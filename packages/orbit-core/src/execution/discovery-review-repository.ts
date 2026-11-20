import {EditorialSourceError,editorialApprovalStillApplicable,type ResolvedEditorialConditions} from './discovery-review-sources';
import {canonicalContextJson,contextQueryRows,type ContextQueryResultClient,type ContextQueryRow} from './context-manifest';
import {DiscoveryReviewError,initialDiscoveryReview,resolveDiscoveryReviewRetry,discoveryPublicationEligibility,type DiscoveryReviewCommand,type DiscoveryReviewDecision,type DiscoveryReviewSnapshot,type DiscoveryReviewPolicy,type DiscoveryEvidenceCompatibility} from './discovery-review';

export type DiscoveryReviewConnection=ContextQueryResultClient&{release:()=>void};
export type DiscoveryReviewPool={connect:()=>Promise<DiscoveryReviewConnection>};
export type DiscoveryReviewOrigin={discoveryId:string;queue:'card_runs'|'card_ai_runs'};
/** Host-supplied assessment only. Historical Journal evidence is not a positive assessment.
 * This callback and all repository methods confer no authentication/authorization. */
export type DiscoveryReviewEvidenceResolver=(origin:DiscoveryReviewOrigin,db:ContextQueryResultClient)=>Promise<DiscoveryEvidenceCompatibility>;
/** Must lock/version-check the actual authorization records through this transaction.
 * A preflight-only callback does not satisfy this contract. Errors must be safe store errors. */
