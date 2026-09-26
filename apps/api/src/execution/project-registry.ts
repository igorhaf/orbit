import {Inject,Injectable} from '@nestjs/common';
import {mkdir,readdir,realpath,stat,writeFile} from 'node:fs/promises';
import {join,parse as parsePath} from 'node:path';
import {createHash} from 'node:crypto';
import {parseDocument,stringify} from 'yaml';
import {Db} from '../db';
import {DocumentResource,Resource,ResourceKind,permissions} from './types';
import {identifier,readResource,safePath} from './security';

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
export type Project={id:string;name:string;root:string;resourcesRoot:string;config:Record<string,unknown>;resources:Resource[];warnings:string[]};

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
    try{config=parseYaml(await readResource(resourcesRoot,'orbit.yaml'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')warnings=[(error as Error).message]}
    try{
      for(const key of ['agents','plugins','permissions'])stringList(config[key],key);
      if(config.default_executor!==undefined&&!identifier(config.default_executor))throw new Error('Executor padrão inválido.');
      if(config.permissions&&stringList(config.permissions,'permissions').some(x=>!permissions.includes(x as typeof permissions[number])))throw new Error('Permissão de projeto desconhecida.');
      if(config.workflow!==undefined&&(!config.workflow||typeof config.workflow!=='object'||Array.isArray(config.workflow)||Object.values(config.workflow).some(x=>!identifier(x))))throw new Error('Workflow inválido.');
    }catch(error){warnings.push((error as Error).message);config={}}
    const resources:Resource[]=[];
    for(const kind of ['agents','skills','rules','knowledge','plugins','automations'] as ResourceKind[]){
      try{
        const directory=await safePath(resourcesRoot,kind,'directory');
        for(const entry of (await readdir(directory,{withFileTypes:true})).slice(0,100)){
          const id=entry.name.replace(/\.(md|ya?ml)$/,'');
          if(entry.isFile()&&identifier(id)&&/\.(md|yaml)$/.test(entry.name))resources.push({id,name:id,kind});
        }
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')warnings.push(`${kind}: ${(error as Error).message}`)}
    }
    return {id:row.id,name:row.name,root,resourcesRoot,config,resources,warnings};
  }
  async document(project:Project,kind:ResourceKind,id:string):Promise<DocumentResource>{
    if(!identifier(id)||!project.resources.some(x=>x.id===id&&x.kind===kind))throw new Error(`${kind}: recurso ${id} não encontrado.`);
    const text=await readResource(project.resourcesRoot,`${kind}/${id}.${kind==='automations'||kind==='plugins'?'yaml':'md'}`);
    const parsed=kind==='automations'||kind==='plugins'?{metadata:parseYaml(text),body:''}:parseMarkdown(text);
    if(parsed.metadata.id!==undefined&&parsed.metadata.id!==id)throw new Error(`${kind}/${id}: ID não corresponde ao arquivo.`);
    for(const field of ['skills','rules','knowledge','permissions'])stringList(parsed.metadata[field],field);
    if(parsed.metadata.executor!==undefined&&!identifier(parsed.metadata.executor))throw new Error('Executor do agente inválido.');
    return {id,kind,name:typeof parsed.metadata.name==='string'?parsed.metadata.name:id,...parsed,hash:createHash('sha256').update(text).digest('hex')};
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
