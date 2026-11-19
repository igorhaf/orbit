import {connect} from 'node:net';
import {randomUUID,createPublicKey,verify} from 'node:crypto';
import type {Readable,Writable} from 'node:stream';
import {ContextBridgeMcpAdapter,contextBridgeMcpBinding} from './context-bridge-mcp';
import type {ContextBridgeLimits} from './context-bridge';

/** Public routing data only. Authority is the host-pinned kernel peer identity,
 * not this path, any run id, environment value or argument supplied to Node. */
export type ContextBridgeMcpBootstrap={endpointPath:string;publicKey:string;limits:ContextBridgeLimits;presentation?:'structured'|'text'};
export async function runContextBridgeMcpEntrypoint(bootstrap:ContextBridgeMcpBootstrap,input:Readable,output:Writable,signal?:AbortSignal):Promise<void>{
  const l=bootstrap.limits;
  if(typeof bootstrap.endpointPath!=='string'||!bootstrap.endpointPath.startsWith('/')||Buffer.byteLength(bootstrap.endpointPath)>100||!l||!Number.isSafeInteger(l.requestTimeoutMs)||l.requestTimeoutMs<1||l.requestTimeoutMs>30000||!Number.isSafeInteger(l.maxResponseBytes)||l.maxResponseBytes<1024||l.maxResponseBytes>65536||!Number.isSafeInteger(l.maxConcurrent)||l.maxConcurrent<1||l.maxConcurrent>16||!Number.isSafeInteger(l.maxTotalBytes)||l.maxTotalBytes<l.maxResponseBytes+256||l.maxTotalBytes>1000000||!Number.isSafeInteger(l.maxRequests)||l.maxRequests<1||l.maxRequests>1024||bootstrap.presentation!==undefined&&!['structured','text'].includes(bootstrap.presentation))throw new Error('Invalid MCP bootstrap.');
  const publicKey=createPublicKey({key:Buffer.from(bootstrap.publicKey,'base64'),format:'der',type:'spki'});
  if(publicKey.asymmetricKeyType!=='ed25519')throw new Error('Invalid Bridge host key.');
  const controller=new AbortController();const socket=connect({path:bootstrap.endpointPath});
  const pending=new Map<string,{resolve:(r:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  let buffer=Buffer.alloc(0),failure:Error|undefined;
  const stop=()=>{if(controller.signal.aborted)return;controller.abort();socket.destroy();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Bridge transport closed.'))}pending.clear()};
  const externalAbort=()=>{failure=new Error('Bridge execution cancelled.');stop()};
  signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();
  socket.on('error',()=>{failure=new Error('Bridge transport failed.');stop()});socket.on('close',()=>{if(!controller.signal.aborted)failure=new Error('Bridge transport lost.');stop()});
  socket.on('data',(chunk:Buffer)=>{
    if(controller.signal.aborted)return;
    buffer=Buffer.concat([buffer,chunk]);if(buffer.length>(l.maxResponseBytes+1536)*(l.maxConcurrent+1)){failure=new Error('Bridge frame limit.');stop();return}
    let at:number;while((at=buffer.indexOf(10))>=0){const frame=buffer.subarray(0,at);buffer=buffer.subarray(at+1);try{
      if(frame.length>l.maxResponseBytes+1536)throw new Error();const envelope=JSON.parse(frame.toString('utf8'));
      if(typeof envelope.signature!=='string'||!envelope.payload||!verify(null,Buffer.from(JSON.stringify(envelope.payload)),publicKey,Buffer.from(envelope.signature,'base64')))throw new Error();
      const response=envelope.payload;if(Buffer.byteLength(JSON.stringify(response))>l.maxResponseBytes+256)throw new Error();
      if(response.jsonrpc!=='2.0'||typeof response.id!=='string'||!pending.has(response.id)||Boolean('result' in response)===Boolean('error' in response))throw new Error();
      const p=pending.get(response.id)!;pending.delete(response.id);clearTimeout(p.timer);response.error?p.reject(new Error('Bridge request refused.')):p.resolve(response.result);
    }catch{failure=new Error('Invalid Bridge frame.');stop();return}}
  });
  const exchange=(method:string,params:unknown):Promise<any>=>new Promise((resolve,reject)=>{
    if(controller.signal.aborted||pending.size>=l.maxConcurrent+1){reject(new Error('Bridge is unavailable.'));return}
    const id=randomUUID(),line=JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n';
    if(Buffer.byteLength(line)>(l.maxRequestBytes??4096)){reject(new Error('Bridge request limit.'));return}
    const timer=setTimeout(()=>{failure=new Error('Bridge timeout.');stop()},l.requestTimeoutMs);pending.set(id,{resolve,reject,timer});socket.write(line,error=>{if(error){failure=new Error('Bridge write failed.');stop()}});
  });
  let adapter:ContextBridgeMcpAdapter|undefined;
  try{
    const init=await exchange('initialize',{protocolVersion:'orbit-context-bridge/1'});if(init?.protocolVersion!=='orbit-context-bridge/1')throw new Error('Bridge protocol mismatch.');
    adapter=new ContextBridgeMcpAdapter({query:request=>exchange('capabilities/call',{request}),close:stop,signal:controller.signal,...contextBridgeMcpBinding(init)},{maxFrameBytes:l.maxRequestBytes??4096,maxResponseBytes:l.maxResponseBytes+256,maxTransportBytes:l.maxTotalBytes,maxPendingRequests:l.maxConcurrent,maxMessages:l.maxRequests+4},bootstrap.presentation??'structured');
    await adapter.attach(input,output).done;if(failure)throw failure;
  }finally{await adapter?.close();stop();signal?.removeEventListener('abort',externalAbort)}
}

if(require.main===module){
  const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
  void (async()=>{
    const raw=process.env.ORBIT_CONTEXT_BRIDGE_BOOTSTRAP;
    if(!raw||Buffer.byteLength(raw)>4096)throw new Error('MCP bootstrap missing.');
    await runContextBridgeMcpEntrypoint(JSON.parse(raw),process.stdin,process.stdout,controller.signal);
  })().then(()=>{process.stdin.destroy();process.exitCode=0},()=>{process.stderr.write('Orbit MCP closed: bootstrap, authority or transport failure.\n');process.stdin.destroy();process.exitCode=1});
}
