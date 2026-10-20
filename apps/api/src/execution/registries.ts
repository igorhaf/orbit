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
  dependencyChain(id:string,requireRegistered=true,trail:string[]=[]):string[]{
    if(trail.includes(id))throw new Error(`Dependência circular: ${[...trail,id].join(' → ')}`);
    const plugin=this.items.get(id);if(!plugin){if(requireRegistered)throw new Error(`Dependência não instalada: ${id}`);return []}
    return [...new Set([...(plugin.dependencies||[]).flatMap(dependency=>this.dependencyChain(dependency,requireRegistered,[...trail,id])),id])];
  }
  blockedBy(id:string){
    this.getById(id);const blocked=new Set<string>();const visited=new Set<string>();
    const visit=(key:string)=>{if(visited.has(key))return;visited.add(key);const plugin=this.items.get(key);if(!plugin){blocked.add(key);return}if(key!==id&&this.disabled.has(key))blocked.add(key);for(const dependency of plugin.dependencies||[])visit(dependency)};
    visit(id);return [...blocked];
  }
  dependents(id:string){this.getById(id);return this.list().filter(plugin=>plugin.id!==id&&this.dependencyChain(plugin.id,false).includes(id)).map(plugin=>plugin.id)}
  isEnabled(id:string){try{return this.dependencyChain(id).every(plugin=>!this.disabled.has(plugin))}catch{return false}}
  selection(ids:string[]){
    const layouts=ids.filter(id=>Boolean(this.getById(id).contributions?.cardLayouts?.length));
    const resolved=[...new Set(layouts.flatMap(id=>{if(!this.isEnabled(id))throw new Error(`Plugin ou dependência desativada: ${id}`);return this.dependencyChain(id)}))];
    if(ids.some(id=>!resolved.includes(id)))throw new Error('Plugin sem layout de cartão.');return resolved;
  }

  setEnabled(id:string,enabled:boolean){this.getById(id);if(enabled)this.disabled.delete(id);else this.disabled.add(id)}
  list(){return [...this.items.values()]}
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
  catalog(){return [...this.items.values()].map(p=>({id:p.id,name:p.name,version:p.version,description:p.description,blockedBy:this.blockedBy(p.id),dependents:this.dependents(p.id),status:this.disabled.has(p.id)?"disabled":this.isEnabled(p.id)?"active":"blocked",dependencies:p.dependencies||[],configuredEnabled:!this.disabled.has(p.id),enabled:this.isEnabled(p.id),configurable:Boolean(p.configurable||p.configuration?.length),capabilities:p.capabilities,actions:(p.actions||[]).map(({id,name,permissions,requiredCapabilities,inputSchema,outputSchema})=>({id,name,permissions,requiredCapabilities,inputSchema,outputSchema})),connectionProvider:p.connectionProvider,contributions:p.contributions||{}}))}
}
export function filesystemPlugin():PluginDefinition{return {id:'filesystem',name:'Arquivos do projeto',version:'1.0.0',capabilities:[{id:'filesystem.read',name:'Ler arquivos',permissions:['filesystem.read']}],actions:[{id:'read',name:'Ler arquivo',permissions:['filesystem.read'],requiredCapabilities:['filesystem.read'],inputSchema:{type:'object',properties:{path:{type:'string',minLength:1,maxLength:1000}},required:['path'],additionalProperties:false},async execute(config,context){const input=context.execution;if(!input)throw new Error('Contexto de execução ausente.');return {type:'text',label:String(config.path),value:await readResource(input.projectRoot,String(config.path))}}}]}}
