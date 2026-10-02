export type RunStatus='idle'|'queued'|'running'|'success'|'failed'|'cancelled';
export type ResourceKind='agents'|'skills'|'rules'|'knowledge'|'plugins';
export type Resource={id:string;name:string;kind:ResourceKind;file?:string};
export type DocumentResource=Resource&{body:string;metadata:Record<string,unknown>;hash:string};
export type CardContext={knowledge?:string[];rules?:string[];files?:string[];cards?:string[];instructions?:string;include_agents_md?:boolean};
export type Integration={plugin:string;action:string;connection_id?:string;config?:Record<string,unknown>};
export type ExecutionConfig={project_id:string|null;enabled:boolean;agent:string|null;executor:string|null;action:string|null;skills:string[];working_directory:string;mode:'manual';permissions:string[];context:CardContext;integrations:Integration[]};
export type ExecutionDefaults=Omit<ExecutionConfig,'project_id'|'enabled'>;
export type Output={type:string;label?:string;value:unknown};
export type ExecutionResult={summary:string;outputs:Output[]};
export type ExecutionInput={runId:string;cardId:string;userId:string;projectId:string;title:string;prompt:string;workingDirectory:string;projectRoot:string;permissions:string[];action:string;integrations:Integration[];signal:AbortSignal};
export type Capability={id:string;name:string;permissions:string[]};
export interface Executor {id:string;name:string;actions:Capability[];execute(input:ExecutionInput):Promise<ExecutionResult>}
export type PluginAction=import('../plugins/contract').ActionDefinition&{execute:(config:Record<string,unknown>,context:import('../plugins/contract').PluginActionContext)=>Promise<Output>};
export type Plugin=import('../plugins/contract').PluginDefinition;
export const permissions=['filesystem.read','filesystem.write','process.execute','mail.read','mail.draft','mail.send','repository.read','repository.write','issues.read','issues.write','pull_requests.read','pull_requests.write','branches.read','branches.write'] as const;
export const emptyConfig=():ExecutionConfig=>({project_id:null,enabled:false,agent:null,executor:null,action:null,skills:[],working_directory:'.',mode:'manual',permissions:[],context:{},integrations:[]});

export const emptyDefaults=():ExecutionDefaults=>{const config=emptyConfig();delete (config as Partial<ExecutionConfig>).project_id;delete (config as Partial<ExecutionConfig>).enabled;return config as ExecutionDefaults};
