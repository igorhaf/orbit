import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue, ResolvedRecordReference } from "../plugins/contract";

const uuid = { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const nullableUuid = { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const text = (maxLength = 4000) => ({ type: "string", minLength: 1, maxLength });
const optionalText = (maxLength = 4000) => ({ type: "string", maxLength });
const list = (items: Record<string, unknown>, maxItems = 100) => ({ type: "array", items, maxItems });
const object = (properties: Record<string, Record<string, unknown>>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const managePermission = "plugin.safdoulas-decisions.manage";
const rolePermission = (role: string) => `plugin.safdoulas-processes.transition.${role}`;
type Ref = ResolvedRecordReference;
type Vote = { voter_user_id: string; position: string; rationale: string };

function error(code: string, path: string, message: string): RecordValidationIssue {
  return { severity: "error", code, path, message };
}

async function ref(context: RecordValidationContext, id: unknown, revision: unknown): Promise<Ref | null> {
  return typeof id === "string" && Number.isInteger(revision) ? context.resolveRecord(id, Number(revision)) : null;
}

async function pinnedPolicy(process: Ref, policyId: unknown, policyRevision: unknown, context: RecordValidationContext): Promise<Ref | null> {
  const rules = await ref(context, process.payload.ruleset_record_id, process.payload.ruleset_revision);
  if (!rules || rules.pluginId !== "safdoulas-governance" || rules.kind !== "accreditation_ruleset") return null;
  if (rules.payload.decision_policy_record_id !== policyId || rules.payload.decision_policy_revision !== policyRevision) return null;
  const policy = await ref(context, policyId, policyRevision);
  return policy?.pluginId === "safdoulas-governance" && policy.kind === "decision_policy" && policy.state === "active" ? policy : null;
}

function voteThreshold(policy: Ref, outcome: string, votes: Vote[], positions: string[]): boolean {
  const configured = ["maintained", "modified", "reversed"].includes(outcome)
    ? policy.payload.appeal_support_thresholds
    : policy.payload.support_thresholds;
  const threshold = (configured as Array<{ outcome: string; minimum_percent: number }> || [])
    .find((item) => item.outcome === outcome)?.minimum_percent;
  if (typeof threshold !== "number") return false;
  const decided = votes.filter((vote) => vote.position !== "abstain");
  if (!decided.length) return false;
  const supporting = decided.filter((vote) => positions.includes(vote.position)).length;
  return supporting / decided.length * 100 >= threshold;
}

export async function institutionalDecisionIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const process = await ref(context, payload.process_record_id, payload.process_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process" || process.state !== "deliberation")
    issues.push(error("decision_process_not_in_deliberation", "process_record_id", "A deliberação precisa apontar para um processo na etapa de deliberação."));
  const consolidation = await ref(context, payload.evaluation_consolidation_record_id, payload.evaluation_consolidation_revision);
  if (!consolidation || consolidation.pluginId !== "safdoulas-assessments" || consolidation.kind !== "evaluation_consolidation" || consolidation.state !== "completed" || consolidation.payload.process_record_id !== process?.id)
    issues.push(error("completed_consolidation_required", "evaluation_consolidation_record_id", "A decisão precisa considerar a consolidação concluída deste processo."));
  const policy = process && await pinnedPolicy(process, payload.decision_policy_record_id, payload.decision_policy_revision, context);
  if (!policy) {
    issues.push(error("active_pinned_decision_policy_required", "decision_policy_record_id", "Vincule a política de decisão ativa e fixada nas regras deste processo."));
    return issues;
  }
  const outcome = String(payload.outcome);
  const allowed = Array.isArray(policy.payload.allowed_outcomes) ? policy.payload.allowed_outcomes as string[] : [];
  if (!allowed.includes(outcome)) issues.push(error("decision_outcome_not_allowed", "outcome", "Este resultado não está permitido pela política fixada no processo."));
  if (["approved_with_conditions", "further_diligence"].includes(outcome) && !String(payload.conditions_or_requests || "").trim())
    issues.push(error("decision_details_required", "conditions_or_requests", "Descreva as condições ou complementações necessárias para este resultado."));
  if (outcome === "denied" && !String(payload.denial_basis || "").trim())
    issues.push(error("denial_basis_required", "denial_basis", "Fundamente o indeferimento com referência aos critérios e evidências analisados."));
  if (!context.recordId) return issues;
  const votes: Vote[] = [];
  const voteRefs = Array.isArray(payload.vote_refs) ? payload.vote_refs as Array<{ record_id: string; revision: number }> : [];
  for (const [index, item] of voteRefs.entries()) {
    const vote = await ref(context, item.record_id, item.revision);
    if (!vote || vote.pluginId !== "safdoulas-decisions" || vote.kind !== "deliberation_vote" || vote.state !== "submitted"
      || vote.payload.decision_record_id !== context.recordId || vote.payload.process_record_id !== process?.id) {
      issues.push(error("invalid_decision_vote", `vote_refs[${index}]`, "Cada voto precisa ser uma submissão independente, vinculada a esta decisão e processo."));
      continue;
    }
    votes.push(vote.payload as Vote);
  }
  if (new Set(votes.map((vote) => vote.voter_user_id)).size !== votes.length)
    issues.push(error("duplicate_decision_voter", "vote_refs", "Cada integrante pode registrar apenas um voto nesta deliberação."));
  const minimum = Number(policy.payload.minimum_voters);
  if (votes.length < minimum) issues.push(error("decision_quorum_missing", "vote_refs", `A política exige ao menos ${minimum} voto(s) para formar quórum.`));
  const position = outcome === "denied" ? "deny" : outcome === "further_diligence" ? "request_diligence" : "approve";
  if (!voteThreshold(policy, outcome, votes, [position]))
    issues.push(error("decision_support_threshold_missing", "vote_refs", "Os votos registrados não atingem o apoio mínimo definido para o resultado escolhido."));
  return issues;
}

export async function appealIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const prior = context.recordId ? await context.resolveLatestRecord?.(context.recordId) : null;
  const filing = !prior || prior.state === "draft";
  const process = await ref(context, payload.process_record_id, payload.process_revision);
  const decision = await ref(context, payload.decision_record_id, payload.decision_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process" || process.state !== "decision")
    issues.push(error("appeal_process_not_decided", "process_record_id", "O recurso precisa se referir a um processo com decisão comunicável."));
  if (!decision || decision.pluginId !== "safdoulas-decisions" || decision.kind !== "institutional_decision" || decision.state !== "ratified" || decision.payload.process_record_id !== process?.id)
    issues.push(error("ratified_decision_required", "decision_record_id", "O recurso precisa apontar para a decisão ratificada deste processo."));
  if (filing && payload.appellant_user_id !== context.actorId)
    issues.push(error("appeal_actor_mismatch", "appellant_user_id", "O recurso deve ser apresentado pela pessoa autenticada vinculada ao processo."));
  if (filing && process && !await context.hasPermissionOnResource?.(rolePermission("applicant"), process.id))
    issues.push(error("appeal_applicant_scope_required", "process_record_id", "O usuário precisa ter a função de requerente atribuída neste processo."));
  const policy = process && decision && await pinnedPolicy(process, decision.payload.decision_policy_record_id, decision.payload.decision_policy_revision, context);
  if (!policy || policy.payload.appeals_enabled !== true || Number(policy.payload.appeal_period_days) < 1)
    issues.push(error("appeal_not_enabled", "decision_record_id", "A política fixada não permite recurso neste processo."));
  const notice = await ref(context, payload.notice_record_id, payload.notice_revision);
  const receivedAt = notice?.payload.acknowledged_at || notice?.payload.delivered_at;
  const validNotice = notice?.pluginId === "safdoulas-diligences" && notice.kind === "case_communication"
    && ["delivered", "acknowledged"].includes(notice.state) && notice.payload.process_record_id === process?.id
    && notice.payload.decision_record_id === decision?.id && notice.payload.decision_revision === decision?.revision
    && Array.isArray(notice.payload.recipient_user_ids) && notice.payload.recipient_user_ids.includes(payload.appellant_user_id);
  if (filing && !validNotice)
    issues.push(error("formal_decision_notice_required", "notice_record_id", "Vincule a comunicação do resultado, com comprovante de entrega ou ciência formal da decisão recorrida."));
  const deadline = validNotice ? Date.parse(String(receivedAt)) + Number(policy?.payload.appeal_period_days || 0) * 86400000 : NaN;
  if (filing && (!Number.isFinite(deadline) || Date.now() > deadline))
    issues.push(error("appeal_deadline_expired", "decision_record_id", "O prazo parametrizado para apresentar recurso encerrou."));
  const appealable = Array.isArray(policy?.payload.appealable_outcomes) ? policy.payload.appealable_outcomes as string[] : [];
  if (decision && !appealable.includes(String(decision.payload.outcome)))
    issues.push(error("appeal_outcome_not_reviewable", "decision_record_id", "O resultado não está coberto pelo direito de recurso configurado."));
  if ((typeof payload.appeal_decision_record_id === "string") !== (typeof payload.appeal_decision_revision === "number"))
    issues.push(error("incomplete_appeal_decision_reference", "appeal_decision_record_id", "Informe a decisão recursal e sua versão juntas."));
  if (typeof payload.appeal_decision_record_id === "string" && typeof payload.appeal_decision_revision === "number") {
    const appealDecision = await ref(context, payload.appeal_decision_record_id, payload.appeal_decision_revision);
    if (!appealDecision || appealDecision.pluginId !== "safdoulas-decisions" || appealDecision.kind !== "appeal_decision"
      || appealDecision.state !== "ratified" || appealDecision.payload.appeal_record_id !== context.recordId)
      issues.push(error("invalid_appeal_decision_reference", "appeal_decision_record_id", "A decisão recursal vinculada precisa estar ratificada e pertencer a este recurso."));
  }
  return issues;
}

export async function appealDecisionIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const appeal = await ref(context, payload.appeal_record_id, payload.appeal_revision);
  if (!appeal || appeal.pluginId !== "safdoulas-decisions" || appeal.kind !== "appeal" || !["submitted", "under_review"].includes(appeal.state))
    issues.push(error("active_appeal_required", "appeal_record_id", "A decisão recursal precisa apontar para um recurso recebido e em análise."));
  const process = await ref(context, payload.process_record_id, payload.process_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process" || process.state !== "appeal" || appeal?.payload.process_record_id !== process.id)
    issues.push(error("appeal_process_mismatch", "process_record_id", "A decisão recursal precisa pertencer à etapa de recurso do mesmo processo."));
  const original = await ref(context, appeal?.payload.decision_record_id, appeal?.payload.decision_revision);
  const policy = process && original && await pinnedPolicy(process, original.payload.decision_policy_record_id, original.payload.decision_policy_revision, context);
  if (!policy) {
    issues.push(error("appeal_policy_unavailable", "appeal_record_id", "A política de decisão fixada não está disponível para revisar o recurso."));
    return issues;
  }
  if (payload.outcome !== "maintained" && !["approved", "approved_with_conditions", "denied"].includes(String(payload.resulting_outcome)))
    issues.push(error("appeal_result_required", "resulting_outcome", "Defina o resultado de acreditação que passa a valer após reformar ou ajustar a decisão."));
  if (payload.outcome === "maintained" && payload.resulting_outcome != null && payload.resulting_outcome !== original?.payload.outcome)
    issues.push(error("maintained_appeal_result_mismatch", "resulting_outcome", "A manutenção precisa preservar o resultado original."));
  if (!context.recordId) {
    if (!String(payload.reasoning || "").trim()) issues.push(error("appeal_reasoning_required", "reasoning", "Fundamente a decisão do recurso."));
    return issues;
  }
  const votes: Vote[] = [];
  const voteRefs = Array.isArray(payload.vote_refs) ? payload.vote_refs as Array<{ record_id: string; revision: number }> : [];
  for (const [index, item] of voteRefs.entries()) {
    const vote = await ref(context, item.record_id, item.revision);
    if (!vote || vote.pluginId !== "safdoulas-decisions" || vote.kind !== "appeal_review_vote" || vote.state !== "submitted"
      || vote.payload.appeal_decision_record_id !== context.recordId || vote.payload.process_record_id !== process?.id) {
      issues.push(error("invalid_appeal_vote", `vote_refs[${index}]`, "Cada voto recursal precisa ser uma submissão independente vinculada a esta decisão e processo."));
      continue;
    }
    votes.push(vote.payload as Vote);
  }
  if (new Set(votes.map((vote) => vote.voter_user_id)).size !== votes.length)
    issues.push(error("duplicate_appeal_reviewer", "vote_refs", "Cada revisor pode registrar apenas um voto neste recurso."));
  if (votes.length < Number(policy.payload.minimum_appeal_reviewers))
    issues.push(error("appeal_review_quorum_missing", "vote_refs", "O recurso não atingiu o quórum de revisão definido pela política."));
  const outcome = String(payload.outcome);
  const position = outcome === "maintained" ? "maintain" : outcome === "modified" ? "modify" : "reverse";
  if (!voteThreshold(policy, outcome, votes, [position]))
    issues.push(error("appeal_support_threshold_missing", "vote_refs", "Os votos não atingem o apoio mínimo da política recursal."));
  if (!String(payload.reasoning || "").trim()) issues.push(error("appeal_reasoning_required", "reasoning", "Fundamente a decisão do recurso."));
  return issues;
}

export async function authorizeAppealCreate(actorId: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  const process = await ref(context, payload.process_record_id, payload.process_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process" || process.state !== "decision") return false;
  return payload.appellant_user_id === actorId
    && Boolean(await context.hasPermissionOnResource?.(rolePermission("applicant"), process.id));
}

async function hasAnyRole(context: RecordValidationContext, processId: string, roles: string[]): Promise<boolean> {
  for (const role of roles) if (await context.hasPermissionOnResource?.(rolePermission(role), processId)) return true;
  return false;
}

async function voteBase(payload: Record<string, unknown>, context: RecordValidationContext, kind: "deliberation_vote" | "appeal_review_vote") {
  const decisionId = kind === "deliberation_vote" ? payload.decision_record_id : payload.appeal_decision_record_id;
  const decisionRevision = kind === "deliberation_vote" ? payload.decision_revision : payload.appeal_decision_revision;
  const decision = await ref(context, decisionId, decisionRevision);
  if (!decision || decision.pluginId !== "safdoulas-decisions" || decision.kind !== (kind === "deliberation_vote" ? "institutional_decision" : "appeal_decision") || decision.state !== "draft") return null;
  const processId = decision.payload.process_record_id;
  if (payload.process_record_id !== processId || payload.voter_user_id !== context.actorId || !context.actorId) return null;
  const process = await ref(context, processId, decision.payload.process_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process") return null;
  let policySource = decision;
  if (kind === "appeal_review_vote") {
    const appeal = await ref(context, decision.payload.appeal_record_id, decision.payload.appeal_revision);
    policySource = await ref(context, appeal?.payload.decision_record_id, appeal?.payload.decision_revision) as Ref || decision;
  }
  const policy = await pinnedPolicy(process, policySource.payload.decision_policy_record_id, policySource.payload.decision_policy_revision, context);
  if (!policy) return null;
  return { decision, process, policy };
}

async function authorizeVoteCreate(actorId: string, payload: Record<string, unknown>, context: RecordValidationContext, kind: "deliberation_vote" | "appeal_review_vote") {
  const base = await voteBase(payload, { ...context, actorId }, kind);
  if (!base) return false;
  const roles = kind === "deliberation_vote"
    ? base.policy.payload.eligible_roles as string[]
    : base.policy.payload.appeal_review_roles as string[];
  return hasAnyRole(context, base.process.id, Array.isArray(roles) ? roles : []);
}

export async function voteIssues(payload: Record<string, unknown>, context: RecordValidationContext, kind: "deliberation_vote" | "appeal_review_vote"): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const base = await voteBase(payload, context, kind);
  if (!base) {
    issues.push(error("vote_assignment_invalid", kind === "deliberation_vote" ? "decision_record_id" : "appeal_decision_record_id", "O voto precisa pertencer a uma decisão em rascunho e a uma pessoa habilitada neste processo."));
    return issues;
  }
  const roles = kind === "deliberation_vote"
    ? base.policy.payload.eligible_roles as string[]
    : base.policy.payload.appeal_review_roles as string[];
  if (!await hasAnyRole(context, base.process.id, Array.isArray(roles) ? roles : []))
    issues.push(error("voter_role_required", "voter_user_id", "A pessoa autenticada não possui função deliberativa atribuída neste processo."));
  if (kind === "deliberation_vote" && base.process.state !== "deliberation")
    issues.push(error("process_not_deliberating", "process_record_id", "O processo não está recebendo votos de deliberação."));
  if (kind === "appeal_review_vote" && base.process.state !== "appeal")
    issues.push(error("process_not_under_appeal", "process_record_id", "O processo não está na etapa de julgamento do recurso."));
  return issues;
}

async function voteTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext, kind: "deliberation_vote" | "appeal_review_vote"): Promise<string[]> {
  if (state !== "draft") return [];
  return await voteIssues(payload, context, kind).then((issues) => issues.length ? [] : ["submitted"]);
}

async function voteAuthorizeTransition(from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext, kind: "deliberation_vote" | "appeal_review_vote"): Promise<boolean> {
  return from === "draft" && to === "submitted" && (await voteIssues(payload, context, kind)).length === 0;
}

async function voteRecordAccess(actorId: string, action: string, state: string, payload: Record<string, unknown>, context: RecordValidationContext) {
  if (await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission)) return true;
  return payload.voter_user_id === actorId && (action === "read" || (action === "write" && state === "draft") || (action === "publish" && state === "draft"));
}

async function authorizeDecisionRecord(actorId: string, action: string, _state: string, payload: Record<string, unknown>, context: RecordValidationContext) {
  if (await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission)) return true;
  if (action !== "read") return false;
  const process = await ref(context, payload.process_record_id, payload.process_revision);
  if (process && _state === "ratified" && await hasAnyRole(context, process.id, ["applicant", "institution_representative"])) return true;
  const policy = process && await pinnedPolicy(process, payload.decision_policy_record_id, payload.decision_policy_revision, context);
  return Boolean(process && policy && await hasAnyRole(context, process.id, policy.payload.eligible_roles as string[] || []));
}

async function authorizeAppealDecisionRecord(actorId: string, action: string, _state: string, payload: Record<string, unknown>, context: RecordValidationContext) {
  if (await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission)) return true;
  if (action !== "read") return false;
  const process = await ref(context, payload.process_record_id, payload.process_revision);
  if (process && _state === "ratified" && await hasAnyRole(context, process.id, ["applicant", "institution_representative"])) return true;
  const appeal = await ref(context, payload.appeal_record_id, payload.appeal_revision);
  const original = await ref(context, appeal?.payload.decision_record_id, appeal?.payload.decision_revision);
  const policy = process && original && await pinnedPolicy(process, original.payload.decision_policy_record_id, original.payload.decision_policy_revision, context);
  return Boolean(process && policy && await hasAnyRole(context, process.id, policy.payload.appeal_review_roles as string[] || []));
}

