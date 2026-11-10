import {Injectable,Inject,HttpException} from '@nestjs/common';
import {Db} from '../../db';
import {AccessService} from '../../access/access';
import {enforceCodexQuota} from '../../codex-limits';
export type QueueSettings={paused:boolean;autoPaused:boolean;autoResume:boolean};
@Injectable()
export class QueueManagement {
 constructor(@Inject(Db) private db:Db,@Inject(AccessService) private access:AccessService){}
 async settings(user:string):Promise<QueueSettings>{const row=await this.db.one<{preferences:Record<string,unknown>}>('SELECT preferences FROM users WHERE id=$1',[user]);if(!row)throw new HttpException('Usuário não encontrado.',404);const p=row.preferences||{};return {paused:p.codexQueuePaused===true,autoPaused:p.codexQueueAutoPaused===true,autoResume:p.codexQueueAutoResume===true};}
 async update(actor:string,body:Record<string,unknown>){if(!body||Object.keys(body).some(key=>!['paused','autoResume','userId'].includes(key))||!['paused','autoResume'].some(key=>key in body)||['paused','autoResume'].some(key=>key in body&&typeof body[key]!=='boolean'))throw new HttpException('Configuração da fila inválida.',400);
 if(body.userId!==undefined&&(typeof body.userId!=='string'||! /^[0-9a-f-]{36}$/i.test(body.userId)))throw new HttpException('Usuário inválido.',400);
 const owner=body.userId===undefined?actor:String(body.userId);if(owner!==actor&&!(await this.access.account(actor)).is_root)throw new HttpException('Somente ROOT gerencia filas de outros usuários.',403);await this.settings(owner);
 const changes:Record<string,unknown>={};if('autoResume'in body)changes.codexQueueAutoResume=body.autoResume;
 if('paused'in body){changes.codexQueuePaused=body.paused;changes.codexQueueAutoPaused=false;}
 await this.db.query("UPDATE users SET preferences=COALESCE(preferences,'{}'::jsonb)||$2::jsonb||CASE WHEN $3 THEN jsonb_build_object('codexQuotaAcknowledged',COALESCE(preferences->>'codexQuotaKey','')) ELSE '{}'::jsonb END WHERE id=$1",[owner,JSON.stringify(changes),body.paused===false]);await this.access.audit(actor,'queue.settings',JSON.stringify({owner,...changes}));return this.settings(owner);}
 async list(actor:string){await enforceCodexQuota(this.db);const root=(await this.access.account(actor)).is_root;
 const items=await this.db.query(`WITH entries AS (
 SELECT r.id,r.user_id,'prompt'::text AS kind,r.status,r.card_id,r.project_id,r.created_at,r.started_at,r.finished_at,r.source::text AS detail FROM card_ai_runs r
 UNION ALL SELECT r.comment_id,r.user_id,'comment',r.status,r.card_id,r.project_id,r.created_at,r.started_at,r.finished_at,'Comentário' FROM card_ai_comment_jobs r
 UNION ALL SELECT r.id,r.user_id,'execution',r.status,r.card_id,r.project_id,r.created_at,r.started_at,r.finished_at,r.stage FROM card_runs r
 UNION ALL SELECT r.id,r.triggered_by,'delivery',r.status,r.card_id,r.project_id,r.created_at,r.started_at,r.finished_at,p.name FROM delivery_runs r JOIN delivery_pipelines p ON p.id=r.pipeline_id
 ),visible AS (
 SELECT e.*,c.title AS card_title,c.url_token,l.board_id,p.name AS project_name,u.name AS owner_name,
 row_number() OVER(PARTITION BY e.user_id,e.kind ORDER BY e.created_at DESC,e.id DESC) AS recent
 FROM entries e JOIN users u ON u.id=e.user_id LEFT JOIN cards c ON c.id=e.card_id LEFT JOIN lists l ON l.id=c.list_id LEFT JOIN ai_projects p ON p.id=e.project_id
 WHERE ($2 OR e.user_id=$1) AND ($2 OR e.card_id IS NULL OR EXISTS(SELECT 1 FROM authorized_board_members bm WHERE bm.board_id=l.board_id AND bm.user_id=$1))
 ) SELECT * FROM visible WHERE status IN ('queued','running','waiting_answer','waiting_approval') OR recent<=50 ORDER BY created_at,id`,[actor,root]);
 const owners=[...new Set([actor,...items.map(item=>String(item.user_id))])];const accounts=await this.db.query('SELECT id,name,preferences FROM users WHERE id=ANY($1::uuid[])',[owners]);
 const queues=accounts.flatMap(account=>['prompt','comment','execution','delivery'].map(kind=>{const p=account.preferences||{};const entries=items.filter(item=>item.user_id===account.id&&item.kind===kind);return {id:account.id+':'+kind,ownerId:account.id,ownerName:account.name,kind,paused:kind!=='delivery'&&p.codexQueuePaused===true,autoPaused:kind!=='delivery'&&p.codexQueueAutoPaused===true,autoResume:kind!=='delivery'&&p.codexQueueAutoResume===true,items:entries};}));return {queues,root,historyLimit:50};
 }
}
