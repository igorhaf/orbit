import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import express,{json,Request} from 'express';
import type {RawBodyRequest} from '@nestjs/common';
import {alexaOrbitBodyParser} from './body-parser';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {SkillRequestSignatureVerifier} from 'ask-sdk-express-adapter';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {FeaturesService} from '../features';
import {AlexaOrbitController} from './alexa-orbit.plugin';
import {interpretation,interpretationPrompt,closingSpeech} from './interpretation';
import {AlexaOrbitService} from './alexa-orbit.service';
import {AlexaSecurity,verifyIdentity,verifyNativeChain} from './security';
import {appointmentInstant,configuration,emptyConfiguration,Envelope,Configuration} from './model';
const owner=randomUUID(),boardId=randomUUID(),columnId=randomUUID(),calendarId=randomUUID();
const config:Configuration={...emptyConfiguration,skillId:'amzn1.ask.skill.fixture',allowedUserIds:['amzn1.ask.account.fixture'],timeZone:'America/Recife',taskDestination:{boardId,columnId},purchaseDestination:{boardId,columnId},appointmentDestination:{calendarId,boardId,columnId},developmentSimulation:true};
function envelope(name:string,slots:Record<string,string>={},id=randomUUID()):Envelope{return {context:{System:{application:{applicationId:config.skillId},user:{userId:config.allowedUserIds[0]}}},request:{type:'IntentRequest',requestId:id,timestamp:new Date().toISOString(),intent:{name,slots:Object.fromEntries(Object.entries(slots).map(([name,value])=>[name,{name,value}]))}}}}
function fixture(enabled=true){const calls:unknown[]=[],requests=new Map<string,{owner_id:string;request_hash:string;response:unknown}>();const db={one:async(sql:string,params:unknown[])=>{if(sql.startsWith('INSERT INTO alexa_orbit_requests')){if(requests.has(String(params[1])))return null;requests.set(String(params[1]),{owner_id:String(params[2]),request_hash:String(params[3]),response:null});return {id:params[1]}}if(sql.startsWith('SELECT owner_id,request_hash'))return requests.get(String(params[1]));if(sql.includes('FROM lists'))return {id:columnId};if(sql.includes('FROM calendar_sources'))return {provider_id:'orbit_cards',time_zone:config.timeZone};return null},query:async(sql:string,params:unknown[])=>{if(sql.startsWith('UPDATE alexa_orbit_requests'))requests.get(String(params[1]))!.response=JSON.parse(String(params[3]));return []}};const operations={createCard:async(...args:unknown[])=>{calls.push(args);return {id:randomUUID()}},scheduleCard:async(...args:unknown[])=>{calls.push(args)}};return {calls,db,operations,service:new AlexaOrbitService(db as never,{isEnabled:()=>enabled} as never,{create:async()=>{calls.push('event')}} as never,operations)}}
test('launch, help, stop, cancel, ended and unknown requests',async()=>{const {service}=fixture();for(const intent of ['AMAZON.HelpIntent','AMAZON.StopIntent','AMAZON.CancelIntent','UnknownIntent']){const reply=await service.dispatch(owner,config,envelope(intent));assert.equal(reply.version,'1.0');assert(reply.response.outputSpeech)}for(const type of ['LaunchRequest','SessionEndedRequest','UnknownRequest']){const request=envelope('');request.request.type=type;assert.equal((await service.dispatch(owner,config,request)).version,'1.0')}});
test('task and purchase call native creation once per request ID',async()=>{for(const [intent,key] of [['AddTaskIntent','task'],['AddPurchaseIntent','item']]){const {service,calls}=fixture(),request=envelope(intent,{[key]:'café'});const first=await service.handle(owner,config,request),second=await service.handle(owner,config,request);assert.deepEqual(first,second);assert.equal(calls.length,1);assert(first.response.outputSpeech?.text.includes('café'));request.request.intent!.slots![key].value='outra';await assert.rejects(()=>service.handle(owner,config,request),/reutilizado/)}});
test('appointment schedules an ordinary card in configured timezone',async()=>{const {service,calls}=fixture();const result=await service.handle(owner,config,envelope('AddAppointmentIntent',{title:'dentista',date:'2026-10-15',time:'15:00'}));assert.equal(calls.length,2);const schedule=(calls[1] as unknown[])[2] as {startAt:string;timeZone:string};assert.equal(schedule.startAt,'2026-10-15T18:00:00.000Z');assert.equal(schedule.timeZone,config.timeZone);assert(result.response.outputSpeech?.text.includes('dentista'))});
test('missing slots elicit task, item, title, date and time without writing',async()=>{const {service,calls}=fixture();for(const [intent,slots,missing] of [['AddTaskIntent',{},'task'],['AddPurchaseIntent',{},'item'],['AddAppointmentIntent',{},'title'],['AddAppointmentIntent',{title:'dentista'},'date'],['AddAppointmentIntent',{title:'dentista',date:'2026-10-15'},'time']] as Array<[string,Record<string,string>,string]>){const reply=await service.dispatch(owner,config,envelope(intent,slots));assert.equal(reply.response.directives?.[0].slotToElicit,missing);assert.equal(reply.response.shouldEndSession,false)}assert.equal(calls.length,0)});
test('missing destinations and service failure stay isolated; disabled plugin writes nothing',async()=>{const f=fixture();assert((await f.service.handle(owner,{...config,taskDestination:null},envelope('AddTaskIntent',{task:'teste'}))).response.outputSpeech?.text.includes('não está configurado'));f.operations.createCard=async()=>{throw new Error('private detail')};const reply=await f.service.handle(owner,config,envelope('AddTaskIntent',{task:'teste'}));assert(!JSON.stringify(reply).includes('private detail'));const disabled=fixture(false);await assert.rejects(()=>disabled.service.handle(owner,config,envelope('AddTaskIntent',{task:'teste'})),/desativado/);assert.equal(disabled.calls.length,0)});
test('exact dates, leap days, DST gaps and ambiguity',()=>{assert.equal(appointmentInstant('2026-10-15','15:00','Europe/Lisbon'),'2026-10-15T14:00:00.000Z');for(const [date,time,zone] of [['2026-02-30','10:00','UTC'],['2026-W40','10:00','UTC'],['2026-10-15','AF','UTC'],['2026-03-08','02:30','America/New_York'],['2026-11-01','01:30','America/New_York']])assert.throws(()=>appointmentInstant(date,time,zone))});
test('wrong skill, unauthorized user and old/future/invalid timestamp fail closed',()=>{for(const mutate of [(e:Envelope)=>{e.context!.System!.application!.applicationId='amzn1.ask.skill.other'},(e:Envelope)=>{e.context!.System!.user!.userId='amzn1.ask.account.other'},(e:Envelope)=>{e.request.timestamp=new Date(Date.now()-160000).toISOString()},(e:Envelope)=>{e.request.timestamp=new Date(Date.now()+160000).toISOString()},(e:Envelope)=>{e.request.timestamp='invalid'}]){const e=envelope('AddTaskIntent');mutate(e);assert.throws(()=>verifyIdentity(e,config),/inválida/)}});
test('real official signature verifier rejects unsigned/hostile public requests',async()=>{const security=new AlexaSecurity(),raw=Buffer.from(JSON.stringify(envelope('AddTaskIntent')));await assert.rejects(()=>security.verify(raw,{},config),/inválida/);await assert.rejects(()=>security.verify(raw,{'signature-256':'invalid',signaturecertchainurl:'https://evil.test/cert'},config),/inválida/)});
test('official SHA256 signature validation rejects tampered body',()=>{const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),raw='{"request":"fixture"}',signature=sign('RSA-SHA256',Buffer.from(raw),privateKey).toString('base64'),verifier=new SkillRequestSignatureVerifier() as unknown as {_validateRequestBody:(key:string,signature:string,body:string)=>void};const key=publicKey.export({type:'spki',format:'pem'}).toString();verifier._validateRequestBody(key,signature,raw);assert.throws(()=>verifier._validateRequestBody(key,signature,raw+' '))});
test('configuration rejects unknown fields and invalid destinations/URLs',()=>{assert.throws(()=>configuration({...config,invented:true}));assert.throws(()=>configuration({...config,taskDestination:{boardId:'bad',columnId}}));assert.throws(()=>configuration({...config,publicEndpoint:'http://example.test/integrations/alexa/orbit'}))});
test('pt-BR model uses supported slots, carrier phrases and matching dialog prompts',()=>{const model=JSON.parse(readFileSync(resolve(__dirname,'alexa/pt-BR.json'),'utf8')).interactionModel;assert.equal(model.languageModel.invocationName,'orbit');for(const intent of model.languageModel.intents){for(const utterance of intent.samples){const slots=[...utterance.matchAll(/\{(\w+)\}/g)].map(match=>match[1]);for(const name of slots)assert(intent.slots?.some((slot:{name:string})=>slot.name===name));if(intent.slots?.some((slot:{type:string})=>slot.type==='AMAZON.SearchQuery')&&slots.length){assert.equal(slots.length,1);assert(utterance.replace(/\{\w+\}/g,'').trim())}}}for(const intent of model.dialog.intents)for(const slot of intent.slots)assert(model.prompts.some((prompt:{id:string})=>prompt.id===slot.prompts.elicitation))});

