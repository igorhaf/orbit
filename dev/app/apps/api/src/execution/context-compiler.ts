import {
  canonicalContextJson, createContextManifest, hashContextText, hashContextValue,
  type ContextManifestIdentity, type ContextObject, type ContextSource,
} from './context-manifest';

/** Host-owned typed material. Trust is obtained only from its registered sources. */
export type ContextSection = 'task'|'rules'|'technical'|'dependencies'|'history'|'operations';
export type ContextCompileBlock = {
  id:string;section:ContextSection;sourceIds:string[];text:string;required:boolean;
  priority?:'direct'|'explicit'|'related'|'historical';kind?:'text'|'structured';
  /** Whole, ordered, exact substrings chosen by the host; never a generated summary. */
  excerpts?:string[];
};
export type ContextCompilerBudget = {
  maxEstimatedTokens:number;reservedResponseTokens:number;reservedOperationTokens:number;
  reservedExternalTokens:number;safetyMarginRatio:number;documentMaxEstimatedTokens:number;
  historyMaxEstimatedTokens:number;perResourceMaxEstimatedTokens:number;providerContextWindow?:number;
};
export type ContextCompilerPolicy = {schemaVersion:1;id:'orbit-context-compiler/1';budget:ContextCompilerBudget};
export type ContextCompilerInput = {
  identity:ContextManifestIdentity;turn?:number;sources:ContextSource[];blocks:ContextCompileBlock[];
  policy:ContextCompilerPolicy;git?:ContextObject|null;checkout?:ContextObject|null;
};
export type ContextCompilationDecision = {
  blockId:string;sourceIds:string[];state:'included'|'partial'|'omitted'|'deduplicated';reason:string;
  originalHash:string;deliveredHash:string|null;originalEstimatedTokens:number;deliveredEstimatedTokens:number;
  duplicateOf:string|null;
};
export type ContextCompilationSourceUsage = {
  sourceId:string;state:'metadata_only'|'included'|'partial'|'omitted'|'deduplicated';blockIds:string[];
};
export type ContextCompilationMetrics = {
  estimator:'utf8-bytes-upper-bound/1';estimated:true;billableTokensKnown:false;
  configuredMaxEstimatedTokens:number;availableEstimatedTokens:number;
  originalEligibleEstimatedTokens:number;compiledEstimatedTokens:number;mandatoryEstimatedTokens:number;
  deduplicatedEstimatedTokens:number;omittedEstimatedTokens:number;
  includedBlocks:number;partialBlocks:number;omittedBlocks:number;deduplicatedBlocks:number;
  originalSourceCount:number;includedSourceCount:number;omittedSourceCount:number;metadataOnlySourceCount:number;
};
export type ContextCompilationResult = {
  schemaVersion:1;status:'ready'|'blocked';identity:ContextManifestIdentity;turn:number;
  policy:ContextCompilerPolicy;text:string;compiledHash:string;fingerprint:string;
  sections:ContextSection[];absentSections:ContextSection[];decisions:ContextCompilationDecision[];
  sourceUsage:ContextCompilationSourceUsage[];metrics:ContextCompilationMetrics;warnings:string[];blockers:string[];
};

export class ContextCompilerError extends Error {
  constructor(message:string,readonly code='CONTEXT_COMPILER_INVALID'){super(message);this.name='ContextCompilerError'}
}

const sectionOrder:ContextSection[]=['task','rules','technical','dependencies','history','operations'];
const priorityOrder=['direct','explicit','related','historical'];
const estimate=(value:string)=>Buffer.byteLength(value,'utf8');
const clone=<T>(value:T):T=>JSON.parse(canonicalContextJson(value));
const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const defaults:ContextCompilerBudget={maxEstimatedTokens:120000,reservedResponseTokens:16000,reservedOperationTokens:8000,reservedExternalTokens:20000,safetyMarginRatio:0.1,documentMaxEstimatedTokens:32000,historyMaxEstimatedTokens:12000,perResourceMaxEstimatedTokens:24000};

/** Explicit host defaults, not an assertion about any model's context window. */
export function defaultContextCompilerPolicy(overrides:Partial<ContextCompilerBudget>={}):ContextCompilerPolicy {
  return {schemaVersion:1,id:'orbit-context-compiler/1',budget:{...defaults,...overrides}};
}

