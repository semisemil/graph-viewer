import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ENTRY = path.join(ROOT, 'src', 'mcp.mjs');
export const CHAT_A = { hostId: 'local', threadId: '11111111-1111-4111-8111-111111111111' };
export const CHAT_B = { hostId: 'local', threadId: '22222222-2222-4222-8222-222222222222' };

export function researchGraph(title = '별도 연구') {
  return {
    schemaVersion: 1, graphId: 'mcp-independent-research', title, kind: '연구 기록',
    nodes: [
      { id: 'question', type: '질문', label: '관찰 대상', details: '<script>plain text</script>\n원문 전체와 유니코드를 보존한다.', status: '기록', sources: [{ label: '자료', href: 'https://example.org/research' }] },
      { id: 'evidence', type: '증거', label: '실험 관찰', details: '측정 결과', status: '확인', sources: [] },
    ],
    edges: [{ id: 'observed', source: 'question', target: 'evidence', type: '관찰 관계', label: '관찰' }],
  };
}

export async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'graph-mcp-contract-'));
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir);
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.stop()));
    await rm(root, { recursive: true, force: true });
  });
  return {
    root, dataDir,
    async start(entry = ENTRY, cwd = ROOT, { modern = false, protocolVersion = '2025-06-18', nodeArgs = [], launcher = false, env = {} } = {}) {
      const client = stdioClient(entry, [], { cwd, nodeArgs, launcher, env: { ...process.env, GRAPH_PANEL_DATA_DIR: dataDir, ...env } });
      clients.push(client);
      if (modern) {
        const request = client.request;
        client.request = (method, params = {}) => request(method, {
          ...params, _meta: {
            ...params._meta,
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'independent-contract', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        });
        client.discovery = await client.request('server/discover', {
          clientInfo: { name: 'independent-contract', version: '1.0.0' }, clientCapabilities: {},
        });
      } else {
        const initialized = await client.request('initialize', {
          protocolVersion, capabilities: {}, clientInfo: { name: 'independent-contract', version: '1.0.0' },
        });
        client.notify('notifications/initialized');
        assert.equal(typeof initialized.protocolVersion, 'string');
        client.initialized = initialized;
      }
      client.call = (name, args = {}, scope = CHAT_A) => client.request('tools/call', {
        name, arguments: args, ...(scope ? { _meta: { threadId: scope.threadId } } : {}),
      });
      return client;
    },
  };
}

export function success(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return result.structuredContent;
}

export function rejected(result, code) {
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.equal(result.structuredContent.error.code, code);
}

export async function publish(client, graph, expectedRevision = 0, scope = CHAT_A) {
  const result = success(await client.call('graph_publish', { graph, expectedRevision }, scope));
  assert.equal(result.committed, true);
  assert.equal(result.graphId, graph.graphId);
  assert.equal(result.revision, expectedRevision + 1);
  return result;
}

export async function openGraph(client, graphId, scope = CHAT_A) {
  const result = await client.call('open_graph', { graphId }, scope);
  success(result);
  const panel = result._meta.graphPanel;
  assert.deepEqual(panel.scope, scope);
  assert.equal(typeof panel.sessionId, 'string');
  assert.ok(panel.sessionId.length > 0);
  assert.ok(panel.snapshot);
  return panel;
}

export async function sync(client, panel, known = {}) {
  return client.call('graph_view', { op: 'sync', scope: panel.scope, sessionId: panel.sessionId, ...known }, panel.scope);
}

export async function action(client, panel, command, snapshot = panel.snapshot) {
  const result = await client.call('graph_view', {
    op: 'action', scope: panel.scope, sessionId: panel.sessionId,
    graphId: snapshot.graph.graphId, revision: snapshot.revision,
    expectedStateRevision: snapshot.stateRevision, action: command,
  }, panel.scope);
  success(result);
  const saved = result._meta.graphPanel.snapshot;
  assert.equal(saved.stateRevision, snapshot.stateRevision + 1);
  panel.snapshot = saved;
  return saved;
}

function stdioClient(entry, args, { cwd = ROOT, env = process.env, nodeArgs = [], launcher = false } = {}) {
  const command = launcher ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : process.execPath;
  const prefix = launcher ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] : nodeArgs;
  const child = spawn(command, [...prefix, entry, ...args], {
    cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let sequence = 0, buffer = '', stderr = '', stopping;
  function fail(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  child.stderr.setEncoding('utf8');
  child.stdin.on('error', fail);
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { fail(new Error(`Non-JSON MCP stdout: ${line}`)); continue; }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(Object.assign(new Error(message.error.message), { rpcError: message.error }));
      else request.resolve(message.result);
    }
  });
  const done = new Promise(resolve => {
    child.once('error', error => { fail(error); resolve(); });
    child.once('exit', (code, signal) => {
      fail(new Error(`MCP exited (${code ?? signal}). ${stderr}`));
      resolve({code, signal});
    });
  });
  return {
    get stderr() { return stderr; },
    request(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP ${method} timed out. ${stderr}`));
        }, 10000);
        pending.set(id, {
          resolve(value) { clearTimeout(timeout); resolve(value); },
          reject(error) { clearTimeout(timeout); reject(error); },
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    async stop() {
      stopping ??= (async () => {
        child.stdin.end();
        let forced = false;
        const timeout = setTimeout(() => {forced = true; child.kill();}, 1000);
        const result = await done;
        clearTimeout(timeout);
        return {...result, forced};
      })();
      return stopping;
    },
  };
}
