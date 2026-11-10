import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue } from "../plugins/contract";

const uuid = { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const nullableUuid = { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const text = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
const optionalText = (maxLength = 2000) => ({ type: "string", maxLength });
const nullableDate = { type: ["string", "null"], format: "date" };
const object = (properties: Record<string, Record<string, unknown>>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const managePermission = "plugin.safdoulas-data-protection.manage";
const readPermission = "plugin.safdoulas-data-protection.read";
const issue = (code: string, path: string, message: string): RecordValidationIssue => ({ severity: "error", code, path, message });
async function isManager(context: RecordValidationContext) {
  return Boolean(await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission));
}
async function canRead(context: RecordValidationContext) {
  return Boolean(await context.hasGlobalPermission?.(readPermission) || await isManager(context));
}

async function pinnedNormativeSource(payload: Record<string, unknown>, context: RecordValidationContext) {
  if (typeof payload.normative_source_record_id !== "string" || !Number.isInteger(payload.normative_source_revision)) return null;
  return context.resolveRecord(payload.normative_source_record_id, Number(payload.normative_source_revision));
}

export async function retentionPolicyIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  if (!String(payload.category || "").trim()) issues.push(issue("retention_category_required", "category", "Informe a categoria de dados abrangida."));
  if (!String(payload.purpose || "").trim()) issues.push(issue("retention_purpose_required", "purpose", "Informe a finalidade de tratamento."));
  if (!Array.isArray(payload.data_categories) || payload.data_categories.length === 0) issues.push(issue("retention_data_categories_required", "data_categories", "Informe as categorias de dados abrangidas."));
  if (!String(payload.start_event || "").trim()) issues.push(issue("retention_start_event_required", "start_event", "Defina o evento que inicia a contagem."));
  if (!Number.isInteger(payload.retention_days) || Number(payload.retention_days) < 1) issues.push(issue("retention_duration_required", "retention_days", "Defina um prazo aprovado em dias."));
  if (!String(payload.legal_basis_reference || "").trim()) issues.push(issue("retention_legal_basis_required", "legal_basis_reference", "Informe a referência da base legal validada."));
  if (!String(payload.institution_approval_reference || "").trim()) issues.push(issue("retention_approval_required", "institution_approval_reference", "Informe a aprovação institucional antes de ativar a política."));
  if (!String(payload.effective_from || "").trim()) issues.push(issue("retention_effective_date_required", "effective_from", "Informe a vigência aprovada."));
  const source = await pinnedNormativeSource(payload, context);
  if (!source || source.pluginId !== "safdoulas-governance" || source.kind !== "normative_document" || source.state !== "active")
    issues.push(issue("active_normative_source_required", "normative_source_record_id", "A política deve apontar para uma fonte normativa ativa e versionada."));
  if (payload.disposition === "erase" && !String(payload.deletion_authorization_reference || "").trim())
    issues.push(issue("deletion_authorization_required", "deletion_authorization_reference", "A destinação por eliminação exige referência de autorização institucional."));
  return issues;
}

export async function retentionCaseIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const policy = await context.resolveRecord(String(payload.policy_record_id || ""), Number(payload.policy_revision));
  if (!policy || policy.pluginId !== "safdoulas-data-protection" || policy.kind !== "retention_policy" || policy.state !== "active")
    issues.push(issue("active_retention_policy_required", "policy_record_id", "A revisão deve usar uma política de retenção ativa e versionada."));
  const target = await context.resolveRecord(String(payload.target_record_id || ""), Number(payload.target_revision));
  if (!target || target.pluginId !== payload.target_plugin_id || target.kind !== payload.target_kind)
    issues.push(issue("retention_target_reference_invalid", "target_record_id", "O registro-alvo precisa existir e corresponder ao plugin e tipo informados."));
  if (payload.legal_hold === true && !String(payload.legal_hold_reference || "").trim())
    issues.push(issue("legal_hold_reference_required", "legal_hold_reference", "Registre a referência que fundamenta a preservação legal."));
  if (payload.disposition === "erase" && !String(payload.deletion_authorization_reference || "").trim())
    issues.push(issue("deletion_authorization_required", "deletion_authorization_reference", "A eliminação exige referência de autorização institucional."));
  if (payload.legal_hold === true && ["anonymize", "erase"].includes(String(payload.disposition)))
    issues.push(issue("legal_hold_blocks_disposition", "disposition", "Preservação legal bloqueia anonimização e eliminação enquanto estiver ativa."));
  return issues;
}

