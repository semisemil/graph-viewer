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
      :host{--text:#eef0f0;--muted:#aeb9c2;--surface:#1c1e20;--canvas:#141618;--grid:#363b3f;--control:#282c2f;--control-border:#4a5054;--control-hover:#363e43;--line:#36393c;--focus:#7fb5ff;--node-surface:#22272b;--card-tint:6%;--node-border:#4b535a;--selected:#c2e2ff;--related:#78b4dc;--edge:#55697d;--edge-active:#7faed4;--flow:#d4ecff;--tooltip-top:#2b3237;--tooltip-shadow:#0009;--scrollbar:#58636c;--source:#d8e3ec;--url:#94a7b7;--type-0:#43cba0;--type-1:#eab75b;--type-2:#6ba9ff;--type-3:#bb93ef;--type-4:#ee96ad;--type-5:#83cbd1;--type-6:#d5bd83;color:var(--text);font:13px system-ui,sans-serif;color-scheme:dark}
      :host([data-theme="light"]){--text:#20303e;--muted:#526577;--surface:#fff;--canvas:#f2f5f8;--grid:#c8d2dc;--control:#fff;--control-border:#c4cfd9;--control-hover:#eaf0f6;--line:#dce3ea;--focus:#2563eb;--node-surface:#fff;--card-tint:4%;--node-border:#aebfce;--selected:#2563eb;--related:#5585b7;--edge:#7e94a9;--edge-active:#386eac;--flow:#175bd2;--tooltip-top:#f8fbff;--tooltip-shadow:#20375024;--scrollbar:#a6b6c5;--source:#354f69;--url:#536d86;--type-0:#087f62;--type-1:#946200;--type-2:#245fbe;--type-3:#7850aa;--type-4:#aa4262;--type-5:#176f7a;--type-6:#7a601e;color-scheme:light}*{box-sizing:border-box}
      .shell{height:100%;display:flex;flex-direction:column;background:var(--surface);overflow:hidden}
      header{padding:10px 12px;border-bottom:1px solid var(--line)}.header-controls{display:flex;align-items:center;gap:10px;width:100%}
      button,input,select{font:inherit;color:inherit}.icon{width:16px;height:16px;flex:none;pointer-events:none}
      button{display:inline-flex;align-items:center;justify-content:center;height:32px;min-width:32px;padding:6px;background:transparent;border:1px solid transparent;border-radius:8px;cursor:pointer;transition:background 140ms ease,color 140ms ease,border-color 140ms ease}
      button[hidden]{display:none}button:hover{background:var(--control-hover)}button:active{background:color-mix(in srgb,var(--focus) 15%,var(--control))}button:focus-visible,select:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
      .search-field{position:relative;display:flex;align-items:center;flex:1;min-width:0;max-width:280px;height:36px;border:1px solid var(--control-border);border-radius:9px;background:var(--control);transition:border-color 140ms ease,box-shadow 140ms ease}
      .search-field:focus-within{border-color:var(--focus);box-shadow:0 0 0 3px color-mix(in srgb,var(--focus) 14%,transparent)}.search-field>.icon{margin-left:10px;color:var(--muted)}
      input{width:100%;min-width:0;height:100%;padding:0 34px 0 8px;background:transparent;border:0;outline:none}input::placeholder{color:var(--muted)}
      .search-clear{position:absolute;right:4px;top:4px;width:26px;min-width:26px;height:26px;padding:4px;border-radius:6px;color:var(--muted)}.search-clear:hover{color:var(--text)}
      .theme-field{position:relative;flex:none;width:112px;margin-left:auto}.theme-field>.icon{position:absolute;right:9px;top:10px;color:var(--muted)}
      select{appearance:none;width:100%;height:36px;padding:0 30px 0 11px;background:var(--control);border:1px solid var(--control-border);border-radius:9px;cursor:pointer}select:hover{background:var(--control-hover)}
      .legend{display:flex;gap:12px;padding:9px 14px;color:var(--muted);font-size:11px;flex-wrap:wrap;max-height:80px;overflow:auto}
      .legend span{overflow-wrap:anywhere}.legend span::before{content:'';display:inline-block;width:7px;height:7px;margin-right:5px;border-radius:2px;background:var(--c)}
      .canvas{position:relative;flex:1;min-height:80px;background-color:var(--canvas);background-image:radial-gradient(var(--grid) .7px,transparent .7px);background-size:18px 18px}
      svg.graph{width:100%;height:100%;display:block;touch-action:none;cursor:grab}svg.graph:active{cursor:grabbing}.node{cursor:pointer;outline:none}.node:focus-visible>rect:first-child{stroke:var(--focus);stroke-width:3}
      .tools{position:absolute;bottom:12px;left:12px;display:flex;align-items:center;gap:2px;padding:4px;border:1px solid var(--control-border);border-radius:12px;background:color-mix(in srgb,var(--surface) 94%,transparent);box-shadow:0 4px 12px color-mix(in srgb,var(--tooltip-shadow) 45%,transparent)}
      .tools button{width:32px}.zoom{display:flex;align-items:center;justify-content:center;min-width:46px;height:32px;margin-left:4px;padding:0 8px;border-left:1px solid var(--line);color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
      .minimap{position:absolute;right:12px;bottom:12px;width:145px;height:70px;border:1px solid var(--control-border);border-radius:7px;background:var(--node-surface);pointer-events:none}
      .viewport{fill:var(--selected);fill-opacity:.07;stroke:var(--related);stroke-width:1;stroke-dasharray:4 3;vector-effect:non-scaling-stroke}
      .mini-edge{fill:none;stroke:var(--edge);stroke-width:.8;vector-effect:non-scaling-stroke}.mini-connection.related .mini-edge{stroke:var(--edge-active);stroke-width:1.2}
      .mini-node{stroke:var(--node-border);stroke-width:.6;vector-effect:non-scaling-stroke;opacity:.45}.mini-node.connected{stroke:var(--related);stroke-width:1.3;opacity:.9;filter:drop-shadow(0 0 14px color-mix(in srgb,var(--related) 45%,transparent))}
      .mini-node.selected{stroke:var(--selected);stroke-width:2;opacity:1;filter:drop-shadow(0 0 20px color-mix(in srgb,var(--selected) 60%,transparent))}
      .node{transition:opacity 160ms ease}.node>rect:first-child{transition:stroke 180ms ease,stroke-width 180ms ease,filter 180ms ease}
      .node.connected>rect:first-child{stroke:var(--related);stroke-width:2;filter:drop-shadow(0 0 5px color-mix(in srgb,var(--related) 25%,transparent))}.node[aria-pressed="true"]>rect:first-child{stroke:var(--selected);stroke-width:2.6;filter:drop-shadow(0 0 8px color-mix(in srgb,var(--selected) 40%,transparent))}.node.unrelated{opacity:.58}.node.search-miss{opacity:.2}
      .edge{transition:stroke 180ms ease,stroke-width 180ms ease;stroke-linecap:round;stroke-linejoin:round}.edge.related{stroke:var(--edge-active);stroke-width:2}
      .edge-flow{display:none;fill:none;stroke-width:2;stroke-linecap:round;stroke-dasharray:10 42;pointer-events:none}
      .connection.related .edge-flow,.mini-connection.related .edge-flow{display:block;stroke:var(--flow);opacity:.95;filter:drop-shadow(0 0 3px color-mix(in srgb,var(--flow) 55%,transparent));animation:edge-current 1300ms linear infinite}.mini-connection .edge-flow{stroke-width:10}
      .port{fill:var(--node-surface);stroke:var(--edge);stroke-width:1.5}.connection.related .port{stroke:var(--related)}
      .edge-label{fill:var(--muted);font-size:10px;text-anchor:middle;paint-order:stroke;stroke:var(--canvas);stroke-width:5px;stroke-linejoin:round}
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
      @media(prefers-reduced-motion:reduce){.connection.related .edge-flow,.mini-connection.related .edge-flow{display:none;animation:none}.node,.node>rect:first-child,.edge,button,.search-field{transition:none}.node-tooltip{animation:none}}
      @media(max-width:380px){header{padding:8px}.header-controls{gap:6px}.theme-field{width:100px}}
      ${compact ? 'header{padding:8px}.header-controls{gap:6px}.search-field,select{height:32px;font-size:12px}.search-clear{top:2px;right:2px}.theme-field{width:100px}.theme-field>.icon{top:8px}.legend{padding:6px 10px;gap:8px;max-height:56px}.tooltip-scroll{padding:13px 14px}.tooltip-title{font-size:15px}.tools{bottom:7px;left:7px}.tools button{width:28px;height:28px;min-width:28px}.zoom{height:28px;min-width:42px}.minimap{width:60px;height:116px;right:7px;bottom:7px;opacity:.3;pointer-events:all;transition:opacity 160ms ease}.minimap:hover,.minimap:focus-visible{opacity:1}.minimap:focus-visible{outline:2px solid var(--focus);outline-offset:2px}@media(prefers-reduced-motion:reduce){.minimap{transition:none}}' : ''}
    </style><div class="shell"><header><div class="header-controls">
      <div class="search-field">${icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>')}<input aria-label="노드 검색" placeholder="노드 검색"><button class="search-clear" type="button" aria-label="검색어 지우기" title="검색어 지우기" hidden>${icon('<path d="m8 8 8 8m0-8-8 8"/>')}</button></div>
      <div class="theme-field"><select aria-label="화면 테마"><option value="auto">자동 테마</option><option value="light">라이트</option><option value="dark">다크</option></select>${icon('<path d="m8 10 4 4 4-4"/>')}</div>
    </div></header><div class="legend" aria-label="노드 유형"></div><div class="canvas"><svg class="graph" role="group"><defs></defs><g class="world"></g></svg><div class="empty" hidden>표시할 노드가 없습니다.</div>
      <div class="tools" role="toolbar" aria-label="그래프 보기"><button type="button" aria-label="확대" title="확대">${icon('<path d="M12 5v14M5 12h14"/>')}</button><button type="button" aria-label="축소" title="축소">${icon('<path d="M5 12h14"/>')}</button><button type="button" aria-label="전체 맞춤" title="전체 맞춤">${icon('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>')}</button><span class="zoom"></span></div>
      <svg class="minimap" role="img" aria-label="그래프 미니맵" tabindex="0"></svg><div class="node-tooltip" id="${id}-tooltip" role="tooltip" hidden><div class="tooltip-scroll"></div></div></div></div>`;

    const shell = shadow.querySelector('.shell');
    const svg = shadow.querySelector('.graph');
    const world = shadow.querySelector('.world');
    const minimap = shadow.querySelector('.minimap');
    const canvas = shadow.querySelector('.canvas');
    const tooltip = shadow.querySelector('.node-tooltip');
    const tooltipScroll = shadow.querySelector('.tooltip-scroll');
    const search = shadow.querySelector('input');
    const clearSearch = shadow.querySelector('.search-clear');
    const themeSelect = shadow.querySelector('select');
    const measure = document.createElement('canvas').getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    let hostTheme = options.hostTheme, themePreference = 'auto';
    try { const saved = window.localStorage.getItem('graph-viewer.theme'); if (['auto', 'light', 'dark'].includes(saved)) themePreference = saved; } catch {}
    let graph, layout, nodeMap, viewMap, viewport, graphSignature, colors;
    let selectedNodeId = null, camera = null, query = '';
    let hovered = null, focused = null, drag = null;
    let tooltipAnchor = null, tooltipHovered = false, showTimer = 0, hideTimer = 0;
    let frame = 0, target = null, interacting = false, destroyed = false;
    let nodeElements = [], miniNodes = [], connections = [], miniConnections = [];

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
      svg.setAttribute('aria-label', graph.title);
      shadow.querySelector('.empty').hidden = graph.nodes.length !== 0;
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
      connections = []; miniConnections = []; nodeElements = []; miniNodes = [];
      graph.edges.forEach((edge, index) => {
        const geometry = edgeGeometry(edge, index);
        const connection = element(document, 'g', {class: 'connection', 'data-id': edge.id, 'data-from': edge.source, 'data-to': edge.target});
        const arrows = markerId => edge.direction === 'none' ? {} : {'marker-end': `url(#${markerId})`, ...(edge.direction === 'both' ? {'marker-start': `url(#${markerId})`} : {})};
        connection.append(element(document, 'path', {class: 'edge', d: geometry.d, fill: 'none', stroke: 'var(--edge)', 'stroke-width': 1.5, ...arrows(`${id}-arrow`)}), element(document, 'path', {class: 'edge-flow', d: geometry.d}));
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
        node.append(element(document, 'rect', {width: w, height: h, rx: 12, fill: `url(#${id}-card-${palette.indexOf(color)})`, stroke: 'var(--node-border)', 'stroke-width': 1.5}), element(document, 'rect', {x: 14, y: 16, width: 8, height: 8, rx: 2, fill: color}));
        cardText(node, 'node-type', data.type, 30, 24, 12, color, 1, 600);
        const titleLines = cardText(node, 'node-title', data.label, 14, compact ? 45 : 55, compact ? 16 : 15, 'var(--text)', compact ? 2 : 1, 600);
        cardText(node, 'node-body', data.details || '', 14, compact ? (titleLines > 1 ? 83 : 66) : 80, compact ? 11 : 12, 'var(--muted)', compact ? 1 : 2);
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
        hideTooltip();
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
      clearSearch.hidden = !query;
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
    try { update(options.graph, options.state); }
    catch (error) { host.remove(); throw error; }
    document.addEventListener('visibilitychange', visibilityChanged);
    document.addEventListener('keydown', tooltipKeydown);
    reduced.addEventListener('change', motionChanged);
    colorScheme.addEventListener('change', applyTheme);
    const resize = new window.ResizeObserver(() => { if (camera) transform(); else fit(); });
    resize.observe(svg);
    return {
      update,
      setHostTheme,
      getState() { return {selectedNodeId, camera: cameraCopy(), query}; },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopAnimation();
        hideTooltip();
        resize.disconnect();
        document.removeEventListener('visibilitychange', visibilityChanged);
        document.removeEventListener('keydown', tooltipKeydown);
        reduced.removeEventListener('change', motionChanged);
        colorScheme.removeEventListener('change', applyTheme);
        interaction(false);
        host.remove();
      }
    };
  }
  root.GraphPanel = {mount};
})(globalThis);
