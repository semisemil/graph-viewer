import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio, StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {z} from 'zod';
import {appendFile, mkdir, open, readFile, realpath, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import GraphModel from './model.js';
import {GraphStore, chatRef, sameChat, failure} from './store.mjs';
import {mermaidGraph} from './mermaid.mjs';

if (process.platform !== 'win32') throw failure('unsupported-platform', 'MCP 그래프 탭은 현재 Windows를 지원합니다.');
const stores = new Map();
async function storage(projectPath) {
  let root, dataDir;
  if (projectPath !== undefined) {
    if (!path.isAbsolute(projectPath) || !(await stat(projectPath)).isDirectory()) throw failure('invalid-project', '프로젝트의 절대 폴더 경로가 필요합니다.');
    root = await realpath(projectPath);
    dataDir = path.join(root, '.graph-viewer');
  } else {
    dataDir = process.env.GRAPH_PANEL_DATA_DIR;
    if (!dataDir || !path.isAbsolute(dataDir)) throw failure('missing-project', 'projectPath에 현재 작업 프로젝트의 절대 경로를 전달하세요.');
  }
  const key = process.platform === 'win32' ? dataDir.toLowerCase() : dataDir;
  if (!stores.has(key)) stores.set(key, (async () => {
    const store = new GraphStore(dataDir);
    await store.init();
    if (root) await writeFile(path.join(dataDir, '.gitignore'), '*\n', {flag: 'wx'}).catch(error => {if (error.code !== 'EEXIST') throw error;});
    return store;
  })().catch(error => {stores.delete(key); throw error;}));
  return {store: await stores.get(key), dataDir, projectPath: root};
}
const uri = 'ui://graph-panel/graph-v2.html';
const logFile = process.env.GRAPH_PANEL_LOG;
async function log(event) {
  if (!logFile) return;
  await mkdir(path.dirname(logFile), {recursive: true});
  await appendFile(logFile, JSON.stringify({at: new Date().toISOString(), pid: process.pid, ...event}) + '\n');
}
function summary(item) {
  return item ? {graphId: item.graph.graphId, title: item.graph.title, revision: item.revision, stateRevision: item.stateRevision, nodeCount: item.graph.nodes.length, edgeCount: item.graph.edges.length} : null;
}
function result(value, hidden) {
  return {content: [{type: 'text', text: JSON.stringify(value)}], structuredContent: value, ...(hidden ? {_meta: {graphPanel: hidden}} : {})};
}
function requestingChat(ctx) {
  const threadId = ctx.mcpReq._meta?.threadId;
  if (typeof threadId !== 'string' || !threadId.trim()) throw failure('missing-chat-context', '호스트가 요청 채팅 ID를 전달하지 않았습니다.');
  return chatRef({hostId: 'local', threadId});
}
async function graphFile(file) {
  if (!path.isAbsolute(file)) throw failure('invalid-path', 'graphPath는 절대 경로여야 합니다.');
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > GraphModel.limits.bytes) throw failure('invalid-graph', '그래프 입력은 최대 1 MiB의 파일이어야 합니다.');
    const bytes = Buffer.alloc(GraphModel.limits.bytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const next = await handle.read(bytes, size, bytes.length - size, null);
      if (!next.bytesRead) break;
      size += next.bytesRead;
    }
    if (size > GraphModel.limits.bytes) throw failure('invalid-graph', '그래프 입력은 최대 1 MiB입니다.');
    return bytes.subarray(0, size).toString('utf8');
  } finally {await handle.close();}
}
async function viewer() {
  const [model, renderer, html] = await Promise.all([
    readFile(new URL('./model.js', import.meta.url), 'utf8'),
    readFile(new URL('./renderer.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/mcp.html', import.meta.url), 'utf8'),
  ]);
  const scripts = [model, renderer].map(source => '<script>' + source.replace(/<\/script/gi, '<\\/script') + '</script>').join('\n');
  return html.replace('<!-- GRAPH_ENGINE -->', () => scripts);
}
const readOnly = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const projectField = {projectPath: z.string().min(1).optional()};
const optionalGraph = z.object({...projectField, graphId: z.string().min(1).optional()}).strict();
let negotiatedVersion;
const transport = new StdioServerTransport();
const send = transport.send.bind(transport);
transport.send = async message => {
  if (message.result?.protocolVersion) {
    negotiatedVersion = message.result.protocolVersion;
    await log({kind: 'initialize-result', protocolVersion: negotiatedVersion});
  }
  if (message.result?.supportedVersions) await log({kind: 'discover-result', supportedVersions: message.result.supportedVersions});
  return send(message);
};
serveStdio(factory => {
  const protocolVersion = () => factory.era === 'modern' ? '2026-07-28' : negotiatedVersion;
  const server = new McpServer({name: 'graph-panel', version: '1.1.0'}, {
    capabilities: {extensions: {'io.modelcontextprotocol/ui': {}}},
    instructions: 'Pass the current project absolute path as projectPath. Use graph_publish with JSON or Mermaid, then open_graph. Updates do not open another tab. Chat identity comes from the host.',
  });
  const observed = new Set();
  function tool(name, config, run) {
    server.registerTool(name, {...config, _meta: {ui: {visibility: ['model']}, ...config._meta}}, async (args, ctx) => {
      try {
        const ref = requestingChat(ctx);
        const selected = await storage(args.projectPath ?? args.scope?.projectPath);
        const scope = {...ref, ...(selected.projectPath ? {projectPath: selected.projectPath} : {})};
        if (name !== 'graph_view' || !observed.has(args.op)) {
          await log({kind: 'tool-call', tool: name, op: args.op, threadId: ref.threadId, protocolVersion: ctx.mcpReq.envelope?.['io.modelcontextprotocol/protocolVersion'] || protocolVersion()});
          observed.add(args.op);
        }
        return await run(args, ref, {...selected, scope});
      } catch (error) {
        const value = {error: {code: error.code || 'invalid-request', message: error.message}};
        return {...result(value), isError: true};
      }
    });
  }
  tool('graph_publish', {
    title: '그래프 저장', description: 'Save JSON or Mermaid flowchart in the current project and chat. Pass projectPath plus graphPath, graph, or mermaid. New graph expectedRevision is 0. Does not open a tab.',
    inputSchema: z.object({...projectField, graphPath: z.string().optional(), graph: z.unknown().optional(), mermaid: z.string().optional(), graphId: z.string().optional(), title: z.string().optional(), expectedRevision: z.number().int().nonnegative()}).strict(),
    annotations: {...readOnly, readOnlyHint: false},
  }, async (args, ref, {store}) => {
    if ([args.graphPath, args.graph, args.mermaid].filter(value => value !== undefined).length !== 1) throw failure('invalid-input', 'graphPath, graph, mermaid 중 하나를 지정하세요.');
    let value = args.graph;
    if (args.graphPath !== undefined) {
      const text = await graphFile(args.graphPath);
      if (path.extname(args.graphPath).toLowerCase() === '.json') value = JSON.parse(text);
      else value = await mermaidGraph(text, {graphId: args.graphId || path.basename(args.graphPath, path.extname(args.graphPath)), title: args.title || args.graphId || path.basename(args.graphPath, path.extname(args.graphPath))});
    } else if (args.mermaid !== undefined) value = await mermaidGraph(args.mermaid, {graphId: args.graphId, title: args.title || args.graphId});
    const graph = GraphModel.validateGraph(value);
    const saved = await store.publish(ref, graph, args.expectedRevision);
    return result({...saved, title: graph.title, nodeCount: graph.nodes.length, edgeCount: graph.edges.length});
  });
  tool('graph_status', {title: '그래프 상태', description: 'List saved graphs in the specified project and current chat.', inputSchema: optionalGraph, annotations: readOnly}, async (args, ref, {store, dataDir, projectPath}) => {
    const status = await store.status(ref, args.graphId);
    return result({...status, snapshot: summary(status.snapshot), dataDir, projectPath, protocolVersion: protocolVersion()});
  });
  tool('graph_read', {title: '그래프 읽기', description: 'Read the complete graph and view state from the specified project and chat.', inputSchema: optionalGraph, annotations: readOnly}, async (args, ref, {store}) => {
    const {snapshot} = await store.status(ref, args.graphId);
    if (!snapshot) throw failure('graph-not-found', '등록된 그래프가 없습니다.', 404);
    return result({snapshot});
  });
  tool('open_graph', {
    title: '그래프', description: 'Open this chat’s saved graph in a separate native graph tab. Reopening restores saved selection, camera and search. No CDP is needed.',
    inputSchema: optionalGraph, annotations: {...readOnly, readOnlyHint: false, idempotentHint: false},
    _meta: {ui: {resourceUri: uri, visibility: ['model']}, 'openai/ui': {entrypoints: [{type: 'thread'}]}},
  }, async (args, ref, {store, scope}) => {
    const opened = await store.openNative(ref, args.graphId);
    const item = summary(opened.snapshot);
    return result({requested: true, graphId: item.graphId, title: item.title, revision: item.revision}, {scope, ...opened});
  });
  tool('graph_view', {
    title: '그래프 화면 연결', description: 'UI-only graph synchronization and view state persistence.',
    annotations: {...readOnly, readOnlyHint: false}, _meta: {ui: {visibility: ['app']}},
    inputSchema: z.object({
      op: z.enum(['sync', 'action', 'ack']), scope: z.object({hostId: z.string(), threadId: z.string(), ...projectField}).strict(), sessionId: z.string().min(1),
      graphId: z.string().optional(), revision: z.number().int().nonnegative().optional(), expectedStateRevision: z.number().int().nonnegative().optional(),
      action: z.object({type: z.string(), nodeId: z.string().nullable().optional(), camera: z.object({x: z.number(), y: z.number(), zoom: z.number()}).strict().optional(), query: z.string().optional()}).strict().optional(),
      knownGraphId: z.string().optional(), knownRevision: z.number().int().nonnegative().optional(), knownStateRevision: z.number().int().nonnegative().optional(),
      stateRevision: z.number().int().nonnegative().optional(), displayMode: z.string().optional(),
    }).strict(),
  }, async (args, ref, {store, scope}) => {
    if (!sameChat(args.scope, ref)) throw failure('scope-mismatch', '이 화면이 연결된 채팅과 호출 채팅이 다릅니다.', 403);
    if (args.op === 'sync') {
      const synced = await store.syncNative(ref, args);
      return result({unchanged: synced.unchanged}, synced.unchanged ? undefined : {scope, sessionId: args.sessionId, snapshot: synced.snapshot});
    }
    if (args.op === 'ack') return result(await store.ackNative(ref, args));
    if (!args.graphId || args.revision === undefined || args.expectedStateRevision === undefined || !args.action) throw failure('invalid-action', '그래프 버전, 상태 버전과 동작이 필요합니다.');
    const saved = await store.action(ref, {...args, view: 'large', nativeSessionId: args.sessionId}, () => {});
    return result({committed: saved.committed}, {scope, sessionId: args.sessionId, snapshot: saved.snapshot});
  });
  server.registerResource('graph-viewer', uri, {title: '그래프', mimeType: 'text/html;profile=mcp-app'}, async resource => ({contents: [{
    uri: resource.href, mimeType: 'text/html;profile=mcp-app', text: await viewer(),
    _meta: {ui: {csp: {connectDomains: [], resourceDomains: []}}, 'openai/ui': {availableDisplayModes: ['fullscreen']}},
  }]}));
  return server;
}, {transport, onerror: error => {console.error(error.message);}});