export function incidentTransitionIssues(to: string, payload: Record<string, unknown>): RecordValidationIssue[] {
  const issues: RecordValidationIssue[] = [];
  if (to === "contained" && !String(payload.containment_reference || "").trim())
    issues.push(issue("containment_reference_required", "containment_reference", "Registre a referência das medidas adotadas antes de marcar o incidente como contido."));
  if (to === "closed" && !String(payload.closure_reference || "").trim())
    issues.push(issue("closure_reference_required", "closure_reference", "Registre a análise e a referência de encerramento do incidente."));
  return issues;
}

async function retentionPolicyTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (state === "draft") return await retentionPolicyIssues(payload, context).then((items) => items.length ? [] : ["approved"]);
  if (state === "approved") return await retentionPolicyIssues(payload, context).then((items) => items.length ? [] : ["active", "retired"]);
  if (state === "active") return ["retired"];
  return [];
}

async function retentionCaseTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (state === "draft") return ["pending_review"];
  if (state === "pending_review") {
    const issues = await retentionCaseIssues(payload, context);
    if (issues.length) return ["blocked"];
    return ["approved", "blocked"];
  }
  if (state === "blocked") return payload.legal_hold === true ? [] : ["pending_review"];
  if (state === "approved") return ["executed"];
  return [];
}

export async function authorizeRetentionCaseTransition(from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  if (!await isManager(context)) return false;
  if (to === "pending_review") return from === "draft" || from === "blocked" && payload.legal_hold !== true;
  if (to === "approved") return from === "pending_review" && (await retentionCaseIssues(payload, context)).length === 0;
  if (to === "blocked") return from === "pending_review";
  if (to === "pending_review") return from === "blocked" && payload.legal_hold !== true;
  if (to === "executed") {
    const disposition = String(payload.disposition);
    return from === "approved" && payload.legal_hold !== true
      && ["preserve", "anonymize", "erase"].includes(disposition)
      && (await retentionCaseIssues(payload, context)).length === 0
      && Boolean(String(payload.execution_evidence_reference || "").trim())
      && (disposition !== "erase" || Boolean(String(payload.deletion_authorization_reference || "").trim()));
  }
  return false;
}

