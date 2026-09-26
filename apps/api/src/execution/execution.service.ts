import {HttpException,Inject,Injectable,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {PoolClient} from 'pg';
import {Db} from '../db';
import {FeaturesService} from '../features';
import {OrbitEvents} from '../orbit-events';
import {ActionDispatcher} from '../action-dispatcher';
import {isId} from '../automation-rules';
import {ProjectRegistry,stringList} from './project-registry';
import {ContextBuilder} from './context-builder';
import {ExecutorRegistry,PluginRegistry,filesystemPlugin} from './registries';
import {CodexExecutor} from './codex-executor';
import {Run,RunRepository} from './run-repository';
import {emptyConfig,emptyDefaults,ExecutionConfig,ExecutionDefaults,ExecutionInput,ExecutionResult,permissions} from './types';
import {configOverrides,globalDefaults,mergeConfig,projectDefaults,validateConfig} from './config';
import {redact,safePath} from './security';

@Injectable()
export class CardExecutionService implements OnModuleInit,OnModuleDestroy {
  readonly executors=new ExecutorRegistry();readonly plugins=new PluginRegistry();readonly runs:RunRepository;readonly context:ContextBuilder;
  private timer?:ReturnType<typeof setInterval>;private active=false;private stopping=false;
  private controllers=new Map<string,AbortController>();
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(ProjectRegistry) private projects:ProjectRegistry,@Inject(OrbitEvents) private events:OrbitEvents,@Inject(ActionDispatcher) private actions:ActionDispatcher){
    this.runs=new RunRepository(db);this.context=new ContextBuilder(db,projects);
    this.executors.register(new CodexExecutor());
    this.executors.register({id:'plugin',name:'Capacidade de plugin',actions:[{id:'execute',name:'Executar integrações',permissions:[]}],async execute(){return {summary:'Integrações executadas.',outputs:[]}}});
    this.plugins.register(filesystemPlugin());
  }
  onModuleInit(){
    for(const type of ['run_agent','run_skill','execute_plugin_action'])this.actions.register(type,async(request,client)=>{
      const config=await this.config(request.cardId,request.userId);
      if(config.mode!=='automatic')throw new Error('O cartão não permite execução automática.');
      const overrides:Partial<ExecutionConfig>={};
      if(request.config.value&&type==='run_agent'){
        const project=await this.projects.get(config.project_id!,request.userId),id=String(request.config.value);
        if(!stringList(project.config.agents,'agents').includes(id))throw new Error('Agente não habilitado no projeto.');
        const agent=await this.projects.document(project,'agents',id);
        overrides.agent=id;overrides.skills=[];overrides.executor=String(agent.metadata.executor||config.executor);overrides.action=String(agent.metadata.action||config.action);
        const ceiling=stringList(agent.metadata.permissions,'permissions');overrides.permissions=config.permissions.filter(p=>p==='execution.automatic'||!ceiling.length||ceiling.includes(p));
      }
      if(request.config.value&&type==='run_skill'){const skill=String(request.config.value);if(!config.skills.includes(skill))throw new Error('Skill não autorizada no cartão.');overrides.skills=[skill]}
      if(type==='execute_plugin_action'&&config.executor!=='plugin')throw new Error('Configure o executor de plugin neste cartão.');
      await this.enqueue(request.cardId,request.userId,{request_key:`automation:${randomUUID()}`},true,client,request.chain,overrides);
    });
    this.actions.register('move_card',async(request,client)=>{
      const list=request.config.list_id;
      if(!isId(list)||(await client.query('SELECT id FROM lists WHERE id=$1 AND board_id=$2 AND archived_at IS NULL',[list,request.boardId])).rowCount===0)throw new Error('Lista da automação indisponível.');
      await client.query('UPDATE cards SET list_id=$2,position=COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=$2),0),updated_at=now() WHERE id=$1',[request.cardId,list]);
    });
    this.timer=setInterval(()=>void this.tick(),2000);this.timer.unref();
  }
  onModuleDestroy(){this.stopping=true;if(this.timer)clearInterval(this.timer);for(const controller of this.controllers.values())controller.abort()}
  async card(id:string,user:string){await this.features.cardBoard(id,user);const row=await this.db.one('SELECT c.*,l.board_id FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=$1',[id]);return row as {id:string;title:string;description:string;board_id:string;ai_project_id:string|null}}
  private storedOverrides(row:Record<string,unknown>|null):Partial<ExecutionDefaults>{
    if(!row)return {};
    const source=row.overrides&&typeof row.overrides==='object'&&Object.keys(row.overrides as object).length?row.overrides:{agent:row.agent,executor:row.executor,action:row.action,skills:row.skills,working_directory:row.working_directory,mode:row.mode,permissions:row.permissions,context:row.context,integrations:row.integrations,automation:row.automation};
    const config=validateConfig({...emptyConfig(),...source});delete (config as Partial<ExecutionConfig>).project_id;delete (config as Partial<ExecutionConfig>).enabled;
    return Object.fromEntries(Object.keys(source as Record<string,unknown>).map(key=>[key,config[key as keyof ExecutionDefaults]])) as Partial<ExecutionDefaults>;
  }
  async config(id:string,user:string,knownCard?:{ai_project_id:string|null}):Promise<ExecutionConfig>{
    const row=await this.db.one<Record<string,unknown>>('SELECT * FROM card_execution_configs WHERE card_id=$1',[id]),card=knownCard||await this.card(id,user);
    const projectId=card.ai_project_id||(row?.project_id as string|undefined)||null;
    let defaults=emptyDefaults();
    if(projectId){const project=await this.projects.get(projectId,user);defaults=projectDefaults(project.config.execution)}
    return mergeConfig(projectId,Boolean(row?.enabled),defaults,this.storedOverrides(row));
  }
  async catalog(user:string,id?:string){
    if(id&&!isId(id))throw new HttpException('Projeto inválido.',400);
    const project=id?await this.projects.get(id,user):null;
    return {projects:await this.projects.list(user),project:project?{id:project.id,name:project.name,config:project.config,resources:project.resources,warnings:project.warnings}:null,executors:this.executors.catalog(),plugins:this.plugins.catalog(),permissions};
  }
  async details(id:string,user:string){
    const card=await this.card(id,user),config=await this.config(id,user,card),runs=await this.db.query(`SELECT id,agent,executor,action,status,stage,output,error,created_at,started_at,finished_at,cancel_requested FROM card_runs WHERE card_id=$1 ORDER BY created_at DESC LIMIT 50`,[id]);
    const project=config.project_id?await this.projects.get(config.project_id,user):null;
    return {execution:config,defaults:project?projectDefaults(project.config.execution):emptyDefaults(),project:project?{id:project.id,name:project.name}:null,result:runs[0]?{status:runs[0].status,...runs[0].output,error:runs[0].error}:{status:'idle'},runs};
  }
  async runDetail(id:string,user:string){if(!isId(id))throw new HttpException('Run inválido.',400);const run=await this.db.one<Run>('SELECT * FROM card_runs WHERE id=$1',[id]);if(!run)throw new HttpException('Run não encontrado.',404);await this.card(run.card_id,user);return {...run,logs:await this.db.query('SELECT stage,message,created_at FROM card_run_logs WHERE run_id=$1 ORDER BY id',[id])}}
  private async resolved(config:ExecutionConfig,card:{id:string;title:string;description:string},user:string){
    if(!config.project_id)throw new Error('Selecione um projeto.');
    const project=await this.projects.get(config.project_id,user);
    const context=await this.context.build(project,config,card,user);
    config.executor=context.executor;
    const executor=this.executors.get(context.executor),action=executor.actions.find(x=>x.id===config.action);
    if(!action)throw new Error('Ação não registrada para este executor.');
    for(const permission of action.permissions)if(!config.permissions.includes(permission))throw new Error(`A ação exige ${permission}.`);
    const enabledPlugins=stringList(project.config.plugins,'plugins');
    for(const integration of config.integrations){if(!enabledPlugins.includes(integration.plugin))throw new Error(`Plugin ${integration.plugin} não habilitado no projeto.`);this.plugins.validate(integration,config.permissions)}
    if(config.executor==='plugin'&&!config.integrations.length)throw new Error('Adicione uma integração.');
    if(config.mode==='automatic'&&!config.permissions.includes('execution.automatic'))throw new Error('Autorize explicitamente execution.automatic.');
    return {project,context,executor};
  }
  async save(id:string,user:string,input:unknown){
    const card=await this.card(id,user);let config:ExecutionConfig;
    try{
      const global=Boolean((input as {save_as_project_default?:unknown})?.save_as_project_default);
      config=validateConfig(input);
      const projectId=card.ai_project_id||config.project_id;
      if(config.enabled&&!projectId)throw new Error('Defina o projeto do cartão na sessão de prompt antes de habilitar a execução.');
      config.project_id=projectId;
      const project=projectId?await this.projects.get(projectId,user):null;
      const defaults=project?projectDefaults(project.config.execution):emptyDefaults();
      if(config.enabled)await this.resolved(config,card,user);
      else if(config.project_id){const project=await this.projects.get(config.project_id,user);await safePath(project.root,config.working_directory,'directory')}
      for(const list of Object.values(config.automation))if(!await this.db.one('SELECT id FROM lists WHERE id=$1 AND board_id=$2 AND archived_at IS NULL',[list,card.board_id]))throw new Error('Lista de resultado não pertence a este quadro.');
      if(global){if(!project)throw new Error('Defina o projeto do cartão antes de salvar um padrão global.');await this.projects.saveExecutionDefaults(project,user,globalDefaults(config));}
      (config as ExecutionConfig&{__overrides?:Partial<ExecutionDefaults>}).__overrides=global?{}:configOverrides(config,defaults);
    }catch(error){throw new HttpException({message:redact((error as Error).message)},400)}
    const client=await this.db.pool.connect();try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[id]);
      if((await client.query("SELECT 1 FROM card_runs WHERE card_id=$1 AND status IN ('queued','running')",[id])).rowCount)throw new HttpException('Aguarde ou cancele a execução antes de mudar a configuração.',409);
      const overrides=(config as ExecutionConfig&{__overrides?:Partial<ExecutionDefaults>}).__overrides||{};
      await client.query(`INSERT INTO card_execution_configs(card_id,project_id,enabled,agent,executor,action,skills,working_directory,mode,permissions,context,integrations,automation,overrides)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(card_id) DO UPDATE SET project_id=EXCLUDED.project_id,enabled=EXCLUDED.enabled,agent=EXCLUDED.agent,executor=EXCLUDED.executor,action=EXCLUDED.action,skills=EXCLUDED.skills,working_directory=EXCLUDED.working_directory,mode=EXCLUDED.mode,permissions=EXCLUDED.permissions,context=EXCLUDED.context,integrations=EXCLUDED.integrations,automation=EXCLUDED.automation,overrides=EXCLUDED.overrides,updated_at=now()`,[id,config.project_id,config.enabled,config.agent,config.executor,config.action,config.skills,config.working_directory,config.mode,config.permissions,JSON.stringify(config.context),JSON.stringify(config.integrations),JSON.stringify(config.automation),JSON.stringify(overrides)]);
      await client.query('COMMIT');this.events.boardChanged(card.board_id,'orbit');return config;
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  async enqueue(id:string,user:string,body:{request_key?:string},automatic=false,transaction?:PoolClient,chain:string[]=[],overrides:Partial<ExecutionConfig>={}){
    const card=await this.card(id,user),config={...await this.config(id,user,card),...overrides};
    if(!config.enabled)throw new HttpException('Habilite a execução neste cartão.',409);
    if(automatic&&(config.mode!=='automatic'||!config.permissions.includes('execution.automatic')))throw new Error('Execução automática não autorizada.');
    try{await this.resolved(config,card,user)}catch(error){throw new HttpException({message:redact((error as Error).message)},400)}
    const key=body.request_key||randomUUID();if(typeof key!=='string'||key.length>150)throw new HttpException('Chave de execução inválida.',400);
    const client=transaction||await this.db.pool.connect();try{
      if(!transaction)await client.query('BEGIN');
      const run=await this.runs.enqueue(client,card,user,config,key,chain);
      if(!transaction)await client.query('COMMIT');this.events.boardChanged(card.board_id,'orbit');return {id:run.id,status:run.status};
    }catch(error){if(!transaction)await client.query('ROLLBACK');if(error instanceof HttpException)throw error;throw new HttpException({message:redact((error as Error).message)},409)}finally{if(!transaction)client.release()}
  }
  async cancel(id:string,user:string){const run=await this.runDetail(id,user);await this.db.query("UPDATE card_runs SET cancel_requested=true WHERE id=$1 AND status IN ('queued','running')",[id]);this.controllers.get(id)?.abort();if(run.status==='queued')await this.runs.finish(run as Run,'cancelled',undefined,'Cancelado pelo usuário.');return {ok:true}}
  async processRun(run:Run){
    const controller=new AbortController();this.controllers.set(run.id,controller);
    const heartbeat=setInterval(()=>void this.db.query("UPDATE card_runs SET heartbeat_at=now() WHERE id=$1 AND status='running' RETURNING cancel_requested",[run.id]).then(rows=>{if(!rows.length||rows[0].cancel_requested)controller.abort()}).catch(()=>controller.abort()),2000);
    try{
      const card=await this.card(run.card_id,run.user_id);
      await this.runs.stage(run.id,'context',`Agente: ${run.agent||'nenhum'}; executor: ${run.executor}; skills: ${run.input.config.skills.join(', ')||'nenhuma'}.`);
      const {project,context,executor}=await this.resolved(run.input.config,run.input.card,run.user_id);
      await this.db.query('UPDATE card_runs SET input=input || $2::jsonb WHERE id=$1',[run.id,JSON.stringify({resources:context.resources})]);
      await this.runs.stage(run.id,'resources',`Recursos carregados: ${context.resources.map(x=>x.kind+':'+x.id).join(', ')||'apenas o cartão'}.`);
      const input:ExecutionInput={runId:run.id,cardId:run.card_id,title:run.input.card.title,prompt:context.prompt,workingDirectory:context.workingDirectory,projectRoot:project.root,permissions:run.input.config.permissions,action:run.action,signal:controller.signal};
      await this.runs.stage(run.id,'executor',`Iniciando ${run.executor}.${run.action}.`);
      if(controller.signal.aborted)throw new Error('Execução cancelada.');
      const result:ExecutionResult=await executor.execute(input);
      for(const integration of run.input.config.integrations){if(controller.signal.aborted)throw new Error('Execução cancelada.');await this.runs.stage(run.id,'plugin',`Executando ${integration.plugin}.${integration.action}.`);result.outputs.push(await this.plugins.execute(integration,input))}
      if(!result||typeof result.summary!=='string'||!Array.isArray(result.outputs)||result.outputs.length>30||JSON.stringify(result).length>200000)throw new Error('Resultado do executor inválido.');
      await this.runs.stage(run.id,'result','Persistindo resultado.');
      const destination=run.input.config.automation.on_success_list_id;
      await this.runs.finish(run,controller.signal.aborted?'cancelled':'success',result,undefined,destination?client=>this.actions.dispatch({type:'move_card',cardId:run.card_id,boardId:card.board_id,userId:run.user_id,config:{list_id:destination},chain:run.chain},client):undefined);
    }catch(error){
      await this.runs.finish(run,controller.signal.aborted?'cancelled':'failed',undefined,redact((error as Error).message));
      if(!controller.signal.aborted&&run.input.config.automation.on_failure_list_id){
        const card=await this.card(run.card_id,run.user_id).catch(()=>null);
        if(card){const client=await this.db.pool.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('orbit.automation_chain',$1,true)",['{'+run.chain.join(',')+'}']);await this.actions.dispatch({type:'move_card',cardId:run.card_id,boardId:card.board_id,userId:run.user_id,config:{list_id:run.input.config.automation.on_failure_list_id},chain:run.chain},client);await client.query('COMMIT')}catch(error){await client.query('ROLLBACK');await this.runs.stage(run.id,'automation',`Falha ao mover: ${(error as Error).message}`)}finally{client.release()}}
      }
    }finally{clearInterval(heartbeat);this.controllers.delete(run.id);const row=await this.db.one('SELECT board_id FROM lists WHERE id=(SELECT list_id FROM cards WHERE id=$1)',[run.card_id]);if(row)this.events.boardChanged(row.board_id,'orbit')}
  }
  async tick(){
    if(this.active||this.stopping)return;this.active=true;
    try{
      const stale=await this.db.query<Run>("SELECT * FROM card_runs WHERE status='running' AND heartbeat_at<now()-interval '2 minutes'");for(const run of stale)await this.runs.finish(run,'failed',undefined,'Worker interrompido. Revise os efeitos antes de executar novamente.');
      const run=await this.runs.claim();if(run)await this.processRun(run);
    }catch(error){console.error('Execution worker:',redact((error as Error).message))}finally{this.active=false}
  }
}
