import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectRegistry} from './project-registry';
import {prepareProjectKnowledge} from './knowledge-host';
import {defaultKnowledgeRetrievalPolicy} from './knowledge-retrieval';
import {defaultContextCompilerPolicy,compileContext,compilationMetadata} from './context-compiler';
import {createContextManifest,hashContextText,hashContextValue,type StoredContextManifest} from './context-manifest';
import {createKnowledgeBridgeCallback,assertKnowledgeBridgeMetadata} from './knowledge-bridge';
import {contextBridgePolicyFromHost,contextBridgePolicyForManifest} from './context-bridge-host';
import type {Db} from '../db';

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'orbit07b-knowledge-'));await mkdir(join(directory,'.orbit/knowledge'),{recursive:true});
 await writeFile(join(directory,'.orbit/orbit.yaml'),'permissions: [filesystem.read]\nknowledge_retrieval:\n  documents: [knowledge/agenda, knowledge/financeiro]\n');
 await writeFile(join(directory,'.orbit/knowledge/agenda.md'),'# Calendário\n\nCalendário das turmas e encontros semanais.');
 await writeFile(join(directory,'.orbit/knowledge/financeiro.md'),'# Pagamento\n\nPagamento parcelado mensal e comprovante financeiro.');
 const saved={compiler:process.env.ORBIT_CONTEXT_COMPILER_ENABLED,retrieval:process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED,bridge:process.env.ORBIT_CONTEXT_BRIDGE_ENABLED,dynamic:process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED};
 process.env.ORBIT_CONTEXT_COMPILER_ENABLED='1';process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED='1';process.env.ORBIT_CONTEXT_BRIDGE_ENABLED='1';process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED='1';
 const state={authorized:true,active:true,authorizations:0};const db={one:async()=>state.authorized?{id:'project',name:'Fixture',local_path:directory}:null} as unknown as Db;
 const projects=new ProjectRegistry(db),project=await projects.get('project','actor');
 const identity={...projects.contextSource(project,'actor',{workspaceId:'workspace'},{id:'none',type:'reference',origin:'test',resourceId:'none',version:'1',contentHash:hashContextText('x'),availability:'available',required:false,selectionReason:'fixture',dependencies:[],trust:'documental'}).scope,queue:'card_runs' as const,runId:'run',cardId:'card',cardRevision:1,executor:'fixture',executionType:'card_execution'};
 const compiler=defaultContextCompilerPolicy(),retrieval=await prepareProjectKnowledge({projects,project,user:'actor',scope:identity,permissions:['filesystem.read'],compilerPolicy:compiler,policy:defaultKnowledgeRetrievalPolicy(),card:{id:'card',title:'Calendário',description:'Calendário',card_revision:1}});
 const compiled=compileContext({identity,sources:retrieval.sources,blocks:retrieval.blocks,policy:compiler});assert.equal(compiled.status,'ready');
 const knowledge={...retrieval.metadata},compilation=compilationMetadata(compiled),bridge=contextBridgePolicyFromHost(compilation,process.env,knowledge);
 const manifest=createContextManifest({identity,sources:retrieval.sources,configuration:{contextCompilation:compilation,knowledgeRetrieval:knowledge,contextBridge:JSON.parse(JSON.stringify(bridge))},git:{status:'not_applicable'},checkout:{mode:'shared'},assemblyPolicy:compiler.id,material:{contextHash:compiled.compiledHash,promptHash:compiled.compiledHash}});
 const record:StoredContextManifest={id:'manifest',queue:'card_runs',runId:'run',turn:0,parentId:null,manifest,createdAt:new Date().toISOString()};
 const options={record,projects,project,permissions:['filesystem.read'],authorize:async(signal:AbortSignal)=>{state.authorizations++;if(signal.aborted||!state.active)throw new Error('authority-lost')}};
 const callback=await createKnowledgeBridgeCallback(options);
 return {directory,projects,project,state,record,options,callback,knowledge,compilation,cleanup:async()=>{for(const [key,value] of Object.entries({ORBIT_CONTEXT_COMPILER_ENABLED:saved.compiler,ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED:saved.retrieval,ORBIT_CONTEXT_BRIDGE_ENABLED:saved.bridge,ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED:saved.dynamic})){if(value===undefined)delete process.env[key];else process.env[key]=value}await rm(directory,{recursive:true,force:true})}};
}

