import Ajv from 'ajv';

export type RunMode='normal'|'bypass';
export type StepStatus='pending'|'running'|'waiting'|'success'|'failed'|'skipped'|'bypassed'|'rejected'|'cancelled';
export type Step={id:string;pipeline_id:string;type:string;name:string;config:Record<string,unknown>;position:number;timeout_ms:number;failure_policy:'stop'|'continue'|'retry';max_attempts:number;retry_delay_ms:number;bypass_policy:'deny'|'allow'|'allow_with_permission';requires:string[]};
export type RunContext={values:Record<string,unknown>;steps:Record<string,Record<string,unknown>>};
export type StepResult={status?:'success'|'waiting';exitCode?:number;stdout?:string;stderr?:string;outputs?:Record<string,unknown>};
export type StepServices={userId:string;projectId:string;cardId?:string|null;runId:string;context:RunContext;timeoutMs:number};
export type StepHandler={type:string;category:string;schema:Record<string,unknown>;run:(config:Record<string,unknown>,services:StepServices)=>Promise<StepResult>;validate?:(config:Record<string,unknown>,services:StepServices)=>Promise<void>};

export class StepHandlerRegistry {
  private handlers=new Map<string,StepHandler>();
  private ajv=new Ajv({allErrors:true});
  register(handler:StepHandler){if(this.handlers.has(handler.type))throw new Error(`Handler duplicado: ${handler.type}`);this.ajv.compile(handler.schema);this.handlers.set(handler.type,handler)}
  get(type:string){const handler=this.handlers.get(type);if(!handler)throw new Error(`Handler não registrado: ${type}`);return handler}
  validate(step:Step){const handler=this.get(step.type);if(!this.ajv.validate(handler.schema,step.config))throw new Error(`Configuração inválida em ${step.name}: ${this.ajv.errorsText()}`);return handler}
  catalog(){return [...this.handlers.values()].map(({type,category,schema})=>({type,category,schema}))}
}

export type BypassOptions={allWorkflowPolicies?:boolean;approvals?:boolean;tests?:boolean;promotions?:boolean;deployments?:boolean;gates?:boolean;steps?:string[]};
const categoryOption:Record<string,keyof BypassOptions>={approval:'approvals',test:'tests',promotion:'promotions',deployment:'deployments',gate:'gates'};
export class PipelineExecutionPolicyService {
  decide(step:Step,category:string,mode:RunMode,options:BypassOptions,canBypass:boolean){
    if(mode==='normal')return 'execute' as const;
    const all=options.allWorkflowPolicies===true;
    const selected=all||options.steps?.includes(step.id)===true||Boolean(categoryOption[category]&&options[categoryOption[category]]===true);
    if(!selected)return 'execute' as const;
    if(all&&step.bypass_policy==='deny')return 'execute' as const;
    if(step.bypass_policy==='deny')throw new Error(`Bypass negado para ${step.name}.`);
    if(step.bypass_policy==='allow_with_permission'&&!canBypass)throw new Error(`Permissão pipeline.bypass necessária para ${step.name}.`);
    return 'bypass' as const;
  }
  validate(mode:RunMode,reason:unknown,options:BypassOptions,canBypass:boolean){
    if(mode==='normal'){if(Object.values(options).some(Boolean))throw new Error('Opções de bypass exigem modo bypass.');return}
    if(!canBypass)throw new Error('Permissão pipeline.bypass necessária.');
    if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw new Error('Informe o motivo do bypass.');
    if(!Object.values(options).some(value=>Array.isArray(value)?value.length>0:value===true))throw new Error('Selecione uma política para bypass.');
  }
}

export function resolveReference(context:RunContext,key:string):unknown{
  const parts=key.split('.');
  if(parts[0]==='context'&&parts.length===2)return context.values[parts[1]];
  if(parts[0]==='steps'&&parts.length===3)return context.steps[parts[1]]?.[parts[2]];
  throw new Error(`Referência inválida: ${key}`);
}
export function requiredOutputs(steps:Step[],context:RunContext,bypassed:Set<string>){
  for(const step of steps){
    if(bypassed.has(step.id))continue;
    for(const requirement of step.requires){
      if(requirement.startsWith('steps.')&&bypassed.has(requirement.split('.')[1])&&resolveReference(context,requirement)===undefined)throw new Error(`Bypass remove output obrigatório: ${requirement}`);
      if(requirement.startsWith('context.')&&resolveReference(context,requirement)===undefined)throw new Error(`Contexto obrigatório ausente: ${requirement}`);
    }
  }
}
