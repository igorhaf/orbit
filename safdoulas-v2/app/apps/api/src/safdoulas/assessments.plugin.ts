import { Body, Controller, Get, HttpException, Inject, Param, Post, Req } from "@nestjs/common";
import type { AccessRequest, AccessService } from "../access/access";
import { AccessService as AccessServiceToken, id } from "../access/access";
import { Db } from "../db";
import { ExtensionRecords } from "../plugins/records/records.service";
import { PluginRegistry } from "../execution/registries";
import { WorkspacesService } from "../workspaces/workspaces.plugin";
import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue, ResolvedRecordReference } from "../plugins/contract";
import { eligibleAccreditorProfile } from "./accreditors.plugin";

const uuid = { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const text = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
const optionalText = (maxLength = 2000) => ({ type: "string", maxLength });
const list = (items: Record<string, unknown>, maxItems = 200) => ({ type: "array", items, maxItems });
const object = (properties: Record<string, Record<string, unknown>>, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const outcomes = ["A", "AP", "NA", "NSA", "D"] as const;
const managePermission = "plugin.safdoulas-assessments.manage";

type Ref = ResolvedRecordReference;
type Criterion = { code: string; evidence_required?: boolean; justification_required?: boolean };
type Answer = { criterion_code: string; outcome: string; justification?: string; observation?: string; evidence: Array<{ record_id: string; revision: number }> };
type EvaluatorProfileRef = { user_id: string; record_id: string; revision: number };

function error(code: string, path: string, message: string): RecordValidationIssue {
  return { severity: "error", code, path, message };
}

type RecommendationCandidate = {
  user_id: string; name: string; profile_record_id: string; profile_revision: number; region_code: string;
  expertise: string[]; active_assignments: number; total_assignments: number; max_parallel_assignments: number;
  matched_expertise: string[];
};
const stateRegions: Record<string, string> = {
  AC: "N", AP: "N", AM: "N", PA: "N", RO: "N", RR: "N", TO: "N",
  AL: "NE", BA: "NE", CE: "NE", MA: "NE", PB: "NE", PE: "NE", PI: "NE", RN: "NE", SE: "NE",
  DF: "CO", GO: "CO", MT: "CO", MS: "CO",
  ES: "SE", MG: "SE", RJ: "SE", SP: "SE",
  PR: "S", RS: "S", SC: "S",
};
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();

export function rankEvaluatorPairs(candidates: RecommendationCandidate[], providerState: string, requiredExpertise: string[]) {
  const targetRegion = stateRegions[providerState.toLocaleUpperCase("pt-BR")] || providerState.toLocaleUpperCase("pt-BR");
  const available = candidates.filter((candidate) => candidate.active_assignments < candidate.max_parallel_assignments);
  const scored = available.map((candidate) => {
    const region = candidate.region_code.toLocaleUpperCase("pt-BR");
    const macroRegion = stateRegions[region] || region;
    const matches = requiredExpertise.filter((required) => candidate.expertise.some((item) => normalize(item) === normalize(required) || normalize(item).includes(normalize(required)) || normalize(required).includes(normalize(item))));
    const score = (macroRegion === targetRegion ? 6 : 0) + Math.min(matches.length, 2) * 4
      - candidate.active_assignments * 12 - candidate.total_assignments * 0.25;
    return { ...candidate, macro_region: macroRegion, score, matched_expertise: matches };
  });
  const pairs: Array<{ score: number; evaluators: typeof scored; reasons: string[] }> = [];
  for (let left = 0; left < scored.length; left++) for (let right = left + 1; right < scored.length; right++) {
    const a = scored[left], b = scored[right];
    const reasons: string[] = [];
    if (a.macro_region !== b.macro_region) reasons.push("Combina avaliadoras de regiões diferentes.");
    else reasons.push(`As duas avaliadoras conhecem a região ${a.macro_region}.`);
    const expertise = [...new Set([...a.matched_expertise, ...b.matched_expertise])];
    if (expertise.length) reasons.push(`Experiência relacionada: ${expertise.join(", ")}.`);
    reasons.push("O rodízio favorece quem recebeu menos processos; a carga atual respeita a capacidade cadastrada.");
    pairs.push({ score: a.score + b.score + (a.macro_region === b.macro_region ? 0 : 10) + Math.min(expertise.length, 2), evaluators: [a, b], reasons });
  }
  return pairs.sort((a, b) => b.score - a.score || a.evaluators[0].user_id.localeCompare(b.evaluators[0].user_id) || a.evaluators[1].user_id.localeCompare(b.evaluators[1].user_id));
}

async function currentAssignmentCount(context: RecordValidationContext, userId: string): Promise<number | null> {
  if (!context.countLatestRecordsByPayloadValue) return null;
  const lockScope = `safdoulas-accreditor-capacity:${userId}`;
  const regular = await context.countLatestRecordsByPayloadValue("safdoulas-assessments", "evaluation_assignment", "assigned", "evaluator_user_ids", userId, lockScope, context.recordId);
  if (regular === null) return null;
  const third = await context.countLatestRecordsByPayloadValue("safdoulas-assessments", "third_review_assignment", "assigned", "evaluator_user_id", userId, lockScope, context.recordId);
  return third === null ? null : regular + third;
}

async function submittedEvaluationCount(context: RecordValidationContext, assignmentId: string): Promise<number | null> {
  return context.countLatestRecordsMatchingPayload?.(
    "safdoulas-assessments", "individual_evaluation", "submitted", { assignment_record_id: assignmentId }, undefined, context.recordId,
  ) ?? null;
}

async function evaluatorDocumentAccessEffects(from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext) {
  const effect: "grant" | "revoke" | null = from === "draft" && to === "assigned" ? "grant" : from === "assigned" && to === "completed" ? "revoke" : null;
  if (!effect) return [];
  const evaluatorIds = Array.isArray(payload.evaluator_user_ids)
    ? payload.evaluator_user_ids.filter((value): value is string => typeof value === "string")
    : typeof payload.evaluator_user_id === "string" ? [payload.evaluator_user_id] : [];
  const projections = Array.isArray(payload.blinded_projection_refs)
    ? payload.blinded_projection_refs as Array<{ record_id: string; revision: number }>
    : [];
  const documentIds = new Set<string>();
  const projectionIds = new Set<string>();
  for (const projectionRef of projections) {
    const projection = await ref(context, projectionRef.record_id, projectionRef.revision);
    if (projection?.pluginId !== "safdoulas-blinding" || projection.kind !== "blinded_projection" || projection.state !== "verified"
      || typeof projection.payload.blinded_document_record_id !== "string")
      throw new Error("A distribuição precisa apontar para projeções cegadas verificadas antes de alterar o acesso aos documentos.");
    documentIds.add(projection.payload.blinded_document_record_id);
    projectionIds.add(projection.id);
  }
  const scopeIds = [...new Set([...documentIds, ...projectionIds, ...(context.recordId ? [context.recordId] : [])])];
  return scopeIds.flatMap((recordId) => evaluatorIds.map((userId) => ({
    userId, roleId: "safdoulas_blinded_evaluator", recordId, effect,
  })));
}

async function assignmentTransitions(kind: "evaluation_assignment" | "third_review_assignment", state: string, _payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (state === "draft") return await authorizeAssignment("draft", "assigned", _payload, context) ? ["assigned"] : [];
  if (state !== "assigned" || !context.recordId) return [];
  const submitted = await submittedEvaluationCount(context, context.recordId);
  const expected = kind === "evaluation_assignment" ? 2 : 1;
  return submitted !== null && submitted >= expected ? ["completed"] : [];
}

async function authorizeAssignment(from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  if (!await context.hasPermission?.(managePermission)) return false;
  if (from === "draft" && to === "assigned") {
    if (typeof payload.process_record_id !== "string" || typeof payload.process_revision !== "number") return false;
    const process = await context.resolveRecord(payload.process_record_id, payload.process_revision);
    return process?.pluginId === "safdoulas-processes" && process.kind === "accreditation_process" && process.state === "review";
  }
  if (from === "assigned" && to === "completed" && context.recordId) {
    const expected = Array.isArray(payload.evaluator_user_ids) ? 2 : 1;
    const submitted = await submittedEvaluationCount(context, context.recordId);
    return submitted !== null && submitted >= expected;
  }
  return false;
}

async function ref(context: RecordValidationContext, id: unknown, revision: unknown): Promise<Ref | null> {
  return typeof id === "string" && Number.isInteger(revision) ? context.resolveRecord(id, Number(revision)) : null;
}

function matrixCriteria(matrix: Ref): Criterion[] {
  const dimensions = Array.isArray(matrix.payload.dimensions) ? matrix.payload.dimensions as Array<{ criteria?: Criterion[] }> : [];
  return dimensions.flatMap((dimension) => Array.isArray(dimension.criteria) ? dimension.criteria : []);
}

export async function assignmentIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const process = await ref(context, payload.process_record_id, payload.process_revision);
  const matrix = await ref(context, payload.matrix_record_id, payload.matrix_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process")
    issues.push(error("assessment_process_required", "process_record_id", "A distribuição deve apontar para um processo de acreditação válido."));
  if (!matrix || matrix.pluginId !== "assessments" || matrix.kind !== "matrix" || matrix.state !== "published")
    issues.push(error("assessment_matrix_required", "matrix_record_id", "Use uma matriz de avaliação publicada e versionada."));
  const evaluators = Array.isArray(payload.evaluator_user_ids) ? payload.evaluator_user_ids as string[] : [];
  if (evaluators.length !== 2 || new Set(evaluators).size !== 2)
    issues.push(error("two_independent_evaluators_required", "evaluator_user_ids", "A distribuição inicial exige exatamente duas acreditadoras distintas."));
  const evaluatorProfiles = Array.isArray(payload.evaluator_profile_refs) ? payload.evaluator_profile_refs as EvaluatorProfileRef[] : [];
  if (evaluatorProfiles.length !== 2 || new Set(evaluatorProfiles.map((item) => item.user_id)).size !== 2)
    issues.push(error("two_evaluator_profiles_required", "evaluator_profile_refs", "Vincule o perfil vigente de cada uma das duas acreditadoras designadas."));
  for (const [index, item] of evaluatorProfiles.entries()) {
    if (evaluators[index] !== item.user_id) {
      issues.push(error("evaluator_profile_mismatch", `evaluator_profile_refs[${index}].user_id`, "Cada perfil precisa corresponder à acreditadora indicada na mesma posição."));
      continue;
    }
    const profile = await ref(context, item.record_id, item.revision);
    if (!process || !profile || profile.pluginId !== "safdoulas-accreditors" || profile.kind !== "profile" || profile.state !== "active"
      || !(await eligibleAccreditorProfile(profile.payload, item.user_id, process, context))) {
      issues.push(error("evaluator_profile_ineligible", `evaluator_profile_refs[${index}]`, "A acreditadora precisa ter habilitação vigente, termo ético e declaração de conflitos atual, sem vínculo declarado com o processo."));
      continue;
    }
    const application = await ref(context, profile.payload.application_record_id, profile.payload.application_revision);
    const ethics = await ref(context, profile.payload.ethics_term_record_id, profile.payload.ethics_term_revision);
    if (!application || application.pluginId !== "safdoulas-accreditors" || application.kind !== "application" || application.state !== "approved")
      issues.push(error("approved_accreditor_application_required", `evaluator_profile_refs[${index}]`, "A habilitação precisa apontar para uma candidatura aprovada."));
    if (!ethics || ethics.pluginId !== "terms" || ethics.kind !== "term" || ethics.state !== "published")
      issues.push(error("published_ethics_term_required", `evaluator_profile_refs[${index}]`, "A acreditadora precisa ter aceitado uma versão publicada do termo ético."));
  }
  const capacityChecks = [...evaluatorProfiles].sort((left, right) => left.user_id.localeCompare(right.user_id));
  for (const item of capacityChecks) {
    const profile = await ref(context, item.record_id, item.revision);
    if (!profile || profile.pluginId !== "safdoulas-accreditors" || profile.kind !== "profile") continue;
    const maximum = profile.payload.max_parallel_assignments;
    const current = await currentAssignmentCount(context, item.user_id);
    if (!Number.isInteger(maximum) || Number(maximum) < 1 || current === null)
      issues.push(error("evaluator_capacity_unavailable", "evaluator_profile_refs", "Não foi possível verificar com segurança a capacidade atual da acreditadora."));
    else if (current >= Number(maximum))
      issues.push(error("evaluator_capacity_reached", "evaluator_profile_refs", "A acreditadora atingiu o limite configurado de processos simultâneos."));
  }
  if (evaluatorProfiles.length === 2 && evaluatorProfiles.some((item, index) => evaluators[index] !== item.user_id))
    issues.push(error("evaluator_profile_order_mismatch", "evaluator_profile_refs", "A ordem dos perfis deve corresponder às duas acreditadoras designadas."));
  const blindings = Array.isArray(payload.blinded_projection_refs) ? payload.blinded_projection_refs as Array<{ record_id: string; revision: number }> : [];
  if (!blindings.length) issues.push(error("blinded_material_required", "blinded_projection_refs", "Vincule as projeções cegadas que serão disponibilizadas às avaliadoras."));
  for (const [index, item] of blindings.entries()) {
    const projection = await ref(context, item.record_id, item.revision);
    if (!projection || projection.pluginId !== "safdoulas-blinding" || projection.kind !== "blinded_projection" || projection.state !== "verified")
      issues.push(error("unverified_blinded_material", `blinded_projection_refs[${index}]`, "Cada material da distribuição precisa ter uma projeção cegada verificada."));
    else if (process && projection.payload.process_record_id !== process.id)
      issues.push(error("blinded_material_process_mismatch", `blinded_projection_refs[${index}]`, "A projeção cegada precisa pertencer ao mesmo processo."));
  }
  if (process && matrix) {
    const rules = await ref(context, process.payload.ruleset_record_id, process.payload.ruleset_revision);
    const matrixId = rules?.payload.matrix_record_id;
    const matrixRevision = rules?.payload.matrix_revision;
    if (!rules || typeof matrixId !== "string" || typeof matrixRevision !== "number")
      issues.push(error("matrix_not_pinned", "matrix_record_id", "Fixe a versão da matriz no conjunto de regras do processo antes de distribuir a avaliação."));
    else if (matrix.id !== matrixId || matrix.revision !== matrixRevision)
      issues.push(error("matrix_ruleset_mismatch", "matrix_record_id", "A matriz precisa corresponder à versão fixada pelas regras do processo."));
  }
  return issues;
}

export async function thirdReviewAssignmentIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const process = await ref(context, payload.process_record_id, payload.process_revision);
  const matrix = await ref(context, payload.matrix_record_id, payload.matrix_revision);
  const consolidation = await ref(context, payload.consolidation_record_id, payload.consolidation_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process")
    issues.push(error("assessment_process_required", "process_record_id", "A terceira distribuição deve apontar para um processo de acreditação válido."));
  if (!matrix || matrix.pluginId !== "assessments" || matrix.kind !== "matrix" || matrix.state !== "published")
    issues.push(error("assessment_matrix_required", "matrix_record_id", "Use uma matriz de avaliação publicada e versionada."));
  if (!consolidation || consolidation.pluginId !== "safdoulas-assessments" || consolidation.kind !== "evaluation_consolidation" || consolidation.state !== "draft")
    issues.push(error("draft_consolidation_required", "consolidation_record_id", "A distribuição deve apontar para uma consolidação em revisão."));
  const divergences = Array.isArray(consolidation?.payload.divergences) ? consolidation.payload.divergences as Array<{ substantial?: boolean }> : [];
  if (!divergences.some((item) => item.substantial))
    issues.push(error("substantial_divergence_required", "consolidation_record_id", "A terceira avaliação só pode ser distribuída após registrar divergência substancial."));
  if (process && consolidation && consolidation.payload.process_record_id !== process.id)
    issues.push(error("consolidation_process_mismatch", "consolidation_record_id", "A consolidação pertence a outro processo."));
  if (matrix && consolidation && (consolidation.payload.matrix_record_id !== matrix.id || consolidation.payload.matrix_revision !== matrix.revision))
    issues.push(error("consolidation_matrix_mismatch", "matrix_record_id", "Use a mesma matriz fixada pelas avaliações comparadas."));
  const profileReference = payload.evaluator_profile_ref as EvaluatorProfileRef | undefined;
  const profile = profileReference && await ref(context, profileReference.record_id, profileReference.revision);
  if (!profile || profile.pluginId !== "safdoulas-accreditors" || profile.kind !== "profile" || profile.state !== "active"
    || !process || !(await eligibleAccreditorProfile(profile.payload, String(payload.evaluator_user_id), process, context)))
    issues.push(error("third_evaluator_profile_ineligible", "evaluator_profile_ref", "A terceira acreditadora precisa ter habilitação vigente e não pode ter vínculo declarado com o processo."));
  else {
    const application = await ref(context, profile.payload.application_record_id, profile.payload.application_revision);
    const ethics = await ref(context, profile.payload.ethics_term_record_id, profile.payload.ethics_term_revision);
    if (!application || application.pluginId !== "safdoulas-accreditors" || application.kind !== "application" || application.state !== "approved")
      issues.push(error("approved_third_accreditor_application_required", "evaluator_profile_ref", "A terceira habilitação precisa apontar para uma candidatura aprovada."));
    if (!ethics || ethics.pluginId !== "terms" || ethics.kind !== "term" || ethics.state !== "published")
      issues.push(error("published_third_ethics_term_required", "evaluator_profile_ref", "A terceira acreditadora precisa ter aceitado um termo ético publicado."));
    const maximum = profile.payload.max_parallel_assignments;
    const current = await currentAssignmentCount(context, String(payload.evaluator_user_id));
    if (!Number.isInteger(maximum) || Number(maximum) < 1 || current === null)
      issues.push(error("third_evaluator_capacity_unavailable", "evaluator_profile_ref", "Não foi possível verificar com segurança a capacidade da terceira acreditadora."));
    else if (current >= Number(maximum))
      issues.push(error("third_evaluator_capacity_reached", "evaluator_profile_ref", "A terceira acreditadora atingiu o limite configurado de processos simultâneos."));
  }
  const first = await ref(context, consolidation?.payload.first_evaluation_record_id, consolidation?.payload.first_evaluation_revision);
  const second = await ref(context, consolidation?.payload.second_evaluation_record_id, consolidation?.payload.second_evaluation_revision);
  if (!payload.evaluator_user_id || payload.evaluator_user_id === first?.payload.evaluator_user_id || payload.evaluator_user_id === second?.payload.evaluator_user_id)
    issues.push(error("third_evaluator_must_be_independent", "evaluator_user_id", "A terceira acreditadora deve ser diferente das duas primeiras."));
  const blindings = Array.isArray(payload.blinded_projection_refs) ? payload.blinded_projection_refs as Array<{ record_id: string; revision: number }> : [];
  if (!blindings.length) issues.push(error("blinded_material_required", "blinded_projection_refs", "Vincule as projeções cegadas disponíveis à terceira acreditadora."));
  for (const [index, item] of blindings.entries()) {
    const projection = await ref(context, item.record_id, item.revision);
    if (!projection || projection.pluginId !== "safdoulas-blinding" || projection.kind !== "blinded_projection" || projection.state !== "verified" || (process && projection.payload.process_record_id !== process.id))
      issues.push(error("invalid_third_review_material", `blinded_projection_refs[${index}]`, "O material deve ser uma projeção cegada verificada deste processo."));
  }
  return issues;
}

export async function evaluationIssues(payload: Record<string, unknown>, context: RecordValidationContext, requireComplete = false): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const assignment = await ref(context, payload.assignment_record_id, payload.assignment_revision);
  const role = payload.evaluation_role;
  const expectedAssignmentKind = role === "third" ? "third_review_assignment" : "evaluation_assignment";
  if (!assignment || assignment.pluginId !== "safdoulas-assessments" || assignment.kind !== expectedAssignmentKind || assignment.state !== "assigned") {
    issues.push(error("active_evaluation_assignment_required", "assignment_record_id", "A avaliação precisa pertencer a uma distribuição ativa."));
    return issues;
  }
  const evaluatorIds = Array.isArray(assignment.payload.evaluator_user_ids) ? assignment.payload.evaluator_user_ids as string[] : [];
  if (role === "first" && payload.evaluator_user_id !== evaluatorIds[0])
    issues.push(error("evaluator_assignment_mismatch", "evaluator_user_id", "A primeira avaliação deve ser preenchida pela pessoa designada."));
  if (role === "second" && payload.evaluator_user_id !== evaluatorIds[1])
    issues.push(error("evaluator_assignment_mismatch", "evaluator_user_id", "A segunda avaliação deve ser preenchida pela pessoa designada."));
  if (role === "third" && payload.evaluator_user_id !== assignment.payload.evaluator_user_id)
    issues.push(error("evaluator_assignment_mismatch", "evaluator_user_id", "A terceira avaliação deve ser preenchida pela acreditadora designada."));
  const assignedProfileRef = role === "third"
    ? assignment.payload.evaluator_profile_ref as EvaluatorProfileRef | undefined
    : (Array.isArray(assignment.payload.evaluator_profile_refs) ? assignment.payload.evaluator_profile_refs as EvaluatorProfileRef[] : [])
      .find((item) => item.user_id === payload.evaluator_user_id);
  if (!assignedProfileRef || assignedProfileRef.user_id !== payload.evaluator_user_id || !context.resolveLatestRecord) {
    issues.push(error("evaluator_current_status_unavailable", "evaluator_user_id", "Não foi possível confirmar a situação atual da acreditadora designada."));
  } else {
    const currentProfile = await context.resolveLatestRecord(assignedProfileRef.record_id);
    if (!currentProfile || currentProfile.pluginId !== "safdoulas-accreditors" || currentProfile.kind !== "profile"
      || currentProfile.state !== "active" || currentProfile.payload.profile_status !== "active")
      issues.push(error("evaluator_no_longer_active", "evaluator_user_id", "A acreditadora foi suspensa, desligada ou deixou de estar ativa; o acesso à avaliação foi revogado."));
  }
  if (typeof payload.evaluator_user_id === "string") {
    const match = { assignment_record_id: assignment.id, evaluator_user_id: payload.evaluator_user_id, evaluation_role: String(role) };
    const duplicateDrafts = await context.countLatestRecordsMatchingPayload?.("safdoulas-assessments", "individual_evaluation", "draft", match, `safdoulas-evaluation:${assignment.id}:${payload.evaluator_user_id}`, context.recordId) ?? null;
    const duplicateSubmissions = await context.countLatestRecordsMatchingPayload?.("safdoulas-assessments", "individual_evaluation", "submitted", match, `safdoulas-evaluation:${assignment.id}:${payload.evaluator_user_id}`, context.recordId) ?? null;
    if (duplicateDrafts === null || duplicateSubmissions === null)
      issues.push(error("evaluation_uniqueness_check_unavailable", "assignment_record_id", "Não foi possível confirmar se esta acreditadora já possui uma avaliação neste encargo."));
    else if (duplicateDrafts + duplicateSubmissions > 0)
      issues.push(error("duplicate_evaluator_assignment", "assignment_record_id", "Esta acreditadora já possui uma avaliação vinculada a esta distribuição."));
  }
  if (role === "third" && (!payload.consolidation_record_id || !payload.consolidation_revision))
    issues.push(error("third_review_reason_required", "consolidation_record_id", "A terceira avaliação precisa estar vinculada à consolidação que identificou divergência substancial."));
  if (context.actorId && payload.evaluator_user_id !== context.actorId && !(await context.hasPermission?.(managePermission)))
    issues.push(error("evaluation_actor_mismatch", "evaluator_user_id", "Somente a acreditadora designada ou a administração pode preparar esta avaliação."));

  const matrix = await ref(context, assignment.payload.matrix_record_id, assignment.payload.matrix_revision);
  if (!matrix) {
    issues.push(error("evaluation_matrix_unavailable", "assignment_record_id", "Não foi possível resolver a versão publicada da matriz fixada na distribuição."));
    return issues;
  }
  if (payload.process_record_id !== assignment.payload.process_record_id || payload.process_revision !== assignment.payload.process_revision || payload.matrix_record_id !== matrix.id || payload.matrix_revision !== matrix.revision)
    issues.push(error("evaluation_snapshot_mismatch", "assignment_record_id", "A avaliação precisa manter os snapshots de processo e matriz fixados na distribuição."));
  const criteria = matrixCriteria(matrix);
  if (role === "third") {
    if (payload.consolidation_record_id !== assignment.payload.consolidation_record_id || payload.consolidation_revision !== assignment.payload.consolidation_revision)
      issues.push(error("third_review_assignment_mismatch", "consolidation_record_id", "Use a consolidação fixada na distribuição da terceira avaliação."));
    if (context.actorId && payload.evaluator_user_id !== context.actorId && !(await context.hasPermission?.(managePermission)))
      issues.push(error("evaluation_actor_mismatch", "evaluator_user_id", "Somente a terceira acreditadora designada ou a administração pode preparar esta avaliação."));
  }
  const blindedRefs = Array.isArray(assignment.payload.blinded_projection_refs)
    ? assignment.payload.blinded_projection_refs as Array<{ record_id: string; revision: number }>
    : [];
  const allowedEvidence = new Set<string>();
  for (const projectionRef of blindedRefs) {
    const projection = await ref(context, projectionRef.record_id, projectionRef.revision);
    if (projection?.pluginId === "safdoulas-blinding" && projection.kind === "blinded_projection"
      && projection.state === "verified" && projection.payload.process_record_id === assignment.payload.process_record_id
      && typeof projection.payload.blinded_document_record_id === "string" && typeof projection.payload.blinded_document_revision === "number")
      allowedEvidence.add(`${projection.payload.blinded_document_record_id}:${projection.payload.blinded_document_revision}`);
  }
  const answers = Array.isArray(payload.answers) ? payload.answers as Answer[] : [];
  const seen = new Set<string>();
  for (const [index, answer] of answers.entries()) {
    if (seen.has(answer.criterion_code)) issues.push(error("duplicate_criterion_answer", `answers[${index}].criterion_code`, "Cada critério deve ter uma única resposta."));
    seen.add(answer.criterion_code);
    const criterion = criteria.find((item) => item.code === answer.criterion_code);
    if (!criterion) {
      issues.push(error("unknown_matrix_criterion", `answers[${index}].criterion_code`, "O critério não pertence à matriz fixada pela distribuição."));
      continue;
    }
    if (!outcomes.includes(answer.outcome as typeof outcomes[number]))
      issues.push(error("invalid_matrix_outcome", `answers[${index}].outcome`, "Use um dos estados da matriz: A, AP, NA, NSA ou D."));
    if (requireComplete && (criterion.justification_required || ["NA", "NSA", "D"].includes(answer.outcome)) && !answer.justification?.trim())
      issues.push(error("criterion_justification_required", `answers[${index}].justification`, "Este resultado exige justificativa."));
    if (requireComplete && criterion.evidence_required && !["D", "NSA"].includes(answer.outcome) && !answer.evidence.length)
      issues.push(error("criterion_evidence_required", `answers[${index}].evidence`, "Este critério exige pelo menos uma evidência."));
    for (const [evidenceIndex, evidence] of answer.evidence.entries()) {
      const document = await ref(context, evidence.record_id, evidence.revision);
      if (!document || document.pluginId !== "documents" || document.kind !== "document" || document.state !== "published")
        issues.push(error("invalid_assessment_evidence", `answers[${index}].evidence[${evidenceIndex}]`, "A evidência deve ser um documento publicado e versionado."));
      else if (document.payload.variant !== "anonymized" || !allowedEvidence.has(`${document.id}:${document.revision}`))
        issues.push(error("assessment_evidence_outside_blinded_assignment", `answers[${index}].evidence[${evidenceIndex}]`, "A evidência deve ser uma cópia anonimizada incluída nas projeções verificadas desta distribuição."));
    }
  }
  for (const criterion of requireComplete ? criteria : [])
    if (!seen.has(criterion.code)) issues.push(error("criterion_not_assessed", "answers", `O critério ${criterion.code} ainda não foi avaliado.`));
  if (requireComplete && !String(payload.preliminary_opinion || "").trim())
    issues.push(error("preliminary_opinion_required", "preliminary_opinion", "Registre um parecer preliminar fundamentado."));
  return issues;
}

async function authorizeEvaluatorTransition(_from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  if (to !== "submitted" || !(context.actorId === payload.evaluator_user_id || await context.hasPermission?.(managePermission))) return false;
  return !(await evaluationIssues(payload, context, true)).some((issue) => issue.severity === "error");
}

export function authorizeIndividualEvaluation(actorId: string, action: string, state: string, payload: Record<string, unknown>): boolean {
  if (actorId !== payload.evaluator_user_id) return false;
  if (action === "read") return true;
  return state === "draft" && (action === "write" || action === "publish");
}

export async function consolidationIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const first = await ref(context, payload.first_evaluation_record_id, payload.first_evaluation_revision);
  const second = await ref(context, payload.second_evaluation_record_id, payload.second_evaluation_revision);
  const valid = (item: Ref | null) => item?.pluginId === "safdoulas-assessments" && item.kind === "individual_evaluation" && item.state === "submitted";
  if (!first || !second || !valid(first) || !valid(second)) {
    issues.push(error("two_submitted_evaluations_required", "first_evaluation_record_id", "A consolidação exige duas avaliações individuais concluídas."));
    return issues;
  }
  if (first.id === second.id || first.payload.evaluator_user_id === second.payload.evaluator_user_id)
    issues.push(error("independent_evaluators_required", "second_evaluation_record_id", "As avaliações precisam vir de duas acreditadoras distintas."));
  for (const field of ["process_record_id", "process_revision", "assignment_record_id", "assignment_revision", "matrix_record_id", "matrix_revision"])
    if (first.payload[field] !== second.payload[field]) issues.push(error("evaluation_snapshot_mismatch", field, "As duas avaliações precisam usar o mesmo processo, distribuição e versão da matriz."));

  const expectedDivergences = divergentCriteria(first.payload, second.payload).map((item) => item.criterion_code);
  const declared = Array.isArray(payload.divergences) ? payload.divergences as Array<{ criterion_code: string; substantial: boolean; rationale?: string }> : [];
  const declaredCodes = declared.map((item) => item.criterion_code).sort();
  if (expectedDivergences.length !== declaredCodes.length || expectedDivergences.some((code, index) => code !== declaredCodes[index]))
    issues.push(error("divergence_set_mismatch", "divergences", "Registre cada critério divergente entre os pareceres, sem omissões ou itens extras."));
  declared.forEach((item, index) => {
    if (typeof item.substantial !== "boolean" || (item.substantial && !item.rationale?.trim()))
      issues.push(error("divergence_classification_required", `divergences[${index}]`, "Classifique a divergência e justifique quando ela for substancial."));
  });
  if (!String(payload.synthesis || "").trim() || !Array.isArray(payload.strengths) || !Array.isArray(payload.fragilities) || !Array.isArray(payload.diligence_items))
    issues.push(error("technical_opinion_incomplete", "synthesis", "A consolidação exige síntese, pontos fortes, fragilidades e itens de diligência."));
  if (payload.process_record_id !== first.payload.process_record_id || payload.process_revision !== first.payload.process_revision)
    issues.push(error("consolidation_process_mismatch", "process_record_id", "A consolidação deve apontar para o processo fixado nas duas avaliações."));
  return issues;
}

