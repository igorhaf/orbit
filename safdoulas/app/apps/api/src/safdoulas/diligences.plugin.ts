import { Body, Controller, HttpException, Inject, Param, Post, Req } from "@nestjs/common";
import type { AccessRequest } from "../access/access";
import { AccessService } from "../access/access";
import type { AuthMailer } from "../access/auth-lifecycle";
import { Db } from "../db";
import { PluginRegistry } from "../execution/registries";
import { ExtensionRecords } from "../plugins/records/records.service";
import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue } from "../plugins/contract";

const uuid = { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const text = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
const optionalText = (maxLength = 4000) => ({ type: "string", maxLength });
const list = (items: Record<string, unknown>, maxItems = 100) => ({ type: "array", items, maxItems });
const object = (properties: Record<string, Record<string, unknown>>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const managePermission = "plugin.safdoulas-diligences.manage";
const representativePermission = "plugin.safdoulas-processes.transition.institution_representative";
type Ref = { id: string; pluginId: string; kind: string; state: string; revision: number; payload: Record<string, unknown> };

function error(code: string, path: string, message: string): RecordValidationIssue {
  return { severity: "error", code, path, message };
}

async function reference(context: RecordValidationContext, id: unknown, revision: unknown): Promise<Ref | null> {
  return typeof id === "string" && Number.isInteger(revision) ? context.resolveRecord(id, Number(revision)) as Promise<Ref | null> : null;
}

export async function diligenceIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const process = await reference(context, payload.process_record_id, payload.process_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process")
    issues.push(error("invalid_diligence_process", "process_record_id", "A diligência precisa estar vinculada a um processo de acreditação versionado."));
  else {
    const rules = await reference(context, process.payload.ruleset_record_id, process.payload.ruleset_revision);
    const transitions = Array.isArray(rules?.payload.state_transitions) ? rules.payload.state_transitions as Array<{ from: string; to: string }> : [];
    const stage = payload.stage === "preliminary_admissibility" ? "preliminary_admissibility" : "assessment";
    const allowedEdge = stage === "preliminary_admissibility"
      ? transitions.some((edge) => edge.from === "triage" && edge.to === "diligence")
      : transitions.some((edge) => (edge.from === "review" || edge.from === "deliberation") && edge.to === "diligence");
    if (process.state !== "diligence" || !allowedEdge)
      issues.push(error("process_not_in_diligence", "process_record_id", "Abra a diligência somente quando o processo estiver na etapa prevista pelas regras vigentes."));
    if (stage === "preliminary_admissibility") {
      const review = await reference(context, process.payload.triage_review_record_id, process.payload.triage_review_revision);
      if (!review || review.pluginId !== "safdoulas-triage" || review.kind !== "admissibility_review" || review.state !== "completed"
        || review.payload.process_record_id !== process.id || review.payload.recommendation !== "correction_required")
        issues.push(error("preliminary_correction_not_recommended", "stage", "A complementação preliminar exige uma triagem concluída que recomende correções para este processo."));
    }
  }
  const items = Array.isArray(payload.items) ? payload.items as Array<{ code: string; request: string; required: boolean }> : [];
  if (!items.length) issues.push(error("diligence_items_required", "items", "Registre ao menos um complemento solicitado."));
  const codes = items.map((item) => item.code.trim());
  if (new Set(codes).size !== codes.length) issues.push(error("duplicate_diligence_item", "items", "Os códigos dos itens da diligência devem ser únicos."));
  const prior = context.recordId ? await context.resolveLatestRecord?.(context.recordId) : null;
  if ((!prior || prior.state === "draft" || prior.payload.due_at !== payload.due_at) && Date.parse(String(payload.due_at)) <= Date.now())
    issues.push(error("diligence_deadline_invalid", "due_at", "O prazo de uma nova solicitação precisa estar no futuro; diligências já abertas preservam o prazo e seu histórico."));
  const deadlineId = payload.deadline_record_id;
  const deadlineRevision = payload.deadline_record_revision;
  if ((typeof deadlineId === "string") !== (typeof deadlineRevision === "number"))
    issues.push(error("incomplete_diligence_deadline_reference", "deadline_record_id", "Informe o relógio de prazo e sua versão juntos."));
  if (payload.pause_process_deadline === true && (typeof deadlineId !== "string" || typeof deadlineRevision !== "number"))
    issues.push(error("diligence_deadline_required", "deadline_record_id", "Vincule o relógio genérico do processo para suspender e retomar o prazo automaticamente."));
  if (typeof deadlineId === "string" && typeof deadlineRevision === "number") {
    const deadline = await reference(context, deadlineId, deadlineRevision);
    if (!deadline || deadline.pluginId !== "deadlines" || deadline.kind !== "clock"
      || deadline.payload.target_type !== "safdoulas_process" || deadline.payload.target_id !== process?.id)
      issues.push(error("invalid_diligence_deadline_reference", "deadline_record_id", "O prazo precisa ser um relógio genérico vinculado ao mesmo processo de acreditação."));
  }
  if (payload.pause_process_deadline === true && !String(payload.pause_reason || "").trim())
    issues.push(error("diligence_pause_reason_required", "pause_reason", "Registre o motivo da suspensão do prazo enquanto a instituição prepara a resposta."));
  return issues;
}

export function diligenceDeadlineEffects(from: string, to: string, payload: Record<string, unknown>) {
  if (payload.pause_process_deadline !== true || typeof payload.deadline_record_id !== "string") return [];
  const pause = (from === "draft" && to === "requested") || (from === "under_review" && to === "follow_up_requested");
  const resume = (from === "requested" && to === "response_received") || (from === "follow_up_requested" && to === "response_received");
  if (pause) return [{ recordId: payload.deadline_record_id, event: "pause" as const, reason: String(payload.pause_reason || "Aguardando resposta da instituição.") }];
  if (resume) return [{ recordId: payload.deadline_record_id, event: "resume" as const, reason: "Prazo retomado após o recebimento da resposta institucional." }];
  return [];
}

export async function diligenceResponseIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const diligence = await reference(context, payload.diligence_record_id, payload.diligence_revision);
  if (!diligence || diligence.pluginId !== "safdoulas-diligences" || diligence.kind !== "diligence" || !["requested", "follow_up_requested"].includes(diligence.state))
    return [error("open_diligence_required", "diligence_record_id", "A resposta precisa atender a uma diligência aberta e versionada.")];
  if (payload.respondent_user_id !== diligence.payload.respondent_user_id || context.actorId !== diligence.payload.respondent_user_id)
    return [error("diligence_respondent_mismatch", "respondent_user_id", "Somente a pessoa representante definida na diligência pode enviar esta resposta.")];
  const requested = Array.isArray(diligence.payload.items) ? diligence.payload.items as Array<{ code: string; required: boolean }> : [];
  const responses = Array.isArray(payload.item_responses) ? payload.item_responses as Array<{
    item_code: string;
    evidence_refs?: Array<{ record_id: string; revision: number }>;
  }> : [];
  const requestedCodes = new Set(requested.map((item) => item.code));
  const responseCodes = responses.map((item) => item.item_code);
  if (new Set(responseCodes).size !== responseCodes.length)
    return [error("duplicate_diligence_response", "item_responses", "Cada item solicitado pode receber uma única resposta por ciclo.")];
  if (responseCodes.some((code) => !requestedCodes.has(code)))
    return [error("unknown_diligence_item", "item_responses", "A resposta contém um item que não pertence a esta diligência.")];
  if (requested.some((item) => item.required && !responseCodes.includes(item.code)))
    return [error("required_diligence_item_unanswered", "item_responses", "Responda todos os itens obrigatórios antes de enviar a complementação.")];
  const evidence = Array.isArray(payload.evidence_refs) ? [...payload.evidence_refs as Array<{ record_id: string; revision: number }>] : [];
  for (const response of responses) {
    if (Array.isArray(response.evidence_refs)) evidence.push(...response.evidence_refs);
  }
  const processId = diligence.payload.process_record_id;
  const processRevision = diligence.payload.process_revision;
  for (const [index, item] of evidence.entries()) {
    const document = await reference(context, item.record_id, item.revision);
    if (!document || document.pluginId !== "documents" || document.kind !== "document" || document.state !== "published")
      return [error("invalid_diligence_evidence", `evidence_refs[${index}]`, "Cada anexo deve apontar para um documento publicado e preservado.")];
    if ((document.payload.related_record_id ?? document.payload.source_id) !== processId || (document.payload.related_record_revision ?? document.payload.source_revision) !== processRevision)
      return [error("diligence_evidence_process_mismatch", `evidence_refs[${index}]`, "O documento anexado precisa pertencer ao mesmo processo.")];
  }
  return [];
}

export async function communicationIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const process = await reference(context, payload.process_record_id, payload.process_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process")
    issues.push(error("invalid_communication_process", "process_record_id", "A comunicação precisa pertencer a um processo de acreditação."));
  if ((typeof payload.decision_record_id === "string") !== (typeof payload.decision_revision === "number"))
    issues.push(error("incomplete_communication_decision", "decision_record_id", "Informe a decisão comunicada e sua versão juntas."));
  if (typeof payload.decision_record_id === "string") {
    const decision = await reference(context, payload.decision_record_id, payload.decision_revision);
    if (!decision || decision.pluginId !== "safdoulas-decisions" || !["institutional_decision", "appeal_decision"].includes(decision.kind)
      || decision.state !== "ratified" || decision.payload.process_record_id !== process?.id)
      issues.push(error("communication_decision_mismatch", "decision_record_id", "A comunicação de resultado deve preservar a decisão ratificada deste processo."));
  }
  if (context.actorId !== payload.sender_user_id && !await context.hasGlobalPermission?.(managePermission))
    issues.push(error("communication_sender_mismatch", "sender_user_id", "O remetente registrado precisa corresponder à pessoa autenticada."));
  if (typeof payload.diligence_record_id === "string") {
    const diligence = await reference(context, payload.diligence_record_id, Number(payload.diligence_revision));
    if (!diligence || diligence.pluginId !== "safdoulas-diligences" || diligence.kind !== "diligence"
      || diligence.payload.process_record_id !== process?.id)
      issues.push(error("communication_diligence_mismatch", "diligence_record_id", "A comunicação precisa apontar para uma diligência deste mesmo processo."));
  }
  const status = payload.delivery_status;
  const sentAt = payload.sent_at;
  const deliveredAt = payload.delivered_at;
  const acknowledgedAt = payload.acknowledged_at;
  const failureReason = typeof payload.failure_reason === "string" ? payload.failure_reason.trim() : "";
  const isTimestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (status === "draft" && (sentAt !== null || deliveredAt !== null || acknowledgedAt !== null))
    issues.push(error("draft_communication_has_delivery_dates", "delivery_status", "Um rascunho não pode registrar envio, entrega ou ciência."));
  if (["sent", "delivered", "acknowledged"].includes(String(status)) && !isTimestamp(sentAt))
    issues.push(error("communication_sent_at_required", "sent_at", "Registre a data de envio antes de marcar a comunicação como enviada."));
  if (["delivered", "acknowledged"].includes(String(status)) && !isTimestamp(deliveredAt))
    issues.push(error("communication_delivered_at_required", "delivered_at", "Registre a confirmação de entrega antes de avançar a comunicação."));
  if (status === "acknowledged" && !isTimestamp(acknowledgedAt))
    issues.push(error("communication_acknowledged_at_required", "acknowledged_at", "Registre a data de ciência antes de concluir a comunicação."));
  for (const [idField, revisionField, requiredFor, code, label] of [
    ["delivery_evidence_record_id", "delivery_evidence_revision", ["delivered", "acknowledged"], "communication_delivery_evidence_required", "comprovante de entrega"],
    ["acknowledgement_evidence_record_id", "acknowledgement_evidence_revision", ["acknowledged"], "communication_acknowledgement_evidence_required", "comprovante de ciência"],
  ] as const) {
    const evidenceId = payload[idField];
    const evidenceRevision = payload[revisionField];
    if ((typeof evidenceId === "string") !== (typeof evidenceRevision === "number"))
      issues.push(error(`incomplete_${code}`, idField, `Informe o registro e a versão do ${label} juntos.`));
    if ((requiredFor as readonly string[]).includes(String(status)) && (typeof evidenceId !== "string" || typeof evidenceRevision !== "number"))
      issues.push(error(code, idField, `Anexe um documento versionado como ${label} antes de confirmar este estado.`));
    if (typeof evidenceId === "string" && typeof evidenceRevision === "number") {
      const evidence = await reference(context, evidenceId, evidenceRevision);
      if (!evidence || evidence.pluginId !== "documents" || evidence.kind !== "document" || evidence.state !== "published")
        issues.push(error(`invalid_${code}`, idField, `O ${label} precisa ser um documento publicado neste workspace.`));
      else if ((evidence.payload.related_record_id ?? evidence.payload.source_id) !== process?.id || (evidence.payload.related_record_revision ?? evidence.payload.source_revision) !== payload.process_revision)
        issues.push(error(`unrelated_${code}`, idField, `O ${label} precisa pertencer à versão deste mesmo processo.`));
    }
  }
  if (status !== "failed" && failureReason)
    issues.push(error("communication_failure_reason_unexpected", "failure_reason", "A justificativa de falha só pode ser preenchida quando o envio falhar."));
  if (status === "failed" && !failureReason)
    issues.push(error("communication_failure_reason_required", "failure_reason", "Registre o motivo quando uma comunicação falhar."));
  if (isTimestamp(sentAt) && isTimestamp(deliveredAt) && Date.parse(String(deliveredAt)) < Date.parse(String(sentAt)))
    issues.push(error("communication_delivery_before_send", "delivered_at", "A confirmação de entrega não pode anteceder o envio."));
  if (isTimestamp(deliveredAt) && isTimestamp(acknowledgedAt) && Date.parse(String(acknowledgedAt)) < Date.parse(String(deliveredAt)))
    issues.push(error("communication_acknowledgement_before_delivery", "acknowledged_at", "A ciência não pode anteceder a entrega registrada."));
  return issues;
}

export function prepareCommunicationTransition(
  _from: string,
  to: string,
  payload: Record<string, unknown>,
  now = new Date(),
): Record<string, unknown> {
  const timestamp = now.toISOString();
  return {
    ...payload,
    delivery_status: to,
    sent_at: to === "sent" ? timestamp : payload.sent_at,
    delivered_at: payload.delivered_at,
    acknowledged_at: payload.acknowledged_at,
    failure_reason: to === "failed" ? payload.failure_reason : "",
  };
}

async function hasRepresentativeScope(actorId: string, processId: unknown, context: RecordValidationContext) {
  return actorId === context.actorId && typeof processId === "string"
    && Boolean(await context.hasPermissionOnResource?.(representativePermission, processId));
}

export async function authorizeDiligence(actorId: string, action: string, state: string, payload: Record<string, unknown>, context: RecordValidationContext) {
  if (await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission)) return true;
  return payload.respondent_user_id === actorId
    && await hasRepresentativeScope(actorId, payload.process_record_id, context)
    && (action === "read" || (action === "publish" && ["requested", "follow_up_requested"].includes(state)));
}

