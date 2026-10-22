import assert from "node:assert/strict";
import test from "node:test";
import type { RecordValidationContext } from "../plugins/contract";
import {
  accreditationProcessTransitions,
  authorizeAccreditationProcessTransition,
  formatProtocolNumber,
  prepareAccreditationProcessTransition,
  safdoulasProcessesPlugin,
} from "./processes.plugin";

const payload = {
  ruleset_record_id: "00000000-0000-4000-8000-000000000001",
  ruleset_revision: 1,
  blinding_policy_record_id: "00000000-0000-4000-8000-000000000007",
  blinding_policy_revision: 1,
};
const consolidationId = "00000000-0000-4000-8000-000000000010";
const submissionId = "00000000-0000-4000-8000-000000000011";
const formId = "00000000-0000-4000-8000-000000000012";
const correctionReviewId = "00000000-0000-4000-8000-000000000013";
const preliminaryResponseId = "00000000-0000-4000-8000-000000000014";

test("submitted process snapshots pin the exact rules, course, application, policy and source documents", () => {
  const frozen = safdoulasProcessesPlugin.contributions?.recordKinds?.accreditation_process.immutablePayloadFieldsAfterInitial || [];
  for (const field of ["ruleset_record_id", "ruleset_revision", "course_record_id", "course_revision", "application_submission_record_id", "application_submission_revision", "document_snapshots"])
    assert.equal(frozen.includes(field), true, field);
});

function context(permissions: string[], includeTriage = false): RecordValidationContext {
  return {
    recordId: "00000000-0000-4000-8000-000000000009",
    resolveRecord: async (id) => {
      if (id === payload.ruleset_record_id) return {
        id: payload.ruleset_record_id, pluginId: "safdoulas-governance", kind: "accreditation_ruleset", state: "active", revision: 1,
        payload: { state_transitions: [
          { from: "draft", to: "submitted", required_role: "applicant" },
          { from: "draft", to: "triage", required_role: "screener" },
          { from: "triage", to: "review", required_role: "secretariat" },
          { from: "review", to: "deliberation", required_role: "secretariat" },
        ] },
      };
      if (id === payload.blinding_policy_record_id) return {
        id, pluginId: "safdoulas-governance", kind: "blinding_policy", state: "active", revision: 1, payload: {},
      };
      if (id === submissionId) return {
        id, pluginId: "forms", kind: "submission", state: "submitted", revision: 2,
        payload: { form_id: formId, form_revision: 4, answers: { provider: "Instituição demonstrativa" } },
      };
      if (id === formId) return {
        id, pluginId: "forms", kind: "form", state: "published", revision: 4,
        payload: { schema: { type: "object" } },
      };
      if (includeTriage && id === "00000000-0000-4000-8000-000000000008") return {
        id,
        pluginId: "safdoulas-triage",
        kind: "admissibility_review",
        state: "completed",
        revision: 1,
        payload: { process_record_id: "00000000-0000-4000-8000-000000000009", recommendation: "admissible" },
      };
      if (id === consolidationId) return {
        id, pluginId: "safdoulas-assessments", kind: "evaluation_consolidation", state: "completed", revision: 1,
        payload: { process_record_id: "00000000-0000-4000-8000-000000000009" },
      };
      return null;
    },
    hasPermission: async (permission) => permissions.includes(permission),
  };
}

test("process transitions are limited to configured roles", async () => {
  assert.deepEqual(
    await accreditationProcessTransitions("draft", payload, context(["plugin.safdoulas-processes.transition.screener"])),
    ["triage"],
  );
});

test("submitted processes cannot return to draft and unlock their frozen snapshots", async () => {
  const actor = context(["plugin.safdoulas-processes.transition.applicant"]);
  const resolve = actor.resolveRecord;
  actor.resolveRecord = async (id, revision) => {
    if (id === payload.ruleset_record_id) return {
      id, pluginId: "safdoulas-governance", kind: "accreditation_ruleset", state: "active", revision: 1,
      payload: { state_transitions: [{ from: "submitted", to: "draft", required_role: "applicant" }] },
    };
    return resolve(id, revision);
  };
  assert.deepEqual(await accreditationProcessTransitions("submitted", payload, actor), []);
  assert.equal(await authorizeAccreditationProcessTransition("submitted", "draft", payload, actor), false);
});

test("transition authorization rechecks the role and exact edge", async () => {
  const actor = context(["plugin.safdoulas-processes.transition.applicant"]);
  assert.equal(await authorizeAccreditationProcessTransition("draft", "submitted", payload, actor), true);
  assert.equal(await authorizeAccreditationProcessTransition("draft", "triage", payload, actor), false);
  assert.equal(await authorizeAccreditationProcessTransition("draft", "decision", payload, actor), false);
});

