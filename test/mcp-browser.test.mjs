import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { CHAT_B, researchGraph, groupedGraph, publish, success, action } from './mcp-fixture.mjs';

import {browserFixture} from './browser-fixture.mjs';

const packagePath = process.env.GRAPH_PANEL_PLAYWRIGHT;

async function storedUntil(client, predicate, graphId) {
  const deadline = Date.now() + 7000;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = success(await client.call('graph_read', graphId ? {graphId} : {})).snapshot;
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail(`UI state was not saved: ${JSON.stringify(snapshot)}`);
}

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
      const points = Array.from({length: Math.ceil(length / 3) + 1}, (_, i) => path.getPointAtLength(Math.min(i * 3, length)));
      for (const card of cards) {
        if (card.id === edge.from || card.id === edge.to) continue;
        if (points.some(point => point.x > card.x + 3 && point.x < card.x + card.width - 3 && point.y > card.y + 3 && point.y < card.y + card.height - 3)) collisions.push({edge: edge.id, card: card.id});
      }
    }
    return collisions;
  });
  assert.deepEqual(crossed, []);
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

test('multiple viewers keep their graphs and UI state while another graph opens, updates or closes', {skip: !packagePath, timeout: 30000}, async t => {
  const f = await browserFixture(t, {entry: path.join('plugins', 'graph-viewer', 'start.ps1'), launcher: true});
  const firstId = f.graph.graphId, other = {...researchGraph('별도 조사'), graphId: 'second-viewer'};
  other.nodes[0].label = '별도 조사 대상';
  await publish(f.client, other);
  const opened = await f.client.call('open_graph', {graphId: other.graphId});
  success(opened);
  const second = await f.openViewer(opened);
  await f.deliver(opened);
  await second.deliver(f.opened);
  await f.frame.getByRole('combobox', {name: '배치 방식'}).selectOption('tree');
  await storedUntil(f.client, snapshot => snapshot.state.views.large.layout === 'tree', firstId);
  await f.frame.locator('.node[data-id="evidence"]').click();
  await storedUntil(f.client, snapshot => snapshot.state.selectedNodeId === 'evidence', firstId);
  await second.frame.getByRole('textbox', {name: '노드 검색'}).fill('별도 조사');
  await storedUntil(f.client, snapshot => snapshot.state.views.large.query === '별도 조사', other.graphId);
  const edited = researchGraph('첫 그래프 개정');
  edited.nodes[0].label = '계속 연결된 첫 그래프';
  await publish(f.client, edited, 1);
  await f.frame.locator('.node[data-id="question"]').filter({hasText: '계속 연결된 첫 그래프'}).waitFor();
  assert.equal(await second.frame.locator('.node[data-id="question"]').filter({hasText: '별도 조사 대상'}).count(), 1);
  assert.equal(await second.frame.getByRole('textbox', {name: '노드 검색'}).inputValue(), '별도 조사');
  assert.equal(await f.frame.locator('.node[data-id="evidence"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await f.frame.getByRole('textbox', {name: '노드 검색'}).inputValue(), '');
  await second.page.close();
  await f.frame.getByRole('textbox', {name: '노드 검색'}).fill('첫 그래프');
  await storedUntil(f.client, snapshot => snapshot.state.views.large.query === '첫 그래프', firstId);
  const reopened = await f.client.call('open_graph', {graphId: other.graphId});
  const restored = await f.openViewer(reopened);
  assert.equal(await restored.frame.getByRole('textbox', {name: '노드 검색'}).inputValue(), '별도 조사');
  assert.equal(await restored.frame.locator('.node[data-id="question"]').filter({hasText: '별도 조사 대상'}).count(), 1);
  await f.frame.getByRole('textbox', {name: '노드 검색'}).fill('재열기 후에도 저장');
  await storedUntil(f.client, snapshot => snapshot.state.views.large.query === '재열기 후에도 저장', firstId);
  const sameGraph = await f.openViewer(await f.client.call('open_graph', {graphId: firstId}));
  assert.equal(await sameGraph.frame.getByRole('textbox', {name: '노드 검색'}).inputValue(), '재열기 후에도 저장');
  await sameGraph.frame.getByRole('textbox', {name: '노드 검색'}).fill('같은 그래프의 공유 상태');
  await storedUntil(f.client, snapshot => snapshot.state.views.large.query === '같은 그래프의 공유 상태', firstId);
  await f.page.waitForFunction(() => document.querySelector('iframe').contentDocument?.querySelector('.graph-viewer')?.shadowRoot.querySelector('input').value === '같은 그래프의 공유 상태');
  assert.equal(await restored.frame.getByRole('textbox', {name: '노드 검색'}).inputValue(), '별도 조사');
  assert.equal(await f.frame.locator('body>header').isVisible(), false);
  assert.equal(await restored.frame.locator('body>header').isVisible(), false);
  assert.deepEqual(f.errors, []);
});

test('PNG export downloads the entire themed graph through the host without changing view state', {skip: !packagePath, timeout: 30000}, async t => {
  const nodes = Array.from({length: 8}, (_, i) => ({id: `n${i}`, type: i % 2 ? '검증' : '작업', label: `이미지로 저장할 작업 ${i}`, details: '한글 제목과 연결을 보존합니다.'}));
  const graph = {
    schemaVersion: 1, graphId: 'image-export', title: '이미지 저장: 전체/구조', nodes,
    edges: nodes.slice(1).map((node, i) => ({id: `e${i}`, source: `n${i}`, target: node.id, label: '검증'})),
    groups: [{id: 'project', label: '프로젝트 구조', nodeIds: []}, {id: 'service', label: '중첩 서비스', nodeIds: ['n0', 'n1'], parentId: 'project'}],
  };
  const f = await browserFixture(t, {graph, hostTheme: 'light', entry: path.join('plugins', 'graph-viewer', 'start.ps1'), launcher: true});
  f.page.setDefaultTimeout(7000);
  const panel = f.opened._meta.graphPanel;
  await action(f.client, panel, {type: 'selectNode', nodeId: 'n0'});
  await f.page.waitForFunction(() => document.querySelector('iframe').contentWindow.graphPanelView.getState().selectedNodeId === 'n0');
  await f.frame.locator('svg.graph').evaluate(svg => Promise.allSettled(svg.getAnimations({subtree: true}).filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished)));
  const button = f.frame.getByRole('button', {name: '그래프 이미지 저장'});
  async function save(name) {
    const waiting = f.page.waitForEvent('download');
    await button.click();
    const download = await waiting;
    assert.equal(download.suggestedFilename(), 'graph-이미지 저장- 전체-구조.png');
    const file = path.join(f.root, name);
    await download.saveAs(file);
    return readFile(file);
  }
  const state = () => f.frame.locator('svg.graph').evaluate(() => graphPanelView.getState());
  const before = await state(), first = await save('first.png');
  assert.equal(first.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(first.readUInt32BE(16) > 1200, 'offscreen nodes must be included');
  assert.deepEqual(await state(), before);
  await action(f.client, panel, {type: 'setCamera', camera: {x: -10000, y: -10000, zoom: .1}});
  await f.page.waitForFunction(() => document.querySelector('iframe').contentWindow.graphPanelView.getState().camera.zoom === .1);
  const overview = await state(), second = await save('overview.png');
  assert.deepEqual(second, first, 'panning and overview must not hide or crop exported graph content');
  assert.deepEqual(await state(), overview);
  await f.frame.getByRole('combobox', {name: '화면 테마'}).selectOption('dark');
  const dark = await save('dark.png');
  assert.notDeepEqual(dark, first);
  const pixel = await f.page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hasContent = false;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== 20 || pixels[i + 1] !== 22 || pixels[i + 2] !== 24) {hasContent = true; break;}
    return {corner: [...pixels.slice(0, 4)], hasContent};
  }, dark.toString('base64'));
  assert.deepEqual(pixel.corner, [20, 22, 24, 255]);
  assert.equal(pixel.hasContent, true, 'the export must contain graph content rather than only its background');
  assert.equal(f.downloads.length, 3);
  assert.equal(f.downloads[0].contents[0].resource.mimeType, 'image/png');
  await f.page.evaluate(() => {window.rejectDownloads = true;});
  await button.click();
  await f.frame.getByRole('status').filter({hasText: '앱에서 저장 요청을 취소하거나 거부했습니다.'}).waitFor();
  assert.equal(await button.isEnabled(), true);
  assert.deepEqual(await state(), overview);
  await f.page.evaluate(graph => {
    const container = document.createElement('main'); container.style.height = '600px'; document.body.append(container);
    window.standaloneView = document.querySelector('iframe').contentWindow.GraphPanel.mount(container, {graph});
  }, graph);
  const directDownload = f.page.waitForEvent('download');
  await f.page.getByRole('button', {name: '그래프 이미지 저장'}).click();
  const direct = await directDownload;
  assert.equal(direct.suggestedFilename(), 'graph-이미지 저장- 전체-구조.png');
  const directFile = path.join(f.root, 'standalone.png');
  await direct.saveAs(directFile);
  assert.equal((await readFile(directFile)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await f.page.evaluate(() => window.standaloneView.destroy());
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
  await f.page.emulateMedia({reducedMotion: 'no-preference'});
  const luminance = rgb => rgb.map(c => {const s = c / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;}).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => {const first = luminance(a), second = luminance(b); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);};
  for (const theme of ['light', 'dark']) {
    await f.frame.getByRole('combobox', {name: '화면 테마'}).selectOption(theme);
    await f.frame.locator('svg.graph').evaluate(svg => Promise.allSettled(svg.getAnimations({subtree: true}).filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished)));
    const lines = await f.frame.locator('svg.graph').evaluate(svg => {
      const root = svg.getRootNode(), style = selector => getComputedStyle(root.querySelector(selector));
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      return {
        background: rgb(style('.canvas').backgroundColor), active: rgb(style('.edge.related').stroke), passive: rgb(style('.connection.unrelated .edge').stroke),
        passiveOpacity: Number(style('.connection.unrelated').opacity), activeWidth: parseFloat(style('.edge.related').strokeWidth), passiveWidth: parseFloat(style('.connection.unrelated .edge').strokeWidth),
        miniActive: rgb(style('.mini-connection.related .mini-edge').stroke), miniOpacity: Number(style('.mini-connection:not(.related)').opacity), miniWidth: parseFloat(style('.mini-connection.related .mini-edge').strokeWidth),
        light: rgb(style('.edge-flow').stroke), lightWidth: parseFloat(style('.edge-flow').strokeWidth),
        dash: style('.edge-flow').strokeDasharray, duration: style('.edge-flow').animationDuration, lightOpacity: Number(style('.edge-flow').opacity),
        flowPath: root.querySelector('.edge-flow').getAttribute('d'), inactivePath: root.querySelector('.connection.unrelated .edge').getAttribute('d'),
      };
    });
    const passive = lines.passive.map((c, i) => c * lines.passiveOpacity + lines.background[i] * (1 - lines.passiveOpacity));
    assert.ok(contrast(lines.active, lines.background) >= 3, `${theme}: selected paths must stand out from the canvas`);
    assert.ok(contrast(lines.active, passive) >= 2, `${theme}: selected and unrelated paths must remain distinct without animation`);
    assert.ok(lines.activeWidth >= lines.passiveWidth * 1.5);
    assert.deepEqual(lines.miniActive, theme === 'light' ? [56, 110, 172] : [127, 174, 212]);
    assert.equal(lines.miniOpacity, 1);
    assert.equal(lines.miniWidth, 1.2);
    assert.ok(contrast(lines.light, lines.active) >= 1.5, `${theme}: moving light must differ from the selected line`);
    assert.deepEqual(lines.light, [212, 236, 255], `${theme}: use the original dark-theme light color`);
    assert.equal(lines.lightWidth, 2);
    assert.equal(lines.dash, '10px, 42px');
    assert.equal(lines.duration, '1.3s');
    assert.equal(lines.lightOpacity, .95);
    assert.equal(await f.frame.locator('.edge-glow').count(), 0);
    assert.equal(lines.flowPath.includes(lines.inactivePath), false);
    const firstOffset = await f.frame.locator('.edge-flow').evaluate(node => getComputedStyle(node).strokeDashoffset);
    await f.page.waitForTimeout(120);
    const secondOffset = await f.frame.locator('.edge-flow').evaluate(node => getComputedStyle(node).strokeDashoffset);
    assert.notEqual(secondOffset, firstOffset, `${theme}: light must move along the path`);
  }
  await f.page.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await f.frame.locator('.edge-flow:visible').count(), 0);
  assert.equal(await f.frame.locator('.edge.related').count(), 3);
  const panel = {...f.opened._meta.graphPanel, snapshot: success(await f.client.call('graph_read')).snapshot};
  await action(f.client, panel, {type: 'selectNode', nodeId: null});
  await f.frame.locator('.world .connection.unrelated').waitFor({state: 'detached'});
  assert.equal(await f.frame.locator('.edge.related,.mini-connection.related').count(), 0);
  assert.equal(await f.frame.locator('.connection').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).opacity === '1')), true);
  await f.page.emulateMedia({reducedMotion: 'no-preference'});
  assert.equal(await f.frame.locator('.edge-flow:visible').count(), 0);
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
  const image = await f.frame.locator('svg.graph').evaluate(async () => {
    const {blob} = await graphPanelView.exportImage();
    const bytes = new DataView(await blob.arrayBuffer());
    return {type: blob.type, size: blob.size, width: bytes.getUint32(16), height: bytes.getUint32(20)};
  });
  assert.equal(image.type, 'image/png');
  assert.ok(image.size > 1000);
  assert.ok(image.width > 0 && image.width <= 16384 && image.height > 0 && image.height <= 16384);
  assert.ok(image.width * image.height <= 32 * 1024 * 1024);
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

