#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import GraphModel from '../src/model.js';
import {startServer} from '../src/server.mjs';
import {failure} from '../src/store.mjs';

const help = `graph-panel (Node.js 22 이상)
  validate <graph.json>
  serve --data-dir <절대 경로> [--port 9232] [--cdp-port 9222]
  publish <graph.json> --thread <id> --expected-revision <n> [--host local] [--port 9232]
  status --thread <id> [--graph <id>] [--host local] [--port 9232]
  show --thread <id> --graph <id> --view summary|large [--host local] [--port 9232]
큰 화면은 show 결과의 url을 Codex의 open_in_codex(browser)로 엽니다.
저장 성공(committed)과 화면 적용(applied)은 별도 결과입니다.`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {console.log(help); return;}
  const options = {}, positional = [];
  const allowed = new Set(['--data-dir', '--port', '--cdp-port', '--thread', '--host', '--expected-revision', '--graph', '--view']);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) {positional.push(args[i]); continue;}
    if (!allowed.has(args[i]) || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw failure('invalid-option', `잘못된 옵션: ${args[i]}`);
    if (Object.hasOwn(options, args[i])) throw failure('invalid-option', `중복 옵션: ${args[i]}`);
    options[args[i]] = args[++i];
  }
  function portOption(key, fallback) {
    const number = Number(options[key] ?? fallback);
    if (!Number.isInteger(number) || number < 1 || number > 65535) throw failure('invalid-port', '포트는 1부터 65535까지 정수입니다.');
    return number;
  }
  async function graphFile() {
    if (positional.length !== 1) throw failure('missing-file', '그래프 JSON 파일 하나를 지정하세요.');
    const data = await readFile(positional[0]);
    if (data.byteLength > GraphModel.limits.bytes) throw failure('too-large', '그래프 JSON은 최대 1 MiB입니다.');
    return GraphModel.validateGraph(JSON.parse(data.toString('utf8').replace(/^\uFEFF/, '')));
  }
  if (command === 'validate') {console.log(JSON.stringify(await graphFile())); return;}
  const port = portOption('--port', 9232);
  if (command === 'serve') {
    if (!options['--data-dir'] || !path.isAbsolute(options['--data-dir'])) throw failure('missing-data-dir', '--data-dir에 저장 폴더의 절대 경로를 지정하세요.');
    const service = await startServer({port, dataDir: options['--data-dir'], cdpPort: options['--cdp-port'] ? portOption('--cdp-port') : undefined});
    console.log(JSON.stringify({ready: true, port: service.port, dataDir: service.dataDir}));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => process.exit(0), error => {console.error(error.message); process.exit(1);}));
    return;
  }
  if (!['publish', 'status', 'show'].includes(command)) throw failure('unknown-command', `명령을 확인하세요: ${command}`);
  if (!options['--thread']) throw failure('missing-thread', '--thread에 요청한 채팅 ID를 지정하세요.');
  const ref = {hostId: options['--host'] || 'local', threadId: options['--thread']};
  const origin = `http://127.0.0.1:${port}`;
  async function request(route, body, authenticated = true) {
    const response = await fetch(`${origin}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {...(authenticated ? {Authorization: `Bearer ${token}`} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw failure(result.error?.code || 'http-error', result.error?.message || `HTTP ${response.status}`, response.status);
    return result;
  }
  let token;
  token = (await request('/connection', undefined, false)).token;
  let result;
  if (command === 'publish') {
    if (!/^\d+$/.test(options['--expected-revision'] || '')) throw failure('missing-revision', '--expected-revision에 조회한 현재 버전을 지정하세요. 최초 등록은 0입니다.');
    result = await request('/api/publish', {chatRef: ref, graph: await graphFile(), expectedRevision: Number(options['--expected-revision'])});
  } else if (command === 'status') {
    const query = new URLSearchParams({...ref, ...(options['--graph'] ? {graphId: options['--graph']} : {})});
    result = await request(`/api/status?${query}`);
  } else {
    if (!options['--graph']) throw failure('missing-graph', '--graph에 등록된 그래프 ID를 지정하세요.');
    result = await request('/api/show', {chatRef: ref, graphId: options['--graph'], view: options['--view']});
  }
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(JSON.stringify({error: {code: error.code || 'command-failed', message: error.message, ...(error.cause?.code ? {cause: error.cause.code} : {})}}));
  process.exitCode = 1;
});
