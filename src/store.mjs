import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, realpath, rename, rm} from 'node:fs/promises';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import GraphModel from './model.js';

export function failure(code, message, status = 400) {
  return Object.assign(new Error(message), {code, status});
}

export function chatRef(value) {
  if (!value || !['hostId', 'threadId'].every(key => typeof value[key] === 'string' && value[key].trim() && value[key].length <= 300)) {
    throw failure('invalid-chat', 'hostId와 threadId를 명시하세요.');
  }
  return {hostId: value.hostId, threadId: value.threadId};
}

export const sameChat = (a, b) => a?.hostId === b?.hostId && a?.threadId === b?.threadId;
const initialState = () => ({selectedNodeId: null, views: {
  summary: {camera: null, query: '', layout: 'layered', direction: 'vertical'},
  large: {camera: null, query: '', layout: 'layered', direction: 'horizontal'},
}});

function validCamera(value) {
  return value && ['x', 'y', 'zoom'].every(key => Number.isFinite(value[key])) && value.zoom > 0 && value.zoom <= 20;
}

function validateRecord(record, ref) {
  if (record.schemaVersion !== 1 || !sameChat(record.chatRef, ref) || !Array.isArray(record.graphs)) throw new Error('저장 형식 또는 채팅 키가 다릅니다.');
  const ids = new Set();
  for (const item of record.graphs) {
    GraphModel.validateGraph(item.graph);
    if (ids.has(item.graph.graphId) || !Number.isSafeInteger(item.revision) || item.revision < 1 || !Number.isSafeInteger(item.stateRevision) || item.stateRevision < 0) throw new Error('저장 버전 또는 그래프 ID가 잘못됐습니다.');
    ids.add(item.graph.graphId);
    const state = item.state;
    if (!state || state.selectedNodeId !== null && !item.graph.nodes.some(n => n.id === state.selectedNodeId)) throw new Error('저장된 선택 노드가 잘못됐습니다.');
    for (const view of ['summary', 'large']) {
      const part = state.views?.[view];
      if (!part || typeof part.query !== 'string' || part.query.length > 2000 || part.camera !== null && !validCamera(part.camera)) throw new Error('보기 상태가 잘못됐습니다.');
      part.layout ??= 'layered'; part.direction ??= view === 'summary' ? 'vertical' : 'horizontal';
      if (!GraphModel.layoutModes.includes(part.layout) || !GraphModel.layoutDirections.includes(part.direction)) throw new Error('배치 설정이 잘못됐습니다.');
    }
  }
  if (record.activeGraphId !== null && !ids.has(record.activeGraphId)) throw new Error('활성 그래프가 없습니다.');
  if (record.nativeView && (typeof record.nativeView.sessionId !== 'string' || !record.nativeView.sessionId)) throw new Error('그래프 탭 세션이 잘못됐습니다.');
  if (record.nativeViews === undefined) {
    record.nativeViews = [];
    if (record.nativeView && record.activeGraphId !== null) {
      const view = {graphId: record.activeGraphId, sessionId: record.nativeView.sessionId};
      if (record.nativeView.lastReport?.graphId === view.graphId) view.lastReport = record.nativeView.lastReport;
      record.nativeViews.push(view);
    }
  }
  delete record.nativeView;
  if (!Array.isArray(record.nativeViews)) throw new Error('그래프 탭 연결 목록이 잘못됐습니다.');
  const boundGraphs = new Set(), sessions = new Set();
  for (const view of record.nativeViews) {
    if (!view || !ids.has(view.graphId) || boundGraphs.has(view.graphId) || typeof view.sessionId !== 'string' || !view.sessionId || sessions.has(view.sessionId)) throw new Error('그래프 탭 연결이 잘못됐습니다.');
    boundGraphs.add(view.graphId); sessions.add(view.sessionId);
  }
  return record;
}

async function replaceFile(file, text) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await rename(temporary, file);
  } finally {
    await handle?.close();
    await rm(temporary, {force: true});
  }
}

