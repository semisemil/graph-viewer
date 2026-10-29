import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { ROOT, ENTRY, CHAT_A, CHAT_B, researchGraph, groupedGraph, fixture, success, rejected, publish, openGraph, sync, action } from './mcp-fixture.mjs';

const execFileAsync = promisify(execFile);

test('MCP binds document changes to the host chat and preserves a complete new graph', async t => {
  const f = await fixture(t), client = await f.start();
  rejected(await client.call('graph_status', {}, null), 'missing-chat-context');
  const empty = success(await client.call('graph_status'));
  assert.deepEqual(empty.graphs, []);
  assert.equal(empty.snapshot, null);
  assert.equal(empty.activeGraphId, null);
  rejected(await client.call('open_graph', { graphId: 'unregistered' }), 'graph-not-found');
  const graph = researchGraph();
  const file = path.join(f.root, '독립 입력.json');
  await writeFile(file, JSON.stringify(graph), 'utf8');
  const saved = success(await client.call('graph_publish', { graphPath: file, expectedRevision: 0 }));
  assert.equal(saved.revision, 1);
  assert.equal(saved.committed, true);
  const panel = await openGraph(client, graph.graphId);
  assert.deepEqual(panel.snapshot.graph, graph);
  assert.deepEqual(success(await client.call('graph_read', { graphId: graph.graphId })).snapshot, panel.snapshot);
  const edited = researchGraph('최신 문서');
  await publish(client, edited, 1);
  const updated = await sync(client, panel);
  success(updated);
  assert.deepEqual(updated._meta.graphPanel.snapshot.graph, edited);
  assert.equal(updated._meta.graphPanel.snapshot.revision, 2);
  rejected(await client.call('graph_publish', { graph: researchGraph('늦은 수정'), expectedRevision: 1 }), 'revision-conflict');
  const afterConflict = await sync(client, panel);
  assert.deepEqual(afterConflict._meta.graphPanel.snapshot, updated._meta.graphPanel.snapshot);
  const status = success(await client.call('graph_status', { graphId: graph.graphId }));
  assert.equal(status.activeGraphId, graph.graphId);
  assert.deepEqual(status.graphs, [{ graphId: graph.graphId, title: edited.title, revision: 2 }]);
  assert.equal(status.snapshot.revision, 2);
  assert.equal(status.snapshot.graph, undefined);
  await openGraph(client, graph.graphId);
});

test('same graph identity in two chats keeps documents, selection and cameras separate', async t => {
  const f = await fixture(t), client = await f.start();
  const a = researchGraph('채팅 A'), b = researchGraph('채팅 B');
  b.nodes[1].details = 'B에서만 작성한 내용';
  await publish(client, a, 0, CHAT_A);
  await publish(client, b, 0, CHAT_B);
  const panelA = await openGraph(client, a.graphId, CHAT_A);
  const panelB = await openGraph(client, b.graphId, CHAT_B);
  await action(client, panelA, { type: 'selectNode', nodeId: 'question' });
  await action(client, panelA, { type: 'setCamera', camera: { x: 39, y: -81, zoom: 1.7 } });
  await action(client, panelB, { type: 'selectNode', nodeId: 'evidence' });
  await action(client, panelB, { type: 'setCamera', camera: { x: -7, y: 23, zoom: 0.8 } });
  await publish(client, researchGraph('A의 수정'), 1, CHAT_A);
  const first = (await sync(client, panelA))._meta.graphPanel.snapshot;
  const second = (await sync(client, panelB))._meta.graphPanel.snapshot;
  assert.equal(first.graph.title, 'A의 수정');
  assert.deepEqual(second.graph, b);
  assert.deepEqual(first.state, panelA.snapshot.state);
  assert.deepEqual(second.state, panelB.snapshot.state);
  assert.equal(first.state.selectedNodeId, 'question');
  assert.equal(second.state.selectedNodeId, 'evidence');
  const mismatched = await client.call('graph_view', { op: 'sync', scope: CHAT_A, sessionId: panelA.sessionId }, CHAT_B);
  assert.equal(mismatched.isError, true);
  assert.equal(mismatched._meta?.graphPanel?.snapshot, undefined);
});

