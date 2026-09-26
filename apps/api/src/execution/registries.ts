import Ajv from 'ajv';
import {Executor,ExecutionInput,Integration,Output,Plugin,PluginAction} from './types';
import {readResource,noSecrets} from './security';

export class ExecutorRegistry {
  private items=new Map<string,Executor>();
  register(executor:Executor){if(this.items.has(executor.id))throw new Error('Executor duplicado.');this.items.set(executor.id,executor)}
  get(id:string){const executor=this.items.get(id);if(!executor)throw new Error(`Executor não registrado: ${id}`);return executor}
  catalog(){return [...this.items.values()].map(({id,name,actions})=>({id,name,actions}))}
}
export class PluginRegistry {
  private items=new Map<string,Plugin>();
  private ajv=new Ajv({allErrors:true});
  register(plugin:Plugin){if(this.items.has(plugin.id))throw new Error('Plugin duplicado.');for(const a of plugin.actions)this.ajv.compile(a.inputSchema);this.items.set(plugin.id,plugin)}
  validate(integration:Integration,permissions:string[]):PluginAction{
    noSecrets(integration.config);
    const plugin=this.items.get(integration.plugin),action=plugin?.actions.find(a=>a.id===integration.action);
    if(!action)throw new Error(`Capacidade não registrada: ${integration.plugin}.${integration.action}`);
    for(const permission of action.permissions)if(!permissions.includes(permission))throw new Error(`Permissão necessária: ${permission}`);
    if(!this.ajv.validate(action.inputSchema,integration.config||{}))throw new Error(`Configuração inválida de ${plugin!.name}: ${this.ajv.errorsText()}`);
    return action;
  }
  async execute(integration:Integration,input:ExecutionInput):Promise<Output>{
    const action=this.validate(integration,input.permissions),output=await action.execute(integration.config||{},input);
    if(action.outputSchema&&!this.ajv.validate(action.outputSchema,output))throw new Error('Saída do plugin inválida.');return output;
  }
  catalog(){return [...this.items.values()].map(p=>({id:p.id,name:p.name,actions:p.actions.map(({id,name,permissions,inputSchema,outputSchema})=>({id,name,permissions,inputSchema,outputSchema}))}))}
}
export function filesystemPlugin():Plugin{return {id:'filesystem',name:'Arquivos do projeto',actions:[{id:'read',name:'Ler arquivo',permissions:['filesystem.read'],inputSchema:{type:'object',properties:{path:{type:'string',minLength:1,maxLength:1000}},required:['path'],additionalProperties:false},async execute(config,input){return {type:'text',label:String(config.path),value:await readResource(input.projectRoot,String(config.path))}}}]}}
