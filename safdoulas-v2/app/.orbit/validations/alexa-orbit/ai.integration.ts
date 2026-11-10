import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {Pool} from 'pg';
import {AlexaOrbitService} from '../../../apps/api/src/alexa-orbit/alexa-orbit.service';
import {SecretVault} from '../../../apps/api/src/secrets';
import {emptyConfiguration,Envelope,Configuration} from '../../../apps/api/src/alexa-orbit/model';
import {interpretation} from '../../../apps/api/src/alexa-orbit/interpretation';
async function main(){
 dotenv.config({path:'apps/api/.env',quiet:true});const url=new URL(process.env.DATABASE_URL!);url.hostname=process.env.ORBIT_SELENIUM_DB_HOST||'172.22.0.3';
 const admin=new Pool({connectionString:url.toString()}),schema='voice_ai_'+randomUUID().replaceAll('-','');let pool:Pool|undefined,boardId:string|undefined;
 const services:AlexaOrbitService[]=[];
 try{
 const user=(await admin.query('SELECT id,name,email,ai_default_model,ai_default_effort FROM users WHERE email=$1',['igorhaf@gmail.com'])).rows[0];assert(user);assert(user.ai_default_model&&user.ai_default_effort,'Configure global AI before running this check');
 const token=jwt.sign({sub:user.id,email:user.email},process.env.JWT_SECRET!,{expiresIn:'15m'});
 async function api(path:string,method='GET',body?:unknown){const r=await fetch('http://localhost:4001'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,`${method} ${path} HTTP ${r.status}`);return r.json()}
 boardId=(await api('/boards','POST',{title:`Voice AI validation ${schema.slice(-8)}`})).id;
 const lists:string[]=[];for(const title of ['Tarefas','Compras','Compromissos'])lists.push((await api(`/boards/${boardId}/lists`,'POST',{title})).id);
 const source=(await admin.query("SELECT id FROM calendar_sources WHERE owner_id=$1 AND provider_id='orbit_cards' LIMIT 1",[user.id])).rows[0];assert(source);
 const role=decodeURIComponent(url.username);assert(/^[a-zA-Z0-9_]+$/.test(role));
 execFileSync('docker',['exec','orbit-db-dev','sh','-c','psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"','fixture',`CREATE SCHEMA "${schema}" AUTHORIZATION "${role}"`],{stdio:'pipe'});pool=new Pool({connectionString:url.toString(),options:`-c search_path=${schema},public`});
 // Private plugin tables; native boards/cards stay in the ordinary public schema.
 await pool.query(readFileSync('apps/api/sql/migrations/063_alexa_orbit_voice.sql','utf8'));await pool.query(readFileSync('apps/api/sql/migrations/064_alexa_orbit_ai_jobs.sql','utf8'));
 const config:Configuration={...emptyConfiguration,skillId:'amzn1.ask.skill.ai-fixture',allowedUserIds:['amzn1.ask.account.ai-fixture'],timeZone:'America/Recife',taskDestination:{boardId:boardId!,columnId:lists[0]},purchaseDestination:{boardId:boardId!,columnId:lists[1]},appointmentDestination:{calendarId:source.id,boardId:boardId!,columnId:lists[2]}};
 await pool.query('INSERT INTO alexa_orbit_configuration(id,owner_id,configuration) VALUES(1,$1,$2)',[user.id,config]);
 const db={query:async(sql:string,params:unknown[]=[])=> (await pool!.query(sql,params)).rows,one:async(sql:string,params:unknown[]=[])=> (await pool!.query(sql,params)).rows[0]||null};
 const effortsUsed:string[]=[];let enabled=true,output='{}',seenPrompt='',afterAi:(()=>void)|undefined;
 const ai={complete:async(prompt:string,_model:string,effort:string)=>{effortsUsed.push(effort);seenPrompt=prompt;afterAi?.();return output}};
 const vault=new SecretVault();
 const ops={createCard:async(list:string,_owner:string,title:string)=>api(`/lists/${list}/cards`,'POST',{title}),scheduleCard:async(card:string,_owner:string,schedule:unknown)=>api(`/cards/${card}`,'PATCH',{schedule})};
 const service=new AlexaOrbitService(db as never,{isEnabled:()=>enabled} as never,{} as never,ops,ai as never,vault,undefined,0);
 const envelope=(utterance='',speaker=config.allowedUserIds[0],clarificationJobId?:string):Envelope=>({context:{System:{user:{userId:speaker}}},session:{attributes:{clarificationJobId}},request:{type:'IntentRequest',requestId:randomUUID(),timestamp:'2026-10-12T12:00:00Z',intent:{name:'OrbitMessageIntent',slots:{utterance:{value:utterance}}}}});
 const launch=envelope();launch.request.type='LaunchRequest';const opening=await service.handle(user.id,config,launch);assert.equal(opening.response.directives?.[0].updatedIntent?.name,'OrbitMessageIntent');assert.equal(opening.response.shouldEndSession,false);
 for(const [speech,action,index,title] of [['preciso comprar café',{kind:'purchase',title:'café'},1,'café'],['preciso pagar energia',{kind:'task',title:'pagar energia'},0,'pagar energia'],['tenho dentista amanhã às quinze horas',{kind:'appointment',title:'dentista',date:'2026-10-13',time:'15:00'},2,'dentista']] as const){
  output=JSON.stringify(action);const request=envelope(speech),received=await service.handle(user.id,config,request);assert.match(received.response.outputSpeech!.text,/Recebi/);await service.handle(user.id,config,request);
  const queued=(await pool.query('SELECT encrypted_input FROM alexa_orbit_ai_jobs WHERE request_id=$1',[request.request.requestId])).rows;assert.equal(queued.length,1);assert(!queued[0].encrypted_input.includes(speech));
  await Promise.all([service.processNext(),service.processNext()]);
  const cards=(await admin.query('SELECT title,list_id,schedule_start_at FROM cards WHERE list_id=ANY($1::uuid[]) AND title=$2',[lists,title])).rows;assert.equal(cards.length,1);assert.equal(cards[0].list_id,lists[index]);if(index===2)assert.equal(cards[0].schedule_start_at.toISOString(),'2026-10-13T18:00:00.000Z');assert(seenPrompt.includes(speech));
 }
 const count=async()=>Number((await admin.query('SELECT count(*) n FROM cards WHERE list_id=ANY($1::uuid[])',[lists])).rows[0].n);
 output=JSON.stringify({kind:'clarify',question:'Para qual dia e horário?'});const incomplete=envelope('tenho dentista');await service.handle(user.id,config,incomplete);await service.processNext();assert.equal(await count(),3);
 const status=envelope();status.request.intent!.name='OrbitStatusIntent';const question=await service.handle(user.id,config,status);assert.match(question.response.outputSpeech!.text,/qual dia/);const jobId=question.sessionAttributes!.clarificationJobId;assert(jobId);
 output=JSON.stringify({kind:'appointment',title:'dentista completo',date:'2026-10-14',time:'16:00'});await service.handle(user.id,config,envelope('dia catorze às dezesseis horas',config.allowedUserIds[0],jobId));await service.processNext();assert(seenPrompt.includes('tenho dentista'));assert(seenPrompt.includes('dia catorze'));assert.equal(await count(),4);
 const other=envelope('', 'amzn1.ask.account.other');other.request.intent!.name='OrbitStatusIntent';assert.match((await service.dispatch(user.id,config,other)).response.outputSpeech!.text,/ainda não registrou/);
 for(const bad of ['not json',JSON.stringify({kind:'task',title:'injected',columnId:lists[1]}),JSON.stringify({kind:'appointment',title:'bad date',date:'2026-02-30',time:'12:00'})]){output=bad;await service.handle(user.id,config,envelope('invalid fixture'));await service.processNext();assert.equal(await count(),4)}
 output=JSON.stringify({kind:'task',title:'blocked'});await service.handle(user.id,config,envelope('blocked fixture'));afterAi=()=>{enabled=false};await service.processNext();assert.equal(await count(),4);enabled=true;afterAi=undefined;
 await pool.query("INSERT INTO alexa_orbit_ai_jobs(id,owner_id,skill_id,request_id,speaker_hash,encrypted_input,state) VALUES($1,$2,$3,$4,'fixture',$5,'executing')",[randomUUID(),user.id,config.skillId,randomUUID(),vault.seal({utterance:'interrupted'})]);await service.processNext();assert.equal(await count(),4);
 for(const invalid of [{kind:'task',title:'x',destination:'invented'},{kind:'appointment',title:'x',date:'2026-03-08',time:'02:30'}])assert.throws(()=>interpretation(JSON.stringify(invalid),'America/New_York'));

 const dialog=new AlexaOrbitService(db as never,{isEnabled:()=>enabled} as never,{} as never,ops,ai as never,vault,undefined,1500);services.push(dialog);
 output='{"kind":"clarify","question":"Qual dia e horário?"}\n[[ORBIT_SUMMARY]]\nQual dia e horário?\n[[/ORBIT_SUMMARY]]';
 const first=await dialog.handle(user.id,config,envelope('tenho uma consulta'));assert.equal(first.response.outputSpeech!.text,'Qual dia e horário?');assert.equal(first.response.shouldEndSession,false);assert.equal(first.sessionAttributes!.dialogPhase,'clarification');assert.equal(await count(),4);
 output='{"kind":"appointment","title":"consulta por diálogo","date":"2026-10-16","time":"15:00"}\n[[ORBIT_SUMMARY]]\nConsulta marcada para dia dezesseis às quinze horas.\n[[/ORBIT_SUMMARY]]';
 const complement=envelope('dia dezesseis às quinze horas');complement.session!.attributes=first.sessionAttributes;
 const second=await dialog.handle(user.id,config,complement);assert.equal(second.response.outputSpeech!.text,'Consulta marcada para dia dezesseis às quinze horas. Quer mais alguma coisa?');assert.equal(second.sessionAttributes!.dialogPhase,'more');assert(!second.response.outputSpeech!.text.includes('\n'));assert.equal(await count(),5);assert(seenPrompt.includes('tenho uma consulta'));
 const yes=envelope('sim');yes.session!.attributes=second.sessionAttributes;assert.match((await dialog.handle(user.id,config,yes)).response.outputSpeech!.text,/Pode falar/);assert.equal(await count(),5);
 output='{"kind":"purchase","title":"arroz"}\n[[ORBIT_SUMMARY]]\nArroz adicionado às compras.\n[[/ORBIT_SUMMARY]]';
 const next=envelope('preciso comprar arroz');next.session!.attributes=second.sessionAttributes;const third=await dialog.handle(user.id,config,next);assert.match(third.response.outputSpeech!.text,/Arroz adicionado/);assert(seenPrompt.includes('Consulta marcada'));assert.equal(await count(),6);
 const no=envelope('não');no.session!.attributes=third.sessionAttributes;const closed=await dialog.handle(user.id,config,no);assert.equal(closed.response.shouldEndSession,true);assert.deepEqual(closed.sessionAttributes,{});assert.equal(await count(),6);
 output='{"kind":"reply","text":"Olá!"}\n[[ORBIT_SUMMARY]]\nOlá, estou aqui para ajudar.\n[[/ORBIT_SUMMARY]]';const chat=await dialog.handle(user.id,config,envelope('oi'));assert.match(chat.response.outputSpeech!.text,/Olá, estou aqui/);assert.equal(await count(),6);
 const slowAi={complete:async()=>{await new Promise(resolve=>setTimeout(resolve,300));return output}};
 const slow=new AlexaOrbitService(db as never,{isEnabled:()=>enabled} as never,{} as never,ops,slowAi as never,vault,undefined,120);services.push(slow);const started=Date.now();const waiting=await slow.handle(user.id,config,envelope('fale comigo'));assert.match(waiting.response.outputSpeech!.text,/Ainda estou processando/);assert(Date.now()-started<500);assert.equal(waiting.sessionAttributes!.dialogPhase,'waiting');
 await new Promise(resolve=>setTimeout(resolve,400));const resume=envelope('continuar');resume.session!.attributes=waiting.sessionAttributes;assert.match((await slow.handle(user.id,config,resume)).response.outputSpeech!.text,/Olá, estou aqui/);assert.equal(await count(),6);

 const originalOne=db.one;let stateReads=0;db.one=async(sql,params=[])=>{if(sql.startsWith('SELECT id,state,encrypted_result,updated_at FROM alexa_orbit_ai_jobs WHERE id='))stateReads++;return originalOne(sql,params)};
 const queueAi={complete:async()=>{await new Promise(resolve=>setTimeout(resolve,350));return output}};
 const fastQueue=new AlexaOrbitService(db as never,{isEnabled:()=>enabled} as never,{} as never,ops,queueAi as never,vault,undefined,1500);services.push(fastQueue);
 const queueStarted=Date.now();const replies=await Promise.all([fastQueue.handle(user.id,config,envelope('olá primeira fala')),fastQueue.handle(user.id,config,envelope('olá segunda fala'))]);
 for(const reply of replies)assert.match(reply.response.outputSpeech!.text,/Olá, estou aqui/);
 assert(Date.now()-queueStarted<1400,'Backlog must drain without a two-second scheduler delay');assert(stateReads<=7,`Too many database polls: ${stateReads}`);assert.equal(await count(),6);
 assert(effortsUsed.every(effort=>effort==='low'),'Voice must use its own low effort default');
 assert.throws(()=>interpretation('{"kind":"reply","text":"x"}\n[[ORBIT_SUMMARY]]\nlinha um\nlinha dois\n[[/ORBIT_SUMMARY]]','America/Recife'));
 console.log(`PASS fast voice: immediate backlog drain, ${stateReads} completion-state reads, low effort`);
 console.log('PASS conversation: immediate result, short ORBIT_SUMMARY, clarification context, second request without replay, yes/no, general chat without writes, bounded wait and later continuation');
 console.log('PASS AI queue: native task/purchase/appointment, timezone, durable encrypted input, concurrent claims, idempotency, clarification continuation, speaker isolation, invalid AI output, disable during AI, no replay of interrupted effects');
 }finally{for(const service of services)await service.onModuleDestroy();if(pool)await pool.end();if(boardId)await admin.query('DELETE FROM boards WHERE id=$1',[boardId]);await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
