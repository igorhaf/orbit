import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../..',import.meta.url)),require=createRequire(join(root,'forge/app/package.json'));
process.env.TSX_TSCONFIG_PATH=join(root,'forge/app/apps/api/tsconfig.json');require('tsx/cjs/api').register();
const {ContextBridge}=require(join(root,'packages/orbit-core/src/execution/context-bridge.ts'));
const {ProjectKnowledgeRetriever,knowledgeCompileInputs,knowledgeRetrievalMetadata,defaultKnowledgeRetrievalPolicy}=require(join(root,'packages/orbit-core/src/execution/knowledge-retrieval.ts'));
const {hashContextText}=require(join(root,'packages/orbit-core/src/execution/context-manifest.ts'));
const {ContextBridgeAdapter}=require(join(root,'packages/orbit-core/src/execution/context-bridge-adapter.ts'));
const {createContextBridgePeer,readContextBridgePeerIdentity}=require(join(root,'packages/orbit-core/src/execution/context-bridge-peer.ts'));
const {createContextManifest}=require(join(root,'packages/orbit-core/src/execution/context-manifest.ts'));
const {compileContext,compilationMetadata,defaultContextCompilerPolicy}=require(join(root,'packages/orbit-core/src/execution/context-compiler.ts'));
const {withWorkspaceWriteLease}=require(join(root,'packages/orbit-core/src/execution/workspace-coordinator.ts'));
const {spawnWorkspaceProcess}=require(join(root,'packages/orbit-core/src/execution/workspace-process.ts'));
const limits={maxRequests:16,maxResponseBytes:4096,maxTotalBytes:18000,requestTimeoutMs:2000,maxConcurrent:1,maxSources:16,maxDependencyDepth:2,maxRequestBytes:4096};
for(const {queue,failure,dynamic=false,presentation='structured'} of [{queue:'card_runs',failure:''},{queue:'card_ai_runs',failure:''},{queue:'card_runs',failure:'mcp_crash'},{queue:'card_runs',failure:'bad_handshake'},{queue:'card_runs',failure:'',dynamic:true},{queue:'card_ai_runs',failure:'',dynamic:true,presentation:'text'}])test(`F2/F3/F4/F5/F12/F13 ${queue}/${failure||'normal'}/${dynamic?presentation:'legacy'} supervised synthetic launcher reaches actual MCP entry and real broker`,{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'orbit06c-chain-'));mkdirSync(join(dir,'home'),{mode:0o700});
 const db={pool:{connect:async()=>Object.assign(new EventEmitter(),{query:async()=>({rows:[{locked:true}]}),release(){}})}};
 const identity={runtimeId:'fixture',projectId:'project',workspaceId:'workspace',actorId:'actor',queue,runId:queue+'-run',cardId:'card',cardRevision:1,executor:'synthetic',executionType:'card_execution'};
 const lexical=defaultKnowledgeRetrievalPolicy(),retriever=new ProjectKnowledgeRetriever(),knowledgePolicy={schemaVersion:1,maxQueryBytes:1024,maxResults:3};
 const candidate={text:'Abacaxi oceano documental.',authorizationPolicy:'fixture_catalog/1',source:{schemaVersion:1,id:'document:knowledge/other',resourceId:'knowledge/other',logicalPath:'.orbit/knowledge/other.md',scope:{runtimeId:identity.runtimeId,projectId:identity.projectId,workspaceId:identity.workspaceId,actorId:identity.actorId},ownerId:identity.actorId,version:'1',contentHash:hashContextText('Abacaxi oceano documental.'),availability:'available',origin:'project_document',type:'knowledge',required:false,selectionReason:'captured_catalog',trust:'documental',dependencies:[]}};
 const initial=dynamic?await retriever.retrieve({identity,query:{text:'calendário',fields:['title'],cardId:identity.cardId,cardRevision:1},candidates:[candidate],policy:lexical,authorize:async()=>true}):null;
 const inputs=initial?knowledgeCompileInputs(initial):{sources:[],blocks:[]};
 const policy=defaultContextCompilerPolicy(),compiled=compileContext({identity,...inputs,policy});
 const manifest=createContextManifest({identity,sources:inputs.sources,configuration:{contextCompilation:compilationMetadata(compiled),...(initial?{knowledgeRetrieval:knowledgeRetrievalMetadata(initial,compiled),contextBridge:{knowledge:knowledgePolicy}}:{})},git:{status:'not_applicable'},checkout:{mode:'shared'},assemblyPolicy:policy.id,material:{contextHash:compiled.compiledHash,promptHash:compiled.compiledHash}});
 const events=[];
 try{await withWorkspaceWriteLease(db,{queue,runId:identity.runId,projectId:identity.projectId,cardId:identity.cardId,projectRoot:dir},async lease=>{
  const bridge=new ContextBridge({record:{id:'manifest',queue,runId:identity.runId,turn:0,parentId:null,manifest,createdAt:new Date().toISOString()},ownerId:lease.owner,signal:lease.signal,limits,...(dynamic?{knowledge:{policy:knowledgePolicy,candidates:[candidate.source],search:(text,_limit,signal)=>retriever.retrieve({identity,query:{text,fields:['dynamic_query'],cardId:identity.cardId,cardRevision:1},candidates:[candidate],policy:lexical,authorize:async()=>{await lease.assertActive();return true},signal})}}:{}),authorize:async()=>lease.assertActive(),observe:async()=>({sources:[]}),read:async()=>{throw Error('no source')},audit:async e=>events.push(e)});
  const internal=new ContextBridgeAdapter({capabilities:bridge.descriptor().capabilities,knowledge:dynamic?knowledgePolicy:undefined,query:r=>bridge.query(r),signal:bridge.signal,close:r=>bridge.close(r)},{maxResponseBytes:4352,maxTransportBytes:18000});
  const peer=await createContextBridgePeer({exchange:r=>internal.handleJsonRpc(r),signal:lease.signal,maxFrameBytes:4096,maxResponseBytes:4352,maxPendingRequests:1,handshakeTimeoutMs:5000});
  const script=join(dir,'launcher.cjs');
  // This trusted test launcher reports the child it actually spawned. The host
  // pins kernel PID/starttime; no claim that native Codex supplies this evidence.
  writeFileSync(script,`
   const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
   assert.equal(process.env.DATABASE_URL,undefined);assert.equal(process.env.OPENAI_API_KEY,undefined);
   const child=spawn(process.execPath,['--import',${JSON.stringify(join(root,'forge/app/node_modules/tsx/dist/loader.mjs'))},${JSON.stringify(join(root,'packages/orbit-core/src/execution/context-bridge-mcp-entry.ts'))}],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','inherit']});
   console.log(JSON.stringify({peerPid:child.pid}));
   const send=(id,method,params)=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n');
   let buffer='';child.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\\n'))>=0){const r=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);if(process.env.ORBIT_FIXTURE_FAILURE==='bad_handshake'){assert.equal(r.error.code,-32602);console.log('handshake-rejected');child.stdin.end();continue;}assert.equal(r.error,undefined);if(r.id===1){if(process.env.ORBIT_FIXTURE_FAILURE==='mcp_crash'){console.log('mcp-crash-tested');child.kill('SIGKILL');continue;}send(undefined,'notifications/initialized');send(2,'tools/list',{});}else if(r.id===2){assert.equal(r.result.tools.length,process.env.ORBIT_FIXTURE_DYNAMIC==='1'?6:5);send(3,'tools/call',process.env.ORBIT_FIXTURE_DYNAMIC==='1'?{name:'orbit_knowledge_search',arguments:{query:process.env.ORBIT_FIXTURE_TEXT==='1'?'nonmatchingtoken':'abacaxi',limit:1}}:{name:'orbit_context_describe',arguments:{}});}else if(r.id===3){const payload=process.env.ORBIT_FIXTURE_TEXT==='1'?JSON.parse(r.result.content[0].text):r.result.structuredContent;assert.equal(payload.status,'ok');if(process.env.ORBIT_FIXTURE_DYNAMIC==='1'){assert.equal(payload.capability,'knowledge.search');if(process.env.ORBIT_FIXTURE_TEXT!=='1')assert.ok(payload.data.results[0].text.includes('Abacaxi'));}console.log('broker-response-verified');child.stdin.end();}}});
   child.once('close',code=>process.exit(code??1));
   send(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:process.env.ORBIT_FIXTURE_FAILURE==='bad_handshake'?null:{name:'synthetic-codex',version:'1'}});
  `);
  let child,output='',diagnostics='',pin;
  try{
   await lease.assertActive();child=spawnWorkspaceProcess(process.execPath,[script],{cwd:dir,env:{PATH:'/usr/bin:/bin',HOME:join(dir,'home'),CODEX_HOME:join(dir,'home','empty'),TSX_TSCONFIG_PATH:join(root,'forge/app/apps/api/tsconfig.json'),TSX_DISABLE_CACHE:'1',ORBIT_FIXTURE_FAILURE:failure,ORBIT_FIXTURE_DYNAMIC:dynamic?'1':'0',ORBIT_FIXTURE_TEXT:presentation==='text'?'1':'0',ORBIT_CONTEXT_BRIDGE_BOOTSTRAP:JSON.stringify({endpointPath:peer.endpointPath,publicKey:peer.publicKey,limits,presentation})},stdio:['ignore','pipe','pipe']});
   child.stderr.on('data',b=>diagnostics+=b);child.stdout.on('data',b=>{output+=b;const match=output.match(/\{"peerPid":(\d+)\}/);if(match&&!pin)pin=readContextBridgePeerIdentity(Number(match[1])).then(id=>peer.authorizePeer(id));});
   const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});await pin;assert.equal(code,failure==='mcp_crash'?1:0,diagnostics);assert.match(output,failure==='mcp_crash'?/mcp-crash-tested/:failure==='bad_handshake'?/handshake-rejected/:/broker-response-verified/);assert.equal(events.some(e=>e.phase==='response_prepared'),!failure);
  }finally{await peer.close();await internal.close()}
 });}finally{rmSync(dir,{recursive:true,force:true})}
});
