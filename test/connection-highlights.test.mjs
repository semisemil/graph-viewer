import assert from 'node:assert/strict';
import {test} from 'node:test';
import GraphModel from '../src/model.js';

const ids = set => [...set].sort();

test('direct neighbors include incoming and outgoing links while distant paths and other branches stay distinct', () => {
  const graph = {
    nodes: ['before', 'parent', 'selected', 'child', 'after', 'both', 'none', 'branch', 'isolated'].map(id => ({id})),
    edges: [
      {id: 'upstream', source: 'before', target: 'parent'},
      {id: 'incoming', source: 'parent', target: 'selected'},
      {id: 'outgoing', source: 'selected', target: 'child'},
      {id: 'downstream', source: 'child', target: 'after'},
      {id: 'bidirectional', source: 'selected', target: 'both', direction: 'both'},
      {id: 'undirected', source: 'none', target: 'selected', direction: 'none'},
      {id: 'other-branch', source: 'parent', target: 'branch'},
      {id: 'cycle', source: 'after', target: 'child'},
      {id: 'self', source: 'selected', target: 'selected'},
    ],
  };
  const related = GraphModel.connectedPath(graph, 'selected');
  assert.deepEqual(ids(related.nodes), ['after', 'before', 'both', 'child', 'none', 'parent', 'selected']);
  assert.deepEqual(ids(related.direct.nodes), ['both', 'child', 'none', 'parent', 'selected']);
  assert.deepEqual(ids(related.direct.edges), ['bidirectional', 'incoming', 'outgoing', 'self', 'undirected']);
  assert.equal(related.edges.has('cycle'), true);
  assert.equal(related.edges.has('other-branch'), false);
  const cleared = GraphModel.connectedPath(graph, null);
  for (const scope of [cleared, cleared.direct]) for (const set of Object.values(scope).filter(value => value instanceof Set)) assert.equal(set.size, 0);
});

test('group endpoints identify immediate neighbors without treating other members as directly connected', () => {
  const graph = {
    nodes: ['selected', 'peer', 'target', 'far', 'source'].map(id => ({id})),
    groups: [{id: 'inner', nodeIds: ['selected', 'peer'], parentId: 'outer'}, {id: 'outer', nodeIds: []}],
    edges: [
      {id: 'group-out', source: 'inner', target: 'target'},
      {id: 'far-out', source: 'target', target: 'far'},
      {id: 'group-in', source: 'source', target: 'inner'},
    ],
  };
  const related = GraphModel.connectedPath(graph, 'selected');
  assert.deepEqual(ids(related.direct.nodes), ['source', 'target']);
  assert.deepEqual(ids(related.direct.edges), ['group-in', 'group-out']);
  assert.deepEqual(ids(related.direct.groups), ['inner', 'outer']);
  assert.equal(related.nodes.has('peer'), false);
  assert.equal(related.nodes.has('far'), true);
  const collapsed = GraphModel.collapseGroups(graph, ['inner']).graph;
  const folded = GraphModel.connectedPath(collapsed, 'inner');
  assert.deepEqual(ids(folded.direct.nodes), ['source', 'target']);
  assert.deepEqual(ids(folded.direct.edges), ['group-in', 'group-out']);
});