export async function authorizeResponse(actorId: string, action: string, state: string, payload: Record<string, unknown>, context: RecordValidationContext) {
  if (await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission)) return true;
  const diligence = await reference(context, payload.diligence_record_id, payload.diligence_revision);
  return payload.respondent_user_id === actorId
    && diligence?.pluginId === "safdoulas-diligences" && diligence.kind === "diligence"
    && diligence.payload.respondent_user_id === actorId
    && await hasRepresentativeScope(actorId, diligence.payload.process_record_id, context)
    && (action === "read" || action === "write" || (action === "publish" && state === "draft"));
}

export async function authorizeResponseCreate(actorId: string, payload: Record<string, unknown>, context: RecordValidationContext) {
  if (await context.hasGlobalPermission?.(managePermission)) return true;
  const diligence = await reference(context, payload.diligence_record_id, payload.diligence_revision);
  return Boolean(diligence && diligence.pluginId === "safdoulas-diligences" && diligence.kind === "diligence"
    && ["requested", "follow_up_requested"].includes(diligence.state)
    && diligence.payload.respondent_user_id === actorId && payload.respondent_user_id === actorId
    && await hasRepresentativeScope(actorId, diligence.payload.process_record_id, context));
}

async function diligenceTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission))
    return ({ draft: ["requested"], requested: ["cancelled"], response_received: ["under_review"], under_review: ["follow_up_requested", "closed"], follow_up_requested: [], closed: [], cancelled: [] } as Record<string, string[]>)[state] || [];
  if (typeof context.actorId === "string" && payload.respondent_user_id === context.actorId && await hasRepresentativeScope(context.actorId, payload.process_record_id, context)) {
    if (state === "requested" || state === "follow_up_requested") return ["response_received"];
  }
  return [];
}

