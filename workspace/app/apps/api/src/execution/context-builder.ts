import {createHash} from 'node:crypto';
import {relative,join} from 'node:path';
import {Db} from '../db';
import {CardContextReference,cardContextsPrompt,linkedCardContexts} from '../card-contexts';
import {AgentRegistry,Project,ProjectRegistry,SkillRegistry,stringList,ContextSelectionScope} from './project-registry';
import {ExecutionConfig} from './types';
import {safePath,redact,redactContext} from './security';
import {ContextSource,hashContextText,hashContextValue} from './context-manifest';
import {compileContext,compilationMetadata,type ContextCompileBlock,type ContextCompilerPolicy} from './context-compiler';
import {contextCompilerPolicyFromHost} from './context-compiler-host';
import {knowledgePolicyFromHost,prepareProjectKnowledge} from './knowledge-host';
import {type KnowledgeRetrievalPolicy,knowledgeRetrievalMetadata} from './knowledge-retrieval';
import {orbitArchitecturePrompt} from '../orbit-architecture';

export class ContextBuilder {
  constructor(private db:Db,private projects:ProjectRegistry){}
  async build(project:Project,config:ExecutionConfig,card:{id:string;title:string;description:string;card_revision?:number;workspace_id?:string},user:string,scope:ContextSelectionScope&{compilerPolicy?:ContextCompilerPolicy|null;knowledgePolicy?:KnowledgeRetrievalPolicy|null}={workspaceId:card.workspace_id}){
    const compilerPolicy=scope.compilerPolicy===undefined?contextCompilerPolicyFromHost():scope.compilerPolicy;
    const knowledgePolicy=scope.knowledgePolicy===undefined?knowledgePolicyFromHost(compilerPolicy):scope.knowledgePolicy;
    const redactMaterial=compilerPolicy?redactContext:redact;
    const fatalWarnings=project.contextWarnings??project.warnings;
    if(fatalWarnings.length)throw new Error('Corrija a configuração do projeto: '+fatalWarnings.join('; '));
    if(project.config.require_write_scope===true&&config.context.write_scope===undefined)throw new Error('Este projeto exige um escopo de arquivos por demanda.');
    const sources:ContextSource[]=[this.projects.contextSource(project,user,scope,{id:'host:architecture',type:'host_policy',origin:'host_architecture',resourceId:'orbitArchitecturePrompt',version:'1',contentHash:hashContextText(orbitArchitecturePrompt),availability:'available',required:true,selectionReason:'host_policy',dependencies:[],trust:'host_policy'}),this.projects.contextSource(project,user,scope,{id:`card:${card.id}`,type:'demand',origin:'card',resourceId:card.id,version:Number.isSafeInteger(card.card_revision)?String(card.card_revision):null,contentHash:hashContextValue({title:redactMaterial(card.title),description:redactMaterial(card.description)}),availability:Number.isSafeInteger(card.card_revision)?'available':'unverified',required:true,selectionReason:'execution_demand',dependencies:[],trust:'documental'}),await this.projects.configurationSource(project,user,scope)];
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
    const compileBlocks:ContextCompileBlock[]=[{id:'host:architecture',section:'rules',sourceIds:['host:architecture'],text:redactMaterial(blocks[0]),required:true,priority:'direct'},{id:`task:${card.id}`,section:'task',sourceIds:[`card:${card.id}`],text:redactMaterial(blocks[1]),required:true,priority:'direct'}];
    const resources:{kind:string;id:string;hash:string}[]=[];
    const add=(kind:string,id:string,body:string,hash?:string,sourceId?:string)=>{
      resources.push({kind,id,hash:hash||createHash('sha256').update(body).digest('hex')});const text=`## ${kind}: ${id}\n${redactMaterial(body)}`;blocks.push(text);
      const resourceId=sourceId||((kind==='agent'||kind==='skill')?`document:${kind==='agent'?'agents':'skills'}/${id}`:(kind==='rules'||kind==='knowledge')?`document:${kind}/${id}`:kind==='instructions'?`execution:${id==='write-scope'?'configuration':'instructions'}`:`file:${id}`);
      compileBlocks.push({id:`material:${resourceId}`,section:kind==='rules'||kind==='agent'?'rules':kind==='instructions'?'operations':'dependencies',sourceIds:[resourceId],text:redactMaterial(text),required:!['knowledge','file'].includes(kind),priority:kind==='instructions'?'direct':'explicit',kind:kind==='file'?'structured':'text'});
    };
    if(agent){add('agent',agent.id,agent.body,agent.hash);sources.push(this.projects.documentSource(project,agent,user,scope,'configured_agent'))}
    for(const id of skills){const skill=await new SkillRegistry(this.projects).resolve(project,id);for(const permission of stringList(skill.metadata.permissions,'permissions'))if(!config.permissions.includes(permission))throw new Error(`Skill ${id} exige ${permission}.`);add('skill',id,skill.body,skill.hash);sources.push(this.projects.documentSource(project,skill,user,scope,'selected_skill'))}
    for(const kind of ['rules','knowledge'] as const)for(const id of kind==='rules'?rules:knowledge){const doc=await this.projects.document(project,kind,id);add(kind,id,doc.body,doc.hash);sources.push(this.projects.documentSource(project,doc,user,scope,'selected_'+kind))}
    if(config.context.include_agents_md){
      const primaryPath=relative(project.root,join(project.resourcesRoot,'AGENTS.md')).replaceAll('\\','/');
      const primary=await this.projects.fileSource(project,primaryPath,user,scope,{required:false,type:'instructions',selectionReason:'optional_agents_md'});
      sources.push(primary.source);
      if(primary.text!==null)add('instructions','AGENTS.md',primary.text,undefined,primary.source.id);
      else if(primaryPath!=='AGENTS.md'){
        const fallback=await this.projects.fileSource(project,'AGENTS.md',user,scope,{required:false,type:'instructions',selectionReason:'agents_md_fallback'});
        sources.push(fallback.source);if(fallback.text!==null)add('instructions','AGENTS.md',fallback.text,undefined,fallback.source.id);
      }
    }
    for(const path of config.context.files||[]){
      if(!config.permissions.includes('filesystem.read'))throw new Error('Leitura de arquivos não autorizada.');
      const selected=await this.projects.fileSource(project,path,user,scope);if(selected.text===null)throw new Error('Arquivo de contexto indisponível.');
      sources.push(selected.source);add('file',path,selected.text,undefined,selected.source.id);
    }
    const linked=await linkedCardContexts(this.db,card.id,user);
    const linkedIds=new Set(linked.map(reference=>reference.id));
    for(const id of config.context.cards||[]){
      if(linkedIds.has(id))continue;
      const referenced=await this.db.one<CardContextReference>(`SELECT c.id,c.title,c.description,c.url_token,c.card_revision,b.workspace_id FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN authorized_board_members m ON m.board_id=b.id WHERE c.id=$1 AND m.user_id=$2 AND b.closed_at IS NULL AND c.archived_at IS NULL AND l.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM vault_items v WHERE v.card_id=c.id)`,[id,user]);
      if(!referenced)throw new Error('Cartão de contexto indisponível.');
      linked.push(referenced);linkedIds.add(id);
    }
    for(const reference of linked){
      if(reference.workspace_id&&reference.workspace_id!==scope.workspaceId)throw new Error('Cartão relacionado fora do workspace autorizado.');
      resources.push({kind:'card',id:reference.id,hash:createHash('sha256').update(reference.title+'\n'+reference.description).digest('hex')});
      sources.push(this.projects.contextSource(project,user,scope,{id:`card:${reference.id}`,type:'related_card',origin:'linked_card',resourceId:reference.id,version:Number.isSafeInteger(reference.card_revision)?String(reference.card_revision):null,contentHash:hashContextValue({title:redactMaterial(reference.title),description:redactMaterial(reference.description)}),availability:Number.isSafeInteger(reference.card_revision)?'available':'unverified',required:true,selectionReason:reference.inherited?'inherited_card':'selected_card',dependencies:[],trust:'documental'}));
    }
    if(linked.length){blocks.push(cardContextsPrompt(linked));for(const reference of linked)compileBlocks.push({id:`reference:${reference.id}`,section:'dependencies',sourceIds:[`card:${reference.id}`],text:redactMaterial(cardContextsPrompt([reference])),required:false,priority:'related',kind:'structured'})}
    if(config.context.instructions){add('instructions','card',config.context.instructions);sources.push(this.projects.contextSource(project,user,scope,{id:'execution:instructions',type:'instructions',origin:'execution_configuration',resourceId:card.id,version:null,contentHash:hashContextText(redactMaterial(config.context.instructions)),availability:'available',required:true,selectionReason:'custom_instructions',dependencies:[`card:${card.id}`],trust:'documental'}))}
    if(config.context.write_scope!==undefined)add('instructions','write-scope',`Escrita limitada aos arquivos: ${config.context.write_scope.join(', ')||'(nenhum)'}. Não implemente outras demandas dos contextos.`);
    let prompt=redactMaterial(blocks.join('\n\n'));
    if(!compilerPolicy&&blocks.join('\n\n').length>60000)throw new Error('Contexto excede 60 KB. Selecione menos recursos.');
    await this.projects.assertSelectionUnchanged(project,user,sources,scope);
    for(const reference of linked){
      if(!Number.isSafeInteger(reference.card_revision))continue;
      const current=await this.db.one<CardContextReference>(`SELECT c.id,c.title,c.description,c.card_revision FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN authorized_board_members m ON m.board_id=b.id WHERE c.id=$1 AND m.user_id=$2 AND b.closed_at IS NULL AND c.archived_at IS NULL AND l.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM vault_items v WHERE v.card_id=c.id)`,[reference.id,user]);
      if(!current||current.card_revision!==reference.card_revision||current.title!==reference.title||current.description!==reference.description)throw new Error('Um cartão relacionado mudou durante a composição do contexto.');
    }
    const resolvedExecutor=config.executor||String(agent?.metadata.executor||project.config.default_executor||'codex');
    const retrieval=knowledgePolicy?await prepareProjectKnowledge({projects:this.projects,project,user,scope:{...sources[0].scope,queue:'card_runs',runId:'pending',cardId:card.id,cardRevision:card.card_revision??null,executor:resolvedExecutor,executionType:'card_execution'},permissions:config.permissions,compilerPolicy,policy:knowledgePolicy,card}):null;
    if(retrieval){for(const source of retrieval.sources){const existing=sources.find(s=>s.id===source.id);if(existing){if(existing.contentHash!==source.contentHash)throw new Error('Uma fonte recuperada divergiu do contexto explícito.');if(existing.version===null)existing.version=source.version;}else sources.push(source);}compileBlocks.push(...retrieval.blocks);}
    const configuration:Record<string,import('./context-manifest').ContextJson>={executionConfigHash:hashContextValue({...config,executor:resolvedExecutor}),projectConfigurationHash:hashContextValue(project.config),workingDirectory:config.working_directory,writeScope:config.context.write_scope??null,permissions:config.permissions,skills,rules,knowledge};
    sources.push(this.projects.contextSource(project,user,scope,{id:'execution:configuration',type:'configuration',origin:'execution_configuration',resourceId:card.id,version:'1',contentHash:hashContextValue(configuration),availability:'available',required:true,selectionReason:'effective_execution_configuration',dependencies:[],trust:'observation'}));
    let compilation:ReturnType<typeof compileContext>|undefined;
    if(compilerPolicy){
      compileBlocks.push({id:'technical:execution',section:'technical',sourceIds:[...(sources.find(source=>source.id==='project:configuration')?.availability==='available'?['project:configuration']:[]),'execution:configuration'],text:JSON.stringify({runtimeId:sources[0].scope.runtimeId,projectId:project.id,workspaceId:sources[0].scope.workspaceId,executor:resolvedExecutor,permissions:config.permissions,writeScope:config.context.write_scope??null}),required:true,priority:'direct',kind:'structured'});
      compilation=compileContext({identity:{...sources[0].scope,queue:'card_runs',runId:'pending',cardId:card.id,cardRevision:card.card_revision??null,executor:resolvedExecutor,executionType:'card_execution'},sources,blocks:compileBlocks,policy:compilerPolicy});
      if(compilation.status!=='ready')throw new Error('O contexto obrigatório não cabe no orçamento de compilação; reconciliação necessária.');
      prompt=compilation.text;configuration.contextCompilation=compilationMetadata(compilation);
      if(retrieval)configuration.knowledgeRetrieval={...retrieval.metadata,...knowledgeRetrievalMetadata(retrieval.result,compilation)};
    }
    return {prompt,resources,skills,sources,assemblyPolicy:compilerPolicy?'orbit-context-compiler/1':'orbit-context-builder/1',configuration,...(compilation?{compilation}:{}),workingDirectory:await safePath(project.root,config.working_directory,'directory'),executor:resolvedExecutor};
  }
}
