import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {ContextBridgeAdapter,contextBridgeProtocol,contextBridgeReadCapabilities} from './context-bridge-adapter';

const rpc=(id:string|number,method:string,params?:unknown)=>({jsonrpc:'2.0',id,method,...(params===undefined?{}:{params})});
const initialize=(adapter:ContextBridgeAdapter)=>adapter.handleJsonRpc(rpc(1,'initialize',{protocolVersion:contextBridgeProtocol}));
const call=(id:string|number=2)=>rpc(id,'capabilities/call',{request:{schemaVersion:1,id:'query-'+id,capability:'context.describe',parameters:{}}});
function fixture(options:ConstructorParameters<typeof ContextBridgeAdapter>[1]={}){
  const queries:unknown[]=[],closed:string[]=[];
  const adapter=new ContextBridgeAdapter({query:async request=>{queries.push(request);return {status:'ok',data:{revision:1},delivery:'unverified'}},close:reason=>{closed.push(reason??'none')}},options);
  return {adapter,queries,closed};
}

test('B1 local protocol initializes deterministically and exposes only five read-only capabilities',async()=>{
  const f=fixture();const before=await f.adapter.handleJsonRpc(call());assert.equal(before?.error?.code,-32002);
  const hello=await initialize(f.adapter);assert.deepEqual((hello?.result as {capabilities:unknown}).capabilities,[...contextBridgeReadCapabilities]);
  assert.equal((hello?.result as {mcpCompatibility:string}).mcpCompatibility,'not_demonstrated');
  assert.equal((await f.adapter.handleJsonRpc(rpc(2,'initialize',{protocolVersion:contextBridgeProtocol})))?.error?.code,-32602);
  assert.equal((await f.adapter.handleJsonRpc(rpc(3,'tools/call',{name:'git.write'})))?.error?.code,-32601);
  assert.equal(f.queries.length,0);await f.adapter.close();
});

test('B2/B5 adapter forwards only structured intent to its host-bound broker handle',async()=>{
  const f=fixture();await initialize(f.adapter);
  const response=await f.adapter.handleJsonRpc(call());assert.equal((response?.result as {status:string}).status,'ok');assert.equal(f.queries.length,1);
  assert.equal((await f.adapter.handleJsonRpc({...call(),runtimeId:'other-runtime'}))?.error?.code,-32600);
  assert.equal((await f.adapter.handleJsonRpc(rpc(3,'capabilities/call',{request:{capability:'cards.write'}})))?.error?.code,-32602);
  assert.equal((await f.adapter.handleJsonRpc(rpc('á'.repeat(60),'ping')))?.id,null);
  assert.equal(f.queries.length,1);await f.adapter.close();
});

test('B14 closing an adapter revokes its bound handle and an old channel cannot be replayed',async()=>{
  const f=fixture();await initialize(f.adapter);await f.adapter.close('turn_finished');await f.adapter.close('again');
  assert.equal((await f.adapter.handleJsonRpc(call()))?.error?.code,-32001);assert.equal(f.queries.length,0);assert.deepEqual(f.closed,['turn_finished']);
});

test('B9 response/frame and whole-transport limits fail closed without reflecting private errors',async()=>{
  const f=fixture({maxFrameBytes:256});assert.equal((await f.adapter.handleJsonRpc(rpc(1,'initialize',{protocolVersion:contextBridgeProtocol,extra:'x'.repeat(300)})))?.error?.code,-32600);await f.adapter.close();
  const adapter=new ContextBridgeAdapter({query:async()=>{throw new Error('/private/secret/socket credential')},close(){} });await initialize(adapter);
  const error=await adapter.handleJsonRpc(call());assert.equal(error?.error?.code,-32603);assert.ok(!JSON.stringify(error).includes('credential'));await adapter.close();
  const oversized=new ContextBridgeAdapter({query:async()=>({body:'x'.repeat(10000)}),close(){}},{maxResponseBytes:512});await initialize(oversized);
  assert.equal((await oversized.handleJsonRpc(call()))?.error?.code,-32004);await oversized.close();
  const limited=fixture({maxMessages:2});await initialize(limited.adapter);await limited.adapter.handleJsonRpc(rpc(2,'ping'));assert.equal((await limited.adapter.handleJsonRpc(rpc(3,'ping')))?.error?.code,-32003);assert.equal(limited.closed.length,1);
  const overall=fixture({maxTransportBytes:512});await initialize(overall.adapter);
  for(let id=2;id<12;id++)await overall.adapter.handleJsonRpc(rpc(id,'ping'));
  await overall.adapter.close();assert.equal(overall.closed.length,1);assert.equal(overall.queries.length,0);
  assert.equal((await overall.adapter.handleJsonRpc(call(12)))?.error?.code,-32001);
});

