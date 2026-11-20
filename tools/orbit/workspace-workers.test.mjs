import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
const require=createRequire(join(root,'forge/app/package.json'));
process.env.TSX_TSCONFIG_PATH=join(root,'forge/app/apps/api/tsconfig.json');
require('tsx/cjs/api').register();
const ts=require('typescript');
const {CardExecutionService}=require(join(root,'forge/app/apps/api/src/execution/execution.service.ts'));
const {PluginRegistry}=require(join(root,'forge/app/apps/api/src/execution/registries.ts'));
const {emptyConfig}=require(join(root,'forge/app/apps/api/src/execution/types.ts'));
// Evaluate the actual prompt service with only its quota function replaced. Never create
// an application, Codex service, real pool, HOME or network connection.
const source=join(root,'forge/app/apps/api/src/plugins/ai/prompt-sessions.ts');
const module={exports:{}};let quotaChecks=0;
const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
const localRequire=createRequire(source);
vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${compiled}\n})`,{filename:source})(specifier=>specifier==='../../codex-limits'?{enforceCodexQuota:async()=>{quotaChecks++}}:localRequire(specifier),module,module.exports,source,dirname(source));
const {PromptSessionsService}=module.exports;
// This harness covers legacy runs. Full manifest-enabled queues have their own context-workers suite.
const latch=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

for(const first of ['generic','prompt'])test(`actual worker boundaries coordinate ${first} first without any provider`,{timeout:15000},async t=>{
 const workspace=mkdtempSync(join(tmpdir(),'orbit-actual-workers-'));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 const genericId='10000000-0000-4000-8000-000000000001',promptId='10000000-0000-4000-8000-000000000002';
 let promptStatus='queued',promptService;let writers=0,maximum=0,completed=false;const events=[];
 const entered={generic:latch(),prompt:latch()},release={generic:latch(),prompt:latch()},promptDone=latch();
 const card={id:promptId,title:'Fixture',description:'Fixture demand',board_id:'board',card_revision:1,ai_execution_mode:'bypass',ai_project_id:'project',ai_model:'fake',ai_effort:'high'};
 const query=async(sql,args=[])=>{
  if(sql.includes('pg_try_advisory_lock'))return [{locked:true}];
  if(sql.includes('SELECT c.id')||sql.includes('SELECT c.*'))return [{...card,id:sql.includes('SELECT c.*')?genericId:promptId}];
  if(sql.includes('SELECT id,name,local_path'))return [{id:'project',name:'Fixture',local_path:workspace,is_internal_orbit:false}];
  if(sql.includes('SELECT card_revision FROM cards'))return [{card_revision:1}];
  if(sql.includes('INSERT INTO card_ai_runs'))return [{id:'prompt-run'}];
  if(sql.includes('SELECT status,worker_id'))return [{status:promptStatus,worker_id:promptService.workerId}];
  if(sql.includes('SELECT status FROM card_ai_runs'))return [{status:promptStatus}];
  if(sql.includes('SELECT id FROM card_ai_runs'))return sql.includes('ORDER BY')?[{id:'prompt-run'}]:[];
  if(sql.includes("SET status='running'")){promptStatus='running';return [{id:'prompt-run'}]}
  if(sql.includes('SET status=$2')){promptStatus=args[1];return [{id:'prompt-run'}]}
  if(sql.includes('SELECT 1 FROM card_ai_runs'))return [{id:'prompt-run'}];
  if(sql.includes('RETURNING cancel_requested'))return [{cancel_requested:false}];
  if(sql.startsWith('SELECT board_id FROM lists'))return [{board_id:'board'}];
  return [];
 };
 const db={query,one:async(sql,args)=>(await query(sql,args))[0]||null,pool:{connect:async()=>Object.assign(new EventEmitter(),{query:async(sql,args)=>({rows:await query(sql,args)}),release(){}})}};
 const features={cardBoard:async()=> 'board',notify:async()=>{},record:async()=>{}};
 const eventBus={boardChanged(){},promptProgress(_board,_card,event){events.push(event);if(event.status==='success'||event.status==='error')promptDone.resolve(event)}};
 const write=async name=>{writers++;maximum=Math.max(maximum,writers);entered[name].resolve();try{await release[name].promise;writeFileSync(join(workspace,name+'.txt'),name)}finally{writers--}};
 const registry=new PluginRegistry();
 const generic=new CardExecutionService(db,features,{},eventBus,registry,{});
 Object.assign(generic.runs,{stage:async()=>{},finish:async(_run,status)=>{assert.equal(status,'success');completed=true}});
 Object.assign(generic,{resolved:async()=>({project:{id:'project',root:workspace,config:{}},context:{workingDirectory:workspace,prompt:'Fixture',resources:[]},executor:{execute:async()=>{await write('generic');return {summary:'done',outputs:[]}}}})});
 promptService=new PromptSessionsService(db,features,{isAvailable:()=>true,execute:async()=>{await write('prompt');return {output:'Done',sessionId:null,fileChanges:[],activities:[]}}},eventBus);
 Object.assign(promptService,{traceContextAvailable:()=>false,localPath:async()=>workspace,queuePaused:async()=>false,descriptionImages:async()=>[]});
 const config={...emptyConfig(),skills:[],context:{write_scope:['generic.txt']}};
 const run={id:'generic-run',card_id:genericId,project_id:'project',user_id:'user',executor:'fake',action:'write',status:'running',input:{config,card:{id:genericId,title:'Fixture',description:'Fixture demand'}},cancel_requested:false};
 let genericWork;
 if(first==='generic'){genericWork=generic.processRun(run);await entered.generic.promise;await promptService.execute(promptId,'user')}
 else{await promptService.execute(promptId,'user');await entered.prompt.promise;genericWork=generic.processRun(run)}
 const second=first==='generic'?'prompt':'generic';
 let secondEntered=false;void entered[second].promise.then(()=>secondEntered=true);
 await pause(120);assert.equal(secondEntered,false,'the second real worker bypassed the coordinator');
 release[first].resolve();await entered[second].promise;release[second].resolve();
 await genericWork;const final=await promptDone.promise;assert.equal(final.status,'success');
 await pause(50);assert.equal(maximum,1);assert.equal(completed,true);assert.equal(readFileSync(join(workspace,'generic.txt'),'utf8'),'generic');assert.equal(readFileSync(join(workspace,'prompt.txt'),'utf8'),'prompt');
 assert.ok(events.some(event=>event.message?.includes('exclusividade física'))||first==='prompt');assert.ok(quotaChecks>0);
});

test('historical C1/C3 remain reproducible only in an uncoordinated disposable baseline',async t=>{
 const workspace=mkdtempSync(join(tmpdir(),'orbit-historical-rollback-'));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 const {captureFileScope}=require(join(root,'forge/app/apps/api/src/execution/file-scope.ts'));
 const first=await captureFileScope(workspace,['a.txt']),second=await captureFileScope(workspace,['b.txt']);
 writeFileSync(join(workspace,'a.txt'),'A');writeFileSync(join(workspace,'b.txt'),'B');
 await assert.rejects(first,/revertidas/);
 assert.throws(()=>readFileSync(join(workspace,'b.txt')));
 await assert.rejects(second,/revertidas/);
 assert.throws(()=>readFileSync(join(workspace,'a.txt')));
 const uncoordinated=await captureFileScope(workspace,['a.txt']);
 writeFileSync(join(workspace,'other-writer.txt'),'unattributed');
 await uncoordinated.rollback();
 assert.throws(()=>readFileSync(join(workspace,'other-writer.txt')));
});
