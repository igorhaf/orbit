import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,unlink,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectRegistry} from './project-registry';
import {prepareKnowledgeCandidates,revalidateKnowledgeCandidates,knowledgePolicyFromHost,knowledgePolicyForManifest,prepareProjectKnowledge} from './knowledge-host';
import {defaultKnowledgeRetrievalPolicy} from './knowledge-retrieval';
import {defaultContextCompilerPolicy,compileContext} from './context-compiler';
import {createContextManifest,hashContextText} from './context-manifest';
import type {Db} from '../db';

const configured='knowledge_retrieval:\n  documents: [knowledge/search, knowledge/private]\n  files: [docs/reference.md]\n';
async function fixture(config=configured){
 const root=await mkdtemp(join(tmpdir(),'orbit07a-host-'));await mkdir(join(root,'.orbit/knowledge'),{recursive:true});await mkdir(join(root,'docs'));
 await writeFile(join(root,'.orbit/orbit.yaml'),'permissions: [filesystem.read]\n'+config);
 await writeFile(join(root,'.orbit/knowledge/search.md'),'# Agendamento\n\nCalendário institucional e agenda de cursos. api_key=fixturesecret');
 await writeFile(join(root,'.orbit/knowledge/private.md'),'---\npermissions: [filesystem.write]\n---\n# Restrito\nDocumento privado de administração.');
 await writeFile(join(root,'.orbit/knowledge/unselected.md'),'Não deve entrar no corpus sem seleção explícita.');
 await writeFile(join(root,'docs/reference.md'),'# Referência\n\nCalendário das turmas e encontros.');
 const state={authorized:true};const db={one:async(_sql:string,p:string[])=>state.authorized&&p[1]==='actor'?{id:'project',name:'Fixture',local_path:root}:null} as unknown as Db;
 const projects=new ProjectRegistry(db),project=await projects.get('project','actor');
 const options={projects,project,user:'actor',workspaceId:'workspace',permissions:['filesystem.read']};
 const identity={runtimeId:projects.contextSource(project,'actor',{workspaceId:'workspace'},{id:'unused',type:'test',origin:'test',resourceId:'unused',version:'1',contentHash:hashContextText('x'),availability:'available',required:false,selectionReason:'fixture',dependencies:[],trust:'documental'}).scope.runtimeId,projectId:'project',workspaceId:'workspace',actorId:'actor',queue:'card_runs' as const,runId:'run',cardId:'card',cardRevision:1,executor:'fixture',executionType:'card_execution'};
 return {root,state,projects,project,options,identity,cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('R11 explicit catalog excludes unselected and unauthorized resources and redacts full bodies',async()=>{
 const f=await fixture();try{const catalog=await prepareKnowledgeCandidates(f.options);assert.equal(catalog.candidates.length,2);assert.ok(catalog.candidates.every(c=>c.source.scope.actorId==='actor'&&c.source.scope.workspaceId==='workspace'&&c.source.version?.startsWith('sha256:')));assert.ok(!JSON.stringify(catalog).includes('fixturesecret'));assert.ok(!JSON.stringify(catalog).includes('Documento privado'));assert.ok(catalog.candidates.some(c=>c.text.includes('[REDACTED]')));await revalidateKnowledgeCandidates(f.options,catalog)}finally{await f.cleanup()}
});
test('R9/R10 full catalog modification and removal invalidate prior snapshot',async()=>{
 for(const mode of ['change','remove']){const f=await fixture();try{const catalog=await prepareKnowledgeCandidates(f.options);const path=join(f.root,'docs/reference.md');if(mode==='change')await writeFile(path,'Outra versão do documento');else await unlink(path);await assert.rejects(()=>revalidateKnowledgeCandidates(f.options,catalog),/mudou|indisponível|preparação/)}finally{await f.cleanup()}}
});
test('R11/R14 project authorization is rechecked rather than inferred from catalog cache',async()=>{
 const f=await fixture();try{const catalog=await prepareKnowledgeCandidates(f.options);f.state.authorized=false;await assert.rejects(()=>revalidateKnowledgeCandidates(f.options,catalog),/sem acesso/);await assert.rejects(()=>prepareKnowledgeCandidates({...f.options,user:'other'}),/sem acesso/)}finally{await f.cleanup()}
});
test('R12/R13 catalog provenance records host project and workspace without shared actor authorization',async()=>{
 const f=await fixture();try{const first=await prepareKnowledgeCandidates(f.options),other=await prepareKnowledgeCandidates({...f.options,workspaceId:'other-workspace'});assert.notEqual(first.catalogHash,other.catalogHash);assert.ok(other.candidates.every(c=>c.source.scope.workspaceId==='other-workspace'));await assert.rejects(()=>prepareProjectKnowledge({...f.options,scope:{...f.identity,projectId:'other-product'},compilerPolicy:defaultContextCompilerPolicy(),policy:defaultKnowledgeRetrievalPolicy(),card:{id:'card',title:'Calendário',description:'Turmas',card_revision:1}}),/Identidade/)}finally{await f.cleanup()}
});
test('catalog configuration prohibits glob scans, reserved paths, escaping and symlinks outside checkout',async()=>{
 for(const file of ['../outside.md','.env','node_modules/a.md','docs/*.md','.orbit/cache/index.json','secrets/payment.json','secret/payment.json','credential/token.txt','.orbit/local/token.txt']){const f=await fixture('knowledge_retrieval:\n  files: ['+file+']\n');try{await assert.rejects(()=>prepareKnowledgeCandidates(f.options),/reservado|inválido/)}finally{await f.cleanup()}}
 const f=await fixture();const outside=await mkdtemp(join(tmpdir(),'orbit07a-outside-'));try{await writeFile(join(outside,'secret.md'),'outside');await unlink(join(f.root,'docs/reference.md'));await symlink(join(outside,'secret.md'),join(f.root,'docs/reference.md'));await assert.rejects(()=>prepareKnowledgeCandidates(f.options),/fora do projeto/)}finally{await f.cleanup();await rm(outside,{recursive:true,force:true})}
});
test('empty explicit catalog is controlled and preparation is interruptible',async()=>{
 const f=await fixture('');try{assert.equal((await prepareKnowledgeCandidates(f.options)).candidates.length,0);const controller=new AbortController();controller.abort();await assert.rejects(()=>prepareKnowledgeCandidates({...f.options,signal:controller.signal}),/interrompida/)}finally{await f.cleanup()}
});
test('R17/R18 host composes optional documentary compiler blocks with retrieval evidence',async t=>{
 const enabled=process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED;process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED='1';t.after(()=>{if(enabled===undefined)delete process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED;else process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED=enabled});
 const f=await fixture();try{const policy=defaultContextCompilerPolicy();const prepared=await prepareProjectKnowledge({...f.options,scope:f.identity,compilerPolicy:policy,policy:defaultKnowledgeRetrievalPolicy(),card:{id:'card',title:'Calendário',description:'Organizar agenda e turmas',card_revision:1}});assert.ok(prepared.result.selected.length>0);assert.ok(prepared.blocks.every(b=>!b.required&&b.priority==='related'));assert.ok(prepared.sources.every(s=>s.trust==='documental'));const compiled=compileContext({identity:f.identity,sources:prepared.sources,blocks:prepared.blocks,policy});assert.equal(compiled.status,'ready');assert.ok(compiled.text.includes('retrieved_reference_data'));assert.ok(!JSON.stringify(prepared.metadata).includes('fixturesecret'));assert.ok(!('text' in prepared.metadata))}finally{await f.cleanup()}
});
test('host opt-in requires compiler and captured policy cannot change or retroactively apply to legacy',()=>{
 const compiler=defaultContextCompilerPolicy();assert.equal(knowledgePolicyFromHost(compiler,{}),null);assert.throws(()=>knowledgePolicyFromHost(null,{ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED:'1'}),/Compiler/);assert.throws(()=>knowledgePolicyFromHost(compiler,{ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED:'true'}),/inválida/);
 assert.equal(knowledgePolicyForManifest(null,{ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED:'1'}),null);
 const identity={runtimeId:'dev',projectId:'project',workspaceId:'workspace',actorId:'actor',queue:'card_runs' as const,runId:'run',cardId:'card',cardRevision:1,executor:'fixture',executionType:'card_execution'};
 const manifest=createContextManifest({identity,sources:[],configuration:{contextCompilation:{policy:JSON.parse(JSON.stringify(compiler))},knowledgeRetrieval:{schemaVersion:1,policy:JSON.parse(JSON.stringify(defaultKnowledgeRetrievalPolicy()))}},git:null,checkout:null,assemblyPolicy:'orbit-context-compiler/1',material:{contextHash:hashContextText('x'),promptHash:hashContextText('x')}});
 assert.deepEqual(knowledgePolicyForManifest(manifest,{ORBIT_CONTEXT_COMPILER_ENABLED:'1',ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED:'1'}),defaultKnowledgeRetrievalPolicy());assert.throws(()=>knowledgePolicyForManifest(manifest,{ORBIT_CONTEXT_COMPILER_ENABLED:'1'}),/mudou/);
});
