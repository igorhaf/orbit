import {canonicalContextJson,hashContextValue,type ContextQueryClient} from './context-manifest';
import {validateDiscoveryReviewPolicy,type DiscoveryReviewPolicy} from './discovery-review';
import {editorialPolicyHash,EditorialSourceError,type EditorialPolicyRecord,type EditorialSourceReference,type EditorialSourceScope} from './discovery-review-sources';
import {type DiscoveryReviewPool} from './discovery-review-repository';
export const editorialPolicySourceId='orbit-editorial-policy-store/1';
export type PolicyCandidateInput={id:string;version:string;scope:EditorialSourceScope;policy:DiscoveryReviewPolicy;validFrom:string;validUntil:string;provenance:{origin:string;attributedActor:string;reference:string}};
export type PolicyCandidate={record:EditorialPolicyRecord;provenance:PolicyCandidateInput['provenance'];governance:'registered'|'content_validated'|'revoked';events:Array<{revision:number;action:'content_validated'|'revoked';attributedActor:string;reason:string;recordedAt:string}>};
const fail=(code:string):never=>{throw new EditorialSourceError(code)};
const rows=async(db:ContextQueryClient,sql:string,p:any[]=[])=>{const r=await db.query(sql,p);return Array.isArray(r)?r:r.rows};
const logical=(v:string)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/.test(v)&&!v.includes('..');
const iso=(v:string)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
/** Internal persistence only, no authentication/authorization or institutional authority.
 * An authenticated governance adapter is still required before exposing any mutation. */
export class DiscoveryEditorialPolicyStore{
 constructor(private readonly pool:DiscoveryReviewPool){}
 private async transaction<T>(fn:(db:ContextQueryClient)=>Promise<T>):Promise<T>{
  const db=await this.pool.connect();try{await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');const r=await fn(db);await db.query('COMMIT');return r}
  catch(e){await db.query('ROLLBACK');if(e instanceof EditorialSourceError)throw e;throw new EditorialSourceError((e as {code?:string}).code==='23505'?'review_policy_version_conflict':'review_policy_store_failed')}
  finally{db.release()}
 }
 async register(input:PolicyCandidateInput):Promise<EditorialSourceReference>{
  const i=JSON.parse(canonicalContextJson(input)) as PolicyCandidateInput;
  if(!logical(i.id)||!logical(i.version)||!logical(i.provenance?.origin)||!logical(i.provenance?.reference)||typeof i.provenance?.attributedActor!=='string'||!i.provenance.attributedActor.trim()||Buffer.byteLength(i.provenance.attributedActor)>160||!iso(i.validFrom)||!iso(i.validUntil)||i.validFrom>=i.validUntil)fail('review_policy_candidate_invalid');
  // Shape validation only; registration and explicit validation event are distinct.
  validateDiscoveryReviewPolicy(i.policy);
  if(Object.keys(i.policy).some(k=>!['schemaVersion','minimumReviewRevision','requiredEvidenceCompatibility','allowIneligibleApproval'].includes(k)))fail('review_policy_candidate_invalid');
  const body={schemaVersion:1 as const,scope:i.scope,status:'unavailable' as const,validFrom:i.validFrom,validUntil:i.validUntil,policy:i.policy};
  const reference={sourceId:editorialPolicySourceId,id:i.id,version:i.version,hash:editorialPolicyHash(body)};
  await this.transaction(db=>db.query('INSERT INTO discovery_editorial_policy_versions(source_id,policy_id,version,content_hash,discovery_id,record,provenance) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[reference.sourceId,reference.id,reference.version,reference.hash,i.scope.discoveryId,canonicalContextJson({...body,reference}),canonicalContextJson(i.provenance)]));
  return reference;
 }
 /** Uses caller transaction. Full reference and exact scope required for every read. */
 async historical(db:ContextQueryClient,reference:EditorialSourceReference,scope:EditorialSourceScope,pin=false):Promise<PolicyCandidate|null>{
  const r=(await rows(db,`SELECT record,provenance FROM discovery_editorial_policy_versions WHERE source_id=$1 AND policy_id=$2 AND version=$3 AND content_hash=$4 ${pin?'FOR SHARE':''}`,[reference.sourceId,reference.id,reference.version,reference.hash]))[0];
  if(!r)return null;
  const {reference:ref,...body}=r.record as EditorialPolicyRecord;
  if(hashContextValue(ref)!==hashContextValue(reference)||editorialPolicyHash(body)!==reference.hash)fail('review_policy_integrity_invalid');
  if(hashContextValue(body.scope)!==hashContextValue(scope))fail('review_policy_scope_invalid');
  const events=(await rows(db,'SELECT revision,action,attributed_actor,reason,recorded_at FROM discovery_editorial_policy_events WHERE source_id=$1 AND policy_id=$2 AND version=$3 ORDER BY revision',[reference.sourceId,reference.id,reference.version])).map(e=>({revision:Number(e.revision),action:e.action,attributedActor:e.attributed_actor,reason:e.reason,recordedAt:new Date(e.recorded_at).toISOString()}));
  return {record:r.record,provenance:r.provenance,governance:events.at(-1)?.action??'registered',events};
 }
 async event(reference:EditorialSourceReference,scope:EditorialSourceScope,action:'content_validated'|'revoked',attributedActor:string,reason:string){
  if(!['content_validated','revoked'].includes(action)||typeof attributedActor!=='string'||!attributedActor.trim()||Buffer.byteLength(attributedActor)>160||typeof reason!=='string'||!reason.trim()||Buffer.byteLength(reason)>2000)fail('review_policy_governance_invalid');
  return this.transaction(async db=>{
   // Same parent row protocol enforced independently by SQL event trigger.
   await db.query('SELECT version FROM discovery_editorial_policy_versions WHERE source_id=$1 AND policy_id=$2 AND version=$3 FOR UPDATE',[reference.sourceId,reference.id,reference.version]);
   const candidate=await this.historical(db,reference,scope);
   if(!candidate)fail('review_policy_not_found');
   if(candidate.governance==='revoked'||candidate.governance===action)fail('review_policy_governance_conflict');
   if(action==='content_validated')validateDiscoveryReviewPolicy(candidate.record.policy);
   await db.query('INSERT INTO discovery_editorial_policy_events(source_id,policy_id,version,revision,action,attributed_actor,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[reference.sourceId,reference.id,reference.version,candidate.events.length+1,action,attributedActor,reason]);
  });
 }
 /** C3 policy-side boundary only: no active candidate exists in this stage. */
 async current(_db:ContextQueryClient,_scope:EditorialSourceScope):Promise<EditorialPolicyRecord|null>{return null}
 async pinCandidate(db:ContextQueryClient,reference:EditorialSourceReference,scope:EditorialSourceScope){
  const candidate=await this.historical(db,reference,scope,true);
  if(!candidate||candidate.governance==='revoked')fail('review_policy_unavailable');return candidate;
 }
 async pinActive(db:ContextQueryClient,reference:EditorialSourceReference,scope:EditorialSourceScope):Promise<never>{
  await this.pinCandidate(db,reference,scope);return fail('review_policy_approval_authority_unavailable');
 }
 async approve():Promise<never>{return fail('review_policy_approval_authority_unavailable')}
 async activate():Promise<never>{return fail('review_policy_activation_authority_unavailable')}
}
