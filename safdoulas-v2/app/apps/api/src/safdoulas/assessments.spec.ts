import assert from "node:assert/strict";
import test from "node:test";
import type { RecordValidationContext, ResolvedRecordReference } from "../plugins/contract";
import { genericPlugins } from "../plugins/records/catalog";
import { PluginRegistry } from "../execution/registries";
import { workspacesPlugin } from "../workspaces/workspaces.plugin";
import { safdoulasBlindingPlugin } from "./blinding.plugin";
import { safdoulasAccreditorsPlugin } from "./accreditors.plugin";
import { assignmentIssues, authorizeIndividualEvaluation, consolidationIssues, consolidationTransitions, divergentCriteria, evaluationIssues, rankEvaluatorPairs, SafdoulasAssessmentRecommendationController, safdoulasAssessmentsPlugin, thirdReviewAssignmentIssues } from "./assessments.plugin";
import { safdoulasGovernancePlugin } from "./governance.plugin";
import { safdoulasProcessesPlugin } from "./processes.plugin";
import { safdoulasRegistryPlugin } from "./registry.plugin";
import { safdoulasTriagePlugin } from "./triage.plugin";

const processId = "00000000-0000-4000-8000-000000000001";
const matrixId = "00000000-0000-4000-8000-000000000002";
const assignmentId = "00000000-0000-4000-8000-000000000003";
const firstId = "00000000-0000-4000-8000-000000000004";
const secondId = "00000000-0000-4000-8000-000000000005";
const thirdId = "00000000-0000-4000-8000-000000000006";
const thirdConsolidationId = "00000000-0000-4000-8000-000000000013";
const projectionId = "00000000-0000-4000-8000-000000000007";
const reviewerOne = "00000000-0000-4000-8000-000000000008";
const reviewerTwo = "00000000-0000-4000-8000-000000000009";
const reviewerThree = "00000000-0000-4000-8000-000000000010";
const applicationOneId = "00000000-0000-4000-8000-000000000014";
const applicationTwoId = "00000000-0000-4000-8000-000000000015";
const profileOneId = "00000000-0000-4000-8000-000000000016";
const profileTwoId = "00000000-0000-4000-8000-000000000017";
const ethicsTermId = "00000000-0000-4000-8000-000000000018";
const blindedDocumentId = "00000000-0000-4000-8000-000000000012";
const processCourseId = "00000000-0000-4000-8000-000000000020";

