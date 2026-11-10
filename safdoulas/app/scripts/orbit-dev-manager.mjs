import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const environment={...process.env,API_HOST:'127.0.0.1',API_PORT:'4001',WEB_HOSTNAME:'127.0.0.1',WEB_ORIGIN:'http://localhost:3001',ORBIT_API_PROXY_URL:'http://127.0.0.1:4001',ORBIT_ENV:'development',THEME:'dark',PORT:'3001'};
const restartRequest=resolve(root,'.orbit-dev-restart-request');
const restartAcknowledgement=resolve(root,'.orbit-dev-restart-ack');
const managerLock=resolve(root,'.orbit-dev-manager.pid');
const webBuildIdPath=resolve(root,'apps/web/.next/BUILD_ID');
const readWebBuildId=()=>{try{return readFileSync(webBuildIdPath,'utf8').trim()}catch{return ''}};
if(existsSync(managerLock)){
  const activePid=Number(readFileSync(managerLock,'utf8').trim());
  try{
    process.kill(activePid,0);
    console.error(`Orbit DEV já está ativo no processo ${activePid}.`);
    process.exit(1);
  }catch{unlinkSync(managerLock)}
}
writeFileSync(managerLock,`${process.pid}\n`,{flag:'wx'});
function releaseLock(){
  try{if(Number(readFileSync(managerLock,'utf8').trim())===process.pid)unlinkSync(managerLock)}catch{/* Lock already released. */}
}
process.on('exit',releaseLock);
console.log('\nOrbit DEV ativo em http://localhost:3001 (API: http://localhost:4001).\n');
let stopping=false;
let restarting=false;
let webRestarting=false;
let lastWebBuildId=readWebBuildId();
const children=new Map();
const services=new Map([
  ['API',{command:process.execPath,args:[resolve(root,'apps/api/dist/main.js')],cwd:resolve(root,'apps/api')}],
  ['Web',{command:process.execPath,args:[resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname',environment.WEB_HOSTNAME],cwd:resolve(root,'apps/web')}],
]);
const launch=(name,service)=>{
  const child=spawn(service.command,service.args,{cwd:service.cwd,stdio:'inherit',env:environment,detached:process.platform!=='win32'});
  children.set(name,child);
  child.on('exit',(code,signal)=>{
    if(children.get(name)!==child)return;
    children.delete(name);
    if(!stopping&&!restarting&&!(name==='Web'&&webRestarting)){
      console.error(`Orbit DEV ${name} parou (código ${code??'-'}, sinal ${signal??'-'}). Reiniciando em 2s.`);
      setTimeout(()=>{if(!stopping)launch(name,service)},2000).unref();
    }
  });
};
for(const [name,service] of services)launch(name,service);
function signal(child,signal){if(!child.pid)return;try{process.platform==='win32'?child.kill(signal):process.kill(-child.pid,signal)}catch{try{child.kill(signal)}catch{/* The process already stopped. */}}}
const delay=milliseconds=>new Promise(resolveDelay=>setTimeout(resolveDelay,milliseconds));
async function restartWeb(){
  if(stopping||restarting||webRestarting)return;
  webRestarting=true;
  console.log('Novo build Web detectado. Reiniciando Web do Orbit DEV...');
  const child=children.get('Web');
  if(child)signal(child,'SIGTERM');
  await delay(1500);
  if(child&&children.get('Web')===child)signal(child,'SIGKILL');
  children.delete('Web');
  if(!stopping)launch('Web',services.get('Web'));
  webRestarting=false;
}
async function restart(){
  if(stopping||restarting)return;
  restarting=true;
  console.log('Novo build detectado. Reiniciando API e Web do Orbit DEV...');
  while(webRestarting&&!stopping)await delay(100);
  await delay(1500);
  for(const child of children.values())signal(child,'SIGTERM');
  await delay(3000);
  for(const child of children.values())signal(child,'SIGKILL');
  children.clear();
  for(const [name,service] of services)launch(name,service);
  restarting=false;
}
if(existsSync(restartRequest))unlinkSync(restartRequest);
const restartWatcher=setInterval(()=>{
  if(!existsSync(restartRequest))return;
  let requestId='';
  try{requestId=readFileSync(restartRequest,'utf8').trim();unlinkSync(restartRequest);writeFileSync(restartAcknowledgement,`${requestId}\n`)}catch{return}
  lastWebBuildId=readWebBuildId()||lastWebBuildId;
  void restart();
},500);
restartWatcher.unref();
const webBuildWatcher=setInterval(()=>{
  const buildId=readWebBuildId();
  if(!buildId||buildId===lastWebBuildId)return;
  lastWebBuildId=buildId;
  void restartWeb();
},1500);
webBuildWatcher.unref();
async function stop(){stopping=true;for(const child of children.values())signal(child,'SIGTERM');await new Promise(resolveDelay=>setTimeout(resolveDelay,3000));for(const child of children.values())signal(child,'SIGKILL');process.exit(0);}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
