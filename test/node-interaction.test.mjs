import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {browserFixture} from './browser-fixture.mjs';
import {action, groupedGraph, success} from './mcp-fixture.mjs';

const options = {skip: !process.env.GRAPH_PANEL_PLAYWRIGHT, timeout: 40000};
const builtEntry = path.join('plugins', 'graph-viewer', 'start.ps1');
const node = (viewer, id) => viewer.frame.locator(`.node[data-id="${id}"]`);
const state = viewer => viewer.frame.locator('svg.graph').evaluate(() => graphPanelView.getState());

async function savedUntil(f, predicate) {
  const deadline = Date.now() + 7000;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = success(await f.client.call('graph_read')).snapshot;
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail(`Interaction was not persisted: ${JSON.stringify(snapshot)}`);
}

async function selected(f, id, viewer = f) {
  const saved = await savedUntil(f, snapshot => snapshot.state.selectedNodeId === id);
  await viewer.page.waitForFunction(id => document.querySelector('iframe').contentWindow.graphPanelView.getState().selectedNodeId === id, id);
  assert.equal(await viewer.frame.locator('.node[aria-pressed="true"]').count(), id === null ? 0 : 1);
  return saved;
}

async function setCamera(f, camera) {
  const panel = {...f.opened._meta.graphPanel, snapshot: success(await f.client.call('graph_read')).snapshot};
  await action(f.client, panel, {type: 'setCamera', camera});
  await f.page.waitForFunction(camera => JSON.stringify(document.querySelector('iframe').contentWindow.graphPanelView.getState().camera) === JSON.stringify(camera), camera);
}

async function unchangedCamera(f, expected) {
  // Also observe after the previous single-click navigation animation would finish.
  await f.page.waitForTimeout(500);
  assert.deepEqual((await state(f)).camera, expected);
  assert.deepEqual(success(await f.client.call('graph_read')).snapshot.state.views.large.camera, expected);
}

async function centerOf(card) {
  return card.evaluate(element => {
    const matrix = element.transform.baseVal[0].matrix, rect = element.querySelector('rect');
    return {x: matrix.e + rect.width.baseVal.value / 2, y: matrix.f + rect.height.baseVal.value / 2};
  });
}

async function centered(f, card, zoom) {
  const expected = {...await centerOf(card), zoom};
  const snapshot = await savedUntil(f, snapshot => {
    const camera = snapshot.state.views.large.camera;
    return camera && ['x', 'y', 'zoom'].every(key => Math.abs(camera[key] - expected[key]) < .001);
  });
  assert.equal(snapshot.state.views.large.camera.zoom, zoom);
  return expected;
}

test('single clicks and Enter or Space toggle selection without moving the camera, and share nullable selection', options, async t => {
  const f = await browserFixture(t, {entry: builtEntry, launcher: true});
  f.page.setDefaultTimeout(7000);
  const initial = (await state(f)).camera;
  const camera = {...initial, x: initial.x + 24, y: initial.y + 20, zoom: .65};
  await setCamera(f, camera);
  await node(f, 'question').click();
  await selected(f, 'question');
  await unchangedCamera(f, camera);
  await f.page.keyboard.press('Escape');
  await node(f, 'evidence').click();
  await selected(f, 'evidence');
  assert.equal(await node(f, 'question').getAttribute('aria-pressed'), 'false');
  await unchangedCamera(f, camera);

  const second = await f.openViewer(await f.client.call('open_graph', {graphId: f.graph.graphId}));
  await selected(f, 'evidence', second);
  await node(second, 'evidence').click();
  await selected(f, null, second);
  await selected(f, null);
  await unchangedCamera(f, camera);
  const reopened = await f.openViewer(await f.client.call('open_graph', {graphId: f.graph.graphId}));
  await selected(f, null, reopened);

  await node(f, 'question').focus();
  await f.page.keyboard.press('Enter');
  await selected(f, 'question');
  await f.page.keyboard.press('Enter');
  await selected(f, null);
  await f.page.keyboard.press('Space');
  await selected(f, 'question');
  await f.page.keyboard.press('Space');
  await selected(f, null);
  await unchangedCamera(f, camera);
  assert.deepEqual(f.errors, []);
});

