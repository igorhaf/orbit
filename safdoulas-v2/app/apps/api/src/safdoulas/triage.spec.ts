import assert from "node:assert/strict";
import test from "node:test";
import type { RecordValidationContext, ResolvedRecordReference } from "../plugins/contract";
import { genericPlugins } from "../plugins/records/catalog";
import { PluginRegistry } from "../execution/registries";
import { workspacesPlugin } from "../workspaces/workspaces.plugin";
import { safdoulasGovernancePlugin } from "./governance.plugin";
import { safdoulasProcessesPlugin } from "./processes.plugin";
import { safdoulasRegistryPlugin } from "./registry.plugin";
import { admissibilityReviewIssues, safdoulasTriagePlugin } from "./triage.plugin";

const processId = "00000000-0000-4000-8000-000000000001";
const rulesetId = "00000000-0000-4000-8000-000000000002";
const evidenceId = "00000000-0000-4000-8000-000000000003";
const rulesetPayload = {
  admission_requirements: [
    { code: "documents-complete", description: "Exemplo", required: true, evidence_required: true },
    { code: "accessibility", description: "Exemplo", required: false, evidence_required: false },
  ],
};

function context(processState = "triage", processRulesetId = rulesetId): RecordValidationContext {
  const references: Record<string, ResolvedRecordReference> = {
    [`${processId}:2`]: {
      id: processId, pluginId: "safdoulas-processes", kind: "accreditation_process", state: processState, revision: 2,
      payload: { ruleset_record_id: processRulesetId, ruleset_revision: 1, document_snapshots: [{ record_id: evidenceId, revision: 1 }] },
    },
    [`${rulesetId}:1`]: {
      id: rulesetId, pluginId: "safdoulas-governance", kind: "accreditation_ruleset", state: "active", revision: 1,
      payload: rulesetPayload,
    },
    [`${evidenceId}:1`]: {
      id: evidenceId, pluginId: "documents", kind: "document", state: "published", revision: 1,
      payload: { variant: "original", file_name: "comprovante.pdf" },
    },
  };
  return { resolveRecord: async (id, revision) => references[`${id}:${revision}`] || null };
}

const review = {
  process_record_id: processId,
  process_revision: 2,
  ruleset_record_id: rulesetId,
  ruleset_revision: 1,
  findings: [
    { requirement_code: "documents-complete", outcome: "met", evidence: [{ record_id: evidenceId, revision: 1 }] },
    { requirement_code: "accessibility", outcome: "not_applicable", evidence: [], note: "Não se aplica a esta verificação inicial." },
  ],
  recommendation: "admissible",
  rationale: "Requisitos obrigatórios verificados.",
};

test("triage plugin registers as a leaf over shared process, governance, and document plugins", () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(safdoulasGovernancePlugin);
  registry.register(safdoulasRegistryPlugin);
  registry.register(safdoulasProcessesPlugin);
  registry.register(safdoulasTriagePlugin);
  assert.equal(registry.isEnabled("safdoulas-triage"), true);
  registry.setEnabled("documents", false);
  assert.equal(registry.isEnabled("safdoulas-triage"), false);
});

test("admissibility checks every pinned requirement and blocks missing mandatory items", async () => {
  assert.deepEqual(await admissibilityReviewIssues(review, context()), []);
  const result = await admissibilityReviewIssues({
    ...review,
    findings: [
      { requirement_code: "documents-complete", outcome: "missing", evidence: [], note: "Falta o documento." },
      review.findings[1],
    ],
  }, context());
  assert.equal(result.some((issue) => issue.code === "mandatory_requirement_missing"), true);
});

test("triage requires evidence when configured and rejects documents outside the process snapshot", async () => {
  const withoutEvidence = await admissibilityReviewIssues({
    ...review,
    findings: [
      { requirement_code: "documents-complete", outcome: "met", evidence: [] },
      review.findings[1],
    ],
  }, context());
  assert.ok(withoutEvidence.some((issue) => issue.code === "requirement_evidence_required"));

  const outsideSnapshot = await admissibilityReviewIssues({
    ...review,
    findings: [
      { requirement_code: "documents-complete", outcome: "met", evidence: [{ record_id: rulesetId, revision: 1 }] },
      review.findings[1],
    ],
  }, context());
  assert.ok(outsideSnapshot.some((issue) => issue.code === "triage_evidence_not_in_process"));
});

test("triage requires the process to be in triage and to use its pinned ruleset", async () => {
  const wrongStage = await admissibilityReviewIssues(review, context("review"));
  assert.equal(wrongStage[0].code, "invalid_process_snapshot");
  const mismatchedRules = await admissibilityReviewIssues(review, context("triage", "00000000-0000-4000-8000-000000000003"));
  assert.equal(mismatchedRules[0].code, "ruleset_snapshot_mismatch");
});
