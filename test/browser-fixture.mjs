import {createRequire} from 'node:module';
import {CHAT_A, fixture, researchGraph, publish, success} from './mcp-fixture.mjs';

const packagePath = process.env.GRAPH_PANEL_PLAYWRIGHT;
const browserOptions = { headless: true, ...(process.env.GRAPH_PANEL_CHROMIUM ? { executablePath: process.env.GRAPH_PANEL_CHROMIUM } : {}) };

export async function browserFixture(t, { initialOrder = 'after', hostTheme = 'dark', graph = researchGraph('MCP 브라우저 최초 문서'), nodeArgs = [], entry, launcher = false } = {}) {
  const f = await fixture(t), client = await f.start(entry, undefined, {nodeArgs, launcher, env: launcher ? {NODE_OPTIONS: '--inspect=127.0.0.1:0'} : {}});
  const originalCall = client.call;
  client.call = (name, args = {}, scope) => originalCall(name, name === 'graph_view' ? args : {projectPath: f.root, ...args}, scope);
  await publish(client, graph);
  const opened = await client.call('open_graph', { graphId: graph.graphId });
  success(opened);
  const { contents } = await client.request('resources/read', { uri: 'ui://graph-viewer/graph-v2.html' });
  const { chromium } = createRequire(import.meta.url)(packagePath);
  const browser = await chromium.launch(browserOptions);
  t.after(() => browser.close());
  const errors = [], downloads = [];
  let held;
  async function openViewer(opened) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    page.on('pageerror', error => errors.push(error.message));
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
      contentType: 'text/html', body: '<title>독립 MCP 호스트</title><iframe title="그래프" sandbox="allow-scripts allow-same-origin" style="width:100%;height:800px;border:0"></iframe>',
    }));
    await page.goto('http://127.0.0.1/mcp-contract-host');
    await page.exposeFunction('mcpDownload', params => {downloads.push(params);});
    await page.evaluate(({ html, opened, initialOrder, hostTheme, clipboardWrite }) => {
      const frame = document.querySelector('iframe');
      if (clipboardWrite) frame.setAttribute('allow', 'clipboard-write');
      const send = message => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...message }, '*');
      window.deliverToolResult = result => send({ method: 'ui/notifications/tool-result', params: result });
      window.deliverHostContext = context => send({method: 'ui/notifications/host-context-changed', params: context});
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
          result = { protocolVersion: '2026-01-26', hostInfo: { name: 'independent-test-host', version: '1' }, hostContext: { displayMode: 'fullscreen', theme: hostTheme } };
        } else if (method === 'tools/call') {
          result = await window.mcpTool(params);
        } else if (method === 'ui/download-file') {
          if (window.rejectDownloads) result = {isError: true};
          else {
            await window.mcpDownload(params);
            const resource = params.contents[0].resource, link = document.createElement('a');
            link.href = `data:${resource.mimeType};base64,${resource.blob}`;
            link.download = decodeURIComponent(resource.uri.split('/').at(-1));
            link.click();
            result = {};
          }
        } else {
          send({ id, error: { code: -32601, message: `Unexpected host request: ${method}` } });
          return;
        }
        send({ id, result });
      });
      frame.srcdoc = html;
    }, { html: contents[0].text, opened, initialOrder, hostTheme, clipboardWrite: contents[0]._meta?.ui?.permissions?.clipboardWrite !== undefined });
    const frame = page.frameLocator('iframe');
    await frame.locator('.graph-viewer').waitFor();
    return {
      page, frame,
      deliver: result => page.evaluate(result => window.deliverToolResult(result), result),
      changeHostContext: context => page.evaluate(context => window.deliverHostContext(context), context),
    };
  }
  const viewer = await openViewer(opened);
  return {
    ...f, client, graph, opened, ...viewer, errors, downloads, openViewer,
    holdNextSync(sessionId) {
      let received, release;
      const receivedPromise = new Promise(resolve => { received = resolve; });
      const releasePromise = new Promise(resolve => { release = resolve; });
      held = { sessionId, received, release: releasePromise };
      return { received: receivedPromise, release };
    },
  };
}
