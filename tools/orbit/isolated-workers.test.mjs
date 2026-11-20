import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
const require=createRequire(join(root,'forge/app/package.json'));
process.env.TSX_TSCONFIG_PATH=join(root,'forge/app/apps/api/tsconfig.json');
require('tsx/cjs/api').register();
const ts=require('typescript');
const {ProjectRegistry}=require(join(root,'forge/app/apps/api/src/execution/project-registry.ts'));
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

test('actual queues route only to the pinned isolated checkout, preserving revisions, questions and legacy sessions', {timeout:120000}, async t=>{
 const directory=mkdtempSync(join(tmpdir(),'orbit-isolated-workers-')),workspace=join(directory,'source'),storage=join(directory,'runs');
 mkdirSync(workspace,{mode:0o700});mkdirSync(storage,{mode:0o700});
 const keys=['ORBIT_ISOLATED_RUNS','ORBIT_WORKTREE_ROOT','HOME','CODEX_HOME','CODEX_BIN'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{ORBIT_ISOLATED_RUNS:'1',ORBIT_WORKTREE_ROOT:storage,HOME:directory,CODEX_HOME:join(directory,'no-codex-home'),CODEX_BIN:join(directory,'must-never-run')});

 const git=(...args)=>execFileSync('/usr/bin/git',['-C',workspace,'-c','core.hooksPath=/dev/null',...args],{env:{PATH:'/usr/bin:/bin',HOME:directory,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'},encoding:'utf8'}).trim();
 git('init','--quiet');writeFileSync(join(workspace,'shared.txt'),'baseline\n');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','baseline');
 const head=git('rev-parse','HEAD'),projectId=randomUUID(),workspaceId=randomUUID(),cardId=randomUUID(),userId=randomUUID();
 const ledger=new Map(),aiRuns=new Map(),calls=[];let latestRun,service,currentRevision=1;
 t.after(async()=>{for(let attempt=0;attempt<400&&[...aiRuns.values()].some(x=>['queued','running'].includes(x.status));attempt++)await pause(25);assert.equal([...aiRuns.values()].some(x=>['queued','running'].includes(x.status)),false,'do not delete a fixture with a live worker');const guards=`/tmp/orbit-write-coordination-${process.getuid()}`;if(existsSync(guards))for(const name of readdirSync(guards)){if(!name.endsWith('.json'))continue;const path=join(guards,name);let marker;try{marker=JSON.parse(readFileSync(path,'utf8'))}catch{continue}if(!ledger.has(marker.runId))continue;if(marker.roots.every(x=>x.path.startsWith(directory+'/'))){assert.equal(marker.pid,process.pid);rmSync(path);}}assert.equal(existsSync(join(directory,'no-codex-home')),false);for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]}rmSync(directory,{recursive:true,force:true});});
 const card=()=>({id:cardId,title:'Fixture',description:'Pinned demand',board_id:'board',workspace_id:workspaceId,card_revision:currentRevision,ai_execution_mode:'bypass',ai_project_id:projectId,ai_model:'fake',ai_effort:'high'});
 const query=async(sql,args=[])=>{
  if(sql.includes('pg_try_advisory_lock'))return [{locked:true}];
  if(sql.includes('FROM isolated_run_checkouts'))return ledger.has(args[1])?[ledger.get(args[1])]:[];
  if(sql.startsWith('INSERT INTO isolated_run_checkouts')){if(ledger.has(args[1]))return [];ledger.set(args[1],{queue:args[0],run_id:args[1],card_id:args[2],card_revision:args[3],project_id:args[4],workspace_id:args[5],owner_id:args[6],identity:JSON.parse(args[7]),state:'preparing',evidence:{}});return [{run_id:args[1]}]}
  if(sql.startsWith('UPDATE isolated_run_checkouts')){const row=ledger.get(args[1]);if(!row)return [];if(sql.includes("state='ready'")){if(row.state!=='awaiting_answer')return [];row.state='ready';return [{run_id:row.run_id}]};if(row.owner_id!==args[6])return [];Object.assign(row,{state:args[2],identity:JSON.parse(args[3]),evidence:JSON.parse(args[4]),diagnostic:args[5]});return [{run_id:row.run_id}]}
  if(sql.includes('RETURNING cancel_requested'))return [{cancel_requested:false}];
  if(sql.includes('SELECT c.id')||sql.includes('SELECT c.*'))return [card()];
  if(sql.includes('FROM ai_projects'))return [{id:projectId,name:'Fixture',local_path:workspace,is_internal_orbit:false}];
  if(sql.includes('SELECT card_revision FROM cards'))return [{card_revision:currentRevision}];
  if(sql.includes('request_key=$2'))return [...aiRuns.values()].filter(x=>x.request_key===args[1]);
  if(sql.startsWith('INSERT INTO card_ai_runs')){latestRun=randomUUID();aiRuns.set(latestRun,{id:latestRun,project_id:projectId,model:'fake',effort:'high',status:'queued',checkout_request:args[10]?JSON.parse(args[10]):undefined,request_key:args[11]});return [{id:latestRun}]}
  const row=aiRuns.get(args[0]);
  if(sql.includes('SELECT status,worker_id'))return row?[{status:row.status,worker_id:service.workerId}]:[];
  if(sql.includes('SELECT status FROM card_ai_runs'))return row?[{status:row.status}]:[];
  if(sql.includes('SELECT id FROM card_ai_runs'))return sql.includes('ORDER BY')?[...aiRuns.values()].filter(x=>['queued','waiting_answer'].includes(x.status)).map(x=>({id:x.id})):[];
  if(sql.includes('SELECT codex_session_id'))return [{codex_session_id:'legacy-session-must-not-cross-worktrees'}];
  if(sql.includes("SET status='queued'")){if(!row||row.status!=='waiting_answer')return [];row.status='queued';return [{id:row.id}]}
  if(sql.includes("SET status='running'")){if(!row||row.status!=='queued')return [];row.status='running';return [{id:row.id}]}
  if(sql.includes("SET status='waiting_answer'")){row.status='waiting_answer';row.codex_session_id=args[2];row.output=args[1];return [{id:row.id}]}
  if(sql.includes('SET status=$2')){row.status=args[1];return [{id:row.id}]}
  if(sql.includes("SET status='error'")){if(row)row.status='error';return row?[{id:row.id}]:[]}
  if(sql.includes('SELECT 1 FROM card_ai_runs'))return row?[{id:row.id}]:[];
  if(sql.includes('SELECT board_id FROM lists'))return [{board_id:'board'}];
  return [];
 };
 const db={query,one:async(sql,args)=>(await query(sql,args))[0]||null,pool:{connect:async()=>Object.assign(new EventEmitter(),{query:async(sql,args)=>({rows:await query(sql,args)}),release(){}})}};
 const events=[],features={cardBoard:async()=> 'board',notify:async()=>{},record:async()=>{}};
 const bus={boardChanged(){},promptProgress(_b,_c,event){events.push(event)}};
 const project={id:projectId,name:'Fixture',root:workspace,resourcesRoot:workspace,config:{},warnings:[],resources:[]};
 const projects=Object.assign(new ProjectRegistry(db),{get:async()=>project});
 const generic=new CardExecutionService(db,features,projects,bus,new PluginRegistry(),{});
 let terminal;
 Object.assign(generic.runs,{stage:async()=>{},finish:async(run,status,result,error)=>{terminal={status,result,error}}});
 const config={...emptyConfig(),project_id:projectId,executor:'plugin',action:'fixture',permissions:[],context:{}};
 Object.assign(generic,{resolved:async()=>({project,context:{workingDirectory:workspace,prompt:'Fixture',resources:[]},executor:{id:'plugin',execute:async input=>{calls.push({queue:'generic',path:input.projectRoot});assert.notEqual(input.projectRoot,workspace);currentRevision=2;writeFileSync(join(input.projectRoot,'shared.txt'),'generic result\n');return {summary:'done',outputs:[]}}}})});
 const {captureIsolationRequest}=require(join(root,'forge/app/apps/api/src/execution/isolated-checkout.ts'));
 const request=await captureIsolationRequest({...project,workspace_id:workspaceId}),genericRun=randomUUID();
 await generic.processRun({id:genericRun,card_id:cardId,card_revision:1,project_id:projectId,user_id:userId,executor:'plugin',action:'fixture',status:'running',input:{config,card:{id:cardId,title:'Fixture',description:'Pinned demand'},checkout_request:request}});
 assert.equal(terminal.status,'success',terminal.error);assert.equal(ledger.get(genericRun).card_revision,1);assert.equal(currentRevision,2);assert.equal(ledger.get(genericRun).evidence.integration,'not_integrated');
 const staleRun=randomUUID(),beforeStale=calls.length;
 await generic.processRun({id:staleRun,card_id:cardId,card_revision:1,project_id:projectId,user_id:userId,executor:'plugin',action:'fixture',status:'running',input:{config,card:{id:cardId,title:'Fixture',description:'Pinned demand'},checkout_request:request}});
 assert.equal(terminal.status,'failed');assert.match(terminal.error,/revisão|reconciliação/);assert.equal(calls.length,beforeStale,'queued stale revision must not invoke an executor');assert.equal(ledger.get(staleRun).evidence.executorStatus,'failed');
 let ask=false;
 service=new PromptSessionsService(db,features,{isAvailable:()=>true,execute:async(_prompt,path,_model,_effort,_progress,session)=>{
   calls.push({queue:'prompt',path,session});assert.notEqual(path,workspace);
   if(ask)return {output:'[[ORBIT_QUESTION]]\nProceed?\n[[/ORBIT_QUESTION]]',sessionId:'isolated-session',fileChanges:[],activities:[]};
   writeFileSync(join(path,'shared.txt'),'prompt result\n');return {output:'Done',sessionId:'isolated-session',fileChanges:[],activities:[]};
 }},bus);
 Object.assign(service,{traceContextAvailable:()=>false,localPath:async()=>workspace,queuePaused:async()=>false,descriptionImages:async()=>[],quota:async()=>{}});
 const wait=async(id,status)=>{for(let i=0;i<1600;i++){if(aiRuns.get(id)?.status===status)return;if(aiRuns.get(id)?.status==='error')assert.fail(`fixture worker failed: ${JSON.stringify(events.slice(-2))}`);await pause(25)}assert.fail(`run did not reach ${status}: ${JSON.stringify(events.slice(-2))}`)};
 const first=await service.execute(cardId,userId,{workspace_mode:'isolated',request_key:'first'});await wait(first.id,'success');
 assert.equal(calls.at(-1).session,null,'a legacy session must not be resumed in the isolated worktree');
 const before=calls.length;assert.equal((await service.execute(cardId,userId,{workspace_mode:'isolated',request_key:'first'})).id,first.id);assert.equal(calls.length,before);
 ask=true;const originalCard=service.card.bind(service);service.card=async(...args)=>{const value=await originalCard(...args);value.card.ai_execution_mode='question';return value};
 const question=await service.execute(cardId,userId,{workspace_mode:'isolated'});await wait(question.id,'waiting_answer');
 const waiting=aiRuns.get(question.id),path=calls.at(-1).path;ask=false;
 await service.execute(cardId,userId,{instruction:'yes'},undefined,{...waiting,output:waiting.output,multiple_agents:true,codex_session_id:'isolated-session'});await wait(question.id,'success');
 assert.equal(calls.at(-1).path,path);assert.equal(calls.at(-1).session,'isolated-session');
 assert.equal(readFileSync(join(workspace,'shared.txt'),'utf8'),'baseline\n');assert.equal(git('status','--porcelain'),'');assert.equal(git('rev-parse','HEAD'),head);
 assert.equal(ledger.size,4);assert.ok([...ledger.values()].every(x=>x.state==='preserved'&&x.evidence.integration==='not_integrated'));
});