const matrix: ResolvedRecordReference = {
  id: matrixId, pluginId: "assessments", kind: "matrix", state: "published", revision: 1,
  payload: { dimensions: [{ code: "formation", criteria: [
    { code: "coordination", evidence_required: true, justification_required: true },
    { code: "accessibility", evidence_required: false, justification_required: false },
  ] }] },
};
const process: ResolvedRecordReference = {
  id: processId, pluginId: "safdoulas-processes", kind: "accreditation_process", state: "review", revision: 3,
  payload: { ruleset_record_id: "00000000-0000-4000-8000-000000000011", ruleset_revision: 1, provider_record_id: "00000000-0000-4000-8000-000000000019", course_record_id: processCourseId, course_revision: 1 },
};
const processCourse: ResolvedRecordReference = {
  id: processCourseId, pluginId: "safdoulas-registry", kind: "course", state: "active", revision: 1, payload: { team_member_refs: [] },
};
const ruleset: ResolvedRecordReference = {
  id: "00000000-0000-4000-8000-000000000011", pluginId: "safdoulas-governance", kind: "accreditation_ruleset", state: "active", revision: 1,
  payload: { matrix_record_id: matrixId, matrix_revision: 1 },
};
const assignment: ResolvedRecordReference = {
  id: assignmentId, pluginId: "safdoulas-assessments", kind: "evaluation_assignment", state: "assigned", revision: 1,
  payload: {
    process_record_id: processId, process_revision: 3, matrix_record_id: matrixId, matrix_revision: 1,
    evaluator_user_ids: [reviewerOne, reviewerTwo],
    evaluator_profile_refs: [
      { user_id: reviewerOne, record_id: profileOneId, revision: 1 },
      { user_id: reviewerTwo, record_id: profileTwoId, revision: 1 },
    ],
    blinded_projection_refs: [{ record_id: projectionId, revision: 1 }],
  },
};
const applications = [reviewerOne, reviewerTwo].map((userId, index): ResolvedRecordReference => ({
  id: index === 0 ? applicationOneId : applicationTwoId, pluginId: "safdoulas-accreditors", kind: "application", state: "approved", revision: 1,
  payload: { user_id: userId },
}));
const profiles = [reviewerOne, reviewerTwo].map((userId, index): ResolvedRecordReference => ({
  id: index === 0 ? profileOneId : profileTwoId, pluginId: "safdoulas-accreditors", kind: "profile", state: "active", revision: 1,
  payload: {
    user_id: userId, profile_status: "active", application_record_id: applications[index].id, application_revision: 1,
    credential_number: "ACC-" + String(index + 1), valid_from: "2020-01-01T00:00:00.000Z", valid_until: "2030-01-01T00:00:00.000Z",
    max_parallel_assignments: 3,
    training_completed_at: "2026-01-01T00:00:00Z", training_attestation_reference: "Declaração de alinhamento integral",
    ethics_term_record_id: ethicsTermId, ethics_term_revision: 1, ethics_accepted_at: "2026-01-01T00:00:00.000Z",
    conflict_declaration_valid_until: "2030-01-01T00:00:00.000Z", affiliations: [],
  },
}));
const ethicsTerm: ResolvedRecordReference = {
  id: ethicsTermId, pluginId: "terms", kind: "term", state: "published", revision: 1, payload: {},
};
const projection: ResolvedRecordReference = {
  id: projectionId, pluginId: "safdoulas-blinding", kind: "blinded_projection", state: "verified", revision: 1,
  payload: { process_record_id: processId, blinded_document_record_id: blindedDocumentId, blinded_document_revision: 1 },
};
const blindedDocument: ResolvedRecordReference = {
  id: blindedDocumentId, pluginId: "documents", kind: "document", state: "published", revision: 1,
  payload: { variant: "anonymized" },
};
const first: ResolvedRecordReference = {
  id: firstId, pluginId: "safdoulas-assessments", kind: "individual_evaluation", state: "submitted", revision: 1,
  payload: { process_record_id: processId, process_revision: 3, assignment_record_id: assignmentId, assignment_revision: 1, matrix_record_id: matrixId, matrix_revision: 1, evaluator_user_id: reviewerOne, answers: [
    { criterion_code: "coordination", outcome: "A", evidence: [{ record_id: "00000000-0000-4000-8000-000000000012", revision: 1 }] },
    { criterion_code: "accessibility", outcome: "AP", evidence: [] },
  ] },
};
const second: ResolvedRecordReference = {
  id: secondId, pluginId: "safdoulas-assessments", kind: "individual_evaluation", state: "submitted", revision: 1,
  payload: { ...first.payload, evaluator_user_id: reviewerTwo, answers: [
    { criterion_code: "coordination", outcome: "A", evidence: [{ record_id: "00000000-0000-4000-8000-000000000012", revision: 1 }] },
    { criterion_code: "accessibility", outcome: "NA", justification: "Não há evidência suficiente.", evidence: [] },
  ] },
};
const thirdConsolidation: ResolvedRecordReference = {
  id: thirdConsolidationId, pluginId: "safdoulas-assessments", kind: "evaluation_consolidation", state: "draft", revision: 1,
  payload: {
    process_record_id: processId, process_revision: 3, matrix_record_id: matrixId, matrix_revision: 1,
    first_evaluation_record_id: firstId, first_evaluation_revision: 1,
    second_evaluation_record_id: secondId, second_evaluation_revision: 1,
    divergences: [{ criterion_code: "accessibility", substantial: true }],
  },
};

function ctx(references: ResolvedRecordReference[] = [], actorId = reviewerOne): RecordValidationContext {
  const all = [...references, process, processCourse, matrix, ruleset, assignment, projection, blindedDocument, first, second, thirdConsolidation, ...applications, ...profiles, ethicsTerm];
  return {
    actorId,
    resolveRecord: async (id, revision) => all.find((item) => item.id === id && item.revision === revision) || null,
    resolveLatestRecord: async (id) => all.find((item) => item.id === id) || null,
    countLatestRecordsByPayloadValue: async () => 0,
    countLatestRecordsMatchingPayload: async () => 0,
    hasPermission: async (permission) => permission === "plugin.safdoulas-assessments.manage",
    hasAcceptedTerm: async (id, revision) => id === ethicsTerm.id && revision === ethicsTerm.revision,
  };
}

