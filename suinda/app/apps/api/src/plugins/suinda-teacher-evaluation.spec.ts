import assert from "node:assert/strict";
import test from "node:test";
import { suindaTeacherEvaluationPlugin as plugin, suindaTeacherEvaluationRecordKinds as kinds } from "./suinda-teacher-evaluation";
import type { RecordValidationContext, ResolvedRecordReference } from "./contract";

const id = (last: string) => `00000000-0000-4000-8000-${last.padStart(12, "0")}`;
const teacherId = id("1");
const managerId = id("2");
const courseId = id("3");
const surveyId = id("4");
const policyId = id("5");
const cycleId = id("6");
const retentionNoticeId = id("8");
const criteria = kinds.evaluation_policy.example.criteria as Array<Record<string, unknown>>;
const policyPayload = { ...kinds.evaluation_policy.example, criteria, retention_notice_record_id: retentionNoticeId };
const retentionNotice: ResolvedRecordReference = { id: retentionNoticeId, pluginId: "suinda-learning", kind: "privacy_notice", state: "published", revision: 1,
  payload: { retention_period_days: 365, retention_record_kinds: ["evaluation_policy", "evaluation_cycle", "evaluation_appeal"] } };

function context(records: Record<string, ResolvedRecordReference>, overrides: Partial<RecordValidationContext> = {}): RecordValidationContext {
  return {
    resolveRecord: async (recordId) => records[recordId] || null,
    resolveLatestRecord: async (recordId) => records[recordId] || null,
    actorId: managerId,
    hasWorkspacePermission: async () => true,
    ...overrides,
  };
}

test("plugin filho declara dependência do aprendizado e os três registros de avaliação", () => {
  assert.equal(plugin.parentPlugin, "suinda-learning");
  assert.deepEqual(plugin.dependencies, ["suinda-learning"]);
  assert.deepEqual(Object.keys(kinds).sort(), ["evaluation_appeal", "evaluation_cycle", "evaluation_policy"]);
});

test("política institucional exige critérios únicos com peso total de 100 e salvaguardas", async () => {
  const validate = kinds.evaluation_policy.validate!;
  assert.deepEqual(await validate(policyPayload, context({ [retentionNoticeId]: retentionNotice })), []);
  const duplicate = { ...policyPayload, criteria: [criteria[0], criteria[0], criteria[2]] };
  assert.equal((await validate(duplicate, context({ [retentionNoticeId]: retentionNotice })))[0]?.code, "teacher_evaluation.criteria_duplicate");
  const invalidWeight = { ...policyPayload, criteria: criteria.map((item, index) => index ? item : { ...item, weight: 39 }) };
  assert.equal((await validate(invalidWeight, context({ [retentionNoticeId]: retentionNotice })))[0]?.code, "teacher_evaluation.criteria_weight");
  assert.equal((await validate({ ...policyPayload, minimum_anonymous_responses: 4 }, context({ [retentionNoticeId]: retentionNotice })))[0]?.code,
    "teacher_evaluation.minimum_sample");
  const mismatchedNotice = { ...retentionNotice, payload: { ...retentionNotice.payload, retention_period_days: 730 } };
  assert.equal((await validate(policyPayload, context({ [retentionNoticeId]: mismatchedNotice })))[0]?.code,
    "teacher_evaluation.retention_notice_invalid");
});

test("aprovação de política exige uma segunda pessoa gestora e registra autoria/horário", async () => {
  const authorize = kinds.evaluation_policy.authorizeTransition!;
  const ownerContext = context({}, { recordId: policyId, isRecordOwner: async () => true });
  assert.equal(await authorize("draft", "approved", policyPayload, ownerContext), false);
  const secondManager = context({}, { recordId: policyId, actorId: managerId, isRecordOwner: async () => false });
  assert.equal(await authorize("draft", "approved", policyPayload, secondManager), true);
  const stamped = await kinds.evaluation_policy.prepareTransition!("draft", "approved", policyPayload, secondManager);
  assert.equal(stamped.approved_by_user_id, managerId);
  assert.equal(typeof stamped.approved_at, "string");
});