function validatePolicy(policy:ContextCompilerPolicy):void {
  if(policy?.schemaVersion!==1||policy.id!=='orbit-context-compiler/1'||!policy.budget)throw new ContextCompilerError('Política de compilação desconhecida.');
  const budget=policy.budget;
  const integerKeys=['maxEstimatedTokens','reservedResponseTokens','reservedOperationTokens','reservedExternalTokens','documentMaxEstimatedTokens','historyMaxEstimatedTokens','perResourceMaxEstimatedTokens'] as const;
  if(integerKeys.some(key=>!Number.isSafeInteger(budget[key])||budget[key]<0||budget[key]>2000000)||budget.maxEstimatedTokens===0||!Number.isFinite(budget.safetyMarginRatio)||budget.safetyMarginRatio<0||budget.safetyMarginRatio>0.5||budget.providerContextWindow!==undefined&&(!Number.isSafeInteger(budget.providerContextWindow)||budget.providerContextWindow<1||budget.providerContextWindow>2000000))throw new ContextCompilerError('Orçamento de compilação inválido.');
}

/** Input ceiling after external instructions and conservative estimation margin.
 * Response/operation reservations apply to a verified provider window only.
 * Without that evidence maxEstimatedTokens is solely the host's input ceiling.
 */
export function contextCompilerMaterialBudget(policy:ContextCompilerPolicy):number {
  validatePolicy(policy);
  const b=policy.budget;
  const ceiling=Math.min(b.maxEstimatedTokens,b.providerContextWindow===undefined?b.maxEstimatedTokens:b.providerContextWindow-b.reservedResponseTokens-b.reservedOperationTokens);
  return Math.max(0,Math.floor((ceiling-b.reservedExternalTokens)*(1-b.safetyMarginRatio)));
}

function sourceSemantic(source:ContextSource):ContextObject {
  const normalize=(value:any):any=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['observedAt','capturedAt','createdAt','updatedAt'].includes(key)).map(([key,entry])=>[key,normalize(entry)])):value;
  return normalize(source) as ContextObject;
}
function sourceDedupeKey(source:ContextSource):ContextObject {
  // Logical aliases can share a body; the full provenance of both stays in the
  // compilation fingerprint/sourceUsage, while approval/trust/version never merge.
  const {id,logicalPath,selectionReason,...rest}=sourceSemantic(source);
  return rest;
}
function renderBlock(block:ContextCompileBlock,body:string,sources:Map<string,ContextSource>):string {
  return canonicalContextJson({block:block.id,sources:block.sourceIds.map(id=>({id,trust:sources.get(id)!.trust})),content:body});
}
function render(blocks:ContextCompileBlock[],bodies:Map<string,string>,sources:Map<string,ContextSource>):string {
  const sections=sectionOrder.flatMap(section=>{
    const members=blocks.filter(block=>block.section===section&&bodies.has(block.id));
    return members.length?[`## ${section}\n`+members.map(block=>renderBlock(block,bodies.get(block.id)!,sources)).join('\n')]:[];
  });
  return sections.length?'# Orbit context — orbit-context-compiler/1\n'+sections.join('\n\n'):'';
}

/** Pure compilation of already-authorized host observations. It performs no I/O,
 * provider call, tokenization claim, authorization grant or semantic approval.
 */
