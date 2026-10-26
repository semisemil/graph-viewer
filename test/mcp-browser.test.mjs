import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { CHAT_A, CHAT_B, fixture, researchGraph, publish, success } from './mcp-fixture.mjs';

const packagePath = process.env.GRAPH_PANEL_PLAYWRIGHT;
const browserOptions = { headless: true, ...(process.env.GRAPH_PANEL_CHROMIUM ? { executablePath: process.env.GRAPH_PANEL_CHROMIUM } : {}) };

async function browserFixture(t, { initialOrder = 'after' } = {}) {
  const f = await fixture(t), client = await f.start();
  const originalCall = client.call;
  client.call = (name, args = {}, scope) => originalCall(name, name === 'graph_view' ? args : {projectPath: f.root, ...args}, scope);
  const graph = researchGraph('MCP 브라우저 최초 문서');
  await publish(client, graph);
  const opened = await client.call('open_graph', { graphId: graph.graphId });
  success(opened);
  const { contents } = await client.request('resources/read', { uri: 'ui://graph-viewer/graph-v2.html' });
  const { chromium } = createRequire(import.meta.url)(packagePath);
  const browser = await chromium.launch(browserOptions);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let held;
  await page.exposeFunction('mcpTool', async params => {
    const result = await client.request('tools/call', { ...params, _meta: { ...params._meta, threadId: CHAT_A.threadId } });
    if (held && params.name === 'graph_view' && params.arguments.op === 'sync' && params.arguments.sessionId === held.sessionId) {
      const waiting = held;
      held = null;
      waiting.received();
      await waiting.release;
    }
    return result;
  });
  await page.route('http://127.0.0.1/mcp-contract-host', route => route.fulfill({
    contentType: 'text/html', body: '<title>독립 MCP 호스트</title><iframe title="그래프" style="width:100%;height:800px;border:0"></iframe>',
  }));
  await page.goto('http://127.0.0.1/mcp-contract-host');
  await page.evaluate(({ html, opened, initialOrder }) => {
    const frame = document.querySelector('iframe');
    const send = message => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...message }, '*');
    window.deliverToolResult = result => send({ method: 'ui/notifications/tool-result', params: result });
    let initialDelivered = false;
    const deliverInitial = () => {
      if (initialDelivered) return;
      initialDelivered = true;
      window.deliverToolResult(opened);
    };
    addEventListener('message', async event => {
      if (event.source !== frame.contentWindow) return;
      const { id, method, params } = event.data || {};
      if (method === 'ui/notifications/initialized') {
        if (initialOrder === 'after') deliverInitial();
        return;
      }
      if (id === undefined) return;
      let result;
      if (method === 'ui/initialize') {
        if (initialOrder === 'before') deliverInitial();
        result = { protocolVersion: '2026-01-26', hostInfo: { name: 'independent-test-host', version: '1' }, hostContext: { displayMode: 'fullscreen' } };
      } else if (method === 'tools/call') {
        result = await window.mcpTool(params);
      } else {
        send({ id, error: { code: -32601, message: `Unexpected host request: ${method}` } });
        return;
      }
      send({ id, result });
    });
    frame.srcdoc = html;
  }, { html: contents[0].text, opened, initialOrder });
  const frame = page.frameLocator('iframe');
  await frame.locator('.node[data-id="question"]').waitFor();
  return {
    ...f, client, graph, opened, page, frame, errors,
    deliver: result => page.evaluate(result => window.deliverToolResult(result), result),
    holdNextSync(sessionId) {
      let received, release;
      const receivedPromise = new Promise(resolve => { received = resolve; });
      const releasePromise = new Promise(resolve => { release = resolve; });
      held = { sessionId, received, release: releasePromise };
      return { received: receivedPromise, release };
    },
  };
}

async function storedUntil(client, predicate) {
  const deadline = Date.now() + 7000;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = success(await client.call('graph_read')).snapshot;
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail(`UI state was not saved: ${JSON.stringify(snapshot)}`);
}