test('two MCP processes accept one simultaneous revision and retain distinct graph registrations', async t => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([f.start(), f.start()]);
  const initial = researchGraph();
  await publish(a, initial);
  const contenders = [researchGraph('동시 수정 A'), researchGraph('동시 수정 B')];
  const results = await Promise.all([a.call('graph_publish', { graph: contenders[0], expectedRevision: 1 }), b.call('graph_publish', { graph: contenders[1], expectedRevision: 1 })]);
  assert.equal(results.filter(result => result.isError !== true).length, 1);
  const winningIndex = results.findIndex(result => result.isError !== true);
  rejected(results[1 - winningIndex], 'revision-conflict');
  const first = await openGraph(a, initial.graphId);
  assert.deepEqual(first.snapshot.graph, contenders[winningIndex]);
  assert.equal(first.snapshot.revision, 2);
  const second = await openGraph(b, initial.graphId);
  assert.deepEqual(second.snapshot, first.snapshot);
  const distinct = [researchGraph('별도 A'), researchGraph('별도 B')];
  distinct[0].graphId = 'independent-a';
  distinct[1].graphId = 'independent-b';
  await Promise.all([publish(a, distinct[0]), publish(b, distinct[1])]);
  assert.deepEqual((await openGraph(a, distinct[0].graphId)).snapshot.graph, distinct[0]);
  assert.deepEqual((await openGraph(b, distinct[1].graphId)).snapshot.graph, distinct[1]);
});

test('reopening a graph across processes keeps prior viewers connected and rejects stale state writes', async t => {
  const f = await fixture(t), a = await f.start(), b = await f.start();
  const graph = researchGraph();
  await publish(a, graph);
  const oldPanel = await openGraph(a, graph.graphId);
  await action(a, oldPanel, { type: 'selectNode', nodeId: 'question' });
  const current = await openGraph(b, graph.graphId);
  await action(b, current, { type: 'selectNode', nodeId: 'evidence' });
  assert.deepEqual((await sync(a, oldPanel))._meta.graphPanel.snapshot, current.snapshot);
  const delayed = await a.call('graph_view', {
    op: 'action', scope: CHAT_A, sessionId: oldPanel.sessionId,
    graphId: graph.graphId, revision: 1, expectedStateRevision: oldPanel.snapshot.stateRevision,
    action: { type: 'selectNode', nodeId: 'question' },
  });
  rejected(delayed, 'state-conflict');
  const staleState = await b.call('graph_view', {
    op: 'action', scope: CHAT_A, sessionId: current.sessionId,
    graphId: graph.graphId, revision: 1, expectedStateRevision: current.snapshot.stateRevision - 1,
    action: { type: 'setCamera', camera: { x: 0, y: 0, zoom: 2 } },
  });
  assert.equal(staleState.isError, true);
  assert.deepEqual((await sync(b, current))._meta.graphPanel.snapshot, current.snapshot);
  await publish(a, researchGraph('개정 문서'), 1);
  const oldRevision = await b.call('graph_view', {
    op: 'action', scope: CHAT_A, sessionId: current.sessionId,
    graphId: graph.graphId, revision: 1, expectedStateRevision: current.snapshot.stateRevision,
    action: { type: 'selectNode', nodeId: 'question' },
  });
  rejected(oldRevision, 'revision-conflict');
  const latest = (await sync(b, current))._meta.graphPanel.snapshot;
  assert.equal(latest.graph.title, '개정 문서');
  assert.deepEqual(latest.state, current.snapshot.state);
});

test('viewers stay bound to different graphs through opens, publishes and a server reconnect', async t => {
  const f = await fixture(t), a = await f.start(), b = await f.start();
  const first = researchGraph('구조'), second = {...researchGraph('조사'), graphId: 'investigation'};
  await publish(a, first);
  const panelA = await openGraph(a, first.graphId);
  await action(a, panelA, {type: 'setLayout', layout: 'tree', direction: 'vertical'});
  await action(a, panelA, {type: 'selectNode', nodeId: 'question'});
  await publish(b, second);
  const panelB = await openGraph(b, second.graphId);
  await action(b, panelB, {type: 'setQuery', query: '실험'});
  await action(b, panelB, {type: 'selectNode', nodeId: 'evidence'});
  for (const panel of [panelA, panelB]) {
    const response = await sync(a, panel);
    success(response);
    assert.deepEqual(response._meta.graphPanel.snapshot, panel.snapshot);
    success(await a.call('graph_view', {
      op: 'ack', scope: panel.scope, sessionId: panel.sessionId, graphId: panel.snapshot.graph.graphId,
      revision: panel.snapshot.revision, stateRevision: panel.snapshot.stateRevision, displayMode: 'fullscreen',
    }));
  }
  assert.equal(success(await a.call('graph_status', {graphId: first.graphId})).lastReport.graphId, first.graphId);
  assert.equal(success(await a.call('graph_status', {graphId: second.graphId})).lastReport.graphId, second.graphId);
  const wrongGraph = await a.call('graph_view', {
    op: 'action', scope: panelA.scope, sessionId: panelA.sessionId, graphId: second.graphId,
    revision: panelB.snapshot.revision, expectedStateRevision: panelB.snapshot.stateRevision,
    action: {type: 'setQuery', query: '다른 그래프에 쓰면 안 됨'},
  });
  rejected(wrongGraph, 'revision-conflict');
  await publish(a, {...first, title: '구조 개정'}, 1);
  assert.deepEqual((await sync(b, panelB))._meta.graphPanel.snapshot, panelB.snapshot);
  panelA.snapshot = (await sync(a, panelA))._meta.graphPanel.snapshot;
  assert.equal(panelA.snapshot.revision, 2);
  assert.equal(panelA.snapshot.state.selectedNodeId, 'question');
  await Promise.all([a.stop(), b.stop()]);
  const restarted = await f.start();
  for (const panel of [panelA, panelB]) {
    assert.deepEqual((await sync(restarted, panel))._meta.graphPanel.snapshot, panel.snapshot);
    await action(restarted, panel, {type: 'setCamera', camera: {x: 50, y: 70, zoom: 1.2}});
  }
});

