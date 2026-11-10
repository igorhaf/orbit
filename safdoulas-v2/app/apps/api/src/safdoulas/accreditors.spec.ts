import assert from "node:assert/strict";
import test from "node:test";
import { PluginRegistry } from "../execution/registries";
import { genericPlugins } from "../plugins/records/catalog";
import { workspacesPlugin } from "../workspaces/workspaces.plugin";
import { safdoulasGovernancePlugin } from "./governance.plugin";
import { safdoulasRegistryPlugin } from "./registry.plugin";
import { accreditorProfileIssues, authorizeAccreditorApplicationCreate, authorizeAccreditorApplicationRecord, eligibleAccreditorProfile, safdoulasAccreditorsPlugin } from "./accreditors.plugin";

const userId = "00000000-0000-4000-8000-000000000001";
const providerId = "00000000-0000-4000-8000-000000000002";
const courseId = "00000000-0000-4000-8000-000000000003";
const process = { pluginId: "safdoulas-processes", kind: "accreditation_process", payload: { provider_record_id: providerId, course_record_id: courseId, course_revision: 1 } };

function profile(overrides: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    profile_status: "active",
    training_completed_at: "2026-01-01T00:00:00Z", training_attestation_reference: "Declaração de alinhamento integral",
    credential_number: "ACC-2026-001",
    valid_from: "2020-01-01T00:00:00.000Z",
    valid_until: "2030-01-01T00:00:00.000Z",
    ethics_term_record_id: "00000000-0000-4000-8000-000000000004",
    ethics_term_revision: 1,
    ethics_accepted_at: "2026-01-01T00:00:00.000Z",
    conflict_declaration_valid_until: "2030-01-01T00:00:00.000Z",
    affiliations: [],
    ...overrides,
  };
}

test("accreditor administration is a leaf over Orbit records, forms, terms, documents and SafDoulas governance", () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(safdoulasGovernancePlugin);
  registry.register(safdoulasRegistryPlugin);
  registry.register(safdoulasAccreditorsPlugin);
  assert.equal(registry.isEnabled("safdoulas-accreditors"), true);
  registry.setEnabled("terms", false);
  assert.equal(registry.isEnabled("safdoulas-accreditors"), false);
});

test("active accreditation requires current credential, published ethics acceptance and current conflict declaration", () => {
  assert.deepEqual(accreditorProfileIssues(profile()), []);
  assert.deepEqual(accreditorProfileIssues(profile({ ethics_term_record_id: null, ethics_term_revision: null, ethics_accepted_at: null }))
    .map((item) => item.code), ["ethics_acceptance_required"]);
  assert.equal(accreditorProfileIssues(profile({ valid_until: "2020-01-01T00:00:00.000Z" })).some((item) => item.code === "credential_expired"), true);
  assert.equal(accreditorProfileIssues(profile({ conflict_declaration_valid_until: null })).some((item) => item.code === "current_conflict_declaration_required"), true);
});

test("assignment eligibility blocks expired records and declared active ties to the evaluated provider or course", async () => {
  const acceptedTerm = {
    hasAcceptedTerm: async () => true,
    resolveRecord: async (id: string, revision: number) => id === courseId && revision === 1
      ? { id: courseId, pluginId: "safdoulas-registry", kind: "course", state: "active", revision: 1, payload: {} }
      : null,
  } as never;
  assert.equal(await eligibleAccreditorProfile(profile(), userId, process, acceptedTerm), true);
  assert.equal(await eligibleAccreditorProfile(profile(), userId, process), false);
  assert.equal(await eligibleAccreditorProfile(profile({ valid_until: "2020-01-01T00:00:00.000Z" }), userId, process, acceptedTerm), false);
  assert.equal(await eligibleAccreditorProfile(profile({ user_id: "00000000-0000-4000-8000-000000000099" }), userId, process, acceptedTerm), false);
  assert.equal(await eligibleAccreditorProfile(profile({ affiliations: [{
    provider_record_id: providerId, course_record_id: null, conflict_type: "teaching", description: "Vínculo vigente.",
    active_from: "2020-01-01", active_until: null,
  }] }), userId, process, acceptedTerm), false);
});

