(function () {
  'use strict';
  globalThis.CodexGraphAdapter?.destroy();
  const same = (a, b) => a?.hostId === b?.hostId && a?.threadId === b?.threadId;
  const visible = element => element && element.getBoundingClientRect().width > 1 && element.getBoundingClientRect().height > 1 && !element.closest('[inert]');
  let context = {chatRef: null, generation: crypto.randomUUID()};
  let host, container, message, view, snapshot, interacting = false, pending = [], outbox = [], nextAction = 0, confirmedStateRevision = -1;

  function activeChat() {
    const matches = [...document.querySelectorAll('[data-app-action-sidebar-thread-active="true"][data-app-action-sidebar-thread-selected="true"][aria-current="page"]')];
    if (matches.length !== 1) return null;
    const hostId = matches[0].getAttribute('data-app-action-sidebar-thread-host-id');
    const rawId = matches[0].getAttribute('data-app-action-sidebar-thread-id');
    if (hostId !== 'local' || !/^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId || '')) return null;
    return {hostId, threadId: rawId.slice('local:'.length)};
  }
  function clearView() {
    view?.destroy(); view = null;
    host?.remove(); host = container = message = null;
    snapshot = null; interacting = false; pending = []; outbox = []; confirmedStateRevision = -1;
  }
  function refreshContext() {
    const ref = activeChat();
    if (!same(context.chatRef, ref)) {
      clearView(); context = {chatRef: ref, generation: crypto.randomUUID()};
    }
    if (host && !visible(host.parentElement)) host.remove();
    return context;
  }
  function localState(item) {return {selectedNodeId: item.state.selectedNodeId, ...item.state.views.summary};}
  function mount() {
    const summary = [...document.querySelectorAll('[data-summary-panel-variant="summary"]')].find(visible);
    const parent = summary?.firstElementChild;
    if (!parent || !snapshot) return false;
    if (!host) {
      host = document.createElement('section');
      host.dataset.codexGraph = 'summary';
      host.style.cssText = 'display:flex;flex-direction:column;flex:none;width:100%;min-height:320px;border-top:1px solid #414446;pointer-events:auto';
      message = document.createElement('div'); message.setAttribute('role', 'status');
      message.style.cssText = 'font:11px system-ui;color:#ffca87;padding:6px 10px;display:none';
      container = document.createElement('div'); container.style.cssText = 'flex:1;min-height:0';
      host.append(message, container);
    }
    if (host.parentElement !== parent) parent.append(host);
    const height = `${Math.max(320, Math.min(740, innerHeight - host.getBoundingClientRect().top - 24))}px`;
    if (host.style.height !== height) host.style.height = height;
    if (!view) {
      view = GraphPanel.mount(container, {
        graph: snapshot.graph, compact: true, state: localState(snapshot),
        onAction(action) {
          const item = {id: ++nextAction, context: {...context}, graphId: snapshot.graph.graphId, revision: snapshot.revision, action};
          pending.push(item); outbox.push(item);
        },
        onInteraction(value) {interacting = value;},
      });
    }
    return host.isConnected;
  }
  const observer = new MutationObserver(() => {
    refreshContext();
    if (context.chatRef && snapshot) mount();
  });
  observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'data-app-action-sidebar-thread-active', 'data-app-action-sidebar-thread-selected']});
  function resize() {if (snapshot) mount();}
  addEventListener('resize', resize);
  globalThis.CodexGraphAdapter = {
    peek() {return {context: refreshContext(), mounted: !!host?.isConnected, state: view?.getState()};},
    showSummary(ref) {
      refreshContext();
      if (!same(ref, context.chatRef)) return false;
      if ([...document.querySelectorAll('[data-summary-panel-variant="summary"]')].some(visible)) return true;
      const buttons = [...document.querySelectorAll('button')].filter(visible);
      const hideTabs = buttons.find(button => button.getAttribute('aria-label') === '탭 숨기기');
      const toggleSummary = buttons.find(button => button.getAttribute('aria-label') === '요약 표시 전환');
      (hideTabs || toggleSummary)?.click();
      return !!(hideTabs || toggleSummary);
    },
    read() {
      refreshContext();
      return {context, actions: outbox.splice(0), mounted: !!host?.isConnected};
    },
    sync(envelope) {
      refreshContext();
      if (!same(context.chatRef, envelope.context.chatRef) || context.generation !== envelope.context.generation) return {stale: true, mounted: false};
      if (!envelope.snapshot) {clearView(); return {mounted: false};}
      const next = envelope.snapshot;
      if (snapshot && snapshot.graph.graphId === next.graph.graphId && next.revision < snapshot.revision) return {stale: true, mounted: !!host?.isConnected};
      const newGraph = !snapshot || snapshot.graph.graphId !== next.graph.graphId || next.revision > snapshot.revision;
      if (newGraph) {pending = []; outbox = []; confirmedStateRevision = -1;}
      else pending = pending.filter(item => item.id > (envelope.ackedActionId || 0));
      confirmedStateRevision = Math.max(confirmedStateRevision, envelope.confirmedStateRevision ?? -1);
      snapshot = next;
      if (view) view.update(next.graph, newGraph || !interacting && !pending.length && next.stateRevision >= confirmedStateRevision ? localState(next) : undefined);
      const mounted = mount();
      if (message) {message.textContent = envelope.error || ''; message.style.display = envelope.error ? 'block' : 'none';}
      return {mounted, graphId: next.graph.graphId, revision: next.revision, contextGeneration: context.generation};
    },
    destroy() {
      observer.disconnect(); removeEventListener('resize', resize); clearView();
      delete globalThis.CodexGraphAdapter;
    },
  };
})();
