import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {browserFixture} from '../test/browser-fixture.mjs';
import {success} from '../test/mcp-fixture.mjs';

const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const cycles = Number(argument('cycles', 100));
const soakSeconds = Number(argument('soak-seconds', 300));
const sourceRef = argument('source-ref');
const scenarios = argument('scenarios', '').split(',');
const launcher = argument('launcher') === 'true';
const entry = argument('entry', path.resolve(`plugins/graph-viewer/${launcher ? 'start.ps1' : 'server.mjs'}`));
const output = path.resolve(argument('output', path.join(os.tmpdir(), `graph-viewer-performance-${Date.now()}.json`)));
const cleanup = [];
const report = {at: new Date().toISOString(), environment: {platform: os.platform(), cpu: os.cpus()[0].model, node: process.version, viewport: '1200x800', throttling: 'none', mcpEntry: entry}, cycles, soakSeconds, scenarios: [], memory: {engine: [], nativeTabs: [], server: [], soak: []}};
const log = (phase, data) => {console.log(JSON.stringify({phase, ...data}));};
function graph(nodes, edges, {cycle = false, long = false} = {}) {
  const items = Array.from({length: nodes}, (_, i) => ({id: `n${i}`, type: ['목표', '관찰', '검증'][i % 3], label: `노드 ${i}: 연결과 실행 결과 확인`, details: (long ? '긴 설명과 원본 자료를 확인합니다. '.repeat(24) : '확인한 근거와 다음 작업을 기록합니다.'), status: '확인'}));
  const links = [];
  for (let gap = 1; links.length < edges && gap < nodes; gap++) for (let i = 0; i < nodes && links.length < edges; i++) {
    const to = cycle ? (i + gap) % nodes : i + gap;
    if (to < nodes) links.push({id: `e${links.length}`, source: `n${i}`, target: `n${to}`, label: '근거'});
  }
  return {schemaVersion: 1, graphId: 'performance', title: '대규모 그래프 성능 검사', nodes: items, edges: links};
}
const dense = graph(500, 2000);
try {
  const f = await browserFixture({after: fn => cleanup.push(fn)}, {graph: dense, nodeArgs: ['--expose-gc', '--inspect=127.0.0.1:0'], entry, launcher});
  report.environment.chromium = f.page.context().browser().version();
  const inspectorUrl = f.client.stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0];
  assert.ok(inspectorUrl, f.client.stderr);
  const socket = new WebSocket(inspectorUrl), calls = new Map();
  let seq = 0;
  await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject;});
  cleanup.push(() => socket.close());
  socket.onmessage = event => {const message = JSON.parse(event.data); if (message.id) {calls.get(message.id)?.(message); calls.delete(message.id);}};
  async function inspect(method, params = {}) {
    const id = ++seq;
    const message = new Promise(resolve => calls.set(id, resolve));
    socket.send(JSON.stringify({id, method, params}));
    const result = await message;
    assert.ok(!result.error, JSON.stringify(result));
    return result.result;
  }
  async function serverMemory(stage) {
    await inspect('HeapProfiler.collectGarbage');
    const result = await inspect('Runtime.evaluate', {expression: 'JSON.stringify({node:process.version,...process.memoryUsage()})', returnByValue: true});
    const memory = {stage, ...JSON.parse(result.result.value)};
    report.memory.server.push(memory);
    log('server-memory', memory);
    return memory;
  }
  await serverMemory('json-start');
  const page = await f.page.context().browser().newPage({viewport: {width: 1200, height: 850}});
  const [model, renderer] = await Promise.all(['model.js', 'renderer.js'].map(file => sourceRef ? execFileSync('git', ['show', `${sourceRef}:src/${file}`], {encoding:'utf8',maxBuffer:1024*1024,windowsHide:true}) : readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')));
  await page.route('http://127.0.0.1/performance', route => route.fulfill({contentType: 'text/html', body: '<style>html,body{margin:0}#graph{width:1200px;height:800px}</style><main id="graph"></main>'}));
  await page.goto('http://127.0.0.1/performance');
  page.on('pageerror', error => f.errors.push(error.message));
  await page.addScriptTag({content: model});
  await page.addScriptTag({content: renderer});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  async function browserMemory(stage) {
    await cdp.send('HeapProfiler.collectGarbage');
    const [heap, dom] = await Promise.all([cdp.send('Runtime.getHeapUsage'), cdp.send('Memory.getDOMCounters')]);
    return {stage, heap: heap.usedSize, ...dom};
  }
  for (const [name, data] of [['50/160', graph(50, 160)], ['250/1000', graph(250, 1000)], ['500/2000', dense], ['500/2000-cycle', graph(500, 2000, {cycle: true})], ['500/2000-long', graph(500, 2000, {long: true})]]) {
    if (scenarios[0] && !scenarios.includes(name)) continue;
    const metrics = await page.evaluate(async graph => {
      const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const mount = [], selection = [], search = [], camera = [], replacement = [];
      for (let trial = 0; trial < 7; trial++) {
        let began = performance.now();
        const view = GraphPanel.mount(document.getElementById('graph'), {graph});
        const mounted = performance.now() - began;
        await paint();
        began = performance.now();
        view.update(graph, {selectedNodeId: 'n0'});
        const selected = performance.now() - began;
        await paint();
        began = performance.now();
        const input = document.querySelector('.graph-viewer').shadowRoot.querySelector('input');
        input.value = '원본'; input.dispatchEvent(new Event('input', {bubbles: true}));
        const searched = performance.now() - began;
        await paint();
        began = performance.now();
        view.update(graph, {camera: {x: 200, y: 200, zoom: 1}});
        const moved = performance.now() - began;
        await paint();
        began = performance.now();
        view.update({...graph, title: `${graph.title} ${trial}`});
        const replaced = performance.now() - began;
        await paint();
        if (trial > 1) {mount.push(mounted); selection.push(selected); search.push(searched); camera.push(moved); replacement.push(replaced);}
        view.destroy();
      }
      const view = GraphPanel.mount(document.getElementById('graph'), {graph, state: {selectedNodeId: 'n0'}});
      await paint();
      const frames = []; let previous;
      await new Promise(resolve => {function frame(now) {if (previous) frames.push(now - previous); previous = now; if (frames.length < 90) requestAnimationFrame(frame); else resolve();} requestAnimationFrame(frame);});
      const nodeCount = document.querySelector('.graph-viewer').shadowRoot.querySelectorAll('.node').length;
      const edgeCount = document.querySelector('.graph-viewer').shadowRoot.querySelectorAll('.connection').length;
      view.destroy();
      const stats = values => {const sorted = [...values].sort((a,b) => a-b);return {median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1]};};
      return {mountMs: stats(mount), selectionMs: stats(selection), searchMs: stats(search), cameraMs: stats(camera), replacementMs: stats(replacement), selectedFrameMs: stats(frames), nodeCount, edgeCount};
    }, data);
    assert.equal(metrics.nodeCount, data.nodes.length);
    assert.equal(metrics.edgeCount, data.edges.length);
    report.scenarios.push({name, ...metrics}); log('scenario', {name, ...metrics});
  }
  if (argument('performance-only') !== 'true') {
    for (let batch = 0; batch <= 5; batch++) {
      if (batch) await page.evaluate(({graph, count}) => {for (let i=0; i<count; i++) {const view = GraphPanel.mount(document.getElementById('graph'), {graph, state: {selectedNodeId: 'n0'}}); view.update({...graph, title: `메모리 검사 ${i}`}); view.destroy();}}, {graph: dense, count: Math.ceil(cycles / 5)});
      report.memory.engine.push(await browserMemory(batch * Math.ceil(cycles / 5)));
      log('engine-memory', report.memory.engine.at(-1));
    }
    await page.evaluate(graph => {
      const grid=document.createElement('section');grid.id='concurrent';grid.style.cssText='display:grid;grid-template-columns:600px 600px';
      document.getElementById('graph').append(grid);
      globalThis.concurrentViews=Array.from({length:4},()=>{const container=document.createElement('div');container.style.cssText='width:600px;height:400px';grid.append(container);return GraphPanel.mount(container,{graph,state:{selectedNodeId:'n0'}});});
    },dense);
    report.memory.concurrentViews=[await browserMemory('4-live-views')];
    await page.evaluate(()=>{for(const view of globalThis.concurrentViews)view.destroy();delete globalThis.concurrentViews;document.getElementById('concurrent').remove();});
    report.memory.concurrentViews.push(await browserMemory('4-destroyed-views'));
    log('concurrent-views', {samples:report.memory.concurrentViews});
    await page.close();
    const nativeCdp = await f.page.context().newCDPSession(f.page);
    async function nativeMemory(stage) {
      await nativeCdp.send('HeapProfiler.collectGarbage');
      const [heap, dom] = await Promise.all([nativeCdp.send('Runtime.getHeapUsage'), nativeCdp.send('Memory.getDOMCounters')]);
      return {stage, heap: heap.usedSize, ...dom};
    }
    const nativeHtml = await f.page.locator('iframe').getAttribute('srcdoc');
    for (let i = 0; i <= 30; i++) {
      if (i) {
        const opened = await f.client.call('open_graph', {graphId: dense.graphId}); success(opened);
        await f.page.evaluate(({html, opened}) => new Promise(resolve => {
          const frame = document.querySelector('iframe');
          function initialized(event) {if (event.source !== frame.contentWindow || event.data?.method !== 'ui/notifications/initialized') return; removeEventListener('message', initialized); window.deliverToolResult(opened); resolve();}
          addEventListener('message', initialized); frame.srcdoc = html;
        }), {html: nativeHtml, opened});
        await f.frame.locator('.node[data-id="n0"]').waitFor();
      }
      if (i % 5 === 0) {report.memory.nativeTabs.push(await nativeMemory(i));log('native-tab-memory', report.memory.nativeTabs.at(-1));}
    }
    for (let i = 0; i < 500; i++) {
      success(await f.client.call('graph_status', {graphId: dense.graphId}));
      if (i % 5 === 0) success(await f.client.call('graph_publish', {graph: {...dense, title: `서버 반복 갱신 ${i}`}, expectedRevision: i / 5 + 1}));
    }
    await serverMemory('500-reads-100-publishes');
    for (let i=0; i<30; i++) success(await f.client.call('graph_publish', {mermaid:'flowchart LR\n A[관찰] --> B[검증] --> C[결론]', graphId:'mermaid-stress', expectedRevision:i}));
    await serverMemory('30-mermaid-publishes');
    const opened = await f.client.call('open_graph', {graphId:dense.graphId}); success(opened); await f.deliver(opened);
    await f.frame.locator('.node[data-id="n0"]').waitFor();
    const end = Date.now() + soakSeconds * 1000;
    while (Date.now() < end) {
      await f.frame.locator(`.node[data-id="${report.memory.soak.length % 2 ? 'n499' : 'n0'}"]`).dispatchEvent('click');
      report.memory.soak.push(await nativeMemory(Math.round((end - Date.now()) / 1000)));
      log('soak', report.memory.soak.at(-1));
      await f.page.waitForTimeout(Math.min(30000, Math.max(0, end-Date.now())));
    }
    await serverMemory('soak-end');
  }
  assert.deepEqual(f.errors, []);
  report.errors = f.errors;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  for (const fn of cleanup.reverse()) await fn();
  log('report', {output});
}
