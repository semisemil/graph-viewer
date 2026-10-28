import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { CHAT_B, researchGraph, publish, success, action } from './mcp-fixture.mjs';

import {browserFixture} from './browser-fixture.mjs';

const packagePath = process.env.GRAPH_PANEL_PLAYWRIGHT;

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

test('toolbar clears persisted search and double-click centers the clicked point without changing zoom', {skip: !packagePath, timeout: 30000}, async t => {
  const f = await browserFixture(t);
  f.page.setDefaultTimeout(7000);
  assert.equal(await f.frame.locator('body>header').isVisible(), false);
  assert.equal(await f.frame.locator('body').getByText(f.graph.title, {exact: true}).count(), 0);
  const search = f.frame.getByRole('textbox', {name: '노드 검색'});
  const clear = f.frame.locator('.search-field').getByRole('button', {name: '검색어 지우기'});
  const query = f.graph.nodes[0].label;
  await search.fill(query);
  await storedUntil(f.client, snapshot => snapshot.state.views.large.query === query);
  assert.ok(await f.frame.locator('.node.search-miss').count() > 0);
  await clear.click();
  assert.equal(await search.inputValue(), '');
  assert.equal(await clear.isVisible(), false);
  assert.equal(await search.evaluate(input => input.getRootNode().activeElement === input), true);
  await storedUntil(f.client, snapshot => snapshot.state.views.large.query === '');
  assert.equal(await f.frame.locator('.node.search-miss').count(), 0);

  const svg = f.frame.locator('svg.graph');
  const before = await svg.evaluate(() => window.graphPanelView.getState());
  const bounds = await svg.boundingBox();
  const point = {x: bounds.width - 8, y: 10};
  const expected = {
    x: before.camera.x + (point.x - bounds.width / 2) / before.camera.zoom,
    y: before.camera.y + (point.y - bounds.height / 2) / before.camera.zoom,
    zoom: before.camera.zoom,
  };
  await svg.dblclick({position: point});
  const saved = await storedUntil(f.client, snapshot => {
    const camera = snapshot.state.views.large.camera;
    return camera && ['x', 'y', 'zoom'].every(key => Math.abs(camera[key] - expected[key]) < .01);
  });
  assert.equal(saved.state.selectedNodeId, before.selectedNodeId);
  assert.equal(saved.state.views.large.camera.zoom, before.camera.zoom);
  assert.equal(await f.frame.locator('body>header').isVisible(), false);
  assert.deepEqual(f.errors, []);
});

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
    mermaid: 'flowchart LR\n A[시작] --> B[확인]\n B <--> C[검증]\n C --- D[완료]\n A --> X[다른 분기]',
    graphId: f.graph.graphId, expectedRevision: 1,
  }));
  await f.frame.locator('.node[data-id="D"]').waitFor();
  await f.frame.getByRole('button', {name: '전체 맞춤'}).click();
  for (const selector of ['.edge', '.mini-edge']) {
    assert.equal(await f.frame.locator(selector).count(), 4);
    assert.equal(await f.frame.locator(selector + '[marker-end]').count(), 3);
    assert.equal(await f.frame.locator(selector + '[marker-start]').count(), 1);
  }
  await f.frame.locator('.node[data-id="D"]').click();
  await storedUntil(f.client, snapshot => snapshot.state.selectedNodeId === 'D');
  assert.equal(await f.frame.locator('.node.connected').count(), 3);
  assert.equal(await f.frame.locator('.mini-node.connected').count(), 3);
  assert.equal(await f.frame.locator('.node.unrelated[data-id="X"]').count(), 1);
  assert.deepEqual(f.errors, []);
});

