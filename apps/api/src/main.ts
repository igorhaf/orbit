import 'reflect-metadata';
import 'dotenv/config';
import { Module, Injectable, Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Request, json } from 'express';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { Db } from './db';
import { FeaturesController, FeaturesService, SINGLE_EMAIL } from './features';

type Payload = Record<string, unknown>;
const fail = (message: string, code = 400): never => { throw new HttpException({ message }, code); };
const value = (v: unknown, name: string, max = 300) => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) fail(`${name} inválido.`);
  return (v as string).trim();
};
const optionalText = (v: unknown, max = 10000) => {
  if (typeof v !== 'string' || v.length > max) fail('Texto inválido.');
  return v as string;
};
const optionalDate = (v: unknown): Date | null => {
  if (v === null || v === '') return null;
  if (typeof v !== 'string') return fail('Data inválida.');
  const date = new Date(v);
  if (Number.isNaN(date.getTime())) return fail('Data inválida.');
  return date;
};
const uuid = (v: string) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) fail('ID inválido.'); return v; };

@Injectable()
class Service {
  constructor(private db: Db, private features: FeaturesService) {}
  user(req: Request) { return this.features.user(req); }
  async member(boardId: string, userId: string, allowClosed = false) {
    uuid(boardId);
    const row = await this.db.one('SELECT bm.role,b.closed_at FROM board_members bm JOIN boards b ON b.id=bm.board_id WHERE bm.board_id=$1 AND bm.user_id=$2', [boardId, userId]);
    if (!row) return fail('Quadro não encontrado.', 404);
    if (row.closed_at && !allowClosed) fail('Este quadro está fechado. Reabra-o para editar.', 409);
    return row;
  }
  async listBoard(listId: string, userId: string) {
    uuid(listId);
    const row = await this.db.one('SELECT board_id FROM lists WHERE id=$1', [listId]);
    if (!row) return fail('Lista não encontrada.', 404);
    await this.member(row.board_id, userId);
    return row.board_id as string;
  }
  async cardBoard(cardId: string, userId: string, allowClosed = false) {
    uuid(cardId);
    const row = await this.db.one('SELECT l.board_id FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=$1', [cardId]);
    if (!row) return fail('Cartão não encontrado.', 404);
    await this.member(row.board_id, userId, allowClosed);
    return row.board_id as string;
  }
  async register() { return fail('Cadastro desativado. Este espaço usa uma conta única.', 403); }
  async login(body: Payload) {
    const email = value(body.email, 'E-mail', 255).toLowerCase();
    const password = value(body.password, 'Senha', 200);
    if (email !== SINGLE_EMAIL) fail('E-mail ou senha incorretos.', 401);
    const row = await this.db.one('SELECT id,name,email,avatar_url,preferences,password_hash FROM users WHERE email=$1', [email]);
    if (!row || !(await bcrypt.compare(password, row.password_hash))) return fail('E-mail ou senha incorretos.', 401);
    return { user: { id: row.id, name: row.name, email: row.email, avatar_url: row.avatar_url, preferences: row.preferences }, token: jwt.sign({ sub: row.id, email: row.email }, process.env.JWT_SECRET!, { expiresIn: '14d' }) };
  }
  async me(userId: string) { return this.features.account(userId); }
  async boards(userId: string, status: string) {
    if (status !== 'active' && status !== 'closed') fail('Filtro inválido.');
    return this.db.query(`SELECT b.id,b.title,b.background,b.starred,b.owner_id,b.created_at,b.workspace_id,b.favorite_position,b.description,b.closed_at,
      (SELECT 'data:'||m.mime_type||';base64,'||replace(encode(m.data,'base64'), E'\n', '') FROM board_media m WHERE m.board_id=b.id) AS background_image,
      w.name AS workspace_name,v.visited_at,
      (SELECT count(*)::int FROM board_members bm2 WHERE bm2.board_id=b.id) AS member_count
      FROM boards b JOIN board_members bm ON bm.board_id=b.id
      LEFT JOIN workspaces w ON w.id=b.workspace_id
      LEFT JOIN board_visits v ON v.board_id=b.id AND v.user_id=$1
      WHERE bm.user_id=$1 AND (b.closed_at IS NOT NULL)=($2='closed') ORDER BY b.starred DESC,b.favorite_position ASC NULLS LAST,v.visited_at DESC NULLS LAST,b.created_at DESC`, [userId,status]);
  }
  async createBoard(userId: string, body: Payload) {
    const title = value(body.title, 'Título', 160);
    const background = typeof body.background === 'string' && /^[a-z0-9-]{1,32}$/.test(body.background) ? body.background : 'blue';
    let workspaceId: string;
    if (body.workspace_id) {
      workspaceId=uuid(value(body.workspace_id, 'Área de trabalho', 36));
      if (!await this.db.one('SELECT id FROM workspaces WHERE id=$1 AND owner_id=$2',[workspaceId,userId])) fail('Área de trabalho não encontrada.',404);
    } else {
      const workspace=await this.db.one('SELECT id FROM workspaces WHERE owner_id=$1 ORDER BY created_at LIMIT 1',[userId]);
      if (!workspace) return fail('Área de trabalho não encontrada.',404);
      workspaceId=workspace.id;
    }
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [board] } = await client.query('INSERT INTO boards(title,background,owner_id,workspace_id) VALUES($1,$2,$3,$4) RETURNING *', [title,background,userId,workspaceId]);
      await client.query('INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,$3)', [board.id,userId,'owner']);
      await client.query('COMMIT');
      await this.features.record(userId,board.id,null,'board_created',`criou o quadro ${title}`);
      return board;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async board(boardId: string, userId: string) {
    await this.member(boardId,userId,true);
    await this.features.visit(boardId,userId);
    const board = await this.db.one(`SELECT id,title,background,description,closed_at,starred,owner_id,created_at,workspace_id,favorite_position,
      (SELECT 'data:'||m.mime_type||';base64,'||replace(encode(m.data,'base64'), E'\n', '') FROM board_media m WHERE m.board_id=boards.id) AS background_image FROM boards WHERE id=$1`, [boardId]);
    const lists = await this.db.query('SELECT id,board_id,title,position FROM lists WHERE board_id=$1 ORDER BY position,created_at', [boardId]);
    const cards = await this.db.query(`SELECT c.id,c.list_id,c.title,c.description,c.position,c.due_date,c.cover_color,c.completed,c.created_at,c.updated_at,
      (c.due_date IS NOT NULL AND c.due_date<now()) AS overdue,
      COALESCE((SELECT json_agg(json_build_object('id',l.id,'name',l.name,'color',l.color)) FROM card_labels cl JOIN labels l ON l.id=cl.label_id WHERE cl.card_id=c.id),'[]'::json) AS labels,
      (SELECT count(*)::int FROM comments cm WHERE cm.card_id=c.id) AS comment_count,
      (SELECT count(*)::int FROM checklist_items ci WHERE ci.card_id=c.id) AS checklist_total,
      (SELECT count(*)::int FROM checklist_items ci WHERE ci.card_id=c.id AND ci.completed) AS checklist_done,
      EXISTS(SELECT 1 FROM card_assignees ca WHERE ca.card_id=c.id AND ca.user_id=$2) AS assigned_to_me
      FROM cards c JOIN lists li ON li.id=c.list_id WHERE li.board_id=$1 ORDER BY c.position,c.created_at`, [boardId,userId]);
    const labels = await this.db.query('SELECT id,board_id,name,color FROM labels WHERE board_id=$1 ORDER BY name', [boardId]);
    const members = await this.db.query('SELECT u.id,u.name,u.email,bm.role FROM board_members bm JOIN users u ON u.id=bm.user_id WHERE bm.board_id=$1 ORDER BY bm.role DESC,u.name', [boardId]);
    return { ...board, lists: lists.map(list => ({...list, cards: cards.filter(card => card.list_id === list.id)})), labels, members };
  }
  async updateBoard(boardId: string,userId: string,body: Payload) {
    await this.member(boardId,userId);
    const title = body.title === undefined ? null : value(body.title,'Título',160);
    const background = body.background === undefined ? null : value(body.background,'Cor',32);
    if (background && !/^[a-z0-9-]+$/.test(background)) fail('Cor inválida.');
    const starred = typeof body.starred === 'boolean' ? body.starred : null;
    const description = body.description === undefined ? undefined : optionalText(body.description);
    let workspaceId: string | null = null;
    if (body.workspace_id !== undefined) {
      workspaceId=uuid(value(body.workspace_id, 'Área de trabalho', 36));
      if (!await this.db.one('SELECT id FROM workspaces WHERE id=$1 AND owner_id=$2',[workspaceId,userId])) fail('Área de trabalho não encontrada.',404);
    }
    const before=await this.db.one('SELECT starred,favorite_position FROM boards WHERE id=$1',[boardId]);
    let favoritePosition: number | null | undefined;
    if (starred===true && !before?.starred) {
      const row=await this.db.one('SELECT COALESCE(max(favorite_position)+1,0) AS next FROM boards WHERE owner_id=$1 AND starred',[userId]);
      favoritePosition=Number(row?.next||0);
    } else if (starred===false) favoritePosition=null;
    const updated=await this.db.one(`UPDATE boards SET title=COALESCE($2,title),background=COALESCE($3,background),
      starred=COALESCE($4,starred),workspace_id=COALESCE($5,workspace_id),
      favorite_position=CASE WHEN $6::boolean THEN $7::double precision ELSE favorite_position END,
      description=CASE WHEN $8::boolean THEN $9::text ELSE description END
      WHERE id=$1 RETURNING *`,[boardId,title,background,starred,workspaceId,favoritePosition!==undefined,favoritePosition??null,description!==undefined,description??null]);
    if (title) await this.features.record(userId,boardId,null,'board_renamed',`renomeou o quadro para ${title}`);
    if (description!==undefined) await this.features.record(userId,boardId,null,'board_description','atualizou a descrição do quadro');
    if (background) await this.features.record(userId,boardId,null,'board_background','alterou a cor de fundo do quadro');
    return updated;
  }
  async deleteBoard(boardId: string,userId: string) {
    const member = await this.member(boardId,userId,true);
    if (!member || member.role !== 'owner') return fail('Apenas o proprietário pode excluir o quadro.',403);
    await this.db.query('DELETE FROM boards WHERE id=$1',[boardId]);
    return { ok: true };
  }
  async closeBoard(boardId: string,userId: string) {
    const member=await this.member(boardId,userId);
    if (!member || member.role!=='owner') fail('Apenas o proprietário pode fechar o quadro.',403);
    await this.db.query('UPDATE boards SET closed_at=now() WHERE id=$1',[boardId]);
    await this.features.record(userId,boardId,null,'board_closed','fechou o quadro');
    return {ok:true};
  }
  async reopenBoard(boardId: string,userId: string) {
    const member=await this.member(boardId,userId,true);
    if (!member || member.role!=='owner') fail('Apenas o proprietário pode reabrir o quadro.',403);
    await this.db.query('UPDATE boards SET closed_at=NULL WHERE id=$1',[boardId]);
    await this.features.record(userId,boardId,null,'board_reopened','reabriu o quadro');
    return {ok:true};
  }
  async boardActivity(boardId: string,userId: string,commentsOnly: string) {
    await this.member(boardId,userId,true);
    return this.db.query(`SELECT a.id,a.kind,a.body,a.created_at,a.card_id,a.board_id,
      b.title AS board_title,c.title AS card_title,u.name AS actor_name FROM activities a
      JOIN users u ON u.id=a.actor_id LEFT JOIN boards b ON b.id=a.board_id
      LEFT JOIN cards c ON c.id=a.card_id WHERE a.board_id=$1 AND ($2::boolean=false OR a.kind='comment')
      ORDER BY a.created_at DESC LIMIT 100`,[boardId,commentsOnly==='true']);
  }
  async setBackgroundImage(boardId: string,userId: string,body: Payload) {
    await this.member(boardId,userId);
    const dataUrl=body.data_url;
    if (typeof dataUrl!=='string' || dataUrl.length>2100000) fail('Imagem inválida ou maior que 1,5 MB.');
    const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl as string);
    if (!match) return fail('Use uma imagem PNG, JPEG ou WebP.');
    const data=Buffer.from(match[2],'base64');
    if (!data.length || data.length>1500000 || data.toString('base64')!==match[2]) fail('Imagem inválida ou maior que 1,5 MB.');
    const valid=match[1]==='png' ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : match[1]==='jpeg' ? data[0]===255 && data[1]===216 && data[2]===255
      : data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP';
    if (!valid) fail('O arquivo não corresponde ao formato informado.');
    await this.db.query(`INSERT INTO board_media(board_id,mime_type,data) VALUES($1,$2,$3)
      ON CONFLICT(board_id) DO UPDATE SET mime_type=excluded.mime_type,data=excluded.data,created_at=now()`,[boardId,`image/${match[1]}`,data]);
    await this.features.record(userId,boardId,null,'board_background','alterou a imagem de fundo do quadro');
    return {ok:true};
  }
  async removeBackgroundImage(boardId: string,userId: string) {
    await this.member(boardId,userId);
    await this.db.query('DELETE FROM board_media WHERE board_id=$1',[boardId]);
    await this.features.record(userId,boardId,null,'board_background','removeu a imagem de fundo do quadro');
    return {ok:true};
  }
  async copyBoard(boardId: string,userId: string,body: Payload) {
    await this.member(boardId,userId,true);
    const source=await this.db.one('SELECT * FROM boards WHERE id=$1',[boardId]);
    if (!source) return fail('Quadro não encontrado.',404);
    const title=body.title===undefined ? `${source.title} (cópia)` : value(body.title,'Título',160);
    const client=await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows:[copy]}=await client.query(`INSERT INTO boards(title,background,description,owner_id,workspace_id)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,[title,source.background,source.description,userId,source.workspace_id]);
      await client.query('INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,$3)',[copy.id,userId,'owner']);
      await client.query('INSERT INTO board_media(board_id,mime_type,data) SELECT $1,mime_type,data FROM board_media WHERE board_id=$2',[copy.id,boardId]);
      const labelMap=new Map<string,string>();
      const labels=await client.query('SELECT id,name,color FROM labels WHERE board_id=$1',[boardId]);
      for (const label of labels.rows) {
        const {rows:[newLabel]}=await client.query('INSERT INTO labels(board_id,name,color) VALUES($1,$2,$3) RETURNING id',[copy.id,label.name,label.color]);
        labelMap.set(label.id,newLabel.id);
      }
      const lists=await client.query('SELECT id,title,position FROM lists WHERE board_id=$1 ORDER BY position,created_at',[boardId]);
      for (const list of lists.rows) {
        const {rows:[newList]}=await client.query('INSERT INTO lists(board_id,title,position) VALUES($1,$2,$3) RETURNING id',[copy.id,list.title,list.position]);
        const cards=await client.query('SELECT * FROM cards WHERE list_id=$1 ORDER BY position,created_at',[list.id]);
        for (const card of cards.rows) {
          const {rows:[newCard]}=await client.query(`INSERT INTO cards(list_id,title,description,position,due_date,cover_color,completed)
            VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[newList.id,card.title,card.description,card.position,card.due_date,card.cover_color,card.completed]);
          const cardLabels=await client.query('SELECT label_id FROM card_labels WHERE card_id=$1',[card.id]);
          for (const item of cardLabels.rows) await client.query('INSERT INTO card_labels(card_id,label_id) VALUES($1,$2)',[newCard.id,labelMap.get(item.label_id)]);
          await client.query(`INSERT INTO checklist_items(card_id,text,completed,position,assignee_id,due_date)
            SELECT $1,text,completed,position,assignee_id,due_date FROM checklist_items WHERE card_id=$2`,[newCard.id,card.id]);
          await client.query('INSERT INTO card_assignees(card_id,user_id) SELECT $1,user_id FROM card_assignees WHERE card_id=$2',[newCard.id,card.id]);
        }
      }
      await client.query('COMMIT');
      await this.features.record(userId,copy.id,null,'board_copied',`copiou o quadro ${source.title}`);
      return copy;
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async invite(boardId: string,userId: string) {
    await this.member(boardId,userId);
    return fail('Convites ficarão disponíveis quando o sistema aceitar mais usuários.',403);
  }
  async createList(boardId: string,userId: string,body: Payload) {
    await this.member(boardId,userId);
    const title = value(body.title,'Título',160);
    const list=await this.db.one('INSERT INTO lists(board_id,title,position) VALUES($1,$2,COALESCE((SELECT max(position)+1 FROM lists WHERE board_id=$1),0)) RETURNING *',[boardId,title]);
    await this.features.record(userId,boardId,null,'list_created',`criou a lista ${title}`);
    return list;
  }
  async updateList(id: string,userId: string,body: Payload) {
    const boardId=await this.listBoard(id,userId);
    const title = body.title === undefined ? null : value(body.title,'Título',160);
    const position = body.position === undefined ? null : Number(body.position);
    if (position !== null && !Number.isFinite(position)) fail('Posição inválida.');
    const list=await this.db.one('UPDATE lists SET title=COALESCE($2,title),position=COALESCE($3,position) WHERE id=$1 RETURNING *',[id,title,position]);
    if (title) await this.features.record(userId,boardId,null,'list_renamed',`renomeou a lista para ${title}`);
    return list;
  }
  async deleteList(id: string,userId: string) { await this.listBoard(id,userId); await this.db.query('DELETE FROM lists WHERE id=$1',[id]); return {ok:true}; }
  async createCard(listId: string,userId: string,body: Payload) {
    const boardId=await this.listBoard(listId,userId);
    const title = value(body.title,'Título',300);
    const card=await this.db.one('INSERT INTO cards(list_id,title,position) VALUES($1,$2,COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=$1),0)) RETURNING *',[listId,title]);
    await this.features.record(userId,boardId,card!.id,'card_created',`criou o cartão ${title}`);
    return card;
  }
  async updateCard(id: string,userId: string,body: Payload) {
    const boardId = await this.cardBoard(id,userId);
    const original=await this.db.one('SELECT list_id FROM cards WHERE id=$1',[id]);
    const title = body.title === undefined ? null : value(body.title,'Título',300);
    const description = body.description === undefined ? null : optionalText(body.description);
    const dueDate = body.due_date === undefined ? undefined : optionalDate(body.due_date);
    if (dueDate instanceof Date && Number.isNaN(dueDate.getTime())) fail('Data inválida.');
    const coverColor = body.cover_color === undefined ? undefined : body.cover_color === null ? null : value(body.cover_color,'Cor',32);
    if (coverColor && !/^[a-z0-9-]+$/.test(coverColor)) fail('Cor inválida.');
    const completed = body.completed === undefined ? null : Boolean(body.completed);
    let listId: string | null = null;
    if (body.list_id !== undefined) { listId = uuid(value(body.list_id, 'Lista', 36)); if ((await this.listBoard(listId,userId)) !== boardId) fail('A lista pertence a outro quadro.'); }
    const position = body.position === undefined ? null : Number(body.position);
    if (position !== null && !Number.isFinite(position)) fail('Posição inválida.');
    const card=await this.db.one(`UPDATE cards SET title=COALESCE($2,title),description=COALESCE($3,description),
      due_date=CASE WHEN $4::boolean THEN $5::timestamptz ELSE due_date END,
      cover_color=CASE WHEN $6::boolean THEN $7::varchar ELSE cover_color END,
      completed=COALESCE($8,completed),list_id=COALESCE($9,list_id),position=COALESCE($10,position),updated_at=now()
      WHERE id=$1 RETURNING *`,[id,title,description,dueDate!==undefined,dueDate===undefined?null:dueDate,coverColor!==undefined,coverColor??null,completed,listId,position]);
    const moved=Boolean(listId && listId!==original?.list_id);
    if (title || description!==null || dueDate!==undefined || completed!==null || moved) {
      const action=completed===true?'concluiu um cartão':moved?'moveu um cartão':title?`renomeou o cartão para ${title}`:dueDate!==undefined?'alterou a data de um cartão':'atualizou um cartão';
      await this.features.record(userId,boardId,id,'card_updated',action);
    }
    return card;
  }
  async deleteCard(id: string,userId: string) { await this.cardBoard(id,userId); await this.db.query('DELETE FROM cards WHERE id=$1',[id]); return {ok:true}; }
  async cardDetails(id: string,userId: string) {
    await this.cardBoard(id,userId,true);
    const comments = await this.db.query('SELECT c.id,c.body,c.created_at,u.id AS author_id,u.name AS author_name FROM comments c JOIN users u ON u.id=c.author_id WHERE c.card_id=$1 ORDER BY c.created_at DESC',[id]);
    const checklist = await this.db.query('SELECT id,text,completed,position,assignee_id,due_date FROM checklist_items WHERE card_id=$1 ORDER BY position',[id]);
    return { comments, checklist };
  }
  async comment(id: string,userId: string,body: Payload) {
    const boardId=await this.cardBoard(id,userId);
    const text = value(body.body,'Comentário',5000);
    const comment=await this.db.one('INSERT INTO comments(card_id,author_id,body) VALUES($1,$2,$3) RETURNING *',[id,userId,text]);
    await this.features.record(userId,boardId,id,'comment',`comentou: ${text.slice(0,180)}`);
    await this.features.mention(userId,boardId,id,text);
    return comment;
  }
  async deleteComment(id: string,userId: string) {
    uuid(id);
    const row = await this.db.one('SELECT cm.author_id,l.board_id FROM comments cm JOIN cards c ON c.id=cm.card_id JOIN lists l ON l.id=c.list_id WHERE cm.id=$1',[id]);
    if (!row) return fail('Comentário não encontrado.',404);
    await this.member(row.board_id,userId);
    if (row.author_id !== userId) fail('Você só pode excluir seus comentários.',403);
    await this.db.query('DELETE FROM comments WHERE id=$1',[id]); return {ok:true};
  }
  async createChecklist(id: string,userId: string,body: Payload) {
    const boardId=await this.cardBoard(id,userId);
    const text = value(body.text,'Item',300);
    const assigned=body.assigned===true?userId:null;
    const dueDate=body.due_date?optionalDate(body.due_date):null;
    if (dueDate && Number.isNaN(dueDate.getTime())) fail('Data inválida.');
    const item=await this.db.one('INSERT INTO checklist_items(card_id,text,position,assignee_id,due_date) VALUES($1,$2,COALESCE((SELECT max(position)+1 FROM checklist_items WHERE card_id=$1),0),$3,$4) RETURNING *',[id,text,assigned,dueDate]);
    await this.features.record(userId,boardId,id,'checklist_created',`adicionou o item ${text}`);
    if (assigned) await this.features.notify(userId,boardId,id,'checklist','Item atribuído a você',text);
    return item;
  }
  async updateChecklist(id: string,userId: string,body: Payload) {
    uuid(id);
    const row = await this.db.one('SELECT ci.card_id FROM checklist_items ci WHERE ci.id=$1',[id]);
    if (!row) return fail('Item não encontrado.',404);
    const boardId=await this.cardBoard(row.card_id,userId);
    const dueDate=body.due_date===undefined?undefined:optionalDate(body.due_date);
    if (dueDate instanceof Date && Number.isNaN(dueDate.getTime())) fail('Data inválida.');
    const item=await this.db.one(`UPDATE checklist_items SET text=COALESCE($2,text),completed=COALESCE($3,completed),
      assignee_id=CASE WHEN $4::boolean THEN $5::uuid ELSE assignee_id END,
      due_date=CASE WHEN $6::boolean THEN $7::timestamptz ELSE due_date END WHERE id=$1 RETURNING *`,
      [id,body.text===undefined?null:value(body.text,'Item',300),typeof body.completed==='boolean'?body.completed:null,
        typeof body.assigned==='boolean',body.assigned?userId:null,dueDate!==undefined,dueDate===undefined?null:dueDate]);
    if (body.completed!==undefined) await this.features.record(userId,boardId,row.card_id,'checklist_updated',body.completed?'concluiu um item de checklist':'reabriu um item de checklist');
    if (body.assigned===true) await this.features.notify(userId,boardId,row.card_id,'checklist','Item atribuído a você',item!.text);
    return item;
  }
  async deleteChecklist(id: string,userId: string) {
    uuid(id); const row = await this.db.one('SELECT card_id FROM checklist_items WHERE id=$1',[id]);
    if (!row) return fail('Item não encontrado.',404); await this.cardBoard(row.card_id,userId);
    await this.db.query('DELETE FROM checklist_items WHERE id=$1',[id]); return {ok:true};
  }
  async createLabel(boardId: string,userId: string,body: Payload) {
    await this.member(boardId,userId);
    const name = typeof body.name === 'string' ? body.name.slice(0,100) : '';
    const color = value(body.color,'Cor',32);
    if (!/^[a-z0-9-]+$/.test(color)) fail('Cor inválida.');
    return this.db.one('INSERT INTO labels(board_id,name,color) VALUES($1,$2,$3) RETURNING *',[boardId,name,color]);
  }
  async toggleLabel(cardId: string,labelId: string,userId: string) {
    const boardId = await this.cardBoard(cardId,userId); uuid(labelId);
    const label = await this.db.one('SELECT id FROM labels WHERE id=$1 AND board_id=$2',[labelId,boardId]);
    if (!label) fail('Etiqueta não encontrada.',404);
    const existing = await this.db.one('SELECT 1 FROM card_labels WHERE card_id=$1 AND label_id=$2',[cardId,labelId]);
    if (existing) await this.db.query('DELETE FROM card_labels WHERE card_id=$1 AND label_id=$2',[cardId,labelId]);
    else await this.db.query('INSERT INTO card_labels(card_id,label_id) VALUES($1,$2)',[cardId,labelId]);
    return { selected: !existing };
  }
}

