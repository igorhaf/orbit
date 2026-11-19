import {hashContextValue,type ContextQueryClient} from './context-manifest';
import {validateDiscoveryReviewPolicy,type DiscoveryReviewPolicy,type DiscoveryEvidenceCompatibility} from './discovery-review';
import {type DiscoveryReviewOrigin} from './discovery-review-repository';

export type EditorialSourceReference={sourceId:string;id:string;version:string;hash:string};
export type EditorialSourceScope=DiscoveryReviewOrigin&{runtimeId:string;projectId:string};
export type EditorialPolicyRecord={schemaVersion:1;reference:EditorialSourceReference;scope:EditorialSourceScope;status:'active'|'revoked'|'unavailable';validFrom:string;validUntil:string;policy:DiscoveryReviewPolicy};
export type EditorialEvidenceAssessment={schemaVersion:1;reference:EditorialSourceReference;scope:EditorialSourceScope;presence:'present'|'missing'|'unknown';compatibility:DiscoveryEvidenceCompatibility;verifiedAt:string;validUntil:string};
export type EditorialConditions={policy:EditorialPolicyRecord|null;evidence:EditorialEvidenceAssessment|null};
export type EditorialProvenance={schemaVersion:1;policy:EditorialPolicyRecord;evidence:EditorialEvidenceAssessment};
export type EditorialVersionedPolicy=DiscoveryReviewPolicy&{editorialProvenance:EditorialProvenance};
export class EditorialSourceError extends Error{constructor(readonly code:string){super(code);this.name='EditorialSourceError'}}
const fail=(code:string):never=>{throw new EditorialSourceError(code)};
const iso=(v:string)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const logical=(v:string)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/.test(v)&&!v.includes('..');
const hashReference=(r:EditorialSourceReference)=>r&&logical(r.sourceId)&&logical(r.id)&&logical(r.version)&&/^[a-f0-9]{64}$/.test(r.hash);
export function editorialPolicyHash(record:Omit<EditorialPolicyRecord,'reference'>){return hashContextValue(record)}
export function editorialEvidenceHash(record:Omit<EditorialEvidenceAssessment,'reference'>){return hashContextValue(record)}
/** The host installs an authority, not data supplied by a request. The authority must
 * resolve immutable history by reference and pin currentness/revocation in this DB
 * transaction. A pair of external reads cannot implement this interface safely. */
export type EditorialSourceAuthority={
 policySourceIds:readonly string[];evidenceSourceIds:readonly string[];
 resolve:(db:ContextQueryClient,scope:EditorialSourceScope)=>Promise<EditorialConditions>;
 historical:(db:ContextQueryClient,reference:EditorialSourceReference,kind:'policy'|'evidence')=>Promise<EditorialPolicyRecord|EditorialEvidenceAssessment|null>;
 pinCurrent:(db:ContextQueryClient,conditions:EditorialConditions)=>Promise<void>;
 consistency:'postgresql_transaction';
};
export type ResolvedEditorialConditions={policy:EditorialVersionedPolicy;evidenceCompatibility:DiscoveryEvidenceCompatibility;revalidate:()=>Promise<void>};
/** No implementation of authority is registered by Orbit in this stage. */
export class EditorialConditionsResolver{
 constructor(private readonly authority:EditorialSourceAuthority,private readonly now:()=>number=Date.now){}
 async resolve(db:ContextQueryClient,scope:EditorialSourceScope):Promise<ResolvedEditorialConditions>{
  if(this.authority.consistency!=='postgresql_transaction')fail('review_source_consistency_unavailable');
  const value=await this.authority.resolve(db,scope);
  // Snapshot data before awaits so the source/caller cannot mutate an accepted receipt.
  const conditions=JSON.parse(JSON.stringify(value)) as EditorialConditions;
  const validate=()=>{
   const p=conditions.policy,e=conditions.evidence,now=this.now();
   if(!p)fail('review_policy_unavailable');
   if(!hashReference(p.reference)||!this.authority.policySourceIds.includes(p.reference.sourceId))fail('review_policy_source_untrusted');
   if(p.schemaVersion!==1||hashContextValue(p.scope)!==hashContextValue(scope)||p.status!=='active')fail('review_policy_unavailable');
   const {reference,...policyBody}=p;
   if(reference.hash!==editorialPolicyHash(policyBody))fail('review_policy_integrity_invalid');
   validateDiscoveryReviewPolicy(p.policy);
   if(!iso(p.validFrom)||!iso(p.validUntil)||Date.parse(p.validFrom)>now||Date.parse(p.validUntil)<=now)fail('review_policy_stale');
   if(!e)fail('review_evidence_unavailable');
   if(!hashReference(e.reference)||!this.authority.evidenceSourceIds.includes(e.reference.sourceId))fail('review_evidence_source_untrusted');
   const {reference:evidenceReference,...evidenceBody}=e;
   if(e.schemaVersion!==1||hashContextValue(e.scope)!==hashContextValue(scope)||evidenceReference.hash!==editorialEvidenceHash(evidenceBody))fail('review_evidence_integrity_invalid');
   if(!['present','missing','unknown'].includes(e.presence)||!['unassessed','compatible','partially_compatible','incompatible','unavailable'].includes(e.compatibility))fail('review_evidence_invalid');
   if(e.presence!=='present'&&e.compatibility!=='unassessed'&&e.compatibility!=='unavailable')fail('review_evidence_invalid');
   if(!iso(e.verifiedAt)||!iso(e.validUntil)||Date.parse(e.verifiedAt)>now||Date.parse(e.validUntil)<=now)fail('review_evidence_stale');
  };
  validate();
  const revalidate=async()=>{validate();await this.authority.pinCurrent(db,conditions);validate()};
  // Pin before trusting even positive compatibility. Implementation must retain locks
  // through COMMIT and reject version changes, revocation and unavailable history.
  await revalidate();
  for(const [kind,record] of [['policy',conditions.policy!],['evidence',conditions.evidence!]] as const){
   const historical=await this.authority.historical(db,record.reference,kind);
   if(!historical||hashContextValue(historical)!==hashContextValue(record))fail('review_source_history_unavailable');
  }
  await revalidate();
  const provenance:EditorialProvenance={schemaVersion:1,policy:conditions.policy!,evidence:conditions.evidence!};
  return {policy:{...conditions.policy!.policy,editorialProvenance:provenance},evidenceCompatibility:conditions.evidence!.presence==='missing'?'unavailable':conditions.evidence!.compatibility,revalidate};
 }
}
/** A changed policy/assessment never silently carries approval forward. Legacy
 * decisions without provenance remain readable, but cannot become eligible here. */
export function editorialApprovalStillApplicable(historical:DiscoveryReviewPolicy,current:EditorialVersionedPolicy,approvalBaseRevision:number):boolean{
 const previous=(historical as Partial<EditorialVersionedPolicy>).editorialProvenance;
 return !!previous&&previous.schemaVersion===1&&hashContextValue(previous)===hashContextValue(current.editorialProvenance)&&approvalBaseRevision>=current.minimumReviewRevision;
}
