import {ExecutionConfig,ExecutionDefaults,emptyConfig,emptyDefaults,permissions} from './types';
import {isId} from '../automation-rules';
import {identifier,noSecrets} from './security';
import {stringList} from './project-registry';
export function validateConfig(input:unknown):ExecutionConfig{
  if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>30000)throw new Error('Configuração inválida.');noSecrets(input);
  const value={...emptyConfig(),...input} as ExecutionConfig;
  if(typeof value.enabled!=='boolean'||!['manual','automatic'].includes(value.mode))throw new Error('Modo de execução inválido.');
  if(value.project_id!==null&&!isId(value.project_id))throw new Error('Projeto inválido.');
  for(const key of ['agent','executor','action'] as const)if(value[key]!==null&&!identifier(value[key]))throw new Error(`${key} inválido.`);
  value.skills=stringList(value.skills,'skills');if(value.skills.some(x=>!identifier(x)))throw new Error('Skill inválida.');
  value.permissions=stringList(value.permissions,'permissions');if(value.permissions.some(x=>!permissions.includes(x as typeof permissions[number])))throw new Error('Permissão não suportada.');
  if(typeof value.working_directory!=='string'||value.working_directory.length>1000)throw new Error('Diretório inválido.');
  if(!value.context||typeof value.context!=='object'||Array.isArray(value.context))throw new Error('Contexto inválido.');
  for(const key of ['knowledge','rules','cards','files'] as const)value.context[key]=stringList(value.context[key],key);
  if([...value.context.knowledge!,...value.context.rules!].some(x=>!identifier(x))||value.context.cards!.some(x=>!isId(x)))throw new Error('Referência de contexto inválida.');
  if(value.context.instructions!==undefined&&(typeof value.context.instructions!=='string'||value.context.instructions.length>10000))throw new Error('Instruções inválidas.');
  if(value.context.include_agents_md!==undefined&&typeof value.context.include_agents_md!=='boolean')throw new Error('Opção AGENTS.md inválida.');
  if(!Array.isArray(value.integrations)||value.integrations.length>10||value.integrations.some(x=>!x||!identifier(x.plugin)||!identifier(x.action)||x.config!==undefined&&(!x.config||typeof x.config!=='object'||Array.isArray(x.config))))throw new Error('Integrações inválidas.');
  if(!value.automation||typeof value.automation!=='object'||Array.isArray(value.automation))throw new Error('Automação inválida.');
  for(const key of Object.keys(value.automation))if(!['on_success_list_id','on_failure_list_id'].includes(key)||!isId(value.automation[key as keyof typeof value.automation]))throw new Error('Destino da automação inválido.');
  // Persist only supported fields; arbitrary client fields never become execution options.
  return Object.fromEntries(Object.keys(emptyConfig()).map(key=>[key,value[key as keyof ExecutionConfig]])) as ExecutionConfig;
}

export function projectDefaults(input:unknown):ExecutionDefaults {
  if(input===undefined)return emptyDefaults();
  const config=validateConfig({...emptyConfig(),...(input as Record<string,unknown>),automation:{}});
  delete (config as Partial<ExecutionConfig>).project_id;delete (config as Partial<ExecutionConfig>).enabled;
  return config as ExecutionDefaults;
}

export function mergeConfig(projectId:string|null,enabled:boolean,defaults:ExecutionDefaults,overrides:Partial<ExecutionDefaults>):ExecutionConfig {
  return {project_id:projectId,enabled,...defaults,...overrides,context:{...defaults.context,...overrides.context},automation:{...defaults.automation,...overrides.automation},integrations:overrides.integrations??defaults.integrations,skills:overrides.skills??defaults.skills,permissions:overrides.permissions??defaults.permissions};
}

const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
export function configOverrides(config:ExecutionConfig,defaults:ExecutionDefaults):Partial<ExecutionDefaults> {
  const values={...config} as Partial<ExecutionConfig>;delete values.project_id;delete values.enabled;
  return Object.fromEntries(Object.entries(values).filter(([key,value])=>!same(value,defaults[key as keyof ExecutionDefaults]))) as Partial<ExecutionDefaults>;
}

export function globalDefaults(config:ExecutionConfig):ExecutionDefaults {
  const defaults=configOverrides(config,emptyDefaults());
  delete defaults.automation;
  return {...emptyDefaults(),...defaults,context:{...emptyDefaults().context,...defaults.context}};
}
