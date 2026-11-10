import assert from "node:assert/strict";
import test from "node:test";
import type { RecordValidationContext, ResolvedRecordReference } from "../plugins/contract";
import {
  appealDecisionIssues,
  appealIssues,
  authorizeAppealCreate,
  institutionalDecisionIssues,
  voteIssues,
} from "./decisions.plugin";

const processId = "00000000-0000-4000-8000-000000000001";
const rulesId = "00000000-0000-4000-8000-000000000002";
const policyId = "00000000-0000-4000-8000-000000000003";
const consolidationId = "00000000-0000-4000-8000-000000000004";
const decisionId = "00000000-0000-4000-8000-000000000005";
const appealId = "00000000-0000-4000-8000-000000000006";
const appealDecisionId = "00000000-0000-4000-8000-000000000007";
const userOne = "00000000-0000-4000-8000-000000000008";
const userTwo = "00000000-0000-4000-8000-000000000009";
const voteOneId = "00000000-0000-4000-8000-000000000010";
const voteTwoId = "00000000-0000-4000-8000-000000000011";
const appealVoteOneId = "00000000-0000-4000-8000-000000000012";
const appealVoteTwoId = "00000000-0000-4000-8000-000000000013";
const noticeId = "00000000-0000-4000-8000-000000000014";

function makeContext(overrides: {
  state?: string;
  actorId?: string;
  rolePermissions?: string[];
  records?: ResolvedRecordReference[];
  recordId?: string;
} = {}): RecordValidationContext {
  const process: ResolvedRecordReference = {
    id: processId, pluginId: "safdoulas-processes", kind: "accreditation_process", state: overrides.state || "deliberation", revision: 5,
    payload: { ruleset_record_id: rulesId, ruleset_revision: 1 },
  };
  const rules: ResolvedRecordReference = {
    id: rulesId, pluginId: "safdoulas-governance", kind: "accreditation_ruleset", state: "active", revision: 1,
    payload: { decision_policy_record_id: policyId, decision_policy_revision: 1 },
  };
  const policy: ResolvedRecordReference = {
    id: policyId, pluginId: "safdoulas-governance", kind: "decision_policy", state: "active", revision: 1,
    payload: {
      eligible_roles: ["deliberator"], minimum_voters: 2, minimum_appeal_reviewers: 2,
      allowed_outcomes: ["approved", "approved_with_conditions", "further_diligence", "denied"],
      support_thresholds: [
        { outcome: "approved", minimum_percent: 50 }, { outcome: "approved_with_conditions", minimum_percent: 50 },
        { outcome: "further_diligence", minimum_percent: 50 }, { outcome: "denied", minimum_percent: 50 },
      ],
      appeals_enabled: true, appealable_outcomes: ["approved", "approved_with_conditions", "denied"], appeal_period_days: 30,
      appeal_review_roles: ["appeal_reviewer"], appeal_support_thresholds: [
        { outcome: "maintained", minimum_percent: 50 }, { outcome: "modified", minimum_percent: 50 }, { outcome: "reversed", minimum_percent: 50 },
      ],
    },
  };
  const consolidation: ResolvedRecordReference = {
    id: consolidationId, pluginId: "safdoulas-assessments", kind: "evaluation_consolidation", state: "completed", revision: 1,
    payload: { process_record_id: processId },
  };
  const decision: ResolvedRecordReference = {
    id: decisionId, pluginId: "safdoulas-decisions", kind: "institutional_decision", state: ["decision", "appeal"].includes(overrides.state || "") ? "ratified" : "draft", revision: 1,
    payload: {
      process_record_id: processId, process_revision: 5, decision_policy_record_id: policyId, decision_policy_revision: 1,
      outcome: "approved", appeal_deadline_at: "2030-01-01T00:00:00.000Z",
    },
  };
  const appeal: ResolvedRecordReference = {
    id: appealId, pluginId: "safdoulas-decisions", kind: "appeal", state: "under_review", revision: 2,
    payload: { process_record_id: processId, decision_record_id: decisionId, decision_revision: 1 },
  };
  const appealDecision: ResolvedRecordReference = {
    id: appealDecisionId, pluginId: "safdoulas-decisions", kind: "appeal_decision", state: "draft", revision: 1,
    payload: { process_record_id: processId, process_revision: 5, appeal_record_id: appealId, appeal_revision: 2 },
  };
  const votes: ResolvedRecordReference[] = [
    { id: voteOneId, pluginId: "safdoulas-decisions", kind: "deliberation_vote", state: "submitted", revision: 1, payload: { decision_record_id: decisionId, process_record_id: processId, voter_user_id: userOne, position: "approve", rationale: "Voto um." } },
    { id: voteTwoId, pluginId: "safdoulas-decisions", kind: "deliberation_vote", state: "submitted", revision: 1, payload: { decision_record_id: decisionId, process_record_id: processId, voter_user_id: userTwo, position: "approve", rationale: "Voto dois." } },
  ];
  const notice: ResolvedRecordReference = { id: noticeId, pluginId: "safdoulas-diligences", kind: "case_communication", state: "delivered", revision: 1,
    payload: { process_record_id: processId, decision_record_id: decisionId, decision_revision: 1, recipient_user_ids: [userOne], delivered_at: new Date(Date.now() - 86400000).toISOString() } };
  const all = [process, rules, policy, consolidation, decision, appeal, appealDecision, notice, ...votes, ...(overrides.records || [])];
  const roles = overrides.rolePermissions || [];
  return {
    actorId: overrides.actorId || userOne,
    recordId: overrides.recordId,
    resolveRecord: async (id, revision) => all.find((record) => record.id === id && record.revision === revision) || null,
    hasPermissionOnResource: async (permission, target) => target === processId && roles.includes(permission),
  };
}

