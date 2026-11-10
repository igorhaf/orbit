import {Body,Controller,Get,HttpException,Inject,Injectable,Param,Patch,Req} from '@nestjs/common';
import type {Request} from 'express';
import {AccessService} from '../access/access';
import {Db} from '../db';
import {FeaturesService} from '../features';
import {PluginRegistry} from '../execution/registries';

type TypeRow={id:string;name:string;description?:string;pluginId:string;enabled:boolean};
const bad=(message:string,status=400):never=>{throw new HttpException({message},status)};

@Injectable()
export class CardTypesService {
 constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(PluginRegistry) private registry:PluginRegistry,@Inject(AccessService) private access:AccessService){}
 private declarations():TypeRow[]{const rows=this.registry.list().flatMap(plugin=>(plugin.contributions?.cardTypes||[]).map(type=>({id:type.id,name:type.name,description:type.description,pluginId:plugin.id,enabled:this.registry.isEnabled(plugin.id)})));const ids=new Set<string>();for(const row of rows){if(ids.has(row.id))throw new Error(`Identificador de tipo de cartão duplicado: ${row.id}`);ids.add(row.id)}return rows}
 private async settingsRows(){return this.db.query<{type_id:string;scope_key:string;enabled:boolean}>('SELECT type_id,scope_key,enabled FROM card_type_settings')}
 async boardTypes(boardId:string,user:string){await this.features.member(boardId,user);const [settings,account]=await Promise.all([this.settingsRows(),this.access.account(user)]);const global=new Map(settings.filter(row=>row.scope_key==='*').map(row=>[row.type_id,row.enabled]));const scoped=new Map(settings.filter(row=>row.scope_key===boardId).map(row=>[row.type_id,row.enabled]));const candidates=this.declarations().filter(type=>type.enabled&&(scoped.get(type.id)??global.get(type.id)??false));const authorized=candidates.length<=1||account.is_root?candidates:await Promise.all(candidates.map(async type=>await this.access.has(user,`cards.type.${type.id}.use`)?type:null)).then(rows=>rows.filter((type):type is TypeRow=>Boolean(type)));return {types:authorized.map(({id,name,description,pluginId})=>({id,name,description,pluginId})),requiresSelection:authorized.length>1,configuredCount:candidates.length}}
 async cardType(cardId:string,user:string){const boardId=await this.features.cardBoard(cardId,user);const current=await this.db.one<{card_type_id:string|null}>('SELECT card_type_id FROM card_plugin_layouts WHERE card_id=$1',[cardId]);return {...await this.boardTypes(boardId,user),currentTypeId:current?.card_type_id||null}}
 async select(cardId:string,user:string,typeId:unknown){
  const boardId=await this.features.cardBoard(cardId,user);if(typeof typeId!=='string')return bad('Tipo de cartão inválido.');
  const options=await this.boardTypes(boardId,user),type=options.types.find(item=>item.id===typeId);if(!type)return bad('Você não tem acesso a este tipo de cartão neste quadro.',403);
  const current=await this.db.one<{card_type_id:string|null;plugin_ids:string[]}>('SELECT card_type_id,plugin_ids FROM card_plugin_layouts WHERE card_id=$1',[cardId]);const currentPlugin=this.declarations().find(row=>row.id===current?.card_type_id)?.pluginId;const pluginIds=current?.plugin_ids||[];
  if(currentPlugin&&currentPlugin!==type.pluginId){const index=pluginIds.indexOf(currentPlugin);if(index>=0)pluginIds.splice(index,1)}
  await this.db.query('INSERT INTO card_plugin_layouts(card_id,card_type_id,plugin_ids) VALUES($1,$2,$3) ON CONFLICT(card_id) DO UPDATE SET card_type_id=$2,plugin_ids=$3,updated_at=now()',[cardId,typeId,pluginIds]);return this.cardType(cardId,user)
 }
 async resolveForCreate(boardId:string,user:string,requested:unknown):Promise<string|null>{
  const options=await this.boardTypes(boardId,user);if(!options.types.length){if(options.configuredCount>0)return bad('Você não tem permissão para os tipos de cartão habilitados neste quadro.',403);if(requested!==undefined&&requested!==null&&requested!=='')return bad('Este quadro não possui tipos de cartão habilitados.',409);return null}
  if(options.types.length===1){const only=options.types[0];if(!only)return null;if(requested!==undefined&&requested!==null&&requested!==''&&requested!==only.id)return bad('O tipo de cartão não corresponde à configuração deste quadro.',409);return only.id}
  if(typeof requested!=='string'||!requested)return bad('Escolha um tipo de cartão permitido para este quadro.',400);if(!options.types.some(type=>type.id===requested))return bad('Você não tem acesso a este tipo de cartão neste quadro.',403);return requested
 }
 async config(actor:string){if(!(await this.access.account(actor)).is_root)bad('Somente ROOT pode configurar os tipos de cartão da instância.',403);const [settings,types,boards]=await Promise.all([this.settingsRows(),Promise.resolve(this.declarations()),this.db.query<{id:string;title:string}>('SELECT id,title FROM boards WHERE NOT is_inbox AND NOT is_collection AND closed_at IS NULL ORDER BY title')]);return {types,settings,boards}}
 async setConfig(actor:string,body:Record<string,unknown>){
  if(!(await this.access.account(actor)).is_root)bad('Somente ROOT pode configurar os tipos de cartão da instância.',403);
  if(Object.keys(body).some(key=>!['typeId','boardId','enabled'].includes(key))||typeof body.typeId!=='string'||!this.declarations().some(type=>type.id===body.typeId))bad('Configuração de tipo inválida.');
  const typeId=body.typeId as string;let scope='*';if(body.boardId!==undefined&&body.boardId!==null){if(typeof body.boardId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(body.boardId))bad('Quadro inválido.');const boardId=body.boardId as string;if(!await this.db.one('SELECT id FROM boards WHERE id=$1',[boardId]))bad('Quadro não encontrado.',404);scope=boardId}
  if(body.enabled===null){if(scope==='*')bad('A configuração global precisa estar definida.');await this.db.query('DELETE FROM card_type_settings WHERE type_id=$1 AND scope_key=$2',[typeId,scope])}else{if(typeof body.enabled!=='boolean')bad('Estado do tipo inválido.');const enabled=body.enabled as boolean;await this.db.query('INSERT INTO card_type_settings(type_id,scope_key,enabled) VALUES($1,$2,$3) ON CONFLICT(type_id,scope_key) DO UPDATE SET enabled=$3,updated_at=now()',[typeId,scope,enabled])}
  await this.access.audit(actor,'card_type.settings.updated',`${typeId}:${scope}:${String(body.enabled)}`);return this.config(actor)
 }
}

@Controller()
export class CardTypesController {
 constructor(@Inject(CardTypesService) private service:CardTypesService,@Inject(AccessService) private access:AccessService){}
 private async user(req:Request){return (await this.access.authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''))).id}
 @Get('boards/:id/card-types') async board(@Req() req:Request,@Param('id') boardId:string){return this.service.boardTypes(boardId,await this.user(req))}
 @Get('cards/:id/type') card(@Req() req:Request,@Param('id') cardId:string){return this.user(req).then(user=>this.service.cardType(cardId,user))}
 @Patch('cards/:id/type') async select(@Req() req:Request,@Param('id') cardId:string,@Body() body:Record<string,unknown>){if(Object.keys(body).some(key=>key!=='typeId'))bad('Campo inválido.');return this.service.select(cardId,await this.user(req),body.typeId)}
 @Get('card-types/config') config(@Req() req:Request){return this.user(req).then(user=>this.service.config(user))}
 @Patch('card-types/config') async setConfig(@Req() req:Request,@Body() body:Record<string,unknown>){return this.service.setConfig(await this.user(req),body)}
}
