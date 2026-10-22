import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue, ResolvedRecordReference } from "../plugins/contract";
import { validCnpj } from "../plugins/common/identifiers";
import { curriculumValidationIssues } from "./curriculum-validation";
import { ownedRecordAccess } from "../plugins/records/ownership";

const text = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
const optionalText = (maxLength = 2000) => ({ type: "string", maxLength });
const uuid = { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const list = (items: Record<string, unknown> = text(500), maxItems = 200) => ({ type: "array", items, maxItems });
const object = (properties: Record<string, Record<string, unknown>>, required: string[] = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const hours = { type: "number", minimum: 0 };
const lifecycle = (states: string[], immutable: string[] = []) => ({
  initial: "draft",
  transitions: {
    draft: ["active", "archived"].filter((state) => states.includes(state)),
    active: states.includes("archived") ? ["archived"] : [],
    archived: [],
  } as Record<string, string[]>,
  immutable,
});

async function linkedRecord(
  payload: Record<string, unknown>,
  key: string,
  expectedKind: string,
  path: string,
  context: RecordValidationContext,
  issues: RecordValidationIssue[],
): Promise<ResolvedRecordReference | null> {
  const recordId = payload[key];
  if (typeof recordId !== "string") return null;
  if (!context.resolveLatestRecord) {
    issues.push({ severity: "error", code: "linked_record_validation_unavailable", path, message: "Não foi possível validar o vínculo com o cadastro relacionado." });
    return null;
  }
  const record = await context.resolveLatestRecord(recordId);
  if (!record) {
    issues.push({ severity: "error", code: "linked_record_unavailable", path, message: "O registro relacionado não existe neste espaço ou não está acessível." });
    return null;
  }
  const expectedPlugin = expectedKind === "document" ? "documents" : "safdoulas-registry";
  if (record.pluginId !== expectedPlugin || record.kind !== expectedKind) {
    issues.push({ severity: "error", code: "linked_record_wrong_type", path, message: `O vínculo deve apontar para um registro do tipo ${expectedKind}.` });
    return null;
  }
  return record;
}

async function providerIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  if (typeof payload.cnpj === "string" && payload.cnpj && !validCnpj(payload.cnpj))
    issues.push({ severity: "error", code: "invalid_provider_cnpj", path: "cnpj", message: "Informe um CNPJ válido ou deixe o campo vazio quando a entidade não possuir CNPJ." });
  const relationships = Array.isArray(payload.relationships) ? payload.relationships as Array<{ provider_record_id?: string }> : [];
  for (const [index, relationship] of relationships.entries()) {
    if (relationship.provider_record_id === context.recordId)
      issues.push({ severity: "error", code: "provider_self_relationship", path: `relationships[${index}].provider_record_id`, message: "Uma entidade formadora não pode se relacionar consigo mesma." });
    else await linkedRecord(relationship, "provider_record_id", "education_provider", `relationships[${index}].provider_record_id`, context, issues);
  }
  return issues;
}

async function courseIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  await linkedRecord(payload, "provider_record_id", "education_provider", "provider_record_id", context, issues);
  const members = Array.isArray(payload.team_member_refs) ? payload.team_member_refs as Array<{ record_id?: string; revision?: number }> : [];
  const seen = new Set<string>();
  for (const [index, reference] of members.entries()) {
    const path = `team_member_refs[${index}]`;
    if (typeof reference.record_id !== "string" || typeof reference.revision !== "number") continue;
    if (seen.has(reference.record_id)) {
      issues.push({ severity: "error", code: "duplicate_course_team_member", path, message: "Cada integrante deve aparecer uma única vez na equipe versionada do curso." });
      continue;
    }
    seen.add(reference.record_id);
    const member = await context.resolveRecord(reference.record_id, reference.revision);
    if (!member || member.pluginId !== "safdoulas-registry" || member.kind !== "course_team_member"
      || member.payload.course_record_id !== context.recordId || member.state !== "active")
      issues.push({ severity: "error", code: "invalid_course_team_member", path, message: "A equipe do curso deve referenciar integrantes ativos vinculados a este curso e a uma revisão específica." });
  }
  return issues;
}

