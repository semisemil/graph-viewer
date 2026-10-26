import http from 'node:http';
import net from 'node:net';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import GraphModel from './model.js';
import {GraphStore, chatRef, sameChat, failure} from './store.mjs';

const files = new Map([
  ['/view', ['../web/index.html', 'text/html; charset=utf-8']],
  ['/model.js', ['./model.js', 'text/javascript; charset=utf-8']],
  ['/renderer.js', ['./renderer.js', 'text/javascript; charset=utf-8']],
  ['/client.js', ['../web/client.js', 'text/javascript; charset=utf-8']],
  ['/page.css', ['../web/page.css', 'text/css; charset=utf-8']],
]);

export async function startServer({dataDir, port = 9232}) {
  const store = new GraphStore(dataDir);
  await store.init();
  const canonical = await realpath(dataDir);
  const hash = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  const lock = net.createServer(socket => socket.end());
  const lockName = process.platform === 'win32' ? String.raw`\\.\pipe\codex-graph-${hash}` : path.join(tmpdir(), `codex-graph-${hash}.sock`);
  try {
    await new Promise((resolve, reject) => {lock.once('error', reject); lock.listen(lockName, resolve);});
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw failure('store-in-use', '같은 저장 폴더를 사용하는 전달 서비스가 실행 중입니다.', 409);
    throw error;
  }
  const origin = `http://127.0.0.1:${port}`, token = randomBytes(32).toString('hex');
  const sessions = new Map(), clients = new Map(), reports = new Map();
  let closing = false;

  function invalidate(clientId) {
    const previous = clients.get(clientId);
    if (previous) {sessions.delete(previous); reports.delete(previous); clients.delete(clientId);}
  }
  async function beginSession(request) {
    const ref = chatRef(request.chatRef);
    if (!['summary', 'large'].includes(request.view) || typeof request.clientId !== 'string' || !request.clientId || request.clientId.length > 300) throw failure('invalid-session', '뷰와 clientId가 필요합니다.');
    const status = await store.status(ref, request.graphId);
    if (!status.snapshot) throw failure('graph-not-found', '그래프가 없습니다.', 404);
    invalidate(request.clientId);
    const sessionId = randomUUID();
    sessions.set(sessionId, {...request, chatRef: ref});
    clients.set(request.clientId, sessionId);
    return {sessionId};
  }
  function checkSession(request) {
    const current = sessions.get(request.sessionId);
    if (!current || !sameChat(current.chatRef, request.chatRef) || current.graphId !== request.graphId || current.view !== request.view) {
      throw failure('stale-session', '뷰 연결이 바뀌었습니다. 새 세션을 여세요.', 409);
    }
  }
  function act(request) {
    const ref = chatRef(request.chatRef);
    return store.action(ref, request, () => checkSession(request));
  }
  async function acknowledge(request) {
    checkSession(request);
    const saved = await store.status(request.chatRef, request.graphId);
    checkSession(request);
    if (!saved.snapshot || request.revision !== saved.snapshot.revision) throw failure('revision-conflict', '표시 버전이 최신 그래프와 다릅니다.', 409);
    reports.set(request.sessionId, {...request, observedAt: new Date().toISOString()});
    return {acknowledged: true};
  }
  function applied(ref, snapshot) {
    if (!snapshot) return null;
    const current = [...reports.values()].filter(r => Date.now() - Date.parse(r.observedAt) < 3000 && sameChat(r.chatRef, ref) && r.graphId === snapshot.graph.graphId && r.revision === snapshot.revision);
    return current.length ? {chatRef: ref, graphId: snapshot.graph.graphId, revision: snapshot.revision, mountedViews: [...new Set(current.map(r => r.view))], observedAt: current.at(-1).observedAt, validForMs: 3000} : null;
  }
  async function status(ref, graphId) {
    const saved = await store.status(ref, graphId);
    return {...saved, applied: applied(ref, saved.snapshot)};
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (value, code = 200) => {response.writeHead(code, {'Content-Type': 'application/json; charset=utf-8'}); response.end(JSON.stringify(value));};
    try {
      if (request.headers.host !== `127.0.0.1:${port}` || request.headers.origin && request.headers.origin !== origin) throw failure('forbidden-origin', '이 서비스의 로컬 주소에서만 접근할 수 있습니다.', 403);
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && url.pathname === '/connection') return json({token});
      if (request.method === 'GET' && files.has(url.pathname)) {
        const [file, type] = files.get(url.pathname);
        const body = await readFile(new URL(file, import.meta.url));
        response.writeHead(200, {'Content-Type': type}); response.end(body); return;
      }
      if (request.headers.authorization !== `Bearer ${token}`) throw failure('unauthorized', '전달 서비스 인증을 갱신하세요.', 401);
      if (request.method === 'GET' && url.pathname === '/api/status') {
        const ref = chatRef(Object.fromEntries(url.searchParams));
        return json(await status(ref, url.searchParams.get('graphId')));
      }
      if (request.method !== 'POST') throw failure('not-found', '명령 경로가 없습니다.', 404);
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > GraphModel.limits.bytes) throw failure('too-large', '요청 본문은 최대 1 MiB입니다.', 413);
        chunks.push(chunk);
      }
      let body;
      try {body = JSON.parse(Buffer.concat(chunks).toString('utf8'));}
      catch {throw failure('invalid-json', '올바른 JSON 본문이 필요합니다.');}
      const ref = chatRef(body.chatRef);
      if (url.pathname === '/api/publish') {
        let graph;
        try {graph = GraphModel.validateGraph(body.graph);} catch (error) {throw failure('invalid-graph', error.message);}
        const result = await store.publish(ref, graph, body.expectedRevision);
        return json({...result, applied: applied(ref, {graph, revision: result.revision})});
      }
      if (url.pathname === '/api/session') return json(await beginSession({...body, chatRef: ref}));
      if (url.pathname === '/api/close-session') {
        checkSession({...body, chatRef: ref});
        invalidate(sessions.get(body.sessionId).clientId);
        return json({closed: true});
      }
      if (url.pathname === '/api/state') return json(await act({...body, chatRef: ref}));
      if (url.pathname === '/api/ack') return json(await acknowledge({...body, chatRef: ref}));
      if (url.pathname === '/api/show') {
        if (body.view !== 'large') throw failure('invalid-view', 'view는 large입니다.');
        const item = await store.activate(ref, body.graphId);
        const viewURL = new URL('/view', origin);
        for (const [key, value] of Object.entries({...ref, graphId: body.graphId})) viewURL.searchParams.set(key, value);
        return json({graphId: body.graphId, revision: item.revision, url: viewURL.href, applied: applied(ref, item)});
      }
      throw failure('not-found', '명령 경로가 없습니다.', 404);
    } catch (error) {
      if (!response.headersSent) json({error: {code: error.code || 'invalid-request', message: error.message}}, error.status || (error.code ? 500 : 400));
      else response.end();
    }
  });
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});
  } catch (error) {lock.close(); throw error;}
  return {
    port, dataDir: canonical,
    async close() {
      if (closing) return;
      closing = true;
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
      await store.drain();
      await new Promise(resolve => lock.close(resolve));
    },
  };
}
