import type {KnowledgeResult} from './knowledge-retrieval';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {assertContextManifestIntegrity,canonicalContextJson,compareContextManifest,hashContextText,hashContextValue,type ContextObject,type ContextSource,type CurrentContextObservation,type StoredContextManifest,type ContextCompatibility} from './context-manifest';
import {contextCompilerMaterialBudget,type ContextCompilerPolicy} from './context-compiler';

export const contextBridgeProtocol='orbit-context-bridge/1' as const;
/** Reserved above each serialized broker response for the bounded local adapter envelope. */
export const contextBridgeTransportReserveBytes=256;
export const contextBridgeCapabilities=['context.describe','sources.list','sources.read','context.compatibility','sources.dependencies'] as const;
export type ContextBridgeCapability=typeof contextBridgeCapabilities[number]|'knowledge.search';
export type ContextBridgeKnowledgePolicy={schemaVersion:1;maxQueryBytes:number;maxResults:number};
export type ContextBridgeKnowledgeAudit={schemaVersion:1;queryHash:string;corpusHash:string;policy:string;found:number;returned:number;omitted:number;remainingBytes?:number;sources:Array<{sourceId:string;sourceIdentityHash:string;sourceHash:string|null;sourceVersion:string|null}>};
export type ContextBridgeRequest={schemaVersion:1;id:string;capability:ContextBridgeCapability;parameters?:{sourceId?:string;maxBytes?:number;offset?:number;limit?:number;query?:string}};
export type ContextBridgeLimits={maxRequests:number;maxResponseBytes:number;maxTotalBytes:number;requestTimeoutMs:number;maxConcurrent:number;maxSources:number;maxDependencyDepth:number;maxRequestBytes?:number};
export type ContextBridgeBinding={schemaVersion:1;protocol:typeof contextBridgeProtocol;bridgeId:string;manifestId:string;queue:'card_runs'|'card_ai_runs';runId:string;turn:number;runtimeId:string;projectId:string;workspaceId:string|null;cardId:string;cardRevision:number|null;actorId:string;ownerId:string;executor:string;contextFingerprint:string;compiledHash:string;checkoutHash:string;gitBase:string|null};
export type ContextBridgeAuditEvent={phase:'bridge_created'|'request_received'|'authorized'|'response_prepared'|'response_emitted'|'delivery_unverified'|'denied'|'closed'|'revoked';requestId?:string;capability?:ContextBridgeCapability;sourceId?:string;sourceIdentityHash?:string;sourceHash?:string|null;sourceVersion?:string|null;status?:string;reason?:string;responseHash?:string;returnedBytes?:number;chargedBytes?:number;observedAt:string;knowledge?:ContextBridgeKnowledgeAudit};
export type ContextBridgeResponse={schemaVersion:1;protocol:typeof contextBridgeProtocol;bridgeId:string;requestId:string;capability:ContextBridgeCapability;status:'ok'|'refused';observedAt:string;data:ContextObject;contentHash:string;returnedBytes:number;limitations:string[];error?:{code:string}};
export type ContextBridgeOptions={record:StoredContextManifest;ownerId:string;limits:ContextBridgeLimits;knowledge?:{policy:ContextBridgeKnowledgePolicy;candidates:ContextSource[];search:(query:string,limit:number,signal:AbortSignal)=>Promise<KnowledgeResult>};readableSourceIds?:string[];signal?:AbortSignal;authorize:(signal:AbortSignal)=>Promise<void>;observe:(sources:ContextSource[],signal:AbortSignal)=>Promise<CurrentContextObservation>;read:(source:ContextSource,signal:AbortSignal)=>Promise<{source:ContextSource;text:string}>;audit:(event:ContextBridgeAuditEvent)=>Promise<void>;now?:()=>string};
export class ContextBridgeError extends Error {
  constructor(readonly code:string,readonly closeTransport=false){super(code);this.name='ContextBridgeError'}
}
const clone=<T>(value:T):T=>JSON.parse(canonicalContextJson(value));
const bytes=(value:unknown)=>Buffer.byteLength(canonicalContextJson(value),'utf8');
const sha=/^[0-9a-f]{64}$/;
const sourceIdPattern=/^src_[0-9a-f]{64}$/;
const idPattern=/^[A-Za-z0-9._:-]{1,128}$/;
const isObject=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fullDimensions=['identity','configuration','git','checkout','assemblyPolicy','material'] as const;
function validLimits(limits:ContextBridgeLimits){
  for(const key of ['maxRequests','maxResponseBytes','maxTotalBytes','requestTimeoutMs','maxConcurrent','maxSources','maxDependencyDepth'] as const)if(!Number.isSafeInteger(limits[key])||limits[key]<1)throw new ContextBridgeError('bridge_invalid_limits');
  if(limits.maxRequests>1024||limits.maxResponseBytes<1024||limits.maxResponseBytes>65536||limits.maxTotalBytes<limits.maxResponseBytes+contextBridgeTransportReserveBytes||limits.maxTotalBytes>1000000||limits.requestTimeoutMs>30000||limits.maxConcurrent>16||limits.maxSources>1024||limits.maxDependencyDepth>16||limits.maxRequestBytes!==undefined&&(!Number.isSafeInteger(limits.maxRequestBytes)||limits.maxRequestBytes<256||limits.maxRequestBytes>16384))throw new ContextBridgeError('bridge_invalid_limits');
}
function validateRequest(value:unknown,maxBytes:number):ContextBridgeRequest {
  let request:unknown;try{if(bytes(value)>maxBytes)throw new Error('size');request=clone(value)}catch{throw new ContextBridgeError('bridge_invalid_request')}
  if(!isObject(request)||Object.keys(request).some(key=>!['schemaVersion','id','capability','parameters'].includes(key))||request.schemaVersion!==1||typeof request.id!=='string'||!idPattern.test(request.id)||typeof request.capability!=='string'||![...contextBridgeCapabilities,'knowledge.search'].includes(request.capability))throw new ContextBridgeError('bridge_invalid_request');
  if(request.parameters===null)throw new ContextBridgeError('bridge_invalid_request');
  const parameters=request.parameters??{};
  if(request.capability==='knowledge.search'){
    if(!isObject(parameters)||Object.keys(parameters).some(k=>!['query','limit'].includes(k))||typeof parameters.query!=='string'||!parameters.query.trim()||Buffer.byteLength(parameters.query)>1024||parameters.limit!==undefined&&(!Number.isSafeInteger(parameters.limit)||Number(parameters.limit)<1||Number(parameters.limit)>6))throw new ContextBridgeError('bridge_invalid_request');
    return request as ContextBridgeRequest;
  }
  if(!isObject(parameters)||Object.keys(parameters).some(key=>!['sourceId','maxBytes','offset','limit'].includes(key))||parameters.sourceId!==undefined&&(typeof parameters.sourceId!=='string'||!sourceIdPattern.test(parameters.sourceId))||parameters.maxBytes!==undefined&&(!Number.isSafeInteger(parameters.maxBytes)||Number(parameters.maxBytes)<1||Number(parameters.maxBytes)>65536))throw new ContextBridgeError('bridge_invalid_request');
  for(const key of ['offset','limit'])if(parameters[key]!==undefined&&(!Number.isSafeInteger(parameters[key])||Number(parameters[key])<(key==='offset'?0:1)||Number(parameters[key])>1024||request.capability!=='sources.list'))throw new ContextBridgeError('bridge_invalid_request');
  const needsSource=['sources.read','sources.dependencies'].includes(request.capability);
  if(needsSource!==Boolean(parameters.sourceId)||request.capability!=='sources.read'&&parameters.maxBytes!==undefined)throw new ContextBridgeError('bridge_invalid_request');
  return request as ContextBridgeRequest;
}
function sameSource(captured:ContextSource,current:ContextSource){
  // Compare the same semantic source dimensions preserved by the04 manifest.

  const normalize=(value:any):any=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['observedAt','capturedAt','createdAt','updatedAt'].includes(key)).map(([key,entry])=>[key,normalize(entry)])):value;
  return canonicalContextJson(normalize(captured))===canonicalContextJson(normalize(current));
}