test('the maximum graph keeps nodes selectable in overview and restores labels after zooming', {skip: !packagePath, timeout: 30000}, async t => {
  const nodes = Array.from({length: 500}, (_, i) => ({id: `n${i}`, type: '작업', label: `작업 ${i}`}));
  const edges = [];
  for (let gap = 1; edges.length < 2000; gap++) for (let i = 0; i + gap < nodes.length && edges.length < 2000; i++) edges.push({id: `e${edges.length}`, source: `n${i}`, target: `n${i + gap}`});
  const f = await browserFixture(t, {graph: {schemaVersion: 1, graphId: 'maximum', title: '최대 크기 그래프', nodes, edges}});
  assert.equal(await f.frame.getByRole('button', {name: /^작업: 작업 /}).count(), 500);
  await f.frame.getByRole('button', {name: '전체 맞춤'}).click();
  await storedUntil(f.client, snapshot => snapshot.state.views.large.camera?.zoom < .2);
  const title = f.frame.locator('.node[data-id="n0"] .node-title');
  assert.equal(await title.evaluate(node => getComputedStyle(node).display), 'none');
  assert.equal(await f.frame.locator('.edge-flow:visible').count(), 0);
  await f.frame.locator('.node[data-id="n0"]').dispatchEvent('click');
  await storedUntil(f.client, snapshot => snapshot.state.selectedNodeId === 'n0' && snapshot.state.views.large.camera?.zoom >= 1);
  assert.notEqual(await title.evaluate(node => getComputedStyle(node).display), 'none');
  assert.equal(await f.frame.locator('.edge-flow:visible').count(), 1);
  assert.equal(await f.frame.locator('.node.connected').count(), 499);
  assert.equal(await f.frame.locator('.mini-node.connected').count(), 499);
  assert.deepEqual(f.errors, []);
});

test('long connections bypass cards in both orientations and a long graph opens at a readable scale', {skip: !packagePath, timeout: 30000}, async t => {
  const nodes = [
    {id: 'context', type: '자료', label: '기존 구조와 제약 확인'},
    {id: 'request', type: '요청', label: '직전 작업과 변경 요구'},
    ...Array.from({length: 10}, (_, i) => ({id: `n${i}`, type: '작업', label: `작업 ${i}: 설계 변경의 근거와 검사 결과 확인`})),
  ];
  const edges = [
    {id: 'start', source: 'context', target: 'n0'},
    ...Array.from({length: 9}, (_, i) => ({id: `step${i}`, source: `n${i}`, target: `n${i + 1}`})),
    ...[2, 4, 6, 9].map(i => ({id: `request${i}`, source: 'request', target: `n${i}`, label: '관련 변경'})),
  ];
  const graph = {schemaVersion: 1, graphId: 'long-connections', title: '긴 작업 경로와 관련 변경', nodes, edges};
  const f = await browserFixture(t, {graph, hostTheme: 'light'});
  const initial = await f.frame.locator('body').evaluate(() => graphPanelView.getState());
  assert.ok(initial.camera.zoom >= .75);
  assert.ok((await f.frame.locator('.node[data-id="n0"] .node-title tspan').count()) > 1);
  await f.frame.getByRole('button', {name: '전체 맞춤'}).click();
  await storedUntil(f.client, snapshot => snapshot.state.views.large.camera?.zoom < .5);
  await f.frame.getByRole('button', {name: '100%로 보기'}).click();
  await storedUntil(f.client, snapshot => Math.abs((snapshot.state.views.large.camera?.zoom || 0) - 1) < 1e-8);

  async function bypassesCards(locator) {
    const crossed = await locator.locator('.world .edge').evaluateAll(paths => {
      const shadow = paths[0].getRootNode();
      const cards = [...shadow.querySelectorAll('.node')].map(node => {
        const {e: x, f: y} = node.transform.baseVal[0].matrix, rect = node.querySelector('rect');
        return {id: node.dataset.id, x, y, width: rect.width.baseVal.value, height: rect.height.baseVal.value};
      });
      const collisions = [];
      for (const path of paths) {
        const edge = path.parentElement.dataset, length = path.getTotalLength();
        for (const card of cards) {
          if (card.id === edge.from || card.id === edge.to) continue;
          for (let t = 0; t <= length; t += 3) {
            const point = path.getPointAtLength(t);
            if (point.x > card.x + 3 && point.x < card.x + card.width - 3 && point.y > card.y + 3 && point.y < card.y + card.height - 3) {
              collisions.push({edge: edge.id, card: card.id});
              break;
            }
          }
        }
      }
      return collisions;
    });
    assert.deepEqual(crossed, []);
  }
  await bypassesCards(f.frame.locator('.graph-viewer'));
  await f.frame.locator('body').evaluate((body, graph) => {
    const container = document.createElement('main');
    container.id = 'compact-check';
    container.style.cssText = 'width:360px;height:700px';
    body.append(container);
    window.compactView = GraphPanel.mount(container, {graph, compact: true});
  }, graph);
  await bypassesCards(f.frame.locator('#compact-check'));
  const cyclic = {...graph, edges: [...edges, {id: 'return', source: 'n5', target: 'n2'}, {id: 'self', source: 'n3', target: 'n3'}]};
  await publish(f.client, cyclic, 1);
  await f.frame.locator('.graph-viewer').first().locator('.connection[data-id="return"]').waitFor();
  await bypassesCards(f.frame.locator('.graph-viewer').first());
  await f.frame.locator('body').evaluate((body, graph) => compactView.update(graph), cyclic);
  await bypassesCards(f.frame.locator('#compact-check'));
  assert.deepEqual(f.errors, []);
});

