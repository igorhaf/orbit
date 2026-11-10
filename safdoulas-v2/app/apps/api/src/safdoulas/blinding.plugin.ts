import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue } from "../plugins/contract";

const uuid = { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const optionalText = (maxLength = 4000) => ({ type: "string", maxLength });
const object = (properties: Record<string, Record<string, unknown>>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
type Reference = { id: string; pluginId: string; kind: string; state: string; revision: number; payload: Record<string, unknown> };

export async function blindedProjectionIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const resolve = async (id: unknown, revision: unknown) => typeof id === "string" && typeof revision === "number"
    ? await context.resolveRecord(id, revision) as Reference | null
    : null;
  const process = await resolve(payload.process_record_id, payload.process_revision);
  const source = await resolve(payload.original_document_record_id, payload.original_document_revision);
  const copy = await resolve(payload.blinded_document_record_id, payload.blinded_document_revision);
  const policy = await resolve(payload.blinding_policy_record_id, payload.blinding_policy_revision);
  const review = await resolve(payload.document_review_record_id, payload.document_review_revision);

  if (!process || process.pluginId !== "safdoulas-processes" || process.kind !== "accreditation_process" || process.state !== "review")
    issues.push({ severity: "error", code: "invalid_process_snapshot", path: "process_record_id", message: "A projeção deve pertencer a uma versão do processo na etapa de análise." });
  else {
    const snapshots = Array.isArray(process.payload.document_snapshots) ? process.payload.document_snapshots as Array<{ record_id: string; revision: number }> : [];
    if (!snapshots.some((item) => item.record_id === payload.original_document_record_id && item.revision === payload.original_document_revision))
      issues.push({ severity: "error", code: "source_not_in_process", path: "original_document_record_id", message: "O original precisa estar incluído nos documentos congelados do processo." });
    if (process.payload.blinding_policy_record_id !== payload.blinding_policy_record_id || process.payload.blinding_policy_revision !== payload.blinding_policy_revision)
      issues.push({ severity: "error", code: "policy_snapshot_mismatch", path: "blinding_policy_record_id", message: "Use a mesma política de cegamento fixada pelo processo." });
  }

  if (!source || source.pluginId !== "documents" || source.kind !== "document" || source.state !== "published" || source.payload.variant !== "original")
    issues.push({ severity: "error", code: "invalid_original_document", path: "original_document_record_id", message: "A projeção precisa preservar uma versão publicada do documento original." });
  if (!copy || copy.pluginId !== "documents" || copy.kind !== "document" || copy.state !== "published" || copy.payload.variant !== "anonymized")
    issues.push({ severity: "error", code: "invalid_blinded_document", path: "blinded_document_record_id", message: "A cópia precisa estar publicada como variante anonimizada." });
  else if (copy.payload.source_id !== payload.original_document_record_id || copy.payload.source_revision !== payload.original_document_revision)
    issues.push({ severity: "error", code: "source_copy_mismatch", path: "blinded_document_record_id", message: "A cópia anonimizada precisa apontar para a versão original indicada." });
  else if (source && typeof source.payload.sha256 === "string" && copy.payload.sha256 === source.payload.sha256)
    issues.push({ severity: "error", code: "blinded_copy_identical_to_source", path: "blinded_document_record_id", message: "A cópia cegada tem o mesmo checksum do original; gere e revise uma cópia própria sem alterar a fonte." });

  if (!policy || policy.pluginId !== "safdoulas-governance" || policy.kind !== "blinding_policy" || policy.state !== "active")
    issues.push({ severity: "error", code: "invalid_blinding_policy", path: "blinding_policy_record_id", message: "A projeção deve usar uma política de cegamento ativa e versionada." });
  if (!review || review.pluginId !== "documents" || review.kind !== "review" || review.state !== "published" || review.payload.decision !== "approved")
    issues.push({ severity: "error", code: "missing_independent_document_review", path: "document_review_record_id", message: "A cópia precisa de revisão independente aprovada pelo plugin de documentos." });
  else {
    const reviewedCopy = await resolve(review.payload.document_id, review.payload.document_revision);
    const exactVersion = review.payload.document_revision === payload.blinded_document_revision;
    const identicalFile = reviewedCopy && copy && typeof copy.payload.sha256 === "string" && typeof copy.payload.file_revision === "number"
      && reviewedCopy.payload.sha256 === copy.payload.sha256 && reviewedCopy.payload.file_revision === copy.payload.file_revision;
    if (review.payload.document_id !== payload.blinded_document_record_id || !(exactVersion || identicalFile))
      issues.push({ severity: "error", code: "review_version_mismatch", path: "document_review_record_id", message: "A revisão precisa corresponder exatamente à versão da cópia publicada." });
    const configuredChecks = policy && policy.pluginId === "safdoulas-governance" && policy.kind === "blinding_policy"
      ? (policy.payload.blinding_policy as { required_checks?: Array<{ code: string }> } | undefined)?.required_checks || []
      : [];
    const checks = review.payload.checks && typeof review.payload.checks === "object" && !Array.isArray(review.payload.checks)
      ? review.payload.checks as Record<string, unknown>
      : {};
    const expected = configuredChecks.map((check) => check.code).sort();
    const actual = Object.keys(checks).sort();
    if (!expected.length || expected.length !== actual.length || expected.some((code, index) => code !== actual[index]))
      issues.push({ severity: "error", code: "blinding_checklist_mismatch", path: "document_review_record_id", message: "A revisão precisa registrar exatamente todas as verificações da política fixada." });
    else if (Object.values(checks).some((value) => value !== true))
      issues.push({ severity: "error", code: "blinding_check_failed", path: "document_review_record_id", message: "A cópia não pode ser aprovada enquanto qualquer verificação de cegamento falhar." });
  }
  return issues;
}

async function projectionTransitions(state: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<string[]> {
  if (state !== "draft") return [];
  return (await blindedProjectionIssues(payload, context)).some((issue) => issue.severity === "error") ? [] : ["verified"];
}

const recordKinds: Record<string, RecordKindContribution> = {
  blinded_projection: {
    label: "Projeção cegada de avaliação",
    schema: object({
      process_record_id: uuid,
      process_revision: { type: "integer", minimum: 1 },
      original_document_record_id: uuid,
      original_document_revision: { type: "integer", minimum: 1 },
      blinded_document_record_id: uuid,
      blinded_document_revision: { type: "integer", minimum: 1 },
      document_review_record_id: uuid,
      document_review_revision: { type: "integer", minimum: 1 },
      blinding_policy_record_id: uuid,
      blinding_policy_revision: { type: "integer", minimum: 1 },
      reviewer_note: optionalText(12000),
    }),
    initial: "draft",
    transitions: { draft: ["verified"], verified: [] },
    immutable: ["verified"],
    resourceScoped: true,
    managePermission: "plugin.safdoulas-blinding.manage",
    availableTransitions: projectionTransitions,
    validate: blindedProjectionIssues,
    example: {
      process_record_id: "00000000-0000-4000-8000-000000000001",
      process_revision: 4,
      original_document_record_id: "00000000-0000-4000-8000-000000000002",
      original_document_revision: 1,
      blinded_document_record_id: "00000000-0000-4000-8000-000000000003",
      blinded_document_revision: 1,
      document_review_record_id: "00000000-0000-4000-8000-000000000004",
      document_review_revision: 1,
      blinding_policy_record_id: "00000000-0000-4000-8000-000000000005",
      blinding_policy_revision: 1,
      reviewer_note: "Registro demonstrativo; conferir a política e os documentos vinculados.",
    },
  },
};

export const safdoulasBlindingPlugin: PluginDefinition = {
  id: "safdoulas-blinding",
  name: "Cegamento SAFDOULAS",
  version: "1.0.0",
  description: "Vincula original, cópia anonimizada e checklist independente à política versionada do processo, sem alterar o original.",
  scope: "workspace",
  dependencies: ["versioned-records", "safdoulas-processes", "safdoulas-governance", "documents", "privacy"],
  capabilities: ["read", "write", "publish", "manage"].map((action) => ({
    id: action,
    name: action === "read" ? "Consultar projeções cegadas" : action === "write" ? "Preparar projeções cegadas" : action === "publish" ? "Verificar projeções cegadas" : "Administrar acesso às projeções",
    permissions: [`plugin.safdoulas-blinding.${action}`],
  })),
  contributions: {
    navigation: [{ id: "safdoulas-blinding", href: "/extensions/safdoulas-blinding", label: "Cegamento" , permission: "plugin.safdoulas-blinding.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "workflow", "label": "Tramitação", "order": 2}, order: 2}],
    recordKinds,
  },
};
