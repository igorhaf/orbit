import { Body, Controller, Delete, Get, HttpException, Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { config as loadEnv } from 'dotenv';
import { Db } from './db';
import { FeaturesService } from './features';
import { OrbitEvents } from './orbit-events';
import { PluginRegistry } from './execution/registries';
import { defineCapability, defineCardAction, defineConnectionProvider, defineContribution, definePlugin } from './plugins/sdk';

export const trelloPluginDefinition=definePlugin({
  id:'trello',name:'Trello',version:'1.0.0',scope:'board',
  configuration:[
    {key:'TRELLO_KEY',label:'Trello API Key',secret:true},
    {key:'TRELLO_TOKEN',label:'Trello Token',secret:true},
    {key:'TRELLO_CONFIG_PATH',label:'Arquivo externo de configuração',secret:false},
    {key:'TRELLO_DEFAULT_BOARD_ID',label:'ID do quadro de origem',secret:false},
    {key:'TRELLO_DEFAULT_ORBIT_BOARD_ID',label:'ID do quadro Orbit',secret:false},
    {key:'TRELLO_SYNC_INTERVAL_MS',label:'Intervalo de sincronização (ms)',secret:false},
  ],
  capabilities:[
    defineCapability({id:'cards.external.read',name:'Ler Cards externos'}),
    defineCapability({id:'cards.external.write',name:'Gravar Cards externos'}),
  ],
  connectionProvider:defineConnectionProvider({id:'trello',name:'Trello',supportsMultiple:true,capabilities:['cards.external.read','cards.external.write']}),
  contributions:{settings:[defineContribution({id:'trello-board-settings',surface:'board'})],cardActions:[defineCardAction({id:'open-trello-card'})]},
});

type Connection = { id:string; board_id:string; trello_board_id:string; trello_board_name:string; created_by:string; created_at:Date };
type TrelloBoard = { id:string; name:string; closed?:boolean; url?:string };
type TrelloList = { id:string; name:string; closed?:boolean; pos?:number; idBoard?:string };
type TrelloCard = { id:string; name:string; desc?:string; due?:string|null; closed?:boolean; dateLastActivity?:string; pos?:number };
const defaultSource = '/home/meada/projetos/semente/backend/.env';
const defaultTrelloBoard = '6aad4f942e48600db2a0a6c4';
const defaultOrbitBoard = 'cbc47724-dc88-430c-8ef6-62ca6b87e22c';
const fail = (message:string,status=400):never=>{throw new HttpException({message},status)};
const trelloId = (value:unknown,label:string) => {
  if(typeof value!=='string'||!/^[A-Za-z0-9]+$/.test(value)||value.length>64)fail(`${label} inválido.`);
  return value;
};

@Injectable()
export class TrelloSyncService implements OnModuleInit, OnModuleDestroy {
  private configured=false;
  private syncing=new Set<string>();
  private timer?:ReturnType<typeof setInterval>;
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(OrbitEvents) private events:OrbitEvents,@Optional() @Inject(PluginRegistry) private plugins:PluginRegistry=new PluginRegistry()){}

  onModuleInit(){
    if(process.env.ORBIT_ENV==='development'&&process.env.ORBIT_ALLOW_EXTERNAL_AUTOMATION!=='true')return;
    if(this.plugins.isEnabled('trello'))void this.connectDefault().catch(error=>console.error('Could not connect the default Trello board.',error));
    this.timer=setInterval(()=>void this.tick(),Number(process.env.TRELLO_SYNC_INTERVAL_MS||5000));
    this.timer.unref();
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer)}

  private credentials(){
    if(!this.configured){loadEnv({path:process.env.TRELLO_CONFIG_PATH||defaultSource});this.configured=true;}
    const key=process.env.TRELLO_KEY,token=process.env.TRELLO_TOKEN;
    if(!key||!token)fail('A integração do Trello não está configurada no servidor.',503);
    return {key:String(key),token:String(token)};
  }
  private async request<T>(path:string,method:'GET'|'POST'|'PUT'|'DELETE'='GET',data:Record<string,string>={}){
    const {key,token}=this.credentials();const query=new URLSearchParams({key,token,...(method==='GET'?data:{})});
    let response:Response;
    try{response=await fetch(`https://api.trello.com/1/${path}?${query}`,{method,headers:{...(method==='GET'?{}:{'content-type':'application/x-www-form-urlencoded'}),'X-Trello-Client-Identifier':'orbit-trello-sync'},body:method==='GET'||method==='DELETE'?undefined:new URLSearchParams({key,token,...data}),signal:AbortSignal.timeout(15_000)});}catch{fail('Não foi possível conectar ao Trello.',502)}
    if(!response!.ok)fail(response!.status===404?'Recurso do Trello não encontrado.':'O Trello recusou a sincronização.',502);
    return response!.json() as Promise<T>;
  }
  private async access(boardId:string,userId:string){await this.features.member(boardId,userId)}
  async available(boardId:string,userId:string){await this.access(boardId,userId);const boards=await this.request<TrelloBoard[]>('members/me/boards','GET',{fields:'name,url,closed'});return boards.filter(board=>!board.closed).map(board=>({id:board.id,name:board.name,url:board.url||null}));}
  async connections(boardId:string,userId:string){await this.access(boardId,userId);return this.db.query('SELECT id,trello_board_id,trello_board_name,enabled,last_synced_at,last_error,created_at FROM trello_connections WHERE board_id=$1 ORDER BY created_at',[boardId])}
  async connect(boardId:string,userId:string,source:unknown){await this.access(boardId,userId);const remote=await this.request<TrelloBoard>(`boards/${trelloId(source,'Quadro do Trello')}`,'GET',{fields:'name,closed'});if(remote.closed)fail('Não é possível conectar um quadro Trello fechado.',409);const connection=await this.db.one<Connection>(`INSERT INTO trello_connections(board_id,trello_board_id,trello_board_name,created_by) VALUES($1,$2,$3,$4)
    ON CONFLICT(board_id,trello_board_id) DO UPDATE SET enabled=true,trello_board_name=EXCLUDED.trello_board_name RETURNING *`,[boardId,remote.id,remote.name,userId]);return this.connection(String(connection!.id));}
  private connection(id:string){return this.db.one('SELECT id,trello_board_id,trello_board_name,enabled,last_synced_at,last_error,created_at FROM trello_connections WHERE id=$1',[id])}
  async disconnect(boardId:string,userId:string,id:string){await this.access(boardId,userId);const removed=await this.db.one('DELETE FROM trello_connections WHERE id=$1 AND board_id=$2 RETURNING id',[id,boardId]);if(!removed)fail('Conexão Trello não encontrada.',404);return {ok:true}}
  async syncBoard(boardId:string,userId:string){await this.access(boardId,userId);const rows=await this.db.query<{id:string}>('SELECT id FROM trello_connections WHERE board_id=$1 AND enabled',[boardId]);return {connections:await Promise.all(rows.map(row=>this.sync(row.id)))};}
  async listOptions(listId:string,userId:string){
    const found=await this.db.one<{board_id:string}>('SELECT board_id FROM lists WHERE id=$1',[listId]);if(!found)fail('Lista não encontrada.',404);const local=found!;await this.access(local.board_id,userId);
    const connections=await this.db.query<Connection>('SELECT * FROM trello_connections WHERE board_id=$1 AND enabled ORDER BY created_at',[local.board_id]);
    return Promise.all(connections.map(async connection=>{const lists=await this.request<TrelloList[]>(`boards/${connection.trello_board_id}/lists`,'GET',{fields:'name,closed,pos',filter:'open'}),mapping=await this.db.one<{trello_list_id:string}>('SELECT trello_list_id FROM trello_list_mappings WHERE connection_id=$1 AND orbit_list_id=$2',[connection.id,listId]);return {connection_id:connection.id,trello_board_name:connection.trello_board_name,mapped_list_id:mapping?.trello_list_id||null,lists:lists.filter(item=>!item.closed).map(item=>({id:item.id,name:item.name}))};}));
  }
  async mapList(listId:string,userId:string,connectionValue:unknown,remoteValue:unknown){
    const found=await this.db.one<{board_id:string}>('SELECT board_id FROM lists WHERE id=$1',[listId]);if(!found)fail('Lista não encontrada.',404);const local=found!;await this.access(local.board_id,userId);
    if(connectionValue===null||connectionValue===''||remoteValue===null||remoteValue===''){await this.db.query('DELETE FROM trello_list_mappings WHERE orbit_list_id=$1',[listId]);return {ok:true,mapped_list_id:null};}
    if(typeof connectionValue!=='string')fail('Conexão Trello inválida.');const match=await this.db.one<Connection>('SELECT * FROM trello_connections WHERE id=$1 AND board_id=$2 AND enabled',[connectionValue,local.board_id]);if(!match)fail('Conexão Trello não encontrada.',404);const connection=match!;
    const remoteId=trelloId(remoteValue,'Lista do Trello'),remote=await this.request<TrelloList>(`lists/${remoteId}`,'GET',{fields:'name,closed,idBoard'});if(remote.closed)fail('Não é possível vincular uma lista Trello arquivada.',409);if(remote.idBoard&&remote.idBoard!==connection.trello_board_id)fail('A lista não pertence ao quadro Trello selecionado.',409);
    const used=await this.db.one<{orbit_list_id:string}>('SELECT orbit_list_id FROM trello_list_mappings WHERE connection_id=$1 AND trello_list_id=$2 AND orbit_list_id<>$3',[connection.id,remote.id,listId]);if(used)fail('Esta lista do Trello já está vinculada a outra coluna local.',409);
    await this.db.query('DELETE FROM trello_list_mappings WHERE orbit_list_id=$1',[listId]);
    await this.db.query('INSERT INTO trello_list_mappings(connection_id,trello_list_id,trello_list_name,orbit_list_id) VALUES($1,$2,$3,$4)',[connection.id,remote.id,remote.name,listId]);
    await this.sync(connection.id);return {ok:true,mapped_list_id:remote.id};
  }
  private async labels(boardId:string,source:string){const ensure=async(name:string,color:string)=>{const existing=await this.db.one<{id:string}>('SELECT id FROM labels WHERE board_id=$1 AND name=$2 LIMIT 1',[boardId,name]);if(existing){await this.db.query('UPDATE labels SET color=$3 WHERE id=$1 AND board_id=$2',[existing.id,boardId,color]);return existing.id;}return String((await this.db.one<{id:string}>('INSERT INTO labels(board_id,name,color) VALUES($1,$2,$3) RETURNING id',[boardId,name,color]))!.id)};const ids=[await ensure('trello','blue_dark'),await ensure(source,'green_dark')];await this.db.query('INSERT INTO card_labels(card_id,label_id) SELECT m.orbit_card_id,u.label_id FROM trello_card_mappings m JOIN cards c ON c.id=m.orbit_card_id CROSS JOIN unnest($2::uuid[]) AS u(label_id) JOIN lists l ON l.id=c.list_id WHERE l.board_id=$1 ON CONFLICT DO NOTHING',[boardId,ids]);return ids;}
  private async pullCard(connection:Connection,listId:string,remote:TrelloCard,index:number,labelIds:string[]){const mapping=await this.db.one<{orbit_card_id:string,last_trello_activity:Date|null}>('SELECT orbit_card_id,last_trello_activity FROM trello_card_mappings WHERE connection_id=$1 AND trello_card_id=$2',[connection.id,remote.id]);const remoteActivity=remote.dateLastActivity?new Date(remote.dateLastActivity):new Date();if(mapping?.last_trello_activity&&remoteActivity<=mapping.last_trello_activity)return false;const due=remote.due&&Number.isFinite(Date.parse(remote.due))?new Date(remote.due):null;let cardId=mapping?.orbit_card_id;if(cardId){await this.db.query(`UPDATE cards SET list_id=$2,title=$3,description=$4,due_date=$5,position=$6,completed=$7,archived_at=$8,updated_at=now() WHERE id=$1`,[cardId,listId,remote.name.slice(0,300),remote.desc||'',due,index,Boolean(remote.closed),remote.closed?new Date():null]);await this.db.query('UPDATE trello_card_mappings SET last_trello_activity=$3,last_orbit_update=now() WHERE connection_id=$1 AND trello_card_id=$2',[connection.id,remote.id,remoteActivity]);}else{const created=await this.db.one<{id:string}>(`INSERT INTO cards(list_id,title,description,due_date,position,completed,archived_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[listId,remote.name.slice(0,300),remote.desc||'',due,index,Boolean(remote.closed),remote.closed?new Date():null]);cardId=created!.id;await this.db.query('INSERT INTO trello_card_mappings(connection_id,trello_card_id,orbit_card_id,last_trello_activity,last_orbit_update) VALUES($1,$2,$3,$4,now())',[connection.id,remote.id,cardId,remoteActivity]);}for(const label of labelIds)await this.db.query('INSERT INTO card_labels(card_id,label_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[cardId,label]);return true;}
  private async pushPending(connection:Connection){
    const cards=await this.db.query<{id:string;title:string;description:string;due_date:Date|null;completed:boolean;archived_at:Date|null;updated_at:Date;trello_card_id:string|null;trello_list_id:string;last_orbit_update:Date|null}>(
      'SELECT c.id,c.title,c.description,c.due_date,c.completed,c.archived_at,c.updated_at,m.trello_card_id,m.last_orbit_update,lm.trello_list_id FROM cards c JOIN lists l ON l.id=c.list_id JOIN trello_list_mappings lm ON lm.orbit_list_id=l.id AND lm.connection_id=$1 LEFT JOIN trello_card_mappings m ON m.orbit_card_id=c.id AND m.connection_id=$1 WHERE l.board_id=$2 AND l.archived_at IS NULL',
      [connection.id,connection.board_id],
    );
    let changed=false;
    for(const card of cards){
      if(card.trello_card_id&&card.last_orbit_update&&card.updated_at<=card.last_orbit_update)continue;
      const data={name:card.title,desc:card.description||'',due:card.due_date?card.due_date.toISOString():'',closed:String(Boolean(card.completed||card.archived_at)),idList:card.trello_list_id};
      if(card.trello_card_id){
        await this.request(`cards/${card.trello_card_id}`,'PUT',data);
        await this.db.query('UPDATE trello_card_mappings SET last_orbit_update=now() WHERE connection_id=$1 AND trello_card_id=$2',[connection.id,card.trello_card_id]);
      }else{
        const remote=await this.request<TrelloCard>('cards','POST',data);
        await this.db.query('INSERT INTO trello_card_mappings(connection_id,trello_card_id,orbit_card_id,last_trello_activity,last_orbit_update) VALUES($1,$2,$3,now(),now())',[connection.id,remote.id,card.id]);
      }
      changed=true;
    }
    return changed;
  }
  async sync(id:string){if(this.syncing.has(id))return {id,status:'running'};this.syncing.add(id);try{const connection=await this.db.one<Connection>('SELECT * FROM trello_connections WHERE id=$1 AND enabled',[id]);if(!connection)return {id,status:'disabled'};const pushed=await this.pushPending(connection);const mappings=await this.db.query<{trello_list_id:string;orbit_list_id:string}>('SELECT trello_list_id,orbit_list_id FROM trello_list_mappings WHERE connection_id=$1',[id]);const labelIds=await this.labels(connection.board_id,connection.trello_board_name);let cardCount=0,changed=false;for(const mapping of mappings){const remoteCards=await this.request<TrelloCard[]>(`lists/${mapping.trello_list_id}/cards`,'GET',{fields:'name,desc,due,closed,dateLastActivity,pos',filter:'all'});for(let cardIndex=0;cardIndex<remoteCards.length;cardIndex++){if(await this.pullCard(connection,mapping.orbit_list_id,remoteCards[cardIndex],cardIndex,labelIds))changed=true;cardCount++;}}await this.db.query('UPDATE trello_connections SET last_synced_at=now(),last_error=NULL WHERE id=$1',[id]);if(changed||pushed)this.events.boardChanged(connection.board_id,changed?'trello':'orbit');return {id,status:'ok',lists:mappings.length,cards:cardCount};}catch(reason){const message=reason instanceof Error?reason.message:'Falha desconhecida.';await this.db.query('UPDATE trello_connections SET last_error=$2 WHERE id=$1',[id,message.slice(0,1000)]).catch(()=>undefined);throw reason;}finally{this.syncing.delete(id)}}
  async tick(){const rows=await this.db.query<{id:string}>('SELECT id FROM trello_connections WHERE enabled');await Promise.all(rows.map(row=>this.sync(row.id).catch(()=>undefined)));}
  async connectDefault(){const orbit=process.env.TRELLO_DEFAULT_ORBIT_BOARD_ID||defaultOrbitBoard;const source=process.env.TRELLO_DEFAULT_BOARD_ID||defaultTrelloBoard;const target=await this.db.one<{owner_id:string}>('SELECT owner_id FROM boards WHERE id=$1',[orbit]);if(target)await this.connect(orbit,target.owner_id,source);}
}

@Controller()
export class TrelloController {
  constructor(@Inject(TrelloSyncService) private trello:TrelloSyncService,@Inject(FeaturesService) private features:FeaturesService){}
  @Get('boards/:id/trello') connections(@Req() req:Request,@Param('id') boardId:string){return this.trello.connections(boardId,this.features.user(req))}
  @Get('boards/:id/trello/available') available(@Req() req:Request,@Param('id') boardId:string){return this.trello.available(boardId,this.features.user(req))}
  @Post('boards/:id/trello') connect(@Req() req:Request,@Param('id') boardId:string,@Body() body:Record<string,unknown>){return this.trello.connect(boardId,this.features.user(req),body.trello_board_id)}
  @Post('boards/:id/trello/sync') sync(@Req() req:Request,@Param('id') boardId:string){return this.trello.syncBoard(boardId,this.features.user(req))}
  @Delete('boards/:id/trello/:connectionId') disconnect(@Req() req:Request,@Param('id') boardId:string,@Param('connectionId') connectionId:string){return this.trello.disconnect(boardId,this.features.user(req),connectionId)}
  @Get('lists/:id/trello') listOptions(@Req() req:Request,@Param('id') listId:string){return this.trello.listOptions(listId,this.features.user(req))}
  @Patch('lists/:id/trello') mapList(@Req() req:Request,@Param('id') listId:string,@Body() body:Record<string,unknown>){return this.trello.mapList(listId,this.features.user(req),body.connection_id,body.trello_list_id)}
}
