import { HttpException, Inject, Injectable } from '@nestjs/common';
import { access, mkdir, realpath, stat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, parse, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { CodexAiService } from './codex-ai';
import { Db } from './db';
import { FeaturesService } from './features';
import { OrbitEvents } from './orbit-events';

type Payload = Record<string, unknown>;
type Effort = 'low'|'medium'|'high'|'xhigh';
type CardContext = { id:string; title:string; description:string; ai_project_id:string|null; ai_model:string|null; ai_effort:Effort|null; ai_default_project_id:string|null; ai_default_model:string|null; ai_default_effort:Effort|null };
const catalog=[
  {id:'gpt-6-astra',name:'Astra'},
  {id:'gpt-6-luna',name:'Luna'},
  {id:'gpt-6-sol',name:'Sol'},
  {id:'gpt-5.6-luna',name:'5.6 Luna'},
  {id:'gpt-5.6-sol',name:'5.6 Sol'},
  {id:'gpt-5.6-terra',name:'5.6 Terra'},
] as const;
const fail=(message:string,status=400):never=>{throw new HttpException({message},status)};
const uuid=(value:unknown,label:string):string=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))fail(`${label} inválido.`);return value as string;};
const selectedModel=(value:unknown):string=>{if(typeof value!=='string'||!catalog.some(item=>item.id===value))fail('Modelo inválido.');return value as string;};
const selectedEffort=(value:unknown):Effort=>{if(value!=='low'&&value!=='medium'&&value!=='high'&&value!=='xhigh')fail('Esforço inválido.');return value as Effort;};
const has=(body:Payload,key:string)=>Object.prototype.hasOwnProperty.call(body,key);
const npm=process.platform==='win32'?'npm.cmd':'npm';

