import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractPromptQuestion, questionGuidance } from './prompt-question';
import { PromptSessionsService } from './prompt-sessions';
import { CodexAiService } from './codex-ai';

const runId='11111111-1111-4111-8111-111111111111';
const question='[[ORBIT_QUESTION]]\nPosso seguir com a implementação?\n[[/ORBIT_QUESTION]]';
const statusIs=(status:number)=>(error:unknown)=>(error as {getStatus():number}).getStatus()===status;

test('disabled AI startup keeps pending work intact and stops without database writes',async()=>{
  const queries:string[]=[];
  const service=new PromptSessionsService({query:async(sql:string)=>{queries.push(sql);return []}} as never,{} as never,{isAvailable:()=>false} as never,{} as never);
  await service.onModuleInit();
  await service.onModuleDestroy();
  assert.deepEqual(queries,[]);
});

test('question protocol rejects incomplete, empty and non-final blocks',()=>{
  assert.equal(extractPromptQuestion(question),'Posso seguir com a implementação?');
  for(const output of ['texto normal','[[ORBIT_QUESTION]]pergunta','[[ORBIT_QUESTION]] [[/ORBIT_QUESTION]]',question+'\ncontinuação'])assert.equal(extractPromptQuestion(output),null);
  assert.match(questionGuidance(false),/Não edite arquivos/);
  assert.match(questionGuidance(true),/permite continuar/);
});

function answerService(run:Record<string,unknown>|null,authorized=true){
  const service=new PromptSessionsService({one:async(sql:string)=>sql.includes('SELECT c.id')?{id:'card'}:run} as never,{cardBoard:async()=>{if(!authorized)throw Object.assign(new Error('Sem acesso'),{getStatus:()=>404});return 'board';}} as never,{} as never,{} as never);
  return service;
}
test('answers validate membership, ownership, pending state and content',async()=>{
  await assert.rejects(()=>answerService(null,false).answerRun('card',runId,'user',{answer:'Sim'}),statusIs(404));
  await assert.rejects(()=>answerService(null).answerRun('card',runId,'user',{answer:'Sim'}),statusIs(409));
  await assert.rejects(()=>answerService({user_id:'other'}).answerRun('card',runId,'user',{answer:'Sim'}),statusIs(403));
  await assert.rejects(()=>answerService(null).answerRun('card',runId,'user',{answer:'Sim',invented:true}),statusIs(400));
  for(const answer of [undefined,42,'   ','x'.repeat(4001)])await assert.rejects(()=>answerService(null).answerRun('card',runId,'user',{answer}),statusIs(400));
  await assert.rejects(()=>answerService(null).answerRun('card','invalid','user',{answer:'Sim'}),statusIs(400));
});

test('answer reuses the pending execution and its saved session',async()=>{
  const run={id:runId,user_id:'user',project_id:'project',model:'gpt-6-luna',effort:'high',codex_session_id:'saved-session',output:'Pergunta'};
  const service=answerService(run);
  let received:unknown[]=[];
  service.execute=async(...args:Parameters<PromptSessionsService['execute']>)=>{received=args;return {id:runId,project_id:'project',model:'gpt-6-luna',effort:'high',status:'queued'};};
  assert.equal((await service.answerRun('card',runId,'user',{answer:' Sim '})).status,'queued');
  assert.deepEqual(received,['card','user',{instruction:'Sim'},undefined,run]);
});

test('cancelling a pending question releases it and emits cancellation',async()=>{
  let sql='';let event:unknown;
  const service=new PromptSessionsService({one:async(query:string)=>{sql=query;return query.includes('SELECT c.id')?{id:'card'}:{id:runId};}} as never,{cardBoard:async()=> 'board'} as never,{} as never,{promptProgress:(_board:string,_card:string,value:unknown)=>{event=value;}} as never);
  assert.equal((await service.cancelRun('card',runId,'user')).status,'cancelled');
  assert.match(sql,/status IN \('queued','waiting_answer'\)/);
  assert.deepEqual(event,{runId,status:'cancelled',message:'Execução cancelada.'});
});

