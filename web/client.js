(async function () {
  'use strict';
  const parameters = new URLSearchParams(location.search);
  const chatRef = {hostId: parameters.get('hostId'), threadId: parameters.get('threadId')};
  const graphId = parameters.get('graphId'), clientId = crypto.randomUUID();
  const label = document.getElementById('connection'), container = document.getElementById('graph');
  let token, sessionId, view, snapshot, interacting = false, actions = [], stopped = false, confirmedStateRevision = -1;
  function message(text, error = false) {label.textContent = text; label.dataset.error = String(error);}
  function localState(item) {return {selectedNodeId: item.state.selectedNodeId, ...item.state.views.large};}
  async function request(route, body, authenticated = true) {
    const response = await fetch(route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {...(authenticated ? {Authorization: `Bearer ${token}`} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error?.message || `HTTP ${response.status}`), {code: result.error?.code});
    return result;
  }
  async function session() {
    if (!token) token = (await request('/connection', undefined, false)).token;
    if (!sessionId) sessionId = (await request('/api/session', {chatRef, graphId, view: 'large', clientId})).sessionId;
  }
  async function update() {
    await session();
    while (actions.length) {
      const queued = actions[0];
      const result = await request('/api/state', {...queued, chatRef, graphId, view: 'large', sessionId});
      confirmedStateRevision = Math.max(confirmedStateRevision, result.snapshot.stateRevision);
      if (actions[0] === queued) actions.shift();
    }
    const query = new URLSearchParams({...chatRef, graphId});
    const saved = await request(`/api/status?${query}`);
    if (!saved.snapshot) throw new Error('등록된 그래프가 없습니다.');
    const next = saved.snapshot;
    if (snapshot && next.revision < snapshot.revision) return;
    const newGraph = !snapshot || next.revision > snapshot.revision;
    if (newGraph) {actions = []; confirmedStateRevision = -1;}
    snapshot = next;
    if (!view) {
      view = GraphPanel.mount(container, {
        graph: next.graph, state: localState(next),
        onAction(action) {actions.push({revision: snapshot.revision, action});},
        onInteraction(value) {interacting = value;},
      });
      globalThis.graphPanelView = view;
    } else view.update(next.graph, newGraph || !interacting && !actions.length && next.stateRevision >= confirmedStateRevision ? localState(next) : undefined);
    document.title = next.graph.title;
    message(`${next.graph.title} / 저장 버전 ${next.revision}`);
    await request('/api/ack', {chatRef, graphId, revision: next.revision, view: 'large', sessionId});
  }
  async function loop() {
    if (stopped) return;
    try {await update();}
    catch (error) {
      if (error.code === 'unauthorized') {token = sessionId = undefined;}
      else if (error.code === 'stale-session') {sessionId = undefined;}
      else if (error.code === 'revision-conflict') {actions = [];}
      message(`연결 대기: ${error.message}`, true);
    }
    if (!stopped) setTimeout(loop, 500);
  }
  addEventListener('pagehide', () => {
    stopped = true; view?.destroy();
    if (sessionId && token) void fetch('/api/close-session', {
      method: 'POST', keepalive: true,
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({chatRef, graphId, view: 'large', sessionId}),
    }).catch(() => {});
  }, {once: true});
  addEventListener('pageshow', event => {if (event.persisted) location.reload();});
  if (!chatRef.hostId || !chatRef.threadId || !graphId) {message('채팅과 그래프 ID가 있는 show URL을 사용하세요.', true); return;}
  await loop();
})();
