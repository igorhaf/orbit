import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue } from "../plugins/contract";

const uuid = { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" };
const optionalText = (maxLength = 4000) => ({ type: "string", maxLength });
const text = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
const list = (items: Record<string, unknown>, maxItems = 100) => ({ type: "array", items, maxItems });
const object = (properties: Record<string, Record<string, unknown>>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const managePermission = "plugin.safdoulas-accreditors.manage";
const conflictTypes = ["institutional", "employment", "teaching", "consulting", "family", "financial", "other"] as const;

type Profile = Record<string, unknown> & {
  user_id: string;
  profile_status: string;
  credential_number: string;
  valid_from: string;
  valid_until: string;
  ethics_term_record_id: string | null;
  ethics_term_revision: number | null;
  ethics_accepted_at: string | null;
  conflict_declaration_valid_until: string | null;
};
type Process = { pluginId: string; kind: string; payload: Record<string, unknown> };

function normalizedPersonName(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim() : "";
}

function issue(code: string, path: string, message: string): RecordValidationIssue {
  return { severity: "error", code, path, message };
}

export function accreditorProfileIssues(payload: Record<string, unknown>): RecordValidationIssue[] {
  const profile = payload as Profile;
  const issues: RecordValidationIssue[] = [];
  if ((typeof profile.ethics_term_record_id === "string") !== (typeof profile.ethics_term_revision === "number"))
    issues.push(issue("incomplete_ethics_term", "ethics_term_record_id", "Informe o termo ético e sua versão juntos."));
  if (profile.profile_status === "active") {
    if (!profile.credential_number?.trim()) issues.push(issue("credential_required", "credential_number", "A acreditadora ativa precisa de certificado ou habilitação registrada."));
    if (Date.parse(profile.valid_from) > Date.now() || Date.parse(profile.valid_until) <= Date.now())
      issues.push(issue("credential_expired", "valid_until", "A habilitação precisa estar vigente na data atual."));
    if (typeof profile.ethics_term_record_id !== "string" || !profile.ethics_accepted_at)
      issues.push(issue("ethics_acceptance_required", "ethics_term_record_id", "Registre o termo ético vigente e seu aceite antes de ativar a acreditadora."));
    if (!profile.conflict_declaration_valid_until || Date.parse(profile.conflict_declaration_valid_until) <= Date.now())
      issues.push(issue("current_conflict_declaration_required", "conflict_declaration_valid_until", "Mantenha uma declaração de vínculos e conflitos vigente antes de ativar a acreditadora."));
    if (typeof payload.training_completed_at !== "string" || !Number.isFinite(Date.parse(payload.training_completed_at))
      || Date.parse(payload.training_completed_at) > Date.now() || !String(payload.training_attestation_reference || "").trim())
      issues.push(issue("mandatory_alignment_required", "training_completed_at", "Registre a conclusão integral do alinhamento obrigatório e a referência da comprovação antes de homologar a habilitação."));
  }
  const affiliations = Array.isArray(payload.affiliations) ? payload.affiliations as Array<Record<string, unknown>> : [];
  for (const [index, affiliation] of affiliations.entries()) {
    if (typeof affiliation.provider_record_id !== "string" && typeof affiliation.course_record_id !== "string"
      && typeof affiliation.person_user_id !== "string" && typeof affiliation.person_name !== "string")
      issues.push(issue("affiliation_target_required", `affiliations[${index}]`, "Vincule a relação declarada a uma instituição, curso ou pessoa identificável."));
    if (typeof affiliation.person_name === "string" && !normalizedPersonName(affiliation.person_name))
      issues.push(issue("invalid_affiliation_person", `affiliations[${index}].person_name`, "Informe um nome válido para identificar a relação pessoal."));
    if (typeof affiliation.active_until === "string" && Date.parse(affiliation.active_until) < Date.parse(String(affiliation.active_from)))
      issues.push(issue("invalid_affiliation_period", `affiliations[${index}].active_until`, "O fim do vínculo não pode anteceder o início."));
  }
  return issues;
}

export async function eligibleAccreditorProfile(payload: Record<string, unknown>, userId: string, process: Process, context?: RecordValidationContext): Promise<boolean> {
  if (payload.user_id !== userId || payload.profile_status !== "active") return false;
  const profile = payload as Profile;
  const now = Date.now();
  if (Date.parse(profile.valid_from) > now || Date.parse(profile.valid_until) <= now) return false;
  if (!profile.credential_number?.trim() || !profile.ethics_term_record_id || !profile.ethics_term_revision || !profile.ethics_accepted_at) return false;
  if (!profile.conflict_declaration_valid_until || Date.parse(profile.conflict_declaration_valid_until) <= now) return false;
  if (typeof payload.training_completed_at !== "string" || !Number.isFinite(Date.parse(payload.training_completed_at))
    || Date.parse(payload.training_completed_at) > now || !String(payload.training_attestation_reference || "").trim()) return false;
  if (!context?.hasAcceptedTerm || !await context.hasAcceptedTerm(profile.ethics_term_record_id, profile.ethics_term_revision, userId)) return false;
  const providerId = process.payload.provider_record_id;
  const courseId = process.payload.course_record_id;
  const affiliations = Array.isArray(payload.affiliations) ? payload.affiliations as Array<Record<string, unknown>> : [];
  const directConflict = affiliations.some((item) => {
    const starts = typeof item.active_from === "string" ? Date.parse(item.active_from) : Number.NEGATIVE_INFINITY;
    const ends = typeof item.active_until === "string" ? Date.parse(item.active_until) : Number.POSITIVE_INFINITY;
    const current = starts <= now && ends > now;
    return current && (
      (typeof providerId === "string" && item.provider_record_id === providerId)
      || (typeof courseId === "string" && item.course_record_id === courseId)
    );
  });
  if (directConflict) return false;

  // The course and offering references on a process are pinned to revisions. Read those
  // snapshots so assignment checks cannot silently change when a roster is edited later.
  if (!context) return false;
  const relatedPeople = new Set<string>();
  const addPerson = (personUserId: unknown, fullName: unknown) => {
    if (typeof personUserId === "string") relatedPeople.add(`id:${personUserId}`);
    const name = normalizedPersonName(fullName);
    if (name) relatedPeople.add(`name:${name}`);
  };
  const courseRecordId = process.payload.course_record_id;
  const courseRevision = process.payload.course_revision;
  if (typeof courseRecordId === "string") {
    if (typeof courseRevision !== "number") return false;
    const course = await context.resolveRecord(courseRecordId, courseRevision);
    if (!course || course.pluginId !== "safdoulas-registry" || course.kind !== "course") return false;
    const teamRefs = Array.isArray(course.payload.team_member_refs) ? course.payload.team_member_refs as Array<{ record_id?: string; revision?: number }> : [];
    for (const reference of teamRefs) {
      if (typeof reference.record_id !== "string" || typeof reference.revision !== "number") return false;
      const member = await context.resolveRecord(reference.record_id, reference.revision);
      if (!member || member.pluginId !== "safdoulas-registry" || member.kind !== "course_team_member"
        || member.state !== "active" || member.payload.course_record_id !== course.id) return false;
      addPerson(member.payload.user_id, member.payload.full_name);
    }
  }
  const offeringId = process.payload.offering_record_id;
  const offeringRevision = process.payload.offering_revision;
  if (typeof offeringId === "string") {
    if (typeof offeringRevision !== "number") return false;
    const offering = await context.resolveRecord(offeringId, offeringRevision);
    if (!offering || offering.pluginId !== "safdoulas-registry" || offering.kind !== "course_offering"
      || offering.payload.course_record_id !== courseId) return false;
    const participants = Array.isArray(offering.payload.participant_refs) ? offering.payload.participant_refs as Array<Record<string, unknown>> : [];
    for (const participant of participants) addPerson(participant.user_id, participant.full_name);
  }
  return !affiliations.some((item) => {
    const starts = typeof item.active_from === "string" ? Date.parse(item.active_from) : Number.NEGATIVE_INFINITY;
    const ends = typeof item.active_until === "string" ? Date.parse(item.active_until) : Number.POSITIVE_INFINITY;
    if (starts > now || ends <= now) return false;
    if (typeof item.person_user_id === "string" && relatedPeople.has(`id:${item.person_user_id}`)) return true;
    const name = normalizedPersonName(item.person_name);
    return Boolean(name && relatedPeople.has(`name:${name}`));
  });
}

export async function authorizeAccreditorApplicationCreate(actorId: string, payload: Record<string, unknown>, context: RecordValidationContext): Promise<boolean> {
  if (payload.user_id !== actorId || typeof payload.source_submission_record_id !== "string" || typeof payload.source_submission_revision !== "number") return false;
  const submission = await context.resolveRecord(payload.source_submission_record_id, payload.source_submission_revision);
  return submission?.pluginId === "forms" && submission.kind === "submission" && ["submitted", "completed"].includes(submission.state)
    && Boolean(await context.isRecordOwner?.(submission.id, actorId));
}

export function authorizeAccreditorApplicationRecord(actorId: string, action: string, state: string, payload: Record<string, unknown>): boolean {
  if (payload.user_id !== actorId) return false;
  return action === "read" || state === "draft" && (action === "write" || action === "publish");
}

async function managerTransition(from: string, to: string, _payload: Record<string, unknown>, context: RecordValidationContext) {
  return from !== to && Boolean(await context.hasPermission?.(managePermission));
}

const recordKinds: Record<string, RecordKindContribution> = {
  certificate_generation: {
    label: "Geração de certificado de habilitação",
    schema: object({ profile_record_id: uuid, profile_revision: { type: "integer", minimum: 1 }, template_record_id: uuid, template_revision: { type: "integer", minimum: 1 },
      document_record_id: uuid, document_revision: { type: "integer", minimum: 1 }, generated_at: { type: "string", format: "date-time" }, status: { type: "string", enum: ["unsigned_draft"] } }),
    initial: "generated", transitions: { generated: [] }, immutable: ["generated"], serverCreated: true, resourceScoped: true, managePermission,
    example: { profile_record_id: "00000000-0000-4000-8000-000000000001", profile_revision: 1, template_record_id: "00000000-0000-4000-8000-000000000002", template_revision: 1, document_record_id: "00000000-0000-4000-8000-000000000003", document_revision: 1, generated_at: "2026-01-01T00:00:00Z", status: "unsigned_draft" },
  },
  application: {
    label: "Candidatura a acreditadora",
    schema: object({
      user_id: uuid,
      source_submission_record_id: uuid,
      source_submission_revision: { type: "integer", minimum: 1 },
      evidence_refs: list(object({ record_id: uuid, revision: { type: "integer", minimum: 1 }, purpose: text(300) }, ["record_id", "revision", "purpose"])),
      eligibility_summary: optionalText(12000),
      reviewed_by: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      decision_reason: optionalText(8000),
    }),
    initial: "draft",
    transitions: { draft: ["submitted"], submitted: ["under_review"], under_review: ["approved", "rejected"], approved: ["withdrawn"], rejected: ["withdrawn"], withdrawn: [] },
    immutable: ["approved", "rejected", "withdrawn"],
    resourceScoped: true,
    managePermission,
    authorizeRecord: authorizeAccreditorApplicationRecord,
    authorizeCreate: authorizeAccreditorApplicationCreate,
    authorizeTransition: async (from, to, payload, context) => from === "draft" && to === "submitted"
      ? context.actorId === payload.user_id || Boolean(await context.hasPermission?.(managePermission))
      : managerTransition(from, to, payload, context),
    validate: async (payload, context) => {
      const issues: RecordValidationIssue[] = [];
      const manager = await context.hasGlobalPermission?.(managePermission) || await context.hasPermission?.(managePermission) || false;
      if (context.actorId && payload.user_id !== context.actorId && !manager)
        issues.push(issue("candidate_identity_mismatch", "user_id", "A candidatura precisa pertencer à pessoa autenticada."));
      if (typeof payload.source_submission_record_id !== "string" || typeof payload.source_submission_revision !== "number")
        issues.push(issue("submitted_application_required", "source_submission_record_id", "A candidatura precisa partir de uma submissão de formulário enviada e versionada."));
      else {
        const source = await context.resolveRecord(payload.source_submission_record_id, Number(payload.source_submission_revision));
        if (!source || source.pluginId !== "forms" || source.kind !== "submission" || !["submitted", "completed"].includes(source.state))
          issues.push(issue("submitted_application_required", "source_submission_record_id", "A candidatura precisa partir de uma submissão de formulário enviada e versionada."));
        else if (context.actorId && !manager && !await context.isRecordOwner?.(source.id, context.actorId))
          issues.push(issue("candidate_submission_not_owned", "source_submission_record_id", "A pessoa candidata só pode vincular uma submissão que ela própria enviou."));
      }
      const evidence = Array.isArray(payload.evidence_refs) ? payload.evidence_refs as Array<{ record_id: string; revision: number }> : [];
      for (const [index, reference] of evidence.entries()) {
        const document = await context.resolveRecord(reference.record_id, reference.revision);
        if (!document || document.pluginId !== "documents" || document.kind !== "document")
          issues.push(issue("invalid_accreditor_evidence", `evidence_refs[${index}]`, "A evidência precisa apontar para uma versão acessível de documento."));
        else if (!manager && context.actorId && !await context.isRecordOwner?.(document.id, context.actorId))
          issues.push(issue("accreditor_evidence_not_owned", `evidence_refs[${index}]`, "A candidatura só pode anexar documentos enviados pela própria pessoa candidata."));
      }
      return issues;
    },
    example: {
      user_id: "00000000-0000-4000-8000-000000000001",
      source_submission_record_id: "00000000-0000-4000-8000-000000000002",
      source_submission_revision: 1, evidence_refs: [], eligibility_summary: "Candidatura demonstrativa.",
      reviewed_by: null, decision_reason: "",
    },
  },
  profile: {
    label: "Habilitação de acreditadora",
    schema: object({
      user_id: uuid,
      application_record_id: uuid,
      application_revision: { type: "integer", minimum: 1 },
      profile_status: { type: "string", enum: ["candidate", "active", "temporarily_inactive", "suspended", "renewing", "disconnected"] },
      credential_number: optionalText(160),
      valid_from: { type: "string", format: "date-time" },
      valid_until: { type: "string", format: "date-time" },
      region_code: { type: "string", minLength: 2, maxLength: 12 },
      expertise: list(text(240), 50),
      max_parallel_assignments: { type: "integer", minimum: 1, maximum: 100 },
      ethics_term_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
      ethics_term_revision: { type: ["integer", "null"], minimum: 1 },
      ethics_accepted_at: { type: ["string", "null"], format: "date-time" },
      conflict_declaration_valid_until: { type: ["string", "null"], format: "date-time" },
      training_completed_at: { type: ["string", "null"], format: "date-time" },
      training_attestation_reference: optionalText(2000),
      affiliations: list(object({
        provider_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
        course_record_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
        person_user_id: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" },
        person_name: { type: ["string", "null"], maxLength: 240 },
        conflict_type: { type: "string", enum: [...conflictTypes] },
        description: text(2000),
        active_from: { type: "string", format: "date" },
        active_until: { type: ["string", "null"], format: "date" },
      }, ["provider_record_id", "course_record_id", "conflict_type", "description", "active_from", "active_until"]), 200),
    }, ["user_id", "application_record_id", "application_revision", "profile_status", "credential_number", "valid_from", "valid_until", "region_code", "expertise", "max_parallel_assignments", "ethics_term_record_id", "ethics_term_revision", "ethics_accepted_at", "conflict_declaration_valid_until", "affiliations"]),
    initial: "draft",
    transitions: { draft: ["approved"], approved: ["active", "rejected"], active: ["temporarily_inactive", "suspended", "renewing", "disconnected"], temporarily_inactive: ["active", "disconnected"], renewing: ["active", "suspended", "disconnected"], suspended: ["active", "disconnected"], rejected: [], disconnected: [] },
    immutable: ["rejected", "disconnected"],
    resourceScoped: true,
    managePermission,
    uniqueFields: ["user_id"],
    detailActions: [{ id: "generate-credential", label: "Gerar minuta PDF do certificado", description: "Preenche o modelo ativo após homologação; a minuta exige assinatura institucional.",
      states: ["active"], permission: "write", path: "/safdoulas/accreditors/{recordId}/certificate-document",
      download: { recordIdField: "document_record_id", revisionField: "document_revision", fileNameField: "document_file_name", path: "/extensions/documents/records/{recordId}/files/{revision}" } }],
    authorizeRecord: (actorId, action, _state, payload) => action === "read" && actorId === payload.user_id,
    availableTransitions: (state) => recordKinds.profile.transitions[state] || [],
    authorizeTransition: managerTransition,
    prepareTransition: (_from, to, payload) => ["active", "temporarily_inactive", "suspended", "renewing", "disconnected"].includes(to)
      ? { ...payload, profile_status: to } : payload,
    validate: async (payload, context) => {
      const issues = accreditorProfileIssues(payload);
      if (payload.profile_status !== "active") return issues;
      const application = await context.resolveRecord(String(payload.application_record_id), Number(payload.application_revision));
      if (!application || application.pluginId !== "safdoulas-accreditors" || application.kind !== "application"
        || application.state !== "approved" || application.payload.user_id !== payload.user_id)
        issues.push(issue("approved_application_required", "application_record_id", "A habilitação ativa precisa vir de uma candidatura aprovada da mesma pessoa."));
      const ethics = await context.resolveRecord(String(payload.ethics_term_record_id), Number(payload.ethics_term_revision));
      if (!ethics || ethics.pluginId !== "terms" || ethics.kind !== "term" || ethics.state !== "published")
        issues.push(issue("published_ethics_term_required", "ethics_term_record_id", "A habilitação ativa precisa apontar para uma versão publicada do termo ético."));
      else if (!context.hasAcceptedTerm || !await context.hasAcceptedTerm(ethics.id, ethics.revision, String(payload.user_id)))
        issues.push(issue("verified_ethics_acceptance_required", "ethics_term_record_id", "A pessoa precisa aceitar esta versão do termo pelo fluxo de aceite registrado."));
      return issues;
    },
    example: {
      user_id: "00000000-0000-4000-8000-000000000001",
      application_record_id: "00000000-0000-4000-8000-000000000002", application_revision: 1,
      profile_status: "candidate", credential_number: "", valid_from: "2026-01-01T00:00:00.000Z", valid_until: "2027-01-01T00:00:00.000Z",
      region_code: "NE", expertise: [], max_parallel_assignments: 3, ethics_term_record_id: null, ethics_term_revision: null,
      ethics_accepted_at: null, conflict_declaration_valid_until: null, affiliations: [],
    },
  },
};

export const safdoulasAccreditorsPlugin: PluginDefinition = {
  id: "safdoulas-accreditors",
  name: "Acreditadoras SAFDOULAS",
  version: "1.0.0",
  description: "Gerencia candidaturas, habilitações, validade, capacidade, termos éticos e vínculos declarados de acreditadoras.",
  scope: "workspace",
  handlesRoute: (path) => /^\/safdoulas\/accreditors\/[a-fA-F0-9-]{36}\/certificate-document$/.test(path),
  routePermission: () => managePermission,
  dependencies: ["versioned-records", "forms", "documents", "terms", "safdoulas-registry", "safdoulas-governance", "privacy"],
  capabilities: ["read", "write", "publish", "manage"].map((action) => ({
    id: action,
    name: action === "read" ? "Consultar candidaturas e habilitações" : action === "write" ? "Preparar candidaturas e declarações" : action === "publish" ? "Habilitar acreditadoras" : "Administrar cadastro de acreditadoras",
    permissions: ["plugin.safdoulas-accreditors." + action],
  })),
  contributions: {
    navigation: [{ id: "safdoulas-accreditors", href: "/extensions/safdoulas-accreditors", label: "Acreditadoras" , permission: "plugin.safdoulas-accreditors.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "registry", "label": "Cadastros e normas", "order": 1}, order: 1}],
    recordKinds,
  },
};
