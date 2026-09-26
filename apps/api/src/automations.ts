import {Body,Controller,Delete,Get,HttpException,Inject,Injectable,OnModuleDestroy,OnModuleInit,Param,Patch,Post,Req} from '@nestjs/common';
import {Request} from 'express';
import {randomUUID} from 'node:crypto';
import {PoolClient,QueryResultRow} from 'pg';
import nodemailer from 'nodemailer';
import {Db} from './db';
import {FeaturesService} from './features';
import {AutomationAction,Context,Definition,interpolate,isId,matches,nextSchedule,dateExpression,validateDefinition} from './automation-rules';

type Rule=QueryResultRow&{id:string;board_id:string;owner_id:string;name:string;definition:Definition;enabled:boolean;tags:string[];created_at:Date;next_run_at:Date|null};
type Event=QueryResultRow&{id:string;board_id:string;card_id:string|null;kind:string;chain:string[];payload:{before?:Record<string,unknown>;after?:Record<string,unknown>}};
const bad=(message:string,status=400):never=>{throw new HttpException({message},status)};
const checkId=(id:unknown)=>{if(!isId(id))bad('ID inválido.');return id as string};

@Injectable()
export class AutomationsService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private ticking=false;
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService){}
  onModuleInit(){this.timer=setInterval(()=>void this.tick(),5000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer)}
  async list(board:string,user:string){await this.features.member(board,user);return this.db.query('SELECT * FROM automations WHERE board_id=$1 ORDER BY created_at DESC',[board])}
  async status(board:string,user:string){await this.features.member(board,user);return this.db.one('SELECT max(r.created_at) AS last FROM automation_runs r JOIN automations a ON a.id=r.automation_id WHERE a.board_id=$1',[board])}
  async access(id:string,user:string){const rule=await this.db.one<Rule>('SELECT * FROM automations WHERE id=$1',[checkId(id)]);if(!rule)bad('Automação não encontrada.',404);await this.features.member(rule!.board_id,user);return rule!}
  private async references(board:string,d:Definition){
    const refs:{table:string;id:string;column?:string}[]=[];
    if(d.trigger.listId)refs.push({table:'lists',id:d.trigger.listId});
    for(const c of d.conditions){if(c.field.startsWith('custom:'))refs.push({table:'custom_fields',id:c.field.slice(7)});if(['list_id','labels','members'].includes(c.field)&&c.value&&isId(c.value))refs.push({table:c.field==='list_id'?'lists':c.field==='labels'?'labels':'board_members',id:c.value,column:c.field==='members'?'user_id':'id'});}
    for(const a of d.actions){
      if(a.target==='list')refs.push({table:'lists',id:a.listId!});
      if(a.type==='move')refs.push({table:'lists',id:a.value!});
      if(a.type.startsWith('label_'))refs.push({table:'labels',id:a.value!});
      if(['assign','unassign'].includes(a.type))refs.push({table:'board_members',id:a.value!,column:'user_id'});
      if(a.type==='field')refs.push({table:'custom_fields',id:a.field!});
    }
    for(const ref of refs){const row=await this.db.one(`SELECT 1 FROM ${ref.table} WHERE ${ref.column||'id'}=$1 AND board_id=$2${ref.table==='lists'?' AND archived_at IS NULL':''}`,[checkId(ref.id),board]);if(!row)bad('Uma lista, etiqueta, pessoa ou campo não pertence ao quadro.');}
  }
  async save(board:string,user:string,body:Record<string,unknown>,id?:string){
    await this.features.member(board,user);
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120)bad('Nome obrigatório, até 120 caracteres.');
    if(body.enabled!==undefined&&typeof body.enabled!=='boolean')bad('Status inválido.');
    if(body.tags!==undefined&&(!Array.isArray(body.tags)||body.tags.length>20||body.tags.some(x=>typeof x!=='string'||x.length>40)))bad('Use até 20 tags de até 40 caracteres.');
    let definition:Definition;
    try{definition=validateDefinition(body.definition)}catch(e){return bad((e as Error).message)}
    await this.references(board,definition);
    const next=definition.trigger.type==='scheduled'?nextSchedule(definition.trigger):null;
    if(id)return this.db.one('UPDATE automations SET name=$2,definition=$3,tags=$4,enabled=$5,next_run_at=$6,updated_at=now() WHERE id=$1 RETURNING *',[id,body.name,JSON.stringify(definition),body.tags||[],body.enabled??true,next]);
    return this.db.one('INSERT INTO automations(board_id,owner_id,name,definition,tags,enabled,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[board,user,body.name,JSON.stringify(definition),body.tags||[],body.enabled??true,next]);
  }
  async update(id:string,user:string,body:Record<string,unknown>){const rule=await this.access(id,user);return this.save(rule.board_id,user,{...rule,...body},id)}
  async remove(id:string,user:string){await this.access(id,user);await this.db.query('DELETE FROM automations WHERE id=$1',[id]);return {ok:true}}
  async copy(id:string,user:string,body:Record<string,unknown>){
    const rule=await this.access(id,user),board=body.boardId?checkId(body.boardId):rule.board_id;
    await this.features.member(board,user);
    const d=structuredClone(rule.definition);
    const mapping=(body.mapping||{}) as Record<string,string>;
    if(board!==rule.board_id){
      const map=(value:string)=>{if(!isId(mapping[value]))bad(`Mapeie a referência ${value} para o quadro de destino.`);return mapping[value]};
      if(d.trigger.listId)d.trigger.listId=map(d.trigger.listId);
      for(const c of d.conditions){if(c.field.startsWith('custom:'))c.field='custom:'+map(c.field.slice(7));if(['list_id','labels','members'].includes(c.field)&&isId(c.value))c.value=map(c.value);if(c.value)c.value=c.value.replace(/custom:([\da-f-]{36})/gi,(_,id)=>'custom:'+map(id));}
      for(const a of d.actions){if(a.listId)a.listId=map(a.listId);if(a.field)a.field=map(a.field);if(['move','label_add','label_remove','assign','unassign'].includes(a.type))a.value=map(a.value!);for(const key of ['value','subject','template'] as const)if(a[key])a[key]=a[key]!.replace(/custom:([\da-f-]{36})/gi,(_,id)=>'custom:'+map(id));}
    }
    return this.save(board,user,{name:`${rule.name.slice(0,110)} (cópia)`,definition:d,tags:rule.tags,enabled:false});
  }
  async logs(id:string,user:string){await this.access(id,user);return {runs:await this.db.query('SELECT * FROM automation_runs WHERE automation_id=$1 ORDER BY created_at DESC LIMIT 100',[id]),mail:await this.db.query('SELECT id,recipient,subject,sent_at,error,attempts,created_at FROM automation_mail WHERE automation_id=$1 ORDER BY created_at DESC LIMIT 100',[id]),mailConfigured:Boolean(process.env.SMTP_HOST&&process.env.SMTP_FROM)}}
  private async context(client:PoolClient,cardId:string):Promise<Context|null>{
    const {rows}=await client.query(`SELECT c.*,l.board_id,l.title AS list,b.title AS board,u.name AS "user",
      COALESCE((SELECT jsonb_agg(label_id::text) FROM card_labels WHERE card_id=c.id),'[]') AS labels,
      COALESCE((SELECT jsonb_agg(user_id::text) FROM card_assignees WHERE card_id=c.id),'[]') AS members,
      COALESCE((SELECT jsonb_object_agg(field_id::text,value) FROM card_custom_values WHERE card_id=c.id),'{}') AS fields
      FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN users u ON u.id=b.owner_id
      WHERE c.id=$1 AND l.archived_at IS NULL AND b.closed_at IS NULL`,[cardId]);
    if(!rows[0])return null;
    const c=rows[0];return {...c,archived:Boolean(c.archived_at),due_date:c.due_date?.toISOString()||null};
  }
  private async targets(client:PoolClient,rule:Rule,action:AutomationAction,source:string|null){
    const target=action.target||(source?'card':'board');
    if(target==='card')return source?[source]:[];
    const {rows}=await client.query(`SELECT c.id FROM cards c JOIN lists l ON l.id=c.list_id WHERE l.board_id=$1 AND l.archived_at IS NULL AND c.archived_at IS NULL AND c.kind IN ('normal','template')
      AND ($2::text<>'list' OR l.id=$3::uuid)
      AND ($2::text<>'related' OR c.id IN (SELECT target_id FROM attachments WHERE card_id=$4 AND kind='card' UNION SELECT card_id FROM attachments WHERE target_id=$4 AND kind='card')) ORDER BY c.id LIMIT 501`,[rule.board_id,target,action.listId||null,source]);
    if(rows.length>500)throw new Error('A execução excede 500 cartões. Restrinja a lista alvo.');
    return rows.map(row=>row.id as string);
  }
  private async action(client:PoolClient,rule:Rule,action:AutomationAction,c:Context,now:Date){
    const text=interpolate(action.value||'',c,now),id=c.id as string;
    switch(action.type){
      case 'move':{
        const destination=(await client.query('SELECT id FROM lists WHERE id=$1 AND board_id=$2 AND archived_at IS NULL FOR UPDATE',[text,rule.board_id])).rows[0];
        if(!destination)throw new Error('Lista de destino indisponível.');
        await client.query('UPDATE cards SET list_id=$2,position=COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=$2),0),updated_at=now() WHERE id=$1',[id,text]);break;
      }
      case 'label_add':case 'label_remove':{
        if(!(await client.query('SELECT id FROM labels WHERE id=$1 AND board_id=$2',[text,rule.board_id])).rowCount)throw new Error('Etiqueta indisponível.');
        await client.query(action.type==='label_add'?'INSERT INTO card_labels(card_id,label_id) VALUES($1,$2) ON CONFLICT DO NOTHING':'DELETE FROM card_labels WHERE card_id=$1 AND label_id=$2',[id,text]);break;
      }
      case 'assign':case 'unassign':{
        if(!(await client.query('SELECT user_id FROM board_members WHERE user_id=$1 AND board_id=$2',[text,rule.board_id])).rowCount)throw new Error('Membro indisponível.');
        await client.query(action.type==='assign'?'INSERT INTO card_assignees(card_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING':'DELETE FROM card_assignees WHERE card_id=$1 AND user_id=$2',[id,text]);
        if(action.type==='assign')await client.query('INSERT INTO card_watchers(card_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,text]);break;
      }
      case 'complete':await client.query('UPDATE cards SET completed=$2,updated_at=now() WHERE id=$1',[id,text==='true']);break;
      case 'archive':await client.query('UPDATE cards SET archived_at=now(),updated_at=now() WHERE id=$1',[id]);break;
      case 'rename':if(!text.trim()||text.length>300)throw new Error('Título: 1 a 300 caracteres.');await client.query('UPDATE cards SET title=$2,updated_at=now() WHERE id=$1',[id,text]);break;
      case 'description':await client.query('UPDATE cards SET description=$2,updated_at=now() WHERE id=$1',[id,text]);break;
      case 'comment':await client.query('INSERT INTO comments(card_id,author_id,body) VALUES($1,$2,$3)',[id,rule.owner_id,text]);break;
      case 'due':case 'start':await client.query(`UPDATE cards SET ${action.type==='due'?'due_date':'start_date'}=$2,updated_at=now() WHERE id=$1`,[id,text?dateExpression(text,now,c.due_date):null]);break;
      case 'field':{
        const f=(await client.query('SELECT * FROM custom_fields WHERE id=$1 AND board_id=$2',[action.field,rule.board_id])).rows[0];if(!f)throw new Error('Campo indisponível.');
        let v:unknown=text;
        if(f.type==='number'){if(!text.trim()||!Number.isFinite(Number(text)))throw new Error('Valor numérico inválido.');v=Number(text)}
        if(f.type==='checkbox'){if(!['true','false'].includes(text))throw new Error('Checkbox: use true ou false.');v=text==='true'}
        if(f.type==='dropdown'&&!f.options.includes(text))throw new Error('Opção do campo inválida.');
        if(f.type==='date')v=dateExpression(text,now,c.due_date).toISOString();
        await client.query('INSERT INTO card_custom_values(card_id,field_id,value) VALUES($1,$2,$3) ON CONFLICT(card_id,field_id) DO UPDATE SET value=EXCLUDED.value',[id,f.id,JSON.stringify(v)]);break;
      }
      case 'checklist_add':{
        const group=(await client.query('INSERT INTO checklists(card_id,title,position) VALUES($1,$2,COALESCE((SELECT max(position)+1 FROM checklists WHERE card_id=$1),0)) RETURNING id',[id,rule.name])).rows[0];
        const items=text.split('\n').map(s=>s.trim()).filter(Boolean);if(items.length>100)throw new Error('Limite de 100 itens.');
        for(let i=0;i<items.length;i++)await client.query('INSERT INTO checklist_items(card_id,checklist_id,text,position) VALUES($1,$2,$3,$4)',[id,group.id,items[i],i]);break;
      }
      case 'checklist_complete':await client.query("UPDATE checklist_items SET completed=true WHERE card_id=$1 AND ($2='' OR text ILIKE '%' || $2 || '%')",[id,text]);break;
    }
    await client.query('INSERT INTO activities(actor_id,board_id,card_id,kind,body) VALUES($1,$2,$3,$4,$5)',[rule.owner_id,rule.board_id,id,'automation',`${rule.name}: ${action.type}`]);
    await client.query(`INSERT INTO notifications(user_id,board_id,card_id,kind,title,body)
      SELECT DISTINCT watcher.user_id,$2,$3,'automation',$4,$5 FROM (
      SELECT user_id FROM card_watchers WHERE card_id=$3 UNION SELECT user_id FROM list_watchers WHERE list_id=$6 UNION SELECT user_id FROM board_watchers WHERE board_id=$2) watcher
      JOIN board_members bm ON bm.user_id=watcher.user_id AND bm.board_id=$2 JOIN users u ON u.id=watcher.user_id
      WHERE $1::uuid IS NOT NULL AND COALESCE((u.preferences->>'notifications')::boolean,true)`,[rule.owner_id,rule.board_id,id,rule.name,`${c.title}: ${action.type}`,c.list_id]);
  }
  private async report(client:PoolClient,rule:Rule,action:AutomationAction,ids:string[],now:Date){
    const cards:Context[]=[];
    for(const id of ids){const c=await this.context(client,id);if(!c)continue;const due=c.due_date?Date.parse(c.due_date):NaN;
      if(action.report==='due_soon'&&(c.completed||due<now.getTime()||due>now.getTime()+7*86400000||!Number.isFinite(due)))continue;
      if(action.report==='overdue'&&(c.completed||due>=now.getTime()||!Number.isFinite(due)))continue;
      if(action.report==='my_cards'&&!c.members.includes(rule.owner_id))continue;
      cards.push(c);
    }
    const board=(await client.query('SELECT b.title,u.name FROM boards b JOIN users u ON u.id=$2 WHERE b.id=$1',[rule.board_id,rule.owner_id])).rows[0];
    const empty={title:'',description:'',list_id:'',list:'',board:board.title,completed:false,due_date:null,labels:[],members:[],fields:{},user:board.name} satisfies Context;
    let body=cards.map(c=>interpolate(action.template||'- {{title}} | {{list}} | {{due_date}}',c,now)).join('\n')||'Nenhum cartão corresponde aos filtros.';
    if(action.report==='snapshot'){
      const counts=new Map<string,number>();for(const card of cards)counts.set(card.list,(counts.get(card.list)||0)+1);
      body=`# ${board.title}\n${cards.length} cartões · ${cards.filter(c=>c.completed).length} concluídos\n${[...counts].map(([name,count])=>`- ${name}: ${count}`).join('\n')}\n\n${body}`;
    }
    const subject=interpolate(action.subject||`${rule.name} — {{board}}`,empty,now);
    if(/[\r\n]/.test(subject))throw new Error('Assunto inválido.');
    for(const recipient of action.recipients!.split(',').map(s=>s.trim()))await client.query('INSERT INTO automation_mail(automation_id,recipient,subject,body) VALUES($1,$2,$3,$4)',[rule.id,recipient,subject,body]);
  }
  private async execute(client:PoolClient,rule:Rule,key:string,source:string|null,chain:string[],now=new Date()){
    if(chain.includes(rule.id)||chain.length>=5){await client.query("INSERT INTO automation_runs(automation_id,event_key,status,details) VALUES($1,$2,'skipped',$3) ON CONFLICT DO NOTHING",[rule.id,key,JSON.stringify({reason:'Proteção contra ciclo: máximo de 5 níveis e uma execução por regra na cadeia'})]);return {status:'skipped',reason:'Proteção contra ciclo'}}
    await client.query('SAVEPOINT automation_run');
    try{
      const inserted=await client.query("INSERT INTO automation_runs(automation_id,event_key,status) VALUES($1,$2,'success') ON CONFLICT DO NOTHING RETURNING id",[rule.id,key]);
      if(!inserted.rowCount){await client.query('RELEASE SAVEPOINT automation_run');return {status:'skipped',reason:'Evento já processado'}}
      await client.query("SELECT set_config('orbit.automation_chain',$1,true)",['{'+[...chain,rule.id].join(',')+'}']);
      const sourceContext=source?await this.context(client,source):null;
      if(source&&(!sourceContext||sourceContext.archived||sourceContext.board_id!==rule.board_id||!matches(sourceContext,rule.definition.conditions,now))){
        await client.query("UPDATE automation_runs SET status='skipped',details=$2 WHERE id=$1",[inserted.rows[0].id,JSON.stringify({reason:'Condições não atendidas ou cartão indisponível'})]);
        await client.query('RELEASE SAVEPOINT automation_run');return {status:'skipped'};
      }
      let affected=0;
      const selections=new Map<string,string[]>();
      for(const action of rule.definition.actions){
        const scope=`${action.target||(source?'card':'board')}:${action.listId||''}`;
        let ids=selections.get(scope);
        if(!ids){
          ids=[];for(const target of await this.targets(client,rule,action,source)){const c=await this.context(client,target);if(c&&!c.archived&&(source||matches(c,rule.definition.conditions,now)))ids.push(target)}
          selections.set(scope,ids);
        }
        if(action.type==='report'){await this.report(client,rule,action,ids,now);continue}
        if(action.type==='sort'){
          // Keep nonmatching cards in their slots, and reorder only the selected cards.
          await client.query(`WITH slots AS (SELECT id,list_id,position,row_number() OVER(PARTITION BY list_id ORDER BY position,id) n FROM cards WHERE id=ANY($1::uuid[])), ordered AS (SELECT id,list_id,row_number() OVER(PARTITION BY list_id ORDER BY ${action.value} ASC NULLS LAST,id) n FROM cards WHERE id=ANY($1::uuid[])) UPDATE cards c SET position=s.position FROM ordered o JOIN slots s ON s.list_id=o.list_id AND s.n=o.n WHERE c.id=o.id`,[ids]);affected+=ids.length;continue;
        }
        for(const id of ids){const c=await this.context(client,id);if(!c||c.board_id!==rule.board_id||c.archived)continue;await this.action(client,rule,action,c,now);affected++;}
      }
      await client.query('UPDATE automation_runs SET details=$2 WHERE id=$1',[inserted.rows[0].id,JSON.stringify({actions:rule.definition.actions.length,affected})]);
      await client.query('RELEASE SAVEPOINT automation_run');return {status:'success',affected};
    }catch(error){
      await client.query('ROLLBACK TO SAVEPOINT automation_run');
      const message=(error as Error).message;
      await client.query("INSERT INTO automation_runs(automation_id,event_key,status,details) VALUES($1,$2,'error',$3) ON CONFLICT DO NOTHING",[rule.id,key,JSON.stringify({error:message})]);
      await client.query('RELEASE SAVEPOINT automation_run');return {status:'error',error:message};
    }
  }
  async run(id:string,user:string,body:Record<string,unknown>){
    const rule=await this.access(id,user);
    if(!rule.enabled)bad('Automação pausada.',409);
    const type=rule.definition.trigger.type;
    if(!['card_button','board_button'].includes(type))bad('Somente botões podem ser executados manualmente.');
    const card=body.cardId?checkId(body.cardId):null;
    if(type==='card_button'&&!card)bad('Selecione um cartão.');
    if(type==='board_button'&&card)bad('Botões do quadro não recebem um cartão.');
    if(card&&(await this.features.cardBoard(card,user))!==rule.board_id)bad('Cartão de outro quadro.');
    const client=await this.db.pool.connect();
    try{await client.query('BEGIN');const result=await this.execute(client,rule,'button:'+user+':'+(body.requestId?checkId(body.requestId):randomUUID()),card,[]);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  async suggestions(board:string,user:string){
    await this.features.member(board,user);
    const groups=await this.db.query(`SELECT payload->'after'->>'list_id' AS list_id,count(*)::int AS count FROM automation_events WHERE board_id=$1 AND kind='card_moved' AND cardinality(chain)=0 AND created_at>now()-interval '30 days' GROUP BY 1 HAVING count(*)>=3 ORDER BY count(*) DESC LIMIT 5`,[board]);
    return groups.map(g=>({name:'Definir prazo ao entrar na lista',reason:`${g.count} movimentos para esta lista nos últimos 30 dias.`,definition:{trigger:{type:'event',event:'card_moved',listId:g.list_id},conditions:[],actions:[{type:'due',value:'now + 2 business_days',target:'card'}]}}));
  }
  async tick(){
    if(this.ticking)return;this.ticking=true;
    let client:PoolClient|undefined,locked=false;
    try{
      client=await this.db.pool.connect();locked=Boolean((await client.query('SELECT pg_try_advisory_lock(72641023) AS locked')).rows[0].locked);if(!locked)return;
      const rules=(await client.query<Rule>(`SELECT a.* FROM automations a JOIN boards b ON b.id=a.board_id JOIN board_members m ON m.board_id=a.board_id AND m.user_id=a.owner_id WHERE a.enabled AND b.closed_at IS NULL`)).rows;
      const queue=(await client.query<Event>('SELECT * FROM automation_events WHERE processed_at IS NULL ORDER BY id LIMIT 100')).rows;
      for(const event of queue){
        await client.query('BEGIN');
        for(const rule of rules){const t=rule.definition.trigger;if(rule.board_id!==event.board_id||t.type!=='event'||t.event!==event.kind||new Date(rule.created_at)>new Date(event.created_at as string))continue;
          if(t.listId&&String(event.payload.after?.list_id||'')!==t.listId){const c=event.card_id?await this.context(client,event.card_id):null;if(event.kind==='card_moved'||c?.list_id!==t.listId)continue;}
          await this.execute(client,rule,'event:'+event.id,event.card_id,event.chain);
        }
        await client.query('UPDATE automation_events SET processed_at=now() WHERE id=$1',[event.id]);await client.query('COMMIT');
      }
      const now=new Date();
      for(const rule of rules){
        const t=rule.definition.trigger;
        if(t.type==='scheduled'&&rule.next_run_at&&new Date(rule.next_run_at)<=now){
          await client.query('BEGIN');await this.execute(client,rule,'scheduled:'+new Date(rule.next_run_at).toISOString(),null,[],now);
          await client.query('UPDATE automations SET next_run_at=$2 WHERE id=$1',[rule.id,nextSchedule(t,now)]);await client.query('COMMIT');
        }
        if(t.type==='due'){
          const {rows}=await client.query(`SELECT c.id,c.due_date FROM cards c JOIN lists l ON l.id=c.list_id
            WHERE l.board_id=$1 AND l.archived_at IS NULL AND c.archived_at IS NULL AND NOT c.completed AND c.kind IN ('normal','template')
            AND c.due_date+($2::int*interval '1 minute')<=now() AND c.due_date+($2::int*interval '1 minute')>=$3
            AND ($4::uuid IS NULL OR c.list_id=$4) AND NOT EXISTS(SELECT 1 FROM automation_runs r WHERE r.automation_id=$5 AND r.event_key='due:'||c.id::text||':'||extract(epoch FROM c.due_date)::text) ORDER BY c.due_date LIMIT 100`,[rule.board_id,t.offsetMinutes,rule.created_at,t.listId||null,rule.id]);
          for(const card of rows){const key=(await client.query('SELECT extract(epoch FROM due_date)::text AS epoch FROM cards WHERE id=$1',[card.id])).rows[0]?.epoch;if(!key)continue;await client.query('BEGIN');await this.execute(client,rule,'due:'+card.id+':'+key,card.id,[],now);await client.query('COMMIT');}
        }
      }
      await this.deliverMail(client);
    }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});console.error('Automation worker:',(e as Error).message)}finally{if(client){if(locked)await client.query('SELECT pg_advisory_unlock(72641023)').catch(()=>{});client.release()}this.ticking=false}
  }
  private async deliverMail(client:PoolClient){
    const configured=Boolean(process.env.SMTP_HOST&&process.env.SMTP_FROM);
    if(!configured){await client.query("UPDATE automation_mail SET error='Configure SMTP_HOST e SMTP_FROM para enviar relatórios.' WHERE sent_at IS NULL AND error IS NULL");return}
    const mailer=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',requireTLS:process.env.SMTP_SECURE!=='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined,connectionTimeout:10000,socketTimeout:15000});
    const rows=(await client.query('SELECT * FROM automation_mail WHERE sent_at IS NULL AND attempts<5 AND next_attempt_at<=now() ORDER BY created_at LIMIT 10')).rows;
    for(const mail of rows){try{
      await mailer.sendMail({from:process.env.SMTP_FROM,to:mail.recipient,subject:mail.subject,text:mail.body,messageId:`<orbit-automation-${mail.id}@${process.env.SMTP_FROM!.split('@').pop()}>`});
      await client.query('UPDATE automation_mail SET sent_at=now(),error=NULL,attempts=attempts+1 WHERE id=$1',[mail.id]);
    }catch(e){await client.query("UPDATE automation_mail SET error=$2,attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=$1",[mail.id,(e as Error).message])}}
    mailer.close();
  }
}

