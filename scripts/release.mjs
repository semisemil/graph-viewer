import {execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPlugin, plugin} from './build-plugin.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args, env = process.env) => execFileSync('git', args, {cwd: root, env, encoding: 'utf8', windowsHide: true}).trim();
if (git(['branch', '--show-current']) !== 'dev') throw new Error('dev 브랜치에서 실행하세요.');
if (git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('개발 변경을 먼저 커밋하세요.');
if (git(['worktree', 'list', '--porcelain']).split('\n').includes('branch refs/heads/main')) throw new Error('main 브랜치를 사용 중인 작업 폴더가 있습니다.');
const source = git(['rev-parse', 'HEAD']);
const previous = git(['rev-parse', 'refs/heads/main']);

await buildPlugin();
execFileSync(process.execPath, ['--test', 'test/*.test.mjs'], {cwd: root, stdio: 'inherit', windowsHide: true});
if (git(['rev-parse', 'HEAD']) !== source || git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('검사 중 개발 변경이 생겼습니다. 다시 실행하세요.');

const temporaryRoot = path.join(root, '.local', 'releases');
await mkdir(temporaryRoot, {recursive: true});
const temporary = await mkdtemp(path.join(temporaryRoot, 'publish-'));
try {
  const output = path.join(temporary, 'tree');
  await cp(plugin, output, {recursive: true});
  for (const file of [
    'README.md', '.gitignore', 'docs/architecture.md', 'docs/architecture-contracts.md', 'docs/development.md',
    'docs/images/investigation.jpg', 'examples/system-map.json', 'examples/request-latency.json', 'examples/request-latency.mmd',
  ]) {
    await mkdir(path.dirname(path.join(output, file)), {recursive: true});
    await cp(path.join(root, file), path.join(output, file));
  }
  const catalog = JSON.parse(await readFile(path.join(root, '.agents/plugins/marketplace.json'), 'utf8'));
  catalog.plugins[0].source.path = '.';
  await mkdir(path.join(output, '.agents/plugins'), {recursive: true});
  await writeFile(path.join(output, '.agents/plugins/marketplace.json'), JSON.stringify(catalog, null, 2) + '\n');
  await writeFile(path.join(output, '.gitattributes'), '* text=auto\nsrc/mcp.mjs -diff -text linguist-generated=true\nsrc/mcp.mjs.LEGAL.txt -whitespace\nTHIRD_PARTY_NOTICES.txt -whitespace\n');
  const env = {...process.env, GIT_INDEX_FILE: path.join(temporary, 'index')};
  git(['--work-tree', output, 'read-tree', '--empty'], env);
  git(['--work-tree', output, 'add', '--all', '--force'], env);
  const tree = git(['write-tree'], env);
  let commit = previous;
  if (tree !== git(['rev-parse', 'main^{tree}'])) {
    const {version} = JSON.parse(await readFile(path.join(plugin, 'package.json'), 'utf8'));
    commit = git(['commit-tree', tree, '-p', previous, '-m', `Publish Graph Viewer ${version} from ${source.slice(0, 7)}`]);
    git(['update-ref', 'refs/heads/main', commit, previous]);
  }
  console.log(JSON.stringify({branch: 'main', commit, source, changed: commit !== previous}));
} finally {
  const target = path.resolve(temporary);
  if (!target.startsWith(path.resolve(temporaryRoot) + path.sep)) throw new Error('임시 배포 폴더 경로가 잘못되었습니다.');
  await rm(target, {recursive: true, force: true});
}
