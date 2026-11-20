import test from 'node:test';
import assert from 'node:assert/strict';
import {ContextBridge,type ContextBridgeOptions,type ContextBridgeLimits,type ContextBridgeRequest,type ContextBridgeAuditEvent} from './context-bridge';
import {createContextManifest,hashContextText,type ContextSource,type ContextObject,type CurrentContextObservation} from './context-manifest';
import {compileContext,compilationMetadata,defaultContextCompilerPolicy} from './context-compiler';
import {ContextBridgeMcpAdapter,contextBridgeMcpVersion} from './context-bridge-mcp';
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('MCP fixture returned a non-object value.');return value as Record<string,unknown>};
const identity={runtimeId:'dev',projectId:'project',workspaceId:'workspace',actorId:'actor',queue:'card_runs' as const,runId:'run',cardId:'card',cardRevision:1,executor:'fixture',executionType:'card_execution'};
function source(id='document:rules/selected'):ContextSource{return {schemaVersion:1,id,type:'rules',origin:'project_document',resourceId:'rules/selected',logicalPath:'.orbit/rules/selected.md',ownerId:'actor',scope:{runtimeId:'dev',projectId:'project',workspaceId:'workspace',actorId:'actor'},version:'1',contentHash:hashContextText('Selected authorized body'),availability:'available',required:true,selectionReason:'explicit_selection',dependencies:[],trust:'documental',provenance:{rawHash:hashContextText('Selected authorized body')}}}
function fixture(overrides:Partial<ContextBridgeOptions>={},limits:Partial<ContextBridgeLimits>={}){
 const selected=source(),policy=defaultContextCompilerPolicy(),compiled=compileContext({identity,sources:[selected],blocks:[{id:'rule',section:'rules',sourceIds:[selected.id],text:'Selected authorized body',required:true}],policy});
 const manifest=createContextManifest({identity,sources:[selected],configuration:{contextCompilation:compilationMetadata(compiled)},git:{status:'observed',baseCommit:'a'.repeat(40)},checkout:{mode:'shared',privateRoot:'/private/host/root'},assemblyPolicy:policy.id,material:{contextHash:compiled.compiledHash,promptHash:compiled.compiledHash}});
 const record={id:'manifest',queue:identity.queue,runId:identity.runId,turn:0,parentId:null,manifest,createdAt:'2026-11-14T00:00:00.000Z'};
 const state={authorized:true,body:'Selected authorized body',sources:copy(manifest.sources),readCalls:0,authorizeCalls:0,observeCalls:0};const events:ContextBridgeAuditEvent[]=[];
 const current=():CurrentContextObservation=>({identity:copy(manifest.identity),sources:copy(state.sources),configuration:copy(manifest.configuration),git:copy(manifest.git),checkout:copy(manifest.checkout),assemblyPolicy:copy(manifest.assemblyPolicy),material:copy(manifest.material)});
 const options:ContextBridgeOptions={record,ownerId:'lease-owner',limits:{maxRequests:32,maxResponseBytes:4096,maxTotalBytes:18000,requestTimeoutMs:1000,maxConcurrent:2,maxSources:32,maxDependencyDepth:4,...limits},readableSourceIds:[selected.id],authorize:async()=>{state.authorizeCalls++;if(!state.authorized)throw new Error('PRIVATE-AUTH-ERROR')},observe:async()=>{state.observeCalls++;return current()},read:async()=>{state.readCalls++;return {source:copy(state.sources[0]),text:state.body}},audit:async event=>{events.push(copy(event))},now:()=> '2026-11-14T00:00:00.000Z',...overrides};
 const bridge=new ContextBridge(options);let sequence=0;
 const query=(capability:ContextBridgeRequest['capability'],parameters?:ContextBridgeRequest['parameters'])=>bridge.query({schemaVersion:1,id:'request-'+(++sequence),capability,...(parameters?{parameters}:{})});
 const opaque=async()=>{const result=await query('sources.list');assert.equal(result.status,'ok');return (result.data.sources as ContextObject[])[0].id as string};
 return {bridge,events,state,options,manifest,current,query,opaque};
}


