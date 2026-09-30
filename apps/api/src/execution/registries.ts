import Ajv from 'ajv';
import {Executor,ExecutionInput,Integration,Output,Plugin,PluginAction} from './types';
import {ActionDefinition,CapabilityDefinition,PluginActionContext,PluginDefinition,TriggerDefinition} from '../plugins/contract';
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
  private ajv=new Ajv({allErrors:true});
  private id(value:string,label:string){if(!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value))throw new Error(`${label} inválido: ${value}`)}
  private unique<T extends {id:string}>(items:T[],label:string){const ids=new Set<string>();for(const item of items){this.id(item.id,label);if(ids.has(item.id))throw new Error(`${label} duplicado: ${item.id}`);ids.add(item.id)}}
  register(plugin:Plugin){
    this.id(plugin.id,'Plugin');if(this.items.has(plugin.id))throw new Error('Plugin duplicado.');
    if(!plugin.version||!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(plugin.version))throw new Error(`Versão inválida para ${plugin.id}.`);
    const capabilities=plugin.capabilities||[],actions=plugin.actions||[],triggers=plugin.triggers||[],notifications=plugin.contributions?.notifications||[];
    this.unique(capabilities,'Capability');this.unique(actions,'Action');this.unique(triggers,'Trigger');
    this.unique(notifications,'Plugin notification');
    const known=new Set(capabilities.map(item=>item.id));
    for(const action of actions){for(const capability of action.requiredCapabilities||[])if(!known.has(capability))throw new Error(`Capability não registrada: ${capability}`);this.ajv.compile(action.inputSchema);if(action.outputSchema)this.ajv.compile(action.outputSchema)}
    for(const trigger of triggers)this.ajv.compile(trigger.eventSchema);
    if(plugin.connectionProvider){this.id(plugin.connectionProvider.id,'Connection provider');for(const capability of plugin.connectionProvider.capabilities)if(!known.has(capability))throw new Error(`Capability não registrada: ${capability}`)}
    this.items.set(plugin.id,{...plugin,capabilities,actions,triggers});
  }
  getById(id:string){const plugin=this.items.get(id);if(!plugin)throw new Error(`Plugin não registrado: ${id}`);return plugin}
  isEnabled(id:string){this.getById(id);return !this.disabled.has(id)}
  setEnabled(id:string,enabled:boolean){this.getById(id);if(enabled)this.disabled.delete(id);else this.disabled.add(id)}
  list(){return [...this.items.values()]}
  getAction(pluginId:string,actionId:string):ActionDefinition{if(!this.isEnabled(pluginId))throw new Error(`O plugin ${pluginId} está desativado.`);const action=(this.getById(pluginId).actions||[]).find(item=>item.id===actionId);if(!action)throw new Error(`Action não registrada: ${pluginId}.${actionId}`);return action}
  getTrigger(pluginId:string,triggerId:string):TriggerDefinition{if(!this.isEnabled(pluginId))throw new Error(`O plugin ${pluginId} está desativado.`);const trigger=(this.getById(pluginId).triggers||[]).find(item=>item.id===triggerId);if(!trigger)throw new Error(`Trigger não registrado: ${pluginId}.${triggerId}`);return trigger}
  getCapability(pluginId:string,capabilityId:string):CapabilityDefinition{if(!this.isEnabled(pluginId))throw new Error(`O plugin ${pluginId} está desativado.`);const capability=(this.getById(pluginId).capabilities||[]).find(item=>item.id===capabilityId);if(!capability)throw new Error(`Capability não registrada: ${pluginId}.${capabilityId}`);return capability}
  connectionProviders(){return this.list().filter(plugin=>this.isEnabled(plugin.id)).flatMap(plugin=>plugin.connectionProvider?[{pluginId:plugin.id,...plugin.connectionProvider}]:[])}
  automationTriggers(){return this.list().filter(plugin=>this.isEnabled(plugin.id)).flatMap(plugin=>(plugin.triggers||[]).map(trigger=>({pluginId:plugin.id,id:typeof trigger.metadata?.event==='string'?trigger.metadata.event:`${plugin.id}.${trigger.id}`,name:trigger.name,schema:trigger.eventSchema})))}
  automationActions(){return this.list().filter(plugin=>this.isEnabled(plugin.id)).flatMap(plugin=>(plugin.contributions?.automationActions||[]).map(action=>({pluginId:plugin.id,...action})))}
  automationTemplates(){return this.list().filter(plugin=>this.isEnabled(plugin.id)).flatMap(plugin=>(plugin.contributions?.automationTemplates||[]).map(template=>({pluginId:plugin.id,pluginName:plugin.name,...template})))}
  automationAction(id:string):({pluginId:string;id:string;scope?:string}&Record<string,unknown>)|undefined{
    const plugin=this.list().find(item=>(item.contributions?.automationActions||[]).some(action=>action.id===id));
    if(!plugin)return undefined;
    if(!this.isEnabled(plugin.id))throw new Error(`O plugin ${plugin.name} está desativado.`);
    const action=plugin.contributions!.automationActions!.find(item=>item.id===id)!;
    return {pluginId:plugin.id,...action,id:String(action.id),scope:typeof action.scope==='string'?action.scope:undefined};
  }
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
    const action=this.validate(integration,input.permissions),output=await action.execute(integration.config||{},{userId:input.userId,projectId:input.projectId,cardId:input.cardId,runId:input.runId,connectionId:integration.connection_id,execution:input,services,logger:{info(){},warn(){}}});
    if(action.outputSchema&&!this.ajv.validate(action.outputSchema,output))throw new Error('Saída do plugin inválida.');return output;
  }
  catalog(){return [...this.items.values()].map(p=>({id:p.id,name:p.name,version:p.version,enabled:this.isEnabled(p.id),capabilities:p.capabilities,actions:(p.actions||[]).map(({id,name,permissions,requiredCapabilities,inputSchema,outputSchema})=>({id,name,permissions,requiredCapabilities,inputSchema,outputSchema})),triggers:p.triggers,connectionProvider:p.connectionProvider,contributions:p.contributions||{}}))}
}
export function filesystemPlugin():PluginDefinition{return {id:'filesystem',name:'Arquivos do projeto',version:'1.0.0',capabilities:[{id:'filesystem.read',name:'Ler arquivos',permissions:['filesystem.read']}],actions:[{id:'read',name:'Ler arquivo',permissions:['filesystem.read'],requiredCapabilities:['filesystem.read'],inputSchema:{type:'object',properties:{path:{type:'string',minLength:1,maxLength:1000}},required:['path'],additionalProperties:false},async execute(config,context){const input=context.execution;if(!input)throw new Error('Contexto de execução ausente.');return {type:'text',label:String(config.path),value:await readResource(input.projectRoot,String(config.path))}}}]}}
