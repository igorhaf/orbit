import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {Db} from '../db';
import {FeaturesService} from '../features';
import {SecretVault} from '../secrets';
import {PluginRegistry} from '../execution/registries';
import {GitPlugin,gitPluginDefinition} from './git.plugin';

const execute=promisify(execFile);
const fixtureGit=async(dir:string,...args:string[])=>(await execute('git',args,{cwd:dir})).stdout.trim();

test('Git plugin versions without deploy, uses configured branches and tracks a pipeline',async()=>{
  const db=new Db(),schema='git_test_'+randomUUID().replaceAll('-',''),root=await mkdtemp(join(tmpdir(),'orbit-git-test-')),remote=await mkdtemp(join(tmpdir(),'orbit-git-remote-'));
  const originalFetch=globalThis.fetch;
  await db.query(`CREATE SCHEMA ${schema}`);await db.pool.end();db.pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
  try{
    await db.query(await readFile(resolve(__dirname,'../../sql/schema.sql'),'utf8'));
    await fixtureGit(root,'init','-b','main');await fixtureGit(root,'config','user.email','orbit-test@example.invalid');await fixtureGit(root,'config','user.name','Orbit Test');
    await writeFile(join(root,'README.md'),'initial\n');await fixtureGit(root,'add','README.md');await fixtureGit(root,'commit','-m','chore: initial');
    await fixtureGit(remote,'init','--bare');await fixtureGit(root,'remote','add','origin',remote);
    const owner=(await db.one<{id:string}>('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id',['Git Owner',`${randomUUID()}@example.invalid`,'test']))!.id;
    const reader=(await db.one<{id:string}>('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id',['Git Reader',`${randomUUID()}@example.invalid`,'test']))!.id;
    const project=(await db.one<{id:string}>('INSERT INTO ai_projects(owner_id,name,local_path) VALUES($1,$2,$3) RETURNING id',[owner,'Git project',root]))!.id;
    const board=(await db.one<{id:string}>('INSERT INTO boards(title,owner_id,ai_default_project_id) VALUES($1,$2,$3) RETURNING id',['Git board',owner,project]))!.id;
    await db.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",[board,owner,reader]);
    const list=(await db.one<{id:string}>('INSERT INTO lists(board_id,title,position) VALUES($1,$2,0) RETURNING id',[board,'Ready']))!.id;
    const card=(await db.one<{id:string}>('INSERT INTO cards(list_id,title,description) VALUES($1,$2,$3) RETURNING id',[list,'Build feature','']))!.id;
    const plugin=new GitPlugin(db,new FeaturesService(db),new SecretVault());
    const registry=new PluginRegistry();registry.register(gitPluginDefinition(plugin));
    assert.deepEqual(registry.catalog().find(item=>item.id==='git')?.actions.map(action=>action.id),['history','commit','operation','deploy']);
    const repo=await plugin.addRepository(project,owner,{name:'App',relative_path:'.',branches:['main','develop'],remote_name:'origin'}) as {id:string};
    const empty=await plugin.projectConfig(project,owner);assert.equal(empty.targets.length,0);
    await assert.rejects(()=>plugin.commit(card,owner,{repository_id:repo.id,type:'feat',paths:['.env']}),/Caminho de arquivo inválido/);
    await assert.rejects(()=>plugin.commit(card,owner,{repository_id:repo.id,type:'feat',paths:['.']}),/Caminho de arquivo inválido/);
    await writeFile(join(root,'feature.txt'),'feature content\n');
    const committed=await plugin.commit(card,owner,{repository_id:repo.id,type:'feat',subject:'Build feature',paths:['feature.txt']}) as {sha:string;title:string;comments:string;files:string[]};
    assert.match(committed.title,/^feat: Build feature$/);assert.ok(committed.comments.split('\n').length<=2);assert.deepEqual(committed.files,['feature.txt']);
    await plugin.gitOperation(card,owner,{repository_id:repo.id,operation:'push'});
    await plugin.gitOperation(card,owner,{repository_id:repo.id,operation:'pull'});
    const history=await plugin.cardHistory(card,reader);assert.equal(history.commits.length,1);assert.equal(history.repositories.length,1);assert.equal(history.targets.length,0);assert.equal(history.can_write,false);
    await assert.rejects(()=>plugin.commit(card,reader,{repository_id:repo.id,type:'fix',paths:['feature.txt']}),/Projeto não encontrado/);
    const linked=await plugin.linkCommit(card,owner,{repository_id:repo.id,sha:committed.sha,branch:'main'});assert.ok(linked);
    await fixtureGit(root,'checkout','-b','side');await writeFile(join(root,'side.txt'),'side branch\n');await fixtureGit(root,'add','side.txt');await fixtureGit(root,'commit','-m','feat: side');
    await fixtureGit(root,'checkout','main');await fixtureGit(root,'merge','--no-ff','side','-m','Merge side into main');
    const mergeSha=await fixtureGit(root,'rev-parse','HEAD');
    const merge=await plugin.linkCommit(card,owner,{repository_id:repo.id,sha:mergeSha,branch:'main'}) as {merge:boolean;files:string[]};
    assert.equal(merge.merge,true);assert.ok(merge.files.includes('side.txt'));
    const targets=[
      {name:'GitHub',provider:'github_actions',base_url:'https://api.github.com',external_project:'owner/repo',pipeline_ref:'deploy.yml'},
      {name:'GitLab',provider:'gitlab_ci',base_url:'https://gitlab.example.com',external_project:'team/repo',pipeline_ref:'default'},
      {name:'Bamboo',provider:'bamboo',base_url:'https://bamboo.example.com',external_project:'PROJ',pipeline_ref:'PROJ-PLAN'},
    ];
    const created=[] as Array<{id:string}>;
    for(const target of targets)created.push((await plugin.addTarget(repo.id,owner,{...target,branches:['main'],stages:['production'],token:'fixture-secret'})) as {id:string});
    const sshTarget=await plugin.addTarget(repo.id,owner,{...targets[0],name:'GitHub SSH',branches:['main'],stages:['production'],token:'fixture-secret',deployment_method:'ssh',git_flow:'commit_push'}) as {id:string};
    const syncTarget=await plugin.addTarget(repo.id,owner,{...targets[0],name:'GitHub Git sync',branches:['main'],stages:[],token:'fixture-secret',deployment_method:'git',git_flow:'pull_push'}) as {id:string};
    assert.equal((await plugin.projectConfig(project,owner)).targets.length,5);
    await assert.rejects(()=>plugin.linkCommit(card,owner,{repository_id:repo.id,sha:committed.sha,branch:'develop'}),/nenhum pipeline configurado/);
    const row=await db.one<{credentials_encrypted:string}>('SELECT credentials_encrypted FROM git_pipeline_targets WHERE id=$1',[created[0].id]);assert.ok(row&&!row.credentials_encrypted.includes('fixture-secret'));
    await plugin.mapColumn(list,created[0].id,owner,{stage_key:'production'});
    globalThis.fetch=async(input)=>String(input).includes('/jobs?')?new Response(JSON.stringify({jobs:[{name:'Deploy via SSH',status:'completed',conclusion:'success'}]}),{status:200}):String(input).includes('/actions/runs/')?new Response(JSON.stringify({status:'completed',conclusion:'success'}),{status:200}):new Response(JSON.stringify({workflow_run_id:42}),{status:200});
    await assert.rejects(()=>plugin.deploy(card,owner,{target_id:created[0].id,branch:'other'}),/não está configurada/);
    const run=await plugin.deploy(card,owner,{target_id:created[0].id,branch:'main'}) as {id:string;stage_key:string;status:string};assert.equal(run.stage_key,'production');assert.equal(run.status,'queued');
    const refreshed=await plugin.refreshRun(run.id,owner);assert.equal(refreshed.status,'success');assert.match(refreshed.logs,/SSH/);
    await writeFile(join(root,'deploy.txt'),'deploy via SSH\n');
    const sshRun=await plugin.deploy(card,owner,{target_id:sshTarget.id,branch:'main',paths:['deploy.txt'],type:'chore'});
    assert.equal(sshRun.status,'queued');
    const syncRun=await plugin.deploy(card,owner,{target_id:syncTarget.id,branch:'main'});assert.equal(syncRun.status,'queued');
    assert.equal((await plugin.cardHistory(card,owner)).commits.length,3);
    assert.equal((await plugin.cardHistory(card,owner)).runs.length,3);
  }finally{globalThis.fetch=originalFetch;await db.pool.end();const cleanup=new Pool({connectionString:process.env.DATABASE_URL});try{await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)}finally{await cleanup.end()}await rm(root,{recursive:true,force:true});await rm(remote,{recursive:true,force:true})}
});