test('Questionar uses read only on the first turn, skips completion checks while waiting, and resumes saved sessions',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'orbit-question-test-'));
  const executable=join(directory,'codex.mjs');
  const oldBin=process.env.CODEX_BIN,oldHome=process.env.CODEX_HOME;
  try{
    await writeFile(executable,`#!/usr/bin/env node\nimport {writeFile} from 'node:fs/promises';\nconst a=process.argv.slice(2);let prompt='';for await(const chunk of process.stdin)prompt+=chunk;\nif(a.includes('resume')){if(!a.includes('saved-session')||!a.includes('--dangerously-bypass-approvals-and-sandbox'))process.exit(2);}else if(a[a.indexOf('--sandbox')+1]!=='read-only')process.exit(3);\nconsole.log(JSON.stringify({type:'thread.started',thread_id:'saved-session'}));\nawait writeFile(a[a.indexOf('--output-last-message')+1],a.includes('resume')?'Concluído':${JSON.stringify(question)});\n`);
    await chmod(executable,0o755);process.env.CODEX_BIN=executable;process.env.CODEX_HOME=directory;
    const codex=new CodexAiService();
    const waiting=await codex.execute(questionGuidance(false),directory,'gpt-6-luna','high',()=>{},null,undefined,undefined,'planning',[],[],[['node','-e','process.exit(7)']],true);
    assert.equal(waiting.sessionId,'saved-session');assert.equal(extractPromptQuestion(waiting.output),'Posso seguir com a implementação?');
    const completed=await codex.execute(questionGuidance(true),directory,'gpt-6-luna','high',()=>{},waiting.sessionId,undefined,undefined,'bypass',[],undefined,[['node','-e','process.exit(0)']],true);
    assert.equal(completed.output,'Concluído');
    await assert.rejects(()=>codex.execute('Finalizar',directory,'gpt-6-luna','high',()=>{},waiting.sessionId,undefined,undefined,'bypass',[],undefined,[['node','-e','process.exit(7)']],true));
  }finally{
    if(oldBin===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=oldBin;
    if(oldHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=oldHome;
    await rm(directory,{recursive:true,force:true});
  }
});