test('layout controls preserve multi-root graphs, selection and search and restore the saved layout after reopening', {skip: !packagePath, timeout: 60000}, async t => {
  const nodes = ['root-a', 'root-b', 'a', 'b', 'c', 'd', 'e', 'done', 'detached'].map(id => ({id, type: '작업', label: id, details: '검사할 연결과 근거'}));
  const links = [['root-a', 'a'], ['root-a', 'b'], ['root-b', 'e'], ['a', 'c'], ['b', 'd'], ['c', 'done'], ['d', 'done'], ['e', 'done'], ['done', 'b']];
  const graph = {schemaVersion: 1, graphId: 'layout-controls', title: '여러 루트와 순환 연결', nodes, edges: links.map(([source, target], i) => ({id: `edge${i}`, source, target}))};
  const f = await browserFixture(t, {graph});
  await f.frame.locator('.node[data-id="root-a"]').click();
  await storedUntil(f.client, item => item.state.selectedNodeId === 'root-a');
  await f.frame.getByRole('textbox', {name: '노드 검색'}).fill('검사');
  await storedUntil(f.client, item => item.state.views.large.query === '검사');
  const direction = f.frame.getByRole('combobox', {name: '배치 방향'});
  const layout = f.frame.getByRole('combobox', {name: '배치 방식'});
  const positions = () => f.frame.locator('.node').evaluateAll(nodes => nodes.map(node => [node.dataset.id, node.transform.baseVal[0].matrix.e, node.transform.baseVal[0].matrix.f]));
  const horizontal = await positions();
  await direction.selectOption('vertical');
  await storedUntil(f.client, item => item.state.views.large.direction === 'vertical');
  const vertical = await positions();
  const root = vertical.find(node => node[0] === 'root-a'), child = vertical.find(node => node[0] === 'a');
  assert.ok(child[2] > root[2]);
  assert.notDeepEqual(vertical, horizontal);
  const arrangements = new Set();
  for (const mode of ['layered', 'tree', 'radial', 'network']) {
    await layout.selectOption(mode);
    const saved = await storedUntil(f.client, item => item.state.views.large.layout === mode);
    assert.equal(saved.state.selectedNodeId, 'root-a');
    assert.equal(saved.state.views.large.query, '검사');
    assert.equal(await f.frame.locator('.node').count(), nodes.length);
    assert.equal(await f.frame.locator('.connection').count(), graph.edges.length);
    assert.equal(await direction.isDisabled(), mode === 'radial' || mode === 'network');
    const overlap = await f.frame.locator('.node').evaluateAll(nodes => {
      const cards = nodes.map(node => {const matrix = node.transform.baseVal[0].matrix, rect = node.querySelector('rect'); return {x: matrix.e, y: matrix.f, w: rect.width.baseVal.value, h: rect.height.baseVal.value};});
      return cards.some((a, i) => cards.slice(i + 1).some(b => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y));
    });
    assert.equal(overlap, false);
    await bypassesCards(f.frame.locator('.graph-viewer'));
    arrangements.add(JSON.stringify(await positions()));
  }
  assert.equal(arrangements.size, 4);
  const before = await positions(), reopened = await f.client.call('open_graph', {graphId: graph.graphId});
  success(reopened);
  await f.page.evaluate(({html, opened}) => {
    const frame = document.querySelector('iframe');
    frame.addEventListener('load', () => window.deliverToolResult(opened), {once: true});
    frame.srcdoc = html;
  }, {html: await f.page.locator('iframe').getAttribute('srcdoc'), opened: reopened});
  await f.frame.getByRole('combobox', {name: '배치 방식'}).waitFor();
  await f.page.waitForFunction(() => document.querySelector('iframe').contentDocument?.querySelector('.graph-viewer')?.shadowRoot.querySelector('[aria-label="배치 방식"]').value === 'network');
  assert.deepEqual(await positions(), before);
  assert.equal(await f.frame.getByRole('textbox', {name: '노드 검색'}).inputValue(), '검사');
  assert.deepEqual(f.errors, []);
});

