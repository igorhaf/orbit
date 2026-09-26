export type RunStatus='idle'|'queued'|'running'|'success'|'failed'|'cancelled';
export type ResourceKind='agents'|'skills'|'rules'|'knowledge'|'plugins'|'automations';
export type Resource={id:string;name:string;kind:ResourceKind};
export type DocumentResource=Resource&{body:string;metadata:Record<string,unknown>;hash:string};
export type CardContext={knowledge?:string[];rules?:string[];files?:string[];cards?:string[];instructions?:string;include_agents_md?:boolean};
export type Integration={plugin:string;action:string;config?:Record<string,unknown>};
export type ExecutionConfig={project_id:string|null;enabled:boolean;agent:string|null;executor:string|null;action:string|null;skills:string[];working_directory:string;mode:'manual'|'automatic';permissions:string[];context:CardContext;integrations:Integration[];automation:{on_success_list_id?:string;on_failure_list_id?:string}};
export type Output={type:string;label?:string;value:unknown};
export type ExecutionResult={summary:string;outputs:Output[]};
export type ExecutionInput={runId:string;cardId:string;title:string;prompt:string;workingDirectory:string;projectRoot:string;permissions:string[];action:string;signal:AbortSignal};
export type Capability={id:string;name:string;permissions:string[]};
export interface Executor {id:string;name:string;actions:Capability[];execute(input:ExecutionInput):Promise<ExecutionResult>}
export type PluginAction=Capability&{inputSchema:Record<string,unknown>;outputSchema?:Record<string,unknown>;execute:(config:Record<string,unknown>,input:ExecutionInput)=>Promise<Output>};
export interface Plugin {id:string;name:string;actions:PluginAction[]}
export const permissions=['filesystem.read','filesystem.write','process.execute','execution.automatic'] as const;
export const emptyConfig=():ExecutionConfig=>({project_id:null,enabled:false,agent:null,executor:null,action:null,skills:[],working_directory:'.',mode:'manual',permissions:[],context:{},integrations:[],automation:{}});
