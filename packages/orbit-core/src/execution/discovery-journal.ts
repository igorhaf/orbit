import {assertContextManifestIntegrity,canonicalContextJson,hashContextValue,type ContextSource,type StoredContextManifest} from './context-manifest';
import {containsSecretText} from './security';
import {DiscoveryJournalStoreError,discoveryCategories,discoveryProposalHash,type DiscoveryBinding,type DiscoveryCapturePolicy,type DiscoveryCategory,type DiscoveryEvidenceRecord,type DiscoverySubmission,type StoredDiscovery} from './discovery-journal-repository';

export const discoveryCapturePolicy:DiscoveryCapturePolicy={schemaVersion:1,id:'orbit-discovery-capture/1',retention:'explicit_admin_policy',textHandling:'review_required',maxProposals:8,maxStatementBytes:2048};
export type DiscoveryProposalEnvelope={schemaVersion:1;kind:'orbit.discovery.proposals';proposals:Array<{category:DiscoveryCategory;statement:string;evidence:Array<{kind:DiscoveryEvidenceRecord['kind'];reference:string;location?:{startLine:number;endLine:number}}>}>};
export class DiscoveryJournalError extends Error{constructor(readonly code:string){super(code);this.name='DiscoveryJournalError'}}
function fail(code:string):never{throw new DiscoveryJournalError(code)}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function strict(v:unknown,keys:string[]):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('discovery_schema_invalid')}
const logical=/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/;
function safeText(text:string){
 // This is a bounded rejection filter, not a universal PII/secret classifier.
 if(containsSecretText(text)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)||/(?:\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|(?:^|\s)\/(?:home|etc|root|var|tmp)\/)/.test(text))fail('discovery_sensitive_content');
}
export function validateDiscoveryEnvelope(value:unknown):DiscoveryProposalEnvelope{
 strict(value,['schemaVersion','kind','proposals']);if(value.schemaVersion!==1||value.kind!=='orbit.discovery.proposals'||!Array.isArray(value.proposals)||value.proposals.length>8||Buffer.byteLength(canonicalContextJson(value))>24000)fail('discovery_envelope_invalid');
 for(const row of value.proposals as unknown[]){strict(row,['category','statement','evidence']);if(!discoveryCategories.includes(row.category as DiscoveryCategory)||typeof row.statement!=='string'||!row.statement.trim()||Buffer.byteLength(row.statement)>2048||!Array.isArray(row.evidence)||row.evidence.length>8)fail('discovery_proposal_invalid');safeText(row.statement);
  for(const e of row.evidence as unknown[]){strict(e,['kind','reference','location']);if(!['manifest_source','artifact','declared_reference'].includes(String(e.kind))||typeof e.reference!=='string'||!logical.test(e.reference)||e.reference.includes('..')||/(?:^|[:\/])(?:\.env|\.git|\.ssh|\.codex|credentials|auth\.json)(?:\/|$|\.)/i.test(e.reference))fail('discovery_evidence_invalid');safeText(e.reference);if(e.location!==undefined){strict(e.location,['startLine','endLine']);if(!Number.isSafeInteger(e.location.startLine)||!Number.isSafeInteger(e.location.endLine)||Number(e.location.startLine)<1||Number(e.location.endLine)<Number(e.location.startLine)||Number(e.location.endLine)>10000000)fail('discovery_location_invalid')}}
 }
 return JSON.parse(canonicalContextJson(value)) as DiscoveryProposalEnvelope;
}
/** Capture requires explicit host approval of quarantine/review policy per project.
 * This grants storage of proposals, never publication, approval or safe classification. */
