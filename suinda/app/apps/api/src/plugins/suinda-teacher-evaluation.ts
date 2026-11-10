import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue } from "./contract";

export const SUINDA_TEACHER_EVALUATION = "suinda-teacher-evaluation";
const MANAGE = `plugin.${SUINDA_TEACHER_EVALUATION}.manage`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const uuid = { type: "string", pattern: UUID.source };
const ref = (kind: string) => ({ ...uuid, recordKind: kind });
async function canManage(context: RecordValidationContext) {
  return Boolean(await context.hasWorkspacePermission?.(MANAGE) || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"));
}
const criteriaSchema = {
  type: "array", minItems: 3, maxItems: 12, items: object({
    criterion_id: { type: "string", pattern: "^[a-z][a-z0-9_-]{1,39}$" },
    label: { type: "string", minLength: 3, maxLength: 160 },
    description: { type: "string", minLength: 10, maxLength: 1200 },
    weight: { type: "integer", minimum: 1, maximum: 100 },
    scale_min: { type: "integer", const: 1 },
    scale_max: { type: "integer", const: 5 },
    evidence_basis: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true,
      items: { type: "string", enum: ["learner_feedback", "course_material", "peer_observation", "documented_activity"] } },
  }, ["criterion_id", "label", "description", "weight", "scale_min", "scale_max", "evidence_basis"]),
};
const managerOnly: Pick<RecordKindContribution, "resourceScoped" | "managePermission" | "authorizeRecord" | "authorizeCreate"> = {
  resourceScoped: true,
  managePermission: MANAGE,
  authorizeRecord: async (_actor, _action, _state, _payload, context) => canManage(context),
  authorizeCreate: async (_actor, _payload, context) => canManage(context),
};
function issue(code: string, path: string, message: string): RecordValidationIssue {
  return { severity: "error", code, path, message };
}
function policyIssue(payload: Record<string, unknown>) {
  const criteria = Array.isArray(payload.criteria) ? payload.criteria as Array<Record<string, unknown>> : [];
  const ids = criteria.map((criterion) => String(criterion.criterion_id || ""));
  const weight = criteria.reduce((sum, criterion) => sum + Number(criterion.weight || 0), 0);
  if (criteria.length < 3 || criteria.length > 12) return issue("teacher_evaluation.criteria_count", "criteria", "Defina de 3 a 12 critérios institucionais.");
  if (new Set(ids).size !== ids.length) return issue("teacher_evaluation.criteria_duplicate", "criteria", "Os identificadores dos critérios precisam ser únicos.");
  if (weight !== 100) return issue("teacher_evaluation.criteria_weight", "criteria", "Os pesos dos critérios precisam somar exatamente 100.");
  if (payload.eligible_evaluators !== "current_or_completed_learners") return issue("teacher_evaluation.evaluator_profile", "eligible_evaluators", "Use alunos com matrícula ativa ou concluída no curso ou na turma.");
  if (payload.nonresponse_policy !== "exclude_without_penalty") return issue("teacher_evaluation.nonresponse", "nonresponse_policy", "A não resposta deve ser excluída sem penalizar aluno ou docente.");
  if (Number(payload.minimum_anonymous_responses) < 5) return issue("teacher_evaluation.minimum_sample", "minimum_anonymous_responses", "A amostra mínima anônima deve ser de pelo menos cinco respostas.");
  if (payload.visibility_policy !== "aggregated_only") return issue("teacher_evaluation.visibility", "visibility_policy", "Resultados individuais e identidades de alunos não podem ser expostos.");
  if (payload.consequence_policy !== "manual_institutional_review") return issue("teacher_evaluation.consequences", "consequence_policy", "Resultados não podem gerar consequências profissionais automatizadas.");
  if (typeof payload.approval_reference !== "string" || payload.approval_reference.trim().length < 8)
    return issue("teacher_evaluation.approval_reference", "approval_reference", "Registre a referência da aprovação institucional dos critérios e do método.");
  return null;
}

