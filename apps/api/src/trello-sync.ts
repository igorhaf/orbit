import { HttpException, Inject, Injectable } from '@nestjs/common';
import { config as loadEnv } from 'dotenv';
import { Db } from './db';
import { FeaturesService } from './features';
import { OrbitEvents } from './orbit-events';

type Connection = { id:string; board_id:string; trello_board_id:string; trello_board_name:string; created_by:string; created_at:Date };
type TrelloBoard = { id:string; name:string; closed?:boolean; url?:string };
type TrelloList = { id:string; name:string; closed?:boolean; pos?:number };
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
export class TrelloSyncService {
  private configured=false;
  private syncing=new Set<string>();
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(OrbitEvents) private events:OrbitEvents){}

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
    ON CONFLICT(board_id,trello_board_id) DO UPDATE SET enabled=true,trello_board_name=EXCLUDED.trello_board_name RETURNING *`,[boardId,remote.id,remote.name,userId]);await this.sync(connection!.id);return this.connection(String(connection!.id));}
  private connection(id:string){return this.db.one('SELECT id,trello_board_id,trello_board_name,enabled,last_synced_at,last_error,created_at FROM trello_connections WHERE id=$1',[id])}
  async disconnect(boardId:string,userId:string,id:string){await this.access(boardId,userId);const removed=await this.db.one('DELETE FROM trello_connections WHERE id=$1 AND board_id=$2 RETURNING id',[id,boardId]);if(!removed)fail('Conexão Trello não encontrada.',404);return {ok:true}}
  async syncBoard(boardId:string,userId:string){await this.access(boardId,userId);const rows=await this.db.query<{id:string}>('SELECT id FROM trello_connections WHERE board_id=$1 AND enabled',[boardId]);return {connections:await Promise.all(rows.map(row=>this.sync(row.id)))};}
  private async labels(boardId:string,source:string){const ensure=async(name:string,color:string)=>{const existing=await this.db.one<{id:string}>('SELECT id FROM labels WHERE board_id=$1 AND name=$2 LIMIT 1',[boardId,name]);if(existing)return existing.id;return String((await this.db.one<{id:string}>('INSERT INTO labels(board_id,name,color) VALUES($1,$2,$3) RETURNING id',[boardId,name,color]))!.id)};return [await ensure('trello','blue'),await ensure(source,'purple')];}
  private async localList(connection:Connection,remote:TrelloList,index:number){const found=await this.db.one<{orbit_list_id:string}>('SELECT orbit_list_id FROM trello_list_mappings WHERE connection_id=$1 AND trello_list_id=$2',[connection.id,remote.id]);const title=`Trello · ${connection.trello_board_name} · ${remote.name}`.slice(0,160);if(found){await this.db.query('UPDATE lists SET title=$2,position=$3,archived_at=$4 WHERE id=$1',[found.orbit_list_id,title,index,remote.closed?new Date():null]);await this.db.query('UPDATE trello_list_mappings SET trello_list_name=$3 WHERE connection_id=$1 AND trello_list_id=$2',[connection.id,remote.id,remote.name]);return found.orbit_list_id}const created=await this.db.one<{id:string}>('INSERT INTO lists(board_id,title,position,archived_at) VALUES($1,$2,$3,$4) RETURNING id',[connection.board_id,title,index,remote.closed?new Date():null]);await this.db.query('INSERT INTO trello_list_mappings(connection_id,trello_list_id,trello_list_name,orbit_list_id) VALUES($1,$2,$3,$4)',[connection.id,remote.id,remote.name,created!.id]);return created!.id;}
  private async pushLists(connection:Connection){const connections=await this.db.query<{id:string}>('SELECT id FROM trello_connections WHERE board_id=$1 AND enabled',[connection.board_id]);const unmapped=await this.db.query<{id:string;title:string;position:number}>('SELECT l.id,l.title,l.position FROM lists l WHERE l.board_id=$1 AND l.created_at>=$2 AND l.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM trello_list_mappings lm WHERE lm.orbit_list_id=l.id)',[connection.board_id,connection.created_at]);if(connections.length===1){for(const list of unmapped){const remote=await this.request<TrelloList>('lists','POST',{name:list.title.slice(0,160),idBoard:connection.trello_board_id,pos:String(list.position)});await this.db.query('INSERT INTO trello_list_mappings(connection_id,trello_list_id,trello_list_name,orbit_list_id) VALUES($1,$2,$3,$4)',[connection.id,remote.id,remote.name,list.id]);}}const mapped=await this.db.query<{trello_list_id:string;trello_list_name:string|null;title:string}>('SELECT lm.trello_list_id,lm.trello_list_name,l.title FROM trello_list_mappings lm JOIN lists l ON l.id=lm.orbit_list_id WHERE lm.connection_id=$1 AND l.archived_at IS NULL',[connection.id]);const prefix=`Trello · ${connection.trello_board_name} · `;for(const list of mapped){const name=(list.title.startsWith(prefix)?list.title.slice(prefix.length):list.title).trim().slice(0,160);if(name&&name!==list.trello_list_name){await this.request(`lists/${list.trello_list_id}`,'PUT',{name});await this.db.query('UPDATE trello_list_mappings SET trello_list_name=$3 WHERE connection_id=$1 AND trello_list_id=$2',[connection.id,list.trello_list_id,name]);}}}
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
  async sync(id:string){if(this.syncing.has(id))return {id,status:'running'};this.syncing.add(id);try{const connection=await this.db.one<Connection>('SELECT * FROM trello_connections WHERE id=$1 AND enabled',[id]);if(!connection)return {id,status:'disabled'};await this.pushLists(connection);const pushed=await this.pushPending(connection);const remoteLists=await this.request<TrelloList[]>(`boards/${connection.trello_board_id}/lists`,'GET',{fields:'name,closed,pos',filter:'all'});const labelIds=await this.labels(connection.board_id,connection.trello_board_name);let cardCount=0,changed=false;for(let listIndex=0;listIndex<remoteLists.length;listIndex++){const remoteList=remoteLists[listIndex],listId=await this.localList(connection,remoteList,listIndex);const remoteCards=await this.request<TrelloCard[]>(`lists/${remoteList.id}/cards`,'GET',{fields:'name,desc,due,closed,dateLastActivity,pos',filter:'all'});for(let cardIndex=0;cardIndex<remoteCards.length;cardIndex++){if(await this.pullCard(connection,listId,remoteCards[cardIndex],cardIndex,labelIds))changed=true;cardCount++;}}await this.db.query('UPDATE trello_connections SET last_synced_at=now(),last_error=NULL WHERE id=$1',[id]);if(changed||pushed)this.events.boardChanged(connection.board_id,changed?'trello':'orbit');return {id,status:'ok',lists:remoteLists.length,cards:cardCount};}catch(reason){const message=reason instanceof Error?reason.message:'Falha desconhecida.';await this.db.query('UPDATE trello_connections SET last_error=$2 WHERE id=$1',[id,message.slice(0,1000)]).catch(()=>undefined);throw reason;}finally{this.syncing.delete(id)}}
  async tick(){const rows=await this.db.query<{id:string}>('SELECT id FROM trello_connections WHERE enabled');await Promise.all(rows.map(row=>this.sync(row.id).catch(()=>undefined)));}
  async connectDefault(){const orbit=process.env.TRELLO_DEFAULT_ORBIT_BOARD_ID||defaultOrbitBoard;const source=process.env.TRELLO_DEFAULT_BOARD_ID||defaultTrelloBoard;const target=await this.db.one<{owner_id:string}>('SELECT owner_id FROM boards WHERE id=$1',[orbit]);if(target)await this.connect(orbit,target.owner_id,source);}
}