test('acknowledged selection, camera and search survive server reconnect and UI reopening', async t => {
  const f = await fixture(t), client = await f.start();
  const graph = researchGraph();
  await publish(client, graph);
  const panel = await openGraph(client, graph.graphId);
  await action(client, panel, { type: 'selectNode', nodeId: 'evidence' });
  await action(client, panel, { type: 'setLayout', layout: 'tree', direction: 'vertical' });
  const camera = { x: -73, y: 104, zoom: 1.45 };
  await action(client, panel, { type: 'setCamera', camera });
  await action(client, panel, { type: 'setQuery', query: '측정 결과' });
  assert.equal(panel.snapshot.state.selectedNodeId, 'evidence');
  assert.deepEqual(panel.snapshot.state.views.large.camera, camera);
  assert.equal(panel.snapshot.state.views.large.query, '측정 결과');
  assert.equal(panel.snapshot.state.views.large.layout, 'tree');
  assert.equal(panel.snapshot.state.views.large.direction, 'vertical');
  const known = { knownGraphId: graph.graphId, knownRevision: panel.snapshot.revision, knownStateRevision: panel.snapshot.stateRevision };
  const unchanged = await sync(client, panel, known);
  success(unchanged);
  assert.equal(unchanged._meta?.graphPanel?.snapshot, undefined);
  assert.equal(unchanged.structuredContent.unchanged, true);
  success(await client.call('graph_view', {
    op: 'ack', scope: CHAT_A, sessionId: panel.sessionId, graphId: graph.graphId,
    revision: panel.snapshot.revision, stateRevision: panel.snapshot.stateRevision, displayMode: 'fullscreen',
  }));
  const report = success(await client.call('graph_status')).lastReport;
  assert.equal(report.graphId, graph.graphId);
  assert.equal(report.revision, panel.snapshot.revision);
  assert.equal(report.stateRevision, panel.snapshot.stateRevision);
  assert.equal(report.displayMode, 'fullscreen');
  assert.equal(typeof report.at, 'string');
  await client.stop();
  const restarted = await f.start();
  const recovered = await sync(restarted, panel);
  success(recovered);
  assert.deepEqual(recovered._meta.graphPanel.snapshot, panel.snapshot);
  const reopened = await openGraph(restarted, graph.graphId);
  assert.deepEqual(reopened.snapshot, panel.snapshot);
  assert.deepEqual((await sync(restarted, panel))._meta.graphPanel.snapshot, panel.snapshot);
});