async function courseChildIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  await linkedRecord(payload, "course_record_id", "course", "course_record_id", context, issues);
  return issues;
}

async function courseOfferingIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues: RecordValidationIssue[] = [];
  const course = await linkedRecord(payload, "course_record_id", "course", "course_record_id", context, issues);
  const modalities = course && Array.isArray(course.payload.modalities) ? course.payload.modalities : [];
  if (course && typeof payload.modality === "string" && !modalities.includes(payload.modality))
    issues.push({ severity: "error", code: "offering_modality_not_in_course", path: "modality", message: "A modalidade desta oferta precisa estar cadastrada no curso." });
  const participants = Array.isArray(payload.participant_refs) ? payload.participant_refs as Array<Record<string, unknown>> : [];
  const userIds = participants.map((item) => item.user_id).filter((id): id is string => typeof id === "string");
  if (new Set(userIds).size !== userIds.length)
    issues.push({ severity: "error", code: "duplicate_offering_participant", path: "participant_refs", message: "Cada participante autenticado deve aparecer uma única vez na oferta." });
  return issues;
}

async function courseEvidenceIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues = await courseChildIssues(payload, context);
  const evidence = Array.isArray(payload.evidence_record_ids) ? payload.evidence_record_ids as string[] : [];
  for (const [index, recordId] of evidence.entries())
    await linkedRecord({ record_id: recordId }, "record_id", "document", `evidence_record_ids[${index}]`, context, issues);
  return issues;
}

async function curriculumIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues = [...await courseChildIssues(payload, context), ...await curriculumValidationIssues(payload, context)];
  if (typeof payload.certificate_template_record_id === "string" && typeof payload.certificate_template_revision === "number") {
    const certificate = await context.resolveRecord(payload.certificate_template_record_id, payload.certificate_template_revision);
    if (certificate?.pluginId === "safdoulas-registry" && certificate.kind === "course_certificate_model"
      && certificate.payload.course_record_id !== payload.course_record_id)
      issues.push({ severity: "error", code: "curriculum_certificate_course_mismatch", path: "certificate_template_record_id", message: "A matriz e o modelo de certificado precisam pertencer ao mesmo curso." });
  }
  return issues;
}

async function certificateModelIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues = await courseChildIssues(payload, context);
  const documentId = payload.document_record_id;
  const revision = payload.document_revision;
  if (typeof documentId === "string" && typeof revision === "number") {
    const document = await context.resolveRecord(documentId, revision);
    if (!document || document.pluginId !== "documents" || document.kind !== "document")
      issues.push({ severity: "error", code: "invalid_certificate_document", path: "document_record_id", message: "O modelo deve apontar para uma versão acessível de documento do plugin Documentos." });
  }
  return issues;
}

async function supervisedPracticeIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const issues = await courseChildIssues(payload, context);
  const supervisors = Array.isArray(payload.supervisor_record_ids) ? payload.supervisor_record_ids as string[] : [];
  for (const [index, recordId] of supervisors.entries()) {
    const supervisor = await linkedRecord({ supervisor_record_id: recordId }, "supervisor_record_id", "course_team_member", `supervisor_record_ids[${index}]`, context, issues);
    if (supervisor && supervisor.payload.course_record_id !== payload.course_record_id)
      issues.push({ severity: "error", code: "supervisor_course_mismatch", path: `supervisor_record_ids[${index}]`, message: "A pessoa supervisora precisa estar vinculada ao mesmo curso da prática." });
    else if (supervisor && supervisor.payload.function !== "practice_supervisor")
      issues.push({ severity: "error", code: "invalid_practice_supervisor_role", path: `supervisor_record_ids[${index}]`, message: "A pessoa vinculada precisa estar cadastrada como supervisora de prática." });
  }
  const evidence = Array.isArray(payload.evidence_record_ids) ? payload.evidence_record_ids as string[] : [];
  for (const [index, recordId] of evidence.entries())
    await linkedRecord({ record_id: recordId }, "record_id", "document", `evidence_record_ids[${index}]`, context, issues);
  return issues;
}