test("assessment plugin is a leaf over generic matrices, records, documents and SAF process plugins", () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(safdoulasGovernancePlugin);
  registry.register(safdoulasRegistryPlugin);
  registry.register(safdoulasAccreditorsPlugin);
  registry.register(safdoulasProcessesPlugin);
  registry.register(safdoulasTriagePlugin);
  registry.register(safdoulasBlindingPlugin);
  registry.register(safdoulasAssessmentsPlugin);
  assert.equal(registry.isEnabled("safdoulas-assessments"), true);
  registry.setEnabled("assessments", false);
  assert.equal(registry.isEnabled("safdoulas-assessments"), false);
  const thirdCandidatesPath = `/safdoulas/assessments/workspaces/${processId}/consolidations/${thirdConsolidationId}/third-candidates`;
  assert.equal(safdoulasAssessmentsPlugin.handlesRoute?.(thirdCandidatesPath), true);
  assert.equal(safdoulasAssessmentsPlugin.routePermission?.(thirdCandidatesPath, "GET"), "plugin.safdoulas-assessments.manage");
  const thirdResultPath = `/safdoulas/assessments/workspaces/${processId}/consolidations/${thirdConsolidationId}/third-result`;
  assert.equal(safdoulasAssessmentsPlugin.handlesRoute?.(thirdResultPath), true);
  assert.equal(safdoulasAssessmentsPlugin.routePermission?.(thirdResultPath, "GET"), "plugin.safdoulas-assessments.manage");
});

test("a workspace member who is not designated cannot start a third evaluation", async () => {
  const assignedTo = "00000000-0000-4000-8000-000000000099";
  const controller = new SafdoulasAssessmentRecommendationController(
    {} as never,
    { isEnabled: () => true } as never,
    { async shared() {} } as never,
    { async require() {} } as never,
    { async query() { return [{ id: assignmentId, kind: "third_review_assignment", state: "assigned", revision: 1, payload: { evaluator_user_id: assignedTo } }]; } } as never,
  );
  await assert.rejects(() => controller.startEvaluation(
    { orbitActor: reviewerOne } as never, processId, assignmentId, { operation_key: "00000000-0000-4000-8000-000000000099" },
  ), /não está designada/);
});

test("recommendations balance regional diversity, matrix expertise and workload while enforcing capacity", () => {
  const candidates = [
    { user_id: reviewerOne, name: "Ana", profile_record_id: profileOneId, profile_revision: 1, region_code: "PE", expertise: ["coordination"], active_assignments: 0, total_assignments: 2, max_parallel_assignments: 3, matched_expertise: [] },
    { user_id: reviewerTwo, name: "Bia", profile_record_id: profileTwoId, profile_revision: 1, region_code: "SP", expertise: ["accessibility"], active_assignments: 1, total_assignments: 1, max_parallel_assignments: 3, matched_expertise: [] },
    { user_id: reviewerThree, name: "Caia", profile_record_id: "00000000-0000-4000-8000-000000000021", profile_revision: 1, region_code: "PE", expertise: ["coordination", "accessibility"], active_assignments: 3, total_assignments: 3, max_parallel_assignments: 3, matched_expertise: [] },
  ];
  const ranked = rankEvaluatorPairs(candidates, "PE", ["coordination", "accessibility"]);
  assert.equal(ranked.length, 1);
  assert.deepEqual(ranked[0].evaluators.map((candidate) => candidate.user_id), [reviewerOne, reviewerTwo]);
  assert.equal(ranked[0].evaluators.some((candidate) => candidate.user_id === reviewerThree), false);
  assert.ok(ranked[0].reasons.some((reason) => reason.includes("regiões diferentes")));
  assert.ok(ranked[0].evaluators.every((candidate) => candidate.matched_expertise.length > 0));
});