const rpc=(id:number,method:string,params?:unknown)=>({jsonrpc:'2.0',id,method,...(params===undefined?{}:{params})});
async function setup(overrides:Partial<ContextBridgeOptions>={},limits:Partial<ContextBridgeLimits>={}){
 const f=fixture(overrides,limits);const adapter=new ContextBridgeMcpAdapter({query:r=>f.bridge.query(r),close:r=>f.bridge.close(r),signal:f.bridge.signal});
 const init=await adapter.handleJsonRpc(rpc(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}}));
 await adapter.handleJsonRpc({jsonrpc:'2.0',method:'notifications/initialized'});
 let id=1;const call=(name:string,args:unknown={})=>adapter.handleJsonRpc(rpc(++id,'tools/call',{name,arguments:args}));
 return {...f,adapter,init,call};
}
test('M1/M2 negotiation, exactly five read-only schemas, no resources or write tools',async()=>{
 const f=await setup();assert.equal(object(f.init!.result).protocolVersion,contextBridgeMcpVersion);
 const list=await f.adapter.handleJsonRpc(rpc(9,'tools/list'));const tools=object(list!.result).tools;
 assert.ok(Array.isArray(tools));assert.equal(tools.length,5);assert.ok(tools.every(tool=>{const value=object(tool);return object(value.annotations).readOnlyHint===true&&object(value.inputSchema).additionalProperties===false}));
 assert.deepEqual(object(f.init!.result).capabilities,{tools:{listChanged:false}});await f.adapter.close();
});
test('M3/M5/M6 real broker read preserves body provenance and explicit refusal',async()=>{
 const f=await setup();const listed=await f.call('orbit_sources_list');const payload=object(object(listed!.result).structuredContent);
 const id=object(object(payload.data).sources instanceof Array?(object(payload.data).sources as unknown[])[0]:undefined).id;assert.equal(typeof id,'string');const read=await f.call('orbit_sources_read',{sourceId:id});const body=object(object(read!.result).structuredContent);
 const data=object(body.data),source=object(data.source);assert.equal(data.text,f.state.body);assert.ok(typeof data.text==='string');assert.equal(data.bodyHash,hashContextText(data.text));assert.equal(source.trust,'documental');assert.ok(f.events.some(e=>e.phase==='response_prepared'));
 const refused=await f.call('orbit_sources_read',{sourceId:'src_'+'0'.repeat(64)});const refusedResult=object(refused!.result);assert.equal(refusedResult.isError,true);assert.equal(object(object(refusedResult.structuredContent).error).code,'bridge_source_not_selected');await f.adapter.close();
});
test('M4 malformed/unknown tools do not invoke broker, notifications never replied to',async()=>{
 const f=await setup();for(const [name,args] of [['write',{}],['orbit_context_describe',{path:'/etc/passwd'}],['orbit_sources_read',{sourceId:'no'}],['orbit_sources_list',{limit:-1}]])assert.equal((await f.call(name as string,args))!.error!.code,-32602);
 assert.equal(f.state.authorizeCalls,0);assert.equal(await f.adapter.handleJsonRpc({jsonrpc:'2.0',method:'unknown'}),null);await f.adapter.close();
});
test('M7/M8 opaque sources differ per binding and closed binding never reopens',async()=>{
 const a=await setup(),b=await setup();const id=(await a.opaque());const result=await b.call('orbit_sources_read',{sourceId:id});assert.equal(object(object(object(result!.result).structuredContent).error).code,'bridge_source_not_selected');
 await a.adapter.close();assert.ok((await a.call('orbit_context_describe'))!.error);await b.adapter.close();
});
test('M9 cancellation of pending read revokes whole binding and suppresses content',async()=>{
 let release!:(value:{source:ContextSource;text:string})=>void;const f=await setup({read:()=>new Promise(resolve=>{release=resolve})});const id=await f.opaque();const pending=f.call('orbit_sources_read',{sourceId:id});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 await f.adapter.handleJsonRpc({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:2}});
 release({source:f.manifest.sources[0],text:'SECRET-LATE'});const result=await pending;assert.ok(!JSON.stringify(result).includes('SECRET-LATE'));assert.equal(f.bridge.signal.aborted,true);
});
test('M10 wire envelope fits existing256-byte reservation and broker budget cannot be reset',async()=>{
 const f=await setup({}, {maxTotalBytes:4352});const result=await f.call('orbit_context_describe');const structured=object(object(result!.result).structuredContent);
 assert.ok(Buffer.byteLength(JSON.stringify(result))-Buffer.byteLength(JSON.stringify(structured))+1<=256);
 const again=await f.call('orbit_context_describe');assert.ok(object(again!.result).isError||again!.error);assert.equal(f.bridge.signal.aborted,true);
});
test('M11 concurrent calls retain broker concurrency refusal',async()=>{
 let release!:(value:{source:ContextSource;text:string})=>void;const f=await setup({read:()=>new Promise(resolve=>{release=resolve})},{maxConcurrent:1});const id=await f.opaque();const first=f.call('orbit_sources_read',{sourceId:id});while(!release)await new Promise(resolve=>setImmediate(resolve));
 const second=await f.call('orbit_context_describe');assert.equal(object(object(object(second!.result).structuredContent).error).code,'bridge_concurrency_limit');release({source:f.manifest.sources[0],text:f.state.body});await first;await f.adapter.close();
});
test('M1 lifecycle enforces initialized and negotiates a supported version',async()=>{
 const f=fixture();const a=new ContextBridgeMcpAdapter({query:r=>f.bridge.query(r),close:r=>f.bridge.close(r)});
 assert.equal((await a.handleJsonRpc(rpc(1,'tools/list')))!.error!.code,-32002);
 const reply=await a.handleJsonRpc(rpc(2,'initialize',{protocolVersion:'unknown',capabilities:{},clientInfo:{name:'fixture',version:'1'}}));assert.equal(object(reply!.result).protocolVersion,contextBridgeMcpVersion);
 assert.equal((await a.handleJsonRpc(rpc(3,'tools/list')))!.error!.code,-32002);await a.close();
});