const recordKinds: Record<string, RecordKindContribution> = {
  education_provider: {
    label: "Instituição, coletivo ou formadora",
    schema: object({
      provider_type: { type: "string", enum: ["institution", "collective", "independent_educator"] },
      display_name: text(300),
      registered_name: optionalText(300),
      cnpj: { type: ["string", "null"], pattern: "^([A-Za-z0-9]{12}[0-9]{2}|[A-Za-z0-9]{2}\\.[A-Za-z0-9]{3}\\.[A-Za-z0-9]{3}/[A-Za-z0-9]{4}-[0-9]{2})$" },
      state: { type: "string", minLength: 2, maxLength: 2 },
      municipality: optionalText(200),
      address: object({ street: optionalText(240), number: optionalText(40), complement: optionalText(160), district: optionalText(160), postal_code: optionalText(20), municipality: optionalText(200), state: { type: "string", minLength: 2, maxLength: 2 } }, []),
      contacts: list(object({ name: text(240), role: text(160), email: { type: "string", format: "email", maxLength: 320 }, phone: optionalText(40) }, ["name", "role", "email"]), 40),
      representatives: list(object({ name: text(240), role: text(160), email: { type: "string", format: "email", maxLength: 320 }, authorization_reference: optionalText(500) }, ["name", "role", "email"]), 40),
      relationships: list(object({ relationship_type: { type: "string", enum: ["associated_collective", "maintained_by", "partner", "other"] }, provider_record_id: uuid, description: optionalText(1000) }, ["relationship_type", "provider_record_id"]), 100),
      status: { type: "string", enum: ["active", "inactive", "under_review"] },
      privacy_notice_version: optionalText(100),
    }, ["provider_type", "display_name", "state", "contacts", "representatives", "status"]),
    ...lifecycle(["draft", "active", "archived"]),
    uniqueFields: ["cnpj"],
    validate: providerIssues,
    example: { provider_type: "collective", display_name: "Coletivo de demonstração", cnpj: null, state: "PE", contacts: [], representatives: [], status: "under_review" },
  },
  course: {
    label: "Curso submetido à acreditação",
    schema: object({
      provider_record_id: uuid,
      name: text(500),
      year_created: { type: "integer", minimum: 1900, maximum: 2200 },
      status: { type: "string", enum: ["planning", "active", "paused", "ended"] },
      description: optionalText(12000),
      objectives: list(text(2000), 50),
      teaching_conception: optionalText(12000),
      methodology: optionalText(12000),
      pedagogical_proposal: object({ problem_context: optionalText(8000), conception: optionalText(12000), objectives: list(text(1500), 50), methodology: optionalText(12000), learning_support: optionalText(12000), organization: optionalText(12000) }, []),
      student_support: optionalText(12000),
      access_criteria: list(text(2000), 50),
      entry_requirements: object({ minimum_age: { type: "integer", minimum: 0 }, minimum_education: { type: "string", enum: ["none", "elementary", "secondary", "higher"] } }, []),
      evaluation_methods: list(object({ name: text(300), description: optionalText(4000), criteria: list(text(1000), 50), evidence_required: { type: "boolean" } }, ["name", "criteria", "evidence_required"]), 100),
      certification_requirements: object({ attendance_description: optionalText(4000), minimum_performance_description: optionalText(4000), required_activities: list(text(1000), 100), final_products: list(text(1000), 100) }, []),
      minimum_live_attendance_percent: { type: "number", minimum: 0, maximum: 100 },
      accessibility_measures: list(text(2000), 100),
      communication_accessibility: list(text(2000), 100),
      affirmative_actions: list(text(2000), 100),
      scholarship_and_retention: optionalText(8000),
      modalities: { type: "array", items: { type: "string", enum: ["in_person", "hybrid", "online_synchronous", "online_asynchronous", "other"] }, minItems: 1, uniqueItems: true },
      team_member_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 } }, ["record_id", "revision"]), 200),
    }, ["provider_record_id", "name", "year_created", "status", "objectives", "access_criteria", "accessibility_measures", "affirmative_actions", "modalities"]),
    ...lifecycle(["draft", "active", "archived"]),
    validate: courseIssues,
    example: { provider_record_id: "00000000-0000-4000-8000-000000000001", name: "Formação demonstrativa", year_created: 2026, status: "planning", objectives: [], pedagogical_proposal: {}, evaluation_methods: [], certification_requirements: {}, access_criteria: [], accessibility_measures: [], communication_accessibility: [], affirmative_actions: [], modalities: ["hybrid"], team_member_refs: [] },
  },
  course_offering: {
    label: "Oferta ou turma abrangida pela acreditação",
    schema: object({
      course_record_id: uuid,
      cohort: text(160),
      year: { type: "integer", minimum: 1900, maximum: 2200 },
      municipality: text(200),
      state: { type: "string", minLength: 2, maxLength: 2 },
      modality: { type: "string", enum: ["in_person", "hybrid", "online_synchronous", "online_asynchronous", "other"] },
      starts_on: { type: "string", format: "date" },
      ends_on: { type: ["string", "null"], format: "date" },
      status: { type: "string", enum: ["planned", "enrolling", "in_progress", "completed", "cancelled"] },
      participant_refs: list(object({ user_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" }, full_name: text(240) }, ["user_id", "full_name"]), 2000),
    }),
    ...lifecycle(["draft", "active", "archived"]),
    validate: courseOfferingIssues,
    example: { course_record_id: "00000000-0000-4000-8000-000000000002", cohort: "Turma de demonstração", year: 2026, municipality: "Recife", state: "PE", modality: "hybrid", starts_on: "2026-01-01", ends_on: null, status: "planned", participant_refs: [] },
  },
  course_team_member: {
    label: "Integrante da equipe formativa",
    schema: object({
      course_record_id: uuid,
      user_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      full_name: text(240),
      function: { type: "string", enum: ["pedagogical_coordinator", "teacher", "practice_supervisor", "other"] },
      doula: { type: "boolean" },
      primary_coordinator: { type: "boolean" },
      doula_experience_years: { type: "number", minimum: 0 },
      primary_professional_area: { type: "string", enum: ["doula", "medicine", "nursing", "obstetrics", "other"] },
      profession: optionalText(200),
      education: list(text(400), 30),
      experience_summary: optionalText(8000),
      responsibilities: list(text(1000), 40),
      components: list(text(300), 100),
      evidence_record_ids: list(uuid, 100),
      active_from: { type: "string", format: "date" },
      active_until: { type: ["string", "null"], format: "date" },
    }, ["course_record_id", "full_name", "function", "doula", "education", "responsibilities", "components", "evidence_record_ids", "active_from", "active_until"]),
    ...lifecycle(["draft", "active", "archived"]),
    validate: courseEvidenceIssues,
    example: { course_record_id: "00000000-0000-4000-8000-000000000002", user_id: null, full_name: "Pessoa de demonstração", function: "teacher", doula: true, education: [], responsibilities: [], components: [], evidence_record_ids: [], active_from: "2026-01-01", active_until: null },
  },
  curriculum: {
    label: "Matriz curricular",
    schema: object({
      course_record_id: uuid,
      version: text(80),
      valid_from: { type: "string", format: "date" },
      total_hours: hours,
      modules: list(object({ code: text(80), name: text(300), axis: optionalText(200), syllabus: optionalText(12000), contents: list(text(2000), 200), hours, activities: list(object({ activity_type: { type: "string", enum: ["theoretical", "extra_activity", "experiential", "case_study", "supervised_practice", "other"] }, modality: { type: "string", enum: ["in_person", "online_synchronous", "online_asynchronous", "other"] }, hours, description: optionalText(1000) }, ["activity_type", "modality", "hours"]), 300), subjects: list(text(300), 100), scheduled_period: optionalText(200), }, ["code", "name", "hours", "contents", "activities"]), 100),
      schedule: list(object({ module_code: text(80), starts_on: { type: "string", format: "date" }, ends_on: { type: "string", format: "date" }, hours, description: optionalText(1000) }, ["module_code", "starts_on", "ends_on", "hours"]), 500),
      schedule_reference: optionalText(500),
      certificate_template_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      certificate_template_revision: { type: ["integer", "null"], minimum: 1 },
      source_form_submission_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      source_form_submission_revision: { type: ["integer", "null"], minimum: 1 },
      source_form_hours_path: { type: ["string", "null"], maxLength: 300 },
      evidence_documents: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 }, purpose: optionalText(300) }, ["record_id", "revision"]), 100),
    }, ["course_record_id", "version", "valid_from", "total_hours", "modules", "schedule", "certificate_template_record_id", "certificate_template_revision", "source_form_submission_record_id", "source_form_submission_revision", "source_form_hours_path", "evidence_documents"]),
    ...lifecycle(["draft", "active", "archived"], ["active", "archived"]),
    validate: curriculumIssues,
    example: { course_record_id: "00000000-0000-4000-8000-000000000002", version: "1.0-demo", valid_from: "2026-01-01", total_hours: 0, modules: [], schedule: [], certificate_template_record_id: null, certificate_template_revision: null, source_form_submission_record_id: null, source_form_submission_revision: null, source_form_hours_path: null, evidence_documents: [] },
  },
  course_certificate_model: {
    label: "Modelo de certificado do curso",
    schema: object({
      course_record_id: uuid,
      version: text(80),
      document_record_id: uuid,
      document_revision: { type: "integer", minimum: 1 },
      declared_hours: hours,
      required_fields: list(text(120), 100),
      notes: optionalText(8000),
    }, ["course_record_id", "version", "document_record_id", "document_revision", "declared_hours", "required_fields"]),
    ...lifecycle(["draft", "active", "archived"], ["active", "archived"]),
    validate: certificateModelIssues,
    example: { course_record_id: "00000000-0000-4000-8000-000000000002", version: "1.0-demo", document_record_id: "00000000-0000-4000-8000-000000000003", document_revision: 1, declared_hours: 0, required_fields: [], notes: "Modelo demonstrativo; substituir pelo documento vigente." },
  },
  supervised_practice: {
    label: "Descrição das práticas para análise documental",
    schema: object({
      course_record_id: uuid,
      practice_type: { type: "string", enum: ["experiential", "supervised"] },
      description: text(4000),
      hours: { type: "number", minimum: 0 },
      modality: { type: "string", enum: ["in_person", "remote", "mixed"] },
      supervisor_record_ids: list(uuid, 50),
      report_required: { type: "boolean" },
      evidence_record_ids: list(uuid, 100),
      ethical_limits: optionalText(8000),
    }, ["course_record_id", "practice_type", "description", "hours", "modality", "supervisor_record_ids", "report_required", "evidence_record_ids"]),
    ...lifecycle(["draft", "active", "archived"]),
    validate: supervisedPracticeIssues,
    example: { course_record_id: "00000000-0000-4000-8000-000000000002", practice_type: "supervised", description: "Prática demonstrativa", hours: 0, modality: "in_person", supervisor_record_ids: [], report_required: true, evidence_record_ids: [], ethical_limits: "" },
  },
};

