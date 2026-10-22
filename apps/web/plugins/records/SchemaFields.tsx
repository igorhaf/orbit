"use client";

import {
  accessInput as input,
  accessButton as button,
} from "@/components/access-shell";

export type Schema = {
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: string[];
  required?: string[];
  format?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
};
const labels: Record<string, string> = {
  display_name: "Nome de divulgação",
  registered_name: "Nome jurídico ou formal",
  cnpj: "CNPJ, quando houver",
  state: "UF",
  municipality: "Município",
  address: "Endereço",
  street: "Logradouro",
  number: "Número",
  complement: "Complemento",
  district: "Bairro",
  postal_code: "CEP",
  contacts: "Contatos",
  representatives: "Representantes autorizados",
  relationships: "Vínculos institucionais",
  relationship_type: "Tipo de vínculo",
  provider_record_id: "Instituição ou formadora vinculada",
  course_record_id: "Curso relacionado",
  full_name: "Nome completo",
  function: "Função na equipe",
  profession: "Profissão",
  education: "Formação",
  experience_summary: "Experiência profissional",
  responsibilities: "Responsabilidades",
  components: "Componentes ministrados ou acompanhados",
  active_from: "Atuação a partir de",
  active_until: "Atuação até",
  pedagogical_proposal: "Proposta pedagógica",
  problem_context: "Contexto e justificativa",
  conception: "Concepção de ensino",
  objectives: "Objetivos de aprendizagem",
  methodology: "Metodologia",
  learning_support: "Apoio às estudantes",
  organization: "Organização da formação",
  evaluation_methods: "Métodos avaliativos",
  criteria: "Critérios",
  evidence_required: "Exige evidência",
  certification_requirements: "Requisitos de certificação",
  attendance_description: "Critério de frequência",
  minimum_performance_description: "Critério de desempenho mínimo",
  required_activities: "Atividades obrigatórias",
  final_products: "Produtos finais exigidos",
  accessibility_measures: "Acessibilidade pedagógica",
  communication_accessibility: "Acessibilidade comunicacional",
  affirmative_actions: "Ações afirmativas",
  scholarship_and_retention: "Bolsas, acesso e permanência",
  modalities: "Modalidades",
  year_created: "Ano de criação do curso",
  teaching_conception: "Concepção pedagógica",
  student_support: "Suporte às estudantes",
  access_criteria: "Critérios de ingresso",
  version: "Versão",
  valid_from: "Início da vigência",
  total_hours: "Carga horária total declarada",
  modules: "Módulos e componentes curriculares",
  activities: "Atividades formativas",
  activity_type: "Tipo de atividade",
  modality: "Modalidade da atividade",
  axis: "Eixo formativo",
  syllabus: "Ementa",
  contents: "Conteúdos programáticos",
  hours: "Carga horária",
  hour_breakdown: "Distribuição da carga horária",
  theoretical: "Teórica",
  in_person: "Presencial",
  synchronous: "On-line síncrona",
  asynchronous: "On-line assíncrona",
  extra_activities: "Atividades extras",
  experiential: "Vivências",
  case_studies: "Estudos de caso",
  supervised_practice: "Prática supervisionada",
  schedule: "Cronograma",
  module_code: "Código do módulo",
  starts_on: "Início",
  ends_on: "Término",
  scheduled_period: "Período previsto",
  certificate_template_record_id: "Modelo de certificado relacionado",
  certificate_template_revision: "Versão do modelo de certificado",
  course_certificate_model: "Modelo de certificado do curso",
  document_record_id: "Documento do certificado",
  document_revision: "Versão do documento",
  declared_hours: "Carga horária declarada no certificado",
  required_fields: "Informações exigidas no certificado",
  source_form_submission_record_id: "Submissão do formulário de origem",
  source_form_submission_revision: "Versão do formulário de origem",
  evidence_documents: "Documentos comprobatórios vinculados",
  record_id: "Registro do documento",
  revision: "Versão do registro",
  purpose: "Finalidade do documento",
  evidence_record_ids: "Documentos comprobatórios",
  supervisor_record_ids: "Supervisores relacionados",
  practice_type: "Tipo de prática",
  ethical_limits: "Limites éticos e salvaguardas",
  report_required: "Exige relatório",
  content: "Conteúdo",
  source_reference: "Código da fonte normativa",
  authority: "Autoridade responsável",
  topics: "Temas",
  valid_until: "Fim da vigência",
  parameters: "Parâmetros",
  code: "Código",
  value: "Valor",
  minimum: "Mínimo",
  maximum: "Máximo",
  outcomes: "Resultados possíveis",
  dimensions: "Dimensões",
  title: "Título",
  justification_required: "Justificativa obrigatória",
  data_categories: "Categorias de dados",
  subject_categories: "Categorias de titulares",
  legal_basis_reference: "Referência da base legal",
  retention_reference: "Referência de retenção",
  request_type: "Tipo de solicitação",
  opaque_reference: "Referência opaca do caso",
  response_reference: "Referência da resposta",
  related_resource_type: "Tipo de recurso relacionado",
  related_resource_id: "ID do recurso relacionado",
  statement: "Declaração",
  expires_at: "Válido até",
  reason: "Justificativa",
  resolution: "Resolução",
  decision_reference: "Referência da decisão",
  disclosure_id: "ID da declaração",
  description: "Descrição",
  schema: "Definição dos campos em JSON Schema",
  form_id: "ID do formulário",
  form_revision: "Versão do formulário",
  answers: "Respostas",
  states: "Estados possíveis",
  initial_state: "Estado inicial",
  transitions: "Transições",
  from: "Origem",
  to: "Destino",
  definition_id: "ID da definição de fluxo",
  definition_revision: "Versão da definição",
  target_type: "Tipo do recurso associado",
  target_id: "ID do recurso associado",
  process_id: "ID do processo",
  outcome: "Resultado",
  checks: "Verificações",
  responsible_user_id: "ID do responsável",
  due_at: "Prazo de resposta",
  response: "Resposta",
  duration_days: "Duração em dias",
  document_id: "ID do documento",
  decision: "Decisão",
  matrix_record_id: "Matriz avaliativa",
  matrix_revision: "Versão da matriz",
  evaluator_user_ids: "Acreditadoras designadas",
  evaluator_profile_refs: "Perfis e habilitações das avaliadoras",
  evaluator_profile_ref: "Perfil da terceira avaliadora",
  profile_status: "Situação da habilitação",
  credential_number: "Número do certificado ou habilitação",
  application_record_id: "Candidatura aprovada",
  application_revision: "Versão da candidatura",
  user_id: "Usuária ou usuário vinculado",
  region_code: "Região de atuação",
  expertise: "Áreas de experiência",
  max_parallel_assignments: "Limite de processos simultâneos",
  ethics_term_record_id: "Termo ético aceito",
  ethics_term_revision: "Versão do termo ético",
  ethics_accepted_at: "Data do aceite ético",
  conflict_declaration_valid_until: "Declaração de conflitos válida até",
  affiliations: "Vínculos e conflitos declarados",
  conflict_type: "Tipo de vínculo ou conflito",
  source_submission_record_id: "Formulário de candidatura enviado",
  source_submission_revision: "Versão da candidatura enviada",
  evidence_refs: "Evidências e documentos comprobatórios",
  eligibility_summary: "Resumo da análise de elegibilidade",
  reviewed_by: "Pessoa responsável pela análise",
  decision_reason: "Fundamentação da decisão",
  evaluator_user_id: "Acreditadora responsável",
  assigned_at: "Data da distribuição",
  assignment_note: "Observação da distribuição",
  assignment_record_id: "Distribuição vinculada",
  assignment_revision: "Versão da distribuição",
  blinded_projection_refs: "Documentos cegados disponíveis",
  evaluation_role: "Etapa da avaliação",
  criterion_code: "Critério da matriz",
  justification: "Justificativa",
  observation: "Observação do critério",
  dimension_code: "Dimensão da matriz",
  summary: "Síntese da dimensão",
  strengths: "Pontos fortes",
  fragilities: "Fragilidades",
  inconsistencies: "Inconsistências encontradas",
  diligence_items: "Itens para diligência",
  request: "Solicitação",
  evidence_reference: "Referência da evidência",
  substantial: "Divergência substancial",
  divergences: "Divergências entre avaliações",
  first_evaluation_record_id: "Primeira avaliação",
  first_evaluation_revision: "Versão da primeira avaliação",
  second_evaluation_record_id: "Segunda avaliação",
  second_evaluation_revision: "Versão da segunda avaliação",
  third_evaluation_record_id: "Terceira avaliação",
  third_evaluation_revision: "Versão da terceira avaliação",
  consolidation_record_id: "Consolidação vinculada",
  consolidation_revision: "Versão da consolidação",
  synthesis: "Síntese comparativa",
  conclusion: "Conclusão técnica",
  preliminary_opinion: "Parecer preliminar individual",
  signature_reference: "Referência da assinatura",
  signed_at: "Data da assinatura",
  accreditation_number: "Número da acreditação",
  normative_document_refs: "Documentos normativos fixados nesta versão",
  source_references: "Códigos das fontes normativas",
  source_document_record_id: "Arquivo original da fonte",
  source_document_revision: "Versão do arquivo original",
  verification_code: "Código público de verificação",
  renewal_request_record_id: "Solicitação de renovação",
  renewal_request_revision: "Versão da solicitação de renovação",
  renewal_process_record_id: "Novo processo de renovação",
  renewal_process_revision: "Versão do novo processo",
  previous_grant_record_id: "Acreditação anterior",
  previous_grant_revision: "Versão da acreditação anterior",
  grant_record_id: "Concessão relacionada",
  grant_revision: "Versão da concessão",
  process_record_id: "Processo de acreditação",
  process_revision: "Versão do processo",
  decision_record_id: "Decisão institucional",
  decision_revision: "Versão da decisão",
  concession_template_record_id: "Modelo de concessão",
  concession_template_revision: "Versão do modelo",
  signed_document_record_id: "Documento assinado",
  signed_document_revision: "Versão do documento assinado",
  accreditation_scope: "Escopo da acreditação",
  provider_name: "Instituição ou formadora",
  course_name: "Curso acreditado",
  offering_codes: "Turmas ou ofertas incluídas",
  condition_refs: "Condicionantes e prazos",
  condition_code: "Condicionante",
  response_summary: "Resposta à condicionante",
  seal_version: "Versão oficial do selo",
  privacy_approval_reference: "Autorização de divulgação pública",
  approval_reference: "Referência da aprovação institucional",
  submitted_on: "Data do envio",
  reported_on: "Data da comunicação",
  reviewed_on: "Data da análise",
  decision_basis: "Fundamentação da decisão",
  review_basis: "Fundamentação da análise",
  review_outcome: "Conclusão sobre a mudança",
  follow_up_process_record_id: "Processo aberto para revisão",
  follow_up_process_revision: "Versão do processo de revisão",
  change_type: "Tipo de mudança comunicada",
  action: "Medida sobre o selo",
  category: "Categoria de dados",
  start_event: "Evento inicial da contagem",
  retention_days: "Prazo de retenção em dias",
  disposition: "Destinação prevista",
  normative_source_record_id: "Fonte normativa",
  normative_source_revision: "Versão da fonte normativa",
  institution_approval_reference: "Referência da aprovação institucional",
  deletion_authorization_reference: "Autorização para eliminação",
  effective_from: "Início da vigência",
  target_record_id: "Registro sob revisão",
  target_revision: "Versão do registro sob revisão",
  target_plugin_id: "Plugin do registro sob revisão",
  target_kind: "Tipo do registro sob revisão",
  policy_record_id: "Política de retenção",
  policy_revision: "Versão da política de retenção",
  legal_hold: "Preservação legal ativa",
  legal_hold_reference: "Referência da preservação legal",
  execution_evidence_reference: "Referência da evidência de destinação",
  executed_at: "Data da destinação registrada",
  incident_type: "Tipo de incidente",
  discovered_at: "Data de identificação",
  affected_record_refs: "Registros afetados",
  containment_reference: "Referência de contenção",
  impact_assessment_reference: "Referência da avaliação de impacto",
  notification_reference: "Referência de notificação",
  closure_reference: "Referência de encerramento",
  seal_asset_record_id: "Ativo aprovado do selo",
  seal_asset_revision: "Versão do ativo do selo",
  files: "Arquivos oficiais por formato",
  format: "Uso do arquivo",
  checksum_sha256: "Checksum SHA-256",
  manual_record_id: "Manual de uso do selo",
  manual_revision: "Versão do manual do selo",
  approved_at: "Data de aprovação do selo",
};
export const fieldLabel = (key: string) =>
  labels[key] || key.replaceAll("_", " ");

