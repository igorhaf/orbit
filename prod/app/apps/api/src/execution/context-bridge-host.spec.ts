import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,unlink,symlink,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {contextBridgePolicyFromHost,contextBridgePolicyForManifest,bridgeConfiguration,openContextBridge} from './context-bridge-host';
import {ContextBuilder} from './context-builder';
import {ProjectRegistry} from './project-registry';
import {PluginRegistry} from './registries';
import {emptyConfig} from './types';
import {validateConfig} from './config';
import {executionContextIdentity,manifestForExecution,relevantPluginSources,contextTechnicalState} from './context-runtime';
import {defaultContextCompilerPolicy} from './context-compiler';
import {hashContextText,type StoredContextManifest} from './context-manifest';
import type {Db} from '../db';
import type {WorkspaceWriteLease} from './workspace-coordinator';

async function fixture(ai=false,knowledge=false){
 const directory=await mkdtemp(join(tmpdir(),'orbit06-host-')),root=join(directory,'project');await mkdir(join(root,'.orbit'),{recursive:true});
 await writeFile(join(root,'.orbit/orbit.yaml'),'permissions: [filesystem.read]\n'+(knowledge?'knowledge_retrieval:\n  files: [guide.txt]\n':''));await writeFile(join(root,'guide.txt'),(knowledge?'Fixture ':'')+'Reference api_key=fixturesecret');
 const saved={compiler:process.env.ORBIT_CONTEXT_COMPILER_ENABLED,bridge:process.env.ORBIT_CONTEXT_BRIDGE_ENABLED,knowledge:process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED,dynamic:process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED};process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED=knowledge?'1':'0';process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED='0';process.env.ORBIT_CONTEXT_COMPILER_ENABLED='1';process.env.ORBIT_CONTEXT_BRIDGE_ENABLED='1';
 const user=randomUUID(),projectId=randomUUID(),workspace=randomUUID(),card={id:randomUUID(),title:'Fixture',description:'Current demand',card_revision:1,workspace_id:workspace};
 const config=validateConfig({...emptyConfig(),project_id:projectId,enabled:true,executor:'fixture',action:'run',permissions:['filesystem.read'],context:{files:knowledge?[]:['guide.txt']}});
 const state={authorized:true,status:'running',worker:'fixture-worker',lease:true,revision:1,latestId:'',cancelled:false};const events:any[]=[];let record:StoredContextManifest;
 const query=async(sql:string,p:any[]=[])=>{
  if(sql.startsWith('INSERT INTO context_bridge_events')){const row={id:p[0],bridge_id:p[1],manifest_id:p[2],context_fingerprint:p[13],event_sequence:String(events.length+1),audit:JSON.parse(p[26]),recorded_at:new Date().toISOString()};events.push(row);return [row]}
  if(sql.includes('FROM context_run_manifests'))return [{id:state.latestId,queue:record.queue,run_id:record.runId,turn:record.turn,parent_id:null,manifest:record.manifest,created_at:record.createdAt}];
  if(sql.startsWith('SELECT user_id,'))return [{user_id:user,project_id:projectId,card_id:card.id,status:state.status,worker_id:state.worker,card_revision:1,cancel_requested:state.cancelled}];
  if(sql.includes('FROM card_execution_configs'))return [config];
  if(sql.includes('WITH RECURSIVE lineage'))return [];
  return [];
 };
 const db={query,one:async(sql:string)=>sql.includes('FROM cards')?{...card,card_revision:state.revision}:sql.includes('ai_projects')&&state.authorized?{id:projectId,name:'Fixture',local_path:root}:null} as unknown as Db;
 const projects=new ProjectRegistry(db),plugins=new PluginRegistry();if(ai)plugins.register({id:'ai',name:'Fixture AI contract',version:'1.0.0',actions:[]});
 const project=await projects.get(projectId,user),built=await new ContextBuilder(db,projects).build(project,config,card,user,{workspaceId:workspace,compilerPolicy:defaultContextCompilerPolicy()});
 const identity=executionContextIdentity('card_runs',randomUUID(),card,projectId,user,'fixture','card_execution');
 const manifest=manifestForExecution(identity,{...built,configuration:bridgeConfiguration(built.configuration,contextBridgePolicyFromHost(built.configuration.contextCompilation)),sources:[...built.sources,...(ai?relevantPluginSources(identity,plugins,['ai']):[])]},await contextTechnicalState(root));
 record={id:randomUUID(),queue:'card_runs',runId:identity.runId,turn:0,parentId:null,manifest,createdAt:new Date().toISOString()};state.latestId=record.id;
 const controller=new AbortController(),lease={owner:randomUUID(),signal:controller.signal,assertActive:async()=>{if(!state.lease)throw new Error('lost')}} as WorkspaceWriteLease;
 const active=await openContextBridge({db,projects,plugins,project,record,lease,workerId:'fixture-worker',signal:controller.signal,card:async()=>({...card,card_revision:state.revision})});
 await active.handle.exchange({jsonrpc:'2.0',id:'init',method:'initialize',params:{protocolVersion:'orbit-context-bridge/1'}});
 let sequence=0;
 const ask=(capability:string,parameters?:unknown)=>active.handle.exchange({jsonrpc:'2.0',id:'rpc'+(++sequence),method:'capabilities/call',params:{request:{schemaVersion:1,id:'request'+sequence,capability,...(parameters?{parameters}:{})}}}) as Promise<any>;
 const source=async()=>{const result=await ask('sources.list',{offset:0,limit:8});assert.equal(result.result?.status,'ok',JSON.stringify(result));return result.result.data.sources.find((item:any)=>(item.type==='file'||item.type==='reference')).id as string;};
 const cleanup=async()=>{await active.close().catch(()=>{});if(saved.compiler===undefined)delete process.env.ORBIT_CONTEXT_COMPILER_ENABLED;else process.env.ORBIT_CONTEXT_COMPILER_ENABLED=saved.compiler;if(saved.bridge===undefined)delete process.env.ORBIT_CONTEXT_BRIDGE_ENABLED;else process.env.ORBIT_CONTEXT_BRIDGE_ENABLED=saved.bridge;if(saved.knowledge===undefined)delete process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED;else process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED=saved.knowledge;if(saved.dynamic===undefined)delete process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED;else process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED=saved.dynamic;await rm(directory,{recursive:true,force:true})};
 return {root,directory,state,record,config,events,plugins,active,ask,source,cleanup,controller};
}