@Controller()
export class AutomationsController {
  constructor(@Inject(AutomationsService) private service:AutomationsService,@Inject(FeaturesService) private features:FeaturesService){}
  @Get('boards/:board/automations') list(@Param('board') board:string,@Req() req:Request){return this.service.list(board,this.features.user(req))}
  @Get('boards/:board/automation-status') status(@Param('board') board:string,@Req() req:Request){return this.service.status(board,this.features.user(req))}
  @Post('boards/:board/automations') create(@Param('board') board:string,@Req() req:Request,@Body() body:Record<string,unknown>){return this.service.save(board,this.features.user(req),body)}
  @Get('boards/:board/automation-suggestions') suggestions(@Param('board') board:string,@Req() req:Request){return this.service.suggestions(board,this.features.user(req))}
  @Patch('automations/:id') update(@Param('id') id:string,@Req() req:Request,@Body() body:Record<string,unknown>){return this.service.update(id,this.features.user(req),body)}
  @Delete('automations/:id') remove(@Param('id') id:string,@Req() req:Request){return this.service.remove(id,this.features.user(req))}
  @Post('automations/:id/copy') copy(@Param('id') id:string,@Req() req:Request,@Body() body:Record<string,unknown>){return this.service.copy(id,this.features.user(req),body)}
  @Post('automations/:id/run') run(@Param('id') id:string,@Req() req:Request,@Body() body:Record<string,unknown>){return this.service.run(id,this.features.user(req),body)}
  @Get('automations/:id/logs') logs(@Param('id') id:string,@Req() req:Request){return this.service.logs(id,this.features.user(req))}
}
