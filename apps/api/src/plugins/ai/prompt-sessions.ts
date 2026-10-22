import {CardLayoutsService} from '../../plugins/card-layouts';
import { assertOrbitFields, orbitArchitecture } from '../../orbit-architecture';
import { extractPromptQuestion, questionGuidance } from '../../prompt-question';
import {validateProjectChecks} from '../../execution/project-checks';
import {redact,redactFileChanges} from '../../execution/security';
import { enforceCodexQuota } from '../../codex-limits';
import { HttpException, Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { access, mkdir, realpath, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { PoolClient } from 'pg';
import { CodexAiService, CodexPromptImage } from '../../codex-ai';
import { Db } from '../../db';
import { cardContextsPrompt, linkedCardContexts } from '../../card-contexts';
import { FeaturesService } from '../../features';
import { OrbitEvents } from '../../orbit-events';
import { extractPromptSummary } from '../../prompt-result';
import { diagnoseToolFailures, ToolCommandActivity } from '../../tool-diagnostics';
import { ProjectRegistry } from '../../execution/project-registry';

type Payload = Record<string, unknown>;
type Effort = 'low'|'medium'|'high'|'xhigh';
type CardContext = { id:string; title:string; description:string; ai_project_id:string|null; ai_model:string|null; ai_effort:Effort|null; ai_execution_mode:'planning'|'bypass'|'question'; ai_default_project_id:string|null; ai_default_model:string|null; ai_default_effort:Effort|null; project_ai_default_model:string|null; project_ai_default_effort:Effort|null; user_ai_default_model:string|null; user_ai_default_effort:Effort|null };
type CommentSettings = {projectId:string;model:string;effort:Effort};
type CommentJob = {comment_id:string;card_id:string;user_id:string;project_id:string;model:string;effort:Effort};
type CommentReply = CommentJob & {authorLabel:string};
const catalog=[
  {id:'gpt-6-astra',name:'Astra',version:'GPT-6'},
  {id:'gpt-6.1-sol',name:'Sol',version:'GPT-6.1'},
  {id:'gpt-6-luna',name:'Luna',version:'GPT-6'},
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
const pathIsWithin=(root:string,path:string)=>{const rel=relative(root,path);return rel===''||(rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel));};
const summaryStart='[[ORBIT_SUMMARY]]';
const summaryEnd='[[/ORBIT_SUMMARY]]';
// Heartbeats run every five seconds. Two minutes tolerate temporary process or
// database stalls without leaving genuinely abandoned runs stuck indefinitely.
const staleRunAfter='2 minutes';

@Injectable()
export class PromptSessionsService implements OnModuleInit,OnModuleDestroy {
  private commentQueueWorkers=new Map<string,Promise<void>>();
  private staleRunTimer:ReturnType<typeof setInterval>|null=null;
  private readonly workerId=`${process.env.ORBIT_ENV||'main'}:${process.pid}:${randomUUID()}`;
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(CodexAiService) private codex:CodexAiService,@Inject(OrbitEvents) private events:OrbitEvents,@Optional() @Inject(ProjectRegistry) private projectRegistry?:ProjectRegistry,@Optional() @Inject(CardLayoutsService) private layouts?:CardLayoutsService){}
  private async member(boardId:string,userId:string){if(!await this.db.one('SELECT board_id FROM board_members WHERE board_id=$1 AND user_id=$2',[boardId,userId]))fail('Quadro não encontrado.',404);}
  async onModuleInit(){
    this.staleRunTimer=setInterval(()=>void this.maintainAiQueues().catch(error=>console.error('Não foi possível atualizar as filas de IA.',error)),5_000);
    this.staleRunTimer.unref();
    if(!this.codex.isAvailable())return;
    await this.db.query("UPDATE card_ai_comment_jobs SET status='queued',started_at=NULL,error=NULL WHERE status='running' AND answer_comment_id IS NULL");
    await this.maintainAiQueues();
  }
  private async maintainAiQueues(){
    if(!this.codex.isAvailable())return;
    await enforceCodexQuota(this.db);
    await this.recoverStaleRuns();
    const queued=await this.db.query<{card_id:string}>('SELECT DISTINCT card_id FROM card_ai_comment_jobs WHERE status=$1',['queued']);
    for(const job of queued)void this.drainCommentQueue(job.card_id).catch((error:unknown)=>console.error('Não foi possível retomar a fila de comentários do GPT.',error));
  }
  async onModuleDestroy(){
    if(this.staleRunTimer)clearInterval(this.staleRunTimer);
    if(!this.codex.isAvailable())return;
    await this.db.query("UPDATE card_ai_runs SET status='error',error='A execução foi interrompida porque o servidor foi reiniciado.',finished_at=now() WHERE worker_id=$1 AND status IN ('queued','running')",[this.workerId]).catch(()=>undefined);
  }
  private async recoverStaleRuns(){
    const stale=await this.db.query<{id:string;card_id:string;user_id:string;board_id:string;title:string}>(`WITH expired AS (
      UPDATE card_ai_runs SET status='error',error='A execução foi interrompida porque o processo responsável deixou de responder.',finished_at=now()
      WHERE status IN ('queued','running') AND heartbeat_at < now()-$1::interval
      RETURNING id,card_id,user_id
    )
    SELECT expired.id,expired.card_id,expired.user_id,l.board_id,c.title
    FROM expired JOIN cards c ON c.id=expired.card_id JOIN lists l ON l.id=c.list_id`,[staleRunAfter]);
    for(const run of stale){
      const message='A execução foi interrompida porque o processo responsável deixou de responder.';
      try{await this.features.notify(run.user_id,run.board_id,run.card_id,'prompt_execution','Falha no prompt',message)}catch(error){console.error('Não foi possível notificar sobre uma execução de prompt interrompida.',error)}
      this.events.promptProgress(run.board_id,run.card_id,{runId:run.id,status:'error',message});
    }
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
    const current=await this.db.one<{name:string;local_path:string;ai_default_model:string|null;ai_default_effort:Effort|null;is_internal_orbit:boolean}>('SELECT name,local_path,ai_default_model,ai_default_effort,is_internal_orbit FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]);
    if(!current)fail('Projeto não encontrado.',404);
    const existing=current as {name:string;local_path:string;ai_default_model:string|null;ai_default_effort:Effort|null;is_internal_orbit:boolean};
    const rawName=body.name;const name=rawName===undefined?existing.name:typeof rawName==='string'&&rawName.trim()&&rawName.trim().length<=120?rawName.trim():fail('Nome inválido.');
    const localPath=body.local_path===undefined?existing.local_path:await this.localPath(body.local_path);
    if(body.local_path!==undefined&&localPath!==existing.local_path&&await this.db.one('SELECT id FROM ai_projects WHERE owner_id=$1 AND local_path=$2 AND id<>$3',[userId,localPath,projectId]))fail('Esta pasta já está cadastrada como projeto.',409);
    const isRoot=Boolean((await this.db.one<{is_root:boolean}>('SELECT is_root FROM users WHERE id=$1',[userId]))?.is_root);
    if(has(body,'is_internal_orbit')&&!isRoot)fail('Somente o usuário root pode classificar um projeto como Orbit interno.',403);
    const isInternalOrbit=has(body,'is_internal_orbit')?body.is_internal_orbit===true:existing.is_internal_orbit;
    const model=!has(body,'ai_default_model')?existing.ai_default_model:body.ai_default_model===null||body.ai_default_model===''?null:selectedModel(body.ai_default_model);
    const effort=!has(body,'ai_default_effort')?existing.ai_default_effort:body.ai_default_effort===null||body.ai_default_effort===''?null:selectedEffort(body.ai_default_effort);
    const updated=await this.db.one<{local_path:string}>('UPDATE ai_projects SET name=$3,local_path=$4,ai_default_model=$5,ai_default_effort=$6,is_internal_orbit=$7,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id,name,local_path,ai_default_model,ai_default_effort,created_at,updated_at,is_internal_orbit',[projectId,userId,name,localPath,model,effort,isInternalOrbit]);
    return updated?this.exposeProjectPath(updated):updated;
  }
  private runningInContainer(){return existsSync('/.dockerenv')||Boolean(process.env.KUBERNETES_SERVICE_HOST);}
  private projectPathRoots(){
    const host=process.env.ORBIT_HOST_PROJECTS_ROOT,container=process.env.ORBIT_CONTAINER_PROJECTS_ROOT;
    if(Boolean(host)!==Boolean(container))fail('Configure ORBIT_HOST_PROJECTS_ROOT e ORBIT_CONTAINER_PROJECTS_ROOT juntos.',500);
    return host&&container?{host:resolve(host),container:resolve(container)}:null;
  }
  private exposeProjectPath<T extends {local_path:string}>(project:T):T{return {...project,local_path:this.projectPathToHost(project.local_path)};}
  private projectPathToContainer(value:string){
    const roots=this.projectPathRoots();if(!roots)return value;
    const supplied=resolve(value);
    if(pathIsWithin(roots.container,supplied))return supplied;
    return pathIsWithin(roots.host,supplied)?resolve(roots.container,relative(roots.host,supplied)):supplied;
  }
  private projectPathToHost(value:string){
    const roots=this.projectPathRoots();if(!roots)return value;
    const supplied=resolve(value);
    return pathIsWithin(roots.container,supplied)?resolve(roots.host,relative(roots.container,supplied)):supplied;
  }
  async projects(userId:string){
    const root=Boolean((await this.db.one('SELECT is_root FROM users WHERE id=$1',[userId]))?.is_root);const shared=await this.features.access?.sharedResources(userId,'projects')||[];
    const projects=await this.db.query<{local_path:string}>('SELECT id,name,local_path,ai_default_model,ai_default_effort,created_at,updated_at,is_internal_orbit FROM ai_projects WHERE (owner_id=$1 OR id=ANY($2::uuid[]) OR $3) ORDER BY is_internal_orbit DESC,name',[userId,shared,root]);
    return projects.map(project=>this.exposeProjectPath(project));
  }
  async executionProjects(userId:string){return this.projects(userId);}
  private async descriptionImages(cardId:string):Promise<CodexPromptImage[]>{
    const rows=await this.db.query<{name:string;mime_type:string;data:Buffer}>("SELECT name,mime_type,data FROM attachments WHERE card_id=$1 AND kind='file' AND mime_type IN ('image/png','image/jpeg','image/webp','image/gif','image/avif') AND data IS NOT NULL ORDER BY position,id LIMIT 10",[cardId]);
    return rows.map(row=>({name:row.name,mimeType:row.mime_type,data:row.data}));
  }
  async projectDirectories(input?:string){
    const roots=this.projectPathRoots();
    if(this.runningInContainer()&&!roots)fail('O seletor está vendo apenas os arquivos do contêiner. Monte a pasta do host no serviço da API e configure ORBIT_HOST_PROJECTS_ROOT e ORBIT_CONTAINER_PROJECTS_ROOT.',409);
    const requested=typeof input==='string'&&input.trim()?input:roots?.host||homedir();
    if(roots&&!pathIsWithin(roots.host,resolve(requested)))fail(`Navegue dentro da raiz de projetos do host: “${roots.host}”.`,403);
    const directory=this.projectPathToContainer(requested);
    const entries=await readdir(directory,{withFileTypes:true}).catch(error=>{const code=(error as NodeJS.ErrnoException).code;if(code==='EACCES'||code==='EPERM')fail('O Orbit não tem permissão para listar esta pasta.',403);if(code==='ENOTDIR')fail('O caminho informado não é uma pasta.');if(code==='ENOENT'&&roots&&(directory===roots.container||directory.startsWith(`${roots.container}/`)))fail(`A pasta do host não está montada no contêiner em “${roots.container}”. Confira o volume no serviço da API e recrie o contêiner.` ,409);if(code==='ENOENT')fail('Esta pasta não existe.',404);return fail('Não foi possível listar esta pasta.',400);});
    const folders=entries.filter(entry=>entry.isDirectory()).map(entry=>({name:entry.name,path:resolve(directory,entry.name)})).sort((a,b)=>a.name.localeCompare(b.name));
    const parentDirectory=roots&&directory===roots.container?null:dirname(directory)===directory?null:dirname(directory);
    return {path:this.projectPathToHost(directory),parent:parentDirectory?this.projectPathToHost(parentDirectory):null,name:basename(directory)||directory,folders:folders.map(folder=>({...folder,path:this.projectPathToHost(folder.path)}))};
  }
  async createProjectDirectory(input:Payload){
    const parent=this.projectPathToContainer(typeof input.path==='string'&&input.path.trim()?input.path:this.projectPathRoots()?.host||homedir());
    const name=typeof input.name==='string'?input.name.trim():'';
    if(!name||name==='.'||name==='..'||name.includes('/')||name.includes('\\')||name.length>120)fail('Informe um nome de pasta válido.');
    try { await stat(parent); } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')fail('A pasta atual não existe.',404); throw error; }
    const target=resolve(parent,name);
    try { await mkdir(target); } catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='EEXIST')fail('Já existe uma pasta com esse nome.',409);if(code==='EACCES'||code==='EPERM')fail('O Orbit não tem permissão para criar essa pasta.');fail('Não foi possível criar a pasta.');}
    return {path:this.projectPathToHost(target)};
  }
  private async localPath(value:unknown,createIfMissing=false,mapHostPath=true):Promise<string>{
    if(typeof value!=='string'||!value.trim()||value.length>2000||!isAbsolute(value))fail('Informe uma pasta local absoluta.');
    const requested=resolve(value as string);
    if(requested===parse(requested).root)fail('Não é permitido usar a raiz do sistema como projeto.');
    const supplied=mapHostPath?this.projectPathToContainer(requested):requested;
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
      if(code==='ENOENT'&&!createIfMissing){
        const roots=this.projectPathRoots();
        const mapsToContainerMount=roots&&pathIsWithin(roots.container,supplied);
        if(this.runningInContainer()&&(!roots&&supplied.startsWith('/home/')||mapsToContainerMount))throw new HttpException({code:'PROJECT_HOST_MOUNT_REQUIRED',message:`A pasta “${value}” não está montada no contêiner do Orbit. Configure um volume Docker de leitura e escrita para essa pasta e os caminhos ORBIT_HOST_PROJECTS_ROOT e ORBIT_CONTAINER_PROJECTS_ROOT.`},409);
        throw new HttpException({code:'PROJECT_DIRECTORY_MISSING',message:`A pasta “${supplied}” não existe. Deseja criá-la?`},409);
      }
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
    const isInternalOrbit=body.is_internal_orbit===true;
    if(body.is_internal_orbit!==undefined&&typeof body.is_internal_orbit!=='boolean')fail('A classificação de projeto interno é inválida.');
    if(isInternalOrbit&&(await this.db.one<{is_root:boolean}>('SELECT is_root FROM users WHERE id=$1',[userId]))?.is_root!==true)fail('Somente o usuário root pode classificar um projeto como Orbit interno.',403);
    const project=await this.db.one<{local_path:string}>('INSERT INTO ai_projects(owner_id,name,local_path,is_internal_orbit) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,local_path) DO NOTHING RETURNING id,name,local_path,ai_default_model,ai_default_effort,created_at,updated_at,is_internal_orbit',[userId,name.trim(),localPath,isInternalOrbit]);
    if(!project)throw new HttpException({message:'Esta pasta já está cadastrada como projeto.'},409);
    return this.exposeProjectPath(project);
  }
  async deleteProject(userId:string,id:string){const project=await this.db.one('DELETE FROM ai_projects WHERE id=$1 AND owner_id=$2 RETURNING id',[uuid(id,'Projeto'),userId]);if(!project)fail('Projeto não encontrado.',404);return {ok:true};}
  async updateBoard(boardId:string,userId:string,body:Payload){
    await this.features.member(boardId,userId);const member=await this.db.one<{role:string}>('SELECT role FROM board_members WHERE board_id=$1 AND user_id=$2',[boardId,userId]);if(!member||member.role!=='owner')fail('Apenas o proprietário pode configurar a IA do quadro.',403);
    const board=await this.db.one<{ai_default_project_id:string|null;ai_default_model:string|null;ai_default_effort:Effort|null}>('SELECT ai_default_project_id,ai_default_model,ai_default_effort FROM boards WHERE id=$1',[boardId]);
    if(!board)fail('Quadro não encontrado.',404);const current=board as {ai_default_project_id:string|null;ai_default_model:string|null;ai_default_effort:Effort|null};
    const rawProject=body.ai_default_project_id;
    const projectId=rawProject===undefined?current.ai_default_project_id:rawProject===null||rawProject===''?null:uuid(rawProject,'Projeto');
    if(projectId&&!await this.db.one('SELECT id FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]))fail('Projeto não encontrado.',404);
    const model=!has(body,'ai_default_model')?current.ai_default_model:body.ai_default_model===null||body.ai_default_model===''?null:selectedModel(body.ai_default_model);
    const effort=!has(body,'ai_default_effort')?current.ai_default_effort:body.ai_default_effort===null||body.ai_default_effort===''?null:selectedEffort(body.ai_default_effort);
    const client=await this.db.pool.connect();
    try{
      await client.query('BEGIN');
      const updated=(await client.query('UPDATE boards SET ai_default_project_id=$2,ai_default_model=$3,ai_default_effort=$4 WHERE id=$1 RETURNING ai_default_project_id,ai_default_model,ai_default_effort',[boardId,projectId,model,effort])).rows[0];
      await client.query(`DELETE FROM card_labels cl USING cards c,lists l,labels label
        WHERE cl.card_id=c.id AND c.list_id=l.id AND cl.label_id=label.id AND l.board_id=$1 AND c.ai_project_id IS NULL
          AND EXISTS(SELECT 1 FROM ai_projects project WHERE project.owner_id=$2 AND project.name=label.name)`,[boardId,userId]);
      if(projectId){
        const project=(await client.query<{name:string}>('SELECT name FROM ai_projects WHERE id=$1',[projectId])).rows[0];
        const existing=(await client.query<{id:string}>('SELECT id FROM labels WHERE board_id=$1 AND name=$2 LIMIT 1',[boardId,project.name])).rows[0];
        const labelId=existing?.id||(await client.query<{id:string}>('INSERT INTO labels(board_id,name,color) VALUES($1,$2,$3) RETURNING id',[boardId,project.name,'green_dark'])).rows[0].id;
        await client.query('INSERT INTO card_labels(card_id,label_id) SELECT c.id,$2 FROM cards c JOIN lists l ON l.id=c.list_id WHERE l.board_id=$1 AND c.ai_project_id IS NULL AND c.archived_at IS NULL ON CONFLICT DO NOTHING',[boardId,labelId]);
      }
      await client.query('COMMIT');
      return updated;
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  private async card(cardId:string,userId:string):Promise<{boardId:string;card:CardContext}>{
    const boardId=await this.features.cardBoard(cardId,userId);
    const card=await this.db.one<CardContext>('SELECT c.id,c.title,c.description,c.ai_project_id,c.ai_model,c.ai_effort,c.ai_execution_mode,b.ai_default_project_id,b.ai_default_model,b.ai_default_effort,p.ai_default_model AS project_ai_default_model,p.ai_default_effort AS project_ai_default_effort,u.ai_default_model AS user_ai_default_model,u.ai_default_effort AS user_ai_default_effort FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN users u ON u.id=$2 LEFT JOIN ai_projects p ON p.id=COALESCE(c.ai_project_id,b.ai_default_project_id) WHERE c.id=$1',[cardId,userId]);
    if(!card)fail('Cartão não encontrado.',404);return {boardId,card:card as CardContext};
  }
  async settingsForCard(cardId:string,userId:string){const {card}=await this.card(cardId,userId);return {projectId:card.ai_project_id||card.ai_default_project_id||null,model:card.ai_model||card.ai_default_model||card.project_ai_default_model||card.user_ai_default_model||null,effort:card.ai_effort||card.ai_default_effort||card.project_ai_default_effort||card.user_ai_default_effort||null};}
  async skillInstructions(projectId:string,userId:string,cardId?:string){
    if(!this.projectRegistry||!projectId)return '';
    const configured=cardId?await this.db.one<{skills:string[];agent:string|null}>('SELECT skills,agent FROM card_execution_configs WHERE card_id=$1',[cardId]):null;
    const resolved=await this.projectRegistry.skillPrompt(projectId,userId,Array.isArray(configured?.skills)?configured.skills:[],configured?.agent);
    return resolved.text?`\n\nINSTRUÇÕES DE SKILLS DO PROJETO (aplique as instruções pertinentes a esta solicitação):\n${resolved.text}`:'';
  }
  async skillInstructionsForCard(cardId:string,userId:string){
    const settings=await this.settingsForCard(cardId,userId);
    return settings.projectId?this.skillInstructions(settings.projectId,userId,cardId):'';
  }
  async commentSettings(cardId:string,userId:string):Promise<CommentSettings>{
    const settings=await this.settingsForCard(cardId,userId);
    if(!settings.projectId)fail('Selecione o projeto do cartão ou configure o projeto padrão do quadro antes de comentar.',409);
    if(!settings.model)fail('Selecione o modelo do cartão ou configure o modelo padrão do quadro antes de comentar.',409);
    if(!settings.effort)fail('Selecione o esforço no cartão, quadro, projeto ou configuração global antes de comentar.',409);
    return {projectId:settings.projectId as string,model:settings.model as string,effort:settings.effort as Effort};
  }
  async enqueueComment(commentId:string,cardId:string,userId:string,settings:CommentSettings,client?:PoolClient){
    await this.layouts?.assertExecutionAllowed(cardId,userId);
    const sql='INSERT INTO card_ai_comment_jobs(comment_id,card_id,user_id,project_id,model,effort) VALUES($1,$2,$3,$4,$5,$6)';
    if(client)await client.query(sql,[commentId,cardId,userId,settings.projectId,settings.model,settings.effort]);
    else await this.db.query(sql,[commentId,cardId,userId,settings.projectId,settings.model,settings.effort]);
  }
  async executeSavedComment(commentId:string,userId:string){
    const comment=await this.db.one<{card_id:string;author_id:string;author_label:string|null;job_status:string|null}>(`SELECT c.card_id,c.author_id,c.author_label,j.status AS job_status
      FROM comments c LEFT JOIN card_ai_comment_jobs j ON j.comment_id=c.id WHERE c.id=$1`,[commentId]);
    if(!comment){fail('Comentário não encontrado.',404);return {queued:false};}
    if(comment.author_id!==userId)fail('Você só pode executar seus comentários.',403);
    if(comment.author_label)fail('Comentários do GPT não podem ser executados.',409);
    if(comment.job_status)fail('Este comentário já foi executado ou está na fila.',409);
    const settings=await this.commentSettings(comment.card_id,userId);
    await this.enqueueComment(commentId,comment.card_id,userId,settings);
    await this.startCommentQueue(comment.card_id,userId);
    return {queued:true};
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
  private async queuePaused(userId:string){
    if(!this.codex.isAvailable())return true;
    await enforceCodexQuota(this.db);
    const row=await this.db.one<{paused:boolean}>("SELECT COALESCE(preferences->>'codexQueuePaused','false')='true' AS paused FROM users WHERE id=$1",[userId]);
    return row?.paused||false;
  }
  private async runCommentQueue(cardId:string){
    const lock=this.db.pool.connect();
    const client=await lock;const lockName=`orbit-comment-queue:${cardId}`;let locked=false;
    try{
      await client.query('SELECT pg_advisory_lock(hashtext($1)::bigint)',[lockName]);locked=true;
      while(true){
        if(!this.codex.isAvailable())break;
        const active=await this.db.one<{active:boolean}>('SELECT EXISTS(SELECT 1 FROM card_runs WHERE card_id=$1 AND status IN (\'queued\',\'running\')) OR EXISTS(SELECT 1 FROM card_ai_runs WHERE card_id=$1 AND status=\'running\') AS active',[cardId]);
        if(active?.active){await new Promise(resolveDelay=>setTimeout(resolveDelay,750));continue;}
        await enforceCodexQuota(this.db);
        const job=await this.db.one<CommentJob>(`WITH next_job AS (
          SELECT comment_id FROM card_ai_comment_jobs WHERE card_id=$1 AND status='queued' AND NOT EXISTS (SELECT 1 FROM users WHERE id=card_ai_comment_jobs.user_id AND preferences->>'codexQueuePaused'='true')
          ORDER BY created_at,comment_id FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE card_ai_comment_jobs jobs SET status='running',started_at=now(),error=NULL
          FROM next_job WHERE jobs.comment_id=next_job.comment_id RETURNING jobs.comment_id,jobs.card_id,jobs.user_id,jobs.project_id,jobs.model,jobs.effort`,[cardId]);
        if(!job){
          const pending=await this.db.one("SELECT 1 FROM card_ai_comment_jobs WHERE card_id=$1 AND status='queued' LIMIT 1",[cardId]);
          if(!pending)break;
          await new Promise(resolveDelay=>setTimeout(resolveDelay,750));continue;
        }
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
    const rawExecutionMode=body.ai_execution_mode;const executionMode=rawExecutionMode===undefined?card.ai_execution_mode:rawExecutionMode==='planning'||rawExecutionMode==='bypass'||rawExecutionMode==='question'?rawExecutionMode:fail('Modo de execução da IA inválido.');
    const client=await this.db.pool.connect();let updated;
    try{
      await client.query('BEGIN');
      updated=(await client.query('UPDATE cards SET ai_project_id=$2,ai_model=$3,ai_effort=$4,ai_execution_mode=$5,updated_at=now() WHERE id=$1 RETURNING ai_project_id,ai_model,ai_effort,ai_execution_mode',[cardId,projectId,model,effort,executionMode])).rows[0];
      await client.query(`DELETE FROM card_labels cl USING labels label
        WHERE cl.card_id=$1 AND cl.label_id=label.id
          AND EXISTS(SELECT 1 FROM ai_projects project WHERE project.owner_id=$2 AND project.name=label.name)`,[cardId,userId]);
      const effectiveProjectId=projectId||card.ai_default_project_id;
      if(effectiveProjectId){
        const project=(await client.query<{name:string}>('SELECT name FROM ai_projects WHERE id=$1',[effectiveProjectId])).rows[0];
        const existing=(await client.query<{id:string}>('SELECT id FROM labels WHERE board_id=$1 AND name=$2 LIMIT 1',[context.boardId,project.name])).rows[0];
        const labelId=existing?.id||(await client.query<{id:string}>('INSERT INTO labels(board_id,name,color) VALUES($1,$2,$3) RETURNING id',[context.boardId,project.name,'green_dark'])).rows[0].id;
        await client.query('INSERT INTO card_labels(card_id,label_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[cardId,labelId]);
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    await this.features.record(userId,context.boardId,cardId,'prompt_session','configurou a sessão de prompt');return updated;
  }
  async runs(cardId:string,userId:string){await this.card(cardId,userId);return this.db.query('SELECT id,project_id,model,effort,source,summary,file_changes,activities,status,prompt,output,error,codex_session_id,COALESCE(started_at,created_at) AS started_at,finished_at FROM card_ai_runs WHERE card_id=$1 ORDER BY created_at DESC LIMIT 20',[cardId]);}
  async toolDiagnostics(userId:string){
    const [latest,failures]=await Promise.all([
      this.db.one<{status:string;error:string|null;activities:ToolCommandActivity[]|null}>('SELECT status,error,activities FROM card_ai_runs WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[userId]),
      this.db.query<{id:string;card_id:string;board_id:string;card_title:string;board_title:string;status:string;error:string|null;activities:ToolCommandActivity[]|null;created_at:string}>(`SELECT r.id,r.card_id,l.board_id,c.title AS card_title,b.title AS board_title,r.status,r.error,r.activities,r.created_at
        FROM card_ai_runs r JOIN cards c ON c.id=r.card_id JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id
        WHERE r.user_id=$1 AND r.status='error' ORDER BY r.created_at DESC,r.id DESC`,[userId]),
    ]);
    const issues=failures.flatMap(run=>diagnoseToolFailures(run).map(problem=>({run_id:run.id,card_id:run.card_id,board_id:run.board_id,card_title:run.card_title,board_title:run.board_title,created_at:run.created_at,...problem})));
    const status=latest&&['queued','running'].includes(latest.status)?'running':latest&&diagnoseToolFailures(latest).length?'error':'success';
    return {status,issues};
  }
  async cancelRun(cardId:string,runId:string,userId:string){
    const context=await this.card(cardId,userId);const id=uuid(runId,'Execução');
    const cancelled=await this.db.one<{id:string}>("UPDATE card_ai_runs SET status='cancelled',error='Cancelado pelo usuário.',finished_at=now() WHERE id=$1 AND card_id=$2 AND status IN ('queued','waiting_answer') RETURNING id",[id,cardId]);
    if(!cancelled){const run=await this.db.one('SELECT status FROM card_ai_runs WHERE id=$1 AND card_id=$2',[id,cardId]);if(!run)fail('Execução não encontrada.',404);fail('Somente execuções ainda na fila podem ser canceladas.',409);}
    this.events.promptProgress(context.boardId,cardId,{runId:id,status:'cancelled',message:'Execução cancelada.'});
    return {ok:true,status:'cancelled' as const};
  }
  async answerRun(cardId:string,runId:string,userId:string,body:Payload){
    await this.card(cardId,userId);
    assertOrbitFields(body,orbitArchitecture.promptRunAnswer);
    const id=uuid(runId,'Execução');
    if(typeof body.answer!=='string'||!body.answer.trim()||body.answer.trim().length>4000)return fail('Informe uma resposta de até 4000 caracteres.');
    const run=await this.db.one<{id:string;user_id:string;project_id:string;model:string;effort:Effort;codex_session_id:string|null;output:string}>("SELECT id,user_id,project_id,model,effort,codex_session_id,output FROM card_ai_runs WHERE id=$1 AND card_id=$2 AND status='waiting_answer'",[id,cardId]);
    if(!run)return fail('A execução não está aguardando resposta.',409);
    if(run.user_id!==userId)fail('Somente o autor da execução pode responder.',403);
    return this.execute(cardId,userId,{instruction:body.answer.trim()},undefined,run);
  }
  async waitingAnswers(userId:string){
    return this.db.query(`SELECT r.id,r.card_id,l.board_id,c.title AS card_title,r.output,r.created_at
      FROM card_ai_runs r JOIN cards c ON c.id=r.card_id JOIN lists l ON l.id=c.list_id
      JOIN board_members bm ON bm.board_id=l.board_id AND bm.user_id=$1
      WHERE r.user_id=$1 AND r.status='waiting_answer' ORDER BY r.created_at,r.id`,[userId]);
  }
  async execute(cardId:string,userId:string,body:Payload={},commentReply?:CommentReply,resume?:{id:string;project_id:string;model:string;effort:Effort;codex_session_id:string|null;output:string}){
    if(!this.codex.isAvailable())fail('O plugin de IA está desativado.',409);
    await this.layouts?.assertExecutionAllowed(cardId,userId);
    const context=await this.card(cardId,userId);const card=context.card;const model=resume?.model||commentReply?.model||card.ai_model||card.ai_default_model||card.project_ai_default_model||card.user_ai_default_model;const effort=resume?.effort||commentReply?.effort||card.ai_effort||card.ai_default_effort||card.project_ai_default_effort||card.user_ai_default_effort;const projectId=resume?.project_id||commentReply?.project_id||card.ai_project_id||card.ai_default_project_id;
    if(!model)fail('Escolha um modelo no cartão, quadro, projeto ou configuração global.',409);if(!effort)fail('Escolha um esforço no cartão, quadro, projeto ou configuração global.',409);if(!projectId)fail('Selecione um projeto no cartão ou configure o padrão do quadro.',409);
    const project=await this.db.one<{id:string;name:string;local_path:string;is_internal_orbit:boolean}>('SELECT id,name,local_path,is_internal_orbit FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]);
    if(!project)fail('Projeto não encontrado.',404);const currentProject=project as {id:string;name:string;local_path:string;is_internal_orbit:boolean};
    const localPath=await this.localPath(currentProject.local_path);
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
      ? `\n\nCHECKLISTS DO CARTÃO (itens [ ] pendentes; itens [x] já concluídos):\n${[...checklistGroups].map(([title,items])=>`${title}${items.length?`\n${items.join('\n')}`:'\n- (sem itens)'}`).join('\n\n')}\n\nEXECUÇÃO OBRIGATÓRIA DO CHECKLIST:\n- Execute todos os itens [ ] em ordem, um por vez; itens [x] servem apenas como contexto e não devem ser refeitos.\n- Ao concluir cada item, valide o resultado com as verificações adequadas e marque o item correspondente do checklist do cartão como concluído.\n- Se uma verificação falhar, investigue a causa, corrija e repita a verificação. Só marque como concluído quando passar.\n- Se não conseguir corrigir uma falha, registre o item como não corrigido, incluindo o motivo, sem marcá-lo como concluído; depois continue com o próximo item pendente. Não pare por causa de uma falha isolada.\n- Ao final, revise todos os itens: confirme quais foram marcados como concluídos e informe quais permaneceram não corrigidos. Não declare concluído um item que não tenha sido executado e validado.`
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
    const executionGuidance='Use o histórico anterior como referência e confira o estado atual dos arquivos e das verificações; não presuma que uma execução anterior concluiu ou validou o trabalho. Implemente somente a solicitação atual e os itens pendentes da checklist deste cartão. Não execute checklists dos cartões de contexto nem repita trabalho já comprovado. Implemente a solicitação nesta execução. Você pode editar arquivos, executar builds e verificações adequadas e respeitar as regras de ciclo de vida do projeto: só reinicie serviços quando o usuário solicitar explicitamente. Se alguma coisa bugar durante a execução, identifique a causa, corrija o problema e retome a solicitação até concluir ou registrar claramente o bloqueio. Não encerre com a execução pendente nem publique alterações sem pedido explícito do usuário. TRABALHO LONGO E RETOMADA: divida solicitações grandes em etapas pequenas, independentes e verificáveis; conclua e registre cada etapa no artefato persistente apropriado antes de iniciar a próxima. Não concentre muitas demandas, verificações ou alterações em um único bloco longo. Antes de repetir uma etapa após interrupção, confira arquivos, histórico e verificações para reaproveitar o progresso válido e evitar efeitos duplicados. Envie progresso curto em cada marco e, se o limite da execução se aproximar, deixe um checkpoint explícito com o que foi concluído, o próximo passo e os riscos, para a próxima execução continuar dali. ECONOMIA DE DADOS: use o histórico e a descrição como contexto sem repeti-los na resposta; envie mensagens de progresso curtas; não copie arquivos completos, diffs ou saídas de terminal para a resposta. Em comandos de validação longos, grave a saída em arquivo temporário, mostre apenas sucesso/falha e, se falhar, apresente somente as linhas relevantes do erro. Seja breve, salvo quando o usuário pedir detalhes.';
    const contextsPrompt=cardContextsPrompt(await linkedCardContexts(this.db,cardId,userId));
    const skillsPrompt=await this.skillInstructions(projectId as string,userId,cardId);
    const configuredScope=await this.db.one<{context:{write_scope?:string[]};permissions:string[]}>('SELECT context,permissions FROM card_execution_configs WHERE card_id=$1',[cardId]);
    const writeScope=configuredScope?.context.write_scope;
    let projectChecks:string[][]=[];if(this.projectRegistry){const registered=await this.projectRegistry.get(projectId as string,userId);if(registered.config.require_write_scope===true&&writeScope===undefined)fail('Este projeto exige um escopo de arquivos configurado para cada demanda.',409);projectChecks=validateProjectChecks(registered.config.post_execution_checks);if(projectChecks.length&&!configuredScope?.permissions.includes('process.execute'))fail('As verificações obrigatórias do projeto exigem permissão para executar processos.',409);}
    const promptImages=await this.descriptionImages(cardId);
    if(commentReply){
      const commentImages=await this.db.query<{name:string;mime_type:string;data:Buffer}>(
        "SELECT name,mime_type,data FROM comment_attachments WHERE comment_id=$1 AND kind='file' AND mime_type IN ('image/png','image/jpeg','image/webp','image/gif','image/avif') AND data IS NOT NULL ORDER BY created_at,id LIMIT 10",
        [commentReply.comment_id]);
      promptImages.push(...commentImages.map(row=>({name:row.name,mimeType:row.mime_type,data:row.data})));
    }
    const imagePrompt=promptImages.length?`\n\nIMAGENS ANEXADAS AO CARTÃO: ${promptImages.length} arquivo(s) de imagem foram anexados ao cartão e estão disponíveis visualmente nesta solicitação. Analise seu conteúdo junto com o texto e identifique os elementos visuais solicitados.`:'';
    const summaryLineLimit=card.ai_execution_mode==='planning'?null:10;
    const summaryInstruction=`\n\nFORMATO FINAL OBRIGATÓRIO:\nDepois da implementação, responda em português com no máximo 5 tópicos curtos, sem repetir o prompt, o histórico, arquivos inteiros ou logs. Em seguida, encerre com um resumo objetivo e didático${summaryLineLimit===null?'':' em até 10 linhas físicas (use menos quando bastar)'}, exatamente neste bloco:\n${summaryStart}\n${summaryLineLimit===null?'[resumo objetivo e didático, sem limite de linhas]':'[resumo em até 10 linhas]'}\n[[ORBIT_COMMIT_TYPE]]\n[um tipo Conventional Commit em minúsculas, como feat, fix, chore, docs, refactor, test ou outro tipo apropriado]\n[[ORBIT_COMMIT_SUMMARY]]\n[descrição simples e objetiva do que foi feito, em uma única linha, sem prefixo de tipo]\n${summaryEnd}\nNão escreva nada depois do marcador final. Relate o que foi feito e o resultado das verificações; não invente resultados.`;
    const questionMode=Boolean(resume)||card.ai_execution_mode==='question';
    const initialQuestion=questionMode&&!resume;
    const modeGuidance=questionMode?`\n\n${questionGuidance(Boolean(resume))}${resume?`\n\nPERGUNTA ANTERIOR:\n${resume.output}`:''}`:'';
    const makePrompt=()=>(continuing
      ? `${executionGuidance}\n\nContinue a conversa deste cartão. A descrição atual é a fonte de requisitos; só altere o projeto quando a mensagem pedir. ${commentReply?'A conversa completa já está nesta sessão; use-a como contexto e processe somente o comentário novo abaixo. ':''}Esta orientação substitui instruções anteriores da sessão que impeçam a implementação ou a validação local.\n\nCARTÃO: ${card.title}${skillsPrompt}\n\nDESCRIÇÃO ATUAL:\n${card.description||card.title}${imagePrompt}${contextsPrompt}${checklistPrompt}${commentReply?'':conversationPrompt}\n\n${commentReply?'NOVA MENSAGEM DO COMENTÁRIO':'NOVA INSTRUÇÃO'}:\n${additional||'Continue a implementação e informe o próximo resultado.'}${summaryInstruction}`
      : `${executionGuidance}\n\nVocê está iniciando a sessão de prompt do Orbit no projeto selecionado. Trabalhe somente dentro do diretório atual.\n\nCARTÃO: ${card.title}${skillsPrompt}\n\nINSTRUÇÃO PRINCIPAL:\n${card.description||card.title}${imagePrompt}${contextsPrompt}${checklistPrompt}${conversationPrompt}${additional&&!initialCommentIsAlreadyInHistory?`\n\n${commentReply?'COMENTÁRIO INICIAL':'INSTRUÇÃO ADICIONAL'}:\n${additional}`:''}${summaryInstruction}`)+modeGuidance;
    let prompt=redact(makePrompt());
    const client=await this.db.pool.connect();let run:{id:string};
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[cardId]);
      if(resume){
        const resumed=(await client.query<{id:string}>("UPDATE card_ai_runs SET status='queued',prompt=$4,worker_id=$3,heartbeat_at=now(),output=NULL,error=NULL,finished_at=NULL WHERE id=$1 AND card_id=$2 AND user_id=$5 AND status='waiting_answer' RETURNING id",[resume.id,cardId,this.workerId,prompt,userId])).rows[0];
        if(!resumed)fail('A execução já foi respondida ou cancelada.',409);
        run=resumed;
      }else{
        const waiting=(await client.query("SELECT id FROM card_ai_runs WHERE card_id=$1 AND status='waiting_answer' LIMIT 1",[cardId])).rows[0];
        if(waiting)fail('Responda ou cancele a pergunta pendente na aba Execução.',409);
        run=(await client.query<{id:string}>("INSERT INTO card_ai_runs(card_id,project_id,user_id,model,effort,prompt,source,worker_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued') RETURNING id",[cardId,currentProject.id,userId,model,effort,prompt,commentReply?'comment':'description',this.workerId])).rows[0];
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    const queuedHeartbeat=setInterval(()=>void this.db.query("UPDATE card_ai_runs SET heartbeat_at=now() WHERE id=$1 AND worker_id=$2 AND status='queued'",[run!.id,this.workerId]).catch(()=>undefined),5_000);
    queuedHeartbeat.unref();
    this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'queued',message:'Execução adicionada à fila.'});
    void (async()=>{
      let cardClient:PoolClient|null=null;let cardLocked=false;let projectClient:PoolClient|null=null;let projectLocked=false;const cardLockName=`orbit-ai-card:${cardId}`;const projectLockName=`orbit-ai-project:${localPath}`;
      try {
        while(true){
          if(await this.queuePaused(userId)){await new Promise(resolveDelay=>setTimeout(resolveDelay,750));continue;}
          const candidate=await this.db.pool.connect();
          const state=(await candidate.query<{status:string}>("SELECT status FROM card_ai_runs WHERE id=$1 AND worker_id=$2",[run!.id,this.workerId])).rows[0];
          if(state?.status!=='queued'){candidate.release();return;}
          const acquired=(await candidate.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked',[cardLockName])).rows[0]?.locked;
          if(!acquired){candidate.release();await new Promise(resolveDelay=>setTimeout(resolveDelay,250));continue;}
          const first=(await candidate.query<{id:string}>("SELECT id FROM card_ai_runs WHERE card_id=$1 AND status IN ('queued','waiting_answer') ORDER BY created_at,id LIMIT 1",[cardId])).rows[0];
          if(first?.id===run!.id){cardClient=candidate;cardLocked=true;break;}
          await candidate.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)',[cardLockName]);candidate.release();
          await new Promise(resolveDelay=>setTimeout(resolveDelay,250));
        }
        projectClient=await this.db.pool.connect();
        await projectClient.query('SELECT pg_advisory_lock(hashtext($1)::bigint)',[projectLockName]);projectLocked=true;
        const previous=await this.db.one<{codex_session_id:string}>('SELECT codex_session_id FROM card_ai_runs WHERE card_id=$1 AND project_id=$2 AND id<>$3 AND codex_session_id IS NOT NULL ORDER BY started_at DESC,id DESC LIMIT 1',[cardId,currentProject.id,run!.id]);
        previousSessionId=resume?.codex_session_id||previous?.codex_session_id||null;continuing=Boolean(previousSessionId);prompt=redact(makePrompt());
        while(await this.queuePaused(userId)){
          const pending=await this.db.one<{status:string}>('SELECT status FROM card_ai_runs WHERE id=$1',[run!.id]);
          if(pending?.status!=='queued')return;
          await new Promise(resolveDelay=>setTimeout(resolveDelay,750));
        }
        const claimed=await this.db.one("UPDATE card_ai_runs SET status='running',prompt=$2,started_at=now(),heartbeat_at=now() WHERE id=$1 AND worker_id=$3 AND status='queued' RETURNING id",[run!.id,prompt,this.workerId]);
        if(!claimed){
          const state=await this.db.one<{status:string}>('SELECT status FROM card_ai_runs WHERE id=$1 AND worker_id=$2',[run!.id,this.workerId]);
          if(!state||state.status==='cancelled')return;
          throw new Error('A execução deixou de estar disponível na fila.');
        }
        let streamedOutput='';let outputWrite:Promise<unknown>=Promise.resolve();const fileChanges=new Map<string,{path:string;kind:'add'|'delete'|'update';additions:number;deletions:number;diff:string}>();const activities=new Map<string,{id:string;kind:'command';command:string;output:string;status:'running'|'completed'|'failed';exitCode?:number}>();
        const progress=(message:string,output=false,replace=false,details?:{fileChanges?:Array<{path:string;kind:'add'|'delete'|'update'}>;activity?:{id:string;kind:'command';command:string;output:string;status:'running'|'completed'|'failed';exitCode?:number}})=>{
          const safeMessage=redact(message);const safeActivity=details?.activity?{...details.activity,command:redact(details.activity.command),output:redact(details.activity.output)}:undefined;
          if(output){streamedOutput=replace?safeMessage:streamedOutput+safeMessage;outputWrite=outputWrite.then(()=>this.db.query('UPDATE card_ai_runs SET output=$2 WHERE id=$1',[run!.id,streamedOutput])).catch(()=>undefined);}
          if(details?.fileChanges){for(const change of details.fileChanges)fileChanges.set(change.path,{...change,additions:0,deletions:0,diff:''});outputWrite=outputWrite.then(()=>this.db.query('UPDATE card_ai_runs SET file_changes=$2 WHERE id=$1',[run!.id,JSON.stringify([...fileChanges.values()])])).catch(()=>undefined);}
          if(safeActivity){activities.set(safeActivity.id,safeActivity);outputWrite=outputWrite.then(()=>this.db.query('UPDATE card_ai_runs SET activities=$2 WHERE id=$1',[run!.id,JSON.stringify([...activities.values()])])).catch(()=>undefined);}
          void this.db.query("UPDATE card_ai_runs SET heartbeat_at=now() WHERE id=$1 AND worker_id=$2 AND status='running'",[run!.id,this.workerId]).catch(()=>undefined);
          this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'running',message:safeMessage,output,replace,files:details?.fileChanges?[...fileChanges.values()].map(({path,kind})=>({path,kind})):undefined,activity:safeActivity});
        };
        progress(`Iniciando ${model} com esforço ${effort}.`);
        const result=await this.codex.execute(prompt,localPath,model as string,effort as string,progress,previousSessionId,sessionId=>this.db.query('UPDATE card_ai_runs SET codex_session_id=$2 WHERE id=$1',[run!.id,sessionId]).then(()=>undefined),async()=>{
          const active=await this.db.query<{id:string}>("UPDATE card_ai_runs SET heartbeat_at=now() WHERE id=$1 AND worker_id=$2 AND status='running' RETURNING id",[run!.id,this.workerId]);
          return active.length>0;
        },initialQuestion?'planning':questionMode?'bypass':card.ai_execution_mode==='planning'?'planning':'bypass',promptImages,initialQuestion?[]:writeScope,initialQuestion?[]:projectChecks,questionMode);
        await enforceCodexQuota(this.db,true);
        for(const change of redactFileChanges(result.fileChanges))fileChanges.set(change.path,change);
        for(const activity of result.activities)activities.set(activity.id,{...activity,command:redact(activity.command),output:redact(activity.output)});
        await outputWrite;
        const safeResultOutput=redact(result.output);
        const question=questionMode?extractPromptQuestion(safeResultOutput):null;
        if(initialQuestion&&!question)throw new Error('O modo Questionar não retornou uma pergunta válida. Tente novamente.');
        if(question){
          const waiting=await this.db.one("UPDATE card_ai_runs SET status='waiting_answer',output=$2,summary=NULL,codex_session_id=$3,file_changes=$4,activities=$5 WHERE id=$1 AND worker_id=$6 AND status='running' RETURNING id",[run!.id,question,result.sessionId,JSON.stringify([...fileChanges.values()]),JSON.stringify([...activities.values()]),this.workerId]);
          if(waiting){
            if(commentReply)await this.db.query("UPDATE card_ai_comment_jobs SET status='success',finished_at=now() WHERE comment_id=$1",[commentReply.comment_id]);
            await this.features.notify(userId,context.boardId,cardId,'prompt_execution','Resposta necessária',question);
            this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'waiting_answer',message:'Aguardando resposta na fila de perguntas.'});
          }
          return;
        }
        const stillOwned=await this.db.one("SELECT 1 FROM card_ai_runs WHERE id=$1 AND worker_id=$2 AND status='running'",[run!.id,this.workerId]);
        if(!stillOwned)return;
        const promptResult=extractPromptSummary(safeResultOutput,summaryLineLimit);
        if(commentReply){
          const replyClient=await this.db.pool.connect();
          try{
            await replyClient.query('BEGIN');
            const publishedSummary=promptResult.summary||'A execução foi concluída; consulte a aba Execução para ver os detalhes.';
            const answer=(await replyClient.query<{id:string}>('INSERT INTO comments(card_id,author_id,author_label,body) VALUES($1,$2,$3,$4) RETURNING id',[cardId,userId,commentReply.authorLabel,publishedSummary])).rows[0];
            await replyClient.query("UPDATE card_ai_runs SET status=$2,output=$3,summary=$4,file_changes=$5,activities=$6,error=$7,codex_session_id=$8,suggested_commit_type=$9,suggested_commit_name=$10,suggested_commit_summary=$11,finished_at=now() WHERE id=$1",[run!.id,'success',promptResult.output,promptResult.summary,JSON.stringify([...fileChanges.values()]),JSON.stringify([...activities.values()]),null,result.sessionId,promptResult.commit.type,promptResult.commit.name,promptResult.commit.summary]);
            await replyClient.query("UPDATE card_ai_comment_jobs SET status='success',answer_comment_id=$2,error=NULL,finished_at=now() WHERE comment_id=$1",[commentReply.comment_id,answer.id]);
            await replyClient.query('COMMIT');
          }catch(error){await replyClient.query('ROLLBACK');throw error}finally{replyClient.release()}
          this.events.commentChanged(context.boardId,cardId);
        }else{
          await this.db.query("UPDATE card_ai_runs SET status=$2,output=$3,summary=$4,file_changes=$5,activities=$6,error=$7,codex_session_id=$8,suggested_commit_type=$9,suggested_commit_name=$10,suggested_commit_summary=$11,finished_at=now() WHERE id=$1",[run!.id,'success',promptResult.output,promptResult.summary,JSON.stringify([...fileChanges.values()]),JSON.stringify([...activities.values()]),null,result.sessionId,promptResult.commit.type,promptResult.commit.name,promptResult.commit.summary]);
          await this.features.record(userId,context.boardId,cardId,'prompt_execution',`${continuing?'continuou':'iniciou'} a conversa com ${model} em ${currentProject.name}`);
        }
        await this.features.notify(userId,context.boardId,cardId,'prompt_execution','Prompt concluído',`O cartão “${card.title}” terminou de processar o prompt.`);
        this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'success',message:'Execução concluída.'});
      }
      catch(error){
        const message=redact(errorMessage(error));
        console.error('[PromptSessions] Execução falhou.',run!.id,message);
        const failed=await this.db.one<{id:string}>("UPDATE card_ai_runs SET status='error',error=$2,finished_at=now() WHERE id=$1 AND status IN ('queued','running') RETURNING id",[run!.id,message]);
        if(!failed)return;
        if(commentReply){await this.db.query("UPDATE card_ai_comment_jobs SET status='error',error=$2,finished_at=now() WHERE comment_id=$1 AND answer_comment_id IS NULL",[commentReply.comment_id,message]);this.events.commentChanged(context.boardId,cardId);}
        await this.features.notify(userId,context.boardId,cardId,'prompt_execution','Falha no prompt',message);
        this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'error',message});
      }finally{
        clearInterval(queuedHeartbeat);
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
