import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseMarkdown,parseYaml,ProjectRegistry,AgentRegistry,SkillRegistry,Project} from './project-registry';
import {ExecutorRegistry,PluginRegistry,filesystemPlugin} from './registries';
import {validateConfig} from './config';
import {emptyConfig,ExecutionInput} from './types';
import {safePath,noSecrets,scrub,redact} from './security';
import {Db} from '../db';
import {ContextBuilder} from './context-builder';

test('frontmatter supports lists and rejects malformed or duplicate YAML keys',()=>{
  assert.deepEqual(parseMarkdown('---\nid: developer\nskills:\n  - review\n---\nBody'),{metadata:{id:'developer',skills:['review']},body:'Body'});
  assert.equal(parseMarkdown('# Plain').body,'# Plain');
  assert.throws(()=>parseYaml('id: one\nid: two'));
  assert.throws(()=>parseMarkdown('---\nid: missing close'));
  assert.throws(()=>parseYaml('- list'));
});
test('configuration is optional, constrained and rejects secrets',()=>{
  assert.equal(validateConfig({}).enabled,false);
  assert.throws(()=>validateConfig({...emptyConfig(),permissions:['root']}));
  assert.throws(()=>validateConfig({...emptyConfig(),executor:'codex; rm -rf /'}));
  assert.throws(()=>validateConfig({...emptyConfig(),invented_workflow:'automatic'}),/Campos fora da arquitetura/);
  assert.throws(()=>validateConfig({...emptyConfig(),context:{legacy_prompt:'invented'}}),/Campos fora da arquitetura/);
  assert.throws(()=>noSecrets({nested:{apiKey:'secret'}}));
  assert.deepEqual(scrub({token:'123',value:'Bearer abc.def.ghi'}),{token:'[REDACTED]',value:'Bearer [REDACTED]'});
  assert.ok(!redact('CLI error: {"access_token":"do-not-expose"}').includes('do-not-expose'));
});
test('resource registries build selected context and reject traversal and symlink escape',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-resources-'));
  try{
    for(const dir of ['agents','skills','rules','knowledge'])await mkdir(join(root,dir));
    await writeFile(join(root,'agents/developer.md'),'---\nid: developer\nskills: [review]\nrules: [coding]\npermissions: [filesystem.read]\n---\nAgent instructions');
    await writeFile(join(root,'skills/review.md'),'---\nid: review\n---\nReview instructions');
    await writeFile(join(root,'rules/coding.md'),'Mandatory rules');
    await writeFile(join(root,'knowledge/selected.md'),'Selected knowledge');
    await writeFile(join(root,'knowledge/unselected.md'),'MUST NOT LOAD');
    await writeFile(join(root,'context.txt'),'File context');await writeFile(join(root,'.env'),'DO NOT READ');
    await symlink('/etc',join(root,'escape'));
    const project:Project={id:'project',name:'Project',root,resourcesRoot:root,config:{permissions:['filesystem.read']},warnings:[],resources:[{id:'developer',name:'Developer',kind:'agents'},{id:'review',name:'Review',kind:'skills'},{id:'coding',name:'Coding',kind:'rules'},{id:'selected',name:'Selected',kind:'knowledge'}]};
    const registry=new ProjectRegistry({} as Db);
    assert.equal((await new AgentRegistry(registry).resolve(project,'developer')).body,'Agent instructions');
    assert.equal((await new SkillRegistry(registry).resolve(project,'review')).id,'review');
    const config={...emptyConfig(),agent:'developer',permissions:['filesystem.read'],context:{knowledge:['selected'],files:['context.txt']}};
    const built=await new ContextBuilder({query:async()=>[]} as unknown as Db,registry).build(project,config,{id:'id',title:'Task',description:'Description'},'user');
    assert.ok(built.prompt.includes('Selected knowledge'));assert.ok(built.prompt.includes('Mandatory rules'));assert.ok(!built.prompt.includes('MUST NOT LOAD'));assert.equal(built.resources.length,5);
    const defaults=await new ContextBuilder({query:async()=>[]} as unknown as Db,registry).build({...project,config:{...project.config,skills:['review']}},{...config,agent:null,skills:[]},{id:'id',title:'Task',description:'Description'},'user');
    assert.deepEqual(defaults.skills,['review']);
    assert.match(defaults.prompt,/CONTRATO OBRIGATÓRIO DE ARQUITETURA ORBIT/);
    assert.ok(defaults.prompt.includes('Review instructions'));
    const references=[{id:'parent',title:'Parent purpose',description:'Current acceptance criteria'},{id:'second',title:'Second context',description:'Supporting details'}];
    const linked=await new ContextBuilder({query:async()=>references,one:async()=>{throw new Error('Duplicate reference was loaded twice')}} as unknown as Db,registry).build(project,{...config,context:{...config.context,cards:['parent']}},{id:'id',title:'Task',description:'Description'},'user');
    assert.ok(linked.prompt.includes('Current acceptance criteria'));
    assert.ok(linked.prompt.includes('Supporting details'));
    assert.equal(linked.prompt.split('[[ORBIT_CONTEXTS]]').length,2);
    assert.match(linked.prompt,/apenas como base de referência/);
    assert.equal(linked.resources.filter(resource=>resource.kind==='card').length,2);
    await assert.rejects(()=>safePath(root,'../'));
    await assert.rejects(()=>safePath(root,'escape/passwd'));
    await assert.rejects(()=>safePath(root,'.env'));
    await assert.rejects(()=>new ContextBuilder({query:async()=>[]} as unknown as Db,registry).build(project,{...config,permissions:['filesystem.write']},{id:'id',title:'Task',description:''},'user'));
  }finally{await rm(root,{recursive:true,force:true})}
});
test('project resources support optional directories, yml files and actionable diagnostics',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-project-registry-'));
  try{
    await mkdir(join(root,'.orbit'));await mkdir(join(root,'.orbit','agents'));await mkdir(join(root,'.orbit','skills'));
    await writeFile(join(root,'.orbit','orbit.yaml'),'agents: [developer]\nskills: [missing]\n');
    await writeFile(join(root,'.orbit','agents','developer.md'),'---\nid: developer\nname: Developer\nskills: [review]\n---\nAgent');
    await writeFile(join(root,'.orbit','skills','review.yml'),'id: review\nname: Review\n');
    const registry=new ProjectRegistry({one:async()=>({id:'project',name:'Project',local_path:root})} as unknown as Db),project=await registry.get('project','user');
    assert.equal(project.resources.find(resource=>resource.id==='developer')?.name,'Developer');
    assert.equal((await registry.document(project,'skills','review')).name,'Review');
    assert.ok(project.warnings.some(warning=>warning.includes('skills: recurso missing')));
    assert.ok(!project.warnings.some(warning=>warning.includes('rules')));
    await writeFile(join(root,'.orbit','agents','broken.md'),'---\nid: broken');
    const refreshed=await registry.get('project','user');assert.ok(refreshed.warnings.some(warning=>warning.includes('agents/broken')));
  }finally{await rm(root,{recursive:true,force:true})}
});
test('project skill prompts combine defaults, agent skills and card-specific skills',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-project-skills-'));
  try{
    await mkdir(join(root,'.orbit','agents'),{recursive:true});await mkdir(join(root,'.orbit','skills'));
    await writeFile(join(root,'.orbit','orbit.yaml'),'skills: [shared]\nexecution:\n  agent: developer\n  skills: [execution]\n');
    await writeFile(join(root,'.orbit','agents','developer.md'),'---\nid: developer\nskills: [agent-skill, shared]\n---\nAgent');
    await writeFile(join(root,'.orbit','agents','qa.md'),'---\nid: qa\nskills: [card-agent]\n---\nQA agent');
    for(const id of ['shared','execution','agent-skill','card-specific','card-agent'])await writeFile(join(root,'.orbit','skills',`${id}.md`),`---\nid: ${id}\n---\nInstructions for ${id}`);
    const registry=new ProjectRegistry({one:async()=>({id:'project',name:'Project',local_path:root})} as unknown as Db);
    const result=await registry.skillPrompt('project','user',['card-specific','execution'],'qa');
    assert.deepEqual(result.skills,['shared','execution','card-specific','agent-skill','card-agent']);
    for(const skill of result.skills)assert.ok(result.text.includes(`Instructions for ${skill}`));
  }finally{await rm(root,{recursive:true,force:true})}
});
test('plugin and executor registries enforce schemas, capabilities and permissions',async()=>{
  const plugins=new PluginRegistry();plugins.register(filesystemPlugin());
  assert.throws(()=>plugins.validate({plugin:'filesystem',action:'read',config:{path:'file'}},[]));
  assert.throws(()=>plugins.validate({plugin:'filesystem',action:'read',config:{path:'file',command:'arbitrary'}},['filesystem.read']));
  assert.throws(()=>plugins.validate({plugin:'unknown',action:'read'},[]));
  const executors=new ExecutorRegistry();executors.register({id:'test',name:'Test',actions:[{id:'run',name:'Run',permissions:[]}],async execute(){return {summary:'ok',outputs:[{type:'json',value:{ok:true}}]}}});
  assert.throws(()=>executors.get('missing'));
  assert.equal((await executors.get('test').execute({} as ExecutionInput)).summary,'ok');
});
