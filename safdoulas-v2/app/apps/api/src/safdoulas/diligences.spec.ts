import assert from "node:assert/strict";
import test from "node:test";
import type { RecordValidationContext, ResolvedRecordReference } from "../plugins/contract";
import { authorizeDiligence, authorizeResponse, authorizeResponseCreate, communicationIssues, communicationTransitions, diligenceDeadlineEffects, diligenceIssues, diligenceResponseIssues, prepareCommunicationTransition, SafdoulasCommunicationController, safdoulasDiligencesPlugin } from "./diligences.plugin";

const processId = "00000000-0000-4000-8000-000000000001";
const diligenceId = "00000000-0000-4000-8000-000000000002";
const respondentId = "00000000-0000-4000-8000-000000000003";
const rulesId = "00000000-0000-4000-8000-000000000004";
const documentId = "00000000-0000-4000-8000-000000000005";
const triageReviewId = "00000000-0000-4000-8000-000000000006";
const deadlineId = "00000000-0000-4000-8000-000000000008";

const process: ResolvedRecordReference = {
  id: processId, pluginId: "safdoulas-processes", kind: "accreditation_process", state: "diligence", revision: 3,
  payload: { ruleset_record_id: rulesId, ruleset_revision: 1, triage_review_record_id: triageReviewId, triage_review_revision: 1 },
};
const rules: ResolvedRecordReference = {
  id: rulesId, pluginId: "safdoulas-governance", kind: "accreditation_ruleset", state: "active", revision: 1,
  payload: { state_transitions: [{ from: "triage", to: "diligence" }, { from: "review", to: "diligence" }] },
};
const triageReview: ResolvedRecordReference = {
  id: triageReviewId, pluginId: "safdoulas-triage", kind: "admissibility_review", state: "completed", revision: 1,
  payload: { process_record_id: processId, recommendation: "correction_required" },
};
const deadline: ResolvedRecordReference = {
  id: deadlineId, pluginId: "deadlines", kind: "clock", state: "running", revision: 1,
  payload: { target_type: "safdoulas_process", target_id: processId, due_at: "2030-01-01T00:00:00.000Z" },
};
const diligence: ResolvedRecordReference = {
  id: diligenceId, pluginId: "safdoulas-diligences", kind: "diligence", state: "requested", revision: 1,
  payload: {
    process_record_id: processId, process_revision: 3, respondent_user_id: respondentId,
    items: [{ code: "doc-1", required: true }, { code: "hours", required: false }],
  },
};
const evidence: ResolvedRecordReference = {
  id: documentId, pluginId: "documents", kind: "document", state: "published", revision: 2,
  payload: { source_id: processId, source_revision: 3 },
};

function context(actorId = respondentId): RecordValidationContext {
  const references = [process, rules, diligence, evidence, triageReview, deadline];
  return {
    actorId,
    resolveRecord: async (id, revision) => references.find((item) => item.id === id && item.revision === revision) || null,
    hasPermissionOnResource: async (permission, recordId) => permission === "plugin.safdoulas-processes.transition.institution_representative" && recordId === processId,
  };
}

test("diligences require a process in the configured diligence state, a due date and unique items", async () => {
  const payload = {
    process_record_id: processId, process_revision: 3, cycle: 1, requested_by_user_id: respondentId, respondent_user_id: respondentId,
    items: [{ code: "doc-1", request: "Enviar documento atualizado.", required: true, source_reference: "Edital vigente" }],
    due_at: "2030-01-01T00:00:00.000Z", pause_process_deadline: true, pause_reason: "Aguardando resposta.", communication_record_ids: [],
    deadline_record_id: deadlineId, deadline_record_revision: 1,
  };
  assert.deepEqual(await diligenceIssues(payload, context()), []);
  const errors = await diligenceIssues({ ...payload, items: [payload.items[0], payload.items[0]], due_at: "2020-01-01T00:00:00.000Z" }, context());
  assert.deepEqual(errors.map((item) => item.code), ["duplicate_diligence_item", "diligence_deadline_invalid"]);
});

