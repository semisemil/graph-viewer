import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'bin', 'graph.mjs');
const execFileAsync = promisify(execFile);

const THREAD_A = '11111111-1111-4111-8111-111111111111';
const THREAD_B = '22222222-2222-4222-8222-222222222222';

function researchGraph(title = '연구 기록') {
  return {
    schemaVersion: 1, graphId: 'independent-research', title, kind: '독립 연구 기록',
    nodes: [
      { id: 'question', type: '질문', label: '관찰 대상', details: '<script>plain text</script>\n전체 본문: 유니코드와 긴 설명을 보존한다.', status: '기록', sources: [{ label: '원자료', href: 'https://example.org/research?q=관찰' }] },
      { id: 'evidence', type: '증거', label: '실험 관찰', details: '별도 도메인의 관찰 결과', status: '확인', sources: [] },
      { id: 'conclusion', type: '결론', label: '판단', details: '증거에서 도출한 결론', status: '잠정', sources: [] },
    ],
    edges: [
      { id: 'observed', source: 'question', target: 'evidence', type: '관찰 관계', label: '관찰' },
      { id: 'supports', source: 'evidence', target: 'conclusion', type: '근거 관계', label: '뒷받침' },
    ],
  };
}

test('CLI validates a new domain and rejects duplicate identities and missing references', async t => {
  const service = await fixture(t, { start: false });
  const valid = await service.validate(researchGraph());
  assert.equal(valid.code, 0, valid.stderr);
  const obsoleteOption = await service.cli('serve', '--cdp-port', '9222');
  assert.notEqual(obsoleteOption.code, 0);
  assert.equal(JSON.parse(obsoleteOption.stderr).error.code, 'invalid-option');
  assert.notEqual((await service.validate('{ malformed JSON')).code, 0);
  for (const mutate of [
    g => g.nodes.push({ ...g.nodes[0] }),
    g => g.edges.push({ ...g.edges[0] }),
    g => { g.edges[0].target = 'absent'; },
  ]) {
    const invalid = researchGraph();
    mutate(invalid);
    assert.notEqual((await service.validate(invalid)).code, 0);
  }
});

test('publish preserves the full arbitrary-domain document and rejects invalid replacements', async t => {
  const service = await fixture(t);
  const graph = researchGraph();
  await service.publish(THREAD_A, graph, 0);
  assert.deepEqual((await service.read(THREAD_A, graph.graphId)).graph, graph);
  const invalid = researchGraph('손상된 수정');
  invalid.edges[0].target = 'absent';
  await service.rejectPublish(THREAD_A, invalid, 1);
  assert.deepEqual((await service.read(THREAD_A, graph.graphId)).graph, graph);
});

test('stale expectedRevision cannot overwrite the accepted edit', async t => {
  const service = await fixture(t);
  await service.publish(THREAD_A, researchGraph(), 0);
  const accepted = researchGraph('수락된 수정');
  await service.publish(THREAD_A, accepted, 1);
  await service.rejectPublish(THREAD_A, researchGraph('늦게 도착한 수정'), 1, 'conflict');
  const saved = await service.read(THREAD_A, accepted.graphId);
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.graph, accepted);
  const sessionId = await service.session(THREAD_A, accepted.graphId, 'summary', 'revision-check');
  const rejected = await service.request('/api/state', {
    chatRef: chatRef(THREAD_A), graphId: accepted.graphId, revision: 1,
    view: 'summary', sessionId, action: { type: 'selectNode', nodeId: 'question' },
  });
  assert.equal(rejected.status, 409);
  assert.deepEqual(await service.read(THREAD_A, accepted.graphId), saved);
});

