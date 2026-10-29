(function (root) {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const palette = Array.from({length: 7}, (_, index) => `var(--type-${index})`);
  const icon = content => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
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
    const id = `graph-viewer-${++sequence}`;
    const host = document.createElement('div');
    host.className = 'graph-viewer';
    host.style.cssText = 'display:block;width:100%;height:100%;min-height:0';
    const shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = `<style>
      :host{--text:#eef0f0;--muted:#aeb9c2;--surface:#1c1e20;--canvas:#141618;--grid:#363b3f;--control:#282c2f;--control-border:#4a5054;--control-hover:#363e43;--line:#36393c;--focus:#7fb5ff;--node-surface:#22272b;--card-tint:6%;--node-border:#4b535a;--selected:#c2e2ff;--related:#78b4dc;--edge:#687581;--edge-active:#38bdf8;--flow:#d4ecff;--tooltip-top:#2b3237;--tooltip-shadow:#0009;--scrollbar:#58636c;--source:#d8e3ec;--url:#94a7b7;--type-0:#43cba0;--type-1:#eab75b;--type-2:#6ba9ff;--type-3:#bb93ef;--type-4:#ee96ad;--type-5:#83cbd1;--type-6:#d5bd83;color:var(--text);font:13px system-ui,sans-serif;color-scheme:dark}
      :host([data-theme="light"]){--text:#20303e;--muted:#526577;--surface:#fff;--canvas:#f2f5f8;--grid:#c8d2dc;--control:#fff;--control-border:#c4cfd9;--control-hover:#eaf0f6;--line:#dce3ea;--focus:#2563eb;--node-surface:#fff;--card-tint:4%;--node-border:#aebfce;--selected:#2563eb;--related:#5585b7;--edge:#7d8791;--edge-active:#1d4ed8;--tooltip-top:#f8fbff;--tooltip-shadow:#20375024;--scrollbar:#a6b6c5;--source:#354f69;--url:#536d86;--type-0:#087f62;--type-1:#946200;--type-2:#245fbe;--type-3:#7850aa;--type-4:#aa4262;--type-5:#176f7a;--type-6:#7a601e;color-scheme:light}*{box-sizing:border-box}
      .shell{height:100%;display:flex;flex-direction:column;background:var(--surface);overflow:hidden}
      header{padding:10px 12px;border-bottom:1px solid var(--line)}.header-controls{display:flex;align-items:center;gap:10px;width:100%}
      button,input,select{font:inherit;color:inherit}.icon{width:16px;height:16px;flex:none;pointer-events:none}
      button{display:inline-flex;align-items:center;justify-content:center;height:32px;min-width:32px;padding:6px;background:transparent;border:1px solid transparent;border-radius:8px;cursor:pointer;transition:background 140ms ease,color 140ms ease,border-color 140ms ease}
      button[hidden]{display:none}button:hover{background:var(--control-hover)}button:active{background:color-mix(in srgb,var(--focus) 15%,var(--control))}button:focus-visible,select:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
      button:disabled{opacity:.45;cursor:default}.export-status{position:absolute;z-index:4;top:12px;right:12px;max-width:calc(100% - 24px);padding:10px 14px;border:1px solid var(--control-border);border-radius:9px;background:var(--surface);color:var(--text);box-shadow:0 4px 16px var(--tooltip-shadow);overflow-wrap:anywhere}.export-status[hidden]{display:none}
      .search-field{position:relative;display:flex;align-items:center;flex:1;min-width:0;max-width:280px;height:36px;border:1px solid var(--control-border);border-radius:9px;background:var(--control);transition:border-color 140ms ease,box-shadow 140ms ease}
      .search-field:focus-within{border-color:var(--focus);box-shadow:0 0 0 3px color-mix(in srgb,var(--focus) 14%,transparent)}.search-field>.icon{margin-left:10px;color:var(--muted)}
      input{width:100%;min-width:0;height:100%;padding:0 34px 0 8px;background:transparent;border:0;outline:none}input::placeholder{color:var(--muted)}
      .search-clear{position:absolute;right:4px;top:4px;width:26px;min-width:26px;height:26px;padding:4px;border-radius:6px;color:var(--muted)}.search-clear:hover{color:var(--text)}
      .theme-field{position:relative;flex:none;width:112px;margin-left:auto}.theme-field>.icon{position:absolute;right:9px;top:10px;color:var(--muted)}
      .layout-controls{display:flex;align-items:center;gap:12px;flex:none}.layout-field{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px;white-space:nowrap}
      .select-wrap{position:relative;display:block;width:112px;color:var(--text)}.direction-field .select-wrap{width:80px}.select-wrap>.icon{position:absolute;right:9px;top:calc(50% - 8px);color:var(--muted)}
      select{appearance:none;width:100%;height:36px;padding:0 30px 0 11px;background:var(--control);border:1px solid var(--control-border);border-radius:9px;cursor:pointer}select:hover{background:var(--control-hover)}
      select:disabled{opacity:.5;cursor:default;background:var(--control)}
      .legend{display:flex;gap:12px;padding:9px 14px;color:var(--muted);font-size:11px;flex-wrap:wrap;max-height:80px;overflow:auto}
      .legend span{overflow-wrap:anywhere}.legend span::before{content:'';display:inline-block;width:7px;height:7px;margin-right:5px;border-radius:2px;background:var(--c)}
      .canvas{position:relative;flex:1;min-height:80px;background-color:var(--canvas);background-image:radial-gradient(var(--grid) .7px,transparent .7px);background-size:18px 18px}
      svg.graph{width:100%;height:100%;display:block;touch-action:none;cursor:grab}svg.graph:active{cursor:grabbing}.node{cursor:pointer;outline:none}.node:focus-visible>rect:first-child{stroke:var(--focus);stroke-width:3}
      .tools{position:absolute;bottom:12px;left:12px;display:flex;align-items:center;gap:2px;padding:4px;border:1px solid var(--control-border);border-radius:12px;background:color-mix(in srgb,var(--surface) 94%,transparent);box-shadow:0 4px 12px color-mix(in srgb,var(--tooltip-shadow) 45%,transparent)}
      .tools button{width:32px}.tools .zoom{width:auto;min-width:46px;height:32px;margin-left:4px;padding:0 8px;border-left:1px solid var(--line);color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
      .minimap{position:absolute;right:12px;bottom:12px;width:145px;height:70px;border:1px solid var(--control-border);border-radius:7px;background:var(--node-surface);pointer-events:none}
      .viewport{fill:var(--selected);fill-opacity:.07;stroke:var(--related);stroke-width:1;stroke-dasharray:4 3;vector-effect:non-scaling-stroke}
      .mini-edge{fill:none;stroke:var(--edge);stroke-width:.8;vector-effect:non-scaling-stroke}.mini-connection.related .mini-edge{stroke:var(--edge-active);stroke-width:1.8}
      .mini-node{stroke:var(--node-border);stroke-width:.6;vector-effect:non-scaling-stroke;opacity:.45}.mini-node.connected{stroke:var(--related);stroke-width:1.3;opacity:.9}
      .mini-node.selected{stroke:var(--selected);stroke-width:2;opacity:1;filter:drop-shadow(0 0 20px color-mix(in srgb,var(--selected) 60%,transparent))}
      .node{transition:opacity 160ms ease}.node>rect:first-child{transition:stroke 180ms ease,stroke-width 180ms ease,filter 180ms ease}
      .group-box{pointer-events:none}.group-border{fill:var(--surface);fill-opacity:.45;stroke:var(--node-border);stroke-width:1.2;stroke-dasharray:6 4;rx:14}.group-title{fill:var(--muted);font-size:13px;font-weight:600}
      .group-box.related .group-border{stroke:var(--related);stroke-width:1.8;stroke-dasharray:none}.group-box.related .group-title{fill:var(--text)}
      .mini-group{fill:none;stroke:var(--node-border);stroke-width:.7;vector-effect:non-scaling-stroke}.mini-group.related{stroke:var(--related);stroke-width:1.2}
      .node.connected>rect:first-child{stroke:var(--related);stroke-width:2}.node[aria-pressed="true"]>rect:first-child{stroke:var(--selected);stroke-width:2.6;filter:drop-shadow(0 0 8px color-mix(in srgb,var(--selected) 40%,transparent))}.node.unrelated{opacity:.58}.node.search-miss{opacity:.2}
      .connection,.mini-connection{transition:opacity 180ms ease}.connection.unrelated,.mini-connection.unrelated{opacity:.35}
      .edge{transition:stroke 180ms ease,stroke-width 180ms ease;stroke-linecap:round;stroke-linejoin:round}.edge.related{stroke:var(--edge-active);stroke-width:2.6}
      .edge-flow{display:none;fill:none;stroke-width:2;stroke-linecap:round;stroke-dasharray:10 42;pointer-events:none}
      .edge-flow.related{display:block;stroke:var(--flow);opacity:.95;animation:edge-current 1300ms linear infinite}
      .port{fill:var(--node-surface);stroke:var(--edge);stroke-width:1.5}.connection.related .port{fill:var(--edge-active);stroke:var(--edge-active)}
      .edge-label{fill:var(--muted);font-size:10px;text-anchor:middle;paint-order:stroke;stroke:var(--canvas);stroke-width:5px;stroke-linejoin:round}
      .connection.related .edge-label{fill:var(--edge-active);font-weight:600}
      .overview .node text,.overview .edge-label,.overview .port{display:none}
      @keyframes edge-current{to{stroke-dashoffset:-52}}
      .node-tooltip{position:absolute;z-index:3;width:360px;max-width:calc(100% - 24px);display:flex;flex-direction:column;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--line));border-radius:14px;background:linear-gradient(150deg,var(--tooltip-top),var(--node-surface) 70%);box-shadow:0 16px 40px var(--tooltip-shadow),0 0 22px color-mix(in srgb,var(--accent) 12%,transparent);color:var(--muted);cursor:auto;animation:tooltip-in 140ms ease-out}
      .node-tooltip[hidden]{display:none}.node-tooltip::after{content:'';position:absolute;width:9px;height:9px;background:var(--tooltip-top);transform:rotate(45deg);border:inherit}
      .node-tooltip[data-side="right"]::after{left:-5px;top:var(--tip);border-right:0;border-top:0}.node-tooltip[data-side="left"]::after{right:-5px;top:var(--tip);border-left:0;border-bottom:0}
      .node-tooltip[data-side="bottom"]::after{top:-5px;left:var(--tip);border-right:0;border-bottom:0}.node-tooltip[data-side="top"]::after{bottom:-5px;left:var(--tip);border-left:0;border-top:0}
      .tooltip-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--scrollbar) transparent;padding:16px 18px;border-radius:13px;overflow-wrap:anywhere;user-select:text}
      .tooltip-meta{display:flex;align-items:center;gap:8px;margin-bottom:9px;color:var(--accent);font-size:11px;font-weight:600}.tooltip-type{flex:1;min-width:0}.tooltip-type::before{content:'';display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:2px;background:var(--accent)}
      .tooltip-status{max-width:55%;padding:3px 7px;border-radius:5px;background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 24%,transparent);font-size:10px;line-height:1.4}
      .tooltip-title{margin:0;color:var(--text);font-size:17px;line-height:1.45;font-weight:600;letter-spacing:-.015em;white-space:pre-wrap}.tooltip-body{margin-top:11px;font-size:12px;line-height:1.75;white-space:pre-wrap}
      .tooltip-sources{margin-top:14px;padding-top:11px;border-top:1px solid var(--line);display:grid;gap:9px}.tooltip-source-label{display:block;color:var(--source);font-size:11px;font-weight:600}.tooltip-source-url{display:block;margin-top:3px;color:var(--url);font-size:11px;line-height:1.6}
      @keyframes tooltip-in{from{opacity:0}to{opacity:1}}.empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);pointer-events:none}.empty[hidden]{display:none}
      .motion-off .edge-flow{display:none!important;animation:none!important}
      @media(prefers-reduced-motion:reduce){.edge-flow.related{display:none;animation:none}.node,.node>rect:first-child,.edge,.connection,.mini-connection,button,.search-field{transition:none}.node-tooltip{animation:none}}
      @media(max-width:380px){header{padding:8px}.header-controls{gap:6px}.theme-field{width:100px}}
      @media(max-width:680px){.header-controls{flex-wrap:wrap}.layout-controls{order:3;flex-basis:100%}}
      ${compact ? 'header{padding:8px}.header-controls{gap:6px}.search-field,select{height:32px;font-size:12px}.search-clear{top:2px;right:2px}.theme-field{width:100px}.theme-field>.icon{top:8px}.legend{padding:6px 10px;gap:8px;max-height:56px}.tooltip-scroll{padding:13px 14px}.tooltip-title{font-size:15px}.tools{bottom:7px;left:7px}.tools button{width:28px;height:28px;min-width:28px}.zoom{height:28px;min-width:42px}.minimap{width:60px;height:116px;right:7px;bottom:7px;opacity:.3;pointer-events:all;transition:opacity 160ms ease}.minimap:hover,.minimap:focus-visible{opacity:1}.minimap:focus-visible{outline:2px solid var(--focus);outline-offset:2px}@media(prefers-reduced-motion:reduce){.minimap{transition:none}}' : ''}
    </style><div class="shell"><header><div class="header-controls">
      <div class="search-field">${icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>')}<input aria-label="노드 검색" placeholder="노드 검색"><button class="search-clear" type="button" aria-label="검색어 지우기" title="검색어 지우기" hidden>${icon('<path d="m8 8 8 8m0-8-8 8"/>')}</button></div>
      <div class="layout-controls"><label class="layout-field">배치<span class="select-wrap"><select aria-label="배치 방식"><option value="layered">계층형</option><option value="tree">트리형</option><option value="radial">방사형</option><option value="network">네트워크형</option></select>${icon('<path d="m8 10 4 4 4-4"/>')}</span></label><label class="layout-field direction-field">방향<span class="select-wrap"><select aria-label="배치 방향"><option value="horizontal">가로</option><option value="vertical">세로</option></select>${icon('<path d="m8 10 4 4 4-4"/>')}</span></label></div>
      <div class="theme-field"><select aria-label="화면 테마"><option value="auto">자동 테마</option><option value="light">라이트</option><option value="dark">다크</option></select>${icon('<path d="m8 10 4 4 4-4"/>')}</div>
      <button class="export-image" type="button" aria-label="그래프 이미지 저장" title="전체 그래프를 PNG로 저장">${icon('<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>')}</button>
    </div></header><div class="legend" aria-label="노드 유형"></div><div class="canvas"><svg class="graph" role="group"><defs></defs><g class="world"></g></svg><div class="empty" hidden>표시할 노드가 없습니다.</div>
      <div class="tools" role="toolbar" aria-label="그래프 보기"><button type="button" aria-label="확대" title="확대">${icon('<path d="M12 5v14M5 12h14"/>')}</button><button type="button" aria-label="축소" title="축소">${icon('<path d="M5 12h14"/>')}</button><button type="button" aria-label="전체 맞춤" title="전체 맞춤">${icon('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>')}</button><button class="zoom" type="button" aria-label="100%로 보기" title="100%로 보기"></button></div>
      <svg class="minimap" role="img" aria-label="그래프 미니맵" tabindex="0"></svg><div class="node-tooltip" id="${id}-tooltip" role="tooltip" hidden><div class="tooltip-scroll"></div></div><div class="export-status" role="status" hidden></div></div></div>`;

    const shell = shadow.querySelector('.shell');
    const svg = shadow.querySelector('.graph');
    const world = shadow.querySelector('.world');
    const minimap = shadow.querySelector('.minimap');
    const canvas = shadow.querySelector('.canvas');
    const tooltip = shadow.querySelector('.node-tooltip');
    const tooltipScroll = shadow.querySelector('.tooltip-scroll');
    const search = shadow.querySelector('input');
    const clearSearch = shadow.querySelector('.search-clear');
    const themeSelect = shadow.querySelector('[aria-label="화면 테마"]');
    const layoutSelect = shadow.querySelector('[aria-label="배치 방식"]');
    const directionSelect = shadow.querySelector('[aria-label="배치 방향"]');
    const exportButton = shadow.querySelector('.export-image');
    const exportStatus = shadow.querySelector('.export-status');
    const measure = document.createElement('canvas').getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    let hostTheme = options.hostTheme, themePreference = 'auto';
    try { const saved = window.localStorage.getItem('graph-viewer.theme'); if (['auto', 'light', 'dark'].includes(saved)) themePreference = saved; } catch {}
    let graph, layout, nodeMap, viewMap, viewport, graphSignature, colors;
    let layoutType = 'layered', direction = compact ? 'vertical' : 'horizontal';
    let selectedNodeId = null, camera = null, query = '';
    let hovered = null, focused = null, drag = null;
    let tooltipAnchor = null, tooltipHovered = false, showTimer = 0, hideTimer = 0;
    let frame = 0, target = null, interacting = false, destroyed = false;
    let nodeElements = [], miniNodes = [], connections = [], miniConnections = [];
    let groupElements = [], miniGroups = [];
    let flowSegments = [], activeFlow = [];
    let flow, surfaceWidth = 0, surfaceHeight = 0;
    let exporting = false, exportTimer = 0;

    function applyTheme() {
      const automatic = ['light', 'dark'].includes(hostTheme) ? hostTheme : colorScheme.matches ? 'dark' : 'light';
      const theme = themePreference === 'auto' ? automatic : themePreference;
      host.dataset.theme = theme;
      themeSelect.value = themePreference;
      options.onThemeChange?.(theme);
    }
    function setHostTheme(theme) { hostTheme = theme; applyTheme(); }
    themeSelect.addEventListener('change', () => {
      themePreference = themeSelect.value;
      try { window.localStorage.setItem('graph-viewer.theme', themePreference); } catch {}
      applyTheme();
    });

    function marker(markerId, size) {
      const node = element(document, 'marker', {id: markerId, viewBox: '0 0 12 12', refX: 10, refY: 6, markerWidth: size, markerHeight: size, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse'});
      node.append(element(document, 'path', {d: 'M2 2 L10 6 L2 10', fill: 'none', stroke: 'context-stroke', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
      return node;
    }
    const definitions = svg.querySelector('defs');
    definitions.append(marker(`${id}-arrow`, 10));
    palette.forEach((color, index) => {
      const gradient = element(document, 'linearGradient', {id: `${id}-card-${index}`, x1: '0%', y1: '0%', x2: '100%', y2: '100%'});
      gradient.append(
        element(document, 'stop', {offset: '0%', 'stop-color': `color-mix(in srgb,${color} var(--card-tint),var(--node-surface))`}),
        element(document, 'stop', {offset: '55%', 'stop-color': 'var(--node-surface)'}),
        element(document, 'stop', {offset: '100%', 'stop-color': 'color-mix(in srgb,var(--canvas) 35%,var(--node-surface))'}),
      );
      definitions.append(gradient);
    });

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
        if (focused) showTooltip();
      }
    }
    function stopAnimation() {
      window.cancelAnimationFrame(frame);
      frame = 0;
      target = null;
    }
    function transform() {
      if (!camera) return;
      const width = surfaceWidth, height = surfaceHeight;
      const tx = width / 2 - camera.x * camera.zoom;
      const ty = height / 2 - camera.y * camera.zoom;
      world.classList.toggle('overview', camera.zoom < .2);
      world.setAttribute('transform', `translate(${tx} ${ty}) scale(${camera.zoom})`);
      shadow.querySelector('.zoom').textContent = `${Math.round(camera.zoom * 100)}%`;
      if (viewport) {
        const left = Math.max(0, Math.min(layout.width, -tx / camera.zoom));
        const top = Math.max(0, Math.min(layout.height, -ty / camera.zoom));
        const right = Math.max(left, Math.min(layout.width, (width - tx) / camera.zoom));
        const bottom = Math.max(top, Math.min(layout.height, (height - ty) / camera.zoom));
        for (const [key, value] of Object.entries({x: left, y: top, width: right - left, height: bottom - top})) viewport.setAttribute(key, value);
      }
      updateFlow();
      positionTooltip();
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
    function fit(local = false, initial = false) {
      surfaceWidth = svg.clientWidth; surfaceHeight = svg.clientHeight;
      if (!surfaceWidth || !surfaceHeight) return;
      const fitted = Math.max(.001, Math.min((surfaceWidth - 30) / layout.width, (surfaceHeight - 35) / layout.height));
      const zoom = initial ? Math.max(.75, fitted) : fitted;
      const first = viewMap.get(selectedNodeId) || layout.nodes[0];
      const center = (size, screen, start) => size <= screen / zoom ? size / 2 : Math.max(screen / (2 * zoom), Math.min(size - screen / (2 * zoom), start));
      const x = initial && first ? center(layout.width, surfaceWidth, first.x + layout.cardWidth / 2) : layout.width / 2;
      const y = initial && first ? center(layout.height, surfaceHeight, first.y + layout.cardHeight / 2) : layout.height / 2;
      moveTo({x, y, zoom}, local ? 440 : 0, local);
    }
    function zoom(factor, x = surfaceWidth / 2, y = surfaceHeight / 2, duration = 300) {
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
        let low = 0, high = 1;
        const fits = count => measure.measureText(rest.slice(0, count).join('')).width <= width;
        while (high < rest.length && fits(high)) {low = high; high = Math.min(rest.length, high * 2);}
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (fits(middle)) low = middle; else high = middle - 1;
        }
        let count = low;
        if (count === rest.length) {lines.push(rest.join('')); break;}
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
      node.append(label);
      return parts.length;
    }
    function hideTooltip() {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      tooltipAnchor?.removeAttribute('aria-describedby');
      tooltipAnchor = null;
      tooltipHovered = false;
      tooltip.hidden = true;
    }
    function positionTooltip() {
      if (tooltip.hidden || !tooltipAnchor || !camera) return;
      const bounds = canvas.getBoundingClientRect();
      const anchor = tooltipAnchor.querySelector('rect').getBoundingClientRect();
      if (anchor.right <= bounds.left || anchor.left >= bounds.right || anchor.bottom <= bounds.top || anchor.top >= bounds.bottom) { hideTooltip(); return; }
      const margin = 12, gap = 14;
      const scrollTop = tooltipScroll.scrollTop;
      const maxHeight = Math.max(0, Math.min(420, bounds.height - margin * 2));
      tooltip.style.maxHeight = `${maxHeight}px`;
      const width = tooltip.offsetWidth;
      let height = tooltip.offsetHeight;
      const centerX = (anchor.left + anchor.right) / 2 - bounds.left;
      const centerY = (anchor.top + anchor.bottom) / 2 - bounds.top;
      let x, y, side;
      if (anchor.right - bounds.left + gap + width <= bounds.width - margin) {
        side = 'right'; x = anchor.right - bounds.left + gap; y = centerY - height / 2;
      } else if (anchor.left - bounds.left - gap - width >= margin) {
        side = 'left'; x = anchor.left - bounds.left - gap - width; y = centerY - height / 2;
      } else {
        x = centerX - width / 2;
        const above = anchor.top - bounds.top - gap - margin;
        const below = bounds.bottom - anchor.bottom - gap - margin;
        side = below >= height || below >= above ? 'bottom' : 'top';
        tooltip.style.maxHeight = `${Math.min(maxHeight, Math.max(140, side === 'bottom' ? below : above))}px`;
        height = tooltip.offsetHeight;
        y = side === 'bottom' ? anchor.bottom - bounds.top + gap : anchor.top - bounds.top - gap - height;
      }
      x = Math.max(margin, Math.min(x, bounds.width - width - margin));
      y = Math.max(margin, Math.min(y, bounds.height - height - margin));
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
      tooltip.dataset.side = side;
      const along = side === 'left' || side === 'right' ? centerY - y : centerX - x;
      tooltip.style.setProperty('--tip', `${Math.max(16, Math.min(along, (side === 'left' || side === 'right' ? height : width) - 20))}px`);
      tooltipScroll.scrollTop = scrollTop;
    }
    function showTooltip() {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      const node = nodeMap.get(hovered || focused);
      if (!node || destroyed || drag) return;
      if (tooltipAnchor?.dataset.id !== node.id) {
        tooltipAnchor?.removeAttribute('aria-describedby');
        tooltipAnchor = nodeElements.find(item => item.dataset.id === node.id);
        tooltipAnchor.setAttribute('aria-describedby', tooltip.id);
        tooltip.style.setProperty('--accent', colors.get(node.type));
        tooltipScroll.replaceChildren();
        const text = (tag, className, value) => { const item = document.createElement(tag); item.className = className; item.textContent = value; return item; };
        const meta = document.createElement('div');
        meta.className = 'tooltip-meta';
        meta.append(text('span', 'tooltip-type', node.type));
        if (node.status) meta.append(text('span', 'tooltip-status', node.status));
        tooltipScroll.append(meta, text('h3', 'tooltip-title', node.label));
        if (node.details) tooltipScroll.append(text('div', 'tooltip-body', node.details));
        if (node.sources?.length) {
          const sources = document.createElement('div');
          sources.className = 'tooltip-sources';
          for (const source of node.sources) {
            const line = document.createElement('div');
            line.append(text('span', 'tooltip-source-label', source.label), text('span', 'tooltip-source-url', source.href));
            sources.append(line);
          }
          tooltipScroll.append(sources);
        }
        tooltipScroll.scrollTop = 0;
      }
      tooltip.hidden = false;
      positionTooltip();
    }
    function requestTooltip(immediate = false) {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      showTimer = window.setTimeout(showTooltip, immediate || !tooltip.hidden ? 0 : 220);
    }
    function leaveTooltip() {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (tooltipHovered) return;
        if (hovered || focused) showTooltip(); else hideTooltip();
      }, 160);
    }
    function tooltipKeydown(event) {
      if (tooltip.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault(); hovered = focused = null; hideTooltip();
      } else if (shadow.activeElement === tooltipAnchor && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        tooltipScroll.scrollTop += (event.key.endsWith('Down') ? 1 : -1) * (event.key.startsWith('Page') ? tooltipScroll.clientHeight * .8 : 40);
      }
    }
    tooltip.addEventListener('pointerenter', () => { tooltipHovered = true; window.clearTimeout(hideTimer); });
    tooltip.addEventListener('pointerleave', () => { tooltipHovered = false; leaveTooltip(); });
    function updateFlow() {
      if (!camera || !flow) return;
      const halfWidth = surfaceWidth / (2 * camera.zoom) + 16, halfHeight = surfaceHeight / (2 * camera.zoom) + 16;
      const path = camera.zoom < .2 ? '' : activeFlow.filter(segment => segment.right >= camera.x - halfWidth && segment.left <= camera.x + halfWidth && segment.bottom >= camera.y - halfHeight && segment.top <= camera.y + halfHeight).map(segment => segment.d).join(' ');
      if (flow.getAttribute('d') !== path) flow.setAttribute('d', path);
      flow.classList.toggle('related', !!path);
    }
    function updateHighlights() {
      const related = selectedNodeId ? model.connectedPath(graph, selectedNodeId) : {nodes: new Set(), edges: new Set(), groups: new Set()};
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
      for (const group of [...groupElements, ...miniGroups]) group.classList.toggle('related', related.groups.has(group.dataset.id));
      for (const connection of [...connections, ...miniConnections]) {
        const active = related.edges.has(connection.dataset.id);
        connection.classList.toggle('related', active);
        connection.classList.toggle('unrelated', !!selectedNodeId && !active);
        connection.querySelector('.edge')?.classList.toggle('related', active);
      }
      activeFlow = flowSegments.filter(segment => related.edges.has(segment.id));
      updateFlow();
      positionTooltip();
    }
    function choose(nodeId) {
      interaction(true);
      selectedNodeId = nodeId;
      updateHighlights();
      showTooltip();
      emit({type: 'selectNode', nodeId});
      const node = viewMap.get(nodeId);
      moveTo({x: node.x + layout.cardWidth / 2, y: node.y + layout.cardHeight / 2, zoom: Math.max(camera?.zoom || 0, compact ? .9 : 1)}, 360);
    }

    function edgeGeometry(index) {
      const route = layout.edges[index], points = route.points.map(point => [...point]);
      const start = route.points[0], end = route.points.at(-1);
      for (const [i, next, distance] of [[0, 1, 6], [points.length - 1, points.length - 2, 10]]) {
        const length = Math.hypot(points[next][0] - points[i][0], points[next][1] - points[i][1]);
        if (length) points[i] = points[i].map((value, axis) => value + (points[next][axis] - value) * Math.min(distance / length, .5));
      }
      let d = `M${points[0].join(' ')}`;
      if (route.curve) d += ` C${points.slice(1).map(point => point.join(' ')).join(' ')}`;
      else {
        for (let i = 1; i < points.length - 1; i++) {
          const corner = points[i];
          const near = neighbor => {
            const length = Math.hypot(neighbor[0] - corner[0], neighbor[1] - corner[1]);
            return corner.map((value, axis) => value + (neighbor[axis] - value) * (length ? Math.min(10 / length, .5) : 0));
          };
          d += ` L${near(points[i - 1]).join(' ')} Q${corner.join(' ')} ${near(points[i + 1]).join(' ')}`;
        }
        d += ` L${points.at(-1).join(' ')}`;
      }
      return {d, start, end, label: route.label};
    }
    async function exportImage() {
      if (destroyed || !graph.nodes.length && !graph.groups?.length) throw new Error('저장할 그래프가 없습니다.');
      const filename = `graph-${[...graph.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '')].slice(0, 100).join('') || 'graph'}.png`;
      const width = layout.width + 64, height = layout.height + 64;
      const scale = Math.min(2, 16384 / width, 16384 / height, Math.sqrt(32 * 1024 * 1024 / (width * height)));
      const pixelWidth = Math.max(1, Math.floor(width * scale)), pixelHeight = Math.max(1, Math.floor(height * scale));
      const copy = svg.cloneNode(true);
      const source = [svg, ...svg.querySelectorAll('*')], copies = [copy, ...copy.querySelectorAll('*')];
      const properties = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'filter', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'paint-order', 'stop-color', 'stop-opacity'];
      for (let i = 0; i < source.length; i++) {
        const style = window.getComputedStyle(source[i]);
        copies[i].style.cssText = properties.map(property => `${property}:${style.getPropertyValue(property).replace(/url\(["']?[^#)]*#([^"')]+)["']?\)/g, 'url(#$1)')}`).join(';');
      }
      copy.setAttribute('xmlns', SVG);
      copy.setAttribute('width', pixelWidth); copy.setAttribute('height', pixelHeight);
      copy.setAttribute('viewBox', `-32 -32 ${width} ${height}`);
      const scene = copy.querySelector('.world');
      scene.removeAttribute('transform'); scene.classList.remove('overview');
      copy.querySelectorAll('.edge-flow').forEach(node => node.remove());
      copy.insertBefore(element(document, 'rect', {x: -32, y: -32, width, height, fill: window.getComputedStyle(host).getPropertyValue('--canvas').trim()}), scene);
      const data = new window.Blob([new window.XMLSerializer().serializeToString(copy)], {type: 'image/svg+xml;charset=utf-8'});
      const url = window.URL.createObjectURL(data);
      const image = new window.Image();
      const bitmap = document.createElement('canvas');
      try {
        await new Promise((resolve, reject) => {image.onload = resolve; image.onerror = () => reject(new Error('그래프 이미지를 만들지 못했습니다.')); image.src = url;});
        bitmap.width = pixelWidth; bitmap.height = pixelHeight;
        const context = bitmap.getContext('2d');
        if (!context) throw new Error('이 환경에서 이미지 저장을 지원하지 않습니다.');
        context.drawImage(image, 0, 0);
        const blob = await new Promise(resolve => bitmap.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('그래프가 커서 PNG를 만들지 못했습니다.');
        return {blob, filename};
      } finally {
        image.onload = image.onerror = null; image.src = '';
        bitmap.width = bitmap.height = 0;
        window.URL.revokeObjectURL(url);
      }
    }
    async function saveImage() {
      if (exporting || destroyed) return;
      exporting = true; exportButton.disabled = true; exportButton.setAttribute('aria-busy', 'true');
      window.clearTimeout(exportTimer); exportStatus.hidden = false; exportStatus.textContent = 'PNG 이미지 생성 중...';
      try {
        const result = await exportImage();
        if (destroyed) return;
        if (options.onExport) await options.onExport(result);
        else {
          const url = window.URL.createObjectURL(result.blob), link = document.createElement('a');
          try {link.href = url; link.download = result.filename; link.click();}
          finally {window.URL.revokeObjectURL(url);}
        }
        if (destroyed) return;
        exportStatus.textContent = 'PNG 저장을 요청했습니다.';
        exportTimer = window.setTimeout(() => {exportStatus.hidden = true;}, 4000);
      } catch (error) {
        if (!destroyed) exportStatus.textContent = `이미지를 저장하지 못했습니다. ${error.message}`;
      } finally {
        exporting = false;
        if (!destroyed) {exportButton.disabled = !graph.nodes.length && !graph.groups?.length; exportButton.removeAttribute('aria-busy');}
      }
    }
    exportButton.addEventListener('click', saveImage);
    function renderGraph(fitAll = false) {
      layout = model.layoutGraph(graph, compact, {layout: layoutType, direction});
      nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
      viewMap = new Map(layout.nodes.map(node => [node.id, node]));
      svg.setAttribute('aria-label', graph.title);
      shadow.querySelector('.empty').hidden = graph.nodes.length !== 0 || layout.groups.length !== 0;
      exportButton.disabled = exporting || !graph.nodes.length && !layout.groups.length;
      const legend = shadow.querySelector('.legend');
      legend.replaceChildren();
      colors = new Map();
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
      connections = []; miniConnections = []; nodeElements = []; miniNodes = []; flowSegments = []; activeFlow = [];
      groupElements = []; miniGroups = [];
      for (const data of layout.groups) {
        const group = element(document, 'g', {class: 'group-box', 'data-id': data.id, role: 'group', 'aria-label': data.label});
        group.append(element(document, 'rect', {class: 'group-border', x: data.x, y: data.y, width: data.width, height: data.height, rx: 14}));
        const label = element(document, 'text', {class: 'group-title', x: data.x + 16, y: data.y + 24});
        fitText(data.label, data.width - 32, '600 13px system-ui, sans-serif', 2).forEach((text, i) => label.append(element(document, 'tspan', {x: data.x + 16, dy: i ? 17 : 0}, text)));
        group.append(label); world.append(group); groupElements.push(group);
        const mini = element(document, 'rect', {class: 'mini-group', 'data-id': data.id, x: data.x, y: data.y, width: data.width, height: data.height, rx: 14});
        minimap.append(mini); miniGroups.push(mini);
      }
      graph.edges.forEach((edge, index) => {
        const geometry = edgeGeometry(index);
        const points = layout.edges[index].points;
        flowSegments.push({id: edge.id, d: geometry.d, left: Math.min(...points.map(point => point[0])), right: Math.max(...points.map(point => point[0])), top: Math.min(...points.map(point => point[1])), bottom: Math.max(...points.map(point => point[1]))});
        const connection = element(document, 'g', {class: 'connection', 'data-id': edge.id, 'data-from': edge.source, 'data-to': edge.target});
        const arrows = markerId => edge.direction === 'none' ? {} : {'marker-end': `url(#${markerId})`, ...(edge.direction === 'both' ? {'marker-start': `url(#${markerId})`} : {})};
        connection.append(element(document, 'path', {class: 'edge', d: geometry.d, fill: 'none', stroke: 'var(--edge)', 'stroke-width': 1.5, ...arrows(`${id}-arrow`)}));
        for (const point of [geometry.start, geometry.end]) connection.append(element(document, 'circle', {class: 'port', cx: point[0], cy: point[1], r: 3}));
        if (edge.label || edge.type) {
          const label = element(document, 'text', {class: 'edge-label', x: geometry.label[0], y: geometry.label[1]}, fitText(edge.label || edge.type, 120, '400 10px system-ui, sans-serif', 1)[0] || '');
          label.append(element(document, 'title', {}, edge.label || edge.type));
          connection.append(label);
        }
        world.append(connection); connections.push(connection);
        const mini = element(document, 'g', {class: 'mini-connection', 'data-id': edge.id, 'data-from': edge.source, 'data-to': edge.target});
        mini.append(element(document, 'path', {class: 'mini-edge', d: geometry.d, ...arrows(`${id}-mini-arrow`)}));
        minimap.append(mini); miniConnections.push(mini);
      });
      flow = element(document, 'path', {class: 'edge-flow'});
      world.append(flow);
      for (const data of layout.nodes) {
        const color = colors.get(data.type), w = layout.cardWidth, h = layout.cardHeight;
        const node = element(document, 'g', {class: 'node', 'data-id': data.id, role: 'button', tabindex: 0, 'aria-label': `${data.type}: ${data.label}`, transform: `translate(${data.x} ${data.y})`});
        node.append(element(document, 'rect', {width: w, height: h, rx: 12, fill: `url(#${id}-card-${palette.indexOf(color)})`, stroke: 'var(--node-border)', 'stroke-width': 1.5}), element(document, 'rect', {x: 14, y: 16, width: 8, height: 8, rx: 2, fill: color}));
        cardText(node, 'node-type', data.type, 30, 24, 12, color, 1, 600);
        const titleLines = cardText(node, 'node-title', data.label, 14, compact ? 45 : 55, compact ? 16 : 15, 'var(--text)', 2, 600);
        cardText(node, 'node-body', data.details || '', 14, compact ? (titleLines > 1 ? 83 : 66) : (titleLines > 1 ? 97 : 80), compact ? 11 : 12, 'var(--muted)', compact || titleLines > 1 ? 1 : 2);
        if (data.status) cardText(node, 'node-status', data.status, 14, h - 14, 11, color, 1);
        node.addEventListener('click', () => choose(data.id));
        node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focused = data.id; choose(data.id); } });
        node.addEventListener('pointerenter', () => { hovered = data.id; requestTooltip(); });
        node.addEventListener('pointerleave', () => { hovered = null; leaveTooltip(); });
        node.addEventListener('focus', () => { if (node.matches(':focus-visible')) { focused = data.id; hovered = null; requestTooltip(true); } });
        node.addEventListener('blur', () => { focused = null; leaveTooltip(); });
        world.append(node); nodeElements.push(node);
        const mini = element(document, 'rect', {class: 'mini-node', 'data-id': data.id, x: data.x, y: data.y, width: w, height: h, rx: 12, fill: color});
        minimap.append(mini); miniNodes.push(mini);
      }
      viewport = element(document, 'rect', {class: 'viewport', rx: 5});
      viewport.append(element(document, 'title', {}, '현재 화면에 보이는 영역'));
      minimap.append(viewport);
      updateHighlights();
      if (camera && !fitAll) transform(); else fit(false, !fitAll);
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
      const previousSelected = selectedNodeId, previousQuery = query;
      const previousLayout = layoutType, previousDirection = direction;
      const changedId = graph?.graphId !== next.graphId;
      if (changedId) { selectedNodeId = null; camera = null; query = ''; layoutType = 'layered'; direction = compact ? 'vertical' : 'horizontal'; }
      if (state) {
        if (model.layoutModes.includes(state.layout)) layoutType = state.layout;
        if (model.layoutDirections.includes(state.direction)) direction = state.direction;
      }
      const changedLayout = previousLayout !== layoutType || previousDirection !== direction;
      if (changedGraph || changedLayout) {
        stopAnimation();
        hideTooltip();
        drag = null;
        interaction(false);
      }
      if (changedLayout) camera = null;
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
      clearSearch.hidden = !query;
      layoutSelect.value = layoutType; directionSelect.value = direction;
      directionSelect.disabled = layoutType === 'radial' || layoutType === 'network';
      directionSelect.title = directionSelect.disabled ? '계층형과 트리형에서 방향을 선택합니다.' : '';
      if (changedGraph || changedLayout) {
        hovered = null; focused = null;
        graphSignature = signature;
        renderGraph();
      } else {
        if (previousSelected !== selectedNodeId || previousQuery !== query) updateHighlights();
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
      hovered = focused = null; hideTooltip();
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
    svg.addEventListener('dblclick', event => {
      if (event.button !== 0 || !camera) return;
      event.preventDefault();
      if (drag) endDrag();
      const bounds = svg.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width - .5) * svg.clientWidth;
      const y = ((event.clientY - bounds.top) / bounds.height - .5) * svg.clientHeight;
      hovered = focused = null; hideTooltip();
      moveTo({x: camera.x + x / camera.zoom, y: camera.y + y / camera.zoom, zoom: camera.zoom}, 300);
    });
    svg.addEventListener('wheel', event => {
      event.preventDefault();
      if (drag) endDrag();
      const bounds = svg.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * .001), event.clientX - bounds.left, event.clientY - bounds.top, 180);
    }, {passive: false});
    shadow.querySelector('[aria-label="확대"]').addEventListener('click', () => zoom(1.25));
    shadow.querySelector('[aria-label="축소"]').addEventListener('click', () => zoom(.8));
    shadow.querySelector('[aria-label="전체 맞춤"]').addEventListener('click', () => fit(true));
    shadow.querySelector('.zoom').addEventListener('click', () => { if (camera) zoom(1 / (target || camera).zoom); });
    function changeLayout() {
      stopAnimation(); hideTooltip(); hovered = focused = null; drag = null;
      interaction(true);
      layoutType = layoutSelect.value; direction = directionSelect.value;
      directionSelect.disabled = layoutType === 'radial' || layoutType === 'network';
      directionSelect.title = directionSelect.disabled ? '계층형과 트리형에서 방향을 선택합니다.' : '';
      camera = null;
      renderGraph(true);
      emit({type: 'setLayout', layout: layoutType, direction, ...(camera ? {camera: cameraCopy()} : {})});
      interaction(false);
    }
    layoutSelect.addEventListener('change', changeLayout);
    directionSelect.addEventListener('change', changeLayout);
    function updateQuery() {
      query = search.value;
      clearSearch.hidden = !query;
      updateHighlights();
      emit({type: 'setQuery', query});
    }
    search.addEventListener('input', updateQuery);
    clearSearch.addEventListener('click', () => { search.value = ''; updateQuery(); search.focus(); });
    function visibilityChanged() {
      shell.classList.toggle('motion-off', document.hidden);
      if (document.hidden) { hovered = focused = null; hideTooltip(); }
      if (document.hidden && target) moveTo(target, 0);
    }
    function motionChanged() { if (reduced.matches && target) moveTo(target, 0); }
    shell.classList.toggle('motion-off', document.hidden);
    applyTheme();
    container.append(host);
    surfaceWidth = svg.clientWidth; surfaceHeight = svg.clientHeight;
    try { update(options.graph, options.state); }
    catch (error) { host.remove(); throw error; }
    document.addEventListener('visibilitychange', visibilityChanged);
    document.addEventListener('keydown', tooltipKeydown);
    reduced.addEventListener('change', motionChanged);
    colorScheme.addEventListener('change', applyTheme);
    const resize = new window.ResizeObserver(([entry]) => {
      surfaceWidth = entry.contentRect.width; surfaceHeight = entry.contentRect.height;
      if (camera) transform(); else fit(false, true);
    });
    resize.observe(svg);
    return {
      update,
      setHostTheme,
      exportImage,
      getState() { return {selectedNodeId, camera: cameraCopy(), query, layout: layoutType, direction}; },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopAnimation();
        window.clearTimeout(exportTimer);
        hideTooltip();
        resize.disconnect();
        document.removeEventListener('visibilitychange', visibilityChanged);
        document.removeEventListener('keydown', tooltipKeydown);
        reduced.removeEventListener('change', motionChanged);
        colorScheme.removeEventListener('change', applyTheme);
        interaction(false);
        world.replaceChildren();
        minimap.replaceChildren();
        tooltipScroll.replaceChildren();
        nodeElements = miniNodes = connections = miniConnections = [];
        groupElements = miniGroups = [];
        flowSegments = activeFlow = [];
        graph = layout = nodeMap = viewMap = colors = flow = null;
        options = {};
        host.remove();
      }
    };
  }
  root.GraphPanel = {mount};
})(globalThis);
