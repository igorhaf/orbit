import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withWorkspaceWriteLease,currentWorkspaceWriteLease,assertWorkspaceWriteCoverage} from './workspace-coordinator';
import {captureFileScope} from './file-scope';
const fake=()=>({pool:{connect:async()=>Object.assign(new EventEmitter(),{query:async()=>({rows:[{locked:true}]}),release(){}})}});
const request=(root:string)=>({queue:'card_runs',runId:'synthetic-run',cardId:'synthetic-card',projectId:'synthetic-project',projectRoot:root});

test('core ownership exists only within callback and rejects uncovered roots',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-ownership-')),outside=await mkdtemp(join(tmpdir(),'orbit-uncovered-'));
  try{assert.equal(currentWorkspaceWriteLease(),undefined);await withWorkspaceWriteLease(fake(),request(root),async lease=>{assert.equal(currentWorkspaceWriteLease(),lease);await assertWorkspaceWriteCoverage(root);await assert.rejects(()=>assertWorkspaceWriteCoverage(outside),/fora da área/);assert.ok(lease.descriptors().length)});assert.equal(currentWorkspaceWriteLease(),undefined)}finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
});
test('guarded snapshot refuses destructive rollback without authorship and retains every file',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-guarded-rollback-'));let owner='';
  try{
    await writeFile(join(root,'before.txt'),'preexisting untracked work');
    await assert.rejects(()=>withWorkspaceWriteLease(fake(),request(root),async lease=>{owner=lease.owner;const scope=await captureFileScope(root,['allowed.txt']);await writeFile(join(root,'unknown.txt'),'unattributed change');await scope.rollback()}),/Conflito de autoria/);
    assert.equal(await readFile(join(root,'before.txt'),'utf8'),'preexisting untracked work');assert.equal(await readFile(join(root,'unknown.txt'),'utf8'),'unattributed change');
    await assert.rejects(()=>withWorkspaceWriteLease(fake(),request(root),async()=>undefined),/quarentena/);
  }finally{if(owner)await rm(`/tmp/orbit-write-coordination-${process.getuid?.()}/${owner}.json`,{force:true});await rm(root,{recursive:true,force:true})}
});
test('loss of authorization cannot be returned as successful callback completion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-guard-lost-'));let owner='';
  try{await assert.rejects(()=>withWorkspaceWriteLease(fake(),request(root),async lease=>{owner=lease.owner;lease.poison('synthetic loss');return 'not successful'}),/synthetic loss/)}finally{if(owner)await rm(`/tmp/orbit-write-coordination-${process.getuid?.()}/${owner}.json`,{force:true});await rm(root,{recursive:true,force:true})}
});
