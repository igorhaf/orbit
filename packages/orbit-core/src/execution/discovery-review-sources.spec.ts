import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EditorialConditionsResolver,editorialPolicyHash,editorialEvidenceHash,editorialApprovalStillApplicable,type EditorialSourceAuthority,type EditorialConditions} from './discovery-review-sources';
const scope={runtimeId:'dev',projectId:randomUUID(),discoveryId:randomUUID(),queue:'card_runs' as const};
const now=Date.parse('2026-11-17T12:00:00.000Z');
const policy={schemaVersion:1 as const,minimumReviewRevision:1,requiredEvidenceCompatibility:['compatible' as const],allowIneligibleApproval:false};
const db={query:async()=>{throw Error('no SQL expected in source contract tests')}};
function fixture(){
 const p={schemaVersion:1 as const,scope,status:'active' as const,validFrom:'2026-11-17T11:00:00.000Z',validUntil:'2026-11-17T13:00:00.000Z',policy};
 const e={schemaVersion:1 as const,scope,presence:'present' as const,compatibility:'compatible' as const,verifiedAt:'2026-11-17T11:59:00.000Z',validUntil:'2026-11-17T13:00:00.000Z'};
 let value:EditorialConditions={policy:{...p,reference:{sourceId:'policy-authority',id:'approval',version:'1',hash:editorialPolicyHash(p)}},evidence:{...e,reference:{sourceId:'evidence-authority',id:'assessment',version:'1',hash:editorialEvidenceHash(e)}}};
 const authority:EditorialSourceAuthority={consistency:'postgresql_transaction',policySourceIds:['policy-authority'],evidenceSourceIds:['evidence-authority'],resolve:async()=>value,historical:async(_db,_ref,kind)=>kind==='policy'?value.policy:value.evidence,pinCurrent:async()=>{}};
 const rehash=()=>{if(value.policy){const {reference,...body}=value.policy;reference.hash=editorialPolicyHash(body)}if(value.evidence){const {reference,...body}=value.evidence;reference.hash=editorialEvidenceHash(body)}};
 return {value,authority,rehash,resolve:()=>new EditorialConditionsResolver(authority,()=>now).resolve(db,scope)};
}
test('C3 absent policy has explicit unavailable error',async()=>{const f=fixture();f.value.policy=null;await assert.rejects(f.resolve(),{code:'review_policy_unavailable'})});
test('C3 source outside trusted host allowlist is refused',async()=>{const f=fixture();f.value.policy!.reference.sourceId='client-assertion';await assert.rejects(f.resolve(),{code:'review_policy_source_untrusted'})});
test('C3 valid policy is versioned, pinned and historically recoverable',async()=>{const f=fixture();let pins=0;f.authority.pinCurrent=async()=>{pins++};const r=await f.resolve();assert.equal(r.policy.editorialProvenance.policy.reference.version,'1');assert.equal(r.evidenceCompatibility,'compatible');assert.equal(pins,2)});
test('C3 version change invalidates eligibility without changing historical receipt',async()=>{const f=fixture(),old=(await f.resolve()).policy,before=structuredClone(old);f.value.policy!.reference.version='2';const current=(await f.resolve()).policy;assert.equal(editorialApprovalStillApplicable(old,current,1),false);assert.deepEqual(old,before)});
test('C3 revoked and unavailable policy fail closed',async()=>{for(const status of ['revoked','unavailable'] as const){const f=fixture();f.value.policy!.status=status;f.rehash();await assert.rejects(f.resolve(),{code:'review_policy_unavailable'})}});
for(const compatibility of ['unassessed','partially_compatible','incompatible','compatible','unavailable'] as const)test('C3 preserves evidence assessment '+compatibility,async()=>{const f=fixture();f.value.evidence!.compatibility=compatibility;f.rehash();assert.equal((await f.resolve()).evidenceCompatibility,compatibility)});
test('C3 missing evidence differs from unavailable and unknown evidence',async()=>{const f=fixture();f.value.evidence!.presence='missing';f.value.evidence!.compatibility='unavailable';f.rehash();const r=await f.resolve();assert.equal(r.policy.editorialProvenance.evidence.presence,'missing');assert.equal(r.evidenceCompatibility,'unavailable');f.value.evidence!.presence='unknown';f.value.evidence!.compatibility='unassessed';f.rehash();assert.equal((await f.resolve()).evidenceCompatibility,'unassessed')});
test('C3 later evidence change removes approval applicability',async()=>{const f=fixture(),old=(await f.resolve()).policy;f.value.evidence!.compatibility='incompatible';f.value.evidence!.reference.version='2';f.rehash();assert.equal(editorialApprovalStillApplicable(old,(await f.resolve()).policy,1),false)});
test('C3 legacy approval and insufficient revision cannot inherit current source approval',async()=>{const f=fixture(),r=await f.resolve();assert.equal(editorialApprovalStillApplicable(policy,r.policy,2),false);assert.equal(editorialApprovalStillApplicable(r.policy,r.policy,0),false);assert.equal(editorialApprovalStillApplicable(r.policy,r.policy,1),true);assert.equal(Object.hasOwn(r,'published'),false)});
test('C3 obsolete assessment is refused',async()=>{const f=fixture();f.value.evidence!.validUntil='2026-11-17T11:59:59.000Z';f.rehash();await assert.rejects(f.resolve(),{code:'review_evidence_stale'})});
test('C3 policy hash, evidence hash and historical retrieval are checked',async()=>{const f=fixture();f.value.policy!.policy={...policy,minimumReviewRevision:5};await assert.rejects(f.resolve(),{code:'review_policy_integrity_invalid'});f.rehash();f.value.evidence!.compatibility='incompatible';await assert.rejects(f.resolve(),{code:'review_evidence_integrity_invalid'});f.rehash();f.authority.historical=async()=>null;await assert.rejects(f.resolve(),{code:'review_source_history_unavailable'})});
test('C3 stale resolution is revalidated before transaction can complete',async()=>{const f=fixture(),r=await f.resolve();f.authority.pinCurrent=async()=>{throw Error('version revoked')};await assert.rejects(r.revalidate(),/version revoked/)});
test('C3 external consistency is never promoted to PostgreSQL atomicity',async()=>{const f=fixture();(f.authority as any).consistency='external';await assert.rejects(f.resolve(),{code:'review_source_consistency_unavailable'})});

test('C3 absent assessment, stale policy and untrusted evidence remain unavailable',async()=>{
 const f=fixture();f.value.evidence=null;await assert.rejects(f.resolve(),{code:'review_evidence_unavailable'});
 const stale=fixture();stale.value.policy!.validUntil='2026-11-17T11:59:59.000Z';stale.rehash();await assert.rejects(stale.resolve(),{code:'review_policy_stale'});
 const foreign=fixture();foreign.value.evidence!.reference.sourceId='unknown-authority';await assert.rejects(foreign.resolve(),{code:'review_evidence_source_untrusted'});
});