@Controller()
class ApiController {
  constructor(private service: Service) {}
  @Get('health') health() { return { status: 'ok' }; }
  @Post('auth/register') register() { return this.service.register(); }
  @Post('auth/login') login(@Body() body: Payload) { return this.service.login(body); }
  @Get('auth/me') me(@Req() req: Request) { return this.service.me(this.service.user(req)); }
  @Get('boards') boards(@Req() req: Request,@Query('status') status='active') { return this.service.boards(this.service.user(req),status); }
  @Post('boards') createBoard(@Req() req: Request,@Body() body: Payload) { return this.service.createBoard(this.service.user(req),body); }
  @Get('boards/:id') board(@Req() req: Request,@Param('id') id: string) { return this.service.board(id,this.service.user(req)); }
  @Patch('boards/:id') updateBoard(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.updateBoard(id,this.service.user(req),body); }
  @Delete('boards/:id') deleteBoard(@Req() req: Request,@Param('id') id: string) { return this.service.deleteBoard(id,this.service.user(req)); }
  @Post('boards/:id/copy') copyBoard(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.copyBoard(id,this.service.user(req),body); }
  @Patch('boards/:id/close') closeBoard(@Req() req: Request,@Param('id') id: string) { return this.service.closeBoard(id,this.service.user(req)); }
  @Patch('boards/:id/reopen') reopenBoard(@Req() req: Request,@Param('id') id: string) { return this.service.reopenBoard(id,this.service.user(req)); }
  @Get('boards/:id/activity') boardActivity(@Req() req: Request,@Param('id') id: string,@Query('commentsOnly') commentsOnly='false') { return this.service.boardActivity(id,this.service.user(req),commentsOnly); }
  @Post('boards/:id/background') background(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.setBackgroundImage(id,this.service.user(req),body); }
  @Delete('boards/:id/background') removeBackground(@Req() req: Request,@Param('id') id: string) { return this.service.removeBackgroundImage(id,this.service.user(req)); }
  @Post('boards/:id/members') invite(@Req() req: Request,@Param('id') id: string) { return this.service.invite(id,this.service.user(req)); }
  @Post('boards/:id/lists') createList(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.createList(id,this.service.user(req),body); }
  @Post('boards/:id/labels') createLabel(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.createLabel(id,this.service.user(req),body); }
  @Patch('lists/:id') updateList(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.updateList(id,this.service.user(req),body); }
  @Delete('lists/:id') deleteList(@Req() req: Request,@Param('id') id: string) { return this.service.deleteList(id,this.service.user(req)); }
  @Post('lists/:id/cards') createCard(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.createCard(id,this.service.user(req),body); }
  @Patch('cards/:id') updateCard(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.updateCard(id,this.service.user(req),body); }
  @Delete('cards/:id') deleteCard(@Req() req: Request,@Param('id') id: string) { return this.service.deleteCard(id,this.service.user(req)); }
  @Get('cards/:id/details') cardDetails(@Req() req: Request,@Param('id') id: string) { return this.service.cardDetails(id,this.service.user(req)); }
  @Post('cards/:id/comments') comment(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.comment(id,this.service.user(req),body); }
  @Delete('comments/:id') deleteComment(@Req() req: Request,@Param('id') id: string) { return this.service.deleteComment(id,this.service.user(req)); }
  @Post('cards/:id/checklist') createChecklist(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.createChecklist(id,this.service.user(req),body); }
  @Patch('checklist/:id') updateChecklist(@Req() req: Request,@Param('id') id: string,@Body() body: Payload) { return this.service.updateChecklist(id,this.service.user(req),body); }
  @Delete('checklist/:id') deleteChecklist(@Req() req: Request,@Param('id') id: string) { return this.service.deleteChecklist(id,this.service.user(req)); }
  @Post('cards/:cardId/labels/:labelId/toggle') toggleLabel(@Req() req: Request,@Param('cardId') cardId: string,@Param('labelId') labelId: string) { return this.service.toggleLabel(cardId,labelId,this.service.user(req)); }
}

@Module({ providers: [Db, FeaturesService, Service], controllers: [ApiController, FeaturesController] })
class AppModule {}

async function bootstrap() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN || 'http://localhost:3000' });
  app.use(json({limit:'3mb'}));
  await app.listen(Number(process.env.API_PORT || 4000));
}
bootstrap();