test('07B searches a captured candidate omitted from initial context without mutating historical manifest',async()=>{
 const f=await fixture();try{assert.ok(!f.record.manifest.sources.some(s=>s.id==='document:knowledge/financeiro'));const historical=hashContextValue(f.record.manifest);const found=await f.callback.search('Pagamento',3,new AbortController().signal);assert.equal(found.status,'matched');assert.equal(found.selected[0].source.id,'document:knowledge/financeiro');assert.equal(found.queryFields[0],'dynamic_query');assert.equal(found.cardRevision,1);assert.equal(found.corpusHash,f.knowledge.corpusHash);assert.equal(hashContextValue(f.record.manifest),historical);assert.ok(f.state.authorizations>2)}finally{await f.cleanup()}
});
test('07B full corpus changes refuse even when changed source is unrelated to the query',async()=>{
 const f=await fixture();try{await writeFile(join(f.directory,'.orbit/knowledge/financeiro.md'),'Outra versão financeira.');await assert.rejects(()=>f.callback.search('Calendário',1,new AbortController().signal),/capturado mudou|preparação/)}finally{await f.cleanup()}
});
test('07B adding a configured candidate cannot expand an existing run corpus',async()=>{
 const f=await fixture();try{await writeFile(join(f.directory,'.orbit/knowledge/new.md'),'Calendário adicional');(f.project.config.knowledge_retrieval as {documents:string[]}).documents.push('knowledge/new');f.project.resources.push({id:'new',name:'new',kind:'knowledge',file:'new.md'});await assert.rejects(()=>f.callback.search('Calendário',1,new AbortController().signal),/capturado mudou/)}finally{await f.cleanup()}
});
test('07B permission revocation and cancelled bindings do not return chunks',async()=>{
 for(const mode of ['project','lease','signal','source']){const f=await fixture();try{const controller=new AbortController();if(mode==='project')f.state.authorized=false;else if(mode==='lease')f.state.active=false;else if(mode==='signal')controller.abort();else await writeFile(join(f.directory,'.orbit/knowledge/financeiro.md'),'---\npermissions: [filesystem.write]\n---\nPagamento restrito');await assert.rejects(()=>f.callback.search('Pagamento',1,controller.signal));}finally{await f.cleanup()}}
});
test('07B callback validates query/limit and keeps captured policy stable across queries',async()=>{
 const f=await fixture();try{for(const [query,limit] of [['',1],['x'.repeat(1025),1],['Pagamento',0],['Pagamento',4]] as Array<[string,number]>)await assert.rejects(()=>f.callback.search(query,limit,new AbortController().signal),/Parâmetros/);const first=await f.callback.search('Pagamento',1,new AbortController().signal),second=await f.callback.search('Pagamento',3,new AbortController().signal);assert.equal(first.corpusHash,second.corpusHash);assert.equal(first.fingerprint,second.fingerprint)}finally{await f.cleanup()}
});
test('07B host activation requires complete 07A evidence and preserves legacy capability policy',async()=>{
 const f=await fixture();try{const enabled=JSON.parse(JSON.stringify(process.env));assert.equal(contextBridgePolicyFromHost(f.compilation,{...enabled,ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED:'0'},f.knowledge)?.knowledge,undefined);assert.deepEqual(contextBridgePolicyFromHost(f.compilation,enabled,f.knowledge)?.knowledge,{schemaVersion:1,maxQueryBytes:1024,maxResults:3});assert.throws(()=>contextBridgePolicyFromHost(f.compilation,enabled),/incompleto/);assert.throws(()=>contextBridgePolicyFromHost(f.compilation,{...enabled,ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED:'0'},f.knowledge),/capturada/);const oldBridge=contextBridgePolicyFromHost(f.compilation,{...enabled,ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED:'0'},f.knowledge);const {schemaVersion,fingerprint,integrityHash,captureStatus,...base}=f.record.manifest;const old=createContextManifest({...base,configuration:{...f.record.manifest.configuration,contextBridge:JSON.parse(JSON.stringify(oldBridge))}});assert.equal(contextBridgePolicyForManifest(old,enabled)?.knowledge,undefined);const incomplete=JSON.parse(JSON.stringify(f.knowledge));delete incomplete.considered[0].sourceIdentityHash;assert.throws(()=>assertKnowledgeBridgeMetadata(incomplete),/histórica/)}finally{await f.cleanup()}
});
