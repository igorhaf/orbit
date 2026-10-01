import { HttpException, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { access, mkdir, realpath, stat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, parse, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { PoolClient } from 'pg';
import { CodexAiService } from './codex-ai';
import { Db } from './db';
import { FeaturesService } from './features';
import { OrbitEvents } from './orbit-events';

type Payload = Record<string, unknown>;
type Effort = 'low'|'medium'|'high'|'xhigh';
type CardContext = { id:string; title:string; description:string; ai_project_id:string|null; ai_model:string|null; ai_effort:Effort|null; ai_default_project_id:string|null; ai_default_model:string|null; ai_default_effort:Effort|null; project_ai_default_model:string|null; project_ai_default_effort:Effort|null; user_ai_default_model:string|null; user_ai_default_effort:Effort|null };
type CommentSettings = {projectId:string;model:string;effort:Effort};
type CommentJob = {comment_id:string;card_id:string;user_id:string;project_id:string;model:string;effort:Effort};
type CommentReply = CommentJob & {authorLabel:string};
const catalog=[
  {id:'gpt-5.6-luna',name:'Luna',version:'GPT-5.6'},
  {id:'gpt-5.6-sol',name:'Sol',version:'GPT-5.6'},
  {id:'gpt-5.6-terra',name:'Terra',version:'GPT-5.6'},
] as const;
const fail=(message:string,status=400):never=>{throw new HttpException({message},status)};
const errorMessage=(error:unknown)=>{
  if(error instanceof HttpException){const response=error.getResponse();if(typeof response==='string')return response;if(response&&typeof response==='object'&&'message'in response)return String((response as {message:unknown}).message);}
  return error instanceof Error?error.message:'O GPT não conseguiu concluir a solicitação.';
};
const uuid=(value:unknown,label:string):string=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))fail(`${label} inválido.`);return value as string;};
const selectedModel=(value:unknown):string=>{if(typeof value!=='string'||!catalog.some(item=>item.id===value))fail('Modelo inválido.');return value as string;};
const selectedEffort=(value:unknown):Effort=>{if(value!=='low'&&value!=='medium'&&value!=='high'&&value!=='xhigh')fail('Esforço inválido.');return value as Effort;};
const has=(body:Payload,key:string)=>Object.prototype.hasOwnProperty.call(body,key);
const npm=process.platform==='win32'?'npm.cmd':'npm';
const summaryStart='[[ORBIT_SUMMARY]]';
const summaryEnd='[[/ORBIT_SUMMARY]]';
function extractPromptSummary(output:string){
  const match=output.match(/\[\[ORBIT_SUMMARY\]\]\s*([\s\S]*?)\s*\[\[\/ORBIT_SUMMARY\]\]/i);
  if(!match)return {summary:null,output};
  const summary=match[1].split(/\r?\n/).map(line=>line.trim()).filter(Boolean).slice(0,10).join('\n').slice(0,3000)||null;
  return {summary,output:output.replace(match[0],'').trimEnd()};
}