test("preliminary admissibility diligence is tied to a completed correction triage", async () => {
  const payload = {
    stage: "preliminary_admissibility", process_record_id: processId, process_revision: 3, cycle: 1,
    requested_by_user_id: respondentId, respondent_user_id: respondentId,
    items: [{ code: "missing-policy", request: "Envie o documento obrigatório.", required: true, source_reference: "Edital vigente" }],
    due_at: "2030-01-01T00:00:00.000Z", pause_process_deadline: true, pause_reason: "Aguardando resposta.",
    deadline_record_id: deadlineId, deadline_record_revision: 1, communication_record_ids: [],
  };
  assert.deepEqual(await diligenceIssues(payload, context()), []);
  const invalidContext = { ...context(), resolveRecord: async (id: string, revision: number) => id === triageReviewId ? { ...triageReview, payload: { ...triageReview.payload, recommendation: "admissible" } } : context().resolveRecord(id, revision) };
  assert.equal((await diligenceIssues(payload, invalidContext))[0].code, "preliminary_correction_not_recommended");
});

test("diligence transitions request automatic pause and resume of the linked Orbit deadline", () => {
  const base = { pause_process_deadline: true, pause_reason: "Aguardando instituição.", deadline_record_id: deadlineId };
  assert.deepEqual(diligenceDeadlineEffects("draft", "requested", base), [{ recordId: deadlineId, event: "pause", reason: "Aguardando instituição." }]);
  assert.deepEqual(diligenceDeadlineEffects("requested", "response_received", base), [{ recordId: deadlineId, event: "resume", reason: "Prazo retomado após o recebimento da resposta institucional." }]);
  assert.deepEqual(diligenceDeadlineEffects("under_review", "follow_up_requested", base).map((item) => item.event), ["pause"]);
  assert.deepEqual(diligenceDeadlineEffects("under_review", "closed", base), []);
  assert.deepEqual(diligenceDeadlineEffects("draft", "requested", { ...base, pause_process_deadline: false }), []);
});

test("responses are limited to the designated respondent and must cover required items with same-process evidence", async () => {
  const base = {
    diligence_record_id: diligenceId, diligence_revision: 1, respondent_user_id: respondentId,
    item_responses: [{ item_code: "doc-1", response: "Documento atualizado." }],
    evidence_refs: [{ record_id: documentId, revision: 2 }], submitted_at: "2030-01-02T12:00:00.000Z",
  };
  assert.deepEqual(await diligenceResponseIssues(base, context()), []);
  const linkedEvidence = { ...evidence, payload: { related_record_id: processId, related_record_revision: 3 } };
  const linkedContext = { ...context(), resolveRecord: async (id: string, revision: number) => id === documentId ? linkedEvidence : context().resolveRecord(id, revision) };
  assert.deepEqual(await diligenceResponseIssues(base, linkedContext), []);

  const itemEvidence = { ...base, evidence_refs: [], item_responses: [{ item_code: "doc-1", response: "Documento enviado.", evidence_refs: [{ record_id: documentId, revision: 2 }] }] };
  assert.deepEqual(await diligenceResponseIssues(itemEvidence, context()), []);
  const unrelatedEvidence = { ...evidence, payload: { source_id: "00000000-0000-4000-8000-000000000099", source_revision: 3 } };
  const unrelatedContext = { ...context(), resolveRecord: async (id: string, revision: number) => id === documentId ? (revision === 2 ? unrelatedEvidence : null) : context().resolveRecord(id, revision) };
  assert.equal((await diligenceResponseIssues(itemEvidence, unrelatedContext))[0].code, "diligence_evidence_process_mismatch");
  assert.equal(await authorizeResponseCreate(respondentId, base, context()), true);
  assert.equal(await authorizeDiligence(respondentId, "read", "requested", diligence.payload, context()), true);
  const withoutProcessRole = { ...context(), hasPermissionOnResource: async () => false };
  assert.equal(await authorizeResponseCreate(respondentId, base, withoutProcessRole), false);
  assert.equal(await authorizeResponse(respondentId, "read", "draft", { ...base, respondent_user_id: respondentId }, withoutProcessRole), false);
  assert.equal(await authorizeDiligence(respondentId, "read", "requested", diligence.payload, withoutProcessRole), false);
  assert.equal((await diligenceResponseIssues({ ...base, item_responses: [{ item_code: "hours", response: "" }] }, context()))[0].code, "required_diligence_item_unanswered");
  assert.equal((await diligenceResponseIssues(base, context("00000000-0000-4000-8000-000000000099")))[0].code, "diligence_respondent_mismatch");
  assert.equal(await authorizeResponseCreate("00000000-0000-4000-8000-000000000099", base, context("00000000-0000-4000-8000-000000000099")), false);
  assert.equal(safdoulasDiligencesPlugin.dependencies?.includes("privacy"), true);
});

