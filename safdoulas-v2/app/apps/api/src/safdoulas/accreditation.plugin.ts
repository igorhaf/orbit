import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue, ResolvedRecordReference } from "../plugins/contract";
import { randomBytes } from "node:crypto";

const uuid = { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const text = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
const optionalText = (maxLength = 2000) => ({ type: "string", maxLength });
const object = (properties: Record<string, Record<string, unknown>>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const list = (items: Record<string, unknown>, maxItems = 100) => ({ type: "array", items, maxItems });
const manage = "plugin.safdoulas-accreditation.manage";
type Ref = ResolvedRecordReference;
export const accreditationDecisionOutcome = (decision: { kind: string; payload: Record<string, unknown> } | null) =>
  decision?.kind === "appeal_decision" ? decision.payload.resulting_outcome : decision?.payload.outcome;
const representativePermission = "plugin.safdoulas-processes.transition.institution_representative";

function issue(code: string, path: string, message: string): RecordValidationIssue {
  return { severity: "error", code, path, message };
}

async function ref(context: RecordValidationContext, recordId: unknown, revision: unknown): Promise<Ref | null> {
  return typeof recordId === "string" && Number.isInteger(revision) ? context.resolveRecord(recordId, Number(revision)) : null;
}

async function canRepresentProcess(context: RecordValidationContext, processId: string): Promise<boolean> {
  return Boolean(await context.hasPermission?.(manage) || await context.hasPermissionOnResource?.(representativePermission, processId));
}

export async function grantIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const process = await ref(context, payload.process_record_id, payload.process_revision);
  const decision = await ref(context, payload.decision_record_id, payload.decision_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process" || process.state !== "decision")
    issues.push(issue("decided_process_required", "process_record_id", "A concessão deve apontar para um processo com decisão final comunicável."));
  const provider = process && await ref(context, process.payload.provider_record_id, process.payload.provider_revision);
  if (!provider || provider.pluginId !== "safdoulas-registry" || provider.kind !== "education_provider")
    issues.push(issue("grant_provider_reference_invalid", "process_record_id", "A instituição da concessão deve vir do cadastro fixado no processo."));
  const course = process && await ref(context, process.payload.course_record_id, process.payload.course_revision);
  if (process?.payload.process_type === "course_accreditation" && (!course || course.pluginId !== "safdoulas-registry" || course.kind !== "course"))
    issues.push(issue("grant_course_reference_invalid", "process_record_id", "O curso da concessão deve vir do curso fixado no processo."));
  const finalDecisionId = process?.payload.appeal_decision_record_id || process?.payload.institutional_decision_record_id;
  if (typeof finalDecisionId === "string" && finalDecisionId !== payload.decision_record_id)
    issues.push(issue("current_final_decision_required", "decision_record_id", "Use a decisão final fixada no processo, incluindo o resultado recursal quando houver."));
  if (!decision || decision.pluginId !== "safdoulas-decisions" || !["institutional_decision", "appeal_decision"].includes(decision.kind) || decision.state !== "ratified"
    || decision.payload.process_record_id !== process?.id || !["approved", "approved_with_conditions"].includes(String(accreditationDecisionOutcome(decision))))
    issues.push(issue("grantable_decision_required", "decision_record_id", "A concessão exige decisão ratificada de deferimento vinculada ao mesmo processo."));
  const source = await ref(context, payload.concession_template_record_id, payload.concession_template_revision);
  if (!source || source.pluginId !== "safdoulas-governance" || source.kind !== "approved_template" || source.state !== "active" || source.payload.document_type !== "concessao")
    issues.push(issue("active_concession_template_required", "concession_template_record_id", "Use um modelo de concessão ativo e versionado."));
  if ((typeof payload.signed_document_record_id === "string") !== (typeof payload.signed_document_revision === "number"))
    issues.push(issue("incomplete_signed_document_reference", "signed_document_record_id", "Informe o documento assinado e sua versão juntos."));
  if (typeof payload.signed_document_record_id === "string" && typeof payload.signed_document_revision === "number") {
    const document = await ref(context, payload.signed_document_record_id, payload.signed_document_revision);
    if (!document || document.pluginId !== "documents" || document.kind !== "document" || document.state !== "published")
      issues.push(issue("signed_concession_document_required", "signed_document_record_id", "A ativação exige a versão publicada e assinada do documento de concessão."));
  }
  if ((typeof payload.seal_asset_record_id === "string") !== (typeof payload.seal_asset_revision === "number"))
    issues.push(issue("incomplete_seal_asset_reference", "seal_asset_record_id", "Informe o ativo oficial do selo e sua versão juntos."));
  if (typeof payload.seal_asset_record_id === "string" && typeof payload.seal_asset_revision === "number") {
    const seal = await ref(context, payload.seal_asset_record_id, payload.seal_asset_revision);
    if (!seal || seal.pluginId !== "safdoulas-accreditation" || seal.kind !== "seal_asset" || seal.state !== "active"
      || seal.payload.version !== payload.seal_version)
      issues.push(issue("active_seal_asset_required", "seal_asset_record_id", "A concessão deve apontar para a versão ativa e aprovada do selo correspondente."));
  }
  if (typeof payload.valid_from === "string" && typeof payload.valid_until === "string" && payload.valid_until <= payload.valid_from)
    issues.push(issue("invalid_accreditation_validity", "valid_until", "A validade final precisa ser posterior ao início da acreditação."));
  if (process && typeof payload.valid_from === "string" && typeof payload.valid_until === "string") {
    const rules = await ref(context, process.payload.ruleset_record_id, process.payload.ruleset_revision);
    const months = rules?.payload.accreditation_validity_months;
    if (typeof months === "number") {
      const [year, month, day] = payload.valid_from.split("-").map(Number);
      const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
      const end = new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay)));
      if (Number.isFinite(end.getTime()) && end.toISOString().slice(0, 10) !== payload.valid_until)
        issues.push(issue("accreditation_validity_rules_mismatch", "valid_until", "A validade deve respeitar o número de meses fixado na versão do edital deste processo."));
    }
  }
  const prior = context.recordId ? await context.resolveLatestRecord?.(context.recordId) : null;
  if ((!prior || prior.state === "draft") && typeof payload.valid_until === "string" && payload.valid_until < new Date().toISOString().slice(0, 10))
    issues.push(issue("accreditation_already_expired", "valid_until", "A nova concessão não pode ser ativada com validade já encerrada."));
  if ((typeof payload.renewal_request_record_id === "string") !== (typeof payload.renewal_request_revision === "number"))
    issues.push(issue("incomplete_renewal_reference", "renewal_request_record_id", "Informe a solicitação de renovação e sua versão juntas."));
  if (typeof payload.renewal_request_record_id === "string" && typeof payload.renewal_request_revision === "number") {
    const renewal = await ref(context, payload.renewal_request_record_id, payload.renewal_request_revision);
    if (!renewal || renewal.pluginId !== "safdoulas-accreditation" || renewal.kind !== "renewal_request" || renewal.state !== "accepted"
      || renewal.payload.renewal_process_record_id !== process?.id || renewal.payload.renewal_process_revision !== process?.revision)
      issues.push(issue("accepted_renewal_request_required", "renewal_request_record_id", "A nova concessão deve apontar para uma renovação aceita e ligada ao mesmo processo."));
  }
  const scope = payload.scope as Record<string, unknown> | undefined;
  if (scope && (!String(scope.course_name || "").trim() || !String(scope.provider_name || "").trim() || !String(scope.description || "").trim()))
    issues.push(issue("public_scope_incomplete", "scope", "Informe instituição, curso e escopo que constarão na concessão."));
  if (scope && provider && scope.provider_name !== provider.payload.display_name)
    issues.push(issue("grant_provider_scope_mismatch", "scope.provider_name", "A instituição da concessão precisa corresponder ao cadastro fixado no processo."));
  if (scope && course && scope.course_name !== course.payload.name)
    issues.push(issue("grant_course_scope_mismatch", "scope.course_name", "O curso da concessão precisa corresponder ao cadastro fixado no processo."));
  const conditionRefs = Array.isArray(payload.condition_refs) ? payload.condition_refs as Array<{ code: string; description: string; due_on?: string | null }> : [];
  if (accreditationDecisionOutcome(decision) === "approved_with_conditions" && !conditionRefs.length)
    issues.push(issue("grant_conditions_tracking_required", "condition_refs", "A concessão condicionada deve registrar como cada condicionante será acompanhada."));
  if (new Set(conditionRefs.map((item) => item.code)).size !== conditionRefs.length)
    issues.push(issue("duplicate_grant_condition", "condition_refs", "Cada condicionante deve ter um código único dentro da concessão."));
  return issues;
}