for (const initialOrder of ['before', 'after']) {
  test(`MCP UI accepts the initial tool result ${initialOrder} bridge initialization and updates its existing graph`, { skip: !packagePath, timeout: 30000 }, async t => {
    const f = await browserFixture(t, { initialOrder });
    await f.frame.locator('svg.graph').evaluate(node => { window.initialGraphSvg = node; });
    await f.frame.locator('.node[data-id="evidence"]').click();
    await storedUntil(f.client, snapshot => snapshot.state.selectedNodeId === 'evidence');
    const edited = researchGraph('MCP 브라우저 수정 문서');
    edited.nodes[0].label = '수정한 관찰 대상';
    await publish(f.client, edited, 1);
    await f.frame.locator('.node[data-id="question"]').filter({ hasText: '수정한 관찰 대상' }).waitFor();
    assert.equal(await f.frame.locator('svg.graph').evaluate(node => node === window.initialGraphSvg), true);
    assert.equal(f.page.context().pages().length, 1);
    assert.equal(await f.frame.locator('.node[data-id="evidence"]').getAttribute('aria-pressed'), 'true');
    await f.frame.getByRole('textbox', { name: '노드 검색' }).fill('관찰');
    await storedUntil(f.client, snapshot => snapshot.revision === 2 && snapshot.state.views.large.query === '관찰');
    assert.deepEqual(f.errors, []);
  });
}

test('late old open results cannot discard a valid in-flight UI connection or change its pinned chat', { skip: !packagePath, timeout: 30000 }, async t => {
  const f = await browserFixture(t);
  const edited = researchGraph('신규 연결의 문서');
  edited.nodes[0].label = '신규 연결에서 표시';
  await publish(f.client, edited, 1);
  const current = await f.client.call('open_graph', { graphId: edited.graphId });
  success(current);
  const waiting = f.holdNextSync(current._meta.graphPanel.sessionId);
  await f.deliver(current);
  await waiting.received;
  await f.deliver(f.opened);
  waiting.release();
  await f.frame.locator('.node[data-id="question"]').filter({ hasText: '신규 연결에서 표시' }).waitFor();
  await f.deliver(f.opened);
  const other = researchGraph('다른 채팅');
  other.nodes[0].label = '표시되면 안 되는 다른 채팅';
  await publish(f.client, other, 0, CHAT_B);
  const foreign = await f.client.call('open_graph', { graphId: other.graphId }, CHAT_B);
  success(foreign);
  await f.deliver(foreign);
  const otherProject = path.join(f.root, '다른 프로젝트');
  await mkdir(otherProject);
  const foreignProjectGraph = researchGraph('다른 프로젝트');
  foreignProjectGraph.nodes[0].label = '표시되면 안 되는 다른 프로젝트';
  success(await f.client.call('graph_publish', {projectPath: otherProject, graph: foreignProjectGraph, expectedRevision: 0}));
  const foreignProject = await f.client.call('open_graph', {projectPath: otherProject, graphId: other.graphId});
  success(foreignProject);
  await f.deliver(foreignProject);
  await f.frame.getByRole('textbox', { name: '노드 검색' }).fill('신규 연결 저장');
  const saved = await storedUntil(f.client, snapshot => snapshot.state.views.large.query === '신규 연결 저장');
  assert.deepEqual(saved.graph, edited);
  assert.equal(await f.frame.locator('.node[data-id="question"]').filter({ hasText: '신규 연결에서 표시' }).count(), 1);
  const untouched = success(await f.client.call('graph_read', { graphId: other.graphId }, CHAT_B)).snapshot;
  assert.equal(untouched.state.views.large.query, '');
  const untouchedProject = success(await f.client.call('graph_read', {projectPath: otherProject, graphId: other.graphId})).snapshot;
  assert.equal(untouchedProject.state.views.large.query, '');
  assert.deepEqual(f.errors, []);
});

test('Mermaid arrows and selected paths render consistently in the graph and minimap', {skip: !packagePath, timeout: 30000}, async t => {
  const f = await browserFixture(t);
  f.page.setDefaultTimeout(7000);
  success(await f.client.call('graph_publish', {
    mermaid: 'flowchart LR\n A[시작] --> B[확인]\n B <--> C[검증]\n C --- D[완료]',
    graphId: f.graph.graphId, expectedRevision: 1,
  }));
  await f.frame.locator('.node[data-id="D"]').waitFor();
  await f.frame.getByRole('button', {name: '전체 맞춤'}).click();
  for (const selector of ['.edge', '.mini-edge']) {
    assert.equal(await f.frame.locator(selector).count(), 3);
    assert.equal(await f.frame.locator(selector + '[marker-end]').count(), 2);
    assert.equal(await f.frame.locator(selector + '[marker-start]').count(), 1);
  }
  await f.frame.locator('.node[data-id="D"]').click();
  await storedUntil(f.client, snapshot => snapshot.state.selectedNodeId === 'D');
  assert.equal(await f.frame.locator('.node.connected').count(), 3);
  assert.equal(await f.frame.locator('.mini-node.connected').count(), 3);
  assert.deepEqual(f.errors, []);
});