test("communication records bind sender, process and optional diligence", async () => {
  const payload = {
    process_record_id: processId, process_revision: 3, diligence_record_id: diligenceId, diligence_revision: 1,
    sender_user_id: respondentId, recipient_user_ids: [respondentId], channel: "portal", subject: "Complementação",
    body: "Consulte a diligência no portal.", sent_at: null, delivered_at: null, acknowledged_at: null,
    delivery_evidence_record_id: null, delivery_evidence_revision: null, acknowledgement_evidence_record_id: null, acknowledgement_evidence_revision: null,
    delivery_status: "draft", failure_reason: "", provider_reference: "",
  };
  assert.deepEqual(await communicationIssues(payload, context()), []);
  const unrelatedEvidence = { ...evidence, payload: { source_id: "00000000-0000-4000-8000-000000000099", source_revision: 3 } };
  const unrelatedContext = { ...context(), hasGlobalPermission: async () => true, resolveRecord: async (id: string, revision: number) => id === documentId ? unrelatedEvidence : context().resolveRecord(id, revision) };
  const unrelatedReceipt = await communicationIssues({ ...payload, delivery_status: "delivered", sent_at: "2030-01-01T00:00:00.000Z", delivered_at: "2030-01-02T00:00:00.000Z", delivery_evidence_record_id: documentId, delivery_evidence_revision: 2 }, unrelatedContext);
  assert.ok(unrelatedReceipt.some((item) => item.code === "unrelated_communication_delivery_evidence_required"));
  assert.equal((await communicationIssues({ ...payload, sender_user_id: "00000000-0000-4000-8000-000000000099" }, context()))[0].code, "communication_sender_mismatch");
  assert.deepEqual(await communicationIssues({ ...payload, delivery_status: "sent" }, context()).then((items) => items.map((item) => item.code)), ["communication_sent_at_required"]);
  assert.deepEqual(await communicationTransitions("sent", payload, { ...context(), hasGlobalPermission: async () => true }), ["failed"]);
  assert.deepEqual(await communicationTransitions("sent", { ...payload, delivery_evidence_record_id: documentId, delivery_evidence_revision: 2 }, { ...context(), hasGlobalPermission: async () => true }), ["delivered", "failed"]);
  const sendRoute = `/safdoulas/communications/${diligenceId}/send`;
  assert.equal(safdoulasDiligencesPlugin.handlesRoute?.(sendRoute), true);
  assert.equal(safdoulasDiligencesPlugin.routePermission?.(sendRoute, "POST"), "plugin.safdoulas-diligences.manage");
  assert.equal(safdoulasDiligencesPlugin.id, "safdoulas-diligences");
});

