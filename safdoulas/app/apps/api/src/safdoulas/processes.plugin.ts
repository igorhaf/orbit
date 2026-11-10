import {courseBoard} from "./course-board";
import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue } from "../plugins/contract";

const optionalText = (maxLength = 2000) => ({ type: "string", maxLength });
const uuid = { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const nullableUuid = { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const list = (items: Record<string, unknown>, maxItems = 200) => ({ type: "array", items, maxItems });
const object = (properties: Record<string, Record<string, unknown>>, required = Object.keys(properties).filter((key) => !["curriculum_record_id", "curriculum_revision"].includes(key))) => ({ type: "object", additionalProperties: false, properties, required });

const transitionRoles = ["applicant", "institution_representative", "accreditor_candidate", "screener", "evaluator", "deliberator", "secretariat", "appeal_reviewer", "observer"] as const;
const transitionPermission = (role: string) => `plugin.safdoulas-processes.transition.${role}`;
const blindingPolicyActive = async (payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> => {
  const recordId = payload.blinding_policy_record_id;
  const revision = payload.blinding_policy_revision;
  if (typeof recordId !== "string" || typeof revision !== "number") return false;
  const policy = await context.resolveRecord(recordId, revision);
  return Boolean(policy && policy.pluginId === "safdoulas-governance" && policy.kind === "blinding_policy" && policy.state === "active");
};
type RuleTransition = { from?: string; to?: string; required_role?: string };
type RuleSet = { pluginId: string; kind: string; state: string; payload: Record<string, unknown> };

const sequenceToken = /\{sequence(?::([1-8]))?\}/g;
export function formatProtocolNumber(pattern: string, year: number, sequence: string): string {
  const tokens = [...pattern.matchAll(/\{[^{}]+\}/g)].map(([token]) => token);
  const sequenceTokens = tokens.filter((token) => /^\{sequence(?::[1-8])?\}$/.test(token));
  const literal = pattern.replace(/\{[^{}]+\}/g, "");
  if (sequenceTokens.length !== 1 || tokens.some((token) => token !== "{year}" && !/^\{sequence(?::[1-8])?\}$/.test(token)) || tokens.filter((token) => token === "{year}").length > 1 || (pattern.match(/\{/g) || []).length !== tokens.length || (pattern.match(/\}/g) || []).length !== tokens.length || !/^[A-Za-z0-9._/-]+$/.test(literal))
    throw new Error("O formato do protocolo deve conter um único {sequence}, pode conter {year} e usar apenas letras, números, ponto, traço, barra ou sublinhado.");
  const width = Number(sequenceTokens[0].match(/:(\d)/)?.[1] || 1);
  return pattern.replace(sequenceToken, sequence.padStart(width, "0")).replace("{year}", String(year));
}

async function ruleset(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RuleSet | null> {
  const recordId = payload.ruleset_record_id;
  const revision = payload.ruleset_revision;
  if (typeof recordId !== "string" || typeof revision !== "number") return null;
  return await context.resolveRecord(recordId, revision) as RuleSet | null;
}

async function triageReview(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RuleSet | null> {
  if (typeof payload.triage_review_record_id !== "string" || typeof payload.triage_review_revision !== "number" || !context.recordId) return null;
  const review = await context.resolveRecord(payload.triage_review_record_id, payload.triage_review_revision) as RuleSet | null;
  return review && review.pluginId === "safdoulas-triage" && review.kind === "admissibility_review" && review.state === "completed" && review.payload.process_record_id === context.recordId ? review : null;
}

async function triageAllowsReview(payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  return (await triageReview(payload, context))?.payload.recommendation === "admissible";
}

async function triageAllowsPreliminaryCorrection(payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  return (await triageReview(payload, context))?.payload.recommendation === "correction_required";
}

async function preliminaryCorrectionResponseSubmitted(payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  if (typeof payload.preliminary_diligence_response_record_id !== "string" || typeof payload.preliminary_diligence_response_revision !== "number" || !context.recordId) return false;
  const response = await context.resolveRecord(payload.preliminary_diligence_response_record_id, payload.preliminary_diligence_response_revision) as RuleSet | null;
  if (!response || response.pluginId !== "safdoulas-diligences" || response.kind !== "diligence_response" || response.state !== "submitted") return false;
  if (typeof response.payload.diligence_record_id !== "string" || typeof response.payload.diligence_revision !== "number") return false;
  const diligence = await context.resolveRecord(response.payload.diligence_record_id, response.payload.diligence_revision) as RuleSet | null;
  return Boolean(diligence && diligence.pluginId === "safdoulas-diligences" && diligence.kind === "diligence"
    && diligence.payload.stage === "preliminary_admissibility" && diligence.payload.process_record_id === context.recordId);
}

async function evaluationAllowsDeliberation(payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  if (typeof payload.evaluation_consolidation_record_id !== "string" || typeof payload.evaluation_consolidation_revision !== "number" || !context.recordId) return false;
  const consolidation = await context.resolveRecord(payload.evaluation_consolidation_record_id, payload.evaluation_consolidation_revision) as RuleSet | null;
  return Boolean(consolidation && consolidation.pluginId === "safdoulas-assessments" && consolidation.kind === "evaluation_consolidation" && consolidation.state === "completed" && consolidation.payload.process_record_id === context.recordId);
}

async function decisionForTransition(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RuleSet | null> {
  if (typeof payload.institutional_decision_record_id !== "string" || typeof payload.institutional_decision_revision !== "number" || !context.recordId) return null;
  const decision = await context.resolveRecord(payload.institutional_decision_record_id, payload.institutional_decision_revision) as RuleSet | null;
  return decision?.pluginId === "safdoulas-decisions" && decision.kind === "institutional_decision" && decision.state === "ratified"
    && decision.payload.process_record_id === context.recordId ? decision : null;
}

async function finalDecisionAllowsClose(payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  const decision = await decisionForTransition(payload, context);
  return Boolean(decision && ["approved", "approved_with_conditions", "denied"].includes(String(decision.payload.outcome)));
}

async function decisionAllowsDiligence(payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  const decision = await decisionForTransition(payload, context);
  return Boolean(decision?.payload.outcome === "further_diligence");
}

async function appealDecisionAllowsClose(payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  if (typeof payload.appeal_decision_record_id !== "string" || typeof payload.appeal_decision_revision !== "number" || !context.recordId) return false;
  const decision = await context.resolveRecord(payload.appeal_decision_record_id, payload.appeal_decision_revision) as RuleSet | null;
  return Boolean(decision && decision.pluginId === "safdoulas-decisions" && decision.kind === "appeal_decision"
    && decision.state === "ratified" && decision.payload.process_record_id === context.recordId);
}

async function submittedAppeal(payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  if (typeof payload.appeal_record_id !== "string" || typeof payload.appeal_revision !== "number" || !context.recordId) return false;
  const appeal = await context.resolveRecord(payload.appeal_record_id, payload.appeal_revision);
  return Boolean(appeal && appeal.pluginId === "safdoulas-decisions" && appeal.kind === "appeal"
    && ["submitted", "under_review"].includes(appeal.state) && appeal.payload.process_record_id === context.recordId
    && appeal.payload.decision_record_id === payload.institutional_decision_record_id);
}

export async function accreditationProcessTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  const reference = await ruleset(payload, context);
  if (!reference || reference.pluginId !== "safdoulas-governance" || reference.kind !== "accreditation_ruleset" || reference.state !== "active") return [];
  const transitions = Array.isArray(reference.payload.state_transitions) ? reference.payload.state_transitions as RuleTransition[] : [];
  const allowed: string[] = [];
  for (const edge of transitions) {
    if (edge.from !== state || typeof edge.to !== "string" || typeof edge.required_role !== "string") continue;
    if (edge.to === "draft" && state !== "draft") continue;
    if (edge.from === "triage" && edge.to === "review" && (!await triageAllowsReview(payload, context) || !await blindingPolicyActive(payload, context))) continue;
    if (edge.from === "triage" && edge.to === "diligence" && !await triageAllowsPreliminaryCorrection(payload, context)) continue;
    if (edge.from === "diligence" && edge.to === "triage" && !await preliminaryCorrectionResponseSubmitted(payload, context)) continue;
    if (edge.from === "review" && edge.to === "deliberation" && !await evaluationAllowsDeliberation(payload, context)) continue;
    if (edge.from === "deliberation" && edge.to === "decision" && !await finalDecisionAllowsClose(payload, context)) continue;
    if (edge.from === "deliberation" && edge.to === "diligence" && !await decisionAllowsDiligence(payload, context)) continue;
    if (edge.to === "appeal" && (edge.from !== "decision" || !await submittedAppeal(payload, context))) continue;
    if (edge.from === "appeal" && edge.to === "decision" && !await appealDecisionAllowsClose(payload, context)) continue;
    if (context.hasPermission && await context.hasPermission(transitionPermission(edge.required_role))) allowed.push(edge.to);
  }
  return [...new Set(allowed)];
}

export async function authorizeAccreditationProcessTransition(from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  const reference = await ruleset(payload, context);
  if (!reference || reference.pluginId !== "safdoulas-governance" || reference.kind !== "accreditation_ruleset" || reference.state !== "active") return false;
  const transitions = Array.isArray(reference.payload.state_transitions) ? reference.payload.state_transitions as RuleTransition[] : [];
  const edge = transitions.find((item) => item.from === from && item.to === to);
  if (!edge || typeof edge.required_role !== "string" || !context.hasPermission) return false;
  if (to === "draft" && from !== "draft") return false;
  if (from === "triage" && to === "review" && (!await triageAllowsReview(payload, context) || !await blindingPolicyActive(payload, context))) return false;
  if (from === "triage" && to === "diligence" && !await triageAllowsPreliminaryCorrection(payload, context)) return false;
  if (from === "diligence" && to === "triage" && !await preliminaryCorrectionResponseSubmitted(payload, context)) return false;
  if (from === "review" && to === "deliberation" && !await evaluationAllowsDeliberation(payload, context)) return false;
  if (from === "deliberation" && to === "decision" && !await finalDecisionAllowsClose(payload, context)) return false;
  if (from === "deliberation" && to === "diligence" && !await decisionAllowsDiligence(payload, context)) return false;
  if (to === "appeal" && (from !== "decision" || !await submittedAppeal(payload, context))) return false;
  if (from === "appeal" && to === "decision" && !await appealDecisionAllowsClose(payload, context)) return false;
  return context.hasPermission(transitionPermission(edge.required_role));
}

export async function prepareAccreditationProcessTransition(from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<Record<string, unknown>> {
  if (from !== "draft" || to !== "submitted") return payload;
  const submissionId = payload.application_submission_record_id;
  const submissionRevision = payload.application_submission_revision;
  if (typeof submissionId !== "string" || typeof submissionRevision !== "number")
    throw new Error("Vincule uma submissão de formulário enviada antes de protocolar a solicitação.");
  const submission = await context.resolveRecord(submissionId, submissionRevision);
  if (!submission || submission.pluginId !== "forms" || submission.kind !== "submission" || !["submitted", "completed"].includes(submission.state))
    throw new Error("A solicitação precisa apontar para uma submissão enviada e versionada.");
  const formId = submission.payload.form_id;
  const formRevision = submission.payload.form_revision;
  const form = typeof formId === "string" && typeof formRevision === "number"
    ? await context.resolveRecord(formId, formRevision)
    : null;
  if (!form || form.pluginId !== "forms" || form.kind !== "form" || form.state !== "published")
    throw new Error("A submissão precisa preservar a versão publicada do formulário utilizado.");
  const reference = await ruleset(payload, context);
  const pattern = reference?.payload.protocol_pattern;
  if (!reference || reference.pluginId !== "safdoulas-governance" || reference.kind !== "accreditation_ruleset" || reference.state !== "active" || typeof pattern !== "string" || !pattern.trim())
    throw new Error("Configure o formato do protocolo na versão ativa das regras antes de receber solicitações.");
  if (typeof reference.payload.application_form_record_id === "string") {
    if (form.id !== reference.payload.application_form_record_id || form.revision !== reference.payload.application_form_revision)
      throw new Error("A solicitação deve usar o formulário oficial e a versão fixados no edital selecionado.");
    const answers = submission.payload.answers as Record<string, unknown>;
    for (const prefix of ["provider", "course", "curriculum"])
      if (answers[`${prefix}_record_id`] !== payload[`${prefix}_record_id`] || answers[`${prefix}_revision`] !== payload[`${prefix}_revision`])
        throw new Error("Os cadastros e suas versões precisam corresponder à solicitação enviada.");
    const references = (values: unknown) => Array.isArray(values) ? values.map((value) => `${value.record_id}:${value.revision}`).sort() : [];
    if (JSON.stringify(references(answers.document_refs)) !== JSON.stringify(references(payload.document_snapshots)))
      throw new Error("Os documentos protocolados devem corresponder exatamente aos anexos da solicitação enviada.");
  }
  if (!context.nextSequence) throw new Error("O gerador de sequência do sistema está indisponível.");
  const sequence = await context.nextSequence();
  try {
    return { ...payload, protocol_number: formatProtocolNumber(pattern, new Date().getUTCFullYear(), sequence) };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Formato de protocolo inválido.");
  }
}

export async function accreditationProcessValidationIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const prior = context.recordId ? await context.resolveLatestRecord?.(context.recordId) : null;
  if (prior?.state === "decision") {
    const allowed = new Set(["appeal_record_id", "appeal_revision", "appeal_decision_record_id", "appeal_decision_revision"]);
    for (const key of new Set([...Object.keys(prior.payload), ...Object.keys(payload)]))
      if (!allowed.has(key) && JSON.stringify(prior.payload[key]) !== JSON.stringify(payload[key]))
        issues.push({ severity: "error", code: "decided_process_field_frozen", path: key, message: "A decisão e a submissão estão preservadas; após a decisão só é permitido vincular o recurso e seu resultado." });
  }
  const reference = await ruleset(payload, context);
  if (!reference || reference.pluginId !== "safdoulas-governance" || reference.kind !== "accreditation_ruleset") {
    issues.push({ severity: "error", code: "invalid_ruleset_reference", path: "ruleset_record_id", message: "A versão vinculada precisa ser um conjunto de regras de acreditação acessível neste espaço." });
  } else {
    if (reference.state !== "active") issues.push({ severity: "error", code: "inactive_ruleset_reference", path: "ruleset_record_id", message: "O processo deve fixar uma versão ativa das regras." });
    const types = Array.isArray(reference.payload.process_types) ? reference.payload.process_types : [];
    if (!types.includes(payload.process_type)) issues.push({ severity: "error", code: "process_type_not_allowed", path: "process_type", message: "Este tipo de processo não está habilitado na versão de regras selecionada." });
    const states = Array.isArray(reference.payload.process_states) ? reference.payload.process_states : [];
    const transitions = Array.isArray(reference.payload.state_transitions) ? reference.payload.state_transitions as RuleTransition[] : [];
    if (!states.includes("draft") || !transitions.some((edge) => edge.from === "draft"))
      issues.push({ severity: "error", code: "ruleset_missing_draft_transition", path: "ruleset_record_id", message: "A versão das regras precisa declarar o estado inicial e ao menos uma transição para rascunho." });
  }

  const providerId = payload.provider_record_id;
  const providerRevision = payload.provider_revision;
  const provider = typeof providerId === "string" && typeof providerRevision === "number"
    ? await context.resolveRecord(providerId, providerRevision)
    : null;
  if (!provider || provider.pluginId !== "safdoulas-registry" || provider.kind !== "education_provider")
    issues.push({ severity: "error", code: "invalid_provider_reference", path: "provider_record_id", message: "O processo precisa apontar para uma instituição, coletivo ou formadora acessível e versionada." });

  const courseId = payload.course_record_id;
  const courseRevision = payload.course_revision;
  const courseRequired = payload.process_type === "course_accreditation";
  if (courseRequired && (typeof courseId !== "string" || typeof courseRevision !== "number"))
    issues.push({ severity: "error", code: "course_reference_required", path: "course_record_id", message: "A acreditação de curso precisa fixar a versão do curso avaliado." });
  if (typeof courseId === "string" && typeof courseRevision === "number") {
    const course = await context.resolveRecord(courseId, courseRevision);
    if (!course || course.pluginId !== "safdoulas-registry" || course.kind !== "course")
      issues.push({ severity: "error", code: "invalid_course_reference", path: "course_record_id", message: "A referência do curso precisa apontar para uma versão acessível do cadastro formativo." });
    else if (provider && course.payload.provider_record_id !== provider.id)
      issues.push({ severity: "error", code: "course_provider_mismatch", path: "course_record_id", message: "O curso e a instituição responsável do processo não correspondem." });
  }

  const offeringId = payload.offering_record_id;
  const offeringRevision = payload.offering_revision;
  if ((typeof offeringId === "string") !== (typeof offeringRevision === "number"))
    issues.push({ severity: "error", code: "incomplete_offering_reference", path: "offering_record_id", message: "Informe identificador e versão da oferta juntos." });
  else if (typeof offeringId === "string" && typeof offeringRevision === "number") {
    const offering = await context.resolveRecord(offeringId, offeringRevision);
    if (!offering || offering.pluginId !== "safdoulas-registry" || offering.kind !== "course_offering")
      issues.push({ severity: "error", code: "invalid_offering_reference", path: "offering_record_id", message: "A oferta precisa apontar para uma versão acessível do cadastro formativo." });
    else if (typeof courseId === "string" && offering.payload.course_record_id !== courseId)
      issues.push({ severity: "error", code: "offering_course_mismatch", path: "offering_record_id", message: "A oferta selecionada pertence a outro curso." });
  }

  const curriculumId = payload.curriculum_record_id;
  const curriculumRevision = payload.curriculum_revision;
  if ((typeof curriculumId === "string") !== (typeof curriculumRevision === "number"))
    issues.push({ severity: "error", code: "incomplete_curriculum_reference", path: "curriculum_record_id", message: "Informe a matriz curricular e sua versão juntas." });
  else if (typeof curriculumId === "string" && typeof curriculumRevision === "number") {
    const curriculum = await context.resolveRecord(curriculumId, curriculumRevision);
    if (!curriculum || curriculum.pluginId !== "safdoulas-registry" || curriculum.kind !== "curriculum"
      || curriculum.state !== "active" || curriculum.payload.course_record_id !== payload.course_record_id)
      issues.push({ severity: "error", code: "invalid_process_curriculum", path: "curriculum_record_id", message: "A matriz curricular deve estar ativa e pertencer ao curso submetido." });
  }

  const submissionId = payload.application_submission_record_id;
  const submissionRevision = payload.application_submission_revision;
  if ((typeof submissionId === "string") !== (typeof submissionRevision === "number"))
    issues.push({ severity: "error", code: "incomplete_application_reference", path: "application_submission_record_id", message: "Informe identificador e versão da submissão juntos." });
  else if (typeof submissionId === "string" && typeof submissionRevision === "number") {
    const submission = await context.resolveRecord(submissionId, submissionRevision);
    if (!submission || submission.pluginId !== "forms" || submission.kind !== "submission")
      issues.push({ severity: "error", code: "invalid_application_reference", path: "application_submission_record_id", message: "A solicitação precisa apontar para uma submissão versionada de formulário acessível." });
    else if (submission.state !== "submitted" && submission.state !== "completed")
      issues.push({ severity: "error", code: "application_not_submitted", path: "application_submission_record_id", message: "Use uma versão enviada do formulário para iniciar a análise." });
  }

  const triageId = payload.triage_review_record_id;
  const triageRevision = payload.triage_review_revision;
  if ((typeof triageId === "string") !== (typeof triageRevision === "number"))
    issues.push({ severity: "error", code: "incomplete_triage_reference", path: "triage_review_record_id", message: "Informe o parecer de triagem e sua versão juntos." });
  else if (typeof triageId === "string" && typeof triageRevision === "number") {
    const triage = await context.resolveRecord(triageId, triageRevision);
    if (!triage || triage.pluginId !== "safdoulas-triage" || triage.kind !== "admissibility_review" || triage.payload.process_record_id !== context.recordId)
      issues.push({ severity: "error", code: "invalid_triage_reference", path: "triage_review_record_id", message: "O parecer de triagem precisa pertencer a este processo." });
  }

  const preliminaryResponseId = payload.preliminary_diligence_response_record_id;
  const preliminaryResponseRevision = payload.preliminary_diligence_response_revision;
  if ((typeof preliminaryResponseId === "string") !== (typeof preliminaryResponseRevision === "number"))
    issues.push({ severity: "error", code: "incomplete_preliminary_response_reference", path: "preliminary_diligence_response_record_id", message: "Informe a resposta à complementação preliminar e sua versão juntas." });
  else if (typeof preliminaryResponseId === "string" && typeof preliminaryResponseRevision === "number") {
    const response = await context.resolveRecord(preliminaryResponseId, preliminaryResponseRevision);
    if (!response || response.pluginId !== "safdoulas-diligences" || response.kind !== "diligence_response" || response.state !== "submitted")
      issues.push({ severity: "error", code: "invalid_preliminary_response_reference", path: "preliminary_diligence_response_record_id", message: "A resposta preliminar precisa estar enviada e versionada." });
  }

  const policyId = payload.blinding_policy_record_id;
  const policyRevision = payload.blinding_policy_revision;
  if ((typeof policyId === "string") !== (typeof policyRevision === "number"))
    issues.push({ severity: "error", code: "incomplete_blinding_policy_reference", path: "blinding_policy_record_id", message: "Informe a política de cegamento e sua versão juntas." });
  else if (typeof policyId === "string" && typeof policyRevision === "number") {
    const policy = await context.resolveRecord(policyId, policyRevision);
    if (!policy || policy.pluginId !== "safdoulas-governance" || policy.kind !== "blinding_policy")
      issues.push({ severity: "error", code: "invalid_blinding_policy_reference", path: "blinding_policy_record_id", message: "A política precisa apontar para um registro versionado de governança." });
    else if (policy.state !== "active")
      issues.push({ severity: "error", code: "inactive_blinding_policy", path: "blinding_policy_record_id", message: "O processo precisa fixar uma política de cegamento ativa." });
  }

  const consolidationId = payload.evaluation_consolidation_record_id;
  const consolidationRevision = payload.evaluation_consolidation_revision;
  if ((typeof consolidationId === "string") !== (typeof consolidationRevision === "number"))
    issues.push({ severity: "error", code: "incomplete_evaluation_consolidation_reference", path: "evaluation_consolidation_record_id", message: "Informe a consolidação das avaliações e sua versão juntas." });
  else if (typeof consolidationId === "string" && typeof consolidationRevision === "number") {
    const consolidation = await context.resolveRecord(consolidationId, consolidationRevision);
    if (!consolidation || consolidation.pluginId !== "safdoulas-assessments" || consolidation.kind !== "evaluation_consolidation" || consolidation.payload.process_record_id !== context.recordId)
      issues.push({ severity: "error", code: "invalid_evaluation_consolidation_reference", path: "evaluation_consolidation_record_id", message: "A consolidação precisa pertencer a este processo." });
  }

  for (const [idKey, revisionKey] of [
    ["institutional_decision_record_id", "institutional_decision_revision"],
    ["appeal_record_id", "appeal_revision"],
    ["appeal_decision_record_id", "appeal_decision_revision"],
  ]) {
    if ((typeof payload[idKey] === "string") !== (typeof payload[revisionKey] === "number"))
      issues.push({ severity: "error", code: "incomplete_decision_reference", path: idKey, message: "Informe o registro de decisão/recurso e sua versão juntos." });
  }
  const processReferences = [
    ["institutional_decision_record_id", "institutional_decision_revision", "institutional_decision", "A decisão precisa pertencer a este processo."],
    ["appeal_record_id", "appeal_revision", "appeal", "O recurso precisa pertencer a este processo."],
    ["appeal_decision_record_id", "appeal_decision_revision", "appeal_decision", "A decisão recursal precisa pertencer a este processo."],
  ] as const;
  for (const [idKey, revisionKey, kind, message] of processReferences) {
    if (typeof payload[idKey] !== "string" || typeof payload[revisionKey] !== "number") continue;
    const linked = await context.resolveRecord(payload[idKey], payload[revisionKey]);
    if (!linked || linked.pluginId !== "safdoulas-decisions" || linked.kind !== kind || linked.payload.process_record_id !== context.recordId)
      issues.push({ severity: "error", code: `invalid_${kind}_reference`, path: idKey, message });
  }

  const documents = Array.isArray(payload.document_snapshots) ? payload.document_snapshots as Array<{ record_id?: string; revision?: number }> : [];
  for (const [index, item] of documents.entries()) {
    const document = typeof item.record_id === "string" && typeof item.revision === "number"
      ? await context.resolveRecord(item.record_id, item.revision)
      : null;
    if (!document || document.pluginId !== "documents" || document.kind !== "document")
      issues.push({ severity: "error", code: "invalid_process_document", path: `document_snapshots[${index}]`, message: "Cada documento do processo precisa apontar para uma versão acessível e preservada." });
  }
  return issues;
}

const recordKinds: Record<string, RecordKindContribution> = {
  accreditation_process: {
    label: "Processo de acreditação",
    schema: object({
      process_type: { type: "string", enum: ["course_accreditation", "accreditor_selection"] },
      protocol_number: { type: ["string", "null"], maxLength: 160 },
      ruleset_record_id: uuid,
      ruleset_revision: { type: "integer", minimum: 1 },
      provider_record_id: uuid,
      provider_revision: { type: "integer", minimum: 1 },
      course_record_id: nullableUuid,
      course_revision: { type: ["integer", "null"], minimum: 1 },
      curriculum_record_id: nullableUuid,
      curriculum_revision: { type: ["integer", "null"], minimum: 1 },
      offering_record_id: nullableUuid,
      offering_revision: { type: ["integer", "null"], minimum: 1 },
      application_submission_record_id: nullableUuid,
      application_submission_revision: { type: ["integer", "null"], minimum: 1 },
      triage_review_record_id: nullableUuid,
      triage_review_revision: { type: ["integer", "null"], minimum: 1 },
      preliminary_diligence_response_record_id: nullableUuid,
      preliminary_diligence_response_revision: { type: ["integer", "null"], minimum: 1 },
      blinding_policy_record_id: nullableUuid,
      blinding_policy_revision: { type: ["integer", "null"], minimum: 1 },
      evaluation_consolidation_record_id: nullableUuid,
      evaluation_consolidation_revision: { type: ["integer", "null"], minimum: 1 },
      institutional_decision_record_id: nullableUuid,
      institutional_decision_revision: { type: ["integer", "null"], minimum: 1 },
      appeal_record_id: nullableUuid,
      appeal_revision: { type: ["integer", "null"], minimum: 1 },
      appeal_decision_record_id: nullableUuid,
      appeal_decision_revision: { type: ["integer", "null"], minimum: 1 },
      document_snapshots: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 }, purpose: optionalText(300) }, ["record_id", "revision"]), 200),
      opened_at: { type: "string", format: "date-time" },
      notes: optionalText(12000),
    }),
    initial: "draft",
    transitions: { draft: [] },
    immutable: ["closed", "cancelled"],
    immutablePayloadFieldsAfterInitial: [
      "protocol_number",
      "ruleset_record_id", "ruleset_revision",
      "provider_record_id", "provider_revision",
      "course_record_id", "course_revision",
      "curriculum_record_id", "curriculum_revision",
      "offering_record_id", "offering_revision",
      "application_submission_record_id", "application_submission_revision",
      "blinding_policy_record_id", "blinding_policy_revision",
      "document_snapshots", "opened_at",
    ],
    resourceScoped: true,
    managePermission: "plugin.safdoulas-processes.manage",
    uniqueFields: ["protocol_number"],
    availableTransitions: accreditationProcessTransitions,
    authorizeTransition: authorizeAccreditationProcessTransition,
    prepareTransition: prepareAccreditationProcessTransition,
    validate: accreditationProcessValidationIssues,
    example: {
      process_type: "course_accreditation",
      protocol_number: null,
      ruleset_record_id: "00000000-0000-4000-8000-000000000001",
      ruleset_revision: 1,
      provider_record_id: "00000000-0000-4000-8000-000000000002",
      provider_revision: 1,
      course_record_id: "00000000-0000-4000-8000-000000000003",
      course_revision: 1,
      offering_record_id: null,
      offering_revision: null,
      application_submission_record_id: null,
      application_submission_revision: null,
      triage_review_record_id: null,
      triage_review_revision: null,
      preliminary_diligence_response_record_id: null,
      preliminary_diligence_response_revision: null,
      blinding_policy_record_id: null,
      blinding_policy_revision: null,
      evaluation_consolidation_record_id: null,
      evaluation_consolidation_revision: null,
      institutional_decision_record_id: null,
      institutional_decision_revision: null,
      appeal_record_id: null,
      appeal_revision: null,
      appeal_decision_record_id: null,
      appeal_decision_revision: null,
      document_snapshots: [],
      opened_at: "2026-01-01T00:00:00.000Z",
      notes: "Exemplo demonstrativo; preencher com as versões reais antes de enviar.",
    },
  },
};

export const safdoulasProcessesPlugin: PluginDefinition = {
  id: "safdoulas-processes",
  name: "Processos de acreditação SAFDOULAS",
  version: "1.0.0",
  description: "Registra processos com regras e evidências versionadas, acesso por escopo e transições autorizadas pelas regras vigentes.",
  scope: "workspace",
  dependencies: ["versioned-records", "safdoulas-governance", "safdoulas-registry", "forms", "documents", "privacy"],
  capabilities: ["read", "write", "publish"].map((action) => ({
    id: action,
    name: action === "read" ? "Consultar processos" : action === "write" ? "Revisar processos atribuídos" : "Executar transições autorizadas",
    permissions: [`plugin.safdoulas-processes.${action}`],
  })).concat(transitionRoles.map((role) => ({
    id: `transition.${role}`,
    name: `Transição de processo como ${role}`,
    permissions: [transitionPermission(role)],
  }))),
  contributions: {
    recordCards:[{board:courseBoard,kind:"accreditation_process",label:"Curso em acreditação",href:"/safdoulas/processes",recordParam:"process",description:"Anotações de acompanhamento do curso. Utilize os documentos e o processo vinculados para submeter evidências ou registrar decisões formais.",titleReference:{plugin:"safdoulas-registry",idField:"course_record_id",revisionField:"course_revision",titleField:"name"}}],
    navigation: [{ id: "safdoulas-processes", href: "/extensions/safdoulas-processes", label: "Processos" , permission: "plugin.safdoulas-processes.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "workflow", "label": "Tramitação", "order": 2}, order: 0}],
    recordKinds,
  },
};
