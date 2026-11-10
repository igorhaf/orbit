import type { PluginDefinition, RecordKindContribution, RecordValidationIssue } from "../plugins/contract";
import type { RecordValidationContext, ResolvedRecordReference } from "../plugins/contract";

const text = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
const optionalText = (maxLength = 2000) => ({ type: "string", maxLength });
const nullableUuid = { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const stringList = { type: "array", items: text(500), maxItems: 200, uniqueItems: true };
const list = (items: Record<string, unknown>, maxItems = 200) => ({ type: "array", items, maxItems });
const object = (
  properties: Record<string, Record<string, unknown>>,
  required: string[] = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });

const blindingCategories = ["person_name", "institution_name", "cnpj", "contact", "visual_identity", "file_metadata"] as const;
const blindingCategory = { type: "string", enum: [...blindingCategories] };
const allBlindingCategories = (items: Array<{ category: string }>) => blindingCategories.every((category) => items.some((item) => item.category === category));
const reviewTransitions = (state: string): string[] => ({ draft: ["under_review"], under_review: ["draft", "approved"], active: ["superseded"] }[state] || []);

export function blindingPolicyIssues(payload: Record<string, unknown>): RecordValidationIssue[] {
  const issues: RecordValidationIssue[] = [];
  const policy = payload.blinding_policy as Record<string, unknown> | undefined;
  const redactionRules = Array.isArray(policy?.redaction_rules) ? policy.redaction_rules as Array<{ category: string; target: string; rationale: string }> : [];
  const preservationRules = Array.isArray(policy?.preserved_evidence) ? policy.preserved_evidence as Array<{ target: string; rationale: string }> : [];
  const checks = Array.isArray(policy?.required_checks) ? policy.required_checks as Array<{ code: string; category: string }> : [];
  if (!allBlindingCategories(redactionRules))
    issues.push({ severity: "warning", code: "blinding_categories_incomplete", path: "blinding_policy.redaction_rules", message: "Defina como tratar nomes de pessoas e instituições, CNPJ, contatos, identidade visual e metadados de arquivos; cada categoria deve ser removida ou ter ausência confirmada." });
  if (!preservationRules.length)
    issues.push({ severity: "warning", code: "preserved_evidence_missing", path: "blinding_policy.preserved_evidence", message: "Defina as evidências pedagógicas que precisam continuar visíveis à avaliação." });
  if (!allBlindingCategories(checks))
    issues.push({ severity: "warning", code: "blinding_checks_incomplete", path: "blinding_policy.required_checks", message: "Inclua uma verificação independente para cada categoria de cegamento." });
  if (!String(payload.approval_reference || "").trim())
    issues.push({ severity: "warning", code: "blinding_policy_not_approved", path: "approval_reference", message: "Registre a referência da aprovação institucional antes de ativar esta política." });
  const codes = checks.map((item) => item.code);
  if (new Set(codes).size !== codes.length)
    issues.push({ severity: "error", code: "duplicate_blinding_check", path: "blinding_policy.required_checks", message: "Os códigos das verificações de cegamento devem ser únicos." });
  if (redactionRules.some((item) => !item.target.trim() || !item.rationale.trim()))
    issues.push({ severity: "error", code: "incomplete_blinding_rule", path: "blinding_policy.redaction_rules", message: "Cada regra de remoção ou ausência confirmada precisa indicar alvo e justificativa." });
  if (preservationRules.some((item) => !item.target.trim() || !item.rationale.trim()))
    issues.push({ severity: "error", code: "incomplete_preservation_rule", path: "blinding_policy.preserved_evidence", message: "Cada evidência preservada precisa indicar alvo e justificativa." });
  return issues;
}

async function blindingPolicyTransitions(state: string, payload: Record<string, unknown>): Promise<string[]> {
  if (state !== "approved") return reviewTransitions(state);
  return blindingPolicyIssues(payload).length === 0 ? ["active"] : [];
}

const sourceDocumentRefSchema = object({ record_id: { ...nullableUuid, type: "string" }, revision: { type: "integer", minimum: 1 }, source_reference: text(500) });
type SourceDocumentRef = { record_id: string; revision: number; source_reference: string };
type GovernanceRecord = ResolvedRecordReference;