export async function sealAssetIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const files = Array.isArray(payload.files) ? payload.files as Array<{ format: string; document_record_id: string; document_revision: number; checksum_sha256: string }> : [];
  const formats = files.map((file) => file.format);
  if (!formats.includes("print") || !formats.includes("digital") || new Set(formats).size !== formats.length)
    issues.push(issue("seal_formats_incomplete", "files", "Inclua um arquivo oficial para impressão e outro para uso digital, sem repetir o formato."));
  for (const [index, file] of files.entries()) {
    const document = await ref(context, file.document_record_id, file.document_revision);
    if (!document || document.pluginId !== "documents" || document.kind !== "document" || document.state !== "published"
      || document.payload.variant !== "original" || document.payload.sha256 !== file.checksum_sha256)
      issues.push(issue("seal_file_integrity_mismatch", `files[${index}]`, "Cada formato deve referenciar o arquivo oficial original, publicado e com checksum correspondente."));
  }
  const manual = await ref(context, payload.manual_record_id, payload.manual_revision);
  if (!manual || manual.pluginId !== "safdoulas-governance" || manual.kind !== "normative_document" || manual.state !== "active"
    || manual.payload.category !== "manual_selo")
    issues.push(issue("active_seal_manual_required", "manual_record_id", "Vincule a versão ativa do Manual de Uso do Selo."));
  if (!String(payload.approval_reference || "").trim())
    issues.push(issue("seal_approval_required", "approval_reference", "Registre a autorização institucional para disponibilizar esta versão do selo."));
  if (typeof payload.approved_at !== "string" || !Number.isFinite(Date.parse(payload.approved_at)))
    issues.push(issue("seal_approval_date_required", "approved_at", "Registre a data da autorização institucional."));
  return issues;
}

