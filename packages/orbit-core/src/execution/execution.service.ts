import {discoveryConfiguration} from './discovery-journal';
import {captureExecutionDiscoveries,readExecutionDiscoveries} from './discovery-journal-host';
import {discoveryCategories} from './discovery-journal-repository';
import {knowledgePolicyForManifest} from './knowledge-host';
import type {KnowledgeRetrievalPolicy} from './knowledge-retrieval';
import {contextBridgePolicyFromHost,contextBridgePolicyForManifest,bridgeConfiguration,openContextBridge} from './context-bridge-host';
import {ContextBridgeRepository} from './context-bridge-repository';
import {ContextManifestRepository,compareContextManifest,ContextManifest,createContextManifest} from './context-manifest';
import {contextTechnicalState,executionContextIdentity,manifestForExecution,relevantPluginSources,currentContext,verifyRunContext,finalRunContext,contextManifestDto} from './context-runtime';
import type {IsolatedCheckoutRequest} from './isolated-checkout';
import type {Project} from './project-registry';
import {orbitContextRuntime} from '../orbit-architecture';
import {relative,resolve} from 'node:path';
import {captureIsolationRequest,validateIsolationRequest,withIsolatedCheckout} from './isolated-checkout';
import {withIsolatedExecution} from './isolated-execution-policy';
import type {WorkspaceWriteLease} from './workspace-coordinator';
import {withWorkspaceWriteLease} from './workspace-coordinator';
import {cardRevisionFreshnessSql} from '../card-versions';
import {CardLayoutsService} from '../plugins/card-layouts';
import {runProjectChecks,validateProjectChecks} from './project-checks';
import {captureFileScope} from './file-scope';
import {HttpException,Inject,Injectable,OnModuleInit,OnModuleDestroy,Optional} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Db} from '../db';
import {FeaturesService} from '../features';
import {OrbitEvents} from '../orbit-events';
import {isId} from './security';
import {ProjectRegistry,stringList} from './project-registry';
import {compilerPolicyForManifest} from './context-compiler-host';
import type {ContextCompilerPolicy} from './context-compiler';
import {ContextBuilder} from './context-builder';
import {ExecutorRegistry,PluginRegistry,filesystemPlugin} from './registries';
import {CodexExecutor} from './codex-executor';
import {assertAiCodeDevelopmentAllowed} from './runtime-code-policy';
import {Run,RunRepository} from './run-repository';
import {emptyConfig,ExecutionConfig,ExecutionInput,ExecutionResult,permissions} from './types';
import {validateConfig} from './config';
import {redact,safePath} from './security';
import {PluginActionExecutor} from './plugin-action-executor';
import {PluginNotifications} from '../plugins/notifications';

function assertIsolatedChecksForEnqueue(value:unknown){if(validateProjectChecks(value).length)throw new Error('Verificações requerem provisionamento seguro antes de executar em worktree isolada.');}