export type DiscoveryReviewTransactionGuard=(db:ContextQueryResultClient,origin:DiscoveryReviewOrigin,operation:'read'|'decide',command?:DiscoveryReviewCommand)=>Promise<void>;
export type PersistedDiscoveryReview={decision:DiscoveryReviewDecision;state:DiscoveryReviewSnapshot['state'];evidenceCompatibility:DiscoveryEvidenceCompatibility;policy:DiscoveryReviewPolicy};
const rows=async(db:ContextQueryResultClient,sql:string,p:unknown[]=[]):Promise<ContextQueryRow[]>=>contextQueryRows(await db.query(sql,p));
export class DiscoveryReviewStoreError extends Error{constructor(readonly code:string){super(code);this.name='DiscoveryReviewStoreError'}}
/** Uses a dedicated connection, never BEGIN/COMMIT through a multiplexed query client. */
export class DiscoveryReviewRepository{
 constructor(private readonly pool:DiscoveryReviewPool,private readonly resolveEvidence?:DiscoveryReviewEvidenceResolver,private readonly authorize?:DiscoveryReviewTransactionGuard,private readonly conditions?:(db:ContextQueryResultClient,origin:DiscoveryReviewOrigin)=>Promise<ResolvedEditorialConditions>,private readonly assertLocalScopeBeforeCommit?:()=>undefined){}
 private async transaction<T>(fn:(db:ContextQueryResultClient)=>Promise<T>):Promise<T>{
  const db=await this.pool.connect();
  try{
   await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
   const result=await fn(db);
   // Do not await between the local provider assertion and dispatching COMMIT.
   this.assertLocalScopeBeforeCommit?.();
   await db.query('COMMIT');
   return result;
  }
  catch(e){await db.query('ROLLBACK');if(e instanceof DiscoveryReviewError||e instanceof DiscoveryReviewStoreError||e instanceof EditorialSourceError)throw e;const code=(e as {code?:string}).code;throw new DiscoveryReviewStoreError(code==='PDR01'?'review_conflict':code==='23505'?'review_idempotency_conflict':'review_persistence_failed')}
  finally{db.release()}
 }
 private async lock(db:ContextQueryResultClient,origin:DiscoveryReviewOrigin){
  if(!/^[0-9a-f-]{36}$/i.test(origin.discoveryId)||!['card_runs','card_ai_runs'].includes(origin.queue))throw new DiscoveryReviewStoreError('review_origin_invalid');
  // Same lock protocol as the SQL insert guard; serialize before any history read.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('discovery-review:'||$1,0))",[origin.discoveryId.toLowerCase()]);
  const found=await rows(db,'SELECT e.id FROM discovery_journal_entries e JOIN discovery_journal_captures c ON c.id=e.capture_id WHERE e.id=$1 AND c.queue=$2',[origin.discoveryId,origin.queue]);
  if(!found.length)throw new DiscoveryReviewStoreError('review_discovery_not_found');
 }
 private async historyIn(db:ContextQueryResultClient,origin:DiscoveryReviewOrigin):Promise<PersistedDiscoveryReview[]>{
  return (await rows(db,'SELECT decision,state,evidence_compatibility,policy FROM discovery_review_decisions WHERE discovery_id=$1 AND queue=$2 ORDER BY review_revision',[origin.discoveryId,origin.queue])).map(r=>({decision:r.decision,state:r.state,evidenceCompatibility:r.evidence_compatibility,policy:r.policy}));
 }
 private async snapshot(db:ContextQueryResultClient,origin:DiscoveryReviewOrigin,history:PersistedDiscoveryReview[],policy:DiscoveryReviewPolicy,resolution?:ResolvedEditorialConditions):Promise<DiscoveryReviewSnapshot>{
  const evidenceCompatibility=resolution?resolution.evidenceCompatibility:this.resolveEvidence?await this.resolveEvidence(origin,db):'unassessed';
  const initial=initialDiscoveryReview({id:origin.discoveryId,state:'proposed',evidence:[]},evidenceCompatibility),last=history.at(-1);
  const snapshot:DiscoveryReviewSnapshot=last?{...initial,state:last.state,reviewRevision:last.decision.cas.nextRevision,lastDecisionHash:last.decision.requestHash,stateChangedAt:last.decision.recordedAt,requestedInformation:last.state==='needs_information'?last.decision.informationRequest:null}:initial;
  snapshot.publicationEligibility=discoveryPublicationEligibility(snapshot,policy);
  if(resolution&&last&&!editorialApprovalStillApplicable(last.policy,resolution.policy,last.decision.expectedReviewRevision))snapshot.publicationEligibility='ineligible';
  return snapshot;
 }
 async record(origin:DiscoveryReviewOrigin,command:DiscoveryReviewCommand,policy:DiscoveryReviewPolicy|null){
  // Detach caller-owned inputs before awaiting locks/resolvers.
  const [o,c,p]=JSON.parse(canonicalContextJson([origin,command,policy])) as [DiscoveryReviewOrigin,DiscoveryReviewCommand,DiscoveryReviewPolicy|null];
  return this.transaction(async db=>{
   o.discoveryId=o.discoveryId.toLowerCase();
   await this.lock(db,o);await this.authorize?.(db,o,'decide',c);
   const resolution=await this.conditions?.(db,o),effectivePolicy=resolution?.policy??p;
   if(!effectivePolicy)throw new EditorialSourceError('review_policy_unavailable');
   const history=await this.historyIn(db,o);
   const snapshot=await this.snapshot(db,o,history,effectivePolicy,resolution);
   const previous=history.find(r=>r.decision.idempotencyKey===c.idempotencyKey)?.decision??null;
   const result=resolveDiscoveryReviewRetry(snapshot,c,previous,effectivePolicy);
   await this.authorize?.(db,o,'decide',c);
   await resolution?.revalidate();
   if(!result.duplicate)await db.query('INSERT INTO discovery_review_decisions(discovery_id,queue,review_revision,expected_revision,state,action,idempotency_key,request_hash,command,decision,evidence_compatibility,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12::jsonb)',[o.discoveryId,o.queue,result.snapshot.reviewRevision,c.expectedReviewRevision,result.snapshot.state,c.action,c.idempotencyKey,result.decision.requestHash,canonicalContextJson({...c,informationRequest:c.informationRequest??null}),canonicalContextJson(result.decision),snapshot.evidenceCompatibility,canonicalContextJson(effectivePolicy)]);
   await resolution?.revalidate();
   return result;
  });
 }
 async current(origin:DiscoveryReviewOrigin,policy:DiscoveryReviewPolicy|null){return this.transaction(async db=>{
  await this.lock(db,origin);await this.authorize?.(db,origin,'read');
  const resolution=await this.conditions?.(db,origin),effectivePolicy=resolution?.policy??policy;
  if(!effectivePolicy)throw new EditorialSourceError('review_policy_unavailable');
  const snapshot=await this.snapshot(db,origin,await this.historyIn(db,origin),effectivePolicy,resolution);
  await resolution?.revalidate();return snapshot;
 })}
 async history(origin:DiscoveryReviewOrigin){return this.transaction(async db=>{await this.lock(db,origin);await this.authorize?.(db,origin,'read');return this.historyIn(db,origin)})}
}