test('node details use a scrollable custom tooltip that supports hover, keyboard and narrow screens', {skip: !packagePath, timeout: 30000}, async t => {
  const f = await browserFixture(t);
  f.page.setDefaultTimeout(7000);
  const graph = researchGraph('노드 툴팁 확인');
  graph.nodes[0].label = '조사 기록에서 확인한 관찰과 후속 검증의 전체 제목';
  graph.nodes[0].details = '첫 번째 관찰 <img src=x onerror=alert(1)>\n확인한 근거와 다음 검증을 함께 읽습니다.\n'.repeat(40);
  await publish(f.client, graph, 1);
  const node = f.frame.locator('.node[data-id="question"]');
  await node.filter({hasText: '조사 기록'}).waitFor();
  assert.equal(await f.frame.locator('.detail').count(), 0);
  assert.equal(await node.locator('title').count(), 0);
  await node.hover();
  const tooltip = f.frame.getByRole('tooltip');
  await tooltip.waitFor();
  assert.equal(await tooltip.locator('.tooltip-title').textContent(), graph.nodes[0].label);
  assert.equal(await tooltip.locator('.tooltip-body').textContent(), graph.nodes[0].details);
  assert.equal(await tooltip.locator('.tooltip-source-url').textContent(), graph.nodes[0].sources[0].href);
  assert.equal(await tooltip.locator('img').count(), 0);
  assert.equal(await node.getAttribute('aria-describedby'), await tooltip.getAttribute('id'));
  await tooltip.hover({position: {x: 35, y: 100}});
  await f.page.mouse.wheel(0, 180);
  await f.page.waitForTimeout(160);
  const scroller = tooltip.locator('.tooltip-scroll');
  const scrollTop = await scroller.evaluate(element => element.scrollTop);
  assert.ok(scrollTop > 0);
  await f.page.waitForTimeout(1150);
  assert.equal(await tooltip.isVisible(), true);
  assert.equal(await scroller.evaluate(element => element.scrollTop), scrollTop);
  await tooltip.click({position: {x: 35, y: 100}});
  await f.page.keyboard.press('Escape');
  await tooltip.waitFor({state: 'hidden'});
  await f.page.waitForTimeout(1150);
  assert.equal(await tooltip.isVisible(), false);

  await f.frame.getByRole('combobox', {name: '화면 테마'}).focus();
  await f.page.keyboard.press('Tab');
  await tooltip.waitFor();
  await f.page.keyboard.press('PageDown');
  assert.ok(await scroller.evaluate(element => element.scrollTop > 0));
  await f.page.keyboard.press('Enter');
  await storedUntil(f.client, snapshot => snapshot.state.selectedNodeId === 'question');
  await f.page.keyboard.press('Escape');
  await tooltip.waitFor({state: 'hidden'});

  await f.page.setViewportSize({width: 340, height: 650});
  await f.page.locator('iframe').evaluate(element => { element.style.height = '600px'; });
  await f.frame.getByRole('button', {name: '전체 맞춤'}).click();
  await node.hover();
  await tooltip.waitFor();
  const bounds = await f.frame.locator('.canvas').boundingBox();
  const popup = await tooltip.boundingBox();
  assert.ok(popup.x >= bounds.x && popup.y >= bounds.y);
  assert.ok(popup.x + popup.width <= bounds.x + bounds.width + 1);
  assert.ok(popup.y + popup.height <= bounds.y + bounds.height + 1);
  const card = await node.boundingBox();
  assert.ok(popup.y + popup.height <= card.y || popup.y >= card.y + card.height);
  graph.nodes[0].details = '좁은 화면에서도 읽던 위치를 유지합니다.\n'.repeat(5);
  await publish(f.client, graph, 2);
  await node.filter({hasText: '좁은 화면'}).waitFor();
  await f.page.mouse.move(0, 0);
  await node.hover();
  await tooltip.waitFor();
  await tooltip.hover({position: {x: 35, y: 100}});
  await f.page.mouse.wheel(0, 90);
  await f.page.waitForTimeout(160);
  const narrowScrollTop = await scroller.evaluate(element => element.scrollTop);
  assert.ok(narrowScrollTop > 0);
  await f.page.waitForTimeout(1150);
  assert.equal(await scroller.evaluate(element => element.scrollTop), narrowScrollTop);
  await f.frame.getByRole('combobox', {name: '화면 테마'}).focus();
  await f.page.mouse.move(0, 0);
  await tooltip.waitFor({state: 'hidden'});
  const panel = {...f.opened._meta.graphPanel, snapshot: success(await f.client.call('graph_read')).snapshot};
  await action(f.client, panel, {type: 'setCamera', camera: {x: -2000, y: 0, zoom: 1}});
  await f.page.waitForTimeout(1150);
  await f.page.keyboard.press('Tab');
  await f.page.keyboard.press('Enter');
  await tooltip.waitFor();
  assert.equal(await tooltip.locator('.tooltip-title').textContent(), graph.nodes[0].label);
  assert.deepEqual(f.errors, []);
});

