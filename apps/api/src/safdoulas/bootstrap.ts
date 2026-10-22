import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../db";
import type { ExtensionRecords, ExtensionRecord } from "../plugins/records/records.service";
import { safdoulasReferenceData } from "./reference-data";
import { safdoulasGovernancePlugin } from "./governance.plugin";

type Payload = Record<string, unknown>;
type Source = { file_name: string; data: Buffer };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const text = { type: "string", minLength: 1, maxLength: 4000 };
const uuid = { type: "string", pattern: "^[a-fA-F0-9-]{36}$" };
const revision = { type: "integer", minimum: 1 };
const yes = { type: "boolean", enum: [true] };
const reference = object({ record_id: uuid, revision, purpose: text });
export const courseApplicationSchema = object({
  responsible_name: text, responsible_email: { type: "string", format: "email" }, responsible_role: text,
  provider_record_id: uuid, provider_revision: revision, course_record_id: uuid, course_revision: revision,
  curriculum_record_id: uuid, curriculum_revision: revision,
  declared_hours: { type: "number", minimum: 0 },
  modality: { type: "string", enum: ["in_person", "hybrid", "online_synchronous", "online_asynchronous", "other"] },
  document_refs: { type: "array", minItems: 1, maxItems: 200, items: reference },
  edital_read: yes, information_true: yes, privacy_accepted: yes, rules_accepted: yes,
  observations: { type: "string", maxLength: 12000 },
});
export const accreditorApplicationSchema = object({
  full_name: text, cpf: { type: "string", minLength: 11, maxLength: 14 }, email: { type: "string", format: "email" }, phone: text,
  state: { type: "string", minLength: 2, maxLength: 2 }, municipality: text, association: text,
  doula_experience_years: { type: "number", minimum: 0 }, training_hours: { type: "number", minimum: 0 },
  experience_summary: text, availability: text, affiliations: text, conflicts: text,
  evidence_refs: { type: "array", minItems: 1, maxItems: 100, items: reference },
  information_true: yes, regulation_read: yes, ethics_commitment: yes, training_commitment: yes,
});

const applicationLabels: Record<string, string> = {
  responsible_name: "Pessoa responsável pelo preenchimento", responsible_email: "E-mail da pessoa responsável", responsible_role: "Função e autorização de representação",
  provider_record_id: "Cadastro da instituição ou formadora", provider_revision: "Versão do cadastro da formadora", course_record_id: "Curso submetido", course_revision: "Versão do curso",
  curriculum_record_id: "Matriz curricular submetida", curriculum_revision: "Versão da matriz curricular", declared_hours: "Carga horária total declarada", modality: "Modalidade avaliada",
  document_refs: "Documentos da solicitação", edital_read: "Li o edital e seus anexos", information_true: "Declaro a veracidade das informações", privacy_accepted: "Aceito o tratamento de dados para acreditação", rules_accepted: "Aceito as regras do processo",
  observations: "Observações", full_name: "Nome completo", cpf: "CPF", email: "E-mail", phone: "Telefone", state: "UF", municipality: "Município", association: "Associação e vínculo institucional",
  doula_experience_years: "Anos de atuação como doula", training_hours: "Carga horária da formação como doula", experience_summary: "Trajetória prática, formativa e institucional", availability: "Disponibilidade para atuação e alinhamento",
  affiliations: "Vínculos institucionais, pedagógicos e pessoais", conflicts: "Impedimentos, suspeições e conflitos declarados", evidence_refs: "Comprovações e declarações", regulation_read: "Li o regulamento interno", ethics_commitment: "Comprometo-me com ética, sigilo e imparcialidade", training_commitment: "Comprometo-me a concluir o alinhamento obrigatório",
};
for (const schema of [courseApplicationSchema, accreditorApplicationSchema])
  for (const [key, field] of Object.entries(schema.properties)) Object.assign(field as object, { title: applicationLabels[key] || key });