async function calculateCycleAggregate(payload: Record<string, unknown>, context: RecordValidationContext) {
  const surveyId = String(payload.survey_record_id || "");
  const policy = await context.resolveLatestRecord?.(String(payload.policy_record_id || ""));
  if (!surveyId || policy?.pluginId !== SUINDA_TEACHER_EVALUATION || policy.kind !== "evaluation_policy") return null;
  const aggregate = await context.aggregateLatestNumericArrayValues?.("suinda-learning", "survey_response", "submitted",
    "survey_record_id", surveyId, "answers", "question_id", "value");
  if (!aggregate) return null;
  const responseCount = Number(aggregate.recordCount);
  const minimum = Number(policy.payload.minimum_anonymous_responses);
  if (!Number.isInteger(responseCount) || responseCount < minimum) return { responseCount, result: null };
  const criteria = Array.isArray(payload.published_criteria) ? payload.published_criteria as Array<Record<string, unknown>> : [];
  const groups = new Map(aggregate.groups.map((group) => [group.key, group]));
  const criterionResults = [];
  for (const criterion of criteria) {
    const group = groups.get(String(criterion.criterion_id || ""));
    if (!group || group.count !== responseCount || !Number.isFinite(group.average) || group.average < 1 || group.average > 5)
      return { responseCount, result: null };
    criterionResults.push({ criterion_id: String(criterion.criterion_id), label: String(criterion.label), weight: Number(criterion.weight),
      responses: group.count, average: Math.round(group.average * 100) / 100 });
  }
  if (groups.size !== criteria.length || criteria.reduce((sum, criterion) => sum + Number(criterion.weight), 0) !== 100)
    return { responseCount, result: null };
  const weightedScore = Math.round(criterionResults.reduce((sum, criterion) => sum + criterion.average * criterion.weight, 0)) / 100;
  return { responseCount, result: { aggregate_response_count: responseCount, aggregate_criteria_results: criterionResults,
    aggregate_weighted_score: weightedScore } };
}

function aggregatePayloadMatches(payload: Record<string, unknown>, expected: Record<string, unknown>) {
  return payload.aggregate_response_count === expected.aggregate_response_count
    && Number(payload.aggregate_weighted_score) === expected.aggregate_weighted_score
    && JSON.stringify(payload.aggregate_criteria_results) === JSON.stringify(expected.aggregate_criteria_results);
}