test("assignment eligibility checks versioned course staff and offering participants against declared personal conflicts", async () => {
  const evaluatorId = "00000000-0000-4000-8000-000000000020";
  const courseMemberId = "00000000-0000-4000-8000-000000000021";
  const memberUserId = "00000000-0000-4000-8000-000000000022";
  const participantUserId = "00000000-0000-4000-8000-000000000023";
  const course = { id: courseId, pluginId: "safdoulas-registry", kind: "course", state: "active", revision: 3, payload: {
    team_member_refs: [{ record_id: courseMemberId, revision: 2 }],
  } };
  const member = { id: courseMemberId, pluginId: "safdoulas-registry", kind: "course_team_member", state: "active", revision: 2, payload: {
    course_record_id: courseId, user_id: memberUserId, full_name: "Coordenadora Pedagógica",
  } };
  const offering = { id: "00000000-0000-4000-8000-000000000025", pluginId: "safdoulas-registry", kind: "course_offering", state: "active", revision: 4, payload: {
    course_record_id: courseId, participant_refs: [{ user_id: participantUserId, full_name: "Pessoa Participante" }],
  } };
  const records = new Map<string, { id: string; pluginId: string; kind: string; state: string; revision: number; payload: Record<string, unknown> }>([
    [`${courseId}:3`, course], [`${courseMemberId}:2`, member], [`${offering.id}:4`, offering],
  ]);
  const context = {
    hasAcceptedTerm: async () => true,
    resolveRecord: async (id: string, revision: number) => records.get(`${id}:${revision}`) || null,
  } as never;
  const pinnedProcess = { pluginId: "safdoulas-processes", kind: "accreditation_process", payload: {
    provider_record_id: providerId, course_record_id: courseId, course_revision: 3,
    offering_record_id: offering.id, offering_revision: 4,
  } };

  assert.equal(await eligibleAccreditorProfile(profile({ user_id: evaluatorId, affiliations: [{
    provider_record_id: null, course_record_id: null, person_user_id: memberUserId, person_name: null,
    conflict_type: "teaching", description: "Coordenação pedagógica do curso.", active_from: "2020-01-01", active_until: null,
  }] }), evaluatorId, pinnedProcess, context), false);
  assert.equal(await eligibleAccreditorProfile(profile({ user_id: evaluatorId, affiliations: [{
    provider_record_id: null, course_record_id: null, person_user_id: null, person_name: "pessoa participante",
    conflict_type: "other", description: "Relação declarada com participante.", active_from: "2020-01-01", active_until: null,
  }] }), evaluatorId, pinnedProcess, context), false);
  assert.equal(await eligibleAccreditorProfile(profile({ user_id: evaluatorId, affiliations: [{
    provider_record_id: null, course_record_id: null, person_user_id: participantUserId, person_name: null,
    conflict_type: "other", description: "Vínculo encerrado.", active_from: "2020-01-01", active_until: "2021-01-01",
  }] }), evaluatorId, pinnedProcess, context), true);
});

test("affiliations must reference a provider or course and have a consistent date range", () => {
  const invalid = accreditorProfileIssues(profile({ affiliations: [{
    provider_record_id: null, course_record_id: null, conflict_type: "other", description: "Vínculo.",
    active_from: "2026-01-01", active_until: "2025-01-01",
  }] }));
  assert.deepEqual(invalid.map((item) => item.code), ["affiliation_target_required", "invalid_affiliation_period"]);
});

test("candidates can create and edit only their own draft from their submitted form", async () => {
  const submission = { id: "00000000-0000-4000-8000-000000000010", pluginId: "forms", kind: "submission", state: "submitted", revision: 2, payload: {} };
  let owner = userId;
  const context = {
    actorId: userId,
    resolveRecord: async () => submission,
    isRecordOwner: async (_recordId: string, user: string) => owner === user,
  };
  const application = { user_id: userId, source_submission_record_id: submission.id, source_submission_revision: 2 };
  assert.equal(await authorizeAccreditorApplicationCreate(userId, application, context), true);
  assert.equal(await authorizeAccreditorApplicationCreate("00000000-0000-4000-8000-000000000099", application, context), false);
  owner = "00000000-0000-4000-8000-000000000099";
  assert.equal(await authorizeAccreditorApplicationCreate(userId, application, context), false);
  assert.equal(authorizeAccreditorApplicationRecord(userId, "read", "submitted", application), true);
  assert.equal(authorizeAccreditorApplicationRecord(userId, "write", "draft", application), true);
  assert.equal(authorizeAccreditorApplicationRecord(userId, "publish", "draft", application), true);
  assert.equal(authorizeAccreditorApplicationRecord(userId, "write", "submitted", application), false);
  assert.equal(authorizeAccreditorApplicationRecord("00000000-0000-4000-8000-000000000099", "read", "draft", application), false);
});

test("candidate applications pin an owned submitted form and owned document evidence", async () => {
  const sourceId = "00000000-0000-4000-8000-000000000011";
  const documentId = "00000000-0000-4000-8000-000000000012";
  const source = { id: sourceId, pluginId: "forms", kind: "submission", state: "submitted", revision: 3, payload: {} };
  const document = { id: documentId, pluginId: "documents", kind: "document", state: "received", revision: 2, payload: {} };
  let owns = true;
  const context = {
    actorId: userId,
    resolveRecord: async (id: string) => id === sourceId ? source : id === documentId ? document : null,
    isRecordOwner: async () => owns,
    hasPermission: async () => false,
    hasGlobalPermission: async () => false,
  };
  const application = safdoulasAccreditorsPlugin.contributions?.recordKinds?.application;
  const payload = {
    user_id: userId, source_submission_record_id: sourceId, source_submission_revision: 3,
    evidence_refs: [{ record_id: documentId, revision: 2, purpose: "Documento de formação" }],
  };
  assert.deepEqual(await application?.validate?.(payload, context), []);
  owns = false;
  assert.deepEqual((await application?.validate?.(payload, context))?.map((item) => item.code), ["candidate_submission_not_owned", "accreditor_evidence_not_owned"]);
});