test('two thread identities isolate the same graph identity and selection', async t => {
  const service = await fixture(t);
  const graphA = researchGraph('같은 제목');
  const graphB = researchGraph('같은 제목');
  graphB.nodes[1].details = '두 번째 채팅의 별도 증거';
  await service.publish(THREAD_A, graphA, 0);
  await service.publish(THREAD_B, graphB, 0);
  await service.action(THREAD_A, graphA.graphId, 'summary', { type: 'selectNode', nodeId: 'evidence' });
  await service.action(THREAD_B, graphB.graphId, 'large', { type: 'selectNode', nodeId: 'conclusion' });
  const first = await service.read(THREAD_A, graphA.graphId);
  const second = await service.read(THREAD_B, graphB.graphId);
  assert.deepEqual(first.graph, graphA);
  assert.deepEqual(second.graph, graphB);
  assert.equal(first.state.selectedNodeId, 'evidence');
  assert.equal(second.state.selectedNodeId, 'conclusion');
});

test('a replaced connection cannot overwrite newer state and does not invalidate a large-view page', async t => {
  const service = await fixture(t);
  const graph = researchGraph();
  await service.publish(THREAD_A, graph, 0);
  const oldSession = await service.session(THREAD_A, graph.graphId, 'summary', 'summary-adapter');
  const largeSession = await service.session(THREAD_A, graph.graphId, 'large', 'large-page-A');
  await service.action(THREAD_A, graph.graphId, 'summary', { type: 'selectNode', nodeId: 'question' }, oldSession);
  const newSession = await service.session(THREAD_A, graph.graphId, 'summary', 'summary-adapter');
  assert.notEqual(newSession, oldSession);
  await service.action(THREAD_A, graph.graphId, 'summary', { type: 'selectNode', nodeId: 'evidence' }, newSession);
  const accepted = await service.read(THREAD_A, graph.graphId);
  assert.equal(accepted.state.selectedNodeId, 'evidence');

  const delayed = await service.request('/api/state', {
    chatRef: chatRef(THREAD_A), graphId: graph.graphId, revision: 1,
    view: 'summary', sessionId: oldSession,
    action: { type: 'selectNode', nodeId: 'question' },
  });
  assert.equal(delayed.status, 409);
  assert.equal((await delayed.json()).error.code, 'stale-session');
  assert.deepEqual(await service.read(THREAD_A, graph.graphId), accepted);

  const camera = { x: 90, y: -15, zoom: 1.4 };
  await service.action(THREAD_A, graph.graphId, 'large', { type: 'setCamera', camera }, largeSession);
  const afterLargeWrite = await service.read(THREAD_A, graph.graphId);
  assert.equal(afterLargeWrite.state.selectedNodeId, 'evidence');
  assert.deepEqual(afterLargeWrite.state.views.large.camera, camera);
  assert.equal(afterLargeWrite.stateRevision, accepted.stateRevision + 1);
});

test('shared selection, independent cameras and search survive edits without lost state', async t => {
  const service = await fixture(t);
  const graph = researchGraph();
  const summary = { zoom: 0.8, x: 31, y: -47 };
  const large = { zoom: 1.6, x: -210, y: 85 };
  await service.publish(THREAD_A, graph, 0);
  await service.action(THREAD_A, graph.graphId, 'summary', { type: 'selectNode', nodeId: 'evidence' });
  await service.action(THREAD_A, graph.graphId, 'summary', { type: 'setCamera', camera: summary });
  await service.action(THREAD_A, graph.graphId, 'large', { type: 'setCamera', camera: large });
  await service.action(THREAD_A, graph.graphId, 'summary', { type: 'setQuery', query: '증거' });
  await service.action(THREAD_A, graph.graphId, 'large', { type: 'setQuery', query: '별도 도메인' });
  const before = await service.read(THREAD_A, graph.graphId);
  assert.equal(before.state.selectedNodeId, 'evidence');
  assert.deepEqual(before.state.views.summary.camera, summary);
  assert.deepEqual(before.state.views.large.camera, large);
  assert.equal(before.state.views.summary.query, '증거');
  assert.equal(before.state.views.large.query, '별도 도메인');
  await service.publish(THREAD_A, researchGraph('본문 수정'), 1);
  const after = await service.read(THREAD_A, graph.graphId);
  assert.deepEqual(after.state, before.state);
});