/** Idempotent demonstration setup through the same record validations as the API. */
export async function bootstrapSafdoulas(db: Db, records: ExtensionRecords, workspace: string, actor: string, sources: Source[]) {
  for (const source of safdoulasReferenceData.sources) {
    const file = sources.find((file) => file.file_name === source.file_name);
    if (!file || createHash("sha256").update(file.data).digest("hex") !== source.sha256)
      throw new Error(`Fonte ausente ou diferente da revisão analisada: ${source.file_name}`);
  }
  const lock = await db.pool.connect();
  await lock.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`safdoulas-bootstrap:${workspace}`]);
  const result: Record<string, ExtensionRecord> = {};
  try {
    const existing = async (plugin: string, kind: string, title: string) => db.one<ExtensionRecord>(
      "SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 AND kind=$3 AND title=$4 ORDER BY created_at LIMIT 1", [workspace, plugin, kind, title]);
    const advance = async (record: ExtensionRecord, states: string[]) => {
      const index = states.indexOf(record.state);
      if (index < 0) throw new Error(`Estado inesperado em ${record.title}: ${record.state}`);
      for (const state of states.slice(index + 1)) record = await records.transition(record.plugin_id, record.id, actor,
        { state, expected_revision: record.revision, reason: "Preparação demonstrativa baseada nos documentos fornecidos; sem aprovação institucional para uso real.", operation_key: randomUUID() });
      return record;
    };
    const create = async (plugin: string, kind: string, title: string, payload: Payload, states: string[]) => {
      const record = await existing(plugin, kind, title) || await records.create(plugin, workspace, actor, { kind, title, payload, operation_key: randomUUID() });
      return advance(record, states);
    };
    const normative = [];
    for (const source of safdoulasReferenceData.sources) {
      const file = sources.find((file) => file.file_name === source.file_name)!;
      const document = await advance(await existing("documents", "document", source.file_name) || await records.upload(workspace, actor, {
        title: source.file_name, file_name: source.file_name,
        mime_type: source.file_name.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data_base64: file.data.toString("base64"), variant: "original", operation_key: randomUUID(), reason: "Fonte original preservada para a revisão de escopo.",
      }), ["draft", "published"]);
      result[source.reference] = document;
      if (source.example_only) continue;
      const norm = await create("safdoulas-governance", "normative_document", `[DEMO] ${source.file_name}`, {
        reference: source.reference, category: source.category, title: source.file_name, issuer: "FENADOULASBR", version: "2026-revisao-demo-1",
        published_on: "2026-10-21", effective_from: "2026-10-21", effective_until: null,
        source_document_record_id: document.id, source_document_revision: document.revision, source_file: source.file_name, checksum_sha256: source.sha256,
        notes: "Original fornecido pelo proprietário. Datas de cadastro para demonstração; não representam publicação normativa oficial. Edital 02/2026 e modelo de concessão prevalecem sobre o fluxo ilustrativo para a validade de dois anos.",
      }, ["draft", "under_review", "approved", "active"]);
      normative.push({ record_id: norm.id, revision: norm.revision, source_reference: source.reference });
    }
    const matrix = await create("assessments", "matrix", "[DEMO] Matriz de acreditação — nove dimensões", safdoulasReferenceData.matrix, ["draft", "published"]);
    result.matrix = matrix;
    const definitions = safdoulasGovernancePlugin.contributions!.recordKinds!;
    const approval = "DEMO — escolha de parâmetros para simulação autorizada pelo proprietário; revisar antes de uso institucional.";
    const decisionPolicy = await create("safdoulas-governance", "decision_policy", "[DEMO] Política de deliberação — revisão documental", {
      ...definitions.decision_policy.example, code: "SAF-DECISION-2026-DEMO", source_references: normative.map((source) => source.source_reference),
      appealable_outcomes: ["denied"], approval_reference: approval,
      support_thresholds: ["approved", "approved_with_conditions", "further_diligence", "denied"].map((outcome) => ({ outcome, minimum_percent: 51 })),
      appeal_support_thresholds: ["maintained", "modified", "reversed"].map((outcome) => ({ outcome, minimum_percent: 51 })),
    }, ["draft", "under_review", "approved", "active"]);
    result.decision_policy = decisionPolicy;
    const categories = ["person_name", "institution_name", "cnpj", "contact", "visual_identity", "file_metadata"];
    const blinding = await create("safdoulas-governance", "blinding_policy", "[DEMO] Cegamento e preservação de evidências", {
      ...definitions.blinding_policy.example, code: "SAF-BLINDING-2026-DEMO", approval_reference: approval,
      blinding_policy: {
        redaction_rules: categories.map((category) => ({ category, target: category, action: "remove", rationale: "Evitar a identificação da instituição e das pessoas na análise independente." })),
        preserved_evidence: [{ target: "Formação, profissão, experiência, matriz, cargas horárias e evidências pedagógicas", rationale: "Manter os elementos necessários à análise qualitativa e quantitativa." }],
        required_checks: categories.map((category) => ({ code: category, label: `Revisar ${category}`, category })),
      },
    }, ["draft", "under_review", "approved", "active"]);
    result.blinding_policy = blinding;
    result.course_form = await create("forms", "form", "[DEMO] Solicitação de acreditação de curso", { description: "Os cadastros relacionados contêm os dados formativos; esta resposta preserva referências, documentos e aceites da solicitação. Não é matrícula em curso.", schema: courseApplicationSchema }, ["draft", "published"]);
    result.accreditor_form = await create("forms", "form", "[DEMO] Candidatura a acreditadora", { description: "Dados e declarações para seleção; habilitação exige conferência, alinhamento e termos.", schema: accreditorApplicationSchema }, ["draft", "published"]);
    const rules = await create("safdoulas-governance", "accreditation_ruleset", "[DEMO] Edital 02/2026 — acreditação de cursos — revisão 2", {
      ...definitions.accreditation_ruleset.example, code: "SAF-COURSE-2026-DEMO-V2", source_references: normative.map((source) => source.source_reference), normative_document_refs: normative,
      application_form_record_id: result.course_form.id, application_form_revision: result.course_form.revision,
      matrix_record_id: matrix.id, matrix_revision: matrix.revision, decision_policy_record_id: decisionPolicy.id, decision_policy_revision: decisionPolicy.revision,
      approval_reference: approval, protocol_pattern: "SAF-{year}/{sequence:4}", accreditation_validity_months: 24,
      admission_requirements: [
        ["application", "Formulário enviado com aceites e responsabilidade."], ["pedagogical_proposal", "PPP, plano de curso ou documento equivalente."],
        ["curriculum", "Matriz curricular, cronograma ou ementa."], ["certificate", "Modelo de certificado."],
        ["coordination", "Comprovações da coordenação."], ["teachers", "Comprovações docentes."], ["truth", "Declaração assinada de veracidade."],
      ].map(([code, description]) => ({ code, description, required: true, evidence_required: true, source_reference: "Edital 02/2026, seção 9" })),
      hour_parameters: [
        ["minimum_total_hours", "Carga horária total", 120, "horas"], ["minimum_supervised_practice_percent", "Prática supervisionada", 20, "%"],
        ["minimum_live_hours_percent", "Atividades presenciais e/ou síncronas", 50, "%"], ["minimum_live_attendance_percent", "Frequência mínima declarada", 75, "%"],
        ["minimum_coordinator_doula_percent", "Doulas na coordenação", 50, "%"], ["minimum_teacher_doula_percent", "Doulas elegíveis no corpo docente", 60, "%"],
        ["minimum_coordinator_experience_years", "Experiência da coordenação como doula", 3, "anos"], ["minimum_teacher_experience_years", "Experiência docente como doula", 2, "anos"],
        ["minimum_entry_age", "Idade mínima de ingresso declarada", 18, "anos"],
      ].map(([code, label, minimum, unit]) => ({ code, label, minimum, unit, source_reference: "Edital 02/2026, seção 11; Documento Norteador 2026" })),
      deadlines: ["initial_analysis", "diligence_response", "analysis_after_diligence", "appeal_analysis"].map((stage) => ({ stage, duration_days: 90, pause_when_waiting_for: ["institution_response"], source_reference: "Edital 02/2026, seções 14, 17 e 18" })),
    }, ["draft", "under_review", "approved", "active"]);
    result.ruleset = rules;
    for (const previous of await db.query<ExtensionRecord>("SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id='safdoulas-governance' AND kind='accreditation_ruleset' AND state='active' AND payload->>'code'='SAF-COURSE-2026-DEMO'", [workspace]))
      await records.transition("safdoulas-governance", previous.id, actor, { state: "superseded", expected_revision: previous.revision, reason: "Revisão de demonstração substituída pela versão que fixa o formulário oficial; snapshots anteriores preservados.", operation_key: randomUUID() });
    result.concession_template = await create("safdoulas-governance", "approved_template", "[DEMO] Modelo de concessão — acreditação institucional", {
      code: "SAF-CONCESSION-2026-DEMO", title: "Concessão de acreditação", version: "2026-demo-1", document_type: "concessao", approval_reference: approval,
      source_references: ["Modelo de concessão, seções 1 a 10"], variables: ["accreditation_number", "process_number", "course_name", "provider_name", "modality", "accreditation_scope", "valid_from", "valid_until"],
      body_markdown: "# Concessão de acreditação {{accreditation_number}}\n\nProcesso {{process_number}}\n\nCurso: {{course_name}}\nInstituição: {{provider_name}}\nModalidade: {{modality}}\nEscopo: {{accreditation_scope}}\nValidade: {{valid_from}} a {{valid_until}}\n\nA acreditação abrange exclusivamente o objeto e as ofertas aprovadas, conforme o edital e o Manual de Uso do Selo. Não se estende à instituição inteira nem acredita individualmente as estudantes.\n\nA validade refere-se à acreditação e à autorização de uso do selo; não ao certificado individual de conclusão.\n\nA instituição deve comunicar alterações relevantes e observar as condições e recomendações da decisão.\n\nDocumento para assinatura institucional. DEMONSTRAÇÃO.",
    }, ["draft", "under_review", "approved", "active"]);
    result.credential_template = await create("safdoulas-governance", "approved_template", "[DEMO] Certificado de habilitação de acreditadora", {
      code: "SAF-CREDENTIAL-2026-DEMO", title: "Certificado de habilitação", version: "2026-demo-1", document_type: "certificado", approval_reference: approval,
      source_references: ["Edital 01/2026, seção 9; Regulamento interno, artigo 6"], variables: ["accreditor_name", "credential_number", "valid_from", "valid_until", "training_completed_at"],
      body_markdown: "# Certificado de habilitação {{credential_number}}\n\nA FENADOULASBR registra a habilitação institucional de {{accreditor_name}} para atuar no Sistema de Acreditação de Cursos de Formação de Doulas.\n\nAlinhamento concluído em {{training_completed_at}}.\nVigência: {{valid_from}} a {{valid_until}}.\n\nA atuação depende de distribuição regular, disponibilidade e ausência de conflito de interesses. Este documento não é certificado de conclusão de curso de estudantes.\n\nMinuta para assinatura institucional. DEMONSTRAÇÃO.",
    }, ["draft", "under_review", "approved", "active"]);
    return { workspace_id: workspace, records: Object.fromEntries(Object.entries(result).map(([key, record]) => [key, { id: record.id, revision: record.revision, state: record.state }])) };
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`safdoulas-bootstrap:${workspace}`]);
    lock.release();
  }
}
