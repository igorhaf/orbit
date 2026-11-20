import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const require=createRequire(join(root,'forge/app/package.json'));
process.env.TSX_TSCONFIG_PATH=join(root,'forge/app/apps/api/tsconfig.json');
require('tsx/cjs/api').register();
const {CodexAiService}=require(join(root,'forge/app/apps/api/src/plugins/ai/codex-provider.ts'));
const {CodexExecutor}=require(join(root,'forge/app/apps/api/src/execution/codex-executor.ts'));
const {withWorkspaceWriteLease}=require(join(root,'forge/app/apps/api/src/execution/workspace-coordinator.ts'));
const {withIsolatedExecution}=require(join(root,'forge/app/apps/api/src/execution/isolated-execution-policy.ts'));

test('real provider uses only a fake CLI with isolated sandbox arguments, sanitized env and no original-directory fallback',{timeout:15000},async t=>{
 const directory=mkdtempSync(join(tmpdir(),'orbit-isolated-fake-cli-')),tree=join(directory,'tree'),home=join(directory,'fake-home'),binary=join(directory,'fake-codex');
 mkdirSync(tree,{mode:0o700});mkdirSync(home,{mode:0o700});
 const saved=Object.fromEntries(['CODEX_BIN','DATABASE_URL','GIT_WORK_TREE','HOME','CODEX_HOME'].map(k=>[k,process.env[k]]));
 Object.assign(process.env,{CODEX_BIN:binary,DATABASE_URL:'synthetic-must-not-inherit',GIT_WORK_TREE:'/synthetic-wrong-tree',HOME:home,CODEX_HOME:home});
 t.after(()=>{for(const key of Object.keys(saved)){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]}rmSync(directory,{recursive:true,force:true})});
 const log=join(directory,'args.json');
 writeFileSync(binary,`#!/usr/bin/node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({args,env:{HOME:process.env.HOME,CODEX_HOME:process.env.CODEX_HOME,DATABASE_URL:process.env.DATABASE_URL,GIT_WORK_TREE:process.env.GIT_WORK_TREE}}));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],'synthetic result');process.stdin.resume();\n`,{mode:0o700});
 const db={pool:{connect:async()=>Object.assign(new EventEmitter(),{query:async sql=>({rows:sql.includes('pg_try_advisory_lock')?[{locked:true}]:[]}),release(){}})}};
 const provider=new CodexAiService();let homes=0;
 provider.codexHome=async()=>{homes++;return home};
 const runId=randomUUID();
 await withWorkspaceWriteLease(db,{queue:'card_ai_runs',runId,cardId:randomUUID(),projectId:randomUUID(),projectRoot:tree},async()=>{
  await withIsolatedExecution({runId,queue:'card_ai_runs',root:tree,baseCommit:'a'.repeat(40),cardRevision:1},async()=>{
   const result=await provider.execute('Synthetic demand',tree,'fake','low');
   assert.equal(result.output,'synthetic result');
   let recorded=JSON.parse(readFileSync(log));
   assert.equal(recorded.args[recorded.args.indexOf('--sandbox')+1],'workspace-write');
   assert.equal(recorded.args.includes('--dangerously-bypass-approvals-and-sandbox'),false);
   assert.equal(recorded.args[recorded.args.indexOf('-C')+1],tree);
   assert.equal(recorded.env.HOME,'/nonexistent');assert.equal(recorded.env.CODEX_HOME,home);
   assert.equal(recorded.env.DATABASE_URL,undefined);assert.equal(recorded.env.GIT_WORK_TREE,undefined);
   assert.ok(recorded.args.includes('mcp_servers={}'));assert.ok(recorded.args.includes('sandbox_workspace_write.network_access=false'));
   await provider.execute('Synthetic read',tree,'fake','low',undefined,undefined,undefined,undefined,'planning');
   recorded=JSON.parse(readFileSync(log));assert.equal(recorded.args[recorded.args.indexOf('--sandbox')+1],'read-only');
   const before=homes;
   await assert.rejects(()=>provider.complete('Must not fall back to process.cwd()'),/worktree/);
   await assert.rejects(()=>new CodexExecutor().execute({projectRoot:tree,workingDirectory:directory}),/worktree/);
   assert.equal(homes,before,'rejected directories must not prepare any Codex HOME');
  });
 });
});
