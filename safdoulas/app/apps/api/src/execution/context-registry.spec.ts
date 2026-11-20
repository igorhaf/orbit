import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Db} from '../db';
import {ProjectRegistry} from './project-registry';
import {ContextBuilder} from './context-builder';
import {emptyConfig} from './types';
import {hashContextValue} from './context-manifest';
import {defaultContextCompilerPolicy} from './context-compiler';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'orbit-context-registry-'));
  await mkdir(join(root,'.orbit/skills'),{recursive:true});
  await writeFile(join(root,'.orbit/orbit.yaml'),'skills: [selected]\npermissions: [filesystem.read]\n');
  await writeFile(join(root,'.orbit/skills/selected.md'),'---\nid: selected\n---\nUse selected content');
  await writeFile(join(root,'.orbit/skills/unrelated.md'),'Unrelated content');
  await writeFile(join(root,'reference.txt'),'Reference content');
  const db={one:async(sql:string)=>sql.includes('ai_projects')?{id:'project',name:'Project',local_path:root}:null,query:async()=>[]} as unknown as Db;
  const registry=new ProjectRegistry(db);
  const project=await registry.get('project','actor');
  const config={...emptyConfig(),permissions:['filesystem.read'],context:{files:['reference.txt'],include_agents_md:true}};
  const card={id:'card',title:'Task',description:'Description',card_revision:1,workspace_id:'workspace'};
  return {root,db,registry,project,config,card,builder:new ContextBuilder(db,registry),cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('compiled builder preserves mandatory material beyond legacy redaction limits and blocks insufficient budget',async()=>{
  const f=await fixture();try{
    const card={...f.card,description:'x'.repeat(65000)+'MANDATORY-TAIL-MUST-SURVIVE'};
    const policy=defaultContextCompilerPolicy();
    const built=await f.builder.build(f.project,f.config,card,'actor',{workspaceId:'workspace',compilerPolicy:policy});
    assert.ok(built.prompt.includes('MANDATORY-TAIL-MUST-SURVIVE'));assert.equal(built.compilation?.status,'ready');
    assert.equal(built.compilation?.compiledHash,built.configuration.contextCompilation&&(built.configuration.contextCompilation as {compiledHash:string}).compiledHash);
    await assert.rejects(()=>f.builder.build(f.project,f.config,card,'actor',{workspaceId:'workspace',compilerPolicy:defaultContextCompilerPolicy({maxEstimatedTokens:30000})}),/orçamento/);
    await assert.rejects(()=>f.builder.build(f.project,f.config,card,'actor',{workspaceId:'workspace',compilerPolicy:null}),/60 KB/);
  }finally{await f.cleanup()}
});

test('registry identifies only incorporated resources and explicit optional omissions',async()=>{
  const f=await fixture();try{
    const built=await f.builder.build(f.project,f.config,f.card,'actor');
    assert.ok(built.sources.some(source=>source.id==='document:skills/selected'));
    assert.ok(!built.sources.some(source=>source.id.includes('unrelated')));
    assert.deepEqual(built.sources.filter(source=>source.type==='instructions').map(source=>[source.logicalPath,source.availability,source.required]),[['.orbit/AGENTS.md','missing',false],['AGENTS.md','missing',false]]);
    const missing=built.sources.filter(source=>source.availability==='missing');
    const observedMissing=await f.registry.observeSelection(f.project,'actor',missing,{workspaceId:'workspace'});
    assert.deepEqual(observedMissing.map(source=>source.provenance),missing.map(source=>source.provenance));
    assert.equal(built.sources.find(source=>source.type==='demand')?.version,'1');
    assert.ok(built.sources.every(source=>source.scope.workspaceId==='workspace'&&source.scope.actorId==='actor'));
  }finally{await f.cleanup()}
});

test('changes to unselected documents do not change selected source semantics',async()=>{
  const f=await fixture();try{
    const first=await f.builder.build(f.project,f.config,f.card,'actor');
    await writeFile(join(f.root,'.orbit/skills/unrelated.md'),'---\nid: malformed\nskills: [unclosed\n---\nChanged unrelated content');
    const reloaded=await f.registry.get('project','actor');
    assert.ok(reloaded.warnings.length>0);
    const second=await f.builder.build(reloaded,f.config,f.card,'actor');
    const semantic=(value:typeof first)=>value.sources.map(source=>Object.fromEntries(Object.entries(source).filter(([key])=>key!=='observedAt')));
    assert.equal(hashContextValue(semantic(first)),hashContextValue(semantic(second)));
  }finally{await f.cleanup()}
});

test('selected source changes and removal are observable without reviving history',async()=>{
  const f=await fixture();try{
    const built=await f.builder.build(f.project,f.config,f.card,'actor');
    const before=built.sources.find(source=>source.id==='file:reference.txt')!;
    await writeFile(join(f.root,'reference.txt'),'Changed selected content');
    const changed=await f.registry.revalidateSelection(f.project,'actor',[before],{workspaceId:'workspace'});
    assert.notEqual(changed[0].contentHash,before.contentHash);
    await rm(join(f.root,'reference.txt'));
    const missing=await f.registry.revalidateSelection(f.project,'actor',[before],{workspaceId:'workspace'});
    assert.equal(missing[0].availability,'missing');assert.equal(missing[0].contentHash,null);
    assert.equal(before.availability,'available');
  }finally{await f.cleanup()}
});

test('configuration changes after registry resolution fail preparation closed',async()=>{
  const f=await fixture();try{
    await writeFile(join(f.root,'.orbit/orbit.yaml'),'skills: []\n');
    await assert.rejects(()=>f.builder.build(f.project,f.config,f.card,'actor'),/configuração.*mudou/);
  }finally{await f.cleanup()}
});

test('a selected file changed during composition fails preparation closed',async()=>{
  const f=await fixture();try{
    const original=f.registry.assertSelectionUnchanged.bind(f.registry);
    f.registry.assertSelectionUnchanged=async(...args)=>{await writeFile(join(f.root,'reference.txt'),'Concurrent update');return original(...args)};
    await assert.rejects(()=>f.builder.build(f.project,f.config,f.card,'actor'),/fonte selecionada mudou/);
  }finally{await f.cleanup()}
});

test('selected source revalidation rejects actor and runtime substitution',async()=>{
  const f=await fixture();try{
    const built=await f.builder.build(f.project,f.config,f.card,'actor');
    const source=built.sources.find(item=>item.id==='file:reference.txt')!;
    await assert.rejects(()=>f.registry.revalidateSelection(f.project,'actor',[{...source,scope:{...source.scope,runtimeId:'another-product'}}],{workspaceId:'workspace'}),/Escopo/);
    await assert.rejects(()=>f.registry.revalidateSelection(f.project,'another-actor',[source],{workspaceId:'workspace'}),/Escopo/);
  }finally{await f.cleanup()}
});

test('skill prompt provenance follows the actual selected bodies and selection agents',async()=>{
  const f=await fixture();try{
    await mkdir(join(f.root,'.orbit/agents'));
    await writeFile(join(f.root,'.orbit/agents/developer.md'),'---\nskills: [selected]\n---\nAgent body is not in skill prompt');
    const project=await f.registry.get('project','actor');
    const built=await f.registry.skillPrompt('project','actor',[],'developer',{workspaceId:'workspace'},project);
    assert.match(built.text,/Use selected content/);assert.doesNotMatch(built.text,/Agent body/);
    assert.ok(built.sources.some(source=>source.id==='document:agents/developer'&&source.provenance?.selectionOnly===true));
    assert.equal(built.sources.find(source=>source.id==='document:skills/selected')?.availability,'available');
  }finally{await f.cleanup()}
});

test('approved checkout reads its own files and binds authorization to the origin',async()=>{
  const f=await fixture();const checkout=await mkdtemp(join(tmpdir(),'orbit-context-approved-'));
  try{
    await mkdir(join(checkout,'.orbit/skills'),{recursive:true});
    await writeFile(join(checkout,'.orbit/orbit.yaml'),'skills: [selected]\npermissions: [filesystem.read]\n');
    await writeFile(join(checkout,'.orbit/skills/selected.md'),'---\nid: selected\n---\nCheckout selected content');
    await writeFile(join(checkout,'reference.txt'),'Checkout reference');
    const project={...f.project,root:checkout,resourcesRoot:join(checkout,'.orbit'),authorizationRoot:f.root};
    const built=await f.builder.build(project,f.config,f.card,'actor');
    assert.match(built.prompt,/Checkout reference/);assert.match(built.prompt,/Checkout selected content/);
    const file=built.sources.find(source=>source.id==='file:reference.txt')!;
    assert.equal((await f.registry.revalidateSelection(project,'actor',[file],{workspaceId:'workspace'}))[0].contentHash,file.contentHash);
    await assert.rejects(()=>f.registry.revalidateSelection({...project,authorizationRoot:undefined},'actor',[file],{workspaceId:'workspace'}),/sem acesso/);
  }finally{await f.cleanup();await rm(checkout,{recursive:true,force:true})}
});

test('related card revisions are captured and concurrent revision changes fail closed',async()=>{
  const f=await fixture();try{
    const related={id:'related',title:'Related',description:'Shared reference',url_token:'selection',workspace_id:'workspace',card_revision:4};
    let current={...related};
    const db={query:async()=>[{...related}],one:async()=>({...current})} as unknown as Db;
    const builder=new ContextBuilder(db,f.registry);
    const first=await builder.build(f.project,f.config,f.card,'actor');
    assert.equal(first.sources.find(source=>source.id==='card:related')?.version,'4');
    current={...related,card_revision:5};
    await assert.rejects(()=>builder.build(f.project,f.config,f.card,'actor'),/cartão relacionado mudou/);
    assert.equal(first.sources.find(source=>source.id==='card:related')?.version,'4');
  }finally{await f.cleanup()}
});

test('selected related cards cannot cross the authorized workspace',async()=>{
  const f=await fixture();try{
    const db={query:async()=>[{id:'related',title:'Private',description:'Private reference',url_token:'selection',workspace_id:'another-workspace',card_revision:1}]} as unknown as Db;
    await assert.rejects(()=>new ContextBuilder(db,f.registry).build(f.project,f.config,f.card,'actor'),/fora do workspace autorizado/);
  }finally{await f.cleanup()}
});

test('resolved default executor has the same effective configuration fingerprint as explicit selection',async()=>{const f=await fixture();try{const first=await f.builder.build(f.project,{...f.config,executor:null},f.card,'actor');const second=await f.builder.build(f.project,{...f.config,executor:first.executor},f.card,'actor');assert.equal(first.configuration.executionConfigHash,second.configuration.executionConfigHash);assert.equal(first.prompt,second.prompt);}finally{await f.cleanup()}});
