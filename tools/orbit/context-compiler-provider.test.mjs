import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=fileURLToPath(new URL('../..',import.meta.url)),require=createRequire(join(root,'forge/app/package.json'));
process.env.TSX_TSCONFIG_PATH=join(root,'forge/app/apps/api/tsconfig.json');require('tsx/cjs/api').register();
const api=join(root,'forge/app/apps/api/src');
const {CodexAiService}=require(join(api,'plugins/ai/codex-provider.ts'));
const {withWorkspaceWriteLease}=require(join(api,'execution/workspace-coordinator.ts'));
const {withIsolatedExecution}=require(join(api,'execution/isolated-execution-policy.ts'));
const {defaultContextCompilerPolicy}=require(join(api,'execution/context-compiler.ts'));
const {hashContextText}=require(join(api,'execution/context-manifest.ts'));

test('compiled delivery receipts match actual fake CLI stdin in both adapters',{timeout:20000},async t=>{
 const directory=mkdtempSync(join(tmpdir(),'orbit05-delivery-')),tree=join(directory,'tree'),home=join(directory,'home'),binary=join(directory,'fake-cli'),log=join(directory,'delivered.json');
 mkdirSync(tree,{mode:0o700});mkdirSync(home,{mode:0o700});
 const keys=['CODEX_BIN','HOME','CODEX_HOME','DATABASE_URL','OPENAI_API_KEY'],saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{CODEX_BIN:binary,HOME:home,CODEX_HOME:home});delete process.env.DATABASE_URL;delete process.env.OPENAI_API_KEY;
 t.after(()=>{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]}rmSync(directory,{recursive:true,force:true})});
 writeFileSync(binary,`#!/usr/bin/node\nconst fs=require('node:fs');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({input,args,home:process.env.CODEX_HOME}));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],'Fixture output');});\n`,{mode:0o700});
 // Override only the legacy home adapter, so neither test can inspect/create real Orbit sessions.
 const source=join(api,'execution/codex-executor.ts'),ts=require('typescript'),module={exports:{}},localRequire=createRequire(source);
 const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${compiled}\n})`,{filename:source})(id=>id==='../codex-home'?{prepareOrbitCodexHome:async()=>home}:localRequire(id),module,module.exports,source,dirname(source));
 const {CodexExecutor}=module.exports,provider=new CodexAiService();provider.codexHome=async()=>home;
 const db={pool:{connect:async()=>Object.assign(new EventEmitter(),{query:async sql=>({rows:sql.includes('pg_try_advisory_lock')?[{locked:true}]:[]}),release(){}})}};
 const runId=randomUUID(),text='Contexto compilado sintético: execute apenas a tarefa atual.',policy=defaultContextCompilerPolicy(),receipts=[];
 const contract={compiledHash:hashContextText(text),policy,onDelivery:async receipt=>{receipts.push(receipt)}};
 await withWorkspaceWriteLease(db,{queue:'card_runs',runId,cardId:randomUUID(),projectId:randomUUID(),projectRoot:tree},async()=>withIsolatedExecution({runId,queue:'card_runs',root:tree,baseCommit:'b'.repeat(40),cardRevision:1},async()=>{
  await provider.execute(text,tree,'fake','low',undefined,null,undefined,undefined,'planning',[],undefined,[],false,false,contract);
  let recorded=JSON.parse(readFileSync(log));assert.equal(recorded.input,text);assert.equal(receipts.at(-1).envelopeHash,hashContextText(recorded.input));assert.equal(recorded.home,home);assert.equal(receipts.at(-1).compiledHash,hashContextText(text));
  assert.equal(recorded.args.includes('--dangerously-bypass-approvals-and-sandbox'),false);
  const generic=new CodexExecutor();
  const input={runId,cardId:randomUUID(),userId:randomUUID(),projectId:randomUUID(),title:'Fixture',prompt:text,workingDirectory:tree,projectRoot:tree,permissions:['filesystem.read'],action:'analyze',integrations:[],signal:new AbortController().signal,contextDelivery:contract};
  await generic.execute(input);recorded=JSON.parse(readFileSync(log));assert.ok(recorded.input.endsWith(text));assert.equal(receipts.at(-1).envelopeHash,hashContextText(recorded.input));assert.equal(receipts.length,2);
  const last=readFileSync(log,'utf8');await assert.rejects(()=>generic.execute({...input,prompt:text+' unauthorized delta'}),/diverge/);assert.equal(readFileSync(log,'utf8'),last);
 }));
});
