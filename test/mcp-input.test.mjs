import assert from 'node:assert/strict';
import {cp, mkdir, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {test} from 'node:test';
import {ROOT, CHAT_A, fixture, success, rejected, action, sync} from './mcp-fixture.mjs';

test('Mermaid files and inline text preserve labels and relationships and reject invalid updates', async t => {
  const f = await fixture(t), client = await f.start();
  const file = path.join(f.root, '응답 조사.mmd');
  const source = 'flowchart LR\n subgraph Backend[백엔드]\n A["관찰<br/>결과"] -->|확인 근거| B{판단}\n end\n Backend --> C[완료]\n B <--> C\n C wait@--- D@{shape: circle, label: "대기"}\n wait@{animate: true}\n A --> B\n classDef observed fill:#fff\n class A observed';
  await writeFile(file, source);
  success(await client.call('graph_publish', {graphPath: file, graphId: 'mermaid', title: '응답 조사', expectedRevision: 0}));
  const snapshot = success(await client.call('graph_read', {graphId: 'mermaid'})).snapshot;
  assert.equal(snapshot.graph.title, '응답 조사');
  assert.deepEqual(snapshot.graph.nodes.map(({id, label}) => [id, label]), [['A', '관찰\n결과'], ['B', '판단'], ['Backend', '백엔드'], ['C', '완료'], ['D', '대기']]);
  assert.deepEqual(snapshot.graph.edges.map(({source, target, label, direction}) => [source, target, label, direction]), [
    ['A', 'B', '확인 근거', 'forward'], ['Backend', 'C', '', 'forward'], ['B', 'C', '', 'both'], ['C', 'D', '', 'none'], ['A', 'B', '', 'forward'],
  ]);
  assert.equal(new Set(snapshot.graph.edges.map(edge => edge.id)).size, 5);
  assert.equal(snapshot.graph.edges[3].id, 'wait');
  for (const mermaid of ['flowchart LR\n A[', 'sequenceDiagram\n A->>B: call', 'flowchart LR\n A --> B\n click A "https://example.org"']) {
    assert.equal((await client.call('graph_publish', {mermaid, graphId: 'mermaid', expectedRevision: 1})).isError, true);
    assert.deepEqual(success(await client.call('graph_read', {graphId: 'mermaid'})).snapshot, snapshot);
  }
  success(await client.call('graph_publish', {mermaid: '```mermaid\nflowchart LR\n A[관찰] & B[증거] --> C[결론]\n```', graphId: 'mermaid', expectedRevision: 1}));
  const updated = success(await client.call('graph_read', {graphId: 'mermaid'})).snapshot;
  assert.equal(updated.revision, 2);
  assert.deepEqual(updated.graph.edges.map(edge => [edge.source, edge.target]), [['A', 'C'], ['B', 'C']]);
});

test('project-local storage separates the same chat and graph and restores its UI state after reconnect', async t => {
  const f = await fixture(t);
  const projects = [path.join(f.root, '첫 프로젝트'), path.join(f.root, '다른 프로젝트')];
  await Promise.all(projects.map(folder => mkdir(folder)));
  const client = await f.start(undefined, undefined, {env: {GRAPH_PANEL_DATA_DIR: ''}});
  rejected(await client.call('graph_status'), 'missing-project');
  for (const [index, projectPath] of projects.entries()) success(await client.call('graph_publish', {
    projectPath, graphId: 'same-id', mermaid: `graph LR\n A[프로젝트 ${index + 1}] --> B[결론]`, expectedRevision: 0,
  }));
  const panel = (await client.call('open_graph', {projectPath: projects[0], graphId: 'same-id'}))._meta.graphPanel;
  assert.deepEqual(panel.scope, {...CHAT_A, projectPath: await realpath(projects[0])});
  await action(client, panel, {type: 'selectNode', nodeId: 'A'});
  await action(client, panel, {type: 'setQuery', query: '프로젝트 1'});
  rejected(await client.call('graph_view', {op: 'sync', scope: {...panel.scope, projectPath: projects[1]}, sessionId: panel.sessionId}), 'stale-session');
  const other = success(await client.call('graph_read', {projectPath: projects[1], graphId: 'same-id'})).snapshot;
  assert.equal(other.graph.nodes[0].label, '프로젝트 2');
  assert.equal(other.state.selectedNodeId, null);
  await client.stop();
  const restarted = await f.start(undefined, undefined, {env: {GRAPH_PANEL_DATA_DIR: ''}});
  const restored = await sync(restarted, panel);
  success(restored);
  assert.deepEqual(restored._meta.graphPanel.snapshot, panel.snapshot);
  for (const projectPath of projects) {
    const status = success(await restarted.call('graph_status', {projectPath}));
    assert.equal(status.dataDir, path.join(await realpath(projectPath), '.graph-viewer'));
    assert.equal(await readFile(path.join(status.dataDir, '.gitignore'), 'utf8'), '*\n');
    assert.equal((await readdir(path.join(status.dataDir, 'chats'))).filter(file => file.endsWith('.json')).length, 1);
  }
  assert.deepEqual(await readdir(f.dataDir), []);
});

test('the distributed plugin starts with Codex bundled Node when Node is absent from PATH', {timeout: 30000}, async t => {
  const f = await fixture(t), plugin = path.join(f.root, '배포 플러그인 with spaces');
  await cp(path.join(ROOT, 'plugins', 'graph-viewer'), plugin, {recursive: true});
  const config = JSON.parse(await readFile(path.join(plugin, '.mcp.json'), 'utf8'));
  assert.equal(config.mcpServers['graph-viewer'].command, 'powershell.exe');
  assert.equal(config.mcpServers['graph-viewer'].env.GRAPH_PANEL_DATA_DIR, undefined);
  const projectPath = path.join(f.root, '사용자 프로젝트');
  await mkdir(projectPath);
  const client = await f.start(path.join(plugin, 'start.ps1'), plugin, {
    modern: true, launcher: true, env: {PATH: path.join(process.env.SystemRoot, 'System32'), GRAPH_PANEL_DATA_DIR: ''},
  });
  const saved = success(await client.call('graph_publish', {projectPath, graphId: 'launch', mermaid: 'graph LR\n A[런타임] --> B[동작]', expectedRevision: 0}));
  assert.equal(saved.revision, 1);
  const opened = await client.call('open_graph', {projectPath, graphId: 'launch'});
  success(opened);
  assert.deepEqual(opened._meta.graphPanel.snapshot.graph.nodes.map(node => node.label), ['런타임', '동작']);
});
