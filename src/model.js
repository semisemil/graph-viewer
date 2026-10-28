(function (root) {
  'use strict';
  const limits = Object.freeze({bytes: 1024 * 1024, nodes: 500, edges: 2000});

  function requireValue(condition, message) {
    if (!condition) throw new Error(message);
  }

  function string(value, name, max = 200, empty = false) {
    requireValue(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0), `${name}: 문자열 길이를 확인하세요 (최대 ${max}).`);
  }

  function validateGraph(graph) {
    requireValue(graph && typeof graph === 'object' && !Array.isArray(graph), '그래프는 JSON 객체여야 합니다.');
    requireValue(graph.schemaVersion === 1, 'schemaVersion은 1이어야 합니다.');
    string(graph.graphId, 'graphId');
    string(graph.title, 'title', 2000);
    if (graph.kind !== undefined) string(graph.kind, 'kind');
    requireValue(Array.isArray(graph.nodes) && graph.nodes.length <= limits.nodes, `nodes는 최대 ${limits.nodes}개입니다.`);
    requireValue(Array.isArray(graph.edges) && graph.edges.length <= limits.edges, `edges는 최대 ${limits.edges}개입니다.`);
    const nodeIds = new Set(), edgeIds = new Set();
    for (const node of graph.nodes) {
      requireValue(node && typeof node === 'object', '노드 형식을 확인하세요.');
      string(node.id, 'node.id');
      string(node.type, 'node.type');
      string(node.label, 'node.label', 2000);
      requireValue(!nodeIds.has(node.id), `중복 노드 ID: ${node.id}`);
      nodeIds.add(node.id);
      if (node.details !== undefined) string(node.details, 'node.details', 30000, true);
      if (node.status !== undefined) string(node.status, 'node.status', 500, true);
      if (node.sources !== undefined) {
        requireValue(Array.isArray(node.sources) && node.sources.length <= 30, 'sources는 최대 30개입니다.');
        for (const source of node.sources) {
          requireValue(source && typeof source === 'object', '출처 형식을 확인하세요.');
          string(source.label, 'source.label', 2000);
          string(source.href, 'source.href', 4000);
        }
      }
    }
    for (const edge of graph.edges) {
      requireValue(edge && typeof edge === 'object', '연결 형식을 확인하세요.');
      string(edge.id, 'edge.id');
      string(edge.source, 'edge.source');
      string(edge.target, 'edge.target');
      requireValue(!edgeIds.has(edge.id), `중복 연결 ID: ${edge.id}`);
      requireValue(nodeIds.has(edge.source) && nodeIds.has(edge.target), `연결의 노드가 없습니다: ${edge.id}`);
      edgeIds.add(edge.id);
      if (edge.type !== undefined) string(edge.type, 'edge.type');
      if (edge.label !== undefined) string(edge.label, 'edge.label', 2000, true);
      if (edge.direction !== undefined) requireValue(['forward', 'both', 'none'].includes(edge.direction), 'edge.direction은 forward, both 또는 none이어야 합니다.');
    }
    const json = JSON.stringify(graph);
    requireValue(new TextEncoder().encode(json).length <= limits.bytes, '그래프 JSON은 최대 1 MiB입니다.');
    return JSON.parse(json);
  }

  function connectedPath(graph, selected) {
    if (!graph.nodes.some(n => n.id === selected)) return {nodes: new Set(), edges: new Set()};
    const forward = new Map(graph.nodes.map(node => [node.id, []]));
    const backward = new Map(graph.nodes.map(node => [node.id, []]));
    for (const edge of graph.edges) {
      forward.get(edge.source).push(edge.target);
      backward.get(edge.target).push(edge.source);
      if (edge.direction === 'both' || edge.direction === 'none') {
        forward.get(edge.target).push(edge.source);
        backward.get(edge.source).push(edge.target);
      }
    }
    function visit(adjacent) {
      const seen = new Set([selected]), pending = [selected];
      while (pending.length) {
        const id = pending.pop();
        for (const next of adjacent.get(id)) if (!seen.has(next)) {seen.add(next); pending.push(next);}
      }
      return seen;
    }
    const before = visit(backward), after = visit(forward);
    return {
      nodes: new Set([...before, ...after]),
      edges: new Set(graph.edges.filter(e => before.has(e.source) && before.has(e.target) || after.has(e.source) && after.has(e.target)).map(e => e.id)),
    };
  }

  function layoutGraph(graph, compact = false) {
    const outgoing = new Map(graph.nodes.map(n => [n.id, []]));
    for (const edge of graph.edges) outgoing.get(edge.source).push(edge.target);
    const indices = new Map(), low = new Map(), stack = [], onStack = new Set(), components = [], componentOf = new Map();
    let index = 0;
    function visit(id) {
      indices.set(id, index); low.set(id, index++); stack.push(id); onStack.add(id);
      for (const next of outgoing.get(id)) {
        if (!indices.has(next)) {visit(next); low.set(id, Math.min(low.get(id), low.get(next)));}
        else if (onStack.has(next)) low.set(id, Math.min(low.get(id), indices.get(next)));
      }
      if (low.get(id) !== indices.get(id)) return;
      const group = [];
      let next;
      do {next = stack.pop(); onStack.delete(next); componentOf.set(next, components.length); group.push(next);} while (next !== id);
      components.push(group);
    }
    for (const node of graph.nodes) if (!indices.has(node.id)) visit(node.id);
    const children = components.map(() => new Set()), indegree = components.map(() => 0), ranks = components.map(() => 0);
    for (const edge of graph.edges) {
      const from = componentOf.get(edge.source), to = componentOf.get(edge.target);
      if (from !== to && !children[from].has(to)) {children[from].add(to); indegree[to]++;}
    }
    const pending = indegree.flatMap((count, i) => count === 0 ? [i] : []);
    while (pending.length) {
      const from = pending.shift();
      for (const to of children[from]) {
        ranks[to] = Math.max(ranks[to], ranks[from] + 1);
        if (--indegree[to] === 0) pending.push(to);
      }
    }
    const layers = [];
    for (const node of graph.nodes) {
      const rank = ranks[componentOf.get(node.id)];
      (layers[rank] ||= []).push(node);
    }
    const cardWidth = compact ? 180 : 225, cardHeight = compact ? 112 : 136;
    const margin = 50, crossGap = compact ? 20 : 45, mainGap = compact ? 68 : 85;
    const maxCount = Math.max(1, ...layers.map(layer => layer.length));
    const crossSize = maxCount * (compact ? cardWidth : cardHeight) + (maxCount - 1) * crossGap;
    const nodes = layers.flatMap((layer, rank) => {
      const size = layer.length * (compact ? cardWidth : cardHeight) + (layer.length - 1) * crossGap;
      return layer.map((node, i) => {
        const cross = margin + (crossSize - size) / 2 + i * ((compact ? cardWidth : cardHeight) + crossGap);
        const main = margin + rank * ((compact ? cardHeight : cardWidth) + mainGap);
        return {...node, x: compact ? cross : main, y: compact ? main : cross};
      });
    });
    const positions = new Map(nodes.map(node => [node.id, {
      main: compact ? node.y : node.x, cross: compact ? node.x : node.y,
      rank: ranks[componentOf.get(node.id)],
    }]));
    const mainSize = compact ? cardHeight : cardWidth, crossCard = compact ? cardWidth : cardHeight;
    const ports = new Map(), lanes = {before: [], after: []}, gaps = new Map();
    const routes = graph.edges.map(edge => {
      const from = positions.get(edge.source), to = positions.get(edge.target);
      const same = to.rank === from.rank;
      const route = {from, to, same, long: to.rank > from.rank + 1};
      for (const [name, node, other, side] of [
        ['start', from, to, 1], ['end', to, from, same ? 1 : 0],
      ]) {
        const key = `${name === 'start' ? edge.source : edge.target}:${side}`;
        if (!ports.has(key)) ports.set(key, []);
        ports.get(key).push({route, name, node, other, side});
      }
      return route;
    });
    for (const entries of ports.values()) {
      entries.sort((a, b) => a.other.cross - b.other.cross || a.other.rank - b.other.rank);
      entries.forEach(({route, name, node, side}, i) => {
        route[name] = [node.main + side * mainSize, node.cross + crossCard * (.2 + .6 * (i + 1) / (entries.length + 1))];
      });
    }
    const crossEnd = margin + crossSize;
    for (const route of routes.filter(route => route.long).sort((a, b) => a.from.rank - b.from.rank || a.to.rank - b.to.rank)) {
      const lo = route.from.rank, hi = route.to.rank;
      const side = route.start[1] + route.end[1] <= margin + crossEnd ? 'before' : 'after';
      const occupied = lanes[side];
      let track = occupied.findIndex(end => end < lo);
      if (track < 0) track = occupied.length;
      occupied[track] = hi - 1;
      route.outer = side === 'before' ? margin - 30 - track * 22 : crossEnd + 30 + track * 22;
    }
    for (const route of routes) {
      const entries = route.same ? [['turn', route.from.rank]] : route.long ? [
        ['exit', route.from.rank], ['entry', route.to.rank - 1],
      ] : [];
      for (const [name, gap] of entries) {
        if (!gaps.has(gap)) gaps.set(gap, []);
        gaps.get(gap).push({route, name});
      }
    }
    for (const [gap, entries] of gaps) {
      entries.sort((a, b) => (a.route.outer ?? a.route.start[1]) - (b.route.outer ?? b.route.start[1]));
      entries.forEach(({route, name}, i) => {
        route[name] = margin + gap * (mainSize + mainGap) + mainSize + 12 + (mainGap - 24) * (i + 1) / (entries.length + 1);
      });
    }
    const point = ([main, cross]) => compact ? [cross, main] : [main, cross];
    const edges = routes.map(route => {
      const {start, end} = route;
      let points, label;
      if (route.same) {
        points = [start, [route.turn, start[1]], [route.turn, end[1]], end];
        label = [route.turn + 12, (start[1] + end[1]) / 2 - 8];
      } else if (route.long) {
        points = [start, [route.exit, start[1]], [route.exit, route.outer], [route.entry, route.outer], [route.entry, end[1]], end];
        label = [(route.exit + route.entry) / 2, route.outer - 8];
      } else {
        const middle = (start[0] + end[0]) / 2;
        points = [start, [middle, start[1]], [middle, end[1]], end];
        label = [middle, (start[1] + end[1]) / 2 - 12];
      }
      return {points: points.map(point), label: point(label), curve: !route.same && !route.long};
    });
    let left = 0, top = 0, right = cardWidth + margin, bottom = cardHeight + margin;
    for (const node of nodes) {right = Math.max(right, node.x + cardWidth); bottom = Math.max(bottom, node.y + cardHeight);}
    edges.forEach((edge, i) => {
      for (const [x, y] of edge.points) {left = Math.min(left, x - margin); top = Math.min(top, y - margin); right = Math.max(right, x); bottom = Math.max(bottom, y);}
      if (graph.edges[i].label || graph.edges[i].type) {
        left = Math.min(left, edge.label[0] - 60 - margin); top = Math.min(top, edge.label[1] - 12 - margin);
        right = Math.max(right, edge.label[0] + 60); bottom = Math.max(bottom, edge.label[1]);
      }
    });
    for (const node of nodes) {node.x -= left; node.y -= top;}
    for (const edge of edges) {
      edge.points = edge.points.map(([x, y]) => [x - left, y - top]);
      edge.label = [edge.label[0] - left, edge.label[1] - top];
    }
    return {nodes, edges, cardWidth, cardHeight, width: right - left + margin, height: bottom - top + margin};
  }

  const api = Object.freeze({limits, validateGraph, connectedPath, layoutGraph});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GraphModel = api;
})(globalThis);
