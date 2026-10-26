(function (root) {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const palette = ['#43cba0', '#eab75b', '#6ba9ff', '#bb93ef', '#ee96ad', '#83cbd1', '#d5bd83'];
  let sequence = 0;

  function element(document, tag, attributes = {}, text) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function mount(container, options) {
    const document = container.ownerDocument;
    const window = document.defaultView;
    const model = root.GraphModel;
    const compact = !!options.compact;
    const id = `graph-panel-${++sequence}`;
    const host = document.createElement('div');
    host.className = 'graph-panel';
    host.style.cssText = 'display:block;width:100%;height:100%;min-height:0';
    const shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = `<style>
      :host{color:#eef0f0;font:13px system-ui,sans-serif;color-scheme:dark}*{box-sizing:border-box}
      .shell{height:100%;display:flex;flex-direction:column;background:#1c1e20;overflow:hidden}
      header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #36393c;flex-wrap:wrap}
      strong{font-size:14px;font-weight:600;overflow-wrap:anywhere;flex:1;min-width:0}
      button,input{font:inherit;color:inherit;background:#282c2f;border:1px solid #4a5054;border-radius:6px;padding:6px 9px}
      button{cursor:pointer}button:hover{background:#363e43}button:focus-visible,input:focus-visible{outline:2px solid #7fb5ff;outline-offset:2px}
      input{min-width:80px;width:135px;max-width:100%}.legend{display:flex;gap:12px;padding:9px 14px;color:#bdc3c7;font-size:11px;flex-wrap:wrap;max-height:80px;overflow:auto}
      .legend span{overflow-wrap:anywhere}.legend span::before{content:'';display:inline-block;width:7px;height:7px;margin-right:5px;border-radius:2px;background:var(--c)}
      .canvas{position:relative;flex:1;min-height:80px;background-color:#141618;background-image:radial-gradient(#363b3f .7px,transparent .7px);background-size:18px 18px}
      svg.graph{width:100%;height:100%;display:block;touch-action:none;cursor:grab}svg.graph:active{cursor:grabbing}.node{cursor:pointer;outline:none}.node:focus-visible>rect:first-child{stroke:white;stroke-width:3}
      .tools{position:absolute;bottom:12px;left:12px;display:flex;gap:4px}.tools button{min-width:32px}.zoom{background:#24292c;padding:7px;border-radius:6px;font-size:11px}
      .minimap{position:absolute;right:12px;bottom:12px;width:145px;height:70px;border:1px solid #454c50;border-radius:7px;background:#23272a;pointer-events:none}
      .viewport{fill:#9ecaff;fill-opacity:.07;stroke:#a9bfd0;stroke-width:1;stroke-dasharray:4 3;vector-effect:non-scaling-stroke}
      .mini-edge{fill:none;stroke:#60758a;stroke-width:.8;vector-effect:non-scaling-stroke}.mini-connection.related .mini-edge{stroke:#9bc9ed;stroke-width:1.2}
      .mini-node{stroke:#495a6a;stroke-width:.6;vector-effect:non-scaling-stroke;opacity:.45}.mini-node.connected{stroke:#93cfff;stroke-width:1.3;opacity:.9;filter:drop-shadow(0 0 14px #78b4ff77)}
      .mini-node.selected{stroke:#eff8ff;stroke-width:2;opacity:1;filter:drop-shadow(0 0 20px #a1d2ffcc)}
      .node{transition:opacity 160ms ease}.node>rect:first-child{transition:stroke 180ms ease,stroke-width 180ms ease,filter 180ms ease}
      .node.connected>rect:first-child{stroke:#78b4dc;stroke-width:2;filter:drop-shadow(0 0 5px #78b4ff44)}.node[aria-pressed="true"]>rect:first-child{stroke:#c2e2ff;stroke-width:2.6;filter:drop-shadow(0 0 8px #78b4ff88)}.node.unrelated{opacity:.58}.node.search-miss{opacity:.2}
      .edge{transition:stroke 180ms ease,stroke-width 180ms ease;stroke-linecap:round;stroke-linejoin:round}.edge.related{stroke:#7faed4;stroke-width:2}
      .edge-flow{display:none;fill:none;stroke-width:2;stroke-linecap:round;stroke-dasharray:10 42;pointer-events:none}
      .connection.related .edge-flow,.mini-connection.related .edge-flow{display:block;stroke:#d4ecff;opacity:.95;filter:drop-shadow(0 0 3px #8bcaff99);animation:edge-current 1300ms linear infinite}.mini-connection .edge-flow{stroke-width:10}
      .port{fill:#1c2228;stroke:#63788d;stroke-width:1.5}.connection.related .port{stroke:#a8d5fa}
      .edge-label{fill:#a7b5c2;font-size:10px;text-anchor:middle;paint-order:stroke;stroke:#141618;stroke-width:5px;stroke-linejoin:round}
      @keyframes edge-current{to{stroke-dashoffset:-52}}
      .detail{min-height:65px;max-height:35%;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap;padding:11px 14px;border-top:1px solid #36393c;font-size:12px;line-height:1.6;color:#bdc6cb}.detail b{display:block;color:#f0f3f4}.source{display:block}.empty{position:absolute;inset:0;display:grid;place-items:center;color:#aeb9c2;pointer-events:none}.empty[hidden]{display:none}
      .motion-off .edge-flow{display:none!important;animation:none!important}
      @media(prefers-reduced-motion:reduce){.connection.related .edge-flow,.mini-connection.related .edge-flow{display:none;animation:none}.node,.node>rect:first-child,.edge{transition:none}}
      ${compact ? 'header{padding:10px;gap:6px}strong{font-size:12px}input{font-size:11px;padding:4px 6px;width:110px}.legend{padding:6px 10px;gap:8px;max-height:56px}.detail{min-height:52px;padding:7px 10px;font-size:11px}.tools{bottom:7px;left:7px}.tools button{padding:3px 6px;min-width:24px}.zoom{padding:4px}.minimap{width:60px;height:116px;right:7px;bottom:7px;opacity:.3;pointer-events:all;transition:opacity 160ms ease}.minimap:hover,.minimap:focus-visible{opacity:1}.minimap:focus-visible{outline:2px solid #7fb5ff;outline-offset:2px}@media(prefers-reduced-motion:reduce){.minimap{transition:none}}' : ''}
    </style><div class="shell"><header><strong></strong><input aria-label="노드 검색" placeholder="노드 검색"></header><div class="legend" aria-label="노드 유형"></div><div class="canvas"><svg class="graph" role="group"><defs></defs><g class="world"></g></svg><div class="empty" hidden>표시할 노드가 없습니다.</div><div class="tools"><button aria-label="확대">+</button><button aria-label="축소">−</button><button aria-label="전체 맞춤">맞춤</button><span class="zoom"></span></div><svg class="minimap" role="img" aria-label="그래프 미니맵" tabindex="0"></svg></div><div class="detail" aria-live="polite"></div></div>`;

    const shell = shadow.querySelector('.shell');
    const svg = shadow.querySelector('.graph');
    const world = shadow.querySelector('.world');
    const minimap = shadow.querySelector('.minimap');
    const detail = shadow.querySelector('.detail');
    const search = shadow.querySelector('input');
    const measure = document.createElement('canvas').getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let graph, layout, nodeMap, viewMap, viewport, graphSignature;
    let selectedNodeId = null, camera = null, query = '';
    let hovered = null, focused = null, drag = null;
    let frame = 0, target = null, interacting = false, destroyed = false;
    let nodeElements = [], miniNodes = [], connections = [], miniConnections = [];

    function marker(markerId, size) {
      const node = element(document, 'marker', {id: markerId, viewBox: '0 0 12 12', refX: 10, refY: 6, markerWidth: size, markerHeight: size, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse'});
      node.append(element(document, 'path', {d: 'M2 2 L10 6 L2 10', fill: 'none', stroke: 'context-stroke', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
      return node;
    }
    svg.querySelector('defs').append(marker(`${id}-arrow`, 10));

    function interaction(value) {
      if (interacting === value) return;
      interacting = value;
      options.onInteraction?.(value);
    }
    function emit(action) { if (!destroyed) options.onAction?.(action); }
    function cameraCopy() { return camera ? {...camera} : null; }
    function finishInteraction() {
      if (interacting) {
        emit({type: 'setCamera', camera: cameraCopy()});
        interaction(false);
      }
    }
    function stopAnimation() {
      window.cancelAnimationFrame(frame);
      frame = 0;
      target = null;
    }
    function transform() {
      if (!camera) return;
      const tx = svg.clientWidth / 2 - camera.x * camera.zoom;
      const ty = svg.clientHeight / 2 - camera.y * camera.zoom;
      world.setAttribute('transform', `translate(${tx} ${ty}) scale(${camera.zoom})`);
      shadow.querySelector('.zoom').textContent = `${Math.round(camera.zoom * 100)}%`;
      if (viewport) {
        const left = Math.max(0, Math.min(layout.width, -tx / camera.zoom));
        const top = Math.max(0, Math.min(layout.height, -ty / camera.zoom));
        const right = Math.max(left, Math.min(layout.width, (svg.clientWidth - tx) / camera.zoom));
        const bottom = Math.max(top, Math.min(layout.height, (svg.clientHeight - ty) / camera.zoom));
        for (const [key, value] of Object.entries({x: left, y: top, width: right - left, height: bottom - top})) viewport.setAttribute(key, value);
      }
    }
    function moveTo(next, duration, local = true) {
      stopAnimation();
      if (local) interaction(true);
      if (!camera || reduced.matches || document.hidden || !duration) {
        camera = {...next};
        transform();
        if (local) finishInteraction();
        return;
      }
      const start = {...camera}, began = window.performance.now();
      target = {...next};
      function step(now) {
        const progress = Math.min(1, (now - began) / duration);
        const ease = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
        camera = Object.fromEntries(['x', 'y', 'zoom'].map(key => [key, start[key] + (next[key] - start[key]) * ease]));
        transform();
        if (progress < 1) frame = window.requestAnimationFrame(step);
        else { frame = 0; target = null; if (local) finishInteraction(); }
      }
      frame = window.requestAnimationFrame(step);
    }
    function fit(local = false) {
      if (!svg.clientWidth || !svg.clientHeight) return;
      const zoom = Math.max(.001, Math.min((svg.clientWidth - 30) / layout.width, (svg.clientHeight - 35) / layout.height));
      moveTo({x: layout.width / 2, y: layout.height / 2, zoom}, local ? 440 : 0, local);
    }
    function zoom(factor, x = svg.clientWidth / 2, y = svg.clientHeight / 2, duration = 300) {
      if (!camera) fit();
      if (!camera) return;
      const from = target || camera;
      const nextZoom = Math.min(2.8, Math.max(.001, from.zoom * factor));
      moveTo({x: from.x + (x - svg.clientWidth / 2) * (1 / from.zoom - 1 / nextZoom), y: from.y + (y - svg.clientHeight / 2) * (1 / from.zoom - 1 / nextZoom), zoom: nextZoom}, duration);
    }

    function fitText(value, width, font, maxLines) {
      measure.font = font;
      let rest = Array.from(value.trim());
      const lines = [];
      while (rest.length && lines.length < maxLines) {
        if (measure.measureText(rest.join('')).width <= width) { lines.push(rest.join('')); break; }
        let count = 0;
        while (count < rest.length && measure.measureText(rest.slice(0, count + 1).join('')).width <= width) count++;
        count = Math.max(1, count);
        if (lines.length === maxLines - 1) {
          while (count > 0 && measure.measureText(rest.slice(0, count).join('') + '…').width > width) count--;
          lines.push(rest.slice(0, count).join('').trimEnd() + '…');
          break;
        }
        const space = rest.lastIndexOf(' ', count);
        if (space > 0) count = space;
        lines.push(rest.slice(0, count).join('').trimEnd());
        rest = Array.from(rest.slice(count).join('').trimStart());
      }
      return lines;
    }
    function cardText(node, className, text, x, y, size, color, lines, weight = 400) {
      const label = element(document, 'text', {class: className, x, y, fill: color, 'font-size': size, 'font-weight': weight});
      const parts = fitText(text, layout.cardWidth - x - 14, `${weight} ${size}px system-ui, sans-serif`, lines);
      parts.forEach((part, index) => label.append(element(document, 'tspan', {x, dy: index ? 19 : 0}, part)));
      label.append(element(document, 'title', {}, text));
      node.append(label);
      return parts.length;
    }
    function showDetails() {
      const node = nodeMap.get(hovered || focused || selectedNodeId);
      detail.replaceChildren();
      if (!node) { detail.textContent = graph.nodes.length ? '노드를 선택하면 전체 내용을 볼 수 있습니다.' : ''; return; }
      const heading = document.createElement('b');
      heading.textContent = `${node.type} / ${node.label}`;
      detail.append(heading);
      if (node.status) { const status = document.createElement('div'); status.textContent = node.status; detail.append(status); }
      if (node.details) detail.append(document.createTextNode(node.details));
      for (const source of node.sources || []) {
        const line = document.createElement('span');
        line.className = 'source';
        line.textContent = `${source.label}: ${source.href}`;
        detail.append(line);
      }
    }
    function updateHighlights() {
      const related = selectedNodeId ? model.connectedPath(graph, selectedNodeId) : {nodes: new Set(), edges: new Set()};
      const needle = query.trim().toLocaleLowerCase();
      for (const node of nodeElements) {
        const selected = node.dataset.id === selectedNodeId;
        const data = nodeMap.get(node.dataset.id);
        node.setAttribute('aria-pressed', String(selected));
        node.classList.toggle('connected', !selected && related.nodes.has(data.id));
        node.classList.toggle('unrelated', !!selectedNodeId && !related.nodes.has(data.id));
        node.classList.toggle('search-miss', !!needle && !`${data.label} ${data.details || ''} ${data.type} ${data.status || ''}`.toLocaleLowerCase().includes(needle));
      }
      for (const node of miniNodes) {
        node.classList.toggle('selected', node.dataset.id === selectedNodeId);
        node.classList.toggle('connected', node.dataset.id !== selectedNodeId && related.nodes.has(node.dataset.id));
      }
      for (const connection of [...connections, ...miniConnections]) {
        const active = related.edges.has(connection.dataset.id);
        connection.classList.toggle('related', active);
        connection.querySelector('.edge')?.classList.toggle('related', active);
      }
      showDetails();
    }
    function choose(nodeId) {
      interaction(true);
      selectedNodeId = nodeId;
      updateHighlights();
      emit({type: 'selectNode', nodeId});
      const node = viewMap.get(nodeId);
      moveTo({x: node.x + layout.cardWidth / 2, y: node.y + layout.cardHeight / 2, zoom: Math.max(camera?.zoom || 0, compact ? .9 : 1)}, 360);
    }

    function edgeGeometry(edge, index) {
      const a = viewMap.get(edge.source), b = viewMap.get(edge.target);
      const w = layout.cardWidth, h = layout.cardHeight;
      const forward = compact ? b.y > a.y : b.x > a.x;
      if (!forward) {
        const gap = 22 + index % 4 * 7;
        if (compact) {
          const x1 = a.x + w * .65, x2 = b.x + w * .35, y1 = a.y, y2 = b.y;
          const outer = Math.min(y1, y2) - gap;
          return {d: `M${x1} ${y1} C${x1} ${outer} ${x1} ${outer} ${(x1 + x2) / 2} ${outer} S${x2} ${outer} ${x2} ${y2 - 9}`, start: [x1, y1], end: [x2, y2], label: [(x1 + x2) / 2, outer - 5]};
        }
        const y1 = a.y + h * .65, y2 = b.y + h * .35, x1 = a.x, x2 = b.x;
        const outer = Math.min(x1, x2) - gap;
        return {d: `M${x1} ${y1} C${outer} ${y1} ${outer} ${y1} ${outer} ${(y1 + y2) / 2} S${outer} ${y2} ${x2 - 9} ${y2}`, start: [x1, y1], end: [x2, y2], label: [outer - 10, (y1 + y2) / 2 - 5]};
      }
      const start = compact ? [a.x + w / 2, a.y + h] : [a.x + w, a.y + h / 2];
      const end = compact ? [b.x + w / 2, b.y] : [b.x, b.y + h / 2];
      const [x, y] = start, [ex, ey] = end;
      const d = compact ? `M${x} ${y + 6} C${x} ${y + (ey - y) * .6} ${ex} ${ey - (ey - y) * .6} ${ex} ${ey - 10}` : `M${x + 6} ${y} C${x + (ex - x) * .6} ${y} ${ex - (ex - x) * .6} ${ey} ${ex - 10} ${ey}`;
      return {d, start, end, label: [(x + ex) / 2 + (compact ? 18 : 0), (y + ey) / 2 - (compact ? 0 : 12)]};
    }
    function renderGraph() {
      layout = model.layoutGraph(graph, compact);
      nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
      viewMap = new Map(layout.nodes.map(node => [node.id, node]));
      shadow.querySelector('strong').textContent = graph.title;
      svg.setAttribute('aria-label', graph.title);
      shadow.querySelector('.empty').hidden = graph.nodes.length !== 0;
      const legend = shadow.querySelector('.legend');
      legend.replaceChildren();
      const colors = new Map();
      for (const node of graph.nodes) if (!colors.has(node.type)) {
        const color = palette[colors.size % palette.length];
        colors.set(node.type, color);
        const item = document.createElement('span');
        item.style.setProperty('--c', color);
        item.textContent = node.type;
        legend.append(item);
      }
      world.replaceChildren();
      minimap.replaceChildren();
      const definitions = element(document, 'defs');
      definitions.append(marker(`${id}-mini-arrow`, 35));
      minimap.append(definitions);
      minimap.setAttribute('viewBox', `-16 -16 ${layout.width + 32} ${layout.height + 32}`);
      connections = []; miniConnections = []; nodeElements = []; miniNodes = [];
      graph.edges.forEach((edge, index) => {
        const geometry = edgeGeometry(edge, index);
        const connection = element(document, 'g', {class: 'connection', 'data-id': edge.id, 'data-from': edge.source, 'data-to': edge.target});
        const arrows = markerId => edge.direction === 'none' ? {} : {'marker-end': `url(#${markerId})`, ...(edge.direction === 'both' ? {'marker-start': `url(#${markerId})`} : {})};
        connection.append(element(document, 'path', {class: 'edge', d: geometry.d, fill: 'none', stroke: '#55697d', 'stroke-width': 1.5, ...arrows(`${id}-arrow`)}), element(document, 'path', {class: 'edge-flow', d: geometry.d}));
        for (const point of [geometry.start, geometry.end]) connection.append(element(document, 'circle', {class: 'port', cx: point[0], cy: point[1], r: 3}));
        if (edge.label || edge.type) {
          const label = element(document, 'text', {class: 'edge-label', x: geometry.label[0], y: geometry.label[1]}, fitText(edge.label || edge.type, 120, '400 10px system-ui, sans-serif', 1)[0] || '');
          label.append(element(document, 'title', {}, edge.label || edge.type));
          connection.append(label);
        }
        world.append(connection); connections.push(connection);
        const mini = element(document, 'g', {class: 'mini-connection', 'data-id': edge.id, 'data-from': edge.source, 'data-to': edge.target});
        mini.append(element(document, 'path', {class: 'mini-edge', d: geometry.d, ...arrows(`${id}-mini-arrow`)}), element(document, 'path', {class: 'edge-flow', d: geometry.d}));
        minimap.append(mini); miniConnections.push(mini);
      });
      for (const data of layout.nodes) {
        const color = colors.get(data.type), w = layout.cardWidth, h = layout.cardHeight;
        const node = element(document, 'g', {class: 'node', 'data-id': data.id, role: 'button', tabindex: 0, 'aria-label': `${data.type}: ${data.label}`, transform: `translate(${data.x} ${data.y})`});
        node.append(element(document, 'rect', {width: w, height: h, rx: 12, fill: '#22272b', stroke: '#4b535a', 'stroke-width': 1.5}), element(document, 'rect', {x: 14, y: 16, width: 8, height: 8, rx: 2, fill: color}));
        cardText(node, 'node-type', data.type, 30, 24, 12, color, 1, 600);
        const titleLines = cardText(node, 'node-title', data.label, 14, compact ? 45 : 55, compact ? 16 : 15, '#f0f2f4', compact ? 2 : 1, 600);
        cardText(node, 'node-body', data.details || '', 14, compact ? (titleLines > 1 ? 83 : 66) : 80, compact ? 11 : 12, '#aeb9c2', compact ? 1 : 2);
        if (data.status) cardText(node, 'node-status', data.status, 14, h - 14, 11, color, 1);
        node.append(element(document, 'title', {}, [data.type, data.label, data.details, data.status].filter(Boolean).join('\n')));
        node.addEventListener('click', () => choose(data.id));
        node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(data.id); } });
        node.addEventListener('pointerenter', () => { hovered = data.id; showDetails(); });
        node.addEventListener('pointerleave', () => { hovered = null; showDetails(); });
        node.addEventListener('focus', () => { focused = data.id; showDetails(); });
        node.addEventListener('blur', () => { focused = null; showDetails(); });
        world.append(node); nodeElements.push(node);
        const mini = element(document, 'rect', {class: 'mini-node', 'data-id': data.id, x: data.x, y: data.y, width: w, height: h, rx: 12, fill: color});
        minimap.append(mini); miniNodes.push(mini);
      }
      viewport = element(document, 'rect', {class: 'viewport', rx: 5});
      viewport.append(element(document, 'title', {}, '현재 화면에 보이는 영역'));
      minimap.append(viewport);
      updateHighlights();
      if (camera) transform(); else fit();
    }

    function validCamera(value) {
      return value && ['x', 'y', 'zoom'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key])) && value.zoom > 0;
    }
    function update(nextGraph, state) {
      if (destroyed) return;
      const next = model.validateGraph(nextGraph);
      const signature = JSON.stringify(next);
      const changedGraph = graphSignature !== signature;
      if (!changedGraph && !state) return;
      const changedId = graph?.graphId !== next.graphId;
      if (changedGraph) {
        stopAnimation();
        drag = null;
        interaction(false);
      }
      if (changedId) { selectedNodeId = null; camera = null; query = ''; }
      graph = next;
      if (state) {
        if (Object.prototype.hasOwnProperty.call(state, 'selectedNodeId')) selectedNodeId = typeof state.selectedNodeId === 'string' ? state.selectedNodeId : null;
        if (validCamera(state.camera) && ['x', 'y', 'zoom'].some(key => camera?.[key] !== state.camera[key])) {
          stopAnimation();
          camera = {x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom};
        }
        if (typeof state.query === 'string') query = state.query;
      }
      if (!graph.nodes.some(node => node.id === selectedNodeId)) selectedNodeId = null;
      search.value = query;
      if (changedGraph) {
        hovered = null; focused = null;
        graphSignature = signature;
        renderGraph();
      } else {
        updateHighlights();
        transform();
      }
    }
    function endDrag() {
      if (!drag) return;
      drag = null;
      finishInteraction();
    }
    svg.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('.node')) return;
      if (!camera) fit();
      if (!camera) return;
      stopAnimation(); interaction(true);
      drag = {pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: {...camera}};
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      camera = {x: drag.camera.x - (event.clientX - drag.x) / drag.camera.zoom, y: drag.camera.y - (event.clientY - drag.y) / drag.camera.zoom, zoom: drag.camera.zoom};
      transform();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) svg.addEventListener(name, endDrag);
    svg.addEventListener('wheel', event => {
      event.preventDefault();
      if (drag) endDrag();
      const bounds = svg.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * .001), event.clientX - bounds.left, event.clientY - bounds.top, 180);
    }, {passive: false});
    shadow.querySelector('[aria-label="확대"]').addEventListener('click', () => zoom(1.25));
    shadow.querySelector('[aria-label="축소"]').addEventListener('click', () => zoom(.8));
    shadow.querySelector('[aria-label="전체 맞춤"]').addEventListener('click', () => fit(true));
    search.addEventListener('input', () => { query = search.value; updateHighlights(); emit({type: 'setQuery', query}); });
    function visibilityChanged() {
      shell.classList.toggle('motion-off', document.hidden);
      if (document.hidden && target) moveTo(target, 0);
    }
    function motionChanged() { if (reduced.matches && target) moveTo(target, 0); }
    shell.classList.toggle('motion-off', document.hidden);
    container.append(host);
    try { update(options.graph, options.state); }
    catch (error) { host.remove(); throw error; }
    document.addEventListener('visibilitychange', visibilityChanged);
    reduced.addEventListener('change', motionChanged);
    const resize = new window.ResizeObserver(() => { if (camera) transform(); else fit(); });
    resize.observe(svg);
    return {
      update,
      getState() { return {selectedNodeId, camera: cameraCopy(), query}; },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopAnimation();
        resize.disconnect();
        document.removeEventListener('visibilitychange', visibilityChanged);
        reduced.removeEventListener('change', motionChanged);
        interaction(false);
        host.remove();
      }
    };
  }
  root.GraphPanel = {mount};
})(globalThis);