export async function consolidationTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (state !== "draft") return [];
  if ((await consolidationIssues(payload, context)).some((issue) => issue.severity === "error")) return [];
  const divergences = Array.isArray(payload.divergences) ? payload.divergences as Array<{ substantial: boolean }> : [];
  const substantial = divergences.some((item) => item.substantial);
  if (!substantial) return ["completed"];
  const third = await ref(context, payload.third_evaluation_record_id, payload.third_evaluation_revision);
  const first = await ref(context, payload.first_evaluation_record_id, payload.first_evaluation_revision);
  const second = await ref(context, payload.second_evaluation_record_id, payload.second_evaluation_revision);
  return third?.pluginId === "safdoulas-assessments" && third.kind === "individual_evaluation" && third.state === "submitted" && third.payload.evaluation_role === "third"
    && third.payload.process_record_id === payload.process_record_id && third.payload.process_revision === payload.process_revision
    && third.payload.matrix_record_id === payload.matrix_record_id && third.payload.matrix_revision === payload.matrix_revision
    && third.payload.evaluator_user_id !== first?.payload.evaluator_user_id && third.payload.evaluator_user_id !== second?.payload.evaluator_user_id
    ? ["completed"] : [];
}

async function authorizeConsolidation(_from: string, to: string, _payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  return to === "completed" && Boolean(await context.hasPermission?.(managePermission));
}