@Injectable()
export class PromptSessionsService implements OnModuleInit {
  private commentQueueWorkers=new Map<string,Promise<void>>();
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(CodexAiService) private codex:CodexAiService,@Inject(OrbitEvents) private events:OrbitEvents){}
  async onModuleInit(){
    await this.db.query("UPDATE card_ai_runs SET status='error',error='A execução foi interrompida porque o servidor foi reiniciado.',finished_at=now() WHERE status IN ('queued','running')");
    await this.db.query("UPDATE card_ai_comment_jobs SET status='queued',started_at=NULL,error=NULL WHERE status='running' AND answer_comment_id IS NULL");
    const queued=await this.db.query<{card_id:string}>('SELECT DISTINCT card_id FROM card_ai_comment_jobs WHERE status=$1',['queued']);
    for(const job of queued)void this.drainCommentQueue(job.card_id).catch((error:unknown)=>console.error('Não foi possível retomar a fila de comentários do GPT.',error));
  }
  models(){return catalog;}
  async updateGlobal(userId:string,body:Payload){
    const current=await this.db.one<{ai_default_model:string|null;ai_default_effort:Effort|null}>('SELECT ai_default_model,ai_default_effort FROM users WHERE id=$1',[userId]);
    if(!current)fail('Conta não encontrada.',404);
    const existing=current as {ai_default_model:string|null;ai_default_effort:Effort|null};
    const model=!has(body,'ai_default_model')?existing.ai_default_model:body.ai_default_model===null||body.ai_default_model===''?null:selectedModel(body.ai_default_model);
    const effort=!has(body,'ai_default_effort')?existing.ai_default_effort:body.ai_default_effort===null||body.ai_default_effort===''?null:selectedEffort(body.ai_default_effort);
    return this.db.one('UPDATE users SET ai_default_model=$2,ai_default_effort=$3 WHERE id=$1 RETURNING ai_default_model,ai_default_effort',[userId,model,effort]);
  }
  async globalSettings(userId:string){return this.db.one<{ai_default_model:string|null;ai_default_effort:Effort|null}>('SELECT ai_default_model,ai_default_effort FROM users WHERE id=$1',[userId]);}
  async updateProject(userId:string,id:string,body:Payload){
    const projectId=uuid(id,'Projeto');
    const current=await this.db.one<{name:string;local_path:string;ai_default_model:string|null;ai_default_effort:Effort|null;is_native:boolean}>('SELECT name,local_path,ai_default_model,ai_default_effort,is_native FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]);
    if(!current)fail('Projeto não encontrado.',404);
    const existing=current as {name:string;local_path:string;ai_default_model:string|null;ai_default_effort:Effort|null;is_native:boolean};
    const rawName=body.name;const name=rawName===undefined?existing.name:typeof rawName==='string'&&rawName.trim()&&rawName.trim().length<=120?rawName.trim():fail('Nome inválido.');
    if(existing.is_native&&body.local_path!==undefined)fail('O caminho do projeto nativo não pode ser alterado.');
    const localPath=body.local_path===undefined?existing.local_path:await this.localPath(body.local_path);
    const model=!has(body,'ai_default_model')?existing.ai_default_model:body.ai_default_model===null||body.ai_default_model===''?null:selectedModel(body.ai_default_model);
    const effort=!has(body,'ai_default_effort')?existing.ai_default_effort:body.ai_default_effort===null||body.ai_default_effort===''?null:selectedEffort(body.ai_default_effort);
    return this.db.one('UPDATE ai_projects SET name=$3,local_path=$4,ai_default_model=$5,ai_default_effort=$6,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id,name,local_path,ai_default_model,ai_default_effort,created_at,updated_at,is_native',[projectId,userId,name,localPath,model,effort]);
  }
  private nativeProjectPath(){return resolve(process.env.ORBIT_NATIVE_ROOT||'/home/meada/projetos/orbit-dev');}
  private async command(directory:string,args:string[]){
    await new Promise<void>((resolveCommand,reject)=>{
      const child=spawn(npm,args,{cwd:directory,stdio:['ignore','pipe','pipe']});let output='';
      child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-2000);});child.stderr.on('data',chunk=>{output=(output+chunk.toString()).slice(-2000);});
      child.on('error',reject);child.on('close',code=>code===0?resolveCommand():reject(new Error(output.trim()||`${args.join(' ')} terminou com código ${code}.`)));
    });
  }
  private async nativeChanges(directory:string){
    return new Promise<boolean>((resolveChanges,reject)=>{
      const child=spawn('git',['status','--porcelain'],{cwd:directory,stdio:['ignore','pipe','pipe']});let output='',error='';
      child.stdout.on('data',chunk=>{output+=chunk.toString();});child.stderr.on('data',chunk=>{error=(error+chunk.toString()).slice(-2000);});
      child.on('error',reject);child.on('close',code=>code===0?resolveChanges(Boolean(output.trim())):reject(new Error(error||'Não foi possível verificar as alterações do Orbit.')));
    });
  }
  private async validateNativeChanges(directory:string,progress:(message:string)=>void){
    if(!await this.nativeChanges(directory))return;
    progress('Aplicando migrações e seed no Orbit em desenvolvimento…');await this.command(directory,['run','db:prepare']);
    progress('Compilando o Orbit em desenvolvimento…');await this.command(directory,['run','build']);
  }
  private async nativeProject(userId:string){
    const current=await this.db.one('SELECT id,name,local_path,ai_default_model,ai_default_effort,created_at,updated_at,is_native FROM ai_projects WHERE owner_id=$1 AND is_native=true LIMIT 1',[userId]);
    if(current)return current;
    const localPath=await this.localPath(this.nativeProjectPath());
    return this.db.one('INSERT INTO ai_projects(owner_id,name,local_path,is_native) VALUES($1,$2,$3,true) RETURNING id,name,local_path,ai_default_model,ai_default_effort,created_at,updated_at,is_native',[userId,'Orbit (nativo)',localPath]);
  }
  async projects(userId:string){
    await this.nativeProject(userId);
    return this.db.query('SELECT id,name,local_path,ai_default_model,ai_default_effort,created_at,updated_at,is_native FROM ai_projects WHERE owner_id=$1 ORDER BY is_native DESC,name',[userId]);
  }
  async executionProjects(userId:string){return this.projects(userId);}
  async projectDirectories(input?:string){
    const directory=resolve(typeof input==='string'&&input.trim()?input:homedir());
    const entries=await readdir(directory,{withFileTypes:true}).catch(error=>{const code=(error as NodeJS.ErrnoException).code;if(code==='EACCES'||code==='EPERM')fail('O Orbit não tem permissão para listar esta pasta.',403);if(code==='ENOTDIR')fail('O caminho informado não é uma pasta.');if(code==='ENOENT')fail('Esta pasta não existe.',404);return fail('Não foi possível listar esta pasta.',400);});
    const folders=entries.filter(entry=>entry.isDirectory()).map(entry=>({name:entry.name,path:resolve(directory,entry.name)})).sort((a,b)=>a.name.localeCompare(b.name));
    return {path:directory,parent:dirname(directory)===directory?null:dirname(directory),name:basename(directory)||directory,folders};
  }
  private async localPath(value:unknown,createIfMissing=false):Promise<string>{
    if(typeof value!=='string'||!value.trim()||value.length>2000||!isAbsolute(value))fail('Informe uma pasta local absoluta.');
    const supplied=resolve(value as string);
    if(supplied===parse(supplied).root)fail('Não é permitido usar a raiz do sistema como projeto.');
    if(createIfMissing){
      try { await mkdir(supplied,{recursive:true}); }
      catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='EACCES'||code==='EPERM')fail('O Orbit não tem permissão para criar essa pasta.');if(code==='ENOTDIR'||code==='EEXIST')fail('O caminho informado contém um item que não é pasta.');fail('Não foi possível criar a pasta neste caminho.');}
    }
    let canonical='';
    try {
      canonical=await realpath(supplied);
      const info=await stat(canonical);
      if(!info.isDirectory())fail('O caminho informado não é uma pasta.');
      await access(canonical,constants.R_OK|constants.W_OK|constants.X_OK);
    } catch(error){
      if(error instanceof HttpException)throw error;
      const code=(error as NodeJS.ErrnoException).code;
      if(code==='ENOENT'&&!createIfMissing)throw new HttpException({code:'PROJECT_DIRECTORY_MISSING',message:`A pasta “${supplied}” não existe. Deseja criá-la?`},409);
      if(code==='EACCES'||code==='EPERM')fail('O Orbit não tem permissão para acessar ou gravar nessa pasta.');
      if(code==='ENOTDIR')fail('O caminho informado contém um item que não é pasta.');
      fail('A pasta local não existe ou não está acessível.');
    }
    if(canonical===parse(canonical).root)fail('Não é permitido usar a raiz do sistema como projeto.');
    return canonical;
  }
  async createProject(userId:string,body:Payload){
    const rawName=body.name;if(typeof rawName!=='string'||!rawName.trim()||rawName.trim().length>120)fail('Nome inválido.');const name=rawName as string;
    const localPath=await this.localPath(body.local_path,body.create_directory===true);
    if(localPath===this.nativeProjectPath())fail('O Orbit é um projeto nativo e não pode ser adicionado à lista de projetos.');
    const project=await this.db.one('INSERT INTO ai_projects(owner_id,name,local_path) VALUES($1,$2,$3) ON CONFLICT(owner_id,local_path) DO NOTHING RETURNING id,name,local_path,ai_default_model,ai_default_effort,created_at,updated_at',[userId,name.trim(),localPath]);
    if(!project)fail('Esta pasta já está cadastrada como projeto.',409);return project;
  }
  async deleteProject(userId:string,id:string){const project=await this.db.one('DELETE FROM ai_projects WHERE id=$1 AND owner_id=$2 AND NOT is_native RETURNING id',[uuid(id,'Projeto'),userId]);if(!project)fail('Projeto não encontrado.',404);return {ok:true};}
  async updateBoard(boardId:string,userId:string,body:Payload){
    await this.features.member(boardId,userId);const member=await this.db.one<{role:string}>('SELECT role FROM board_members WHERE board_id=$1 AND user_id=$2',[boardId,userId]);if(!member||member.role!=='owner')fail('Apenas o proprietário pode configurar a IA do quadro.',403);
    const board=await this.db.one<{ai_default_project_id:string|null;ai_default_model:string|null;ai_default_effort:Effort|null}>('SELECT ai_default_project_id,ai_default_model,ai_default_effort FROM boards WHERE id=$1',[boardId]);
    if(!board)fail('Quadro não encontrado.',404);const current=board as {ai_default_project_id:string|null;ai_default_model:string|null;ai_default_effort:Effort|null};
    const rawProject=body.ai_default_project_id;
    const projectId=rawProject===undefined?current.ai_default_project_id:rawProject===null||rawProject===''?null:uuid(rawProject,'Projeto');
    if(projectId&&!await this.db.one('SELECT id FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]))fail('Projeto não encontrado.',404);
    const model=!has(body,'ai_default_model')?current.ai_default_model:body.ai_default_model===null||body.ai_default_model===''?null:selectedModel(body.ai_default_model);
    const effort=!has(body,'ai_default_effort')?current.ai_default_effort:body.ai_default_effort===null||body.ai_default_effort===''?null:selectedEffort(body.ai_default_effort);
    return this.db.one('UPDATE boards SET ai_default_project_id=$2,ai_default_model=$3,ai_default_effort=$4 WHERE id=$1 RETURNING ai_default_project_id,ai_default_model,ai_default_effort',[boardId,projectId,model,effort]);
  }
  private async card(cardId:string,userId:string):Promise<{boardId:string;card:CardContext}>{
    const boardId=await this.features.cardBoard(cardId,userId);
    const card=await this.db.one<CardContext>('SELECT c.id,c.title,c.description,c.ai_project_id,c.ai_model,c.ai_effort,b.ai_default_project_id,b.ai_default_model,b.ai_default_effort,p.ai_default_model AS project_ai_default_model,p.ai_default_effort AS project_ai_default_effort,u.ai_default_model AS user_ai_default_model,u.ai_default_effort AS user_ai_default_effort FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN users u ON u.id=$2 LEFT JOIN ai_projects p ON p.id=COALESCE(c.ai_project_id,b.ai_default_project_id) WHERE c.id=$1',[cardId,userId]);
    if(!card)fail('Cartão não encontrado.',404);return {boardId,card:card as CardContext};
  }
  async settingsForCard(cardId:string,userId:string){const {card}=await this.card(cardId,userId);return {projectId:card.ai_project_id||card.ai_default_project_id||null,model:card.ai_model||card.ai_default_model||card.project_ai_default_model||card.user_ai_default_model||null,effort:card.ai_effort||card.ai_default_effort||card.project_ai_default_effort||card.user_ai_default_effort||null};}
  async commentSettings(cardId:string,userId:string):Promise<CommentSettings>{
    const settings=await this.settingsForCard(cardId,userId);
    if(!settings.projectId)fail('Selecione o projeto do cartão ou configure o projeto padrão do quadro antes de comentar.',409);
    if(!settings.model)fail('Selecione o modelo do cartão ou configure o modelo padrão do quadro antes de comentar.',409);
    if(!settings.effort)fail('Selecione o esforço no cartão, quadro, projeto ou configuração global antes de comentar.',409);
    return {projectId:settings.projectId as string,model:settings.model as string,effort:settings.effort as Effort};
  }
  async enqueueComment(commentId:string,cardId:string,userId:string,settings:CommentSettings,client?:PoolClient){
    const sql='INSERT INTO card_ai_comment_jobs(comment_id,card_id,user_id,project_id,model,effort) VALUES($1,$2,$3,$4,$5,$6)';
    if(client)await client.query(sql,[commentId,cardId,userId,settings.projectId,settings.model,settings.effort]);
    else await this.db.query(sql,[commentId,cardId,userId,settings.projectId,settings.model,settings.effort]);
  }
  async startCommentQueue(cardId:string,userId:string){
    const {boardId}=await this.card(cardId,userId);
    this.events.commentChanged(boardId,cardId);
    void this.drainCommentQueue(cardId).catch((error:unknown)=>console.error('Não foi possível processar a fila de comentários do GPT.',error));
  }
  private async drainCommentQueue(cardId:string):Promise<void>{
    const current=this.commentQueueWorkers.get(cardId);
    if(current)return current.then(()=>this.drainCommentQueue(cardId));
    const worker=this.runCommentQueue(cardId).finally(()=>this.commentQueueWorkers.delete(cardId));
    this.commentQueueWorkers.set(cardId,worker);
    return worker;
  }
  private async runCommentQueue(cardId:string){
    const lock=this.db.pool.connect();
    const client=await lock;const lockName=`orbit-comment-queue:${cardId}`;let locked=false;
    try{
      await client.query('SELECT pg_advisory_lock(hashtext($1)::bigint)',[lockName]);locked=true;
      while(true){
        const active=await this.db.one<{active:boolean}>('SELECT EXISTS(SELECT 1 FROM card_runs WHERE card_id=$1 AND status IN (\'queued\',\'running\')) OR EXISTS(SELECT 1 FROM card_ai_runs WHERE card_id=$1 AND status=\'running\') AS active',[cardId]);
        if(active?.active){await new Promise(resolveDelay=>setTimeout(resolveDelay,750));continue;}
        const job=await this.db.one<CommentJob>(`WITH next_job AS (
          SELECT comment_id FROM card_ai_comment_jobs WHERE card_id=$1 AND status='queued'
          ORDER BY created_at,comment_id FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE card_ai_comment_jobs jobs SET status='running',started_at=now(),error=NULL
          FROM next_job WHERE jobs.comment_id=next_job.comment_id RETURNING jobs.comment_id,jobs.card_id,jobs.user_id,jobs.project_id,jobs.model,jobs.effort`,[cardId]);
        if(!job)break;
        try{
          this.events.commentChanged((await this.card(cardId,job.user_id)).boardId,cardId);
          const comment=await this.db.one<{body:string}>('SELECT body FROM comments WHERE id=$1',[job.comment_id]);
          if(!comment)throw new Error('O comentário que iniciou esta resposta não existe mais.');
          const replyLabel=this.replyAuthorLabel(job.model,job.effort);
          await this.execute(job.card_id,job.user_id,{instruction:comment.body},{...job,authorLabel:replyLabel});
          while(true){
            const state=await this.db.one<{status:string}>('SELECT status FROM card_ai_comment_jobs WHERE comment_id=$1',[job.comment_id]);
            if(!state||state.status==='success'||state.status==='error')break;
            await new Promise(resolveDelay=>setTimeout(resolveDelay,750));
          }
        }catch(error){
          const message=errorMessage(error);
          const active=await this.db.one<{active:boolean}>('SELECT EXISTS(SELECT 1 FROM card_runs WHERE card_id=$1 AND status IN (\'queued\',\'running\')) OR EXISTS(SELECT 1 FROM card_ai_runs WHERE card_id=$1 AND status=\'running\') AS active',[cardId]);
          if(active?.active){
            await this.db.query("UPDATE card_ai_comment_jobs SET status='queued',started_at=NULL,error=NULL WHERE comment_id=$1 AND status<>'success'",[job.comment_id]);
            await new Promise(resolveDelay=>setTimeout(resolveDelay,750));
            continue;
          }
          await this.db.query("UPDATE card_ai_comment_jobs SET status='error',error=$2,finished_at=now() WHERE comment_id=$1 AND status<>'success'",[job.comment_id,message]);
          const {boardId}=await this.card(cardId,job.user_id).catch(()=>({boardId:''}));
          if(boardId)this.events.commentChanged(boardId,cardId);
        }
      }
    }finally{
      if(locked)await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)',[lockName]);
      client.release();
    }
  }
  private replyAuthorLabel(model:string,effort:Effort){
    const definition=catalog.find(item=>item.id===model);
    const version=/^gpt-([0-9]+(?:\.[0-9]+)?)-/.exec(model)?.[1]||'GPT';
    const name=(definition?.name||model).replace(/^\d+(?:\.\d+)?\s+/,'');
    const efforts:Record<Effort,string>={low:'Baixo',medium:'Médio',high:'Alto',xhigh:'Muito alto'};
    return `[GPT] [${name}] [v${version}] [${efforts[effort]}]`;
  }
  async updateCard(cardId:string,userId:string,body:Payload){
    const context=await this.card(cardId,userId);const card=context.card;
    const rawProject=body.ai_project_id;const projectId=rawProject===undefined?card.ai_project_id:rawProject===null||rawProject===''?null:uuid(rawProject,'Projeto');
    if(projectId&&!await this.db.one('SELECT id FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]))fail('Projeto não encontrado.',404);
    const rawModel=body.ai_model;const model=rawModel===undefined?card.ai_model:rawModel===null||rawModel===''?null:selectedModel(rawModel);
    const rawEffort=body.ai_effort;const effort=rawEffort===undefined?card.ai_effort:rawEffort===null||rawEffort===''?null:selectedEffort(rawEffort);
    const updated=await this.db.one('UPDATE cards SET ai_project_id=$2,ai_model=$3,ai_effort=$4,updated_at=now() WHERE id=$1 RETURNING ai_project_id,ai_model,ai_effort',[cardId,projectId,model,effort]);
    await this.features.record(userId,context.boardId,cardId,'prompt_session','configurou a sessão de prompt');return updated;
  }
  async runs(cardId:string,userId:string){await this.card(cardId,userId);return this.db.query('SELECT id,project_id,model,effort,source,summary,file_changes,activities,status,prompt,output,error,codex_session_id,started_at,finished_at FROM card_ai_runs WHERE card_id=$1 ORDER BY started_at DESC LIMIT 20',[cardId]);}
  async execute(cardId:string,userId:string,body:Payload={},commentReply?:CommentReply){
    const context=await this.card(cardId,userId);const card=context.card;const model=commentReply?.model||card.ai_model||card.ai_default_model||card.project_ai_default_model||card.user_ai_default_model;const effort=commentReply?.effort||card.ai_effort||card.ai_default_effort||card.project_ai_default_effort||card.user_ai_default_effort;const projectId=commentReply?.project_id||card.ai_project_id||card.ai_default_project_id;
    if(!model)fail('Escolha um modelo no cartão, quadro, projeto ou configuração global.',409);if(!effort)fail('Escolha um esforço no cartão, quadro, projeto ou configuração global.',409);if(!projectId)fail('Selecione um projeto no cartão ou configure o padrão do quadro.',409);
    const project=await this.db.one<{id:string;name:string;local_path:string;is_native:boolean}>('SELECT id,name,local_path,is_native FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]);
    if(!project)fail('Projeto não encontrado.',404);const currentProject=project as {id:string;name:string;local_path:string;is_native:boolean};const localPath=await this.localPath(currentProject.local_path);
    const instructionLimit=commentReply?5000:4000;
    const additional=body.instruction===undefined?'':typeof body.instruction==='string'&&body.instruction.trim().length<=instructionLimit?body.instruction.trim():fail('A instrução adicional é inválida.');
    const checklistRows=await this.db.query<{checklist_title:string;item_text:string|null;completed:boolean|null}>(
      `SELECT cl.title AS checklist_title,ci.text AS item_text,ci.completed
       FROM checklists cl LEFT JOIN checklist_items ci ON ci.checklist_id=cl.id
       WHERE cl.card_id=$1 ORDER BY cl.position,cl.id,ci.position,ci.id`,[cardId]);
    const checklistGroups=new Map<string,string[]>();
    for(const row of checklistRows){
      const items=checklistGroups.get(row.checklist_title)||[];
      if(row.item_text)items.push(`- [${row.completed?'x':' '}] ${row.item_text}`);
      checklistGroups.set(row.checklist_title,items);
    }
    const checklistPrompt=checklistGroups.size
      ? `\n\nCHECKLISTS DO CARTÃO (considere os itens pendentes como tarefas e os concluídos como contexto):\n${[...checklistGroups].map(([title,items])=>`${title}${items.length?`\n${items.join('\n')}`:'\n- (sem itens)'}`).join('\n\n')}`
      : '';
    const conversationRows=commentReply?await this.db.query<{author_name:string;body:string}>(
      `SELECT COALESCE(c.author_label,u.name) AS author_name,c.body
       FROM comments c JOIN users u ON u.id=c.author_id
       WHERE c.card_id=$1 ORDER BY c.created_at ASC,c.id ASC`,[cardId]):[];
    const conversationPrompt=commentReply
      ? `\n\nCONVERSA COMPLETA DE COMENTÁRIOS DESTE CARTÃO (em ordem cronológica; use todas as mensagens como contexto):\n${conversationRows.map(row=>`${row.author_name}:\n${row.body}`).join('\n\n')||'(sem comentários anteriores)'}\n\nConsidere o histórico inteiro, mesmo quando partes dele se repetirem.`
      : '';
    const initialCommentIsAlreadyInHistory=commentReply&&conversationRows.some(row=>row.body===additional);
    let previousSessionId:string|null=null;let continuing=false;
    const executionGuidance='Implemente a solicitação nesta execução. Você pode editar arquivos, executar builds e verificações adequadas e reiniciar serviços locais do projeto quando necessário. Não encerre com a execução pendente nem transfira o trabalho para a automação Publicar Orbit, a menos que o usuário peça publicação ou deploy. ECONOMIA DE DADOS: use o histórico e a descrição como contexto sem repeti-los na resposta; envie mensagens de progresso curtas; não copie arquivos completos, diffs ou saídas de terminal para a resposta. Em comandos de validação longos, grave a saída em arquivo temporário, mostre apenas sucesso/falha e, se falhar, apresente somente as linhas relevantes do erro. Seja breve, salvo quando o usuário pedir detalhes.';
    const summaryInstruction=commentReply?'':`\n\nFORMATO FINAL OBRIGATÓRIO:\nDepois da implementação, responda em português com no máximo 5 tópicos curtos, sem repetir o prompt, o histórico, arquivos inteiros ou logs. Em seguida, encerre com um resumo objetivo e didático em até 10 linhas físicas (use menos quando bastar), exatamente neste bloco:\n${summaryStart}\n[resumo em até 10 linhas]\n${summaryEnd}\nNão escreva nada depois do marcador final. Relate o que foi feito e o resultado das verificações; não invente resultados.`;
    const makePrompt=()=>continuing
      ? `Continue a conversa deste cartão. A descrição atual é a fonte de requisitos; só altere o projeto quando a mensagem pedir. ${commentReply?'A conversa completa já está nesta sessão; use-a como contexto e processe somente o comentário novo abaixo. ':''}${executionGuidance} Esta orientação substitui instruções anteriores da sessão que impeçam a implementação ou a validação local.\n\nCARTÃO: ${card.title}\n\nDESCRIÇÃO ATUAL:\n${card.description||card.title}${checklistPrompt}${commentReply?'':conversationPrompt}\n\n${commentReply?'NOVA MENSAGEM DO COMENTÁRIO':'NOVA INSTRUÇÃO'}:\n${additional||'Continue a implementação e informe o próximo resultado.'}${summaryInstruction}`
      : `Você está iniciando a sessão de prompt do Orbit no projeto selecionado. Trabalhe somente dentro do diretório atual. ${executionGuidance}\n\nCARTÃO: ${card.title}\n\nINSTRUÇÃO PRINCIPAL:\n${card.description||card.title}${checklistPrompt}${conversationPrompt}${additional&&!initialCommentIsAlreadyInHistory?`\n\n${commentReply?'COMENTÁRIO INICIAL':'INSTRUÇÃO ADICIONAL'}:\n${additional}`:''}${summaryInstruction}`;
    let prompt=makePrompt();
    const client=await this.db.pool.connect();let run:{id:string};
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[cardId]);
      run=(await client.query<{id:string}>('INSERT INTO card_ai_runs(card_id,project_id,user_id,model,effort,prompt,source) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[cardId,currentProject.id,userId,model,effort,prompt,commentReply?'comment':'description'])).rows[0];await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'queued',message:'Execução adicionada à fila.'});
    void (async()=>{
      let cardClient:PoolClient|null=null;let cardLocked=false;let projectClient:PoolClient|null=null;let projectLocked=false;const cardLockName=`orbit-ai-card:${cardId}`;const projectLockName=`orbit-ai-project:${localPath}`;
      try {
        while(true){
          const candidate=await this.db.pool.connect();
          const acquired=(await candidate.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked',[cardLockName])).rows[0]?.locked;
          if(!acquired){candidate.release();await new Promise(resolveDelay=>setTimeout(resolveDelay,250));continue;}
          const first=(await candidate.query<{id:string}>("SELECT id FROM card_ai_runs WHERE card_id=$1 AND status='queued' ORDER BY created_at,id LIMIT 1",[cardId])).rows[0];
          if(first?.id===run!.id){cardClient=candidate;cardLocked=true;break;}
          await candidate.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)',[cardLockName]);candidate.release();
          await new Promise(resolveDelay=>setTimeout(resolveDelay,250));
        }
        projectClient=await this.db.pool.connect();
        await projectClient.query('SELECT pg_advisory_lock(hashtext($1)::bigint)',[projectLockName]);projectLocked=true;
        const previous=await this.db.one<{codex_session_id:string}>('SELECT codex_session_id FROM card_ai_runs WHERE card_id=$1 AND project_id=$2 AND id<>$3 AND codex_session_id IS NOT NULL ORDER BY started_at DESC,id DESC LIMIT 1',[cardId,currentProject.id,run!.id]);
        previousSessionId=previous?.codex_session_id||null;continuing=Boolean(previousSessionId);prompt=makePrompt();
        await this.db.query("UPDATE card_ai_runs SET status='running',prompt=$2,started_at=now() WHERE id=$1",[run!.id,prompt]);
        let streamedOutput='';let outputWrite:Promise<unknown>=Promise.resolve();const fileChanges=new Map<string,{path:string;kind:'add'|'delete'|'update'}>();const activities=new Map<string,{id:string;kind:'command';command:string;output:string;status:'running'|'completed'|'failed';exitCode?:number}>();
        const progress=(message:string,output=false,replace=false,details?:{fileChanges?:Array<{path:string;kind:'add'|'delete'|'update'}>;activity?:{id:string;kind:'command';command:string;output:string;status:'running'|'completed'|'failed';exitCode?:number}})=>{
          if(output){streamedOutput=replace?message:streamedOutput+message;outputWrite=outputWrite.then(()=>this.db.query('UPDATE card_ai_runs SET output=$2 WHERE id=$1',[run!.id,streamedOutput])).catch(()=>undefined);}
          if(details?.fileChanges){for(const change of details.fileChanges)fileChanges.set(change.path,change);outputWrite=outputWrite.then(()=>this.db.query('UPDATE card_ai_runs SET file_changes=$2 WHERE id=$1',[run!.id,JSON.stringify([...fileChanges.values()])])).catch(()=>undefined);}
          if(details?.activity){activities.set(details.activity.id,details.activity);outputWrite=outputWrite.then(()=>this.db.query('UPDATE card_ai_runs SET activities=$2 WHERE id=$1',[run!.id,JSON.stringify([...activities.values()])])).catch(()=>undefined);}
          this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'running',message,output,replace,files:details?.fileChanges?[...fileChanges.values()]:undefined,activity:details?.activity});
        };
        progress(`Iniciando ${model} com esforço ${effort}.`);
        const result=await this.codex.execute(prompt,localPath,model as string,effort as string,progress,previousSessionId,sessionId=>this.db.query('UPDATE card_ai_runs SET codex_session_id=$2 WHERE id=$1',[run!.id,sessionId]).then(()=>undefined));
        for(const change of result.fileChanges)fileChanges.set(change.path,change);
        for(const activity of result.activities)activities.set(activity.id,activity);
        await outputWrite;
        let validationError:string|null=null;
        if(currentProject.is_native){
          try{await this.validateNativeChanges(localPath,message=>this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'running',message}));}
          catch(error){validationError=errorMessage(error);}
        }
        const promptResult=commentReply?{summary:null,output:result.output}:extractPromptSummary(result.output);
        if(commentReply){
          const replyClient=await this.db.pool.connect();
          try{
            await replyClient.query('BEGIN');
            const answerBody=validationError?`${result.output}\n\n> A resposta foi concluída e a sessão foi preservada, mas a validação automática do projeto falhou. Consulte a aba Execução para ver o erro antes do deploy.`:result.output;
            const answer=(await replyClient.query<{id:string}>('INSERT INTO comments(card_id,author_id,author_label,body) VALUES($1,$2,$3,$4) RETURNING id',[cardId,userId,commentReply.authorLabel,answerBody])).rows[0];
            await replyClient.query("UPDATE card_ai_runs SET status=$2,output=$3,summary=$4,file_changes=$5,activities=$6,error=$7,codex_session_id=$8,finished_at=now() WHERE id=$1",[run!.id,validationError?'error':'success',promptResult.output,promptResult.summary,JSON.stringify([...fileChanges.values()]),JSON.stringify([...activities.values()]),validationError,result.sessionId]);
            await replyClient.query("UPDATE card_ai_comment_jobs SET status='success',answer_comment_id=$2,error=$3,finished_at=now() WHERE comment_id=$1",[commentReply.comment_id,answer.id,validationError]);
            await replyClient.query('COMMIT');
          }catch(error){await replyClient.query('ROLLBACK');throw error}finally{replyClient.release()}
          this.events.commentChanged(context.boardId,cardId);
        }else{
          await this.db.query("UPDATE card_ai_runs SET status=$2,output=$3,summary=$4,file_changes=$5,activities=$6,error=$7,codex_session_id=$8,finished_at=now() WHERE id=$1",[run!.id,validationError?'error':'success',promptResult.output,promptResult.summary,JSON.stringify([...fileChanges.values()]),JSON.stringify([...activities.values()]),validationError,result.sessionId]);
          await this.features.record(userId,context.boardId,cardId,'prompt_execution',`${continuing?'continuou':'iniciou'} a conversa com ${model} em ${currentProject.name}`);
        }
        await this.features.notify(userId,context.boardId,cardId,'prompt_execution',validationError?'Prompt concluído com falha na validação':'Prompt concluído',validationError||`O cartão “${card.title}” terminou de processar o prompt.`);
        this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:validationError?'error':'success',message:validationError||'Execução concluída.'});
      }
      catch(error){
        const message=errorMessage(error);
        await this.db.query("UPDATE card_ai_runs SET status='error',error=$2,finished_at=now() WHERE id=$1",[run!.id,message]);
        if(commentReply){await this.db.query("UPDATE card_ai_comment_jobs SET status='error',error=$2,finished_at=now() WHERE comment_id=$1 AND answer_comment_id IS NULL",[commentReply.comment_id,message]);this.events.commentChanged(context.boardId,cardId);}
        await this.features.notify(userId,context.boardId,cardId,'prompt_execution','Falha no prompt',message);
        this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'error',message});
      }finally{
        if(projectClient){
          try{if(projectLocked)await projectClient.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)',[projectLockName]);}
          finally{projectClient.release();}
        }
        if(cardClient){
          try{if(cardLocked)await cardClient.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)',[cardLockName]);}
          finally{cardClient.release();}
        }
      }
    })().catch(error=>console.error('Não foi possível finalizar a execução de prompt.',error));
    return {id:run!.id,project_id:currentProject.id,model,effort,status:'queued' as const};
  }
}