export const suindaTeacherEvaluationRecordKinds: Record<string, RecordKindContribution> = {
  evaluation_policy: {
    label: "Política institucional de avaliação docente",
    schema: object({
      criteria: criteriaSchema,
      eligible_evaluators: { type: "string", enum: ["current_or_completed_learners"] },
      nonresponse_policy: { type: "string", enum: ["exclude_without_penalty"] },
      minimum_anonymous_responses: { type: "integer", minimum: 5, maximum: 1000 },
      validation_method: { type: "string", enum: ["independent_panel", "institutional_rubric_review"] },
      appeal_window_days: { type: "integer", minimum: 1, maximum: 90 },
      appeal_reviewer_role: { type: "string", enum: ["independent_workspace_manager"] },
      retention_days: { type: "integer", minimum: 30, maximum: 3650 },
      retention_notice_record_id: ref("privacy_notice"),
      visibility_policy: { type: "string", enum: ["aggregated_only"] },
      consequence_policy: { type: "string", enum: ["manual_institutional_review"] },
      approval_reference: { type: "string", minLength: 8, maxLength: 1000 },
      approved_by_user_id: { type: ["string", "null"], pattern: UUID.source },
      approved_at: { type: ["string", "null"], format: "date-time" },
    }, ["criteria", "eligible_evaluators", "nonresponse_policy", "minimum_anonymous_responses", "validation_method",
      "appeal_window_days", "appeal_reviewer_role", "retention_days", "retention_notice_record_id", "visibility_policy", "consequence_policy", "approval_reference"]),
    initial: "draft", transitions: { draft: ["approved", "archived"], approved: ["archived"], archived: [] },
    stateLabels: { draft: "Rascunho institucional", approved: "Aprovada por segunda pessoa gestora", archived: "Arquivada" },
    immutablePayloadFieldsAfterInitial: ["criteria", "eligible_evaluators", "nonresponse_policy", "minimum_anonymous_responses",
      "validation_method", "appeal_window_days", "appeal_reviewer_role", "retention_days", "retention_notice_record_id",
      "visibility_policy", "consequence_policy", "approval_reference"],
    example: { criteria: [
      { criterion_id: "clarity", label: "Clareza didática", description: "Explica objetivos, conceitos e relações entre conteúdos.", weight: 40,
        scale_min: 1, scale_max: 5, evidence_basis: ["learner_feedback", "course_material"] },
      { criterion_id: "inclusion", label: "Ambiente inclusivo", description: "Oferece oportunidades respeitosas de participação e aprendizagem.", weight: 30,
        scale_min: 1, scale_max: 5, evidence_basis: ["learner_feedback", "peer_observation"] },
      { criterion_id: "feedback", label: "Qualidade da devolutiva", description: "Fornece devolutivas relacionadas aos objetivos de aprendizagem.", weight: 30,
        scale_min: 1, scale_max: 5, evidence_basis: ["learner_feedback", "documented_activity"] },
    ], eligible_evaluators: "current_or_completed_learners", nonresponse_policy: "exclude_without_penalty", minimum_anonymous_responses: 5,
      validation_method: "independent_panel", appeal_window_days: 30, appeal_reviewer_role: "independent_workspace_manager", retention_days: 365,
      retention_notice_record_id: "00000000-0000-4000-8000-000000000008",
      visibility_policy: "aggregated_only", consequence_policy: "manual_institutional_review", approval_reference: "Ata ou resolução institucional aprovada" },
    ...managerOnly,
    authorizeTransition: async (from, to, _payload, context) => {
      if (!await canManage(context)) return false;
      if (from === "draft" && to === "approved" && context.recordId && context.actorId
        && await context.isRecordOwner?.(context.recordId, context.actorId)) return false;
      return true;
    },
    prepareTransition: async (from, to, payload, context) => from === "draft" && to === "approved"
      ? { ...payload, approved_by_user_id: context.actorId || null, approved_at: new Date().toISOString() } : payload,
    validate: async (payload, context) => {
      const problem = policyIssue(payload);
      if (problem) return [problem];
      const notice = await context.resolveLatestRecord?.(String(payload.retention_notice_record_id || ""));
      const coveredKinds = Array.isArray(notice?.payload.retention_record_kinds) ? notice.payload.retention_record_kinds : [];
      if (notice?.pluginId !== "suinda-learning" || notice.kind !== "privacy_notice" || notice.state !== "published"
        || Number(notice.payload.retention_period_days) !== Number(payload.retention_days)
        || !["evaluation_policy", "evaluation_cycle", "evaluation_appeal"].every((kind) => coveredKinds.includes(kind)))
        return [issue("teacher_evaluation.retention_notice_invalid", "retention_notice_record_id",
          "Vincule um aviso de privacidade publicado, com mesmo prazo e cobertura para política, ciclo e recurso de avaliação.")];
      if (context.transition?.to === "approved" && (!context.actorId || !payload.approval_reference))
        return [issue("teacher_evaluation.approval_required", "approval_reference", "A segunda pessoa gestora precisa aprovar uma política com referência institucional registrada.")];
      return [];
    },
  },
  evaluation_cycle: {
    label: "Ciclo de avaliação docente",
    schema: object({
      policy_record_id: ref("evaluation_policy"),
      teacher_user_id: uuid,
      course_record_id: ref("course"),
      course_revision: { type: "integer", minimum: 1 },
      cohort_record_id: { ...ref("cohort"), type: ["string", "null"] },
      survey_record_id: ref("survey"),
      opens_at: { type: "string", format: "date-time" },
      closes_at: { type: "string", format: "date-time" },
      published_criteria: criteriaSchema,
      validation_summary: { type: ["string", "null"], minLength: 20, maxLength: 4000 },
      validation_reference: { type: ["string", "null"], minLength: 8, maxLength: 1000 },
      validated_by_user_id: { type: ["string", "null"], pattern: UUID.source },
      validated_at: { type: ["string", "null"], format: "date-time" },
      aggregate_response_count: { type: ["integer", "null"], minimum: 0 },
      aggregate_weighted_score: { type: ["number", "null"], minimum: 1, maximum: 5 },
      aggregate_criteria_results: { type: ["array", "null"], maxItems: 12, items: object({
        criterion_id: { type: "string", pattern: "^[a-z][a-z0-9_-]{1,39}$" }, label: { type: "string", minLength: 3, maxLength: 160 },
        weight: { type: "integer", minimum: 1, maximum: 100 }, responses: { type: "integer", minimum: 5 },
        average: { type: "number", minimum: 1, maximum: 5 },
      }, ["criterion_id", "label", "weight", "responses", "average"]) },
    }, ["policy_record_id", "teacher_user_id", "course_record_id", "course_revision", "survey_record_id", "opens_at", "closes_at", "published_criteria"]),
    initial: "draft", transitions: { draft: ["open", "archived"], open: ["closed"], closed: ["validated", "archived"], validated: ["archived"], archived: [] },
    stateLabels: { draft: "Rascunho", open: "Coletando avaliações anônimas", closed: "Encerrado; aguarda validação institucional",
      validated: "Resultado validado pela instituição", archived: "Arquivado" },
    immutablePayloadFieldsAfterInitial: ["policy_record_id", "teacher_user_id", "course_record_id", "course_revision", "cohort_record_id",
      "survey_record_id", "opens_at", "closes_at", "published_criteria"],
    example: { policy_record_id: "00000000-0000-4000-8000-000000000001", teacher_user_id: "00000000-0000-4000-8000-000000000002",
      course_record_id: "00000000-0000-4000-8000-000000000003", course_revision: 1, cohort_record_id: null,
      survey_record_id: "00000000-0000-4000-8000-000000000004", opens_at: "2030-01-01T00:00:00.000Z", closes_at: "2030-02-01T00:00:00.000Z",
      published_criteria: [], validation_summary: null, validation_reference: null, validated_by_user_id: null, validated_at: null },
    resourceScoped: true, managePermission: MANAGE,
    authorizeCreate: async (_actor, _payload, context) => canManage(context),
    authorizeRecord: async (actor, action, _state, payload, context) => Boolean(action === "read" && payload.teacher_user_id === actor || await canManage(context)),
    authorizeTransition: async (_from, _to, _payload, context) => canManage(context),
    validate: async (payload, context) => {
      if (!context.transition) return [];
      if (context.transition.to === "validated") {
        const policy = await context.resolveLatestRecord?.(String(payload.policy_record_id || ""));
        if (!policy || policy.pluginId !== SUINDA_TEACHER_EVALUATION || policy.kind !== "evaluation_policy" || policy.state !== "approved")
          return [issue("teacher_evaluation.policy_not_approved", "policy_record_id", "A validação exige a política institucional vigente.")];
        if (context.actorId === payload.teacher_user_id || context.actorId === policy.payload.approved_by_user_id)
          return [issue("teacher_evaluation.validator_not_independent", "validated_by_user_id", "A pessoa avaliada e quem aprovou a política não podem validar o resultado.")];
        if (typeof payload.validation_summary !== "string" || payload.validation_summary.trim().length < 20
          || typeof payload.validation_reference !== "string" || payload.validation_reference.trim().length < 8)
          return [issue("teacher_evaluation.validation_evidence_required", "validation_reference", "Registre a síntese do resultado e a referência auditável da validação institucional.")];
        const aggregate = await calculateCycleAggregate(payload, context);
        if (!aggregate || aggregate.responseCount < Number(policy.payload.minimum_anonymous_responses))
          return [issue("teacher_evaluation.validation_sample_insufficient", "survey_record_id", "Não há amostra suficiente para validar este resultado anônimo.")];
        if (!aggregate.result)
          return [issue("teacher_evaluation.validation_aggregate_incomplete", "published_criteria", "As respostas agregadas não cobrem todos os critérios publicados com valores válidos.")];
        if (!aggregatePayloadMatches(payload, aggregate.result))
          return [issue("teacher_evaluation.validation_aggregate_mismatch", "aggregate_criteria_results", "O resultado agregado deve corresponder às respostas anônimas e aos pesos aprovados.")];
        return [];
      }
      if (context.transition.to === "closed") {
        const closesAt = Date.parse(String(payload.closes_at || ""));
        const survey = await context.resolveLatestRecord?.(String(payload.survey_record_id || ""));
        if (!Number.isFinite(closesAt) || closesAt > Date.now() || survey?.state !== "closed")
          return [issue("teacher_evaluation.cycle_not_ended", "closes_at", "Encerre o ciclo somente após o prazo e depois do fechamento da pesquisa vinculada.")];
        return [];
      }
      if (context.transition.to !== "open") return [];
      const policyId = String(payload.policy_record_id || "");
      const courseId = String(payload.course_record_id || "");
      const teacherId = String(payload.teacher_user_id || "");
      const courseRevision = Number(payload.course_revision);
      const [policy, course, cohort, survey] = await Promise.all([
        context.resolveLatestRecord?.(policyId), context.resolveLatestRecord?.(courseId),
        typeof payload.cohort_record_id === "string" ? context.resolveLatestRecord?.(String(payload.cohort_record_id)) : Promise.resolve(null),
        context.resolveLatestRecord?.(String(payload.survey_record_id || "")),
      ]);
      if (policy?.pluginId !== SUINDA_TEACHER_EVALUATION || policy.kind !== "evaluation_policy" || policy.state !== "approved")
        return [issue("teacher_evaluation.policy_not_approved", "policy_record_id", "O ciclo exige uma política institucional aprovada e vigente.")];
      if (course?.pluginId !== "suinda-learning" || course.kind !== "course" || Number(course.payload.version) !== courseRevision)
        return [issue("teacher_evaluation.course_revision_invalid", "course_revision", "O ciclo precisa fixar a revisão curricular atual do curso.")];
      if (payload.cohort_record_id && (cohort?.pluginId !== "suinda-learning" || cohort.kind !== "cohort"
        || cohort.payload.course_record_id !== courseId || Number(cohort.payload.course_revision) !== courseRevision))
        return [issue("teacher_evaluation.cohort_mismatch", "cohort_record_id", "A turma precisa pertencer ao curso e à mesma revisão curricular.")];
      const courseInstructors = Array.isArray(course.payload.instructor_ids) ? course.payload.instructor_ids : [];
      const cohortInstructors = Array.isArray(cohort?.payload.instructor_ids) ? cohort.payload.instructor_ids : [];
      if (!courseInstructors.includes(teacherId) && !cohortInstructors.includes(teacherId) && cohort?.payload.instructor_user_id !== teacherId)
        return [issue("teacher_evaluation.teacher_unassigned", "teacher_user_id", "A pessoa avaliada precisa estar atribuída ao curso ou à turma do ciclo.")];
      if (survey?.pluginId !== "suinda-learning" || survey.kind !== "survey" || survey.state !== "open"
        || survey.payload.target_type !== "teacher" || survey.payload.target_record_id !== teacherId || survey.payload.anonymous !== true)
        return [issue("teacher_evaluation.survey_invalid", "survey_record_id", "Vincule uma pesquisa aberta, anônima e direcionada à pessoa docente avaliada.")];
      if (Number(survey.payload.minimum_anonymous_responses || 5) !== Number(policy.payload.minimum_anonymous_responses))
        return [issue("teacher_evaluation.sample_threshold_mismatch", "survey_record_id", "A pesquisa e a política aprovada precisam usar a mesma amostra mínima anônima.")];
      const opensAt = Date.parse(String(payload.opens_at || ""));
      const closesAt = Date.parse(String(payload.closes_at || ""));
      const surveyClosesAt = Date.parse(String(survey.payload.responses_close_at || ""));
      if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt) || opensAt >= closesAt || opensAt > Date.now() || closesAt <= Date.now()
        || !Number.isFinite(surveyClosesAt) || surveyClosesAt !== closesAt)
        return [issue("teacher_evaluation.period_invalid", "closes_at", "O período precisa ser futuro, crescente e coincidir com o fechamento da pesquisa.")];
      const approvedCriteria = Array.isArray(policy.payload.criteria) ? policy.payload.criteria : [];
      const cycleCriteria = Array.isArray(payload.published_criteria) ? payload.published_criteria : [];
      const questions = Array.isArray(survey.payload.questions) ? survey.payload.questions as Array<Record<string, unknown>> : [];
      const criterionIds = approvedCriteria.map((item) => (item as Record<string, unknown>).criterion_id);
      const questionIds = questions.map((item) => item.id);
      if (JSON.stringify(cycleCriteria) !== JSON.stringify(approvedCriteria) || questions.length !== approvedCriteria.length
        || questions.some((question) => question.type !== "rating" || question.required === false)
        || criterionIds.some((id) => !questionIds.includes(id))
        || approvedCriteria.some((criterion) => {
          const item = criterion as Record<string, unknown>;
          return !questions.some((question) => question.id === item.criterion_id && question.label === item.label);
        }))
        return [issue("teacher_evaluation.instrument_mismatch", "survey_record_id", "A pesquisa precisa usar exatamente os critérios e pesos da política aprovada, com escala de 1 a 5.")];
      return [];
    },
    prepareTransition: async (_from, to, payload, context) => {
      if (to !== "validated") return payload;
      const aggregate = await calculateCycleAggregate(payload, context);
      if (!aggregate?.result) throw new Error("Não foi possível calcular os resultados anônimos do ciclo.");
      return { ...payload, ...aggregate.result, validated_by_user_id: context.actorId || null, validated_at: new Date().toISOString() };
    },
  },
  evaluation_appeal: {
    label: "Recurso sobre avaliação docente",
    schema: object({
      cycle_record_id: ref("evaluation_cycle"),
      teacher_user_id: uuid,
      statement: { type: "string", minLength: 20, maxLength: 4000 },
      decision_reason: { type: ["string", "null"], maxLength: 2000 },
      reviewer_user_id: { type: ["string", "null"], pattern: UUID.source },
      decided_at: { type: ["string", "null"], format: "date-time" },
    }, ["cycle_record_id", "teacher_user_id", "statement"]),
    example: { cycle_record_id: "00000000-0000-4000-8000-000000000006", teacher_user_id: "00000000-0000-4000-8000-000000000002",
      statement: "Solicito revisão independente da aplicação dos critérios do ciclo.", decision_reason: null, reviewer_user_id: null, decided_at: null },
    initial: "submitted", transitions: { submitted: ["in_review"], in_review: ["accepted", "rejected"], accepted: [], rejected: [] },
    stateLabels: { submitted: "Enviado", in_review: "Em revisão independente", accepted: "Recurso acolhido", rejected: "Recurso não acolhido" },
    immutable: ["cycle_record_id", "teacher_user_id", "statement"], personalOwnerField: "teacher_user_id", selfServiceCreate: true,
    resourceScoped: true, managePermission: MANAGE,
    authorizeCreate: async (actor, payload, context) => {
      const cycle = await context.resolveLatestRecord?.(String(payload.cycle_record_id || ""));
      if (cycle?.pluginId !== SUINDA_TEACHER_EVALUATION || cycle.kind !== "evaluation_cycle" || cycle.state !== "validated"
        || cycle.payload.teacher_user_id !== actor || payload.teacher_user_id !== actor) return false;
      const policy = await context.resolveLatestRecord?.(String(cycle.payload.policy_record_id || ""));
      const closedAt = Date.parse(String(cycle.payload.validated_at || ""));
      const appealDays = Number(policy?.payload.appeal_window_days);
      return policy?.pluginId === SUINDA_TEACHER_EVALUATION && policy.kind === "evaluation_policy" && policy.state === "approved"
        && Number.isFinite(closedAt) && Number.isInteger(appealDays) && appealDays > 0
        && Date.now() <= closedAt + appealDays * 86400000;
    },
    authorizeRecord: async (actor, action, _state, payload, context) => Boolean(
      await canManage(context) || action === "read" && payload.teacher_user_id === actor,
    ),
    authorizeTransition: async (_from, to, payload, context) => {
      if (!await canManage(context) || context.actorId === payload.teacher_user_id) return false;
      const cycle = await context.resolveLatestRecord?.(String(payload.cycle_record_id || ""));
      const policy = cycle ? await context.resolveLatestRecord?.(String(cycle.payload.policy_record_id || "")) : null;
      if (!cycle || !policy || context.actorId === policy.payload.approved_by_user_id) return false;
      return to === "in_review" || (to === "accepted" || to === "rejected")
        && typeof payload.decision_reason === "string" && payload.decision_reason.trim().length >= 10;
    },
    prepareTransition: async (_from, to, payload, context) => to === "validated"
      ? { ...payload, validated_by_user_id: context.actorId || null, validated_at: new Date().toISOString() }
      : to === "in_review" || to === "accepted" || to === "rejected"
      ? { ...payload, reviewer_user_id: context.actorId || null,
        ...(to === "accepted" || to === "rejected" ? { decided_at: new Date().toISOString() } : {}) } : payload,
    validate: async (payload, context) => {
      if (!UUID.test(String(payload.teacher_user_id || "")) || !UUID.test(String(payload.cycle_record_id || "")))
        return [issue("teacher_evaluation.appeal_reference_invalid", "cycle_record_id", "O recurso precisa identificar um ciclo e uma pessoa docente válidos.")];
      if (context.transition?.to === "accepted" || context.transition?.to === "rejected") {
        const cycle = await context.resolveLatestRecord?.(String(payload.cycle_record_id));
        const policy = cycle ? await context.resolveLatestRecord?.(String(cycle.payload.policy_record_id || "")) : null;
        if (!policy || typeof payload.decision_reason !== "string" || payload.decision_reason.trim().length < 10)
          return [issue("teacher_evaluation.appeal_decision_reason", "decision_reason", "A decisão independente precisa registrar fundamentação de pelo menos dez caracteres.")];
        if (context.actorId === payload.teacher_user_id || context.actorId === policy.payload.approved_by_user_id)
          return [issue("teacher_evaluation.appeal_reviewer_not_independent", "reviewer_user_id", "A pessoa avaliada e a responsável pela aprovação da política não podem decidir este recurso.")];
      }
      return [];
    },
  },
};

export const suindaTeacherEvaluationPlugin: PluginDefinition = {
  id: SUINDA_TEACHER_EVALUATION,
  name: "Suindá · Avaliação docente",
  version: "1.0.0",
  description: "Critérios institucionais versionados, ciclos de feedback anônimo agregado e recursos avaliados por pessoa independente.",
  scope: "workspace",
  parentPlugin: "suinda-learning",
  dependencies: ["suinda-learning"],
  capabilities: [{ id: "manage", name: "Administrar avaliação docente", permissions: [MANAGE] }],
  contributions: {
    navigation: [{ id: SUINDA_TEACHER_EVALUATION, label: "Avaliação docente", href: `/extensions/${SUINDA_TEACHER_EVALUATION}`, permission: MANAGE, order: 78 }],
    recordKinds: suindaTeacherEvaluationRecordKinds,
  },
};