const recordKinds: Record<string, RecordKindContribution> = {
  evaluation_assignment: {
    label: "Distribuição de avaliações",
    schema: object({
      process_record_id: uuid,
      process_revision: { type: "integer", minimum: 1 },
      matrix_record_id: uuid,
      matrix_revision: { type: "integer", minimum: 1 },
      blinded_projection_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }, ["record_id", "revision"]), 100),
      evaluator_user_ids: { type: "array", minItems: 2, maxItems: 2, uniqueItems: true, items: uuid },
      evaluator_profile_refs: { type: "array", minItems: 2, maxItems: 2, items: object({ user_id: uuid, record_id: uuid, revision: { type: "integer", minimum: 1 } }) },
      assigned_at: { type: "string", format: "date-time" },
      assignment_note: optionalText(4000),
    }),
    initial: "draft",
    transitions: { draft: ["assigned"], assigned: ["completed"], completed: [] },
    immutable: ["completed"],
    resourceScoped: true,
    managePermission,
    authorizeRecord: (actorId, action, _state, payload) => action === "read"
      && (Array.isArray(payload.evaluator_user_ids) ? payload.evaluator_user_ids.includes(actorId) : payload.evaluator_user_id === actorId),
    recordRoleEffects: evaluatorDocumentAccessEffects,
    authorizeTransition: authorizeAssignment,
    availableTransitions: (_state, payload, context) => assignmentTransitions("evaluation_assignment", _state, payload, context),
    validate: assignmentIssues,
    example: {
      process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 3,
      matrix_record_id: "00000000-0000-4000-8000-000000000002", matrix_revision: 1,
      blinded_projection_refs: [{ record_id: "00000000-0000-4000-8000-000000000003", revision: 1 }],
      evaluator_user_ids: ["00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"],
      evaluator_profile_refs: [
        { user_id: "00000000-0000-4000-8000-000000000004", record_id: "00000000-0000-4000-8000-000000000014", revision: 1 },
        { user_id: "00000000-0000-4000-8000-000000000005", record_id: "00000000-0000-4000-8000-000000000015", revision: 1 },
      ],
      assigned_at: "2026-01-01T12:00:00Z", assignment_note: "Distribuição demonstrativa.",
    },
  },
  third_review_assignment: {
    label: "Distribuição para terceira avaliação",
    schema: object({
      process_record_id: uuid,
      process_revision: { type: "integer", minimum: 1 },
      matrix_record_id: uuid,
      matrix_revision: { type: "integer", minimum: 1 },
      consolidation_record_id: uuid,
      consolidation_revision: { type: "integer", minimum: 1 },
      evaluator_profile_ref: object({ user_id: uuid, record_id: uuid, revision: { type: "integer", minimum: 1 } }),
      blinded_projection_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }, ["record_id", "revision"]), 100),
      evaluator_user_id: uuid,
      assigned_at: { type: "string", format: "date-time" },
      assignment_note: optionalText(4000),
    }),
    initial: "draft",
    transitions: { draft: ["assigned"], assigned: ["completed"], completed: [] },
    immutable: ["completed"],
    resourceScoped: true,
    managePermission,
    authorizeRecord: (actorId, action, _state, payload) => action === "read" && payload.evaluator_user_id === actorId,
    recordRoleEffects: evaluatorDocumentAccessEffects,
    authorizeTransition: authorizeAssignment,
    availableTransitions: (_state, payload, context) => assignmentTransitions("third_review_assignment", _state, payload, context),
    validate: thirdReviewAssignmentIssues,
    example: {
      process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 3,
      matrix_record_id: "00000000-0000-4000-8000-000000000002", matrix_revision: 1,
      consolidation_record_id: "00000000-0000-4000-8000-000000000013", consolidation_revision: 1,
      blinded_projection_refs: [{ record_id: "00000000-0000-4000-8000-000000000003", revision: 1 }],
      evaluator_user_id: "00000000-0000-4000-8000-000000000010", assigned_at: "2026-01-01T12:00:00Z",
      evaluator_profile_ref: { user_id: "00000000-0000-4000-8000-000000000010", record_id: "00000000-0000-4000-8000-000000000016", revision: 1 },
      assignment_note: "Distribuição demonstrativa após divergência substancial.",
    },
  },
  individual_evaluation: {
    label: "Avaliação individual",
    schema: object({
      assignment_record_id: uuid,
      assignment_revision: { type: "integer", minimum: 1 },
      process_record_id: uuid,
      process_revision: { type: "integer", minimum: 1 },
      matrix_record_id: uuid,
      matrix_revision: { type: "integer", minimum: 1 },
      evaluation_role: { type: "string", enum: ["first", "second", "third"] },
      evaluator_user_id: uuid,
      consolidation_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      consolidation_revision: { type: ["integer", "null"], minimum: 1 },
      answers: list(object({
        criterion_code: text(120),
        outcome: { type: "string", enum: [...outcomes] },
        justification: optionalText(12000),
        observation: optionalText(12000),
        evidence: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }, ["record_id", "revision"]), 50),
      }, ["criterion_code", "outcome", "evidence"]), 500),
      dimension_summaries: list(object({ dimension_code: text(120), summary: text(12000) }, ["dimension_code", "summary"]), 100),
      strengths: list(text(4000), 100),
      fragilities: list(text(4000), 100),
      inconsistencies: list(text(4000), 100),
      diligence_items: list(object({ request: text(4000), rationale: text(4000), evidence_reference: optionalText(1000) }, ["request", "rationale"]), 100),
      preliminary_opinion: text(16000),
      signature_reference: optionalText(1000),
      signed_at: { type: ["string", "null"], format: "date-time" },
    }),
    initial: "draft",
    transitions: { draft: ["submitted"], submitted: [] },
    immutable: ["submitted"],
    resourceScoped: true,
    managePermission,
    authorizeRecord: (actorId, action, state, payload) => authorizeIndividualEvaluation(actorId, action, state, payload),
    authorizeTransition: authorizeEvaluatorTransition,
    validate: evaluationIssues,
    example: {
      assignment_record_id: "00000000-0000-4000-8000-000000000006", assignment_revision: 1,
      process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 3,
      matrix_record_id: "00000000-0000-4000-8000-000000000002", matrix_revision: 1,
      evaluation_role: "first", evaluator_user_id: "00000000-0000-4000-8000-000000000004",
      consolidation_record_id: null, consolidation_revision: null, answers: [], dimension_summaries: [],
      strengths: [], fragilities: [], inconsistencies: [], diligence_items: [], preliminary_opinion: "Parecer fundamentado.",
      signature_reference: "", signed_at: null,
    },
  },
  evaluation_consolidation: {
    label: "Consolidação de avaliações",
    schema: object({
      process_record_id: uuid,
      process_revision: { type: "integer", minimum: 1 },
      matrix_record_id: uuid,
      matrix_revision: { type: "integer", minimum: 1 },
      first_evaluation_record_id: uuid,
      first_evaluation_revision: { type: "integer", minimum: 1 },
      second_evaluation_record_id: uuid,
      second_evaluation_revision: { type: "integer", minimum: 1 },
      divergences: list(object({ criterion_code: text(120), substantial: { type: "boolean" }, rationale: optionalText(4000) }, ["criterion_code", "substantial"]), 500),
      third_evaluation_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      third_evaluation_revision: { type: ["integer", "null"], minimum: 1 },
      synthesis: text(16000),
      strengths: list(text(4000), 100),
      fragilities: list(text(4000), 100),
      diligence_items: list(object({ request: text(4000), rationale: text(4000), evidence_reference: optionalText(1000) }, ["request", "rationale"]), 100),
      conclusion: text(12000),
      final_opinion_template_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      final_opinion_template_revision: { type: ["integer", "null"], minimum: 1 },
      signature_reference: optionalText(1000),
      signed_at: { type: ["string", "null"], format: "date-time" },
    }),
    initial: "draft",
    transitions: { draft: ["completed"], completed: [] },
    immutable: ["completed"],
    resourceScoped: true,
    managePermission,
    availableTransitions: consolidationTransitions,
    authorizeTransition: authorizeConsolidation,
    validate: consolidationIssues,
    example: {
      process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 3,
      matrix_record_id: "00000000-0000-4000-8000-000000000002", matrix_revision: 1,
      first_evaluation_record_id: "00000000-0000-4000-8000-000000000007", first_evaluation_revision: 1,
      second_evaluation_record_id: "00000000-0000-4000-8000-000000000008", second_evaluation_revision: 1,
      divergences: [], third_evaluation_record_id: null, third_evaluation_revision: null,
      synthesis: "Síntese comparativa.", strengths: [], fragilities: [], diligence_items: [], conclusion: "Conclusão técnica.",
      final_opinion_template_record_id: null, final_opinion_template_revision: null, signature_reference: "", signed_at: null,
    },
  },
};