@Injectable()
export class PromptSessionsService {
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(CodexAiService) private codex:CodexAiService,@Inject(OrbitEvents) private events:OrbitEvents){}
  models(){return catalog;}
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
    progress('Executando os testes unitários do Orbit…');await this.command(directory,['run','test:unit']);
  }
  private async nativeProject(userId:string){
    const current=await this.db.one('SELECT id,name,local_path,created_at,updated_at,is_native FROM ai_projects WHERE owner_id=$1 AND is_native=true LIMIT 1',[userId]);
    if(current)return current;
    const localPath=await this.localPath(this.nativeProjectPath());
    return this.db.one('INSERT INTO ai_projects(owner_id,name,local_path,is_native) VALUES($1,$2,$3,true) RETURNING id,name,local_path,created_at,updated_at,is_native',[userId,'Orbit (nativo)',localPath]);
  }
  async projects(userId:string){return this.db.query('SELECT id,name,local_path,created_at,updated_at FROM ai_projects WHERE owner_id=$1 AND NOT is_native ORDER BY name',[userId]);}
  async executionProjects(userId:string){return [await this.nativeProject(userId),...await this.projects(userId)];}
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
    const project=await this.db.one('INSERT INTO ai_projects(owner_id,name,local_path) VALUES($1,$2,$3) ON CONFLICT(owner_id,local_path) DO NOTHING RETURNING id,name,local_path,created_at,updated_at',[userId,name.trim(),localPath]);
    if(!project)fail('Esta pasta já está cadastrada como projeto.',409);return project;
  }
  async updateProject(userId:string,id:string,body:Payload){
    const rawName=body.name;const name=rawName===undefined?undefined:typeof rawName==='string'&&rawName.trim()&&rawName.trim().length<=120?rawName.trim():fail('Nome inválido.');
    const localPath=body.local_path===undefined?undefined:await this.localPath(body.local_path);
    const project=await this.db.one('UPDATE ai_projects SET name=COALESCE($3,name),local_path=COALESCE($4,local_path),updated_at=now() WHERE id=$1 AND owner_id=$2 AND NOT is_native RETURNING id,name,local_path,created_at,updated_at',[uuid(id,'Projeto'),userId,name??null,localPath??null]);
    if(!project)fail('Projeto não encontrado.',404);return project;
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
    const card=await this.db.one<CardContext>('SELECT c.id,c.title,c.description,c.ai_project_id,c.ai_model,c.ai_effort,b.ai_default_project_id,b.ai_default_model,b.ai_default_effort FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE c.id=$1',[cardId]);
    if(!card)fail('Cartão não encontrado.',404);return {boardId,card:card as CardContext};
  }
  async settingsForCard(cardId:string,userId:string){const {card}=await this.card(cardId,userId);return {projectId:card.ai_project_id||card.ai_default_project_id||null,model:card.ai_model||card.ai_default_model||null,effort:card.ai_effort||card.ai_default_effort||'medium' as Effort};}
  async updateCard(cardId:string,userId:string,body:Payload){
    const context=await this.card(cardId,userId);const card=context.card;
    const rawProject=body.ai_project_id;const projectId=rawProject===undefined?card.ai_project_id:rawProject===null||rawProject===''?null:uuid(rawProject,'Projeto');
    if(projectId&&!await this.db.one('SELECT id FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]))fail('Projeto não encontrado.',404);
    const rawModel=body.ai_model;const model=rawModel===undefined?card.ai_model:rawModel===null||rawModel===''?null:selectedModel(rawModel);
    const rawEffort=body.ai_effort;const effort=rawEffort===undefined?card.ai_effort:rawEffort===null||rawEffort===''?null:selectedEffort(rawEffort);
    const updated=await this.db.one('UPDATE cards SET ai_project_id=$2,ai_model=$3,ai_effort=$4,updated_at=now() WHERE id=$1 RETURNING ai_project_id,ai_model,ai_effort',[cardId,projectId,model,effort]);
    await this.features.record(userId,context.boardId,cardId,'prompt_session','configurou a sessão de prompt');return updated;
  }
  async runs(cardId:string,userId:string){await this.card(cardId,userId);return this.db.query('SELECT id,model,effort,status,output,error,codex_session_id,started_at,finished_at FROM card_ai_runs WHERE card_id=$1 ORDER BY started_at DESC LIMIT 20',[cardId]);}
  async execute(cardId:string,userId:string,body:Payload={}){
    const context=await this.card(cardId,userId);const card=context.card;const model=card.ai_model||card.ai_default_model;const effort=card.ai_effort||card.ai_default_effort||'medium' as Effort;const projectId=card.ai_project_id||card.ai_default_project_id;
    if(!model)fail('Escolha um modelo.',409);if(!projectId)fail('Selecione um projeto no cartão ou configure o padrão do quadro.',409);
    const project=await this.db.one<{id:string;name:string;local_path:string;is_native:boolean}>('SELECT id,name,local_path,is_native FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]);
    if(!project)fail('Projeto não encontrado.',404);const currentProject=project as {id:string;name:string;local_path:string;is_native:boolean};const localPath=await this.localPath(currentProject.local_path);
    const orbitRoot=this.nativeProjectPath();
    const deployNote=localPath===orbitRoot?'\n\nEste é o projeto do próprio Orbit. Não execute build, deploy, migrations nem reinicie servidores; faça apenas as alterações solicitadas. O botão Deploy do Orbit compila e reinicia depois que a execução terminar.':'';
    const additional=body.instruction===undefined?'':typeof body.instruction==='string'&&body.instruction.trim().length<=4000?body.instruction.trim():fail('A instrução adicional é inválida.');
    const previous=await this.db.one<{codex_session_id:string}>('SELECT codex_session_id FROM card_ai_runs WHERE card_id=$1 AND project_id=$2 AND codex_session_id IS NOT NULL ORDER BY started_at DESC LIMIT 1',[cardId,currentProject.id]);
    const continuing=Boolean(previous?.codex_session_id);
    const prompt=continuing
      ? `Continue a conversa deste cartão. A descrição atual é a fonte de requisitos; só altere o projeto quando a instrução pedir.\n\nCARTÃO: ${card.title}\n\nDESCRIÇÃO ATUAL:\n${card.description||'(sem descrição)'}\n\nNOVA INSTRUÇÃO:\n${additional||'Continue a implementação e informe o próximo resultado.'}`
      : `Você está iniciando a sessão de prompt do Orbit no projeto selecionado. Trabalhe somente dentro do diretório atual.${deployNote}\n\nCARTÃO: ${card.title}\n\nINSTRUÇÃO PRINCIPAL:\n${card.description||card.title}${additional?`\n\nINSTRUÇÃO ADICIONAL:\n${additional}`:''}`;
    const client=await this.db.pool.connect();let run:{id:string};
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[cardId]);
      if((await client.query("SELECT id FROM card_runs WHERE card_id=$1 AND status IN ('queued','running') UNION ALL SELECT id FROM card_ai_runs WHERE card_id=$1 AND status='running'",[cardId])).rowCount)fail('Este cartão já possui uma execução ativa.',409);
      run=(await client.query<{id:string}>('INSERT INTO card_ai_runs(card_id,project_id,user_id,model,effort,prompt) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[cardId,currentProject.id,userId,model,effort,prompt])).rows[0];await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'running',message:`Iniciando ${model} com esforço ${effort}.`});
    try { const result=await this.codex.execute(prompt,localPath,model as string,effort,message=>this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'running',message}),previous?.codex_session_id);if(currentProject.is_native)await this.validateNativeChanges(localPath,message=>this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'running',message})); await this.db.query("UPDATE card_ai_runs SET status='success',output=$2,codex_session_id=$3,finished_at=now() WHERE id=$1",[run!.id,result.output,result.sessionId]); await this.features.record(userId,context.boardId,cardId,'prompt_execution',`${continuing?'continuou':'iniciou'} a conversa com ${model} em ${currentProject.name}`); this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'success',message:'Execução concluída.'}); return {id:run!.id,model,effort,status:'success' as const,output:result.output,codex_session_id:result.sessionId}; }
    catch(error){const message=error instanceof Error?error.message:'A execução falhou.';await this.db.query("UPDATE card_ai_runs SET status='error',error=$2,finished_at=now() WHERE id=$1",[run!.id,message]);this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'error',message});if(error instanceof HttpException)throw error;throw new HttpException(message,422);}
  }
}
