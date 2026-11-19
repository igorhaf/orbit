import {hashContextValue} from './context-manifest';
import {type StoredDiscovery} from './discovery-journal-repository';

export const discoveryReviewStates=['proposed','in_review','needs_information','approved','rejected','approval_withdrawn'] as const;
export type DiscoveryReviewState=typeof discoveryReviewStates[number];
export type DiscoveryEvidenceCompatibility='unassessed'|'compatible'|'partially_compatible'|'incompatible'|'unavailable';
export type DiscoveryPublicationEligibility='ineligible'|'eligible';
export type DiscoveryReviewAction='start_review'|'request_information'|'approve'|'reject'|'withdraw_approval';
export type DiscoveryReviewDecision={schemaVersion:1;decisionId:string;discoveryId:string;expectedReviewRevision:number;action:DiscoveryReviewAction;reviewerId:string;idempotencyKey:string;reason:string;informationRequest:string|null;recordedAt:string;cas:{expectedRevision:number;nextRevision:number};requestHash:string};
export type DiscoveryReviewSnapshot={schemaVersion:1;discoveryId:string;reviewRevision:number;state:DiscoveryReviewState;evidenceCompatibility:DiscoveryEvidenceCompatibility;publicationEligibility:DiscoveryPublicationEligibility;lastDecisionHash:string|null;requestedInformation:string|null;stateChangedAt:string};
export type DiscoveryReviewPolicy={schemaVersion:1;minimumReviewRevision:number;requiredEvidenceCompatibility:readonly DiscoveryEvidenceCompatibility[];allowIneligibleApproval:boolean};
export type DiscoveryReviewCommand={action:DiscoveryReviewAction;expectedReviewRevision:number;reviewerId:string;idempotencyKey:string;reason:string;recordedAt:string;informationRequest?:string};
export type DiscoveryReviewErrorCode='review_schema_invalid'|'review_conflict'|'review_idempotency_conflict'|'review_transition_invalid'|'review_reason_required'|'review_information_required'|'review_evidence_incompatible'|'review_policy_not_satisfied'|'review_proposal_invalid';
export class DiscoveryReviewError extends Error{constructor(readonly code:DiscoveryReviewErrorCode){super(code);this.name='DiscoveryReviewError'}}
const fail=(code:DiscoveryReviewErrorCode):never=>{throw new DiscoveryReviewError(code)};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha=/^[0-9a-f]{64}$/;
const timestamp=(v:string)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function assertCommand(c:DiscoveryReviewCommand){
 if(!c||!['start_review','request_information','approve','reject','withdraw_approval'].includes(c.action)||!Number.isSafeInteger(c.expectedReviewRevision)||c.expectedReviewRevision<0||typeof c.reviewerId!=='string'||!c.reviewerId.trim()||Buffer.byteLength(c.reviewerId)>160||typeof c.idempotencyKey!=='string'||c.idempotencyKey.length<8||c.idempotencyKey.length>160||typeof c.reason!=='string'||Buffer.byteLength(c.reason)>2000||!timestamp(c.recordedAt)||(c.informationRequest!==undefined&&(typeof c.informationRequest!=='string'||Buffer.byteLength(c.informationRequest)>2000)))fail('review_schema_invalid');
 if(!c.reason.trim())fail('review_reason_required');
 if(c.action==='request_information'&&!c.informationRequest?.trim())fail('review_information_required');
}
export function initialDiscoveryReview(discovery:Pick<StoredDiscovery,'id'|'state'|'evidence'>,evidenceCompatibility:DiscoveryEvidenceCompatibility='unassessed'):DiscoveryReviewSnapshot{
 if(!uuid.test(discovery.id)||discovery.state!=='proposed'||!Array.isArray(discovery.evidence))fail('review_proposal_invalid');
 return {schemaVersion:1,discoveryId:discovery.id,reviewRevision:0,state:'proposed',evidenceCompatibility,publicationEligibility:'ineligible',lastDecisionHash:null,requestedInformation:null,stateChangedAt:'1970-01-01T00:00:00.000Z'};
}
export function discoveryPublicationEligibility(snapshot:Pick<DiscoveryReviewSnapshot,'state'|'evidenceCompatibility'>,policy:DiscoveryReviewPolicy):DiscoveryPublicationEligibility{
 validateDiscoveryReviewPolicy(policy);
 return snapshot.state==='approved'&&policy.allowIneligibleApproval===false&&policy.requiredEvidenceCompatibility.includes(snapshot.evidenceCompatibility)&&snapshot.evidenceCompatibility==='compatible'?'eligible':'ineligible';
}
export function validateDiscoveryReviewPolicy(policy:DiscoveryReviewPolicy):void{
 if(!policy||policy.schemaVersion!==1||!Number.isSafeInteger(policy.minimumReviewRevision)||policy.minimumReviewRevision<1||!Array.isArray(policy.requiredEvidenceCompatibility)||policy.requiredEvidenceCompatibility.length===0||policy.requiredEvidenceCompatibility.some(x=>!['unassessed','compatible','partially_compatible','incompatible','unavailable'].includes(x))||typeof policy.allowIneligibleApproval!=='boolean')fail('review_schema_invalid');
}
export function decideDiscoveryReview(current:DiscoveryReviewSnapshot,command:DiscoveryReviewCommand,policy:DiscoveryReviewPolicy):{snapshot:DiscoveryReviewSnapshot;decision:DiscoveryReviewDecision;duplicate:boolean}{
 assertDiscoveryReviewSnapshot(current);assertCommand(command);validateDiscoveryReviewPolicy(policy);
 if(command.expectedReviewRevision!==current.reviewRevision)fail('review_conflict');
 const transition:Record<DiscoveryReviewAction,{from:readonly DiscoveryReviewState[];to:DiscoveryReviewState}>={
  start_review:{from:['proposed','needs_information'],to:'in_review'},
  request_information:{from:['in_review'],to:'needs_information'},
  approve:{from:['in_review'],to:'approved'},
  reject:{from:['in_review','needs_information'],to:'rejected'},
  withdraw_approval:{from:['approved'],to:'approval_withdrawn'},
 };
 const rule=transition[command.action];if(!rule.from.includes(current.state))fail('review_transition_invalid');
 if(command.action==='approve'&&current.reviewRevision<policy.minimumReviewRevision)fail('review_policy_not_satisfied');
 if(command.action==='approve'&&(!policy.requiredEvidenceCompatibility.includes(current.evidenceCompatibility)||current.evidenceCompatibility!=='compatible'))fail('review_evidence_incompatible');
 const nextRevision=current.reviewRevision+1;
 const requestHash=hashContextValue({discoveryId:current.discoveryId,expectedReviewRevision:command.expectedReviewRevision,action:command.action,reviewerId:command.reviewerId,idempotencyKey:command.idempotencyKey,reason:command.reason,recordedAt:command.recordedAt,informationRequest:command.informationRequest??null});
 const decision:DiscoveryReviewDecision={schemaVersion:1,decisionId:hashContextValue({discoveryId:current.discoveryId,idempotencyKey:command.idempotencyKey}),discoveryId:current.discoveryId,expectedReviewRevision:current.reviewRevision,action:command.action,reviewerId:command.reviewerId,idempotencyKey:command.idempotencyKey,reason:command.reason.trim(),informationRequest:command.informationRequest?.trim()||null,recordedAt:command.recordedAt,cas:{expectedRevision:current.reviewRevision,nextRevision},requestHash};
 const snapshot:DiscoveryReviewSnapshot={...current,reviewRevision:nextRevision,state:rule.to,requestedInformation:command.action==='request_information'?command.informationRequest!.trim():null,lastDecisionHash:requestHash,stateChangedAt:command.recordedAt,publicationEligibility:'ineligible'};
 snapshot.publicationEligibility=discoveryPublicationEligibility(snapshot,policy);
 return {snapshot,decision,duplicate:false};
}
export function resolveDiscoveryReviewRetry(current:DiscoveryReviewSnapshot,command:DiscoveryReviewCommand,previous:DiscoveryReviewDecision|null,policy:DiscoveryReviewPolicy):{snapshot:DiscoveryReviewSnapshot;decision:DiscoveryReviewDecision;duplicate:boolean}{
 assertDiscoveryReviewSnapshot(current);assertCommand(command);validateDiscoveryReviewPolicy(policy);
 if(previous&&previous.idempotencyKey===command.idempotencyKey){const requestHash=hashContextValue({discoveryId:current.discoveryId,expectedReviewRevision:command.expectedReviewRevision,action:command.action,reviewerId:command.reviewerId,idempotencyKey:command.idempotencyKey,reason:command.reason,recordedAt:command.recordedAt,informationRequest:command.informationRequest??null});if(requestHash===previous.requestHash&&previous.discoveryId===current.discoveryId)return {snapshot:current,decision:previous,duplicate:true};fail('review_idempotency_conflict')}
 return decideDiscoveryReview(current,command,policy);
}
export function assertDiscoveryReviewSnapshot(snapshot:DiscoveryReviewSnapshot):void{
 if(!snapshot||snapshot.schemaVersion!==1||!uuid.test(snapshot.discoveryId)||!Number.isSafeInteger(snapshot.reviewRevision)||snapshot.reviewRevision<0||!discoveryReviewStates.includes(snapshot.state)||!['unassessed','compatible','partially_compatible','incompatible','unavailable'].includes(snapshot.evidenceCompatibility)||!['eligible','ineligible'].includes(snapshot.publicationEligibility)||!(snapshot.lastDecisionHash===null||sha.test(snapshot.lastDecisionHash))||!(snapshot.requestedInformation===null||typeof snapshot.requestedInformation==='string'&&Buffer.byteLength(snapshot.requestedInformation)<=2000)||!timestamp(snapshot.stateChangedAt))fail('review_schema_invalid');
}