test("decision drafts may be created before votes, but ratification requires independent submitted votes and configured quorum", async () => {
  const payload = {
    process_record_id: processId, process_revision: 5,
    evaluation_consolidation_record_id: consolidationId, evaluation_consolidation_revision: 1,
    decision_policy_record_id: policyId, decision_policy_revision: 1,
    outcome: "approved", grounds: "Fundamento vinculado aos pareceres.", conditions_or_requests: "", denial_basis: "",
    vote_refs: [], evidence_refs: [], decided_at: null, appeal_deadline_at: null, signatory_user_ids: [userOne], signature_document_ref: { record_id: null, revision: null },
  };
  assert.deepEqual(await institutionalDecisionIssues(payload, makeContext()), []);
  assert.equal((await institutionalDecisionIssues({ ...payload, vote_refs: [{ record_id: voteOneId, revision: 1 }] }, makeContext({ recordId: decisionId }))).some((item) => item.code === "decision_quorum_missing"), true);
  assert.deepEqual(await institutionalDecisionIssues({ ...payload, vote_refs: [{ record_id: voteOneId, revision: 1 }, { record_id: voteTwoId, revision: 1 }] }, makeContext({ recordId: decisionId })), []);
});

test("each deliberation vote is submitted by its authorized voter for a draft decision in the same process", async () => {
  const payload = {
    decision_record_id: decisionId, decision_revision: 1, process_record_id: processId,
    voter_user_id: userOne, position: "approve", rationale: "Fundamento individual.", voted_at: null,
  };
  const authorized = makeContext({ actorId: userOne, rolePermissions: ["plugin.safdoulas-processes.transition.deliberator"] });
  assert.deepEqual(await voteIssues(payload, authorized, "deliberation_vote"), []);
  const unauthorized = makeContext({ actorId: userOne });
  assert.equal((await voteIssues(payload, unauthorized, "deliberation_vote"))[0].code, "voter_role_required");
});

test("appeals require the appellant's process scope and an unexpired policy window", async () => {
  const payload = {
    process_record_id: processId, process_revision: 5, decision_record_id: decisionId, decision_revision: 1,
    appellant_user_id: userOne, notice_record_id: noticeId, notice_revision: 1, protocol_number: "SAF-REC-1", grounds: "Fundamento do recurso.", evidence_refs: [],
    appeal_decision_record_id: null, appeal_decision_revision: null, submitted_at: "2026-10-20T12:00:00.000Z",
  };
  const authorized = makeContext({ state: "decision", actorId: userOne, rolePermissions: ["plugin.safdoulas-processes.transition.applicant"] });
  assert.equal(await authorizeAppealCreate(userOne, payload, authorized), true);
  assert.deepEqual(await appealIssues(payload, authorized), []);
  assert.equal(await authorizeAppealCreate(userTwo, payload, authorized), false);
  assert.equal((await appealIssues(payload, makeContext({ state: "decision", actorId: userOne })))[0].code, "appeal_applicant_scope_required");
});

test("appeal decisions use pinned appeal policy and separate submitted reviewer votes", async () => {
  const votes: ResolvedRecordReference[] = [
    { id: appealVoteOneId, pluginId: "safdoulas-decisions", kind: "appeal_review_vote", state: "submitted", revision: 1, payload: { appeal_decision_record_id: appealDecisionId, process_record_id: processId, voter_user_id: userOne, position: "maintain", rationale: "Voto um." } },
    { id: appealVoteTwoId, pluginId: "safdoulas-decisions", kind: "appeal_review_vote", state: "submitted", revision: 1, payload: { appeal_decision_record_id: appealDecisionId, process_record_id: processId, voter_user_id: userTwo, position: "maintain", rationale: "Voto dois." } },
  ];
  const payload = {
    process_record_id: processId, process_revision: 5, appeal_record_id: appealId, appeal_revision: 2,
    outcome: "maintained", vote_refs: [{ record_id: appealVoteOneId, revision: 1 }, { record_id: appealVoteTwoId, revision: 1 }],
    reasoning: "Resposta fundamentada ao recurso.", evidence_refs: [], decided_at: null, signatory_user_ids: [userOne],
  };
  const context = makeContext({ state: "appeal", recordId: appealDecisionId, records: votes });
  assert.deepEqual(await appealDecisionIssues(payload, context), []);
  assert.equal((await appealDecisionIssues({ ...payload, vote_refs: [] }, context)).some((item) => item.code === "appeal_review_quorum_missing"), true);
});