export function discoveryPolicyFromHost(projectId:string,env:NodeJS.ProcessEnv=process.env):DiscoveryCapturePolicy|null{
 const flag=env.ORBIT_DISCOVERY_JOURNAL_ENABLED;if(flag===undefined||flag==='0')return null;if(flag!=='1')return fail('discovery_host_policy_invalid');
 if(env.ORBIT_DISCOVERY_JOURNAL_TEXT_POLICY!=='review_required')return fail('discovery_review_policy_required');
 const projects=(env.ORBIT_DISCOVERY_JOURNAL_PROJECTS||'').split(',').filter(Boolean);if(!projects.includes(projectId))return null;
 return {...discoveryCapturePolicy};
}
export function discoveryConfiguration(configuration:Record<string,any>,projectId:string,captured?:Pick<StoredContextManifest,'manifest'>|null){
 const policy=captured===undefined?discoveryPolicyFromHost(projectId):captured?.manifest.configuration.discoveryJournal;
 // An old manifest never gains a grant when the current host flag changes.
 if(policy&&canonicalContextJson(policy)!==canonicalContextJson(discoveryPolicyFromHost(projectId)))fail('discovery_host_policy_changed');
 return {...configuration,...(policy?{discoveryJournal:JSON.parse(canonicalContextJson(policy))}:{})};
}
export function discoveryIngestionReviewed(projectId:string,envelopeHash:string,env:NodeJS.ProcessEnv=process.env):boolean{
 const entries=(env.ORBIT_DISCOVERY_JOURNAL_REVIEWED_ENVELOPES||'').split(',').filter(Boolean);
 if(entries.length>256||entries.some(e=>!/^([0-9a-f-]{36}):[0-9a-f]{64}$/.test(e)))return false;
 return entries.includes(projectId+':'+envelopeHash);
}
export function discoveryPolicyForRecord(record:StoredContextManifest):DiscoveryCapturePolicy|null{
 const policy=record.manifest.configuration.discoveryJournal;if(!policy)return null;
 if(canonicalContextJson(policy)!==canonicalContextJson(discoveryCapturePolicy)||canonicalContextJson(discoveryPolicyFromHost(record.manifest.identity.projectId))!==canonicalContextJson(policy))return fail('discovery_host_policy_changed');
 return {...discoveryCapturePolicy};
}
export type DiscoveryJournalStore={capture:(b:DiscoveryBinding,s:DiscoverySubmission)=>Promise<{status:'persisted'|'duplicate';records:StoredDiscovery[]}>};
export type DiscoveryCaptureAuthority={record:StoredContextManifest;workerId:string;runtimeId:string;signal:AbortSignal;authorize:()=>Promise<void>;observe:(source:ContextSource)=>Promise<ContextSource|null>};
export type DiscoveryCaptureReceipt={schemaVersion:1;state:'disabled'|'absent'|'empty'|'persisted'|'duplicate'|'rejected'|'pending';proposalCount:number;code?:string;artifactAvailability:'host_observed_not_durable';semanticApproval:false};
/** No filesystem/DB/provider access here. Callbacks are supplied by the host and
 * repository binding checks remain independent. Never register this as MCP. */
