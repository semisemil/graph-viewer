(function (root) {
  'use strict';
  const limits = Object.freeze({bytes: 1024 * 1024, nodes: 500, edges: 2000, groups: 500});
  const layoutModes = Object.freeze(['layered', 'tree', 'radial', 'network']);
  const layoutDirections = Object.freeze(['horizontal', 'vertical']);

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
    const groupIds = new Set(), memberOwners = new Set(), groups = graph.groups === undefined ? [] : graph.groups;
    requireValue(Array.isArray(groups) && groups.length <= limits.groups, 'groups는 최대 500개입니다.');
    for (const group of groups) {
      requireValue(group && typeof group === 'object', '그룹 형식을 확인하세요.');
      string(group.id, 'group.id'); string(group.label, 'group.label', 2000);
      requireValue(!groupIds.has(group.id) && !nodeIds.has(group.id), `중복 그룹 ID: ${group.id}`);
      groupIds.add(group.id);
      requireValue(Array.isArray(group.nodeIds), 'group.nodeIds는 노드 ID 배열이어야 합니다.');
      for (const id of group.nodeIds) {
        requireValue(nodeIds.has(id), `그룹의 노드가 없습니다: ${id}`);
        requireValue(!memberOwners.has(id), `노드는 하나의 그룹에 직접 속해야 합니다: ${id}`);
        memberOwners.add(id);
      }
      if (group.parentId !== undefined) string(group.parentId, 'group.parentId');
    }
    const parents = new Map(groups.map(group => [group.id, group.parentId]));
    for (const group of groups) {
      const seen = new Set([group.id]);
      let parent = group.parentId;
      while (parent !== undefined) {
        requireValue(groupIds.has(parent) && !seen.has(parent), `그룹의 부모 또는 중첩 관계가 잘못됐습니다: ${group.id}`);
        seen.add(parent); parent = parents.get(parent);
      }
    }
    for (const edge of graph.edges) {
      requireValue(edge && typeof edge === 'object', '연결 형식을 확인하세요.');
      string(edge.id, 'edge.id');
      string(edge.source, 'edge.source');
      string(edge.target, 'edge.target');
      requireValue(!edgeIds.has(edge.id), `중복 연결 ID: ${edge.id}`);
      requireValue((nodeIds.has(edge.source) || groupIds.has(edge.source)) && (nodeIds.has(edge.target) || groupIds.has(edge.target)), `연결의 노드 또는 그룹이 없습니다: ${edge.id}`);
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
    if (!graph.nodes.some(n => n.id === selected)) return {nodes: new Set(), edges: new Set(), groups: new Set()};
    const forward = new Map(graph.nodes.map(node => [node.id, []]));
    const backward = new Map(graph.nodes.map(node => [node.id, []]));
    const members = groupMembers(graph), hubs = new Map();
    const link = (source, target) => {forward.get(source).push(target); backward.get(target).push(source);};
    for (const edge of graph.edges) {
      const reverse = edge.direction === 'both' || edge.direction === 'none';
      if (members.has(edge.source) || members.has(edge.target)) {
        const hub = Symbol(edge.id); hubs.set(edge.id, hub); forward.set(hub, []); backward.set(hub, []);
        for (const source of members.get(edge.source) || [edge.source]) {link(source, hub); if (reverse) link(hub, source);}
        for (const target of members.get(edge.target) || [edge.target]) {link(hub, target); if (reverse) link(target, hub);}
      } else {
        link(edge.source, edge.target); if (reverse) link(edge.target, edge.source);
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
    const nodes = new Set(graph.nodes.filter(node => before.has(node.id) || after.has(node.id)).map(node => node.id));
    const edges = new Set(graph.edges.filter(edge => hubs.has(edge.id) ? before.has(hubs.get(edge.id)) || after.has(hubs.get(edge.id)) : before.has(edge.source) && before.has(edge.target) || after.has(edge.source) && after.has(edge.target)).map(edge => edge.id));
    const groups = new Set([...members].filter(([id, items]) => items.some(node => nodes.has(node)) || graph.edges.some(edge => edges.has(edge.id) && (edge.source === id || edge.target === id))).map(([id]) => id));
    const parents = new Map((graph.groups || []).map(group => [group.id, group.parentId]));
    for (const id of groups) if (parents.get(id)) groups.add(parents.get(id));
    return {nodes, edges, groups};
  }

  function groupMembers(graph) {
    const members = new Map(), children = new Map((graph.groups || []).map(group => [group.id, []]));
    const byId = new Map((graph.groups || []).map(group => [group.id, group]));
    for (const group of graph.groups || []) if (group.parentId) children.get(group.parentId).push(group.id);
    function visit(id) {
      if (!members.has(id)) members.set(id, [...byId.get(id).nodeIds, ...children.get(id).flatMap(visit)]);
      return members.get(id);
    }
    for (const group of graph.groups || []) visit(group.id);
    return members;
  }

  function layoutGraph(graph, compact = false, options = {}) {
    const mode = options.layout || 'layered';
    const vertical = (options.direction || (compact ? 'vertical' : 'horizontal')) === 'vertical';
    requireValue(layoutModes.includes(mode), '배치 방식을 확인하세요.');
    requireValue(!options.direction || layoutDirections.includes(options.direction), '배치 방향을 확인하세요.');
    if (graph.groups?.length) return groupedLayout(graph, compact, options);
    if (mode === 'layered') return layeredLayout(graph, compact, vertical);
    const cardWidth = compact ? 180 : 225, cardHeight = compact ? 112 : 136;
    const gapX = mode === 'tree' && !vertical ? (compact ? 68 : 85) : (compact ? 20 : 45);
    const gapY = mode === 'tree' && vertical ? (compact ? 68 : 85) : (compact ? 20 : 45);
    const positions = mode === 'network' ? networkPositions(graph, cardWidth / 2) : forestPositions(graph, mode === 'radial', vertical, cardWidth, cardHeight, gapX, gapY);
    const occupied = new Set();
    const nodes = graph.nodes.map((node, i) => {
      const desired = positions[i], column = Math.round(desired[0] / (cardWidth + gapX)), row = Math.round(desired[1] / (cardHeight + gapY));
      let cell = [column, row];
      for (let radius = 1; occupied.has(cell.join(',')); radius++) {
        const candidates = [];
        for (let offset = -radius; offset <= radius; offset++) {
          candidates.push([column + offset, row - radius], [column + offset, row + radius], [column - radius, row + offset], [column + radius, row + offset]);
        }
        cell = candidates.filter(point => !occupied.has(point.join(','))).sort((a, b) => Math.hypot(a[0] - column, a[1] - row) - Math.hypot(b[0] - column, b[1] - row))[0] || cell;
      }
      occupied.add(cell.join(','));
      return {...node, x: cell[0] * (cardWidth + gapX), y: cell[1] * (cardHeight + gapY)};
    });
    return finishLayout(graph, nodes, gridEdges(graph, nodes, cardWidth, cardHeight, gapX, gapY), cardWidth, cardHeight);
  }

  function groupedLayout(graph, compact, options) {
    const width = compact ? 180 : 225, height = compact ? 112 : 136;
    const vertical = (options.direction || (compact ? 'vertical' : 'horizontal')) === 'vertical';
    const directed = !options.layout || options.layout === 'layered' || options.layout === 'tree';
    const crossGap = compact ? 20 : 45, mainGap = compact ? 68 : 85;
    const gapX = directed && !vertical ? mainGap : crossGap, gapY = directed && vertical ? mainGap : crossGap;
    const stepX = width + gapX, stepY = height + gapY;
    const owners = new Map(graph.groups.flatMap(group => group.nodeIds.map(id => [id, group.id])));
    function arrange(parentId) {
      const units = graph.nodes.filter(node => owners.get(node.id) === parentId).map(node => ({id: node.id, label: node.label, nodes: [{...node, x: 0, y: 0}], groups: [], left: 0, top: 0, right: width, bottom: height}));
      for (const group of graph.groups.filter(group => group.parentId === parentId)) units.push({...arrange(group.id), id: group.id, label: group.label});
      const unitOf = new Map();
      for (const unit of units) for (const item of [...unit.nodes, ...unit.groups]) unitOf.set(item.id, unit.id);
      const edges = graph.edges.flatMap(edge => {
        const source = unitOf.get(edge.source), target = unitOf.get(edge.target);
        return source && target && source !== target ? [{...edge, source, target}] : [];
      });
      const coarse = layoutGraph({...graph, groups: undefined, nodes: units.map(unit => ({id: unit.id, label: unit.label, type: '배치'})), edges}, compact, options);
      const minX = coarse.nodes.length ? Math.min(...coarse.nodes.map(node => node.x)) : 0;
      const minY = coarse.nodes.length ? Math.min(...coarse.nodes.map(node => node.y)) : 0;
      const nodes = [], groups = [], byId = new Map(units.map(unit => [unit.id, unit]));
      function offsets(axis, minimum, step, before, after) {
        const spans = new Map();
        for (const position of coarse.nodes) {
          const cell = Math.round((position[axis] - minimum) / step), unit = byId.get(position.id), span = spans.get(cell);
          spans.set(cell, {lo: Math.min(span?.lo ?? Infinity, unit[before]), hi: Math.max(span?.hi ?? -Infinity, unit[after])});
        }
        let cursor = 0, previous = -1;
        const result = new Map();
        for (const [cell, span] of [...spans].sort((a, b) => a[0] - b[0])) {
          cursor += (cell - previous - 1) * step;
          const offset = Math.ceil((cursor - span.lo) / step) * step;
          result.set(cell, offset); cursor = offset + span.hi + 20; previous = cell;
        }
        return result;
      }
      const columns = offsets('x', minX, stepX, 'left', 'right'), rows = offsets('y', minY, stepY, 'top', 'bottom');
      for (const position of coarse.nodes) {
        const unit = byId.get(position.id);
        const dx = columns.get(Math.round((position.x - minX) / stepX));
        const dy = rows.get(Math.round((position.y - minY) / stepY));
        nodes.push(...unit.nodes.map(node => ({...node, x: node.x + dx, y: node.y + dy})));
        groups.push(...unit.groups.map(group => ({...group, x: group.x + dx, y: group.y + dy})));
      }
      const items = [...nodes.map(node => ({x: node.x, y: node.y, width, height})), ...groups];
      let left = items.length ? Math.min(...items.map(item => item.x)) : 0;
      let top = items.length ? Math.min(...items.map(item => item.y)) : 0;
      let right = items.length ? Math.max(...items.map(item => item.x + item.width)) : width;
      let bottom = items.length ? Math.max(...items.map(item => item.y + item.height)) : height / 2;
      if (parentId !== undefined) {
        left -= 20; top -= 52; right += 20; bottom += 20;
        const group = graph.groups.find(group => group.id === parentId);
        groups.unshift({...group, x: left, y: top, width: right - left, height: bottom - top});
      }
      const dx = Math.ceil(left / stepX) * stepX, dy = Math.ceil(top / stepY) * stepY;
      for (const item of [...nodes, ...groups]) {item.x -= dx; item.y -= dy;}
      left -= dx; right -= dx; top -= dy; bottom -= dy;
      return {nodes, groups, left, top, right, bottom};
    }
    const {nodes, groups} = arrange(undefined);
    return finishLayout(graph, nodes, gridEdges(graph, nodes, width, height, gapX, gapY, groups), width, height, groups);
  }

  function forestPositions(graph, radial, vertical, width, height, gapX, gapY) {
    const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
    const outgoing = graph.nodes.map(() => []), incoming = graph.nodes.map(() => 0);
    for (const edge of graph.edges) {
      const from = index.get(edge.source), to = index.get(edge.target);
      if (from !== to) {outgoing[from].push(to); incoming[to]++;}
    }
    const roots = incoming.flatMap((count, i) => count === 0 ? [i] : []), queue = [...roots], seen = new Set(roots);
    const children = graph.nodes.map(() => []), depth = graph.nodes.map(() => 0), weights = graph.nodes.map(() => 1);
    let cursor = 0;
    while (seen.size < graph.nodes.length || cursor < queue.length) {
      if (cursor === queue.length) {
        const root = graph.nodes.findIndex((node, i) => !seen.has(i));
        roots.push(root); queue.push(root); seen.add(root);
      }
      const from = queue[cursor++];
      for (const to of outgoing[from]) if (!seen.has(to)) {
        seen.add(to); children[from].push(to); depth[to] = depth[from] + 1; queue.push(to);
      }
    }
    for (const i of [...queue].reverse()) if (children[i].length) weights[i] = children[i].reduce((sum, child) => sum + weights[child], 0);
    const cross = [], angles = [], total = roots.reduce((sum, root) => sum + weights[root], 0);
    function place(i, offset) {
      cross[i] = offset + (weights[i] - 1) / 2;
      angles[i] = -Math.PI / 2 + (offset + weights[i] / 2) / total * Math.PI * 2;
      for (const child of children[i]) {place(child, offset); offset += weights[child];}
    }
    let offset = 0;
    for (const root of roots) {place(root, offset); offset += weights[root];}
    if (!radial) return graph.nodes.map((node, i) => vertical ? [cross[i] * (width + gapX), depth[i] * (height + gapY)] : [depth[i] * (width + gapX), cross[i] * (height + gapY)]);
    const rings = [], radius = [], spacing = Math.hypot(width + gapX, height + gapY);
    depth.forEach((value, i) => {const ring = value + (roots.length > 1 ? 1 : 0); (rings[ring] ||= []).push(angles[i]);});
    for (let ring = 0; ring < rings.length; ring++) {
      const values = (rings[ring] || []).sort((a, b) => a - b);
      let required = 0;
      if (values.length > 1) {
        const minimum = Math.min(...values.map((angle, i) => (values[(i + 1) % values.length] - angle + Math.PI * 2) % (Math.PI * 2)));
        required = spacing / (2 * Math.sin(minimum / 2));
      }
      radius[ring] = Math.max(ring ? radius[ring - 1] + spacing : 0, required);
    }
    return graph.nodes.map((node, i) => {
      const r = radius[depth[i] + (roots.length > 1 ? 1 : 0)];
      return [Math.cos(angles[i]) * r, Math.sin(angles[i]) * r];
    });
  }

  function networkPositions(graph, scale) {
    const count = graph.nodes.length, index = new Map(graph.nodes.map((node, i) => [node.id, i]));
    const points = graph.nodes.map((node, i) => [Math.cos(i * 2.399963229728653) * Math.sqrt(i) * 1.7, Math.sin(i * 2.399963229728653) * Math.sqrt(i) * 1.7]);
    const links = graph.edges.map(edge => [index.get(edge.source), index.get(edge.target)]);
    const dx = new Float64Array(count), dy = new Float64Array(count);
    for (let step = 0; step < 90; step++) {
      dx.fill(0); dy.fill(0);
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        const x = points[i][0] - points[j][0], y = points[i][1] - points[j][1], force = 2 / (x * x + y * y + .01);
        dx[i] += x * force; dy[i] += y * force; dx[j] -= x * force; dy[j] -= y * force;
      }
      for (const [from, to] of links) {
        const x = points[from][0] - points[to][0], y = points[from][1] - points[to][1], force = Math.hypot(x, y) * .12;
        dx[from] -= x * force; dy[from] -= y * force; dx[to] += x * force; dy[to] += y * force;
      }
      const temperature = 1.2 * (1 - step / 90);
      for (let i = 0; i < count; i++) {
        dx[i] -= points[i][0] * .12; dy[i] -= points[i][1] * .12;
        const length = Math.hypot(dx[i], dy[i]), movement = length ? Math.min(temperature / length, 1) : 0;
        points[i][0] += dx[i] * movement; points[i][1] += dy[i] * movement;
      }
    }
    return points.map(([x, y]) => [x * scale, y * scale]);
  }

  function gridEdges(graph, nodes, width, height, gapX, gapY, groups = []) {
    const byId = new Map([...nodes.map(node => ({...node, width, height})), ...groups].map(item => [item.id, item]));
    const intersects = (a, b, node) => {
      let lo = 0, hi = 1;
      for (let axis = 0; axis < 2; axis++) {
        const start = axis ? node.y - 8 : node.x - 8, end = start + (axis ? height : width) + 16, delta = b[axis] - a[axis];
        if (!delta) {if (a[axis] <= start || a[axis] >= end) return false;}
        else {const t1 = (start - a[axis]) / delta, t2 = (end - a[axis]) / delta; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));}
        if (lo >= hi) return false;
      }
      return true;
    };
    return graph.edges.map(edge => {
      const a = byId.get(edge.source), b = byId.get(edge.target);
      const ac = [a.x + a.width / 2, a.y + a.height / 2], bc = [b.x + b.width / 2, b.y + b.height / 2];
      if (a === b) return {points: [[a.x + a.width, a.y + a.height * .35], [a.x + a.width + gapX * .8, a.y + a.height * .35], [a.x + a.width + gapX * .8, a.y + a.height * .65], [a.x + a.width, a.y + a.height * .65]], label: [a.x + a.width + gapX / 2, a.y + a.height * .35 - 12], curve: true};
      const port = (center, other, box) => {
        const dx = other[0] - center[0], dy = other[1] - center[1], scale = 1 / Math.max(Math.abs(dx) / (box.width / 2), Math.abs(dy) / (box.height / 2));
        return [center[0] + dx * scale, center[1] + dy * scale];
      };
      let points = [port(ac, bc, a), port(bc, ac, b)];
      if (nodes.some(node => node.id !== a.id && node.id !== b.id && intersects(points[0], points[1], node))) {
        const sameColumn = a.x === b.x && a.width === b.width, right = bc[0] >= ac[0];
        const start = [a.x + (right ? a.width : 0), ac[1]], end = [b.x + (right && !sameColumn ? 0 : b.width), bc[1]];
        const corridor = (x, after) => (after ? Math.ceil((x + gapX / 2) / (width + gapX)) : Math.floor((x + gapX / 2) / (width + gapX))) * (width + gapX) - gapX / 2;
        const exit = corridor(start[0], right), entry = corridor(end[0], !right || sameColumn);
        const lane = Math.round((ac[1] + bc[1]) / 2 / (height + gapY)) * (height + gapY) - gapY / 2;
        points = sameColumn ? [start, [exit, start[1]], [exit, end[1]], end] : [start, [exit, start[1]], [exit, lane], [entry, lane], [entry, end[1]], end];
      }
      const pairs = points.slice(1).map((point, i) => ({a: points[i], b: point, length: Math.hypot(point[0] - points[i][0], point[1] - points[i][1])}));
      const longest = pairs.sort((a, b) => b.length - a.length)[0];
      return {points, label: [(longest.a[0] + longest.b[0]) / 2, (longest.a[1] + longest.b[1]) / 2 - 12], curve: false};
    });
  }

  function layeredLayout(graph, compact, vertical) {
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
    const crossSize = maxCount * (vertical ? cardWidth : cardHeight) + (maxCount - 1) * crossGap;
    const nodes = layers.flatMap((layer, rank) => {
      const size = layer.length * (vertical ? cardWidth : cardHeight) + (layer.length - 1) * crossGap;
      return layer.map((node, i) => {
        const cross = margin + (crossSize - size) / 2 + i * ((vertical ? cardWidth : cardHeight) + crossGap);
        const main = margin + rank * ((vertical ? cardHeight : cardWidth) + mainGap);
        return {...node, x: vertical ? cross : main, y: vertical ? main : cross};
      });
    });
    const positions = new Map(nodes.map(node => [node.id, {
      main: vertical ? node.y : node.x, cross: vertical ? node.x : node.y,
      rank: ranks[componentOf.get(node.id)],
    }]));
    const mainSize = vertical ? cardHeight : cardWidth, crossCard = vertical ? cardWidth : cardHeight;
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
    const point = ([main, cross]) => vertical ? [cross, main] : [main, cross];
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
    return finishLayout(graph, nodes, edges, cardWidth, cardHeight);
  }

  function finishLayout(graph, nodes, edges, cardWidth, cardHeight, groups = []) {
    const margin = 50;
    let left = 0, top = 0, right = cardWidth + margin, bottom = cardHeight + margin;
    for (const node of nodes) {left = Math.min(left, node.x - margin); top = Math.min(top, node.y - margin);}
    for (const group of groups) {left = Math.min(left, group.x - margin); top = Math.min(top, group.y - margin); right = Math.max(right, group.x + group.width); bottom = Math.max(bottom, group.y + group.height);}
    for (const node of nodes) {right = Math.max(right, node.x + cardWidth); bottom = Math.max(bottom, node.y + cardHeight);}
    edges.forEach((edge, i) => {
      for (const [x, y] of edge.points) {left = Math.min(left, x - margin); top = Math.min(top, y - margin); right = Math.max(right, x); bottom = Math.max(bottom, y);}
      if (graph.edges[i].label || graph.edges[i].type) {
        left = Math.min(left, edge.label[0] - 60 - margin); top = Math.min(top, edge.label[1] - 12 - margin);
        right = Math.max(right, edge.label[0] + 60); bottom = Math.max(bottom, edge.label[1]);
      }
    });
    for (const node of nodes) {node.x -= left; node.y -= top;}
    for (const group of groups) {group.x -= left; group.y -= top;}
    for (const edge of edges) {
      edge.points = edge.points.map(([x, y]) => [x - left, y - top]);
      edge.label = [edge.label[0] - left, edge.label[1] - top];
    }
    return {nodes, edges, groups, cardWidth, cardHeight, width: right - left + margin, height: bottom - top + margin};
  }

  const api = Object.freeze({limits, layoutModes, layoutDirections, validateGraph, connectedPath, layoutGraph});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GraphModel = api;
})(globalThis);
