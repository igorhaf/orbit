import {Body,Controller,Get,HttpException,Inject,Injectable,OnModuleInit,Param,Post,Req} from '@nestjs/common';
import {writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {AccessService,type AccessRequest} from '../../access/access';
import {PluginRegistry} from '../../execution/registries';
import {coreVersion,inheritedCoreCompatibility} from '../core-compatibility';

/** Publishes a private, secret-free compatibility inventory even in customer instances. */
@Injectable()
export class CoreCompatibilityReport implements OnModuleInit{
 constructor(@Inject(PluginRegistry)private registry:PluginRegistry){}
 report(){return {core:coreVersion,generatedAt:new Date().toISOString(),plugins:this.registry.list().map(p=>({id:p.id,version:p.version,dependencies:p.dependencies||[],coreCompatibility:p.coreCompatibility||inheritedCoreCompatibility}))}}
 async onModuleInit(){const path=process.env.ORBIT_COMPATIBILITY_REPORT||'/data/config/runtime-compatibility.json';try{await mkdir(dirname(path),{recursive:true});await writeFile(path+'.tmp',JSON.stringify(this.report(),null,2),{mode:0o600});await rename(path+'.tmp',path)}catch(error){if(process.env.ORBIT_ENV)throw error;console.warn('Relatório de compatibilidade não persistido neste processo local.',String(error))}}
}
@Injectable()
export class EnvironmentControl{
 constructor(@Inject(AccessService)private access:AccessService,@Inject(PluginRegistry)private plugins:PluginRegistry){}
 async request(user:string,path:string,body?:Record<string,unknown>){if(!this.plugins.isEnabled('environment-management'))throw new HttpException('A gestão de ambientes está desativada.',409);await this.access.require(user,body?'environments.manage':'environments.read');const url=process.env.ORBIT_ENVIRONMENT_CONTROL_URL,token=process.env.ORBIT_ENVIRONMENT_CONTROL_TOKEN;if(!url||!token)throw new HttpException('Configure a conexão com o CONTROL nas configurações do plugin.',409);const target=new URL(url);if(target.protocol!=='http:'&&target.protocol!=='https:')throw new HttpException('Endereço do CONTROL inválido.',409);let response:Response;try{response=await fetch(new URL(path,target),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'X-Orbit-Actor':user,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)})}catch{throw new HttpException('O CONTROL não respondeu. As operações já registradas continuam independentes da aplicação.',503)}const result=await response.json() as Record<string,unknown>;if(!response.ok)throw new HttpException(result,response.status);return result}
}
@Controller('environment-management')
export class EnvironmentManagementController{
 constructor(@Inject(EnvironmentControl)private control:EnvironmentControl,@Inject(CoreCompatibilityReport)private report:CoreCompatibilityReport,@Inject(AccessService)private access:AccessService){}
 private user(req:AccessRequest){if(!req.orbitActor)throw new HttpException('Autenticação necessária.',401);return req.orbitActor}
 @Get()list(@Req()req:AccessRequest){return this.control.request(this.user(req),'/environments')}
 @Get('runtime')async runtime(@Req()req:AccessRequest){await this.access.require(this.user(req),'environments.read');return this.report.report()}
 @Post('plans')plan(@Req()req:AccessRequest,@Body()body:Record<string,unknown>){if(Object.keys(body).some(k=>k!=='target')||typeof body.target!=='string')throw new HttpException('Destino inválido.',400);return this.control.request(this.user(req),'/plans',{target:body.target})}
 @Post('jobs')start(@Req()req:AccessRequest,@Body()body:Record<string,unknown>){if(Object.keys(body).some(k=>!['target','operation','planId'].includes(k))||!['check','update'].includes(String(body.operation))||typeof body.target!=='string')throw new HttpException('Operação inválida.',400);return this.control.request(this.user(req),'/jobs',body)}
 @Post('jobs/:id/recover')recover(@Req()req:AccessRequest,@Param('id')id:string,@Body()body:Record<string,unknown>){if(!/^[0-9a-f-]{36}$/.test(id)||Object.keys(body).some(k=>k!=='acknowledgement')||typeof body.acknowledgement!=='string')throw new HttpException('Confirmação de recuperação inválida.',400);return this.control.request(this.user(req),'/jobs/'+id+'/recover',body)}
 @Get('jobs/:id/log')log(@Req()req:AccessRequest,@Param('id')id:string){if(!/^[0-9a-f-]{36}$/.test(id))throw new HttpException('ID inválido.',400);return this.control.request(this.user(req),'/jobs/'+id+'/log')}
 @Get('jobs/:id')job(@Req()req:AccessRequest,@Param('id')id:string){if(!/^[0-9a-f-]{36}$/.test(id))throw new HttpException('ID inválido.',400);return this.control.request(this.user(req),'/jobs/'+id)}
}