test('host Bridge flags require a compiled context and fit inside reserved compiler budget',()=>{
 const compilation={schemaVersion:1,status:'ready',policy:defaultContextCompilerPolicy()} as any;
 assert.equal(contextBridgePolicyFromHost(undefined,{}),null);assert.throws(()=>contextBridgePolicyFromHost(undefined,{ORBIT_CONTEXT_BRIDGE_ENABLED:'1'}),/compilado/);
 assert.throws(()=>contextBridgePolicyFromHost(compilation,{ORBIT_CONTEXT_BRIDGE_ENABLED:'true'}),/inválida/);
 assert.throws(()=>contextBridgePolicyFromHost(compilation,{ORBIT_CONTEXT_BRIDGE_ENABLED:'1',ORBIT_CONTEXT_BRIDGE_MAX_TOTAL_BYTES:'20000'}),/reserva/);
 assert.equal(contextBridgePolicyFromHost(compilation,{ORBIT_CONTEXT_BRIDGE_ENABLED:'1'})?.limits.maxTotalBytes,10000);assert.equal(contextBridgePolicyForManifest(null,{ORBIT_CONTEXT_BRIDGE_ENABLED:'1'}),null);
});

test('B2/B4/B8 host reauthorizes real registry sources and exposes partial freshness with redacted data',async()=>{
 const f=await fixture();try{const id=await f.source();const response=await f.ask('sources.read',{sourceId:id,maxBytes:256});assert.equal(response.result.status,'ok');assert.equal(response.result.data.text,'Reference api_key=[REDACTED]');assert.equal(response.result.data.bodyHash,hashContextText(response.result.data.text));assert.ok(f.events.some(row=>row.audit.event.phase==='response_prepared'));assert.ok(f.events.some(row=>row.audit.event.phase==='response_emitted'));assert.ok(!JSON.stringify(f.events).includes('fixturesecret'));const current=await f.ask('context.compatibility');assert.equal(current.result.data.status,'unverified');assert.equal(current.result.data.complete,false);}finally{await f.cleanup()}
});

