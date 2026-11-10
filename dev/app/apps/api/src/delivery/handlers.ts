import {Inject,Injectable} from '@nestjs/common';
import {Db} from '../db';
import {branchName} from '../git/rules';
import {CommandExecutorRegistry} from './executors';
import {StepHandlerRegistry,StepResult,StepServices} from './contracts';
import {DeliveryGitService} from './git-service';

type Strategy={id:string;run:(config:Record<string,unknown>,services:StepServices)=>Promise<StepResult>};
export class DeploymentStrategyRegistry {
  private items=new Map<string,Strategy>();
  register(strategy:Strategy){if(this.items.has(strategy.id))throw new Error('Strategy duplicada.');this.items.set(strategy.id,strategy)}
  get(id:string){const item=this.items.get(id);if(!item)throw new Error(`Deploy strategy não registrada: ${id}`);return item}
  list(){return [...this.items.keys()]}
}
export class PromotionStrategyRegistry {
  private items=new Map<string,Strategy>();
  register(strategy:Strategy){if(this.items.has(strategy.id))throw new Error('Strategy duplicada.');this.items.set(strategy.id,strategy)}
  get(id:string){const item=this.items.get(id);if(!item)throw new Error(`Promotion strategy não registrada: ${id}`);return item}
  list(){return [...this.items.keys()]}
}

