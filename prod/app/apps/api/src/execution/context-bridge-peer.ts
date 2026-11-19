import {mkdtemp,chmod,readFile,stat,lstat,rmdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,sign} from 'node:crypto';
import {join,resolve} from 'node:path';
import {spawnWorkspaceProcess} from './workspace-process';
import {currentWorkspaceWriteLease} from './workspace-coordinator';

/** Exact process identity pinned by trusted host preparation, never agent input. */
export type ContextBridgePeerIdentity={pid:number;startTime:string;uid:number};
export type ContextBridgePeerOptions={exchange:(request:unknown)=>Promise<unknown>;signal?:AbortSignal;maxFrameBytes?:number;maxResponseBytes?:number;maxPendingRequests?:number;handshakeTimeoutMs?:number};

export async function readContextBridgePeerIdentity(pid:number):Promise<ContextBridgePeerIdentity>{
  if(process.platform!=='linux'||!Number.isSafeInteger(pid)||pid<1)throw new Error('Context peer identity requires a Linux process.');
  const text=await readFile(`/proc/${pid}/stat`,'utf8'),tail=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);
  if(tail.length<20||tail[0]==='Z'||!/^\d+$/.test(tail[19]))throw new Error('Context peer identity is unavailable.');
  const metadata=await stat(`/proc/${pid}`);
  return {pid,startTime:tail[19],uid:metadata.uid};
}

/** Single-use local endpoint. SO_PEERCRED/pidfd checks run in a tiny Python
 * helper because Node's portable net API does not expose Linux peer credentials.
 * Responses are signed with a per-endpoint host-only Ed25519 key; the entrypoint
 * must verify the public key pinned in host bootstrap, not trust a socket path.
 * This is not a defense against ptrace/procfs or a compromised same-process host.
 */
