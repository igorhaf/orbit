import {Controller,Get,Post,Param,Req,Body,Inject,Injectable,HttpException} from '@nestjs/common';
import type {Request,Response,NextFunction} from 'express';
import {Db} from '../../db';
import {AccessService,type AccessRequest,id} from '../../access/access';
import {PluginRegistry} from '../../execution/registries';
import {ExtensionRecords} from '../records/records.service';
import type {PluginDefinition} from '../contract';
import type {CalendarItem} from '../../calendar/types';

export const recordCardsPlugin:PluginDefinition={id:'record-cards',name:'Cartões de registros',version:'1.0.0',dependencies:['versioned-records'],description:'Comentários, anexos, checklist e datas nativos para registros de plugins, com acesso validado no registro original.',handlesRoute:path=>path==='/record-cards/mine'||/^\/record-cards\/boards\/[0-9a-f-]{36}(?:\/templates\/[a-z0-9-]+)?$/.test(path)||/^\/record-cards\/[a-z0-9-]+\/records\/[0-9a-f-]{36}$/.test(path),routePermission:()=>null,capabilities:['read','write'].map(action=>({id:action,name:action==='read'?'Consultar cartões de registros':'Colaborar nos cartões de registros',permissions:[`plugin.record-cards.${action}`]}))};
type Mapping={record_id:string;card_id:string;board_id:string;plugin_id:string;kind:string};
@Injectable()
export class RecordCardsService{
 constructor(@Inject(Db)private db:Db,@Inject(ExtensionRecords)private records:ExtensionRecords,@Inject(AccessService)private access:AccessService,@Inject(PluginRegistry)private plugins:PluginRegistry){}
 private async authorize(plugin:string,recordId:string,user:string,write=false){
  if(!this.plugins.isEnabled('record-cards')||!this.plugins.isEnabled(plugin))throw new HttpException('O plugin de cartões ou uma dependência está desativado.',409);
  await this.access.require(user,`plugin.record-cards.${write?'write':'read'}`);
  const record=await this.records.detail(plugin,id(recordId),user);
  const projection=this.plugins.getById(plugin).contributions?.recordCards?.find(item=>item.kind===record.kind);
  if(!projection)throw new HttpException('Este registro não contribui cartões.',404);
  let title=record.title;
  if(projection.titleReference){
   const ref=projection.titleReference;const key=record.payload[ref.idField],revision=record.payload[ref.revisionField];
   if(typeof key!=='string'||typeof revision!=='number')throw new HttpException('A referência do cartão está incompleta.',409);
   const source=await this.records.versionSnapshot(ref.plugin,key,revision,user);
   title=String(source.payload[ref.titleField]||source.title);
  }
  return{record,projection,title};
 }
 async mapping(board:string):Promise<Mapping|null>{return this.db.one<Mapping>('SELECT link.*,r.plugin_id,r.kind FROM record_card_links link JOIN extension_records r ON r.id=link.record_id WHERE link.board_id=$1',[board])}
 async target(board:string,user:string){
  const map=await this.mapping(board);if(!map)return null;const {record,projection}=await this.authorize(map.plugin_id,map.record_id,user);
  return `${projection.href||`/extensions/${map.plugin_id}`}?workspace=${record.workspace_id}&${projection.recordParam||'record'}=${record.id}`;
 }
 async visibleBoards(user:string,status:string){
  if(status!=='active'||!this.plugins.isEnabled('record-cards')||!await this.access.has(user,'plugin.record-cards.read'))return[];
  const result:Array<Record<string,unknown>&{id:string}>=[];
  for(const item of await this.mine(user)){
   const {record,projection}=await this.authorize(item.plugin_id,item.record_id,user);if(!projection.board?.visible)continue;
   const board=await this.db.one<{id:string;title:string;owner_id:string;created_at:string;starred:boolean;closed_at:string|null}>('SELECT * FROM boards WHERE id=$1 AND closed_at IS NULL',[item.board_id]);if(!board)continue;
   result.push({...board,workspace_id:record.workspace_id,is_collection:false,is_inbox:false,card_count:Number((await this.db.one<{count:number}>('SELECT count(*)::int AS count FROM cards c JOIN lists l ON l.id=c.list_id WHERE l.board_id=$1 AND c.archived_at IS NULL',[board.id]))?.count||0),completed_card_count:0,record_scope:true});
  }
  return result;
 }
 async scope(board:string,user:string){
  const map=await this.mapping(board);if(!map)return null;const {record,projection}=await this.authorize(map.plugin_id,map.record_id,user);if(!projection.board)return null;
  const phases=await this.db.query<{phase_id:string;list_id:string}>('SELECT phase_id,list_id FROM record_board_phases WHERE board_id=$1',[board]);
  return {board_id:board,record_id:map.record_id,plugin_id:map.plugin_id,workspace_id:record.workspace_id,primary_card_id:map.card_id,label:projection.label,fixed_scope:true,state:record.state,record_href:`${projection.href||`/extensions/${map.plugin_id}`}?workspace=${record.workspace_id}&${projection.recordParam||'record'}=${record.id}`,phases:projection.board.phases.map(phase=>({...phase,list_id:phases.find(row=>row.phase_id===phase.id)?.list_id})),templates:projection.board.templates,can_write:await this.access.has(user,'plugin.record-cards.write')};
 }
 private async ensureScope(link:Mapping,record:{state:string},definition:NonNullable<NonNullable<PluginDefinition['contributions']>['recordCards']>[number]['board']){
  if(!definition)return;const client=await this.db.pool.connect();
  try{
   await client.query('BEGIN');await client.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE',[link.board_id]);
   const currentPhase=definition.phases.find(phase=>phase.id===record.state)||definition.phases[0];
   const existing=(await client.query<{phase_id:string;list_id:string}>('SELECT phase_id,list_id FROM record_board_phases WHERE board_id=$1',[link.board_id])).rows;
   const previous=(await client.query<{id:string}>('SELECT id FROM lists WHERE board_id=$1 ORDER BY position LIMIT 1',[link.board_id])).rows[0];
   for(const [position,phase] of definition.phases.entries()){
    const known=existing.find(row=>row.phase_id===phase.id);let listId=known?.list_id;
    if(!listId){listId=!existing.length&&phase.id===currentPhase.id&&previous?previous.id:(await client.query<{id:string}>('INSERT INTO lists(board_id,title,position) VALUES($1,$2,$3) RETURNING id',[link.board_id,phase.label,position])).rows[0].id;
     await client.query('INSERT INTO record_board_phases(board_id,phase_id,list_id) VALUES($1,$2,$3)',[link.board_id,phase.id,listId]);}
    await client.query('UPDATE lists SET title=$2,position=$3 WHERE id=$1',[listId,phase.label,position]);
   }
   const phase=(await client.query<{list_id:string}>('SELECT list_id FROM record_board_phases WHERE board_id=$1 AND phase_id=$2',[link.board_id,currentPhase.id])).rows[0];
   await client.query('UPDATE cards SET list_id=$2 WHERE id=$1 AND list_id<>$2',[link.card_id,phase.list_id]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }
 async fromTemplate(board:string,templateId:string,user:string,operationKey:string){
  const map=await this.mapping(id(board));if(!map)throw new HttpException('Quadro não encontrado.',404);
  const {projection}=await this.authorize(map.plugin_id,map.record_id,user,true);const template=projection.board?.templates.find(item=>item.id===templateId);if(!template)throw new HttpException('Modelo fora do escopo deste quadro.',404);
  id(operationKey);const client=await this.db.pool.connect();let result;
  try{
   await client.query('BEGIN');await client.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE',[board]);
   const previous=(await client.query('SELECT u.template_id,c.id,c.url_token FROM record_board_template_uses u JOIN cards c ON c.id=u.card_id WHERE u.board_id=$1 AND u.operation_key=$2',[board,operationKey])).rows[0];
   if(previous){if(previous.template_id!==templateId)throw new HttpException('Operação já utilizada por outro modelo.',409);await client.query('COMMIT');return previous;}
   const phase=(await client.query<{list_id:string}>('SELECT list_id FROM record_board_phases WHERE board_id=$1 AND phase_id=$2',[board,template.phase])).rows[0];if(!phase)throw new HttpException('A fase do modelo ainda não foi configurada.',409);
   result=(await client.query("INSERT INTO cards(list_id,title,description,position,kind) VALUES($1,$2,$3,COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=$1),0),'normal') RETURNING id,url_token",[phase.list_id,template.name,template.description])).rows[0];
   const checklist=(await client.query<{id:string}>("INSERT INTO checklists(card_id,title,position) VALUES($1,'Checklist',0) RETURNING id",[result.id])).rows[0];
   for(const [position,text] of template.checklist.entries())await client.query('INSERT INTO checklist_items(card_id,checklist_id,text,position) VALUES($1,$2,$3,$4)',[result.id,checklist.id,text,position]);
   if(this.plugins.isEnabled('structured-view'))await client.query('INSERT INTO structured_view_parents(card_id,parent_card_id) VALUES($1,$2)',[result.id,map.card_id]);
   await client.query('INSERT INTO record_board_template_uses(board_id,operation_key,template_id,card_id,created_by) VALUES($1,$2,$3,$4,$5)',[board,operationKey,templateId,result.id,user]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  return result;
 }
 async members(board:string,user:string){
  const map=await this.mapping(board);if(!map)return null;await this.authorize(map.plugin_id,map.record_id,user);
  const users=await this.db.query<{id:string;name:string;email:string;avatar_url:string|null}>(`SELECT DISTINCT u.id,u.name,u.email,u.avatar_url FROM users u WHERE NOT u.disabled AND (u.is_root OR u.id=(SELECT created_by FROM extension_records WHERE id=$1) OR EXISTS(SELECT 1 FROM access_grants g JOIN access_roles r ON r.id=g.role_id WHERE g.user_id=u.id AND ((g.scope_type='extension_record' AND g.scope_id=$1::text) OR (g.scope_type='global' AND $2=ANY(r.permissions))))) ORDER BY u.name`,[map.record_id,`plugin.${map.plugin_id}.manage`]);
  const allowed=[];for(const candidate of users)if(await this.access.boardPermission(board,candidate.id))allowed.push({...candidate,role:'member'});return allowed;
 }
 install(){
  this.access.registerBoardListProvider((user,status)=>this.visibleBoards(user,status));
  this.access.registerBoardScopeProvider((board,user)=>this.scope(board,user));
  this.access.registerBoardMembersProvider((board,user)=>this.members(board,user));
  this.access.registerBoardListingPolicy(async board=>!await this.mapping(board));
  this.access.registerBoardAccessProvider(async(board,user,permission)=>{
   const map=await this.mapping(board);if(!map)return null;
   try{await this.authorize(map.plugin_id,map.record_id,user,permission==='boards.write');return true}catch(error){if(error instanceof HttpException&&[403,404,409].includes(error.getStatus()))return false;throw error}
  });
 }
 async card(plugin:string,recordId:string,user:string,create=false){
  const {record,projection,title}=await this.authorize(plugin,recordId,user,create);
  let link=await this.db.one<Mapping>('SELECT * FROM record_card_links WHERE record_id=$1',[record.id]);
  if(!link&&create){
   const client=await this.db.pool.connect();try{
    await client.query('BEGIN');await client.query('SELECT id FROM extension_records WHERE id=$1 FOR UPDATE',[record.id]);
    link=(await client.query<Mapping>('SELECT * FROM record_card_links WHERE record_id=$1',[record.id])).rows[0];
    if(!link){
     const owner=(await client.query('SELECT created_by FROM extension_records WHERE id=$1',[record.id])).rows[0].created_by;
     const board=(await client.query("INSERT INTO boards(title,owner_id,background,description) VALUES($1,$2,'blue',$3) RETURNING id",[title.slice(0,160),owner,'Colaboração vinculada a registro; acesso herdado do registro original.'])).rows[0];
     const list=(await client.query("INSERT INTO lists(board_id,title,position) VALUES($1,$2,0) RETURNING id",[board.id,projection.label])).rows[0];
     const card=(await client.query("INSERT INTO cards(list_id,title,description,position,kind) VALUES($1,$2,$3,0,'normal') RETURNING id",[list.id,title.slice(0,300),projection.description||'Anotações de acompanhamento. Os documentos e as decisões formais permanecem nos registros vinculados.'])).rows[0];
     link=(await client.query<Mapping>('INSERT INTO record_card_links(record_id,card_id,board_id) VALUES($1,$2,$3) RETURNING *',[record.id,card.id,board.id])).rows[0];
    }
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  if(!link)throw new HttpException('Cartão ainda não aberto.',404);
  if(create)await this.ensureScope(link,record,projection.board);
  const permissions={write:await this.access.has(user,'plugin.record-cards.write')};
  return{...link,plugin_id:plugin,record_id:record.id,workspace_id:record.workspace_id,record_state:record.state,record_revision:record.revision,title,permissions};
 }
 async mine(user:string){
  await this.access.require(user,'plugin.record-cards.read');
  const rows=await this.db.query<Mapping>('SELECT link.*,r.plugin_id,r.kind FROM record_card_links link JOIN extension_records r ON r.id=link.record_id ORDER BY link.created_at DESC LIMIT 500');
  const result=[];for(const map of rows){try{
   const original=await this.authorize(map.plugin_id,map.record_id,user);
   const work=await this.db.one<{id:string;url_token:string;title:string;due_date:string|null;completed:boolean;comments:number;pending_items:number}>("SELECT c.id,c.url_token,c.title,c.due_date,c.completed,(SELECT count(*)::int FROM comments WHERE card_id=c.id) AS comments,(SELECT count(*)::int FROM checklist_items WHERE card_id=c.id AND NOT completed) AS pending_items FROM cards c WHERE c.id=$1 AND archived_at IS NULL",[map.card_id]);
   if(work)result.push({...work,board_id:map.board_id,record_id:map.record_id,plugin_id:map.plugin_id,board_href:`/board/${map.board_id}`,workspace_id:original.record.workspace_id,state:original.record.state,record_href:`${original.projection.href||`/extensions/${map.plugin_id}`}?workspace=${original.record.workspace_id}&${original.projection.recordParam||"record"}=${map.record_id}`});
  }catch(error){if(!(error instanceof HttpException)||![403,404,409].includes(error.getStatus()))throw error}}
  return result;
 }
 async reminders(user:string){
  if(!this.plugins.isEnabled('record-cards')||!await this.access.has(user,'plugin.record-cards.read'))return;
  for(const card of await this.mine(user))await this.db.query(`INSERT INTO notifications(plugin_id,user_id,board_id,card_id,kind,title,body,due_at)
   SELECT 'record-cards',$1,$2,c.id,'due',CASE WHEN c.due_date<now() THEN 'Cartão vencido' ELSE 'Prazo próximo' END,c.title,c.due_date FROM cards c
   WHERE c.id=$3 AND c.due_date IS NOT NULL AND c.reminder_minutes IS NOT NULL AND c.due_date<=now()+c.reminder_minutes*interval '1 minute' ON CONFLICT DO NOTHING`,[user,card.board_id,card.id]);
 }
 async calendarItems(user:string,sourceId:string,start:Date,end:Date):Promise<CalendarItem[]>{
  if(!this.plugins.isEnabled('record-cards')||!await this.access.has(user,'plugin.record-cards.read'))return[];
  const items:CalendarItem[]=[];
  for(const work of await this.mine(user)){
   const card=await this.db.one('SELECT * FROM cards WHERE id=$1 AND schedule_start_at IS NOT NULL AND schedule_start_at<$3 AND COALESCE(schedule_end_at,schedule_start_at)>=$2',[work.id,start,end]);if(!card)continue;
   items.push({id:`card:${work.id}`,sourceId,resourceType:'card',cardId:String(work.id),cardUrlToken:String(work.url_token),title:String(work.title),description:String(card.description||''),start:new Date(card.schedule_start_at).toISOString(),end:card.schedule_end_at?new Date(card.schedule_end_at).toISOString():null,allDay:Boolean(card.schedule_all_day),timeZone:card.schedule_time_zone,metadata:{boardId:work.board_id,recordHref:work.record_href}});
  }
  return items;
 }
 middleware(){return(req:Request,res:Response,next:NextFunction)=>{void this.checkRequest(req).then(()=>next()).catch(error=>res.status(error instanceof HttpException?error.getStatus():500).json({message:error instanceof Error?error.message:'Não foi possível verificar o acesso ao cartão.'}))}}
 private async checkRequest(req:Request){
  if(!['GET','HEAD'].includes(req.method)&&typeof req.body?.list_id==='string'&&/^[0-9a-f-]{36}$/i.test(req.body.list_id)){
   const target=await this.db.one('SELECT rc.board_id FROM record_card_links rc JOIN lists l ON l.board_id=rc.board_id WHERE l.id=$1',[req.body.list_id]);
   if(target){const source=req.path.match(/^\/cards\/([0-9a-f-]{36})$/i);const same=source&&await this.db.one('SELECT 1 FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=$1 AND l.board_id=$2',[source[1],target.board_id]);if(!same)throw new HttpException('Crie atividades pelos modelos do próprio quadro; não transfira cartões de outros registros.',409);}
  }
  if(req.method==='POST'&&/^\/cards\/(move|copy|merge|archive|delete)$/.test(req.path)&&Array.isArray(req.body?.card_ids)){
   const source=await this.db.one('SELECT 1 FROM cards c JOIN lists l ON l.id=c.list_id JOIN record_card_links rc ON rc.board_id=l.board_id WHERE c.id=ANY($1::uuid[]) LIMIT 1',[req.body.card_ids]);
   if(source)throw new HttpException('Os cartões de registros permanecem vinculados ao registro original.',409);
  }
  const match=req.path.match(/^\/(boards|lists|cards|comments|checklists|checklist-items|checklist|card-attachments|comment-attachments|labels)\/([0-9a-f-]{36})(?:\/|$)/i);
  if(!match)return;
  const kind=match[1],key=match[2];let board=kind==='boards'?key:null;
  if(!board){
   const tables:Record<string,string>={cards:'cards',comments:'comments',checklists:'checklists','checklist-items':'checklist_items',checklist:'checklist_items','card-attachments':'attachments','comment-attachments':'comment_attachments'};
   if(kind==='lists'||kind==='labels')board=(await this.db.one(`SELECT board_id FROM ${kind} WHERE id=$1`,[key]))?.board_id;
   else if(tables[kind]){const join=kind==='cards'?'':kind==='comment-attachments'?'JOIN comments cm ON cm.id=r.comment_id JOIN cards c ON c.id=cm.card_id':'JOIN cards c ON c.id=r.card_id';board=(await this.db.one(`SELECT l.board_id FROM ${tables[kind]} r ${join} JOIN lists l ON l.id=${kind==='cards'?'r.list_id':'c.list_id'} WHERE r.id=$1`,[key]))?.board_id}
  }
  if(!board)return;const map=await this.mapping(board);if(!map)return;
  const account=await this.access.authenticate(String(req.headers.authorization||'').replace(/^Bearer /i,''));const writing=!['GET','HEAD'].includes(req.method);
  await this.authorize(map.plugin_id,map.record_id,account.id,writing);
  if(!writing)return;
  if(kind==='boards'&&!/^\/boards\/[^/]+\/(?:labels|views(?:\/.*)?)$/.test(req.path))throw new HttpException('Este quadro é administrado pelo plugin do registro.',409);
  if(kind==='lists')throw new HttpException('A organização deste cartão pertence ao registro original.',409);
  if(kind==='cards'&&Object.hasOwn(req.body||{},'list_id')){
   const same=typeof req.body.list_id==='string'&&await this.db.one('SELECT 1 FROM record_board_phases WHERE board_id=$1 AND list_id=$2',[board,req.body.list_id]);
   if(key===map.card_id||!same)throw new HttpException('O cartão permanece no escopo do seu registro.',409);
  }
  if(kind==='cards'&&((key===map.card_id&&(req.method==='DELETE'||/(?:archive|restore|template)(?:\/|$)/.test(req.path)))||/(?:copy|merge|mirror)(?:\/|$)/.test(req.path)||['board_id','kind'].some(field=>Object.hasOwn(req.body||{},field))))throw new HttpException('Mantenha o cartão no registro original; alterações de fase são feitas pelo fluxo formal.',409);
 }
}
@Controller('record-cards')
export class RecordCardsController{
 constructor(@Inject(RecordCardsService)private service:RecordCardsService){}
 @Get('boards/:board')scope(@Req()req:AccessRequest,@Param('board')board:string){return this.service.scope(id(board),String(req.orbitActor))}
 @Post('boards/:board/templates/:template')template(@Req()req:AccessRequest,@Param('board')board:string,@Param('template')template:string,@Body()body:{operation_key:string}){if(!body||Object.keys(body).some(key=>key!=='operation_key'))throw new HttpException('Campos fora do modelo.',400);return this.service.fromTemplate(board,template,String(req.orbitActor),body.operation_key)}
 @Get('mine')mine(@Req()req:AccessRequest){return this.service.mine(String(req.orbitActor))}
 @Get(':plugin/records/:id')get(@Req()req:AccessRequest,@Param('plugin')plugin:string,@Param('id')record:string){return this.service.card(plugin,record,String(req.orbitActor))}
 @Post(':plugin/records/:id')create(@Req()req:AccessRequest,@Param('plugin')plugin:string,@Param('id')record:string){return this.service.card(plugin,record,String(req.orbitActor),true)}
}
