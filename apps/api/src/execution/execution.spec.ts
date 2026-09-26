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
    const built=await new ContextBuilder({} as Db,registry).build(project,config,{id:'id',title:'Task',description:'Description'},'user');
    assert.ok(built.prompt.includes('Selected knowledge'));assert.ok(built.prompt.includes('Mandatory rules'));assert.ok(!built.prompt.includes('MUST NOT LOAD'));assert.equal(built.resources.length,5);
    await assert.rejects(()=>safePath(root,'../'));
    await assert.rejects(()=>safePath(root,'escape/passwd'));
    await assert.rejects(()=>safePath(root,'.env'));
    await assert.rejects(()=>new ContextBuilder({} as Db,registry).build(project,{...config,permissions:['filesystem.write']},{id:'id',title:'Task',description:''},'user'));
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
