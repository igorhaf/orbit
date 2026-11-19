import {AsyncLocalStorage} from 'node:async_hooks';
import {ChildProcess,execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {FileHandle,open,realpath,stat,statfs,readFile,mkdir,readdir,unlink,lstat,link} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const storage=new AsyncLocalStorage<WorkspaceWriteLease>();
const coverage=new WeakMap<WorkspaceWriteLease,Resource[]>();
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const contains=(parent:string,child:string)=>{const path=relative(parent,child);return path===''||!path.startsWith('..')&&!isAbsolute(path)};
const directory=()=>`/tmp/orbit-write-coordination-${process.getuid?.()}`;
type Resource={path:string;dev:number;ino:number};
type Client={query:(sql:string,params?:unknown[])=>Promise<{rows:any[]}>;on:(event:'error',listener:(error:Error)=>void)=>unknown;removeListener:(event:'error',listener:(error:Error)=>void)=>unknown;release:(destroy?:boolean)=>void};
type Database={pool:{connect:()=>Promise<Client>}};
export type WorkspaceWriteLeaseRequest={queue:string;runId:string;cardId:string;projectId:string;projectRoot:string;workingDirectory?:string;signal?:AbortSignal;onState?:(state:string)=>void};
export interface WorkspaceWriteLease {owner:string;resource:string;signal:AbortSignal;assertActive():Promise<void>;descriptors():number[];trackProcess(child:ChildProcess):void;poison(reason:string):void}
export function currentWorkspaceWriteLease(){return storage.getStore()}
export async function assertWorkspaceWriteCoverage(path:string){const lease=storage.getStore();if(!lease)throw new WorkspaceCoordinationError('Proteção compartilhada ausente.');await lease.assertActive();const target=await realpath(path);if(!(coverage.get(lease)||[]).some(root=>contains(root.path,target)))throw new WorkspaceCoordinationError('A operação está fora da área física protegida.');}
export class WorkspaceCoordinationError extends Error{constructor(message:string,readonly code='WORKSPACE_COORDINATION_CONFLICT'){super(message);this.name='WorkspaceCoordinationError'}}
function stopped(signal?:AbortSignal){if(signal?.aborted)throw new WorkspaceCoordinationError('Execução cancelada enquanto aguardava o workspace.','WORKSPACE_WAIT_CANCELLED')}
async function inode(path:string):Promise<Resource>{const value=await stat(path);if(!value.isDirectory())throw new WorkspaceCoordinationError('O recurso físico não é um diretório.');return {path,dev:value.dev,ino:value.ino}}
async function physical(path:string){return inode(await realpath(path))}
async function mountSafety(path:string){
  const supported=new Set([0xef53,0x58465342,0x9123683e,0x01021994,0x794c7630]);
  if(!supported.has(Number((await statfs(path)).type)>>>0))throw new WorkspaceCoordinationError('Filesystem não homologado para exclusividade local; execução bloqueada.');
  const unescape=(value:string)=>value.replace(/\\([0-7]{3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)));
  const mounts=(await readFile('/proc/self/mountinfo','utf8')).trim().split('\n').map(line=>{const fields=line.split(' ');return {root:unescape(fields[3]),point:unescape(fields[4])}});
  const parents=mounts.filter(m=>contains(m.point,path)).sort((a,b)=>b.point.length-a.point.length);
  if(!parents.length||parents[0].root!=='/'||mounts.some(m=>m.point!==path&&contains(path,m.point)))throw new WorkspaceCoordinationError('Bind mounts ou mounts aninhados impedem identificar a árvore física com segurança.');
}
async function gitRoots(path:string):Promise<string[]>{
  const env={PATH:process.env.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'};
  try{
    const top=(await exec('git',['-C',path,'rev-parse','--show-toplevel'],{env,timeout:3000})).stdout.trim();
    const common=(await exec('git',['-C',path,'rev-parse','--git-common-dir'],{env,timeout:3000})).stdout.trim();
    return [await realpath(top),await realpath(resolve(path,common))];
  }catch(error){
    for(let parent=path;;parent=dirname(parent)){
      try{await lstat(join(parent,'.git'));throw new WorkspaceCoordinationError('A raiz Git existe, mas não pôde ser resolvida com segurança.')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
      if(parent===dirname(parent))break;
    }
    return [];
  }
}
async function resources(request:WorkspaceWriteLeaseRequest){
  if(process.platform!=='linux'||!process.getuid)throw new WorkspaceCoordinationError('Coordenação física exige Linux e flock; não há fallback inseguro.');
  const project=await physical(request.projectRoot),work=await physical(request.workingDirectory||request.projectRoot);
  if(!contains(project.path,work.path))throw new WorkspaceCoordinationError('Diretório de execução fora da raiz física do projeto.');
  const candidates=[project.path,...await gitRoots(project.path),...await gitRoots(work.path)];
  const paths=[...new Set(candidates)].sort().filter((path,_,all)=>!all.some(other=>other!==path&&contains(other,path)));
  const roots=await Promise.all(paths.map(physical));
  for(const root of roots){await mountSafety(root.path);if((await stat(root.path)).uid!==process.getuid())throw new WorkspaceCoordinationError('A raiz deve pertencer ao mesmo usuário do coordenador; múltiplos UIDs não são homologados.');}
  return {roots,project,work};
}
async function markerDirectory(){
  const path=directory();
  await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error});
  const entry=await lstat(path);
  if(!entry.isDirectory()||entry.isSymbolicLink()||entry.uid!==process.getuid?.()||(entry.mode&0o077)!==0)throw new WorkspaceCoordinationError('Diretório de ownership inseguro.');
  return path;
}
async function closeHandles(handles:FileHandle[]){for(const handle of handles.reverse())await handle.close().catch(()=>undefined)}
async function tryPhysicalLocks(roots:Resource[]){
  const paths=new Map<string,boolean>();
  for(const root of roots){for(let p=root.path;;p=dirname(p)){paths.set(p,paths.get(p)||p===root.path);if(p===dirname(p))break}}
  const handles:FileHandle[]=[];
  try{
    for(const [path,exclusive] of [...paths].sort(([a],[b])=>a.length-b.length||a.localeCompare(b))){
      const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);handles.push(handle);
      const {spawn}=await import('node:child_process');
      const code=await new Promise<number|null>((done,reject)=>{const child=spawn('/usr/bin/flock',['-n',exclusive?'-x':'-s','3'],{stdio:['ignore','ignore','ignore',handle.fd]});child.once('error',reject);child.once('close',done)});
      if(code!==0){await closeHandles(handles);return null}
    }
    return handles;
  }catch(error){await closeHandles(handles);throw error}
}
async function readMarkers(path:string){
  const values:any[]=[];
  for(const file of await readdir(path)){
    if(!file.endsWith('.json'))continue;
    let handle:FileHandle;
    try{handle=await open(join(path,file),constants.O_RDONLY|constants.O_NOFOLLOW)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error}
    try{const entry=await handle.stat();if(entry.size>65536||entry.uid!==process.getuid?.())throw new Error('Invalid marker');values.push(JSON.parse(await handle.readFile('utf8')))}finally{await handle.close()}
  }
  return values;
}
async function overlaps(marker:any,roots:Resource[]){
  if(!Array.isArray(marker.roots))throw new WorkspaceCoordinationError('Ownership inválido; exige revisão manual.');
  for(const old of marker.roots)for(const root of roots){
    if(typeof old.path!=='string'||!isAbsolute(old.path))throw new WorkspaceCoordinationError('Ownership inválido.');
    if(contains(old.path,root.path)||contains(root.path,old.path)||old.dev===root.dev&&old.ino===root.ino)return true;
    for(let p=root.path;;p=dirname(p)){const value=await stat(p);if(value.dev===old.dev&&value.ino===old.ino)return true;if(p===dirname(p))break}
  }
  return false;
}
export async function withWorkspaceWriteLease<T>(db:Database,request:WorkspaceWriteLeaseRequest,callback:(lease:WorkspaceWriteLease)=>Promise<T>):Promise<T>{
  stopped(request.signal);
  const identities=await resources(request),{roots}=identities;
  const nested=storage.getStore();
  if(nested){await nested.assertActive();if(!roots.every(root=>(coverage.get(nested)||[]).some(parent=>contains(parent.path,root.path))))throw new WorkspaceCoordinationError('Uma operação aninhada não pode ampliar a área protegida.');return callback(nested)}
  const markerRoot=await markerDirectory();let handles:FileHandle[]|null=null,client:Client|undefined;
  const state=(phase:string)=>request.onState?.(phase);
  state('waiting_workspace');
  try{
    while(!handles){stopped(request.signal);handles=await tryPhysicalLocks(roots);if(!handles){await delay(100);continue}
      for(const marker of await readMarkers(markerRoot))if(await overlaps(marker,roots)){state('blocked_workspace');throw new WorkspaceCoordinationError('Workspace em quarentena por interrupção anterior; não há retomada automática de ownership.','WORKSPACE_QUARANTINED')}
      client=await db.pool.connect();let acquired=true;
      for(const root of roots){const key=BigInt.asIntN(64,BigInt('0x'+hash(`${root.dev}:${root.ino}`).slice(0,16))).toString();const value=await client.query('SELECT pg_try_advisory_lock($1::bigint) AS locked',[key]);if(!value.rows[0]?.locked){acquired=false;break}}
      if(!acquired){client.release(true);client=undefined;await closeHandles(handles);handles=null;await delay(100)}
    }
    stopped(request.signal);
    const owner=randomUUID(),markerPath=join(markerRoot,owner+'.json'),controller=new AbortController();
    const marker={owner,queue:request.queue,runId:request.runId,cardId:request.cardId,projectId:request.projectId,pid:process.pid,roots,createdAt:new Date().toISOString()};
    const temporaryMarker=join(markerRoot,owner+'.tmp');
    const file=await open(temporaryMarker,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await file.writeFile(JSON.stringify(marker));await file.sync();await link(temporaryMarker,markerPath)}finally{await file.close();await unlink(temporaryMarker).catch(()=>undefined)}
    let poison:string|null=null,finished=false;const processes=new Set<Promise<void>>();
    const fail=(reason:string)=>{poison=poison||reason;controller.abort(new WorkspaceCoordinationError(reason,'WORKSPACE_PROTECTION_LOST'));state('interrupted_workspace')};
    const aborted=()=>controller.abort(request.signal?.reason);request.signal?.addEventListener('abort',aborted,{once:true});
    const connectionError=(error:Error)=>fail(`Conexão de coordenação perdida: ${error.message}`);client!.on('error',connectionError);
    const lease:WorkspaceWriteLease={owner,resource:roots[0].path,signal:controller.signal,
      async assertActive(){if(finished||poison||controller.signal.aborted)throw new WorkspaceCoordinationError(poison||'A execução deixou de ter autorização de escrita.','WORKSPACE_PROTECTION_LOST');for(const value of [...roots,identities.project,identities.work]){const current=await physical(value.path);if(current.dev!==value.dev||current.ino!==value.ino){fail('A identidade física do workspace mudou.');throw new WorkspaceCoordinationError('Identidade física alterada.')}}},
      descriptors(){if(finished||controller.signal.aborted)throw new WorkspaceCoordinationError('Proteção indisponível.');return handles!.map(handle=>handle.fd)},
      poison:fail,
      trackProcess(child){const waiting=new Promise<void>(resolve=>{let killTimer:ReturnType<typeof setTimeout>|undefined;const stop=()=>{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),6000);killTimer.unref()};controller.signal.addEventListener('abort',stop,{once:true});const done=()=>{if(killTimer)clearTimeout(killTimer);controller.signal.removeEventListener('abort',stop);resolve()};child.once('error',()=>{fail('Falha ao iniciar supervisor.');done()});child.once('close',(code,signal)=>{if(signal||code===null||code===125)fail('Supervisor terminou sem comprovação de drenagem.');done()});if(controller.signal.aborted)stop()});processes.add(waiting);void waiting.finally(()=>processes.delete(waiting))},
    };
    coverage.set(lease,roots);
    let checking=false;
    const heartbeat=setInterval(()=>{if(checking||finished)return;checking=true;let timer:ReturnType<typeof setTimeout>;void Promise.race([client!.query('SELECT 1 AS workspace_guard_heartbeat'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Heartbeat de coordenação expirou.')),1500)})]).catch(error=>fail(String(error.message))).finally(()=>{clearTimeout(timer);checking=false})},500);heartbeat.unref();
    let callbackCompleted=false;
    try{await lease.assertActive();state('active_workspace');const result=await storage.run(lease,()=>callback(lease));await lease.assertActive();callbackCompleted=true;return result}
    finally{
      clearInterval(heartbeat);
      // Never close directory descriptors while a known supervisor is still alive.
      if(processes.size){if(callbackCompleted)fail('Execução retornou com processos mutáveis ainda ativos.');else controller.abort(new Error('A execução falhou; drenando processos.'));}
      while(processes.size)await Promise.all([...processes]);
      try{if(!poison){for(const value of [...roots,identities.project,identities.work]){const current=await physical(value.path);if(current.dev!==value.dev||current.ino!==value.ino)throw new Error('Workspace identity changed')}await unlink(markerPath)}}catch(error){poison=String(error);}
      finished=true;request.signal?.removeEventListener('abort',aborted);client!.removeListener('error',connectionError);
      state(poison?'quarantined_workspace':'released_workspace');
      if(poison)throw new WorkspaceCoordinationError(poison,'WORKSPACE_PROTECTION_LOST');
    }
  }finally{if(client)client.release(true);if(handles)await closeHandles(handles)}
}