test('real node double-click sequences center the node at unchanged zoom even when it starts selected', options, async t => {
  const f = await browserFixture(t, {entry: builtEntry, launcher: true});
  f.page.setDefaultTimeout(7000);
  const initial = (await state(f)).camera;
  const camera = {...initial, x: initial.x + 18, y: initial.y + 24, zoom: .65};
  await setCamera(f, camera);
  const card = node(f, 'question');
  // A point away from the card center distinguishes node-centering from canvas point-centering.
  await card.dblclick({position: {x: 25, y: 35}});
  await selected(f, 'question');
  await centered(f, card, camera.zoom);

  await setCamera(f, camera);
  await card.dblclick({position: {x: 25, y: 35}});
  await selected(f, 'question');
  const atNode = await centered(f, card, camera.zoom);

  const svg = f.frame.locator('svg.graph'), bounds = await svg.boundingBox();
  const point = {x: bounds.width - 8, y: 10};
  const expected = {
    x: atNode.x + (point.x - bounds.width / 2) / atNode.zoom,
    y: atNode.y + (point.y - bounds.height / 2) / atNode.zoom,
    zoom: atNode.zoom,
  };
  await svg.dblclick({position: point});
  await savedUntil(f, snapshot => {
    const camera = snapshot.state.views.large.camera;
    return camera && ['x', 'y', 'zoom'].every(key => Math.abs(camera[key] - expected[key]) < .01);
  });
  await selected(f, 'question');
  assert.equal((await state(f)).camera.zoom, atNode.zoom);
  assert.deepEqual(f.errors, []);
});

test('collapsed representatives toggle hidden selections and double-click as nodes while fold controls preserve selection', options, async t => {
  const f = await browserFixture(t, {graph: groupedGraph(), entry: builtEntry, launcher: true});
  f.page.setDefaultTimeout(7000);
  await node(f, 'A').click();
  await selected(f, 'A');
  await f.frame.getByRole('button', {name: 'API 서비스 접기', exact: true}).click();
  await savedUntil(f, snapshot => snapshot.state.views.large.collapsedGroupIds.includes('Inner'));
  const card = node(f, 'Inner');
  await card.waitFor();
  assert.equal(await card.getAttribute('aria-pressed'), 'true');
  assert.equal(success(await f.client.call('graph_read')).snapshot.state.selectedNodeId, 'A');
  const camera = (await state(f)).camera;
  await card.click({position: {x: 25, y: 35}});
  await selected(f, null);
  await unchangedCamera(f, camera);
  await card.click({position: {x: 25, y: 35}});
  await selected(f, 'Inner');
  await unchangedCamera(f, camera);
  await card.dblclick({position: {x: 25, y: 35}});
  await selected(f, 'Inner');
  await centered(f, card, camera.zoom);
  await f.frame.getByRole('button', {name: 'API 서비스 펼치기', exact: true}).click();
  await savedUntil(f, snapshot => !snapshot.state.views.large.collapsedGroupIds.includes('Inner'));
  assert.equal(success(await f.client.call('graph_read')).snapshot.state.selectedNodeId, 'Inner');
  assert.equal(await node(f, 'A').count(), 1);
  assert.deepEqual(f.errors, []);
});

test('selected nodes retain distinct type accents and a visible shape cue in both themes', options, async t => {
  const f = await browserFixture(t, {entry: builtEntry, launcher: true});
  f.page.setDefaultTimeout(7000);
  const appearance = card => card.evaluate(element => {
    const root = element.getRootNode(), style = getComputedStyle(element.querySelector('rect'));
    const frame = getComputedStyle(element.querySelector('.node-frame'));
    const mini = root.querySelector(`.mini-node[data-id="${element.dataset.id}"]`);
    const paint = document.createElement('canvas').getContext('2d');
    const color = value => {paint.clearRect(0, 0, 1, 1); paint.fillStyle = value; paint.fillRect(0, 0, 1, 1); return [...paint.getImageData(0, 0, 1, 1).data];};
    return {border: color(style.stroke), frame: color(frame.stroke), cue: Number(frame.opacity), mini: color(getComputedStyle(mini).stroke)};
  });
  for (const theme of ['dark', 'light']) {
    await f.frame.getByRole('combobox', {name: '화면 테마'}).selectOption(theme);
    await f.frame.locator(`.graph-viewer[data-theme="${theme}"]`).waitFor();
    const accents = [];
    for (const id of ['question', 'evidence']) {
      const card = node(f, id), unselected = await appearance(card);
      await card.click();
      await selected(f, id);
      await f.page.mouse.move(0, 0);
      await f.page.waitForTimeout(300);
      const selectedStyle = await appearance(card);
      assert.notDeepEqual(selectedStyle.border, unselected.border, `${theme}/${id}: selection changes the card border`);
      assert.ok(selectedStyle.cue > .9, `${theme}/${id}: the shape cue identifies selection without color alone`);
      accents.push(selectedStyle);
      await card.click();
      await selected(f, null);
      await f.page.mouse.move(0, 0);
      await f.page.waitForTimeout(300);
      assert.equal((await appearance(card)).cue, 0);
    }
    for (const key of ['border', 'frame', 'mini']) assert.notDeepEqual(accents[0][key], accents[1][key], `${theme}: ${key} follows node type instead of one fixed selection color`);
  }
  assert.deepEqual(f.errors, []);
});