test('Mermaid groups contain their members, keep nested boundaries and group links in every layout and the minimap', {skip: !packagePath, timeout: 60000}, async t => {
  const f = await browserFixture(t);
  const mermaid = 'flowchart LR\n subgraph Outer[공통 기반]\n subgraph API[API 서비스]\n A[요청] --> B[검증]\n end\n C[저장소]\n B --> C\n end\n subgraph App[사용자 앱]\n D[화면] --> E[완료]\n end\n API --> App\n C --> D';
  success(await f.client.call('graph_publish', {graphId: f.graph.graphId, mermaid, expectedRevision: 1}));
  await f.frame.locator('.group-box[data-id="Outer"]').waitFor();
  const graph = success(await f.client.call('graph_read')).snapshot.graph;
  assert.equal(graph.nodes.length, 5);
  assert.equal(await f.frame.locator('.node[data-id="API"]').count(), 0);
  assert.equal(await f.frame.locator('.mini-group').count(), 3);
  assert.equal(await f.frame.locator('.group-title').filter({hasText: 'API 서비스'}).count(), 1);
  await f.frame.locator('.node[data-id="A"]').dispatchEvent('click');
  await storedUntil(f.client, item => item.state.selectedNodeId === 'A');
  assert.equal(await f.frame.locator('.group-box.related').count(), 3);
  assert.equal(await f.frame.locator('.mini-group.related').count(), 3);
  for (const mode of ['layered', 'tree', 'radial', 'network']) {
    await f.frame.getByRole('combobox', {name: '배치 방식'}).selectOption(mode);
    await storedUntil(f.client, item => item.state.views.large.layout === mode);
    assert.equal(await f.frame.locator('.node').count(), 5);
    assert.equal(await f.frame.locator('.connection').count(), graph.edges.length);
    const contained = await f.frame.locator('.graph').evaluate((svg, groups) => {
      const shadow = svg.getRootNode();
      const box = id => {
        const rect = shadow.querySelector(`.group-box[data-id="${id}"] .group-border`);
        return {x: rect.x.baseVal.value, y: rect.y.baseVal.value, w: rect.width.baseVal.value, h: rect.height.baseVal.value};
      };
      const within = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
      const outer = box('Outer'), app = box('App');
      return groups.every(group => group.nodeIds.every(id => {
        const node = shadow.querySelector(`.node[data-id="${id}"]`), m = node.transform.baseVal[0].matrix, rect = node.querySelector('rect');
        return within({x: m.e, y: m.f, w: rect.width.baseVal.value, h: rect.height.baseVal.value}, box(group.id));
      }) && (!group.parentId || within(box(group.id), box(group.parentId)))) && !(app.x < outer.x + outer.w && app.x + app.w > outer.x && app.y < outer.y + outer.h && app.y + app.h > outer.y);
    }, graph.groups);
    assert.equal(contained, true);
    await bypassesCards(f.frame.locator('.graph-viewer'));
  }
  assert.deepEqual(f.errors, []);
});