function JsonField({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
}) {
  return (
    <textarea
      aria-label={label}
      className={`${input} min-h-36 font-mono text-sm`}
      defaultValue={value === undefined ? "" : JSON.stringify(value, null, 2)}
      onChange={(event) => {
        const field = event.currentTarget;
        try {
          const parsed = field.value.trim()
            ? JSON.parse(field.value)
            : undefined;
          field.setCustomValidity("");
          onChange(parsed);
        } catch {
          field.setCustomValidity("Informe um JSON válido.");
        }
      }}
    />
  );
}

function Field({
  schema,
  value,
  onChange,
  label,
}: {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
}) {
  const type = Array.isArray(schema.type)
    ? schema.type.find((item) => item !== "null")
    : schema.type;
  if (schema.enum)
    return (
      <select
        aria-label={label}
        className={input}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">Selecione</option>
        {schema.enum.map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
    );
  if (type === "boolean")
    return (
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        Sim
      </label>
    );
  if (type === "object" && schema.properties)
    return (
      <SchemaFields
        schema={schema}
        value={(value || {}) as Record<string, unknown>}
        onChange={onChange}
      />
    );
  if (type === "array" && schema.items) {
    const items = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={index}
            className="min-w-0 space-y-2 rounded border border-white/15 p-3"
          >
            <Field
              label={`${label} ${index + 1}`}
              schema={schema.items!}
              value={item}
              onChange={(next) =>
                onChange(items.map((value, i) => (i === index ? next : value)))
              }
            />
            <button
              type="button"
              className="min-h-11 text-sm text-[#ff8f73]"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              Remover item {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className={button}
          onClick={() =>
            onChange([...items, schema.items?.type === "object" ? {} : ""])
          }
        >
          Adicionar item
        </button>
      </div>
    );
  }
  if (!type || type === "object")
    return (
      <JsonField key={label} label={label} value={value} onChange={onChange} />
    );
  if (type === "number" || type === "integer")
    return (
      <input
        aria-label={label}
        className={input}
        type="number"
        step={type === "integer" ? 1 : "any"}
        min={schema.minimum}
        max={schema.maximum}
        value={value === undefined ? "" : String(value)}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? undefined : Number(event.target.value),
          )
        }
      />
    );
  if (schema.format === "date" || schema.format === "date-time")
    return (
      <input
        aria-label={label}
        className={input}
        type={schema.format === "date" ? "date" : "datetime-local"}
        value={String(value ?? "").replace(/Z$/, "")}
        onChange={(event) =>
          onChange(
            event.target.value
              ? schema.format === "date"
                ? event.target.value
                : new Date(event.target.value).toISOString()
              : undefined,
          )
        }
      />
    );
  return (
    <textarea
      aria-label={label}
      rows={schema.maxLength && schema.maxLength > 1000 ? 4 : 2}
      maxLength={schema.maxLength}
      className={input}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  );
}

export default function SchemaFields({
  schema,
  value,
  onChange,
  skip = [],
}: {
  schema: Schema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  skip?: string[];
}) {
  return (
    <div className="grid min-w-0 gap-4">
      {Object.entries(schema.properties || {})
        .filter(([key]) => !skip.includes(key))
        .map(([key, field]) => (
          <div key={key} className="min-w-0">
            <p className="mb-1 text-sm font-semibold">
              {field.title || fieldLabel(key)}
              {schema.required?.includes(key) ? " *" : ""}
            </p>
            {field.description && <p className="mb-2 text-sm">{field.description}</p>}
            <Field
              schema={field}
              label={field.title || fieldLabel(key)}
              value={value[key]}
              onChange={(next) => {
                const updated = { ...value };
                if (next === undefined) delete updated[key];
                else updated[key] = next;
                onChange(updated);
              }}
            />
          </div>
        ))}
    </div>
  );
}