type DeployTarget={id:string;name:string;project_id:string;environment_id:string;executor_type:string;server_id:string|null;repository_id:string|null;working_directory:string;git_remote_id:string|null;git_branch:string|null;build_commands:string[];restart_command:string|null};
@Injectable()
export class DeliveryHandlers {
  constructor(@Inject(Db) private db:Db,@Inject(CommandExecutorRegistry) private executors:CommandExecutorRegistry,@Inject(DeliveryGitService) private git:DeliveryGitService){}
  private async projectPath(projectId:string,userId:string){const row=await this.db.one<{local_path:string}>('SELECT local_path FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]);if(!row)throw new Error('Projeto não autorizado.');return row.local_path}
  private async command(config:Record<string,unknown>,services:StepServices){
    const executor=this.executors.get(typeof config.executor==='string'?config.executor:'local');
    const output=await executor.execute({userId:services.userId,projectRoot:await this.projectPath(services.projectId,services.userId),serverId:typeof config.serverId==='string'?config.serverId:undefined,cwd:typeof config.workingDirectory==='string'?config.workingDirectory:'.',command:String(config.command),env:config.environmentVariables as Record<string,string>|undefined,timeoutMs:services.timeoutMs});
    if(!output.success)throw new Error(output.stderr||`Comando retornou ${output.exitCode}.`);
    return {exitCode:output.exitCode,stdout:output.stdout,stderr:output.stderr,outputs:{exitCode:output.exitCode}};
  }
  async gitDeploy(config:Record<string,unknown>,services:StepServices){
    const target=await this.db.one<DeployTarget>('SELECT t.* FROM delivery_targets t JOIN delivery_environments e ON e.id=t.environment_id JOIN ai_projects p ON p.id=t.project_id WHERE t.id=$1 AND t.project_id=$2 AND e.project_id=t.project_id AND p.owner_id=$3',[config.deployTargetId,services.projectId,services.userId]);
    if(!target||target.environment_id!==config.environmentId||!target.repository_id||!target.git_remote_id)throw new Error('Deploy target Git inválido ou não autorizado.');
    const branch=branchName(config.branch??target.git_branch),executor=target.executor_type;
    const common={repositoryId:target.repository_id,remoteId:target.git_remote_id,branch,executor,serverId:target.server_id,workingDirectory:target.working_directory};
    const lock=await this.db.one('INSERT INTO delivery_target_locks(target_id,run_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING target_id',[target.id,services.runId]);
    if(!lock)throw new Error('Deploy target ocupado por outra execução.');
    try{
      await this.git.operation('git.fetch',common,services);
      await this.git.operation('git.checkout',common,services);
      await this.git.operation('git.pull',common,services);
      for(const command of target.build_commands){await this.command({executor,serverId:target.server_id,workingDirectory:target.working_directory,command},services)}
      if(target.restart_command)await this.command({executor,serverId:target.server_id,workingDirectory:target.working_directory,command:target.restart_command},services);
      const log=await this.git.operation('git.log',common,services);const revision=String(log.outputs?.output||'').split(' ')[0];
      if(config.revision&&config.revision!==revision)throw new Error('A revisão implantada não corresponde à solicitada.');
      return {outputs:{deployTargetId:target.id,environmentId:target.environment_id,branch,revision},stdout:`Deploy ${target.name} concluído em ${revision}.`};
    }finally{await this.db.query('DELETE FROM delivery_target_locks WHERE target_id=$1 AND run_id=$2',[target.id,services.runId])}
  }
  async gitPromotion(config:Record<string,unknown>,services:StepServices){
    const source=branchName(config.source),target=branchName(config.target);
    if(source===target)throw new Error('Promotion exige branches distintas.');
    const common={repositoryId:config.repositoryId,remoteId:config.remoteId,executor:config.executor,serverId:config.serverId,workingDirectory:config.workingDirectory};
    await this.git.operation('git.fetch',{...common,branch:source},services);
    await this.git.operation('git.checkout',{...common,branch:target},services);
    await this.git.operation('git.merge',{...common,source},services);
    await this.git.operation('git.push',{...common,branch:target},services);
    const log=await this.git.operation('git.log',common,services);
    const targetRevision=String(log.outputs?.output||'').split(' ')[0];
    return {outputs:{source,target,targetRevision},stdout:`Promotion ${source} → ${target}: ${targetRevision}`};
  }
  register(steps:StepHandlerRegistry,deployments:DeploymentStrategyRegistry,promotions:PromotionStrategyRegistry){
    deployments.register({id:'git',run:(config,services)=>this.gitDeploy(config,services)});
    promotions.register({id:'git.merge',run:(config,services)=>this.gitPromotion(config,services)});
    const string={type:'string',minLength:1,maxLength:1000};
    const base=(required:string[],properties:Record<string,unknown>)=>({type:'object',required,properties,additionalProperties:false});
    for(const type of ['git.add','git.commit','git.push','git.fetch','git.checkout','git.pull','git.merge']){
      const extra=type==='git.add'?{paths:{type:'array',items:string,minItems:1}}:type==='git.commit'?{message:string}:type==='git.merge'?{source:string}:type==='git.checkout'?{branch:string}:{remoteId:string,branch:string};
      const required=['repositoryId',...type==='git.add'?['paths']:type==='git.commit'?['message']:type==='git.merge'?['source']:type==='git.checkout'?['branch']:['remoteId','branch']];
      steps.register({type,category:'git',schema:base(required,{repositoryId:string,executor:{enum:['local','ssh']},serverId:string,workingDirectory:string,...extra}),run:(config,services)=>this.git.operation(type,config,services)});
    }
    const commandSchema=base(['command'],{command:string,executor:{enum:['local','ssh']},serverId:string,workingDirectory:string,environmentVariables:{type:'object',additionalProperties:{type:'string',maxLength:2000}}});
    steps.register({type:'command.execute',category:'command',schema:commandSchema,run:(config,services)=>this.command(config,services)});
    steps.register({type:'test.run',category:'test',schema:commandSchema,run:(config,services)=>this.command(config,services)});
    steps.register({type:'approval.wait',category:'approval',schema:base(['message'],{message:string,allowedUserIds:{type:'array',items:string}}),run:async()=>({status:'waiting'})});
    steps.register({type:'deploy.execute',category:'deployment',schema:base(['environmentId','deployTargetId','strategy'],{environmentId:string,deployTargetId:string,strategy:string,branch:string,revision:string}),run:(config,services)=>deployments.get(String(config.strategy)).run(config,services)});
    steps.register({type:'promotion.execute',category:'promotion',schema:base(['strategy','repositoryId','remoteId','source','target'],{strategy:string,repositoryId:string,remoteId:string,source:string,target:string,executor:{enum:['local','ssh']},serverId:string,workingDirectory:string}),run:(config,services)=>promotions.get(String(config.strategy)).run(config,services)});
  }
}
