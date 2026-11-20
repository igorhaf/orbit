import {canonicalContextJson,type ContextManifest} from './context-manifest';
import {defaultContextCompilerPolicy,contextCompilerMaterialBudget,type ContextCompilerBudget,type ContextCompilerPolicy} from './context-compiler';

/** Configuration belongs to the host; project files and prompts cannot opt in. */
const knobs:Record<string,keyof ContextCompilerBudget>={
  ORBIT_CONTEXT_COMPILER_MAX_ESTIMATED_TOKENS:'maxEstimatedTokens',
  ORBIT_CONTEXT_COMPILER_RESERVED_RESPONSE_TOKENS:'reservedResponseTokens',
  ORBIT_CONTEXT_COMPILER_RESERVED_OPERATION_TOKENS:'reservedOperationTokens',
  ORBIT_CONTEXT_COMPILER_RESERVED_EXTERNAL_TOKENS:'reservedExternalTokens',
  ORBIT_CONTEXT_COMPILER_SAFETY_MARGIN_RATIO:'safetyMarginRatio',
  ORBIT_CONTEXT_COMPILER_DOCUMENT_MAX_ESTIMATED_TOKENS:'documentMaxEstimatedTokens',
  ORBIT_CONTEXT_COMPILER_HISTORY_MAX_ESTIMATED_TOKENS:'historyMaxEstimatedTokens',
  ORBIT_CONTEXT_COMPILER_PER_RESOURCE_MAX_ESTIMATED_TOKENS:'perResourceMaxEstimatedTokens',
  ORBIT_CONTEXT_COMPILER_PROVIDER_CONTEXT_WINDOW:'providerContextWindow',
};
export function contextCompilerPolicyFromHost(env:NodeJS.ProcessEnv=process.env):ContextCompilerPolicy|null{
  if(env.ORBIT_CONTEXT_COMPILER_ENABLED===undefined||env.ORBIT_CONTEXT_COMPILER_ENABLED==='0')return null;
  if(env.ORBIT_CONTEXT_COMPILER_ENABLED!=='1')throw new Error('Ativação do compilador de contexto inválida no host.');
  const overrides:Partial<ContextCompilerBudget>={};
  for(const [name,key] of Object.entries(knobs)){
    const raw=env[name];if(raw===undefined)continue;
    if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw))throw new Error(`Orçamento de contexto inválido: ${name}.`);
    const value=Number(raw);
    if(!Number.isFinite(value)||(key==='safetyMarginRatio'?(value<0||value>=1):(!Number.isSafeInteger(value)||value<0||value>10_000_000)))throw new Error(`Orçamento de contexto inválido: ${name}.`);
    overrides[key]=value;
  }
  const policy=defaultContextCompilerPolicy(overrides);contextCompilerMaterialBudget(policy);return policy;
}
/** Legacy runs remain legacy when the host is enabled later. Compiled runs fail
 * closed if the host disables or changes the captured compilation policy. */
export function compilerPolicyForManifest(manifest:ContextManifest|null,env:NodeJS.ProcessEnv=process.env):ContextCompilerPolicy|null{
  const captured=manifest?.configuration.contextCompilation;
  if(captured===undefined){
    if(manifest?.assemblyPolicy==='orbit-context-compiler/1')throw new Error('Política de compilação capturada indisponível.');
    return null;
  }
  if(!captured||typeof captured!=='object'||Array.isArray(captured)||!captured.policy||typeof captured.policy!=='object'||Array.isArray(captured.policy)||manifest?.assemblyPolicy!=='orbit-context-compiler/1')throw new Error('Contrato de compilação capturado inválido.');
  const current=contextCompilerPolicyFromHost(env);
  if(!current||canonicalContextJson(current)!==canonicalContextJson(captured.policy))throw new Error('A política de compilação do host mudou; reconciliação necessária antes de executar.');
  return current;
}