async function decisionTransitions(state: string, _payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  return state === "draft" && (await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission)) ? ["ratified"] : [];
}

async function authorizeDecisionTransition(from: string, to: string, _payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  return from === "draft" && to === "ratified"
    && Boolean(await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission));
}

async function prepareDecisionTransition(from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<Record<string, unknown>> {
  if (from !== "draft" || to !== "ratified") return payload;
  const process = await ref(context, payload.process_record_id, payload.process_revision);
  const policy = process && await pinnedPolicy(process, payload.decision_policy_record_id, payload.decision_policy_revision, context);
  if (!policy) throw new Error("A política de decisão ativa não está fixada nas regras do processo.");
  const decided = new Date();
  return { ...payload, decided_at: decided.toISOString(), appeal_deadline_at: null };
}

async function appealTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission)) {
    if (state === "submitted") return ["under_review"];
    if (state === "under_review" && typeof payload.appeal_decision_record_id === "string" && typeof payload.appeal_decision_revision === "number") {
      const decision = await ref(context, payload.appeal_decision_record_id, payload.appeal_decision_revision);
      if (decision?.pluginId === "safdoulas-decisions" && decision.kind === "appeal_decision" && decision.state === "ratified") return ["decided"];
    }
  }
  if (state === "draft" && payload.appellant_user_id === context.actorId && (await appealIssues(payload, context)).length === 0)
    return ["submitted"];
  return [];
}