@Injectable()
export class CardExecutionService implements OnModuleInit,OnModuleDestroy {
  readonly contextManifests:ContextManifestRepository;readonly executors=new ExecutorRegistry();readonly plugins:PluginRegistry;readonly runs:RunRepository;readonly context:ContextBuilder;
  private timer?:ReturnType<typeof setInterval>;private active=false;private stopping=false;
  private controllers=new Map<string,AbortController>();
  private notifications:PluginNotifications;
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(ProjectRegistry) private projects:ProjectRegistry,@Inject(OrbitEvents) private events:OrbitEvents,@Inject(PluginRegistry) plugins:PluginRegistry,@Optional() @Inject(PluginNotifications) notifications?:PluginNotifications,@Optional() @Inject(CardLayoutsService) private layouts?:CardLayoutsService){
    this.plugins=plugins;this.contextManifests=new ContextManifestRepository(db);
    this.notifications=notifications||new PluginNotifications(this.db);
    this.runs=new RunRepository(db);this.context=new ContextBuilder(db,projects);
    this.executors.register(new CodexExecutor(()=>this.plugins.isEnabled('ai')));
    this.executors.register(new PluginActionExecutor(this.plugins,this.notifications));
    this.plugins.register(filesystemPlugin());
  }
  onModuleInit(){
    this.timer=setInterval(()=>void this.tick(),2000);this.timer.unref();
  }
  onModuleDestroy(){this.stopping=true;if(this.timer)clearInterval(this.timer);for(const controller of this.controllers.values())controller.abort()}
  async card(id:string,user:string){await this.features.cardBoard(id,user);const row=await this.db.one('SELECT c.*,l.board_id,b.workspace_id FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE c.id=$1 AND NOT EXISTS(SELECT 1 FROM vault_items WHERE card_id=c.id)',[id]);if(!row)throw new HttpException('Cartões no cofre não possuem execução.',409);return row as {id:string;title:string;description:string;board_id:string;workspace_id?:string;card_revision:number}}
  async config(id:string):Promise<ExecutionConfig>{const row=await this.db.one('SELECT * FROM card_execution_configs WHERE card_id=$1',[id]);return row?validateConfig(Object.fromEntries(Object.keys(emptyConfig()).map(key=>[key,row[key]]))):emptyConfig()}
  async catalog(user:string,id?:string){
    if(id&&!isId(id))throw new HttpException('Projeto inválido.',400);
    const project=id?await this.projects.get(id,user):null;
    return {projects:await this.projects.list(user),project:project?{id:project.id,name:project.name,config:project.config,resources:project.resources,warnings:project.warnings}:null,executors:this.executors.catalog(),plugins:this.plugins.catalog(),permissions};
  }
  async details(id:string,user:string){
    await this.card(id,user);
    const config=await this.config(id),runs=await this.db.query(`SELECT r.id,r.agent,r.executor,r.action,r.status,r.stage,r.output,r.error,r.created_at,r.started_at,r.finished_at,r.cancel_requested,r.metadata->'write_coordination' AS write_coordination,r.card_revision,r.finished_card_revision,c.card_revision AS current_card_revision,${cardRevisionFreshnessSql('r','c')} AS freshness FROM card_runs r JOIN cards c ON c.id=r.card_id WHERE r.card_id=$1 ORDER BY r.created_at DESC LIMIT 50`,[id]);
    const outputs=await this.db.query('SELECT id,run_id,position,type,label,value,created_at FROM card_outputs WHERE card_id=$1 ORDER BY created_at DESC,position',[id]);
    return {execution:config,result:runs[0]?{status:runs[0].status,...runs[0].output,error:runs[0].error,card_revision:runs[0].card_revision,current_card_revision:runs[0].current_card_revision,freshness:runs[0].freshness}:{status:'idle'},runs,outputs};
  }
  async runDetail(id:string,user:string){if(!isId(id))throw new HttpException('Run inválido.',400);const run=await this.db.one<Run>(`SELECT r.*,c.card_revision AS current_card_revision,${cardRevisionFreshnessSql('r','c')} AS freshness FROM card_runs r JOIN cards c ON c.id=r.card_id WHERE r.id=$1`,[id]);if(!run)throw new HttpException('Run não encontrado.',404);await this.card(run.card_id,user);return {...run,logs:await this.db.query('SELECT stage,message,created_at FROM card_run_logs WHERE run_id=$1 ORDER BY id',[id]),outputs:await this.db.query('SELECT id,position,type,label,value,created_at FROM card_outputs WHERE run_id=$1 ORDER BY position',[id])}}
  private async resolved(config:ExecutionConfig,card:{id:string;title:string;description:string;card_revision?:number;workspace_id?:string},user:string,compilerPolicy?:ContextCompilerPolicy|null,knowledgePolicy?:KnowledgeRetrievalPolicy|null){
    if(!config.project_id)throw new Error('Selecione um projeto.');
    const project=await this.projects.get(config.project_id,user);
    const context=await this.context.build(project,config,card,user,{workspaceId:card.workspace_id,compilerPolicy,knowledgePolicy});
    config.executor=context.executor;
    const executor=this.executors.get(context.executor),action=executor.actions.find(x=>x.id===config.action);
    if(!action)throw new Error('Ação não registrada para este executor.');
    for(const permission of action.permissions)if(!config.permissions.includes(permission))throw new Error(`A ação exige ${permission}.`);
    if(validateProjectChecks(project.config.post_execution_checks).length&&!config.permissions.includes('process.execute'))throw new Error('As verificações obrigatórias do projeto exigem process.execute.');
    const enabledPlugins=stringList(project.config.plugins,'plugins');
    for(const integration of config.integrations){if(!enabledPlugins.includes(integration.plugin))throw new Error(`Plugin ${integration.plugin} não habilitado no projeto.`);this.plugins.validate(integration,config.permissions)}
    if(config.executor==='plugin'&&!config.integrations.length)throw new Error('Adicione uma integração.');
    return {project,context,executor};
  }
  async save(id:string,user:string,input:unknown){
    const card=await this.card(id,user);let config:ExecutionConfig;
    try{
      config=validateConfig(input);
      if(config.enabled)await this.resolved(config,card,user);
      else if(config.project_id){const project=await this.projects.get(config.project_id,user);await safePath(project.root,config.working_directory,'directory')}
    }catch(error){throw new HttpException({message:redact((error as Error).message)},400)}
    const client=await this.db.pool.connect();try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[id]);
      if((await client.query("SELECT 1 FROM card_runs WHERE card_id=$1 AND status IN ('queued','running')",[id])).rowCount)throw new HttpException('Aguarde ou cancele a execução antes de mudar a configuração.',409);
      await client.query(`INSERT INTO card_execution_configs(card_id,project_id,enabled,agent,executor,action,skills,working_directory,mode,permissions,context,integrations)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(card_id) DO UPDATE SET project_id=EXCLUDED.project_id,enabled=EXCLUDED.enabled,agent=EXCLUDED.agent,executor=EXCLUDED.executor,action=EXCLUDED.action,skills=EXCLUDED.skills,working_directory=EXCLUDED.working_directory,mode=EXCLUDED.mode,permissions=EXCLUDED.permissions,context=EXCLUDED.context,integrations=EXCLUDED.integrations,updated_at=now()`,[id,config.project_id,config.enabled,config.agent,config.executor,config.action,config.skills,config.working_directory,config.mode,config.permissions,JSON.stringify(config.context),JSON.stringify(config.integrations)]);
      await client.query('COMMIT');this.events.boardChanged(card.board_id,'orbit');return config;
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  private async preparedContextManifest(runId:string,project:Project,context:Awaited<ReturnType<ContextBuilder['build']>>,config:ExecutionConfig,card:{id:string;card_revision?:number|null;workspace_id?:string|null},user:string,request?:IsolatedCheckoutRequest,technical?:Awaited<ReturnType<typeof contextTechnicalState>>,bridgeManifest?:ContextManifest|null):Promise<ContextManifest>{
    const identity=executionContextIdentity('card_runs',runId,card,project.id,user,config.executor||context.executor,'card_execution');
    const plugins=relevantPluginSources(identity,this.plugins,[...config.integrations.map(item=>item.plugin),...(config.executor==='codex'?['ai']:[])]);
    const bridgePolicy=bridgeManifest===undefined?contextBridgePolicyFromHost(context.configuration.contextCompilation,undefined,context.configuration.knowledgeRetrieval):contextBridgePolicyForManifest(bridgeManifest);
    return manifestForExecution(identity,{...context,configuration:discoveryConfiguration(bridgeConfiguration(context.configuration,bridgePolicy),project.id,bridgeManifest===undefined?undefined:bridgeManifest?{manifest:bridgeManifest}:null),sources:[...context.sources,...plugins]},technical??await contextTechnicalState(project.root,request));
  }
  async contextDetail(queue:string,id:string,user:string){
    if(!['card_runs','card_ai_runs'].includes(queue)||!isId(id))throw new HttpException('Execução inválida.',400);
    const table=queue==='card_runs'?'card_runs':'card_ai_runs';
    const run=await this.db.one(`SELECT card_id,project_id,user_id,status${queue==='card_runs'?',input':''} FROM ${table} WHERE id=$1`,[id]);
    if(!run)throw new HttpException('Execução não encontrada.',404);
    const card=await this.card(run.card_id,user);let project:Project;
    try{project=await this.projects.get(run.project_id,user)}catch{throw new HttpException('Contexto não encontrado ou sem acesso ao projeto.',404)}
    const record=await this.contextManifests.latest(queue as 'card_runs'|'card_ai_runs',id);
    if(!record)return {context_status:'legacy',manifest:null,verifications:[]};
    if(record.manifest.identity.runtimeId!==orbitContextRuntime||record.manifest.identity.projectId!==run.project_id||record.manifest.identity.cardId!==run.card_id||record.manifest.identity.actorId!==run.user_id||record.manifest.identity.workspaceId!==(card.workspace_id??null))throw new HttpException('Contexto fora do escopo autorizado.',403);
    const dto=contextManifestDto(record,await this.contextManifests.history(record.id),{runStatus:run.status});
    // GET observes without appending rows; last persisted checks retain their own time.
    let live;
    try{
      if(queue==='card_runs'&&run.input){
        if(run.input.checkout_request)await validateIsolationRequest({...project,workspace_id:card.workspace_id},run.input.checkout_request);
        const config=await this.config(run.card_id),resolved=await this.resolved(config,card,user,compilerPolicyForManifest(record.manifest),knowledgePolicyForManifest(record.manifest));
        const observed=await this.preparedContextManifest(id,project,resolved.context,config,card,user,run.input.checkout_request,undefined,record.manifest);
        live=compareContextManifest(record.manifest,currentContext(observed));
      }else{
        const sources=await this.projects.revalidateSelection(project,user,record.manifest.sources,{workspaceId:card.workspace_id});
        const plugins=relevantPluginSources(record.manifest.identity,this.plugins,record.manifest.sources.filter(source=>source.origin==='plugin_registry').map(source=>source.resourceId.replace(/^plugin:/,'')));
        const byId=new Map(plugins.map(source=>[source.id,source]));
        live=compareContextManifest(record.manifest,{sources:sources.map(source=>byId.get(source.id)??source)});
      }
    }catch{live={status:'unavailable' as const,changes:['selected_sources'],reasons:['As fontes atuais não puderam ser observadas no escopo autorizado.']};}
    const bridgeHistory=record.manifest.configuration.contextBridge?await new ContextBridgeRepository(this.db).history(record.id,100):[];
    const knowledgeEvents=bridgeHistory.filter(row=>row.event.capability==='knowledge.search');
    const knowledgeSnapshot={enabled_at_capture:Boolean((record.manifest.configuration.contextBridge as Record<string,unknown>|undefined)?.knowledge),schema_version:1,queries_in_returned_history:new Set(knowledgeEvents.map(row=>row.event.requestId).filter(Boolean)).size,emitted_results_in_returned_history:knowledgeEvents.filter(row=>row.event.phase==='response_emitted').reduce((sum,row)=>sum+(row.event.knowledge?.returned??0),0),authority_state:'captured_policy_not_live_channel',corpus_state:'captured_not_live_search',counts_scope:'returned_history_only',model_consumption:'unverified'};
    const bridgeSnapshot=record.manifest.configuration.contextBridge?{enabled:true,captured_policy:record.manifest.configuration.contextBridge,transport_status:'local_protocol_only_codex_not_homologated',history:bridgeHistory,knowledge_search:knowledgeSnapshot,history_limited:bridgeHistory.length===100,counts_scope:'returned_history_only'}:{enabled:false};
    return {...dto,bridge:bridgeSnapshot,last_verification_status:dto.context_status,context_status:live.status,live_verification:{...live,reference:'authorized_project',observed_at:new Date().toISOString()}};

  }
  async discoveryDetail(queue:string,id:string,user:string,filters:Record<string,string>={}){
    if(!['card_runs','card_ai_runs'].includes(queue)||!isId(id)||Object.keys(filters).some(k=>!['category','limit','offset'].includes(k)))throw new HttpException('Consulta inválida.',400);
    const run=await this.db.one(`SELECT card_id,project_id,user_id FROM ${queue} WHERE id=$1`,[id]);
    if(!run||run.user_id!==user)throw new HttpException('Descobertas não encontradas.',404);
    const card=await this.card(run.card_id,user);await this.projects.get(run.project_id,user);
    const record=await this.contextManifests.latest(queue as 'card_runs'|'card_ai_runs',id);
    if(!record||!record.manifest.configuration.discoveryJournal)return {schemaVersion:1,state:'disabled_or_legacy',records:[],countsScope:'returned_page_only'};
    const identity=record.manifest.identity;
    if(identity.runtimeId!==orbitContextRuntime||identity.actorId!==user||identity.projectId!==run.project_id||identity.cardId!==run.card_id||identity.workspaceId!==(card.workspace_id??null))throw new HttpException('Descobertas fora do escopo.',403);
    const limit=filters.limit===undefined?50:Number(filters.limit),offset=filters.offset===undefined?0:Number(filters.offset);
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>10000||filters.category!==undefined&&!discoveryCategories.includes(filters.category as typeof discoveryCategories[number]))throw new HttpException('Filtro inválido.',400);
    try{return await readExecutionDiscoveries(this.db,record,user,{limit,offset,...(filters.category?{category:filters.category as typeof discoveryCategories[number]}:{})})}catch{throw new HttpException('Journal indisponível para consulta autorizada.',503)}
  }
  async enqueue(id:string,user:string,body:{request_key?:string;workspace_mode?:'isolated'}){
    assertAiCodeDevelopmentAllowed(orbitContextRuntime);
    await this.layouts?.assertExecutionAllowed(id,user);
    const card=await this.card(id,user),config=await this.config(id);
    if(body.workspace_mode!==undefined&&body.workspace_mode!=='isolated')throw new HttpException('Modo de workspace inválido.',400);
    // A repeated request retains the original run even if HEAD or the card changed.
    if(body.request_key){const previous=await this.db.one('SELECT id,status FROM card_runs WHERE card_id=$1 AND request_key=$2',[id,body.request_key]);if(previous)return {id:previous.id,status:previous.status};}
    if(!config.enabled)throw new HttpException('Habilite a execução neste cartão.',409);
    let checkoutRequest:Awaited<ReturnType<typeof captureIsolationRequest>>|undefined;
    let prepared:Awaited<ReturnType<CardExecutionService['resolved']>>;
    let preparedManifest:ContextManifest;
    try{
      if(body.workspace_mode==='isolated'){
        if(!config.project_id)throw new Error('Selecione um projeto.');
        if(!card.workspace_id)throw new Error('Workspace organizacional não identificado para este card.');
        checkoutRequest=await captureIsolationRequest({...await this.projects.get(config.project_id,user),workspace_id:card.workspace_id});
      }
      if(!config.project_id)throw new Error('Selecione um projeto.');
      const sourceProject=await this.projects.get(config.project_id,user);
      const technicalBefore=await contextTechnicalState(sourceProject.root,checkoutRequest);
      prepared=await this.resolved(config,card,user);
      preparedManifest=await this.preparedContextManifest('pending',prepared.project,prepared.context,config,card,user,checkoutRequest,technicalBefore);
      const checked=await this.resolved(config,card,user);
      const confirmed=await this.preparedContextManifest('pending',checked.project,checked.context,config,card,user,checkoutRequest);
      if(compareContextManifest(preparedManifest,currentContext(confirmed)).status!=='compatible')throw new Error('O contexto mudou durante a preparação; reconciliação necessária.');
      if(checkoutRequest)await validateIsolationRequest({...prepared.project,workspace_id:card.workspace_id},checkoutRequest);
    }catch(error){throw new HttpException({message:redact((error as Error).message)},400)}
    const key=body.request_key||randomUUID();if(typeof key!=='string'||key.length>150)throw new HttpException('Chave de execução inválida.',400);
    const client=await this.db.pool.connect();try{
      await client.query('BEGIN');
      const run=await this.runs.enqueue(client,card,user,config,key,checkoutRequest,async(client,inserted)=>{
        const manifest=createContextManifest({identity:{...preparedManifest.identity,runId:inserted.id},sources:preparedManifest.sources,configuration:preparedManifest.configuration,git:preparedManifest.git,checkout:preparedManifest.checkout,assemblyPolicy:preparedManifest.assemblyPolicy,material:preparedManifest.material,capturedAt:preparedManifest.capturedAt});
        const record=await this.contextManifests.store(client,manifest);
        await client.query("UPDATE card_runs SET input=input||jsonb_build_object('context_manifest_id',$2::text) WHERE id=$1",[inserted.id,record.id]);
      });
      await client.query('COMMIT');this.events.boardChanged(card.board_id,'orbit');return {id:run.id,status:run.status};
    }catch(error){await client.query('ROLLBACK');if(error instanceof HttpException)throw error;throw new HttpException({message:redact((error as Error).message)},409)}finally{client.release()}
  }
  async cancel(id:string,user:string){
    const run=await this.runDetail(id,user);
    const queued=await this.db.query("UPDATE card_runs SET status='cancelled',cancel_requested=true,error='Cancelado pelo usuário.',finished_at=now(),heartbeat_at=now() WHERE id=$1 AND status='queued' RETURNING id",[id]);
    if(queued.length){await this.db.query("INSERT INTO card_run_logs(run_id,stage,message) VALUES($1,'cancelled','Cancelado pelo usuário.')",[id]);return {ok:true}}
    const running=await this.db.query("UPDATE card_runs SET cancel_requested=true WHERE id=$1 AND status='running' RETURNING id",[id]);
    if(running.length){this.controllers.get(id)?.abort();return {ok:true}}
    // The run became terminal after runDetail read it; cancellation is already complete.
    if(['success','failed','cancelled'].includes(run.status))return {ok:true};
    throw new HttpException('Execução não pode ser cancelada neste estado.',409);
  }
  async processRun(run:Run){
    const controller=new AbortController();this.controllers.set(run.id,controller);
    const userCancelled=()=>controller.signal.aborted&&controller.signal.reason?.name==='AbortError';
    const heartbeat=setInterval(()=>void this.db.query("UPDATE card_runs SET heartbeat_at=now() WHERE id=$1 AND status='running' AND worker_id=$2 RETURNING cancel_requested",[run.id,this.runs.workerId]).then(rows=>{if(!rows.length)controller.abort(new Error('A execução deixou de pertencer ao worker.'));else if(rows[0].cancel_requested)controller.abort()}).catch(()=>controller.abort(new Error('A comunicação de ownership do worker foi interrompida.'))),2000);
    try{
      await this.layouts?.assertExecutionAllowed(run.card_id,run.user_id);
      const card=await this.card(run.card_id,run.user_id);
      await this.runs.stage(run.id,'context',`Agente: ${run.agent||'nenhum'}; executor: ${run.executor}; skills: ${run.input.config.skills.join(', ')||'nenhuma'}.`);
      const capturedCard={...run.input.card,card_revision:run.card_revision??undefined,workspace_id:card.workspace_id};
      const contextRecord=run.input.context_manifest_id?await this.contextManifests.get(run.input.context_manifest_id):null;
      if(run.input.context_manifest_id&&!contextRecord)throw new Error('Manifesto vinculado à execução está indisponível.');
      let compilerPolicy:ContextCompilerPolicy|null;let knowledgePolicy:KnowledgeRetrievalPolicy|null;
      try{compilerPolicy=compilerPolicyForManifest(contextRecord?.manifest??null);}
      catch(error){if(contextRecord)await this.contextManifests.observe(contextRecord.id,{phase:'started',compatibility:{status:'changed',changes:['compilation:policy'],reasons:['A política de compilação do host mudou ou foi desativada.']}});throw error;}
      try{knowledgePolicy=knowledgePolicyForManifest(contextRecord?.manifest??null);}
      catch(error){if(contextRecord)await this.contextManifests.observe(contextRecord.id,{phase:'started',compatibility:{status:'changed',changes:['knowledge:policy'],reasons:['A política capturada de recuperação mudou ou foi desativada.']}});throw error;}
      const resolved=await this.resolved(run.input.config,capturedCard,run.user_id,compilerPolicy,knowledgePolicy);
      let {project,context}=resolved;const executor=resolved.executor;
      const checkoutRequest=run.input.checkout_request;
      if(checkoutRequest){
        if(run.project_id!==project.id||run.input.config.project_id!==project.id)throw new Error('Projeto do run isolado não corresponde à autorização atual.');
        if(executor.id!==run.executor)throw new Error('Executor atual não corresponde ao snapshot do run.');
        if(!['codex','plugin'].includes(run.executor))throw new Error('Executor sem contrato de checkout isolado homologado pelo host.');
        assertIsolatedChecksForEnqueue(project.config.post_execution_checks);
        for(const integration of run.input.config.integrations)if(integration.plugin!=='filesystem'||integration.action!=='read')throw new Error('Action sem autoridade de isolamento homologada.');
      }
      let completedResult:ExecutionResult|undefined;
      let coordinationWrites:Promise<unknown>=Promise.resolve();
      const executeProtected=async(lease:WorkspaceWriteLease)=>{
      await coordinationWrites;
      await lease.assertActive();
      if(checkoutRequest){const activeCard=await this.card(run.card_id,run.user_id);if(activeCard.card_revision!==run.card_revision||activeCard.workspace_id!==card.workspace_id)throw new Error('A revisão ou workspace mudou durante a espera; reconciliação necessária antes de executar.');}
      await this.db.query("UPDATE card_runs SET metadata=jsonb_set(metadata,'{write_coordination}',$2::jsonb) WHERE id=$1 AND worker_id=$3",[run.id,JSON.stringify({phase:'active_workspace',owner:lease.owner,resource:lease.resource}),this.runs.workerId]);
      if(contextRecord){
        const authorized=await this.projects.get(project.id,run.user_id);
        if(authorized.root!==(project.authorizationRoot||project.root))throw new Error('A raiz autorizada do projeto mudou durante a espera.');
        const selectedProject=project.authorizationRoot?{...authorized,authorizationRoot:authorized.root,root:project.root,resourcesRoot:project.resourcesRoot}:authorized;
        context=await this.context.build(selectedProject,run.input.config,capturedCard,run.user_id,{workspaceId:card.workspace_id,compilerPolicy:compilerPolicyForManifest(contextRecord?.manifest??null),knowledgePolicy:knowledgePolicyForManifest(contextRecord?.manifest??null)});
        const activeCard=await this.card(run.card_id,run.user_id);
        if(activeCard.card_revision!==run.card_revision||activeCard.workspace_id!==card.workspace_id)throw new Error('A demanda ou workspace mudou antes da entrega do contexto.');
        const observed=await this.preparedContextManifest(run.id,project,context,run.input.config,capturedCard,run.user_id,checkoutRequest,undefined,contextRecord.manifest);
        const compatibility=await verifyRunContext(this.contextManifests,contextRecord,observed,'started',{boundary:'executor_input',contextHash:observed.material.contextHash,promptHash:observed.material.promptHash,checkoutOwner:lease.owner});
        if(compatibility.status!=='compatible')throw new Error('O contexto capturado ficou incompatível antes da execução; reconciliação necessária.');
      }
      await this.db.query('UPDATE card_runs SET input=input || $2::jsonb WHERE id=$1',[run.id,JSON.stringify({resources:context.resources})]);
      await this.runs.stage(run.id,'resources',`Recursos carregados: ${context.resources.map(x=>x.kind+':'+x.id).join(', ')||'apenas o cartão'}.`);
      const input:ExecutionInput={runId:run.id,cardId:run.card_id,userId:run.user_id,projectId:project.id,title:run.input.card.title,prompt:context.prompt,workingDirectory:context.workingDirectory,projectRoot:project.root,permissions:run.input.config.permissions,action:run.action,integrations:run.input.config.integrations,signal:AbortSignal.any([controller.signal,lease.signal]),writeScope:run.input.config.context.write_scope,...(context.compilation&&contextRecord&&run.executor==='codex'?{contextDelivery:{compiledHash:context.compilation.compiledHash,policy:context.compilation.policy,...(contextRecord.manifest.configuration.contextBridge?{dynamicContextBudgetBytes:contextBridgePolicyForManifest(contextRecord.manifest)!.limits.maxTotalBytes}:{}),onDelivery:async(receipt:import('./context-manifest').ContextObject)=>{await this.contextManifests.observe(contextRecord.id,{phase:'delivered',compatibility:{status:'compatible',changes:[],reasons:['Material compilado verificado na fronteira do adaptador.']},delivery:receipt})}}}:{})};
      await this.runs.stage(run.id,'executor',`Iniciando ${run.executor}.${run.action}.`);
      if(controller.signal.aborted)throw new Error('Execução cancelada.');
      let result:ExecutionResult;let activeBridge:Awaited<ReturnType<typeof openContextBridge>>|undefined;
      const verifyScope=input.writeScope===undefined?null:await captureFileScope(project.root,input.writeScope);
      const checks=validateProjectChecks(project.config.post_execution_checks);
      try{
      if(contextRecord&&contextBridgePolicyForManifest(contextRecord.manifest)){activeBridge=await openContextBridge({db:this.db,projects:this.projects,plugins:this.plugins,record:contextRecord,project,lease,workerId:this.runs.workerId,signal:input.signal,card:()=>this.card(run.card_id,run.user_id)});input.contextBridge=activeBridge.handle;}
      result=await executor.execute(input);
      if(run.executor!=='plugin')for(const integration of run.input.config.integrations){if(controller.signal.aborted)throw new Error('Execução cancelada.');await this.runs.stage(run.id,'plugin',`Executando ${integration.plugin}.${integration.action}.`);result.outputs.push(await this.plugins.execute(integration,input,{notifications:{publish:(notification)=>this.notifications.publish(integration.plugin,input.userId,notification)}}))}
      if(!result||typeof result.summary!=='string'||!Array.isArray(result.outputs)||result.outputs.length>30||JSON.stringify(result).length>200000)throw new Error('Resultado do executor inválido.');
        if(verifyScope)await verifyScope();
        if(checks.length){await this.runs.stage(run.id,'verification','Executando verificações obrigatórias do projeto.');await runProjectChecks(project.root,checks,90000,input.signal);}
        if(controller.signal.aborted)throw new Error('Execução cancelada.');
        if(verifyScope)await verifyScope();
      }catch(error){
        if(verifyScope){
          if(checks.length){const restored=await verifyScope.rollback();if(restored.length)await this.runs.stage(run.id,'verification','As alterações da execução reprovada foram restauradas.');}
          else await verifyScope();
        }
        throw error;
      }finally{if(activeBridge)await activeBridge.close().catch(()=>console.error('Context Bridge close audit unavailable.'));}
      if(contextRecord)await finalRunContext(this.contextManifests,contextRecord,async()=>{
        const activeCard=await this.card(run.card_id,run.user_id),authorized=await this.projects.get(project.id,run.user_id);
        const currentProject=project.authorizationRoot?{...authorized,root:project.root,resourcesRoot:project.resourcesRoot,authorizationRoot:authorized.root}:authorized;
        const currentConfig=await this.config(run.card_id);
        const observed=await this.context.build(currentProject,currentConfig,activeCard,run.user_id,{workspaceId:activeCard.workspace_id,compilerPolicy:compilerPolicyForManifest(contextRecord.manifest),knowledgePolicy:knowledgePolicyForManifest(contextRecord.manifest)});
        return this.preparedContextManifest(run.id,currentProject,observed,currentConfig,activeCard,run.user_id,checkoutRequest,undefined,contextRecord.manifest);
      });
      await lease.assertActive();
      await captureExecutionDiscoveries({db:this.db,projects:this.projects,record:contextRecord,project,lease,workerId:this.runs.workerId,signal:input.signal,output:result.outputs,authorizeCard:()=>this.card(run.card_id,run.user_id)});
      completedResult=result;
      };
      if(checkoutRequest){
        await validateIsolationRequest({...project,workspace_id:card.workspace_id},checkoutRequest);
        await withIsolatedCheckout(this.db,{queue:'card_runs',authorizedProjectRoot:project.root,runId:run.id,cardId:run.card_id,cardRevision:run.card_revision??null,projectId:project.id,workspaceId:card.workspace_id,request:checkoutRequest,signal:controller.signal,onState:phase=>{
          coordinationWrites=coordinationWrites.then(()=>this.db.query("UPDATE card_runs SET metadata=jsonb_set(metadata,'{write_coordination}',COALESCE(metadata->'write_coordination','{}'::jsonb)||$2::jsonb) WHERE id=$1 AND worker_id=$3",[run.id,JSON.stringify({phase,mode:'isolated'}),this.runs.workerId])).catch(()=>controller.abort(new Error('Persistência da coordenação isolada falhou.')));
        }},async(checkout,lease)=>{
          const original=project;
          project={...original,authorizationRoot:original.root,root:checkout.root,resourcesRoot:resolve(checkout.root,relative(original.root,original.resourcesRoot))};
          context=await this.context.build(project,run.input.config,capturedCard,run.user_id,{workspaceId:card.workspace_id,compilerPolicy:compilerPolicyForManifest(contextRecord?.manifest??null),knowledgePolicy:knowledgePolicyForManifest(contextRecord?.manifest??null)});
          await withIsolatedExecution({runId:run.id,queue:'card_runs',root:checkout.root,baseCommit:checkoutRequest.baseCommit,cardRevision:run.card_revision??null},()=>executeProtected(lease));
        });
      }else{
      await withWorkspaceWriteLease(this.db,{queue:'card_runs',runId:run.id,cardId:run.card_id,projectId:project.id,projectRoot:project.root,workingDirectory:context.workingDirectory,signal:controller.signal,onState:phase=>{
        coordinationWrites=coordinationWrites.then(async()=>{
          await this.db.query("UPDATE card_runs SET metadata=jsonb_set(metadata,'{write_coordination}',COALESCE(metadata->'write_coordination','{}'::jsonb)||$2::jsonb) WHERE id=$1 AND worker_id=$3",[run.id,JSON.stringify({phase,requested_root:project.root}),this.runs.workerId]);
          if(phase==='waiting_workspace'||phase==='active_workspace')await this.runs.stage(run.id,phase,phase==='waiting_workspace'?'Aguardando exclusividade física do workspace.':'Exclusividade física adquirida.');
        }).catch(()=>controller.abort(new Error('Não foi possível persistir a coordenação do workspace.')));
      }},executeProtected);
      }
      await coordinationWrites;
      if(!completedResult)throw new Error('Execução terminou sem resultado protegido.');
      await this.runs.stage(run.id,'result','Persistindo resultado.');
      await this.runs.finish(run,userCancelled()?'cancelled':'success',completedResult);
      if(!controller.signal.aborted)await this.features.notify(run.user_id,card.board_id,run.card_id,'card_execution','Execução concluída',`A execução do cartão “${run.input.card.title}” foi concluída.`);
    }catch(error){
      await this.runs.finish(run,userCancelled()?'cancelled':'failed',undefined,redact((error as Error).message));
      if(!controller.signal.aborted){const card=await this.card(run.card_id,run.user_id).catch(()=>null);if(card)await this.features.notify(run.user_id,card.board_id,run.card_id,'card_execution','Falha na execução',`A execução do cartão “${run.input.card.title}” falhou: ${redact((error as Error).message)}`)}
    }finally{clearInterval(heartbeat);this.controllers.delete(run.id);const row=await this.db.one('SELECT board_id FROM lists WHERE id=(SELECT list_id FROM cards WHERE id=$1)',[run.card_id]);if(row)this.events.boardChanged(row.board_id,'orbit')}
  }
  async tick(){
    if(this.active||this.stopping)return;this.active=true;
    try{
      await this.db.query("UPDATE card_runs SET status='failed',error='Worker interrompido. O workspace pode exigir revisão de quarentena.',finished_at=now() WHERE status='running' AND heartbeat_at<now()-interval '2 minutes'");
      const run=await this.runs.claim();if(run)await this.processRun(run);
    }catch(error){console.error('Execution worker:',redact((error as Error).message))}finally{this.active=false}
  }
}
