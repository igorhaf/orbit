import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Db } from '../db';
import { FeaturesService } from '../features';
import { SecretVault } from '../secrets';
import { GitPlugin } from './git.plugin';

const run=promisify(execFile);
test('card commit draft selects only its dirty files and leaves other work untouched',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-git-draft-'));
  const cardId=randomUUID(),projectId=randomUUID(),ownerId=randomUUID(),repoId=randomUUID(),boardId=randomUUID(),listId=randomUUID();
  const git=async(...args:string[])=>(await run('git',args,{cwd:root})).stdout.trim();
  try{
    await git('init','-b','develop');await git('config','user.name','Orbit Test');await git('config','user.email','orbit-test@example.invalid');
    await mkdir(join(root,'src'));await writeFile(join(root,'src/a.ts'),'export const a=1;\n');await git('add','src/a.ts');await git('commit','-m','chore: initial');
    await writeFile(join(root,'src/a.ts'),'export const a=2;\n');await writeFile(join(root,'src/b.ts'),'export const b=1;\n');await writeFile(join(root,'.env'),'SECRET=fixture\n');
    const repository={id:repoId,project_id:projectId,owner_id:ownerId,name:'App',relative_path:'.',remote_name:'origin',branches:['develop'],local_path:root};
    let promptRuns:Array<{summary:string|null;file_changes:Array<{path:string;kind:string}>;suggested_commit_type:string|null;suggested_commit_name:string|null;suggested_commit_summary:string|null}>=[];
    const db={
      one:async(sql:string)=>{
        if(sql.includes('SELECT COALESCE(c.ai_project_id'))return {project_id:projectId,board_id:boardId,list_id:listId,title:'Corrigir calendário'};
        if(sql.includes('FROM ai_projects'))return {id:projectId,local_path:root};
        if(sql.includes('FROM git_repositories'))return repository;
        if(sql.includes('SELECT created_at FROM git_card_commits'))return null;
        if(sql.startsWith('INSERT INTO git_card_commits'))return {sha:await git('rev-parse','HEAD')};
        throw new Error(`Consulta inesperada: ${sql}`);
      },
      query:async(sql:string)=>{
        if(sql.includes('FROM git_pipeline_targets'))return [];
        if(sql.includes('FROM card_ai_runs'))return promptRuns;
        throw new Error(`Consulta inesperada: ${sql}`);
      },
    } as unknown as Db;
    const features={cardBoard:async()=>boardId} as unknown as FeaturesService;
    const plugin=new GitPlugin(db,features,{} as SecretVault);
    const noPromptDraft=await plugin.commitDraft(cardId,ownerId,repoId);
    assert.equal(noPromptDraft.type,'');
    assert.equal(noPromptDraft.subject,'');
    assert.equal(noPromptDraft.description,'');
    assert.equal(noPromptDraft.source,'manual');
    assert.equal(noPromptDraft.has_commit_suggestion,false);
    promptRuns=[{summary:'Corrige abertura no calendário.',file_changes:[{path:'src/a.ts',kind:'update'}],suggested_commit_type:'refactor',suggested_commit_name:null,suggested_commit_summary:'Centraliza a lógica de abertura.'}];
    const draft=await plugin.commitDraft(cardId,ownerId,repoId);
    assert.equal(draft.branch,'develop');
    assert.equal(draft.type,'refactor');
    assert.equal(draft.subject,'Centraliza a lógica de abertura.');
    assert.equal(draft.description,'');
    assert.equal(draft.has_commit_suggestion,true);
    assert.deepEqual(draft.files.map(file=>[file.path,file.suggested]),[['src/a.ts',true],['src/b.ts',false]]);
    await plugin.commit(cardId,ownerId,{repository_id:repoId,type:draft.type,subject:draft.subject,description:draft.description,paths:draft.files.filter(file=>file.suggested).map(file=>file.path)});
    assert.match(await git('log','-1','--format=%B'),/^refactor: Centraliza a lógica de abertura/);
    assert.match(await git('status','--porcelain'),/src\/b\.ts/);
    assert.doesNotMatch(await git('show','--format=','--name-only','HEAD'),/src\/b\.ts/);
  }finally{await rm(root,{recursive:true,force:true})}
});
