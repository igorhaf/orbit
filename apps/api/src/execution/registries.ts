import Ajv from 'ajv';
import {Executor,ExecutionInput,Integration,Output,Plugin,PluginAction} from './types';
import {ActionDefinition,CapabilityDefinition,PluginActionContext,PluginDefinition} from '../plugins/contract';
import {readResource,noSecrets} from './security';

export class ExecutorRegistry {
  private items=new Map<string,Executor>();
  register(executor:Executor){if(this.items.has(executor.id))throw new Error('Executor duplicado.');this.items.set(executor.id,executor)}
  get(id:string){const executor=this.items.get(id);if(!executor)throw new Error(`Executor não registrado: ${id}`);return executor}
  catalog(){return [...this.items.values()].map(({id,name,actions})=>({id,name,actions}))}
}
export class PluginRegistry {
  private items=new Map<string,Plugin>();
  private disabled=new Set<string>();
  private authorizeAction?:(plugin:string,action:string,user:string)=>Promise<void>;
  setAuthorizer(authorize:(plugin:string,action:string,user:string)=>Promise<void>){this.authorizeAction=authorize}
  private ajv=new Ajv({allErrors:true});
  private id(value:string,label:string){if(!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value))throw new Error(`${label} inválido: ${value}`)}
  private unique<T extends {id:string}>(items:T[],label:string){const ids=new Set<string>();for(const item of items){this.id(item.id,label);if(ids.has(item.id))throw new Error(`${label} duplicado: ${item.id}`);ids.add(item.id)}}
  register(plugin:Plugin){
    this.id(plugin.id,'Plugin');if(this.items.has(plugin.id))throw new Error('Plugin duplicado.');
    if(!plugin.version||!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(plugin.version))throw new Error(`Versão inválida para ${plugin.id}.`);
    const capabilities=plugin.capabilities||[],actions=plugin.actions||[],notifications=plugin.contributions?.notifications||[];
    this.unique(capabilities,'Capability');this.unique(actions,'Action');
    this.unique(notifications,'Plugin notification');
    this.unique(plugin.contributions?.processBoards||[],'Process board');
    const configuration=plugin.configuration||[];
    if(new Set(configuration.map(field=>field.key)).size!==configuration.length||configuration.some(field=>{
      const type=field.type||'text';
      return !/^[A-Z][A-Z0-9_]*$/.test(field.key)||!field.label||!['text','textarea','number','boolean','url','select'].includes(type)||
        (field.min!==undefined&&!Number.isFinite(field.min))||(field.max!==undefined&&!Number.isFinite(field.max))||
        (field.min!==undefined&&field.max!==undefined&&field.min>field.max)||
        (field.maxLength!==undefined&&(!Number.isInteger(field.maxLength)||field.maxLength<1||field.maxLength>20000))||
        (type==='select'&&(!field.options?.length||new Set(field.options.map(option=>option.value)).size!==field.options.length||field.options.some(option=>!option.value||!option.label)))||
        (type!=='select'&&field.options!==undefined);
    }))throw new Error(`Configuração inválida para ${plugin.id}.`);
    const owned=new Set([...this.items.values()].flatMap(item=>(item.configuration||[]).map(field=>field.key)));
    if(configuration.some(field=>owned.has(field.key)))throw new Error(`Variável de plugin já registrada: ${plugin.id}.`);
    const known=new Set(capabilities.map(item=>item.id));
    for(const action of actions){for(const capability of action.requiredCapabilities||[])if(!known.has(capability))throw new Error(`Capability não registrada: ${capability}`);this.ajv.compile(action.inputSchema);if(action.outputSchema)this.ajv.compile(action.outputSchema)}
    if(plugin.connectionProvider){this.id(plugin.connectionProvider.id,'Connection provider');for(const capability of plugin.connectionProvider.capabilities)if(!known.has(capability))throw new Error(`Capability não registrada: ${capability}`)}
    this.unique(plugin.contributions?.cardLayouts||[],'Card layout');
    this.unique(plugin.contributions?.cardTypes||[],'Card type');
    this.unique(plugin.contributions?.boardViews||[],'Board view');
    const recordKinds=plugin.contributions?.recordKinds||{};
    for(const [kind,definition] of Object.entries(recordKinds)){
      this.id(kind,'Record kind');
      if(!definition||typeof definition.label!=='string'||!definition.label.trim()||typeof definition.initial!=='string'||!definition.initial.trim()||!definition.transitions||typeof definition.transitions!=='object'||Array.isArray(definition.transitions)||!definition.example||typeof definition.example!=='object'||Array.isArray(definition.example))throw new Error(`Tipo de registro inválido para ${plugin.id}.${kind}.`);
      for(const [state,next] of Object.entries(definition.transitions))if(!state.trim()||!Array.isArray(next)||next.some(value=>typeof value!=='string'||!value.trim()))throw new Error(`Transições inválidas para ${plugin.id}.${kind}.`);
      for(const action of definition.detailActions||[]){
        if(!/^[a-z][a-z0-9_-]{1,60}$/.test(action.id)||!action.label?.trim()||(action.retryLabel!==undefined&&(typeof action.retryLabel!=='string'||!action.retryLabel.trim()))||!Array.isArray(action.states)||!action.states.length||action.states.some(state=>typeof state!=='string'||!state.trim())||!['write','publish'].includes(action.permission)||!action.path?.startsWith('/')||action.path.startsWith('//')||/[\r\n]/.test(action.path)||(action.ownsTransitions!==undefined&&typeof action.ownsTransitions!=='boolean'))throw new Error(`Ação de registro inválida para ${plugin.id}.${kind}.`);
        if(action.download&&(!/^[a-z][a-zA-Z0-9_]*$/.test(action.download.recordIdField)||!/^[a-z][a-zA-Z0-9_]*$/.test(action.download.revisionField)||!/^[a-z][a-zA-Z0-9_]*$/.test(action.download.fileNameField)||!action.download.path.startsWith('/')||action.download.path.startsWith('//')||/[\r\n]/.test(action.download.path)))throw new Error(`Download inválido para ${plugin.id}.${kind}.${action.id}.`);
      }
      if(definition.immutable!==undefined&&(!Array.isArray(definition.immutable)||definition.immutable.some(state=>typeof state!=='string'||!state.trim())))throw new Error(`Estados imutáveis inválidos para ${plugin.id}.${kind}.`);
      if(definition.uniqueFields!==undefined&&(!Array.isArray(definition.uniqueFields)||new Set(definition.uniqueFields).size!==definition.uniqueFields.length||definition.uniqueFields.some(field=>typeof field!=='string'||!(/^[a-z][a-z0-9_]*$/.test(field))||!Object.hasOwn(definition.schema.properties||{},field))))throw new Error(`Campos únicos inválidos para ${plugin.id}.${kind}.`);
      if(definition.validate!==undefined&&typeof definition.validate!=='function')throw new Error(`Validador semântico inválido para ${plugin.id}.${kind}.`);
      if(definition.resourceScoped!==undefined&&typeof definition.resourceScoped!=='boolean')throw new Error(`Escopo de registro inválido para ${plugin.id}.${kind}.`);
      if(definition.serverCreated!==undefined&&typeof definition.serverCreated!=='boolean')throw new Error(`Origem de criação inválida para ${plugin.id}.${kind}.`);
      if(definition.managePermission!==undefined&&(!definition.resourceScoped||!/^[-a-z0-9_.]+$/.test(definition.managePermission)))throw new Error(`Permissão administrativa inválida para ${plugin.id}.${kind}.`);
      if(definition.availableTransitions!==undefined&&typeof definition.availableTransitions!=='function')throw new Error(`Resolvedor de transições inválido para ${plugin.id}.${kind}.`);
      if(definition.authorizeTransition!==undefined&&typeof definition.authorizeTransition!=='function')throw new Error(`Autorizador de transições inválido para ${plugin.id}.${kind}.`);
      if(definition.prepareTransition!==undefined&&typeof definition.prepareTransition!=='function')throw new Error(`Preparador de transição inválido para ${plugin.id}.${kind}.`);
      if(!Object.hasOwn(definition.transitions,definition.initial))throw new Error(`Estado inicial não declarado para ${plugin.id}.${kind}.`);
      this.ajv.compile(definition.schema);
    }
    for(const projection of plugin.contributions?.recordCards||[]){
      this.id(projection.kind,'Record card kind');if(!plugin.contributions?.recordKinds?.[projection.kind]||!projection.label?.trim())throw new Error('Cartão de registro inválido.');
      if(projection.href&&!/^\/[a-z0-9/-]+$/.test(projection.href))throw new Error('Destino de cartão de registro inválido.');
      if(projection.recordParam&&!/^[a-z][a-z0-9_]*$/.test(projection.recordParam))throw new Error('Parâmetro de cartão de registro inválido.');
      if(projection.board){const board=projection.board;if(board.fixedScope!==true||typeof board.visible!=='boolean'||!board.phases.length)throw new Error('Escopo fixo de quadro inválido.');
       this.unique(board.phases,'Board phase');this.unique(board.templates,'Board template');
       for(const phase of board.phases){this.id(phase.id,'Board phase');if(!phase.label?.trim())throw new Error('Fase de quadro inválida.');}
       for(const template of board.templates){this.id(template.id,'Board template');if(!template.name?.trim()||!template.description?.trim()||!board.phases.some(phase=>phase.id===template.phase)||!Array.isArray(template.checklist)||template.checklist.some(item=>typeof item!=='string'||!item.trim()))throw new Error('Modelo de cartão inválido.');}
      }
      if(projection.titleReference){const reference=projection.titleReference;this.id(reference.plugin,'Title reference plugin');for(const field of [reference.idField,reference.revisionField,reference.titleField])if(!/^[a-z][a-z0-9_]*$/.test(field))throw new Error('Referência de título inválida.');}
    }
    this.unique(plugin.contributions?.boardCreators||[],'Board creator');
    for(const creator of plugin.contributions?.boardCreators||[]){this.id(creator.id,'Board creator');this.id(creator.permission,'Board creator permission');if(!creator.name?.trim()||!/^\/[a-z0-9/-]+$/.test(creator.href))throw new Error('Criação de quadro inválida.');}
    for(const item of plugin.contributions?.navigation||[]){
      this.id(item.id,'Navigation');if(!item.label?.trim()||!/^\/[a-z0-9/-]+$/.test(item.href))throw new Error('Link de navegação inválido.');
      for(const group of [item.group,item.section])if(group){this.id(group.id,'Navigation group');if(!group.label?.trim()||(group.order!==undefined&&!Number.isFinite(group.order)))throw new Error('Grupo de navegação inválido.');}
      if(item.section&&!item.group)throw new Error('Seção de navegação exige um grupo.');
      if(item.order!==undefined&&!Number.isFinite(item.order))throw new Error('Ordem de navegação inválida.');
    }
    for(const board of plugin.contributions?.processBoards||[]){this.id(board.id,'Process board');this.id(board.permission,'Process board permission');if(!board.name?.trim()||!/^\/[a-z0-9/-]+$/.test(board.href))throw new Error('Quadro de processos inválido.');}
    for(const view of plugin.contributions?.boardViews||[]){this.id(view.renderer,'Board renderer');this.id(view.permission,'Board permission');if(!view.name.trim())throw new Error('Nome da visualização obrigatório.');if([...this.items.values()].some(item=>item.contributions?.boardViews?.some(registered=>registered.id===view.id)))throw new Error('Visualização já registrada por outro plugin.');}
    for(const layout of plugin.contributions?.cardLayouts||[]){
      if(!layout.name||!Array.isArray(layout.slots)||layout.slots.some(slot=>typeof slot!=='string'||!slot))throw new Error('Layout de cartão inválido.');
      if(new Set((layout.fields||[]).map(field=>field.key)).size!==(layout.fields||[]).length)throw new Error('Campo de layout duplicado.');
      for(const field of layout.fields||[])if(!/^[a-z][a-z0-9_]*$/.test(field.key)||!field.label||!['text','textarea','select'].includes(field.type)||(field.maxLength!==undefined&&(!Number.isInteger(field.maxLength)||field.maxLength<1||field.maxLength>20000)))throw new Error('Campo de layout inválido.');
    }
    for(const layout of plugin.contributions?.cardLayouts||[])for(const field of layout.fields||[])if(field.type==='select'&&(!field.options?.length||new Set(field.options.map(option=>option.value)).size!==field.options.length||field.options.some(option=>!option.value||!option.label)))throw new Error('Opções de layout inválidas.');
    for(const layout of plugin.contributions?.cardLayouts||[])for(const field of layout.fields||[])if(field.childDefault&&field.type==='select'&&!field.options?.some(option=>option.value===field.childDefault))throw new Error('Valor de filho fora das opções do layout.');
    for(const type of plugin.contributions?.cardTypes||[])if(!type.name||!Array.isArray(type.slots||[])||(type.slots||[]).some(slot=>typeof slot!=='string'||!slot))throw new Error('Tipo de cartão inválido.');

    for(const dependency of plugin.dependencies||[]){this.id(dependency,'Dependency');if(dependency===plugin.id)throw new Error('Plugin não pode depender de si mesmo.');}
    this.items.set(plugin.id,{...plugin,capabilities,actions});
    try{this.dependencyChain(plugin.id,false)}catch(error){this.items.delete(plugin.id);throw error}

  }
  getById(id:string){const plugin=this.items.get(id);if(!plugin)throw new Error(`Plugin não registrado: ${id}`);return plugin}
  private uninstalled=new Set<string>();
  setInstalled(id:string,installed:boolean){this.getById(id);if(installed)this.uninstalled.delete(id);else this.uninstalled.add(id)}
  isInstalled(id:string){return this.items.has(id)&&!this.isHidden(id)}
  private isHidden(id:string){return this.uninstalled.has(id)||new Set((process.env.ORBIT_HIDDEN_PLUGINS||'').split(',').map(value=>value.trim()).filter(Boolean)).has(id)}
  routePlugin(path:string){return [...this.items.values()].find(plugin=>plugin.handlesRoute?.(path))?.id}
  dependencyChain(id:string,requireRegistered=true,trail:string[]=[]):string[]{
    if(trail.includes(id))throw new Error(`Dependência circular: ${[...trail,id].join(' → ')}`);
    const plugin=this.items.get(id);if(!plugin){if(requireRegistered)throw new Error(`Dependência não instalada: ${id}`);return []}
    return [...new Set([...(plugin.dependencies||[]).flatMap(dependency=>this.dependencyChain(dependency,requireRegistered,[...trail,id])),id])];
  }
  blockedBy(id:string){
    this.getById(id);const blocked=new Set<string>();const visited=new Set<string>();
    const visit=(key:string)=>{if(visited.has(key))return;visited.add(key);const plugin=this.items.get(key);if(!plugin){blocked.add(key);return}if(key!==id&&(this.disabled.has(key)||this.isHidden(key)))blocked.add(key);for(const dependency of plugin.dependencies||[])visit(dependency)};
    visit(id);return [...blocked];
  }
  dependents(id:string){this.getById(id);return this.list().filter(plugin=>plugin.id!==id&&this.dependencyChain(plugin.id,false).includes(id)).map(plugin=>plugin.id)}
  isEnabled(id:string){if(this.isHidden(id))return false;try{return this.dependencyChain(id).every(plugin=>!this.disabled.has(plugin)&&!this.isHidden(plugin))}catch{return false}}
  selection(ids:string[]){
    const layouts=ids.filter(id=>Boolean(this.getById(id).contributions?.cardLayouts?.length));
    const resolved=[...new Set(layouts.flatMap(id=>{if(!this.isEnabled(id))throw new Error(`Plugin ou dependência desativada: ${id}`);return this.dependencyChain(id)}))];
    if(ids.some(id=>!resolved.includes(id)))throw new Error('Plugin sem layout de cartão.');return resolved;
  }

  setEnabled(id:string,enabled:boolean){this.getById(id);if(enabled)this.disabled.delete(id);else this.disabled.add(id)}
  list(){return [...this.items.values()].filter(plugin=>!this.isHidden(plugin.id))}
  getAction(pluginId:string,actionId:string):ActionDefinition{if(!this.isEnabled(pluginId))throw new Error(`O plugin ${pluginId} está desativado.`);const action=(this.getById(pluginId).actions||[]).find(item=>item.id===actionId);if(!action)throw new Error(`Action não registrada: ${pluginId}.${actionId}`);return action}
  getCapability(pluginId:string,capabilityId:string):CapabilityDefinition{if(!this.isEnabled(pluginId))throw new Error(`O plugin ${pluginId} está desativado.`);const capability=(this.getById(pluginId).capabilities||[]).find(item=>item.id===capabilityId);if(!capability)throw new Error(`Capability não registrada: ${pluginId}.${capabilityId}`);return capability}
  connectionProviders(){return this.list().filter(plugin=>this.isEnabled(plugin.id)).flatMap(plugin=>plugin.connectionProvider?[{pluginId:plugin.id,...plugin.connectionProvider}]:[])}
  validate(integration:Integration,permissions:string[]):PluginAction{
    noSecrets(integration.config);
    if(!this.isEnabled(integration.plugin))throw new Error(`O plugin ${integration.plugin} está desativado.`);
    const plugin=this.items.get(integration.plugin),action=plugin?.actions?.find(a=>a.id===integration.action);
    if(!plugin||!action||!action.execute)throw new Error(`Capacidade não registrada: ${integration.plugin}.${integration.action}`);
    for(const permission of action.permissions||[])if(!permissions.includes(permission))throw new Error(`Permissão necessária: ${permission}`);
    for(const capabilityId of action.requiredCapabilities||[]){
      const capability=this.getCapability(integration.plugin,capabilityId);
      for(const permission of capability.permissions||[])if(!permissions.includes(permission))throw new Error(`Permissão necessária: ${permission}`);
    }
    if(!this.ajv.validate(action.inputSchema,integration.config||{}))throw new Error(`Configuração inválida de ${plugin!.name}: ${this.ajv.errorsText()}`);
    return action as PluginAction;
  }
  async execute(integration:Integration,input:ExecutionInput,services?:PluginActionContext['services']):Promise<Output>{
    const action=this.validate(integration,input.permissions);await this.authorizeAction?.(integration.plugin,integration.action,input.userId);const output=await action.execute(integration.config||{},{userId:input.userId,projectId:input.projectId,cardId:input.cardId,runId:input.runId,connectionId:integration.connection_id,execution:input,services,logger:{info(){},warn(){}}});
    if(action.outputSchema&&!this.ajv.validate(action.outputSchema,output))throw new Error('Saída do plugin inválida.');return output;
  }
  catalog(){return this.list().map(p=>({id:p.id,name:p.name,version:p.version,description:p.description,blockedBy:this.blockedBy(p.id),dependents:this.dependents(p.id),status:this.disabled.has(p.id)?"disabled":this.isEnabled(p.id)?"active":"blocked",dependencies:p.dependencies||[],configuredEnabled:!this.disabled.has(p.id),enabled:this.isEnabled(p.id),configurable:Boolean(p.configurable||p.configuration?.length),capabilities:p.capabilities,actions:(p.actions||[]).map(({id,name,permissions,requiredCapabilities,inputSchema,outputSchema})=>({id,name,permissions,requiredCapabilities,inputSchema,outputSchema})),connectionProvider:p.connectionProvider,contributions:p.contributions||{}}))}
}
export function filesystemPlugin():PluginDefinition{return {id:'filesystem',name:'Arquivos do projeto',version:'1.0.0',capabilities:[{id:'filesystem.read',name:'Ler arquivos',permissions:['filesystem.read']}],actions:[{id:'read',name:'Ler arquivo',permissions:['filesystem.read'],requiredCapabilities:['filesystem.read'],inputSchema:{type:'object',properties:{path:{type:'string',minLength:1,maxLength:1000}},required:['path'],additionalProperties:false},async execute(config,context){const input=context.execution;if(!input)throw new Error('Contexto de execução ausente.');return {type:'text',label:String(config.path),value:await readResource(input.projectRoot,String(config.path))}}}]}}
