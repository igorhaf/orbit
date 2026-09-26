import { Body, Controller, Delete, Get, HttpException, Injectable, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { Db } from './db';

export const SINGLE_EMAIL = 'igorhaf@gmail.com';
const bad = (message: string, status = 400): never => { throw new HttpException({ message }, status); };
const validId = (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) bad('ID inválido.');
  return id;
};
const bounded = (value: unknown, label: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) bad(`${label} inválido.`);
  return (value as string).trim();
};

@Injectable()
export class FeaturesService {
  constructor(private db: Db) {}

  user(req: Request): string {
    const token = req.headers.authorization?.replace(/^Bearer /i, '');
    if (!token) bad('Faça login para continuar.', 401);
    try {
      const payload = jwt.verify(token!, process.env.JWT_SECRET!) as { sub: string; email?: string };
      if (payload.email !== SINGLE_EMAIL) bad('Sessão inválida. Entre novamente.', 401);
      return payload.sub;
    } catch { return bad('Sessão expirada. Entre novamente.', 401); }
  }

  async member(boardId: string, userId: string) {
    validId(boardId);
    const row = await this.db.one('SELECT bm.role,b.closed_at FROM board_members bm JOIN boards b ON b.id=bm.board_id WHERE bm.board_id=$1 AND bm.user_id=$2', [boardId, userId]);
    if (!row) return bad('Quadro não encontrado.', 404);
    if (row.closed_at) bad('Este quadro está fechado. Reabra-o para editar.', 409);
  }

  async cardBoard(cardId: string, userId: string): Promise<string> {
    validId(cardId);
    const row = await this.db.one('SELECT l.board_id,l.archived_at AS list_archived,c.archived_at AS card_archived,c.kind FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=$1', [cardId]);
    if (!row) return bad('Cartão não encontrado.', 404);
    await this.member(row.board_id, userId);
    if (row.list_archived || row.card_archived) bad('Este cartão está arquivado.',409);
    if(!['normal','template'].includes(row.kind))bad('Este tipo de cartão não possui detalhes editáveis.',409);
    return row.board_id;
  }

  async account(userId: string) {
    const account = await this.db.one('SELECT id,name,email,avatar_url,preferences,created_at FROM users WHERE id=$1 AND email=$2', [userId, SINGLE_EMAIL]);
    if (!account) return bad('Conta não encontrada.', 404);
    return account;
  }

  async updateProfile(userId: string, body: Record<string, unknown>) {
    const name = body.name === undefined ? null : bounded(body.name, 'Nome', 120);
    let avatar: string | null | undefined;
    if (body.avatar_url !== undefined) {
      if (body.avatar_url === null || body.avatar_url === '') avatar = null;
      else if (typeof body.avatar_url === 'string' && body.avatar_url.length <= 350000 &&
        (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(body.avatar_url) || /^https:\/\//i.test(body.avatar_url))) avatar = body.avatar_url;
      else bad('Imagem de perfil inválida. Use PNG, JPEG, WebP ou uma URL HTTPS.');
    }
    await this.db.query('UPDATE users SET name=COALESCE($2,name),avatar_url=CASE WHEN $3::boolean THEN $4::text ELSE avatar_url END WHERE id=$1', [userId,name,avatar!==undefined,avatar??null]);
    return this.account(userId);
  }

  async updatePreferences(userId: string, body: Record<string, unknown>) {
    const allowed = ['theme','notifications','browserNotifications','shortcuts','compactCards'];
    const changes: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      if (key === 'theme') {
        if (!['light','dark'].includes(String(body[key]))) bad('Tema inválido.');
        changes.theme = body[key];
      } else {
        if (typeof body[key] !== 'boolean') bad(`Preferência ${key} inválida.`);
        changes[key] = body[key];
      }
    }
    await this.db.query('UPDATE users SET preferences=preferences || $2::jsonb WHERE id=$1', [userId,JSON.stringify(changes)]);
    return this.account(userId);
  }

  async workspaces(userId: string) {
    return this.db.query(`SELECT w.id,w.name,w.created_at,count(b.id)::int AS board_count
      FROM workspaces w LEFT JOIN boards b ON b.workspace_id=w.id AND b.closed_at IS NULL
      WHERE w.owner_id=$1 GROUP BY w.id ORDER BY w.created_at`, [userId]);
  }

  async createWorkspace(userId: string, body: Record<string, unknown>) {
    const name = bounded(body.name, 'Nome', 120);
    const workspace=await this.db.one('INSERT INTO workspaces(owner_id,name) VALUES($1,$2) RETURNING id,name,created_at', [userId,name]);
    await this.record(userId,null,null,'workspace_created',`criou a área de trabalho ${name}`);
    return workspace;
  }

  async visit(boardId: string, userId: string) {
    await this.db.query(`INSERT INTO board_visits(board_id,user_id,visited_at) VALUES($1,$2,now())
      ON CONFLICT(board_id,user_id) DO UPDATE SET visited_at=excluded.visited_at`, [boardId,userId]);
  }

  async reorderFavorites(userId: string, ids: unknown) {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(x=>typeof x!=='string' || !/^[0-9a-f-]{36}$/i.test(x)) || new Set(ids).size!==ids.length) bad('Ordem inválida.');
    const favoriteIds=ids as string[];
    const count = await this.db.one(`SELECT count(*)::int AS total FROM boards b JOIN board_members bm ON bm.board_id=b.id
      WHERE bm.user_id=$1 AND b.starred AND b.closed_at IS NULL`, [userId]);
    if (Number(count?.total)!==favoriteIds.length) bad('Inclua todos os quadros favoritos.');
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i=0;i<favoriteIds.length;i++) {
        const result=await client.query(`UPDATE boards b SET favorite_position=$3 FROM board_members bm
          WHERE b.id=$1 AND bm.board_id=b.id AND bm.user_id=$2 AND b.starred RETURNING b.id`, [favoriteIds[i],userId,i]);
        if (result.rowCount!==1) bad('Quadro favorito não encontrado.',404);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return { ok: true };
  }

