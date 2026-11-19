import {EditorialSourceError,type ResolvedEditorialConditions} from './discovery-review-sources';
import {type ContextQueryClient} from './context-manifest';
import {DiscoveryReviewRepository,DiscoveryReviewStoreError,type DiscoveryReviewPool,type DiscoveryReviewOrigin,type DiscoveryReviewEvidenceResolver,type DiscoveryReviewTransactionGuard} from './discovery-review-repository';
import {type DiscoveryReviewPolicy,type DiscoveryReviewCommand,DiscoveryReviewError} from './discovery-review';

export class DiscoveryReviewApplicationError extends DiscoveryReviewStoreError{
 constructor(code:string,readonly status:number){super(code)}
}
/** Internal integration port, not an authentication mechanism or a production adapter.
 * Only the trusted host can construct it; never deserialize from an HTTP body.
 * Session must preserve actual actor vs effective subject and reject simulation.
 * authorize must revalidate session and resource ACL under transaction locks,
 * and audit successful access in that transaction. No adapter is enabled in 07D-C. */
export type DiscoveryReviewHost<Context>={
 session:(context:Context)=>Promise<{actorId:string;subjectId:string;simulated:boolean}|null>;
 authorize:(principal:{actorId:string;subjectId:string;readKind?:'current'|'history'},...args:Parameters<DiscoveryReviewTransactionGuard>)=>Promise<void>;
 /** A synchronous assertion for mutable scope providers in this process.
  * This supplements SQL locks. It does not attest another process or pin providers during COMMIT. */
 assertLocalScopeBeforeCommit?:()=>undefined;
 policy:()=>Promise<DiscoveryReviewPolicy|null>;
 evidence?:DiscoveryReviewEvidenceResolver;
 conditions?:(db:ContextQueryClient,origin:DiscoveryReviewOrigin)=>Promise<ResolvedEditorialConditions>;
};
const invalid=()=>{throw new DiscoveryReviewApplicationError('review_request_invalid',400)};
export function discoveryReviewHttpError(error:unknown):{status:number;code:string}{
 if(error instanceof EditorialSourceError)return {status:503,code:error.code};
 if(error instanceof DiscoveryReviewApplicationError)return {status:error.status,code:error.code};
 if(error instanceof DiscoveryReviewError)return {status:['review_conflict','review_idempotency_conflict'].includes(error.code)?409:400,code:error.code};
 if(error instanceof DiscoveryReviewStoreError&&['review_conflict','review_idempotency_conflict'].includes(error.code))return {status:409,code:error.code};
 return {status:503,code:'review_unavailable'};
}
/** Safe internal application facade. Not registered as controller/service in runtimes.
 * Production cannot create an enabled facade until it supplies the host contract. */
export class DiscoveryReviewApplication<Context>{
 constructor(private readonly pool:DiscoveryReviewPool,private readonly host?:DiscoveryReviewHost<Context>){}
 private async bound(context:Context,readKind:'current'|'history'='current'){
  if(!this.host)throw new DiscoveryReviewApplicationError('review_host_unavailable',503);
  const host=this.host,principal=await host.session(context);
  if(!principal)throw new DiscoveryReviewApplicationError('review_unauthenticated',401);
  if(principal.simulated||principal.actorId!==principal.subjectId)throw new DiscoveryReviewApplicationError('review_forbidden',403);
  const guard:DiscoveryReviewTransactionGuard=async(db,origin,operation,command)=>{
   await host.authorize({...principal,readKind},db,origin,operation,command);
   // Independently enforce proposer/approver separation using the immutable capture.
   if(command?.action==='approve'){
    const result=await db.query('SELECT c.actor_id FROM discovery_journal_entries e JOIN discovery_journal_captures c ON c.id=e.capture_id WHERE e.id=$1 AND c.queue=$2',[origin.discoveryId,origin.queue]);
    const rows=Array.isArray(result)?result:result.rows;
    if(!rows.length||rows[0].actor_id===principal.actorId)throw new DiscoveryReviewApplicationError('review_separation_required',403);
   }
  };
  return {host,principal,repository:new DiscoveryReviewRepository(this.pool,host.evidence,guard,host.conditions,host.assertLocalScopeBeforeCommit?.bind(host))};
 }
 private origin(value:DiscoveryReviewOrigin){
  if(!value||Object.keys(value).some(k=>!['discoveryId','queue'].includes(k))||typeof value.discoveryId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.discoveryId)||!['card_runs','card_ai_runs'].includes(value.queue))invalid();
  return {...value,discoveryId:value.discoveryId.toLowerCase()};
 }
 async history(context:Context,origin:DiscoveryReviewOrigin){const bound=await this.bound(context,'history');return bound.repository.history(this.origin(origin))}
 async current(context:Context,origin:DiscoveryReviewOrigin){
  const {host,repository}=await this.bound(context),policy=host.conditions?null:await host.policy();
  if(!policy&&!host.conditions)throw new DiscoveryReviewApplicationError('review_policy_unavailable',503);
  return repository.current(this.origin(origin),policy);
 }
 async decide(context:Context,origin:DiscoveryReviewOrigin,body:unknown){
  const {host,principal,repository}=await this.bound(context);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['action','expectedReviewRevision','idempotencyKey','reason','recordedAt','informationRequest'].includes(k)))invalid();
  const policy=host.conditions?null:await host.policy();
  if(!host.conditions&&(!policy||!host.evidence))throw new DiscoveryReviewApplicationError('review_conditions_unavailable',503);
  return repository.record(this.origin(origin),{...body,reviewerId:principal.actorId} as DiscoveryReviewCommand,policy);
 }
}