test('host seam reuses the06 exchange adapter and its limits, without a second broker',async()=>{
 const {createContextBridgeMcpForHost}=await import('./context-bridge-mcp');
 const {ContextBridgeAdapter}=await import('./context-bridge-adapter');
 const f=fixture();const internal=new ContextBridgeAdapter({query:r=>f.bridge.query(r),close:r=>f.bridge.close(r),signal:f.bridge.signal});
 const adapter=await createContextBridgeMcpForHost({exchange:r=>internal.handleJsonRpc(r),signal:f.bridge.signal,descriptor:f.bridge.descriptor()},r=>internal.close(r));
 await adapter.handleJsonRpc(rpc(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}}));await adapter.handleJsonRpc({jsonrpc:'2.0',method:'notifications/initialized'});
 const read=await adapter.handleJsonRpc(rpc(2,'tools/call',{name:'orbit_context_describe'}));assert.equal(object(object(read!.result).structuredContent).status,'ok');await adapter.close();assert.equal(f.bridge.signal.aborted,true);
});

test('F6 text-only representation is explicit and never duplicates an unmetered body',async()=>{
 const f=fixture();const a=new ContextBridgeMcpAdapter({query:r=>f.bridge.query(r),close:r=>f.bridge.close(r),signal:f.bridge.signal},{},'text');
 await a.handleJsonRpc(rpc(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'text-only',version:'1'}}));await a.handleJsonRpc({jsonrpc:'2.0',method:'notifications/initialized'});
 const response=await a.handleJsonRpc(rpc(2,'tools/call',{name:'orbit_sources_dependencies',arguments:{sourceId:await f.opaque()}}));
 assert.equal(object(response!.result).structuredContent,undefined);const content=object(response!.result).content;if(!Array.isArray(content))throw new Error('MCP text fixture omitted content.');const text=object(content[0]).text;assert.equal(typeof text,'string');assert.equal(JSON.parse(text as string).status,'ok');assert.ok(JSON.parse(text as string).contentHash);await a.close();
});
test('F14 text escaping cannot exceed the existing reservation',async()=>{
 const f=fixture();const a=new ContextBridgeMcpAdapter({query:async()=>({status:'ok',data:{text:'"'.repeat(1000)}}),close:r=>f.bridge.close(r)},{},'text');
 await a.handleJsonRpc(rpc(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'text-only',version:'1'}}));await a.handleJsonRpc({jsonrpc:'2.0',method:'notifications/initialized'});
 const response=await a.handleJsonRpc(rpc(2,'tools/call',{name:'orbit_context_describe'}));assert.equal(response!.error!.code,-32004);assert.equal(f.bridge.signal.aborted,true);
});