async function responseTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission)) return state === "draft" ? ["submitted"] : [];
  const diligence = await reference(context, payload.diligence_record_id, payload.diligence_revision);
  return typeof context.actorId === "string" && payload.respondent_user_id === context.actorId && state === "draft"
    && diligence?.pluginId === "safdoulas-diligences" && diligence.kind === "diligence"
    && await hasRepresentativeScope(context.actorId, diligence.payload.process_record_id, context) ? ["submitted"] : [];
}

async function authorizeDiligenceTransition(from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext) {
  if (from === "requested" && to === "response_received")
    return typeof context.actorId === "string" && context.actorId === payload.respondent_user_id && await hasRepresentativeScope(context.actorId, payload.process_record_id, context);
  return Boolean(await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission))
    && ((from === "requested" && to === "cancelled")
      || (from === "response_received" && ["under_review", "follow_up_requested", "closed"].includes(to))
      || (from === "under_review" && ["follow_up_requested", "closed"].includes(to))
      || (from === "follow_up_requested" && to === "response_received"));
}

async function authorizeResponseTransition(from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext) {
  if (from !== "draft" || to !== "submitted") return false;
  if (await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission)) return true;
  const diligence = await reference(context, payload.diligence_record_id, payload.diligence_revision);
  return typeof context.actorId === "string" && payload.respondent_user_id === context.actorId
    && diligence?.pluginId === "safdoulas-diligences" && diligence.kind === "diligence"
    && await hasRepresentativeScope(context.actorId, diligence.payload.process_record_id, context);
}