test('service restart restores the last document, selection and both view cameras', async t => {
  const service = await fixture(t);
  const graph = researchGraph();
  await service.publish(THREAD_A, graph, 0);
  await service.action(THREAD_A, graph.graphId, 'summary', { type: 'selectNode', nodeId: 'conclusion' });
  await service.action(THREAD_A, graph.graphId, 'summary', { type: 'setCamera', camera: { zoom: 0.7, x: 10, y: -80 } });
  await service.action(THREAD_A, graph.graphId, 'large', { type: 'setCamera', camera: { zoom: 1.3, x: -90, y: 40 } });
  await service.action(THREAD_A, graph.graphId, 'large', { type: 'setQuery', query: '판단' });
  const before = await service.read(THREAD_A, graph.graphId);
  await service.restart();
  const after = await service.read(THREAD_A, graph.graphId);
  assert.deepEqual(after.graph, before.graph);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.state, before.state);
  assert.equal(after.stateRevision, before.stateRevision);
});

test('corrupt stored JSON recovers the last good backup without losing it on a later write', async t => {
  const service = await fixture(t);
  const original = researchGraph();
  await service.publish(THREAD_A, original, 0);
  await service.publish(THREAD_A, researchGraph('직전 최신본'), 1);
  await service.stop();
  const corrupt = '{ invalid persisted JSON';
  const storedFile = service.storedFile(THREAD_A);
  const backup = JSON.parse(await readFile(`${storedFile}.bak`, 'utf8'));
  await writeFile(storedFile, corrupt, 'utf8');
  await service.restart();
  const recovered = await service.read(THREAD_A, original.graphId);
  assert.deepEqual(recovered.graph, original);
  assert.equal(recovered.revision, 1);
  const graph = researchGraph('복구 후 등록');
  await service.publish(THREAD_A, graph, 1);
  assert.deepEqual((await service.read(THREAD_A, graph.graphId)).graph, graph);
  assert.deepEqual(JSON.parse(await readFile(`${storedFile}.bak`, 'utf8')), backup);
});

test('a second writer for the same data directory is rejected without disturbing the first', async t => {
  const service = await fixture(t);
  const graph = researchGraph();
  await service.publish(THREAD_A, graph, 0);
  const second = await service.startSecondWriter();
  assert.notEqual(second.code, 0);
  assert.deepEqual((await service.read(THREAD_A, graph.graphId)).graph, graph);
});

test('CLI reports an unregistered thread and returns a usable large-view URL', async t => {
  const service = await fixture(t);
  const empty = await service.cli('status', '--thread', THREAD_A, '--port', String(service.port));
  assert.equal(empty.code, 0, empty.stderr);
  assert.deepEqual(empty.json.graphs, []);
  assert.equal(empty.json.snapshot, null);
  const graph = researchGraph();
  await service.publish(THREAD_A, graph, 0);
  const shown = await service.cli('show', '--thread', THREAD_A, '--graph', graph.graphId,
    '--view', 'large', '--port', String(service.port));
  assert.equal(shown.code, 0, shown.stderr);
  const url = new URL(shown.json.url);
  assert.equal(url.origin, service.origin);
  assert.equal(url.pathname, '/view');
  const page = await fetch(url, { signal: AbortSignal.timeout(3000) });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /<html[\s>]/i);
  const obsoleteView = await service.cli('show', '--thread', THREAD_A, '--graph', graph.graphId,
    '--view', 'summary', '--port', String(service.port));
  assert.notEqual(obsoleteView.code, 0);
  assert.equal(JSON.parse(obsoleteView.stderr).error.code, 'invalid-view');
});