test("distribution fixes process, published matrix, verified blinded material and two distinct evaluators", async () => {
  const payload = {
    process_record_id: processId, process_revision: 3, matrix_record_id: matrixId, matrix_revision: 1,
    blinded_projection_refs: [{ record_id: projectionId, revision: 1 }], evaluator_user_ids: [reviewerOne, reviewerTwo],
    evaluator_profile_refs: [{ user_id: reviewerOne, record_id: profileOneId, revision: 1 }, { user_id: reviewerTwo, record_id: profileTwoId, revision: 1 }],
  };
  assert.deepEqual(await assignmentIssues(payload, ctx()), []);
  assert.equal((await assignmentIssues({ ...payload, evaluator_user_ids: [reviewerOne, reviewerOne] }, ctx())).some((item) => item.code === "two_independent_evaluators_required"), true);
  const conflictedProfile = { ...profiles[0], payload: { ...profiles[0].payload, affiliations: [{
    provider_record_id: "00000000-0000-4000-8000-000000000019", course_record_id: null, conflict_type: "teaching",
    description: "Vínculo ativo com a instituição avaliada.", active_from: "2020-01-01", active_until: null,
  }] } };
  assert.equal((await assignmentIssues(payload, ctx([conflictedProfile]))).some((item) => item.code === "evaluator_profile_ineligible"), true);
});

test("distribution blocks evaluators at capacity and fails closed when the workspace count is unavailable", async () => {
  const payload = {
    process_record_id: processId, process_revision: 3, matrix_record_id: matrixId, matrix_revision: 1,
    blinded_projection_refs: [{ record_id: projectionId, revision: 1 }], evaluator_user_ids: [reviewerOne, reviewerTwo],
    evaluator_profile_refs: [
      { user_id: reviewerOne, record_id: profileOneId, revision: 1 },
      { user_id: reviewerTwo, record_id: profileTwoId, revision: 1 },
    ],
  };
  const atCapacity = {
    ...ctx(),
    countLatestRecordsByPayloadValue: async (_plugin: string, _kind: string, _state: string, _field: string, user: string) => user === reviewerOne ? 3 : 0,
  };
  assert.equal((await assignmentIssues(payload, atCapacity)).some((item) => item.code === "evaluator_capacity_reached"), true);
  const unavailable = { ...ctx(), countLatestRecordsByPayloadValue: async () => null };
  assert.equal((await assignmentIssues(payload, unavailable)).some((item) => item.code === "evaluator_capacity_unavailable"), true);
});

test("assignment slots are released only after every assigned evaluator submits, and duplicate evaluations are rejected", async () => {
  const primary = safdoulasAssessmentsPlugin.contributions?.recordKinds?.evaluation_assignment;
  const third = safdoulasAssessmentsPlugin.contributions?.recordKinds?.third_review_assignment;
  assert.ok(primary && third);
  const base = { ...ctx(), recordId: assignmentId };
  assert.deepEqual(await primary.availableTransitions?.("assigned", assignment.payload, base), []);
  const completePrimary = { ...base, countLatestRecordsMatchingPayload: async (_plugin: string, _kind: string, _state: string, match: Record<string, string>) => match.assignment_record_id === assignmentId ? 2 : 0 };
  assert.deepEqual(await primary.availableTransitions?.("assigned", assignment.payload, completePrimary), ["completed"]);
  assert.deepEqual(await third.availableTransitions?.("assigned", { evaluator_user_id: reviewerThree }, { ...base, countLatestRecordsMatchingPayload: async () => 1 }), ["completed"]);

  const payload = { ...first.payload, evaluation_role: "first" };
  const duplicate = { ...ctx(), countLatestRecordsMatchingPayload: async (_plugin: string, _kind: string, _state: string, match: Record<string, string>) => match.evaluator_user_id === reviewerOne ? 1 : 0 };
  assert.equal((await evaluationIssues(payload, duplicate)).some((item) => item.code === "duplicate_evaluator_assignment"), true);
});