test("protocol numbers use the pinned configurable pattern and global sequence", async () => {
  assert.equal(formatProtocolNumber("SAF-{year}/{sequence:4}", 2026, "27"), "SAF-2026/0027");
  assert.throws(() => formatProtocolNumber("SAF-{year}/{sequence}/{sequence}", 2026, "27"));
  let sequenceCalls = 0;
  const rulesContext: RecordValidationContext = {
    ...context([]),
    resolveRecord: async (id, revision) => {
      if (id === payload.ruleset_record_id) return {
        id, pluginId: "safdoulas-governance", kind: "accreditation_ruleset", state: "active", revision: 1,
        payload: { protocol_pattern: "SAF-{year}/{sequence:4}" },
      };
      return context([]).resolveRecord(id, revision);
    },
    nextSequence: async () => { sequenceCalls += 1; return "27"; },
  };
  const submissionPayload = { ...payload, application_submission_record_id: submissionId, application_submission_revision: 2 };
  const generated = await prepareAccreditationProcessTransition("draft", "submitted", submissionPayload, rulesContext);
  assert.match(String(generated.protocol_number), /^SAF-\d{4}\/0027$/);
  assert.equal(sequenceCalls, 1);
  await assert.rejects(() => prepareAccreditationProcessTransition("draft", "submitted", payload, rulesContext), /Vincule uma submissão/);
  assert.equal(sequenceCalls, 1, "invalid applications must not consume protocol numbers");
  const missingForm = { ...rulesContext, resolveRecord: async (id: string, revision: number) => id === formId ? null : rulesContext.resolveRecord(id, revision) };
  await assert.rejects(() => prepareAccreditationProcessTransition("draft", "submitted", submissionPayload, missingForm), /versão publicada do formulário/);
  assert.equal(sequenceCalls, 1, "an unpublished or unavailable form must not consume protocol numbers");
  assert.equal(await prepareAccreditationProcessTransition("draft", "triage", payload, rulesContext), payload);
});

test("process cannot advance from triage to review without a completed admissibility report", async () => {
  const reportId = "00000000-0000-4000-8000-000000000008";
  const actor = context(["plugin.safdoulas-processes.transition.secretariat"]);
  assert.deepEqual(await accreditationProcessTransitions("triage", payload, actor), []);
  const reviewedPayload = { ...payload, triage_review_record_id: reportId, triage_review_revision: 1 };
  assert.deepEqual(await accreditationProcessTransitions("triage", reviewedPayload, context(["plugin.safdoulas-processes.transition.secretariat"], true)), ["review"]);
});

test("preliminary correction requires a correction triage and a submitted response before returning to triage", async () => {
  const processId = "00000000-0000-4000-8000-000000000009";
  const correctionContext: RecordValidationContext = {
    ...context(["plugin.safdoulas-processes.transition.secretariat", "plugin.safdoulas-processes.transition.institution_representative"], true),
    resolveRecord: async (id, revision) => {
      if (id === payload.ruleset_record_id) return {
        id, pluginId: "safdoulas-governance", kind: "accreditation_ruleset", state: "active", revision: 1,
        payload: { state_transitions: [
          { from: "triage", to: "review", required_role: "secretariat" },
          { from: "triage", to: "diligence", required_role: "secretariat" },
          { from: "diligence", to: "triage", required_role: "institution_representative" },
        ] },
      };
      if (id === correctionReviewId) return {
        id, pluginId: "safdoulas-triage", kind: "admissibility_review", state: "completed", revision: 1,
        payload: { process_record_id: processId, recommendation: "correction_required" },
      };
      if (id === preliminaryResponseId) return {
        id, pluginId: "safdoulas-diligences", kind: "diligence_response", state: "submitted", revision: 1,
        payload: { diligence_record_id: "00000000-0000-4000-8000-000000000015", diligence_revision: 1 },
      };
      if (id === "00000000-0000-4000-8000-000000000015") return {
        id, pluginId: "safdoulas-diligences", kind: "diligence", state: "requested", revision: 1,
        payload: { stage: "preliminary_admissibility", process_record_id: processId },
      };
      return context(["plugin.safdoulas-processes.transition.secretariat", "plugin.safdoulas-processes.transition.institution_representative"], true).resolveRecord(id, revision);
    },
  };
  const correctionPayload = { ...payload, triage_review_record_id: correctionReviewId, triage_review_revision: 1 };
  assert.deepEqual(await accreditationProcessTransitions("triage", correctionPayload, correctionContext), ["diligence"]);
  assert.equal(await authorizeAccreditationProcessTransition("triage", "diligence", correctionPayload, correctionContext), true);
  assert.deepEqual(await accreditationProcessTransitions("diligence", correctionPayload, correctionContext), []);
  const responded = {
    ...correctionPayload,
    preliminary_diligence_response_record_id: preliminaryResponseId,
    preliminary_diligence_response_revision: 1,
  };
  assert.deepEqual(await accreditationProcessTransitions("diligence", responded, correctionContext), ["triage"]);
  assert.equal(await authorizeAccreditationProcessTransition("diligence", "triage", responded, correctionContext), true);
});

test("process cannot advance to deliberation without a completed linked evaluation consolidation", async () => {
  const actor = context(["plugin.safdoulas-processes.transition.secretariat"]);
  assert.deepEqual(await accreditationProcessTransitions("review", payload, actor), []);
  const withConsolidation = {
    ...payload,
    evaluation_consolidation_record_id: consolidationId,
    evaluation_consolidation_revision: 1,
  };
  assert.deepEqual(await accreditationProcessTransitions("review", withConsolidation, actor), ["deliberation"]);
  assert.equal(await authorizeAccreditationProcessTransition("review", "deliberation", withConsolidation, actor), true);
});