function chatRef(threadId) {
  return { hostId: 'local', threadId };
}

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function runCli(args) {
  try {
    const output = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: ROOT, timeout: 8000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    });
    return { code: 0, ...output, json: JSON.parse(output.stdout) };
  } catch (error) {
    if (error.killed) throw new Error(`CLI did not finish: ${args.join(' ')}\n${error.stderr || ''}`);
    if (typeof error.code !== 'number') throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function fixture(t, { start = true } = {}) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'graph-public-contract-'));
  const dataDir = path.join(temporaryRoot, 'data');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let running;
  let token;
  let nextInput = 0;
  const sessions = new Map();

  async function writeInput(graph) {
    const file = path.join(temporaryRoot, `input-${nextInput++}.json`);
    await writeFile(file, typeof graph === 'string' ? graph : JSON.stringify(graph), 'utf8');
    return file;
  }

  async function stop() {
    if (!running) return;
    const owned = running;
    running = undefined;
    if (owned.process.exitCode === null && owned.process.signalCode === null) owned.process.kill();
    await owned.done;
  }

  async function startServer() {
    sessions.clear();
    const child = spawn(process.execPath, [CLI, 'serve', '--data-dir', dataDir, '--port', String(port)], {
      cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const owned = { process: child, output: '', exited: false };
    child.stdout.on('data', chunk => { owned.output += chunk; });
    child.stderr.on('data', chunk => { owned.output += chunk; });
    owned.done = new Promise(resolve => {
      child.once('error', error => { owned.exited = true; owned.output += error.message; resolve(); });
      child.once('exit', () => { owned.exited = true; resolve(); });
    });
    running = owned;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (owned.exited) throw new Error(`Service exited before accepting requests:\n${owned.output}`);
      try {
        const response = await fetch(`${origin}/connection`, { signal: AbortSignal.timeout(300) });
        if (response.ok) {
          token = (await response.json()).token;
          assert.equal(typeof token, 'string');
          assert.ok(token.length > 0);
          return;
        }
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error(`Service did not become ready:\n${owned.output}`);
  }

  async function request(route, body) {
    return fetch(`${origin}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(3000),
    });
  }

  async function session(threadId, graphId, view, clientId) {
    const response = await request('/api/session', { chatRef: chatRef(threadId), graphId, view, clientId });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const { sessionId } = body;
    assert.equal(typeof sessionId, 'string');
    assert.ok(sessionId.length > 0);
    return sessionId;
  }

  const service = {
    port, origin, request, session, stop,
    cli: (...args) => runCli(args),
    async validate(graph) {
      return runCli(['validate', await writeInput(graph)]);
    },
    async publish(threadId, graph, expectedRevision) {
      const result = await runCli(['publish', await writeInput(graph), '--thread', threadId,
        '--expected-revision', String(expectedRevision), '--port', String(port)]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.json.committed, true);
      assert.equal(result.json.graphId, graph.graphId);
      assert.equal(result.json.revision, expectedRevision + 1);
      return result.json;
    },
    async rejectPublish(threadId, graph, expectedRevision, reason) {
      const result = await request('/api/publish', { chatRef: chatRef(threadId), graph, expectedRevision });
      assert.equal(result.status, reason === 'conflict' ? 409 : 400, await result.text());
    },
    async read(threadId, graphId) {
      const result = await runCli(['status', '--thread', threadId, '--graph', graphId, '--port', String(port)]);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(result.json.chatRef, chatRef(threadId));
      assert.ok(result.json.snapshot, 'A successful publish must be observable through status.');
      return result.json.snapshot;
    },
    async action(threadId, graphId, view, action, sessionId) {
      if (sessionId === undefined) {
        const clientId = JSON.stringify([threadId, graphId, view]);
        if (!sessions.has(clientId)) sessions.set(clientId, await session(threadId, graphId, view, clientId));
        sessionId = sessions.get(clientId);
      }
      const result = await request('/api/state', { chatRef: chatRef(threadId), graphId, revision: 1, view, sessionId, action });
      assert.equal(result.status, 200, await result.text());
    },
    async restart() {
      await stop();
      await startServer();
    },
    storedFile(threadId) {
      const key = createHash('sha256').update(JSON.stringify(['local', threadId])).digest('hex');
      return path.join(dataDir, 'chats', `${key}.json`);
    },
    async startSecondWriter() {
      const otherPort = await freePort();
      return runCli(['serve', '--data-dir', dataDir, '--port', String(otherPort)]);
    },
  };

  t.after(async () => {
    await stop();
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  if (start) await startServer();
  return service;
}