export async function sealAssetTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  const valid = (await sealAssetIssues(payload, context)).length === 0;
  if (state === "draft") return valid ? ["approved"] : [];
  if (state === "approved") return valid ? ["active", "retired"] : ["retired"];
  if (state === "active") return ["retired"];
  return [];
}

export async function publicListingIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const grant = await ref(context, payload.grant_record_id, payload.grant_revision);
  if (!grant || grant.pluginId !== "safdoulas-accreditation" || grant.kind !== "accreditation_grant" || grant.state !== "active")
    issues.push(issue("active_grant_required", "grant_record_id", "A publicação deve apontar para uma acreditação ativa."));
  if (grant && payload.verification_code !== grant.payload.verification_code)
    issues.push(issue("verification_code_mismatch", "verification_code", "O código público precisa corresponder ao código emitido para a concessão."));
  const scope = grant?.payload.scope as Record<string, unknown> | undefined;
  for (const key of ["provider_name", "course_name", "modality", "description"])
    if (scope && payload[key] !== scope[key]) issues.push(issue("public_listing_scope_mismatch", key, "A publicação deve reproduzir o escopo aprovado na concessão."));
  if (grant && (payload.valid_from !== grant.payload.valid_from || payload.valid_until !== grant.payload.valid_until))
    issues.push(issue("public_listing_validity_mismatch", "valid_until", "A consulta pública deve reproduzir a validade exata da concessão."));
  if (!String(payload.privacy_approval_reference || "").trim())
    issues.push(issue("publication_approval_required", "privacy_approval_reference", "Registre a referência da autorização institucional para divulgar estes campos."));
  return issues;
}

export async function sealOccurrenceIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const grant = await ref(context, payload.grant_record_id, payload.grant_revision);
  if (!grant || grant.pluginId !== "safdoulas-accreditation" || grant.kind !== "accreditation_grant")
    issues.push(issue("seal_grant_required", "grant_record_id", "A ocorrência precisa apontar para uma concessão de selo registrada."));
  if (payload.action === "suspend" && grant?.state !== "suspended")
    issues.push(issue("suspension_state_mismatch", "grant_record_id", "A ocorrência de suspensão exige que a concessão esteja suspensa."));
  if (payload.action === "cancel" && grant?.state !== "cancelled")
    issues.push(issue("cancellation_state_mismatch", "grant_record_id", "A ocorrência de cancelamento exige que a concessão esteja cancelada."));
  return issues;
}

