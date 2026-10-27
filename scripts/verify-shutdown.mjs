import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';

const script = fileURLToPath(import.meta.url);
const launcher = path.resolve('plugins/graph-viewer/start.ps1');
const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
function query(command) {return execFileSync(powershell, ['-NoProfile','-Command',command], {encoding:'utf8',windowsHide:true}).trim();}
if (process.argv[2] === '--owner') {
  const child = spawn(process.execPath, [path.join(path.dirname(launcher), 'server.mjs')], {windowsHide:true, stdio:'inherit'});
  console.log(JSON.stringify({launcherPid:child.pid}));
  child.on('exit',code=>{process.exitCode=code;});
} else if (process.argv[2] === '--host') {
  const child = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher], {windowsHide:true, stdio:['pipe','pipe','pipe']});
  console.log(JSON.stringify({launcherPid:child.pid}));
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.stdin.on('error', () => {});
  child.on('exit', code => {process.exitCode=code;process.stdin.destroy();});
} else if (option('capture') || option('check')) {
  const processes = JSON.parse(query(`$items = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'powershell.exe'" | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;parent=$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o');graph=($_.Name -eq 'node.exe' -and $_.CommandLine -match 'plugins[\\/]cache[\\/]graph-viewer[\\/]graph-viewer[\\/].*server.mjs')} }; ConvertTo-Json -InputObject @($items) -Compress`));
  if (option('capture')) {
    const servers = processes.filter(item => item.graph);
    const launchers = processes.filter(item => servers.some(server => server.parent === item.pid));
    const record = {capturedAt: new Date().toISOString(), servers, launchers};
    writeFileSync(path.resolve(option('capture')), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify({servers: servers.length, launchers: launchers.length, output: path.resolve(option('capture'))}));
  } else {
    const record = JSON.parse(readFileSync(option('check'), 'utf8'));
    const remaining = [...record.servers, ...record.launchers].filter(before => processes.some(current => current.pid === before.pid && current.created === before.created));
    record.checkedAt = new Date().toISOString(); record.remaining = remaining;
    writeFileSync(path.resolve(option('check')), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify({tracked: record.servers.length + record.launchers.length, remaining, allStopped: remaining.length === 0}));
    if (remaining.length) process.exitCode = 1;
  }
} else {
  function alive(pid) {try {process.kill(pid,0);return true;}catch{return false;}}
  const results=[];
  const repeat=Number(process.argv.find(arg=>arg.startsWith('--repeat='))?.split('=')[1] || 1);
  for (const mode of Array.from({length:repeat},()=>['disconnect','host-killed','launcher-killed','parent-killed-open-input']).flat()) {
    let pipe, writer, reader;
    if (mode === 'parent-killed-open-input') {
      const name=String.raw`\\.\pipe\graph-viewer-shutdown-${process.pid}-${Date.now()}`;
      pipe=net.createServer();pipe.listen(name);await once(pipe,'listening');
      const connected=once(pipe,'connection');writer=net.connect(name);[reader]=await connected;
    }
    const host=spawn(process.execPath,[script,pipe?'--owner':'--host'],{windowsHide:true,stdio:[reader || 'pipe','pipe','pipe']});
    const input=writer || host.stdin;
    let output='',stderr='',relayPid,serverPid;
    host.stdout.on('data',data=>{output+=data;relayPid ??= Number(output.match(/"launcherPid":(\d+)/)?.[1]);});
    host.stderr.on('data',data=>{stderr+=data;});
    input.on('error',()=>{});
    const readyAt=Date.now();
    input.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'isolated-shutdown-host',version:'1'}}})+'\n');
    try {
      while (!output.includes('"id":1') && Date.now()-readyAt<15000) await new Promise(resolve=>setTimeout(resolve,50));
      if (pipe) {serverPid=relayPid;relayPid=host.pid;}
      else if (relayPid) serverPid=Number(query(`Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${relayPid}' | Where-Object Name -eq 'node.exe' | Select-Object -First 1 -ExpandProperty ProcessId`));
      assert.ok(output.includes('"id":1'), `MCP initialization timeout: ${stderr}`);
      assert.ok(serverPid, 'MCP server PID not found');
      const began=Date.now();
      if (mode==='disconnect') input.end();
      else if(mode==='host-killed' || pipe) host.kill();
      else query(`Stop-Process -Id ${relayPid} -Force`);
      while ((alive(relayPid)||alive(serverPid)) && Date.now()-began<5000) await new Promise(resolve=>setTimeout(resolve,50));
      const result={mode,shutdownMs:Date.now()-began,launcherStopped:!alive(relayPid),serverStopped:!alive(serverPid)};
      results.push(result);console.log(JSON.stringify(result));
      assert.ok(result.launcherStopped && result.serverStopped, `Processes survived ${mode}`);
    } finally {
      input.end();reader?.destroy();writer?.destroy();pipe?.close();
      for(const pid of [serverPid,relayPid,host.pid]) if(pid && alive(pid)) process.kill(pid);
    }
  }
  console.log(JSON.stringify({passed:results.length,scope:'isolated host process; live Codex app was not stopped'}));
}
