import {Body,Controller,Get,Patch,Param,Req,Inject,Injectable,HttpException} from '@nestjs/common';
import type {Request} from 'express';
import {Db} from '../db';
import {FeaturesService} from '../features';
import {PluginRegistry} from '../execution/registries';
import {AccessService} from '../access/access';
import {cardLayoutValues,childCardLayoutData} from './card-layout-values';
@Injectable()
export class CardLayoutsService {
 constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(PluginRegistry) private registry:PluginRegistry){}
 async get(card:string,user:string){await this.features.cardBoard(card,user);if(await this.db.one('SELECT card_id FROM vault_items WHERE card_id=$1',[card]))throw new HttpException('Itens do cofre não possuem plugins de IA.',409);const stored=await this.db.one<{plugin_ids:string[];data:Record<string,Record<string,string>>;card_type_id:string|null}>('SELECT plugin_ids,data,card_type_id FROM card_plugin_layouts WHERE card_id=$1',[card]);const typeOwner=this.registry.list().find(plugin=>plugin.contributions?.cardTypes?.some(type=>type.id===stored?.card_type_id));const typeContribution=typeOwner?.contributions?.cardTypes?.find(type=>type.id===stored?.card_type_id);let typePlugins:string[]=[];if(typeOwner){try{typePlugins=this.registry.isEnabled(typeOwner.id)?this.registry.selection([typeOwner.id]):[typeOwner.id]}catch{typePlugins=[typeOwner.id]}}const typePlugin=typeOwner?.id||null;const selected=[...new Set([...(stored?.plugin_ids||[]),...typePlugins])];
 const available=this.registry.catalog().filter(plugin=>plugin.contributions.cardLayouts?.length);
 const values=cardLayoutValues(this.registry.list(),selected,stored?.data);
 return {...values,selected,primaryPluginId:typePlugin,typeId:stored?.card_type_id||null,available,data:stored?.data||{},slots:[...new Set([...(this.registry.isEnabled(typeOwner?.id||'')?typeContribution?.slots||[]:[]),...available.filter(plugin=>selected.includes(plugin.id)&&plugin.enabled).flatMap(plugin=>plugin.contributions.cardLayouts!.flatMap(layout=>layout.slots))])].filter(slot=>!values.executionBlocked||!['ai.controls','ai.prompt','ai.execution','ai.comments','development.git'].includes(slot))};}
 async fields(card:string,user:string,pluginId:string,body:Record<string,unknown>){const current=await this.get(card,user);if(!current.selected.includes(pluginId)||!this.registry.isEnabled(pluginId))throw new HttpException('Plugin não disponível neste cartão.',409);
 const fields=this.registry.getById(pluginId).contributions?.cardLayouts?.flatMap(layout=>layout.fields||[])||[];
 if(Object.keys(body).some(key=>!fields.some(field=>field.key===key))||Object.entries(body).some(([key,value])=>typeof value!=='string'||value.length>(fields.find(field=>field.key===key)?.maxLength||20000)||(fields.find(field=>field.key===key)?.type==='select'&&!fields.find(field=>field.key===key)?.options?.some(option=>option.value===value))))throw new HttpException('Campos fora do layout do plugin.',400);
 if(Object.entries(body).some(([key,value])=>fields.find(field=>field.key===key)?.options?.some(option=>option.value===value&&option.blocksExecution))&&await this.db.one("SELECT 1 FROM card_ai_runs WHERE card_id=$1 AND status IN('queued','running','waiting_answer') UNION ALL SELECT 1 FROM card_runs WHERE card_id=$1 AND status IN('queued','running') UNION ALL SELECT 1 FROM card_ai_comment_jobs WHERE card_id=$1 AND status IN('queued','running') LIMIT 1",[card]))throw new HttpException('Aguarde a execução pendente antes de classificar como contexto.',409);
 await this.db.query("UPDATE card_plugin_layouts SET data=jsonb_set(data,ARRAY[$2]::text[],COALESCE(data->$2,'{}'::jsonb)||$3::jsonb,true),updated_at=now() WHERE card_id=$1",[card,pluginId,JSON.stringify(body)]);return this.get(card,user);}
 async set(card:string,user:string,body:Record<string,unknown>){await this.features.cardBoard(card,user);if(await this.db.one('SELECT card_id FROM vault_items WHERE card_id=$1',[card]))throw new HttpException('Itens do cofre não possuem plugins de IA.',409);if(Object.keys(body).some(key=>key!=='plugins')||!Array.isArray(body.plugins)||body.plugins.some(id=>typeof id!=='string')||body.plugins.length>30)throw new HttpException('Plugins do cartão inválidos.',400);
 const current=await this.db.one<{card_type_id:string|null}>('SELECT card_type_id FROM card_plugin_layouts WHERE card_id=$1',[card]);const typePlugin=this.registry.list().find(plugin=>plugin.contributions?.cardTypes?.some(type=>type.id===current?.card_type_id))?.id;const requested=[...new Set([...(body.plugins as string[]),...(typePlugin&&this.registry.isEnabled(typePlugin)?[typePlugin]:[])])];let ids:string[];try{ids=this.registry.selection(requested)}catch(error){throw new HttpException((error as Error).message,409)}
 await this.db.query('INSERT INTO card_plugin_layouts(card_id,plugin_ids) VALUES($1,$2) ON CONFLICT(card_id) DO UPDATE SET plugin_ids=$2,updated_at=now()',[card,typePlugin?ids.filter(id=>id!==typePlugin):ids]);return this.get(card,user);}
 childData(data:Record<string,Record<string,string>>){return childCardLayoutData(this.registry.list(),data)}
 async assertExecutionAllowed(card:string,user:string){if((await this.get(card,user)).executionBlocked)throw new HttpException('Este cartão é Contexto. Classifique-o como Executável para iniciar uma execução.',409);}
 async decorateCards<T extends Record<string,unknown>>(cards:T[]){
  if(!cards.length)return cards;
  const rows=await this.db.query<{card_id:string;plugin_ids:string[];card_type_id:string|null;data:Record<string,Record<string,string>>}>('SELECT card_id,plugin_ids,card_type_id,data FROM card_plugin_layouts WHERE card_id=ANY($1::uuid[])',[cards.map(card=>card.id)]);
  return cards.map(card=>{const stored=rows.find(row=>row.card_id===card.id),owner=this.registry.list().find(plugin=>plugin.contributions?.cardTypes?.some(type=>type.id===stored?.card_type_id));const values=cardLayoutValues(this.registry.list(),[...(stored?.plugin_ids||[]),...(owner?[owner.id]:[])],stored?.data);return {...card,plugin_badges:values.badges,execution_blocked:values.executionBlocked}});
 }
}
@Controller('cards/:id/plugins')
export class CardLayoutsController{
 constructor(@Inject(CardLayoutsService) private layouts:CardLayoutsService,@Inject(AccessService) private access:AccessService){}
 @Get() async get(@Req() req:Request,@Param('id') id:string){const user=await this.access.authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));return this.layouts.get(id,user.id)}
 @Patch(':pluginId/fields') async fields(@Req() req:Request,@Param('id') id:string,@Param('pluginId') pluginId:string,@Body() body:Record<string,unknown>){const user=await this.access.authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));return this.layouts.fields(id,user.id,pluginId,body)}
 @Patch() async set(@Req() req:Request,@Param('id') id:string,@Body() body:Record<string,unknown>){const user=await this.access.authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));return this.layouts.set(id,user.id,body)}
}