test("individual evaluation requires every pinned criterion, evidence and assigned evaluator", async () => {
  const payload = {
    assignment_record_id: assignmentId, assignment_revision: 1, process_record_id: processId, process_revision: 3,
    matrix_record_id: matrixId, matrix_revision: 1, evaluation_role: "first", evaluator_user_id: reviewerOne,
    answers: [
      { criterion_code: "coordination", outcome: "A", justification: "Atende aos parâmetros descritos na evidência.", evidence: [{ record_id: "00000000-0000-4000-8000-000000000012", revision: 1 }] },
      { criterion_code: "accessibility", outcome: "AP", evidence: [] },
    ], preliminary_opinion: "Parecer fundamentado.",
  };
  const withDocument = ctx([{
    id: "00000000-0000-4000-8000-000000000012", pluginId: "documents", kind: "document", state: "published", revision: 1, payload: { variant: "anonymized" },
  }]);
  assert.deepEqual(await evaluationIssues(payload, withDocument, true), []);
  const originalDocument: ResolvedRecordReference = {
    id: "00000000-0000-4000-8000-000000000054", pluginId: "documents", kind: "document", state: "published", revision: 1,
    payload: { variant: "original" },
  };
  const outsideEvidence = { ...payload, answers: payload.answers.map((answer) => answer.criterion_code === "coordination"
    ? { ...answer, evidence: [{ record_id: originalDocument.id, revision: 1 }] }
    : answer) };
  assert.equal((await evaluationIssues(outsideEvidence, ctx([originalDocument]), true)).some((item) => item.code === "assessment_evidence_outside_blinded_assignment"), true);
  const privateRecordContext = {
    ...withDocument,
    resolveRecord: async (id: string, revision: number) => [assignment, matrix, projection, blindedDocument].find((item) => item.id === id && item.revision === revision) || null,
  };
  assert.deepEqual(await evaluationIssues(payload, privateRecordContext, true), []);
  assert.equal((await evaluationIssues({ ...payload, evaluator_user_id: reviewerTwo }, withDocument, true)).some((item) => item.code === "evaluator_assignment_mismatch"), true);
  assert.equal((await evaluationIssues({ ...payload, answers: payload.answers.slice(0, 1) }, withDocument, true)).some((item) => item.code === "criterion_not_assessed"), true);
});

test("third evaluators validate only against their immutable assignment snapshot, not the private process or consolidation", async () => {
  const thirdAssignment: ResolvedRecordReference = {
    id: assignmentId, pluginId: "safdoulas-assessments", kind: "third_review_assignment", state: "assigned", revision: 1,
    payload: {
      process_record_id: processId, process_revision: 3, matrix_record_id: matrixId, matrix_revision: 1,
      consolidation_record_id: thirdConsolidationId, consolidation_revision: 1, evaluator_user_id: reviewerThree,
      evaluator_profile_ref: { user_id: reviewerThree, record_id: "00000000-0000-4000-8000-000000000021", revision: 1 },
      blinded_projection_refs: [{ record_id: projectionId, revision: 1 }],
    },
  };
  const payload = {
    assignment_record_id: assignmentId, assignment_revision: 1, process_record_id: processId, process_revision: 3,
    matrix_record_id: matrixId, matrix_revision: 1, evaluation_role: "third", evaluator_user_id: reviewerThree,
    consolidation_record_id: thirdConsolidationId, consolidation_revision: 1,
    answers: [
      { criterion_code: "coordination", outcome: "A", justification: "Evidência conferida.", evidence: [{ record_id: "00000000-0000-4000-8000-000000000012", revision: 1 }] },
      { criterion_code: "accessibility", outcome: "AP", evidence: [] },
    ], preliminary_opinion: "Parecer fundamentado.",
  };
  const context = {
    ...ctx([], reviewerThree),
    resolveRecord: async (id: string, revision: number) => [thirdAssignment, matrix, projection, blindedDocument].find((item) => item.id === id && item.revision === revision) || null,
    resolveLatestRecord: async (id: string) => id === "00000000-0000-4000-8000-000000000021"
      ? { ...profiles[0], id, payload: { ...profiles[0].payload, user_id: reviewerThree, application_record_id: applicationOneId } }
      : null,
  };
  assert.deepEqual(await evaluationIssues(payload, context), []);
  assert.equal((await evaluationIssues(payload, { ...context, actorId: reviewerOne, hasPermission: async () => false })).some((item) => item.code === "evaluation_actor_mismatch"), true);
});

test("individual assessment access is limited to its evaluator; a submitted assessment is read-only", () => {
  const payload = { evaluator_user_id: reviewerOne };
  assert.equal(authorizeIndividualEvaluation(reviewerOne, "read", "draft", payload), true);
  assert.equal(authorizeIndividualEvaluation(reviewerTwo, "read", "draft", payload), false);
  assert.equal(authorizeIndividualEvaluation(reviewerOne, "write", "draft", payload), true);
  assert.equal(authorizeIndividualEvaluation(reviewerOne, "write", "submitted", payload), false);
});

