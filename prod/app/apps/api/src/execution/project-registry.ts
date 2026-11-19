import {Inject,Injectable} from '@nestjs/common';
import {mkdir,readdir,realpath,stat,writeFile} from 'node:fs/promises';
import {join,relative,resolve,isAbsolute,sep,parse as parsePath} from 'node:path';
import {createHash} from 'node:crypto';
import {parseDocument,stringify} from 'yaml';
import {Db} from '../db';
import {DocumentResource,Resource,ResourceKind,permissions} from './types';
import {identifier,readResource,safePath,redact} from './security';
import {ContextSource,hashContextText,hashContextValue} from './context-manifest';
import {orbitContextRuntime,orbitArchitecturePrompt} from '../orbit-architecture';

export function parseYaml(text:string):Record<string,unknown>{
  if(text.length>64000)throw new Error('Configuração excede 64 KB.');
  const doc=parseDocument(text,{uniqueKeys:true});
  if(doc.errors.length)throw new Error('YAML inválido: '+doc.errors[0].message.split('\n')[0]);
  const result=doc.toJS({maxAliasCount:20}) as unknown;
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('Esperado um objeto YAML.');
  return result as Record<string,unknown>;
}
export function parseMarkdown(text:string){
  const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if(/^---\r?\n/.test(text)&&!match)throw new Error('Frontmatter incompleto.');
  return {metadata:match?parseYaml(match[1]):{},body:match?text.slice(match[0].length):text};
}
export const stringList=(value:unknown,name:string):string[]=>{if(value===undefined)return [];if(!Array.isArray(value)||value.length>30||value.some(x=>typeof x!=='string'||x.length>1000))throw new Error(`${name}: lista inválida.`);return [...new Set(value)] as string[]};
export type Project={id:string;name:string;root:string;resourcesRoot:string;config:Record<string,unknown>;resources:Resource[];warnings:string[];contextWarnings?:string[];authorizationRoot?:string;configObservation?:{logicalPath:string;hash:string|null}};
export type ContextSelectionScope={workspaceId?:string|null};

