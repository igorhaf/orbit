import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Db } from '../db';
import { FeaturesService } from '../features';
import { SecretVault } from '../secrets';
import { GitPlugin } from './git.plugin';

const run=promisify(execFile);
test('add, partial merge, ignore, commit and push use only the configured branch',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-git-flow-')),remote=await mkdtemp(join(tmpdir(),'orbit-git-remote-'));
  const cardId=randomUUID(),projectId=randomUUID(),ownerId=randomUUID(),repoId=randomUUID(),boardId=randomUUID(),listId=randomUUID();
  const git=async(...args:string[])=>(await run('git',args,{cwd:root})).stdout.trim();
  try{
    await git('init','-b','develop');await git('config','user.name','Orbit Test');await git('config','user.email','orbit-test@example.invalid');
    await writeFile(join(root,'feature.txt'),'one\ntwo\nthree\n');await writeFile(join(root,'tracked.log'),'old\n');await git('add','feature.txt','tracked.log');await git('commit','-m','chore: initial');
    await run('git',['init','--bare',remote]);await git('remote','add','origin',remote);await git('push','-u','origin','develop');
    await writeFile(join(root,'feature.txt'),'ONE\ntwo\nTHREE\n');await writeFile(join(root,'notes.tmp'),'local only\n');await writeFile(join(root,'tracked.log'),'new\n');
    const repository={id:repoId,project_id:projectId,owner_id:ownerId,name:'App',relative_path:'.',remote_name:'origin',branches:['develop'],local_path:root};
    const db={one:async(sql:string)=>{
      if(sql.includes('SELECT COALESCE(c.ai_project_id'))return {project_id:projectId,board_id:boardId,list_id:listId,title:'Corrigir recurso'};
      if(sql.includes('FROM ai_projects'))return {id:projectId,local_path:root};
      if(sql.includes('FROM git_repositories'))return repository;
      if(sql.startsWith('INSERT INTO git_card_commits'))return {sha:await git('rev-parse','HEAD')};
      throw new Error(`Consulta inesperada: ${sql}`);
    },query:async(sql:string)=>{if(sql.includes('FROM git_pipeline_targets'))return [];throw new Error(`Consulta inesperada: ${sql}`)}} as unknown as Db;
    const plugin=new GitPlugin(db,{cardBoard:async()=>boardId} as unknown as FeaturesService,{} as SecretVault);
    const review=await plugin.workingFileDiff(cardId,ownerId,repoId,'feature.txt');
    assert.equal(review.binary,false);assert.equal(review.too_large,false);
    assert.equal(review.sections.filter(section=>section.kind==='change').length,2);
    await plugin.stageHunks(cardId,ownerId,repoId,{path:'feature.txt',etag:review.etag,choices:[true,false]});
    assert.equal(await git('show',':feature.txt'),'ONE\ntwo\nthree');
    assert.equal(await readFile(join(root,'feature.txt'),'utf8'),'ONE\ntwo\nTHREE\n');
    const stagedReview=await plugin.workingFileDiff(cardId,ownerId,repoId,'feature.txt');
    await plugin.stageHunks(cardId,ownerId,repoId,{path:'feature.txt',etag:stagedReview.etag,source:'index',choices:[false]});
    assert.equal(await git('show',':feature.txt'),'one\ntwo\nthree');
    const refreshed=await plugin.workingFileDiff(cardId,ownerId,repoId,'feature.txt');
    await plugin.stageHunks(cardId,ownerId,repoId,{path:'feature.txt',etag:refreshed.etag,choices:[true,false]});
    const staged=await plugin.stageFiles(cardId,ownerId,repoId,{paths:['feature.txt'],ignore_paths:['notes.tmp','tracked.log']});
    assert.deepEqual(staged.files.sort(),['.gitignore','feature.txt','tracked.log']);
    assert.equal(await git('show',':feature.txt'),'ONE\ntwo\nthree');
    await plugin.commitPrepared(cardId,ownerId,{repository_id:repoId,type:'fix',subject:'Corrigir primeira linha',description:'Primeiro trecho revisado\nArquivo temporário ignorado',paths:staged.files});
    assert.match(await git('log','-1','--format=%B'),/^fix: Corrigir primeira linha/);
    assert.equal(await git('show','HEAD:feature.txt'),'ONE\ntwo\nthree');
    assert.equal(await readFile(join(root,'feature.txt'),'utf8'),'ONE\ntwo\nTHREE\n');
    assert.equal((await git('check-ignore','notes.tmp')),'notes.tmp');
    assert.equal((await git('check-ignore','tracked.log')),'tracked.log');
    assert.equal(await readFile(join(root,'tracked.log'),'utf8'),'new\n');
    await plugin.gitOperation(cardId,ownerId,{repository_id:repoId,operation:'push'});
    assert.equal(await git('rev-parse','HEAD'),(await run('git',['--git-dir',remote,'rev-parse','refs/heads/develop'])).stdout.trim());
    await assert.rejects(()=>plugin.gitOperation(cardId,ownerId,{repository_id:repoId,operation:'pull'}),/árvore de trabalho deve estar limpa/);
  }finally{await rm(root,{recursive:true,force:true});await rm(remote,{recursive:true,force:true})}
});