test("communication delivery and acknowledgement require published evidence and explicit timestamps", async () => {
  const draft = {
    process_record_id: processId, process_revision: 3, diligence_record_id: null, diligence_revision: null,
    sender_user_id: respondentId, recipient_user_ids: [respondentId], channel: "portal", subject: "Resultado",
    body: "Há uma atualização no processo.", sent_at: null, delivered_at: null, acknowledged_at: null,
    delivery_evidence_record_id: null, delivery_evidence_revision: null, acknowledgement_evidence_record_id: null, acknowledgement_evidence_revision: null,
    delivery_status: "draft", failure_reason: "", provider_reference: "",
  };
  const now = new Date("2030-01-02T12:00:00.000Z");
  const queued = prepareCommunicationTransition("draft", "queued", draft, now);
  assert.equal(queued.delivery_status, "queued");
  assert.equal(queued.sent_at, null);
  const sent = prepareCommunicationTransition("queued", "sent", queued, now);
  assert.equal(sent.sent_at, now.toISOString());
  assert.deepEqual(await communicationIssues(sent, context()), []);
  const delivered = prepareCommunicationTransition("sent", "delivered", {
    ...sent, delivered_at: "2030-01-03T12:00:00.000Z", delivery_evidence_record_id: documentId, delivery_evidence_revision: 2,
  }, new Date("2030-01-03T12:00:00.000Z"));
  assert.deepEqual(await communicationIssues(delivered, context()), []);
  const acknowledged = prepareCommunicationTransition("delivered", "acknowledged", {
    ...delivered, acknowledged_at: "2030-01-04T12:00:00.000Z", acknowledgement_evidence_record_id: documentId, acknowledgement_evidence_revision: 2,
  }, new Date("2030-01-04T12:00:00.000Z"));
  assert.deepEqual(await communicationIssues(acknowledged, context()), []);
  assert.equal((await communicationIssues(prepareCommunicationTransition("sent", "delivered", sent, now), context()))[0].code, "communication_delivered_at_required");
  assert.deepEqual((await communicationIssues({ ...draft, delivery_status: "failed" }, context())).map((item) => item.code), ["communication_failure_reason_required"]);
  assert.deepEqual((await communicationIssues({ ...sent, delivered_at: "2030-01-01T12:00:00.000Z", delivery_evidence_record_id: documentId, delivery_evidence_revision: 2, delivery_status: "delivered" }, context())).map((item) => item.code), ["communication_delivery_before_send"]);
});

test("email communication sends through SMTP and records accepted or failed delivery", async () => {
  const template: { id: string; title: string; kind: string; state: string; revision: number; payload: Record<string, unknown> } = {
    id: diligenceId, title: "Complementação documental", kind: "case_communication", state: "draft", revision: 1,
    payload: { channel: "email", recipient_user_ids: [respondentId], subject: "Complementação", body: "Envie os documentos solicitados." },
  };
  async function run(sendMessage: () => Promise<unknown>) {
    const states: string[] = [];
    const revisions: Array<{ reason: string; payload: Record<string, unknown> }> = [];
    let current = { ...template, payload: { ...template.payload } };
    const records = {
      detail: async () => current,
      transition: async (_plugin: string, _id: string, _actor: string, body: Record<string, unknown>) => {
        states.push(String(body.state));
        current = { ...current, state: String(body.state), revision: current.revision + 1,
          payload: { ...current.payload, delivery_status: body.state, sent_at: body.state === "sent" ? "2030-01-01T00:00:00.000Z" : current.payload.sent_at } };
        return current;
      },
      version: async (_plugin: string, _id: string, _actor: string, body: Record<string, unknown>) => {
        revisions.push({ reason: String(body.reason), payload: body.payload as Record<string, unknown> });
        current = { ...current, revision: current.revision + 1, payload: body.payload as typeof current.payload };
        return current;
      },
    };
    const controller = new SafdoulasCommunicationController(
      records as never,
      { isEnabled: () => true } as never,
      { query: async () => [{ id: respondentId, email: "representante@example.org" }] } as never,
      { require: async () => undefined } as never,
      { send: async () => undefined, sendMessage: async () => sendMessage() } as never,
    );
    const result = await controller.send({ orbitActor: respondentId } as never, diligenceId, {});
    return { result, states, current, revisions };
  }

  const success = await run(async () => ({ messageId: "smtp-accepted" }));
  assert.deepEqual(success.states, ["queued", "sent"]);
  assert.equal(success.current.payload.delivery_status, "sent");
  assert.equal(success.current.payload.provider_reference, "smtp-accepted");
  const failed = await run(async () => { throw new Error("SMTP indisponível"); });
  assert.deepEqual(failed.states, ["queued", "failed"]);
  assert.equal(failed.current.payload.delivery_status, "failed");
  assert.equal(failed.current.payload.failure_reason, "SMTP indisponível");
});