async function sourceDocument(context: RecordValidationContext, id: unknown, revision: unknown): Promise<GovernanceRecord | null> {
  return typeof id === "string" && Number.isInteger(revision) ? context.resolveRecord(id, Number(revision)) : null;
}

export async function normativeDocumentIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  if ((typeof payload.source_document_record_id === "string") !== (typeof payload.source_document_revision === "number"))
    issues.push({ severity: "error", code: "incomplete_normative_source_file", path: "source_document_record_id", message: "Informe o registro do arquivo original e sua versão juntos." });
  if (typeof payload.source_document_record_id !== "string") {
    issues.push({ severity: "warning", code: "normative_source_file_missing", path: "source_document_record_id", message: "Vincule o arquivo original e sua versão antes de ativar esta fonte normativa." });
    return issues;
  }
  const source = await sourceDocument(context, payload.source_document_record_id, payload.source_document_revision);
  if (!source || source.pluginId !== "documents" || source.kind !== "document" || source.state !== "published")
    issues.push({ severity: "error", code: "published_normative_source_required", path: "source_document_record_id", message: "A fonte normativa precisa apontar para um documento original publicado e versionado." });
  else if (source.payload.variant !== "original" || source.payload.sha256 !== payload.checksum_sha256)
    issues.push({ severity: "error", code: "normative_source_checksum_mismatch", path: "checksum_sha256", message: "O checksum precisa corresponder ao arquivo original publicado." });
  return issues;
}

export async function accreditationRulesetIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const admissionRequirements = Array.isArray(payload.admission_requirements)
    ? payload.admission_requirements as Array<{ code: string }>
    : [];
  const admissionCodes = admissionRequirements.map((requirement) => requirement.code);
  if (new Set(admissionCodes).size !== admissionCodes.length)
    issues.push({ severity: "error", code: "duplicate_admission_requirement", path: "admission_requirements", message: "Os códigos dos requisitos de admissibilidade devem ser únicos nesta versão das regras." });
  const refs = Array.isArray(payload.normative_document_refs) ? payload.normative_document_refs as SourceDocumentRef[] : [];
  const sourceCodes = Array.isArray(payload.source_references) ? payload.source_references as string[] : [];
  const resolved: GovernanceRecord[] = [];
  for (const [index, item] of refs.entries()) {
    const source = await sourceDocument(context, item.record_id, item.revision);
    if (!source || source.pluginId !== "safdoulas-governance" || source.kind !== "normative_document" || source.state !== "active")
      issues.push({ severity: "error", code: "active_normative_reference_required", path: `normative_document_refs[${index}]`, message: "Cada fundamento precisa apontar para uma versão ativa do documento normativo." });
    else {
      resolved.push(source);
      if (item.source_reference !== source.payload.reference)
        issues.push({ severity: "error", code: "normative_reference_code_mismatch", path: `normative_document_refs[${index}].source_reference`, message: "O código da fonte precisa corresponder ao documento normativo fixado." });
    }
  }
  if (new Set(refs.map((item) => `${item.record_id}:${item.revision}`)).size !== refs.length)
    issues.push({ severity: "error", code: "duplicate_normative_reference", path: "normative_document_refs", message: "Uma versão de documento normativo só pode ser referenciada uma vez." });
  if (new Set(sourceCodes).size !== sourceCodes.length)
    issues.push({ severity: "error", code: "duplicate_source_code", path: "source_references", message: "Os códigos das fontes não podem se repetir." });
  if (sourceCodes.length !== refs.length || sourceCodes.some((code) => !refs.some((item) => item.source_reference === code)))
    issues.push({ severity: refs.length ? "error" : "warning", code: "normative_source_snapshot_mismatch", path: "normative_document_refs", message: "Fixe a versão de cada documento citado nas regras; não deixe referência apenas como texto." });
  if (!refs.length && !issues.some((item) => item.code === "normative_source_snapshot_mismatch"))
    issues.push({ severity: "warning", code: "normative_sources_not_pinned", path: "normative_document_refs", message: "Nenhum documento normativo está fixado nesta versão das regras." });
  return issues;
}