test('collapsed groups and group selection survive reconnect, preserve source data and prune removed groups', async t => {
  const f = await fixture(t), client = await f.start(), graph = groupedGraph();
  await publish(client, graph);
  const panel = await openGraph(client, graph.graphId);
  await action(client, panel, {type: 'setGroupCollapsed', groupId: 'Inner', collapsed: true});
  await action(client, panel, {type: 'setGroupCollapsed', groupId: 'Outer', collapsed: true});
  await action(client, panel, {type: 'selectNode', nodeId: 'Outer'});
  const camera = {x: 120, y: 90, zoom: .8};
  await action(client, panel, {type: 'setGroupCollapsed', groupId: 'Outer', collapsed: false, camera});
  assert.deepEqual(panel.snapshot.graph, graph);
  assert.deepEqual(panel.snapshot.state.views.large.collapsedGroupIds, ['Inner']);
  assert.deepEqual(panel.snapshot.state.views.summary.collapsedGroupIds, []);
  assert.deepEqual(panel.snapshot.state.views.large.camera, camera);
  await client.stop();
  const restarted = await f.start(), reopened = await openGraph(restarted, graph.graphId);
  assert.deepEqual(reopened.snapshot, panel.snapshot);
  rejected(await restarted.call('graph_view', {op: 'action', scope: CHAT_A, sessionId: reopened.sessionId,
    graphId: graph.graphId, revision: 1, expectedStateRevision: reopened.snapshot.stateRevision,
    action: {type: 'setGroupCollapsed', groupId: 'missing', collapsed: true}}), 'invalid-group');
  const edited = structuredClone(graph);
  edited.groups = edited.groups.filter(group => group.id !== 'Inner' && group.id !== 'Outer');
  edited.edges = edited.edges.filter(edge => edge.id !== 'group-d');
  await publish(restarted, edited, 1);
  const saved = success(await restarted.call('graph_read', {graphId: graph.graphId})).snapshot;
  assert.deepEqual(saved.state.views.large.collapsedGroupIds, []);
  assert.equal(saved.state.selectedNodeId, null);
  assert.deepEqual(saved.graph, edited);
});

test('legacy single-view records restore their connection and graph state with default layouts', async t => {
  const f = await fixture(t), client = await f.start(), graph = researchGraph();
  await publish(client, graph);
  const panel = await openGraph(client, graph.graphId);
  await action(client, panel, {type: 'selectNode', nodeId: 'evidence'});
  const camera = {x: 30, y: 80, zoom: .9};
  await action(client, panel, {type: 'setCamera', camera});
  await client.stop();
  const key = createHash('sha256').update(JSON.stringify([CHAT_A.hostId, CHAT_A.threadId])).digest('hex');
  const file = path.join(f.dataDir, 'chats', `${key}.json`), record = JSON.parse(await readFile(file, 'utf8'));
  record.nativeView = {sessionId: panel.sessionId}; delete record.nativeViews;
  for (const view of Object.values(record.graphs[0].state.views)) {delete view.layout; delete view.direction; delete view.collapsedGroupIds;}
  await writeFile(file, JSON.stringify(record), 'utf8');
  const restarted = await f.start(), saved = success(await restarted.call('graph_read', {graphId: graph.graphId})).snapshot;
  assert.deepEqual(saved.graph, graph);
  assert.equal(saved.state.selectedNodeId, 'evidence');
  assert.deepEqual(saved.state.views.large.camera, camera);
  assert.equal(saved.state.views.large.layout, 'layered');
  assert.equal(saved.state.views.large.direction, 'horizontal');
  assert.equal(saved.state.views.summary.direction, 'vertical');
  assert.deepEqual(saved.state.views.large.collapsedGroupIds, []);
  assert.deepEqual((await sync(restarted, panel))._meta.graphPanel.snapshot, saved);
  const another = {...researchGraph('새 그래프'), graphId: 'another'};
  await publish(restarted, another);
  await openGraph(restarted, another.graphId);
  assert.deepEqual((await sync(restarted, panel))._meta.graphPanel.snapshot, saved);
});

test('backup recovery restores saved graph state without reviving a prior UI token', async t => {
  const f = await fixture(t), client = await f.start();
  const graph = researchGraph();
  await publish(client, graph);
  const panel = await openGraph(client, graph.graphId);
  await action(client, panel, { type: 'selectNode', nodeId: 'evidence' });
  const savedBeforeLastWrite = structuredClone(panel.snapshot);
  await action(client, panel, { type: 'setQuery', query: '백업 이후 변경' });
  await client.stop();
  const key = createHash('sha256').update(JSON.stringify([CHAT_A.hostId, CHAT_A.threadId])).digest('hex');
  await writeFile(path.join(f.dataDir, 'chats', `${key}.json`), '{corrupt JSON', 'utf8');
  const restarted = await f.start();
  rejected(await sync(restarted, panel), 'stale-session');
  const reopened = await openGraph(restarted, graph.graphId);
  assert.notEqual(reopened.sessionId, panel.sessionId);
  assert.deepEqual(reopened.snapshot, savedBeforeLastWrite);
});