export async function communicationTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (!await context.hasGlobalPermission?.(managePermission) && !await context.hasPermission?.(managePermission)) return [];
  const evidenceIsPublished = async (idField: string, revisionField: string) => {
    const id = payload[idField];
    const revision = payload[revisionField];
    if (typeof id !== "string" || typeof revision !== "number") return false;
    const document = await context.resolveRecord(id, revision);
    return document?.pluginId === "documents" && document.kind === "document" && document.state === "published";
  };
  if (state === "sent") return [...(await evidenceIsPublished("delivery_evidence_record_id", "delivery_evidence_revision") ? ["delivered"] : []), "failed"];
  if (state === "delivered") return await evidenceIsPublished("acknowledgement_evidence_record_id", "acknowledgement_evidence_revision") ? ["acknowledged"] : [];
  return ({ draft: ["queued"], queued: ["sent", "failed"], sent: ["delivered", "failed"], delivered: ["acknowledged"], failed: ["queued"], acknowledged: [] } as Record<string, string[]>)[state] || [];
}

async function authorizeCommunicationTransition(from: string, to: string, _payload: Record<string, unknown>, context: RecordValidationContext) {
  return Boolean(await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission))
    && ({ draft: ["queued"], queued: ["sent", "failed"], sent: ["delivered", "failed"], delivered: ["acknowledged"], failed: ["queued"] } as Record<string, string[]>)[from]?.includes(to) === true;
}