export async function renewalRequestIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const prior = await ref(context, payload.previous_grant_record_id, payload.previous_grant_revision);
  if (!prior || prior.pluginId !== "safdoulas-accreditation" || prior.kind !== "accreditation_grant" || !["active", "expired"].includes(prior.state))
    issues.push(issue("renewal_prior_grant_required", "previous_grant_record_id", "A renovação deve apontar para uma acreditação vigente ou expirada, nunca cancelada."));
  const process = await ref(context, payload.renewal_process_record_id, payload.renewal_process_revision);
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process" || process.payload.process_type !== "course_accreditation")
    issues.push(issue("renewal_process_required", "renewal_process_record_id", "A renovação precisa iniciar um novo processo de acreditação de curso."));
  const previousProcess = prior && await ref(context, prior.payload.process_record_id, prior.payload.process_revision);
  if (process && previousProcess && (process.payload.course_record_id !== previousProcess.payload.course_record_id || process.payload.provider_record_id !== previousProcess.payload.provider_record_id))
    issues.push(issue("renewal_course_mismatch", "renewal_process_record_id", "O processo de renovação deve avaliar o mesmo curso e a mesma instituição da acreditação anterior."));
  if (process && !await canRepresentProcess(context, process.id))
    issues.push(issue("renewal_representative_scope_required", "renewal_process_record_id", "A renovação deve ser apresentada por uma pessoa representante vinculada ao processo."));
  return issues;
}

export async function conditionFollowUpIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const grant = await ref(context, payload.grant_record_id, payload.grant_revision);
  if (!grant || grant.pluginId !== "safdoulas-accreditation" || grant.kind !== "accreditation_grant" || !["active", "suspended"].includes(grant.state))
    issues.push(issue("condition_grant_required", "grant_record_id", "O acompanhamento deve pertencer a uma concessão ativa ou suspensa."));
  const conditions = Array.isArray(grant?.payload.condition_refs) ? grant.payload.condition_refs as Array<{ code: string }> : [];
  if (!conditions.some((condition) => condition.code === payload.condition_code))
    issues.push(issue("unknown_accreditation_condition", "condition_code", "O código informado não está entre as condicionantes desta concessão."));
  const process = grant && await ref(context, grant.payload.process_record_id, grant.payload.process_revision);
  if (process && !await canRepresentProcess(context, process.id))
    issues.push(issue("condition_representative_scope_required", "grant_record_id", "A evidência deve ser enviada por uma pessoa representante vinculada ao processo."));
  return issues;
}

export async function postAccreditationChangeIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const grant = await ref(context, payload.grant_record_id, payload.grant_revision);
  if (!grant || grant.pluginId !== "safdoulas-accreditation" || grant.kind !== "accreditation_grant" || !["active", "suspended"].includes(grant.state))
    issues.push(issue("change_grant_required", "grant_record_id", "A alteração deve se referir a uma acreditação ativa ou suspensa."));
  const process = grant && await ref(context, grant.payload.process_record_id, grant.payload.process_revision);
  if (process && !await canRepresentProcess(context, process.id))
    issues.push(issue("change_representative_scope_required", "grant_record_id", "A comunicação deve ser enviada por uma pessoa representante vinculada ao processo."));
  if (payload.review_outcome && !String(payload.review_basis || "").trim())
    issues.push(issue("change_review_basis_required", "review_basis", "Registre a justificativa da decisão sobre o impacto da alteração."));
  if ((typeof payload.follow_up_process_record_id === "string") !== (typeof payload.follow_up_process_revision === "number"))
    issues.push(issue("incomplete_change_process_reference", "follow_up_process_record_id", "Informe o processo de revisão e sua versão juntos."));
  if (payload.review_outcome === "reopened") {
    const followUp = await ref(context, payload.follow_up_process_record_id, payload.follow_up_process_revision);
    if (!followUp || followUp.pluginId !== "safdoulas-processes" || followUp.kind !== "accreditation_process" || followUp.state === "decision"
      || followUp.payload.provider_record_id !== process?.payload.provider_record_id || followUp.payload.course_record_id !== process?.payload.course_record_id)
      issues.push(issue("change_reopen_process_required", "follow_up_process_record_id", "A reabertura deve vincular um novo processo do mesmo curso e instituição."));
  }
  return issues;
}

