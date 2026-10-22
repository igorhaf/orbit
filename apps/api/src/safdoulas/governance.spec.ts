import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginRegistry } from "../execution/registries";
import { genericPlugins } from "../plugins/records/catalog";
import { validate } from "../plugins/records/rules";
import { workspacesPlugin } from "../workspaces/workspaces.plugin";
import { accreditationRulesetIssues, blindingPolicyIssues, normativeDocumentIssues, normativeDocumentTransitions, safdoulasGovernancePlugin } from "./governance.plugin";

test("SafDoulas governance schemas register over the shared versioned-record engine", async () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(safdoulasGovernancePlugin);

  const registered = registry.getById("safdoulas-governance");
  assert.deepEqual(Object.keys(registered.contributions?.recordKinds || {}), [
    "normative_document",
    "accreditation_ruleset",
    "approved_template",
    "decision_policy",
    "blinding_policy",
  ]);
  assert.equal(registry.isEnabled("safdoulas-governance"), true);
  for (const [kind, definition] of Object.entries(registered.contributions?.recordKinds || {}))
    assert.doesNotThrow(() => validate(definition.schema, definition.example), kind);
  const ruleset = registered.contributions?.recordKinds?.accreditation_ruleset;
  const issues = await ruleset?.validate?.({
    ...ruleset.example,
    state_transitions: [{ from: "unconfigured", to: "decision", required_role: "applicant" }],
  }, { resolveRecord: async () => null });
  assert.ok(issues?.some((item) => item.code === "transition_state_missing"));
  const invalidPattern = await ruleset?.validate?.({
    ...ruleset.example,
    protocol_pattern: "SAF-{sequence}-{sequence}",
  }, { resolveRecord: async () => null });
  assert.ok(invalidPattern?.some((item) => item.code === "invalid_protocol_pattern"));
  registry.setEnabled("documents", false);
  assert.equal(registry.isEnabled("safdoulas-governance"), false);
  registry.setEnabled("documents", true);
  assert.equal(registry.isEnabled("safdoulas-governance"), true);
});

test("normative sources must pin a published original document with the same checksum before activation", async () => {
  const definition = safdoulasGovernancePlugin.contributions?.recordKinds?.normative_document;
  assert.ok(definition);
  const payload = { ...definition.example, source_document_record_id: "file", source_document_revision: 2, checksum_sha256: "a".repeat(64) };
  const issues = await normativeDocumentIssues(payload, { resolveRecord: async () => ({
    id: "file", pluginId: "documents", kind: "document", state: "published", revision: 2,
    payload: { variant: "original", sha256: "b".repeat(64) },
  }) });
  assert.deepEqual(issues.map((item) => item.code), ["normative_source_checksum_mismatch"]);
  assert.deepEqual(await normativeDocumentTransitions("approved", { ...payload, checksum_sha256: "b".repeat(64) }, { resolveRecord: async () => ({
    id: "file", pluginId: "documents", kind: "document", state: "published", revision: 2,
    payload: { variant: "original", sha256: "b".repeat(64) },
  }) }), ["active"]);
});

test("admission requirement codes are unique within a ruleset version", async () => {
  const definition = safdoulasGovernancePlugin.contributions?.recordKinds?.accreditation_ruleset;
  assert.ok(definition);
  const requirement = { code: "same-code", description: "Requisito demonstrativo", required: true, evidence_required: true };
  const issues = await definition.validate?.({
    ...definition.example,
    admission_requirements: [requirement, requirement],
  }, { resolveRecord: async () => null });
  assert.ok(issues?.some((item) => item.code === "duplicate_admission_requirement"));
});

test("ruleset activation requires every cited source to be pinned to an active normative version", async () => {
  const payload = {
    source_references: ["SAF-REG-01"],
    normative_document_refs: [{ record_id: "norm", revision: 4, source_reference: "SAF-REG-01" }],
  };
  const context = { resolveRecord: async () => ({
    id: "norm", pluginId: "safdoulas-governance", kind: "normative_document", state: "active", revision: 4,
    payload: { reference: "SAF-REG-01" },
  }) };
  assert.deepEqual(await accreditationRulesetIssues(payload, context), []);
  const missing = await accreditationRulesetIssues({ ...payload, normative_document_refs: [] }, context);
  assert.ok(missing.some((item) => item.code === "normative_source_snapshot_mismatch"));
});

test("blinding policy cannot activate until every category, preserved evidence, checks, and approval are configured", async () => {
  const policyDefinition = safdoulasGovernancePlugin.contributions?.recordKinds?.blinding_policy;
  assert.ok(policyDefinition);
  const draft = policyDefinition.example;
  assert.ok(blindingPolicyIssues(draft).some((issue) => issue.code === "blinding_categories_incomplete"));
  assert.deepEqual(await policyDefinition.availableTransitions?.("approved", draft, { resolveRecord: async () => null }), []);

  const categories = ["person_name", "institution_name", "cnpj", "contact", "visual_identity", "file_metadata"];
  const configured = {
    ...draft,
    approval_reference: "DEMO-APPROVAL-001",
    blinding_policy: {
      redaction_rules: categories.map((category) => ({ category, target: `${category}:demo`, action: "confirm_absent", rationale: "Configuração demonstrativa." })),
      preserved_evidence: [{ target: "pedagogical-evidence:demo", rationale: "Exemplo; validar antes de uso real." }],
      required_checks: categories.map((category) => ({ code: `check-${category}`, label: `Verificar ${category}`, category })),
    },
  };
  assert.deepEqual(blindingPolicyIssues(configured), []);
  assert.deepEqual(await policyDefinition.availableTransitions?.("approved", configured, { resolveRecord: async () => null }), ["active"]);
});
