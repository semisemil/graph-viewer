import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {sameChat} from './store.mjs';

class CdpSocket {
  #id = 0;
  #pending = new Map();
  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), waiting = this.#pending.get(message.id);
      if (!waiting) return;
      this.#pending.delete(message.id); clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const waiting of this.#pending.values()) {clearTimeout(waiting.timer); waiting.reject(new Error('CDP 연결 종료'));}
      this.#pending.clear();
    });
  }
  async evaluate(expression) {
    const id = ++this.#id;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {this.#pending.delete(id); reject(new Error('CDP 응답 시간 초과'));}, 5000);
      this.#pending.set(id, {resolve, reject, timer});
      try {this.socket.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, returnByValue: true, awaitPromise: true}}));}
      catch (error) {clearTimeout(timer); this.#pending.delete(id); reject(error);}
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  close() {this.socket.close();}
  get open() {return this.socket.readyState === WebSocket.OPEN;}
}

export class CodexConnection {
  constructor({port, store, beginSession, invalidate, act, acknowledge}) {
    Object.assign(this, {port, store, beginSession, invalidate, act, acknowledge});
    this.clientId = `codex-summary-${randomUUID()}`;
    this.info = {state: 'connecting'};
  }
  status() {return this.info;}
  async showSummary(ref) {
    await this.refresh();
    if (this.socket?.open) await this.socket.evaluate(`globalThis.CodexGraphAdapter?.showSummary(${JSON.stringify(ref)})`);
    await this.refresh();
  }
  start() {
    this.running = true;
    const next = async () => {
      await this.refresh();
      if (this.running) this.timer = setTimeout(next, 650);
    };
    void next();
  }
  refresh() {
    if (!this.running) return Promise.resolve();
    if (this.work) return this.work;
    this.work = this.#tick().catch(error => {
      this.invalidate(this.clientId); this.sessionKey = this.sessionId = null;
      this.socket?.close(); this.socket = null;
      this.info = {state: 'disconnected', message: error.message, observedAt: new Date().toISOString()};
    }).finally(() => {this.work = null;});
    return this.work;
  }
  async #connect() {
    const response = await fetch(`http://127.0.0.1:${this.port}/json/list`, {signal: AbortSignal.timeout(2000)});
    if (!response.ok) throw new Error(`CDP 목록 HTTP ${response.status}`);
    const targets = (await response.json()).filter(target => target.type === 'page' && target.url === 'app://-/index.html');
    if (targets.length !== 1) throw new Error(`Codex 메인 페이지 ${targets.length}개. 정확히 하나가 필요합니다.`);
    const url = new URL(targets[0].webSocketDebuggerUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'ws:') throw new Error('CDP 주소가 로컬 WebSocket이 아닙니다.');
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {ws.close(); reject(new Error('CDP 연결 시간 초과'));}, 3000);
      ws.addEventListener('open', () => {clearTimeout(timer); resolve();}, {once: true});
      ws.addEventListener('error', () => {clearTimeout(timer); reject(new Error('CDP 연결 실패'));}, {once: true});
    });
    this.socket = new CdpSocket(ws);
    this.invalidate(this.clientId); this.sessionKey = this.sessionId = null;
    await this.#install();
  }
  async #install() {
    this.sources ||= await Promise.all(['model.js', 'renderer.js', 'codex-adapter.js'].map(name => readFile(new URL(name, import.meta.url), 'utf8')));
    await this.socket.evaluate(`globalThis.codexGraphDemo?.remove();\n${this.sources.join('\n')}\ntrue`);
  }
  async #tick() {
    if (!this.socket?.open) await this.#connect();
    let reading = await this.socket.evaluate('globalThis.CodexGraphAdapter?.read()');
    if (!reading) {await this.#install(); reading = await this.socket.evaluate('globalThis.CodexGraphAdapter.read()');}
    const {context, actions} = reading;
    if (!context.chatRef) {
      this.invalidate(this.clientId); this.sessionKey = this.sessionId = null;
      this.info = {state: 'waiting-chat', message: '현재 채팅 ID를 확인할 수 없습니다.', observedAt: new Date().toISOString()};
      return;
    }
    let saved = await this.store.status(context.chatRef);
    const graphId = saved.snapshot?.graph.graphId;
    const key = JSON.stringify([context.generation, context.chatRef, graphId]);
    if (key !== this.sessionKey) {
      this.invalidate(this.clientId); this.sessionId = null; this.sessionKey = key;
      if (graphId) this.sessionId = (await this.beginSession({chatRef: context.chatRef, graphId, view: 'summary', clientId: this.clientId})).sessionId;
    }
    let ackedActionId = 0, confirmedStateRevision = -1, error;
    for (const action of actions) {
      ackedActionId = Math.max(ackedActionId, action.id);
      if (!this.sessionId || action.context.generation !== context.generation || !sameChat(action.context.chatRef, context.chatRef) || action.graphId !== graphId) continue;
      try {
        const result = await this.act({chatRef: context.chatRef, graphId, revision: action.revision, view: 'summary', sessionId: this.sessionId, action: action.action});
        confirmedStateRevision = Math.max(confirmedStateRevision, result.snapshot.stateRevision);
      } catch (failure) {error = failure.message;}
    }
    if (actions.length) saved = await this.store.status(context.chatRef);
    const report = await this.socket.evaluate(`globalThis.CodexGraphAdapter?.sync(${JSON.stringify({context, snapshot: saved.snapshot, ackedActionId, confirmedStateRevision, error})})`);
    if (report?.mounted && this.sessionId && saved.snapshot) {
      await this.acknowledge({chatRef: context.chatRef, graphId: saved.snapshot.graph.graphId, revision: saved.snapshot.revision, view: 'summary', sessionId: this.sessionId, contextGeneration: report.contextGeneration});
    } else {
      this.invalidate(this.clientId); this.sessionKey = this.sessionId = null;
    }
    this.info = {state: report?.mounted ? 'mounted' : report?.stale ? 'chat-changed' : saved.snapshot ? 'waiting-summary' : 'no-graph', chatRef: context.chatRef, contextGeneration: context.generation, observedAt: new Date().toISOString()};
  }
  async stop() {
    this.running = false; clearTimeout(this.timer);
    await this.work;
    this.invalidate(this.clientId);
    if (this.socket?.open) await this.socket.evaluate('globalThis.CodexGraphAdapter?.destroy(); true').catch(() => {});
    this.socket?.close(); this.socket = null;
  }
}
