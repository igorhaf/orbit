import {ArgumentsHost,Body,Catch,Controller,Delete,ExceptionFilter,Get,HttpException,Inject,Param,Patch,Post,Put,Req,UseFilters} from '@nestjs/common';
import {Request,Response} from 'express';
import {FeaturesService} from '../features';
import {redact} from '../execution/security';
import {PluginDefinition} from '../plugins/contract';
import {DeliveryManagement,record} from './management';
import {DeliveryRunner} from './runner';
import {SshCommandExecutor} from './executors';
import {DeliveryGitService} from './git-service';

@Catch(Error)
class DeliveryFilter implements ExceptionFilter {
  catch(error:Error,host:ArgumentsHost){const response=host.switchToHttp().getResponse<Response>();const code=error instanceof HttpException?error.getStatus():400;response.status(code).json({message:redact(error.message).slice(0,1000)})}
}

@UseFilters(DeliveryFilter)
@Controller('delivery')
export class DeliveryController {
  constructor(@Inject(FeaturesService) private features:FeaturesService,@Inject(DeliveryManagement) private management:DeliveryManagement,@Inject(DeliveryRunner) private runner:DeliveryRunner,@Inject(DeliveryGitService) private git:DeliveryGitService){}
  private user(req:Request){return this.features.user(req)}
  @Get('catalog') catalog(@Req() req:Request){return this.management.catalog(this.user(req))}
  @Post('bypass-permission') bypassPermission(@Req() req:Request,@Body() body:Record<string,unknown>){return this.management.setBypass(this.user(req),body.enabled===true)}
  @Get('projects/:id') config(@Req() req:Request,@Param('id') id:string){return this.management.config(id,this.user(req))}
  @Post('credentials') credential(@Req() req:Request,@Body() body:Record<string,unknown>){return this.management.credential(this.user(req),record(body))}
  @Post('servers') server(@Req() req:Request,@Body() body:Record<string,unknown>){return this.management.server(this.user(req),record(body))}
  @Post('servers/:id/test') testServer(@Req() req:Request,@Param('id') id:string){return this.management.testServer(this.user(req),id)}
  @Post('repositories/:id/remotes') remote(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){return this.management.remote(this.user(req),id,record(body))}
  @Post('repositories/:id/operations') gitOperation(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){const input=record(body);return this.git.direct(this.user(req),id,String(input.type),record(input.config??{}))}
  @Post('projects/:id/environments') environment(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){return this.management.environment(this.user(req),id,record(body))}
  @Post('projects/:id/targets') target(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){return this.management.target(this.user(req),id,record(body))}
  @Post('projects/:id/pipelines') pipeline(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){return this.management.createPipeline(this.user(req),id,record(body))}
  @Patch('pipelines/:id') updatePipeline(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){return this.management.updatePipeline(this.user(req),id,record(body))}
  @Get('pipelines/:id/steps') steps(@Req() req:Request,@Param('id') id:string){return this.management.steps(this.user(req),id)}
  @Put('pipelines/:id/steps') replaceSteps(@Req() req:Request,@Param('id') id:string,@Body() body:{steps:unknown}){return this.management.replaceSteps(this.user(req),id,body.steps)}
  @Post('pipelines/:id/runs') run(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){return this.runner.start(this.user(req),id,record(body))}
  @Get('projects/:id/runs') runs(@Req() req:Request,@Param('id') id:string){return this.runner.list(this.user(req),id)}
  @Get('runs/:id') detail(@Req() req:Request,@Param('id') id:string){return this.runner.detail(this.user(req),id)}
  @Post('runs/:id/approve') approve(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){return this.runner.decision(this.user(req),id,true,body?.comment)}
  @Post('runs/:id/reject') reject(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){return this.runner.decision(this.user(req),id,false,body?.comment)}
  @Post('runs/:id/cancel') cancel(@Req() req:Request,@Param('id') id:string){return this.runner.cancel(this.user(req),id)}
  @Delete('pipelines/:id') disable(@Req() req:Request,@Param('id') id:string){return this.management.updatePipeline(this.user(req),id,{enabled:false})}
}

export const sshPluginDefinition=(ssh:SshCommandExecutor):PluginDefinition=>({id:'ssh',name:'SSH',version:'1.0.0',scope:'account',capabilities:[{id:'connection.test',name:'Testar conexão SSH',permissions:['process.execute']},{id:'command.execute',name:'Executar comando SSH',permissions:['process.execute']}],actions:[{id:'test',name:'Testar servidor',requiredCapabilities:['connection.test'],inputSchema:{type:'object',required:['serverId'],properties:{serverId:{type:'string'}},additionalProperties:false},async execute(input,context){if(!context.userId)throw new Error('Usuário obrigatório.');return {type:'ssh',label:'Conexão',value:await ssh.test(String(input.serverId),context.userId)}}},{id:'execute',name:'Executar comando remoto',requiredCapabilities:['command.execute'],inputSchema:{type:'object',required:['serverId','command','workingDirectory'],properties:{serverId:{type:'string'},command:{type:'string'},workingDirectory:{type:'string'}},additionalProperties:false},async execute(input,context){if(!context.userId)throw new Error('Usuário obrigatório.');return {type:'ssh',label:'Resultado SSH',value:await ssh.execute({serverId:String(input.serverId),userId:context.userId,cwd:String(input.workingDirectory),command:String(input.command),timeoutMs:60000})}}}]});
export const deliveryPluginDefinition=(runner:DeliveryRunner):PluginDefinition=>({id:'delivery',name:'Delivery Pipelines',version:'1.0.0',scope:'account',capabilities:[{id:'pipeline.run',name:'Executar Delivery Pipeline',permissions:['process.execute']}],actions:[{id:'run',name:'Executar pipeline do card',requiredCapabilities:['pipeline.run'],inputSchema:{type:'object',required:['pipelineId'],properties:{pipelineId:{type:'string'}},additionalProperties:false},async execute(input,context){if(!context.userId||!context.cardId)throw new Error('Card e usuário obrigatórios.');return {type:'delivery',label:'Pipeline iniciado',value:await runner.start(context.userId,String(input.pipelineId),{cardId:context.cardId,mode:'normal'})}}}]});
