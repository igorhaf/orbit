import assert from "node:assert/strict";
import test from "node:test";
import { publicAccreditationProjection } from "./accreditation.public";
import { grantIssues, publicListingIssues, renewalRequestIssues, postAccreditationChangeIssues, conditionFollowUpIssues, sealAssetIssues, safdoulasAccreditationPlugin } from "./accreditation.plugin";
import { PluginRegistry } from "../execution/registries";
import { genericPlugins } from "../plugins/records/catalog";
import { workspacesPlugin } from "../workspaces/workspaces.plugin";
import { safdoulasGovernancePlugin } from "./governance.plugin";
import { safdoulasProcessesPlugin } from "./processes.plugin";
import { safdoulasDecisionsPlugin } from "./decisions.plugin";
import { safdoulasRegistryPlugin } from "./registry.plugin";
import { safdoulasAssessmentsPlugin } from "./assessments.plugin";
import { safdoulasAccreditorsPlugin } from "./accreditors.plugin";
import { safdoulasBlindingPlugin } from "./blinding.plugin";
import { fillConcessionTemplate, renderConcessionPdf } from "./concession-document";

test("SAF accreditation plugin is a leaf over versioned records, documents, decisions, processes and governance", () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(safdoulasGovernancePlugin);
  registry.register(safdoulasRegistryPlugin);
  registry.register(safdoulasProcessesPlugin);
  registry.register(safdoulasAccreditorsPlugin);
  registry.register(safdoulasBlindingPlugin);
  registry.register(safdoulasAssessmentsPlugin);
  registry.register(safdoulasDecisionsPlugin);
  registry.register(safdoulasAccreditationPlugin);
  assert.equal(registry.isEnabled("safdoulas-accreditation"), true);
  assert.equal(registry.routePlugin("/public/safdoulas/accreditations/SAF-DEMO-2026-0001"), "safdoulas-accreditation");
  assert.equal(registry.routePlugin("/public/safdoulas/accreditations/SAF-DEMO-2026-0001/seal/digital"), "safdoulas-accreditation");
  const generationRoute = "/safdoulas/accreditation/grants/00000000-0000-4000-8000-000000000001/concession-document";
  assert.equal(registry.routePlugin(generationRoute), "safdoulas-accreditation");
  assert.equal(safdoulasAccreditationPlugin.routePermission?.(generationRoute, "POST"), "plugin.safdoulas-accreditation.manage");
  registry.setEnabled("safdoulas-decisions", false);
  assert.equal(registry.isEnabled("safdoulas-accreditation"), false);
  assert.equal(registry.catalog().find((item) => item.id === "safdoulas-accreditation")?.status, "blocked");
});

test("grant cannot be published without a ratified favorable decision, active template, and signed document", async () => {
  const issues = await grantIssues({
    process_record_id: "process", process_revision: 1,
    decision_record_id: "decision", decision_revision: 1,
    concession_template_record_id: "template", concession_template_revision: 1,
    signed_document_record_id: "document", signed_document_revision: 1,
    valid_from: "2026-01-01", valid_until: "2027-01-01",
    scope: { provider_name: "A", course_name: "B", description: "C" },
    condition_refs: [],
  }, { resolveRecord: async () => null });
  assert.deepEqual(issues.map((item) => item.code), [
    "decided_process_required", "grant_provider_reference_invalid", "grantable_decision_required", "active_concession_template_required", "signed_concession_document_required",
  ]);
});

test("grant drafts can be prepared before signing but cannot activate without a published signed document", async () => {
  const registry = new PluginRegistry();
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(safdoulasGovernancePlugin);
  registry.register(safdoulasRegistryPlugin);
  registry.register(safdoulasProcessesPlugin);
  registry.register(safdoulasAccreditorsPlugin);
  registry.register(safdoulasBlindingPlugin);
  registry.register(safdoulasAssessmentsPlugin);
  registry.register(safdoulasDecisionsPlugin);
  registry.register(safdoulasAccreditationPlugin);
  const payload = {
    process_record_id: "process", process_revision: 1,
    decision_record_id: "decision", decision_revision: 1,
    concession_template_record_id: "template", concession_template_revision: 1,
    signed_document_record_id: null, signed_document_revision: null,
    valid_from: "2026-01-01", valid_until: "2027-01-01",
    scope: { provider_name: "Provider", course_name: "Course", description: "Scope" }, condition_refs: [],
  };
  const records = new Map([
    ["process", { id: "process", pluginId: "safdoulas-processes", kind: "accreditation_process", state: "decision", revision: 1, payload: { provider_record_id: "provider", provider_revision: 1, process_type: "course_accreditation", course_record_id: "course", course_revision: 1 } }],
    ["decision", { id: "decision", pluginId: "safdoulas-decisions", kind: "institutional_decision", state: "ratified", revision: 1, payload: { process_record_id: "process", outcome: "approved" } }],
    ["template", { id: "template", pluginId: "safdoulas-governance", kind: "approved_template", state: "active", revision: 1, payload: { document_type: "concessao" } }],
    ["provider", { id: "provider", pluginId: "safdoulas-registry", kind: "education_provider", state: "active", revision: 1, payload: { display_name: "Provider" } }],
    ["course", { id: "course", pluginId: "safdoulas-registry", kind: "course", state: "active", revision: 1, payload: { name: "Course", provider_record_id: "provider" } }],
  ]);
  const context = { resolveRecord: async (recordId: string) => records.get(recordId) || null };
  const issues = await grantIssues(payload, context);
  assert.deepEqual(issues, []);
  const grant = safdoulasAccreditationPlugin.contributions?.recordKinds?.accreditation_grant;
  assert.ok(grant?.availableTransitions);
  assert.deepEqual(await grant.availableTransitions("draft", payload, context), ["cancelled"]);
});