export function compileContext(input:ContextCompilerInput):ContextCompilationResult {
  const selected=clone(input);validatePolicy(selected.policy);
  const turn=selected.turn??0;
  if(!Number.isSafeInteger(turn)||turn<0||!Array.isArray(selected.blocks))throw new ContextCompilerError('Turno ou blocos inválidos.');
  // Reuse the registry/manifest schema and scope validation, without persistence
  // or changing the meaning of any historical material/fingerprint field.
  const contextSnapshot=createContextManifest({identity:selected.identity,sources:selected.sources,configuration:{},git:selected.git??null,checkout:selected.checkout??null,assemblyPolicy:'context-compiler-input-validation/1',material:{contextHash:hashContextText(''),promptHash:hashContextText('')},capturedAt:'2000-01-01T00:00:00.000Z'});
  const sources=new Map(selected.sources.map(source=>[source.id,source]));
  const blocksById=new Map<string,ContextCompileBlock>();
  for(const block of selected.blocks){
    if(!block||!nonempty(block.id)||!sectionOrder.includes(block.section)||!Array.isArray(block.sourceIds)||!block.sourceIds.length||block.sourceIds.some(id=>!nonempty(id))||new Set(block.sourceIds).size!==block.sourceIds.length||typeof block.text!=='string'||typeof block.required!=='boolean'||block.priority!==undefined&&!priorityOrder.includes(block.priority)||block.kind!==undefined&&!['text','structured'].includes(block.kind))throw new ContextCompilerError('Bloco de contexto inválido.');
    if(blocksById.has(block.id))throw new ContextCompilerError('Identidade de bloco ambígua.');
    if(block.sourceIds.some(id=>!sources.has(id)))throw new ContextCompilerError('Um bloco refere uma fonte não selecionada.','CONTEXT_COMPILER_HIDDEN_SOURCE');
    if(block.excerpts!==undefined){
      if(!Array.isArray(block.excerpts)||!block.excerpts.length||block.excerpts.some(value=>!nonempty(value)))throw new ContextCompilerError('Trechos documentais inválidos.');
      let offset=0;
      for(const excerpt of block.excerpts){const position=block.text.indexOf(excerpt,offset);if(position<0)throw new ContextCompilerError('Trecho não corresponde ao material observado.');offset=position+excerpt.length;}
      if(block.required||block.kind==='structured'||block.section==='rules'||block.sourceIds.some(id=>sources.get(id)!.trust==='host_policy'))throw new ContextCompilerError('Material obrigatório, regra ou estrutura não admite cortes.');
    }
    blocksById.set(block.id,block);
  }
  const warnings:string[]=[],blockers:string[]=[];
  const addBlocker=(reason:string)=>{if(!blockers.includes(reason))blockers.push(reason)};
  const sourceVisit=new Set<string>(),sourceVisited=new Set<string>();
  function inspectDependencies(id:string){
    if(sourceVisit.has(id)){addBlocker('source_dependency_cycle');return}
    if(sourceVisited.has(id))return;
    sourceVisit.add(id);
    for(const dependency of sources.get(id)!.dependencies){if(!sources.has(dependency))addBlocker('source_dependency_missing');else inspectDependencies(dependency)}
    sourceVisit.delete(id);sourceVisited.add(id);
  }
  for(const source of selected.sources)inspectDependencies(source.id);
  const resourceStates=new Map<string,Set<string>>();
  for(const source of selected.sources){
    const key=canonicalContextJson({scope:source.scope,type:source.type,origin:source.origin,resourceId:source.resourceId,ownerId:source.ownerId,version:source.version});
    const states=resourceStates.get(key)??new Set<string>();states.add(source.contentHash??'unverified');resourceStates.set(key,states);
  }
  if([...resourceStates.values()].some(states=>states.size>1))warnings.push('source_content_conflict_unresolved');
  if(selected.policy.budget.providerContextWindow===undefined)warnings.push('provider_capacity_unknown');
  warnings.push('estimation_is_not_billable_token_usage','provider_memory_and_multimodal_usage_not_measured');

  const bySource=new Map<string,ContextCompileBlock[]>();
  for(const block of selected.blocks)for(const id of block.sourceIds)bySource.set(id,[...(bySource.get(id)??[]),block]);
  const dependencyBlocks=(block:ContextCompileBlock)=>[...new Set(block.sourceIds.flatMap(id=>sources.get(id)!.dependencies).flatMap(id=>(bySource.get(id)??[]).map(value=>value.id)))].filter(id=>id!==block.id);
  const mandatory=new Set(selected.blocks.filter(block=>block.required).map(block=>block.id));
  function requireDependency(id:string,seen=new Set<string>()){
    if(seen.has(id))return;seen.add(id);mandatory.add(id);
    for(const dependency of dependencyBlocks(blocksById.get(id)!))requireDependency(dependency,seen);
  }
  for(const id of [...mandatory])requireDependency(id);
  const rank=(block:ContextCompileBlock)=>priorityOrder.indexOf(block.priority??'explicit');
  const ordered=[...selected.blocks].sort((a,b)=>Number(mandatory.has(b.id))-Number(mandatory.has(a.id))||rank(a)-rank(b)||sectionOrder.indexOf(a.section)-sectionOrder.indexOf(b.section)||(a.id<b.id?-1:a.id>b.id?1:0));
  const blocks:ContextCompileBlock[]=[],blockVisit=new Set<string>(),blockVisited=new Set<string>();
  function orderBlock(id:string){
    if(blockVisit.has(id)){addBlocker('material_dependency_cycle');return}
    if(blockVisited.has(id))return;
    blockVisit.add(id);for(const dependency of dependencyBlocks(blocksById.get(id)!))orderBlock(dependency);
    blockVisit.delete(id);blockVisited.add(id);blocks.push(blocksById.get(id)!);
  }
  for(const block of ordered)orderBlock(block.id);

  const bodies=new Map<string,string>(),dedupe=new Map<string,string>(),decisions:ContextCompilationDecision[]=[];
  const decisionById=new Map<string,ContextCompilationDecision>();
  const available=contextCompilerMaterialBudget(selected.policy),budget=selected.policy.budget;
  let optionalDocuments=0,optionalHistory=0;
  const decide=(block:ContextCompileBlock,state:ContextCompilationDecision['state'],reason:string,body:string|null,duplicateOf:string|null=null)=>{
    const decision:ContextCompilationDecision={blockId:block.id,sourceIds:block.sourceIds,state,reason,originalHash:hashContextText(block.text),deliveredHash:body===null?null:hashContextText(body),originalEstimatedTokens:estimate(renderBlock(block,block.text,sources)),deliveredEstimatedTokens:body===null?0:estimate(renderBlock(block,body,sources)),duplicateOf};
    decisions.push(decision);decisionById.set(block.id,decision);return decision;
  };
  for(const block of blocks){
    const required=mandatory.has(block.id),blockSources=block.sourceIds.map(id=>sources.get(id)!);
    if(blockSources.some(source=>source.availability!=='available'||!source.contentHash&&!source.version)){
      decide(block,'omitted','source_not_verifiable',null);if(required)addBlocker('mandatory_source_not_verifiable');continue;
    }
    const unavailableDependency=dependencyBlocks(block).some(id=>{
      const dependency=decisionById.get(id);return !dependency||dependency.state==='omitted'||dependency.state==='partial';
    });
    if(unavailableDependency){decide(block,'omitted','dependency_material_not_delivered',null);if(required)addBlocker('mandatory_dependency_not_delivered');continue}
    const duplicateKey=canonicalContextJson({section:block.section,text:block.text,sources:blockSources.map(sourceDedupeKey).map(value=>canonicalContextJson(value)).sort()});
    const prior=dedupe.get(duplicateKey);
    if(prior){decide(block,'deduplicated','exact_equivalent_material',null,prior);continue}
    const originalCost=estimate(renderBlock(block,block.text,sources));
    const category=block.section==='history'?'history':block.section==='dependencies'?'documents':null;
    const allowedOptional=(cost:number)=>cost<=budget.perResourceMaxEstimatedTokens&&(category!=='documents'||optionalDocuments+cost<=budget.documentMaxEstimatedTokens)&&(category!=='history'||optionalHistory+cost<=budget.historyMaxEstimatedTokens);
    const fits=(body:string)=>{const candidate=new Map(bodies);candidate.set(block.id,body);return estimate(render(blocks,candidate,sources))<=available};
    if(required){
      bodies.set(block.id,block.text);dedupe.set(duplicateKey,block.id);decide(block,'included','mandatory_material',block.text);
      if(estimate(render(blocks,bodies,sources))>available)addBlocker('mandatory_material_exceeds_budget');
      continue;
    }
    if(allowedOptional(originalCost)&&fits(block.text)){
      bodies.set(block.id,block.text);dedupe.set(duplicateKey,block.id);decide(block,'included','selected_optional_material',block.text);
      if(category==='documents')optionalDocuments+=originalCost;if(category==='history')optionalHistory+=originalCost;
      continue;
    }
    // Only explicit, whole, ordered excerpts can reduce optional documentary text.
    // No arbitrary character/token cut, generated summary, rule or code truncation.
    if(block.excerpts?.length&&block.kind!=='structured'&&block.section!=='rules'&&!blockSources.some(source=>source.trust==='host_policy')){
      let chosen='';
      for(const excerpt of block.excerpts){
        const candidate=chosen?chosen+'\n\n[explicit excerpt boundary]\n\n'+excerpt:excerpt;
        if(allowedOptional(estimate(renderBlock(block,candidate,sources)))&&fits(candidate))chosen=candidate;else break;
      }
      if(chosen&&chosen!==block.text){
        bodies.set(block.id,chosen);const cost=estimate(renderBlock(block,chosen,sources));
        decide(block,'partial','explicit_documentary_excerpts',chosen);
        if(category==='documents')optionalDocuments+=cost;if(category==='history')optionalHistory+=cost;
        continue;
      }
    }
    decide(block,'omitted',allowedOptional(originalCost)?'context_budget':'optional_resource_or_category_budget',null);
  }
  const compiledText=render(blocks,bodies,sources);
  if(estimate(compiledText)>available&&!blockers.includes('mandatory_material_exceeds_budget'))addBlocker('compiled_material_exceeds_budget');
  const sourceUsage:ContextCompilationSourceUsage[]=selected.sources.map(source=>{
    const associated=decisions.filter(decision=>decision.sourceIds.includes(source.id));
    const state:ContextCompilationSourceUsage['state']=!associated.length?'metadata_only':associated.every(decision=>decision.state==='omitted')?'omitted':associated.some(decision=>decision.state==='partial'||decision.state==='omitted')?'partial':associated.some(decision=>decision.state==='included')?'included':'deduplicated';
    return {sourceId:source.id,state,blockIds:associated.map(decision=>decision.blockId)};
  });
  const sections=sectionOrder.filter(section=>blocks.some(block=>block.section===section&&bodies.has(block.id)));
  const metrics:ContextCompilationMetrics={
    estimator:'utf8-bytes-upper-bound/1',estimated:true,billableTokensKnown:false,
    configuredMaxEstimatedTokens:budget.maxEstimatedTokens,availableEstimatedTokens:available,
    originalEligibleEstimatedTokens:estimate(render(blocks,new Map(blocks.map(block=>[block.id,block.text])),sources)),
    compiledEstimatedTokens:estimate(compiledText),mandatoryEstimatedTokens:estimate(render(blocks,new Map([...bodies].filter(([id])=>mandatory.has(id))),sources)),
    deduplicatedEstimatedTokens:decisions.filter(decision=>decision.state==='deduplicated').reduce((sum,decision)=>sum+decision.originalEstimatedTokens,0),
    omittedEstimatedTokens:decisions.filter(decision=>decision.state==='omitted'||decision.state==='partial').reduce((sum,decision)=>sum+decision.originalEstimatedTokens-decision.deliveredEstimatedTokens,0),
    includedBlocks:decisions.filter(decision=>decision.state==='included').length,partialBlocks:decisions.filter(decision=>decision.state==='partial').length,
    omittedBlocks:decisions.filter(decision=>decision.state==='omitted').length,deduplicatedBlocks:decisions.filter(decision=>decision.state==='deduplicated').length,
    originalSourceCount:selected.sources.length,includedSourceCount:sourceUsage.filter(source=>['included','partial','deduplicated'].includes(source.state)).length,
    omittedSourceCount:sourceUsage.filter(source=>source.state==='omitted').length,metadataOnlySourceCount:sourceUsage.filter(source=>source.state==='metadata_only').length,
  };
  const fingerprint=hashContextValue({schemaVersion:1,contextFingerprint:contextSnapshot.fingerprint,turn,policy:selected.policy,decisions,sourceUsage,compiledHash:hashContextText(compiledText),warnings,blockers});
  return {schemaVersion:1,status:blockers.length?'blocked':'ready',identity:selected.identity,turn,policy:selected.policy,text:compiledText,compiledHash:hashContextText(compiledText),fingerprint,sections,absentSections:sectionOrder.filter(section=>!sections.includes(section)),decisions,sourceUsage,metrics,warnings,blockers};
}

/** Additive metadata for configuration.contextCompilation in the immutable04
 * manifest. Bodies, source provenance and physical checkout data are excluded.
 * API consumers must still authorize the resource and sanitize identifiers.
 */
export function compilationMetadata(result:ContextCompilationResult):ContextObject {
  const {identity,turn,text,...metadata}=result;
  return clone(metadata) as unknown as ContextObject;
}