  async toggleAssignee(cardId: string, userId: string) {
    return this.toggleCardMember(cardId,userId,userId);
  }

  async toggleCardMember(cardId: string, actorId: string, memberId: string) {
    const boardId=await this.cardBoard(cardId,actorId);
    validId(memberId);
    if (!await this.db.one('SELECT 1 FROM board_members WHERE board_id=$1 AND user_id=$2',[boardId,memberId])) bad('Membro não pertence ao quadro.',404);
    const existing=await this.db.one('SELECT 1 FROM card_assignees WHERE card_id=$1 AND user_id=$2',[cardId,memberId]);
    if (existing) await this.db.query('DELETE FROM card_assignees WHERE card_id=$1 AND user_id=$2',[cardId,memberId]);
    else {
      await this.db.query('INSERT INTO card_assignees(card_id,user_id) VALUES($1,$2)',[cardId,memberId]);
      await this.db.query('INSERT INTO card_watchers(card_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[cardId,memberId]);
    }
    await this.record(actorId,boardId,cardId,existing?'unassigned':'assigned',existing?'removeu um membro do cartão':'atribuiu um membro ao cartão');
    if (!existing) {
      const card=await this.db.one('SELECT title FROM cards WHERE id=$1',[cardId]);
      await this.notify(memberId,boardId,cardId,'assignment','Cartão atribuído a você',card?.title||'');
    }
    return { assigned: !existing };
  }

  async notifyAssignees(actorId: string, boardId: string, cardId: string, kind: string, title: string, body: string) {
    const members=await this.db.query('SELECT user_id FROM card_assignees WHERE card_id=$1 AND user_id<>$2',[cardId,actorId]);
    for (const member of members) await this.notify(member.user_id,boardId,cardId,kind,title,body);
  }

  async record(actorId: string, boardId: string | null, cardId: string | null, kind: string, body: string) {
    await this.db.query('INSERT INTO activities(actor_id,board_id,card_id,kind,body) VALUES($1,$2,$3,$4,$5)',[actorId,boardId,cardId,kind,body.slice(0,1000)]);
    if(boardId) await this.notifyWatchers(actorId,boardId,cardId,kind,body);
  }

  async notify(userId: string, boardId: string, cardId: string | null, kind: string, title: string, body: string) {
    const account=await this.account(userId);
    if (!account.preferences.notifications) return;
    await this.db.query(`INSERT INTO notifications(user_id,board_id,card_id,kind,title,body)
      VALUES($1,$2,$3,$4,$5,$6)`, [userId,boardId,cardId,kind,title,body.slice(0,300)]);
  }

  async mention(userId: string, boardId: string, cardId: string, body: string) {
    const targets=new Set<string>();
    if(/@card\b/i.test(body)) for(const row of await this.db.query('SELECT user_id FROM card_assignees WHERE card_id=$1',[cardId]))targets.add(row.user_id);
    if(/@board\b/i.test(body)) for(const row of await this.db.query('SELECT user_id FROM board_members WHERE board_id=$1',[boardId]))targets.add(row.user_id);
    if(/@(igor|igorhaf)\b/i.test(body))targets.add(userId);
    if(!targets.size)return;
    const card=await this.db.one('SELECT title FROM cards WHERE id=$1',[cardId]);
    for(const target of targets)await this.notify(target,boardId,cardId,'mention',`Menção em ${card?.title||'um cartão'}`,body);
  }

  private async notifyWatchers(actorId:string,boardId:string,cardId:string|null,kind:string,body:string){
    const ids=new Set<string>();
    for(const row of await this.db.query('SELECT user_id FROM board_watchers WHERE board_id=$1',[boardId]))ids.add(row.user_id);
    if(cardId){
      for(const row of await this.db.query('SELECT user_id FROM card_watchers WHERE card_id=$1',[cardId]))ids.add(row.user_id);
      for(const row of await this.db.query('SELECT lw.user_id FROM list_watchers lw JOIN cards c ON c.list_id=lw.list_id WHERE c.id=$1',[cardId]))ids.add(row.user_id);
    }
    const card=cardId?await this.db.one('SELECT title FROM cards WHERE id=$1',[cardId]):null;
    for(const id of ids)if(id!==actorId)await this.notify(id,boardId,cardId,kind,`Atualização em ${card?.title||'quadro'}`,body);
  }

  async watches(cardId:string,userId:string){
    const boardId=await this.cardBoard(cardId,userId);
    const list=await this.db.one('SELECT list_id FROM cards WHERE id=$1',[cardId]);
    return {
      card:Boolean(await this.db.one('SELECT 1 FROM card_watchers WHERE card_id=$1 AND user_id=$2',[cardId,userId])),
      list:Boolean(await this.db.one('SELECT 1 FROM list_watchers WHERE list_id=$1 AND user_id=$2',[list!.list_id,userId])),
      board:Boolean(await this.db.one('SELECT 1 FROM board_watchers WHERE board_id=$1 AND user_id=$2',[boardId,userId])),
    };
  }
  async toggleWatch(scope:'card'|'list'|'board',id:string,userId:string){
    validId(id); let boardId:string;let table:string;let key:string;
    if(scope==='card'){boardId=await this.cardBoard(id,userId);table='card_watchers';key='card_id'}
    else if(scope==='list'){const row=await this.db.one('SELECT board_id FROM lists WHERE id=$1',[id]);if(!row)bad('Lista não encontrada.',404);await this.member(row!.board_id,userId);boardId=row!.board_id;table='list_watchers';key='list_id'}
    else {await this.member(id,userId);boardId=id;table='board_watchers';key='board_id'}
    const existing=await this.db.one(`SELECT 1 FROM ${table} WHERE ${key}=$1 AND user_id=$2`,[id,userId]);
    if(existing)await this.db.query(`DELETE FROM ${table} WHERE ${key}=$1 AND user_id=$2`,[id,userId]);
    else await this.db.query(`INSERT INTO ${table}(${key},user_id) VALUES($1,$2)`,[id,userId]);
    await this.record(userId,boardId,scope==='card'?id:null,existing?'watch_stopped':'watch_started',existing?'parou de acompanhar':'começou a acompanhar');
    return {watching:!existing};
  }

  async home(userId: string) {
    const [upNext, highlights, yourItems, recentBoards, favorites, recentConversations] = await Promise.all([
      this.db.query(`SELECT c.id,c.title,c.description,c.due_date,c.completed,c.list_id,l.title AS list_title,
        (c.due_date IS NOT NULL AND c.due_date<now()) AS overdue,
        b.id AS board_id,b.title AS board_title,b.background,ca.user_id IS NOT NULL AS assigned_to_me
        FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id
        JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$1
        LEFT JOIN card_assignees ca ON ca.card_id=c.id AND ca.user_id=$1
        WHERE b.closed_at IS NULL AND l.archived_at IS NULL AND c.archived_at IS NULL AND NOT c.completed AND ((c.due_date IS NOT NULL AND c.due_date<=now()+interval '7 days') OR ca.user_id IS NOT NULL)
        ORDER BY c.due_date ASC NULLS LAST,c.updated_at DESC LIMIT 40`,[userId]),
      this.activities(userId,18),
      this.db.query(`SELECT ci.id,ci.text,ci.completed,ci.due_date,c.id AS card_id,c.title AS card_title,
        (ci.due_date IS NOT NULL AND ci.due_date<now()) AS overdue,
        b.id AS board_id,b.title AS board_title FROM checklist_items ci
        JOIN cards c ON c.id=ci.card_id JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id
        JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$1
        WHERE ci.assignee_id=$1 AND b.closed_at IS NULL AND l.archived_at IS NULL AND c.archived_at IS NULL ORDER BY ci.completed,ci.due_date ASC NULLS LAST,ci.position LIMIT 80`,[userId]),
      this.db.query(`SELECT b.id,b.title,b.background,b.starred,b.workspace_id,w.name AS workspace_name,v.visited_at,
        (SELECT 'data:'||m.mime_type||';base64,'||replace(encode(m.data,'base64'), E'\n', '') FROM board_media m WHERE m.board_id=b.id) AS background_image
        FROM board_visits v JOIN boards b ON b.id=v.board_id
        JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$1
        LEFT JOIN workspaces w ON w.id=b.workspace_id WHERE v.user_id=$1 AND b.closed_at IS NULL ORDER BY v.visited_at DESC LIMIT 8`,[userId]),
      this.db.query(`SELECT b.id,b.title,b.background,b.starred,b.workspace_id,w.name AS workspace_name,b.favorite_position,
        (SELECT 'data:'||m.mime_type||';base64,'||replace(encode(m.data,'base64'), E'\n', '') FROM board_media m WHERE m.board_id=b.id) AS background_image
        FROM boards b JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$1
        LEFT JOIN workspaces w ON w.id=b.workspace_id WHERE b.starred AND b.closed_at IS NULL ORDER BY b.favorite_position ASC NULLS LAST,b.created_at DESC`,[userId]),
      this.db.query(`SELECT cm.id,cm.body,cm.created_at,c.id AS card_id,c.title AS card_title,
        b.id AS board_id,b.title AS board_title,u.name AS author_name
        FROM comments cm JOIN users u ON u.id=cm.author_id JOIN cards c ON c.id=cm.card_id
        JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id
        JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$1
        WHERE b.closed_at IS NULL AND l.archived_at IS NULL AND c.archived_at IS NULL ORDER BY cm.created_at DESC LIMIT 6`,[userId]),
    ]);
    return { upNext,highlights,yourItems,recentBoards,favorites,recentConversations };
  }

  async activities(userId: string, limit=30) {
    return this.db.query(`SELECT a.id,a.kind,a.body,a.created_at,a.card_id,a.board_id,
      b.title AS board_title,c.title AS card_title,u.name AS actor_name
      FROM activities a JOIN users u ON u.id=a.actor_id
      LEFT JOIN boards b ON b.id=a.board_id LEFT JOIN cards c ON c.id=a.card_id
      WHERE (a.board_id IS NULL OR b.closed_at IS NULL) AND (a.actor_id=$1 OR (a.board_id IS NOT NULL AND EXISTS
        (SELECT 1 FROM board_members bm WHERE bm.board_id=a.board_id AND bm.user_id=$1)))
      ORDER BY a.created_at DESC LIMIT $2`,[userId,Math.min(limit,100)]);
  }

  async assignedCards(userId: string) {
    return this.db.query(`SELECT c.id,c.title,c.description,c.due_date,c.completed,b.id AS board_id,
      b.title AS board_title,b.background,l.title AS list_title
      FROM card_assignees ca JOIN cards c ON c.id=ca.card_id JOIN lists l ON l.id=c.list_id
      JOIN boards b ON b.id=l.board_id JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$1
      WHERE ca.user_id=$1 AND b.closed_at IS NULL AND l.archived_at IS NULL AND c.archived_at IS NULL ORDER BY c.completed,c.due_date ASC NULLS LAST,c.updated_at DESC`,[userId]);
  }

  async search(userId: string, term: string) {
    const q=term.trim().slice(0,100);
    if (q.length<2) return { boards: [], cards: [] };
    const pattern=`%${q}%`;
    const [boards,cards]=await Promise.all([
      this.db.query(`SELECT b.id,b.title,b.background,b.starred,w.name AS workspace_name
        FROM boards b JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$1
        LEFT JOIN workspaces w ON w.id=b.workspace_id WHERE b.closed_at IS NULL AND b.title ILIKE $2 ORDER BY b.starred DESC,b.title LIMIT 12`,[userId,pattern]),
      this.db.query(`SELECT c.id,c.title,c.description,c.due_date,c.completed,b.id AS board_id,b.title AS board_title,
        l.title AS list_title FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id
        JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$1
        WHERE b.closed_at IS NULL AND l.archived_at IS NULL AND c.archived_at IS NULL AND (c.title ILIKE $2 OR c.description ILIKE $2) ORDER BY c.updated_at DESC LIMIT 20`,[userId,pattern]),
    ]);
    return { boards,cards };
  }

  async planner(userId:string, boardId?:string) {
    const boardFilter=boardId?` AND b.id=$2`:''; const params=boardId?[userId,validId(boardId)]:[userId];
    const cards=await this.db.query(`SELECT c.id,c.title,c.due_date,c.completed,b.id AS board_id,b.title AS board_title,l.title AS list_title
      FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN board_members bm ON bm.board_id=b.id
      LEFT JOIN card_assignees ca ON ca.card_id=c.id AND ca.user_id=$1 WHERE bm.user_id=$1 AND (ca.user_id=$1 OR b.is_inbox) AND c.due_date IS NOT NULL AND c.archived_at IS NULL AND l.archived_at IS NULL AND b.closed_at IS NULL${boardFilter} ORDER BY c.due_date`,params);
    const events=await this.db.query(`SELECT e.id,e.title,e.starts_at,e.ends_at,COALESCE(json_agg(json_build_object('id',c.id,'title',c.title,'board_id',b.id)) FILTER(WHERE c.id IS NOT NULL),'[]') AS cards FROM focus_events e LEFT JOIN focus_event_cards fec ON fec.event_id=e.id LEFT JOIN cards c ON c.id=fec.card_id LEFT JOIN lists l ON l.id=c.list_id LEFT JOIN boards b ON b.id=l.board_id WHERE e.user_id=$1 GROUP BY e.id ORDER BY e.starts_at`,[userId]);
    return {cards,events};
  }
  async createFocus(userId:string,body:Record<string,unknown>){const title=body.title===undefined?'Focus time':bounded(body.title,'Título',160);const start=new Date(bounded(body.starts_at,'Início',40)),end=new Date(bounded(body.ends_at,'Fim',40));if(Number.isNaN(+start)||Number.isNaN(+end)||end<=start)bad('Intervalo inválido.');return this.db.one('INSERT INTO focus_events(user_id,title,starts_at,ends_at) VALUES($1,$2,$3,$4) RETURNING *',[userId,title,start,end]);}
  async linkFocus(userId:string,eventId:string,cardId:string){validId(eventId);await this.cardBoard(cardId,userId);const event=await this.db.one('SELECT id FROM focus_events WHERE id=$1 AND user_id=$2',[eventId,userId]);if(!event)bad('Bloco de foco não encontrado.',404);await this.db.query('INSERT INTO focus_event_cards(event_id,card_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[eventId,validId(cardId)]);return {ok:true};}
  async unlinkFocus(userId:string,eventId:string,cardId:string){validId(eventId);await this.db.query('DELETE FROM focus_event_cards fec USING focus_events e WHERE fec.event_id=$1 AND fec.card_id=$2 AND e.id=fec.event_id AND e.user_id=$3',[eventId,validId(cardId),userId]);return {ok:true};}

  async notifications(userId: string) {
    const account=await this.account(userId);
    await this.db.query(`DELETE FROM notifications n WHERE n.user_id=$1 AND n.kind='due'
      AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.id=n.card_id AND NOT c.completed AND c.archived_at IS NULL
        AND c.due_date=n.due_at AND c.reminder_minutes IS NOT NULL
        AND EXISTS (SELECT 1 FROM lists l JOIN boards b ON b.id=l.board_id WHERE l.id=c.list_id AND l.archived_at IS NULL AND b.closed_at IS NULL))`,[userId]);
    if (account.preferences.notifications) {
      await this.db.query(`INSERT INTO notifications(user_id,board_id,card_id,kind,title,body,due_at)
        SELECT $1,b.id,c.id,'due',CASE WHEN c.due_date<now() THEN 'Cartão vencido' ELSE 'Prazo próximo' END,
          c.title,c.due_date FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id
        JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$1
        WHERE b.closed_at IS NULL AND l.archived_at IS NULL AND c.archived_at IS NULL AND NOT c.completed AND c.due_date IS NOT NULL
          AND c.reminder_minutes IS NOT NULL AND c.due_date<=now()+c.reminder_minutes*interval '1 minute'
        ON CONFLICT DO NOTHING`,[userId]);
    }
    return this.db.query(`SELECT n.id,n.kind,n.title,n.body,n.created_at,n.read_at,n.board_id,n.card_id,
      b.title AS board_title FROM notifications n LEFT JOIN boards b ON b.id=n.board_id
      WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 80`,[userId]);
  }

  async markNotification(userId: string, id: string) {
    validId(id);
    const result=await this.db.one('UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id',[id,userId]);
    if (!result) bad('Notificação não encontrada.',404);
    return {ok:true};
  }

  async markAllNotifications(userId: string) {
    await this.db.query('UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND read_at IS NULL',[userId]);
    return {ok:true};
  }
}

@Controller()
export class FeaturesController {
  constructor(private features: FeaturesService) {}
  @Get('account') account(@Req() req: Request) { return this.features.account(this.features.user(req)); }
  @Patch('account') updateAccount(@Req() req: Request,@Body() body: Record<string, unknown>) { return this.features.updateProfile(this.features.user(req),body); }
  @Patch('account/preferences') preferences(@Req() req: Request,@Body() body: Record<string, unknown>) { return this.features.updatePreferences(this.features.user(req),body); }
  @Get('account/activity') activity(@Req() req: Request) { return this.features.activities(this.features.user(req),60); }
  @Get('account/cards') cards(@Req() req: Request) { return this.features.assignedCards(this.features.user(req)); }
  @Get('home') home(@Req() req: Request) { return this.features.home(this.features.user(req)); }
  @Get('workspaces') workspaces(@Req() req: Request) { return this.features.workspaces(this.features.user(req)); }
  @Post('workspaces') createWorkspace(@Req() req: Request,@Body() body: Record<string, unknown>) { return this.features.createWorkspace(this.features.user(req),body); }
  @Patch('favorites/reorder') favorites(@Req() req: Request,@Body() body: {ids: string[]}) { return this.features.reorderFavorites(this.features.user(req),body.ids); }
  @Post('cards/:id/assignee/toggle') toggleAssignee(@Req() req: Request,@Param('id') id: string) { return this.features.toggleAssignee(id,this.features.user(req)); }
  @Post('cards/:id/assignees/:userId/toggle') toggleCardMember(@Req() req: Request,@Param('id') id: string,@Param('userId') userId: string) { return this.features.toggleCardMember(id,this.features.user(req),userId); }
  @Get('cards/:id/watches') watches(@Req() req:Request,@Param('id') id:string){return this.features.watches(id,this.features.user(req));}
  @Post('cards/:id/watch/toggle') watchCard(@Req() req:Request,@Param('id') id:string){return this.features.toggleWatch('card',id,this.features.user(req));}
  @Post('lists/:id/watch/toggle') watchList(@Req() req:Request,@Param('id') id:string){return this.features.toggleWatch('list',id,this.features.user(req));}
  @Post('boards/:id/watch/toggle') watchBoard(@Req() req:Request,@Param('id') id:string){return this.features.toggleWatch('board',id,this.features.user(req));}
  @Get('search') search(@Req() req: Request,@Query('q') q='') { return this.features.search(this.features.user(req),q); }
  @Get('planner') planner(@Req() req:Request,@Query('board_id') boardId?:string){return this.features.planner(this.features.user(req),boardId);}
  @Post('planner/focus-events') focus(@Req() req:Request,@Body() body:Record<string,unknown>){return this.features.createFocus(this.features.user(req),body);}
  @Post('planner/focus-events/:id/cards/:cardId') linkFocus(@Req() req:Request,@Param('id') id:string,@Param('cardId') cardId:string){return this.features.linkFocus(this.features.user(req),id,cardId);}
  @Delete('planner/focus-events/:id/cards/:cardId') unlinkFocus(@Req() req:Request,@Param('id') id:string,@Param('cardId') cardId:string){return this.features.unlinkFocus(this.features.user(req),id,cardId);}
  @Get('notifications') notifications(@Req() req: Request) { return this.features.notifications(this.features.user(req)); }
  @Patch('notifications/read-all') readAll(@Req() req: Request) { return this.features.markAllNotifications(this.features.user(req)); }
  @Patch('notifications/:id/read') read(@Req() req: Request,@Param('id') id: string) { return this.features.markNotification(this.features.user(req),id); }
}