test("seal assets need an approved manual, original print and digital files, and matching checksums", async () => {
  const asset = safdoulasAccreditationPlugin.contributions?.recordKinds?.seal_asset;
  assert.ok(asset);
  const payload = {
    ...asset.example, version: "seal-v1", files: [
      { format: "print", document_record_id: "print", document_revision: 1, checksum_sha256: "a".repeat(64) },
      { format: "digital", document_record_id: "digital", document_revision: 2, checksum_sha256: "b".repeat(64) },
    ], manual_record_id: "manual", manual_revision: 3, approval_reference: "APROVACAO-1", approved_at: "2026-01-01T12:00:00.000Z",
  };
  const records = new Map([
    ["print", { id: "print", pluginId: "documents", kind: "document", state: "published", revision: 1, payload: { variant: "original", sha256: "a".repeat(64) } }],
    ["digital", { id: "digital", pluginId: "documents", kind: "document", state: "published", revision: 2, payload: { variant: "original", sha256: "b".repeat(64) } }],
    ["manual", { id: "manual", pluginId: "safdoulas-governance", kind: "normative_document", state: "active", revision: 3, payload: { category: "manual_selo" } }],
  ]);
  const context = { resolveRecord: async (id: string, revision: number) => { const record = records.get(id); return record?.revision === revision ? record : null; } };
  assert.deepEqual(await sealAssetIssues(payload, context), []);
  const mismatch = { ...payload, files: payload.files.map((item) => item.format === "digital" ? { ...item, checksum_sha256: "c".repeat(64) } : item) };
  assert.ok((await sealAssetIssues(mismatch, context)).some((item) => item.code === "seal_file_integrity_mismatch"));
  const duplicateFormats = { ...payload, files: [payload.files[0], { ...payload.files[1], format: "print" }] };
  assert.ok((await sealAssetIssues(duplicateFormats, context)).some((item) => item.code === "seal_formats_incomplete"));
});

test("an accreditation grant cannot pin a different or inactive seal asset version", async () => {
  const payload = {
    process_record_id: "process", process_revision: 1, decision_record_id: "decision", decision_revision: 1,
    concession_template_record_id: "template", concession_template_revision: 1,
    signed_document_record_id: null, signed_document_revision: null, seal_asset_record_id: "seal", seal_asset_revision: 2,
    seal_version: "seal-v2", valid_from: "2026-01-01", valid_until: "2027-01-01", scope: { provider_name: "A", course_name: "B", description: "C" }, condition_refs: [],
  };
  const issues = await grantIssues(payload, { resolveRecord: async () => ({ id: "seal", pluginId: "safdoulas-accreditation", kind: "seal_asset", state: "active", revision: 2, payload: { version: "seal-v1" } }) });
  assert.ok(issues.some((item) => item.code === "active_seal_asset_required"));
});

test("concession PDF fills only declared variables and marks the generated document as an unsigned draft", async () => {
  const filled = fillConcessionTemplate("# {{course_name}}\nInstituição: {{provider_name}}", ["course_name", "provider_name"], { course_name: "Curso de formação", provider_name: "Formadora" });
  assert.equal(filled, "# Curso de formação\nInstituição: Formadora");
  assert.throws(() => fillConcessionTemplate("{{unknown}}", [], {}), /não foi declarada/);
  assert.throws(() => fillConcessionTemplate("{{course_name}}", ["course_name"], {}), /dado vinculado/);
  const pdf = await renderConcessionPdf(filled);
  assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-");
});

test("public listing must match its active grant and records publication authorization", async () => {
  const payload = {
    grant_record_id: "grant", grant_revision: 1, verification_code: "SAF-DEMO-2026-0001",
    provider_name: "Other", course_name: "Curso", modality: "Presencial", description: "Escopo",
    privacy_approval_reference: "",
  };
  const issues = await publicListingIssues(payload, { resolveRecord: async () => ({
    id: "grant", pluginId: "safdoulas-accreditation", kind: "accreditation_grant", state: "active", revision: 1,
    payload: { verification_code: "SAF-DEMO-2026-0001", scope: { provider_name: "Instituição", course_name: "Curso", modality: "Presencial", description: "Escopo" } },
  }) });
  assert.deepEqual(issues.map((item) => item.code), ["public_listing_scope_mismatch", "publication_approval_required"]);
});

