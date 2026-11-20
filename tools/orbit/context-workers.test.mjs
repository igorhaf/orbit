import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,renameSync,unlinkSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../..',import.meta.url));
// The baseline always exercises 04 with compilation off. The separate wrapper
// supplies this test-only selector and a clean host environment for the opt-in run.
const journalEnabled=process.env.ORBIT_DISCOVERY_JOURNAL_TEST_MODE==='1';
const dynamicKnowledge=process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_TEST_MODE==='1';
const knowledgeEnabled=dynamicKnowledge||process.env.ORBIT_KNOWLEDGE_RETRIEVAL_TEST_MODE==='1';
const bridgeEnabled=dynamicKnowledge||process.env.ORBIT_CONTEXT_BRIDGE_TEST_MODE==='1';
const compilerEnabled=knowledgeEnabled||bridgeEnabled||process.env.ORBIT_CONTEXT_COMPILER_TEST_MODE==='1';
const require=createRequire(join(root,'forge/app/package.json'));
process.env.TSX_TSCONFIG_PATH=join(root,'forge/app/apps/api/tsconfig.json');
require('tsx/cjs/api').register();
const api=join(root,'forge/app/apps/api/src');
const {CardExecutionService}=require(join(api,'execution/execution.service.ts'));
const {ProjectRegistry}=require(join(api,'execution/project-registry.ts'));
const {PluginRegistry}=require(join(api,'execution/registries.ts'));
const {emptyConfig}=require(join(api,'execution/types.ts'));
const {createContextManifest,hashContextText,hashContextValue}=require(join(api,'execution/context-manifest.ts'));
// Only the quota import is replaced. No bootstrap, pool constructor, provider or CLI is created.
const source=join(api,'plugins/ai/prompt-sessions.ts'),ts=require('typescript'),module={exports:{}};
const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
const localRequire=createRequire(source);
vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${compiled}\n})`,{filename:source})(id=>id==='../../codex-limits'?{enforceCodexQuota:async()=>{}}:localRequire(id),module,module.exports,source,dirname(source));
const {PromptSessionsService}=module.exports;
const clone=value=>JSON.parse(JSON.stringify(value));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test(`actual context-aware queues preserve manifests, reject drift and keep completed output (${compilerEnabled?'compiler opt-in':'legacy 04'})`, {timeout:120000}, async t=>{
 const directory=mkdtempSync(join(tmpdir(),'orbit-context-workers-')),workspace=join(directory,'project');
 mkdirSync(join(workspace,'.orbit/skills'),{recursive:true,mode:0o700});
 if(knowledgeEnabled)mkdirSync(join(workspace,'.orbit/knowledge'),{recursive:true,mode:0o700});
 writeFileSync(join(workspace,'.orbit/orbit.yaml'),'skills: [selected]\npermissions: [filesystem.read]\nplugins: [filesystem]\n'+(knowledgeEnabled?'knowledge_retrieval:\n  documents: [knowledge/catalog, knowledge/other]\n':''));
 const selected=join(workspace,'.orbit/skills/selected.md');
 const knowledgeFile=join(workspace,'.orbit/knowledge/catalog.md'),otherKnowledge=join(workspace,'.orbit/knowledge/other.md');
 const reset=()=>{writeFileSync(selected,'---\nid: selected\n---\nSelected fixture policy');if(knowledgeEnabled){writeFileSync(knowledgeFile,'---\nid: catalog\n---\nFixture task reference for executing fixture task safely.');writeFileSync(otherKnowledge,'---\nid: other\n---\nAbacaxi oceano.')}};reset();
 const keys=[...new Set(['HOME','CODEX_HOME','CODEX_BIN','ORBIT_ISOLATED_RUNS','ORBIT_WORKTREE_ROOT','ORBIT_CONTEXT_COMPILER_ENABLED','ORBIT_CONTEXT_BRIDGE_ENABLED','ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED',...Object.keys(process.env).filter(key=>(key.startsWith('ORBIT_CONTEXT_COMPILER_')||key.startsWith('ORBIT_CONTEXT_BRIDGE_')||key==='ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED'||key.startsWith('ORBIT_DISCOVERY_JOURNAL_')))])],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 for(const key of keys)if((key.startsWith('ORBIT_CONTEXT_COMPILER_')||key.startsWith('ORBIT_CONTEXT_BRIDGE_')||key==='ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED'||key.startsWith('ORBIT_DISCOVERY_JOURNAL_')))delete process.env[key];
 Object.assign(process.env,{HOME:directory,CODEX_HOME:join(directory,'no-auth'),CODEX_BIN:join(directory,'nonexistent-cli'),ORBIT_ISOLATED_RUNS:'0',ORBIT_CONTEXT_COMPILER_ENABLED:compilerEnabled?'1':'0',ORBIT_CONTEXT_BRIDGE_ENABLED:bridgeEnabled?'1':'0',ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED:knowledgeEnabled?'1':'0',ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED:dynamicKnowledge?'1':'0'});
 const git=(...args)=>execFileSync('/usr/bin/git',['-C',workspace,'-c','core.hooksPath=/dev/null',...args],{env:{PATH:'/usr/bin:/bin',HOME:directory,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'},encoding:'utf8'}).trim();
 git('init','--quiet');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Fixture context');
 const projectId=randomUUID(),workspaceId=randomUUID(),cardId=randomUUID(),userId=randomUUID();
 const bridgeEvents=[],bridgeHandles=[];
 const journalEntries=[],journalCaptures=new Map(),journalReadRoots=[];
 let journalMode='absent',journalStoreFailure=false,journalExternalSymlink=false;
 const externalEvidence=join(directory,'external-fixture-evidence.md');if(journalEnabled)writeFileSync(externalEvidence,'DO-NOT-LEAK-EXTERNAL-FIXTURE-BODY');
 const envelope=()=>({schemaVersion:1,kind:'orbit.discovery.proposals',proposals:[{category:journalMode==='invalid'?'approved':'technical_observation',statement:'A selected fixture contract supplies the execution policy.',evidence:[{kind:'manifest_source',reference:'document:skills/selected'}]}]});
 const setJournalMode=value=>{journalMode=value;process.env.ORBIT_DISCOVERY_JOURNAL_REVIEWED_ENVELOPES=value==='unreviewed'?'':projectId+':'+hashContextValue(envelope());};
 if(journalEnabled)Object.assign(process.env,{ORBIT_DISCOVERY_JOURNAL_ENABLED:'1',ORBIT_DISCOVERY_JOURNAL_TEXT_POLICY:'review_required',ORBIT_DISCOVERY_JOURNAL_PROJECTS:projectId,ORBIT_DISCOVERY_JOURNAL_REVIEWED_ENVELOPES:''});
 const manifests=[],observations=[],genericRuns=new Map(),aiRuns=new Map(),checkoutLedger=new Map(),events=[],calls=[];
 let mode='bypass',question=false,during=false,duringRevision=false,duringUnrelated=false,currentRevision=1,beforePrompt=false,beforePromptAction=null,isolatedPrompt=false,service,configuredModel='fake-model';
 let conversation=[];
 const card=()=>({id:cardId,title:'Fixture task',description:'Execute fixture task',card_revision:currentRevision,board_id:'board',workspace_id:workspaceId,ai_project_id:projectId,ai_model:configuredModel,ai_effort:'high',ai_execution_mode:mode});
 const config={...emptyConfig(),enabled:true,project_id:projectId,executor:'fixture',action:'run',permissions:['filesystem.read'],context:{}};
 const query=async(sql,p=[])=>{
  if(sql.startsWith("SELECT metadata->'discovery_capture' AS discovery_capture")){const run=genericRuns.get(p[0]);return run?.user_id===p[1]?[{discovery_capture:clone(run.metadata?.discovery_capture??null)}]:[];}
  if(sql.startsWith('SELECT discovery_capture FROM card_ai_runs')){const run=aiRuns.get(p[0]);return run?.user_id===p[1]?[{discovery_capture:clone(run.discovery_capture??null)}]:[];}
  if(sql.startsWith('SELECT * FROM orbit_discovery_capture(')){
   if(journalStoreFailure)throw new Error('Synthetic Journal unavailable');
   const binding=JSON.parse(p[0]),submission=JSON.parse(p[1]),run=(binding.queue==='card_runs'?genericRuns:aiRuns).get(binding.runId),manifest=manifests.find(m=>m.id===binding.manifestId);
   assert.equal(run?.status,'running');assert.equal(run.worker_id,binding.workerId);assert.equal(run.card_revision,binding.cardRevision);assert.equal(run.user_id,binding.actorId);assert.equal(binding.runtimeId,manifest.runtime_id);assert.equal(binding.contextFingerprint,manifest.fingerprint);assert.equal(binding.turn,manifest.turn);
   const key=[binding.runtimeId,binding.projectId,binding.actorId,binding.queue,binding.runId,binding.turn,submission.submissionKey].join(':');
   const existing=journalCaptures.get(key);
   if(existing){if(existing.hash!==p[2])throw Object.assign(new Error('conflict'),{code:'23505'});return clone(existing.rows.map(row=>({...row,capture_status:'duplicate'})));}
   const captureId=randomUUID(),{proposals,...header}=submission;
   const records=proposals.map((proposal,position)=>({capture_status:'persisted',id:randomUUID(),capture_id:captureId,position,proposal,recorded_at:new Date().toISOString(),binding,submission:header}));
   journalCaptures.set(key,{hash:p[2],rows:records});journalEntries.push(...records);return clone(records);
  }
  if(sql.startsWith('SELECT e.*,h.binding,h.submission FROM discovery_journal_entries'))return clone(journalEntries.filter(row=>row.binding.runtimeId===p[0]&&row.binding.projectId===p[1]&&row.binding.workspaceId===p[2]&&row.binding.actorId===p[3]&&row.binding.queue===p[4]&&row.binding.runId===p[5]&&(!p[6]||row.proposal.category===p[6])&&row.binding.cardId===p[7]).slice().reverse().slice(p[9],p[9]+p[8]));
  if(sql.startsWith("UPDATE card_runs SET metadata=jsonb_set(metadata,'{discovery_capture}'")){const run=genericRuns.get(p[0]);if(run?.status==='running'&&run.worker_id===p[2])run.metadata={...run.metadata,discovery_capture:JSON.parse(p[1])};return [];}
  if(sql.startsWith('UPDATE card_ai_runs SET discovery_capture=')){const run=aiRuns.get(p[0]);if(run?.status==='running'&&run.worker_id===p[2])run.discovery_capture=JSON.parse(p[1]);return [];}
  if(sql.includes('FROM comments c JOIN users'))return clone(conversation);
  if(sql.startsWith('INSERT INTO comments('))return [{id:randomUUID()}];
  if(sql.startsWith('INSERT INTO context_bridge_events')){const row={id:p[0],event_sequence:String(bridgeEvents.length+1),bridge_id:p[1],manifest_id:p[2],context_fingerprint:p[13],audit:JSON.parse(p[26]),knowledge_metadata:p[28]?JSON.parse(p[28]):null,recorded_at:new Date().toISOString()};bridgeEvents.push(row);return [clone(row)]}
  if(sql.startsWith('SELECT * FROM context_bridge_events'))return clone(bridgeEvents.filter(row=>row.manifest_id===p[0]).reverse().slice(0,p[1]));
  if(sql.startsWith('SELECT user_id,project_id,card_id,status,worker_id,card_revision')){const run=(sql.includes('FROM card_ai_runs')?aiRuns:genericRuns).get(p[0]);return run?[clone(run)]:[]}
  if(sql.startsWith('INSERT INTO context_run_manifests')){
   const [id,queue,run_id,turn,parent_id,card_id,card_revision,project_id,workspace_id,actor_id,runtime_id,fingerprint,integrity_hash,manifest]=p;
   const row={id,queue,run_id,turn,parent_id,card_id,card_revision,project_id,workspace_id,actor_id,runtime_id,fingerprint,integrity_hash,manifest:JSON.parse(manifest),created_at:new Date().toISOString()};manifests.push(row);return [clone(row)];
  }
  if(sql.startsWith('SELECT * FROM context_run_manifests'))return clone(sql.includes('WHERE id=')?manifests.filter(row=>row.id===p[0]):manifests.filter(row=>row.queue===p[0]&&row.run_id===p[1]).sort((a,b)=>b.turn-a.turn).slice(0,1));
  if(sql.startsWith('INSERT INTO context_manifest_verifications')){observations.push({id:p[0],manifest_id:p[1],phase:p[2],status:p[3],observation:JSON.parse(p[4]),observed_at:p[5]});return []}
  if(sql.startsWith('SELECT * FROM context_manifest_verifications'))return clone(observations.filter(row=>row.manifest_id===p[0]));
  if(sql.includes('FROM isolated_run_checkouts'))return checkoutLedger.has(p[1])?[clone(checkoutLedger.get(p[1]))]:[];
  if(sql.startsWith('INSERT INTO isolated_run_checkouts')){if(checkoutLedger.has(p[1]))return [];checkoutLedger.set(p[1],{queue:p[0],run_id:p[1],card_id:p[2],card_revision:p[3],project_id:p[4],workspace_id:p[5],owner_id:p[6],identity:JSON.parse(p[7]),state:'preparing',evidence:{}});return [{run_id:p[1]}]}
  if(sql.startsWith('UPDATE isolated_run_checkouts')){const row=checkoutLedger.get(p[1]);if(!row||row.owner_id!==p[6])return [];Object.assign(row,{state:p[2],identity:JSON.parse(p[3]),evidence:JSON.parse(p[4]),diagnostic:p[5]});return [{run_id:row.run_id}]}
  if(sql.includes('pg_try_advisory_lock'))return [{locked:true}];
  if(sql.includes('SELECT card_revision FROM cards'))return [{card_revision:currentRevision}];
  if(sql.includes('FROM ai_projects'))return p[1]&&p[1]!==userId?[]:[{id:projectId,name:'Fixture',local_path:workspace,is_internal_orbit:false}];
  if(sql.startsWith('SELECT skills,agent FROM card_execution_configs'))return [{skills:clone(config.skills),agent:config.agent}];
  if(sql.startsWith('SELECT context,permissions FROM card_execution_configs'))return [{context:clone(config.context),permissions:clone(config.permissions)}];
  if(sql.includes('FROM card_execution_configs'))return [clone(config)];
  if(sql.includes('WITH RECURSIVE lineage'))return [];
  if(sql.includes('SELECT c.id')||sql.includes('SELECT c.*'))return [card()];
  if(sql.startsWith('INSERT INTO card_runs(')){
   const row={id:randomUUID(),card_id:p[0],project_id:p[1],user_id:p[2],agent:p[3],executor:p[4],action:p[5],input:JSON.parse(p[6]),request_key:p[7],card_revision:p[8],status:'queued',cancel_requested:false};genericRuns.set(row.id,row);return [row];
  }
  if(sql.includes('UPDATE card_runs SET input=input||jsonb_build_object')){genericRuns.get(p[0]).input.context_manifest_id=p[1];return []}
  if(sql.startsWith('SELECT card_id,project_id,user_id')&&sql.includes('FROM card_runs'))return genericRuns.has(p[0])?[genericRuns.get(p[0])]:[];
  if(sql.startsWith('SELECT card_id,project_id,user_id')&&sql.includes('FROM card_ai_runs'))return aiRuns.has(p[0])?[aiRuns.get(p[0])]:[];
  if(sql.includes('FROM card_runs')&&sql.includes('request_key=$2'))return [...genericRuns.values()].filter(row=>row.card_id===p[0]&&row.request_key===p[1]);
  if(sql.startsWith('INSERT INTO card_ai_runs')){
   const row={id:randomUUID(),card_id:p[0],project_id:p[1],user_id:p[2],model:p[3],effort:p[4],prompt:p[5],worker_id:p[7],multiple_agents:p[8],card_revision:p[9],checkout_request:p[10]?JSON.parse(p[10]):null,request_key:p[11],status:'queued'};aiRuns.set(row.id,row);return [{id:row.id}];
  }
  if(sql.includes('FROM card_ai_runs')&&sql.includes('request_key=$2'))return [...aiRuns.values()].filter(row=>row.card_id===p[0]&&row.request_key===p[1]);
  if(sql.includes('SELECT codex_session_id'))return [{codex_session_id:'unverified-legacy-must-not-resume'}];
  if(sql.includes('SELECT id FROM card_ai_runs')&&sql.includes('ORDER BY'))return [...aiRuns.values()].filter(row=>['queued','waiting_answer'].includes(row.status)).map(row=>({id:row.id})).slice(0,1);
  if(sql.includes("SELECT id FROM card_ai_runs")&&sql.includes("status='waiting_answer'"))return [...aiRuns.values()].filter(row=>row.status==='waiting_answer').map(row=>({id:row.id}));
  const ai=aiRuns.get(p[0]);
  if(sql.includes("FROM card_ai_runs WHERE id=$1 AND card_id=$2 AND status='waiting_answer'"))return ai?.status==='waiting_answer'?[ai]:[];
  if(sql.includes('SELECT status,worker_id'))return ai?[{status:ai.status,worker_id:ai.worker_id}]:[];
  if(sql.includes('SELECT status FROM card_ai_runs'))return ai?[{status:ai.status}]:[];
  if(sql.includes('SELECT 1 FROM card_ai_runs'))return ai?[{id:ai.id}]:[];
  if(sql.includes("UPDATE card_ai_runs SET status='queued'")){if(ai?.status!=='waiting_answer')return [];Object.assign(ai,{status:'queued',prompt:p[3],output:null});return [{id:ai.id}]}
  if(sql.includes("UPDATE card_ai_runs SET status='running'")){if(ai?.status!=='queued')return [];Object.assign(ai,{status:'running',prompt:p[1]});return [{id:ai.id}]}
  if(sql.includes("UPDATE card_ai_runs SET status='waiting_answer'")){Object.assign(ai,{status:'waiting_answer',output:p[1],codex_session_id:p[2]});return [{id:ai.id}]}
  if(sql.includes('UPDATE card_ai_runs SET status=$2')){Object.assign(ai,{status:p[1],output:p[2],summary:p[3],codex_session_id:p[7]});return [{id:ai.id}]}
  if(sql.includes("UPDATE card_ai_runs SET status='error'")){if(ai)Object.assign(ai,{status:'error',error:p[1]});return ai?[{id:ai.id}]:[]}
  if(sql.includes('RETURNING cancel_requested'))return [{cancel_requested:false}];
  if(sql.includes('SELECT board_id FROM lists'))return [{board_id:'board'}];
  return [];
 };
 const db={query,one:async(sql,p)=>clone((await query(sql,p))[0]??null),pool:{connect:async()=>Object.assign(new EventEmitter(),{query:async(sql,p)=>{const rows=await query(sql,p);return {rows,rowCount:rows.length}},release(){}})}};
 const features={cardBoard:async(_id,user)=>{if(user!==userId)throw new Error('Membership denied');return 'board'},notify:async()=>{},record:async()=>{}};
 const bus={boardChanged(){},commentChanged(){},promptProgress(_b,_c,event){events.push(event)}};
 const projects=new ProjectRegistry(db),knowledgeReadRoots=[],documentRead=projects.document.bind(projects);projects.document=async(project,...args)=>{if(dynamicKnowledge&&args[0]==='knowledge')knowledgeReadRoots.push(project.root);return documentRead(project,...args)};const plugins=new PluginRegistry();plugins.register({id:'ai',name:'Fixture AI contract',version:'1.0.0',actions:[],capabilities:[]});
 const selectionRead=projects.revalidateSelection.bind(projects);projects.revalidateSelection=async(project,user,sources,...args)=>{if(journalEnabled&&sources.some(source=>source.id==='document:skills/selected'))journalReadRoots.push(project.root);return selectionRead(project,user,sources,...args)};
 const generic=new CardExecutionService(db,features,projects,bus,plugins,{});
 const assertCompiled=(queue,id,prompt)=>{
  const record=manifests.filter(row=>row.queue===queue&&row.run_id===id).sort((a,b)=>b.turn-a.turn)[0];assert.ok(record,'executor must have an immutable manifest');
  const metadata=record.manifest.configuration.contextCompilation;
  if(!metadata){assert.notEqual(record.manifest.assemblyPolicy,'orbit-context-compiler/1');return null;}
  assert.equal(metadata.schemaVersion,1);assert.equal(metadata.policy.id,'orbit-context-compiler/1');
  assert.equal(metadata.compiledHash,hashContextText(prompt));assert.equal(record.manifest.material.promptHash,hashContextText(prompt));
  assert.equal(metadata.metrics.estimated,true);assert.equal(metadata.metrics.billableTokensKnown,false);
  assert.ok(metadata.metrics.compiledEstimatedTokens<=metadata.metrics.availableEstimatedTokens);
  assert.ok(Array.isArray(metadata.decisions));assert.ok(Array.isArray(metadata.sourceUsage));
  assert.equal(metadata.text,undefined,'metadata must not persist another prompt body');return metadata;
 };
 const useBridge=async handle=>{
  bridgeHandles.push(handle);assert.equal(handle.descriptor.protocol,'orbit-context-bridge/1');assert.equal(handle.descriptor.readOnly,true);
  assert.ok(!JSON.stringify(handle.descriptor).includes(workspace));
  const initialized=await handle.exchange({jsonrpc:'2.0',id:'init',method:'initialize',params:{protocolVersion:'orbit-context-bridge/1'}});assert.ok(initialized.result,JSON.stringify(initialized));
  if(dynamicKnowledge&&handle.descriptor.capabilities.includes('knowledge.search')){
    assert.ok(initialized.result.capabilities.includes('knowledge.search'));assert.equal(initialized.result.knowledge.maxResults,3);
    const record=manifests.find(m=>m.run_id===handle.descriptor.runId&&m.turn===handle.descriptor.turn),before=clone(record);
    assert.equal(record.manifest.sources.some(s=>s.id==='document:knowledge/other'),false);
    const readStart=knowledgeReadRoots.length;
    const searched=await handle.exchange({jsonrpc:'2.0',id:'search',method:'capabilities/call',params:{request:{schemaVersion:1,id:'knowledge-search',capability:'knowledge.search',parameters:{query:'abacaxi',limit:1}}}});
    assert.equal(searched.result?.status,'ok',JSON.stringify(searched));const result=searched.result.data.results[0];assert.ok(result.text.includes('Abacaxi'));assert.match(result.sourceId,/^src_[a-f0-9]{64}$/);assert.equal(result.selectedInitially,false);assert.equal(result.initialCompilation,'not_selected');const expectedRoot=checkoutLedger.get(handle.descriptor.runId)?.identity.root??workspace;assert.ok(knowledgeReadRoots.slice(readStart).length>0);assert.ok(knowledgeReadRoots.slice(readStart).every(root=>root===expectedRoot));assert.deepEqual(record,before);assert.ok(!JSON.stringify(searched).includes('document:knowledge/other'));
    const checkout=checkoutLedger.get(handle.descriptor.runId);
    if(checkout){
      const isGeneric=genericRuns.has(handle.descriptor.runId),owner=checkout.owner_id,head=join(checkout.identity.gitDirectory,'HEAD'),backup=head+'.fixture-original';
      try{
        if(isGeneric){const content=readFileSync(head);renameSync(head,backup);writeFileSync(head,content);}else checkout.owner_id=randomUUID();
        const denied=await handle.exchange({jsonrpc:'2.0',id:'invalid-checkout',method:'capabilities/call',params:{request:{schemaVersion:1,id:'invalid-checkout',capability:'knowledge.search',parameters:{query:'abacaxi'}}}});
        assert.ok(denied.error);assert.equal(handle.signal.aborted,true);
      }finally{if(isGeneric){unlinkSync(head);renameSync(backup,head);}else checkout.owner_id=owner;}
    }
    return;
  }
  const listed=await handle.exchange({jsonrpc:'2.0',id:'list',method:'capabilities/call',params:{request:{schemaVersion:1,id:'selected',capability:'sources.list',parameters:{offset:0,limit:16}}}});
  assert.equal(listed.result?.status,'ok',JSON.stringify(listed));
  const selectedSource=listed.result.data.sources.find(source=>source.type==='skills');assert.ok(selectedSource,JSON.stringify(listed.result.data));assert.match(selectedSource.id,/^src_[a-f0-9]{64}$/);
  const read=await handle.exchange({jsonrpc:'2.0',id:'read',method:'capabilities/call',params:{request:{schemaVersion:1,id:'selected-read',capability:'sources.read',parameters:{sourceId:selectedSource.id,maxBytes:1024}}}});
  assert.equal(read.result?.status,'ok',JSON.stringify(read));assert.equal(read.result.data.text,'Selected fixture policy');assert.equal(read.result.data.representation,'data');assert.equal(read.result.data.bodyHash,hashContextText(read.result.data.text));
 };
 generic.executors.register({id:'fixture',name:'Fixture',actions:[{id:'run',name:'Run',permissions:[]}],execute:async input=>{if(input.contextBridge)await useBridge(input.contextBridge);assertCompiled('card_runs',input.runId,input.prompt);calls.push({queue:'card_runs',runId:input.runId,prompt:input.prompt});if(during)writeFileSync(selected,'Changed during generic execution');if(journalExternalSymlink){renameSync(selected,selected+'.fixture-backup');symlinkSync(externalEvidence,selected);}if(duringRevision)currentRevision++;if(duringUnrelated)writeFileSync(join(workspace,'unrelated.txt'),'Unselected file changed');return {summary:'Generic output preserved',outputs:journalEnabled&&journalMode!=='absent'?[{type:'orbit.discovery.proposals',value:envelope()}]:[{type:'text',value:'artifact'}]}}});
 Object.assign(generic.runs,{stage:async()=>{},finish:async(run,status,result,error)=>Object.assign(genericRuns.get(run.id),{status,result,error}),claim:async()=>{throw new Error('Quota-bearing claim is forbidden in this fixture')}});
 service=new PromptSessionsService(db,features,{isAvailable:()=>true,execute:async(prompt,path,_model,_effort,_progress,session,...rest)=>{if(isolatedPrompt){assert.notEqual(path,workspace);assert.match(prompt,/Selected fixture policy/);assert.match(readFileSync(join(path,'.orbit/skills/selected.md'),'utf8'),/Selected fixture policy/);writeFileSync(join(path,'isolated-result.txt'),'Provider artifact inside approved checkout');}else assert.equal(path,workspace);if(rest[9])await useBridge(rest[9]);const active=[...aiRuns.values()].find(row=>row.status==='running');assert.ok(active);const metadata=assertCompiled('card_ai_runs',active.id,prompt),delivery=rest[8];if(metadata){assert.equal(delivery?.compiledHash,metadata.compiledHash);assert.deepEqual(delivery.policy,metadata.policy);const {prepareContextDelivery}=require(join(api,'execution/context-delivery.ts'));await delivery.onDelivery?.(prepareContextDelivery(prompt,prompt,delivery));}else assert.equal(delivery,undefined);calls.push({queue:'card_ai_runs',runId:active.id,prompt,session,path});if(during)writeFileSync(selected,'Changed during prompt execution');return {output:question?'[[ORBIT_QUESTION]]\nProceed?\n[[/ORBIT_QUESTION]]':(journalEnabled&&journalMode!=='absent'?JSON.stringify(envelope()):'Prompt output preserved'),sessionId:'fixture-session',fileChanges:[],activities:[]}}},bus,projects,undefined,plugins);
 Object.assign(service,{localPath:async()=>workspace,queuePaused:async()=>{if(beforePromptAction){const action=beforePromptAction;beforePromptAction=null;action();}if(beforePrompt){beforePrompt=false;writeFileSync(selected,'Changed while queued')}return false},descriptionImages:async()=>[],quota:async()=>{}});
 const wait=async(id,status)=>{for(let n=0;n<4000;n++){const row=aiRuns.get(id);if(row?.status===status)return row;if(row?.status==='error'&&status!=='error')assert.fail(row.error+' '+JSON.stringify(observations.filter(check=>manifests.some(manifest=>manifest.id===check.manifest_id&&manifest.run_id===id)).map(check=>({phase:check.phase,status:check.status,changes:check.observation.compatibility.changes}))));await pause(10)}assert.fail(`Expected ${status}; actual status: ${aiRuns.get(id)?.status}; error: ${aiRuns.get(id)?.error??'none'}`)};
 const runGeneric=async id=>{const run=genericRuns.get(id);run.status='running';run.worker_id=generic.runs.workerId;await generic.processRun(run);return run};
 const checks=id=>observations.filter(row=>row.manifest_id===id);
 if(bridgeEnabled)t.diagnostic(JSON.stringify({fixtureRoot:directory,fixturePid:process.pid}));
 t.after(async()=>{for(let n=0;n<200&&[...aiRuns.values()].some(row=>['queued','running'].includes(row.status));n++)await pause(10);assert.ok(![...aiRuns.values()].some(row=>['queued','running'].includes(row.status)));assert.equal(existsSync(join(directory,'no-auth')),false);for(const key of Object.keys(process.env))if((key.startsWith('ORBIT_CONTEXT_COMPILER_')||key.startsWith('ORBIT_CONTEXT_BRIDGE_')||key==='ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED'||key.startsWith('ORBIT_DISCOVERY_JOURNAL_')))delete process.env[key];for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]}rmSync(directory,{recursive:true,force:true});});

 await t.test('T7/T8 generic enqueue keeps original context on retry and rejects pre-execution drift',async()=>{
  reset();const queued=await generic.enqueue(cardId,userId,{request_key:'generic-before'}),run=genericRuns.get(queued.id),manifest=manifests.find(row=>row.id===run.input.context_manifest_id),count=manifests.length;
  writeFileSync(selected,'Changed before executor');
  config.enabled=false;try{assert.equal((await generic.enqueue(cardId,userId,{request_key:'generic-before'})).id,queued.id);assert.equal(manifests.length,count);}finally{config.enabled=true;}
  const before=calls.length;await runGeneric(queued.id);assert.equal(run.status,'failed');assert.match(run.error,/incompatível|reconciliação/);assert.equal(calls.length,before);assert.equal(checks(manifest.id).at(-1).status,'changed');
 });
 await t.test('T9 generic preserves output and records changed context independently',async()=>{
  reset();const queued=await generic.enqueue(cardId,userId,{request_key:'generic-during'});during=true;const run=await runGeneric(queued.id);during=false;
  assert.equal(run.status,'success',run.error);assert.equal(run.result.summary,'Generic output preserved');assert.equal(checks(run.input.context_manifest_id).at(-1).status,'changed');
 });
 await t.test('T7/T8 prompt retry retains initial manifest and worker blocks drift without provider call',async()=>{
  reset();beforePrompt=true;const before=calls.length,queued=await service.execute(cardId,userId,{request_key:'prompt-before'});const failed=await wait(queued.id,'error');assert.match(failed.error,/contexto capturado mudou/);
  const record=manifests.find(row=>row.run_id===queued.id),count=manifests.length;
  configuredModel=null;try{assert.equal((await service.execute(cardId,userId,{request_key:'prompt-before'})).id,queued.id);assert.equal(manifests.length,count);assert.equal(calls.length,before);}finally{configuredModel='fake-model';}assert.ok(checks(record.id).some(row=>row.status==='changed'));
 });
 await t.test('T9/T15 prompt preserves completed output while final selected sources changed',async()=>{
  reset();during=true;const queued=await service.execute(cardId,userId,{request_key:'prompt-during'});const run=await wait(queued.id,'success');during=false;
  const record=manifests.find(row=>row.run_id===queued.id);assert.equal(run.output,'Prompt output preserved');assert.equal(checks(record.id).at(-1).status,'changed');assert.equal(calls.at(-1).session,null);
  assert.ok(manifests.some(row=>row.queue==='card_runs'));assert.ok(manifests.some(row=>row.queue==='card_ai_runs'));
 });
 await t.test('T11 both manifest-aware pipelines use the actual approved isolated checkout',async()=>{
  reset();if(bridgeEnabled&&!dynamicKnowledge)process.env.ORBIT_CONTEXT_BRIDGE_ENABLED='0';assert.equal(git('status','--porcelain'),'');
  const storage=join(directory,'isolated-runs');mkdirSync(storage,{mode:0o700});
  const originalConfig=clone(config),originalIsolation=process.env.ORBIT_ISOLATED_RUNS,originalStorage=process.env.ORBIT_WORKTREE_ROOT,base=git('rev-parse','HEAD'),originalSource=readFileSync(selected,'utf8');
  process.env.ORBIT_ISOLATED_RUNS='1';process.env.ORBIT_WORKTREE_ROOT=storage;
  const assertBinding=(queue,id)=>{
   const ledger=checkoutLedger.get(id),record=manifests.find(row=>row.queue===queue&&row.run_id===id);
   assert.ok(ledger,`Missing checkout ledger for ${queue}`);assert.equal(ledger.state,'preserved');assert.notEqual(ledger.identity.root,workspace);assert.ok(ledger.identity.root.startsWith(storage+'/'));
   assert.equal(record.manifest.git.baseCommit,base);assert.equal(record.manifest.checkout.mode,'isolated');assert.equal(ledger.identity.request.baseCommit,base);assert.equal(ledger.evidence.integration,'not_integrated');
   const source=record.manifest.sources.find(item=>item.id==='document:skills/selected');
   if(knowledgeEnabled){const recovered=record.manifest.sources.find(s=>s.id==='document:knowledge/catalog');assert.ok(recovered);assert.equal(recovered.provenance.rawHash,hashContextText(readFileSync(join(ledger.identity.root,recovered.logicalPath),'utf8')));assert.ok(record.manifest.configuration.knowledgeRetrieval);}
   const actual=readFileSync(join(ledger.identity.root,source.logicalPath),'utf8');assert.equal(source.provenance.rawHash,hashContextText(actual));assert.equal(source.contentHash,hashContextText('Selected fixture policy'));
   assert.ok(checks(record.id).some(row=>row.phase==='started'&&row.status==='compatible'));assert.equal(checks(record.id).at(-1).status,'compatible');
   return ledger;
  };
  try{
   Object.assign(config,{executor:'plugin',action:'execute',integrations:[{plugin:'filesystem',action:'read',config:{path:'.orbit/skills/selected.md'}}]});
   const queued=await generic.enqueue(cardId,userId,{request_key:'generic-isolated',workspace_mode:'isolated'}),run=await runGeneric(queued.id);
   assert.equal(run.status,'success',run.error+' '+JSON.stringify(checks(run.input.context_manifest_id).map(row=>row.observation.compatibility)));assert.equal(run.result.outputs[0].value,originalSource);assertBinding('card_runs',queued.id);
   Object.assign(config,originalConfig);isolatedPrompt=true;
   const prompt=await service.execute(cardId,userId,{request_key:'prompt-isolated',workspace_mode:'isolated'}),completed=await wait(prompt.id,'success');
   assert.equal(completed.output,'Prompt output preserved');const ledger=assertBinding('card_ai_runs',prompt.id);
   assert.equal(calls.at(-1).path,ledger.identity.root);assert.equal(calls.at(-1).session,null);assert.equal(readFileSync(join(ledger.identity.root,'isolated-result.txt'),'utf8'),'Provider artifact inside approved checkout');
   assert.equal(readFileSync(selected,'utf8'),originalSource);assert.equal(existsSync(join(workspace,'isolated-result.txt')),false);assert.equal(git('status','--porcelain'),'');assert.equal(git('rev-parse','HEAD'),base);
  }finally{if(bridgeEnabled)process.env.ORBIT_CONTEXT_BRIDGE_ENABLED='1';isolatedPrompt=false;Object.assign(config,originalConfig);process.env.ORBIT_ISOLATED_RUNS=originalIsolation;if(originalStorage===undefined)delete process.env.ORBIT_WORKTREE_ROOT;else process.env.ORBIT_WORKTREE_ROOT=originalStorage;}
 });
 await t.test('T10 compatible answer preserves session and adds immutable manifest turn',async()=>{
  reset();mode='question';question=true;const queued=await service.execute(cardId,userId,{request_key:'question-compatible'});await wait(queued.id,'waiting_answer');
  const initial=clone(manifests.find(row=>row.run_id===queued.id));question=false;
  await service.answerRun(cardId,queued.id,userId,{answer:'Proceed'});await wait(queued.id,'success');
  const turns=manifests.filter(row=>row.run_id===queued.id);assert.equal(turns.length,2);assert.equal(turns[1].parent_id,turns[0].id);assert.equal(turns[1].turn,1);assert.deepEqual(turns[0],initial);assert.equal(calls.at(-1).session,'fixture-session');
 });
 if(bridgeEnabled)await t.test('B18 a waiting question refuses changed Bridge policy without consuming the old turn',async()=>{
  reset();mode='question';question=true;const queued=await service.execute(cardId,userId,{request_key:'bridge-policy-answer'});await wait(queued.id,'waiting_answer');question=false;
  const count=manifests.length,before=calls.length;process.env.ORBIT_CONTEXT_BRIDGE_ENABLED='0';
  try{await assert.rejects(()=>service.answerRun(cardId,queued.id,userId,{answer:'Proceed'}),dynamicKnowledge?/Bridge|dinâmica/:/Bridge mudou/);assert.equal(manifests.length,count);assert.equal(calls.length,before);assert.equal(aiRuns.get(queued.id).status,'waiting_answer');assert.equal(bridgeHandles.at(-1).signal.aborted,true);}finally{process.env.ORBIT_CONTEXT_BRIDGE_ENABLED='1';aiRuns.get(queued.id).status='cancelled';}
 });
 if(compilerEnabled&&!bridgeEnabled&&!knowledgeEnabled){
  await t.test('C12 C15: card edits retain captured compilation and unrelated files keep selected context compatible',async()=>{
   reset();mode='bypass';
   const first=await generic.enqueue(cardId,userId,{request_key:'compiler-revision-during'}),record=manifests.find(row=>row.run_id===first.id),snapshot=clone(record);
   try{duringRevision=true;const run=await runGeneric(first.id);assert.equal(run.status,'success',run.error);assert.equal(currentRevision,2);assert.equal(record.manifest.identity.cardRevision,1);assert.deepEqual(record,snapshot);assert.equal(checks(record.id).at(-1).status,'changed');}finally{duringRevision=false;currentRevision=1;}
   const second=await generic.enqueue(cardId,userId,{request_key:'compiler-unrelated'});
   try{duringUnrelated=true;const run=await runGeneric(second.id);assert.equal(run.status,'success',run.error);assert.equal(checks(run.input.context_manifest_id).at(-1).status,'compatible');}finally{duringUnrelated=false;}
  });
  await t.test('C5 C19: optional duplicate comment history records savings with both queues compiled',async()=>{
   reset();mode='bypass';
   conversation=[{author_name:'Fixture author',body:'Identical authorized historical fixture.'},{author_name:'Fixture author',body:'Identical authorized historical fixture.'}];
   try{
    const queued=await service.execute(cardId,userId,{instruction:'Process the current comment',request_key:'compiler-dedup'}, {comment_id:randomUUID(),card_id:cardId,user_id:userId,project_id:projectId,model:'fake-model',effort:'high',authorLabel:'Fixture assistant'});
    const run=await wait(queued.id,'success'),record=manifests.find(row=>row.run_id===queued.id),metadata=record.manifest.configuration.contextCompilation;
    assert.ok(metadata.decisions.some(decision=>decision.state==='deduplicated'));
    assert.ok(metadata.metrics.deduplicatedEstimatedTokens>0);assert.ok(!run.prompt.includes('CONVERSA COMPLETA'));
    assert.equal(hashContextText(calls.at(-1).prompt),metadata.compiledHash);
    assert.ok(manifests.some(row=>row.queue==='card_runs'&&row.manifest.configuration.contextCompilation));
    assert.ok(manifests.some(row=>row.queue==='card_ai_runs'&&row.manifest.configuration.contextCompilation));
   }finally{conversation=[];}
  });
  await t.test('C4: bounded optional history is omitted with its original source and an explicit decision',async()=>{
   reset();mode='bypass';conversation=[{author_name:'Fixture author',body:'Optional historical evidence. '.repeat(100)}];
   process.env.ORBIT_CONTEXT_COMPILER_HISTORY_MAX_ESTIMATED_TOKENS='64';
   try{
    const queued=await service.execute(cardId,userId,{instruction:'Process this current comment',request_key:'compiler-history-limit'}, {comment_id:randomUUID(),card_id:cardId,user_id:userId,project_id:projectId,model:'fake-model',effort:'high',authorLabel:'Fixture assistant'});
    await wait(queued.id,'success');const record=manifests.find(row=>row.run_id===queued.id),metadata=record.manifest.configuration.contextCompilation;
    assert.ok(metadata.decisions.some(decision=>decision.blockId==='history-0'&&decision.state==='omitted'&&decision.reason));
    assert.ok(metadata.metrics.omittedEstimatedTokens>0);assert.ok(record.manifest.sources.some(source=>source.id==='prompt:conversation'));
    assert.ok(!calls.at(-1).prompt.includes(conversation[0].body));
   }finally{conversation=[];delete process.env.ORBIT_CONTEXT_COMPILER_HISTORY_MAX_ESTIMATED_TOKENS;}
  });
  await t.test('C3: mandatory context over the host budget blocks both enqueues before executor or manifest persistence',async()=>{
   reset();mode='bypass';const count=manifests.length,before=calls.length,genericCount=genericRuns.size,aiCount=aiRuns.size;
   const budget={ORBIT_CONTEXT_COMPILER_MAX_ESTIMATED_TOKENS:'1024',ORBIT_CONTEXT_COMPILER_RESERVED_RESPONSE_TOKENS:'0',ORBIT_CONTEXT_COMPILER_RESERVED_OPERATION_TOKENS:'0',ORBIT_CONTEXT_COMPILER_RESERVED_EXTERNAL_TOKENS:'0',ORBIT_CONTEXT_COMPILER_SAFETY_MARGIN_RATIO:'0'};
   const previous=Object.fromEntries(Object.keys(budget).map(key=>[key,process.env[key]]));Object.assign(process.env,budget);
   try{
    await assert.rejects(()=>generic.enqueue(cardId,userId,{request_key:'compiler-budget-generic'}),/orçamento|compila|budget|obrigatório/i);
    await assert.rejects(()=>service.execute(cardId,userId,{request_key:'compiler-budget-prompt'}),/orçamento|compila|budget|obrigatório/i);
    assert.equal(manifests.length,count);assert.equal(calls.length,before);assert.equal(genericRuns.size,genericCount);assert.equal(aiRuns.size,aiCount);
   }finally{for(const key of Object.keys(budget))if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  });
  await t.test('C9 C11: queued compiled generic run retains idempotent original and rejects a changed host policy',async()=>{
   reset();const queued=await generic.enqueue(cardId,userId,{request_key:'compiler-policy-before'}),run=genericRuns.get(queued.id),record=manifests.find(row=>row.id===run.input.context_manifest_id),snapshot=clone(record),count=manifests.length,before=calls.length;
   process.env.ORBIT_CONTEXT_COMPILER_MAX_ESTIMATED_TOKENS=String(record.manifest.configuration.contextCompilation.policy.budget.maxEstimatedTokens+1);
   try{
    assert.equal((await generic.enqueue(cardId,userId,{request_key:'compiler-policy-before'})).id,queued.id);
    assert.equal(manifests.length,count);await runGeneric(queued.id);assert.equal(run.status,'failed');assert.match(run.error,/política|compila|reconciliação/i);assert.equal(calls.length,before);assert.deepEqual(record,snapshot);
   }finally{delete process.env.ORBIT_CONTEXT_COMPILER_MAX_ESTIMATED_TOKENS;}
  });
  await t.test('C16: a waiting compiled question cannot resume after policy changes and keeps its original turn',async()=>{
   reset();mode='question';question=true;const queued=await service.execute(cardId,userId,{request_key:'compiler-policy-answer'});await wait(queued.id,'waiting_answer');question=false;
   const record=manifests.find(row=>row.run_id===queued.id),snapshot=clone(record),before=calls.length,count=manifests.length;
   process.env.ORBIT_CONTEXT_COMPILER_MAX_ESTIMATED_TOKENS=String(record.manifest.configuration.contextCompilation.policy.budget.maxEstimatedTokens+1);
   try{
    await assert.rejects(()=>service.answerRun(cardId,queued.id,userId,{answer:'Proceed'}),/política|compila|reconciliação/i);
    assert.equal(calls.length,before);assert.equal(manifests.length,count);assert.deepEqual(record,snapshot);assert.equal(aiRuns.get(queued.id).status,'waiting_answer');
   }finally{delete process.env.ORBIT_CONTEXT_COMPILER_MAX_ESTIMATED_TOKENS;aiRuns.get(queued.id).status='cancelled';}
  });
  await t.test('C19: enabling the host after preparation preserves legacy material in both queued pipelines',async()=>{
   reset();mode='bypass';process.env.ORBIT_CONTEXT_COMPILER_ENABLED='0';
   try{
    const queued=await generic.enqueue(cardId,userId,{request_key:'compiler-existing-legacy-generic'}),record=manifests.find(row=>row.run_id===queued.id),snapshot=clone(record);
    assert.equal(record.manifest.configuration.contextCompilation,undefined);process.env.ORBIT_CONTEXT_COMPILER_ENABLED='1';
    const completedGeneric=await runGeneric(queued.id);assert.equal(completedGeneric.status,'success',completedGeneric.error);assert.deepEqual(record,snapshot);assert.equal(record.manifest.material.promptHash,hashContextText(calls.at(-1).prompt));
    process.env.ORBIT_CONTEXT_COMPILER_ENABLED='0';beforePromptAction=()=>{process.env.ORBIT_CONTEXT_COMPILER_ENABLED='1'};
    const prompt=await service.execute(cardId,userId,{request_key:'compiler-existing-legacy-prompt'}),completed=await wait(prompt.id,'success');
    const promptRecord=manifests.find(row=>row.run_id===prompt.id);assert.equal(completed.output,'Prompt output preserved');assert.equal(promptRecord.manifest.configuration.contextCompilation,undefined);assert.equal(promptRecord.manifest.assemblyPolicy,'orbit-prompt-sessions/1');
    assert.equal(promptRecord.manifest.material.promptHash,hashContextText(calls.at(-1).prompt));
   }finally{beforePromptAction=null;process.env.ORBIT_CONTEXT_COMPILER_ENABLED='1';}
  });
 }
 await t.test('T10 incompatible answer does not consume provider or replace question history',async()=>{
  reset();mode='question';question=true;const queued=await service.execute(cardId,userId,{request_key:'question-incompatible'});await wait(queued.id,'waiting_answer');question=false;
  const before=calls.length,count=manifests.length;writeFileSync(selected,'Changed after question');
  await assert.rejects(()=>service.answerRun(cardId,queued.id,userId,{answer:'Proceed'}),compilerEnabled?/compilação da pergunta mudou/:/contexto da pergunta mudou/);
  assert.equal(calls.length,before);assert.equal(manifests.length,count);assert.equal(aiRuns.get(queued.id).status,'waiting_answer');if(knowledgeEnabled||journalEnabled)aiRuns.get(queued.id).status='cancelled';
 });
 await t.test('non-Git and unborn repositories do not poison workspace supervision',async()=>{
  reset();mode='bypass';
  const metadata=join(directory,'saved-fixture-git');renameSync(join(workspace,'.git'),metadata);
  try{
   for(const state of ['not_applicable','unborn']){
    if(state==='unborn')git('init','--quiet');
    const queued=await generic.enqueue(cardId,userId,{request_key:'technical-'+state}),run=await runGeneric(queued.id);
    assert.equal(run.status,'success',run.error);
    const manifest=manifests.find(row=>row.id===run.input.context_manifest_id);assert.equal(manifest.manifest.git.status,state);assert.equal(checks(manifest.id).at(-1).status,'compatible');
   }
  }finally{rmSync(join(workspace,'.git'),{recursive:true,force:true});renameSync(metadata,join(workspace,'.git'));}
 });
 if(bridgeEnabled)await t.test('B17/B18: both queues capture the Bridge, audit bounded reads and revoke old turn handles',async()=>{
  assert.ok(bridgeHandles.length>=4);
  const captured=manifests.filter(row=>row.manifest.configuration.contextBridge);assert.ok(captured.some(row=>row.queue==='card_runs'));assert.ok(captured.some(row=>row.queue==='card_ai_runs'));
  assert.ok(bridgeEvents.some(row=>row.audit.event.phase==='response_prepared'));assert.ok(bridgeEvents.some(row=>row.audit.event.phase==='response_emitted'));assert.ok(bridgeEvents.some(row=>row.audit.event.phase==='closed'));
  assert.ok(!JSON.stringify(bridgeEvents).includes('Selected fixture policy'));assert.ok(!JSON.stringify(bridgeEvents).includes(workspace));if(dynamicKnowledge){assert.ok(bridgeEvents.some(row=>row.knowledge_metadata?.returned>0));assert.ok(!JSON.stringify(bridgeEvents).includes('Abacaxi'));assert.ok(!JSON.stringify(bridgeEvents).includes('document:knowledge/other'));}
  assert.equal(new Set(bridgeHandles.map(handle=>handle.descriptor.bridgeId)).size,bridgeHandles.length);
  for(const handle of bridgeHandles){assert.equal(handle.signal.aborted,true);const response=await handle.exchange({jsonrpc:'2.0',id:'old',method:'ping'});assert.ok(response.error);}
 });

 if(knowledgeEnabled){
  await t.test('R17/R18 both queues record selected optional knowledge and actual compilation decisions',async()=>{
   reset();mode='bypass';question=false;const q=await generic.enqueue(cardId,userId,{request_key:'knowledge-generic'});await runGeneric(q.id);assert.equal(genericRuns.get(q.id).status,'success',genericRuns.get(q.id).error);
   const p=await service.execute(cardId,userId,{request_key:'knowledge-prompt'});await wait(p.id,'success');
   for(const id of [q.id,p.id]){const record=manifests.find(m=>m.run_id===id);const k=record.manifest.configuration.knowledgeRetrieval;assert.equal(k.schemaVersion,1);assert.equal(k.candidateCount,2);assert.ok(k.selected.length);assert.ok(k.compilationDecisions.some(d=>d.state==='included'));assert.ok(record.manifest.sources.find(s=>s.id==='document:knowledge/catalog'));assert.equal(record.manifest.sources.some(s=>s.id==='document:knowledge/other'),false);assert.ok(calls.find(c=>c.runId===id).prompt.includes('Fixture task reference'));assert.equal(JSON.stringify(k).includes('reference for executing'),false);}
  });
  await t.test('R19/R21 changed unselected corpus blocks both workers and retries keep original selection',async()=>{
   reset();const q=await generic.enqueue(cardId,userId,{request_key:'knowledge-drift-generic'}),record=clone(manifests.find(m=>m.run_id===q.id)),count=manifests.length,before=calls.length;writeFileSync(otherKnowledge,'Changed unrelated corpus');assert.equal((await generic.enqueue(cardId,userId,{request_key:'knowledge-drift-generic'})).id,q.id);assert.equal(manifests.length,count);await runGeneric(q.id);assert.equal(genericRuns.get(q.id).status,'failed');assert.equal(calls.length,before);assert.deepEqual(manifests.find(m=>m.id===record.id),record);
   reset();beforePromptAction=()=>writeFileSync(otherKnowledge,'Changed prompt corpus before worker');const p=await service.execute(cardId,userId,{request_key:'knowledge-drift-prompt'});await wait(p.id,'error');assert.equal(calls.length,before);
  });
  await t.test('R23 resumed question refuses changed corpus without consuming history',async()=>{
   reset();mode='question';question=true;const q=await service.execute(cardId,userId,{request_key:'knowledge-question'});await wait(q.id,'waiting_answer');question=false;const count=manifests.length,before=calls.length;writeFileSync(otherKnowledge,'Changed corpus during answer');await assert.rejects(()=>service.answerRun(cardId,q.id,userId,{answer:'Proceed'}));assert.equal(manifests.length,count);assert.equal(calls.length,before);assert.equal(aiRuns.get(q.id).status,'waiting_answer');aiRuns.get(q.id).status='cancelled';mode='bypass';
  });
  await t.test('R23 captured knowledge policy rejects resume with409 and preserves old turn',async()=>{
   reset();mode='question';question=true;const q=await service.execute(cardId,userId,{request_key:'knowledge-policy-answer'});await wait(q.id,'waiting_answer');question=false;const count=manifests.length,before=calls.length;process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED='0';try{await assert.rejects(()=>service.answerRun(cardId,q.id,userId,{answer:'Proceed'}),e=>e.status===409);assert.equal(manifests.length,count);assert.equal(calls.length,before);assert.ok(observations.some(o=>o.phase==='resume_rejected'&&o.observation.compatibility.changes.includes('knowledge:policy')));}finally{process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED='1';aiRuns.get(q.id).status='cancelled';mode='bypass';}
  });
  if(dynamicKnowledge)await t.test('D2 prompt five-capability capture is not upgraded when the dynamic host flag later enables',async()=>{
   reset();mode='bypass';question=false;process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED='0';beforePromptAction=()=>{process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED='1'};
   try{const p=await service.execute(cardId,userId,{request_key:'dynamic-legacy-prompt'});await wait(p.id,'success');const record=manifests.find(m=>m.run_id===p.id);assert.equal(record.manifest.configuration.contextBridge.knowledge,undefined);assert.equal(bridgeHandles.at(-1).descriptor.capabilities.includes('knowledge.search'),false);}finally{beforePromptAction=null;process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED='1';}
  });
  await t.test('R21 captured disabled recovery stays disabled when host enables later',async()=>{
   reset();process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED='0';if(dynamicKnowledge)process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED='0';const q=await generic.enqueue(cardId,userId,{request_key:'knowledge-legacy'});process.env.ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED='1';if(dynamicKnowledge)process.env.ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED='1';await runGeneric(q.id);assert.equal(genericRuns.get(q.id).status,'success',genericRuns.get(q.id).error);assert.equal(manifests.find(m=>m.run_id===q.id).manifest.configuration.knowledgeRetrieval,undefined);
  });
 }
 if(journalEnabled){
  await t.test('J22/J23 both real queue services capture structured proposals with host identity and preserved output',async()=>{
   reset();mode='bypass';question=false;setJournalMode('valid');
   const genericQueued=await generic.enqueue(cardId,userId,{request_key:'journal-generic'}),genericRecord=clone(manifests.find(m=>m.run_id===genericQueued.id));
   const genericRun=await runGeneric(genericQueued.id);assert.equal(genericRun.status,'success',genericRun.error);assert.equal(genericRun.result.outputs[0].type,'orbit.discovery.proposals');assert.equal(genericRun.metadata.discovery_capture.receipts[0].state,'persisted');
   const promptQueued=await service.execute(cardId,userId,{request_key:'journal-prompt'}),promptRun=await wait(promptQueued.id,'success');assert.deepEqual(JSON.parse(promptRun.output),envelope());assert.equal(promptRun.discovery_capture.receipts[0].state,'persisted');
   for(const [queue,id] of [['card_runs',genericQueued.id],['card_ai_runs',promptQueued.id]]){const entries=journalEntries.filter(e=>e.binding.queue===queue&&e.binding.runId===id);assert.equal(entries.length,1);assert.equal(entries[0].binding.actorId,userId);assert.equal(entries[0].binding.cardId,cardId);assert.equal(entries[0].binding.cardRevision,currentRevision);assert.equal(entries[0].proposal.evidence[0].state,'verified');assert.match(entries[0].proposal.evidence[0].hash,/^[a-f0-9]{64}$/);assert.equal(entries[0].submission.origin,'structured_output');assert.equal(entries[0].submission.artifactHash,hashContextValue(envelope()));}
   assert.deepEqual(manifests.find(m=>m.id===genericRecord.id),genericRecord);setJournalMode('absent');
  });
  await t.test('J21 changed evidence is recorded as changed rather than current verified knowledge',async()=>{
   reset();mode='bypass';question=false;setJournalMode('valid');const queued=await generic.enqueue(cardId,userId,{request_key:'journal-changed-evidence'}),original=clone(manifests.find(m=>m.run_id===queued.id));
   try{during=true;const completed=await runGeneric(queued.id);assert.equal(completed.status,'success',completed.error);const entry=journalEntries.find(e=>e.binding.runId===queued.id);assert.ok(entry);assert.equal(entry.proposal.evidence[0].state,'changed');assert.equal(entry.proposal.evidence[0].hash,original.manifest.sources.find(s=>s.id==='document:skills/selected').contentHash);assert.deepEqual(manifests.find(m=>m.id===original.id),original);}finally{during=false;reset();setJournalMode('absent');}
  });
  await t.test('J17/J24 a captured source replaced by an external symlink is unavailable and never read as verified evidence',async()=>{
   reset();mode='bypass';question=false;setJournalMode('valid');const queued=await generic.enqueue(cardId,userId,{request_key:'journal-external-symlink'});
   try{journalExternalSymlink=true;const completed=await runGeneric(queued.id);assert.equal(completed.status,'success',completed.error);const entry=journalEntries.find(e=>e.binding.runId===queued.id);assert.ok(entry);assert.equal(entry.proposal.evidence[0].state,'unavailable');assert.ok(!JSON.stringify(entry).includes('DO-NOT-LEAK-EXTERNAL-FIXTURE-BODY'));assert.ok(!JSON.stringify(entry).includes(externalEvidence));}finally{journalExternalSymlink=false;if(existsSync(selected+'.fixture-backup')){unlinkSync(selected);renameSync(selected+'.fixture-backup',selected);}setJournalMode('absent');}
  });
  await t.test('J13/J14 absence and Journal persistence failure leave technical results intact in both queues',async()=>{
   reset();mode='bypass';question=false;setJournalMode('absent');const count=journalEntries.length;
   const none=await generic.enqueue(cardId,userId,{request_key:'journal-absent'}),noneRun=await runGeneric(none.id);assert.equal(noneRun.status,'success');assert.equal(noneRun.metadata.discovery_capture.receipts[0].state,'absent');assert.equal(journalEntries.length,count);
   setJournalMode('valid');journalStoreFailure=true;
   try{const genericQueued=await generic.enqueue(cardId,userId,{request_key:'journal-db-failure-generic'}),genericRun=await runGeneric(genericQueued.id);assert.equal(genericRun.status,'success',genericRun.error);assert.equal(genericRun.result.summary,'Generic output preserved');assert.equal(genericRun.metadata.discovery_capture.receipts[0].state,'pending');const promptQueued=await service.execute(cardId,userId,{request_key:'journal-db-failure-prompt'}),promptRun=await wait(promptQueued.id,'success');assert.deepEqual(JSON.parse(promptRun.output),envelope());assert.equal(promptRun.discovery_capture.receipts[0].state,'pending');assert.equal(journalEntries.length,count);}finally{journalStoreFailure=false;setJournalMode('absent');}
  });
  await t.test('J2/J17 invalid or unreviewed structured envelopes are refused without changing successful execution',async()=>{
   reset();mode='bypass';question=false;const count=journalEntries.length;
   for(const variant of ['invalid','unreviewed']){setJournalMode(variant);const queued=await generic.enqueue(cardId,userId,{request_key:'journal-'+variant}),run=await runGeneric(queued.id);assert.equal(run.status,'success',run.error);assert.equal(run.metadata.discovery_capture.receipts[0].state,'rejected');assert.equal(journalEntries.length,count);}
   setJournalMode('absent');
  });
  await t.test('J11/J23 waiting question retains its turn and resumed structured result belongs only to the new manifest',async()=>{
   reset();mode='question';question=true;setJournalMode('valid');const queued=await service.execute(cardId,userId,{request_key:'journal-question'});const initial=await wait(queued.id,'waiting_answer'),first=clone(manifests.find(m=>m.run_id===queued.id));
   assert.equal(initial.discovery_capture.receipts[0].state,'absent');assert.equal(journalEntries.filter(e=>e.binding.runId===queued.id).length,0);question=false;
   await service.answerRun(cardId,queued.id,userId,{answer:'Proceed'});const completed=await wait(queued.id,'success');assert.equal(completed.discovery_capture.receipts[0].state,'persisted');const entries=journalEntries.filter(e=>e.binding.runId===queued.id);assert.equal(entries.length,1);assert.equal(entries[0].binding.turn,1);assert.notEqual(entries[0].binding.manifestId,first.id);assert.deepEqual(manifests.find(m=>m.id===first.id),first);setJournalMode('absent');mode='bypass';
  });
  await t.test('J21/J24 proposals observe captured evidence only in the approved physical worktree in both queues',async()=>{
   reset();mode='bypass';question=false;setJournalMode('valid');assert.equal(git('status','--porcelain'),'');const storage=join(directory,'journal-isolated');mkdirSync(storage,{mode:0o700});const previousIsolation=process.env.ORBIT_ISOLATED_RUNS,previousStorage=process.env.ORBIT_WORKTREE_ROOT,previousConfig=clone(config),pluginExecutor=generic.executors.get('plugin'),previousExecute=pluginExecutor.execute;process.env.ORBIT_ISOLATED_RUNS='1';process.env.ORBIT_WORKTREE_ROOT=storage;
   Object.assign(config,{executor:'plugin',action:'execute',integrations:[{plugin:'filesystem',action:'read',config:{path:'.orbit/skills/selected.md'}}]});pluginExecutor.execute=async input=>{assert.notEqual(input.projectRoot,workspace);assert.equal(readFileSync(join(input.projectRoot,'.orbit/skills/selected.md'),'utf8'),'---\nid: selected\n---\nSelected fixture policy');return {summary:'Synthetic isolated Journal output',outputs:[{type:'orbit.discovery.proposals',value:envelope()}]}};
   try{const q=await generic.enqueue(cardId,userId,{request_key:'journal-isolated-generic',workspace_mode:'isolated'}),before=journalReadRoots.length,run=await runGeneric(q.id);assert.equal(run.status,'success',run.error);const genericRoot=checkoutLedger.get(q.id).identity.root;assert.notEqual(genericRoot,workspace);assert.ok(journalReadRoots.slice(before).includes(genericRoot));assert.equal(journalEntries.find(e=>e.binding.runId===q.id).proposal.evidence[0].state,'verified');Object.assign(config,previousConfig);isolatedPrompt=true;const p=await service.execute(cardId,userId,{request_key:'journal-isolated-prompt',workspace_mode:'isolated'}),completed=await wait(p.id,'success');assert.equal(completed.discovery_capture.receipts[0].state,'persisted');const promptRoot=checkoutLedger.get(p.id).identity.root;assert.ok(journalReadRoots.includes(promptRoot));assert.equal(journalEntries.find(e=>e.binding.runId===p.id).proposal.evidence[0].state,'verified');assert.equal(readFileSync(selected,'utf8'),'---\nid: selected\n---\nSelected fixture policy');assert.equal(existsSync(join(workspace,'isolated-result.txt')),false);}finally{pluginExecutor.execute=previousExecute;Object.assign(config,previousConfig);isolatedPrompt=false;setJournalMode('absent');process.env.ORBIT_ISOLATED_RUNS=previousIsolation;if(previousStorage===undefined)delete process.env.ORBIT_WORKTREE_ROOT;else process.env.ORBIT_WORKTREE_ROOT=previousStorage;}
  });
  await t.test('J2/J20 legacy captures are not retrofitted and authorized Journal reads remain scoped and paginated',async()=>{
   reset();mode='bypass';question=false;setJournalMode('valid');process.env.ORBIT_DISCOVERY_JOURNAL_ENABLED='0';const count=journalEntries.length;
   try{const q=await generic.enqueue(cardId,userId,{request_key:'journal-existing-legacy-generic'});process.env.ORBIT_DISCOVERY_JOURNAL_ENABLED='1';const run=await runGeneric(q.id);assert.equal(run.status,'success',run.error);assert.equal(manifests.find(m=>m.run_id===q.id).manifest.configuration.discoveryJournal,undefined);assert.equal(journalEntries.length,count);}finally{process.env.ORBIT_DISCOVERY_JOURNAL_ENABLED='1';setJournalMode('absent');}
   const entry=journalEntries.find(e=>e.binding.queue==='card_runs');assert.ok(entry);const dto=await generic.discoveryDetail('card_runs',entry.binding.runId,userId,{limit:'1',offset:'0'});assert.equal(dto.records.length,1);assert.equal(dto.latestCapture.receipts[0].state,'persisted');assert.equal(dto.latestCapture.scope,'last_host_receipt_not_global_history');assert.equal(dto.records[0].state,'proposed');assert.equal(dto.records[0].semanticApproval,false);assert.equal(dto.countsScope,'returned_page_only');assert.equal(dto.records[0].compatibility,'historical_not_revalidated');assert.equal(dto.records[0].evidence[0].availability,'not_revalidated');await assert.rejects(()=>generic.discoveryDetail('card_runs',entry.binding.runId,randomUUID(),{}));await assert.rejects(()=>generic.discoveryDetail('card_runs',entry.binding.runId,userId,{limit:'101'}));const page=await generic.discoveryDetail('card_runs',entry.binding.runId,userId,{limit:'1',offset:'1'});assert.equal(page.records.length,0);
  });
 }
 await t.test('T14 read API verifies resource scope and excludes physical paths and source bodies',async()=>{
  const run=[...genericRuns.values()].find(row=>row.status==='success');writeFileSync(selected,'Source changed before authorized read');
  const observationCount=observations.length;
  const dto=await generic.contextDetail('card_runs',run.id,userId),json=JSON.stringify(dto);
  assert.equal(dto.context_status,'changed');assert.equal(observations.length,observationCount);assert.ok(!json.includes(workspace));assert.ok(!json.includes('Selected fixture policy'));assert.ok(!json.includes('rawHash'));assert.ok(!json.includes('checkoutOwner'));
  if(compilerEnabled){assert.equal(dto.compilation.policy_version,'orbit-context-compiler/1');assert.equal(dto.compilation.text,undefined);}
  if(dynamicKnowledge){assert.equal(dto.bridge.knowledge_search.authority_state,'captured_policy_not_live_channel');assert.equal(dto.bridge.knowledge_search.counts_scope,'returned_history_only');}
  if(knowledgeEnabled){assert.equal(dto.knowledge_retrieval.policy_id,'orbit-lexical-retrieval/1');assert.equal(dto.knowledge_retrieval.authorized_candidates,2);assert.equal(dto.knowledge_retrieval.selected,undefined);assert.equal(dto.knowledge_retrieval.query,undefined);}
  await assert.rejects(()=>generic.contextDetail('card_runs',run.id,randomUUID()),/Membership denied/);
  const record=manifests.find(row=>row.id===run.input.context_manifest_id),original=record.manifest;
  const replacement=clone(original);replacement.identity.runtimeId='suinda';replacement.sources.forEach(source=>source.scope.runtimeId='suinda');
  delete replacement.schemaVersion;delete replacement.fingerprint;delete replacement.integrityHash;delete replacement.captureStatus;
  record.manifest=createContextManifest(replacement);
  await assert.rejects(()=>generic.contextDetail('card_runs',run.id,userId),/fora do escopo autorizado/);record.manifest=original;
 });
});
