import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {decideDiscoveryReview,discoveryPublicationEligibility,initialDiscoveryReview,resolveDiscoveryReviewRetry,type DiscoveryReviewCommand,type DiscoveryReviewPolicy,type DiscoveryReviewSnapshot} from './discovery-review';

const policy:DiscoveryReviewPolicy={schemaVersion:1,minimumReviewRevision:1,requiredEvidenceCompatibility:['compatible'],allowIneligibleApproval:false};
const command=(action:DiscoveryReviewCommand['action'],revision:number,extra:Partial<DiscoveryReviewCommand>={}):DiscoveryReviewCommand=>({action,expectedReviewRevision:revision,reviewerId:randomUUID(),idempotencyKey:'idem-key-'+randomUUID(),reason:'Editorial assessment recorded.',recordedAt:'2026-11-16T12:00:00.000Z',...(action==='request_information'?{informationRequest:'Please provide a source.'}:{}),...extra});
const initial=():DiscoveryReviewSnapshot=>initialDiscoveryReview({id:randomUUID(),state:'proposed',evidence:[]},'compatible');
const advance=(s:DiscoveryReviewSnapshot,a:DiscoveryReviewCommand['action'],extra:Partial<DiscoveryReviewCommand>={})=>decideDiscoveryReview(s,command(a,s.reviewRevision,extra),policy);

test('07D-A starts proposed and advances review revision monotonically for every editorial transition',()=>{
 let s=initial();assert.equal(s.reviewRevision,0);assert.equal(s.publicationEligibility,'ineligible');
 for(const [action,state] of [['start_review','in_review'],['request_information','needs_information'],['start_review','in_review'],['approve','approved'],['withdraw_approval','approval_withdrawn']] as const){const result=advance(s,action);s=result.snapshot;assert.equal(s.state,state);assert.equal(s.reviewRevision,result.decision.cas.nextRevision);assert.equal(result.decision.cas.expectedRevision,s.reviewRevision-1);assert.equal(result.decision.reviewerId.length>0,true);}
 assert.equal(s.reviewRevision,5);
});
test('07D-A rejects invalid transitions and stale CAS without changing input snapshot',()=>{
 const s=initial(),before=structuredClone(s);assert.throws(()=>advance(s,'approve'),{code:'review_transition_invalid'});assert.throws(()=>decideDiscoveryReview(s,command('start_review',1),policy),{code:'review_conflict'});assert.deepEqual(s,before);
});
test('07D-A requires reason and information request, both bounded and timestamp canonical',()=>{
 const s=advance(initial(),'start_review').snapshot;
 assert.throws(()=>decideDiscoveryReview(s,command('approve',1,{reason:'   '}),policy),{code:'review_reason_required'});
 assert.throws(()=>decideDiscoveryReview(s,command('request_information',1,{informationRequest:' '}),policy),{code:'review_information_required'});
 assert.throws(()=>decideDiscoveryReview(s,command('reject',1,{recordedAt:'yesterday'}),policy),{code:'review_schema_invalid'});
 assert.throws(()=>decideDiscoveryReview(s,command('reject',1,{reason:'x'.repeat(2001)}),policy),{code:'review_schema_invalid'});
});
test('07D-A approval requires compatible evidence; editorial state and evidence compatibility stay separate',()=>{
 const s={...initial(),state:'in_review' as const,evidenceCompatibility:'partially_compatible' as const,reviewRevision:1};
 assert.throws(()=>decideDiscoveryReview(s,command('approve',1),policy),{code:'review_evidence_incompatible'});
 const withdrawn={...s,state:'approved' as const,evidenceCompatibility:'incompatible' as const,publicationEligibility:'ineligible' as const};
 assert.equal(discoveryPublicationEligibility(withdrawn,policy),'ineligible');
});
test('07D-A records requested information in the decision payload',()=>{
 const s=advance(initial(),'start_review').snapshot;
 const result=decideDiscoveryReview(s,command('request_information',1,{informationRequest:'Attach the source.'}),policy);
 assert.equal(result.decision.informationRequest,'Attach the source.');
 assert.equal(result.snapshot.requestedInformation,'Attach the source.');
});

test('07D-A eligibility is derived and approval never publishes',()=>{
 const s=advance({...initial(),state:'in_review',reviewRevision:1},'approve').snapshot;
 assert.equal(s.state,'approved');assert.equal(s.publicationEligibility,'eligible');assert.equal(Object.hasOwn(s,'published'),false);
 assert.equal(discoveryPublicationEligibility({...s,evidenceCompatibility:'unavailable'},policy),'ineligible');
});
test('07D-A minimum review revision is evaluated before approval',()=>{
 const stricter={...policy,minimumReviewRevision:2};
 const s={...initial(),state:'in_review' as const,reviewRevision:1};
 assert.throws(()=>decideDiscoveryReview(s,command('approve',1),stricter),{code:'review_policy_not_satisfied'});
 const later={...s,reviewRevision:2};
 assert.equal(decideDiscoveryReview(later,command('approve',2),stricter).snapshot.state,'approved');
});

test('07D-A retry is idempotent only for the same key and canonical command',()=>{
 const s=initial(),c=command('start_review',0),first=decideDiscoveryReview(s,c,policy);
 assert.equal(resolveDiscoveryReviewRetry(first.snapshot,c,first.decision,policy).duplicate,true);
 assert.throws(()=>resolveDiscoveryReviewRetry(first.snapshot,{...c,reason:'Different request'},first.decision,policy),{code:'review_idempotency_conflict'});
 assert.throws(()=>decideDiscoveryReview(first.snapshot,c,policy),{code:'review_conflict'});
});
test('07D-A reviewer identifier is attribution metadata, not authorization or a credential',()=>{
 const s=initial(),c=command('start_review',0,{reviewerId:'not-an-auth-token'});
 assert.equal(decideDiscoveryReview(s,c,policy).decision.reviewerId,'not-an-auth-token');
});