test('native chain verification rejects a self-signed certificate with the correct Alexa SAN',async()=>{const dir=await mkdtemp(join(tmpdir(),'alexa-native-test-'));try{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=echo-api.amazon.com','-addext','subjectAltName=DNS:echo-api.amazon.com'],{stdio:'ignore'});await assert.rejects(()=>verifyNativeChain(readFileSync(join(dir,'cert.pem'),'utf8')))}finally{await rm(dir,{recursive:true,force:true})}});
test('writable external calendar uses existing CalendarService instead of card creation',async()=>{const f=fixture(),original=f.db.one;f.db.one=async(sql,params)=>sql.includes('FROM calendar_sources')?{provider_id:'google_calendar',time_zone:config.timeZone,capabilities:{create:true},connection_enabled:true} as never:original(sql,params);await f.service.handle(owner,config,envelope('AddAppointmentIntent',{title:'dentista',date:'2026-10-15',time:'15:00'}));assert.deepEqual(f.calls,['event'])});
test('production never enables the local simulator',async()=>{const f=fixture(),old=process.env.ORBIT_ENV;f.db.one=async()=>({owner_id:owner,configuration:config}) as never;try{process.env.ORBIT_ENV='production';await assert.rejects(()=>f.service.simulate(owner,envelope('AddTaskIntent',{task:'teste'})),/indisponível/);assert.equal(f.calls.length,0)}finally{if(old===undefined)delete process.env.ORBIT_ENV;else process.env.ORBIT_ENV=old}});

test('Alexa middleware preserves exact signed bytes ahead of the global JSON parser',async()=>{
 const app=express();app.use('/integrations/alexa/orbit',alexaOrbitBodyParser);app.use(json({limit:'16mb'}));
 app.post('/integrations/alexa/orbit',(req,res)=>{const raw=(req as RawBodyRequest<Request>).rawBody;res.json({raw:raw?.toString('base64'),parsed:req.body})});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 try{const address=server.address();assert(address&&typeof address==='object');const raw=Buffer.from(' { "texto" : "café e pão", "request" : {} } \n');const result=await fetch(`http://127.0.0.1:${address.port}/integrations/alexa/orbit`,{method:'POST',headers:{'Content-Type':'application/json'},body:raw});assert.equal(result.status,200);const parsed=await result.json() as {raw:string;parsed:{texto:string}};assert.equal(parsed.raw,raw.toString('base64'));assert.equal(parsed.parsed.texto,'café e pão')}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
});

@Module({controllers:[AlexaOrbitController],providers:[
 {provide:AlexaOrbitService,useValue:{enabled:()=>true,resolved:async()=>({owner,config}),handle:async()=>({version:'1.0',response:{outputSpeech:{type:'PlainText',text:'Orbit aberto.'},shouldEndSession:false}})}},
 {provide:AlexaSecurity,useValue:{verify:async()=>envelope('AMAZON.HelpIntent')}},
 {provide:FeaturesService,useValue:{user:()=>owner}}
]})
class HttpProtocolFixture{}
test('HTTP protocol returns 200 and the Alexa envelope for successful POST',async()=>{
 // Isolated loopback fixture: validates HTTP semantics, not Amazon signature authenticity.
 const app=await NestFactory.create(HttpProtocolFixture,{logger:false});await app.listen(0,'127.0.0.1');
 try{const address=app.getHttpServer().address();const result=await fetch(`http://127.0.0.1:${address.port}/integrations/alexa/orbit`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(result.status,200);const body=await result.json() as {version:string;response:{outputSpeech:{text:string}}};assert.equal(body.version,'1.0');assert.equal(body.response.outputSpeech.text,'Orbit aberto.')}finally{await app.close()}
});

test('free speech starts on launch; AI interpretation rejects invented fields and invalid appointments',async()=>{
 const f=fixture(),launch=envelope('');launch.request.type='LaunchRequest';const reply=await f.service.dispatch(owner,config,launch);assert.equal(reply.response.shouldEndSession,false);assert.equal(reply.response.directives?.[0].updatedIntent?.name,'OrbitMessageIntent');assert.equal(reply.response.directives?.[0].slotToElicit,'utterance');assert.equal(f.calls.length,0);
 assert.deepEqual(interpretation('{"kind":"purchase","title":"café"}','America/Recife'),{kind:'purchase',title:'café'});
 for(const bad of ['not json','[]','{"kind":"task","title":"x","boardId":"invented"}','{"kind":"delete","title":"x"}','{"kind":"appointment","title":"x","date":"2026-02-30","time":"15:00"}','{"kind":"appointment","title":"x","date":"2026-10-13","time":"AF"}'])assert.throws(()=>interpretation(bad,'America/Recife'));
 const prompt=interpretationPrompt('amanhã às quinze','America/Recife','2026-10-12T12:00:00Z','fixture project skill');assert(prompt.includes('fixture project skill'));assert(prompt.includes('2026-10-12T12:00:00Z'));assert(prompt.includes('America/Recife'));
});

test('voice summaries are one line; natural closing does not confuse negative task text',()=>{
 const output='{ "kind":"reply", "text":"Olá" }\n[[ORBIT_SUMMARY]]\nOlá, posso ajudar.\n[[/ORBIT_SUMMARY]]';assert.equal(interpretation(output,'America/Recife').summary,'Olá, posso ajudar.');
 assert.throws(()=>interpretation(output.replace('Olá, posso ajudar.','linha um\nlinha dois'),'America/Recife'));
 for(const text of ['não','não obrigado','chega','sair','nada mais','é só isso'])assert(closingSpeech(text));
 for(const text of ['não esquecer de pagar energia','não comprar açúcar','não amanhã, sexta-feira'])assert(!closingSpeech(text));
});

test('voice effort defaults to low and validates plugin-specific overrides',()=>{
 const legacy={...config};delete legacy.aiEffort;assert.equal(configuration(legacy).aiEffort,'low');
 for(const effort of ['low','medium','high'])assert.equal(configuration({...config,aiEffort:effort}).aiEffort,effort);
 assert.throws(()=>configuration({...config,aiEffort:'unsupported'}));
});
