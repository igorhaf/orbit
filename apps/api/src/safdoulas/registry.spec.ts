import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginRegistry } from "../execution/registries";
import { genericPlugins } from "../plugins/records/catalog";
import { validate } from "../plugins/records/rules";
import { workspacesPlugin } from "../workspaces/workspaces.plugin";
import { safdoulasRegistryPlugin } from "./registry.plugin";
import { curriculumValidationIssues } from "./curriculum-validation";

test("SafDoulas course registry types register through the shared plugin records engine", () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(safdoulasRegistryPlugin);

  const registered = registry.getById("safdoulas-registry");
  assert.deepEqual(Object.keys(registered.contributions?.recordKinds || {}), [
    "education_provider",
    "course",
    "course_offering",
    "course_team_member",
    "curriculum",
    "course_certificate_model",
    "supervised_practice",
  ]);
  for (const [kind, definition] of Object.entries(registered.contributions?.recordKinds || {}))
    assert.doesNotThrow(() => validate(definition.schema, definition.example), kind);
  const kinds = registered.contributions?.recordKinds || {};
  assert.deepEqual(kinds.curriculum.schema.required, ["course_record_id", "version", "valid_from", "total_hours", "modules", "schedule", "certificate_template_record_id", "certificate_template_revision", "source_form_submission_record_id", "source_form_submission_revision", "source_form_hours_path", "evidence_documents"]);
  assert.deepEqual(kinds.curriculum.schema.properties && Object.keys(kinds.curriculum.schema.properties), ["course_record_id", "version", "valid_from", "total_hours", "modules", "schedule", "schedule_reference", "certificate_template_record_id", "certificate_template_revision", "source_form_submission_record_id", "source_form_submission_revision", "source_form_hours_path", "evidence_documents"]);
  const courseProperties = kinds.course.schema.properties as Record<string, { type?: string }>;
  const certificateProperties = kinds.course_certificate_model.schema.properties as Record<string, { minimum?: number }>;
  assert.equal(courseProperties.evaluation_methods.type, "array");
  assert.equal(certificateProperties.declared_hours.minimum, 0);
  assert.equal(registry.isEnabled("safdoulas-registry"), true);
  registry.setEnabled("privacy", false);
  assert.equal(registry.isEnabled("safdoulas-registry"), false);
  registry.setEnabled("privacy", true);
  assert.equal(registry.isEnabled("safdoulas-registry"), true);
});

test("curriculum validation compares declared, module, activity and schedule hours without fixed accreditation thresholds", async () => {
  const consistent = {
    total_hours: 8,
    modules: [{ code: "M1", hours: 8, activities: [{ activity_type: "theoretical", modality: "in_person", hours: 5 }, { activity_type: "experiential", modality: "in_person", hours: 3 }] }],
    schedule: [{ module_code: "M1", hours: 8 }],
  };
  assert.deepEqual(await curriculumValidationIssues(consistent, { resolveRecord: async () => null }), []);

  const inconsistent = {
    total_hours: 8,
    modules: [{ code: "M1", hours: 6, activities: [{ activity_type: "theoretical", modality: "in_person", hours: 5 }] }],
    schedule: [{ module_code: "M1", hours: 4 }],
  };
  assert.deepEqual(
    (await curriculumValidationIssues(inconsistent, { resolveRecord: async () => null })).map((issue) => issue.code),
    ["curriculum_total_mismatch", "module_activity_hours_mismatch", "module_schedule_hours_mismatch", "schedule_total_mismatch"],
  );

  const invalidReferences = {
    total_hours: 0,
    modules: [{ code: "M1", hours: 0 }, { code: "M1", hours: 0 }],
    schedule: [{ module_code: "UNKNOWN", hours: 0 }],
  };
  assert.deepEqual(
    (await curriculumValidationIssues(invalidReferences, { resolveRecord: async () => null })).map((issue) => issue.code),
    ["duplicate_module_code", "unknown_schedule_module"],
  );
});

test("curriculum validation resolves pinned certificate, source form and evidence documents", async () => {
  const references = new Map<string, { id: string; pluginId: string; kind: string; state: string; revision: number; payload: Record<string, unknown> }>([
    ["certificate:2", { id: "certificate", pluginId: "safdoulas-registry", kind: "course_certificate_model", state: "active", revision: 2, payload: { declared_hours: 10, document_record_id: "certificate-file", document_revision: 3 } }],
    ["certificate-file:3", { id: "certificate-file", pluginId: "documents", kind: "document", state: "received", revision: 3, payload: { file_name: "certificate.pdf" } }],
    ["application:4", { id: "application", pluginId: "forms", kind: "submission", state: "submitted", revision: 4, payload: { answers: { course: "Example", total_hours: 8 } } }],
    ["evidence:5", { id: "evidence", pluginId: "documents", kind: "document", state: "received", revision: 5, payload: { file_name: "matrix.pdf" } }],
  ]);
  const issues = await curriculumValidationIssues({
    total_hours: 8,
    modules: [],
    schedule: [],
    certificate_template_record_id: "certificate",
    certificate_template_revision: 2,
    source_form_submission_record_id: "application",
    source_form_submission_revision: 4,
    source_form_hours_path: "total_hours",
    evidence_documents: [{ record_id: "evidence", revision: 5 }],
  }, { resolveRecord: async (id, revision) => references.get(`${id}:${revision}`) || null });

  assert.deepEqual(issues.map((issue) => issue.code), ["certificate_hours_mismatch"]);
});

