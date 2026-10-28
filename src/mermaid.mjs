import {createHash} from 'node:crypto';
import {load, JSON_SCHEMA} from 'js-yaml';
import GraphModel from './model.js';

let grammar;
async function flowGrammar() {
  grammar ||= import('mermaid').then(async ({default: mermaid}) => {
    mermaid.initialize({startOnLoad: false});
    const diagram = await mermaid.mermaidAPI.getDiagramFromText('flowchart LR');
    return {Parser: diagram.getParser().parser.Parser, destructLink: diagram.db.destructLink.bind(diagram.db)};
  });
  return grammar;
}

export async function mermaidGraph(source, {graphId, title = graphId}) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > GraphModel.limits.bytes) throw new Error('Mermaid 입력은 최대 1 MiB입니다.');
  let text = source.trim();
  const fenced = /^```mermaid\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced) text = fenced[1];
  const firstLine = text.split(/\r?\n/).find(line => line.trim() && !line.trimStart().startsWith('%%')) || '';
  if (!/^\s*(?:flowchart|graph)\b/.test(firstLine)) throw new Error('Mermaid flowchart와 graph를 지원합니다.');
  const core = await flowGrammar(), parser = new core.Parser();
  const vertices = new Map(), edges = [], groups = new Map(), occurrences = new Map();
  let first = true, groupCount = 0;
  const label = value => String(value?.text ?? value ?? '').replace(/<br\s*\/?\s*>/gi, '\n');
  function addVertex(id, value, type, style, classes, direction, properties, metadata) {
    const key = String(id);
    if (groups.has(key)) return;
    if (edges.some(edge => edge.id === key)) return;
    if (metadata !== undefined) {
      const data = load(metadata.includes('\n') ? metadata + '\n' : '{\n' + metadata + '\n}', {schema: JSON_SCHEMA});
      if (data?.label !== undefined) value = data.label;
    }
    const previous = vertices.get(key);
    vertices.set(key, {id: key, type: '노드', label: value === undefined ? previous?.label || key : label(value)});
    if (vertices.size > GraphModel.limits.nodes) throw new Error('Mermaid 노드는 최대 500개입니다.');
  }
  function edge(source, target, text, direction, id) {
    for (const id of [source, target]) if (!vertices.has(id) && !groups.has(id)) addVertex(id);
    const key = JSON.stringify([source, target, text, direction]);
    const n = occurrences.get(key) || 0; occurrences.set(key, n + 1);
    if (edges.length >= GraphModel.limits.edges) throw new Error('Mermaid 관계는 최대 2,000개입니다.');
    edges.push({id: id && !edges.some(edge => edge.id === id) ? id : 'edge-' + createHash('sha256').update(key + n).digest('hex').slice(0, 20), source, target, label: text, direction});
  }
  parser.yy = {
    lex: {firstGraph() {const value = first; first = false; return value;}},
    setDirection() {},
    addVertex,
    destructLink(value, ...rest) {return {...core.destructLink(value, ...rest), reverse: String(value).trim().startsWith('<') && !String(value).trim().endsWith('>')};},
    addLink(starts, ends, link) {
      for (const start of starts) for (const end of ends) {
        let source = start, target = end;
        if (link.reverse) [source, target] = [target, source];
        const text = label(link.text), type = link.type || 'arrow_point';
        const id = start === starts.at(-1) && end === ends[0] ? link.id?.replace('@', '') : undefined;
        edge(String(source), String(target), text, type === 'arrow_open' ? 'none' : type.startsWith('double_') ? 'both' : 'forward', id);
      }
    },
    addSubGraph(id, nodes, value) {
      const key = id === undefined || id === value && /\s/.test(label(id)) ? `subGraph${groupCount}` : label(id).trim();
      groupCount++;
      const claimed = new Set([...groups.values()].flatMap(group => group.items));
      const items = [...new Set(nodes.flat(Infinity).filter(item => typeof item === 'string' && item.trim() && item !== key && !claimed.has(item)))];
      const previous = groups.get(key);
      groups.set(key, {id: key, label: label(value).trim() || key, items: [...(previous?.items || []), ...items]});
      vertices.delete(key);
      if (groups.size > GraphModel.limits.groups) throw new Error('Mermaid 그룹은 최대 500개입니다.');
      return key;
    },
    setAccTitle() {}, setAccDescription() {},
    addClass() {}, setClass() {}, updateLink() {}, updateLinkInterpolate() {},
    setTooltip() {},
    setClickEvent() {throw new Error('Mermaid 클릭 동작은 지원하지 않습니다.');},
    setLink() {throw new Error('Mermaid 클릭 링크는 지원하지 않습니다.');},
  };
  // Use the syntax parser without Mermaid's DOM renderer; GraphPanel displays labels as text.
  parser.parse(text + '\n');
  const exported = [...groups.values()].map(group => ({id: group.id, label: group.label, nodeIds: [...vertices.keys()].filter(id => group.items.includes(id))}));
  for (const group of exported) {
    const parent = [...groups.values()].find(candidate => candidate.items.includes(group.id));
    if (parent) group.parentId = parent.id;
  }
  return GraphModel.validateGraph({schemaVersion: 1, graphId, title, kind: 'mermaid', nodes: [...vertices.values()], edges, ...(exported.length ? {groups: exported} : {})});
}
