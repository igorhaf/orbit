import assert from "node:assert/strict";
import test from "node:test";
import type { RecordValidationContext, ResolvedRecordReference } from "../plugins/contract";
import { genericPlugins } from "../plugins/records/catalog";
import { PluginRegistry } from "../execution/registries";
import { workspacesPlugin } from "../workspaces/workspaces.plugin";
import { safdoulasGovernancePlugin } from "./governance.plugin";
import { safdoulasProcessesPlugin } from "./processes.plugin";
import { safdoulasRegistryPlugin } from "./registry.plugin";
import { safdoulasTriagePlugin } from "./triage.plugin";
import { blindedProjectionIssues, safdoulasBlindingPlugin } from "./blinding.plugin";

const processId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000002";
const copyId = "00000000-0000-4000-8000-000000000003";
const reviewId = "00000000-0000-4000-8000-000000000004";
const policyId = "00000000-0000-4000-8000-000000000005";
const reviewChecks = Object.fromEntries(["person_name", "institution_name", "cnpj", "contact", "visual_identity", "file_metadata"].map((category) => [`check-${category}`, true]));

function context(): RecordValidationContext {
  const records: Record<string, ResolvedRecordReference> = {
    [`${processId}:4`]: {
      id: processId, pluginId: "safdoulas-processes", kind: "accreditation_process", state: "review", revision: 4,
      payload: {
        blinding_policy_record_id: policyId,
        blinding_policy_revision: 1,
        document_snapshots: [{ record_id: sourceId, revision: 1 }],
      },
    },
    [`${sourceId}:1`]: {
      id: sourceId, pluginId: "documents", kind: "document", state: "published", revision: 1,
      payload: { variant: "original", sha256: "a".repeat(64) },
    },
    [`${copyId}:1`]: {
      id: copyId, pluginId: "documents", kind: "document", state: "published", revision: 1,
      payload: { variant: "anonymized", source_id: sourceId, source_revision: 1, sha256: "b".repeat(64) },
    },
    [`${policyId}:1`]: {
      id: policyId, pluginId: "safdoulas-governance", kind: "blinding_policy", state: "active", revision: 1,
      payload: { blinding_policy: {
        redaction_rules: ["person_name", "institution_name", "cnpj", "contact", "visual_identity", "file_metadata"].map((category) => ({ category, action: "remove" })),
        required_checks: Object.keys(reviewChecks).map((code, index) => ({ code, category: ["person_name", "institution_name", "cnpj", "contact", "visual_identity", "file_metadata"][index] })),
      } },
    },
    [`${reviewId}:1`]: {
      id: reviewId, pluginId: "documents", kind: "review", state: "published", revision: 1,
      payload: { decision: "approved", document_id: copyId, document_revision: 1, checks: reviewChecks },
    },
  };
  return { resolveRecord: async (id, revision) => records[`${id}:${revision}`] || null };
}

const projection = {
  process_record_id: processId, process_revision: 4,
  original_document_record_id: sourceId, original_document_revision: 1,
  blinded_document_record_id: copyId, blinded_document_revision: 1,
  document_review_record_id: reviewId, document_review_revision: 1,
  blinding_policy_record_id: policyId, blinding_policy_revision: 1,
};

test("SafDoulas blinding remains a leaf over generic versioned documents and process plugins", () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(safdoulasGovernancePlugin);
  registry.register(safdoulasRegistryPlugin);
  registry.register(safdoulasProcessesPlugin);
  registry.register(safdoulasTriagePlugin);
  registry.register(safdoulasBlindingPlugin);
  assert.equal(registry.isEnabled("safdoulas-blinding"), true);
  registry.setEnabled("documents", false);
  assert.equal(registry.isEnabled("safdoulas-blinding"), false);
});

test("blinded projection preserves the source and requires the exact active policy checklist", async () => {
  assert.deepEqual(await blindedProjectionIssues(projection, context()), []);
  const broken = await blindedProjectionIssues({ ...projection, blinded_document_revision: 2 }, context());
  assert.equal(broken.some((issue) => issue.code === "review_version_mismatch" || issue.code === "source_copy_mismatch"), true);
});

test("blinded projection rejects a copy whose bytes are identical to the original", async () => {
  const recordsContext = context();
  const resolve = recordsContext.resolveRecord;
  recordsContext.resolveRecord = async (id, revision) => {
    const record = await resolve(id, revision);
    return record?.id === copyId ? { ...record, payload: { ...record.payload, sha256: "a".repeat(64) } } : record;
  };
  const issues = await blindedProjectionIssues(projection, recordsContext);
  assert.equal(issues.some((issue) => issue.code === "blinded_copy_identical_to_source"), true);
});

test("a projection cannot be marked verified when one required blinding check failed", async () => {
  const recordsContext = context();
  const resolve = recordsContext.resolveRecord;
  recordsContext.resolveRecord = async (id, revision) => {
    const record = await resolve(id, revision);
    return record?.id === reviewId ? { ...record, payload: { ...record.payload, checks: { ...reviewChecks, "check-cnpj": false } } } : record;
  };
  const issues = await blindedProjectionIssues(projection, recordsContext);
  assert.equal(issues.some((issue) => issue.code === "blinding_check_failed"), true);
});