export async function createContextBridgePeer(options:ContextBridgePeerOptions){
  if(process.platform!=='linux')throw new Error('Context peer transport requires Linux.');
  const lease=currentWorkspaceWriteLease();if(lease)await lease.assertActive();
  const abortInput=lease?AbortSignal.any([lease.signal,...(options.signal?[options.signal]:[])]):options.signal;
  if(abortInput?.aborted)throw new Error('Context peer transport is revoked.');
  const limits={maxFrameBytes:options.maxFrameBytes??4096,maxResponseBytes:options.maxResponseBytes??65536,maxPendingRequests:options.maxPendingRequests??4,handshakeTimeoutMs:options.handshakeTimeoutMs??5000};
  for(const name of ['maxFrameBytes','maxResponseBytes'] as const)if(!Number.isSafeInteger(limits[name])||limits[name]<256||limits[name]>(name==='maxResponseBytes'?1047552:1048576))throw new Error('Invalid context peer limits.');
  if(!Number.isSafeInteger(limits.maxPendingRequests)||limits.maxPendingRequests<1||limits.maxPendingRequests>16||!Number.isSafeInteger(limits.handshakeTimeoutMs)||limits.handshakeTimeoutMs<100||limits.handshakeTimeoutMs>30000)throw new Error('Invalid context peer limits.');
  const script=[resolve(__dirname,'context-bridge-peer.py'),resolve(__dirname,'../../src/execution/context-bridge-peer.py')].find(existsSync);
  if(!script)throw new Error('Context peer helper is unavailable.');
  const directory=await mkdtemp(join(tmpdir(),'orbit-context-peer-'));await chmod(directory,0o700);
  const endpointPath=join(directory,'peer.sock');const controller=new AbortController();
  const keys=generateKeyPairSync('ed25519');const publicKey=keys.publicKey.export({format:'der',type:'spki'}).toString('base64');
  let child:ReturnType<typeof spawnWorkspaceProcess>;
  try{child=spawnWorkspaceProcess('python3',['-I','-B',script],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe'],shell:false})}
  catch(error){await rmdir(directory);throw error}
  let readyResolve!:()=>void,readyReject!:(e:Error)=>void,authResolve!:()=>void,authReject!:(e:Error)=>void;
  const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject});
  const authorized=new Promise<void>((resolve,reject)=>{authResolve=resolve;authReject=reject});void authorized.catch(()=>{});
  let doneResolve!:()=>void;const done=new Promise<void>(resolve=>{doneResolve=resolve});
  let closed=false,pinned=false,buffer=Buffer.alloc(0),closing:Promise<void>|undefined;
  const send=(value:unknown)=>{if(closed||child.stdin?.destroyed)return;child.stdin!.write(JSON.stringify(value)+'\n',error=>{if(error)void close('host_pipe_failure')})};
  const close=(reason='host_closed'):Promise<void>=>{
    if(closing)return closing;
    closed=true;controller.abort(new Error(reason));abortInput?.removeEventListener('abort',onAbort);
    readyReject(new Error('Context peer channel closed.'));authReject(new Error('Context peer channel closed.'));
    if(!child.stdin?.destroyed){child.stdin?.end(JSON.stringify({type:'close'})+'\n')}
    const timer=setTimeout(()=>child.kill('SIGTERM'),1000);timer.unref();
    closing=done.finally(()=>clearTimeout(timer));return closing;
  };
  const onAbort=()=>{void close('host_revoked')};abortInput?.addEventListener('abort',onAbort,{once:true});
  child.stdin!.on('error',()=>{void close('host_pipe_failure')});
  child.stderr!.on('data',()=>{/* Redacted helper diagnostics are intentionally not relayed. */});
  child.stdout!.on('data',(chunk:Buffer)=>{
    if(closed)return;
    buffer=Buffer.concat([buffer,chunk]);
    if(buffer.length>(limits.maxFrameBytes+1024)*(limits.maxPendingRequests+1)){void close('helper_frame_limit');return}
    let at:number;
    while((at=buffer.indexOf(10))>=0){
      const frame=buffer.subarray(0,at);buffer=buffer.subarray(at+1);
      let message:any;try{message=JSON.parse(frame.toString('utf8'))}catch{void close('helper_protocol_failure');return}
      if(message.event==='ready'){readyResolve();continue}
      if(message.event==='authorized'){authResolve();continue}
      if(message.event==='connected')continue;
      if(message.event!=='request'||!Number.isSafeInteger(message.id)){void close('helper_protocol_failure');return}
      const id=message.id;
      void Promise.resolve().then(()=>{if(closed)throw new Error('revoked');return options.exchange(message.request)}).then(response=>{
        if(closed||abortInput?.aborted)return;
        const serialized=JSON.stringify(response);
        if(serialized===undefined||Buffer.byteLength(serialized)>limits.maxResponseBytes){void close('response_frame_limit');return}
        const signature=sign(null,Buffer.from(serialized,'utf8'),keys.privateKey).toString('base64');
        send({type:'response',id,response:{payload:response,signature}});
      },()=>{void close('host_exchange_failure')}).catch(()=>{void close('host_response_failure')});
    }
  });
  child.once('error',()=>{void close('helper_start_failure')});
  child.once('close',()=>{
    closed=true;controller.abort(new Error('Context peer channel ended.'));abortInput?.removeEventListener('abort',onAbort);
    readyReject(new Error('Context peer helper ended.'));authReject(new Error('Context peer helper ended.'));
    // Do not delete unknown replacement paths or recursively remove this folder.
    void (async()=>{try{await lstat(endpointPath)}catch(error:any){if(error?.code==='ENOENT')await rmdir(directory).catch(()=>{})}doneResolve()})();
  });
  send({path:endpointPath,...limits,maxResponseBytes:limits.maxResponseBytes+1024});
  if(abortInput?.aborted)void close('host_revoked');
  const startupTimer=setTimeout(()=>{void close('helper_start_timeout')},limits.handshakeTimeoutMs);startupTimer.unref();
  try{await ready}catch(error){await close('helper_start_failure');throw error}finally{clearTimeout(startupTimer)}
  return {endpointPath,publicKey,signal:controller.signal,done,close,
    async authorizePeer(identity:ContextBridgePeerIdentity){
      if(pinned||closed||abortInput?.aborted)throw new Error('Context peer authorization is closed.');
      pinned=true; // Claim this one-shot authorization before the asynchronous identity read.
      const current=await readContextBridgePeerIdentity(identity.pid);
      if(current.pid!==identity.pid||current.uid!==identity.uid||current.startTime!==identity.startTime||identity.uid!==process.getuid?.())throw new Error('Context peer identity changed.');
      send({type:'authorize',identity});await authorized;
    },
  };
}
