import {build} from 'esbuild';
import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const plugin = path.join(root, 'plugins', 'graph-viewer');
const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');

export async function buildPlugin() {
  const {version, engines} = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await mkdir(path.join(plugin, 'src'), {recursive: true});
  await mkdir(path.join(plugin, 'web'), {recursive: true});
  await mkdir(path.join(plugin, '.codex-plugin'), {recursive: true});
  const chunks = path.resolve(plugin, 'src', 'chunks');
  if (path.dirname(chunks) !== path.join(plugin, 'src')) throw new Error('생성 청크 경로가 잘못되었습니다.');
  await rm(chunks, {recursive: true, force: true});
  await rm(path.join(plugin, 'src', 'mcp.mjs.LEGAL.txt'), {force: true});
  const bundle = await build({
    absWorkingDir: root, entryPoints: ['src/mcp.mjs'], outdir: path.join(plugin, 'src'), entryNames: 'mcp',
    chunkNames: 'chunks/[name]-[hash]', outExtension: {'.js': '.mjs'}, splitting: true,
    bundle: true, platform: 'node', target: 'node22.12', format: 'esm', minify: true, keepNames: true,
    legalComments: 'external', metafile: true,
    banner: {js: "import {createRequire as bundleRequire} from 'node:module';const require=bundleRequire(import.meta.url);"},
  });
  const packages = [...new Set(Object.keys(bundle.metafile.inputs).flatMap(file => {
    const match = file.replaceAll('\\', '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    return match ? [match[1]] : [];
  }))].sort();
  const notices = [];
  for (const name of packages) {
    const folder = path.join(root, 'node_modules', name);
    const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
    const licenses = (await readdir(folder)).filter(file => /^(?:licen[sc]e|copying)(?:[.-]|$)/i.test(file));
    notices.push(`${name}@${pkg.version} (${pkg.license || 'see license below'})\n` + (await Promise.all(licenses.map(file => readFile(path.join(folder, file), 'utf8')))).join('\n'));
    if (!licenses.length) throw new Error(`License file missing: ${name}`);
  }
  await writeFile(path.join(plugin, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n--------------------\n\n') + '\n');
  await Promise.all([
    ...['model.js', 'renderer.js'].map(file => cp(path.join(root, 'src', file), path.join(plugin, 'src', file))),
    cp(path.join(root, 'web', 'mcp.html'), path.join(plugin, 'web', 'mcp.html')),
    cp(path.join(root, 'skills', 'graph-viewer'), path.join(plugin, 'skills', 'graph-viewer'), {recursive: true, filter: file => !file.endsWith(path.sep + 'scripts')}),
    cp(path.join(root, 'scripts', 'start-plugin.ps1'), path.join(plugin, 'start.ps1')),
  ]);
  await writeFile(path.join(plugin, 'server.mjs'), "import './src/mcp.mjs';\n");
  await json(path.join(plugin, 'package.json'), {name: 'graph-viewer', version, private: true, engines});
  await json(path.join(plugin, '.codex-plugin', 'plugin.json'), {
    name: 'graph-viewer', version, description: 'Interactive graphs for the current project and Codex chat.',
    mcpServers: './.mcp.json', skills: './skills', requires_local_executor: true,
    interface: {displayName: 'Graph Viewer', shortDescription: '프로젝트별 그래프와 탐색'},
  });
  await json(path.join(plugin, '.mcp.json'), {mcpServers: {'graph-viewer': {
    command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'start.ps1'], cwd: '.',
    env: {CODEX_MCP_PROTOCOL_VERSION: '2026-07-28'},
  }}});
  return plugin;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await buildPlugin());