export class GraphStore {
  #queues = new Map();
  #lockRoot;
  constructor(directory) {this.directory = directory;}
  async init() {
    await mkdir(path.join(this.directory, 'chats'), {recursive: true});
    this.#lockRoot = await realpath(this.directory);
    if (process.platform === 'win32') this.#lockRoot = this.#lockRoot.toLowerCase();
  }
  async drain() {while (this.#queues.size) await Promise.allSettled([...this.#queues.values()]);}
  key(ref) {return createHash('sha256').update(JSON.stringify([ref.hostId, ref.threadId])).digest('hex');}
  async #load(ref) {
    const file = path.join(this.directory, 'chats', `${this.key(ref)}.json`);
    const errors = [];
    for (const candidate of [file, `${file}.bak`]) {
      try {
        const text = await readFile(candidate, 'utf8');
        const record = validateRecord(JSON.parse(text), ref);
        if (candidate !== file) record.nativeViews = [];
        return {file, record, original: candidate === file ? text : null};
      } catch (error) {errors.push(error);}
    }
    if (errors.every(e => e.code === 'ENOENT')) return {file, record: {schemaVersion: 1, chatRef: ref, activeGraphId: null, graphs: [], nativeViews: []}, original: null};
    throw failure('corrupt-store', '채팅 저장 파일과 백업을 읽지 못했습니다. 기존 파일을 보존합니다.', 500);
  }
  async #lock(key) {
    if (process.platform !== 'win32') return async () => {};
    const hash = createHash('sha256').update(JSON.stringify([this.#lockRoot, key])).digest('hex');
    const name = String.raw`\\.\pipe\codex-graph-transaction-${hash}`;
    const deadline = Date.now() + 5000;
    for (;;) {
      const lock = net.createServer(socket => socket.destroy());
      try {
        await new Promise((resolve, reject) => {lock.once('error', reject); lock.listen(name, resolve);});
        return () => new Promise(resolve => lock.close(resolve));
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
        if (Date.now() >= deadline) throw failure('store-busy', '다른 저장 작업을 기다리는 시간이 초과됐습니다.', 409);
        await delay(15);
      }
    }
  }
  #transaction(ref, change) {
    const key = this.key(ref), prior = this.#queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(async () => {
      const release = await this.#lock(key);
      try {
      const loaded = await this.#load(ref);
      const result = await change(loaded.record);
      if (result.write) {
        if (loaded.original !== null) await replaceFile(`${loaded.file}.bak`, loaded.original);
        await replaceFile(loaded.file, JSON.stringify(loaded.record));
      }
      return result.value;
      } finally {await release();}
    });
    this.#queues.set(key, next);
    next.finally(() => {if (this.#queues.get(key) === next) this.#queues.delete(key);}).catch(() => {});
    return next;
  }
  status(ref, graphId) {
    return this.#transaction(ref, record => ({value: {
      chatRef: ref, activeGraphId: record.activeGraphId,
      graphs: record.graphs.map(item => ({graphId: item.graph.graphId, title: item.graph.title, revision: item.revision})),
      snapshot: record.graphs.find(item => item.graph.graphId === (graphId || record.activeGraphId)) || null,
      lastReport: record.nativeViews.find(view => view.graphId === (graphId || record.activeGraphId))?.lastReport || null,
    }}));
  }
  publish(ref, graph, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw failure('invalid-revision', 'expectedRevision은 0 이상의 정수여야 합니다.');
    return this.#transaction(ref, record => {
      const current = record.graphs.find(item => item.graph.graphId === graph.graphId);
      if ((current?.revision || 0) !== expectedRevision) throw failure('revision-conflict', `최신 버전은 ${current?.revision || 0}입니다.`, 409);
      const item = {graph, revision: expectedRevision + 1, state: current?.state || initialState(), stateRevision: current?.stateRevision || 0};
      if (item.state.selectedNodeId !== null && !graph.nodes.some(n => n.id === item.state.selectedNodeId)) {
        item.state.selectedNodeId = null; item.stateRevision++;
      }
      if (current) record.graphs[record.graphs.indexOf(current)] = item;
      else record.graphs.push(item);
      record.activeGraphId = graph.graphId;
      return {write: true, value: {committed: true, graphId: graph.graphId, revision: item.revision}};
    });
  }
  activate(ref, graphId) {
    return this.#transaction(ref, record => {
      const item = record.graphs.find(item => item.graph.graphId === graphId);
      if (!item) throw failure('graph-not-found', '먼저 그래프를 등록하세요.', 404);
      const write = record.activeGraphId !== graphId;
      record.activeGraphId = graphId;
      return {write, value: item};
    });
  }
  openNative(ref, graphId) {
    return this.#transaction(ref, record => {
      const item = record.graphs.find(item => item.graph.graphId === (graphId || record.activeGraphId));
      if (!item) throw failure('graph-not-found', '먼저 그래프를 등록하세요.', 404);
      let view = record.nativeViews.find(view => view.graphId === item.graph.graphId);
      const write = !view || record.activeGraphId !== item.graph.graphId;
      if (!view) {
        view = {graphId: item.graph.graphId, sessionId: randomUUID()};
        record.nativeViews.push(view);
      }
      record.activeGraphId = item.graph.graphId;
      return {write, value: {sessionId: view.sessionId, snapshot: item}};
    });
  }
  #nativeBinding(record, sessionId) {
    const view = record.nativeViews.find(view => view.sessionId === sessionId);
    if (!view) throw failure('stale-session', '이 그래프 탭의 연결이 만료됐습니다. 그래프를 다시 여세요.', 409);
    const item = record.graphs.find(item => item.graph.graphId === view.graphId);
    if (!item) throw failure('graph-not-found', '연결된 그래프가 없습니다.', 404);
    return {view, item};
  }
  syncNative(ref, request) {
    return this.#transaction(ref, record => {
      const {item} = this.#nativeBinding(record, request.sessionId);
      const unchanged = item.graph.graphId === request.knownGraphId && item.revision === request.knownRevision && item.stateRevision === request.knownStateRevision;
      return {value: {unchanged, ...(unchanged ? {} : {snapshot: item})}};
    });
  }
  ackNative(ref, request) {
    return this.#transaction(ref, record => {
      const {view, item} = this.#nativeBinding(record, request.sessionId);
      if (request.graphId !== item.graph.graphId || request.revision !== item.revision || !Number.isSafeInteger(request.stateRevision) || request.stateRevision < 0 || request.stateRevision > item.stateRevision || request.displayMode !== 'fullscreen') throw failure('invalid-report', '현재 그래프와 fullscreen 표시 결과를 확인하세요.');
      view.lastReport = {graphId: request.graphId, revision: request.revision, stateRevision: request.stateRevision, displayMode: request.displayMode, at: new Date().toISOString()};
      return {write: true, value: {committed: true}};
    });
  }
  action(ref, request, checkSession) {
    return this.#transaction(ref, record => {
      checkSession();
      if (Object.hasOwn(request, 'nativeSessionId')) {
        const {item} = this.#nativeBinding(record, request.nativeSessionId);
        if (item.graph.graphId !== request.graphId) throw failure('revision-conflict', '이 뷰어에 연결된 그래프와 다릅니다.', 409);
      }
      const item = record.graphs.find(item => item.graph.graphId === request.graphId);
      if (!item) throw failure('graph-not-found', '그래프가 없습니다.', 404);
      if (item.revision !== request.revision) throw failure('revision-conflict', '새 그래프 버전을 조회하세요.', 409);
      if (request.expectedStateRevision !== undefined && request.expectedStateRevision !== item.stateRevision) throw failure('state-conflict', '최신 보기 상태를 다시 조회하세요.', 409);
      const {action, view} = request;
      if (!['summary', 'large'].includes(view) || !action) throw failure('invalid-action', '보기와 상태 명령을 확인하세요.');
      if (action.type === 'selectNode') {
        if (action.nodeId !== null && !item.graph.nodes.some(n => n.id === action.nodeId)) throw failure('invalid-node', '선택할 노드가 없습니다.');
        item.state.selectedNodeId = action.nodeId;
      } else if (action.type === 'setCamera') {
        if (!validCamera(action.camera)) throw failure('invalid-camera', '카메라 중심과 양수 배율이 필요합니다.');
        const {x, y, zoom} = action.camera;
        item.state.views[view].camera = {x, y, zoom};
      } else if (action.type === 'setQuery') {
        if (typeof action.query !== 'string' || action.query.length > 2000) throw failure('invalid-query', '검색어는 최대 2000자입니다.');
        item.state.views[view].query = action.query;
      } else if (action.type === 'setLayout') {
        if (!GraphModel.layoutModes.includes(action.layout) || !GraphModel.layoutDirections.includes(action.direction)) throw failure('invalid-layout', '배치 방식과 방향을 확인하세요.');
        if (action.camera !== undefined && !validCamera(action.camera)) throw failure('invalid-camera', '카메라 중심과 양수 배율이 필요합니다.');
        const part = item.state.views[view];
        part.layout = action.layout; part.direction = action.direction;
        part.camera = action.camera ? {x: action.camera.x, y: action.camera.y, zoom: action.camera.zoom} : null;
      } else throw failure('invalid-action', '지원하지 않는 상태 명령입니다.');
      item.stateRevision++;
      return {write: true, value: {committed: true, snapshot: item}};
    });
  }
}