test('prompt queue persists waiting, releases locks, and requeues the same run after an answer',async()=>{
  let status='queued',output='',sessionId:string|null=null;
  let released=0,calls=0;
  const modes:string[]=[];
  const events:string[]=[];
  const pending=new Map<string,()=>void>();
  const until=(expected:string)=>new Promise<void>(resolve=>pending.set(expected,resolve));
  const query=async(sql:string,args:unknown[]=[])=>{
    if(sql.includes('pg_try_advisory_lock'))return [{locked:true}];
    if(sql.includes('SET status=\'queued\',prompt=')){
      if(status!=='waiting_answer')return [];
      status='queued';return [{id:runId}];
    }
    if(sql.includes('INSERT INTO card_ai_runs')){status='queued';return [{id:runId}];}
    if(sql.includes('SELECT id FROM card_ai_runs'))return status==='waiting_answer'&&sql.includes('LIMIT 1')&&!sql.includes('ORDER BY')?[{id:runId}]:sql.includes('ORDER BY')?[{id:runId}]:[];
    if(sql.includes('SELECT status FROM card_ai_runs'))return [{status}];
    if(sql.includes('SET status=\'running\'')){if(status!=='queued')return [];status='running';return [{id:runId}];}
    if(sql.includes('SET status=\'waiting_answer\'')){status='waiting_answer';output=String(args[1]);sessionId=String(args[2]);return [{id:runId}];}
    if(sql.includes('SET status=$2')){status=String(args[1]);return [];}
    if(sql.includes('SELECT 1 FROM card_ai_runs'))return [{id:runId}];
    if(sql.includes('SELECT id,user_id'))return status==='waiting_answer'?[{id:runId,user_id:'user',project_id:'project',model:'gpt-6-luna',effort:'high',codex_session_id:sessionId,output}]:[];
    if(sql.includes('SELECT codex_session_id'))return sessionId?[{codex_session_id:sessionId}]:[];
    if(sql.includes('SELECT id,name,local_path'))return [{id:'project',name:'Test',local_path:process.cwd(),is_internal_orbit:false}];
    if(sql.includes('SELECT c.id'))return [{id:'card',title:'Card',description:'Implementar',ai_execution_mode:'question',ai_project_id:'project',ai_model:'gpt-6-luna',ai_effort:'high'}];
    return [];
  };
  const db={query,one:async(sql:string,args?:unknown[])=>(await query(sql,args))[0]||null,pool:{connect:async()=>({query:async(sql:string,args?:unknown[])=>({rows:await query(sql,args)}),release:()=>{released++;}})}};
  const service=new PromptSessionsService(db as never,{cardBoard:async()=> 'board',notify:async()=>{},record:async()=>{}} as never,{isAvailable:()=>true,execute:async(...args:unknown[])=>{modes.push(String(args[8]));calls++;if(calls===2)assert.equal(args[5],'saved-session');return {output:calls===1?question:'Concluído',sessionId:'saved-session',fileChanges:[],activities:[]};}} as never,{promptProgress:(_board:string,_card:string,event:{status:string})=>{events.push(event.status);pending.get(event.status)?.();}} as never);
  Object.assign(service,{localPath:async()=>process.cwd(),queuePaused:async()=>false,descriptionImages:async()=>[]});
  const waiting=until('waiting_answer');
  const first=await service.execute('card','user');
  await waiting;
  // Finally releases both advisory lock clients after publishing the event.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(first.id,runId);assert.equal(status,'waiting_answer');assert.equal(sessionId,'saved-session');assert.ok(released>=3);
  await assert.rejects(()=>service.execute('card','user'),statusIs(409));
  const success=until('success');
  const responses=await Promise.allSettled([service.answerRun('card',runId,'user',{answer:'Sim'}),service.answerRun('card',runId,'user',{answer:'Sim duplicado'})]);
  const accepted=responses.filter(result=>result.status==='fulfilled');
  const rejected=responses.filter(result=>result.status==='rejected');
  assert.equal(accepted.length,1);assert.equal(rejected.length,1);
  assert.equal((rejected[0] as PromiseRejectedResult).reason.getStatus(),409);
  const resumed=(accepted[0] as PromiseFulfilledResult<Awaited<ReturnType<PromptSessionsService['answerRun']>>>).value;
  assert.equal(resumed.id,first.id);assert.equal(resumed.status,'queued');
  await success;
  assert.deepEqual(modes,['planning','bypass']);assert.equal(status,'success');
  await assert.rejects(()=>service.answerRun('card',runId,'user',{answer:'Sim novamente'}),statusIs(409));
  assert.deepEqual(events,['queued','running','waiting_answer','queued','running','success']);
});


test('card settings accept all execution modes and reject unknown values before mutation',async()=>{
  const saved:string[]=[];
  const card={id:'card',ai_execution_mode:'bypass',ai_project_id:null,ai_model:null,ai_effort:null,ai_default_project_id:null};
  const service=new PromptSessionsService({one:async()=>card,pool:{connect:async()=>({query:async(sql:string,args:unknown[]=[])=>{
    if(sql.startsWith('UPDATE cards')){saved.push(String(args[4]));return {rows:[{ai_execution_mode:args[4]}]};}
    return {rows:[]};
  },release:()=>{}})}} as never,{cardBoard:async()=> 'board',record:async()=>{}} as never,{} as never,{} as never);
  for(const mode of ['bypass','planning','question'])assert.equal((await service.updateCard('card','user',{ai_execution_mode:mode})).ai_execution_mode,mode);
  await assert.rejects(()=>service.updateCard('card','user',{ai_execution_mode:'invalid'}),statusIs(400));
  assert.deepEqual(saved,['bypass','planning','question']);
});