test("curriculum validation compares the mapped form hours without assuming form field names", async () => {
  const context = { resolveRecord: async () => ({ id: "application", pluginId: "forms", kind: "submission", state: "submitted", revision: 1, payload: { answers: { application: { declared_hours: "120,5" } } } }) };
  const base = { total_hours: 120, modules: [], schedule: [], source_form_submission_record_id: "application", source_form_submission_revision: 1, source_form_hours_path: "application.declared_hours" };
  assert.deepEqual((await curriculumValidationIssues(base, context)).map((issue) => issue.code), ["form_hours_mismatch"]);
  assert.deepEqual((await curriculumValidationIssues({ ...base, total_hours: 120.5 }, context)), []);
  assert.deepEqual((await curriculumValidationIssues({ ...base, source_form_hours_path: "missing" }, context)).map((issue) => issue.code), ["source_form_hours_unavailable"]);
});

test("formative registry records require existing links to the expected entity types", async () => {
  const kinds = safdoulasRegistryPlugin.contributions?.recordKinds || {};
  const linked = new Map([
    ["provider", { id: "provider", pluginId: "safdoulas-registry", kind: "education_provider", state: "active", revision: 3, payload: {} }],
    ["course", { id: "course", pluginId: "safdoulas-registry", kind: "course", state: "active", revision: 2, payload: { provider_record_id: "provider", modalities: ["hybrid"] } }],
    ["supervisor", { id: "supervisor", pluginId: "safdoulas-registry", kind: "course_team_member", state: "active", revision: 4, payload: { course_record_id: "other-course" } }],
    ["document", { id: "document", pluginId: "documents", kind: "document", state: "published", revision: 5, payload: {} }],
  ]);
  const context = {
    recordId: "current-provider",
    resolveRecord: async () => null,
    resolveLatestRecord: async (id: string) => linked.get(id) || null,
  };

  assert.deepEqual(await kinds.course?.validate?.({ provider_record_id: "provider" }, context), []);
  assert.equal((await kinds.course?.validate?.({ provider_record_id: "missing" }, context))?.[0].code, "linked_record_unavailable");
  assert.equal((await kinds.course?.validate?.({ provider_record_id: "document" }, context))?.[0].code, "linked_record_wrong_type");
  assert.equal((await kinds.course_offering?.validate?.({ course_record_id: "course", modality: "in_person" }, context))?.[0].code, "offering_modality_not_in_course");
  assert.equal((await kinds.education_provider?.validate?.({ relationships: [{ provider_record_id: "current-provider" }] }, context))?.[0].code, "provider_self_relationship");
  assert.equal((await kinds.supervised_practice?.validate?.({
    course_record_id: "course", supervisor_record_ids: ["supervisor"], evidence_record_ids: ["document"],
  }, context))?.some((issue) => issue.code === "supervisor_course_mismatch"), true);
});

test("provider records allow entities without CNPJ and validate registered identifiers", async () => {
  const definition = safdoulasRegistryPlugin.contributions?.recordKinds?.education_provider;
  assert.ok(definition);
  assert.deepEqual(validate(definition.schema, definition.example), undefined);
  assert.deepEqual(await definition.validate?.(definition.example, { resolveRecord: async () => null }), []);
  assert.deepEqual(await definition.validate?.({ ...definition.example, cnpj: "11.222.333/0001-81" }, { resolveRecord: async () => null }), []);
  assert.deepEqual((await definition.validate?.({ ...definition.example, cnpj: "11.222.333/0001-82" }, { resolveRecord: async () => null }))?.map((issue) => issue.code), ["invalid_provider_cnpj"]);
  assert.throws(() => validate(definition.schema, { ...definition.example, cnpj: "12.345" }), /Conteúdo inválido/);
  assert.deepEqual(definition.uniqueFields, ["cnpj"]);
});

test("course roster is an immutable list of active, version-pinned team members from that course", async () => {
  const definition = safdoulasRegistryPlugin.contributions?.recordKinds?.course;
  assert.ok(definition);
  const memberId = "00000000-0000-4000-8000-000000000030";
  const validMember = { id: memberId, pluginId: "safdoulas-registry", kind: "course_team_member", state: "active", revision: 4, payload: { course_record_id: "course-id" } };
  const context = {
    recordId: "course-id",
    resolveLatestRecord: async () => ({ id: "provider-id", pluginId: "safdoulas-registry", kind: "education_provider", state: "active", revision: 1, payload: {} }),
    resolveRecord: async (id: string, revision: number) => id === memberId && revision === 4 ? validMember : null,
  };
  const payload = { provider_record_id: "00000000-0000-4000-8000-000000000001", team_member_refs: [{ record_id: memberId, revision: 4 }] };
  assert.deepEqual(await definition.validate?.(payload, context), []);
  assert.deepEqual((await definition.validate?.({ ...payload, team_member_refs: [{ record_id: memberId, revision: 3 }] }, context))?.map((issue) => issue.code), ["invalid_course_team_member"]);
  assert.deepEqual((await definition.validate?.({ ...payload, team_member_refs: [payload.team_member_refs[0], payload.team_member_refs[0]] }, context))?.map((issue) => issue.code), ["duplicate_course_team_member"]);
});