test("ciclo publicado exige política aprovada, revisão fixada, docente atribuído e pesquisa anônima correspondente", async () => {
  const course: ResolvedRecordReference = { id: courseId, pluginId: "suinda-learning", kind: "course", state: "published", revision: 2,
    payload: { version: 3, instructor_ids: [teacherId] } };
  const policy: ResolvedRecordReference = { id: policyId, pluginId: plugin.id, kind: "evaluation_policy", state: "approved", revision: 2, payload: policyPayload };
  const survey: ResolvedRecordReference = { id: surveyId, pluginId: "suinda-learning", kind: "survey", state: "open", revision: 1,
    payload: { target_type: "teacher", target_record_id: teacherId, anonymous: true,
      minimum_anonymous_responses: 5, responses_close_at: "2035-02-01T00:00:00.000Z",
      questions: criteria.map((item) => ({ id: item.criterion_id, label: item.label, type: "rating", required: true })) } };
  const cyclePayload = { policy_record_id: policyId, teacher_user_id: teacherId, course_record_id: courseId, course_revision: 3,
    cohort_record_id: null, survey_record_id: surveyId, opens_at: "2035-01-01T00:00:00.000Z", closes_at: "2035-02-01T00:00:00.000Z",
    published_criteria: criteria };
  const records = { [policyId]: policy, [courseId]: course, [surveyId]: survey };
  const validate = kinds.evaluation_cycle.validate!;
  const issues = await validate(cyclePayload, context(records, { transition: { from: "draft", to: "open" } }));
  assert.equal(issues[0]?.code, "teacher_evaluation.period_invalid");

  const currentClose = new Date(Date.now() + 86400000).toISOString();
  survey.payload.responses_close_at = currentClose;
  cyclePayload.closes_at = currentClose;
  cyclePayload.opens_at = new Date(Date.now() - 60000).toISOString();
  assert.deepEqual(await validate(cyclePayload, context(records, { transition: { from: "draft", to: "open" } })), []);

  survey.payload.minimum_anonymous_responses = 10;
  assert.equal((await validate(cyclePayload, context(records, { transition: { from: "draft", to: "open" } })))[0]?.code,
    "teacher_evaluation.sample_threshold_mismatch");
});

test("recurso só pode ser criado pela pessoa avaliada dentro do prazo aprovado", async () => {
  const validatedAt = new Date(Date.now() - 10 * 86400000).toISOString();
  const policy: ResolvedRecordReference = { id: policyId, pluginId: plugin.id, kind: "evaluation_policy", state: "approved", revision: 1,
    payload: { appeal_window_days: 30, approved_by_user_id: managerId } };
  const cycle: ResolvedRecordReference = { id: cycleId, pluginId: plugin.id, kind: "evaluation_cycle", state: "validated", revision: 1,
    payload: { teacher_user_id: teacherId, policy_record_id: policyId, validated_at: validatedAt } };
  const auth = kinds.evaluation_appeal.authorizeCreate!;
  const records = { [cycleId]: cycle, [policyId]: policy };
  assert.equal(await auth(teacherId, { cycle_record_id: cycleId, teacher_user_id: teacherId }, context(records, { actorId: teacherId })), true);
  assert.equal(await auth(managerId, { cycle_record_id: cycleId, teacher_user_id: managerId }, context(records, { actorId: managerId })), false);
  policy.payload.appeal_window_days = 5;
  assert.equal(await auth(teacherId, { cycle_record_id: cycleId, teacher_user_id: teacherId }, context(records, { actorId: teacherId })), false);
});

test("validação institucional exige amostra, parecer e instância independente e fica atribuída ao revisor", async () => {
  const policy: ResolvedRecordReference = { id: policyId, pluginId: plugin.id, kind: "evaluation_policy", state: "approved", revision: 1,
    payload: { ...policyPayload, approved_by_user_id: managerId } };
  const payload = { policy_record_id: policyId, teacher_user_id: teacherId, survey_record_id: surveyId,
    published_criteria: criteria, aggregate_response_count: null, aggregate_weighted_score: null, aggregate_criteria_results: null,
    validation_summary: "A comissão confirmou a aplicação uniforme dos critérios publicados.", validation_reference: "Ata institucional 2026-14" };
  const validatorId = id("7");
  const averages = [4.2, 3.3, 4.8];
  const aggregated = { recordCount: 5, groups: criteria.map((item, index) => ({ key: String(item.criterion_id), count: 5, average: averages[index] })) };
  const validContext = context({ [policyId]: policy }, { actorId: validatorId, transition: { from: "closed", to: "validated" },
    aggregateLatestNumericArrayValues: async () => aggregated });
  const prepared = await kinds.evaluation_cycle.prepareTransition!("closed", "validated", payload, validContext);
  assert.deepEqual(await kinds.evaluation_cycle.validate!(prepared, validContext), []);
  const stamped = await kinds.evaluation_cycle.prepareTransition!("closed", "validated", payload, validContext);
  assert.equal(stamped.validated_by_user_id, validatorId);
  assert.equal(typeof stamped.validated_at, "string");
  assert.equal(stamped.aggregate_response_count, 5);
  assert.equal(stamped.aggregate_weighted_score, 4.11);
  assert.equal((stamped.aggregate_criteria_results as Array<{ average: number }>)[0].average, 4.2);
  assert.equal((await kinds.evaluation_cycle.validate!({ ...prepared, aggregate_weighted_score: 4.99 }, validContext))[0]?.code,
    "teacher_evaluation.validation_aggregate_mismatch");
  const insufficient = context({ [policyId]: policy }, { actorId: validatorId, transition: { from: "closed", to: "validated" },
    aggregateLatestNumericArrayValues: async () => ({ ...aggregated, recordCount: 4 }) });
  assert.equal((await kinds.evaluation_cycle.validate!(payload, insufficient))[0]?.code, "teacher_evaluation.validation_sample_insufficient");
  const policyApprover = context({ [policyId]: policy }, { actorId: managerId, transition: { from: "closed", to: "validated" },
    aggregateLatestNumericArrayValues: async () => aggregated });
  assert.equal((await kinds.evaluation_cycle.validate!(payload, policyApprover))[0]?.code, "teacher_evaluation.validator_not_independent");
});