test('B10 adapter bounds in-flight calls independently of broker accounting',async()=>{
  let release:(value:unknown)=>void=()=>{};let calls=0;
  const adapter=new ContextBridgeAdapter({query:async()=>{calls++;return new Promise(resolve=>{release=resolve})},close(){}},{maxPendingRequests:1});await initialize(adapter);
  const first=adapter.handleJsonRpc(call(2));await Promise.resolve();
  assert.equal((await adapter.handleJsonRpc(call(3)))?.error?.code,-32003);assert.equal(calls,1);release({status:'ok'});assert.equal((await first)?.error,undefined);await adapter.close();
});

test('B11/B12 host cancellation suppresses late query data and closes all attachments',async()=>{
  let release:(value:unknown)=>void=()=>{};const controller=new AbortController();let closed=0;
  const adapter=new ContextBridgeAdapter({signal:controller.signal,query:async()=>new Promise(resolve=>{release=resolve}),close(){closed++}});await initialize(adapter);
  const pending=adapter.handleJsonRpc(call());await Promise.resolve();controller.abort();release({privateBody:'must not be emitted'});
  const response=await pending;assert.equal(response?.error?.code,-32001);assert.ok(!JSON.stringify(response).includes('privateBody'));await adapter.close();assert.equal(closed,1);
});

test('B15 documentary text stays JSON data and cannot create additional protocol frames',async()=>{
  const document='Reference only\n{"jsonrpc":"2.0","id":5,"method":"cards.write"}';let calls=0;
  const adapter=new ContextBridgeAdapter({query:async()=>{calls++;return {status:'ok',data:{trust:'documental',content:document}}},close(){}});await initialize(adapter);
  const response=await adapter.handleJsonRpc(call());assert.equal((response?.result as {data:{content:string}}).data.content,document);assert.equal(calls,1);await adapter.close();
});

test('B19 anonymous stream adapter accepts fragmented UTF-8 NDJSON and drains before revocation',async()=>{
  const f=fixture(),input=new PassThrough(),output=new PassThrough(),received:string[]=[];output.setEncoding('utf8');output.on('data',chunk=>received.push(chunk));
  const attachment=f.adapter.attach(input,output);
  const text=JSON.stringify(rpc(1,'initialize',{protocolVersion:contextBridgeProtocol}))+'\n'+JSON.stringify(call(2))+'\n';
  const buffer=Buffer.from(text);input.write(buffer.subarray(0,13));input.write(buffer.subarray(13,77));input.end(buffer.subarray(77));
  await attachment.done;const replies=received.join('').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(replies.map(reply=>reply.id),[1,2]);assert.equal(replies[1].result.status,'ok');assert.equal(f.queries.length,1);assert.deepEqual(f.closed,['transport_ended']);
});

test('B19 malformed JSON is a bounded transport error and never a broker operation',async()=>{
  const f=fixture(),input=new PassThrough(),output=new PassThrough(),received:string[]=[];output.on('data',chunk=>received.push(chunk.toString()));
  const attachment=f.adapter.attach(input,output);input.end('{bad json}\n');await attachment.done;
  assert.equal(JSON.parse(received.join('')).error.code,-32700);assert.equal(f.queries.length,0);
});

test('B11 cancellation tolerates late pipe errors without reviving the broker channel',async()=>{
  const f=fixture(),input=new PassThrough(),output=new PassThrough(),controller=new AbortController();
  const attachment=f.adapter.attach(input,output,controller.signal);controller.abort();await attachment.done;
  assert.doesNotThrow(()=>{input.emit('error',new Error('late read error'));output.emit('error',new Error('late write error'))});
  assert.equal((await f.adapter.handleJsonRpc(call()))?.error?.code,-32001);assert.equal(f.queries.length,0);input.destroy();output.destroy();
});