test('modern discovery exposes model and app tools separately and returns a self-contained UI resource', async t => {
  const f = await fixture(t), client = await f.start(ENTRY, ROOT, { modern: true });
  assert.ok(client.discovery.supportedVersions.includes('2026-07-28'));
  assert.equal(client.discovery.resultType, 'complete');
  assert.ok(client.discovery.capabilities.tools);
  assert.ok(client.discovery.capabilities.resources);
  const fallback = await f.start(ENTRY, ROOT, { protocolVersion: '9999-12-31' });
  assert.notEqual(fallback.initialized.protocolVersion, '9999-12-31');
  const { tools } = await client.request('tools/list');
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  for (const name of ['graph_publish', 'graph_status', 'graph_read', 'open_graph']) {
    assert.deepEqual(byName.get(name)._meta.ui.visibility, ['model']);
  }
  assert.deepEqual(byName.get('graph_view')._meta.ui.visibility, ['app']);
  const uri = 'ui://graph-viewer/graph-v2.html';
  assert.equal(byName.get('open_graph')._meta.ui.resourceUri, uri);
  for (const name of ['graph_publish', 'graph_status', 'graph_read', 'graph_view']) {
    assert.equal(byName.get(name)._meta.ui.resourceUri, undefined);
  }
  const { contents } = await client.request('resources/read', { uri });
  assert.equal(contents.length, 1);
  assert.equal(contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(contents[0]._meta['openai/ui'].availableDisplayModes, ['fullscreen']);
  assert.match(contents[0].text, /<html[\s>]/i);
  assert.doesNotMatch(contents[0].text, /(?:src|href)=["'](?:file:|[A-Z]:[\\/])/i);
  assert.doesNotMatch(contents[0].text, /C:[\\/]graph-viewer/i);
  const graph = researchGraph();
  await publish(client, graph);
  for (const name of ['graph_status', 'open_graph']) {
    const result = await client.call(name, { graphId: graph.graphId });
    success(result);
    const modelResult = JSON.stringify({ content: result.content, structuredContent: result.structuredContent });
    assert.ok(!modelResult.includes(graph.nodes[0].details));
    assert.ok(!modelResult.includes(graph.nodes[1].details));
    assert.equal(result.structuredContent.snapshot?.graph, undefined);
  }
  const read = success(await client.call('graph_read', { graphId: graph.graphId }));
  assert.deepEqual(read.snapshot.graph, graph);
});

test('the packaged launcher exits on host disconnection without a forced kill', async t => {
  const f = await fixture(t);
  const client = await f.start(path.join(ROOT, 'plugins/graph-viewer/start.ps1'), ROOT, {launcher: true});
  const exit = await client.stop();
  assert.deepEqual(exit, {code: 0, signal: null, forced: false});
});

test('a generated package runs after moving to a directory with spaces and Korean text', { timeout: 120000 }, async t => {
  const f = await fixture(t);
  const output = path.join(f.root, 'generated-package');
  const moved = path.join(f.root, '옮긴 패키지 with spaces');
  await execFileAsync(process.execPath, [path.join(ROOT, 'scripts', 'package-mcp.mjs'), '--output', output, '--data-dir', f.dataDir], {
    cwd: ROOT, windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024,
  });
  await rename(output, moved);
  const plugin = path.join(moved, 'plugins', 'graph-viewer');
  const config = JSON.parse(await readFile(path.join(plugin, '.mcp.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(plugin, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'graph-viewer');
  assert.equal(manifest.interface.displayName, 'Graph Viewer');
  assert.deepEqual(Object.keys(config.mcpServers), ['graph-viewer']);
  assert.deepEqual(await readdir(path.join(plugin, 'skills')), ['graph-viewer']);
  assert.match(await readFile(path.join(plugin, 'skills', 'graph-viewer', 'SKILL.md'), 'utf8'), /^---\r?\nname: graph-viewer\r?\n/);
  assert.doesNotMatch(JSON.stringify(config), /C:[\\/]graph-viewer/i);
  const client = await f.start(path.join(plugin, 'server.mjs'), plugin, {
    modern: true,
    nodeArgs: ['--permission', `--allow-fs-read=${moved}`, `--allow-fs-read=${f.dataDir}`, `--allow-fs-write=${f.dataDir}`],
  });
  const graph = researchGraph('이동 후 등록');
  await publish(client, graph);
  const panel = await openGraph(client, graph.graphId);
  assert.deepEqual(panel.snapshot.graph, graph);
  const { contents } = await client.request('resources/read', { uri: 'ui://graph-viewer/graph-v2.html' });
  assert.match(contents[0].text, /<html[\s>]/i);
  assert.doesNotMatch(contents[0].text, /C:[\\/]graph-viewer/i);
  success(await client.call('graph_publish', {mermaid: 'flowchart LR\n A[이동 후] --> B[Mermaid]', graphId: 'portable-mermaid', expectedRevision: 0}));
  const converted = success(await client.call('graph_read', {graphId: 'portable-mermaid'})).snapshot.graph;
  assert.deepEqual(converted.nodes.map(node => node.label), ['이동 후', 'Mermaid']);
});
