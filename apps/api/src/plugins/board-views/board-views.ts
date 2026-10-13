import {Body,Controller,Get,Patch,Param,Req,Inject,Injectable,HttpException} from '@nestjs/common';
import type {Request} from 'express';
import {AccessService} from '../../access/access';
import {Db} from '../../db';
import {FeaturesService} from '../../features';
import {PluginRegistry} from '../../execution/registries';

export type SavedBoardFilter={id:string;name:string;query:string;listId:string;assignee:string;labelId:string;due:string};
const reject=(message:string,status=400):never=>{throw new HttpException({message},status)};

@Injectable()
export class BoardViewsService {
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(PluginRegistry) private registry:PluginRegistry,@Inject(AccessService) private access:AccessService){}
  private async authorize(board:string,user:string){await this.access.require(user,'boards.read');await this.features.member(board,user);}
  async available(board:string,user:string){
    await this.authorize(board,user);
    const declarations=this.registry.list().filter(plugin=>this.registry.isEnabled(plugin.id)).flatMap(plugin=>(plugin.contributions?.boardViews||[]).map(view=>({...view,pluginId:plugin.id})));
    const views=(await Promise.all(declarations.map(async view=>await this.access.has(user,view.permission)?view:null))).filter(view=>view!==null);
    const preferences=await this.db.one<{view_id:string;saved_filters:SavedBoardFilter[]}>('SELECT view_id,saved_filters FROM board_view_preferences WHERE user_id=$1 AND board_id=$2',[user,board]);
    return {views,canWrite:await this.access.boardPermission(board,user,'boards.write'),preferredViewId:views.find(view=>view.id===preferences?.view_id)?.id||views[0]?.id||null,savedFilters:preferences?.saved_filters||[]};
  }
  async save(board:string,user:string,body:Record<string,unknown>){
    const state=await this.available(board,user);
    if(!Object.keys(body).length||Object.keys(body).some(key=>!['viewId','savedFilters'].includes(key)))reject('Preferência de visualização inválida.');
    const viewId=body.viewId??state.preferredViewId;
    if(typeof viewId!=='string'||!state.views.some(view=>view.id===viewId))reject('Você não tem acesso a esta visualização.',403);
    let filters=state.savedFilters;
    if(body.savedFilters!==undefined){
      if(!Array.isArray(body.savedFilters)||body.savedFilters.length>20)reject('Salve no máximo 20 filtros.');
      const values=body.savedFilters as unknown[];
      const keys=['id','name','query','listId','assignee','labelId','due'];
      filters=values.map(value=>{
        if(!value||typeof value!=='object'||Array.isArray(value))reject('Filtro inválido.');
        const filter=value as Record<string,unknown>;
        if(Object.keys(filter).some(key=>!keys.includes(key))||keys.some(key=>typeof filter[key]!=='string'||String(filter[key]).length>(key==='query'?200:80)))reject('Filtro inválido.');
        if(!String(filter.id).trim()||!String(filter.name).trim()||!['','overdue','upcoming','none'].includes(String(filter.due)))reject('Filtro inválido.');
        return filter as SavedBoardFilter;
      });
      if(new Set(filters.map(filter=>filter.id)).size!==filters.length)reject('Filtros duplicados.');
    }
    await this.db.query('INSERT INTO board_view_preferences(user_id,board_id,view_id,saved_filters) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(user_id,board_id) DO UPDATE SET view_id=$3,saved_filters=$4::jsonb,updated_at=now()',[user,board,viewId,JSON.stringify(filters)]);
    return this.available(board,user);
  }
  async setParent(board:string,user:string,card:string,body:Record<string,unknown>){
    const state=await this.available(board,user);
    if(!state.views.some(view=>view.id==='structured')||!state.canWrite)reject('Sem permissão para organizar a hierarquia.',403);
    const validId=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
    if(Object.keys(body).length!==1||!Object.hasOwn(body,'parentId')||!validId(card)||(body.parentId!==null&&!validId(body.parentId)))reject('Pai principal inválido.');
    const parent=body.parentId as string|null;if(parent===card)reject('Um cartão não pode ser seu próprio pai.');
    const client=await this.db.pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[board]);
      const ids=parent?[card,parent]:[card];
      const available=await client.query(`SELECT c.id FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=ANY($1::uuid[]) AND l.board_id=$2 AND c.archived_at IS NULL AND l.archived_at IS NULL AND c.kind IN ('normal','template') AND NOT EXISTS(SELECT 1 FROM vault_items v WHERE v.card_id=c.id)`,[ids,board]);
      if(available.rows.length!==ids.length)reject('Escolha cartões disponíveis neste quadro.');
      if(parent){const cycle=await client.query(`WITH RECURSIVE ancestors(id) AS (SELECT $1::uuid UNION SELECT p.parent_card_id FROM structured_view_parents p JOIN ancestors a ON p.card_id=a.id) SELECT 1 FROM ancestors WHERE id=$2`,[parent,card]);if(cycle.rows.length)reject('Este movimento criaria um ciclo na hierarquia.',409);
        await client.query('INSERT INTO structured_view_parents(card_id,parent_card_id) VALUES($1,$2) ON CONFLICT(card_id) DO UPDATE SET parent_card_id=$2,updated_at=now()',[card,parent]);
      }else await client.query('DELETE FROM structured_view_parents WHERE card_id=$1',[card]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    await this.features.record(user,board,card,'hierarchy_updated',parent?'alterou o pai principal do cartão':'moveu o cartão para a raiz da hierarquia');
    return this.relations(board,user,'structured');
  }
  async relations(board:string,user:string,viewId:string){
    const state=await this.available(board,user);
    if(!state.views.some(view=>view.id===viewId))reject('Visualização indisponível ou sem permissão.',403);
    const links=await this.db.query<{cardId:string;contextId:string;position:number}>(`SELECT ref.card_id AS "cardId",ref.context_card_id AS "contextId",ref.position
      FROM card_contexts ref JOIN cards c ON c.id=ref.card_id JOIN lists l ON l.id=c.list_id
      JOIN cards context ON context.id=ref.context_card_id JOIN lists cl ON cl.id=context.list_id
      WHERE l.board_id=$1 AND cl.board_id=$1 AND c.archived_at IS NULL AND context.archived_at IS NULL
      AND l.archived_at IS NULL AND cl.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM vault_items v WHERE v.card_id IN(c.id,context.id))
      ORDER BY ref.position,ref.card_id,ref.context_card_id`,[board]);
    const parents=await this.db.query<{cardId:string;contextId:string;position:number}>(`SELECT p.card_id AS "cardId",p.parent_card_id AS "contextId",0 AS position
      FROM structured_view_parents p JOIN cards c ON c.id=p.card_id JOIN lists l ON l.id=c.list_id
      JOIN cards parent ON parent.id=p.parent_card_id JOIN lists pl ON pl.id=parent.list_id
      WHERE l.board_id=$1 AND pl.board_id=$1 AND c.archived_at IS NULL AND parent.archived_at IS NULL
      AND l.archived_at IS NULL AND pl.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM vault_items v WHERE v.card_id IN(c.id,parent.id))`,[board]);
    return {links:parents,contextLinks:links};
  }
}

@Controller('boards/:id/views')
export class BoardViewsController {
  constructor(@Inject(BoardViewsService) private service:BoardViewsService,@Inject(AccessService) private access:AccessService){}
  private async user(req:Request){return (await this.access.authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''))).id;}
  @Get() async list(@Req() req:Request,@Param('id') board:string){return this.service.available(board,await this.user(req));}
  @Patch() async save(@Req() req:Request,@Param('id') board:string,@Body() body:Record<string,unknown>){return this.service.save(board,await this.user(req),body);}
  @Patch('structured/cards/:cardId/parent') async parent(@Req() req:Request,@Param('id') board:string,@Param('cardId') card:string,@Body() body:Record<string,unknown>){return this.service.setParent(board,await this.user(req),card,body);}
  @Get(':viewId/relations') async relations(@Req() req:Request,@Param('id') board:string,@Param('viewId') view:string){return this.service.relations(board,await this.user(req),view);}
}