@Injectable()
export class ProjectRegistry {
  constructor(@Inject(Db) private db:Db){}
  async list(user:string){return this.db.query('SELECT id,name,local_path FROM ai_projects WHERE owner_id=$1 ORDER BY name',[user])}
  async get(id:string,user:string):Promise<Project>{
    const row=await this.db.one('SELECT id,name,local_path FROM ai_projects WHERE id=$1 AND owner_id=$2',[id,user]);
    if(!row)throw new Error('Projeto não encontrado ou sem acesso.');
    const root=await realpath(row.local_path);
    if(root===parsePath(root).root||!(await stat(root)).isDirectory())throw new Error('Pasta de projeto inválida.');
    let resourcesRoot=root;
    try{resourcesRoot=await safePath(root,'.orbit','directory')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    let config:Record<string,unknown>={},warnings:string[]=[];
    const configObservation:{logicalPath:string;hash:string|null}={logicalPath:relative(root,join(resourcesRoot,'orbit.yaml')).replaceAll('\\','/'),hash:null};
    try{const raw=await readResource(resourcesRoot,'orbit.yaml');configObservation.hash=hashContextText(raw);config=parseYaml(raw)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')warnings=[(error as Error).message]}
    try{
      for(const key of ['agents','skills','rules','knowledge','plugins','permissions'])stringList(config[key],key);
      if(config.default_executor!==undefined&&!identifier(config.default_executor))throw new Error('Executor padrão inválido.');
      if(config.permissions&&stringList(config.permissions,'permissions').some(x=>!permissions.includes(x as typeof permissions[number])))throw new Error('Permissão de projeto desconhecida.');
    }catch(error){warnings.push((error as Error).message);config={}}
    const contextWarnings=[...warnings];
    const resources:Resource[]=[];
    for(const kind of ['agents','skills','rules','knowledge','plugins'] as ResourceKind[]){
      try{
        const directory=await safePath(resourcesRoot,kind,'directory');
        const entries=await readdir(directory,{withFileTypes:true});
        if(entries.length>100)warnings.push(`${kind}: limite de 100 recursos excedido.`);
        for(const entry of entries.slice(0,100)){
          const id=entry.name.replace(/\.(md|ya?ml)$/,'');
          if(entry.isFile()&&identifier(id)&&/\.(md|ya?ml)$/.test(entry.name))resources.push({id,name:id,kind,file:entry.name});
        }
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')warnings.push(`${kind}: ${(error as Error).message}`)}
    }
    const project={id:row.id,name:row.name,root,resourcesRoot,config,resources,warnings,contextWarnings,configObservation},invalid=new Set<string>();
    for(const resource of resources){
      try{const document=await this.document(project,resource.kind,resource.id);resource.name=document.name}
      catch(error){invalid.add(`${resource.kind}/${resource.id}`);warnings.push(`${resource.kind}/${resource.id}: ${(error as Error).message}`)}
    }
    const exists=(kind:ResourceKind,id:string)=>resources.some(resource=>resource.kind===kind&&resource.id===id);
    for(const kind of ['agents','skills','rules','knowledge'] as ResourceKind[])for(const id of stringList(config[kind],kind))if(!exists(kind,id))warnings.push(`${kind}: recurso ${id} não encontrado.`);
    for(const resource of resources.filter(item=>item.kind==='agents'&&!invalid.has(`agents/${item.id}`))){
      const agent=await this.document(project,'agents',resource.id);for(const kind of ['skills','rules','knowledge'] as ResourceKind[])for(const id of stringList(agent.metadata[kind],kind))if(!exists(kind,id))warnings.push(`agents/${resource.id}: ${kind}/${id} não encontrado.`)
    }
    return project;
  }
  async document(project:Project,kind:ResourceKind,id:string):Promise<DocumentResource>{
    if(!identifier(id)||!project.resources.some(x=>x.id===id&&x.kind===kind))throw new Error(`${kind}: recurso ${id} não encontrado.`);
    const matches=project.resources.filter(item=>item.id===id&&item.kind===kind);
    if(matches.length!==1)throw new Error(`${kind}/${id}: identidade de recurso ambígua.`);
    const resource=matches[0];
    const text=await readResource(project.resourcesRoot,`${kind}/${resource.file||id+(kind==='plugins'?'.yaml':'.md')}`);
    const parsed=/\.ya?ml$/.test(resource.file||'')||kind==='plugins'?{metadata:parseYaml(text),body:''}:parseMarkdown(text);
    if(parsed.metadata.id!==undefined&&parsed.metadata.id!==id)throw new Error(`${kind}/${id}: ID não corresponde ao arquivo.`);
    for(const field of ['skills','rules','knowledge','permissions'])stringList(parsed.metadata[field],field);
    if(parsed.metadata.executor!==undefined&&!identifier(parsed.metadata.executor))throw new Error('Executor do agente inválido.');
    if(parsed.metadata.action!==undefined&&!identifier(parsed.metadata.action))throw new Error('Action do agente inválida.');
    if(parsed.metadata.name!==undefined&&(typeof parsed.metadata.name!=='string'||parsed.metadata.name.length>200))throw new Error('Nome do recurso inválido.');
    if(stringList(parsed.metadata.permissions,'permissions').some(value=>!permissions.includes(value as typeof permissions[number])))throw new Error('Permissão do recurso desconhecida.');
    return {id,kind,name:typeof parsed.metadata.name==='string'?parsed.metadata.name:id,...parsed,hash:createHash('sha256').update(text).digest('hex')};
  }
  contextSource(project:Project,user:string,scope:ContextSelectionScope,source:Omit<ContextSource,'schemaVersion'|'scope'|'ownerId'|'observedAt'>):ContextSource{
    return {schemaVersion:1,...source,ownerId:user,scope:{runtimeId:orbitContextRuntime,projectId:project.id,workspaceId:scope.workspaceId??null,actorId:user},observedAt:new Date().toISOString()};
  }
  documentSource(project:Project,document:DocumentResource,user:string,scope:ContextSelectionScope={},selectionReason='explicit_selection'):ContextSource{
    const resource=project.resources.find(item=>item.kind===document.kind&&item.id===document.id);
    const logicalPath=relative(project.root,join(project.resourcesRoot,document.kind,resource?.file||document.id+(document.kind==='plugins'?'.yaml':'.md'))).replaceAll('\\','/');
    return this.contextSource(project,user,scope,{id:`document:${document.kind}/${document.id}`,type:document.kind,origin:'project_document',logicalPath,resourceId:`${document.kind}/${document.id}`,version:null,contentHash:hashContextText(redact(document.body)),availability:'available',required:true,selectionReason,dependencies:[],trust:'documental',provenance:{rawHash:document.hash}});
  }
  async fileSource(project:Project,path:string,user:string,scope:ContextSelectionScope={},options:{required?:boolean;selectionReason?:string;type?:string}={}):Promise<{source:ContextSource;text:string|null}>{
    const logicalPath=relative(project.root,resolve(project.root,path));
    if(logicalPath==='..'||logicalPath.startsWith('..'+sep)||isAbsolute(logicalPath))throw new Error('Caminho de contexto fora do projeto.');
    path=logicalPath.replaceAll('\\','/');
    let text:string|null=null;
    try{text=await readResource(project.root,path)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    return {text,source:this.contextSource(project,user,scope,{id:`file:${path}`,type:options.type||'file',origin:'project_file',logicalPath:path,resourceId:path,version:null,contentHash:text===null?null:hashContextText(redact(text)),availability:text===null?'missing':'available',required:options.required!==false,selectionReason:options.selectionReason||'explicit_selection',dependencies:[],trust:'documental',provenance:{rawHash:text===null?null:hashContextText(text)}})};
  }
  async configurationSource(project:Project,user:string,scope:ContextSelectionScope={}):Promise<ContextSource>{
    const path=relative(project.root,join(project.resourcesRoot,'orbit.yaml')).replaceAll('\\','/');
    const observed=await this.fileSource(project,path,user,scope,{required:false,type:'configuration',selectionReason:'project_configuration'});
    if(project.configObservation&&(project.configObservation.logicalPath!==path||project.configObservation.hash!==(observed.source.provenance?.rawHash??null)))throw new Error('A configuração do projeto mudou durante a composição do contexto.');
    return {...observed.source,id:'project:configuration',contentHash:observed.text===null?null:hashContextValue(project.config),provenance:{...observed.source.provenance,effectiveHash:hashContextValue(project.config)}};
  }
  // Re-resolve only the selected resources. Historical hashes never grant access.
  async revalidateSelection(project:Project,user:string,sources:ContextSource[],scope:ContextSelectionScope={}):Promise<ContextSource[]>{
    const row=await this.db.one('SELECT id,name,local_path FROM ai_projects WHERE id=$1 AND owner_id=$2',[project.id,user]);
    if(!row||await realpath(row.local_path)!==await realpath(project.authorizationRoot||project.root))throw new Error('Projeto não encontrado ou sem acesso ao contexto.');
    const observed=await this.observeSelection(project,user,sources,scope);
    for(let index=0;index<observed.length;index++){
      const source=observed[index];
      if(source.origin==='card'||source.origin==='linked_card'){
        const card=await this.db.one<{title:string;description:string;card_revision:number;workspace_id:string}>(`SELECT c.title,c.description,c.card_revision,b.workspace_id FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN authorized_board_members m ON m.board_id=b.id WHERE c.id=$1 AND m.user_id=$2 AND b.closed_at IS NULL AND c.archived_at IS NULL AND l.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM vault_items v WHERE v.card_id=c.id)`,[source.resourceId,user]);
        observed[index]=!card||card.workspace_id!==(scope.workspaceId??null)?{...source,availability:'unavailable',contentHash:null}:{...source,availability:Number.isSafeInteger(card.card_revision)?'available':'unverified',version:Number.isSafeInteger(card.card_revision)?String(card.card_revision):null,contentHash:hashContextValue({title:redact(card.title),description:redact(card.description)})};
      }else if(source.origin==='host_architecture')observed[index]={...source,contentHash:hashContextText(orbitArchitecturePrompt)};
      else if(source.origin!=='project_file'&&source.origin!=='project_document')observed[index]={...source,availability:'unverified'};
    }
    return observed;
  }
  async observeSelection(project:Project,user:string,sources:ContextSource[],scope:ContextSelectionScope={}):Promise<ContextSource[]>{
    const observed:ContextSource[]=[];
    for(const source of sources){
      if(source.scope.runtimeId!==orbitContextRuntime||source.scope.projectId!==project.id||source.scope.actorId!==user||source.ownerId!==user||source.scope.workspaceId!==(scope.workspaceId??null))throw new Error('Escopo de fonte de contexto incompatível.');
      if(source.origin!=='project_file'&&source.origin!=='project_document'){observed.push(source);continue}
      if(!source.logicalPath)throw new Error('Fonte de contexto sem caminho lógico.');
      try{
        const raw=await readResource(project.root,source.logicalPath);
        const body=source.origin==='project_document'?(/\.ya?ml$/.test(source.logicalPath)?'':parseMarkdown(raw).body):raw;
        observed.push({...source,contentHash:source.id==='project:configuration'?hashContextValue(parseYaml(raw)):source.provenance?.selectionOnly?hashContextValue({skills:stringList(parseMarkdown(raw).metadata.skills,'skills')}):hashContextText(redact(body)),availability:'available',provenance:{...source.provenance,rawHash:hashContextText(raw)},observedAt:new Date().toISOString()});
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;observed.push({...source,availability:'missing',contentHash:null,provenance:{...source.provenance,rawHash:null},observedAt:new Date().toISOString()})}
    }
    return observed;
  }
  async assertSelectionUnchanged(project:Project,user:string,sources:ContextSource[],scope:ContextSelectionScope={}){
    const observed=await this.observeSelection(project,user,sources,scope);
    for(let index=0;index<sources.length;index++){
      const before=sources[index],after=observed[index];
      if(before.availability!==after.availability||before.contentHash!==after.contentHash||(before.provenance?.rawHash??null)!==(after.provenance?.rawHash??null))throw new Error('Uma fonte selecionada mudou durante a composição do contexto.');
    }
  }
  async skillPrompt(id:string,user:string,additionalSkills:string[]=[],additionalAgent?:string|null,scope:ContextSelectionScope={},checkoutProject?:Project){
    const project=checkoutProject||await this.get(id,user);
    if(project.id!==id)throw new Error('Identidade do projeto de contexto incompatível.');
    const fatalWarnings=project.contextWarnings??project.warnings;
    if(fatalWarnings.length)throw new Error('Corrija a configuração do projeto: '+fatalWarnings.join('; '));
    const sources:ContextSource[]=[await this.configurationSource(project,user,scope)];
    const execution=project.config.execution&&typeof project.config.execution==='object'&&!Array.isArray(project.config.execution)?project.config.execution as Record<string,unknown>:{};
    const skills=[...stringList(project.config.skills,'skills'),...stringList(execution.skills,'execution.skills'),...additionalSkills];
    const agentIds=[...new Set([execution.agent,additionalAgent].filter((agent):agent is string=>agent!==undefined&&agent!==null&&agent!==''))];
    for(const agentId of agentIds){
      if(!identifier(agentId))throw new Error('Agente configurado inválido.');
      const agent=await new AgentRegistry(this).resolve(project,agentId);
      sources.push({...this.documentSource(project,agent,user,scope,'skill_selection_agent'),contentHash:hashContextValue({skills:stringList(agent.metadata.skills,`agent/${agentId}.skills`)}),provenance:{rawHash:agent.hash,selectionOnly:true}});
      skills.push(...stringList(agent.metadata.skills,`agent/${agentId}.skills`));
    }
    const unique=[...new Set(skills)];
    const documents=await Promise.all(unique.map(skillId=>new SkillRegistry(this).resolve(project,skillId)));
    for(const document of documents)sources.push(this.documentSource(project,document,user,scope,'selected_skill'));
    const text=documents.map(skill=>`## Skill do projeto: ${skill.id}\n${redact(skill.body)}`).join('\n\n');
    if(text.length>60000)throw new Error('As skills do projeto excedem o limite de contexto de 60 KB.');
    await this.assertSelectionUnchanged(project,user,sources,scope);
    return {skills:unique,text,sources,assemblyPolicy:'orbit-skill-prompt/1',configuration:{projectConfigurationHash:hashContextValue(project.config),skills:unique,agents:agentIds}};
  }
  async saveExecutionDefaults(project:Project,user:string,defaults:Record<string,unknown>){
    const next={...project.config,execution:defaults};
    const target=project.resourcesRoot===project.root?join(project.root,'orbit.yaml'):join(project.resourcesRoot,'orbit.yaml');
    await mkdir(project.resourcesRoot,{recursive:true});
    await writeFile(target,stringify(next),'utf8');
    return this.get(project.id,user);
  }
}
export class AgentRegistry {constructor(private projects:ProjectRegistry){}resolve(project:Project,id:string){return this.projects.document(project,'agents',id)}}
export class SkillRegistry {constructor(private projects:ProjectRegistry){}resolve(project:Project,id:string){return this.projects.document(project,'skills',id)}}