for (const definition of Object.values(recordKinds)) Object.assign(definition, {
  resourceScoped: true,
  managePermission: "plugin.safdoulas-registry.manage",
  authorizeRecord: ownedRecordAccess("safdoulas-registry"),
});

export const safdoulasRegistryPlugin: PluginDefinition = {
  id: "safdoulas-registry",
  name: "Cadastro para acreditação SAFDOULAS",
  version: "1.0.0",
  description: "Dados e evidências de instituições, cursos, ofertas, equipes e propostas curriculares submetidos à acreditação; o cadastro não oferece aulas nem acompanha a aprendizagem das estudantes.",
  scope: "workspace",
  dependencies: ["versioned-records", "forms", "documents", "privacy"],
  capabilities: ["read", "write", "publish"].map((action) => ({
    id: action,
    name: action === "read" ? "Consultar cadastro formativo" : action === "write" ? "Revisar cadastro formativo" : "Ativar cadastro formativo",
    permissions: [`plugin.safdoulas-registry.${action}`],
  })),
  contributions: {
    navigation: [{ id: "safdoulas-registry", href: "/extensions/safdoulas-registry", label: "Cadastro formativo" , permission: "plugin.safdoulas-registry.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "registry", "label": "Cadastros e normas", "order": 1}, order: 0}],
    recordKinds,
  },
};