test('groups collapse into connected cards, retain nested state and restore across viewers and layouts', {skip: !packagePath, timeout: 60000}, async t => {
  const graph = groupedGraph();
  const f = await browserFixture(t, {graph, entry: path.join('plugins', 'graph-viewer', 'start.ps1'), launcher: true});
  f.page.setDefaultTimeout(7000);
  const toggle = (name, expanded) => f.frame.getByRole('button', {name: `${name} ${expanded ? '접기' : '펼치기'}`, exact: true});
  const ids = selector => f.frame.locator(selector).evaluateAll(nodes => nodes.map(node => node.dataset.id).sort());
  await f.frame.locator('.node[data-id="A"]').dispatchEvent('click');
  await storedUntil(f.client, item => item.state.selectedNodeId === 'A' && item.state.views.large.camera !== null);
  await toggle('API 서비스', true).focus();
  await f.page.keyboard.press('Enter');
  await storedUntil(f.client, item => item.state.views.large.collapsedGroupIds.includes('Inner'));
  assert.deepEqual(await ids('.node'), ['C', 'D', 'E', 'Inner']);
  assert.equal(await f.frame.locator('.node[data-id="Inner"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await toggle('API 서비스', false).getAttribute('aria-expanded'), 'false');
  assert.deepEqual(await ids('.mini-node'), ['C', 'D', 'E', 'Inner']);
  assert.deepEqual(await ids('.connection'), ['ad', 'bc', 'bd', 'dc', 'de', 'empty-d', 'group-d', 'self-d']);
  for (const id of ['ad', 'bd', 'group-d']) assert.equal(await f.frame.locator(`.connection[data-id="${id}"]`).getAttribute('data-from'), 'Inner');
  await f.frame.getByRole('textbox', {name: '노드 검색'}).fill('숨겨진 검색 대상');
  assert.equal(await f.frame.locator('.node[data-id="Inner"].search-miss').count(), 0);
  await f.frame.getByRole('button', {name: '검색어 지우기'}).click();
  await f.frame.locator('.node[data-id="Inner"]').dispatchEvent('click');
  await storedUntil(f.client, item => item.state.selectedNodeId === 'Inner' && item.state.views.large.query === '');
  await toggle('백엔드', true).dispatchEvent('click');
  await storedUntil(f.client, item => item.state.views.large.collapsedGroupIds.includes('Outer'));
  assert.deepEqual(await ids('.node'), ['D', 'E', 'Outer']);
  assert.equal(await f.frame.locator('.connection[data-id="dc"]').getAttribute('data-to'), 'Outer');
  assert.equal(await f.frame.locator('.mini-node.selected[data-id="Outer"]').count(), 1);
  const snapshot = success(await f.client.call('graph_read')).snapshot;
  assert.deepEqual(snapshot.graph, graph);
  const second = await f.openViewer(await f.client.call('open_graph', {graphId: graph.graphId}));
  assert.equal(await second.frame.locator('.node[data-id="Outer"]').count(), 1);
  await toggle('백엔드', false).dispatchEvent('click');
  await storedUntil(f.client, item => !item.state.views.large.collapsedGroupIds.includes('Outer'));
  await second.frame.locator('.node[data-id="Inner"]').waitFor();
  assert.deepEqual(await ids('.node'), ['C', 'D', 'E', 'Inner']);
  for (const mode of ['layered', 'tree', 'radial', 'network']) {
    await f.frame.getByRole('combobox', {name: '배치 방식'}).selectOption(mode);
    await storedUntil(f.client, item => item.state.views.large.layout === mode);
    assert.equal(await f.frame.locator('.node[data-id="Inner"]').count(), 1);
    await bypassesCards(f.frame.locator('.graph-viewer'));
  }
  await f.frame.getByRole('combobox', {name: '화면 테마'}).selectOption('light');
  await toggle('빈 그룹', true).click();
  await storedUntil(f.client, item => item.state.views.large.collapsedGroupIds.includes('Empty'));
  assert.equal(await f.frame.locator('.connection[data-id="empty-d"]').getAttribute('data-from'), 'Empty');
  await f.frame.locator('.node[data-id="Empty"]').dispatchEvent('click');
  const emptyCenter = await f.frame.locator('.node[data-id="Empty"]').evaluate(node => {
    const matrix = node.transform.baseVal[0].matrix, rect = node.querySelector('rect');
    return {x: matrix.e + rect.width.baseVal.value / 2, y: matrix.f + rect.height.baseVal.value / 2};
  });
  await storedUntil(f.client, item => item.state.selectedNodeId === 'Empty' && item.state.views.large.camera?.x === emptyCenter.x && item.state.views.large.camera?.y === emptyCenter.y);
  assert.equal(await f.frame.locator('.connection.related[data-id="empty-d"]').count(), 1);
  const exportState = await f.frame.locator('svg.graph').evaluate(() => graphPanelView.getState());
  await f.frame.getByRole('button', {name: '그래프 이미지 저장', exact: true}).click();
  await f.frame.getByRole('status').filter({hasText: 'PNG 저장을 요청했습니다.'}).waitFor();
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].contents[0].resource.mimeType, 'image/png');
  assert.deepEqual(await f.frame.locator('svg.graph').evaluate(() => graphPanelView.getState()), exportState);
  await toggle('API 서비스', false).focus();
  await f.page.keyboard.press('Space');
  await storedUntil(f.client, item => !item.state.views.large.collapsedGroupIds.includes('Inner'));
  assert.deepEqual(await ids('.node'), ['A', 'B', 'C', 'D', 'E', 'Empty']);
  assert.deepEqual(await ids('.connection'), graph.edges.map(edge => edge.id).sort());
  assert.deepEqual(success(await f.client.call('graph_read')).snapshot.graph, graph);
  await f.frame.locator('svg.graph').evaluate(svg => {
    const root = svg.getRootNode();
    for (const id of ['Inner', 'Other']) root.querySelector(`.group-toggle[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', {bubbles: true}));
  });
  await storedUntil(f.client, item => ['Inner', 'Other', 'Empty'].every(id => item.state.views.large.collapsedGroupIds.includes(id)));
  assert.deepEqual(await ids('.node'), ['C', 'D', 'Empty', 'Inner', 'Other']);
  const beforeAll = success(await f.client.call('graph_read')).snapshot;
  await f.frame.getByRole('button', {name: '전체 그룹 접기', exact: true}).click();
  const allClosed = await storedUntil(f.client, item => item.state.views.large.collapsedGroupIds.length === 4);
  assert.equal(allClosed.stateRevision, beforeAll.stateRevision + 1);
  assert.deepEqual(await ids('.node'), ['D', 'Empty', 'Other', 'Outer']);
  assert.deepEqual(await ids('.mini-node'), ['D', 'Empty', 'Other', 'Outer']);
  assert.equal(await f.frame.getByRole('button', {name: '전체 그룹 접기', exact: true}).isDisabled(), true);
  await f.frame.getByRole('button', {name: '전체 그룹 펼치기', exact: true}).click();
  const allOpened = await storedUntil(f.client, item => item.state.views.large.collapsedGroupIds.length === 0);
  assert.equal(allOpened.stateRevision, allClosed.stateRevision + 1);
  assert.deepEqual(await ids('.node'), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(await ids('.connection'), graph.edges.map(edge => edge.id).sort());
  assert.equal(await f.frame.getByRole('button', {name: '전체 그룹 펼치기', exact: true}).isDisabled(), true);
  await second.frame.locator('.node[data-id="A"]').waitFor();
  await second.page.close();
  assert.deepEqual(f.errors, []);
});

test('clipboard exports complete or content-free graph JSON and supports manual copy when access is denied', {skip: !packagePath, timeout: 30000}, async t => {
  const graph = groupedGraph();
  graph.graphId = 'private-customer-graph'; graph.title = '고객 전용 구조'; graph.kind = 'private-customer-kind';
  graph.nodes[0] = {...graph.nodes[0], type: 'private-customer-type', details: 'private-customer-description', status: 'private-customer-status', sources: [{label: '고객 자료', href: 'https://private.customer.example/doc'}], metadata: {owner: 'private-customer-owner'}};
  graph.metadata = {projectPath: 'C:/private-customer-project'};
  graph.edges[0].metadata = 'private-customer-edge';
  const f = await browserFixture(t, {graph, entry: path.join('plugins', 'graph-viewer', 'start.ps1'), launcher: true});
  f.page.setDefaultTimeout(7000);
  await f.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: 'http://127.0.0.1'});
  await f.frame.getByRole('button', {name: '전체 그룹 접기', exact: true}).click();
  await storedUntil(f.client, item => item.state.views.large.collapsedGroupIds.length === 4);
  const before = success(await f.client.call('graph_read', {graphId: graph.graphId})).snapshot;
  const copy = f.frame.getByRole('button', {name: '그래프 JSON 복사', exact: true});
  const readClipboard = () => f.page.evaluate(() => navigator.clipboard.readText());
  await copy.click();
  await f.frame.getByRole('button', {name: '내용 포함하여 복사'}).focus();
  await f.page.keyboard.press('Enter');
  await f.frame.getByRole('status').filter({hasText: '그래프 JSON을 복사했습니다.'}).waitFor();
  assert.deepEqual(JSON.parse(await readClipboard()), graph, 'hidden members and unknown source fields must be preserved');
  assert.deepEqual(success(await f.client.call('graph_read', {graphId: graph.graphId})).snapshot, before);
  await copy.click();
  await f.frame.getByRole('button', {name: '내용 비우고 복사'}).click();
  await f.frame.getByRole('dialog').waitFor({state: 'hidden'});
  const emptyText = await readClipboard(), empty = JSON.parse(emptyText);
  for (const secret of ['private-customer', 'private.customer.example', '고객', 'API 서비스', '요청', '응답']) assert.equal(emptyText.includes(secret), false, secret);
  assert.equal(empty.nodes.length, 5); assert.equal(empty.groups.length, 4); assert.equal(empty.edges.length, 10);
  const originalIds = new Set([...graph.nodes, ...graph.groups, ...graph.edges].map(item => item.id));
  assert.equal([...empty.nodes, ...empty.groups, ...empty.edges].some(item => originalIds.has(item.id)), false);
  assert.equal(new Set(empty.nodes.map(node => node.type)).size, 2);
  assert.notEqual(empty.nodes[0].type, empty.nodes[1].type);
  assert.equal(empty.nodes[1].type, empty.nodes[4].type);
  const ids = new Map([...empty.nodes.map((node, i) => [node.id, `n${i}`]), ...empty.groups.map((group, i) => [group.id, `g${i}`])]);
  assert.deepEqual(empty.edges.map(edge => [ids.get(edge.source), ids.get(edge.target), edge.direction || 'forward']), [
    ['n0', 'n1', 'forward'], ['n1', 'n2', 'forward'], ['n0', 'n3', 'forward'], ['n1', 'n3', 'forward'],
    ['g1', 'n3', 'forward'], ['n3', 'n2', 'both'], ['n3', 'n4', 'none'], ['g3', 'n3', 'forward'],
    ['n0', 'n0', 'forward'], ['n3', 'n3', 'forward'],
  ]);
  assert.deepEqual(empty.groups.map(group => ({nodes: group.nodeIds.map(id => ids.get(id)), parent: ids.get(group.parentId)})), [
    {nodes: ['n2'], parent: undefined}, {nodes: ['n0', 'n1'], parent: 'g0'}, {nodes: ['n4'], parent: undefined}, {nodes: [], parent: undefined},
  ]);
  await publish(f.client, empty);
  assert.deepEqual(success(await f.client.call('graph_read', {graphId: empty.graphId})).snapshot.graph, empty);
  await f.frame.locator('svg.graph').evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {configurable: true, value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError'))});
  });
  await copy.click();
  await f.frame.getByRole('button', {name: '내용 포함하여 복사'}).click();
  await f.frame.getByRole('dialog').waitFor({state: 'hidden'});
  assert.deepEqual(JSON.parse(await readClipboard()), graph, 'legacy copy must still write to the actual clipboard');
  await f.frame.locator('svg.graph').evaluate(() => {document.execCommand = () => false;});
  await f.page.setViewportSize({width: 380, height: 850});
  await copy.click();
  await f.frame.getByRole('button', {name: '내용 비우고 복사'}).click();
  const manual = f.frame.getByRole('textbox', {name: '복사할 그래프 JSON'});
  await manual.waitFor();
  assert.deepEqual(JSON.parse(await manual.inputValue()), empty);
  await f.page.keyboard.press('Control+c');
  assert.deepEqual(JSON.parse(await readClipboard()), empty);
  const within = await f.frame.getByRole('dialog').evaluate(dialog => {
    const bounds = dialog.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
  });
  assert.equal(within, true);
  await f.page.keyboard.press('Escape');
  await f.frame.getByRole('dialog').waitFor({state: 'hidden'});
  assert.deepEqual(success(await f.client.call('graph_read', {graphId: graph.graphId})).snapshot, before);
  assert.deepEqual(f.errors, []);
});

test('uneven nested groups pack disconnected nodes without oversized gaps or long detours', {skip: !packagePath, timeout: 60000}, async t => {
  const graph = {schemaVersion: 1, graphId: 'compact-groups', title: '크기가 다른 그룹과 외부 연결', nodes: [], edges: [], groups: [{id: 'app', label: '애플리케이션', nodeIds: []}]};
  for (const [id, count] of [['views', 12], ['processors', 9], ['device', 4], ['core', 2], ['entry', 1], ['standalone', 3]]) {
    const nodes = Array.from({length: count}, (_, i) => ({id: id + i, type: '작업', label: `${id} ${i}`}));
    graph.nodes.push(...nodes);
    graph.groups.push({id, label: id, nodeIds: nodes.map(node => node.id), ...(['views', 'processors'].includes(id) ? {parentId: 'app'} : {})});
  }
  const edge = (source, target) => graph.edges.push({id: `e${graph.edges.length}`, source, target, label: '호출'});
  edge('entry0', 'views0');
  for (let i = 0; i < 12; i++) edge(`views${i}`, `processors${i % 9}`);
  for (let i = 0; i < 9; i++) edge(`processors${i}`, `core${i % 2}`);
  for (const [from, to] of [['processors3', 'device0'], ['device0', 'device1'], ['device1', 'device2'], ['device2', 'device3'], ['device3', 'processors3']]) edge(from, to);
  const f = await browserFixture(t, {graph, entry: path.join('plugins', 'graph-viewer', 'start.ps1'), launcher: true});
  for (const mode of ['layered', 'tree', 'radial', 'network']) {
    await f.frame.getByRole('combobox', {name: '배치 방식'}).selectOption(mode);
    if (mode === 'layered' || mode === 'tree') await f.frame.getByRole('combobox', {name: '배치 방향'}).selectOption(mode === 'layered' ? 'vertical' : 'horizontal');
    await storedUntil(f.client, item => item.state.views.large.layout === mode && (mode !== 'layered' || item.state.views.large.direction === 'vertical'));
    const geometry = await f.frame.locator('svg.graph').evaluate(svg => {
      const root = svg.getRootNode(), box = root.querySelector('.world').getBBox();
      const cards = [...root.querySelectorAll('.node')].map(node => {const m = node.transform.baseVal[0].matrix, rect = node.querySelector('rect'); return {x: m.e, y: m.f, w: rect.width.baseVal.value, h: rect.height.baseVal.value};});
      const group = root.querySelector('.group-box[data-id="views"] .group-border');
      return {
        area: box.width * box.height, cardArea: cards[0].w * cards[0].h, diagonal: Math.hypot(cards[0].w, cards[0].h),
        aspect: group.width.baseVal.value / group.height.baseVal.value,
        nodeCount: cards.length, edgeCount: root.querySelectorAll('.connection').length,
        routeLength: [...root.querySelectorAll('.edge')].reduce((sum, edge) => sum + edge.getTotalLength(), 0),
        overlap: cards.some((a, i) => cards.slice(i + 1).some(b => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)),
      };
    });
    assert.equal(geometry.nodeCount, graph.nodes.length);
    assert.equal(geometry.edgeCount, graph.edges.length);
    assert.equal(geometry.overlap, false);
    assert.ok(geometry.aspect >= 1 / 3 && geometry.aspect <= 3, `${mode}: independent members must not form one long strip`);
    assert.ok(geometry.area < geometry.cardArea * graph.nodes.length * 6, `${mode}: oversized groups must not spread every row and column`);
    assert.ok(geometry.routeLength < geometry.diagonal * graph.edges.length * 4, `${mode}: related groups must stay close enough to avoid long detours`);
    await bypassesCards(f.frame.locator('.graph-viewer'));
  }
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

  await f.frame.getByRole('button', {name: '그래프 이미지 저장', exact: true}).focus();
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
  await f.frame.getByRole('button', {name: '그래프 이미지 저장', exact: true}).focus();
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