/** A host-bound query closure is the capability. IDs/fingerprints are never authentication.
 * An adapter must bind this closure to one protected local connection, not publish it by UUID.
 * No database, filesystem, provider, environment or mutable tool is imported here.
 */
export class ContextBridge {
  readonly binding:ContextBridgeBinding;
  private readonly record:StoredContextManifest;private readonly limits:ContextBridgeLimits;private readonly knowledge:ContextBridgeOptions['knowledge'];
  private readonly selected=new Map<string,ContextSource>();private readonly opaque=new Map<string,string>();private readonly readable:Set<string>;
  private readonly knowledgeCandidates=new Map<string,ContextSource>();
  private readonly controller=new AbortController();private readonly externalSignal?:AbortSignal;private readonly abortExternal:()=>void;
  private state:'active'|'closed'|'revoked'='active';private reason='active';private requests=0;private inFlight=0;private reserved=0;private charged=0;private returned=0;private succeeded=0;private refused=0;
  private readonly ids=new Set<string>();private readonly operations=new Set<Promise<unknown>>();private closeAudit:Promise<void>=Promise.resolve();
  constructor(private readonly options:ContextBridgeOptions){
    this.knowledge=options.knowledge?{policy:clone(options.knowledge.policy),candidates:clone(options.knowledge.candidates),search:options.knowledge.search}:undefined;
    this.record=clone(options.record);assertContextManifestIntegrity(this.record.manifest);this.limits=clone(options.limits);validLimits(this.limits);
    const {manifest}=this.record,compilation=manifest.configuration.contextCompilation as ContextObject|undefined;
    if(this.record.queue!==manifest.identity.queue||this.record.runId!==manifest.identity.runId||!this.record.id||!Number.isSafeInteger(this.record.turn)||this.record.turn<0||typeof options.ownerId!=='string'||!options.ownerId||compilation?.schemaVersion!==1||compilation.status!=='ready'||manifest.assemblyPolicy!=='orbit-context-compiler/1'||!isObject(compilation.policy)||compilation.policy.id!=='orbit-context-compiler/1'||typeof compilation.compiledHash!=='string'||compilation.compiledHash!==manifest.material.promptHash||compilation.compiledHash!==manifest.material.contextHash||typeof compilation.fingerprint!=='string'||!sha.test(compilation.fingerprint))throw new ContextBridgeError('bridge_unverifiable_context');
    if(isObject(manifest.configuration.contextBridge)&&manifest.configuration.contextBridge.knowledge!==undefined&&!this.knowledge)throw new ContextBridgeError('bridge_knowledge_unavailable',true);
    const compilerPolicy=compilation.policy as unknown as ContextCompilerPolicy;contextCompilerMaterialBudget(compilerPolicy);
    // Dynamic data consumes a host-reserved part of the same compiled input ceiling.
    if(this.limits.maxTotalBytes>compilerPolicy.budget.reservedExternalTokens||manifest.sources.length>this.limits.maxSources)throw new ContextBridgeError('bridge_invalid_limits');
    this.binding={schemaVersion:1,protocol:contextBridgeProtocol,bridgeId:randomUUID(),manifestId:this.record.id,queue:this.record.queue,runId:this.record.runId,turn:this.record.turn,runtimeId:manifest.identity.runtimeId,projectId:manifest.identity.projectId,workspaceId:manifest.identity.workspaceId,cardId:manifest.identity.cardId,cardRevision:manifest.identity.cardRevision,actorId:manifest.identity.actorId,ownerId:options.ownerId,executor:manifest.identity.executor,contextFingerprint:manifest.fingerprint,compiledHash:compilation.compiledHash,checkoutHash:hashContextValue(manifest.checkout),gitBase:typeof manifest.git?.baseCommit==='string'?manifest.git.baseCommit:null};
    Object.freeze(this.binding);
    const secret=randomBytes(32);
    try{for(const source of manifest.sources){const id='src_'+createHmac('sha256',secret).update(source.id).digest('hex');this.selected.set(id,source);this.opaque.set(source.id,id)}
    if(options.knowledge){
      const captured=manifest.configuration.contextBridge as ContextObject|undefined,metadata=manifest.configuration.knowledgeRetrieval as ContextObject|undefined;
      const policy=options.knowledge.policy;
      if(policy.schemaVersion!==1||!Number.isSafeInteger(policy.maxQueryBytes)||policy.maxQueryBytes<1||policy.maxQueryBytes>1024||!Number.isSafeInteger(policy.maxResults)||policy.maxResults<1||policy.maxResults>6||canonicalContextJson(captured?.knowledge??null)!==canonicalContextJson(policy)||metadata?.schemaVersion!==1||!Array.isArray(metadata.considered)||!sha.test(String(metadata.corpusHash)))throw new ContextBridgeError('bridge_knowledge_unverifiable',true);
      const expected=metadata.considered as ContextObject[];
      if(expected.length!==options.knowledge.candidates.length||new Set(options.knowledge.candidates.map(v=>v.id)).size!==expected.length||expected.length>this.limits.maxSources)throw new ContextBridgeError('bridge_knowledge_unverifiable',true);
      for(const source of options.knowledge.candidates){
        const old=expected.find(c=>c.id===source.id);
        if(!old||old.version!==source.version||old.contentHash!==source.contentHash||old.trust!==source.trust||source.trust==='host_policy'||source.availability!=='available'||source.scope.runtimeId!==manifest.identity.runtimeId||source.scope.projectId!==manifest.identity.projectId||source.scope.workspaceId!==manifest.identity.workspaceId||source.scope.actorId!==manifest.identity.actorId||source.ownerId!==manifest.identity.actorId)throw new ContextBridgeError('bridge_knowledge_unverifiable',true);
        const opaque=this.opaque.get(source.id)??'src_'+createHmac('sha256',secret).update(source.id).digest('hex');this.opaque.set(source.id,opaque);this.knowledgeCandidates.set(opaque,clone(source));
      }
    }
    if(this.opaque.size>this.limits.maxSources)throw new ContextBridgeError('bridge_invalid_limits');
    }finally{secret.fill(0)}
    this.readable=new Set(options.readableSourceIds??[]);
    if([...this.readable].some(id=>!this.selected.has(this.opaque.get(id)??'')))throw new ContextBridgeError('bridge_unselected_readable_source');
    this.externalSignal=options.signal;this.abortExternal=()=>{void this.revoke('execution_cancelled').catch(()=>{})};
    this.externalSignal?.addEventListener('abort',this.abortExternal,{once:true});if(this.externalSignal?.aborted)this.abortExternal();
  }
  get signal():AbortSignal{return this.controller.signal}
  private now(){return this.options.now?.()??new Date().toISOString()}
  private ensureActive(signal?:AbortSignal){if(this.state!=='active'||this.controller.signal.aborted||signal?.aborted)throw new ContextBridgeError(this.state==='active'?'bridge_request_cancelled':'bridge_revoked',true)}
  private async audit(event:Omit<ContextBridgeAuditEvent,'observedAt'>){try{await this.options.audit({...event,observedAt:this.now()})}catch{throw new ContextBridgeError('bridge_audit_failure',true)}}
  private async authorize(signal:AbortSignal){this.ensureActive(signal);try{await this.options.authorize(signal)}catch{await this.revoke('authorization_lost');throw new ContextBridgeError('bridge_authorization_lost',true)}this.ensureActive(signal)}
  descriptor(){return clone({schemaVersion:1,protocol:contextBridgeProtocol,bridgeId:this.binding.bridgeId,runtimeId:this.binding.runtimeId,projectId:this.binding.projectId,workspaceId:this.binding.workspaceId,cardId:this.binding.cardId,cardRevision:this.binding.cardRevision,runId:this.binding.runId,turn:this.binding.turn,executor:this.binding.executor,manifestId:this.binding.manifestId,contextFingerprint:this.binding.contextFingerprint,compiledHash:this.binding.compiledHash,checkoutHash:this.binding.checkoutHash,gitBase:this.binding.gitBase,state:this.state,readOnly:true,capabilities:[...contextBridgeCapabilities,...(this.knowledge?['knowledge.search']:[])],...(this.knowledge?{knowledge:this.knowledge.policy}:{}),limits:this.limits,delivery:'unverified'})}
  summary(){return clone({bridgeId:this.binding.bridgeId,protocol:contextBridgeProtocol,state:this.state,reason:this.reason,requests:this.requests,inFlight:this.inFlight,responses:this.succeeded,refused:this.refused,returnedBytes:this.returned,chargedBytes:this.charged,reservedBytes:this.reserved,remainingBytes:Math.max(0,this.limits.maxTotalBytes-this.charged-this.reserved),estimator:'utf8-bytes-upper-bound/1',billableTokensKnown:false})}
  async close(reason='run_finished'){return this.stop('closed',reason)}
  async revoke(reason='authorization_lost'){return this.stop('revoked',reason)}
  private async stop(state:'closed'|'revoked',reason:string){
    if(this.state!=='active'){await this.closeAudit;return}
    this.state=state;this.reason=/^[a-z][a-z0-9_.:-]{0,127}$/.test(reason)?reason:'bridge_closed';this.controller.abort(new ContextBridgeError('bridge_revoked',true));this.externalSignal?.removeEventListener('abort',this.abortExternal);
    this.closeAudit=this.audit({phase:state,status:state,reason:this.reason});await this.closeAudit;
  }
  private publicSource(id:string,source:ContextSource,current?:ContextSource){return {id,type:source.type,trust:source.trust,version:source.version,capturedHash:source.contentHash,currentHash:current?.contentHash??null,availability:current?.availability??'unverified',readable:this.readable.has(source.id)}}
  private async observe(signal:AbortSignal){
    const observed=clone(await this.options.observe([...this.selected.values()].map(clone),signal));this.ensureActive(signal);await this.authorize(signal);
    const compatibility=compareContextManifest(this.record.manifest,observed);
    const complete=fullDimensions.every(key=>Object.prototype.hasOwnProperty.call(observed,key));
    return {observed,compatibility:compatibility.status==='compatible'&&!complete?{status:'unverified' as const,changes:[],reasons:['partial_observation']}:compatibility,complete};
  }
  private response(request:ContextBridgeRequest,status:'ok'|'refused',data:ContextObject,error?:string):ContextBridgeResponse{
    const result:ContextBridgeResponse={schemaVersion:1,protocol:contextBridgeProtocol,bridgeId:this.binding.bridgeId,requestId:request.id,capability:request.capability,status,observedAt:this.now(),data,contentHash:hashContextValue(data),returnedBytes:0,limitations:['data_not_privileged_instructions','adapter_delivery_not_model_usage','estimated_bytes_not_billable_tokens'],...(error?{error:{code:error}}:{})};
    for(let attempt=0;attempt<8;attempt++){const size=bytes(result);if(size===result.returnedBytes)break;result.returnedBytes=size}
    return result;
  }
  private async handle(request:ContextBridgeRequest,signal:AbortSignal):Promise<{data:ContextObject;source?:ContextSource;sourceId?:string}> {
    const manifest=this.record.manifest;
    if(request.capability==='knowledge.search'){
      const capability=this.knowledge;if(!capability)throw new ContextBridgeError('bridge_capability_not_authorized');
      const query=request.parameters!.query!,limit=request.parameters?.limit??capability.policy.maxResults;
      if(Buffer.byteLength(query)>capability.policy.maxQueryBytes||limit>capability.policy.maxResults)throw new ContextBridgeError('bridge_invalid_knowledge_parameters');
      let result:KnowledgeResult;try{result=await capability.search(query,limit,signal)}catch{throw new ContextBridgeError('bridge_knowledge_unverifiable',true)}this.ensureActive(signal);await this.authorize(signal);
      const captured=manifest.configuration.knowledgeRetrieval as ContextObject;
      if(result.corpusHash!==captured.corpusHash||result.queryHash!==hashContextValue({text:query,fields:['dynamic_query'],cardId:this.binding.cardId,cardRevision:this.binding.cardRevision})||result.policy.id!=='orbit-lexical-retrieval/1'||canonicalContextJson(result.policy)!==canonicalContextJson(captured.policy)||canonicalContextJson(result.considered)!==canonicalContextJson(captured.considered)||result.algorithm!==captured.algorithm||result.cardId!==this.binding.cardId||result.cardRevision!==this.binding.cardRevision||result.selected.length>6)throw new ContextBridgeError('bridge_knowledge_changed',true);
      const prepared=Array.isArray(captured.selected)?captured.selected as ContextObject[]:[],decisions=Array.isArray(captured.compilationDecisions)?captured.compilationDecisions as ContextObject[]:[];
      const all=result.selected.map(chunk=>{
        const id=this.opaque.get(chunk.source.id),source=id?this.knowledgeCandidates.get(id):undefined;
        if(!id||!source||source.version!==chunk.source.version||source.contentHash!==chunk.documentHash||source.trust!==chunk.source.trust||!sameSource(source,chunk.source)||chunk.bodyHash!==hashContextText(chunk.text))throw new ContextBridgeError('bridge_knowledge_source_unverifiable',true);
        return {sourceId:id,sourceIdentityHash:hashContextText(source.id),version:source.version,documentHash:chunk.documentHash,bodyHash:chunk.bodyHash,type:source.type,origin:source.origin,trust:source.trust,rank:chunk.rank,score:chunk.score,location:{startLine:chunk.startLine,endLine:chunk.endLine},text:chunk.text,sourceSelectedInitially:this.selected.has(id),selectedInitially:prepared.some(c=>c.id===chunk.id),initialCompilationScope:'retrieval_block_only',initialCompilation:decisions.find(c=>c.blockId===chunk.id)?.state??'not_selected',stage:'recovered_dynamically'};
      });
      let returned=Math.min(limit,all.length),data:ContextObject;
      do{data={schemaVersion:1,queryHash:result.queryHash,algorithm:result.algorithm,policy:result.policy.id,corpusHash:result.corpusHash,compatibility:'compatible',status:result.status,remainingBytesEstimated:Math.max(0,this.limits.maxTotalBytes-this.charged-this.reserved),countsScope:'retriever_shortlist',found:all.length,returned,omitted:all.length-returned,results:all.slice(0,returned),warnings:[...result.warnings,...(returned<all.length?['response_results_omitted']:[])],limitations:[...result.limitations,'dynamic_not_original_material','delivery_to_model_unverified']};if(this.response(request,'ok',data).returnedBytes<=this.limits.maxResponseBytes)break;returned--}while(returned>=0);
      if(returned<0)throw new ContextBridgeError('bridge_response_size_limit');
      return {data};
    }
    if(request.capability==='context.describe'){
      const {compatibility,complete}=await this.observe(signal);
      const {ownerId,protocol,schemaVersion,...identity}=this.binding;
      return {data:{identity:identity as unknown as ContextObject,verification:{status:compatibility.status,complete,changedDimensions:compatibility.changes.length},executionState:'running',compilationPolicy:'orbit-context-compiler/1'}};
    }
    if(request.capability==='sources.list'){
      const {observed}=await this.observe(signal),current=new Map(observed.sources.map(source=>[source.id,source]));
      const all=[...this.selected],offset=request.parameters?.offset??0;
      if(offset>all.length)throw new ContextBridgeError('bridge_invalid_request');
      let end=Math.min(all.length,offset+(request.parameters?.limit??this.limits.maxSources));
      let data:ContextObject;
      do{data={sources:all.slice(offset,end).map(([id,source])=>this.publicSource(id,source,current.get(source.id))),offset,total:all.length,nextOffset:end<all.length?end:null,limited:end<all.length};if(this.response(request,'ok',data).returnedBytes<=this.limits.maxResponseBytes)break;end--}while(end>offset);
      if(end===offset&&offset<all.length)throw new ContextBridgeError('bridge_response_size_limit');
      return {data};
    }
    if(request.capability==='context.compatibility'){
      const {observed,compatibility,complete}=await this.observe(signal),current=new Map(observed.sources.map(source=>[source.id,source]));
      return {data:{status:compatibility.status,complete,sources:[...this.selected].map(([id,source])=>{const actual=current.get(source.id);return {id,status:!actual?'unavailable':actual.availability==='unverified'?'unverified':actual.availability!=='available'?'unavailable':sameSource(source,actual)?'compatible':'changed'}})}};
    }
    const sourceId=request.parameters!.sourceId!,source=this.selected.get(sourceId);if(!source)throw new ContextBridgeError('bridge_source_not_selected');
    if(request.capability==='sources.dependencies'){
      const seen=new Set<string>(),relations:ContextObject[]=[];
      const visit=(current:ContextSource,depth:number)=>{if(depth>this.limits.maxDependencyDepth)throw new ContextBridgeError('bridge_dependency_limit');if(seen.has(current.id))return;seen.add(current.id);for(const dependency of current.dependencies){const id=this.opaque.get(dependency);if(!id)throw new ContextBridgeError('bridge_dependency_unverified');const target=this.selected.get(id);if(!target)throw new ContextBridgeError('bridge_dependency_unverified');relations.push({from:this.opaque.get(current.id)!,to:id,type:target.type,version:target.version,capturedHash:target.contentHash});if(relations.length>this.limits.maxSources)throw new ContextBridgeError('bridge_dependency_limit');visit(target,depth+1)}};
      visit(source,0);return {data:{sourceId,relations,historical:true},source,sourceId};
    }
    if(!this.readable.has(source.id))throw new ContextBridgeError('bridge_source_not_readable');
    const {observed}=await this.observe(signal),current=observed.sources.find(value=>value.id===source.id);
    if(!current||current.availability==='missing'||current.availability==='unavailable')throw new ContextBridgeError('bridge_source_unavailable');
    if(current.availability!=='available'||!current.contentHash&&!current.version)throw new ContextBridgeError('bridge_source_unverified');
    if(!sameSource(source,current))throw new ContextBridgeError('bridge_source_changed');
    const result=await this.options.read(clone(source),signal);this.ensureActive(signal);await this.authorize(signal);
    if(typeof result.text!=='string'||!sameSource(source,result.source))throw new ContextBridgeError('bridge_source_changed');
    if(request.parameters?.maxBytes!==undefined&&Buffer.byteLength(result.text,'utf8')>request.parameters.maxBytes)throw new ContextBridgeError('bridge_source_size_limit');
    return {data:{source:this.publicSource(sourceId,source,result.source),representation:'data',text:result.text,bodyHash:hashContextText(result.text),historicalHash:source.contentHash,observedHash:result.source.contentHash},source,sourceId};
  }
  async query(value:unknown):Promise<ContextBridgeResponse>{
    this.ensureActive();let request:ContextBridgeRequest;
    try{request=validateRequest(value,this.limits.maxRequestBytes??4096)}catch{void this.revoke('invalid_request').catch(()=>{});throw new ContextBridgeError('bridge_invalid_request',true)}
    if(this.ids.has(request.id)){void this.revoke('request_replay').catch(()=>{});throw new ContextBridgeError('bridge_request_replay',true)}
    if(this.requests>=this.limits.maxRequests){await this.revoke('request_limit');throw new ContextBridgeError('bridge_request_limit',true)}
    const reservation=this.limits.maxResponseBytes+contextBridgeTransportReserveBytes;
    if(this.charged+this.reserved+reservation>this.limits.maxTotalBytes){await this.revoke('budget_exhausted');throw new ContextBridgeError('bridge_budget_exhausted',true)}
    const overConcurrency=this.inFlight>=this.limits.maxConcurrent;
    this.ids.add(request.id);this.requests++;this.reserved+=reservation;if(!overConcurrency)this.inFlight++;
    const operationController=new AbortController();const abort=()=>operationController.abort(this.controller.signal.reason);this.controller.signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>operationController.abort(new ContextBridgeError('bridge_request_timeout')),this.limits.requestTimeoutMs);
    const operation=this.perform(request,operationController.signal,overConcurrency);
    this.operations.add(operation);
    try{
      const result=await Promise.race([operation,new Promise<never>((_,reject)=>{if(operationController.signal.aborted)reject(operationController.signal.reason);else operationController.signal.addEventListener('abort',()=>reject(operationController.signal.reason),{once:true})})]);
      this.ensureActive(operationController.signal);const cost=result.returnedBytes+contextBridgeTransportReserveBytes;
      if(result.returnedBytes>this.limits.maxResponseBytes||cost>reservation)throw new ContextBridgeError('bridge_response_size_limit');
      this.charged+=cost;this.returned+=result.returnedBytes;if(result.status==='ok')this.succeeded++;else this.refused++;
      return clone(result);
    }catch(error){
      if(error instanceof ContextBridgeError&&error.code==='bridge_request_timeout'){this.refused++;void this.revoke('request_timeout').catch(()=>{});void this.audit({phase:'denied',requestId:request.id,capability:request.capability,status:'refused',reason:'bridge_request_timeout'}).catch(()=>{});throw new ContextBridgeError('bridge_request_timeout',true)}
      if(!(error instanceof ContextBridgeError)||error.closeTransport)void this.revoke('audit_or_authorization_failure').catch(()=>{});
      throw error instanceof ContextBridgeError?error:new ContextBridgeError('bridge_audit_or_host_failure',true);
    }finally{clearTimeout(timeout);this.controller.signal.removeEventListener('abort',abort);this.reserved-=reservation;if(!overConcurrency)this.inFlight--;this.operations.delete(operation);}
  }
  private async perform(request:ContextBridgeRequest,signal:AbortSignal,overConcurrency:boolean):Promise<ContextBridgeResponse>{
    const selectedSource=request.parameters?.sourceId?this.selected.get(request.parameters.sourceId):undefined;
    const knowledge=request.capability==='knowledge.search'&&this.knowledge?{schemaVersion:1 as const,queryHash:hashContextValue({text:request.parameters!.query,fields:['dynamic_query'],cardId:this.binding.cardId,cardRevision:this.binding.cardRevision}),corpusHash:String((this.record.manifest.configuration.knowledgeRetrieval as ContextObject|undefined)?.corpusHash??''),policy:'orbit-lexical-retrieval/1',found:0,returned:0,omitted:0,remainingBytes:Math.max(0,this.limits.maxTotalBytes-this.charged-this.reserved),sources:[]}:undefined;
    const provenance={...(knowledge&&sha.test(knowledge.corpusHash)?{knowledge}:{}),...(request.parameters?.sourceId?{sourceId:request.parameters.sourceId}:{}),...(selectedSource?{sourceIdentityHash:hashContextText(selectedSource.id)}:{})};
    await this.audit({phase:'request_received',requestId:request.id,capability:request.capability,...provenance,status:'received'});this.ensureActive(signal);
    let response:ContextBridgeResponse,source:ContextSource|undefined,sourceId=request.parameters?.sourceId;
    try{
      await this.authorize(signal);await this.audit({phase:'authorized',requestId:request.id,capability:request.capability,...provenance,status:'authorized'});this.ensureActive(signal);
      if(overConcurrency)throw new ContextBridgeError('bridge_concurrency_limit');
      const handled=await this.handle(request,signal);source=handled.source;sourceId=handled.sourceId;
      response=this.response(request,'ok',handled.data);
      if(response.returnedBytes>this.limits.maxResponseBytes)throw new ContextBridgeError('bridge_response_size_limit');
    }catch(error){
      this.ensureActive(signal);
      if(error instanceof ContextBridgeError&&error.closeTransport){await this.audit({phase:'denied',requestId:request.id,capability:request.capability,...provenance,status:'refused',reason:error.code});throw error;}
      response=this.response(request,'refused',{},error instanceof ContextBridgeError?error.code:'bridge_source_unavailable');
      await this.audit({phase:'denied',requestId:request.id,capability:request.capability,...provenance,status:'refused',reason:response.error!.code});this.ensureActive(signal);
    }
    await this.authorize(signal);
    await this.audit({phase:'response_prepared',requestId:request.id,capability:request.capability,...provenance,...(bridgeKnowledgeAuditMetadata(response)?{knowledge:bridgeKnowledgeAuditMetadata(response)}:{}),...(source?{sourceHash:source.contentHash,sourceVersion:source.version}:{}),status:response.status,responseHash:response.contentHash,returnedBytes:response.returnedBytes,chargedBytes:response.returnedBytes+contextBridgeTransportReserveBytes});this.ensureActive(signal);
    await this.audit({phase:'delivery_unverified',requestId:request.id,capability:request.capability,...provenance,status:'unverified',reason:'model_delivery_not_observed'});this.ensureActive(signal);
    await this.authorize(signal);return response;
  }
}

/** Audit-safe summary of verified public results. No raw query or document body. */
export function bridgeKnowledgeAuditMetadata(response:ContextBridgeResponse):ContextBridgeKnowledgeAudit|undefined{
 if(response.capability!=='knowledge.search'||response.status!=='ok')return undefined;
 const d=response.data;if(!Array.isArray(d.results))return undefined;
 return {schemaVersion:1,queryHash:String(d.queryHash),corpusHash:String(d.corpusHash),policy:String(d.policy),found:Number(d.found),returned:Number(d.returned),omitted:Number(d.omitted),...(Number.isSafeInteger(d.remainingBytesEstimated)?{remainingBytes:Number(d.remainingBytesEstimated)}:{}),sources:(d.results as ContextObject[]).map(v=>({sourceId:String(v.sourceId),sourceIdentityHash:String(v.sourceIdentityHash),sourceHash:typeof v.documentHash==='string'?v.documentHash:null,sourceVersion:typeof v.version==='string'?v.version:null}))};
}
