import {stat,realpath,lstat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {ContextCompatibility,ContextManifest,ContextManifestIdentity,ContextManifestRepository,ContextObject,ContextScope,ContextSource,CurrentContextObservation,StoredContextManifest,compareContextManifest,createContextManifest,hashContextText,hashContextValue,assertContextManifestIntegrity} from './context-manifest';
import {IsolatedCheckoutRequest} from './isolated-checkout';
import {runManagedProcess} from './managed-process';
import {PluginRegistry} from './registries';
import {coreVersion,inheritedCoreCompatibility} from '../plugins/core-compatibility';
import {orbitContextRuntime} from '../orbit-architecture';

/** Only host-observed values enter these records. No source body is persisted here. */
export const contextJson=(value:unknown):ContextObject=>JSON.parse(JSON.stringify(value)) as ContextObject;
export function observedContextSource(scope:ContextScope,id:string,type:string,value:unknown,options:Partial<ContextSource>={}):ContextSource{
  return {schemaVersion:1,id,type,origin:'host_observation',resourceId:id,ownerId:scope.actorId,scope:{runtimeId:scope.runtimeId,projectId:scope.projectId,workspaceId:scope.workspaceId,actorId:scope.actorId},version:'1',contentHash:hashContextValue(value),availability:'available',required:true,selectionReason:'material_delivered_to_executor',dependencies:[],trust:'observation',observedAt:new Date().toISOString(),...options};
}
export function executionContextIdentity(queue:'card_runs'|'card_ai_runs',runId:string,card:{id:string;card_revision?:number|null;workspace_id?:string|null},projectId:string,user:string,executor:string,executionType:string):ContextManifestIdentity{
  return {queue,runId,cardId:card.id,cardRevision:card.card_revision??null,workspaceId:card.workspace_id??null,projectId,actorId:user,runtimeId:orbitContextRuntime,executor,executionType};
}
export function relevantPluginSources(scope:ContextScope,registry:PluginRegistry,ids:string[]):ContextSource[]{
  return [...new Set(ids.flatMap(id=>{try{return registry.dependencyChain(id)}catch{return [id]}}))].sort().map(id=>{
    try{
      const plugin=registry.getById(id),enabled=registry.isEnabled(id);
      return observedContextSource(scope,`plugin:${id}`,'plugin_contract',{id,version:plugin.version,coreContract:coreVersion,coreCompatibility:plugin.coreCompatibility??inheritedCoreCompatibility,parentPlugin:plugin.parentPlugin??null,dependencies:plugin.dependencies??[],capabilities:plugin.capabilities??[],actions:(plugin.actions??[]).map(action=>({id:action.id,permissions:action.permissions??[],requiredCapabilities:action.requiredCapabilities??[],inputSchema:action.inputSchema,outputSchema:action.outputSchema??null}))},{origin:'plugin_registry',version:plugin.version,availability:enabled?'available':'unavailable',dependencies:(plugin.dependencies??[]).map(value=>'plugin:'+value),selectionReason:'execution_plugin_dependency'});
    }catch{return observedContextSource(scope,`plugin:${id}`,'plugin_contract',{id},{origin:'plugin_registry',availability:'unavailable',contentHash:null,version:null,selectionReason:'execution_plugin_dependency'})}
  });
}
/** Read-only Git identity, never a dirty-tree snapshot or a call to Codex. */
export async function contextTechnicalState(root:string,request?:IsolatedCheckoutRequest):Promise<{git:ContextObject|null;checkout:ContextObject}> {
  if(request)return {git:{status:'pinned',baseCommit:request.baseCommit,reference:request.reference,branch:request.branch},checkout:{mode:'isolated',sourceIdentity:request.sourceIdentity,intended:true}};
  const path=await realpath(root),info=await stat(path);
  let gitMarker=false;for(let parent=path;;parent=dirname(parent)){try{await lstat(join(parent,'.git'));gitMarker=true;break}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}if(parent===dirname(parent))break;}
  if(!gitMarker)return {git:{status:'not_applicable'},checkout:{mode:'shared',identity:{dev:info.dev,ino:info.ino}}};
  const environment={PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1'};
  const read=async(args:string[])=>runManagedProcess('/usr/bin/git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],{cwd:path,env:environment,timeoutMs:5000,maxOutputBytes:4096});
  const branch=await read(['symbolic-ref','--quiet','HEAD']);
  if(branch.code===0&&(await read(['show-ref','--verify','--quiet',branch.stdout.trim()])).code===1)return {git:{status:'unborn',reference:branch.stdout.trim()},checkout:{mode:'shared',identity:{dev:info.dev,ino:info.ino}}};
  const head=await read(['rev-parse','--verify','HEAD^{commit}']);
  if(head.code!==0)return {git:{status:'not_verified'},checkout:{mode:'shared',identity:{dev:info.dev,ino:info.ino}}};
  return {git:{status:'observed',baseCommit:head.stdout.trim(),reference:branch.code===0?branch.stdout.trim():null},checkout:{mode:'shared',identity:{dev:info.dev,ino:info.ino}}};
}
export type ContextPreparedMaterial={sources:ContextSource[];configuration:ContextObject;assemblyPolicy:string;prompt:string};
export function manifestForExecution(identity:ContextManifestIdentity,prepared:ContextPreparedMaterial,technical:{git:ContextObject|null;checkout:ContextObject}):ContextManifest{
  return createContextManifest({identity,sources:prepared.sources,configuration:prepared.configuration,assemblyPolicy:prepared.assemblyPolicy,...technical,material:{contextHash:hashContextText(prepared.prompt),promptHash:hashContextText(prepared.prompt)}});
}
export function currentContext(manifest:ContextManifest):CurrentContextObservation{return {identity:manifest.identity,sources:manifest.sources,configuration:manifest.configuration,assemblyPolicy:manifest.assemblyPolicy,git:manifest.git,checkout:manifest.checkout,material:manifest.material}}
export async function verifyRunContext(repository:ContextManifestRepository,record:StoredContextManifest,observed:ContextManifest,phase:string,delivery?:ContextObject):Promise<ContextCompatibility>{
  const compatibility:ContextCompatibility=record.runId!==observed.identity.runId||record.queue!==observed.identity.queue?{status:'unavailable',changes:['manifest:run_binding'],reasons:['O manifesto não pertence a esta execução.']}:compareContextManifest(record.manifest,currentContext(observed));
  await repository.observe(record.id,{phase,compatibility,...(delivery?{delivery}:{})});
  return compatibility;
}
export async function finalRunContext(repository:ContextManifestRepository,record:StoredContextManifest,observe:()=>Promise<ContextManifest>,delivery?:ContextObject):Promise<ContextCompatibility>{
  let compatibility:ContextCompatibility;
  try{compatibility=compareContextManifest(record.manifest,currentContext(await observe()))}catch{compatibility={status:'unavailable',changes:['selected_sources'],reasons:['Não foi possível reautorizar ou observar as fontes selecionadas ao final.']}}
  // Context drift cannot discard the executor's output. DB failures remain explicit
  // in logs and never turn an absent observation into compatibility approval.
  try{await repository.observe(record.id,{phase:'finished',compatibility,...(delivery?{delivery}:{})})}catch{compatibility={status:'unverified',changes:['verification_persistence'],reasons:['A verificação final de contexto não pôde ser persistida.']};console.error('Context verification persistence failed.');}
  return compatibility;
}
function safeCompilationSummary(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const compilation=value as ContextObject,policy=compilation.policy as ContextObject|undefined;
  if(compilation.schemaVersion!==1||policy?.id!=='orbit-context-compiler/1')return undefined;
  return {schema_version:1,policy_version:policy.id,budget:policy.budget,compiled_hash:compilation.compiledHash,fingerprint:compilation.fingerprint,metrics:compilation.metrics,sections:compilation.sections,absent_sections:compilation.absentSections,warning_count:Array.isArray(compilation.warnings)?compilation.warnings.length:0};
}
function safeKnowledgeSummary(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const v=value as ContextObject;if(v.schemaVersion!==1||!v.policy||typeof v.policy!=='object'||Array.isArray(v.policy)||v.policy.id!=='orbit-lexical-retrieval/1')return undefined;
  const selected=Array.isArray(v.selected)?v.selected:[],decisions=Array.isArray(v.compilationDecisions)?v.compilationDecisions:[];
  const state=(d:unknown)=>d&&typeof d==='object'&&!Array.isArray(d)?(d as ContextObject).state:null;
  return {schema_version:1,algorithm:v.algorithm,policy_id:v.policy.id,corpus_hash:v.corpusHash,query_hash:v.queryHash,selection_fingerprint:v.fingerprint,status:v.status,authorized_candidates:v.candidateCount,selected_chunks:selected.length,included_chunks:decisions.filter(d=>['included','partial','deduplicated'].includes(String(state(d)))).length,omitted_chunks:decisions.filter(d=>state(d)==='omitted').length,warning_count:Array.isArray(v.warnings)?v.warnings.length:0};
}
function safeDeliverySummary(value?:ContextObject){
  if(!value)return undefined;
  return Object.fromEntries(['schemaVersion','boundary','compiledHash','contextHash','promptHash','envelopeHash','policy','estimator','compiledEstimatedTokens','envelopeEstimatedTokens','externalEstimatedTokens','billableTokensKnown','providerMemoryControlled','imageTokensKnown','dynamicContextBudgetBytes'].filter(key=>Object.prototype.hasOwnProperty.call(value,key)).map(key=>[key,value[key]]));
}
/** DTO exposes only allowlisted compilation/delivery metadata, never bodies or private roots. */
export function contextManifestDto(record:StoredContextManifest,checks:Awaited<ReturnType<ContextManifestRepository['history']>>,options:{runStatus?:string}={}){
  assertContextManifestIntegrity(record.manifest);
  const manifest=record.manifest,last=checks.at(-1);
  const terminal=options.runStatus&&['success','failed','error','cancelled'].includes(options.runStatus);
  const status=terminal&&last?.phase!=='finished'?'unverified':last?.compatibility.status??'unverified';
  return {id:record.id,turn:record.turn,parent_id:record.parentId,schema_version:manifest.schemaVersion,queue:manifest.identity.queue,run_id:manifest.identity.runId,card_id:manifest.identity.cardId,card_revision:manifest.identity.cardRevision,project_id:manifest.identity.projectId,workspace_id:manifest.identity.workspaceId,runtime_id:manifest.identity.runtimeId,executor:manifest.identity.executor,execution_type:manifest.identity.executionType,fingerprint:manifest.fingerprint,integrity_hash:manifest.integrityHash,git:manifest.git?{status:manifest.git.status,base_commit:manifest.git.baseCommit??null,reference:manifest.git.reference??null}:null,material:manifest.material,...(safeCompilationSummary(manifest.configuration.contextCompilation)?{compilation:safeCompilationSummary(manifest.configuration.contextCompilation)}:{}),...(safeKnowledgeSummary(manifest.configuration.knowledgeRetrieval)?{knowledge_retrieval:safeKnowledgeSummary(manifest.configuration.knowledgeRetrieval)}:{}),captured_at:manifest.capturedAt,context_status:status,observed_at:last?.observedAt??null,sources:manifest.sources.map(source=>({id:source.id,type:source.type,origin:source.origin,resource_id:source.resourceId,version:source.version,content_hash:source.contentHash,availability_at_capture:source.availability,required:source.required,selection_reason:source.selectionReason,dependencies:source.dependencies,trust:source.trust})),verifications:checks.map(check=>({id:check.id,phase:check.phase,status:check.compatibility.status,changes:check.compatibility.changes,reasons:check.compatibility.reasons,observed_at:check.observedAt,...(safeDeliverySummary(check.delivery)?{delivery:safeDeliverySummary(check.delivery)}:{})}))};
}