export const safdoulasAssessmentsPlugin: PluginDefinition = {
  id: "safdoulas-assessments",
  name: "Avaliação SAFDOULAS",
  version: "1.0.0",
  description: "Distribui análises independentes, registra avaliações por critério e consolida divergências sobre matrizes e documentos cegados versionados.",
  scope: "workspace",
  handlesRoute: (path) => /^\/safdoulas\/assessments\/workspaces\/[a-fA-F0-9-]{36}\/(?:processes\/[a-fA-F0-9-]{36}\/recommendations|my-assignments|assignments\/[a-fA-F0-9-]{36}\/start|ready-to-consolidate|consolidations\/[a-fA-F0-9-]{36}\/(?:third-candidates|third-result))$/.test(path),
  routePermission: (path, method) => path.endsWith("/recommendations") || path.endsWith("/ready-to-consolidate") || path.endsWith("/third-candidates") || path.endsWith("/third-result") ? managePermission
    : method === "GET" ? "plugin.safdoulas-assessments.read" : "plugin.safdoulas-assessments.write",
  dependencies: ["versioned-records", "assessments", "safdoulas-processes", "safdoulas-accreditors", "safdoulas-blinding", "documents", "privacy"],
  capabilities: ["read", "write", "publish", "manage"].map((action) => ({
    id: action,
    name: action === "read" ? "Consultar avaliações" : action === "write" ? "Preencher avaliação" : action === "publish" ? "Consolidar pareceres" : "Distribuir e administrar avaliações",
    permissions: [`plugin.safdoulas-assessments.${action}`],
  })),
  contributions: {
    navigation: [{ id: "safdoulas-assessments", href: "/safdoulas/assessments", label: "Avaliação" , permission: "plugin.safdoulas-assessments.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "workflow", "label": "Tramitação", "order": 2}, order: 3}],
    recordKinds,
  },
};

type AssignmentSourceRecord = { id: string; kind: string; state: string; revision: number; payload: Record<string, unknown> };
type SubmittedEvaluationRow = {
  assignment_id: string; assignment_kind: string; assignment_state: string; assignment_revision: number; assignment_payload: Record<string, unknown>;
  evaluation_id: string; evaluation_revision: number; evaluation_payload: Record<string, unknown>;
};

export function divergentCriteria(first: Record<string, unknown>, second: Record<string, unknown>) {
  const firstAnswers = new Map(((first.answers as Answer[]) || []).map((answer) => [answer.criterion_code, answer]));
  const secondAnswers = new Map(((second.answers as Answer[]) || []).map((answer) => [answer.criterion_code, answer]));
  return [...firstAnswers.keys()].filter((code) => firstAnswers.get(code)?.outcome !== secondAnswers.get(code)?.outcome)
    .sort().map((criterionCode) => ({
      criterion_code: criterionCode,
      first_outcome: firstAnswers.get(criterionCode)?.outcome || "",
      second_outcome: secondAnswers.get(criterionCode)?.outcome || "",
      substantial: false,
      rationale: "",
    }));
}

@Controller("safdoulas/assessments")
export class SafdoulasAssessmentRecommendationController {
  constructor(
    @Inject(ExtensionRecords) private readonly records: ExtensionRecords,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
    @Inject(WorkspacesService) private readonly workspaces: WorkspacesService,
    @Inject(AccessServiceToken) private readonly access: AccessService,
    @Inject(Db) private readonly db: Db,
  ) {}

  @Get("workspaces/:workspaceId/ready-to-consolidate")
  async readyToConsolidate(@Req() request: AccessRequest, @Param("workspaceId") workspaceId: string) {
    const workspace = id(workspaceId), actorId = String(request.orbitActor);
    await this.access.require(actorId, managePermission);
    await this.workspaces.shared(actorId, workspace);
    if (!this.plugins.isEnabled("safdoulas-assessments")) throw new HttpException("O plugin de avaliação ou uma dependência está desativado.", 409);
    const rows = await this.db.query<SubmittedEvaluationRow>(`WITH latest AS (
      SELECT DISTINCT ON (r.id) r.id,r.kind,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.workspace_id=$1 AND r.plugin_id='safdoulas-assessments'
        AND r.kind IN ('evaluation_assignment','individual_evaluation','evaluation_consolidation')
      ORDER BY r.id,v.revision DESC
    ) SELECT a.id AS assignment_id,a.kind AS assignment_kind,a.state AS assignment_state,a.revision AS assignment_revision,a.payload AS assignment_payload,
        e.id AS evaluation_id,e.revision AS evaluation_revision,e.payload AS evaluation_payload
      FROM latest a JOIN latest e ON e.payload->>'assignment_record_id'=a.id
      WHERE a.kind='evaluation_assignment' AND a.state IN ('assigned','completed')
        AND e.kind='individual_evaluation' AND e.state='submitted'
      ORDER BY a.id,e.id`, [workspace]);
    const grouped = new Map<string, { assignment: SubmittedEvaluationRow; evaluations: SubmittedEvaluationRow[] }>();
    for (const row of rows) {
      const entry = grouped.get(row.assignment_id) || { assignment: row, evaluations: [] };
      entry.evaluations.push(row);
      grouped.set(row.assignment_id, entry);
    }
    const ready = [];
    for (const [assignmentId, entry] of grouped) {
      const first = entry.evaluations.find((row) => row.evaluation_payload.evaluation_role === "first");
      const second = entry.evaluations.find((row) => row.evaluation_payload.evaluation_role === "second");
      if (!first || !second || first.evaluation_payload.evaluator_user_id === second.evaluation_payload.evaluator_user_id) continue;
      const existingRows = await this.db.query<AssignmentSourceRecord>(`SELECT r.id,r.kind,r.title,v.state,v.revision,v.payload
        FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
        WHERE r.workspace_id=$1 AND r.plugin_id='safdoulas-assessments' AND r.kind='evaluation_consolidation'
          AND v.revision=(SELECT MAX(v2.revision) FROM extension_record_versions v2 WHERE v2.record_id=r.id)
          AND v.payload->>'first_evaluation_record_id'=$2 AND v.payload->>'second_evaluation_record_id'=$3
        ORDER BY r.updated_at DESC LIMIT 1`, [workspace, first.evaluation_id, second.evaluation_id]);
      const existingConsolidation = existingRows[0];
      if (existingConsolidation?.state === "completed") continue;
      const processId = String(entry.assignment.assignment_payload.process_record_id || "");
      const processRevision = Number(entry.assignment.assignment_payload.process_revision);
      const matrixId = String(entry.assignment.assignment_payload.matrix_record_id || "");
      const matrixRevision = Number(entry.assignment.assignment_payload.matrix_revision);
      const [process, matrix] = await Promise.all([
        this.db.query<ResolvedRecordReference>(`SELECT r.id,r.plugin_id AS "pluginId",r.kind,v.state,v.revision,v.payload
          FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
          WHERE r.id=$1 AND r.workspace_id=$2 AND v.revision=$3`, [id(processId), workspace, processRevision]),
        this.db.query<ResolvedRecordReference>(`SELECT r.id,r.plugin_id AS "pluginId",r.kind,v.state,v.revision,v.payload
          FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
          WHERE r.id=$1 AND r.workspace_id=$2 AND v.revision=$3`, [id(matrixId), workspace, matrixRevision]),
      ]);
      if (process[0]?.pluginId !== "safdoulas-processes" || process[0].kind !== "accreditation_process"
        || matrix[0]?.pluginId !== "assessments" || matrix[0].kind !== "matrix") continue;
      await Promise.all([assignmentId, first.evaluation_id, second.evaluation_id].map((recordId) => this.access.audit(
        actorId, "safdoulas-assessments.consolidation.read", recordId, { type: "extension_record", id: recordId },
      )));
      await Promise.all([process[0].id, matrix[0].id].map((recordId) => this.access.audit(
        actorId, "safdoulas-assessments.consolidation.read", recordId, { type: "extension_record", id: recordId },
      )));
      if (existingConsolidation) await this.access.audit(actorId, "safdoulas-assessments.consolidation.read", existingConsolidation.id, { type: "extension_record", id: existingConsolidation.id });
      ready.push({
        assignment: { id: assignmentId, revision: entry.assignment.assignment_revision, state: entry.assignment.assignment_state },
        process: { protocol_number: process[0].payload.protocol_number || "" },
        matrix: { id: matrix[0].id, revision: matrix[0].revision, dimensions: matrix[0].payload.dimensions },
        first: { id: first.evaluation_id, revision: first.evaluation_revision, payload: first.evaluation_payload },
        second: { id: second.evaluation_id, revision: second.evaluation_revision, payload: second.evaluation_payload },
        divergences: divergentCriteria(first.evaluation_payload, second.evaluation_payload),
        assignment_payload: entry.assignment.assignment_payload,
        consolidation: existingConsolidation ? { id: existingConsolidation.id, revision: existingConsolidation.revision, state: existingConsolidation.state, payload: existingConsolidation.payload } : null,
      });
    }
    return ready;
  }

  @Get("workspaces/:workspaceId/consolidations/:consolidationId/third-candidates")
  async thirdCandidates(@Req() request: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("consolidationId") consolidationId: string) {
    const workspace = id(workspaceId), consolidationKey = id(consolidationId), actorId = String(request.orbitActor);
    await this.access.require(actorId, managePermission);
    await this.workspaces.shared(actorId, workspace);
    const latest = await this.db.query<AssignmentSourceRecord>(`SELECT r.id,r.kind,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.id=$1 AND r.workspace_id=$2 AND r.plugin_id='safdoulas-assessments' AND r.kind='evaluation_consolidation'
        AND v.revision=(SELECT MAX(v2.revision) FROM extension_record_versions v2 WHERE v2.record_id=r.id)`, [consolidationKey, workspace]);
    const consolidation = latest[0];
    if (!consolidation || consolidation.state !== "draft") throw new HttpException("A consolidação não está disponível para preparar uma terceira avaliação.", 404);
    if (!this.plugins.isEnabled("safdoulas-assessments")) throw new HttpException("O plugin de avaliação ou uma dependência está desativado.", 409);
    await this.access.audit(actorId, "safdoulas-assessments.third-review.prepare", consolidation.id, { type: "extension_record", id: consolidation.id });
    const existingAssignments = await this.db.query<AssignmentSourceRecord>(`WITH latest AS (
      SELECT DISTINCT ON (r.id) r.id,r.kind,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.workspace_id=$1 AND r.plugin_id='safdoulas-assessments' AND r.kind='third_review_assignment'
      ORDER BY r.id,v.revision DESC
    ) SELECT * FROM latest WHERE kind='third_review_assignment' AND state IN ('assigned','completed')
      AND payload->>'consolidation_record_id'=$2 ORDER BY id DESC`, [workspace, consolidationKey]);
    if (existingAssignments.length > 1) throw new HttpException("Há múltiplas terceiras distribuições para esta consolidação; revise a trilha antes de continuar.", 409);
    const divergences = Array.isArray(consolidation.payload.divergences) ? consolidation.payload.divergences as Array<{ substantial?: boolean }> : [];
    if (!divergences.some((item) => item.substantial)) throw new HttpException("Não há divergência substancial que justifique terceira avaliação.", 409);
    const resolveRecord = async (recordId: string, revision: number): Promise<ResolvedRecordReference | null> => {
      if (!Number.isInteger(revision) || revision < 1) return null;
      const rows = await this.db.query<ResolvedRecordReference>(`SELECT r.id,r.plugin_id AS "pluginId",r.kind,v.state,v.revision,v.payload
        FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
        WHERE r.id=$1 AND r.workspace_id=$2 AND v.revision=$3`, [id(recordId), workspace, revision]);
      return rows[0] || null;
    };
    const process = await resolveRecord(String(consolidation.payload.process_record_id || ""), Number(consolidation.payload.process_revision));
    const first = await resolveRecord(String(consolidation.payload.first_evaluation_record_id || ""), Number(consolidation.payload.first_evaluation_revision));
    const second = await resolveRecord(String(consolidation.payload.second_evaluation_record_id || ""), Number(consolidation.payload.second_evaluation_revision));
    if (!process || process.pluginId !== "safdoulas-processes" || !first || !second
      || first.kind !== "individual_evaluation" || second.kind !== "individual_evaluation")
      throw new HttpException("As versões de processo e avaliações fixadas na consolidação não estão disponíveis.", 409);
    const excludedUsers = new Set([first.payload.evaluator_user_id, second.payload.evaluator_user_id]);
    const validationContext: RecordValidationContext = {
      actorId,
      resolveRecord,
      hasAcceptedTerm: async (recordId, revision, userId) => Boolean(await this.db.one(
        "SELECT 1 FROM extension_term_acceptances WHERE record_id=$1 AND revision=$2 AND user_id=$3 LIMIT 1",
        [id(recordId), revision, id(userId)],
      )),
    };
    const profiles = (await this.records.list("safdoulas-accreditors", workspace, actorId) as AssignmentSourceRecord[])
      .filter((record) => record.kind === "profile");
    const workloadRows = await this.db.query<{ user_id: string; active_assignments: number; total_assignments: number }>(`WITH latest AS (
      SELECT DISTINCT ON (r.id) r.kind,v.state,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.workspace_id=$1 AND r.plugin_id='safdoulas-assessments' AND r.kind IN ('evaluation_assignment','third_review_assignment')
      ORDER BY r.id,v.revision DESC
    ), assignments AS (
      SELECT state,jsonb_array_elements_text(payload->'evaluator_user_ids') AS user_id FROM latest
      WHERE kind='evaluation_assignment' AND state IN ('assigned','completed')
      UNION ALL
      SELECT state,payload->>'evaluator_user_id' AS user_id FROM latest
      WHERE kind='third_review_assignment' AND state IN ('assigned','completed') AND payload ? 'evaluator_user_id'
    ) SELECT user_id,COUNT(*) FILTER (WHERE state='assigned')::int AS active_assignments,COUNT(*)::int AS total_assignments
      FROM assignments GROUP BY user_id`, [workspace]);
    const workload = new Map(workloadRows.map((row) => [row.user_id, row]));
    const profileUserIds = profiles.map((profile) => String(profile.payload.user_id)).filter((userId) => /^[a-fA-F0-9-]{36}$/.test(userId));
    const accounts = profileUserIds.length ? await this.db.query<{ id: string; name: string }>(
      "SELECT id::text AS id,name FROM users WHERE id=ANY($1::uuid[]) AND NOT disabled", [profileUserIds],
    ) : [];
    const names = new Map(accounts.map((account) => [account.id, account.name]));
    const candidates = [];
    for (const profile of profiles) {
      const userId = String(profile.payload.user_id || "");
      const usage = workload.get(userId);
      const active = usage?.active_assignments || 0, total = usage?.total_assignments || 0;
      if (excludedUsers.has(userId) || !names.has(userId) || profile.state !== "active" || profile.payload.profile_status !== "active"
        || !Number.isInteger(profile.payload.max_parallel_assignments) || active >= Number(profile.payload.max_parallel_assignments)
        || !await eligibleAccreditorProfile(profile.payload, userId, { pluginId: process.pluginId, kind: process.kind, payload: process.payload }, validationContext)) continue;
      candidates.push({ user_id: userId, name: names.get(userId), profile_record_id: profile.id, profile_revision: profile.revision,
        region_code: String(profile.payload.region_code || ""), active_assignments: active, total_assignments: total,
        max_parallel_assignments: Number(profile.payload.max_parallel_assignments) });
    }
    const existing = existingAssignments[0];
    const existingUserId = typeof existing?.payload.evaluator_user_id === "string" ? existing.payload.evaluator_user_id : "";
    const existingAccount = existingUserId ? await this.db.one<{ name: string }>("SELECT name FROM users WHERE id=$1", [id(existingUserId)]) : null;
    return {
      candidates: existing ? [] : candidates.sort((a, b) => a.active_assignments - b.active_assignments || a.total_assignments - b.total_assignments || a.user_id.localeCompare(b.user_id)),
      assignment: existing ? { id: existing.id, revision: existing.revision, state: existing.state, evaluator_name: existingAccount?.name || "Acreditadora designada" } : null,
    };
  }

  @Get("workspaces/:workspaceId/consolidations/:consolidationId/third-result")
  async thirdResult(@Req() request: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("consolidationId") consolidationId: string) {
    const workspace = id(workspaceId), consolidationKey = id(consolidationId), actorId = String(request.orbitActor);
    await this.access.require(actorId, managePermission);
    await this.workspaces.shared(actorId, workspace);
    if (!this.plugins.isEnabled("safdoulas-assessments")) throw new HttpException("O plugin de avaliação ou uma dependência está desativado.", 409);
    await this.access.audit(actorId, "safdoulas-assessments.third-evaluation.check", consolidationKey, { type: "extension_record", id: consolidationKey });
    const consolidationRows = await this.db.query<AssignmentSourceRecord>(`SELECT r.id,r.kind,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.id=$1 AND r.workspace_id=$2 AND r.plugin_id='safdoulas-assessments' AND r.kind='evaluation_consolidation'
        AND v.revision=(SELECT MAX(v2.revision) FROM extension_record_versions v2 WHERE v2.record_id=r.id)`, [consolidationKey, workspace]);
    const consolidation = consolidationRows[0];
    if (!consolidation || consolidation.state !== "draft") throw new HttpException("A consolidação não está em revisão.", 404);
    const rows = await this.db.query<AssignmentSourceRecord>(`WITH latest AS (
      SELECT DISTINCT ON (r.id) r.id,r.kind,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.workspace_id=$1 AND r.plugin_id='safdoulas-assessments' AND r.kind='individual_evaluation'
      ORDER BY r.id,v.revision DESC
    ) SELECT * FROM latest WHERE kind='individual_evaluation' AND state='submitted'
      AND payload->>'evaluation_role'='third' AND payload->>'consolidation_record_id'=$2 ORDER BY id DESC`, [workspace, consolidationKey]);
    if (rows.length > 1) throw new HttpException("Há mais de uma terceira avaliação submetida para esta consolidação; revise a trilha antes de concluir.", 409);
    if (!rows[0]) return null;
    const assignments = await this.db.query<AssignmentSourceRecord>(`WITH latest AS (
      SELECT DISTINCT ON (r.id) r.id,r.kind,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.workspace_id=$1 AND r.plugin_id='safdoulas-assessments' AND r.kind='third_review_assignment'
      ORDER BY r.id,v.revision DESC
    ) SELECT * FROM latest WHERE kind='third_review_assignment' AND payload->>'consolidation_record_id'=$2 ORDER BY id DESC`, [workspace, consolidationKey]);
    if (assignments.length !== 1 || assignments[0].payload.evaluator_user_id !== rows[0].payload.evaluator_user_id)
      throw new HttpException("A terceira avaliação não corresponde a uma distribuição única e íntegra.", 409);
    await Promise.all([consolidationKey, rows[0].id, assignments[0].id].map((recordId) => this.access.audit(
      actorId, "safdoulas-assessments.third-evaluation.read", recordId, { type: "extension_record", id: recordId },
    )));
    return { evaluation: rows[0], assignment: { id: assignments[0].id, revision: assignments[0].revision, state: assignments[0].state } };
  }

  @Get("workspaces/:workspaceId/my-assignments")
  async myAssignments(@Req() request: AccessRequest, @Param("workspaceId") workspaceId: string) {
    const workspace = id(workspaceId), actorId = String(request.orbitActor);
    await this.access.require(actorId, "plugin.safdoulas-assessments.read");
    await this.workspaces.shared(actorId, workspace);
    if (!this.plugins.isEnabled("safdoulas-assessments")) throw new HttpException("O plugin de avaliação ou uma dependência está desativado.", 409);
    const assignments = await this.db.query<AssignmentSourceRecord>(`WITH latest AS (
      SELECT DISTINCT ON (r.id) r.id,r.kind,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.workspace_id=$1 AND r.plugin_id='safdoulas-assessments' AND r.kind IN ('evaluation_assignment','third_review_assignment')
      ORDER BY r.id,v.revision DESC
    ) SELECT * FROM latest WHERE state='assigned' AND (
      payload->'evaluator_user_ids' @> jsonb_build_array($2::text) OR payload->>'evaluator_user_id'=$2
    ) ORDER BY title,id`, [workspace, actorId]);
    return Promise.all(assignments.map((assignment) => this.assignmentView(workspace, actorId, assignment)));
  }

  @Post("workspaces/:workspaceId/assignments/:assignmentId/start")
  async startEvaluation(@Req() request: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("assignmentId") assignmentId: string, @Body() body: Record<string, unknown>) {
    if (Object.keys(body || {}).some((key) => key !== "operation_key") || typeof body?.operation_key !== "string" || !/^[a-fA-F0-9-]{36}$/.test(body.operation_key))
      throw new HttpException("Informe somente uma chave de operação válida.", 400);
    const workspace = id(workspaceId), assignmentKey = id(assignmentId), actorId = String(request.orbitActor);
    await this.access.require(actorId, "plugin.safdoulas-assessments.write");
    await this.workspaces.shared(actorId, workspace);
    if (!this.plugins.isEnabled("safdoulas-assessments")) throw new HttpException("O plugin de avaliação ou uma dependência está desativado.", 409);
    const row = await this.db.query<AssignmentSourceRecord>(`SELECT r.id,r.kind,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.id=$1 AND r.workspace_id=$2 AND r.plugin_id='safdoulas-assessments'
        AND v.revision=(SELECT MAX(v2.revision) FROM extension_record_versions v2 WHERE v2.record_id=r.id)`, [assignmentKey, workspace]);
    const assignment = row[0];
    if (!assignment || assignment.state !== "assigned" || !["evaluation_assignment", "third_review_assignment"].includes(assignment.kind))
      throw new HttpException("A distribuição não está ativa ou não pertence a este workspace.", 404);
    if (assignment.kind === "third_review_assignment" && assignment.payload.evaluator_user_id !== actorId)
      throw new HttpException("Esta distribuição não está designada para sua conta.", 403);
    const evaluatorIds = Array.isArray(assignment.payload.evaluator_user_ids) ? assignment.payload.evaluator_user_ids as string[] : [];
    const evaluatorIndex = evaluatorIds.indexOf(actorId);
    const role = assignment.kind === "third_review_assignment" ? "third" : evaluatorIndex === 0 ? "first" : evaluatorIndex === 1 ? "second" : "";
    if (!role) throw new HttpException("Esta distribuição não está designada para sua conta.", 403);
    const existing = await this.db.query<AssignmentSourceRecord>(`SELECT r.id,r.kind,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.workspace_id=$1 AND r.plugin_id='safdoulas-assessments' AND r.kind='individual_evaluation'
        AND v.revision=(SELECT MAX(v2.revision) FROM extension_record_versions v2 WHERE v2.record_id=r.id)
        AND v.payload->>'assignment_record_id'=$2 AND v.payload->>'evaluator_user_id'=$3 AND v.payload->>'evaluation_role'=$4
        AND v.state IN ('draft','submitted') ORDER BY r.updated_at DESC LIMIT 1`, [workspace, assignment.id, actorId, role]);
    const task = await this.assignmentView(workspace, actorId, assignment, existing[0] || null);
    if (existing[0]) return task;
    const matrix = task.matrix;
    const payload: Record<string, unknown> = {
      assignment_record_id: assignment.id, assignment_revision: assignment.revision,
      process_record_id: assignment.payload.process_record_id, process_revision: assignment.payload.process_revision,
      matrix_record_id: matrix.id, matrix_revision: matrix.revision, evaluation_role: role, evaluator_user_id: actorId,
      consolidation_record_id: role === "third" ? assignment.payload.consolidation_record_id : null,
      consolidation_revision: role === "third" ? assignment.payload.consolidation_revision : null,
      answers: [], dimension_summaries: [], strengths: [], fragilities: [], inconsistencies: [], diligence_items: [],
      preliminary_opinion: "Em elaboração.", signature_reference: "", signed_at: null,
    };
    const evaluation = await this.records.create("safdoulas-assessments", workspace, actorId, {
      kind: "individual_evaluation", title: `Parecer individual · ${role}`, payload, operation_key: body.operation_key,
    }) as AssignmentSourceRecord;
    return { ...task, evaluation };
  }

  private async assignmentView(workspace: string, actorId: string, assignment: AssignmentSourceRecord, evaluation?: AssignmentSourceRecord | null) {
    const resolvePinned = async (recordId: unknown, revision: unknown) => {
      if (typeof recordId !== "string" || !Number.isInteger(revision)) return null;
      const rows = await this.db.query<ResolvedRecordReference>(`SELECT r.id,r.plugin_id AS "pluginId",r.kind,v.state,v.revision,v.payload
        FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
        WHERE r.id=$1 AND r.workspace_id=$2 AND v.revision=$3`, [id(recordId), workspace, Number(revision)]);
      return rows[0] || null;
    };
    const matrix = await resolvePinned(assignment.payload.matrix_record_id, assignment.payload.matrix_revision);
    if (!matrix || matrix.pluginId !== "assessments" || matrix.kind !== "matrix" || matrix.state !== "published")
      throw new HttpException("A matriz publicada da distribuição não está disponível.", 409);
    const projectionRefs = Array.isArray(assignment.payload.blinded_projection_refs)
      ? assignment.payload.blinded_projection_refs as Array<{ record_id: string; revision: number }> : [];
    const blindedDocuments = [];
    for (const reference of projectionRefs) {
      const projection = await resolvePinned(reference.record_id, reference.revision);
      if (!projection || projection.pluginId !== "safdoulas-blinding" || projection.kind !== "blinded_projection"
        || projection.state !== "verified" || projection.payload.process_record_id !== assignment.payload.process_record_id)
        throw new HttpException("Uma projeção cegada vinculada à distribuição não está mais disponível.", 409);
      const document = await resolvePinned(projection.payload.blinded_document_record_id, projection.payload.blinded_document_revision);
      if (!document || document.pluginId !== "documents" || document.kind !== "document" || document.state !== "published" || document.payload.variant !== "anonymized")
        throw new HttpException("O documento cegado não está disponível para esta distribuição.", 409);
      blindedDocuments.push({ record_id: document.id, revision: document.revision, label: `Documento cegado ${blindedDocuments.length + 1}`, mime_type: document.payload.mime_type });
    }
    if (!blindedDocuments.length) throw new HttpException("A distribuição não contém documentos cegados verificados.", 409);
    const process = await resolvePinned(assignment.payload.process_record_id, assignment.payload.process_revision);
    const role = assignment.kind === "third_review_assignment" ? "third"
      : (Array.isArray(assignment.payload.evaluator_user_ids) ? (assignment.payload.evaluator_user_ids as string[]).indexOf(actorId) === 0 ? "first" : "second" : "");
    return {
      assignment: { id: assignment.id, revision: assignment.revision, kind: assignment.kind, role },
      process: { protocol_number: process?.payload.protocol_number || "" },
      matrix: { id: matrix.id, revision: matrix.revision, dimensions: matrix.payload.dimensions },
      blinded_documents: blindedDocuments,
      evaluation: evaluation || null,
    };
  }

  @Post("workspaces/:workspaceId/processes/:processId/recommendations")
  async recommendations(@Req() request: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("processId") processId: string, @Body() body: Record<string, unknown>) {
    if (Object.keys(body || {}).length) throw new HttpException("A solicitação de sugestão não aceita campos adicionais.", 400);
    const workspace = id(workspaceId), processRecordId = id(processId), actorId = String(request.orbitActor);
    await this.access.require(actorId, managePermission);
    await this.workspaces.shared(actorId, workspace);
    if (!this.plugins.isEnabled("safdoulas-assessments")) throw new HttpException("O plugin de avaliação ou uma dependência está desativado.", 409);
    const process = await this.records.detail("safdoulas-processes", processRecordId, actorId) as AssignmentSourceRecord;
    if (process.kind !== "accreditation_process" || process.state !== "review") throw new HttpException("A distribuição só pode ser preparada para um processo em análise.", 409);
    const eligibilityProcess = { pluginId: "safdoulas-processes", kind: process.kind, payload: process.payload };

    const resolveRecord = async (recordId: string, revision: number): Promise<ResolvedRecordReference | null> => {
      if (!Number.isInteger(revision) || revision < 1) return null;
      const rows = await this.db.query<ResolvedRecordReference>(`SELECT r.id,r.plugin_id AS "pluginId",r.kind,v.state,v.revision,v.payload
        FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
        WHERE r.id=$1 AND r.workspace_id=$2 AND v.revision=$3`, [id(recordId), workspace, revision]);
      return rows[0] || null;
    };
    const validationContext: RecordValidationContext = {
      actorId,
      resolveRecord,
      hasAcceptedTerm: async (recordId, revision, userId) => Boolean(await this.db.one(
        "SELECT 1 FROM extension_term_acceptances WHERE record_id=$1 AND revision=$2 AND user_id=$3 LIMIT 1",
        [id(recordId), revision, id(userId)],
      )),
    };
    const provider = typeof process.payload.provider_record_id === "string" && typeof process.payload.provider_revision === "number"
      ? await resolveRecord(process.payload.provider_record_id, process.payload.provider_revision) : null;
    if (!provider || provider.pluginId !== "safdoulas-registry" || provider.kind !== "education_provider")
      throw new HttpException("A instituição versionada do processo não está disponível para orientar a regionalidade.", 409);
    const rules = typeof process.payload.ruleset_record_id === "string" && typeof process.payload.ruleset_revision === "number"
      ? await resolveRecord(process.payload.ruleset_record_id, process.payload.ruleset_revision) : null;
    const matrix = rules && typeof rules.payload.matrix_record_id === "string" && typeof rules.payload.matrix_revision === "number"
      ? await resolveRecord(rules.payload.matrix_record_id, rules.payload.matrix_revision) : null;
    if (!matrix || matrix.pluginId !== "assessments" || matrix.kind !== "matrix" || matrix.state !== "published")
      throw new HttpException("A matriz publicada fixada pelas regras do processo não está disponível.", 409);

    const profiles = (await this.records.list("safdoulas-accreditors", workspace, actorId) as AssignmentSourceRecord[])
      .filter((record) => record.kind === "profile");
    if (profiles.length >= 100) throw new HttpException("A lista de perfis atingiu o limite de consulta; refine o espaço antes de gerar uma sugestão completa.", 409);
    const projectionRecords = await this.records.list("safdoulas-blinding", workspace, actorId) as AssignmentSourceRecord[];
    if (projectionRecords.length >= 100) throw new HttpException("A lista de projeções cegadas atingiu o limite de consulta; não é possível garantir uma distribuição completa.", 409);
    const projections = projectionRecords.filter((record) => record.kind === "blinded_projection" && record.state === "verified" && record.payload.process_record_id === process.id);
    if (!projections.length) throw new HttpException("O processo ainda não possui projeções cegadas verificadas para distribuição.", 409);

    const workloadRows = await this.db.query<{ user_id: string; active_assignments: number; total_assignments: number }>(`WITH latest AS (
      SELECT DISTINCT ON (r.id) r.kind,v.state,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id
      WHERE r.workspace_id=$1 AND r.plugin_id='safdoulas-assessments' AND r.kind IN ('evaluation_assignment','third_review_assignment')
      ORDER BY r.id,v.revision DESC
    ), assignments AS (
      SELECT state, jsonb_array_elements_text(payload->'evaluator_user_ids') AS user_id FROM latest
      WHERE kind='evaluation_assignment' AND state IN ('assigned','completed')
      UNION ALL
      SELECT state,payload->>'evaluator_user_id' AS user_id FROM latest
      WHERE kind='third_review_assignment' AND state IN ('assigned','completed') AND payload ? 'evaluator_user_id'
    )
    SELECT user_id,COUNT(*) FILTER (WHERE state='assigned')::int AS active_assignments,COUNT(*)::int AS total_assignments
    FROM assignments GROUP BY user_id`, [workspace]);
    const workload = new Map(workloadRows.map((row) => [row.user_id, row]));
    const profileUserIds = profiles.map((profile) => String(profile.payload.user_id)).filter((userId) => /^[a-fA-F0-9-]{36}$/.test(userId));
    const accounts = profileUserIds.length ? await this.db.query<{ id: string; name: string }>(
      "SELECT id::text AS id,name FROM users WHERE id=ANY($1::uuid[]) AND NOT disabled", [profileUserIds],
    ) : [];
    const names = new Map(accounts.map((account) => [account.id, account.name]));
    const requiredExpertise = (Array.isArray(matrix.payload.dimensions) ? matrix.payload.dimensions as Array<Record<string, unknown>> : [])
      .flatMap((dimension) => [dimension.code, dimension.name, dimension.label, ...(Array.isArray(dimension.criteria) ? (dimension.criteria as Array<Record<string, unknown>>).flatMap((criterion) => [criterion.code, criterion.name, criterion.label]) : [])])
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    const candidates: RecommendationCandidate[] = [];
    for (const profileRecord of profiles) {
      const payload = profileRecord.payload;
      const userId = typeof payload.user_id === "string" ? payload.user_id : "";
      const usage = workload.get(userId);
      const currentLoad = usage?.active_assignments || 0, totalLoad = usage?.total_assignments || 0;
      if (!names.has(userId) || payload.profile_status !== "active" || profileRecord.state !== "active"
        || !Number.isInteger(payload.max_parallel_assignments) || currentLoad >= Number(payload.max_parallel_assignments)
        || !await eligibleAccreditorProfile(payload, userId, eligibilityProcess, validationContext)) continue;
      candidates.push({
        user_id: userId, name: names.get(userId)!, profile_record_id: profileRecord.id, profile_revision: profileRecord.revision,
        region_code: String(payload.region_code || ""),
        expertise: Array.isArray(payload.expertise) ? (payload.expertise as unknown[]).filter((value): value is string => typeof value === "string") : [],
        active_assignments: currentLoad, total_assignments: totalLoad, max_parallel_assignments: Number(payload.max_parallel_assignments), matched_expertise: [],
      });
    }
    const pairs = rankEvaluatorPairs(candidates, String(provider.payload.state || ""), requiredExpertise).slice(0, 5);
    return {
      process: { id: process.id, revision: process.revision, protocol_number: process.payload.protocol_number || "" },
      matrix: { id: matrix.id, revision: matrix.revision },
      blinded_projection_refs: projections.map((projection) => ({ record_id: projection.id, revision: projection.revision })),
      eligible_count: candidates.length,
      pairs: pairs.map((pair) => ({
        reasons: pair.reasons,
        evaluators: pair.evaluators.map((candidate) => ({
          user_id: candidate.user_id, name: candidate.name, profile_record_id: candidate.profile_record_id,
          profile_revision: candidate.profile_revision, region_code: candidate.region_code,
          active_assignments: candidate.active_assignments, max_parallel_assignments: candidate.max_parallel_assignments,
          total_assignments: candidate.total_assignments, matched_expertise: candidate.matched_expertise,
        })),
      })),
    };
  }
}