test('B6/B7 changed or escaped selected files never return new or external bodies',async()=>{
 for(const scenario of ['changed','removed','symlink']){const f=await fixture();try{const id=await f.source();if(scenario==='changed')await writeFile(join(f.root,'guide.txt'),'CHANGED PRIVATE BODY');else{await unlink(join(f.root,'guide.txt'));if(scenario==='symlink'){const outside=join(f.directory,'outside.txt');await writeFile(outside,'OUTSIDE PRIVATE BODY');await symlink(outside,join(f.root,'guide.txt'));}}const response=await f.ask('sources.read',{sourceId:id});assert.ok(response.error||response.result.status==='refused');assert.ok(!JSON.stringify(response).includes('PRIVATE BODY'));}finally{await f.cleanup()}}
});

test('B11/B12/B13 host denies membership, revision, worker, terminal, permission or plugin revocation',async()=>{
 for(const scenario of ['membership','revision','worker','terminal','permission','plugin','cancel']){const f=await fixture(scenario==='plugin');try{if(scenario==='membership')f.state.authorized=false;if(scenario==='revision')f.state.revision=2;if(scenario==='worker')f.state.worker='other';if(scenario==='terminal')f.state.status='success';if(scenario==='permission')f.config.permissions=[];if(scenario==='plugin')f.plugins.setEnabled('ai',false);if(scenario==='cancel')f.controller.abort();const result=await f.ask('context.describe');assert.ok(result.error);assert.equal(f.active.handle.signal.aborted,true);}finally{await f.cleanup()}}
});

test('B14 close revokes the old adapter; source references alone cannot reactivate it',async()=>{
 const f=await fixture();try{const id=await f.source();await f.active.close();assert.equal(f.active.handle.signal.aborted,true);const result=await f.ask('sources.read',{sourceId:id});assert.ok(result.error);assert.ok(f.events.some(row=>row.audit.event.phase==='closed'));}finally{await f.cleanup()}
});

test('B12 changing the local Git layout or replacing the approved root revokes the binding',async()=>{
 for(const scenario of ['git','root']){const f=await fixture();try{if(scenario==='git'){await mkdir(join(f.root,'.git'));await writeFile(join(f.root,'.git/HEAD'),'ref: refs/heads/unapproved\n');}else{await rename(f.root,join(f.directory,'old-root'));await mkdir(join(f.root,'.orbit'),{recursive:true});await writeFile(join(f.root,'.orbit/orbit.yaml'),'permissions: [filesystem.read]\n');await writeFile(join(f.root,'guide.txt'),'Reference api_key=fixturesecret');}const response=await f.ask('context.describe');assert.ok(response.error);assert.equal(f.active.handle.signal.aborted,true);}finally{await f.cleanup()}}
});

test('07A content-addressed optional sources keep legacy sources.read semantics',async()=>{const f=await fixture(false,true);try{const id=await f.source();const source=f.record.manifest.sources.find(s=>s.id==='file:guide.txt')!;assert.equal(source.required,false);assert.match(source.version!,/^sha256:/);const response=await f.ask('sources.read',{sourceId:id});assert.equal(response.result?.status,'ok',JSON.stringify(response));assert.ok(response.result.data.text.includes('Fixture Reference'));assert.ok(!response.result.data.text.includes('fixturesecret'))}finally{await f.cleanup()}});
