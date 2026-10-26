import {cp, mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = {};
for (let i=2; i<process.argv.length; i+=2) {
  const key=process.argv[i];
  if (!['--output','--data-dir','--log'].includes(key) || !process.argv[i+1] || options[key]) throw new Error('사용법: node scripts/package-mcp.mjs --output <새 절대 경로> [--data-dir <자료 절대 경로>] [--log <진단 파일 절대 경로>]');
  options[key]=process.argv[i+1];
}
if (!options['--output'] || !path.isAbsolute(options['--output'])) throw new Error('--output에 절대 경로가 필요합니다.');
if (options['--data-dir'] && !path.isAbsolute(options['--data-dir'])) throw new Error('--data-dir에 절대 경로가 필요합니다.');
if (options['--log'] && !path.isAbsolute(options['--log'])) throw new Error('--log에 절대 경로가 필요합니다.');
const output=path.resolve(options['--output']);
try {await stat(output);throw new Error('기존 출력 폴더를 덮어쓰지 않습니다: '+output);} catch(error) {if(error.code!=='ENOENT')throw error;}
const plugin=path.join(output,'plugins','graph-viewer');
await cp(path.join(root,'plugins','graph-viewer'),plugin,{recursive:true});
await mkdir(path.join(output,'.agents','plugins'),{recursive:true});
const json=async(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n');
const config=JSON.parse(await readFile(path.join(plugin,'.mcp.json'),'utf8'));
if (options['--data-dir']) config.mcpServers['graph-viewer'].env.GRAPH_PANEL_DATA_DIR=options['--data-dir'];
if (options['--log']) config.mcpServers['graph-viewer'].env.GRAPH_PANEL_LOG=options['--log'];
await json(path.join(plugin,'.mcp.json'),config);
await cp(path.join(root,'.agents','plugins','marketplace.json'),path.join(output,'.agents','plugins','marketplace.json'));
console.log(JSON.stringify({output,plugin,dataDir:options['--data-dir']}));
