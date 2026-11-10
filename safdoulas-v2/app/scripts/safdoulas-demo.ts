import {recordCardsPlugin} from "../apps/api/src/plugins/record-cards/record-cards.plugin";
import { structuredViewPlugin } from "../apps/api/src/plugins/board-views/board-view.plugins";
import { processBoardPlugin } from "../apps/api/src/plugins/process-board/process-board.plugin";
import "reflect-metadata";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Db } from "../apps/api/src/db";
import { AccessService } from "../apps/api/src/access/access";
import { PluginRegistry } from "../apps/api/src/execution/registries";
import { workspacesPlugin, WorkspacesService } from "../apps/api/src/workspaces/workspaces.plugin";
import { genericPlugins } from "../apps/api/src/plugins/records/catalog";
import { ExtensionRecords, type ExtensionRecord } from "../apps/api/src/plugins/records/records.service";
import { DocumentScanner } from "../apps/api/src/plugins/records/documents";
import { safdoulasPlugins } from "../apps/api/src/safdoulas/suite";
import { safdoulasReferenceData } from "../apps/api/src/safdoulas/reference-data";
import { bootstrapSafdoulas } from "../apps/api/src/safdoulas/bootstrap";
import { SafdoulasCaseworkController } from "../apps/api/src/safdoulas/casework.plugin";
import { SafdoulasAccreditorCertificateController } from "../apps/api/src/safdoulas/accreditor-certificate";
import { migrateVersions } from "../apps/api/src/migrations";

