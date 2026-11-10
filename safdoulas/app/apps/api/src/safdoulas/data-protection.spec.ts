import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecordValidationContext, ResolvedRecordReference } from "../plugins/contract";
import { genericPlugins } from "../plugins/records/catalog";
import { validate } from "../plugins/records/rules";
import { PluginRegistry } from "../execution/registries";
import { workspacesPlugin } from "../workspaces/workspaces.plugin";
import { authorizeRetentionCaseTransition, incidentTransitionIssues, retentionCaseIssues, retentionPolicyIssues, safdoulasDataProtectionPlugin } from "./data-protection.plugin";
import { safdoulasGovernancePlugin } from "./governance.plugin";

const normId = "00000000-0000-4000-8000-000000000001";
const policyId = "00000000-0000-4000-8000-000000000002";
const targetId = "00000000-0000-4000-8000-000000000003";
const norm: ResolvedRecordReference = {
  id: normId, pluginId: "safdoulas-governance", kind: "normative_document", state: "active", revision: 2,
  payload: { reference: "NORM-EXAMPLE" },
};
const policy: ResolvedRecordReference = {
  id: policyId, pluginId: "safdoulas-data-protection", kind: "retention_policy", state: "active", revision: 1,
  payload: {},
};
const target: ResolvedRecordReference = {
  id: targetId, pluginId: "documents", kind: "document", state: "published", revision: 3,
  payload: { variant: "original" },
};

function context(records: ResolvedRecordReference[] = [norm, policy, target], manager = true): RecordValidationContext {
  return {
    actorId: "staff",
    resolveRecord: async (id, revision) => records.find((record) => record.id === id && record.revision === revision) || null,
    hasGlobalPermission: async (permission) => manager && permission === "plugin.safdoulas-data-protection.manage",
  };
}

test("SafDoulas data protection is a child plugin over generic privacy, documents and versioned records", () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(safdoulasGovernancePlugin);
  registry.register(safdoulasDataProtectionPlugin);
  assert.equal(registry.isEnabled("safdoulas-data-protection"), true);
  assert.ok(safdoulasDataProtectionPlugin.dependencies?.includes("privacy"));
  registry.setEnabled("privacy", false);
  assert.equal(registry.isEnabled("safdoulas-data-protection"), false);
  registry.setEnabled("privacy", true);
  assert.equal(registry.isEnabled("safdoulas-data-protection"), true);
  for (const definition of Object.values(safdoulasDataProtectionPlugin.contributions?.recordKinds || {}))
    assert.doesNotThrow(() => validate(definition.schema, definition.example));
});

test("retention policy requires an active pinned normative source and leaves institutional parameters unset", async () => {
  const definition = safdoulasDataProtectionPlugin.contributions?.recordKinds?.retention_policy;
  assert.ok(definition);
  assert.equal(definition.example.retention_days, null);
  const unsetIssues = await retentionPolicyIssues({ ...definition.example }, context());
  assert.deepEqual(new Set(unsetIssues.map((item) => item.code)), new Set([
    "retention_data_categories_required", "retention_duration_required", "retention_legal_basis_required",
    "retention_approval_required", "retention_effective_date_required", "active_normative_source_required",
  ]));
  const configured = {
    ...definition.example, category: "categoria demo", data_categories: ["dados de exemplo"], retention_days: 10,
    legal_basis_reference: "base de teste", normative_source_record_id: normId, normative_source_revision: 2,
    institution_approval_reference: "aprovado para teste", effective_from: "2026-01-01",
  };
  assert.deepEqual(await retentionPolicyIssues(configured, context()), []);
  assert.ok((await retentionPolicyIssues(configured, context([ { ...norm, state: "draft" } ]))).some((item) => item.code === "active_normative_source_required"));
});

test("retention case pins its target and active policy and legal hold blocks destructive disposition", async () => {
  const definition = safdoulasDataProtectionPlugin.contributions?.recordKinds?.retention_case;
  assert.ok(definition);
  const payload = {
    ...definition.example, target_record_id: targetId, target_revision: 3, policy_record_id: policyId,
    policy_revision: 1, disposition: "preserve", legal_hold: false,
  };
  assert.deepEqual(await retentionCaseIssues(payload, context()), []);
  assert.equal(await authorizeRetentionCaseTransition("draft", "pending_review", payload, context()), true);
  const held = { ...payload, disposition: "erase", legal_hold: true, legal_hold_reference: "hold-1" };
  assert.ok((await retentionCaseIssues(held, context())).some((item) => item.code === "legal_hold_blocks_disposition"));
  const mismatched = { ...payload, target_revision: 1 };
  assert.ok((await retentionCaseIssues(mismatched, context())).some((item) => item.code === "retention_target_reference_invalid"));
  assert.equal(await authorizeRetentionCaseTransition("approved", "executed", { ...payload, execution_evidence_reference: "evidence-1" }, context()), true);
  assert.equal(await authorizeRetentionCaseTransition("approved", "executed", { ...payload, execution_evidence_reference: "" }, context()), false);
  assert.equal(await authorizeRetentionCaseTransition("approved", "executed", { ...payload, disposition: "erase", execution_evidence_reference: "evidence-1" }, context()), false);
});

test("privacy incidents require containment and closure references before state transitions", () => {
  assert.equal(incidentTransitionIssues("contained", {}).length, 1);
  assert.equal(incidentTransitionIssues("contained", { containment_reference: "INC-1" }).length, 0);
  assert.equal(incidentTransitionIssues("closed", {}).length, 1);
  assert.equal(incidentTransitionIssues("closed", { closure_reference: "REL-1" }).length, 0);
});
