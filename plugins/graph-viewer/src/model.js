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
    function visit(backward) {
      const seen = new Set([selected]), pending = [selected];
      while (pending.length) {
        const id = pending.pop();
        for (const edge of graph.edges) {
          const from = backward ? edge.target : edge.source, to = backward ? edge.source : edge.target;
          if (from === id && !seen.has(to)) {seen.add(to); pending.push(to);}
          if ((edge.direction === 'both' || edge.direction === 'none') && to === id && !seen.has(from)) {seen.add(from); pending.push(from);}
        }
      }
      return seen;
    }
    const before = visit(true), after = visit(false);
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
    return {
      nodes, cardWidth, cardHeight,
      width: Math.max(cardWidth + margin * 2, ...nodes.map(n => n.x + cardWidth + margin)),
      height: Math.max(cardHeight + margin * 2, ...nodes.map(n => n.y + cardHeight + margin)),
    };
  }

  const api = Object.freeze({limits, validateGraph, connectedPath, layoutGraph});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GraphModel = api;
})(globalThis);