const recordKinds: Record<string, RecordKindContribution> = {
  process_meeting: {
    label: "Entrevista ou reunião complementar",
    schema: object({
      process_record_id: uuid, process_revision: { type: "integer", minimum: 1 },
      scheduled_at: { type: "string", format: "date-time" }, agenda: text(8000),
      invited_user_ids: list(uuid, 100), attended_user_ids: list(uuid, 100),
      minutes: optionalText(30000), result: optionalText(12000),
      evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }), 100),
    }),
    initial: "planned", transitions: { planned: ["confirmed", "cancelled"], confirmed: ["held", "cancelled"], held: [], cancelled: [] }, immutable: ["held", "cancelled"],
    resourceScoped: true, managePermission,
    authorizeRecord: async (actor, action, _state, payload) => action === "read" && Array.isArray(payload.invited_user_ids) && payload.invited_user_ids.includes(actor),
    availableTransitions: (state, payload) => state === "planned" ? ["confirmed", "cancelled"]
      : state === "confirmed" ? String(payload.minutes || "").trim() && String(payload.result || "").trim() && Array.isArray(payload.attended_user_ids) && payload.attended_user_ids.length ? ["held", "cancelled"] : ["cancelled"] : [],
    validate: async (payload, context) => {
      const process = await reference(context, payload.process_record_id, payload.process_revision);
      const issues: RecordValidationIssue[] = [];
      if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process")
        issues.push(error("meeting_process_required", "process_record_id", "Vincule a entrevista ao processo correspondente."));
      const invited = payload.invited_user_ids as string[] || [];
      if ((payload.attended_user_ids as string[] || []).some((user) => !invited.includes(user)))
        issues.push(error("meeting_attendance_not_invited", "attended_user_ids", "Inclua na convocação todas as pessoas que participaram da reunião."));
      return issues;
    },
    example: { process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 1, scheduled_at: "2026-12-01T12:00:00Z", agenda: "Esclarecimento documental e pedagógico.", invited_user_ids: [], attended_user_ids: [], minutes: "", result: "", evidence_refs: [] },
  },
  exceptional_case: {
    label: "Caso omisso e deliberação excepcional",
    schema: object({
      process_record_id: uuid, process_revision: { type: "integer", minimum: 1 },
      subject: text(500), description: text(12000), competent_body: text(300),
      responsible_user_ids: list(uuid, 50), resolution: optionalText(16000), decision_reference: optionalText(2000),
      evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }), 100),
    }),
    initial: "open", transitions: { open: ["under_review"], under_review: ["decided"], decided: ["closed"], closed: [] },
    immutable: ["decided", "closed"], resourceScoped: true, managePermission,
    availableTransitions: (state, payload) => state === "open" ? ["under_review"]
      : state === "under_review" ? String(payload.resolution || "").trim() && String(payload.decision_reference || "").trim() && Array.isArray(payload.responsible_user_ids) && payload.responsible_user_ids.length ? ["decided"] : []
      : state === "decided" ? ["closed"] : [],
    validate: async (payload, context) => {
      const process = await reference(context, payload.process_record_id, payload.process_revision);
      return process && process.pluginId === "safdoulas-processes" && process.kind === "accreditation_process" ? []
        : [error("exception_process_required", "process_record_id", "Registre o caso omisso no processo correspondente, preservando a deliberação competente.")];
    },
    example: { process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 1, subject: "Situação excepcional", description: "Descreva a situação não prevista no instrumento vigente.", competent_body: "Diretoria de Formação e Pesquisa / GT", responsible_user_ids: [], resolution: "", decision_reference: "", evidence_refs: [] },
  },
  diligence: {
    label: "Diligência de acreditação",
    schema: object({
      stage: { type: "string", enum: ["preliminary_admissibility", "assessment"] },
      process_record_id: uuid,
      process_revision: { type: "integer", minimum: 1 },
      cycle: { type: "integer", minimum: 1 },
      requested_by_user_id: uuid,
      respondent_user_id: uuid,
      items: { type: "array", minItems: 1, maxItems: 100, items: object({ code: text(120), request: text(4000), required: { type: "boolean" }, source_reference: optionalText(500) }) },
      due_at: { type: "string", format: "date-time" },
      pause_process_deadline: { type: "boolean" },
      pause_reason: optionalText(2000),
      deadline_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      deadline_record_revision: { type: ["integer", "null"], minimum: 1 },
      communication_record_ids: list(uuid, 100),
    }),
    initial: "draft",
    transitions: { draft: ["requested"], requested: ["response_received", "cancelled"], response_received: ["under_review"], under_review: ["follow_up_requested", "closed"], follow_up_requested: ["response_received"], closed: [], cancelled: [] },
    immutable: ["closed", "cancelled"],
    resourceScoped: true,
    managePermission,
    authorizeRecord: authorizeDiligence,
    availableTransitions: diligenceTransitions,
    authorizeTransition: authorizeDiligenceTransition,
    deadlineEffects: (from, to, payload) => diligenceDeadlineEffects(from, to, payload),
    validate: diligenceIssues,
    example: {
      stage: "assessment", process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 1, cycle: 1,
      requested_by_user_id: "00000000-0000-4000-8000-000000000002", respondent_user_id: "00000000-0000-4000-8000-000000000003",
      items: [{ code: "doc-1", request: "Apresente a versão atualizada do documento indicado.", required: true, source_reference: "Regra aplicável" }],
      due_at: "2030-01-01T00:00:00.000Z", pause_process_deadline: true,
      pause_reason: "A contagem fica suspensa enquanto a instituição prepara a resposta, segundo a regra registrada.",
      deadline_record_id: "00000000-0000-4000-8000-000000000006", deadline_record_revision: 1, communication_record_ids: [],
    },
  },
  diligence_response: {
    label: "Resposta à diligência",
    schema: object({
      diligence_record_id: uuid,
      diligence_revision: { type: "integer", minimum: 1 },
      respondent_user_id: uuid,
      item_responses: { type: "array", minItems: 1, maxItems: 100, items: object({ item_code: text(120), response: text(8000), evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }), 50) }) },
      evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }), 100),
      submitted_at: { type: "string", format: "date-time" },
    }),
    initial: "draft",
    transitions: { draft: ["submitted"], submitted: [] },
    immutable: ["submitted"],
    resourceScoped: true,
    managePermission,
    authorizeRecord: authorizeResponse,
    authorizeCreate: authorizeResponseCreate,
    availableTransitions: responseTransitions,
    authorizeTransition: authorizeResponseTransition,
    validate: diligenceResponseIssues,
    example: {
      diligence_record_id: "00000000-0000-4000-8000-000000000004", diligence_revision: 1,
      respondent_user_id: "00000000-0000-4000-8000-000000000003",
      item_responses: [{ item_code: "doc-1", response: "Documento atualizado anexado.", evidence_refs: [] }], evidence_refs: [],
      submitted_at: "2030-01-02T12:00:00.000Z",
    },
  },
  case_communication: {
    label: "Comunicação do processo",
    schema: object({
      process_record_id: uuid,
      process_revision: { type: "integer", minimum: 1 },
      decision_record_id: { type: ["string", "null"], pattern: uuid.pattern },
      decision_revision: { type: ["integer", "null"], minimum: 1 },
      diligence_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      diligence_revision: { type: ["integer", "null"], minimum: 1 },
      sender_user_id: uuid,
      recipient_user_ids: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: uuid },
      channel: { type: "string", enum: ["email", "portal", "system"] },
      subject: text(500),
      body: text(20000),
      sent_at: { type: ["string", "null"], format: "date-time" },
      delivered_at: { type: ["string", "null"], format: "date-time" },
      acknowledged_at: { type: ["string", "null"], format: "date-time" },
      delivery_evidence_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      delivery_evidence_revision: { type: ["integer", "null"], minimum: 1 },
      acknowledgement_evidence_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      acknowledgement_evidence_revision: { type: ["integer", "null"], minimum: 1 },
      delivery_status: { type: "string", enum: ["draft", "queued", "sent", "delivered", "failed", "acknowledged"] },
      failure_reason: optionalText(2000),
      provider_reference: optionalText(1000),
    }, ["process_record_id", "process_revision", "diligence_record_id", "diligence_revision", "sender_user_id", "recipient_user_ids", "channel", "subject", "body", "sent_at", "delivered_at", "acknowledged_at", "delivery_evidence_record_id", "delivery_evidence_revision", "acknowledgement_evidence_record_id", "acknowledgement_evidence_revision", "delivery_status", "failure_reason", "provider_reference"]),
    initial: "draft",
    transitions: { draft: ["queued"], queued: ["sent", "failed"], sent: ["delivered", "failed"], delivered: ["acknowledged"], failed: ["queued"], acknowledged: [] },
    immutable: ["acknowledged"],
    detailActions: [{
      id: "send-case-email", label: "Enviar e-mail", retryLabel: "Tentar enviar novamente", description: "O envio usa o SMTP configurado no Orbit e somente destinatários com conta ativa e e-mail verificado.",
      states: ["draft", "failed"], permission: "publish", ownsTransitions: true, path: "/safdoulas/communications/{recordId}/send",
      when: { "payload.channel": "email" },
    }],
    resourceScoped: true,
    managePermission,
    availableTransitions: communicationTransitions,
    authorizeTransition: authorizeCommunicationTransition,
    prepareTransition: async (from, to, payload) => prepareCommunicationTransition(from, to, payload),
    validate: communicationIssues,
    authorizeRecord: async (actorId, action, _state, payload, context) => await context.hasPermission?.(managePermission)
      || (action === "read" && (payload.sender_user_id === actorId || (payload.recipient_user_ids as string[]).includes(actorId))),
    example: {
      process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 1, diligence_record_id: null, diligence_revision: null,
      sender_user_id: "00000000-0000-4000-8000-000000000002", recipient_user_ids: ["00000000-0000-4000-8000-000000000003"],
      channel: "portal", subject: "Complementação solicitada", body: "Consulte os itens e prazos registrados no portal do processo.",
      sent_at: null, delivered_at: null, acknowledged_at: null, delivery_evidence_record_id: null, delivery_evidence_revision: null,
      acknowledgement_evidence_record_id: null, acknowledgement_evidence_revision: null,
      delivery_status: "draft", failure_reason: "", provider_reference: "",
    },
  },
};