export async function normativeDocumentTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (state !== "approved") return reviewTransitions(state);
  const issues = await normativeDocumentIssues(payload, context);
  return typeof payload.source_document_record_id === "string" && !issues.some((item) => item.severity === "error") ? ["active"] : [];
}

async function accreditationRulesetTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (state !== "approved") return reviewTransitions(state);
  const issues = await accreditationRulesetIssues(payload, context);
  return Array.isArray(payload.normative_document_refs) && payload.normative_document_refs.length > 0
    && !issues.some((item) => item.severity === "error") ? ["active"] : [];
}

const recordKinds: Record<string, RecordKindContribution> = {
  normative_document: {
    label: "Documento normativo",
    schema: object({
      reference: text(120),
      category: { type: "string", enum: ["edital_chamamento", "regulamento", "edital_curso", "fluxo", "formulario", "manual_selo", "modelo_concessao", "documento_norteador", "matriz_avaliativa", "termo_etico", "outro"] },
      title: text(500),
      issuer: text(240),
      version: text(80),
      published_on: { type: "string", format: "date" },
      effective_from: { type: "string", format: "date" },
      effective_until: { type: ["string", "null"], format: "date" },
      source_document_record_id: nullableUuid,
      source_document_revision: { type: ["integer", "null"], minimum: 1 },
      source_file: optionalText(500),
      checksum_sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
      notes: optionalText(10000),
    }, ["reference", "category", "title", "issuer", "version", "published_on", "effective_from"]),
    initial: "draft",
    transitions: { draft: ["under_review"], under_review: ["draft", "approved"], approved: ["active"], active: ["superseded"], superseded: [] },
    validate: normativeDocumentIssues,
    availableTransitions: normativeDocumentTransitions,
    immutable: ["active", "superseded"],
    example: {
      reference: "SAF-EXAMPLE-001",
      category: "documento_norteador",
      title: "Documento norteador de demonstração",
      issuer: "FENADOULASBR",
      version: "2026-demo-1",
      published_on: "2026-01-01",
      effective_from: "2026-01-01",
      source_document_record_id: null,
      source_document_revision: null,
      notes: "Registro demonstrativo; validar a vigência antes de uso real.",
    },
  },
  accreditation_ruleset: {
    label: "Conjunto de regras de acreditação",
    schema: object({
      code: text(120),
      title: text(500),
      version: text(80),
      source_references: stringList,
      normative_document_refs: { type: "array", items: sourceDocumentRefSchema, maxItems: 200, uniqueItems: true },
      admission_requirements: { type: "array", maxItems: 200, items: object({ code: text(120), description: text(4000), required: { type: "boolean" }, evidence_required: { type: "boolean" }, source_reference: optionalText(500) }) },
      hour_parameters: { type: "array", maxItems: 100, items: object({ code: text(120), label: text(300), minimum: { type: "number", minimum: 0 }, maximum: { type: "number", minimum: 0 }, unit: text(80), source_reference: optionalText(500) }, ["code", "label", "unit"]) },
      deadlines: { type: "array", maxItems: 100, items: object({ stage: text(120), duration_days: { type: "integer", minimum: 1 }, pause_when_waiting_for: stringList, source_reference: optionalText(500) }, ["stage", "duration_days"]) },
      process_types: { type: "array", items: { type: "string", enum: ["course_accreditation", "accreditor_selection"] }, minItems: 1, uniqueItems: true },
      process_states: stringList,
      state_transitions: { type: "array", maxItems: 200, items: object({ from: text(80), to: text(80), required_role: { type: "string", enum: ["applicant", "institution_representative", "accreditor_candidate", "screener", "evaluator", "deliberator", "secretariat", "appeal_reviewer", "observer"] } }) },
      matrix_record_id: nullableUuid,
      matrix_revision: { type: ["integer", "null"], minimum: 1 },
      decision_policy_record_id: nullableUuid,
      decision_policy_revision: { type: ["integer", "null"], minimum: 1 },
      application_form_record_id: nullableUuid,
      application_form_revision: { type: ["integer", "null"], minimum: 1 },
      protocol_pattern: optionalText(160),
      accreditation_validity_months: { type: "integer", minimum: 1, maximum: 120 },
      approval_reference: optionalText(500),
    }, ["code", "title", "version", "source_references", "admission_requirements", "hour_parameters", "deadlines", "process_types", "process_states", "state_transitions"]),
    initial: "draft",
    transitions: { draft: ["under_review"], under_review: ["draft", "approved"], approved: ["active"], active: ["superseded"], superseded: [] },
    immutable: ["active", "superseded"],
    availableTransitions: accreditationRulesetTransitions,
    example: {
      code: "SAF-ACC-DEMO-2026",
      title: "Regras demonstrativas de acreditação",
      version: "1.0-demo",
      source_references: [],
      normative_document_refs: [],
      matrix_record_id: null,
      matrix_revision: null,
      decision_policy_record_id: null,
      decision_policy_revision: null,
      admission_requirements: [{ code: "documents-complete", description: "Documentação exigida pelo edital aplicável recebida.", required: true, evidence_required: true, source_reference: "SAF-EXAMPLE-001" }],
      hour_parameters: [],
      deadlines: [],
      protocol_pattern: "{year}-{sequence:4}",
      process_types: ["course_accreditation"],
      process_states: ["draft", "submitted", "triage", "review", "diligence", "deliberation", "appeal", "decision"],
      state_transitions: [
        { from: "draft", to: "submitted", required_role: "applicant" },
        { from: "submitted", to: "triage", required_role: "screener" },
        { from: "triage", to: "review", required_role: "secretariat" },
        { from: "triage", to: "diligence", required_role: "secretariat" },
        { from: "diligence", to: "triage", required_role: "institution_representative" },
        { from: "review", to: "diligence", required_role: "evaluator" },
        { from: "diligence", to: "review", required_role: "institution_representative" },
        { from: "review", to: "deliberation", required_role: "secretariat" },
        { from: "deliberation", to: "diligence", required_role: "deliberator" },
        { from: "decision", to: "appeal", required_role: "secretariat" },
        { from: "deliberation", to: "decision", required_role: "deliberator" },
        { from: "appeal", to: "decision", required_role: "appeal_reviewer" },
      ],
    },
    validate: async (payload, context) => {
      const issues: RecordValidationIssue[] = await accreditationRulesetIssues(payload, context);
      if ((typeof payload.matrix_record_id === "string") !== (typeof payload.matrix_revision === "number"))
        issues.push({ severity: "error", code: "incomplete_matrix_reference", path: "matrix_record_id", message: "Informe a matriz de avaliação e sua versão juntas." });
      if ((typeof payload.decision_policy_record_id === "string") !== (typeof payload.decision_policy_revision === "number"))
        issues.push({ severity: "error", code: "incomplete_decision_policy_reference", path: "decision_policy_record_id", message: "Informe a política de decisão e sua versão juntas." });
      const states = new Set(payload.process_states as string[]);
      for (const [index, edge] of (payload.state_transitions as Array<{ from: string; to: string }>).entries()) {
        if (!states.has(edge.from) || !states.has(edge.to))
          issues.push({ severity: "error", code: "transition_state_missing", path: `state_transitions[${index}]`, message: "Cada transição precisa apontar para estados declarados no conjunto de regras." });
      }
      if (typeof payload.protocol_pattern === "string" && payload.protocol_pattern) {
        const pattern = payload.protocol_pattern;
        const tokens = [...pattern.matchAll(/\{[^{}]+\}/g)].map(([token]) => token);
        const sequenceTokens = tokens.filter((token) => /^\{sequence(?::[1-8])?\}$/.test(token));
        const literal = pattern.replace(/\{[^{}]+\}/g, "");
        if (sequenceTokens.length !== 1 || tokens.some((token) => token !== "{year}" && !/^\{sequence(?::[1-8])?\}$/.test(token)) || tokens.filter((token) => token === "{year}").length > 1 || (pattern.match(/\{/g) || []).length !== tokens.length || (pattern.match(/\}/g) || []).length !== tokens.length || !/^[A-Za-z0-9._/-]+$/.test(literal))
          issues.push({ severity: "error", code: "invalid_protocol_pattern", path: "protocol_pattern", message: "O formato do protocolo deve conter um único {sequence}, pode conter {year} e usar apenas letras, números, ponto, traço, barra ou sublinhado." });
      }
      return issues;
    },
  },
  approved_template: {
    label: "Modelo institucional",
    schema: object({
      code: text(120),
      title: text(500),
      document_type: { type: "string", enum: ["parecer", "diligencia", "concessao", "certificado", "comunicacao", "devolutiva", "resultado", "outro"] },
      version: text(80),
      body_markdown: text(100000),
      variables: stringList,
      source_references: stringList,
      approval_reference: optionalText(500),
    }, ["code", "title", "document_type", "version", "body_markdown", "variables", "source_references"]),
    initial: "draft",
    transitions: { draft: ["under_review"], under_review: ["draft", "approved"], approved: ["active"], active: ["retired"], retired: [] },
    immutable: ["active", "retired"],
    example: {
      code: "SAF-TEMPLATE-DEMO-001",
      title: "Modelo demonstrativo de parecer",
      document_type: "parecer",
      version: "1.0-demo",
      body_markdown: "## Parecer\n\nModelo de demonstração. Validar e substituir pelo modelo institucional aprovado.",
      variables: ["process_number", "course_name", "decision"],
      source_references: ["SAF-EXAMPLE-001"],
    },
  },
  decision_policy: {
    label: "Política de deliberação e recursos",
    schema: object({
      code: text(120),
      title: text(500),
      version: text(80),
      source_references: stringList,
      eligible_roles: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", enum: ["deliberator", "secretariat"] } },
      minimum_voters: { type: "integer", minimum: 1, maximum: 100 },
      minimum_appeal_reviewers: { type: "integer", minimum: 1, maximum: 100 },
      allowed_outcomes: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: { type: "string", enum: ["approved", "approved_with_conditions", "further_diligence", "denied"] } },
      support_thresholds: { type: "array", minItems: 1, maxItems: 4, items: object({ outcome: { type: "string", enum: ["approved", "approved_with_conditions", "further_diligence", "denied"] }, minimum_percent: { type: "number", minimum: 1, maximum: 100 } }) },
      appeals_enabled: { type: "boolean" },
      appealable_outcomes: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: { type: "string", enum: ["approved", "approved_with_conditions", "further_diligence", "denied"] } },
      appeal_period_days: { type: "integer", minimum: 0, maximum: 3650 },
      appeal_review_roles: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", enum: ["appeal_reviewer", "deliberator"] } },
      appeal_support_thresholds: { type: "array", minItems: 1, maxItems: 3, items: object({ outcome: { type: "string", enum: ["maintained", "modified", "reversed"] }, minimum_percent: { type: "number", minimum: 1, maximum: 100 } }) },
      approval_reference: optionalText(500),
    }, ["code", "title", "version", "source_references", "eligible_roles", "minimum_voters", "minimum_appeal_reviewers", "allowed_outcomes", "support_thresholds", "appeals_enabled", "appealable_outcomes", "appeal_period_days", "appeal_review_roles", "appeal_support_thresholds"]),
    initial: "draft",
    transitions: { draft: ["under_review"], under_review: ["draft", "approved"], approved: ["active"], active: ["superseded"], superseded: [] },
    immutable: ["active", "superseded"],
    example: {
      code: "SAF-DECISION-DEMO-001", title: "Política demonstrativa; configurar conforme deliberação institucional", version: "1.0-demo",
      source_references: [], eligible_roles: ["deliberator"], minimum_voters: 2, minimum_appeal_reviewers: 2,
      allowed_outcomes: ["approved", "approved_with_conditions", "further_diligence", "denied"],
      support_thresholds: [
        { outcome: "approved", minimum_percent: 50 }, { outcome: "approved_with_conditions", minimum_percent: 50 },
        { outcome: "further_diligence", minimum_percent: 50 }, { outcome: "denied", minimum_percent: 50 },
      ],
      appeals_enabled: true, appealable_outcomes: ["approved", "approved_with_conditions", "denied"], appeal_period_days: 30,
      appeal_review_roles: ["appeal_reviewer"], approval_reference: "DEMO — não é parâmetro institucional aprovado",
      appeal_support_thresholds: [
        { outcome: "maintained", minimum_percent: 50 }, { outcome: "modified", minimum_percent: 50 }, { outcome: "reversed", minimum_percent: 50 },
      ],
    },
    validate: (payload) => {
      const issues: RecordValidationIssue[] = [];
      const outcomes = payload.allowed_outcomes as string[];
      const thresholds = payload.support_thresholds as Array<{ outcome: string }>;
      for (const outcome of outcomes) if (!thresholds.some((item) => item.outcome === outcome))
        issues.push({ severity: "error", code: "decision_outcome_threshold_missing", path: "support_thresholds", message: `Configure o quórum de votos favoráveis para o resultado ${outcome}.` });
      for (const item of thresholds) if (!outcomes.includes(item.outcome))
        issues.push({ severity: "error", code: "decision_threshold_outcome_unknown", path: "support_thresholds", message: "Cada limiar de voto deve corresponder a um resultado permitido." });
      const appealOutcomes = ["maintained", "modified", "reversed"];
      const appealThresholds = payload.appeal_support_thresholds as Array<{ outcome: string }>;
      for (const outcome of appealOutcomes) if (!appealThresholds.some((item) => item.outcome === outcome))
        issues.push({ severity: "error", code: "appeal_threshold_missing", path: "appeal_support_thresholds", message: `Configure o limiar de votos para o resultado recursal ${outcome}.` });
      if (!String(payload.approval_reference || "").trim())
        issues.push({ severity: "warning", code: "decision_policy_approval_missing", path: "approval_reference", message: "Registre a aprovação institucional antes de ativar esta política para processos reais." });
      return issues;
    },
  },
  blinding_policy: {
    label: "Política de cegamento",
    schema: object({
      code: text(120),
      title: text(500),
      version: text(80),
      source_references: stringList,
      blinding_policy: object({
        redaction_rules: list(object({
          category: blindingCategory,
          target: text(500),
          action: { type: "string", enum: ["remove", "confirm_absent"] },
          rationale: text(2000),
        })),
        preserved_evidence: list(object({ target: text(500), rationale: text(2000) })),
        required_checks: list(object({ code: text(120), label: text(500), category: blindingCategory })),
      }),
      approval_reference: optionalText(500),
    }, ["code", "title", "version", "source_references", "blinding_policy"]),
    initial: "draft",
    transitions: { draft: ["under_review"], under_review: ["draft", "approved"], approved: ["active"], active: ["superseded"], superseded: [] },
    immutable: ["active", "superseded"],
    availableTransitions: blindingPolicyTransitions,
    validate: (payload) => blindingPolicyIssues(payload),
    example: {
      code: "SAF-BLINDING-DEMO-001",
      title: "Política demonstrativa de cegamento; completar e aprovar antes de uso",
      version: "1.0-demo",
      source_references: [],
      blinding_policy: { redaction_rules: [], preserved_evidence: [], required_checks: [] },
      approval_reference: "",
    },
  },
};

export const safdoulasGovernancePlugin: PluginDefinition = {
  id: "safdoulas-governance",
  name: "Governança SAFDOULAS",
  version: "1.0.0",
  description: "Versiona fontes normativas, regras parametrizadas e modelos institucionais do SAFDOULAS.",
  scope: "workspace",
  dependencies: ["versioned-records", "reference-library", "policy-parameters", "documents", "workflows"],
  capabilities: ["read", "write", "publish"].map((action) => ({
    id: action,
    name: action === "read" ? "Consultar governança" : action === "write" ? "Revisar governança" : "Aprovar e ativar governança",
    permissions: [`plugin.safdoulas-governance.${action}`],
  })),
  contributions: {
    navigation: [{ id: "safdoulas-governance", href: "/extensions/safdoulas-governance", label: "Governança" , permission: "plugin.safdoulas-governance.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "registry", "label": "Cadastros e normas", "order": 1}, order: 2}],
    recordKinds,
  },
};
