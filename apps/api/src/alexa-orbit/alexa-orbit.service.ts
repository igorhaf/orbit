import {HttpException,Inject,Injectable,Logger,Optional,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {Db} from '../db';
import {CodexAiService} from '../codex-ai';
import {SecretVault} from '../secrets';
import {ProjectRegistry} from '../execution/project-registry';
import {interpretation,interpretationPrompt,closingSpeech,oneLine,ConversationTurn,VoiceInput} from './interpretation';
import {PluginRegistry} from '../execution/registries';
import {CalendarService} from '../calendar/calendar.service';
import {resolveVaultReference} from '../vault-credentials';
import {cardKindFromTitle} from '../card-rules';
import {Configuration,Destination,Envelope,PLUGIN_ID,appointmentInstant,configuration,emptyConfiguration,response,listen,slot,VoiceResponse} from './model';
export const ORBIT_VOICE_REPLY_BUDGET=Symbol('ORBIT_VOICE_REPLY_BUDGET');
export const ORBIT_VOICE_OPERATIONS=Symbol('ORBIT_VOICE_OPERATIONS');
export interface OrbitVoiceOperations{createCard(list:string,owner:string,title:string):Promise<{id:string}>;scheduleCard(card:string,owner:string,schedule:{startAt:string;endAt:string;allDay:boolean;timeZone:string}):Promise<unknown>}
@Injectable()
export class AlexaOrbitService implements OnModuleInit,OnModuleDestroy{
 private logger=new Logger('AlexaOrbit');
 private successfulReplies=new WeakSet<VoiceResponse>();
 private completed(text:string){const reply=response(text);this.successfulReplies.add(reply);return reply}
 constructor(@Inject(Db) private db:Db,@Inject(PluginRegistry) private plugins:PluginRegistry,@Inject(CalendarService) private calendar:CalendarService,@Inject(ORBIT_VOICE_OPERATIONS) private orbit:OrbitVoiceOperations,@Optional() @Inject(CodexAiService) private ai?:CodexAiService,@Optional() @Inject(SecretVault) private vault?:SecretVault,@Optional() @Inject(ProjectRegistry) private projects?:ProjectRegistry,@Optional() @Inject(ORBIT_VOICE_REPLY_BUDGET) private replyBudget=6000){}
 enabled(){return this.plugins.isEnabled(PLUGIN_ID)}
 private assertEnabled(){if(!this.enabled())throw new HttpException('Plugin desativado.',404)}
 async stored(owner?:string){const row=await this.db.one<{owner_id:string;configuration:Configuration}>('SELECT owner_id,configuration FROM alexa_orbit_configuration WHERE id=1');if(row&&owner&&row.owner_id!==owner)throw new HttpException('Configuração de outro usuário.',403);return row}
 async resolved(){const row=await this.stored();if(!row)return null;const config=configuration(row.configuration);if(config.skillId.startsWith('orbit-vault://'))config.skillId=await resolveVaultReference(this.db,config.skillId,row.owner_id);return {owner:row.owner_id,config}}
 async settings(owner:string){const row=await this.stored(owner);return {configuration:row?configuration(row.configuration):emptyConfiguration,localEndpoint:'/integrations/alexa/orbit',enabled:this.enabled(),development:process.env.ORBIT_ENV==='development'}}
 async save(owner:string,input:unknown){await this.stored(owner);const config=configuration(input);if(config.skillId.startsWith('orbit-vault://')){const skill=await resolveVaultReference(this.db,config.skillId,owner);if(!/^amzn1\.ask\.skill\.[\w-]+$/.test(skill))throw new HttpException('A constante não contém um Skill ID válido.',400)}
  for(const target of [config.taskDestination,config.purchaseDestination])if(target&&!await this.destination(owner,target))throw new HttpException('Quadro ou coluna indisponível.',400);
  if(config.appointmentDestination&&!await this.appointmentTarget(owner,config))throw new HttpException('Calendário ou destino indisponível.',400);
  await this.db.query('INSERT INTO alexa_orbit_configuration(id,owner_id,configuration) VALUES(1,$1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET configuration=excluded.configuration,updated_at=now()',[owner,JSON.stringify(config)]);return this.settings(owner)
 }
 async destination(owner:string,target:Destination|null){if(!target)return false;return Boolean(await this.db.one('SELECT l.id FROM lists l JOIN boards b ON b.id=l.board_id JOIN board_members m ON m.board_id=b.id WHERE l.id=$1 AND l.board_id=$2 AND m.user_id=$3 AND l.archived_at IS NULL AND b.closed_at IS NULL',[target.columnId,target.boardId,owner]))}
 private async source(owner:string,id:string){return this.db.one<{provider_id:string;time_zone:string|null;capabilities:{create?:boolean};connection_enabled:boolean|null}>('SELECT s.provider_id,s.time_zone,s.capabilities,c.enabled AS connection_enabled FROM calendar_sources s LEFT JOIN integration_connections c ON c.id=s.connection_id WHERE s.id=$1 AND s.owner_id=$2',[id,owner])}
 async appointmentTarget(owner:string,config:Configuration){const target=config.appointmentDestination;if(!target)return false;const source=await this.source(owner,target.calendarId);if(!source)return false;if(source.provider_id==='orbit_cards')return Boolean(target.boardId&&target.columnId&&await this.destination(owner,{boardId:target.boardId,columnId:target.columnId}));return Boolean(source.capabilities?.create&&source.connection_enabled!==false&&this.plugins.isEnabled(source.provider_id))}
 async health(owner:string){let current:{owner:string;config:Configuration}|null=null;try{current=await this.resolved()}catch{/* Missing vault reference makes only this plugin unavailable. */}if(current&&current.owner!==owner)throw new HttpException('Configuração de outro usuário.',403);const config=current?.config||emptyConfiguration;
  const taskDestinationConfigured=await this.destination(owner,config.taskDestination),purchaseDestinationConfigured=await this.destination(owner,config.purchaseDestination),appointmentDestinationConfigured=await this.appointmentTarget(owner,config),skillIdConfigured=Boolean(config.skillId&&config.allowedUserIds.length),source=config.appointmentDestination?await this.source(owner,config.appointmentDestination.calendarId):null,timeZoneConfigured=Boolean(config.timeZone||source?.time_zone);return {plugin:PLUGIN_ID,status:this.enabled()?'healthy':'disabled',enabled:this.enabled(),configured:skillIdConfigured&&taskDestinationConfigured&&purchaseDestinationConfigured&&appointmentDestinationConfigured&&timeZoneConfigured,skillIdConfigured,taskDestinationConfigured,purchaseDestinationConfigured,appointmentDestinationConfigured,timeZoneConfigured,simulationAvailable:this.enabled()&&process.env.ORBIT_ENV==='development'&&config.developmentSimulation,pendingRequests:Number((await this.db.one<{n:string}>("SELECT count(*) AS n FROM alexa_orbit_requests WHERE owner_id=$1 AND state='processing'",[owner]))?.n||0)}
 }
 async options(owner:string){const [boards,columns,calendars]=await Promise.all([this.db.query('SELECT b.id,b.title FROM boards b JOIN board_members m ON m.board_id=b.id WHERE m.user_id=$1 AND b.closed_at IS NULL ORDER BY b.title',[owner]),this.db.query('SELECT l.id,l.board_id,l.title FROM lists l JOIN boards b ON b.id=l.board_id JOIN board_members m ON m.board_id=b.id WHERE m.user_id=$1 AND b.closed_at IS NULL AND l.archived_at IS NULL ORDER BY l.position',[owner]),this.calendar.sources(owner)]);return {boards,columns,calendars:calendars.filter(source=>source.provider_id==='orbit_cards'||(source.capabilities as {create?:boolean})?.create)}}
 private title(value:string){if(value.length>300||[...value].some(char=>char.charCodeAt(0)<32)||cardKindFromTitle(value,process.env.WEB_ORIGIN||'http://localhost').kind!=='normal')throw new Error('Título de tarefa inválido.');return value}
 private async addTask(owner:string,config:Configuration,title:string){if(!await this.destination(owner,config.taskDestination))return response('O destino das tarefas ainda não está configurado no Orbit.');await this.orbit.createCard(config.taskDestination!.columnId,owner,this.title(title));this.logger.log('alexa_task_created');return this.completed(`Adicionei ${title} às tarefas.`)}
 private async addPurchase(owner:string,config:Configuration,title:string){if(!await this.destination(owner,config.purchaseDestination))return response('O destino das compras ainda não está configurado no Orbit.');await this.orbit.createCard(config.purchaseDestination!.columnId,owner,this.title(title));this.logger.log('alexa_purchase_created');return this.completed(`Adicionei ${title} às compras.`)}
 private async addAppointment(owner:string,config:Configuration,title:string,date:string,time:string){if(!await this.appointmentTarget(owner,config))return response('O calendário de compromissos ainda não está configurado no Orbit.');const target=config.appointmentDestination!,source=await this.source(owner,target.calendarId),timeZone=config.timeZone||source?.time_zone||'';if(!timeZone)return response('O fuso horário dos compromissos ainda não está configurado no Orbit.');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(`${date}T00:00:00Z`))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)return response('Preciso de um dia exato. Para qual dia?',false,'date');if(!/^\d{2}:\d{2}(?::\d{2})?$/.test(time))return response('Preciso de um horário exato. Que horas?',false,'time');let start:string;try{start=appointmentInstant(date,time,timeZone)}catch{return response('Esse horário não está disponível no fuso configurado. Que horas?',false,'time')}const end=new Date(Date.parse(start)+3600000).toISOString();this.title(title);
  if(source?.provider_id==='orbit_cards'){const card=await this.orbit.createCard(target.columnId!,owner,title);await this.orbit.scheduleCard(card.id,owner,{startAt:start,endAt:end,allDay:false,timeZone})}else await this.calendar.create(owner,target.calendarId,{title,start,end,allDay:false,timeZone});this.logger.log('alexa_appointment_created');const when=new Intl.DateTimeFormat('pt-BR',{timeZone,day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(start));return this.completed(`Marquei ${title} para ${when}.`)
 }
 async dispatch(owner:string,config:Configuration,envelope:Envelope,deadline=Date.now()+this.replyBudget):Promise<VoiceResponse>{const request=envelope.request;
  if(request.type==='LaunchRequest')return listen('Orbit ligado. Como posso ajudar?');
  if(request.type==='SessionEndedRequest')return response();if(request.type!=='IntentRequest')return response('Não reconheci esse pedido. Peça ajuda ao Orbit.',false);
  const intent=request.intent?.name;this.logger.log(JSON.stringify({event:'alexa_intent_received',intent,requestId:request.requestId}));
  switch(intent){case 'OrbitMessageIntent':return this.enqueue(owner,config,envelope,deadline);case 'OrbitStatusIntent':return this.voiceStatus(owner,config,envelope);case 'AMAZON.YesIntent':return listen('Pode falar. Como posso ajudar?',undefined,envelope.session?.attributes?.conversationJobId);case 'AMAZON.NoIntent':return response('Até mais!');case 'AMAZON.HelpIntent':return listen('Converse comigo ou peça para registrar tarefas, compras e compromissos; diga não ou sair para encerrar.');case 'AMAZON.StopIntent':case 'AMAZON.CancelIntent':return response('Tudo bem.');case 'AddTaskIntent':return slot(envelope,'task')?this.addTask(owner,config,slot(envelope,'task')):response('O que você quer adicionar às tarefas?',false,'task');case 'AddPurchaseIntent':return slot(envelope,'item')?this.addPurchase(owner,config,slot(envelope,'item')):response('O que você quer adicionar às compras?',false,'item');case 'AddAppointmentIntent':if(!slot(envelope,'title'))return response('Qual é o compromisso?',false,'title');if(!slot(envelope,'date'))return response('Para qual dia?',false,'date');if(!slot(envelope,'time'))return response('Que horas?',false,'time');return this.addAppointment(owner,config,slot(envelope,'title'),slot(envelope,'date'),slot(envelope,'time'));default:return response('Não reconheci esse pedido. Peça ajuda ao Orbit.',false)}
 }
 async handle(owner:string,config:Configuration,envelope:Envelope,deadline=Date.now()+this.replyBudget){this.assertEnabled();const hash=createHash('sha256').update(JSON.stringify({type:envelope.request.type,intent:envelope.request.intent,sessionAttributes:envelope.session?.attributes,user:envelope.context?.System?.user?.userId||envelope.session?.user?.userId})).digest('hex');const id=envelope.request.requestId;
  const claimed=await this.db.one("INSERT INTO alexa_orbit_requests(skill_id,request_id,owner_id,request_hash,state) VALUES($1,$2,$3,$4,'processing') ON CONFLICT DO NOTHING RETURNING request_id",[config.skillId,id,owner,hash]);
  if(!claimed){const previous=await this.db.one<{owner_id:string;request_hash:string;response:VoiceResponse|null}>('SELECT owner_id,request_hash,response FROM alexa_orbit_requests WHERE skill_id=$1 AND request_id=$2',[config.skillId,id]);if(previous?.owner_id!==owner||previous.request_hash!==hash)throw new HttpException('Request ID reutilizado com outro conteúdo.',400);return previous.response||response('Esse pedido já está em processamento. Confira o Orbit antes de tentar novamente.')}
  let result:VoiceResponse,state='completed';try{result=await this.dispatch(owner,config,envelope,deadline)}catch(error){state='failed';this.logger.error(JSON.stringify({event:'alexa_intent_failed',intent:envelope.request.intent?.name,requestId:id,errorType:(error as Error).name}));result=response('Não consegui concluir esse pedido agora. Confira o Orbit antes de tentar novamente.')}
  await this.db.query('UPDATE alexa_orbit_requests SET state=$3,response=$4::jsonb WHERE skill_id=$1 AND request_id=$2',[config.skillId,id,state,JSON.stringify(result)]);return result;
 }

 private timer?:ReturnType<typeof setInterval>;
 private draining?:Promise<void>;
 private stopping=false;
 private signals=new Map<string,Set<()=>void>>();
 private workRequested=false;
 private nextJob?:string;
 private startWorker(jobId?:string){
  if(this.stopping||!this.ai||!this.vault||!this.enabled())return;
  this.workRequested=true;if(jobId)this.nextJob=jobId;if(this.draining)return;
  this.draining=(async()=>{while(!this.stopping&&this.enabled()){const selected=this.nextJob;this.nextJob=undefined;this.workRequested=false;const processed=await this.processNext(selected);if(!processed&&!this.workRequested&&!selected)break}})().catch(error=>{this.workRequested=false;this.logger.warn(JSON.stringify({event:'alexa_ai_worker_failed',errorType:(error as Error).name}))}).finally(()=>{this.draining=undefined;if(this.workRequested)this.startWorker(this.nextJob)});
 }
 private jobSignal(id:string,timeout:number){
  let finish:()=>void=()=>undefined;let timer:ReturnType<typeof setTimeout>|undefined;
  const promise=new Promise<void>(resolve=>{finish=()=>{if(timer)clearTimeout(timer);const listeners=this.signals.get(id);listeners?.delete(finish);if(!listeners?.size)this.signals.delete(id);resolve()};const listeners=this.signals.get(id)||new Set<()=>void>();listeners.add(finish);this.signals.set(id,listeners);timer=setTimeout(finish,Math.max(0,timeout))});
  return {promise,dispose:finish};
 }
 onModuleInit(){if(!this.ai||!this.vault)return;this.startWorker();this.timer=setInterval(()=>this.startWorker(),2000);this.timer.unref()}
 async onModuleDestroy(){this.stopping=true;if(this.timer)clearInterval(this.timer);await this.draining}
 private speaker(envelope:Envelope){return createHash('sha256').update(envelope.context?.System?.user?.userId||envelope.session?.user?.userId||'local').digest('hex')}
 async jobs(owner:string){await this.stored(owner);const rows=await this.db.query<{id:string;state:string;created_at:Date;encrypted_result:string|null}>('SELECT id,state,created_at,encrypted_result FROM alexa_orbit_ai_jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 10',[owner]);return rows.map(row=>({id:row.id,state:row.state,createdAt:row.created_at,message:row.encrypted_result&&this.vault?this.vault.open<{text:string}>(row.encrypted_result).text:''}))}
 private async enqueue(owner:string,config:Configuration,envelope:Envelope,deadline:number){
  const utterance=slot(envelope,'utterance');if(closingSpeech(utterance))return response('Até mais!');if(['verificar pedido','qual o resultado','meu pedido ficou pronto','consultar pedido','continuar','aguardar'].includes(utterance.toLowerCase()))return this.voiceStatus(owner,config,envelope);if(!utterance)return listen('Como posso ajudar?',undefined,envelope.session?.attributes?.conversationJobId);
  if(utterance.length>2000||[...utterance].some(char=>char.charCodeAt(0)<32))return listen('Esse pedido é muito longo. Diga um pedido por vez.');
  if(!this.ai||!this.vault)return response('A inteligência artificial por voz ainda não está disponível no Orbit.');
  const settings=await this.db.one<{ai_default_model:string|null;ai_default_effort:string|null}>('SELECT ai_default_model,ai_default_effort FROM users WHERE id=$1',[owner]);
  if(!settings?.ai_default_model)return response('Configure o modelo de inteligência artificial nas configurações do Orbit.');
  const speaker=this.speaker(envelope),pending=await this.db.one<{n:string}>("SELECT count(*) AS n FROM alexa_orbit_ai_jobs WHERE owner_id=$1 AND state IN ('queued','interpreting','executing')",[owner]);if(Number(pending?.n||0)>=20)return response('Há muitos pedidos em processamento. Aguarde antes de registrar outro.');
  const history:ConversationTurn[]=[];const previousId=envelope.session?.attributes?.conversationJobId||envelope.session?.attributes?.clarificationJobId;
  if(previousId&&/^[0-9a-f-]{36}$/i.test(previousId)){
   const earlier=await this.db.one<{state:string;encrypted_input:string;encrypted_result:string|null}>("SELECT state,encrypted_input,encrypted_result FROM alexa_orbit_ai_jobs WHERE id=$1 AND owner_id=$2 AND skill_id=$3 AND speaker_hash=$4",[previousId,owner,config.skillId,speaker]);
   if(earlier&&['queued','interpreting','executing'].includes(earlier.state))return this.waitForReply(owner,config,envelope,previousId,deadline);
   if(earlier){const input=this.vault.open<VoiceInput>(earlier.encrypted_input);history.push(...(input.history||[]).slice(-8),{role:'user',text:input.utterance,receivedAt:input.receivedAt});if(earlier.encrypted_result){const result=this.vault.open<{text:string}>(earlier.encrypted_result);history.push({role:'assistant',text:result.text,receivedAt:input.receivedAt})}}
  }
  if(['sim','sim por favor','claro','pode sim'].includes(utterance.toLowerCase())&&envelope.session?.attributes?.dialogPhase==='more')return listen('Pode falar. Como posso ajudar?',undefined,previousId);
  const input:VoiceInput={utterance,receivedAt:envelope.request.timestamp,history};const jobId=randomUUID();
  await this.db.query("INSERT INTO alexa_orbit_ai_jobs(id,owner_id,skill_id,request_id,speaker_hash,encrypted_input,state) VALUES($1,$2,$3,$4,$5,$6,'queued') ON CONFLICT(skill_id,request_id) DO NOTHING",[jobId,owner,config.skillId,envelope.request.requestId,speaker,this.vault.seal(input)]);
  if(this.replyBudget<=0)return response('Recebi seu pedido. A inteligência artificial vai organizar e salvar no Orbit. Diga verificar pedido para consultar o resultado.',false);
  this.startWorker(jobId);
  return this.waitForReply(owner,config,envelope,jobId,deadline);
 }
 private jobReply(job:{id:string;state:string;encrypted_result:string|null;updated_at:Date}){
  if(['queued','interpreting','executing'].includes(job.state))return listen(Date.now()-new Date(job.updated_at).getTime()>600000?'O pedido ficou sem conclusão confirmada; confira no Orbit antes de repetir.':'Ainda estou processando; diga continuar em instantes.',undefined,job.id,'waiting');
  const text=oneLine(job.encrypted_result&&this.vault?this.vault.open<{text:string}>(job.encrypted_result).text:'Não consegui concluir esse pedido.');
  return job.state==='needs_input'?listen(text,job.id,job.id,'clarification'):listen(`${text} Quer mais alguma coisa?`,undefined,job.id,'more');
 }
 private async waitForReply(owner:string,config:Configuration,envelope:Envelope,jobId:string,deadline:number){
  let job:{id:string;state:string;encrypted_result:string|null;updated_at:Date}|null=null;
  do{
   // Subscribe before reading state to avoid missing a completion between the read and wait.
   const signal=this.jobSignal(jobId,Math.min(500,Math.max(0,deadline-Date.now()-100)));
   try{
    job=await this.db.one('SELECT id,state,encrypted_result,updated_at FROM alexa_orbit_ai_jobs WHERE id=$1 AND owner_id=$2 AND skill_id=$3 AND speaker_hash=$4',[jobId,owner,config.skillId,this.speaker(envelope)]);
    if(!job)return listen('Não localizei esse pedido. Como posso ajudar?');
    if(!['queued','interpreting','executing'].includes(job.state))return this.jobReply(job);
    if(deadline-Date.now()<=100)break;
    await signal.promise;
   }finally{signal.dispose()}
  }while(Date.now()<deadline-100);
  return this.jobReply(job!);
 }

 private async voiceStatus(owner:string,config:Configuration,envelope:Envelope){
  const job=await this.db.one<{id:string;state:string;encrypted_result:string|null;updated_at:Date}>('SELECT id,state,encrypted_result,updated_at FROM alexa_orbit_ai_jobs WHERE owner_id=$1 AND skill_id=$2 AND speaker_hash=$3 ORDER BY created_at DESC LIMIT 1',[owner,config.skillId,this.speaker(envelope)]);
  if(!job)return listen('Você ainda não registrou um pedido. Como posso ajudar?');
  return this.jobReply(job);
 }
 async processNext(jobId?:string){
  if(!this.enabled()||!this.ai||!this.vault)return false;
  const startedAt=Date.now();let inferenceMs:number|null=null;
  const job=await this.db.one<{id:string;owner_id:string;skill_id:string;encrypted_input:string;created_at:Date}>("UPDATE alexa_orbit_ai_jobs SET state='interpreting',updated_at=now() WHERE id=(SELECT id FROM alexa_orbit_ai_jobs WHERE state='queued' AND ($1::uuid IS NULL OR id=$1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) AND state='queued' RETURNING id,owner_id,skill_id,encrypted_input,created_at",[jobId||null]);
  if(!job)return false;
  let state='failed',text='Não consegui interpretar o pedido. Nenhuma ação foi iniciada. Tente novamente com mais detalhes.';
  try{
   const current=await this.resolved();if(!current||current.owner!==job.owner_id||current.config.skillId!==job.skill_id)throw new Error('Configuração alterada.');
   const config=current.config,input=this.vault.open<VoiceInput>(job.encrypted_input);
   const boardIds=[config.taskDestination?.boardId,config.purchaseDestination?.boardId,config.appointmentDestination?.boardId].filter((id):id is string=>Boolean(id));
   const [source,settings,projectRows]=await Promise.all([
    config.appointmentDestination?this.source(job.owner_id,config.appointmentDestination.calendarId):Promise.resolve(null),
    this.db.one<{ai_default_model:string|null;ai_default_effort:string|null}>('SELECT ai_default_model,ai_default_effort FROM users WHERE id=$1',[job.owner_id]),
    boardIds.length?this.db.query<{ai_default_project_id:string|null}>('SELECT DISTINCT b.ai_default_project_id FROM boards b JOIN board_members m ON m.board_id=b.id WHERE b.id=ANY($1::uuid[]) AND m.user_id=$2',[boardIds,job.owner_id]):Promise.resolve([])
   ]);
   const timeZone=config.timeZone||source?.time_zone||'';if(!settings?.ai_default_model)throw new Error('IA não configurada.');
   const skills=this.projects?(await Promise.all(projectRows.filter(row=>row.ai_default_project_id).map(row=>this.projects!.skillPrompt(row.ai_default_project_id!,job.owner_id)))).map(result=>result.text).join('\n'):'';
   const inferenceStarted=Date.now();
   const output=await this.ai.complete(interpretationPrompt(input.utterance,timeZone,input.receivedAt,skills,input.history||[]),settings.ai_default_model,config.aiEffort||'low');
   inferenceMs=Date.now()-inferenceStarted;
   const action=interpretation(output,timeZone);
   if(action.kind==='clarify'){state='needs_input';text=oneLine(action.question)}
   else if(action.kind==='reply'){state='completed';text=oneLine(action.summary||action.text)}
   else{
    // Recheck configuration and plugin activation after the potentially slow AI call.
    const latest=await this.resolved();if(!this.enabled()||!latest||latest.owner!==job.owner_id||JSON.stringify(latest.config)!==JSON.stringify(config))throw new Error('Configuração alterada durante processamento.');
    await this.db.query("UPDATE alexa_orbit_ai_jobs SET state='executing',updated_at=now() WHERE id=$1",[job.id]);
    text='A execução ficou sem conclusão confirmada. Confira o conteúdo criado no Orbit antes de repetir.';
    const result=action.kind==='task'?await this.addTask(job.owner_id,config,action.title):action.kind==='purchase'?await this.addPurchase(job.owner_id,config,action.title):await this.addAppointment(job.owner_id,config,action.title,action.date,action.time);
    text=oneLine(result.response.outputSpeech?.text||'Pedido concluído.');if(this.successfulReplies.has(result)&&action.summary)text=action.summary;state=this.successfulReplies.has(result)?'completed':'failed';
   }
  }catch(error){this.logger.warn(JSON.stringify({event:'alexa_ai_job_failed',jobId:job.id,errorType:(error as Error).name}))}
  await this.db.query('UPDATE alexa_orbit_ai_jobs SET state=$2,encrypted_result=$3,updated_at=now() WHERE id=$1',[job.id,state,this.vault.seal({text})]);
  for(const notify of [...(this.signals.get(job.id)||[])])notify();
  this.logger.log(JSON.stringify({event:'alexa_ai_job_timing',jobId:job.id,state,inferenceMs,totalMs:Date.now()-startedAt}));
  return true;
 }

 async simulate(owner:string,envelope:Envelope){this.assertEnabled();const current=await this.resolved();if(process.env.ORBIT_ENV!=='development'||!current?.config.developmentSimulation||current.owner!==owner)throw new HttpException('Simulador de desenvolvimento indisponível.',403);return this.handle(owner,current.config,envelope)}
}