export class DiscoveryJournal{
 constructor(private readonly store:DiscoveryJournalStore){}
 async capture(authority:DiscoveryCaptureAuthority,artifact:{id:string;value:unknown}):Promise<DiscoveryCaptureReceipt>{
  const receipt=(state:DiscoveryCaptureReceipt['state'],proposalCount=0,code?:string):DiscoveryCaptureReceipt=>({schemaVersion:1,state,proposalCount,...(code?{code}:{}),artifactAvailability:'host_observed_not_durable',semanticApproval:false});
  const signal=authority.signal,record=JSON.parse(canonicalContextJson(authority.record)) as StoredContextManifest;
  if(!record.manifest.configuration.discoveryJournal)return receipt('disabled');
  const alive=()=>{if(signal.aborted)fail('discovery_cancelled')};
  try{
   alive();assertContextManifestIntegrity(record.manifest);const policy=discoveryPolicyForRecord(record)!;
   const i=record.manifest.identity;if(i.runtimeId!==authority.runtimeId||i.queue!==record.queue||i.runId!==record.runId||!Number.isSafeInteger(i.cardRevision)||Number(i.cardRevision)<1)fail('discovery_binding_invalid');
   if(!logical.test(artifact.id)||artifact.id.includes('..'))fail('discovery_artifact_invalid');
   const envelope=validateDiscoveryEnvelope(artifact.value);if(!envelope.proposals.length)return receipt('empty');
   if(!discoveryIngestionReviewed(i.projectId,hashContextValue(envelope)))fail('discovery_ingestion_review_required');
   await authority.authorize();alive();
   const evidence=async(e:DiscoveryProposalEnvelope['proposals'][number]['evidence'][number]):Promise<DiscoveryEvidenceRecord>=>{
    if(e.kind==='declared_reference')return {...e,hash:null,version:null,state:'unverified'};
    if(e.kind==='artifact')return {...e,hash:e.reference===artifact.id?hashContextValue(envelope):null,version:'1',state:e.reference===artifact.id?'historical_reference':'unavailable'};
    const source=record.manifest.sources.find(s=>s.id===e.reference);
    if(!source)return {...e,hash:null,version:null,state:'unavailable'};
    const scope=source.scope;if(scope.runtimeId!==i.runtimeId||scope.projectId!==i.projectId||scope.workspaceId!==i.workspaceId||scope.actorId!==i.actorId||source.ownerId!==i.actorId)fail('discovery_evidence_scope');
    let observed:ContextSource|null=null;try{observed=await authority.observe(source)}catch{/* Unavailable is not verified and does not grant a read. */}alive();
    const sameIdentity=(a:ContextSource,b:ContextSource)=>{const {observedAt:at,...left}=a,{observedAt:bt,...right}=b;return canonicalContextJson(left)===canonicalContextJson(right)};
    const matching=observed&&source.availability==='available'&&observed.availability==='available'&&typeof source.contentHash==='string'&&/^[0-9a-f]{64}$/.test(source.contentHash)&&sameIdentity(source,observed);
    return {...e,hash:source.contentHash,version:source.version,state:!observed||observed.availability!=='available'?'unavailable':!source.contentHash?'unverified':matching?'verified':'changed'};
   };
   const proposals=[];for(const p of envelope.proposals){const row={category:p.category,statement:p.statement,evidence:await Promise.all(p.evidence.map(evidence))};proposals.push({...row,proposalHash:discoveryProposalHash(row)})}
   await authority.authorize();alive();discoveryPolicyForRecord(record);if(!discoveryIngestionReviewed(i.projectId,hashContextValue(envelope)))fail('discovery_ingestion_review_required');
   const binding:DiscoveryBinding={runtimeId:i.runtimeId,projectId:i.projectId,workspaceId:i.workspaceId,actorId:i.actorId,cardId:i.cardId,cardRevision:i.cardRevision!,queue:record.queue,runId:record.runId,turn:record.turn,manifestId:record.id,contextFingerprint:record.manifest.fingerprint,workerId:authority.workerId};
   const artifactHash=hashContextValue(envelope),submissionKey=hashContextValue({queue:record.queue,runId:record.runId,turn:record.turn,manifestId:record.id,artifactId:artifact.id,schemaVersion:1});
   const result=await this.store.capture(binding,{submissionKey,artifactId:artifact.id,artifactHash,origin:'structured_output',executor:i.executor,policy,proposals});
   return receipt(result.status,result.records.length);
  }catch(error){const conflict=error instanceof DiscoveryJournalStoreError&&error.code==='discovery_idempotency_conflict';const code=error instanceof DiscoveryJournalError||conflict?error.code:'discovery_capture_pending';return receipt(error instanceof DiscoveryJournalError||conflict?'rejected':'pending',0,code)}
 }
}
/** Only a whole explicitly typed JSON document is eligible. Natural language,
 * fences and citations are not parsed as facts. No file is opened from output. */
export function discoveryArtifacts(queue:'card_runs'|'card_ai_runs',output:unknown):Array<{id:string;value:unknown}>{
 if(queue==='card_runs'){
  if(!Array.isArray(output))return [];
  return output.flatMap((o,index)=>object(o)&&o.type==='orbit.discovery.proposals'?[{id:'output:'+index,value:o.value}]:[]);
 }
 if(typeof output!=='string'||Buffer.byteLength(output)>24000||!output.trimStart().startsWith('{'))return [];
 try{const value=JSON.parse(output);return object(value)&&value.kind==='orbit.discovery.proposals'?[{id:'output:structured',value}]:[]}catch{return []}
}