const people = [
  ["admin", "Helena Duarte", "administrator", "Administração técnica", "Administra usuários e privilégios; não é root e não substitui a governança institucional."],
  ["governanca", "Marina Albuquerque", "safdoulas_federation_governance", "Governança FENADOULASBR", "Mantém editais, artigos/referências normativas, políticas, formulários, matrizes e modelos; habilita acreditadoras e gerencia a acreditação."],
  ["diretoria", "Lívia Nascimento", "safdoulas_directorate", "Diretoria", "Delibera, vota e ratifica decisões, consulta processos e relatórios; não administra usuários."],
  ["gt", "Beatriz Campos", "safdoulas_workgroup", "Grupo de Trabalho", "Confere documentação, prepara cegamento, acompanha complementações e organiza a avaliação; não concede privilégios."],
  ["acreditadora", "Ana Luísa Ferreira", "safdoulas_accreditor", "Acreditadora", "Avalia somente processos atribuídos com documentos cegados; não vê originais nem parecer alheio antes da consolidação."],
  ["acreditadora2", "Carolina Mendes", "safdoulas_accreditor", "Segunda acreditadora", "Segunda análise independente do exemplo concluído, com os mesmos limites da primeira acreditadora."],
  ["candidata", "Camila Rocha", "safdoulas_accreditor_candidate", "Candidata a acreditadora", "Preenche sua candidatura, envia comprovantes e aceita termos; não avalia até ser habilitada."],
  ["instituicao", "Renata Oliveira", "safdoulas_institution", "Instituição ou formadora", "Mantém seus cadastros e prepara/envia suas solicitações; acompanha apenas seus processos."],
  ["representante", "Paula Ribeiro", "safdoulas_institution_representative", "Representante institucional", "Atua nos processos da formadora, envia complementações e acompanha decisão e concessão."],
  ["observador", "Juliana Costa", "safdoulas_observer", "Observador", "Consulta apenas o andamento expressamente compartilhado; não altera dados nem acessa documentos privados."],
  ["publico", "Fernanda Lima", "safdoulas_public_user", "Usuário público", "Sem workspace ou registros internos; somente consulta pública permitida pelo portal."],
] as const;

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL || "").pathname, "/safdoulas", "Preparação exclusiva da instância SafDoulas.");
  const directory = process.argv[2], reportDir = resolve(process.argv[3] || "../data/reports");
  assert.ok(directory, "Informe a pasta dos documentos originais.");
  await mkdir(reportDir, { recursive: true, mode: 0o700 });
  const credentialFile = join(reportDir, "safdoulas-demo-credentials.json");
  let saved: Record<string, { id: string; email: string; password: string }> = {};
  try { saved = JSON.parse(await readFile(credentialFile, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const db = new Db();
  try {
    await migrateVersions(db.pool);
    const root = (await db.one<{ id: string; email: string }>("SELECT id,email FROM users WHERE is_root=true AND NOT disabled ORDER BY created_at LIMIT 1"))!;
    assert.ok(root, "A conta root original deve existir.");
    const registry = new PluginRegistry();
    for (const plugin of [workspacesPlugin, structuredViewPlugin, processBoardPlugin, recordCardsPlugin, ...genericPlugins, ...safdoulasPlugins]) registry.register(plugin);
    const access = new AccessService(db); access.registerPlugins(registry.list()); access.bindPlugins(registry.list());
    const spaces = new WorkspacesService(db, access); spaces.onModuleInit();
    const workspace = (await db.one<{ id: string }>("SELECT id FROM workspaces WHERE name='SafDoulas — Acreditação' AND archived_at IS NULL"))!;
    assert.ok(workspace, "Execute safdoulas-prepare.ts antes da demonstração.");
    const records = new ExtensionRecords(db, access, registry, new DocumentScanner()); records.onModuleInit();
    const sources = await Promise.all(safdoulasReferenceData.sources.map(async source => ({ file_name: source.file_name, data: await readFile(join(directory, source.file_name)) })));
    const setup = await bootstrapSafdoulas(db, records, workspace.id, root.id, sources);
    const ruleRecord = (await db.one<ExtensionRecord>("SELECT * FROM extension_records WHERE id=$1", [setup.records.ruleset.id]))!;
    for (const [key, name, role, position, purpose] of people) {
      const email = `${key}@demo.safdoulas.test`;
      const prior = await db.one<{id:string}>("SELECT id FROM users WHERE email=$1", [email]);
      if (prior && !saved[key]) throw new Error(`Conta pré-existente sem manifesto privado: ${email}`);
      if (!prior) {
        const password = `Saf!${randomBytes(12).toString("base64url")}`;
        const user = await access.createUser(root.id, { name, email, password, roles: [role] });
        saved[key] = { id: user.id, email, password };
        await writeFile(credentialFile, JSON.stringify(saved, null, 2), { mode: 0o600 }); await chmod(credentialFile, 0o600);
      }
      await db.query("UPDATE users SET preferences=preferences || $2::jsonb WHERE id=$1", [saved[key].id, JSON.stringify({ safdoulas_demo: { full_name: name, role: position, biography: purpose, municipality: "Recife", state: "PE", country: "Brasil", fictional: true } })]);
      if (key !== "publico") await db.query("INSERT INTO workspace_members(workspace_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [workspace.id, saved[key].id]);
    }
    const actors = [root.id, saved.governanca.id];
    const evaluators = [saved.acreditadora.id, saved.acreditadora2.id];
    let prefix = "[DEMO 03 — Concluído]";
    const definition = (plugin: string, kind: string) => registry.getById(plugin).contributions!.recordKinds![kind];
    const create = async (plugin: string, kind: string, payload: Record<string, unknown>, actor = actors[0]) => {
      const title = `${prefix} ${definition(plugin, kind).label} · ${actor === root.id ? "gestão" : (await access.account(actor)).name}`;
      return await db.one<ExtensionRecord>("SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 AND kind=$3 AND title=$4", [workspace.id, plugin, kind, title]) || records.create(plugin, workspace.id, actor, { kind, title, payload, operation_key: randomUUID() });
    };
    const transition = async (record: ExtensionRecord, state: string, actor = actors[0]) => {
      record = (await db.one<ExtensionRecord>("SELECT * FROM extension_records WHERE id=$1", [record.id]))!;
      if (record.state === state) return record;
      if (record.plugin_id === "safdoulas-processes") {
        const order = ["draft", "submitted", "triage", "review", "deliberation", "decision"];
        if (order.indexOf(record.state) > order.indexOf(state)) return record;
      } else if (record.kind === "case_communication") {
        if (["draft", "queued", "sent", "delivered", "acknowledged"].indexOf(record.state) > ["draft", "queued", "sent", "delivered", "acknowledged"].indexOf(state)) return record;
      } else {
        const edges = definition(record.plugin_id, record.kind).transitions || {};
        const seen = new Set<string>();
        const reachable = (from: string): boolean => { if (from === record.state) return true; if (seen.has(from)) return false; seen.add(from); return (edges[from] || []).some(reachable); };
        if (reachable(state)) return record;
      }
      return records.transition(record.plugin_id, record.id, actor, { state, expected_revision: record.revision, reason: "Preparação de demonstração solicitada: caso fictício, sem validade institucional.", operation_key: randomUUID() });
    };
    const revise = async (record: ExtensionRecord, patch: Record<string, unknown>) => {
      record = (await db.one<ExtensionRecord>("SELECT * FROM extension_records WHERE id=$1", [record.id]))!;
      if (Object.entries(patch).every(([key, value]) => isDeepStrictEqual(record.payload[key], value))) return record;
      return records.version(record.plugin_id, record.id, actors[0], { title: record.title, payload: { ...record.payload, ...patch }, expected_revision: record.revision, reason: "Vincular evidências preservadas da demonstração", operation_key: randomUUID() });
    };
    const upload = async (title: string, body: string, source?: ExtensionRecord) => {
      const recordTitle = `${prefix} ${title}`;
      const document = await db.one<ExtensionRecord>("SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id='documents' AND title=$2", [workspace.id, recordTitle]) || await records.upload(workspace.id, actors[0], {
        title: recordTitle, file_name: title + ".txt", mime_type: "text/plain", data_base64: Buffer.from(body).toString("base64"), variant: source ? "anonymized" : "original", ...(source ? { source_id: source.id, source_revision: source.revision } : {}), operation_key: randomUUID(),
      });
      await shareRecord(saved.governanca.id, "safdoulas_federation_governance", document);
      return document;
    };
    const shareRecord = async (user: string, role: string, record: ExtensionRecord) => {
      if (!definition(record.plugin_id, record.kind).resourceScoped) return;
      const roles = (await access.grants(user, "extension_record", record.id)).map(item => item.role_id);
      if (!roles.includes(role)) await access.assignScopedRoles(root.id, user, "extension_record", record.id, [...roles, role]);
    };
    const makeCase = async (code: string, name: string, state: "draft" | "review" | "closed") => {
      prefix = code;
      const original = await transition(await upload("Dossiê pedagógico fictício", `DEMO — ${name}. Formadora fictícia em Recife/PE. Proposta de 180 horas, 40 de prática supervisionada e 94 síncronas. Uso exclusivo para teste de acreditação; não oferece aulas, matrícula ou autorização MEC.`), "published");
      const provider = await transition(await create("safdoulas-registry", "education_provider", { ...definition("safdoulas-registry", "education_provider").example,
        display_name: name, registered_name: `${name} — coletivo fictício`, municipality: "Recife", status: "active", address: { municipality: "Recife", state: "PE" },
        contacts: [{ name: "Renata Oliveira", role: "Responsável institucional", email: saved.instituicao.email }], representatives: [{ name: "Paula Ribeiro", role: "Representante autorizada", email: saved.representante.email, authorization_reference: "Autorização fictícia da demonstração" }] }), "active");
      let course = await create("safdoulas-registry", "course", { ...definition("safdoulas-registry", "course").example, provider_record_id: provider.id, name: `Formação em Doulagem — ${name}`, status: "active", description: "Curso declarado exclusivamente para avaliação de acreditação; não é ambiente de aulas.", minimum_live_attendance_percent: 75, entry_requirements: { minimum_age: 18, minimum_education: "secondary" }, objectives: ["Cuidado respeitoso e baseado em evidências", "Atuação ética e não clínica da doula"], access_criteria: ["18 anos e ensino médio"], accessibility_measures: ["Materiais acessíveis e acolhimento de necessidades individuais"], affirmative_actions: ["Política demonstrativa de bolsas e permanência"] });
      const members: ExtensionRecord[] = [];
      for (const [functionName, fullName] of [["pedagogical_coordinator", "Luciana Barros"], ["teacher", "Teresa Martins"]]) {
        const previousPrefix = prefix; prefix += ` ${functionName}`;
        members.push(await transition(await create("safdoulas-registry", "course_team_member", { ...definition("safdoulas-registry", "course_team_member").example, course_record_id: course.id, full_name: fullName, function: functionName, doula: true, primary_coordinator: functionName === "pedagogical_coordinator", doula_experience_years: 6, primary_professional_area: "doula", education: ["Formação em doulagem — demonstração"], responsibilities: ["Planejamento e acompanhamento pedagógico"], components: ["Ética e cuidado perinatal"], evidence_record_ids: [original.id] }), "active")); prefix = previousPrefix;
      }
      if (course.state === "draft") course = await transition(await revise(course, { team_member_refs: members.map(member => ({ record_id: member.id, revision: member.revision })) }), "active");
      const curriculum = await transition(await create("safdoulas-registry", "curriculum", { ...definition("safdoulas-registry", "curriculum").example, course_record_id: course.id, total_hours: 180,
        modules: [{ code: "M1", name: "Ética e fundamentos do cuidado", hours: 94, contents: ["Direitos, evidências e atuação da doula"], activities: [{ activity_type: "theoretical", modality: "online_synchronous", hours: 94 }] },
          { code: "M2", name: "Estudos e análise de casos", hours: 46, contents: ["Estudos dirigidos e produção reflexiva"], activities: [{ activity_type: "case_study", modality: "online_asynchronous", hours: 46 }] },
          { code: "M3", name: "Prática supervisionada", hours: 40, contents: ["Observação e cuidado supervisionado"], activities: [{ activity_type: "supervised_practice", modality: "in_person", hours: 40 }] }] }), "active");
      const form = setup.records.course_form;
      let application = await create("forms", "submission", { form_id: form.id, form_revision: form.revision, answers: { responsible_name: "Paula Ribeiro", responsible_email: saved.representante.email, responsible_role: "Representante autorizada", provider_record_id: provider.id, provider_revision: provider.revision, course_record_id: course.id, course_revision: course.revision, curriculum_record_id: curriculum.id, curriculum_revision: curriculum.revision, declared_hours: 180, modality: "hybrid", document_refs: [{ record_id: original.id, revision: original.revision, purpose: "Proposta pedagógica, equipe e documentos demonstrativos" }], edital_read: true, information_true: true, privacy_accepted: true, rules_accepted: true, observations: "Dados integralmente fictícios; nenhum curso real é acreditado por este exemplo." } });
      if (state !== "draft") application = await transition(application, "submitted");
      let process = await create("safdoulas-processes", "accreditation_process", { ...definition("safdoulas-processes", "accreditation_process").example, ruleset_record_id: setup.records.ruleset.id, ruleset_revision: setup.records.ruleset.revision, provider_record_id: provider.id, provider_revision: provider.revision, course_record_id: course.id, course_revision: course.revision, curriculum_record_id: curriculum.id, curriculum_revision: curriculum.revision, application_submission_record_id: state === "draft" ? null : application.id, application_submission_revision: state === "draft" ? null : application.revision, blinding_policy_record_id: setup.records.blinding_policy.id, blinding_policy_revision: setup.records.blinding_policy.revision, document_snapshots: [{ record_id: original.id, revision: original.revision }] });
      if (state === "review") {
        process = await transition(await transition(process, "submitted"), "triage");
        const requirements = ruleRecord.payload.admission_requirements as Array<{code:string}>;
        const triage = await transition(await create("safdoulas-triage", "admissibility_review", { process_record_id: process.id, process_revision: process.revision, ruleset_record_id: setup.records.ruleset.id, ruleset_revision: setup.records.ruleset.revision, findings: requirements.map(item => ({ requirement_code: item.code, outcome: "met", evidence: [{ record_id: original.id, revision: original.revision }] })), recommendation: "admissible", rationale: "Conferência demonstrativa concluída; aguardando preparação e distribuição de avaliação." }), "completed");
        process = await transition(await revise(process, { triage_review_record_id: triage.id, triage_review_revision: triage.revision }), "review");
      }
      return { process, provider, course, curriculum, application, original };
    };
    const pending = await makeCase("[DEMO 01 — Não iniciado]", "Raízes do Cuidado", "draft"); console.log("Exemplo 01 preparado.");
    const underway = await makeCase("[DEMO 02 — Em andamento]", "Caminhos do Nascer", "review"); console.log("Exemplo 02 preparado.");
    const completed = await makeCase("[DEMO 03 — Concluído]", "Rede Acolher", "closed");
    const submissionFor = async (actor: string) => {
      const account = await access.account(actor);
      const previous = prefix; prefix += ` candidatura ${actor}`;
      const submitted = await transition(await create("forms", "submission", { form_id: setup.records.accreditor_form.id, form_revision: setup.records.accreditor_form.revision, answers: { full_name: account.name, cpf: "00000000000", email: account.email, phone: "Contato fictício — não telefonar", state: "PE", municipality: "Recife", association: "Rede demonstrativa de doulas", doula_experience_years: 6, training_hours: 180, experience_summary: "Atuação e avaliação pedagógica simuladas para teste", availability: "Duas análises mensais na demonstração", affiliations: "Nenhum vínculo com as três formadoras fictícias", conflicts: "Sem conflito declarado para estes exemplos fictícios", evidence_refs: [{ record_id: completed.original.id, revision: completed.original.revision, purpose: "Comprovação fictícia de simulação" }], information_true: true, regulation_read: true, ethics_commitment: true, training_commitment: true } }), "submitted");
      prefix = previous; return submitted;
    };
    const original = completed.original;
    const provider = completed.provider;
    const course = completed.course;
    const curriculum = completed.curriculum;
    const application = completed.application;
    let process = completed.process;
    process = await transition(process, "submitted"); assert.match(String(process.payload.protocol_number), /^SAF-\d{4}\/\d{4,}$/);
    process = await transition(process, "triage");
    const ruleSnapshot = await records.versionSnapshot("safdoulas-governance", setup.records.ruleset.id, setup.records.ruleset.revision, actors[0]);
    const requirements = ruleSnapshot.payload.admission_requirements as Array<{ code: string }>;
    const triage = await transition(await create("safdoulas-triage", "admissibility_review", {
      process_record_id: process.id, process_revision: process.revision, ruleset_record_id: setup.records.ruleset.id, ruleset_revision: setup.records.ruleset.revision,
      findings: requirements.map((item) => ({ requirement_code: item.code, outcome: "met", evidence: [{ record_id: original.id, revision: original.revision }] })), recommendation: "admissible", rationale: "Documentos conferidos neste cenário demonstrativo",
    }), "completed");
    process = await transition(await revise(process, { triage_review_record_id: triage.id, triage_review_revision: triage.revision }), "review");
    let copy = await upload("Dossiê cegado", "Coded institution. Curriculum, professional experience and educational evidence remain available.", original);
    const review = await transition(await create("documents", "review", { document_id: copy.id, document_revision: copy.revision, decision: "approved",
      checks: Object.fromEntries(["person_name", "institution_name", "cnpj", "contact", "visual_identity", "file_metadata"].map((code) => [code, true])), reason: "Independent review of every configured redaction category" }, actors[1]), "published", actors[1]);
    copy = await transition(copy, "published");
    const projection = await transition(await create("safdoulas-blinding", "blinded_projection", {
      process_record_id: process.id, process_revision: process.revision, original_document_record_id: original.id, original_document_revision: original.revision,
      blinded_document_record_id: copy.id, blinded_document_revision: copy.revision, document_review_record_id: review.id, document_review_revision: review.revision,
      blinding_policy_record_id: setup.records.blinding_policy.id, blinding_policy_revision: setup.records.blinding_policy.revision, reviewer_note: "Original preserved; independent review kept",
    }), "verified");
    const ethics = await transition(await create("terms", "term", { content: "Commitment to ethics, secrecy and impartiality", source_reference: "Supplied ethical commitment" }), "published");
    const profiles: ExtensionRecord[] = [];
    for (const actor of evaluators) {
      prefix = `[DEMO 03 — Concluído] habilitação ${actor}`;
      await records.accept(ethics.id, actor, { revision: ethics.revision, accepted: true, operation_key: randomUUID() });
      const candidateForm = await submissionFor(actor);
      let candidate = await create("safdoulas-accreditors", "application", {
        ...definition("safdoulas-accreditors", "application").example, user_id: actor, source_submission_record_id: candidateForm.id, source_submission_revision: candidateForm.revision,
      });
      for (const state of ["submitted", "under_review", "approved"]) candidate = await transition(candidate, state);
      let profile = await create("safdoulas-accreditors", "profile", {
        ...definition("safdoulas-accreditors", "profile").example, user_id: actor, region_code: "PE", expertise: ["Doulagem", "Avaliação pedagógica"], application_record_id: candidate.id, application_revision: candidate.revision,
        credential_number: `DEMO-ACC-${actor.slice(0,8)}`, valid_from: "2026-10-21T00:00:00Z", valid_until: "2028-10-21T00:00:00Z",
        ethics_term_record_id: ethics.id, ethics_term_revision: ethics.revision, ethics_accepted_at: "2026-01-01T00:00:00Z", conflict_declaration_valid_until: "2028-10-21T00:00:00Z",
        training_completed_at: "2026-01-01T00:00:00Z", training_attestation_reference: "Registro demonstrativo de participação no alinhamento", affiliations: [],
      });
      profile = await transition(await transition(profile, "approved"), "active"); profiles.push(profile);
    }
    prefix = "[DEMO 03 — Concluído]";
    const priorCertificate = await db.one<ExtensionRecord>("SELECT * FROM extension_records WHERE plugin_id='safdoulas-accreditors' AND kind='certificate_generation' AND payload->>'profile_record_id'=$1 ORDER BY created_at DESC LIMIT 1", [profiles[0].id]);
    const certificate = priorCertificate ? priorCertificate.payload as { document_record_id:string; document_revision:number } : await new SafdoulasAccreditorCertificateController(records, access, registry).generate({ orbitActor: actors[0] } as never, profiles[0].id);
    const certificateFile = await records.download(certificate.document_record_id, certificate.document_revision, actors[0]);
    assert.equal(certificateFile.data.subarray(0, 5).toString(), "%PDF-");
    const assignment = await transition(await create("safdoulas-assessments", "evaluation_assignment", {
      ...definition("safdoulas-assessments", "evaluation_assignment").example, process_record_id: process.id, process_revision: process.revision,
      matrix_record_id: setup.records.matrix.id, matrix_revision: setup.records.matrix.revision,
      blinded_projection_refs: [{ record_id: projection.id, revision: projection.revision }], evaluator_user_ids: evaluators,
      evaluator_profile_refs: profiles.map((profile, index) => ({ user_id: evaluators[index], record_id: profile.id, revision: profile.revision })),
    }), "assigned");
    const evaluations: ExtensionRecord[] = [];
    for (const actor of evaluators) evaluations.push(await transition(await create("safdoulas-assessments", "individual_evaluation", {
      ...definition("safdoulas-assessments", "individual_evaluation").example,
      assignment_record_id: assignment.id, assignment_revision: assignment.revision, process_record_id: process.id, process_revision: process.revision,
      matrix_record_id: setup.records.matrix.id, matrix_revision: setup.records.matrix.revision,
      evaluator_user_id: actor, evaluation_role: actor === evaluators[0] ? "first" : "second",
      answers: safdoulasReferenceData.matrix.dimensions.flatMap((dimension) => dimension.criteria.map((criterion) => ({ criterion_code: criterion.code, outcome: "A", justification: "Evidência demonstrativa examinada neste critério; resultado fictício para testar a jornada", evidence: [{ record_id: copy.id, revision: copy.revision }] }))),
    }, actor), "submitted", actor));
    await assert.rejects(() => records.detail("documents", original.id, evaluators[0]), /autorizado/);
    await assert.rejects(() => records.detail("safdoulas-assessments", evaluations[1].id, evaluators[0]), /autorizado/);
    const consolidation = await transition(await create("safdoulas-assessments", "evaluation_consolidation", {
      ...definition("safdoulas-assessments", "evaluation_consolidation").example,
      process_record_id: process.id, process_revision: process.revision, matrix_record_id: setup.records.matrix.id, matrix_revision: setup.records.matrix.revision,
      first_evaluation_record_id: evaluations[0].id, first_evaluation_revision: evaluations[0].revision,
      second_evaluation_record_id: evaluations[1].id, second_evaluation_revision: evaluations[1].revision, divergences: [],
    }), "completed");
    process = await transition(await revise(process, { evaluation_consolidation_record_id: consolidation.id, evaluation_consolidation_revision: consolidation.revision }), "deliberation");
    let decision = await create("safdoulas-decisions", "institutional_decision", {
      ...definition("safdoulas-decisions", "institutional_decision").example,
      process_record_id: process.id, process_revision: process.revision, evaluation_consolidation_record_id: consolidation.id, evaluation_consolidation_revision: consolidation.revision,
      decision_policy_record_id: setup.records.decision_policy.id, decision_policy_revision: setup.records.decision_policy.revision,
      outcome: "approved", vote_refs: [], signatory_user_ids: actors,
    });
    const voters = [saved.governanca.id, saved.diretoria.id];
    for (const key of ["governanca", "diretoria"] as const) {
      await shareRecord(saved[key].id, people.find(person => person[0] === key)![2], process);
      await shareRecord(saved[key].id, people.find(person => person[0] === key)![2], decision);
    }
    const votes = [];
    for (const actor of voters) votes.push(await transition(await create("safdoulas-decisions", "deliberation_vote", {
      decision_record_id: decision.id, decision_revision: decision.revision, process_record_id: process.id, voter_user_id: actor, position: "approve", rationale: "Voto colegiado independente no processo fictício", voted_at: null,
    }, actor), "submitted", actor));
    decision = await transition(await revise(decision, { signatory_user_ids: voters, vote_refs: votes.map((vote) => ({ record_id: vote.id, revision: vote.revision })) }), "ratified");
    process = await transition(await revise(process, { institutional_decision_record_id: decision.id, institutional_decision_revision: decision.revision }), "decision");
    const signed = await transition(await upload("Concessão SIMULADA — sem validade institucional", "DEMONSTRAÇÃO FICTÍCIA. Simulação de documento assinado exclusivamente para teste; não há assinatura real nem acreditação oficial."), "published");
    const sealManual = await db.one<ExtensionRecord>("SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id='safdoulas-governance' AND payload->>'category'='manual_selo'", [workspace.id]);
    const demoSeal = await transition(await upload("Selo SIMULADO — sem validade institucional", "DEMO — recurso gráfico ilustrativo, não é o selo oficial FENADOULASBR."), "published");
    const seal = await transition(await transition(await create("safdoulas-accreditation", "seal_asset", {
      version: "isolated-demo", files: ["print", "digital"].map((format) => ({ format, document_record_id: demoSeal.id, document_revision: demoSeal.revision, checksum_sha256: demoSeal.payload.sha256 })),
      manual_record_id: sealManual!.id, manual_revision: sealManual!.revision, approval_reference: "Demo only", approved_at: new Date().toISOString(),
    }), "approved"), "active");
    const grant = await transition(await create("safdoulas-accreditation", "accreditation_grant", {
      ...definition("safdoulas-accreditation", "accreditation_grant").example,
      process_record_id: process.id, process_revision: process.revision, decision_record_id: decision.id, decision_revision: decision.revision,
      concession_template_record_id: setup.records.concession_template.id, concession_template_revision: setup.records.concession_template.revision,
      signed_document_record_id: signed.id, signed_document_revision: signed.revision,
      seal_asset_record_id: seal.id, seal_asset_revision: seal.revision, seal_version: "isolated-demo",
      scope: { provider_name: provider.payload.display_name, course_name: course.payload.name, modality: "hybrid", description: "Somente o curso e a oferta declarados no processo fictício", offering_codes: [] },
      valid_from: "2026-10-21", valid_until: "2028-10-21", condition_refs: [],
    }), "active");
    assert.match(String(grant.payload.verification_code), /^SAF-[A-F0-9]{32}$/);
    for (const key of ["instituicao", "representante"] as const) {
      const role = people.find(person => person[0] === key)![2];
      for (const item of [grant, signed, demoSeal, seal]) await shareRecord(saved[key].id, role, item);
    }
    const receiptTitle = "[DEMO 03 — Concluído] Comprovante SIMULADO de entrega no portal";
    const receiptDraft = await db.one<ExtensionRecord>("SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id='documents' AND title=$2", [workspace.id, receiptTitle]) || await records.upload(workspace.id, root.id, {
      title: receiptTitle, file_name: "comprovante-demo.txt", mime_type: "text/plain", data_base64: Buffer.from("SIMULAÇÃO de entrega no portal às contas de demonstração; sem envio externo ou efeito institucional.").toString("base64"), variant: "original", related_record_id: process.id, related_record_revision: process.revision, operation_key: randomUUID(),
    });
    const receipt = await transition(receiptDraft, "published");
    const communication = await create("safdoulas-diligences", "case_communication", {
      ...definition("safdoulas-diligences", "case_communication").example, process_record_id: process.id, process_revision: process.revision,
      decision_record_id: decision.id, decision_revision: decision.revision, sender_user_id: actors[0], recipient_user_ids: [saved.instituicao.id, saved.representante.id],
      channel: "portal", subject: "DEMO — decisão de acreditação simulada", body: "A demonstração do processo foi concluída. Consulte a decisão e a concessão de demonstração. Este aviso não representa acreditação oficial.",
      delivery_evidence_record_id: receipt.id, delivery_evidence_revision: receipt.revision,
    });
    let notice = communication;
    for (const state of ["queued", "sent"]) notice = await transition(notice, state);
    if (notice.state === "sent") notice = await revise(notice, { delivered_at: new Date().toISOString() });
    notice = await transition(notice, "delivered");
    const casework = new SafdoulasCaseworkController(records, registry, access, db);
    const folder = await casework.detail({ orbitActor: actors[0] } as never, process.id);
    assert.ok(["decision", "closed"].includes(folder.process.state));
    assert.ok(folder.records.some((record) => record.id === grant.id));
    assert.equal(folder.requirement_checks.find((check) => check.code === "minimum_total_hours")?.value, 180);
    completed.process = process;
    console.log("Exemplo 03 concluído com duas avaliações independentes.");
    // Demo accounts never receive root; records remain subject to exact resource sharing.
    const all = await db.query<ExtensionRecord>("SELECT * FROM extension_records WHERE workspace_id=$1", [workspace.id]);
    const references = all.filter(record => !record.title.startsWith("[DEMO 0"));
    for (const record of all) {
      for (const key of ["governanca", "gt"] as const) {
        if (key === "gt" && ["individual_evaluation", "deliberation_vote"].includes(record.kind)) continue;
        await shareRecord(saved[key].id, people.find(person => person[0] === key)![2], record);
      }
      if (!["individual_evaluation", "blinded_projection"].includes(record.kind) && record.plugin_id !== "documents") await shareRecord(saved.diretoria.id, "safdoulas_directorate", record);
      const caseCode = [pending, underway, completed].find(item => record.title.startsWith(item.process.title.split("]")[0] + "]"));
      if (caseCode && (["safdoulas-registry", "safdoulas-processes"].includes(record.plugin_id) || record.id === caseCode.application.id || record.id === caseCode.original.id)) {
        for (const key of ["instituicao", "representante"] as const) await shareRecord(saved[key].id, people.find(person => person[0] === key)![2], record);
      }
    }
    for (const record of references) for (const key of ["instituicao", "representante", "candidata", "acreditadora", "acreditadora2"] as const) {
      if (["forms", "terms", "assessments", "safdoulas-governance"].includes(record.plugin_id)) await shareRecord(saved[key].id, people.find(person => person[0] === key)![2], record);
    }
    await shareRecord(saved.observador.id, "safdoulas_observer", completed.process);
    for (const item of [pending, underway, completed]) {
      await records.detail("safdoulas-processes", item.process.id, saved.instituicao.id);
      await records.detail("safdoulas-processes", item.process.id, saved.representante.id);
    }
    await assert.rejects(() => records.detail("documents", completed.original.id, saved.acreditadora.id));
    await assert.rejects(() => records.detail("safdoulas-assessments", evaluations[1].id, saved.acreditadora.id));
    await assert.rejects(() => records.detail("safdoulas-processes", pending.process.id, saved.observador.id));
    await assert.rejects(() => records.detail("safdoulas-processes", completed.process.id, saved.publico.id));
    assert.equal((await records.list("safdoulas-processes", workspace.id, root.id)).filter(record => record.kind === "accreditation_process").length, 3);
    for (const item of [pending, underway, completed]) {
      const fresh = (await records.detail("safdoulas-processes", item.process.id, root.id));
      assert.equal(fresh.state, item === pending ? "draft" : item === underway ? "review" : "decision");
    }
    const candidatePrefix = prefix; prefix = "[DEMO — Candidata]";
    const candidateForm = await submissionFor(saved.candidata.id);
    const candidateApplication = await create("safdoulas-accreditors", "application", { ...definition("safdoulas-accreditors", "application").example, user_id: saved.candidata.id, source_submission_record_id: candidateForm.id, source_submission_revision: candidateForm.revision });
    await shareRecord(saved.candidata.id, "safdoulas_accreditor_candidate", candidateForm);
    await shareRecord(saved.candidata.id, "safdoulas_accreditor_candidate", candidateApplication);
    prefix = candidatePrefix;
    const rows = people.map(([key,name,,position,purpose]) => `| ${position} | ${name} | ${saved[key].email} | ${saved[key].password} | ${purpose} |`).join("\n");
    const report = `# SafDoulas — demonstração e acessos\n\nURL: http://localhost:3002 — preparado em 21/10/2026.\nTodos os nomes e contatos de demonstração são fictícios. As contas usam senhas próprias e não são armazenadas no cofre.\n\n## Perfis\n\n| Nível | Nome | Login | Senha | Responsabilidade |\n|---|---|---|---|---|\n${rows}\n\nRoot: ${root.email}, conta original e senha preservadas; acesso total. Nenhuma nova conta root foi criada.\nO papel interno de avaliação cegada não é um nível de usuário: é concedido automaticamente só nos registros atribuídos.\n\n## Três fluxos\n\n` + [pending,underway,completed].map((item,index) => `${index+1}. ${item.provider.payload.display_name}: ${index===0?"não iniciado — rascunho sem protocolo":index===1?"em andamento — triagem concluída, aguardando avaliação":"concluído — dois pareceres, votação, decisão e concessão SIMULADOS"}; abrir http://localhost:3002/safdoulas/processes?workspace=${workspace.id} e selecionar ${item.process.title}.`).join("\n") + `\n\n## Registros fixos e manutenção\n\n13 documentos originais preservados com checksum; 11 referências normativas, matriz de 9 dimensões/80 critérios, 2 formulários, políticas de deliberação e cegamento, regra vigente de acreditação e 2 modelos documentais.\nGovernança mantém os editais, referências a artigos/seções, critérios, formulários, políticas e modelos por versões; a acreditadora preenche pareceres e não altera o edital.\nOs artigos não são inventados nem usados como notas automáticas: as fontes e referências de seção ficam associadas às regras e aos critérios.\nSomente os três exemplos acima compõem os processos de demonstração. A regra antiga supersedida permanece no histórico imutável, sem vigência.\nA decisão e o selo do exemplo concluído são SIMULAÇÕES: não constituem acreditação oficial, assinatura real nem autorização MEC.\n\n## Verificações\n\nTrês estados confirmados no banco pelo serviço real; visibilidade de instituição/representante; bloqueio de documento original e parecer alheio para acreditadora; observador limitado e público sem acesso interno. Testes HTTP de login e navegação são registrados em validacao-demo.json.\n`;
    await writeFile(join(reportDir, "safdoulas-demonstracao-acessos.md"), report, { mode: 0o600 }); await chmod(join(reportDir, "safdoulas-demonstracao-acessos.md"), 0o600);
    await writeFile(join(reportDir, "safdoulas-demo-manifest.json"), JSON.stringify({ workspace_id: workspace.id, processes: [pending,underway,completed].map(item => ({ id:item.process.id, title:item.process.title })), original_document_id: completed.original.id, second_evaluation_id: evaluations[1].id, rule_id: setup.records.ruleset.id }, null, 2), { mode: 0o600 });
    console.log("Demonstração validada; relatório privado gerado em " + reportDir);
  } finally { await db.pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