const recordKinds: Record<string, RecordKindContribution> = {
  deliberation_vote: {
    label: "Voto de deliberação",
    schema: object({
      decision_record_id: uuid, decision_revision: { type: "integer", minimum: 1 },
      process_record_id: uuid, voter_user_id: uuid,
      position: { type: "string", enum: ["approve", "deny", "request_diligence", "abstain"] },
      rationale: text(8000), voted_at: { type: ["string", "null"], format: "date-time" },
    }),
    initial: "draft", transitions: { draft: ["submitted"], submitted: [] }, immutable: ["submitted"],
    resourceScoped: true, managePermission, authorizeCreate: (actorId, payload, context) => authorizeVoteCreate(actorId, payload, context, "deliberation_vote"),
    authorizeRecord: voteRecordAccess,
    availableTransitions: (state, payload, context) => voteTransitions(state, payload, context, "deliberation_vote"),
    authorizeTransition: (from, to, payload, context) => voteAuthorizeTransition(from, to, payload, context, "deliberation_vote"),
    prepareTransition: async (from, to, payload) => from === "draft" && to === "submitted" ? { ...payload, voted_at: new Date().toISOString() } : payload,
    validate: (payload, context) => voteIssues(payload, context, "deliberation_vote"),
    example: { decision_record_id: "00000000-0000-4000-8000-000000000001", decision_revision: 1, process_record_id: "00000000-0000-4000-8000-000000000002", voter_user_id: "00000000-0000-4000-8000-000000000003", position: "approve", rationale: "Voto demonstrativo.", voted_at: null },
  },
  appeal_review_vote: {
    label: "Voto de revisão de recurso",
    schema: object({
      appeal_decision_record_id: uuid, appeal_decision_revision: { type: "integer", minimum: 1 },
      process_record_id: uuid, voter_user_id: uuid,
      position: { type: "string", enum: ["maintain", "modify", "reverse", "abstain"] },
      rationale: text(8000), voted_at: { type: ["string", "null"], format: "date-time" },
    }),
    initial: "draft", transitions: { draft: ["submitted"], submitted: [] }, immutable: ["submitted"],
    resourceScoped: true, managePermission, authorizeCreate: (actorId, payload, context) => authorizeVoteCreate(actorId, payload, context, "appeal_review_vote"),
    authorizeRecord: voteRecordAccess,
    availableTransitions: (state, payload, context) => voteTransitions(state, payload, context, "appeal_review_vote"),
    authorizeTransition: (from, to, payload, context) => voteAuthorizeTransition(from, to, payload, context, "appeal_review_vote"),
    prepareTransition: async (from, to, payload) => from === "draft" && to === "submitted" ? { ...payload, voted_at: new Date().toISOString() } : payload,
    validate: (payload, context) => voteIssues(payload, context, "appeal_review_vote"),
    example: { appeal_decision_record_id: "00000000-0000-4000-8000-000000000004", appeal_decision_revision: 1, process_record_id: "00000000-0000-4000-8000-000000000002", voter_user_id: "00000000-0000-4000-8000-000000000003", position: "maintain", rationale: "Voto demonstrativo.", voted_at: null },
  },
  institutional_decision: {
    label: "Deliberação e decisão institucional",
    schema: object({
      process_record_id: uuid, process_revision: { type: "integer", minimum: 1 },
      evaluation_consolidation_record_id: uuid, evaluation_consolidation_revision: { type: "integer", minimum: 1 },
      decision_policy_record_id: uuid, decision_policy_revision: { type: "integer", minimum: 1 },
      outcome: { type: "string", enum: ["approved", "approved_with_conditions", "further_diligence", "denied"] },
      vote_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }), 100),
      grounds: text(16000), conditions_or_requests: optionalText(12000), denial_basis: optionalText(12000),
      evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 }, rationale: text(1000) }), 100),
      decided_at: { type: ["string", "null"], format: "date-time" }, appeal_deadline_at: { type: ["string", "null"], format: "date-time" },
      signatory_user_ids: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: uuid },
      signature_document_ref: object({ record_id: { type: ["string", "null"], pattern: uuid.pattern }, revision: { type: ["integer", "null"], minimum: 1 } }),
    }),
    initial: "draft", transitions: { draft: ["ratified"], ratified: [] }, immutable: ["ratified"],
    resourceScoped: true, managePermission,
    authorizeRecord: authorizeDecisionRecord,
    availableTransitions: decisionTransitions, authorizeTransition: authorizeDecisionTransition, prepareTransition: prepareDecisionTransition,
    validate: institutionalDecisionIssues,
    example: {
      process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 5,
      evaluation_consolidation_record_id: "00000000-0000-4000-8000-000000000002", evaluation_consolidation_revision: 1,
      decision_policy_record_id: "00000000-0000-4000-8000-000000000003", decision_policy_revision: 1,
      outcome: "approved_with_conditions", vote_refs: [],
      grounds: "Fundamentação demonstrativa vinculada aos pareceres e à matriz.", conditions_or_requests: "Condição demonstrativa.", denial_basis: "",
      evidence_refs: [], decided_at: null, appeal_deadline_at: null, signatory_user_ids: ["00000000-0000-4000-8000-000000000004"], signature_document_ref: { record_id: null, revision: null },
    },
  },
  appeal: {
    label: "Recurso da instituição",
    schema: object({
      process_record_id: uuid, process_revision: { type: "integer", minimum: 1 },
      decision_record_id: uuid, decision_revision: { type: "integer", minimum: 1 },
      appellant_user_id: uuid, protocol_number: text(160), grounds: text(16000),
      notice_record_id: nullableUuid, notice_revision: { type: ["integer", "null"], minimum: 1 },
      appeal_decision_record_id: nullableUuid, appeal_decision_revision: { type: ["integer", "null"], minimum: 1 },
      evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 }, description: text(1000) }), 100),
      submitted_at: { type: "string", format: "date-time" },
    }, ["process_record_id", "process_revision", "decision_record_id", "decision_revision", "appellant_user_id", "protocol_number", "grounds", "appeal_decision_record_id", "appeal_decision_revision", "evidence_refs", "submitted_at"]),
    initial: "draft", transitions: { draft: ["submitted"], submitted: ["under_review"], under_review: ["decided"], decided: [] }, immutable: ["decided"],
    resourceScoped: true, managePermission, authorizeCreate: authorizeAppealCreate,
    authorizeRecord: async (actorId, action, state, payload, context) => action === "read"
      ? actorId === payload.appellant_user_id || Boolean(await context.hasPermissionOnResource?.(rolePermission("appeal_reviewer"), String(payload.process_record_id)))
      : actorId === payload.appellant_user_id && action === "publish" && state === "draft",
    availableTransitions: appealTransitions,
    uniqueFields: ["protocol_number"],
    prepareTransition: async (from, to, payload, context) => from === "draft" && to === "submitted"
      ? { ...payload, submitted_at: new Date().toISOString(), protocol_number: `SAF-REC-${new Date().getUTCFullYear()}/${await context.nextSequence?.() || ""}` } : payload,
    validate: appealIssues,
    example: {
      process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 7,
      decision_record_id: "00000000-0000-4000-8000-000000000005", decision_revision: 1,
      appellant_user_id: "00000000-0000-4000-8000-000000000006", protocol_number: "SAF-REC-DEMO-001",
      appeal_decision_record_id: null, appeal_decision_revision: null,
      grounds: "Fundamentação demonstrativa; substituir pela manifestação real.", evidence_refs: [], submitted_at: "2030-01-01T12:00:00.000Z",
    },
  },
  appeal_decision: {
    label: "Decisão recursal",
    schema: object({
      process_record_id: uuid, process_revision: { type: "integer", minimum: 1 },
      appeal_record_id: uuid, appeal_revision: { type: "integer", minimum: 1 },
      outcome: { type: "string", enum: ["maintained", "modified", "reversed"] },
      resulting_outcome: { type: ["string", "null"], enum: ["approved", "approved_with_conditions", "denied", null] },
      vote_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }), 100),
      reasoning: text(16000), evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }), 100),
      decided_at: { type: ["string", "null"], format: "date-time" }, signatory_user_ids: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: uuid },
    }, ["process_record_id", "process_revision", "appeal_record_id", "appeal_revision", "outcome", "vote_refs", "reasoning", "evidence_refs", "decided_at", "signatory_user_ids"]),
    initial: "draft", transitions: { draft: ["ratified"], ratified: [] }, immutable: ["ratified"],
    resourceScoped: true, managePermission,
    authorizeRecord: authorizeAppealDecisionRecord,
    availableTransitions: decisionTransitions, authorizeTransition: authorizeDecisionTransition,
    validate: appealDecisionIssues,
    prepareTransition: async (from, to, payload, context) => {
      if (from !== "draft" || to !== "ratified") return payload;
      const appeal = await ref(context, payload.appeal_record_id, payload.appeal_revision);
      const original = appeal && await ref(context, appeal.payload.decision_record_id, appeal.payload.decision_revision);
      return { ...payload, decided_at: new Date().toISOString(), resulting_outcome: payload.outcome === "maintained" ? original?.payload.outcome : payload.resulting_outcome };
    },
    example: {
      process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 8,
      appeal_record_id: "00000000-0000-4000-8000-000000000007", appeal_revision: 2,
      outcome: "maintained", vote_refs: [],
      reasoning: "Fundamentação demonstrativa do recurso.", evidence_refs: [], decided_at: null, signatory_user_ids: ["00000000-0000-4000-8000-000000000008"],
    },
  },
};

export const safdoulasDecisionsPlugin: PluginDefinition = {
  id: "safdoulas-decisions", name: "Deliberações e recursos SAFDOULAS", version: "1.0.0",
  description: "Registra decisões institucionais, quórum e votos, recursos e julgamento recursal usando políticas institucionais versionadas.",
  scope: "workspace", dependencies: ["versioned-records", "safdoulas-processes", "safdoulas-governance", "safdoulas-assessments", "documents", "privacy"],
  capabilities: ["read", "write", "manage"].map((action) => ({
    id: action, name: action === "read" ? "Consultar deliberações e recursos" : action === "write" ? "Preparar deliberação e recurso" : "Administrar decisões institucionais",
    permissions: [`plugin.safdoulas-decisions.${action}`],
  })),
  contributions: { navigation: [{ id: "safdoulas-decisions", href: "/extensions/safdoulas-decisions", label: "Decisões e recursos" , permission: "plugin.safdoulas-decisions.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "workflow", "label": "Tramitação", "order": 2}, order: 5}], recordKinds },
};
