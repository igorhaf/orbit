import {Inject,Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {PoolClient} from 'pg';
import {Db} from '../db';
import {branchName} from '../git/rules';
import {Step,StepHandlerRegistry,RunContext,RunMode,BypassOptions,PipelineExecutionPolicyService,requiredOutputs,resolveReference} from './contracts';
import {DeliveryCredentialService,SshCommandExecutor} from './executors';
import {DeliveryGitService} from './git-service';
import {DeliveryManagement,noInlineSecrets,record,uid} from './management';
import {DeploymentStrategyRegistry,PromotionStrategyRegistry} from './handlers';

type DeliveryRun={id:string;pipeline_id:string;project_id:string;card_id:string|null;triggered_by:string;trigger_type:string;trigger_key:string|null;mode:RunMode;status:string;context:RunContext;bypass_options:BypassOptions;bypass_reason:string|null;current_step_id:string|null};
const bounded=(value:unknown)=>typeof value==='string'?value.slice(0,64000):'';

@Injectable()
export class DeliveryRunner {
  private policy=new PipelineExecutionPolicyService();
  constructor(@Inject(Db) private db:Db,@Inject(DeliveryManagement) private management:DeliveryManagement,@Inject(StepHandlerRegistry) private handlers:StepHandlerRegistry,@Inject(DeploymentStrategyRegistry) private deployments:DeploymentStrategyRegistry,@Inject(PromotionStrategyRegistry) private promotions:PromotionStrategyRegistry,@Inject(DeliveryGitService) private git:DeliveryGitService,@Inject(SshCommandExecutor) private ssh:SshCommandExecutor,@Inject(DeliveryCredentialService) private credentials:DeliveryCredentialService){}
  private async audit(runId:string,stepId:string|null,actorId:string,event:string,details:Record<string,unknown>={},client?:PoolClient){const sql='INSERT INTO delivery_audit(run_id,step_id,actor_id,event,details) VALUES($1,$2,$3,$4,$5::jsonb)',params=[runId,stepId,actorId,event,JSON.stringify(details)];if(client)await client.query(sql,params);else await this.db.query(sql,params)}
  private async sanitize(userId:string,value:unknown):Promise<unknown>{if(typeof value==='string')return this.credentials.redact(userId,value);if(Array.isArray(value))return Promise.all(value.map(item=>this.sanitize(userId,item)));if(value&&typeof value==='object'){const entries=await Promise.all(Object.entries(value).map(async([key,item])=>[key,/(?:password|secret|token|privateKey)/i.test(key)?'[REDACTED]':await this.sanitize(userId,item)] as const));return Object.fromEntries(entries)}return value}
  private async steps(pipelineId:string){return this.db.query<Step>('SELECT * FROM delivery_steps WHERE pipeline_id=$1 ORDER BY position',[pipelineId])}
  private async preflight(step:Step,userId:string,projectId:string){
    this.handlers.validate(step);const config=step.config;
    if(step.type.startsWith('git.')){
      const repository=await this.git.repository(uid(config.repositoryId),userId,projectId);
      if(config.remoteId)await this.git.remote(uid(config.remoteId),repository.id);
      for(const branch of [config.branch,config.source,config.target])if(branch!==undefined&&!repository.branches.includes(branchName(branch)))throw new Error(`Branch fora da configuração em ${step.name}.`);
    }
    if(step.type==='promotion.execute'){
      this.promotions.get(String(config.strategy));const repository=await this.git.repository(uid(config.repositoryId),userId,projectId);await this.git.remote(uid(config.remoteId),repository.id);for(const branch of [config.source,config.target])if(!repository.branches.includes(branchName(branch)))throw new Error('Branch de promotion fora do repositório.');
    }
    if(step.type==='deploy.execute'){
      this.deployments.get(String(config.strategy));const target=await this.db.one<{environment_id:string;server_id:string|null;repository_id:string|null;git_remote_id:string|null;git_branch:string|null}>('SELECT t.environment_id,t.server_id,t.repository_id,t.git_remote_id,t.git_branch FROM delivery_targets t JOIN ai_projects p ON p.id=t.project_id WHERE t.id=$1 AND t.project_id=$2 AND p.owner_id=$3',[uid(config.deployTargetId),projectId,userId]);if(!target||target.environment_id!==config.environmentId)throw new Error('Deploy target inválido.');if(target.server_id)await this.ssh.server(target.server_id,userId);if(config.strategy==='git'){if(!target.repository_id||!target.git_remote_id)throw new Error('Deploy Git exige repositório e remote.');const repository=await this.git.repository(target.repository_id,userId,projectId);await this.git.remote(target.git_remote_id,repository.id);const branch=config.branch??target.git_branch;if(!repository.branches.includes(branchName(branch)))throw new Error('Branch de deploy fora do repositório.')}}
    if((step.type==='command.execute'||step.type==='test.run'||step.type.startsWith('git.')||step.type==='promotion.execute')&&config.executor==='ssh'){
      await this.ssh.server(uid(config.serverId),userId);
      if(typeof config.workingDirectory!=='string'||!config.workingDirectory.startsWith('/'))throw new Error('Executor SSH exige pasta absoluta.');
    }
  }
  async start(userId:string,pipelineId:string,input:Record<string,unknown>){
    const pipeline=await this.management.pipeline(pipelineId,userId);if(!pipeline.enabled)throw new Error('Pipeline desativado.');
    if(input.mode!==undefined&&!['normal','bypass'].includes(String(input.mode)))throw new Error('Modo inválido.');
    const mode:RunMode=input.mode==='bypass'?'bypass':'normal',options=input.bypassOptions===undefined?{}:record(input.bypassOptions) as BypassOptions;
    for(const [key,value] of Object.entries(options)){if(!['allWorkflowPolicies','approvals','tests','promotions','deployments','gates','steps'].includes(key)||key==='steps'&&(!Array.isArray(value)||value.some(item=>typeof item!=='string'||!uid(item)))||key!=='steps'&&typeof value!=='boolean')throw new Error('Opção de bypass inválida.');}
    if(mode==='bypass'&&pipeline.execution_policy.bypassEnabled===false)throw new Error('Bypass desativado neste pipeline.');
    noInlineSecrets(input.reason);
    this.policy.validate(mode,input.reason,options,await this.management.canBypass(userId));
    if(mode==='bypass'&&await this.credentials.redact(userId,String(input.reason))!==String(input.reason))throw new Error('Motivo do bypass contém segredo.');
    const steps=await this.steps(pipelineId);if(!steps.length)throw new Error('Pipeline sem steps.');
    for(const step of steps)await this.preflight(step,userId,pipeline.project_id);
    const contextInput=input.context===undefined?{}:record(input.context);noInlineSecrets(contextInput);
    const context:RunContext={values:contextInput,steps:{}};
    const bypassed=new Set<string>();const canBypass=await this.management.canBypass(userId);
    for(const step of steps)if(this.policy.decide(step,this.handlers.get(step.type).category,mode,options,canBypass)==='bypass')bypassed.add(step.id);
    const positions=new Map(steps.map((step,index)=>[step.id,index]));
    for(const step of steps)for(const requirement of step.requires)if(requirement.startsWith('steps.')){const producer=requirement.split('.')[1];if(!positions.has(producer)||positions.get(producer)!>=step.position)throw new Error(`Dependência inválida em ${step.name}: ${requirement}`)}
    requiredOutputs(steps,context,bypassed);
    const cardId=input.cardId?uid(input.cardId):null;if(cardId){const card=await this.db.one<{project_id:string}>('SELECT COALESCE(c.ai_project_id,b.ai_default_project_id) AS project_id FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE c.id=$1 AND b.owner_id=$2',[cardId,userId]);if(!card||card.project_id!==pipeline.project_id)throw new Error('Card não pertence ao projeto.');}
    if(input.triggerType!==undefined&&!['manual','card.completed'].includes(String(input.triggerType)))throw new Error('Trigger inválido.');
    const trigger=input.triggerType==='card.completed'?'card.completed':'manual';if(trigger==='card.completed'&&pipeline.trigger_type!=='card.completed')throw new Error('Trigger não configurado.');
    const triggerKey=trigger==='card.completed'?input.triggerKey?uid(input.triggerKey):randomUUID():null;
    const client=await this.db.pool.connect();let run:DeliveryRun|null=null;
    try{
      await client.query('BEGIN');
      run=(await client.query<DeliveryRun>('INSERT INTO delivery_runs(pipeline_id,project_id,card_id,triggered_by,trigger_type,trigger_key,mode,status,context,bypass_options,bypass_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11) ON CONFLICT DO NOTHING RETURNING *',[pipelineId,pipeline.project_id,cardId,userId,trigger,triggerKey,mode,'queued',JSON.stringify(context),JSON.stringify(options),mode==='bypass'?String(input.reason).trim():null])).rows[0]||null;
      if(!run&&triggerKey){run=(await client.query<DeliveryRun>('SELECT * FROM delivery_runs WHERE pipeline_id=$1 AND trigger_key=$2',[pipelineId,triggerKey])).rows[0]||null;if(run){await client.query('COMMIT');return run}}
      if(!run)throw new Error('Execução duplicada.');
      for(const step of steps)await client.query('INSERT INTO delivery_step_runs(run_id,step_id,step_snapshot,status) VALUES($1,$2,$3::jsonb,$4)',[run.id,step.id,JSON.stringify(step),'pending']);
      await this.audit(run.id,null,userId,'pipeline.started',{mode,trigger,cardId,reason:run.bypass_reason},client);
      if(mode==='bypass')await this.audit(run.id,null,userId,'pipeline.bypass.started',{options,reason:run.bypass_reason,bypassedSteps:[...bypassed]},client);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    void this.execute(run.id).catch(()=>undefined);return run;
  }
  async execute(runId:string){
    const run=await this.db.one<DeliveryRun>("UPDATE delivery_runs SET status='running' WHERE id=$1 AND status='queued' RETURNING *",[runId]);if(!run)return;
    try{await this.executeClaimed(run)}catch(error){const message=await this.credentials.redact(run.triggered_by,(error as Error).message);await this.db.query("UPDATE delivery_runs SET status='failed',error=$2,finished_at=now() WHERE id=$1 AND status='running'",[run.id,message]);await this.audit(run.id,null,run.triggered_by,'pipeline.failed',{error:message})}
  }
  private async executeClaimed(run:DeliveryRun){
    const steps=await this.steps(run.pipeline_id),canBypass=await this.management.canBypass(run.triggered_by);let context=run.context;
    for(const step of steps){
      const previous=await this.db.one<{status:string}>('SELECT status FROM delivery_step_runs WHERE run_id=$1 AND step_id=$2',[run.id,step.id]);if(!previous||['success','bypassed','skipped'].includes(previous.status))continue;
      const handler=this.handlers.get(step.type);
      try{
        const decision=this.policy.decide(step,handler.category,run.mode,run.bypass_options,canBypass);
        if(decision==='bypass'){await this.db.query("UPDATE delivery_step_runs SET status='bypassed',started_at=now(),finished_at=now(),metadata=$3::jsonb WHERE run_id=$1 AND step_id=$2",[run.id,step.id,JSON.stringify({reason:run.bypass_reason,by:run.triggered_by,policy:step.bypass_policy})]);await this.audit(run.id,step.id,run.triggered_by,'step.bypassed',{reason:run.bypass_reason});if(step.type==='approval.wait')await this.audit(run.id,step.id,run.triggered_by,'approval.bypassed',{reason:run.bypass_reason});continue}
        for(const requirement of step.requires)if(resolveReference(context,requirement)===undefined)throw new Error(`Output obrigatório ausente: ${requirement}`);
        await this.db.query("UPDATE delivery_runs SET current_step_id=$2 WHERE id=$1",[run.id,step.id]);
        await this.db.query("UPDATE delivery_step_runs SET status='running',started_at=now() WHERE run_id=$1 AND step_id=$2",[run.id,step.id]);await this.audit(run.id,step.id,run.triggered_by,'step.started');
        if(step.type==='deploy.execute')await this.audit(run.id,step.id,run.triggered_by,'deployment.started');if(step.type==='promotion.execute')await this.audit(run.id,step.id,run.triggered_by,'promotion.started');
        let output;let attempt=0;
        while(true){attempt++;try{output=await handler.run(step.config,{userId:run.triggered_by,projectId:run.project_id,cardId:run.card_id,runId:run.id,context,timeoutMs:step.timeout_ms});break}catch(error){if(step.failure_policy==='retry'&&attempt<step.max_attempts){await this.db.query('UPDATE delivery_step_runs SET attempt=$3 WHERE run_id=$1 AND step_id=$2',[run.id,step.id,attempt+1]);if(step.retry_delay_ms)await new Promise(resolve=>setTimeout(resolve,step.retry_delay_ms));continue}throw error}}
        if(output.status==='waiting'){
          const client=await this.db.pool.connect();try{await client.query('BEGIN');await client.query("UPDATE delivery_step_runs SET status='waiting' WHERE run_id=$1 AND step_id=$2",[run.id,step.id]);await client.query('INSERT INTO delivery_approvals(run_id,step_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[run.id,step.id]);await client.query("UPDATE delivery_runs SET status='waiting_approval' WHERE id=$1",[run.id]);await this.audit(run.id,step.id,run.triggered_by,'approval.requested',{},client);await client.query('COMMIT')}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return;
        }
        const safe=await this.sanitize(run.triggered_by,output) as typeof output;const outputs=safe.outputs||{};context={values:context.values,steps:{...context.steps,[step.id]:outputs}};
        const client=await this.db.pool.connect();try{await client.query('BEGIN');await client.query("UPDATE delivery_step_runs SET status='success',finished_at=now(),exit_code=$3,stdout=$4,stderr=$5,outputs=$6::jsonb,attempt=$7 WHERE run_id=$1 AND step_id=$2",[run.id,step.id,safe.exitCode??0,bounded(safe.stdout),bounded(safe.stderr),JSON.stringify(outputs),attempt]);await client.query('UPDATE delivery_runs SET context=$2::jsonb WHERE id=$1',[run.id,JSON.stringify(context)]);await this.audit(run.id,step.id,run.triggered_by,'step.completed',{},client);if(step.type==='deploy.execute')await this.audit(run.id,step.id,run.triggered_by,'deployment.completed',{},client);if(step.type==='promotion.execute')await this.audit(run.id,step.id,run.triggered_by,'promotion.completed',{},client);await client.query('COMMIT')}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
      }catch(error){const message=await this.credentials.redact(run.triggered_by,(error as Error).message);await this.db.query("UPDATE delivery_step_runs SET status='failed',finished_at=now(),error=$3 WHERE run_id=$1 AND step_id=$2",[run.id,step.id,message]);await this.audit(run.id,step.id,run.triggered_by,'step.failed',{error:message});if(step.failure_policy==='continue')continue;await this.db.query("UPDATE delivery_runs SET status='failed',error=$2,finished_at=now() WHERE id=$1",[run.id,message]);await this.audit(run.id,null,run.triggered_by,'pipeline.failed',{error:message});return}
    }
    await this.db.query("UPDATE delivery_runs SET status='success',current_step_id=NULL,finished_at=now() WHERE id=$1",[run.id]);await this.audit(run.id,null,run.triggered_by,'pipeline.completed');
  }
  async decision(userId:string,runId:string,approve:boolean,comment:unknown){
    const client=await this.db.pool.connect();
    try{await client.query('BEGIN');const run=(await client.query<DeliveryRun>('SELECT r.* FROM delivery_runs r JOIN delivery_pipelines p ON p.id=r.pipeline_id WHERE r.id=$1 AND p.owner_id=$2 FOR UPDATE',[uid(runId),userId])).rows[0];if(!run||run.status!=='waiting_approval'||!run.current_step_id)throw new Error('Aprovação indisponível.');const current=run.current_step_id;const step=(await client.query<Step>('SELECT * FROM delivery_steps WHERE id=$1',[current])).rows[0];if(!step)throw new Error('Step de aprovação ausente.');const allowed=step.config.allowedUserIds;if(Array.isArray(allowed)&&allowed.length&&!allowed.includes(userId))throw new Error('Usuário não autorizado a aprovar.');const note=typeof comment==='string'?await this.credentials.redact(userId,comment.slice(0,1000)):null;await client.query(`UPDATE delivery_approvals SET ${approve?'approved_at':'rejected_at'}=now(),${approve?'approved_by':'rejected_by'}=$3,comment=$4 WHERE run_id=$1 AND step_id=$2`,[runId,current,userId,note]);await client.query("UPDATE delivery_step_runs SET status=$3,finished_at=now() WHERE run_id=$1 AND step_id=$2",[runId,current,approve?'success':'rejected']);await client.query("UPDATE delivery_runs SET status=$2::varchar,finished_at=CASE WHEN $2::varchar='rejected' THEN now() ELSE NULL END WHERE id=$1",[runId,approve?'queued':'rejected']);await this.audit(runId,current,userId,approve?'approval.approved':'approval.rejected',{comment:note},client);await client.query('COMMIT');if(approve)void this.execute(runId).catch(()=>undefined);return {status:approve?'queued':'rejected'}
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  async detail(userId:string,runId:string){const run=await this.db.one<DeliveryRun>('SELECT r.* FROM delivery_runs r JOIN delivery_pipelines p ON p.id=r.pipeline_id WHERE r.id=$1 AND p.owner_id=$2',[uid(runId),userId]);if(!run)throw new Error('Execução não autorizada.');const [steps,approvals,audit]=await Promise.all([this.db.query('SELECT id,step_id,step_snapshot,status,attempt,started_at,finished_at,exit_code,stdout,stderr,error,outputs,metadata FROM delivery_step_runs WHERE run_id=$1 ORDER BY (step_snapshot->>\'position\')::int',[runId]),this.db.query('SELECT step_id,requested_at,approved_at,rejected_at,approved_by,rejected_by,comment FROM delivery_approvals WHERE run_id=$1',[runId]),this.db.query('SELECT step_id,actor_id,event,details,created_at FROM delivery_audit WHERE run_id=$1 ORDER BY id',[runId])]);return {...run,steps,approvals,audit}}
  async list(userId:string,projectId:string){await this.management.project(projectId,userId);return this.db.query('SELECT r.id,r.pipeline_id,p.name AS pipeline_name,r.card_id,r.trigger_type,r.mode,r.status,r.bypass_reason,r.current_step_id,r.triggered_by,r.started_at,r.finished_at FROM delivery_runs r JOIN delivery_pipelines p ON p.id=r.pipeline_id WHERE r.project_id=$1 AND p.owner_id=$2 ORDER BY r.created_at DESC LIMIT 100',[projectId,userId])}
  async cancel(userId:string,runId:string){const row=await this.db.one('UPDATE delivery_runs SET status=$3,finished_at=now() WHERE id=$1 AND triggered_by=$2 AND status IN (\'queued\',\'waiting_approval\') RETURNING id',[uid(runId),userId,'cancelled']);if(!row)throw new Error('Execução não pode ser cancelada neste estado.');await this.audit(runId,null,userId,'pipeline.cancelled');return {status:'cancelled'}}
  async recoverQueued(){const queued=await this.db.query<{id:string}>('SELECT id FROM delivery_runs WHERE status=$1 ORDER BY created_at LIMIT 100',['queued']);for(const run of queued)void this.execute(run.id).catch(()=>undefined)}
}
