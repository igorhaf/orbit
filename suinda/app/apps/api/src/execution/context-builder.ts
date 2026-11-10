import {createHash} from 'node:crypto';
import {Db} from '../db';
import {CardContextReference,cardContextsPrompt,linkedCardContexts} from '../card-contexts';
import {AgentRegistry,Project,ProjectRegistry,SkillRegistry,stringList} from './project-registry';
import {ExecutionConfig} from './types';
import {readResource,safePath,redact} from './security';
import {orbitArchitecturePrompt} from '../orbit-architecture';

export class ContextBuilder {
  constructor(private db:Db,private projects:ProjectRegistry){}
  async build(project:Project,config:ExecutionConfig,card:{id:string;title:string;description:string},user:string){
    if(project.warnings.length)throw new Error('Corrija a configuração do projeto: '+project.warnings.join('; '));
    if(project.config.require_write_scope===true&&config.context.write_scope===undefined)throw new Error('Este projeto exige um escopo de arquivos por demanda.');
    const agent=config.agent?await new AgentRegistry(this.projects).resolve(project,config.agent):null;
    const execution=project.config.execution as Record<string,unknown>|undefined;
    const skills=[...new Set([...stringList(project.config.skills,'skills'),...stringList(execution?.skills,'execution.skills'),...stringList(agent?.metadata.skills,'skills'),...config.skills])];
    const rules=[...new Set([...stringList(agent?.metadata.rules,'rules'),...(config.context.rules||[])])];
    const knowledge=[...new Set([...stringList(agent?.metadata.knowledge,'knowledge'),...(config.context.knowledge||[])])];
    const permitted=stringList(project.config.permissions,'permissions');
    const ceiling=permitted.length?permitted:['filesystem.read','process.execute'];
    const agentPermissions=stringList(agent?.metadata.permissions,'permissions');
    for(const permission of config.permissions){
      if(!ceiling.includes(permission))throw new Error(`Projeto não autoriza ${permission}.`);
      if(agentPermissions.length&&!agentPermissions.includes(permission))throw new Error(`Agente não autoriza ${permission}.`);
    }
    const blocks=[orbitArchitecturePrompt,`# Card\n${card.title}\n\n${card.description}`];
    const resources:{kind:string;id:string;hash:string}[]=[];
    const add=(kind:string,id:string,body:string,hash?:string)=>{resources.push({kind,id,hash:hash||createHash('sha256').update(body).digest('hex')});blocks.push(`## ${kind}: ${id}\n${redact(body)}`)};
    if(agent)add('agent',agent.id,agent.body,agent.hash);
    for(const id of skills){const skill=await new SkillRegistry(this.projects).resolve(project,id);for(const permission of stringList(skill.metadata.permissions,'permissions'))if(!config.permissions.includes(permission))throw new Error(`Skill ${id} exige ${permission}.`);add('skill',id,skill.body,skill.hash)}
    for(const kind of ['rules','knowledge'] as const)for(const id of kind==='rules'?rules:knowledge){const doc=await this.projects.document(project,kind,id);add(kind,id,doc.body,doc.hash)}
    if(config.context.include_agents_md){
      try{add('instructions','AGENTS.md',await readResource(project.resourcesRoot,'AGENTS.md'))}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;try{add('instructions','AGENTS.md',await readResource(project.root,'AGENTS.md'))}catch(fallback){if((fallback as NodeJS.ErrnoException).code!=='ENOENT')throw fallback}}
    }
    for(const path of config.context.files||[]){if(!config.permissions.includes('filesystem.read'))throw new Error('Leitura de arquivos não autorizada.');add('file',path,await readResource(project.root,path))}
    const linked=await linkedCardContexts(this.db,card.id,user);
    const linkedIds=new Set(linked.map(reference=>reference.id));
    for(const id of config.context.cards||[]){
      if(linkedIds.has(id))continue;
      const referenced=await this.db.one<CardContextReference>(`SELECT c.id,c.title,c.description,c.url_token FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN board_members m ON m.board_id=b.id WHERE c.id=$1 AND m.user_id=$2 AND b.closed_at IS NULL AND c.archived_at IS NULL`,[id,user]);
      if(!referenced)throw new Error('Cartão de contexto indisponível.');
      linked.push(referenced);linkedIds.add(id);
    }
    for(const reference of linked)resources.push({kind:'card',id:reference.id,hash:createHash('sha256').update(reference.title+'\n'+reference.description).digest('hex')});
    if(linked.length)blocks.push(cardContextsPrompt(linked));
    if(config.context.instructions)add('instructions','card',config.context.instructions);
    if(config.context.write_scope!==undefined)add('instructions','write-scope',`Escrita limitada aos arquivos: ${config.context.write_scope.join(', ')||'(nenhum)'}. Não implemente outras demandas dos contextos.`);
    const prompt=redact(blocks.join('\n\n'));
    if(blocks.join('\n\n').length>60000)throw new Error('Contexto excede 60 KB. Selecione menos recursos.');
    return {prompt,resources,skills,workingDirectory:await safePath(project.root,config.working_directory,'directory'),executor:config.executor||String(agent?.metadata.executor||project.config.default_executor||'codex')};
  }
}
