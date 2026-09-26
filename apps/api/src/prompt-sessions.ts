import { HttpException, Inject, Injectable } from '@nestjs/common';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, parse } from 'node:path';
import { CodexAiService } from './codex-ai';
import { Db } from './db';
import { FeaturesService } from './features';
import { OrbitEvents } from './orbit-events';

type Payload = Record<string, unknown>;
type Effort = 'low'|'medium'|'high'|'xhigh';
type CardContext = { id:string; title:string; description:string; ai_project_id:string|null; ai_model:string|null; ai_effort:Effort|null; ai_default_model:string|null; ai_default_effort:Effort|null };
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

@Injectable()
export class PromptSessionsService {
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService,@Inject(CodexAiService) private codex:CodexAiService,@Inject(OrbitEvents) private events:OrbitEvents){}
  models(){return catalog;}
  async projects(userId:string){return this.db.query('SELECT id,name,local_path,created_at,updated_at FROM ai_projects WHERE owner_id=$1 ORDER BY name',[userId]);}
  private async localPath(value:unknown):Promise<string>{
    if(typeof value!=='string'||value.length>2000||!isAbsolute(value))fail('Informe uma pasta local absoluta.');const supplied=value as string;
    let resolved='';
    try { resolved=await realpath(supplied); const info=await stat(resolved); if(!info.isDirectory())fail('O caminho não é uma pasta.'); }
    catch(error){if(error instanceof HttpException)throw error;fail('A pasta local não existe ou não está acessível.');}
    if(resolved===parse(resolved).root)fail('Não é permitido usar a raiz do sistema como projeto.');
    return resolved;
  }
  async createProject(userId:string,body:Payload){
    const rawName=body.name;if(typeof rawName!=='string'||!rawName.trim()||rawName.trim().length>120)fail('Nome inválido.');const name=rawName as string;
    const localPath=await this.localPath(body.local_path);
    return this.db.one('INSERT INTO ai_projects(owner_id,name,local_path) VALUES($1,$2,$3) RETURNING id,name,local_path,created_at,updated_at',[userId,name.trim(),localPath]);
  }
  async updateProject(userId:string,id:string,body:Payload){
    const rawName=body.name;const name=rawName===undefined?undefined:typeof rawName==='string'&&rawName.trim()&&rawName.trim().length<=120?rawName.trim():fail('Nome inválido.');
    const localPath=body.local_path===undefined?undefined:await this.localPath(body.local_path);
    const project=await this.db.one('UPDATE ai_projects SET name=COALESCE($3,name),local_path=COALESCE($4,local_path),updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id,name,local_path,created_at,updated_at',[uuid(id,'Projeto'),userId,name??null,localPath??null]);
    if(!project)fail('Projeto não encontrado.',404);return project;
  }
  async deleteProject(userId:string,id:string){const project=await this.db.one('DELETE FROM ai_projects WHERE id=$1 AND owner_id=$2 RETURNING id',[uuid(id,'Projeto'),userId]);if(!project)fail('Projeto não encontrado.',404);return {ok:true};}
  async updateBoard(boardId:string,userId:string,body:Payload){
    await this.features.member(boardId,userId);const member=await this.db.one<{role:string}>('SELECT role FROM board_members WHERE board_id=$1 AND user_id=$2',[boardId,userId]);if(!member||member.role!=='owner')fail('Apenas o proprietário pode configurar a IA do quadro.',403);
    const board=await this.db.one<{ai_default_model:string|null;ai_default_effort:Effort|null}>('SELECT ai_default_model,ai_default_effort FROM boards WHERE id=$1',[boardId]);
    if(!board)fail('Quadro não encontrado.',404);const current=board as {ai_default_model:string|null;ai_default_effort:Effort|null};
    const model=!has(body,'ai_default_model')?current.ai_default_model:body.ai_default_model===null||body.ai_default_model===''?null:selectedModel(body.ai_default_model);
    const effort=!has(body,'ai_default_effort')?current.ai_default_effort:body.ai_default_effort===null||body.ai_default_effort===''?null:selectedEffort(body.ai_default_effort);
    return this.db.one('UPDATE boards SET ai_default_model=$2,ai_default_effort=$3 WHERE id=$1 RETURNING ai_default_model,ai_default_effort',[boardId,model,effort]);
  }
  private async card(cardId:string,userId:string):Promise<{boardId:string;card:CardContext}>{
    const boardId=await this.features.cardBoard(cardId,userId);
    const card=await this.db.one<CardContext>('SELECT c.id,c.title,c.description,c.ai_project_id,c.ai_model,c.ai_effort,b.ai_default_model,b.ai_default_effort FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE c.id=$1',[cardId]);
    if(!card)fail('Cartão não encontrado.',404);return {boardId,card:card as CardContext};
  }
  async settingsForCard(cardId:string,userId:string){const {card}=await this.card(cardId,userId);return {model:card.ai_model||card.ai_default_model||null,effort:card.ai_effort||card.ai_default_effort||'medium' as Effort};}
  async updateCard(cardId:string,userId:string,body:Payload){
    const context=await this.card(cardId,userId);const card=context.card;
    const rawProject=body.ai_project_id;const projectId=rawProject===undefined?card.ai_project_id:rawProject===null||rawProject===''?null:uuid(rawProject,'Projeto');
    if(projectId&&!await this.db.one('SELECT id FROM ai_projects WHERE id=$1 AND owner_id=$2',[projectId,userId]))fail('Projeto não encontrado.',404);
    const rawModel=body.ai_model;const model=rawModel===undefined?card.ai_model:rawModel===null||rawModel===''?null:selectedModel(rawModel);
    const rawEffort=body.ai_effort;const effort=rawEffort===undefined?card.ai_effort:rawEffort===null||rawEffort===''?null:selectedEffort(rawEffort);
    const updated=await this.db.one('UPDATE cards SET ai_project_id=$2,ai_model=$3,ai_effort=$4,updated_at=now() WHERE id=$1 RETURNING ai_project_id,ai_model,ai_effort',[cardId,projectId,model,effort]);
    await this.features.record(userId,context.boardId,cardId,'prompt_session','configurou a sessão de prompt');return updated;
  }
  async runs(cardId:string,userId:string){await this.card(cardId,userId);return this.db.query('SELECT id,model,effort,status,output,error,started_at,finished_at FROM card_ai_runs WHERE card_id=$1 ORDER BY started_at DESC LIMIT 20',[cardId]);}
  async execute(cardId:string,userId:string){
    const context=await this.card(cardId,userId);const card=context.card;const model=card.ai_model||card.ai_default_model;const effort=card.ai_effort||card.ai_default_effort||'medium' as Effort;
    if(!model)fail('Escolha um modelo.',409);if(!card.ai_project_id)fail('Selecione um projeto para executar.',409);
    const project=await this.db.one<{id:string;name:string;local_path:string}>('SELECT id,name,local_path FROM ai_projects WHERE id=$1 AND owner_id=$2',[card.ai_project_id,userId]);
    if(!project)fail('Projeto não encontrado.',404);const currentProject=project as {id:string;name:string;local_path:string};const localPath=await this.localPath(currentProject.local_path);
    const prompt=`Você está executando a sessão de prompt do Orbit no projeto selecionado. Trabalhe somente dentro do diretório atual.\n\nCARTÃO: ${card.title}\n\nINSTRUÇÃO:\n${card.description||card.title}`;
    const run=await this.db.one<{id:string}>('INSERT INTO card_ai_runs(card_id,project_id,user_id,model,effort,prompt) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[cardId,currentProject.id,userId,model,effort,prompt]);
    this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'running',message:`Iniciando ${model} com esforço ${effort}.`});
    try { const output=await this.codex.execute(prompt,localPath,model as string,effort,message=>this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'running',message})); await this.db.query("UPDATE card_ai_runs SET status='success',output=$2,finished_at=now() WHERE id=$1",[run!.id,output]); await this.features.record(userId,context.boardId,cardId,'prompt_execution',`executou ${model} em ${currentProject.name}`); this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'success',message:'Execução concluída.'}); return {id:run!.id,model,effort,status:'success' as const,output}; }
    catch(error){const message=error instanceof Error?error.message:'A execução falhou.';await this.db.query("UPDATE card_ai_runs SET status='error',error=$2,finished_at=now() WHERE id=$1",[run!.id,message]);this.events.promptProgress(context.boardId,cardId,{runId:run!.id,status:'error',message});throw error;}
  }
}