test("third evaluation assignment is allowed only for a substantial divergence and a new evaluator", async () => {
  const payload = {
    process_record_id: processId, process_revision: 3, matrix_record_id: matrixId, matrix_revision: 1,
    consolidation_record_id: thirdConsolidationId, consolidation_revision: 1,
    blinded_projection_refs: [{ record_id: projectionId, revision: 1 }], evaluator_user_id: reviewerThree,
    evaluator_profile_ref: { user_id: reviewerThree, record_id: "00000000-0000-4000-8000-000000000021", revision: 1 },
  };
  const thirdProfile = { ...profiles[0], id: "00000000-0000-4000-8000-000000000021", payload: { ...profiles[0].payload, user_id: reviewerThree, application_record_id: applicationOneId } };
  assert.deepEqual(await thirdReviewAssignmentIssues(payload, ctx([thirdProfile])), []);
  assert.equal((await thirdReviewAssignmentIssues({ ...payload, evaluator_user_id: reviewerOne }, ctx())).some((item) => item.code === "third_evaluator_must_be_independent"), true);
});

test("assigning and closing a third review grants and revokes only its blinded record scopes", async () => {
  const definition = safdoulasAssessmentsPlugin.contributions?.recordKinds?.third_review_assignment;
  assert.ok(definition?.recordRoleEffects);
  const payload = {
    evaluator_user_id: reviewerThree,
    blinded_projection_refs: [{ record_id: projectionId, revision: 1 }],
  };
  const context = { ...ctx([], reviewerThree), recordId: assignmentId };
  const granted = await definition.recordRoleEffects!("draft", "assigned", payload, context);
  assert.deepEqual(granted.map((effect) => [effect.userId, effect.roleId, effect.recordId, effect.effect]), [
    [reviewerThree, "safdoulas_blinded_evaluator", blindedDocumentId, "grant"],
    [reviewerThree, "safdoulas_blinded_evaluator", projectionId, "grant"],
    [reviewerThree, "safdoulas_blinded_evaluator", assignmentId, "grant"],
  ]);
  const revoked = await definition.recordRoleEffects!("assigned", "completed", payload, context);
  assert.ok(revoked.every((effect) => effect.effect === "revoke" && effect.userId === reviewerThree));
});

test("consolidation captures all outcome divergences and requires a distinct third review when substantial", async () => {
  const base = {
    process_record_id: processId, process_revision: 3, matrix_record_id: matrixId, matrix_revision: 1,
    first_evaluation_record_id: firstId, first_evaluation_revision: 1,
    second_evaluation_record_id: secondId, second_evaluation_revision: 1,
    divergences: [{ criterion_code: "accessibility", substantial: false }],
    third_evaluation_record_id: null, third_evaluation_revision: null,
    synthesis: "Síntese comparativa.", strengths: [], fragilities: [], diligence_items: [], conclusion: "Conclusão técnica.",
  };
  assert.deepEqual(await consolidationIssues(base, ctx()), []);
  assert.deepEqual(await consolidationTransitions("draft", base, ctx()), ["completed"]);
  const substantial = { ...base, divergences: [{ criterion_code: "accessibility", substantial: true, rationale: "A divergência muda a interpretação do critério." }] };
  assert.deepEqual(await consolidationTransitions("draft", substantial, ctx()), []);
  const third: ResolvedRecordReference = {
    id: thirdId, pluginId: "safdoulas-assessments", kind: "individual_evaluation", state: "submitted", revision: 1,
    payload: { evaluation_role: "third", evaluator_user_id: reviewerThree, process_record_id: processId, process_revision: 3, matrix_record_id: matrixId, matrix_revision: 1 },
  };
  assert.deepEqual(await consolidationTransitions("draft", {
    ...substantial, third_evaluation_record_id: thirdId, third_evaluation_revision: 1,
  }, ctx([third])), ["completed"]);
});

test("evaluation comparison reports only criteria with different outcomes in stable matrix-code order", () => {
  const compared = divergentCriteria(
    { answers: [{ criterion_code: "zeta", outcome: "A" }, { criterion_code: "alpha", outcome: "NA" }] },
    { answers: [{ criterion_code: "zeta", outcome: "AP" }, { criterion_code: "alpha", outcome: "NA" }] },
  );
  assert.deepEqual(compared.map((item) => [item.criterion_code, item.first_outcome, item.second_outcome]), [["zeta", "A", "AP"]]);
});