test("public verification returns only approved public fields and current accreditation status", () => {
  const result = publicAccreditationProjection({
    verification_code: "SAF-DEMO-2026-0001", provider_name: "Instituição", course_name: "Curso",
    modality: "Presencial", description: "Escopo público", valid_from: "2026-01-01", valid_until: "2027-01-01",
    internal_note: "não pode vazar", process_record_id: "private",
  }, "suspended", "2026-06-01", { seal_asset_record_id: "seal" });
  assert.deepEqual(result, {
    verification_code: "SAF-DEMO-2026-0001", provider_name: "Instituição", course_name: "Curso",
    modality: "Presencial", description: "Escopo público", valid_from: "2026-01-01", valid_until: "2027-01-01", status: "suspended", seal_downloads: null,
  });
});

test("only currently valid published accreditations expose the versioned seal download links", () => {
  const base = { verification_code: "SAF-DEMO-2026-0001", valid_from: "2026-01-01", valid_until: "2027-01-01" };
  const valid = publicAccreditationProjection(base, "active", "2026-06-01", { seal_asset_record_id: "seal" });
  assert.deepEqual(valid.seal_downloads, {
    print: "/public/safdoulas/accreditations/SAF-DEMO-2026-0001/seal/print",
    digital: "/public/safdoulas/accreditations/SAF-DEMO-2026-0001/seal/digital",
  });
  assert.equal(publicAccreditationProjection(base, "suspended", "2026-06-01", { seal_asset_record_id: "seal" }).seal_downloads, null);
});

test("renewal must preserve the previous course and provider and use an assigned representative", async () => {
  const records = new Map([
    ["prior", { id: "prior", pluginId: "safdoulas-accreditation", kind: "accreditation_grant", state: "active", revision: 3, payload: { process_record_id: "old-process", process_revision: 4 } }],
    ["old-process", { id: "old-process", pluginId: "safdoulas-processes", kind: "accreditation_process", state: "decision", revision: 4, payload: { course_record_id: "course-1", provider_record_id: "provider-1" } }],
    ["new-process", { id: "new-process", pluginId: "safdoulas-processes", kind: "accreditation_process", state: "submitted", revision: 1, payload: { process_type: "course_accreditation", course_record_id: "course-2", provider_record_id: "provider-1" } }],
  ]);
  const issues = await renewalRequestIssues({ previous_grant_record_id: "prior", previous_grant_revision: 3, renewal_process_record_id: "new-process", renewal_process_revision: 1 }, {
    resolveRecord: async (recordId) => records.get(recordId) || null,
    hasPermissionOnResource: async () => true,
  });
  assert.deepEqual(issues.map((item) => item.code), ["renewal_course_mismatch"]);
});

test("a post-accreditation change cannot be reopened without a related follow-up process", async () => {
  const records = new Map([
    ["grant", { id: "grant", pluginId: "safdoulas-accreditation", kind: "accreditation_grant", state: "active", revision: 1, payload: { process_record_id: "process", process_revision: 1 } }],
    ["process", { id: "process", pluginId: "safdoulas-processes", kind: "accreditation_process", state: "decision", revision: 1, payload: { course_record_id: "course", provider_record_id: "provider" } }],
  ]);
  const issues = await postAccreditationChangeIssues({ grant_record_id: "grant", grant_revision: 1, review_outcome: "reopened", review_basis: "Justificado", follow_up_process_record_id: null, follow_up_process_revision: null }, {
    resolveRecord: async (recordId) => records.get(recordId) || null,
    hasPermissionOnResource: async () => true,
  });
  assert.deepEqual(issues.map((item) => item.code), ["change_reopen_process_required"]);
});

test("condition evidence is limited to a registered condition and a representative on that process", async () => {
  const records = new Map([
    ["grant", { id: "grant", pluginId: "safdoulas-accreditation", kind: "accreditation_grant", state: "active", revision: 1, payload: { process_record_id: "process", process_revision: 1, condition_refs: [{ code: "COND-1" }] } }],
    ["process", { id: "process", pluginId: "safdoulas-processes", kind: "accreditation_process", state: "decision", revision: 1, payload: {} }],
  ]);
  const issues = await conditionFollowUpIssues({ grant_record_id: "grant", grant_revision: 1, condition_code: "OTHER" }, {
    resolveRecord: async (recordId) => records.get(recordId) || null,
    hasPermissionOnResource: async () => false,
  });
  assert.deepEqual(issues.map((item) => item.code), ["unknown_accreditation_condition", "condition_representative_scope_required"]);
});