test('desfazer e refazer commit do cartão criam commits reversíveis sem mover a branch para trás',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-git-undo-'));
  const cardId=randomUUID(),projectId=randomUUID(),ownerId=randomUUID(),repoId=randomUUID(),boardId=randomUUID(),listId=randomUUID();
  const git=async(...args:string[])=>(await run('git',args,{cwd:root})).stdout.trim();
  try{
    await git('init','-b','develop');await git('config','user.name','Orbit Test');await git('config','user.email','orbit-test@example.invalid');
    await writeFile(join(root,'feature.txt'),'before\n');await git('add','.');await git('commit','-m','chore: initial');
    await writeFile(join(root,'feature.txt'),'after\n');await git('add','.');await git('commit','-m','feat: card change');
    const original=await git('rev-parse','HEAD');let latest:{sha:string;action:'undo'|'redo'}|null=null;
    const repository={id:repoId,project_id:projectId,owner_id:ownerId,name:'App',relative_path:'.',remote_name:'origin',branches:['develop'],local_path:root};
    const db={one:async(sql:string,params:unknown[])=>{
      if(sql.includes('SELECT COALESCE(c.ai_project_id'))return {project_id:projectId,board_id:boardId,list_id:listId,title:'Card'};
      if(sql.includes('FROM ai_projects'))return {id:projectId,local_path:root};
      if(sql.includes('FROM git_repositories'))return repository;
      if(sql.includes('SELECT sha,branch,action,merge,title FROM git_card_commits'))return params[2]===original?{sha:original,branch:'develop',action:'commit',merge:false,title:'feat: card change'}:null;
      if(sql.includes('SELECT sha,action FROM git_card_commits'))return latest;
      if(sql.startsWith('INSERT INTO git_card_commits')){latest={sha:params[2] as string,action:params[9] as 'undo'|'redo'};return latest;}
      throw new Error(`Consulta inesperada: ${sql}`);
    },query:async(sql:string)=>{if(sql.includes('FROM git_pipeline_targets'))return [];throw new Error(`Consulta inesperada: ${sql}`)}} as unknown as Db;
    const plugin=new GitPlugin(db,{cardBoard:async()=>boardId} as unknown as FeaturesService,{} as SecretVault);
    await plugin.toggleCardCommit(cardId,ownerId,repoId,original);
    assert.equal(await readFile(join(root,'feature.txt'),'utf8'),'before\n');
    assert.equal((latest as {action:string}|null)?.action,'undo');
    assert.notEqual(await git('rev-parse','HEAD'),original);
    await plugin.toggleCardCommit(cardId,ownerId,repoId,original);
    assert.equal(await readFile(join(root,'feature.txt'),'utf8'),'after\n');
    assert.equal((latest as {action:string}|null)?.action,'redo');
  }finally{await rm(root,{recursive:true,force:true})}
});