const recordKinds: Record<string, RecordKindContribution> = {
  retention_policy: {
    label: "Política de retenção",
    schema: object({
      category: text(160), purpose: text(2000), data_categories: { type: "array", items: text(160), maxItems: 100 },
      start_event: text(160), retention_days: { type: ["integer", "null"], minimum: 1, maximum: 365000 },
      disposition: { type: "string", enum: ["review", "preserve", "block", "anonymize", "erase"] },
      legal_basis_reference: optionalText(1000), normative_source_record_id: nullableUuid,
      normative_source_revision: { type: ["integer", "null"], minimum: 1 }, institution_approval_reference: optionalText(1000),
      deletion_authorization_reference: optionalText(1000), effective_from: nullableDate,
    }),
    initial: "draft", transitions: { draft: ["approved"], approved: ["active", "retired"], active: ["retired"], retired: [] },
    resourceScoped: true, managePermission, authorizeCreate: (_actorId, _payload, context) => isManager(context),
    authorizeRecord: (_actorId, action, _state, _payload, context) => action === "read" ? canRead(context) : isManager(context),
    availableTransitions: retentionPolicyTransitions,
    authorizeTransition: async (from, to, payload, context) => Boolean(await isManager(context))
      && (to === "retired" || from === "draft" && to === "approved" || from === "approved" && to === "active")
      && (to === "retired" || (await retentionPolicyIssues(payload, context)).length === 0),
    example: {
      category: "Categoria definida pela instituição", purpose: "Finalidade a validar", data_categories: [], start_event: "Evento inicial a definir",
      retention_days: null, disposition: "review", legal_basis_reference: "", normative_source_record_id: null,
      normative_source_revision: null, institution_approval_reference: "", deletion_authorization_reference: "", effective_from: null,
    },
  },
  retention_case: {
    label: "Revisão de retenção e destinação",
    schema: object({
      target_record_id: uuid, target_revision: { type: "integer", minimum: 1 }, target_plugin_id: text(120), target_kind: text(120),
      policy_record_id: uuid, policy_revision: { type: "integer", minimum: 1 }, due_at: { type: "string", format: "date-time" },
      disposition: { type: "string", enum: ["review", "preserve", "block", "anonymize", "erase"] },
      legal_hold: { type: "boolean" }, legal_hold_reference: optionalText(1000),
      deletion_authorization_reference: optionalText(1000), execution_evidence_reference: optionalText(2000),
      executed_at: { type: ["string", "null"], format: "date-time" },
    }),
    initial: "draft", transitions: { draft: ["pending_review"], pending_review: ["approved", "blocked"], blocked: ["pending_review"], approved: ["executed"], executed: [] },
    resourceScoped: true, managePermission, authorizeCreate: (_actorId, _payload, context) => isManager(context),
    authorizeRecord: (_actorId, action, _state, _payload, context) => action === "read" ? canRead(context) : isManager(context),
    availableTransitions: retentionCaseTransitions,
    authorizeTransition: authorizeRetentionCaseTransition,
    validate: retentionCaseIssues,
    prepareTransition: (from, to, payload) => to === "executed" && from === "approved" ? { ...payload, executed_at: new Date().toISOString() } : payload,
    example: {
      target_record_id: "00000000-0000-4000-8000-000000000002", target_revision: 1, target_plugin_id: "documents", target_kind: "document",
      policy_record_id: "00000000-0000-4000-8000-000000000003", policy_revision: 1, due_at: "2026-12-31T23:59:59Z",
      disposition: "review", legal_hold: false, legal_hold_reference: "", deletion_authorization_reference: "",
      execution_evidence_reference: "", executed_at: null,
    },
  },
  privacy_incident: {
    label: "Incidente de privacidade",
    schema: object({
      incident_type: text(160), discovered_at: { type: "string", format: "date-time" },
      affected_record_refs: { type: "array", maxItems: 500, items: object({ record_id: uuid, plugin_id: text(120), kind: text(120) }) },
      data_categories: { type: "array", items: text(160), maxItems: 100 }, description: text(12000),
      containment_reference: optionalText(2000), impact_assessment_reference: optionalText(2000),
      notification_reference: optionalText(2000), closure_reference: optionalText(2000),
    }),
    initial: "detected", transitions: { detected: ["investigating"], investigating: ["contained"], contained: ["closed"], closed: [] },
    resourceScoped: true, managePermission, authorizeCreate: (_actorId, _payload, context) => isManager(context),
    authorizeRecord: (_actorId, action, _state, _payload, context) => action === "read" ? canRead(context) : isManager(context),
    availableTransitions: (state, payload) => state === "detected" ? ["investigating"]
      : state === "investigating" ? incidentTransitionIssues("contained", payload).length ? [] : ["contained"]
      : state === "contained" ? incidentTransitionIssues("closed", payload).length ? [] : ["closed"] : [],
    authorizeTransition: async (from, to, payload, context) => Boolean(await isManager(context))
      && (from === "detected" && to === "investigating" || from === "investigating" && to === "contained" || from === "contained" && to === "closed")
      && incidentTransitionIssues(to, payload).length === 0,
    example: {
      incident_type: "Tipo a classificar", discovered_at: "2026-01-01T12:00:00Z", affected_record_refs: [], data_categories: [],
      description: "Registro de demonstração sem dados pessoais reais.", containment_reference: "", impact_assessment_reference: "",
      notification_reference: "", closure_reference: "",
    },
  },
};

export const safdoulasDataProtectionPlugin: PluginDefinition = {
  id: "safdoulas-data-protection",
  name: "Proteção de dados SAFDOULAS",
  version: "1.0.0",
  description: "Complementa Privacidade com políticas configuráveis de retenção, preservação legal, destinação documentada e registro de incidentes.",
  scope: "workspace",
  dependencies: ["versioned-records", "privacy", "safdoulas-governance", "documents"],
  capabilities: [
    { id: "read", name: "Consultar proteção de dados", permissions: [readPermission] },
    { id: "manage", name: "Administrar proteção de dados", permissions: [managePermission] },
  ],
  contributions: { navigation: [{ id: "safdoulas-data-protection", href: "/extensions/safdoulas-data-protection", label: "Proteção de dados" , permission: "plugin.safdoulas-data-protection.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "publication", "label": "Publicação e privacidade", "order": 3}, order: 1}], recordKinds },
};