const kinds: Record<string, RecordKindContribution> = {
  accreditation_grant: {
    label: "Concessão de acreditação",
    schema: object({
      process_record_id: uuid, process_revision: { type: "integer", minimum: 1 },
      decision_record_id: uuid, decision_revision: { type: "integer", minimum: 1 },
      concession_template_record_id: uuid, concession_template_revision: { type: "integer", minimum: 1 },
      signed_document_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" }, signed_document_revision: { type: ["integer", "null"], minimum: 1 },
      accreditation_number: text(120), verification_code: { type: ["string", "null"], pattern: "^[A-Z0-9-]{12,64}$" },
      renewal_request_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      renewal_request_revision: { type: ["integer", "null"], minimum: 1 },
      seal_asset_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      seal_asset_revision: { type: ["integer", "null"], minimum: 1 },
      scope: object({ provider_name: text(500), course_name: text(500), modality: text(120), description: text(2000), offering_codes: list(text(120), 100) }),
      valid_from: { type: "string", format: "date" }, valid_until: { type: "string", format: "date" },
      condition_refs: list(object({ code: text(120), description: text(2000), due_on: { type: ["string", "null"], format: "date" } }), 100),
      seal_version: text(80), approval_reference: optionalText(500),
    }),
    initial: "draft",
    transitions: { draft: ["active", "cancelled"], active: ["suspended", "expired", "cancelled"], suspended: ["active", "cancelled"], expired: ["cancelled"], cancelled: [] },
    immutable: ["cancelled"], uniqueFields: ["accreditation_number", "verification_code"], resourceScoped: true, managePermission: manage,
    immutablePayloadFieldsAfterInitial: ["process_record_id", "process_revision", "decision_record_id", "decision_revision", "scope", "valid_from", "valid_until", "verification_code", "signed_document_record_id", "signed_document_revision", "seal_asset_record_id", "seal_asset_revision", "seal_version", "concession_template_record_id", "concession_template_revision"],
    detailActions: [{
      id: "generate-concession-draft", label: "Gerar e baixar minuta PDF",
      description: "Gera uma minuta com base nas versões vinculadas ao processo e ao modelo ativo. O arquivo fica marcado como não assinado; envie a versão assinada para concluir a concessão.",
      states: ["draft"], permission: "write",
      path: "/safdoulas/accreditation/grants/{recordId}/concession-document",
      download: { recordIdField: "document_record_id", revisionField: "document_revision", fileNameField: "document_file_name", path: "/extensions/documents/records/{recordId}/files/{revision}" },
    }],
    validate: grantIssues,
    prepareTransition: async (from, to, payload) => from === "draft" && to === "active" && !payload.verification_code
      ? { ...payload, verification_code: `SAF-${randomBytes(16).toString("hex").toUpperCase()}` }
      : payload,
    availableTransitions: async (state, payload, context) => {
      const allowed = kinds.accreditation_grant.transitions[state] || [];
      const issues = await grantIssues(payload, context);
      return allowed.filter((target) => target !== "active" || (
        typeof payload.signed_document_record_id === "string" && typeof payload.signed_document_revision === "number"
        && typeof payload.valid_until === "string" && payload.valid_until >= new Date().toISOString().slice(0, 10)
        && typeof payload.seal_asset_record_id === "string" && typeof payload.seal_asset_revision === "number"
        && !issues.some((item) => item.severity === "error")
      ));
    },
    example: {
      process_record_id: "00000000-0000-4000-8000-000000000001", process_revision: 1,
      decision_record_id: "00000000-0000-4000-8000-000000000002", decision_revision: 1,
      concession_template_record_id: "00000000-0000-4000-8000-000000000003", concession_template_revision: 1,
      signed_document_record_id: null, signed_document_revision: null,
      accreditation_number: "SAF-DEMO-2026-0001", verification_code: null, renewal_request_record_id: null, renewal_request_revision: null,
      seal_asset_record_id: null, seal_asset_revision: null,
      scope: { provider_name: "Instituição de demonstração", course_name: "Curso de demonstração", modality: "Presencial", description: "Escopo demonstrativo; confirmar aprovação e validade.", offering_codes: [] },
      valid_from: "2026-01-01", valid_until: "2027-01-01", condition_refs: [], seal_version: "demo-1", approval_reference: "DEMO — validar regras e identidade visual antes de uso real",
    },
  },
  seal_asset: {
    label: "Versão oficial do selo",
    schema: object({
      version: text(80),
      files: list(object({
        format: { type: "string", enum: ["print", "digital"] }, document_record_id: uuid,
        document_revision: { type: "integer", minimum: 1 }, checksum_sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
      }), 2),
      manual_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      manual_revision: { type: ["integer", "null"], minimum: 1 }, approval_reference: optionalText(1000),
      approved_at: { type: ["string", "null"], format: "date-time" },
    }),
    initial: "draft", transitions: { draft: ["approved"], approved: ["active", "retired"], active: ["retired"], retired: [] },
    resourceScoped: true, managePermission: manage,
    availableTransitions: sealAssetTransitions,
    authorizeTransition: async (from, to, payload, context) => Boolean(await context.hasGlobalPermission?.(manage) || await context.hasPermission?.(manage))
      && (to === "retired" || from === "draft" && to === "approved" || from === "approved" && to === "active")
      && (to === "retired" || (await sealAssetIssues(payload, context)).length === 0),
    example: { version: "VERSÃO A DEFINIR PELA INSTITUIÇÃO", files: [], manual_record_id: null, manual_revision: null, approval_reference: "", approved_at: null },
  },
  concession_document_generation: {
    label: "Geração de minuta de concessão",
    schema: object({
      grant_record_id: uuid, grant_revision: { type: "integer", minimum: 1 },
      process_record_id: uuid, process_revision: { type: "integer", minimum: 1 },
      decision_record_id: uuid, decision_revision: { type: "integer", minimum: 1 },
      template_record_id: uuid, template_revision: { type: "integer", minimum: 1 },
      document_record_id: uuid, document_revision: { type: "integer", minimum: 1 },
      generated_at: { type: "string", format: "date-time" },
      status: { type: "string", enum: ["unsigned_draft"] },
    }),
    initial: "generated", transitions: { generated: [] }, immutable: ["generated"],
    resourceScoped: true, managePermission: manage, serverCreated: true,
    example: {
      grant_record_id: "00000000-0000-4000-8000-000000000001", grant_revision: 1,
      process_record_id: "00000000-0000-4000-8000-000000000002", process_revision: 1,
      decision_record_id: "00000000-0000-4000-8000-000000000003", decision_revision: 1,
      template_record_id: "00000000-0000-4000-8000-000000000004", template_revision: 1,
      document_record_id: "00000000-0000-4000-8000-000000000005", document_revision: 1,
      generated_at: "2026-01-01T00:00:00.000Z", status: "unsigned_draft",
    },
  },
  public_accreditation_listing: {
    label: "Publicação de consulta de acreditação",
    schema: object({
      grant_record_id: uuid, grant_revision: { type: "integer", minimum: 1 }, verification_code: { type: "string", pattern: "^[A-Z0-9-]{12,64}$" },
      provider_name: text(500), course_name: text(500), modality: text(120), description: text(2000),
      valid_from: { type: "string", format: "date" }, valid_until: { type: "string", format: "date" },
      privacy_approval_reference: text(500),
    }),
    initial: "draft", transitions: { draft: ["published", "withdrawn"], published: ["withdrawn"], withdrawn: [] }, immutable: ["published", "withdrawn"],
    resourceScoped: true, managePermission: manage, validate: publicListingIssues,
    example: { grant_record_id: "00000000-0000-4000-8000-000000000001", grant_revision: 1, verification_code: "SAF-DEMO-2026-0001", provider_name: "Instituição de demonstração", course_name: "Curso de demonstração", modality: "Presencial", description: "Escopo limitado da demonstração", valid_from: "2026-01-01", valid_until: "2027-01-01", privacy_approval_reference: "DEMO — autorização a confirmar" },
  },
  seal_occurrence: {
    label: "Ocorrência de uso do selo",
    schema: object({
      grant_record_id: uuid, grant_revision: { type: "integer", minimum: 1 },
      action: { type: "string", enum: ["warning", "correction_required", "suspend", "cancel", "close"] },
      reported_on: { type: "string", format: "date" }, description: text(4000), resolution: optionalText(4000),
      evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }), 100), approval_reference: optionalText(500),
    }),
    initial: "open", transitions: { open: ["under_review", "closed"], under_review: ["open", "closed"], closed: [] }, immutable: ["closed"],
    resourceScoped: true, managePermission: manage, validate: sealOccurrenceIssues,
    example: { grant_record_id: "00000000-0000-4000-8000-000000000001", grant_revision: 1, action: "warning", reported_on: "2026-01-01", description: "Ocorrência demonstrativa; não representa caso real.", resolution: "", evidence_refs: [], approval_reference: "DEMO" },
  },
  renewal_request: {
    label: "Solicitação de renovação",
    schema: object({
      previous_grant_record_id: uuid, previous_grant_revision: { type: "integer", minimum: 1 },
      renewal_process_record_id: uuid, renewal_process_revision: { type: "integer", minimum: 1 },
      submitted_on: { type: ["string", "null"], format: "date" }, reason: text(4000),
      evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 }, purpose: optionalText(300) }), 100),
      decision_basis: optionalText(4000),
    }),
    initial: "draft", transitions: { draft: ["submitted"], submitted: ["under_review"], under_review: ["accepted", "rejected"], accepted: ["completed"], rejected: [], completed: [] },
    uniqueFields: ["renewal_process_record_id"], resourceScoped: true, managePermission: manage, validate: renewalRequestIssues,
    authorizeTransition: async (from, to, _payload, context) => !["accepted", "rejected", "completed"].includes(to) || Boolean(await context.hasPermission?.(manage)),
    prepareTransition: async (from, to, payload) => from === "draft" && to === "submitted"
      ? { ...payload, submitted_on: new Date().toISOString().slice(0, 10) }
      : payload,
    availableTransitions: async (state, payload, context) => {
      const allowed = kinds.renewal_request.transitions[state] || [];
      const issues = await renewalRequestIssues(payload, context);
      return allowed.filter((target) => !["accepted", "rejected"].includes(target) || (!issues.some((item) => item.severity === "error") && Boolean(String(payload.decision_basis || "").trim())));
    },
    example: { previous_grant_record_id: "00000000-0000-4000-8000-000000000001", previous_grant_revision: 1, renewal_process_record_id: "00000000-0000-4000-8000-000000000002", renewal_process_revision: 1, submitted_on: null, reason: "Pedido demonstrativo de renovação.", evidence_refs: [], decision_basis: "" },
  },
  condition_follow_up: {
    label: "Acompanhamento de condicionante",
    schema: object({
      grant_record_id: uuid, grant_revision: { type: "integer", minimum: 1 }, condition_code: text(120),
      response_summary: optionalText(8000), evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 }, purpose: optionalText(300) }), 100),
      submitted_on: { type: ["string", "null"], format: "date" }, review_basis: optionalText(4000), reviewed_on: { type: ["string", "null"], format: "date" },
    }),
    initial: "draft", transitions: { draft: ["submitted"], submitted: ["under_review"], under_review: ["accepted", "needs_revision"], needs_revision: ["submitted"], accepted: [] },
    uniqueFields: ["grant_record_id", "condition_code"], resourceScoped: true, managePermission: manage, validate: conditionFollowUpIssues,
    authorizeTransition: async (from, to, _payload, context) => !["accepted", "needs_revision"].includes(to) || Boolean(await context.hasPermission?.(manage)),
    availableTransitions: async (state, payload, context) => {
      const allowed = kinds.condition_follow_up.transitions[state] || [];
      const issues = await conditionFollowUpIssues(payload, context);
      return allowed.filter((target) => !["accepted", "needs_revision"].includes(target)
        || (!issues.some((item) => item.severity === "error") && Boolean(String(payload.review_basis || "").trim())
          && (target !== "accepted" || Boolean(String(payload.response_summary || "").trim()))));
    },
    prepareTransition: async (from, to, payload) => from === "under_review" && ["accepted", "needs_revision"].includes(to)
      ? { ...payload, reviewed_on: new Date().toISOString().slice(0, 10) }
      : from === "draft" && to === "submitted" ? { ...payload, submitted_on: new Date().toISOString().slice(0, 10) }
      : payload,
    example: { grant_record_id: "00000000-0000-4000-8000-000000000001", grant_revision: 1, condition_code: "DEMO-01", response_summary: "", evidence_refs: [], submitted_on: null, review_basis: "", reviewed_on: null },
  },
  post_accreditation_change: {
    label: "Comunicação de mudança pós-acreditação",
    schema: object({
      grant_record_id: uuid, grant_revision: { type: "integer", minimum: 1 },
      change_type: { type: "string", enum: ["coordination", "teaching_team", "workload", "modality", "curriculum", "certification", "other"] },
      summary: text(8000), reported_on: { type: ["string", "null"], format: "date" },
      evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 }, purpose: optionalText(300) }), 100),
      review_outcome: { type: ["string", "null"], enum: ["record_only", "review_required", "reopened", "not_applicable", null] },
      review_basis: optionalText(4000), reviewed_on: { type: ["string", "null"], format: "date" },
      follow_up_process_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      follow_up_process_revision: { type: ["integer", "null"], minimum: 1 },
    }),
    initial: "draft", transitions: { draft: ["submitted"], submitted: ["under_review"], under_review: ["record_only", "review_required", "reopened", "not_applicable"], record_only: ["closed"], review_required: ["closed"], reopened: ["closed"], not_applicable: ["closed"], closed: [] },
    resourceScoped: true, managePermission: manage, validate: postAccreditationChangeIssues,
    authorizeTransition: async (from, to, _payload, context) => !["record_only", "review_required", "reopened", "not_applicable"].includes(to) || Boolean(await context.hasPermission?.(manage)),
    availableTransitions: async (state, payload, context) => {
      const allowed = kinds.post_accreditation_change.transitions[state] || [];
      const transitions = await Promise.all(allowed.map(async (target) => {
        if (!["record_only", "review_required", "reopened", "not_applicable"].includes(target)) return target;
        const issues = await postAccreditationChangeIssues({ ...payload, review_outcome: target }, context);
        return !issues.some((item) => item.severity === "error") && Boolean(String(payload.review_basis || "").trim()) ? target : null;
      }));
      return transitions.filter((target): target is string => target !== null);
    },
    prepareTransition: async (from, to, payload) => from === "under_review" && ["record_only", "review_required", "reopened", "not_applicable"].includes(to)
      ? { ...payload, review_outcome: to, reviewed_on: new Date().toISOString().slice(0, 10) }
      : from === "draft" && to === "submitted" ? { ...payload, reported_on: new Date().toISOString().slice(0, 10) }
      : payload,
    example: { grant_record_id: "00000000-0000-4000-8000-000000000001", grant_revision: 1, change_type: "curriculum", summary: "Mudança demonstrativa para análise.", reported_on: null, evidence_refs: [], review_outcome: null, review_basis: "", reviewed_on: null, follow_up_process_record_id: null, follow_up_process_revision: null },
  },
};

export const safdoulasAccreditationPlugin: PluginDefinition = {
  id: "safdoulas-accreditation", name: "Acreditação e selo SAFDOULAS", version: "1.0.0", scope: "workspace",
  description: "Concessão versionada, validade, selo, ocorrências e projeção pública explicitamente autorizada.",
  handlesRoute: (path) => /^\/public\/safdoulas\/accreditations\/[A-Z0-9-]{12,64}$/.test(path)
    || /^\/public\/safdoulas\/accreditations\/[A-Z0-9-]{12,64}\/seal\/(print|digital)$/.test(path)
    || /^\/safdoulas\/accreditation\/grants\/[a-fA-F0-9-]{36}\/concession-document$/.test(path),
  routePermission: (path) => path.startsWith("/public/") ? null : "plugin.safdoulas-accreditation.manage",
  dependencies: ["versioned-records", "documents", "safdoulas-processes", "safdoulas-decisions", "safdoulas-governance"],
  capabilities: ["read", "write", "publish", "manage"].map((action) => ({ id: action, name: action, permissions: [`plugin.safdoulas-accreditation.${action}`] })),
  contributions: { recordKinds: kinds },
};
