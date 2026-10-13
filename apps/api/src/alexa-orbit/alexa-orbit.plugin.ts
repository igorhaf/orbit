import {Body,Controller,Get,Inject,Logger,Patch,Post,RawBodyRequest,Req,HttpException,HttpCode} from '@nestjs/common';
import {Request} from 'express';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FeaturesService} from '../features';
import {PluginDefinition} from '../plugins/contract';
import {AlexaOrbitService} from './alexa-orbit.service';
import {AlexaSecurity} from './security';
import {Envelope,PLUGIN_ID} from './model';
export const alexaOrbitPluginDefinition:PluginDefinition={id:PLUGIN_ID,dependencies:['ai'],name:'Alexa · Orbit por voz',version:'1.0.0',scope:'account',configurable:true,description:'Custom Skill privada Orbit: criar tarefas, compras e compromissos.',capabilities:[{id:'voice.create',name:'Criar por voz'}],contributions:{settings:[{id:PLUGIN_ID,label:'Alexa · Orbit',href:'/plugins?configure=alexa-orbit'}]}};
@Controller()
export class AlexaOrbitController{
 private logger=new Logger('AlexaOrbitEndpoint');
 constructor(@Inject(AlexaOrbitService) private plugin:AlexaOrbitService,@Inject(AlexaSecurity) private security:AlexaSecurity,@Inject(FeaturesService) private features:FeaturesService){}
 @Get('plugins/alexa-orbit/configuration') settings(@Req() req:Request){return this.plugin.settings(this.features.user(req))}
 @Patch('plugins/alexa-orbit/configuration') save(@Req() req:Request,@Body() body:unknown){return this.plugin.save(this.features.user(req),body)}
 @Get('plugins/alexa-orbit/health') health(@Req() req:Request){return this.plugin.health(this.features.user(req))}
 @Get('plugins/alexa-orbit/interaction-model') async interactionModel(@Req() req:Request){this.features.user(req);try{return JSON.parse(await readFile(resolve(__dirname,'alexa/pt-BR.json'),'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return JSON.parse(await readFile(resolve(__dirname,'../../src/alexa-orbit/alexa/pt-BR.json'),'utf8'))}}
 @Get('plugins/alexa-orbit/ai-jobs') jobs(@Req() req:Request){return this.plugin.jobs(this.features.user(req))}
 @Get('plugins/alexa-orbit/options') options(@Req() req:Request){return this.plugin.options(this.features.user(req))}
 @Post('plugins/alexa-orbit/simulate') async simulate(@Req() req:Request,@Body() body:Record<string,unknown>){const owner=this.features.user(req);if(!['OrbitMessageIntent','OrbitStatusIntent','AddTaskIntent','AddPurchaseIntent','AddAppointmentIntent'].includes(String(body.intent))||!body.slots||typeof body.slots!=='object'||Array.isArray(body.slots))throw new HttpException('Simulação inválida.',400);const slots=Object.fromEntries(Object.entries(body.slots).map(([key,value])=>{if(typeof value!=='string'||value.length>2000)throw new HttpException('Slot inválido.',400);return [key,{name:key,value}]}));const envelope:Envelope={request:{type:'IntentRequest',requestId:typeof body.requestId==='string'&&body.requestId.length<=300?`local:${body.requestId}`:`local:${randomUUID()}`,timestamp:new Date().toISOString(),intent:{name:String(body.intent),slots}}};return this.plugin.simulate(owner,envelope)}
 @Post('integrations/alexa/orbit') @HttpCode(200) async voice(@Req() req:RawBodyRequest<Request>){const deadline=Date.now()+6000;if(!this.plugin.enabled())throw new HttpException('Plugin desativado.',404);let current;try{current=await this.plugin.resolved()}catch{throw new HttpException('Configuração indisponível.',400)}if(!current)throw new HttpException('Configure a skill no Orbit.',400);this.logger.log('alexa_request_received');let envelope:Envelope;try{envelope=await this.security.verify(req.rawBody,req.headers,current.config)}catch{this.logger.warn('alexa_request_rejected');throw new HttpException('Requisição Alexa inválida.',400)}this.logger.log(JSON.stringify({event:'alexa_request_verified',requestType:envelope.request.type,intent:envelope.request.intent?.name,requestId:envelope.request.requestId}));return this.plugin.handle(current.owner,current.config,envelope,deadline)}
}