test('light and dark themes follow host changes, preserve graph state and retain an explicit choice after reopening', {skip: !packagePath, timeout: 30000}, async t => {
  const f = await browserFixture(t, {hostTheme: 'dark'});
  f.page.setDefaultTimeout(7000);
  await f.page.emulateMedia({colorScheme: 'light'});
  const surface = theme => f.frame.locator(`.graph-viewer[data-theme="${theme}"]`);
  const control = f.frame.getByRole('combobox', {name: '화면 테마'});
  const state = () => f.frame.locator('svg.graph').evaluate(() => window.graphPanelView.getState());
  const appearance = () => f.frame.locator('svg.graph').evaluate(svg => {
    const root = svg.getRootNode(), style = selector => getComputedStyle(root.querySelector(selector));
    const gradientId = style('.node>rect').fill.match(/#([^"')]+)/)[1];
    const paint = document.createElement('canvas').getContext('2d');
    const card = [...root.getElementById(gradientId).querySelectorAll('stop')].map(stop => {
      paint.fillStyle = getComputedStyle(stop).stopColor;
      paint.fillRect(0, 0, 1, 1);
      return `rgb(${[...paint.getImageData(0, 0, 1, 1).data].slice(0, 3).join(',')})`;
    });
    return {canvas: style('.canvas').backgroundColor, card,
      title: style('.node-title').fill, body: style('.node-body').fill, type: style('.node-type').fill,
      minimap: style('.minimap').backgroundColor, tooltip: style('.tooltip-title').color,
      page: getComputedStyle(document.body).backgroundColor};
  });
  await surface('dark').waitFor();
  await f.frame.locator('.node[data-id="evidence"]').click();
  await storedUntil(f.client, snapshot => snapshot.state.selectedNodeId === 'evidence' && snapshot.state.views.large.camera !== null);
  const before = await state();
  const dark = await appearance();
  await f.changeHostContext({theme: 'light'});
  await surface('light').waitFor();
  const light = await appearance();
  for (const key of Object.keys(light)) assert.notDeepEqual(light[key], dark[key], key);
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(value => {
    const s = Number(value) / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  for (const key of ['title', 'body', 'type']) for (const background of light.card) {
    const a = luminance(light[key]), b = luminance(background);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, key);
  }
  assert.deepEqual(await state(), before);
  await control.selectOption('dark');
  await surface('dark').waitFor();
  await f.changeHostContext({theme: 'light'});
  await f.page.waitForTimeout(80);
  assert.equal(await surface('dark').count(), 1);
  await control.selectOption('light');
  await surface('light').waitFor();
  await f.page.evaluate(opened => new Promise(resolve => {
    const frame = document.querySelector('iframe');
    const initialized = event => {
      if (event.source !== frame.contentWindow || event.data?.method !== 'ui/notifications/initialized') return;
      removeEventListener('message', initialized);
      window.deliverToolResult(opened);
      resolve();
    };
    addEventListener('message', initialized);
    frame.srcdoc = frame.srcdoc;
  }), f.opened);
  await surface('light').waitFor();
  assert.equal(await control.inputValue(), 'light');
  assert.deepEqual(await state(), before);
  await control.selectOption('auto');
  await surface('dark').waitFor();
  await f.changeHostContext({theme: 'light'});
  await surface('light').waitFor();
  assert.deepEqual(await state(), before);
  assert.deepEqual(f.errors, []);
});