export const safdoulasDiligencesPlugin: PluginDefinition = {
  id: "safdoulas-diligences",
  name: "Diligências e comunicações SAFDOULAS",
  version: "1.0.0",
  description: "Registra pedidos de complemento, respostas institucionais e comunicações por ciclo, com prazo e trilha versionados.",
  scope: "workspace",
  handlesRoute: (path) => /^\/safdoulas\/communications\/[a-fA-F0-9-]{36}\/send$/.test(path),
  routePermission: () => managePermission,
  dependencies: ["versioned-records", "safdoulas-processes", "safdoulas-governance", "documents", "privacy", "deadlines"],
  capabilities: ["read", "write", "manage"].map((action) => ({
    id: action,
    name: action === "read" ? "Consultar diligências e comunicações" : action === "write" ? "Responder diligências" : "Administrar diligências e comunicações",
    permissions: [`plugin.safdoulas-diligences.${action}`],
  })),
  contributions: {
    navigation: [{ id: "safdoulas-diligences", href: "/extensions/safdoulas-diligences", label: "Diligências" , permission: "plugin.safdoulas-diligences.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "workflow", "label": "Tramitação", "order": 2}, order: 4}],
    recordKinds,
  },
};

@Controller("safdoulas/communications")
export class SafdoulasCommunicationController {
  constructor(
    @Inject(ExtensionRecords) private readonly records: ExtensionRecords,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
    @Inject(Db) private readonly db: Db,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject("AUTH_MAILER") private readonly mailer: AuthMailer,
  ) {}

  @Post(":id/send")
  async send(@Req() request: AccessRequest, @Param("id") recordId: string, @Body() body: Record<string, unknown>) {
    if (Object.keys(body || {}).length) throw new HttpException("O envio não aceita campos adicionais.", 400);
    const actorId = String(request.orbitActor);
    await this.access.require(actorId, managePermission);
    if (!this.plugins.isEnabled("safdoulas-diligences")) throw new HttpException("O plugin de diligências e comunicações está desativado.", 409);

    const record = await this.records.detail("safdoulas-diligences", recordId, actorId) as {
      id: string; title: string; state: string; revision: number; kind: string; payload: Record<string, unknown>;
    };
    if (record.kind !== "case_communication" || record.payload.channel !== "email")
      throw new HttpException("Somente comunicações por e-mail podem ser enviadas por esta ação.", 409);
    if (!(record.state === "draft" || record.state === "failed"))
      throw new HttpException("A comunicação precisa estar em rascunho ou com falha para ser enviada.", 409);

    const recipients = record.payload.recipient_user_ids as string[];
    const accounts = await this.db.query<{ id: string; email: string }>(
      "SELECT id,email FROM users WHERE id=ANY($1::uuid[]) AND NOT disabled AND email_verified ORDER BY id",
      [recipients],
    );
    if (accounts.length !== recipients.length)
      throw new HttpException("Todos os destinatários precisam ter uma conta ativa e e-mail verificado no Orbit.", 409);

    const queued = await this.records.transition("safdoulas-diligences", record.id, actorId, {
      state: "queued", expected_revision: record.revision, reason: "Envio solicitado pelo painel de comunicações.",
    }) as typeof record;
    let receipt: { messageId?: string };
    try {
      if (!this.mailer.sendMessage) throw new Error("O serviço de e-mail não aceita mensagens institucionais.");
      receipt = await this.mailer.sendMessage(accounts.map((account) => account.email), String(record.payload.subject), String(record.payload.body));
    } catch (error) {
      const failureReason = (error instanceof Error ? error.message : "Falha desconhecida no envio SMTP.").slice(0, 1900);
      const failedPayload = await this.records.version("safdoulas-diligences", record.id, actorId, {
        title: record.title,
        payload: { ...queued.payload, delivery_status: "failed", failure_reason: failureReason },
        expected_revision: queued.revision,
        reason: "Falha no envio da comunicação por e-mail.",
      }) as typeof record;
      return this.records.transition("safdoulas-diligences", record.id, actorId, {
        state: "failed", expected_revision: failedPayload.revision, reason: "O serviço SMTP recusou ou não concluiu o envio.",
      });
    }
    const sent = await this.records.transition("safdoulas-diligences", record.id, actorId, {
      state: "sent", expected_revision: queued.revision, reason: "O serviço SMTP aceitou a comunicação.",
    }) as typeof record;
    if (!receipt.messageId) return sent;
    return this.records.version("safdoulas-diligences", record.id, actorId, {
      title: sent.title,
      payload: { ...sent.payload, provider_reference: receipt.messageId.slice(0, 1000) },
      expected_revision: sent.revision,
      reason: "Identificador de aceitação do serviço SMTP registrado.",
    });
  }
}
