import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {startServer} from '../src/server.mjs';

const packagePath = process.argv[2];
if (!packagePath) throw new Error('사용법: node scripts/verify-browser.mjs <playwright 패키지 절대 경로>');
const {chromium} = createRequire(import.meta.url)(packagePath);
const temporary = await mkdtemp(path.join(tmpdir(), 'graph-browser-'));
const artifactDir = new URL('../.local/engine-work/', import.meta.url);
await mkdir(artifactDir, {recursive: true});
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const chatRef = {hostId: 'local', threadId: '11111111-1111-4111-8111-111111111111'};
const graph = {
  schemaVersion: 1, graphId: 'browser-check', title: '공개 그래프 동작 확인', kind: '임의 자료',
  nodes: [
    {id: 'root', type: '목표', label: '자료 살펴보기'},
    {id: 'a', type: '확인', label: '연결 확인', details: '전체 텍스트 <img src=x onerror=alert(1)>를 코드로 실행하지 않고 보여줍니다. '.repeat(5)},
    {id: 'other', type: '다른 분기', label: '별도 탐색'},
    {id: 'c', type: '근거', label: '충분한 너비를 사용하는 노드 제목과 전체 내용을 확인하는 예시'},
    {id: 'end', type: '결론', label: '근거 확인'},
    {id: 'island', type: '분리 노드', label: '별도 항목'},
  ],
  edges: [
    {id: 'root-a', source: 'root', target: 'a', label: '확인'},
    {id: 'root-other', source: 'root', target: 'other'},
    {id: 'a-c', source: 'a', target: 'c'},
    {id: 'c-end', source: 'c', target: 'end'},
    {id: 'other-end', source: 'other', target: 'end'},
  ],
};
let service, browser, token;
const outcomes = [];
async function request(route, body) {
  const response = await fetch(`${origin}${route}`, {method: body ? 'POST' : 'GET', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
const route = `/view?${new URLSearchParams({...chatRef, graphId: graph.graphId})}`;
const savedState = () => request(`/api/status?${new URLSearchParams({...chatRef, graphId: graph.graphId})}`);
async function camera(page) {return page.evaluate(() => graphPanelView.getState().camera);}
function near(a, b) {for (const key of ['x', 'y', 'zoom']) assert.ok(Math.abs(a[key] - b[key]) < .01, `${key}: ${a[key]} / ${b[key]}`);}

try {
  service = await startServer({dataDir: temporary, port});
  token = (await (await fetch(`${origin}/connection`)).json()).token;
  await request('/api/publish', {chatRef, graph, expectedRevision: 0});
  browser = await chromium.launch({headless: true, ...(process.argv[3] ? {executablePath: process.argv[3]} : {})});
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + route);
  await page.waitForFunction(() => globalThis.graphPanelView);
  assert.equal(await page.locator('.node').count(), 6);
  assert.equal(await page.locator('.edge-flow:visible').count(), 0);

  let release, held;
  const heldResponse = new Promise(resolve => {held = resolve;});
  const releaseResponse = new Promise(resolve => {release = resolve;});
  await page.route('**/api/status?*', async handler => {
    const response = await handler.fetch();
    held();
    await releaseResponse;
    await handler.fulfill({response});
  }, {times: 1});
  await heldResponse;
  const before = await camera(page);
  await page.locator('.node[data-id="a"]').click();
  await page.waitForTimeout(90);
  const during = await camera(page);
  assert.notDeepEqual(during, before);
  release();
  await page.waitForTimeout(160);
  assert.equal(await page.locator('.node[data-id="a"]').getAttribute('aria-pressed'), 'true');
  const later = await camera(page);
  assert.notDeepEqual(later, during);
  await page.waitForTimeout(300);
  const related = await page.locator('.connection.related').evaluateAll(nodes => nodes.map(node => node.dataset.id).sort());
  assert.deepEqual(related, ['a-c', 'c-end', 'root-a']);
  assert.deepEqual(await page.locator('.mini-connection.related').evaluateAll(nodes => nodes.map(node => node.dataset.id).sort()), related);
  assert.equal(await page.locator('.mini-node.selected').getAttribute('data-id'), 'a');
  assert.ok((await page.locator('.edge-flow:visible').count()) > 0);
  assert.equal(await page.locator('.node img').count(), 0);
  outcomes.push('선택 전체 경로, 미니맵 일치, 지연 조회 중 선택/카메라 애니메이션 보존');

  const box = await page.locator('svg.graph').boundingBox();
  const beforeDrag = await camera(page);
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 88, box.y + 58, {steps: 5});
  await page.mouse.up();
  const released = await camera(page);
  assert.notDeepEqual(released, beforeDrag);
  await page.waitForTimeout(650);
  near(await camera(page), released);
  const viewportWidth = await page.locator('.viewport').getAttribute('width');
  await page.getByRole('button', {name: '확대', exact: true}).click();
  await page.waitForTimeout(450);
  assert.ok(Number(await page.locator('.viewport').getAttribute('width')) < Number(viewportWidth));
  outcomes.push('드래그 종료 즉시 정지, 확대와 미니맵 현재 영역');
  await page.getByRole('textbox', {name: '노드 검색'}).fill('근거');
  await page.waitForTimeout(650);
  const state = (await savedState()).snapshot.state;
  assert.equal(state.selectedNodeId, 'a');
  assert.equal(state.views.large.query, '근거');
  assert.equal(state.views.summary.query, '');
  await page.screenshot({path: path.join(new URL(artifactDir).pathname.replace(/^\/(.:)/, '$1'), 'browser-large.png')});

  await service.close();
  await page.waitForTimeout(600);
  service = await startServer({dataDir: temporary, port});
  token = (await (await fetch(`${origin}/connection`)).json()).token;
  await page.waitForFunction(() => document.getElementById('connection').dataset.error === 'false', null, {timeout: 7000});
  assert.equal(await page.getByRole('textbox', {name: '노드 검색'}).inputValue(), '근거');
  await page.getByRole('textbox', {name: '노드 검색'}).fill('복구 뒤 검색');
  await page.waitForTimeout(900);
  assert.equal((await savedState()).snapshot.state.views.large.query, '복구 뒤 검색');
  outcomes.push('같은 열린 HTML 페이지가 서비스 재시작 후 인증/세션 복구와 상태 저장 재개');
  await page.close();
  await new Promise(resolve => setTimeout(resolve, 3200));
  assert.equal((await savedState()).applied, null);
  outcomes.push('큰 화면을 닫은 뒤 이전 마운트 확인 만료');

  const compact = await browser.newPage({viewport: {width: 340, height: 920}});
  await compact.route('**/client.js', handler => handler.fulfill({contentType: 'text/javascript', body: ''}));
  await compact.goto(origin + route);
  await compact.waitForFunction(() => globalThis.GraphPanel);
  await compact.evaluate(graph => {
    document.getElementById('connection').remove();
    globalThis.graphPanelView = GraphPanel.mount(document.getElementById('graph'), {graph, compact: true});
  }, graph);
  assert.equal(await compact.locator('.node[data-id="a"] .node-title tspan').count(), 1);
  await compact.locator('.node[data-id="a"]').focus();
  await compact.keyboard.press('Enter');
  await compact.waitForTimeout(400);
  assert.match(await compact.locator('.detail').innerText(), /<img src=x onerror=alert\(1\)>/);
  assert.equal(await compact.locator('img').count(), 0);
  assert.equal(await compact.locator('.node[data-id="a"]').getAttribute('aria-pressed'), 'true');
  const map = compact.locator('.minimap');
  await compact.mouse.move(0, 0);
  await compact.waitForTimeout(200);
  assert.equal(await map.evaluate(node => Number(getComputedStyle(node).opacity)), .3);
  await map.hover();
  await compact.waitForTimeout(220);
  assert.equal(await map.evaluate(node => Number(getComputedStyle(node).opacity)), 1);
  await compact.screenshot({path: path.join(new URL(artifactDir).pathname.replace(/^\/(.:)/, '$1'), 'browser-summary.png')});
  await compact.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await compact.locator('.edge-flow:visible').count(), 0);
  outcomes.push('세로 배치, 한 줄 제목, 전체 텍스트, 키보드 선택, 반투명 미니맵 hover와 동작 줄이기');

  for (const sample of [
    {...graph, nodes: [], edges: []},
    {...graph, nodes: graph.nodes.slice(0, 2), edges: [{id: 'one', source: 'root', target: 'a'}, {id: 'two', source: 'a', target: 'root'}, {id: 'self', source: 'a', target: 'a'}]},
  ]) {
    await compact.evaluate(graph => graphPanelView.update(graph), sample);
    assert.equal(await compact.locator('.node').count(), sample.nodes.length);
    assert.equal(await compact.locator('path[d*="NaN"]').count(), 0);
  }
  outcomes.push('빈 그래프, 순환과 자기 연결 표시');
  assert.deepEqual(errors, []);
  await writeFile(new URL('browser-results.json', artifactDir), JSON.stringify({verified: outcomes}, null, 2));
  console.log(JSON.stringify({verified: outcomes}));
} finally {
  await browser?.close();
  await service?.close();
  assert.ok(path.resolve(temporary).startsWith(path.resolve(tmpdir()) + path.sep));
  assert.ok(path.basename(temporary).startsWith('graph-browser-'));
  await rm(temporary, {recursive: true, force: true});
}
