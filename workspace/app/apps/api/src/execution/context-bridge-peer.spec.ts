import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {createPublicKey,verify} from 'node:crypto';
import {createContextBridgePeer,readContextBridgePeerIdentity} from './context-bridge-peer';

function client(path:string){
  const script=`const net=require('node:net');const s=net.connect(process.argv[1]);s.on('error',()=>process.exit(4));s.on('close',()=>process.exit(0));s.on('data',b=>process.stdout.write(b));process.stdin.on('data',b=>s.write(b));process.stdin.on('end',()=>s.end());`;
  return spawn(process.execPath,['-e',script,path],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
}
async function dispose(child:ChildProcess){if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit')}}
type PeerReply={payload:unknown;signature:string};
function reply(child:ChildProcess,request:unknown):Promise<PeerReply>{return new Promise((resolve,reject)=>{let text='';const data=(b:Buffer)=>{text+=b;if(text.includes('\n')){child.stdout!.off('data',data);resolve(JSON.parse(text.split('\n')[0]) as PeerReply)}};child.stdout!.on('data',data);child.once('error',reject);child.stdin!.write(JSON.stringify(request)+'\n')})}

test('F7/F8 exact kernel PID,starttime,UID permit only pinned process; endpoint is one-use',{timeout:10000},async t=>{
 let requests=0;const host=await createContextBridgePeer({exchange:async request=>{requests++;return {echo:request}},handshakeTimeoutMs:5000});
 const wrong=client(host.endpointPath),right=client(host.endpointPath);t.after(async()=>{await host.close();await dispose(wrong);await dispose(right)});
 await host.authorizePeer(await readContextBridgePeerIdentity(right.pid!));
 const answer=await reply(right,{authorized:'fixture'});assert.deepEqual(answer.payload,{echo:{authorized:'fixture'}});assert.equal(verify(null,Buffer.from(JSON.stringify(answer.payload)),createPublicKey({key:Buffer.from(host.publicKey,'base64'),format:'der',type:'spki'}),Buffer.from(answer.signature,'base64')),true);assert.equal(requests,1);
 if(wrong.exitCode===null&&wrong.signalCode===null)await once(wrong,'exit');assert.equal(existsSync(host.endpointPath),false);
 await assert.rejects(async()=>host.authorizePeer(await readContextBridgePeerIdentity(right.pid!)),/closed/);
 await host.close();assert.equal(host.signal.aborted,true);
});

test('F9/F10 revocation suppresses pending host response and endpoint reuse',{timeout:10000},async t=>{
 let resolveExchange!:(v:unknown)=>void;let started!:(v:unknown)=>void;const startedPromise=new Promise(resolve=>{started=resolve});
 const abort=new AbortController();const host=await createContextBridgePeer({exchange:()=>{started(null);return new Promise(resolve=>{resolveExchange=resolve})},signal:abort.signal});
 const child=client(host.endpointPath);t.after(async()=>{await host.close();await dispose(child)});await host.authorizePeer(await readContextBridgePeerIdentity(child.pid!));
 let received='';child.stdout!.on('data',b=>received+=b);child.stdin!.write('{"request":"pending"}\n');await startedPromise;
 abort.abort();await host.done;resolveExchange({secret:'LATE'});await new Promise(resolve=>setImmediate(resolve));assert.equal(received,'');assert.equal(existsSync(host.endpointPath),false);
});

test('F7 mismatched birth identity refused before helper authorization',{timeout:10000},async t=>{
 const host=await createContextBridgePeer({exchange:async()=>({})});t.after(()=>host.close());const identity=await readContextBridgePeerIdentity(process.pid);
 await assert.rejects(()=>host.authorizePeer({...identity,startTime:'0'}),/changed/);await host.close();assert.equal(host.signal.aborted,true);
});

test('F14 input frame limit and handshake timeout fail closed',{timeout:10000},async t=>{
 let calls=0;const host=await createContextBridgePeer({exchange:async()=>{calls++;return {}},maxFrameBytes:256});const child=client(host.endpointPath);
 t.after(async()=>{await host.close();await dispose(child)});await host.authorizePeer(await readContextBridgePeerIdentity(child.pid!));child.stdin!.write(JSON.stringify({body:'x'.repeat(600)})+'\n');await host.done;assert.equal(calls,0);assert.equal(host.signal.aborted,true);
 // A deliberately tiny deadline may expire before Python is scheduled. Both
 // startup refusal and a ready channel later timing out must fail closed.
 const idle=await createContextBridgePeer({exchange:async()=>({}),handshakeTimeoutMs:100}).catch(error=>{assert.match(String(error),/closed|ended/);return null});
 if(idle){await idle.done;assert.equal(idle.signal.aborted,true);assert.equal(existsSync(idle.endpointPath),false);}
});
