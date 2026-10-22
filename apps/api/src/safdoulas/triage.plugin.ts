import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue } from "../plugins/contract";

const uuid = { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const text = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
const optionalText = (maxLength = 2000) => ({ type: "string", maxLength });
const list = (items: Record<string, unknown>, maxItems = 200) => ({ type: "array", items, maxItems });
const object = (properties: Record<string, Record<string, unknown>>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });

type Reference = { id: string; pluginId: string; kind: string; state: string; revision: number; payload: Record<string, unknown> };
type AdmissionRequirement = { code: string; required: boolean; evidence_required: boolean };
type Finding = { requirement_code: string; outcome: string; evidence: Array<{ record_id: string; revision: number }>; note?: string };

export async function admissibilityReviewIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const process = await context.resolveRecord(String(payload.process_record_id), Number(payload.process_revision)) as Reference | null;
  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process" || process.state !== "triage") {
    issues.push({ severity: "error", code: "invalid_process_snapshot", path: "process_record_id", message: "A triagem deve apontar para uma versão do processo na etapa de triagem." });
    return issues;
  }
  if (process.payload.ruleset_record_id !== payload.ruleset_record_id || process.payload.ruleset_revision !== payload.ruleset_revision)
    issues.push({ severity: "error", code: "ruleset_snapshot_mismatch", path: "ruleset_record_id", message: "A triagem deve usar a mesma versão das regras fixada pelo processo." });

  const ruleset = await context.resolveRecord(String(payload.ruleset_record_id), Number(payload.ruleset_revision)) as Reference | null;
  if (!ruleset || ruleset.pluginId !== "safdoulas-governance" || ruleset.kind !== "accreditation_ruleset" || ruleset.state !== "active") {
    issues.push({ severity: "error", code: "invalid_ruleset_snapshot", path: "ruleset_record_id", message: "A triagem precisa usar um conjunto de regras ativo e versionado." });
    return issues;
  }

  const requirements = Array.isArray(ruleset.payload.admission_requirements)
    ? ruleset.payload.admission_requirements as AdmissionRequirement[]
    : [];
  const findings = Array.isArray(payload.findings) ? payload.findings as Finding[] : [];
  const requirementCodes = requirements.map((requirement) => requirement.code);
  const processDocuments = Array.isArray(process.payload.document_snapshots)
    ? process.payload.document_snapshots as Array<{ record_id: string; revision: number }>
    : [];
  const findingsByCode = new Map<string, Finding>();
  for (const [index, finding] of findings.entries()) {
    if (findingsByCode.has(finding.requirement_code))
      issues.push({ severity: "error", code: "duplicate_requirement_finding", path: `findings[${index}].requirement_code`, message: "Cada requisito deve ter uma única verificação nesta triagem." });
    findingsByCode.set(finding.requirement_code, finding);
    if (!requirementCodes.includes(finding.requirement_code))
      issues.push({ severity: "error", code: "unknown_admission_requirement", path: `findings[${index}].requirement_code`, message: "O requisito não pertence à versão de regras fixada." });
    const requirement = requirements.find((item) => item.code === finding.requirement_code);
    if (finding.outcome === "met" && requirement?.evidence_required && finding.evidence.length === 0)
      issues.push({ severity: "error", code: "requirement_evidence_required", path: `findings[${index}].evidence`, message: "Este requisito exige ao menos um documento comprobatório do processo." });
    if (finding.outcome !== "met" && !finding.note?.trim())
      issues.push({ severity: "error", code: "finding_note_required", path: `findings[${index}].note`, message: "Explique cada requisito ausente ou marcado como não aplicável." });
    for (const [evidenceIndex, evidence] of finding.evidence.entries()) {
      if (!processDocuments.some((document) => document.record_id === evidence.record_id && document.revision === evidence.revision))
        issues.push({ severity: "error", code: "triage_evidence_not_in_process", path: `findings[${index}].evidence[${evidenceIndex}]`, message: "A evidência precisa estar incluída no snapshot documental deste processo." });
      const document = await context.resolveRecord(evidence.record_id, evidence.revision);
      if (!document || document.pluginId !== "documents" || document.kind !== "document" || document.state !== "published")
        issues.push({ severity: "error", code: "invalid_triage_evidence", path: `findings[${index}].evidence[${evidenceIndex}]`, message: "A evidência precisa apontar para um documento publicado e versionado." });
    }
  }
  for (const requirement of requirements)
    if (!findingsByCode.has(requirement.code))
      issues.push({ severity: "error", code: "admission_requirement_unchecked", path: "findings", message: `O requisito ${requirement.code} ainda não foi verificado.` });

  const mandatoryFailure = requirements.some((requirement) => requirement.required && findingsByCode.get(requirement.code)?.outcome !== "met");
  if (payload.recommendation === "admissible" && mandatoryFailure)
    issues.push({ severity: "error", code: "mandatory_requirement_missing", path: "recommendation", message: "A recomendação de admissibilidade exige todos os requisitos obrigatórios atendidos." });
  if (payload.recommendation !== "admissible" && !String(payload.rationale || "").trim())
    issues.push({ severity: "error", code: "recommendation_rationale_required", path: "rationale", message: "Registre a justificativa da recomendação de correção ou inadmissibilidade." });
  return issues;
}

const recordKinds: Record<string, RecordKindContribution> = {
  admissibility_review: {
    label: "Triagem documental de admissibilidade",
    schema: object({
      process_record_id: uuid,
      process_revision: { type: "integer", minimum: 1 },
      ruleset_record_id: uuid,
      ruleset_revision: { type: "integer", minimum: 1 },
      findings: list(object({
        requirement_code: text(120),
        outcome: { type: "string", enum: ["met", "missing", "not_applicable"] },
        evidence: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }, ["record_id", "revision"]), 40),
        note: optionalText(4000),
      }, ["requirement_code", "outcome", "evidence"]), 200),
      recommendation: { type: "string", enum: ["admissible", "correction_required", "inadmissible"] },
      rationale: optionalText(12000),
    }),
    initial: "draft",
    transitions: { draft: ["completed"], completed: [] },
    immutable: ["completed"],
    resourceScoped: true,
    managePermission: "plugin.safdoulas-triage.manage",
    validate: admissibilityReviewIssues,
    example: {
      process_record_id: "00000000-0000-4000-8000-000000000001",
      process_revision: 2,
      ruleset_record_id: "00000000-0000-4000-8000-000000000002",
      ruleset_revision: 1,
      findings: [{ requirement_code: "documents-complete", outcome: "met", evidence: [] }],
      recommendation: "admissible",
      rationale: "Exemplo de triagem; substituir por evidência e regra institucional vigentes.",
    },
  },
};

export const safdoulasTriagePlugin: PluginDefinition = {
  id: "safdoulas-triage",
  name: "Triagem SAFDOULAS",
  version: "1.0.0",
  description: "Registra verificações de admissibilidade por requisito, com referência a regras e evidências versionadas.",
  scope: "workspace",
  dependencies: ["versioned-records", "safdoulas-processes", "safdoulas-governance", "documents", "privacy"],
  capabilities: ["read", "write", "publish"].map((action) => ({
    id: action,
    name: action === "read" ? "Consultar triagens" : action === "write" ? "Preparar triagem" : "Concluir triagem",
    permissions: [`plugin.safdoulas-triage.${action}`],
  })),
  contributions: {
    navigation: [{ id: "safdoulas-triage", href: "/extensions/safdoulas-triage", label: "Triagem" , permission: "plugin.safdoulas-triage.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "workflow", "label": "Tramitação", "order": 2}, order: 1}],
    recordKinds,
  },
};
