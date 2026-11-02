import { createHash, randomUUID } from "node:crypto";
import type { PluginDefinition, RecordKindContribution, RecordValidationContext, RecordValidationIssue } from "../contract";
import { isProviderCaptionVideo, validateLessonCaptions } from "./lesson-captions";
import { lessonAccessibilityGaps } from "./accessibility-audit";
import { normalizeScholarshipRubric } from "./scholarship-rubric";

export const learnerProfileSensitiveFields = [
  "phone", "date_of_birth", "institution", "study_program", "academic_background",
  "emergency_contact_name", "emergency_contact_phone", "custom_fields",
];

const suindaStateLabels: Record<string, string> = {
    active: "Ativo",
    inactive: "Inativo",
    enrollment_open: "Inscrições abertas",
    application_draft: "Inscrição incompleta",
    enrolling: "Em inscrições",
    in_progress: "Em andamento",
    closed: "Encerrado",
    canceled: "Cancelado",
    archived: "Arquivado",
    published: "Publicado",
    waitlisted: "Na lista de espera",
    approved: "Aprovado",
    expired: "Prazo expirado",
    rejected: "Recusado",
    enrolled: "Matriculado",
    withdrawn: "Desistente",
    consent_withdrawn: "Consentimento retirado",
    failed: "Reprovado",
    scheduled: "Agendado",
    live: "Ao vivo",
    recorded: "Registrado",
    corrected: "Corrigido",
    grading: "Aguardando correção",
    resubmitted: "Reenviado",
    issued: "Emitido",
    revoked: "Revogado",
    accepted: "Registrado",
    consented: "Consentido",
    acknowledged: "Ciência registrada",
    under_review: "Em análise",
    submitted: "Aguardando validação",
    pending: "Pendente",
    revision_requested: "Ajuste solicitado",
    sent: "Enviado",
    read: "Lida",
    open: "Aberta",
    reviewed: "Analisada",
    dismissed: "Descartada",
    actioned: "Conteúdo ocultado",
    needs_correction: "Precisa de correção",
    validated: "Validado",
};

const suindaFieldLabels: Record<string, string> = {
  code: "Código",
  discount_type: "Tipo de desconto",
  discount_value: "Valor do desconto",
  max_redemptions: "Limite de utilizações",
  category: "Categoria",
  tags: "Etiquetas",
  modality: "Modalidade",
  format: "Formato",
  level: "Nível",
  workload_mode: "Origem da carga horária",
  workload_hours: "Carga horária (horas)",
  certificate_min_grade: "Nota mínima para certificação (%)",
  intermediate_certificate_milestones: "Marcos para certificados intermediários",
  milestone_key: "Identificador do marco",
  milestone_title: "Nome do marco",
  required_lesson_ids: "Aulas necessárias para concluir o marco",
  attendance_justification_deadline_days: "Prazo para justificar falta (dias; 0 = sem prazo)",
  makeup_fee_amount: "Taxa de reposição (0 = sem taxa)",
  required_document_categories: "Documentos exigidos na matrícula",
  objectives: "Objetivos de aprendizagem",
  competencies: "Competências desenvolvidas",
  skills: "Habilidades desenvolvidas",
  prerequisites: "Pré-requisitos",
  prerequisite_course_ids: "Cursos pré-requisitos verificáveis",
  required_materials: "Materiais necessários",
  application_form_fields: "Campos do formulário de inscrição",
  instructor_ids: "Professores (IDs de usuário)",
  tutor_ids: "Tutores (IDs de usuário)",
  image_url: "Imagem de capa (URL)",
  price_amount: "Preço",
  currency: "Moeda",
  settings_key: "Chave da configuração institucional",
  certificate_kind: "Tipo de certificado",
  participation_scope: "Atividades abrangidas pela participação",
  institution_display_name: "Nome institucional exibido",
  default_attendance_min_percent: "Frequência mínima padrão (%)",
  default_certificate_min_grade: "Nota mínima adicional para certificação (%)",
  default_currency: "Moeda financeira padrão (ISO 4217)",
  default_installment_count: "Número padrão de parcelas",
  default_first_payment_due_days: "Dias até o primeiro vencimento",
  default_installment_interval_days: "Intervalo padrão entre parcelas (dias)",
  installment_count: "Número de parcelas",
  first_payment_due_days: "Vencimento da primeira parcela (dias)",
  installment_interval_days: "Intervalo entre parcelas (dias)",
  capacity: "Vagas",
  version: "Versão curricular ou da finalidade",
  enrollment_opens_at: "Início das inscrições",
  enrollment_closes_at: "Fim das inscrições",
  enrollment_confirmation_hours: "Prazo para confirmar matrícula (horas)",
  target_metric: "Indicador do desafio",
  target_value: "Meta do desafio",
  weekly_learning_goal_days: "Meta pessoal de dias ativos por semana",
  weekly_learning_goal_metric: "Indicador da meta pessoal semanal",
  weekly_learning_goal_target: "Valor da meta pessoal semanal",
  academic_reminders_enabled: "Receber lembretes acadêmicos",
  academic_session_reminder_minutes: "Aviso de encontro com antecedência",
  academic_deadline_reminder_hours: "Aviso de prazos com antecedência",
  academic_document_reminder_days: "Aviso de vencimento de documentos com antecedência",
  field_key: "Identificador do campo",
  field_type: "Tipo do campo",
  original_session_record_id: "Encontro em que houve a falta",
  replacement_session_record_id: "Encontro vinculado à reposição",
  preferred_at: "Data preferida para reposição",
  review_notes: "Orientação da coordenação",
  fee_amount: "Taxa da reposição",
  fee_currency: "Moeda da taxa",
  fee_status: "Situação da taxa",
  entry_type: "Tipo de lançamento",
  payment_method: "Forma de pagamento",
  payment_reference: "Referência do pagamento",
  amount: "Valor",
  recorded_by_user_id: "Registrado por",
  request_key: "Chave interna da solicitação",
  gamification_public_enabled: "Participar do ranking público de aprendizagem",
  starts_on: "Data de início",
  ends_on: "Data de término",
  course_record_id: "Registro do curso",
  course_revision: "Versão do curso",
  learner_user_id: "ID de usuário do aluno",
  staff_user_id: "ID da pessoa docente",
  professional_title: "Título profissional",
  biography: "Biografia profissional",
  qualifications: "Formação e qualificações",
  specialties: "Especialidades",
  website_url: "Site profissional",
  purpose_code: "Código estável da finalidade",
  purpose: "Finalidade do tratamento",
  data_categories: "Categorias de dados",
  subject_categories: "Categorias de titulares",
  request_type: "Direito solicitado",
  request_scope: "Dados ou tratamento relacionado",
  request_description: "Descrição da solicitação",
  response_summary: "Resumo da resposta",
  decision_reference: "Referência da decisão",
  legal_basis: "Base legal declarada pela instituição",
  legal_basis_detail: "Detalhamento da base legal",
  retention_description: "Prazo e critério de retenção",
  retention_period_days: "Prazo de retenção em dias (0 = revisão manual)",
  retention_record_kinds: "Tipos de registro abrangidos pelo prazo",
  notice_text: "Aviso de privacidade",
  notice_record_id: "Aviso de privacidade",
  academic_term_record_id: "Termo ou documento acadêmico",
  term_record_id: "Termo assinado",
  term_revision: "Revisão do termo",
  term_title_snapshot: "Título assinado",
  term_body_snapshot: "Conteúdo assinado",
  terms_sha256: "SHA-256 do documento",
  signature_evidence_sha256: "SHA-256 da evidência de assinatura",
  signer_name: "Nome de quem assinou",
  signed_at: "Assinado em",
  signature_method: "Método de assinatura",
  document_type: "Tipo do documento",
  signing_required: "Exigir assinatura",
  terms_version: "Versão do documento",
  terms_body: "Texto dos termos",
  signature_key: "Chave de assinatura",
  notice_revision: "Versão do aviso",
  consent_key: "Chave do registro",
  consent_status: "Tipo de registro",
  responded_at: "Respondido em",
  withdrawn_at: "Consentimento retirado em",
  purpose_snapshot: "Finalidade registrada",
  data_categories_snapshot: "Categorias de dados registradas",
  consent_required: "Consentimento necessário para esta finalidade",
  event_type: "Tipo de evento acadêmico",
  session_type: "Tipo de encontro",
  makeup_capacity: "Vagas para reposição (0 = não publicar)",
  all_day: "Evento de dia inteiro",
  public_profile_enabled: "Perfil profissional público",
  alumni_public_enabled: "Participar da comunidade de ex-alunos",
  application_answers: "Respostas da inscrição",
  institution_referral: "Instituição que indicou",
  coupon_code: "Cupom ou código de convite",
  discount_context: "Finalidade do benefício",
  partner_name: "Instituição/associação parceira",
  discount_context_snapshot: "Finalidade do benefício aplicada",
  discount_partner_snapshot: "Parceiro do benefício aplicado",
  coupon_record_id: "Cupom aplicado",
  discount_amount: "Desconto aplicado",
  amount_due: "Valor líquido da inscrição",
  submitted_at: "Enviado em",
  decision_reason: "Motivo da decisão",
  waitlist_position: "Posição na lista de espera",
  effective_by: "Confirmar matrícula até",
  payment_status: "Situação financeira",
  payment_entry_id: "Registro de pagamento",
  payment_key: "Chave do lançamento",
  attendance_percent: "Frequência (%)",
  grade: "Nota",
  completed_at: "Concluído em",
  position: "Ordem",
  summary: "Resumo",
  prerequisite_module_ids: "Módulos pré-requisitos",
  module_record_id: "Registro do módulo",
  unit_record_id: "Unidade de aprendizagem",
  institution_unit_record_id: "Unidade institucional",
  unit_code: "Código da unidade",
  unit_type: "Tipo de unidade",
  state_code: "UF",
  content_type: "Tipo de conteúdo",
  content_url: "Link do conteúdo",
  body_markdown: "Texto da aula (Markdown)",
  transcript: "Transcrição/legendas",
  transcript_reviewed: "Transcrição conferida por uma pessoa",
  captions_vtt: "Legendas do vídeo (WebVTT)",
  captions_language: "Idioma das legendas (BCP 47)",
  captions_label: "Nome da faixa de legendas",
  captions_reviewed: "Legendas conferidas por uma pessoa",
  provider_captions_confirmed: "Confirmar legendas do player externo",
  workload_minutes: "Duração (minutos)",
  required: "Obrigatório",
  downloadable: "Permitir download",
  release_at: "Disponível a partir de",
  cohort_record_id: "Registro da turma",
  instructor_user_id: "ID de usuário do professor",
  starts_at: "Começa em",
  ends_at: "Termina em",
  meeting_provider: "Serviço de reunião",
  meeting_url: "Link de acesso",
  location: "Local",
  room_record_id: "Sala",
  room_code: "Código da sala",
  room_name: "Nome da sala",
  max_occupancy: "Lotação máxima",
  floor: "Andar/bloco",
  accessibility: "Acessibilidade",
  address: "Endereço",
  latitude: "Latitude",
  longitude: "Longitude",
  geofence_radius_meters: "Raio de validação (metros)",
  geolocation_required: "Exigir geolocalização no check-in",
  geolocation_verified: "Localização validada",
  resources: "Recursos da sala",
  recording_url: "Gravação",
  reminder_sent_at: "Lembrete enviado em",
  enrollment_record_id: "Registro da matrícula",
  session_record_id: "Registro do encontro",
  status: "Situação",
  minutes_attended: "Minutos de presença",
  checkin_method: "Método de confirmação",
  justification_record_id: "Documento de justificativa",
  emergency_contact_name: "Nome do contato de emergência",
  emergency_contact_phone: "Telefone do contato de emergência",
  phone: "Telefone de contato",
  date_of_birth: "Data de nascimento",
  academic_background: "Formação e informações acadêmicas",
  education_level: "Escolaridade",
  institution: "Instituição de ensino",
  study_program: "Curso ou programa de estudos",
  preferred_contact: "Contato preferencial",
  notes: "Observações",
  assessment_record_id: "Registro da avaliação",
  assessment_type: "Tipo de avaliação",
  instructions: "Instruções",
  opens_at: "Disponível a partir de",
  time_limit_minutes: "Tempo limite (minutos)",
  max_attempts: "Tentativas permitidas",
  passing_score: "Nota mínima (%)",
  required_for_certificate: "Exigir aprovação para emitir certificado",
  question_set: "Questões próprias",
  question_bank_refs: "Bancos de questões",
  recovery_for_assessment_id: "Avaliação original para recuperação",
  recovery_for_assessment_revision: "Versão da avaliação original",
  record_id: "Banco de questões",
  revision: "Versão fixada",
  question_id: "ID da questão",
  difficulty: "Dificuldade da questão",
  question_category_filter: "Filtrar questões por categoria",
  question_difficulty_filter: "Filtrar questões por dificuldade",
  type: "Tipo da questão",
  prompt: "Enunciado",
  options: "Alternativas",
  correct_option_ids: "Alternativas corretas",
  points: "Pontuação",
  max_length: "Limite de caracteres",
  rubric: "Rubrica de avaliação",
  criterion: "Critério",
  criterion_id: "ID do critério",
  criterion_scores: "Pontuações da rubrica",
  description: "Descrição",
  group_submission: "Entrega em grupo",
  group_id: "ID do grupo",
  files: "Arquivos e documentos",
  answer: "Resposta",
  score: "Nota (%)",
  feedback: "Feedback do professor",
  grader_user_id: "ID de usuário do avaliador",
  late: "Entrega atrasada",
  supervisor_user_id: "ID de usuário do supervisor",
  scheduled_at: "Agendado para",
  hours_claimed: "Horas declaradas",
  hours_validated: "Horas validadas",
  activity_description: "Descrição da atividade",
  completion_notes: "Relato do aluno",
  observations: "Observações do supervisor",
  review_feedback: "Orientação da revisão",
  reviewed_at: "Revisado em",
  validated_by_user_id: "Validado por",
  validation_outcome: "Resultado da validação",
  certificate_code: "Código de validação",
  template_key: "Chave do modelo",
  organization_name: "Nome da instituição no certificado",
  certificate_title: "Título do certificado",
  opening_text: "Texto de abertura",
  completion_text: "Texto de conclusão",
  signers_label: "Rótulo das assinaturas",
  footer_text: "Texto do rodapé",
  accent_color: "Cor de destaque",
  border_color: "Cor da moldura",
  issued_at: "Emitido em",
  signer_names: "Responsáveis pela assinatura",
  file_record_id: "Registro do arquivo PDF",
  public_validation_enabled: "Permitir consulta pública",
  revocation_reason: "Motivo do cancelamento",
  program_record_id: "Registro do programa de bolsas",
  documents: "Documentos enviados",
  reviewer_user_id: "ID de usuário do avaliador",
  eligibility: "Critérios de elegibilidade",
  required_documents: "Documentos obrigatórios",
  scoring_criteria: "Critérios de pontuação",
  scoring_method: "Método de pontuação",
  max_points: "Pontuação máxima",
  guidance: "Orientação de avaliação",
  scoring_criteria_snapshot: "Rubrica fixada na candidatura",
  counterparty_requirements: "Contrapartidas",
  counterparty_requirements_snapshot: "Contrapartidas fixadas na candidatura",
  scholarship_application_id: "Candidatura aprovada",
  requirement_key: "Chave da contrapartida",
  requirement_text: "Exigência do programa",
  evidence_text: "Relato da evidência",
  evidence_files: "Comprovantes da contrapartida",
  course_record_ids: "Registros dos cursos",
  discount_percent: "Desconto (%)",
  available_places: "Vagas disponíveis",
  audience_type: "Público-alvo",
  audience_record_id: "Registro do público-alvo",
  body: "Mensagem",
  channel: "Canal de envio",
  sent_at: "Enviado em",
  requires_read_confirmation: "Confirmar leitura",
  template_code: "Código do modelo",
  target_record_id: "Registro relacionado",
  anonymous: "Respostas anônimas",
  questions: "Perguntas (JSON)",
  responses_close_at: "Encerramento das respostas",
  nps_enabled: "Incluir pergunta NPS",
  target_competencies: "Competências desenvolvidas",
  required_for_profiles: "Perfis com trilha obrigatória",
};
const suindaEnumLabels: Record<string, string> = {
  consent: "Consentimento", contract: "Execução de contrato", legal_obligation: "Obrigação legal", legitimate_interest: "Legítimo interesse", public_policy: "Política pública",
  academic_operations: "Operação acadêmica", public_profile: "Perfil público de colegas", alumni_community: "Comunidade de ex-alunos", gamification_ranking: "Ranking de gamificação", crm_contact_sync: "Sincronização de contato com CRM",
  beginner: "Iniciante",
  identity: "Identificação", education: "Formação acadêmica", enrollment: "Matrícula", payment: "Financeiro",
  online: "Online", in_person: "Presencial", hybrid: "Híbrida", open: "Livre", cohort: "Com turma",
  campus: "Campus", branch: "Filial", center: "Centro",
  introductory: "Introdutório", intermediate: "Intermediário", advanced: "Avançado", specialization: "Especialização",
  secondary: "Ensino médio", technical: "Técnico", undergraduate: "Graduação", postgraduate: "Pós-graduação", other_education: "Outro", not_informed: "Prefiro não informar",
  phone: "Telefone",
  not_required: "Não se aplica", pending: "Pendente", paid: "Pago", overdue: "Em atraso", refunded: "Reembolsado", waived: "Isento",
  video: "Vídeo", audio: "Áudio", article: "Texto ou artigo", pdf: "PDF ou apostila", presentation: "Apresentação", link: "Link externo", gallery: "Galeria de imagens", live: "Ao vivo",
  google_meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams", other: "Outro", none: "Sem serviço externo",
  present: "Presente", absent: "Ausente", justified: "Falta justificada", late: "Atrasado", early_departure: "Saída antecipada",
  manual: "Informada manualmente", qr: "QR Code", teacher: "Professor", geolocation: "Geolocalização",
  quiz: "Questionário", exam: "Prova", assignment: "Trabalho", project: "Projeto", practical: "Prática",
  approved: "Aprovada", rejected: "Recusada", returned: "Devolvida para ajuste", resubmitted: "Reenviada",
  workspace: "Workspace", course: "Curso", learner: "Aluno", internal: "Notificação interna", email: "E-mail", whatsapp: "WhatsApp", push: "Push",
  module: "Módulo", infrastructure: "Infraestrutura",
  curriculum: "Calculada pela estrutura curricular",
  weighted_v1: "Rubrica ponderada (0–1000)",
  holiday: "Feriado acadêmico",
  recess: "Recesso acadêmico",
  makeup: "Reposição de aula",
  percent: "Percentual",
  fixed: "Valor fixo",
  regular: "Encontro regular",
  completion: "Conclusão de curso",
  participation: "Participação parcial",
  "15": "15 minutos antes",
  "60": "1 hora antes",
  "360": "6 horas antes",
  "1440": "24 horas antes",
  "2880": "48 horas antes",
  "1": "1 hora antes",
  "6": "6 horas antes",
  "12": "12 horas antes",
  "24": "24 horas antes",
  "48": "48 horas antes",
  "3": "3 dias antes",
  "7": "7 dias antes",
  "14": "14 dias antes",
  "30": "30 dias antes",
  single_choice: "Escolha única", multiple_choice: "Escolha múltipla", short_answer: "Resposta curta", essay: "Discursiva",
};

const text = (maxLength = 4000) => ({ type: "string", minLength: 1, maxLength });
const optionalText = (maxLength = 4000) => ({ type: ["string", "null"], maxLength });
const date = { type: "string", format: "date" };
const dateTime = { type: "string", format: "date-time" };
const number = (minimum = 0, maximum = 100000) => ({ type: "number", minimum, maximum });
const integer = (minimum = 0, maximum = 100000) => ({ type: "integer", minimum, maximum });
const choice = (...values: string[]) => ({ enum: values });
const list = (maxItems = 100) => ({ type: "array", items: text(240), maxItems, uniqueItems: true });
const longTextList = (maxItems = 50, maxLength = 2000) => ({ type: "array", items: text(maxLength), maxItems, uniqueItems: true });
function enrollmentWindowOpen(payload: Record<string, unknown>, now = Date.now()) {
  const opensAt = typeof payload.enrollment_opens_at === "string" ? Date.parse(payload.enrollment_opens_at) : null;
  const closesAt = typeof payload.enrollment_closes_at === "string" ? Date.parse(payload.enrollment_closes_at) : null;
  return (opensAt === null || !Number.isFinite(opensAt) || opensAt <= now)
    && (closesAt === null || !Number.isFinite(closesAt) || closesAt > now);
}
const recordRef = (recordKind: string, optional = false, recordRevisionField?: string) => ({
  type: optional ? ["string", "null"] : "string", maxLength: 80, recordKind,
  ...(recordRevisionField ? { recordRevisionField } : {}),
});
const recordList = (recordKind: string, maxItems = 100) => ({
  type: "array", items: recordRef(recordKind), maxItems, uniqueItems: true,
});
const applicationFormField = {
  type: "object", additionalProperties: false, required: ["id", "label", "type"],
  properties: {
    id: { type: "string", pattern: "^[a-z][a-z0-9_]{1,39}$" },
    label: { type: "string", minLength: 1, maxLength: 120 },
    type: { enum: ["text", "textarea", "email", "phone", "number", "date", "select", "multiselect"], enumLabels: {
      text: "Texto curto", textarea: "Texto longo", email: "E-mail", phone: "Telefone", number: "Número", date: "Data", select: "Seleção única", multiselect: "Seleção múltipla",
    } },
    required: { type: "boolean" },
    options: { type: "array", items: { type: "string", minLength: 1, maxLength: 120 }, maxItems: 30, uniqueItems: true },
    max_length: { type: "integer", minimum: 1, maximum: 4000 },
  },
};
const object = (properties: Record<string, Record<string, unknown>>, required: string[]) => ({
  type: "object", additionalProperties: false,
  properties: Object.fromEntries(Object.entries(properties).map(([key, schema]) => {
    const enumLabels = Array.isArray(schema.enum)
      ? Object.fromEntries(schema.enum.filter((value): value is string => typeof value === "string" && Boolean(suindaEnumLabels[value])).map((value) => [value, suindaEnumLabels[value]]))
      : undefined;
    return [key, {
      ...schema,
      ...(!schema.title && suindaFieldLabels[key] ? { title: suindaFieldLabels[key] } : {}),
      ...(enumLabels && Object.keys(enumLabels).length ? { enumLabels } : {}),
    }];
  })),
  required,
});

function kind(
  label: string,
  properties: Record<string, Record<string, unknown>>,
  required: string[],
  initial: string,
  transitions: Record<string, string[]>,
  example: Record<string, unknown>,
  immutable: string[] = [],
): RecordKindContribution {
  return {
    label,
    schema: object(properties, required),
    initial,
    transitions,
    stateLabels: Object.fromEntries(Object.keys(transitions).filter((state) => suindaStateLabels[state]).map((state) => [state, suindaStateLabels[state]])),
    immutable,
    example,
  };
}

function learnerPrivateRecord(ownerField = "learner_user_id", allowSelfCreate = true, selfPublishStates: string[] = []): Pick<RecordKindContribution, "resourceScoped" | "managePermission" | "personalOwnerField" | "authorizeCreate" | "authorizeRecord"> {
  return {
    resourceScoped: true,
    managePermission: "plugin.suinda-learning.manage",
    personalOwnerField: ownerField,
    authorizeCreate: async (actor, payload, context) =>
      allowSelfCreate && payload[ownerField] === actor || Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.write")),
    authorizeRecord: async (actor, action, state, payload, context) => {
      if (payload[ownerField] === actor && (action === "read" || action === "write" && state === "draft" || action === "publish" && (state === "draft" || selfPublishStates.includes(state)))) return true;
      return Boolean(
        context.recordId && await context.hasPermissionOnResource?.(`plugin.suinda-learning.${action}`, context.recordId)
          || await context.hasWorkspacePermission?.(`plugin.suinda-learning.${action}`),
      );
    },
  };
}

function enrollmentHasOutstandingPrice(enrollmentPayload: Record<string, unknown>, coursePayload: Record<string, unknown>) {
  return Number(enrollmentPayload.amount_due ?? coursePayload.price_amount ?? 0) > 0
    && !["paid", "waived"].includes(String(enrollmentPayload.payment_status || ""));
}

const institutionUnit = kind("Unidade institucional", {
  unit_code: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$", description: "Código único desta unidade dentro do workspace." },
  unit_type: choice("campus", "branch", "center", "online", "other"),
  address: optionalText(500), city: optionalText(120), state_code: { type: ["string", "null"], pattern: "^$|^[A-Z]{2}$" },
  contact_email: { type: ["string", "null"], format: "email", maxLength: 255 }, contact_phone: optionalText(40),
}, ["unit_code", "unit_type"], "draft", { draft: ["published", "archived"], published: ["archived"], archived: [] },
{ unit_code: "REC-01", unit_type: "campus", address: null, city: null, state_code: null, contact_email: null, contact_phone: null }, ["unit_code"]);
institutionUnit.validate = async (payload, context) => {
  const code = String(payload.unit_code || "").toLocaleLowerCase("pt-BR");
  const units = await context.listLatestRecords?.("suinda-learning", "institution_unit", {}, undefined, 1000,
    `suinda-unit-code:${code}`);
  if (!units) return [{ severity: "error", code: "institution_unit.uniqueness_unavailable", path: "unit_code", message: "Não foi possível verificar a unicidade do código da unidade. Tente novamente." }];
  if (units?.some((unit) => unit.id !== context.recordId && String(unit.payload.unit_code || "").toLocaleLowerCase("pt-BR") === code))
    return [{ severity: "error", code: "institution_unit.code_duplicate", path: "unit_code", message: "Já existe uma unidade com este código neste workspace." }];
  return [];
};
institutionUnit.resourceScoped = true;
institutionUnit.managePermission = "plugin.suinda-learning.manage";
institutionUnit.authorizeCreate = async (_actor, _payload, context) =>
  Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"));
institutionUnit.authorizeRecord = async (_actor, action, _state, _payload, context) =>
  Boolean(context.recordId && await context.hasPermissionOnResource?.(`plugin.suinda-learning.${action}`, context.recordId)
    || context.recordId && await context.hasPermissionOnResource?.("plugin.suinda-learning.manage", context.recordId)
    || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"));
institutionUnit.uniqueFields = ["unit_code"];

const course = kind("Curso", {
  institution_unit_record_id: recordRef("institution_unit", true),
  code: text(80), summary: text(1000), description: text(20000), category: text(160), tags: list(),
  modality: choice("online", "in_person", "hybrid"), format: choice("open", "cohort"), level: choice("introductory", "intermediate", "advanced", "specialization"),
  workload_mode: { ...choice("manual", "curriculum"), description: "No modo curricular, a carga horária é somada das durações das aulas publicadas na revisão do curso." },
  workload_hours: { ...number(0, 10000), description: "Obrigatória no modo manual. No modo curricular, o valor informado aqui não substitui o total calculado." },
  attendance_min_percent: number(0, 100), certificate_min_grade: { ...number(0, 100), description: "Nota mínima adicional exigida em cada avaliação obrigatória para emissão do certificado. Zero usa somente a nota mínima de cada avaliação." }, attendance_justification_deadline_days: { ...integer(0, 365), description: "Prazo em dias após o término do encontro para enviar comprovante de falta. Zero mantém o prazo aberto." }, required_document_categories: { type: "array", items: choice("identity", "education", "enrollment", "payment", "other"), maxItems: 5, uniqueItems: true }, objectives: list(40), competencies: list(100), skills: list(100), prerequisites: list(40), prerequisite_course_ids: recordList("course", 20), required_materials: list(80), instructor_ids: list(100),
  intermediate_certificate_milestones: { type: "array", maxItems: 20, uniqueItems: false, description: "Marcos opcionais desta revisão. Cada certificado é emitido quando o aluno concluir todas as aulas selecionadas.", items: { type: "object", additionalProperties: false, properties: {
    milestone_key: { type: "string", pattern: "^[a-z][a-z0-9_-]{1,39}$", title: "Identificador do marco" },
    milestone_title: { ...text(120), title: "Nome do marco" },
    required_lesson_ids: { ...recordList("lesson", 50), title: "Aulas necessárias" },
  }, required: ["milestone_key", "milestone_title", "required_lesson_ids"] } },
  makeup_fee_amount: { ...number(0, 1000000), description: "Taxa por solicitação de reposição de encontro, na moeda do curso. Zero não cobra taxa." },
  application_form_fields: { type: "array", items: applicationFormField, maxItems: 30 },
  image_url: optionalText(2000), price_amount: number(0, 10000000), currency: text(3),
  installment_count: { type: "integer", minimum: 1, maximum: 24, description: "Quantidade total de parcelas iguais, incluindo a primeira. Padrão: 1 (à vista)." },
  first_payment_due_days: { type: "integer", minimum: 0, maximum: 90, description: "Dias após a inscrição até o vencimento da primeira parcela. Padrão: 0." },
  installment_interval_days: { type: "integer", minimum: 1, maximum: 365, description: "Intervalo entre vencimentos das parcelas. Padrão: 30 dias." },
  capacity: integer(0, 100000), version: integer(1, 10000),
  enrollment_opens_at: dateTime, enrollment_closes_at: dateTime, starts_on: date, ends_on: date,
  enrollment_confirmation_hours: { ...integer(1, 720), description: "Prazo em horas para o aluno confirmar uma vaga aprovada. Padrão: 72 horas." },
}, ["code", "description", "modality", "format", "version"], "draft", {
  draft: ["published", "archived"], published: ["enrollment_open", "archived"], enrollment_open: ["in_progress", "closed", "archived"],
  in_progress: ["completed", "canceled"], closed: ["archived"], completed: ["archived"], canceled: ["archived"], archived: [],
}, { code: "CURSO-001", description: "Curso de demonstração", modality: "online", format: "cohort", workload_mode: "manual", workload_hours: 12, version: 1, currency: "BRL", enrollment_confirmation_hours: 72, installment_count: 1, first_payment_due_days: 0, installment_interval_days: 30, certificate_min_grade: 0 }, ["code"]);
course.validate = (payload) => {
  const issues: Awaited<ReturnType<Validator>> = payload.workload_mode === "curriculum" || Number(payload.workload_hours) > 0
    ? []
    : [{ severity: "error", code: "course.workload_required", path: "workload_hours", message: "Informe uma carga horária manual maior que zero ou selecione o cálculo pela estrutura curricular." }];
  if (Number(payload.price_amount || 0) <= 0 && Number(payload.installment_count || 1) > 1)
    issues.push({ severity: "error", code: "course.installments_without_price", path: "installment_count", message: "Parcelamento só pode ser configurado para cursos pagos." });
  const fields = Array.isArray(payload.application_form_fields) ? payload.application_form_fields as Array<Record<string, unknown>> : [];
  const ids = new Set<string>();
  fields.forEach((field, index) => {
    const fieldId = typeof field.id === "string" ? field.id : "";
    if (ids.has(fieldId)) issues.push({ severity: "error", code: "application_form.duplicate_field", path: `application_form_fields.${index}.id`, message: "Cada campo do formulário precisa ter um identificador único." });
    ids.add(fieldId);
    if (["select", "multiselect"].includes(String(field.type)) && (!Array.isArray(field.options) || field.options.length < 1))
      issues.push({ severity: "error", code: "application_form.options_required", path: `application_form_fields.${index}.options`, message: "Campos de seleção precisam ter ao menos uma opção." });
  });
  return issues;
};
const validateIntermediateMilestones = async (payload: Record<string, unknown>, context: RecordValidationContext) => {
  const milestones = Array.isArray(payload.intermediate_certificate_milestones)
    ? payload.intermediate_certificate_milestones as Array<Record<string, unknown>> : [];
  const issues: Array<{ severity: "error"; code: string; path: string; message: string }> = [];
  const keys = new Set<string>();
  for (const [index, milestone] of milestones.entries()) {
    const path = `intermediate_certificate_milestones.${index}`;
    const key = typeof milestone.milestone_key === "string" ? milestone.milestone_key.trim() : "";
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(key) || keys.has(key)) {
      issues.push({ severity: "error", code: "course.intermediate_certificate_key_invalid", path: `${path}.milestone_key`, message: "Use identificadores únicos, iniciados por letra e com até 40 caracteres." });
    }
    keys.add(key);
    if (typeof milestone.milestone_title !== "string" || !milestone.milestone_title.trim())
      issues.push({ severity: "error", code: "course.intermediate_certificate_title_required", path: `${path}.milestone_title`, message: "Informe o nome do marco intermediário." });
    const lessonIds = Array.isArray(milestone.required_lesson_ids) ? milestone.required_lesson_ids.filter((value): value is string => typeof value === "string") : [];
    if (!lessonIds.length || lessonIds.length > 50 || new Set(lessonIds).size !== lessonIds.length) {
      issues.push({ severity: "error", code: "course.intermediate_certificate_lessons_invalid", path: `${path}.required_lesson_ids`, message: "Selecione de uma a cinquenta aulas distintas para o marco." });
      continue;
    }
    if (!context.resolveLatestRecord) continue;
    for (const [lessonIndex, lessonId] of lessonIds.entries()) {
      const lessonRecord = await context.resolveLatestRecord(lessonId);
      const moduleId = typeof lessonRecord?.payload.module_record_id === "string" ? lessonRecord.payload.module_record_id : "";
      const moduleRecord = moduleId ? await context.resolveLatestRecord(moduleId) : null;
      if (lessonRecord?.pluginId !== "suinda-learning" || lessonRecord.kind !== "lesson"
        || moduleRecord?.pluginId !== "suinda-learning" || moduleRecord.kind !== "module"
        || moduleRecord.payload.course_record_id !== context.recordId
        || Number(moduleRecord.payload.course_version) !== Number(payload.version)) {
        issues.push({ severity: "error", code: "course.intermediate_certificate_lesson_course_mismatch", path: `${path}.required_lesson_ids.${lessonIndex}`, message: "Cada aula precisa pertencer a um módulo desta versão do curso." });
      }
    }
  }
  return issues;
};
course.validate = combine(course.validate!, validateIntermediateMilestones);
course.validate = combine(course.validate!, publishedInstitutionUnit("institution_unit_record_id"), stableUnitAssignment("course_record_id"));
course.uniqueFields = ["code"];
course.immutablePayloadFieldsAfterInitial = ["code"];
course.defaultsForCreate = async (_payload, context) => {
  const records = await context.listLatestRecords?.("suinda-learning", "institution_settings", { settings_key: "institution" }, "published", 1);
  const settings = records?.[0]?.payload;
  if (!settings) return {};
  return {
    attendance_min_percent: settings.default_attendance_min_percent,
    certificate_min_grade: settings.default_certificate_min_grade,
    currency: settings.default_currency,
    installment_count: settings.default_installment_count,
    first_payment_due_days: settings.default_first_payment_due_days,
    installment_interval_days: settings.default_installment_interval_days,
  };
};
course.publicRead = {
  states: ["published", "enrollment_open", "in_progress", "closed", "completed"],
  fields: ["code", "summary", "description", "category", "tags", "modality", "format", "level", "workload_mode", "workload_hours", "attendance_min_percent", "attendance_justification_deadline_days", "makeup_fee_amount", "required_document_categories", "application_form_fields", "objectives", "competencies", "skills", "prerequisites", "prerequisite_course_ids", "required_materials", "image_url", "price_amount", "currency", "installment_count", "first_payment_due_days", "installment_interval_days", "version", "capacity", "enrollment_opens_at", "enrollment_closes_at", "starts_on", "ends_on"],
};

// One versioned institutional policy per Suindá workspace. Course values remain
// explicit overrides; consumers can adopt these defaults without changing the
// existing course-level contract.
const institutionSettings = kind("Configuração institucional", {
  settings_key: { type: "string", const: "institution" },
  institution_display_name: optionalText(180),
  default_attendance_min_percent: number(0, 100),
  default_certificate_min_grade: number(0, 100),
  default_currency: { type: "string", pattern: "^[A-Z]{3}$", minLength: 3, maxLength: 3 },
  default_installment_count: integer(1, 24),
  default_first_payment_due_days: integer(0, 90),
  default_installment_interval_days: integer(1, 365),
}, ["settings_key", "default_attendance_min_percent", "default_certificate_min_grade", "default_currency", "default_installment_count", "default_first_payment_due_days", "default_installment_interval_days"], "draft",
{ draft: ["published", "archived"], published: ["archived"], archived: [] },
{ settings_key: "institution", institution_display_name: null, default_attendance_min_percent: 75, default_certificate_min_grade: 0, default_currency: "BRL", default_installment_count: 1, default_first_payment_due_days: 0, default_installment_interval_days: 30 });
institutionSettings.resourceScoped = true;
institutionSettings.managePermission = "plugin.suinda-learning.manage";
institutionSettings.uniqueFields = ["settings_key"];
institutionSettings.immutablePayloadFieldsAfterInitial = ["settings_key"];
institutionSettings.authorizeCreate = async (_actor, _payload, context) =>
  Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"));
institutionSettings.authorizeRecord = async (_actor, action, _state, _payload, context) =>
  Boolean(context.recordId && await context.hasPermissionOnResource?.(`plugin.suinda-learning.${action}`, context.recordId)
    || await context.hasWorkspacePermission?.(`plugin.suinda-learning.${action}`));

const cohort = kind("Turma", {
  institution_unit_record_id: recordRef("institution_unit", true),
  course_record_id: recordRef("course", false, "course_revision"), course_revision: integer(1), code: text(80), instructor_ids: list(100), tutor_ids: list(100), preceptor_ids: list(100), coordinator_ids: list(100),
  price_amount: { ...number(0, 10000000), description: "Preço desta turma. Deixe vazio para herdar o preço do curso; a moeda é a configurada no curso." },
  enrollment_opens_at: dateTime, enrollment_closes_at: dateTime, starts_at: dateTime, ends_at: dateTime,
  capacity: integer(1, 100000), location: optionalText(1000), meeting_url: optionalText(2000), schedule: list(100),
  required_document_categories: { type: "array", items: choice("identity", "education", "enrollment", "payment", "other"), maxItems: 5, uniqueItems: true },
}, ["course_record_id", "course_revision", "code", "starts_at", "ends_at", "capacity"], "draft", {
  draft: ["enrolling", "canceled"], enrolling: ["active", "closed", "canceled"], active: ["completed", "paused", "canceled"],
  paused: ["active", "canceled"], closed: ["archived"], completed: ["archived"], canceled: ["archived"], archived: [],
}, { course_record_id: "course-record-id", course_revision: 1, code: "TURMA-001", starts_at: "2030-01-01T12:00:00Z", ends_at: "2030-02-01T12:00:00Z", capacity: 30 }, ["course_record_id", "course_revision", "code"]);
cohort.publicRead = {
  states: ["enrolling"],
  fields: ["course_record_id", "course_revision", "institution_unit_record_id", "code", "price_amount", "enrollment_opens_at", "enrollment_closes_at", "starts_at", "ends_at", "capacity", "location", "schedule", "required_document_categories"],
};
cohort.seatAvailability = {
  capacityField: "capacity", reservationKind: "enrollment", relationField: "cohort_record_id",
  reservedStates: ["approved", "enrolled", "active", "paused"], outputField: "seats_remaining",
};

const enrollmentCoupon = kind("Cupom ou código de convite", {
  code: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{3,39}$", description: "Código sem espaços, entre 4 e 40 caracteres." },
  discount_context: choice("promotion", "institutional_agreement", "member_discount"), partner_name: { type: ["string", "null"], maxLength: 180 },
  discount_type: choice("percent", "fixed"), discount_value: number(0.01, 100000),
  course_record_id: recordRef("course", true), starts_at: { type: ["string", "null"], format: "date-time" },
  ends_at: { type: ["string", "null"], format: "date-time" }, max_redemptions: integer(1, 1000000),
}, ["code", "discount_type", "discount_value", "max_redemptions"], "draft",
{ draft: ["published", "archived"], published: ["archived"], archived: [] },
{ code: "SUINDA2026", discount_context: "promotion", partner_name: null, discount_type: "percent", discount_value: 10, course_record_id: null,
  starts_at: null, ends_at: null, max_redemptions: 100 });
enrollmentCoupon.resourceScoped = true;
enrollmentCoupon.managePermission = "plugin.suinda-learning.manage";
enrollmentCoupon.uniqueFields = ["code"];
enrollmentCoupon.immutablePayloadFieldsAfterInitial = ["code"];
enrollmentCoupon.validate = async (payload, context) => {
  const contextType = ["institutional_agreement", "member_discount"].includes(String(payload.discount_context))
    ? String(payload.discount_context) : "promotion";
  if (contextType !== "promotion" && !(typeof payload.partner_name === "string" && payload.partner_name.trim()))
    return [{ severity: "error", code: "coupon.partner.required", path: "partner_name", message: "Informe a instituição ou associação parceira do benefício." }];
  if (payload.discount_type === "percent" && Number(payload.discount_value) > 100)
    return [{ severity: "error", code: "coupon.discount_percent.invalid", path: "discount_value", message: "O desconto percentual não pode passar de 100%." }];
  const start = typeof payload.starts_at === "string" ? Date.parse(payload.starts_at) : null;
  const end = typeof payload.ends_at === "string" ? Date.parse(payload.ends_at) : null;
  if (start !== null && end !== null && start >= end)
    return [{ severity: "error", code: "coupon.window.invalid", path: "ends_at", message: "O encerramento precisa ocorrer depois do início." }];
  if (typeof payload.course_record_id === "string" && context.resolveLatestRecord) {
    const course = await context.resolveLatestRecord(payload.course_record_id);
    if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course")
      return [{ severity: "error", code: "coupon.course.invalid", path: "course_record_id", message: "Selecione um curso deste plugin." }];
  }
  return [];
};

const enrollment = kind("Inscrição e matrícula", {
  course_record_id: recordRef("course", false, "course_revision"), course_revision: integer(1), cohort_record_id: recordRef("cohort", true), cohort_revision: integer(1), institution_unit_record_id: recordRef("institution_unit", true), learner_user_id: text(80), application_answers: { type: "object" }, institution_referral: optionalText(180), coupon_code: { type: ["string", "null"], maxLength: 40 }, coupon_record_id: recordRef("enrollment_coupon", true), coupon_code_snapshot: optionalText(40), discount_context_snapshot: { type: ["string", "null"], enum: ["promotion", "institutional_agreement", "member_discount", null] }, discount_partner_snapshot: { type: ["string", "null"], maxLength: 180 }, discount_amount: number(0, 1000000), amount_due: number(0, 1000000), amount_due_currency: text(3),
  submitted_at: dateTime, decision_reason: optionalText(4000), waitlist_position: integer(1), payment_status: choice("not_required", "pending", "paid", "overdue", "refunded", "waived"),
  attendance_percent: number(0, 100), grade: number(0, 100), completed_at: dateTime, effective_by: dateTime,
}, ["course_record_id", "course_revision", "learner_user_id"], "application_draft", {
  application_draft: ["submitted", "withdrawn"], submitted: ["approved", "waitlisted", "rejected", "withdrawn"], waitlisted: ["approved", "rejected", "withdrawn"],
  approved: ["enrolled", "withdrawn", "expired"], enrolled: ["active", "paused", "withdrawn"], active: ["paused", "completed", "failed", "withdrawn"],
  paused: ["active", "withdrawn"], completed: [], failed: ["completed"], rejected: [], withdrawn: [],
}, { course_record_id: "course-record-id", course_revision: 1, learner_user_id: "user-id", payment_status: "not_required" });
Object.assign(enrollment, learnerPrivateRecord());
enrollment.selfServiceCreate = true;
enrollment.defaultsForCreate = async (payload, context) => {
  let cohort = typeof payload.cohort_record_id === "string" ? await context.resolveLatestRecord?.(payload.cohort_record_id) : null;
  if (cohort?.pluginId !== "suinda-learning" || cohort.kind !== "cohort") cohort = null;
  const courseId = typeof payload.course_record_id === "string" ? payload.course_record_id
    : typeof cohort?.payload.course_record_id === "string" ? cohort.payload.course_record_id : null;
  const course = courseId ? await context.resolveLatestRecord?.(courseId) : null;
  if (courseId && context.listLatestRecords) {
    const locked = await context.listLatestRecords("suinda-learning", "enrollment", { course_record_id: courseId }, undefined, 1,
      `suinda-unit-assignment:course_record_id:${courseId}`);
    if (!locked) throw new Error("Could not lock course enrollment unit assignment.");
  }
  if (cohort && context.listLatestRecords) {
    const locked = await context.listLatestRecords("suinda-learning", "enrollment", { cohort_record_id: cohort.id }, undefined, 1,
      `suinda-unit-assignment:cohort_record_id:${cohort.id}`);
    if (!locked) throw new Error("Could not lock cohort enrollment unit assignment.");
  }
  const courseUnit = course?.pluginId === "suinda-learning" && course.kind === "course" ? course.payload.institution_unit_record_id : null;
  const cohortUnit = cohort?.payload.institution_unit_record_id;
  return { institution_unit_record_id: typeof cohortUnit === "string" ? cohortUnit : typeof courseUnit === "string" ? courseUnit : null };
};
enrollment.immutablePayloadFieldsAfterInitial = ["course_record_id", "course_revision", "learner_user_id", "cohort_record_id", "cohort_revision", "institution_referral",
  "coupon_record_id", "coupon_code_snapshot", "discount_context_snapshot", "discount_partner_snapshot", "discount_amount", "amount_due", "amount_due_currency"];
const enrollmentSeatStates = ["approved", "enrolled", "active", "paused"];

const learnerProfile = kind("Perfil acadêmico do aluno", {
  learner_user_id: text(80), phone: optionalText(40), preferred_contact: choice("email", "phone"), date_of_birth: { type: ["string", "null"], format: "date" },
  education_level: choice("secondary", "technical", "undergraduate", "postgraduate", "other_education", "not_informed"),
  institution: optionalText(180), study_program: optionalText(180), academic_background: optionalText(4000),
  emergency_contact_name: optionalText(120), emergency_contact_phone: optionalText(40),
  public_profile_enabled: { type: "boolean" }, public_bio: optionalText(500), public_interests: optionalText(300),
  alumni_public_enabled: { type: "boolean" },
  gamification_public_enabled: { type: "boolean", title: "Participar do ranking público de aprendizagem" },
  weekly_learning_goal_days: { type: "integer", minimum: 1, maximum: 7, title: "Meta pessoal de dias ativos por semana" },
  weekly_learning_goal_metric: choice("study_days", "lessons", "attendance", "practice_hours"),
  weekly_learning_goal_target: { type: "number", minimum: 0.5, maximum: 40 },
  academic_reminders_enabled: { type: "boolean", title: "Receber lembretes acadêmicos" },
  academic_session_reminder_minutes: choice("15", "60", "360", "1440", "2880"),
  academic_deadline_reminder_hours: choice("1", "6", "12", "24", "48"),
  academic_document_reminder_days: choice("3", "7", "14", "30"),
  custom_fields: { type: "object", maxProperties: 40, additionalProperties: { type: ["string", "number", "boolean", "array", "null"] } },
}, ["learner_user_id"], "draft", { draft: ["archived"], archived: [] }, { learner_user_id: "user-id" });
learnerProfile.resourceScoped = true;
learnerProfile.managePermission = "plugin.suinda-learning.manage";
learnerProfile.personalOwnerField = "learner_user_id";
learnerProfile.uniqueFields = ["learner_user_id"];
learnerProfile.sensitiveFields = learnerProfileSensitiveFields;
learnerProfile.validate = async (payload, context) => {
  const goalMetric = payload.weekly_learning_goal_metric || "study_days";
  const legacyGoalDays = Number.isInteger(payload.weekly_learning_goal_days) ? Number(payload.weekly_learning_goal_days) : 3;
  const goalTarget = payload.weekly_learning_goal_target === undefined ? legacyGoalDays : Number(payload.weekly_learning_goal_target);
  const validGoal = goalMetric === "study_days" || goalMetric === "attendance"
    ? Number.isInteger(goalTarget) && goalTarget >= 1 && goalTarget <= 7
    : goalMetric === "lessons" ? Number.isInteger(goalTarget) && goalTarget >= 1 && goalTarget <= 21
      : goalMetric === "practice_hours" && Number.isFinite(goalTarget) && goalTarget >= 0.5 && goalTarget <= 40
        && Math.round(goalTarget * 2) === goalTarget * 2;
  if (!validGoal) return [{ severity: "error", code: "learner_profile.weekly_goal.invalid", path: "weekly_learning_goal_target",
    message: "Defina uma meta válida para o indicador semanal selecionado." }];
  const custom = payload.custom_fields;
  if (custom === undefined) return [];
  if (!custom || typeof custom !== "object" || Array.isArray(custom))
    return [{ severity: "error", code: "learner_profile.custom_fields.invalid", path: "custom_fields", message: "Os campos personalizados do perfil são inválidos." }];
  const definitions = await context.listLatestRecords?.("suinda-learning", "learner_profile_field", {}, undefined, 200);
  const fields = definitions || [];
  const byKey = new Map(fields.map((record) => [String(record.payload.field_key), record]));
  const values = custom as Record<string, unknown>;
  const reserved = new Set(["learner_user_id", "phone", "preferred_contact", "date_of_birth", "education_level", "institution", "study_program", "academic_background", "emergency_contact_name", "emergency_contact_phone", "public_profile_enabled", "alumni_public_enabled", "public_bio", "public_interests", "gamification_public_enabled", "weekly_learning_goal_days", "weekly_learning_goal_metric", "weekly_learning_goal_target", "academic_reminders_enabled", "academic_session_reminder_minutes", "academic_deadline_reminder_hours", "academic_document_reminder_days", "custom_fields"]);
  for (const [key, value] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key) || reserved.has(key) || !field)
      return [{ severity: "error", code: "learner_profile.custom_fields.unknown", path: `custom_fields.${key}`, message: "O perfil contém um campo que não está configurado para esta instituição." }];
    const definition = field.payload;
    const isEmpty = value === null || value === "" || value === undefined;
    const missingRequired = definition.field_type === "checkbox" ? value !== true
      : definition.field_type === "multiselect" ? !Array.isArray(value) || value.length === 0 : isEmpty;
    if (field.state === "published" && definition.required === true && missingRequired)
      return [{ severity: "error", code: "learner_profile.custom_fields.required", path: `custom_fields.${key}`, message: `Preencha o campo obrigatório ${String(definition.label)}.` }];
    if (isEmpty) continue;
    const type = String(definition.field_type);
    const options = Array.isArray(definition.options) ? definition.options.map(String) : [];
    const maxLength = Number(definition.max_length || (type === "textarea" ? 2000 : 240));
    const valid = type === "text" || type === "textarea" || type === "phone"
      ? typeof value === "string" && value.length <= maxLength
      : type === "date" ? typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      : type === "number" ? typeof value === "number" && Number.isFinite(value)
      : type === "checkbox" ? typeof value === "boolean"
      : type === "select" ? typeof value === "string" && options.includes(value)
      : type === "multiselect" ? Array.isArray(value) && value.length <= options.length && value.every((entry) => typeof entry === "string" && options.includes(entry))
      : false;
    if (!valid) return [{ severity: "error", code: "learner_profile.custom_fields.type", path: `custom_fields.${key}`, message: `O valor do campo ${String(definition.label)} não corresponde à configuração.` }];
  }
  for (const [key, field] of byKey) {
    const value = values[key];
    const missingRequired = field.payload.field_type === "checkbox" ? value !== true
      : field.payload.field_type === "multiselect" ? !Array.isArray(value) || value.length === 0
        : value === undefined || value === null || value === "";
    if (field.state === "published" && field.payload.required === true && missingRequired)
      return [{ severity: "error", code: "learner_profile.custom_fields.required", path: `custom_fields.${key}`, message: `Preencha o campo obrigatório ${String(field.payload.label)}.` }];
  }
  return [];
};

const learnerProfileField = kind("Campo personalizado do perfil acadêmico", {
  field_key: { type: "string", pattern: "^[a-z][a-z0-9_]{1,39}$" },
  label: { type: "string", minLength: 1, maxLength: 120 },
  field_type: { enum: ["text", "textarea", "phone", "date", "number", "select", "multiselect", "checkbox"], enumLabels: { text: "Texto curto", textarea: "Texto longo", phone: "Telefone", date: "Data", number: "Número", select: "Seleção única", multiselect: "Seleção múltipla", checkbox: "Sim ou não" } },
  required: { type: "boolean" },
  options: { type: "array", maxItems: 30, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 120 } },
  max_length: { type: "integer", minimum: 1, maximum: 2000 },
  position: { type: "integer", minimum: 0, maximum: 10000 },
}, ["field_key", "label", "field_type", "required", "position"], "draft", { draft: ["published", "archived"], published: ["draft", "archived"], archived: [] }, {
  field_key: "preferred_name", label: "Nome preferido", field_type: "text", required: false, options: [], position: 0,
});
learnerProfileField.uniqueFields = ["field_key"];
learnerProfileField.resourceScoped = true;
learnerProfileField.managePermission = "plugin.suinda-learning.manage";
learnerProfileField.validate = async (payload) => {
  if (["select", "multiselect"].includes(String(payload.field_type)) && (!Array.isArray(payload.options) || !payload.options.length))
    return [{ severity: "error", code: "learner_profile_field.options.required", path: "options", message: "Campos de seleção precisam de pelo menos uma opção." }];
  if (!(["text", "textarea"].includes(String(payload.field_type))) && payload.max_length !== undefined)
    return [{ severity: "error", code: "learner_profile_field.max_length.invalid", path: "max_length", message: "O limite de caracteres só se aplica a campos de texto." }];
  return [];
};
learnerProfile.authorizeCreate = async (actor, payload, context) => {
  if (await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")) return true;
  if (payload.learner_user_id !== actor) return false;
  const enrollments = await context.listLatestRecords?.("suinda-learning", "enrollment", { learner_user_id: actor }, undefined, 500);
  return Boolean(enrollments?.some((record) => ["application_draft", "submitted", "waitlisted", "approved", "enrolled", "active", "paused", "completed"].includes(record.state)));
};
learnerProfile.authorizeRecord = async (actor, action, state, payload, context) => {
  if (payload.learner_user_id === actor && (action === "read" || action === "write" && state === "draft")) return true;
  return Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage")
    || context.recordId && await context.hasPermissionOnResource?.("plugin.suinda-learning.manage", context.recordId));
};

const staffProfile = kind("Perfil profissional da equipe docente", {
  staff_user_id: text(80), professional_title: optionalText(180), biography: optionalText(4000),
  qualifications: optionalText(4000), specialties: list(30), website_url: optionalText(2000),
  public_profile_enabled: { type: "boolean" }, staff_role: choice("instructor", "preceptor", "coordinator", "tutor"),
  recurring_availability: { type: "array", items: { type: "object", properties: {
    weekday: integer(0, 6), start_time: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    end_time: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, timezone: text(80),
  }, required: ["weekday", "start_time", "end_time", "timezone"], additionalProperties: false }, maxItems: 42 },
}, ["staff_user_id"], "draft", { draft: ["archived"], archived: [] },
{ staff_user_id: "user-id", professional_title: "Docente", biography: null, qualifications: null, specialties: [], website_url: null, public_profile_enabled: false, staff_role: "instructor", recurring_availability: [] });
staffProfile.resourceScoped = true;
staffProfile.managePermission = "plugin.suinda-learning.manage";
staffProfile.personalOwnerField = "staff_user_id";
staffProfile.uniqueFields = ["staff_user_id"];
staffProfile.authorizeCreate = async (actor, payload, context) => {
  if (await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")) return true;
  if (payload.staff_user_id !== actor || !context.listLatestRecords) return false;
  const [courses, cohorts] = await Promise.all([
    context.listLatestRecords("suinda-learning", "course", {}, undefined, 500),
    context.listLatestRecords("suinda-learning", "cohort", {}, undefined, 500),
  ]);
  return Boolean(courses?.some((record) => Array.isArray(record.payload.instructor_ids) && record.payload.instructor_ids.includes(actor))
    || cohorts?.some((record) => [record.payload.instructor_ids, record.payload.tutor_ids, record.payload.preceptor_ids, record.payload.coordinator_ids].some((members) => Array.isArray(members) && members.includes(actor))));
};
staffProfile.authorizeRecord = async (actor, action, state, payload, context) => {
  if (payload.staff_user_id === actor && ["read", "write"].includes(action) && state === "draft") return true;
  return Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage")
    || context.recordId && await context.hasPermissionOnResource?.("plugin.suinda-learning.manage", context.recordId));
};
staffProfile.validate = async (payload) => {
  const value = payload.website_url;
  if (value == null || value === "") return [];
  try {
    const parsed = new URL(String(value));
    return ["https:", "http:"].includes(parsed.protocol) ? [] : [{ severity: "error", code: "staff_profile.website_url_invalid", path: "website_url", message: "Informe um endereço profissional HTTP ou HTTPS." }];
  } catch {
    return [{ severity: "error", code: "staff_profile.website_url_invalid", path: "website_url", message: "Informe um endereço profissional válido." }];
  }
};

const staffCredential = kind("Credencial profissional privada", {
  staff_user_id: text(80), category: choice("diploma", "license", "certificate", "other"),
  file_name: text(240), mime_type: choice("application/pdf", "image/png", "image/jpeg"),
  size_bytes: integer(1, 8388608), sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  scan_status: choice("clean", "not_configured"), expires_at: date, description: optionalText(1000),
}, ["staff_user_id", "category", "file_name", "mime_type", "size_bytes", "sha256", "scan_status"], "submitted",
{ submitted: ["expired", "archived"], expired: ["archived"], archived: [] }, {
  staff_user_id: "user-id", category: "diploma", file_name: "documento.pdf", mime_type: "application/pdf", size_bytes: 1,
  sha256: "0".repeat(64), scan_status: "not_configured",
});
staffCredential.resourceScoped = true;
staffCredential.managePermission = "plugin.suinda-learning.manage";
staffCredential.personalOwnerField = "staff_user_id";
staffCredential.serverCreated = true;
staffCredential.sensitiveAttachments = true;
const authorizePrivateStaffCredential = async (actor: string, action: string, _state: string, payload: Record<string, unknown>, context: RecordValidationContext) => {
  if (payload.staff_user_id === actor && action === "read") return true;
  return Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage")
    || context.recordId && await context.hasPermissionOnResource?.("plugin.suinda-learning.manage", context.recordId));
};
staffCredential.authorizeRecord = authorizePrivateStaffCredential;
staffCredential.authorizeAttachment = authorizePrivateStaffCredential;

const courseFavorite = kind("Curso favorito", {
  learner_user_id: text(80), course_record_id: recordRef("course"), favorite_key: text(180),
}, ["learner_user_id", "course_record_id", "favorite_key"], "active", { active: ["removed"], removed: ["active"] }, {
  learner_user_id: "user-id", course_record_id: "course-record-id", favorite_key: "user-id:course-record-id",
});
courseFavorite.serverCreated = true;
courseFavorite.resourceScoped = true;
courseFavorite.personalOwnerField = "learner_user_id";
courseFavorite.uniqueFields = ["favorite_key"];

const learnerDocument = kind("Documento acadêmico do aluno", {
  enrollment_record_id: recordRef("enrollment"), learner_user_id: text(80), category: choice("identity", "education", "enrollment", "payment", "other"),
  description: optionalText(2000), expires_at: date, renews_document_id: optionalText(80), file_name: text(240), mime_type: choice("application/pdf", "image/png", "image/jpeg", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  size_bytes: integer(1, 8388608), sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, scan_status: choice("clean", "not_configured"), reviewer_user_id: optionalText(80), reviewed_at: dateTime, review_notes: optionalText(2000),
}, ["enrollment_record_id", "learner_user_id", "category", "file_name", "mime_type", "size_bytes", "sha256", "scan_status"], "submitted", { submitted: ["approved", "rejected"], approved: ["expired"], rejected: [], expired: [] }, {
  enrollment_record_id: "enrollment-record-id", learner_user_id: "user-id", category: "education", file_name: "comprovante.pdf", mime_type: "application/pdf", size_bytes: 1, sha256: "0".repeat(64), scan_status: "not_configured",
});

const learnerPrivacyRequest = kind("Solicitação de privacidade do aluno", {
  learner_user_id: text(80), request_type: choice("access", "correction", "elimination", "portability", "revocation", "objection", "other"),
  request_scope: choice("account_profile", "academic_record", "consent", "communications", "other"),
  request_description: text(3000), requested_categories: list(30), response_summary: optionalText(3000), decision_reference: optionalText(240),
}, ["learner_user_id", "request_type", "request_scope", "request_description"], "received", {
  received: ["identity_verification", "triage", "blocked"],
  identity_verification: ["triage", "blocked"], triage: ["in_review", "blocked"],
  in_review: ["response_ready", "blocked"], response_ready: ["in_review", "completed", "blocked"],
  blocked: ["triage"], completed: [],
}, { learner_user_id: "user-id", request_type: "access", request_scope: "academic_record", request_description: "Descreva quais dados acadêmicos deseja consultar." }, ["completed"]);
Object.assign(learnerPrivacyRequest, learnerPrivateRecord());
learnerPrivacyRequest.authorizeTransition = async (_from, _to, _payload, context) => Boolean(
  await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"),
);
learnerPrivacyRequest.prepareTransition = async (_from, to, payload) => {
  if (["response_ready", "completed"].includes(to) && (!payload.response_summary || !payload.decision_reference))
    throw new Error("Registre um resumo da resposta e a referência da decisão antes de concluir a análise.");
  return payload;
};
learnerPrivacyRequest.validate = async (payload) => String(payload.request_description || "").trim().length >= 20
  ? [] : [{ severity: "error", code: "privacy_request.description_too_short", path: "request_description", message: "Descreva a solicitação com pelo menos 20 caracteres." }];

const privacyNotice = kind("Aviso de privacidade acadêmica", {
  purpose_code: choice("academic_operations", "public_profile", "alumni_community", "gamification_ranking", "crm_contact_sync"), version: integer(1, 10000), purpose: text(2000), data_categories: list(30), subject_categories: list(20),
  legal_basis: choice("consent", "contract", "legal_obligation", "legitimate_interest", "public_policy", "other"),
  legal_basis_detail: text(1200), retention_description: text(1200), retention_period_days: integer(0, 36500),
  retention_record_kinds: { type: "array", maxItems: 40, uniqueItems: true, items: { enum: ["learner_profile", "learner_privacy_request", "learner_document", "attendance_justification", "makeup_request", "enrollment", "payment_entry", "makeup_fee_entry", "attendance", "submission", "assessment_attempt", "assessment_session", "practice", "certificate", "scholarship_application", "announcement_read_receipt", "survey_response", "discussion_thread", "discussion_reply", "alumni_post", "alumni_reply", "learner_consent"] } },
  consent_required: { type: "boolean" }, notice_text: text(12000),
}, ["purpose_code", "version", "purpose", "data_categories", "subject_categories", "legal_basis", "legal_basis_detail", "retention_description", "retention_period_days", "retention_record_kinds", "consent_required", "notice_text"],
"draft", { draft: ["published", "archived"], published: ["archived"], archived: [] }, {
  purpose_code: "academic_operations", version: 1, purpose: "Descrever a finalidade específica deste tratamento.", data_categories: ["Dados acadêmicos"], subject_categories: ["Alunos"],
  legal_basis: "other", legal_basis_detail: "Definida pela instituição responsável.", retention_description: "Definida pela instituição responsável.", retention_period_days: 0, retention_record_kinds: [], consent_required: false,
  notice_text: "Explique quais dados são tratados, para qual finalidade, por quanto tempo e como exercer direitos.",
});
privacyNotice.managePermission = "plugin.suinda-learning.manage";
privacyNotice.resourceScoped = true;
privacyNotice.authorizeCreate = async (_actor, _payload, context) => Boolean(
  await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"),
);
privacyNotice.authorizeRecord = async (_actor, _action, _state, _payload, context) => Boolean(
  await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"),
);
privacyNotice.publicRead = { states: ["published"], fields: ["purpose_code", "version", "purpose", "data_categories", "subject_categories", "legal_basis", "legal_basis_detail", "retention_description", "retention_period_days", "retention_record_kinds", "consent_required", "notice_text"] };
privacyNotice.validate = async (payload) => (payload.legal_basis === "consent") === (payload.consent_required === true)
  && (payload.consent_required !== true || ["public_profile", "alumni_community", "gamification_ranking", "crm_contact_sync"].includes(String(payload.purpose_code)))
  && (payload.purpose_code !== "crm_contact_sync" || Array.isArray(payload.data_categories)
    && ["learner_name", "verified_email"].every((category) => (payload.data_categories as unknown[]).includes(category)))
  && Array.isArray(payload.retention_record_kinds)
  && payload.retention_record_kinds.every((kind) => ["learner_profile", "learner_privacy_request", "learner_document", "attendance_justification", "makeup_request", "enrollment", "payment_entry", "makeup_fee_entry", "attendance", "submission", "assessment_attempt", "assessment_session", "practice", "certificate", "scholarship_application", "announcement_read_receipt", "survey_response", "discussion_thread", "discussion_reply", "alumni_post", "alumni_reply", "learner_consent"].includes(String(kind)))
  && (Number(payload.retention_period_days) === 0 || payload.retention_record_kinds.length > 0)
  ? [] : [{ severity: "error", code: "privacy_notice.invalid_configuration", path: "consent_required", message: "Consentimento só pode ser exigido para finalidade opcional suportada; informe também ao menos uma categoria de registro quando definir prazo de retenção." }];

const learnerConsent = kind("Aceite de aviso de privacidade", {
  learner_user_id: text(80), notice_record_id: recordRef("privacy_notice"), notice_revision: integer(1, 10000),
  consent_key: text(240), consent_status: choice("consented", "acknowledged"), responded_at: dateTime, withdrawn_at: optionalText(80),
  purpose_snapshot: text(2000), data_categories_snapshot: list(30),
}, ["learner_user_id", "notice_record_id", "notice_revision", "consent_key", "consent_status", "responded_at", "purpose_snapshot", "data_categories_snapshot"],
"accepted", { accepted: ["consent_withdrawn"], consent_withdrawn: [] }, {
  learner_user_id: "user-id", notice_record_id: "notice-record-id", notice_revision: 1, consent_key: "response-operation-key",
  consent_status: "acknowledged", responded_at: "2026-01-01T00:00:00.000Z", purpose_snapshot: "Finalidade acadêmica", data_categories_snapshot: ["Dados acadêmicos"],
}, ["withdrawn"]);
Object.assign(learnerConsent, learnerPrivateRecord("learner_user_id", true, ["accepted"]));
learnerConsent.serverCreated = true;
learnerConsent.authorizeTransition = async (from, to, payload, context) => {
  if (context.actorId === payload.learner_user_id && from === "accepted" && to === "consent_withdrawn" && payload.consent_status === "consented") return true;
  return Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"));
};
learnerConsent.prepareTransition = async (from, to, payload) => {
  if (from !== "accepted" || to !== "consent_withdrawn" || payload.consent_status !== "consented") throw new Error("Somente um consentimento ativo pode ser retirado.");
  return { ...payload, withdrawn_at: new Date().toISOString() };
};
learnerConsent.validate = async (payload, context) => {
  const notice = await context.resolveRecord(String(payload.notice_record_id || ""), Number(payload.notice_revision));
  if (!notice || notice.pluginId !== "suinda-learning" || notice.kind !== "privacy_notice" || notice.state !== "published")
    return [{ severity: "error", code: "privacy_consent.notice_unavailable", path: "notice_record_id", message: "O aviso precisa estar publicado na versão aceita." }];
  const requiresConsent = notice.payload.consent_required === true;
  if ((requiresConsent && payload.consent_status !== "consented") || (!requiresConsent && payload.consent_status !== "acknowledged")
    || payload.purpose_snapshot !== notice.payload.purpose
    || JSON.stringify(payload.data_categories_snapshot) !== JSON.stringify(notice.payload.data_categories))
    return [{ severity: "error", code: "privacy_consent.snapshot_mismatch", path: "consent_status", message: "O aceite deve refletir exatamente a finalidade, as categorias e a exigência de consentimento da versão publicada." }];
  return [];
};

export function academicTermsHash(documentType: unknown, version: unknown, body: unknown) {
  return createHash("sha256").update(JSON.stringify({
    document_type: String(documentType || ""), terms_version: String(version || ""), body: String(body || ""),
  }), "utf8").digest("hex");
}

export function academicSignatureEvidenceHash(payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify({
    version: "suinda-simple-signature-v1", method: payload.signature_method,
    term_record_id: payload.term_record_id, term_revision: Number(payload.term_revision),
    enrollment_record_id: payload.enrollment_record_id, learner_user_id: payload.learner_user_id,
    term_title_snapshot: payload.term_title_snapshot, signer_name: payload.signer_name,
    signed_at: payload.signed_at, terms_sha256: payload.terms_sha256,
  }), "utf8").digest("hex");
}

const academicTerm = kind("Termo e documento acadêmico", {
  document_type: choice("contract", "commitment", "regulation", "consent", "other"),
  audience_type: choice("workspace", "course", "cohort"),
  course_record_id: recordRef("course", true, "course_revision"), course_revision: { type: ["integer", "null"], minimum: 1 },
  cohort_record_id: recordRef("cohort", true, "cohort_revision"), cohort_revision: { type: ["integer", "null"], minimum: 1 },
  terms_version: text(80), terms_body: text(20000), signing_required: { type: "boolean" },
}, ["document_type", "audience_type", "terms_version", "terms_body", "signing_required"], "draft",
{ draft: ["published", "archived"], published: ["archived"], archived: [] }, {
  document_type: "regulation", audience_type: "workspace", terms_version: "v1",
  terms_body: "Escreva o conteúdo completo que o aluno deverá ler e assinar.", signing_required: true,
});
academicTerm.managePermission = "plugin.suinda-learning.manage";
academicTerm.resourceScoped = true;
academicTerm.authorizeCreate = async (_actor, _payload, context) => Boolean(
  await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"),
);
academicTerm.authorizeRecord = async (_actor, _action, _state, _payload, context) => Boolean(
  await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"),
);
academicTerm.immutablePayloadFieldsAfterInitial = ["document_type", "audience_type", "course_record_id", "course_revision", "cohort_record_id", "cohort_revision", "terms_version", "terms_body", "signing_required"];
academicTerm.authorizeTransition = async (_from, _to, _payload, context) => Boolean(
  await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"),
);
academicTerm.validate = async (payload, context) => {
  if (!context.resolveRecord) return [];
  const issues = [];
  if (payload.audience_type === "workspace") {
    if (payload.course_record_id || payload.cohort_record_id)
      issues.push({ severity: "error" as const, code: "academic_term.scope_invalid", path: "audience_type", message: "Documento institucional não pode estar vinculado a curso ou turma." });
  } else if (payload.audience_type === "course") {
    const course = await context.resolveRecord(String(payload.course_record_id || ""), Number(payload.course_revision));
    if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course")
      issues.push({ severity: "error" as const, code: "academic_term.course_invalid", path: "course_record_id", message: "Selecione uma revisão válida do curso." });
    if (payload.cohort_record_id) issues.push({ severity: "error" as const, code: "academic_term.scope_invalid", path: "cohort_record_id", message: "Documento de curso não deve apontar também para uma turma." });
  } else if (payload.audience_type === "cohort") {
    const cohort = await context.resolveRecord(String(payload.cohort_record_id || ""), Number(payload.cohort_revision));
    if (!cohort || cohort.pluginId !== "suinda-learning" || cohort.kind !== "cohort")
      issues.push({ severity: "error" as const, code: "academic_term.cohort_invalid", path: "cohort_record_id", message: "Selecione uma revisão válida da turma." });
    if (payload.course_record_id) issues.push({ severity: "error" as const, code: "academic_term.scope_invalid", path: "course_record_id", message: "Documento de turma deve apontar somente para a turma." });
  }
  if (!String(payload.terms_body || "").trim() || !String(payload.terms_version || "").trim())
    issues.push({ severity: "error" as const, code: "academic_term.content_required", path: "terms_body", message: "Informe o texto e a versão do documento." });
  return issues;
};

const academicSignature = kind("Assinatura de documento acadêmico", {
  term_record_id: recordRef("academic_term"), term_revision: integer(1), enrollment_record_id: recordRef("enrollment"),
  learner_user_id: text(80), signature_key: text(240), document_type: choice("contract", "commitment", "regulation", "consent", "other"),
  term_title_snapshot: text(240), terms_version: text(80), term_body_snapshot: text(20000), signer_name: text(240),
  signed_at: dateTime, signature_method: choice("authenticated_typed_name"), terms_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  signature_evidence_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
}, ["term_record_id", "term_revision", "enrollment_record_id", "learner_user_id", "signature_key", "document_type", "term_title_snapshot", "terms_version", "term_body_snapshot", "signer_name", "signed_at", "signature_method", "terms_sha256", "signature_evidence_sha256"],
"signed", { signed: [] }, {
  term_record_id: "academic-term-id", term_revision: 1, enrollment_record_id: "enrollment-record-id", learner_user_id: "user-id",
  signature_key: "enrollment:term:revision", document_type: "regulation", term_title_snapshot: "Regulamento acadêmico",
  terms_version: "v1", term_body_snapshot: "Texto assinado", signer_name: "Ana Exemplo", signed_at: "2030-01-01T12:00:00Z",
  signature_method: "authenticated_typed_name", terms_sha256: "0".repeat(64), signature_evidence_sha256: "0".repeat(64),
});
Object.assign(academicSignature, learnerPrivateRecord("learner_user_id", false));
academicSignature.serverCreated = true;
academicSignature.uniqueFields = ["signature_key"];
academicSignature.authorizeCreate = async (actor, payload) => payload.learner_user_id === actor;
academicSignature.validate = async (payload, context) => {
  if (!context.resolveRecord || !context.resolveLatestRecord) return [];
  const [term, enrollment] = await Promise.all([
    context.resolveRecord(String(payload.term_record_id), Number(payload.term_revision)),
    context.resolveLatestRecord(String(payload.enrollment_record_id)),
  ]);
  if (!term || term.pluginId !== "suinda-learning" || term.kind !== "academic_term" || term.state !== "published"
    || !enrollment || enrollment.pluginId !== "suinda-learning" || enrollment.kind !== "enrollment")
    return [{ severity: "error", code: "academic_signature.reference_invalid", path: "term_record_id", message: "O termo publicado e a matrícula não estão disponíveis." }];
  const owner = String(payload.learner_user_id);
  const audienceMatches = term.payload.audience_type === "workspace"
    || term.payload.audience_type === "course" && term.payload.course_record_id === enrollment.payload.course_record_id
      && Number(term.payload.course_revision) === Number(enrollment.payload.course_revision)
    || term.payload.audience_type === "cohort" && term.payload.cohort_record_id === enrollment.payload.cohort_record_id
      && (!enrollment.payload.cohort_revision || Number(term.payload.cohort_revision) === Number(enrollment.payload.cohort_revision));
  const termsHash = academicTermsHash(term.payload.document_type, term.payload.terms_version, term.payload.terms_body);
  const expectedKey = `${enrollment.id}:${term.id}:${term.revision}`;
  const expectedEvidence = academicSignatureEvidenceHash(payload);
  if (enrollment.payload.learner_user_id !== owner || context.actorId !== owner || !audienceMatches
    || !["application_draft", "submitted", "approved", "enrolled", "active", "paused", "completed"].includes(enrollment.state)
    || term.payload.signing_required !== true || !String(payload.term_title_snapshot || "").trim()
    || payload.terms_version !== term.payload.terms_version || payload.term_body_snapshot !== term.payload.terms_body
    || payload.document_type !== term.payload.document_type || payload.signature_method !== "authenticated_typed_name"
    || payload.signature_key !== expectedKey || payload.terms_sha256 !== termsHash || payload.signature_evidence_sha256 !== expectedEvidence)
    return [{ severity: "error", code: "academic_signature.snapshot_mismatch", path: "signature_evidence_sha256", message: "A assinatura precisa corresponder à matrícula, ao titular e à revisão publicada do documento." }];
  return [];
};

learnerDocument.serverCreated = true;
learnerDocument.sensitiveAttachments = true;
learnerDocument.resourceScoped = true;
learnerDocument.managePermission = "plugin.suinda-learning.manage";
learnerDocument.personalOwnerField = "learner_user_id";
learnerDocument.authorizeCreate = async (actor, payload) => payload.learner_user_id === actor;
learnerDocument.authorizeRecord = async (actor, action, _state, payload, context) =>
  action === "read" && payload.learner_user_id === actor
    || action === "read" && Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
      || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"));
learnerDocument.authorizeAttachment = async (actor, action, _state, payload, context) =>
  action === "read" && (payload.learner_user_id === actor || Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage")));
learnerDocument.validate = async (payload, context) => {
  if (typeof payload.enrollment_record_id !== "string" || typeof payload.learner_user_id !== "string" || !context.resolveLatestRecord) return [];
  const enrollmentRecord = await context.resolveLatestRecord(payload.enrollment_record_id);
  return enrollmentRecord?.pluginId === "suinda-learning" && enrollmentRecord.kind === "enrollment"
    && enrollmentRecord.payload.learner_user_id === payload.learner_user_id
    && (context.actorId === payload.learner_user_id || Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")))
    ? []
    : [{ severity: "error", code: "learner_document_owner_invalid", path: "learner_user_id", message: "O documento deve pertencer ao aluno autenticado e à matrícula selecionada." }];
};

const attendanceJustification = kind("Justificativa de falta", {
  enrollment_record_id: recordRef("enrollment"), session_record_id: recordRef("session"), learner_user_id: text(80),
  request_key: text(180), reason: text(2000), file_name: text(240),
  mime_type: choice("application/pdf", "image/png", "image/jpeg", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  size_bytes: integer(1, 8388608), sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, scan_status: choice("clean", "not_configured"),
  reviewer_user_id: optionalText(80), reviewed_at: dateTime, review_notes: optionalText(2000), attendance_record_id: optionalText(80),
}, ["enrollment_record_id", "session_record_id", "learner_user_id", "request_key", "reason", "file_name", "mime_type", "size_bytes", "sha256", "scan_status"],
"submitted", { submitted: ["approved", "rejected"], rejected: ["submitted"], approved: [] }, {
  enrollment_record_id: "enrollment-record-id", session_record_id: "session-record-id", learner_user_id: "user-id", request_key: "enrollment:session",
  reason: "Descreva a justificativa", file_name: "atestado.pdf", mime_type: "application/pdf", size_bytes: 1, sha256: "0".repeat(64), scan_status: "not_configured",
});
attendanceJustification.serverCreated = true;
attendanceJustification.sensitiveAttachments = true;
attendanceJustification.resourceScoped = true;
attendanceJustification.managePermission = "plugin.suinda-learning.manage";
attendanceJustification.personalOwnerField = "learner_user_id";
attendanceJustification.uniqueFields = ["request_key"];
attendanceJustification.authorizeCreate = async (actor, payload) => payload.learner_user_id === actor;
attendanceJustification.authorizeRecord = async (actor, action, _state, payload, context) =>
  action === "read" && (payload.learner_user_id === actor || Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage")));
attendanceJustification.authorizeAttachment = async (actor, action, _state, payload, context) =>
  action === "read" && (payload.learner_user_id === actor || Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage")));

const makeupRequest = kind("Solicitação de reposição", {
  enrollment_record_id: recordRef("enrollment"), learner_user_id: text(80), original_session_record_id: recordRef("session"),
  reason: text(2000), preferred_at: { type: ["string", "null"], format: "date-time" },
  replacement_session_record_id: recordRef("session", true), reviewer_user_id: optionalText(80), reviewed_at: { type: ["string", "null"], format: "date-time" },
  review_notes: optionalText(2000), original_attendance_status: { type: ["string", "null"], enum: ["absent", "justified", null] },
  request_key: text(180), fee_amount: number(0, 1000000), fee_currency: text(3), fee_status: choice("not_required", "pending", "paid", "waived"),
}, ["enrollment_record_id", "learner_user_id", "original_session_record_id", "reason", "request_key"], "submitted",
{ submitted: ["approved", "rejected", "canceled"], approved: ["scheduled", "canceled"], rejected: ["submitted"], scheduled: ["completed", "canceled"], completed: [], canceled: ["submitted"] },
{ enrollment_record_id: "enrollment-record-id", learner_user_id: "user-id", original_session_record_id: "session-record-id",
  reason: "Descreva o motivo do pedido", preferred_at: null, replacement_session_record_id: null, reviewer_user_id: null,
  reviewed_at: null, review_notes: null, original_attendance_status: null, request_key: "enrollment:session", fee_amount: 0, fee_currency: "BRL", fee_status: "not_required" });
makeupRequest.serverCreated = true;
makeupRequest.resourceScoped = true;
makeupRequest.managePermission = "plugin.suinda-learning.manage";
makeupRequest.personalOwnerField = "learner_user_id";
makeupRequest.uniqueFields = ["request_key"];
makeupRequest.immutablePayloadFieldsAfterInitial = ["enrollment_record_id", "learner_user_id", "original_session_record_id", "request_key"];
makeupRequest.authorizeCreate = async (actor, payload) => payload.learner_user_id === actor;
makeupRequest.authorizeRecord = async (actor, action, _state, payload, context) =>
  action === "read" && (payload.learner_user_id === actor || Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.read")
    || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage") || await context.hasGlobalPermission?.("plugin.suinda-learning.manage")))
  || ["write", "publish"].includes(action) && Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"));
makeupRequest.availableTransitions = async (state, payload, context) => {
  let transitions = makeupRequest.transitions[state] || [];
  if (state === "submitted" && payload.fee_status === "pending")
    transitions = transitions.filter((next) => next !== "approved");
  if (state === "approved" && !payload.replacement_session_record_id)
    transitions = transitions.filter((next) => next !== "scheduled");
  if (state === "scheduled" && transitions.includes("completed")) {
    const session = typeof payload.replacement_session_record_id === "string" && context.resolveLatestRecord
      ? await context.resolveLatestRecord(payload.replacement_session_record_id) : null;
    if (session?.state !== "completed") transitions = transitions.filter((next) => next !== "completed");
  }
  return transitions;
};
makeupRequest.prepareTransition = async (_from, to, payload, context) =>
  ["approved", "rejected"].includes(to)
    ? { ...payload, reviewer_user_id: context.actorId, reviewed_at: new Date().toISOString() }
    : payload;
makeupRequest.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  relatedRecord("original_session_record_id", "session"),
  relatedRecord("replacement_session_record_id", "session"),
  async (payload, context) => {
    if (!context.resolveLatestRecord) return [];
    const [enrollment, original] = await Promise.all([
      typeof payload.enrollment_record_id === "string" ? context.resolveLatestRecord(payload.enrollment_record_id) : null,
      typeof payload.original_session_record_id === "string" ? context.resolveLatestRecord(payload.original_session_record_id) : null,
    ]);
    if (!enrollment || enrollment.kind !== "enrollment" || enrollment.pluginId !== "suinda-learning"
      || enrollment.payload.learner_user_id !== payload.learner_user_id
      || !original || original.kind !== "session" || original.pluginId !== "suinda-learning"
      || original.state !== "completed")
      return [{ severity: "error", code: "makeup_request_relationship_invalid", path: "original_session_record_id", message: "A solicitação precisa pertencer ao aluno e a um encontro concluído da turma de sua matrícula." }];
    const [enrollmentCohort, originalCohort] = await Promise.all([
      context.resolveLatestRecord(String(enrollment.payload.cohort_record_id || "")),
      context.resolveLatestRecord(String(original.payload.cohort_record_id || "")),
    ]);
    if (!enrollmentCohort || !originalCohort || enrollment.payload.course_record_id !== originalCohort.payload.course_record_id
      || String(enrollment.payload.course_revision) !== String(originalCohort.payload.course_revision))
      return [{ severity: "error", code: "makeup_request_relationship_invalid", path: "original_session_record_id", message: "A solicitação precisa pertencer ao curso e à edição curricular da matrícula." }];
    if (typeof payload.replacement_session_record_id === "string") {
      const replacement = await context.resolveLatestRecord(payload.replacement_session_record_id);
      if (!replacement || replacement.kind !== "session" || replacement.pluginId !== "suinda-learning"
        || replacement.payload.session_type !== "makeup" || replacement.payload.replacement_session_record_id !== original.id
        || !await (async () => {
          if (replacement.payload.cohort_record_id === original.payload.cohort_record_id) return true;
          const targetCohort = context.resolveLatestRecord ? await context.resolveLatestRecord(String(replacement.payload.cohort_record_id || "")) : null;
          return targetCohort?.kind === "cohort" && targetCohort.payload.course_record_id === originalCohort.payload.course_record_id
            && String(targetCohort.payload.course_revision) === String(originalCohort.payload.course_revision);
        })()
        || !["scheduled", "live", "completed"].includes(replacement.state))
        return [{ severity: "error", code: "makeup_request_session_invalid", path: "replacement_session_record_id", message: "O encontro precisa ser uma reposição vinculada ao encontro original, no mesmo curso e edição curricular." }];
    }
    return [];
  },
);

async function enrollmentCapacity(payload: Record<string, unknown>, context: Parameters<NonNullable<RecordKindContribution["availableTransitions"]>>[2]) {
  const cohortId = typeof payload.cohort_record_id === "string" ? payload.cohort_record_id : null;
  const courseId = typeof payload.course_record_id === "string" ? payload.course_record_id : null;
  const relatedId = cohortId || courseId;
  if (!relatedId || !context.resolveLatestRecord || !context.countLatestRecordsMatchingPayload) return null;
  const related = await context.resolveLatestRecord(relatedId);
  if (!related) return null;
  const capacity = Number(related.payload.capacity || 0);
  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  const match: Record<string, string> = cohortId
    ? { cohort_record_id: cohortId }
    : { course_record_id: courseId! };
  const lockScope = `suinda-enrollment-capacity:${related.id}`;
  let occupied = 0;
  for (const state of enrollmentSeatStates) {
    const count = await context.countLatestRecordsMatchingPayload(
      "suinda-learning", "enrollment", state, match, lockScope,
      typeof context.recordId === "string" ? context.recordId : undefined,
    );
    if (count === null) return null;
    occupied += count;
  }
  return { available: occupied < capacity, lockScope, match };
}
enrollment.availableTransitions = async (state, payload, context) => {
  const next = [...(enrollment.transitions[state] || [])];
  if (!next.includes("approved")) return next;
  const capacity = await enrollmentCapacity(payload, context);
  return capacity?.available === false ? next.filter((candidate) => candidate !== "approved") : next;
};
enrollment.prepareTransition = async (_from, to, payload, context) => {
  if (to === "approved" && context.resolveLatestRecord) {
    const courseId = String(payload.course_record_id || "");
    const revision = Number(payload.course_revision);
    const course = Number.isInteger(revision) && revision > 0
      ? await context.resolveRecord(courseId, revision)
      : await context.resolveLatestRecord(courseId);
    const hours = Number(course?.payload.enrollment_confirmation_hours || 72);
    return { ...payload, effective_by: new Date(Date.now() + Math.min(720, Math.max(1, hours)) * 60 * 60 * 1000).toISOString() };
  }
  if (to !== "waitlisted" || !context.nextLatestRecordOrdinal) return payload;
  const cohortId = typeof payload.cohort_record_id === "string" ? payload.cohort_record_id : null;
  const courseId = typeof payload.course_record_id === "string" ? payload.course_record_id : null;
  const relatedId = cohortId || courseId;
  if (!relatedId) return payload;
  const match: Record<string, string> = cohortId ? { cohort_record_id: cohortId } : { course_record_id: courseId! };
  const lockScope = `suinda-enrollment-capacity:${relatedId}`;
  const position = await context.nextLatestRecordOrdinal(
    "suinda-learning", "enrollment", "waitlisted", "waitlist_position", match, lockScope,
    typeof context.recordId === "string" ? context.recordId : undefined,
  );
  if (position === null) throw new Error("Não foi possível calcular a posição da lista de espera.");
  return { ...payload, waitlist_position: position };
};
enrollment.transitionEffects = async (from, to, payload, context) => {
  if (!(["withdrawn", "expired"].includes(to)) || !enrollmentSeatStates.includes(from)) return [];
  const cohortId = typeof payload.cohort_record_id === "string" ? payload.cohort_record_id : null;
  const courseId = typeof payload.course_record_id === "string" ? payload.course_record_id : null;
  const relatedId = cohortId || courseId;
  if (!relatedId || !context.resolveLatestRecord || !context.countLatestRecordsMatchingPayload || !context.listLatestRecords) return [];
  const related = await context.resolveLatestRecord(relatedId);
  if (!related || (cohortId ? !["enrolling", "active"].includes(related.state) : related.state !== "enrollment_open")) return [];
  const relatedLabel = cohortId ? "a turma vinculada" : "o curso";
  const capacity = Number(related.payload.capacity || 0);
  const match: Record<string, string> = cohortId ? { cohort_record_id: cohortId } : { course_record_id: courseId! };
  const lockScope = `suinda-enrollment-capacity:${related.id}`;
  let occupied = 0;
  for (const state of enrollmentSeatStates) {
    const count = await context.countLatestRecordsMatchingPayload("suinda-learning", "enrollment", state, match, lockScope);
    if (count === null) return [];
    occupied += count;
  }
  const queue = await context.listLatestRecords("suinda-learning", "enrollment", match, "waitlisted", 1000, lockScope);
  if (!queue?.length) return [];
  const available = Number.isFinite(capacity) && capacity > 0 ? Math.max(0, capacity - occupied) : queue.length;
  if (!available) return [];
  const ordered = queue.sort((a, b) => Number(a.payload.waitlist_position || Number.MAX_SAFE_INTEGER) - Number(b.payload.waitlist_position || Number.MAX_SAFE_INTEGER)
    || String(a.payload.submitted_at || "").localeCompare(String(b.payload.submitted_at || "")) || a.id.localeCompare(b.id));
  return ordered.slice(0, available).map((candidate) => ({
    recordId: candidate.id,
    expectedRevision: candidate.revision,
    expectedState: "waitlisted",
    nextState: "approved",
    payload: { decision_reason: `Convocação automática: vaga liberada em ${relatedLabel}.` },
    reason: `Convocação automática pela liberação de vaga em ${relatedLabel}`,
  }));
};

const learningModule = kind("Módulo", {
  course_record_id: recordRef("course"), course_revision: integer(1), course_version: integer(1), position: integer(0), summary: optionalText(4000), objectives: list(40), competencies: list(100), skills: list(100), prerequisite_module_ids: recordList("module", 40), workload_hours: number(0, 1000), sequential: { type: "boolean" },
}, ["course_record_id", "position"], "draft", { draft: ["published", "archived"], published: ["archived"], archived: [] }, { course_record_id: "course-record-id", course_version: 1, position: 1, objectives: [] });

const learningUnit = kind("Unidade de aprendizagem", {
  module_record_id: recordRef("module"), position: integer(0), summary: optionalText(4000), objectives: list(40), competencies: list(100), skills: list(100),
}, ["module_record_id", "position"], "draft", { draft: ["published", "archived"], published: ["archived"], archived: [] },
{ module_record_id: "module-record-id", position: 1, objectives: [] });

const lesson = kind("Aula e material", {
  module_record_id: recordRef("module"), unit_record_id: recordRef("learning_unit", true), position: integer(0), content_type: choice("video", "audio", "article", "pdf", "presentation", "link", "gallery", "live"),
  content_url: optionalText(4000),
  body_markdown: {
    ...optionalText(50000),
    description: "Use ![descrição](URL) para imagens informativas. Use ![](URL) somente para imagens puramente decorativas; a publicação mostra um aviso para confirmar essa escolha. Espaços ou caracteres invisíveis não contam como descrição.",
  },
  transcript: optionalText(50000),
  transcript_reviewed: { type: "boolean", description: "Confirme após comparar a transcrição com toda a fala e as informações visuais relevantes da aula." },
  document_accessibility_reviewed: { type: "boolean", title: "Revisão de acessibilidade do documento", description: "Confirme somente depois de revisar este PDF ou apresentação com tecnologia assistiva: estrutura e ordem de leitura, títulos, cabeçalhos de tabela, alternativas de imagem e idioma. Desmarque e salve antes de substituir ou incluir um documento." },
  captions_vtt: optionalText(100000), captions_language: optionalText(80), captions_label: optionalText(120), workload_minutes: integer(0, 10000),
  captions_reviewed: { type: "boolean", description: "Confirme após comparar cada legenda, seus tempos, falas e sons relevantes com o vídeo atual." },
  provider_captions_confirmed: { type: "boolean", description: "Confirme somente depois de verificar que a faixa de legendas existe e pode ser ativada nos controles do YouTube ou Vimeo." },
  required: { type: "boolean" }, downloadable: { type: "boolean" }, release_at: dateTime, prerequisites: recordList("lesson", 40), objectives: list(40), competencies: list(100), skills: list(100),
}, ["module_record_id", "position", "content_type"], "draft", { draft: ["scheduled", "published", "archived"], scheduled: ["published", "archived"], published: ["archived"], archived: [] }, { module_record_id: "module-record-id", position: 1, content_type: "article", document_accessibility_reviewed: false, required: true, downloadable: false, objectives: [] });
lesson.carryAttachmentsOnVersion = true;
lesson.sensitiveAttachments = true;
lesson.authorizeAttachment = async (actor, action, state, payload, context) => {
  const manages = Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"));
  const writes = Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.write"));
  if (action === "upload" && (manages || writes)) return true;
  if (action !== "upload" && manages) return true;
  if (typeof payload.module_record_id !== "string" || !context.resolveLatestRecord || !context.listLatestRecords) return false;
  const moduleRecord = await context.resolveLatestRecord(payload.module_record_id);
  if (!moduleRecord || moduleRecord.pluginId !== "suinda-learning" || moduleRecord.kind !== "module") return false;
  const courseId = String(moduleRecord.payload.course_record_id || "");
  const courseRecord = await context.resolveLatestRecord(courseId);
  if (!courseRecord || courseRecord.pluginId !== "suinda-learning" || courseRecord.kind !== "course") return false;
  const assignedToCourse = [courseRecord.payload.instructor_ids, courseRecord.payload.tutor_ids]
    .some((members) => Array.isArray(members) && members.includes(actor));
  const assignedCohorts = await context.listLatestRecords("suinda-learning", "cohort", { course_record_id: courseId }, undefined, 500);
  const assignedToCohort = assignedCohorts?.some((record) => record.payload.instructor_user_id === actor
    || [record.payload.instructor_ids, record.payload.tutor_ids]
      .some((members) => Array.isArray(members) && members.includes(actor))) || false;
  if (action === "read" && (assignedToCourse || assignedToCohort)) return true;
  if (action !== "read" || state !== "published" || moduleRecord.state !== "published") return false;
  if (action === "read" && payload.downloadable !== true) return false;
  const enrollments = await context.listLatestRecords("suinda-learning", "enrollment", { learner_user_id: actor }, undefined, 500);
  for (const enrollment of enrollments || []) {
    if (enrollment.pluginId !== "suinda-learning" || enrollment.kind !== "enrollment"
      || !["enrolled", "active", "completed"].includes(enrollment.state) || enrollment.payload.course_record_id !== courseId
      || Number.isInteger(moduleRecord.payload.course_revision) && Number(enrollment.payload.course_revision) !== Number(moduleRecord.payload.course_revision)
      || !context.resolveRecord || !Number.isInteger(enrollment.payload.course_revision)) continue;
    const pinnedCourse = await context.resolveRecord(courseId, Number(enrollment.payload.course_revision));
    if (!pinnedCourse || Number(pinnedCourse.payload.version) !== Number(moduleRecord.payload.course_version)
      || enrollmentHasOutstandingPrice(enrollment.payload, pinnedCourse.payload)) continue;
    return true;
  }
  return false;
};

const lessonProgress = kind("Progresso da aula", {
  enrollment_record_id: recordRef("enrollment"), lesson_record_id: recordRef("lesson"), learner_user_id: text(80), progress_key: text(180), completed_at: dateTime,
}, ["enrollment_record_id", "lesson_record_id", "learner_user_id", "progress_key", "completed_at"], "completed", { completed: [] }, { enrollment_record_id: "enrollment-record-id", lesson_record_id: "lesson-record-id", learner_user_id: "user-id", progress_key: "enrollment:lesson", completed_at: "2030-01-01T12:00:00Z" }, ["completed"]);
Object.assign(lessonProgress, learnerPrivateRecord("learner_user_id"));
lessonProgress.serverCreated = true;
lessonProgress.uniqueFields = ["progress_key"];
lessonProgress.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  relatedRecord("lesson_record_id", "lesson"),
  async (payload, context) => {
    const enrollmentId = typeof payload.enrollment_record_id === "string" ? payload.enrollment_record_id : null;
    const lessonId = typeof payload.lesson_record_id === "string" ? payload.lesson_record_id : null;
    if (!enrollmentId || !lessonId || !context.resolveLatestRecord) return [];
    const [enrollmentRecord, lessonRecord] = await Promise.all([
      context.resolveLatestRecord(enrollmentId),
      context.resolveLatestRecord(lessonId),
    ]);
    const issues: RecordValidationIssue[] = [];
    if (!enrollmentRecord || enrollmentRecord.pluginId !== "suinda-learning" || enrollmentRecord.kind !== "enrollment"
      || !["enrolled", "active", "completed"].includes(enrollmentRecord.state)) {
      issues.push({ severity: "error" as const, code: "learning_enrollment_inactive", path: "enrollment_record_id", message: "A conclusão exige uma matrícula válida e ativa." });
    }
    if (!lessonRecord || lessonRecord.pluginId !== "suinda-learning" || lessonRecord.kind !== "lesson") {
      issues.push({ severity: "error" as const, code: "learning_lesson_invalid", path: "lesson_record_id", message: "A aula precisa pertencer ao Suindá." });
    }
    if (enrollmentRecord && enrollmentRecord.payload.learner_user_id !== context.actorId
      || payload.learner_user_id !== context.actorId) {
      issues.push({ severity: "error" as const, code: "learning_owner_mismatch", path: "learner_user_id", message: "A conclusão só pode ser registrada para o próprio aluno autenticado." });
    }
    if (payload.progress_key !== `${enrollmentId}:${lessonId}`) {
      issues.push({ severity: "error" as const, code: "learning_progress_key_mismatch", path: "progress_key", message: "A chave de progresso precisa identificar unicamente esta matrícula e aula." });
    }
    return issues;
  },
);

const mediaProgress = kind("Progresso assistido de mídia", {
  enrollment_record_id: recordRef("enrollment"), lesson_record_id: recordRef("lesson"), learner_user_id: text(80), progress_key: text(180),
  position_seconds: number(0, 86400), watched_seconds: number(0, 86400), duration_seconds: number(0, 86400), percent: number(0, 100), heartbeat_at: dateTime,
}, ["enrollment_record_id", "lesson_record_id", "learner_user_id", "progress_key", "position_seconds", "watched_seconds", "duration_seconds", "percent", "heartbeat_at"], "saved", { saved: ["saved"] },
{ enrollment_record_id: "enrollment-record-id", lesson_record_id: "lesson-record-id", learner_user_id: "user-id", progress_key: "enrollment:lesson", position_seconds: 0, watched_seconds: 0, duration_seconds: 0, percent: 0, heartbeat_at: "2030-01-01T12:00:00Z" });
Object.assign(mediaProgress, learnerPrivateRecord("learner_user_id", false));
mediaProgress.serverCreated = true;
mediaProgress.uniqueFields = ["progress_key"];
mediaProgress.authorizeRecord = async (actor, action, _state, payload) =>
  payload.learner_user_id === actor && ["read", "write"].includes(action);

const learningBookmark = kind("Retomada de aprendizagem", {
  enrollment_record_id: recordRef("enrollment"), lesson_record_id: recordRef("lesson"), learner_user_id: text(80),
  bookmark_key: text(180), selected_at: dateTime,
}, ["enrollment_record_id", "lesson_record_id", "learner_user_id", "bookmark_key", "selected_at"], "saved", { saved: ["saved"] },
{ enrollment_record_id: "enrollment-record-id", lesson_record_id: "lesson-record-id", learner_user_id: "user-id", bookmark_key: "enrollment:user", selected_at: "2030-01-01T12:00:00Z" });
Object.assign(learningBookmark, learnerPrivateRecord("learner_user_id", true));
learningBookmark.serverCreated = true;
learningBookmark.uniqueFields = ["bookmark_key"];
learningBookmark.authorizeRecord = async (actor, action, _state, payload) =>
  payload.learner_user_id === actor && ["read", "write"].includes(action);
learningBookmark.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  relatedRecord("lesson_record_id", "lesson"),
  async (payload, context) => {
    if (payload.learner_user_id !== context.actorId)
      return [{ severity: "error" as const, code: "learning_bookmark_owner_invalid", path: "learner_user_id", message: "A retomada deve pertencer ao aluno autenticado." }];
    return [];
  },
);

const discussionThread = kind("Tópico da comunidade", {
  enrollment_record_id: recordRef("enrollment"), course_record_id: recordRef("course"), course_revision: integer(1), lesson_record_id: recordRef("lesson", true),
  author_user_id: text(80), thread_type: choice("discussion", "question"), body: text(8000),
}, ["enrollment_record_id", "course_record_id", "course_revision", "author_user_id", "thread_type", "body"], "open", { open: ["resolved", "hidden"], resolved: ["open", "hidden"], hidden: ["open"] },
{ enrollment_record_id: "enrollment-record-id", course_record_id: "course-record-id", course_revision: 1, author_user_id: "user-id", thread_type: "discussion", body: "Mensagem" });
Object.assign(discussionThread, learnerPrivateRecord("author_user_id", false));
discussionThread.serverCreated = true;
discussionThread.publicRead = { states: ["open", "resolved"], fields: ["course_record_id", "course_revision", "lesson_record_id", "thread_type", "body"] };
discussionThread.authorizeCreate = async (actor, payload, context) => {
  if (payload.author_user_id !== actor || typeof payload.enrollment_record_id !== "string" || !context.resolveLatestRecord) return false;
  const enrollment = await context.resolveLatestRecord(payload.enrollment_record_id);
  if (!enrollment || enrollment.pluginId !== "suinda-learning" || enrollment.kind !== "enrollment"
    || !["enrolled", "active", "completed"].includes(enrollment.state)
    || enrollment.payload.learner_user_id !== actor || enrollment.payload.course_record_id !== payload.course_record_id
    || Number(enrollment.payload.course_revision) !== Number(payload.course_revision)) return false;
  if (typeof enrollment.payload.course_record_id !== "string" || !Number.isInteger(enrollment.payload.course_revision)) return false;
  const course = await context.resolveRecord?.(enrollment.payload.course_record_id, Number(enrollment.payload.course_revision));
  if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course"
    || enrollmentHasOutstandingPrice(enrollment.payload, course.payload)) return false;
  if (typeof payload.lesson_record_id === "string") {
    const lessonRecord = await context.resolveLatestRecord(payload.lesson_record_id);
    if (!lessonRecord || lessonRecord.pluginId !== "suinda-learning" || lessonRecord.kind !== "lesson") return false;
    const moduleRecord = typeof lessonRecord.payload.module_record_id === "string" ? await context.resolveLatestRecord(lessonRecord.payload.module_record_id) : null;
    if (!moduleRecord || moduleRecord.payload.course_record_id !== enrollment.payload.course_record_id
      || Number(moduleRecord.payload.course_revision) !== Number(enrollment.payload.course_revision)) return false;
  }
  return true;
};
async function isCommunityModerator(actor: string, courseId: unknown, courseRevision: unknown, context: RecordValidationContext, enrollmentId?: unknown) {
  if (typeof courseId !== "string" || !Number.isInteger(courseRevision)) return false;
  if (await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")) return true;
  const course = await context.resolveLatestRecord?.(courseId);
  if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course") return false;
  if ([course.payload.instructor_ids, course.payload.tutor_ids].some((ids) => Array.isArray(ids) && ids.includes(actor))) return true;
  if (typeof enrollmentId !== "string" || !context.resolveLatestRecord) return false;
  const enrollment = await context.resolveLatestRecord(enrollmentId);
  if (!enrollment || enrollment.pluginId !== "suinda-learning" || enrollment.kind !== "enrollment"
    || enrollment.payload.course_record_id !== courseId || Number(enrollment.payload.course_revision) !== Number(courseRevision)) return false;
  const cohortId = enrollment.payload.cohort_record_id;
  const cohort = typeof cohortId === "string" ? await context.resolveLatestRecord(cohortId) : null;
  if (typeof cohortId === "string" && !cohort) return false;
  if (cohort && (cohort.pluginId !== "suinda-learning" || cohort.kind !== "cohort"
    || cohort.payload.course_record_id !== courseId || Number(cohort.payload.course_revision) !== Number(courseRevision))) return false;
  if (cohort && (cohort.payload.instructor_user_id === actor || [cohort.payload.instructor_ids, cohort.payload.tutor_ids]
    .some((ids) => Array.isArray(ids) && ids.includes(actor)))) return true;
  const directUnitId = enrollment.payload.institution_unit_record_id;
  const cohortUnitId = cohort?.payload.institution_unit_record_id;
  const unitId = typeof directUnitId === "string" ? directUnitId : typeof cohortUnitId === "string" ? cohortUnitId : course.payload.institution_unit_record_id;
  if (typeof unitId !== "string" || !context.hasPermissionOnResource) return false;
  const unit = await context.resolveLatestRecord(unitId);
  return Boolean(unit?.pluginId === "suinda-learning" && unit.kind === "institution_unit"
    && await context.hasPermissionOnResource("plugin.suinda-learning.manage", unit.id));
}
discussionThread.authorizeRecord = async (actor, action, _state, payload, context) => {
  if (!["read", "write", "publish"].includes(action)) return false;
  if (_state === "hidden") return action === "read" && await isCommunityModerator(actor, payload.course_record_id, payload.course_revision, context, payload.enrollment_record_id);
  if (payload.author_user_id === actor) return true;
  return action !== "write" && await isCommunityModerator(actor, payload.course_record_id, payload.course_revision, context, payload.enrollment_record_id);
};
discussionThread.authorizeTransition = async (from, to, payload, context) =>
  to === "hidden" || from === "hidden" ? await isCommunityModerator(String(context.actorId || ""), payload.course_record_id, payload.course_revision, context, payload.enrollment_record_id)
    : context.actorId === payload.author_user_id;
discussionThread.validate = combine(relatedRecord("enrollment_record_id", "enrollment"), relatedRecord("course_record_id", "course"), relatedRecord("lesson_record_id", "lesson"), async (payload, context) =>
  payload.author_user_id === context.actorId ? [] : [{ severity: "error" as const, code: "community_author_invalid", path: "author_user_id", message: "O autor precisa ser o usuário autenticado." }]);

const discussionReply = kind("Resposta da comunidade", {
  thread_record_id: recordRef("discussion_thread"), enrollment_record_id: recordRef("enrollment"), author_user_id: text(80), body: text(8000),
}, ["thread_record_id", "enrollment_record_id", "author_user_id", "body"], "published", { published: ["hidden"], hidden: ["published"] },
{ thread_record_id: "thread-record-id", enrollment_record_id: "enrollment-record-id", author_user_id: "user-id", body: "Resposta" });
Object.assign(discussionReply, learnerPrivateRecord("author_user_id", false));
discussionReply.serverCreated = true;
discussionReply.authorizeCreate = async (actor, payload, context) => {
  if (payload.author_user_id !== actor || typeof payload.thread_record_id !== "string" || typeof payload.enrollment_record_id !== "string" || !context.resolveLatestRecord) return false;
  const [thread, enrollment] = await Promise.all([context.resolveLatestRecord(payload.thread_record_id), context.resolveLatestRecord(payload.enrollment_record_id)]);
  return Boolean(thread?.pluginId === "suinda-learning" && thread.kind === "discussion_thread" && thread.state !== "hidden"
    && thread.payload.course_record_id === enrollment?.payload.course_record_id && enrollment?.payload.learner_user_id === actor
    && Number(thread.payload.course_revision) === Number(enrollment?.payload.course_revision)
    && ["enrolled", "active", "completed"].includes(enrollment.state));
};
discussionReply.authorizeRecord = async (actor, action, _state, payload, context) => {
  if (action !== "read" && action !== "write" && action !== "publish") return false;
  const thread = typeof payload.thread_record_id === "string" ? await context.resolveLatestRecord?.(payload.thread_record_id) : null;
  if (_state === "hidden") return action === "read" && Boolean(thread && await isCommunityModerator(actor, thread.payload.course_record_id, thread.payload.course_revision, context, thread.payload.enrollment_record_id));
  if (payload.author_user_id === actor) return true;
  if (action === "write") return false;
  return Boolean(thread && await isCommunityModerator(actor, thread.payload.course_record_id, thread.payload.course_revision, context, thread.payload.enrollment_record_id));
};
discussionReply.authorizeTransition = async (from, to, payload, context) => {
  if (to !== "hidden" && from !== "hidden") return false;
  const thread = typeof payload.thread_record_id === "string" ? await context.resolveLatestRecord?.(payload.thread_record_id) : null;
  return Boolean(thread && await isCommunityModerator(String(context.actorId || ""), thread.payload.course_record_id, thread.payload.course_revision, context, thread.payload.enrollment_record_id));
};
discussionReply.validate = combine(relatedRecord("thread_record_id", "discussion_thread"), relatedRecord("enrollment_record_id", "enrollment"), async (payload, context) =>
  payload.author_user_id === context.actorId ? [] : [{ severity: "error" as const, code: "community_author_invalid", path: "author_user_id", message: "O autor precisa ser o usuário autenticado." }]);

const discussionReaction = kind("Reação da comunidade", {
  thread_record_id: recordRef("discussion_thread"), learner_user_id: text(80), reaction: choice("like", "helpful", "celebrate"), reaction_key: text(180),
}, ["thread_record_id", "learner_user_id", "reaction", "reaction_key"], "active", { active: ["removed"], removed: ["active"] },
{ thread_record_id: "thread-record-id", learner_user_id: "user-id", reaction: "like", reaction_key: "user:thread:like" });
Object.assign(discussionReaction, learnerPrivateRecord("learner_user_id", false));
discussionReaction.serverCreated = true;
discussionReaction.uniqueFields = ["reaction_key"];
discussionReaction.authorizeCreate = async (actor, payload, context) => {
  if (payload.learner_user_id !== actor || typeof payload.thread_record_id !== "string" || !context.resolveLatestRecord) return false;
  const thread = await context.resolveLatestRecord(payload.thread_record_id);
  if (!thread || thread.pluginId !== "suinda-learning" || thread.kind !== "discussion_thread") return false;
  const enrollments = await context.listLatestRecords?.("suinda-learning", "enrollment", { learner_user_id: actor }, undefined, 500);
  return Boolean(enrollments?.some((entry) => entry.payload.course_record_id === thread.payload.course_record_id
    && ["enrolled", "active", "completed"].includes(entry.state)));
};
discussionReaction.authorizeRecord = async (actor, action, _state, payload) =>
  ["read", "write", "publish"].includes(action) && payload.learner_user_id === actor;

async function isCompletedAlumni(actor: string, courseId: unknown, courseRevision: unknown, context: RecordValidationContext) {
  if (typeof courseId !== "string" || !Number.isInteger(courseRevision) || !context.listLatestRecords) return false;
  const enrollments = await context.listLatestRecords("suinda-learning", "enrollment", { learner_user_id: actor }, undefined, 500);
  return Boolean(enrollments?.some((record) => record.pluginId === "suinda-learning" && record.kind === "enrollment"
    && record.state === "completed" && record.payload.course_record_id === courseId
    && Number(record.payload.course_revision) === Number(courseRevision)
    && ["not_required", "paid", "waived"].includes(String(record.payload.payment_status))));
}

async function hasAlumniVisibility(actor: string, context: RecordValidationContext) {
  const profiles = await context.listLatestRecords?.("suinda-learning", "learner_profile", { learner_user_id: actor }, undefined, 100);
  return Boolean(profiles?.some((profile) => profile.payload.alumni_public_enabled === true));
}

const alumniPost = kind("Publicação da comunidade de ex-alunos", {
  enrollment_record_id: recordRef("enrollment"), course_record_id: recordRef("course"), course_revision: integer(1),
  author_user_id: text(80), body: text(8000), post_key: text(180),
}, ["enrollment_record_id", "course_record_id", "course_revision", "author_user_id", "body", "post_key"],
"published", { published: ["hidden"], hidden: ["published"] },
{ enrollment_record_id: "enrollment-id", course_record_id: "course-id", course_revision: 1, author_user_id: "alumni-id", body: "Mensagem para a comunidade", post_key: "enrollment:operation" });
alumniPost.resourceScoped = true;
alumniPost.serverCreated = true;
alumniPost.uniqueFields = ["post_key"];
alumniPost.authorizeCreate = async (actor, payload, context) => {
  if (payload.author_user_id !== actor || typeof payload.enrollment_record_id !== "string" || !context.resolveLatestRecord) return false;
  const enrollment = await context.resolveLatestRecord(payload.enrollment_record_id);
  const course = await context.resolveRecord?.(String(payload.course_record_id || ""), Number(payload.course_revision));
  return Boolean(enrollment?.pluginId === "suinda-learning" && enrollment.kind === "enrollment" && enrollment.state === "completed"
    && enrollment.payload.learner_user_id === actor && enrollment.payload.course_record_id === payload.course_record_id
    && Number(enrollment.payload.course_revision) === Number(payload.course_revision)
    && ["not_required", "paid", "waived"].includes(String(enrollment.payload.payment_status))
    && course?.pluginId === "suinda-learning" && course.kind === "course"
    && !enrollmentHasOutstandingPrice(enrollment.payload, course.payload)
    && await hasAlumniVisibility(actor, context));
};
alumniPost.authorizeRecord = async (actor, action, _state, payload, context) =>
  action === "read" ? await isCompletedAlumni(actor, payload.course_record_id, payload.course_revision, context)
      && await isCompletedAlumni(String(payload.author_user_id), payload.course_record_id, payload.course_revision, context)
      && await hasAlumniVisibility(String(payload.author_user_id), context)
    : false;

const alumniReply = kind("Resposta da comunidade de ex-alunos", {
  post_record_id: recordRef("alumni_post"), enrollment_record_id: recordRef("enrollment"), course_record_id: recordRef("course"),
  course_revision: integer(1), author_user_id: text(80), body: text(8000),
}, ["post_record_id", "enrollment_record_id", "course_record_id", "course_revision", "author_user_id", "body"],
"published", { published: ["hidden"], hidden: ["published"] },
{ post_record_id: "post-id", enrollment_record_id: "enrollment-id", course_record_id: "course-id", course_revision: 1,
  author_user_id: "alumni-id", body: "Resposta" });
alumniReply.resourceScoped = true;
alumniReply.serverCreated = true;
alumniReply.authorizeCreate = async (actor, payload, context) => {
  if (payload.author_user_id !== actor || typeof payload.post_record_id !== "string" || typeof payload.enrollment_record_id !== "string"
    || !context.resolveLatestRecord) return false;
  const [post, enrollment] = await Promise.all([context.resolveLatestRecord(payload.post_record_id), context.resolveLatestRecord(payload.enrollment_record_id)]);
  const course = await context.resolveRecord?.(String(payload.course_record_id || ""), Number(payload.course_revision));
  return Boolean(post?.pluginId === "suinda-learning" && post.kind === "alumni_post" && post.state === "published"
    && enrollment?.pluginId === "suinda-learning" && enrollment.kind === "enrollment" && enrollment.state === "completed"
    && enrollment.payload.learner_user_id === actor && enrollment.payload.course_record_id === payload.course_record_id
    && Number(enrollment.payload.course_revision) === Number(payload.course_revision)
    && ["not_required", "paid", "waived"].includes(String(enrollment.payload.payment_status))
    && post.payload.course_record_id === payload.course_record_id && Number(post.payload.course_revision) === Number(payload.course_revision)
    && course?.pluginId === "suinda-learning" && course.kind === "course"
    && !enrollmentHasOutstandingPrice(enrollment.payload, course.payload)
    && await hasAlumniVisibility(actor, context));
};
alumniReply.authorizeRecord = async (actor, action, _state, payload, context) =>
  action === "read" ? await isCompletedAlumni(actor, payload.course_record_id, payload.course_revision, context)
      && await isCompletedAlumni(String(payload.author_user_id), payload.course_record_id, payload.course_revision, context)
      && await hasAlumniVisibility(String(payload.author_user_id), context)
    : false;

const communityPin = kind("Pinagem de tópico da comunidade", {
  thread_record_id: recordRef("discussion_thread"), course_record_id: recordRef("course"), course_revision: integer(1),
  pinned_by_user_id: text(80), pin_key: text(180),
}, ["thread_record_id", "course_record_id", "course_revision", "pinned_by_user_id", "pin_key"], "pinned",
{ pinned: ["unpinned"], unpinned: ["pinned"] },
{ thread_record_id: "thread-id", course_record_id: "course-id", course_revision: 1, pinned_by_user_id: "teacher-id", pin_key: "thread-id" });
communityPin.resourceScoped = true;
communityPin.serverCreated = true;
communityPin.uniqueFields = ["pin_key"];
communityPin.authorizeCreate = async (actor, payload, context) => {
  if (payload.pinned_by_user_id !== actor || typeof payload.thread_record_id !== "string" || !context.resolveLatestRecord) return false;
  const thread = await context.resolveLatestRecord(payload.thread_record_id);
  return Boolean(thread?.pluginId === "suinda-learning" && thread.kind === "discussion_thread" && thread.state !== "hidden"
    && thread.payload.course_record_id === payload.course_record_id
    && Number(thread.payload.course_revision) === Number(payload.course_revision)
    && await isCommunityModerator(actor, payload.course_record_id, payload.course_revision, context, thread.payload.enrollment_record_id));
};
communityPin.authorizeRecord = async (actor, action, _state, payload, context) =>
  ["read", "write", "publish"].includes(action)
  && await isCommunityModerator(actor, payload.course_record_id, payload.course_revision, context, payload.thread_record_id
    ? (await context.resolveLatestRecord?.(String(payload.thread_record_id)))?.payload.enrollment_record_id : undefined);
communityPin.authorizeTransition = async (_from, _to, payload, context) =>
  isCommunityModerator(String(context.actorId || ""), payload.course_record_id, payload.course_revision, context, payload.thread_record_id
    ? (await context.resolveLatestRecord?.(String(payload.thread_record_id)))?.payload.enrollment_record_id : undefined);

const communityReport = kind("Denúncia de conteúdo da comunidade", {
  enrollment_record_id: recordRef("enrollment"), target_enrollment_record_id: recordRef("enrollment", true), course_record_id: recordRef("course"), course_revision: integer(1),
  reporter_user_id: text(80), target_record_id: text(80), target_kind: choice("discussion_thread", "discussion_reply"),
  reason: choice("harassment", "spam", "personal_data", "inappropriate", "other"), details: optionalText(2000), report_key: text(180),
}, ["enrollment_record_id", "course_record_id", "course_revision", "reporter_user_id", "target_record_id", "target_kind", "reason", "report_key"],
"open", { open: ["reviewed", "dismissed", "actioned"], reviewed: ["dismissed", "actioned", "open"], dismissed: ["open"], actioned: ["open"] },
{ enrollment_record_id: "enrollment-id", target_enrollment_record_id: "target-enrollment-id", course_record_id: "course-id", course_revision: 1, reporter_user_id: "user-id",
  target_record_id: "thread-id", target_kind: "discussion_thread", reason: "inappropriate", report_key: "reporter:target" });
Object.assign(communityReport, learnerPrivateRecord("reporter_user_id", false));
communityReport.serverCreated = true;
communityReport.resourceScoped = true;
communityReport.uniqueFields = ["report_key"];
communityReport.authorizeCreate = async (actor, payload, context) => {
  if (payload.reporter_user_id !== actor || typeof payload.enrollment_record_id !== "string" || typeof payload.target_enrollment_record_id !== "string" || typeof payload.target_record_id !== "string"
    || !context.resolveLatestRecord) return false;
  const [enrollment, targetEnrollment, target] = await Promise.all([context.resolveLatestRecord(payload.enrollment_record_id),
    context.resolveLatestRecord(payload.target_enrollment_record_id), context.resolveLatestRecord(payload.target_record_id)]);
  const parentThread = target?.kind === "discussion_reply" && typeof target.payload.thread_record_id === "string"
    ? await context.resolveLatestRecord(target.payload.thread_record_id) : null;
  const targetAuthor = target?.payload.author_user_id;
  return Boolean(enrollment?.pluginId === "suinda-learning" && enrollment.kind === "enrollment"
    && enrollment.payload.learner_user_id === actor && ["enrolled", "active", "completed"].includes(enrollment.state)
    && enrollment.payload.course_record_id === payload.course_record_id
    && Number(enrollment.payload.course_revision) === Number(payload.course_revision)
    && targetEnrollment?.pluginId === "suinda-learning" && targetEnrollment.kind === "enrollment"
    && targetEnrollment.payload.course_record_id === payload.course_record_id
    && Number(targetEnrollment.payload.course_revision) === Number(payload.course_revision)
    && target?.pluginId === "suinda-learning" && target.kind === payload.target_kind && target.state !== "hidden" && targetAuthor !== actor
    && (target.kind === "discussion_thread"
      ? target.payload.course_record_id === payload.course_record_id && Number(target.payload.course_revision) === Number(payload.course_revision)
        && target.payload.enrollment_record_id === targetEnrollment.id
      : Boolean(parentThread?.kind === "discussion_thread" && parentThread.state !== "hidden"
        && parentThread.payload.course_record_id === payload.course_record_id
        && Number(parentThread.payload.course_revision) === Number(payload.course_revision)
        && parentThread.payload.enrollment_record_id === targetEnrollment.id)));
};
communityReport.authorizeRecord = async (actor, action, _state, payload, context) => {
  if (action === "read" && payload.reporter_user_id === actor) return true;
  if (action !== "read" && action !== "publish") return false;
  return isCommunityModerator(actor, payload.course_record_id, payload.course_revision, context, payload.target_enrollment_record_id || payload.enrollment_record_id);
};
communityReport.authorizeTransition = async (_from, _to, payload, context) =>
  isCommunityModerator(String(context.actorId || ""), payload.course_record_id, payload.course_revision, context, payload.target_enrollment_record_id || payload.enrollment_record_id);
communityReport.validate = combine(relatedRecord("enrollment_record_id", "enrollment"), relatedRecord("course_record_id", "course"),
  async (payload, context) => payload.reporter_user_id === context.actorId
    ? [] : [{ severity: "error" as const, code: "community_reporter_invalid", path: "reporter_user_id", message: "A denúncia deve pertencer à pessoa autenticada." }]);

const learningMessage = kind("Mensagem individual de aprendizagem", {
  enrollment_record_id: recordRef("enrollment"), course_record_id: recordRef("course"), course_revision: integer(1),
  sender_user_id: text(80), recipient_user_id: text(80), conversation_key: text(64), body: text(5000), sent_at: dateTime,
}, ["enrollment_record_id", "course_record_id", "course_revision", "sender_user_id", "recipient_user_id", "conversation_key", "body", "sent_at"],
"sent", { sent: [] }, { enrollment_record_id: "enrollment-record-id", course_record_id: "course-record-id", course_revision: 1,
  sender_user_id: "sender-id", recipient_user_id: "recipient-id", conversation_key: "conversation-key", body: "Mensagem", sent_at: "2030-01-01T12:00:00Z" },
["enrollment_record_id", "course_record_id", "course_revision", "sender_user_id", "recipient_user_id", "conversation_key", "body", "sent_at"]);
learningMessage.resourceScoped = true;
learningMessage.serverCreated = true;
learningMessage.authorizeCreate = async (actor, payload, context) => {
  if (typeof payload.enrollment_record_id !== "string" || typeof payload.sender_user_id !== "string"
    || typeof payload.recipient_user_id !== "string" || payload.sender_user_id !== actor
    || actor === payload.recipient_user_id || !context.resolveLatestRecord) return false;
  const enrollment = await context.resolveLatestRecord(payload.enrollment_record_id);
  if (!enrollment || enrollment.pluginId !== "suinda-learning" || enrollment.kind !== "enrollment"
    || !["enrolled", "active", "completed"].includes(enrollment.state)
    || enrollment.payload.course_record_id !== payload.course_record_id
    || Number(enrollment.payload.course_revision) !== Number(payload.course_revision)) return false;
  const course = await context.resolveRecord?.(String(enrollment.payload.course_record_id), Number(enrollment.payload.course_revision));
  if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course"
    || enrollmentHasOutstandingPrice(enrollment.payload, course.payload)) return false;
  if (actor === enrollment.payload.learner_user_id) {
    if (!context.resolveLatestRecord) return false;
    const cohort = typeof enrollment.payload.cohort_record_id === "string" ? await context.resolveLatestRecord(enrollment.payload.cohort_record_id) : null;
    const instructors = [course.payload.instructor_ids, cohort?.payload.instructor_ids, cohort?.payload.tutor_ids]
      .flatMap((members) => Array.isArray(members) ? members : []);
    return instructors.includes(payload.recipient_user_id);
  }
  if (payload.recipient_user_id !== enrollment.payload.learner_user_id) return false;
  const cohort = typeof enrollment.payload.cohort_record_id === "string" ? await context.resolveLatestRecord(enrollment.payload.cohort_record_id) : null;
  const instructors = [course.payload.instructor_ids, cohort?.payload.instructor_ids, cohort?.payload.tutor_ids]
    .flatMap((members) => Array.isArray(members) ? members : []);
  return instructors.includes(actor)
    || Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"))
    || Boolean(await context.hasGlobalPermission?.("plugin.suinda-learning.manage"));
};
learningMessage.authorizeRecord = async (actor, action, _state, payload) =>
  ["read", "write", "publish"].includes(action)
    && [payload.sender_user_id, payload.recipient_user_id].includes(actor);

async function isPublicCourseParticipant(userId: unknown, courseId: unknown, courseRevision: unknown, context: RecordValidationContext) {
  if (typeof userId !== "string" || typeof courseId !== "string" || !Number.isInteger(courseRevision) || !context.listLatestRecords) return false;
  const [enrollments, profiles, course] = await Promise.all([
    context.listLatestRecords("suinda-learning", "enrollment", { learner_user_id: userId }, undefined, 500),
    context.listLatestRecords("suinda-learning", "learner_profile", { learner_user_id: userId }, undefined, 100),
    context.resolveRecord?.(courseId, Number(courseRevision)),
  ]);
  const enrolled = (enrollments || []).some((entry) => entry.pluginId === "suinda-learning" && entry.kind === "enrollment"
    && ["enrolled", "active"].includes(entry.state) && entry.payload.course_record_id === courseId
    && Number(entry.payload.course_revision) === Number(courseRevision)
    && !enrollmentHasOutstandingPrice(entry.payload, course?.payload || {}));
  return enrolled && Boolean((profiles || []).some((profile) => profile.pluginId === "suinda-learning"
    && profile.kind === "learner_profile" && profile.payload.public_profile_enabled === true));
}

const networkConnection = kind("Conexão entre participantes", {
  course_record_id: recordRef("course"), course_revision: integer(1), requester_user_id: text(80), recipient_user_id: text(80),
  request_key: text(180), greeting: optionalText(400), requested_at: dateTime,
}, ["course_record_id", "course_revision", "requester_user_id", "recipient_user_id", "request_key", "requested_at"],
"pending", { pending: ["accepted", "declined", "canceled"], accepted: ["closed"], closed: [], declined: ["pending"], canceled: ["pending"] },
{ course_record_id: "course-record-id", course_revision: 1, requester_user_id: "requester-id", recipient_user_id: "recipient-id", request_key: "course:revision:pair", requested_at: "2030-01-01T12:00:00Z" });
Object.assign(networkConnection, learnerPrivateRecord("requester_user_id", false));
networkConnection.serverCreated = true;
networkConnection.uniqueFields = ["request_key"];
networkConnection.authorizeCreate = async (actor, payload, context) => payload.requester_user_id === actor
  && payload.recipient_user_id !== actor
  && await isPublicCourseParticipant(actor, payload.course_record_id, payload.course_revision, context)
  && await isPublicCourseParticipant(payload.recipient_user_id, payload.course_record_id, payload.course_revision, context);
networkConnection.authorizeRecord = async (actor, action, _state, payload) =>
  ["read", "write", "publish"].includes(action)
    && (payload.requester_user_id === actor || payload.recipient_user_id === actor);
networkConnection.authorizeTransition = async (from, to, payload, context) => {
  const actor = context.actorId;
  if (from === "pending" && ["accepted", "declined"].includes(to)) return actor === payload.recipient_user_id;
  if (from === "pending" && to === "canceled") return actor === payload.requester_user_id;
  if (from === "accepted" && to === "closed") return actor === payload.requester_user_id || actor === payload.recipient_user_id;
  if (["declined", "canceled"].includes(from) && to === "pending" && (actor === payload.requester_user_id || actor === payload.recipient_user_id))
    return await isPublicCourseParticipant(actor, payload.course_record_id, payload.course_revision, context)
      && await isPublicCourseParticipant(actor === payload.requester_user_id ? payload.recipient_user_id : payload.requester_user_id,
        payload.course_record_id, payload.course_revision, context);
  return false;
};
networkConnection.prepareTransition = async (from, to, payload, context) => {
  if (!["declined", "canceled"].includes(from) || to !== "pending" || !context.actorId) return payload;
  const other = context.actorId === payload.requester_user_id ? payload.recipient_user_id : payload.requester_user_id;
  return { ...payload, requester_user_id: context.actorId, recipient_user_id: other, requested_at: new Date().toISOString(), greeting: null };
};
networkConnection.validate = async (payload, context) => {
  if (payload.requester_user_id === payload.recipient_user_id)
    return [{ severity: "error", code: "network_connection_self_invalid", path: "recipient_user_id", message: "Não é possível criar uma conexão consigo mesmo." }];
  if (context.recordId) return [];
  return await isPublicCourseParticipant(payload.requester_user_id, payload.course_record_id, payload.course_revision, context)
    && await isPublicCourseParticipant(payload.recipient_user_id, payload.course_record_id, payload.course_revision, context)
    ? [] : [{ severity: "error", code: "network_connection_participants_invalid", path: "recipient_user_id", message: "Ambas as pessoas precisam ter perfil público e matrícula ativa nesta edição." }];
};

async function activeCourseParticipant(userId: unknown, courseId: unknown, courseRevision: unknown, context: RecordValidationContext) {
  if (typeof userId !== "string" || typeof courseId !== "string" || !Number.isInteger(courseRevision) || !context.listLatestRecords) return false;
  const [enrollments, course] = await Promise.all([
    context.listLatestRecords("suinda-learning", "enrollment", { learner_user_id: userId }, undefined, 500),
    context.resolveRecord?.(courseId, Number(courseRevision)),
  ]);
  return Boolean(course?.pluginId === "suinda-learning" && course.kind === "course"
    && (enrollments || []).some((enrollment) => enrollment.pluginId === "suinda-learning" && enrollment.kind === "enrollment"
      && ["enrolled", "active"].includes(enrollment.state) && enrollment.payload.course_record_id === courseId
      && Number(enrollment.payload.course_revision) === Number(courseRevision)
      && !enrollmentHasOutstandingPrice(enrollment.payload, course.payload)));
}

const communityDirectMessage = kind("Mensagem direta entre participantes", {
  connection_record_id: recordRef("network_connection"), course_record_id: recordRef("course"), course_revision: integer(1),
  sender_user_id: text(80), recipient_user_id: text(80), message_key: text(180), body: text(4000), sent_at: dateTime,
}, ["connection_record_id", "course_record_id", "course_revision", "sender_user_id", "recipient_user_id", "message_key", "body", "sent_at"],
"sent", { sent: ["read"], read: [] }, { connection_record_id: "connection-id", course_record_id: "course-id", course_revision: 1,
  sender_user_id: "sender-id", recipient_user_id: "recipient-id", message_key: "connection:sender:operation", body: "Mensagem", sent_at: "2030-01-01T12:00:00Z" });
communityDirectMessage.resourceScoped = true;
communityDirectMessage.serverCreated = true;
communityDirectMessage.uniqueFields = ["message_key"];
communityDirectMessage.authorizeCreate = async (actor, payload, context) => {
  if (payload.sender_user_id !== actor || payload.recipient_user_id === actor || typeof payload.connection_record_id !== "string" || !context.resolveLatestRecord) return false;
  const connection = await context.resolveLatestRecord(payload.connection_record_id);
  if (!connection || connection.pluginId !== "suinda-learning" || connection.kind !== "network_connection" || connection.state !== "accepted"
    || connection.payload.course_record_id !== payload.course_record_id
    || Number(connection.payload.course_revision) !== Number(payload.course_revision)
    || ![connection.payload.requester_user_id, connection.payload.recipient_user_id].includes(actor)
    || ![connection.payload.requester_user_id, connection.payload.recipient_user_id].includes(payload.recipient_user_id)) return false;
  return await activeCourseParticipant(actor, payload.course_record_id, payload.course_revision, context)
    && await activeCourseParticipant(payload.recipient_user_id, payload.course_record_id, payload.course_revision, context);
};
communityDirectMessage.authorizeRecord = async (actor, action, _state, payload, context) =>
  ["read", "write", "publish"].includes(action)
  && [payload.sender_user_id, payload.recipient_user_id].includes(actor)
  && await activeCourseParticipant(actor, payload.course_record_id, payload.course_revision, context);
communityDirectMessage.authorizeTransition = async (from, to, payload, context) =>
  from === "sent" && to === "read" && payload.recipient_user_id === context.actorId;
communityDirectMessage.validate = combine(
  relatedRecord("connection_record_id", "network_connection"), relatedRecord("course_record_id", "course"),
  async (payload, context) => payload.sender_user_id === context.actorId && payload.sender_user_id !== payload.recipient_user_id
    ? [] : [{ severity: "error" as const, code: "community_message_sender_invalid", path: "sender_user_id", message: "A mensagem deve ser enviada pela pessoa autenticada a outro participante." }],
);

const studyGroup = kind("Grupo de estudo", {
  enrollment_record_id: recordRef("enrollment"), course_record_id: recordRef("course"), course_revision: integer(1), owner_user_id: text(80),
  description: text(2000), capacity: integer(2, 30),
}, ["enrollment_record_id", "course_record_id", "course_revision", "owner_user_id", "description", "capacity"], "open", { open: ["closed"], closed: ["open", "archived"], archived: [] },
{ enrollment_record_id: "enrollment-record-id", course_record_id: "course-record-id", course_revision: 1, owner_user_id: "user-id", description: "Objetivo e horários do grupo", capacity: 8 });
Object.assign(studyGroup, learnerPrivateRecord("owner_user_id", false));
studyGroup.serverCreated = true;
studyGroup.publicRead = { states: ["open"], fields: ["course_record_id", "course_revision", "description", "capacity"] };
studyGroup.authorizeCreate = async (actor, payload, context) => {
  if (payload.owner_user_id !== actor || typeof payload.enrollment_record_id !== "string" || !context.resolveLatestRecord) return false;
  const enrollment = await context.resolveLatestRecord(payload.enrollment_record_id);
  if (!enrollment || enrollment.pluginId !== "suinda-learning" || enrollment.kind !== "enrollment"
    || enrollment.payload.learner_user_id !== actor || enrollment.payload.course_record_id !== payload.course_record_id
    || Number(enrollment.payload.course_revision) !== Number(payload.course_revision)
    || !["enrolled", "active"].includes(enrollment.state)) return false;
  const course = await context.resolveRecord?.(String(enrollment.payload.course_record_id), Number(enrollment.payload.course_revision));
  return Boolean(course?.pluginId === "suinda-learning" && course.kind === "course"
    && !enrollmentHasOutstandingPrice(enrollment.payload, course.payload));
};
studyGroup.authorizeRecord = async (actor, action, _state, payload, context) =>
  action === "read" || action === "write" || action === "publish"
    ? payload.owner_user_id === actor || Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"))
    : false;
studyGroup.validate = combine(relatedRecord("enrollment_record_id", "enrollment"), relatedRecord("course_record_id", "course"), async (payload, context) => {
  if (typeof payload.enrollment_record_id !== "string" || !context.resolveLatestRecord) return [];
  const enrollment = await context.resolveLatestRecord(payload.enrollment_record_id);
  return enrollment !== null && enrollment.payload.learner_user_id === payload.owner_user_id && enrollment.payload.course_record_id === payload.course_record_id
    && Number(enrollment.payload.course_revision) === Number(payload.course_revision)
    ? [] : [{ severity: "error" as const, code: "study_group_owner_enrollment_invalid", path: "enrollment_record_id", message: "O grupo precisa ser criado pelo aluno da matrícula no mesmo curso." }];
});

const studyGroupMember = kind("Participação em grupo de estudo", {
  group_record_id: recordRef("study_group"), enrollment_record_id: recordRef("enrollment"), learner_user_id: text(80), membership_key: text(180), joined_at: dateTime,
}, ["group_record_id", "enrollment_record_id", "learner_user_id", "membership_key", "joined_at"], "active", { active: ["left"], left: ["active"] },
{ group_record_id: "group-record-id", enrollment_record_id: "enrollment-record-id", learner_user_id: "user-id", membership_key: "user:group", joined_at: "2030-01-01T12:00:00Z" });
Object.assign(studyGroupMember, learnerPrivateRecord("learner_user_id", false));
studyGroupMember.serverCreated = true;
studyGroupMember.uniqueFields = ["membership_key"];
studyGroupMember.authorizeCreate = async (actor, payload, context) => {
  if (payload.learner_user_id !== actor || typeof payload.group_record_id !== "string" || typeof payload.enrollment_record_id !== "string" || !context.resolveLatestRecord) return false;
  const [group, enrollment] = await Promise.all([context.resolveLatestRecord(payload.group_record_id), context.resolveLatestRecord(payload.enrollment_record_id)]);
  return Boolean(group?.pluginId === "suinda-learning" && group.kind === "study_group" && group.state === "open"
    && enrollment?.pluginId === "suinda-learning" && enrollment.kind === "enrollment"
    && enrollment.payload.learner_user_id === actor && ["enrolled", "active"].includes(enrollment.state)
    && enrollment.payload.course_record_id === group.payload.course_record_id
    && Number(enrollment.payload.course_revision) === Number(group.payload.course_revision)
    && group.payload.owner_user_id !== actor
    && (Number(group.payload.capacity) > 0));
};

const studyGroupMessage = kind("Mensagem do grupo de estudo", {
  group_record_id: recordRef("study_group"), enrollment_record_id: recordRef("enrollment"),
  sender_user_id: text(80), message_key: text(180), body: text(4000),
}, ["group_record_id", "enrollment_record_id", "sender_user_id", "message_key", "body"], "sent", { sent: [] }, {
  group_record_id: "group-record-id", enrollment_record_id: "enrollment-record-id", sender_user_id: "user-id",
  message_key: "group:sender:operation", body: "Mensagem do grupo",
});
studyGroupMessage.resourceScoped = true;
studyGroupMessage.serverCreated = true;
studyGroupMessage.uniqueFields = ["message_key"];
studyGroupMessage.authorizeCreate = async (actor, payload, context) => {
  if (payload.sender_user_id !== actor || typeof payload.group_record_id !== "string"
    || typeof payload.enrollment_record_id !== "string" || !context.resolveLatestRecord) return false;
  const [group, enrollment] = await Promise.all([
    context.resolveLatestRecord(payload.group_record_id), context.resolveLatestRecord(payload.enrollment_record_id),
  ]);
  if (!group || group.pluginId !== "suinda-learning" || group.kind !== "study_group" || group.state !== "open"
    || !enrollment || enrollment.pluginId !== "suinda-learning" || enrollment.kind !== "enrollment"
    || enrollment.payload.learner_user_id !== actor || !["enrolled", "active"].includes(enrollment.state)
    || enrollment.payload.course_record_id !== group.payload.course_record_id
    || Number(enrollment.payload.course_revision) !== Number(group.payload.course_revision)) return false;
  const course = await context.resolveRecord(String(enrollment.payload.course_record_id), Number(enrollment.payload.course_revision));
  if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course"
    || enrollmentHasOutstandingPrice(enrollment.payload, course.payload)) return false;
  if (group.payload.owner_user_id === actor && group.payload.enrollment_record_id === enrollment.id) return true;
  const memberships = await context.listLatestRecords?.("suinda-learning", "study_group_member", {
    group_record_id: group.id, learner_user_id: actor, enrollment_record_id: enrollment.id,
  }, "active", 100);
  return Boolean(memberships?.some((membership) => membership.state === "active"));
};
studyGroupMessage.authorizeRecord = async (actor, action, _state, payload, context) => {
  if (action !== "read" || typeof payload.group_record_id !== "string" || !context.resolveLatestRecord) return false;
  const group = await context.resolveLatestRecord(payload.group_record_id);
  if (!group || group.pluginId !== "suinda-learning" || group.kind !== "study_group" || !["open", "closed"].includes(group.state)) return false;
  const enrolled = await context.resolveLatestRecord?.(String(payload.enrollment_record_id || ""));
  if (!enrolled || enrolled.pluginId !== "suinda-learning" || enrolled.kind !== "enrollment"
    || enrolled.payload.learner_user_id !== actor || !["enrolled", "active"].includes(enrolled.state)
    || enrolled.payload.course_record_id !== group.payload.course_record_id
    || Number(enrolled.payload.course_revision) !== Number(group.payload.course_revision)) return false;
  const course = await context.resolveRecord(String(enrolled.payload.course_record_id), Number(enrolled.payload.course_revision));
  if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course"
    || enrollmentHasOutstandingPrice(enrolled.payload, course.payload)) return false;
  if (group.payload.owner_user_id === actor && group.payload.enrollment_record_id === enrolled.id) return true;
  const memberships = await context.listLatestRecords?.("suinda-learning", "study_group_member", {
    group_record_id: group.id, learner_user_id: actor, enrollment_record_id: enrolled.id,
  }, "active", 100);
  return Boolean(memberships?.some((membership) => membership.state === "active"));
};
studyGroupMessage.validate = combine(relatedRecord("group_record_id", "study_group"), relatedRecord("enrollment_record_id", "enrollment"), async (payload) =>
  typeof payload.sender_user_id === "string" && typeof payload.message_key === "string"
    && typeof payload.body === "string" && payload.body.trim().length > 0
    ? [] : [{ severity: "error" as const, code: "study_group_message_invalid", path: "body", message: "A mensagem do grupo precisa de um remetente e conteúdo." }]);
studyGroupMember.authorizeRecord = async (actor, action, _state, payload) =>
  ["read", "write", "publish"].includes(action) && payload.learner_user_id === actor;
studyGroupMember.validate = async (payload, context) => {
  if (typeof payload.group_record_id !== "string" || typeof payload.enrollment_record_id !== "string"
    || typeof payload.membership_key !== "string" || !context.resolveLatestRecord) return [];
  const [group, enrollment] = await Promise.all([context.resolveLatestRecord(payload.group_record_id), context.resolveLatestRecord(payload.enrollment_record_id)]);
  if (!group || group.pluginId !== "suinda-learning" || group.kind !== "study_group" || group.state !== "open"
    || !enrollment || enrollment.pluginId !== "suinda-learning" || enrollment.kind !== "enrollment"
    || enrollment.payload.learner_user_id !== payload.learner_user_id || enrollment.payload.course_record_id !== group.payload.course_record_id
    || Number(enrollment.payload.course_revision) !== Number(group.payload.course_revision)
    || group.payload.owner_user_id === payload.learner_user_id
    || !["enrolled", "active"].includes(enrollment.state))
    return [{ severity: "error", code: "study_group_membership_invalid", path: "group_record_id", message: "O grupo precisa estar aberto e pertencer ao curso da matrícula ativa." }];
  const activeMembers = await context.countLatestRecordsMatchingPayload?.("suinda-learning", "study_group_member", "active", {
    group_record_id: payload.group_record_id,
  }, `suinda-study-group:${payload.group_record_id}`);
  if (activeMembers !== null && activeMembers !== undefined && activeMembers >= Number(group.payload.capacity) - 1)
    return [{ severity: "error", code: "study_group_full", path: "group_record_id", message: "Este grupo atingiu a capacidade definida pelo criador." }];
  return [];
};

const room = kind("Sala de aula", {
  code: { ...text(80), title: "Código da sala" }, max_occupancy: integer(1, 100000), address: text(1000), floor: optionalText(160),
  accessibility: optionalText(2000), resources: list(40),
  latitude: { type: ["number", "null"], minimum: -90, maximum: 90 },
  longitude: { type: ["number", "null"], minimum: -180, maximum: 180 },
  geolocation_required: { type: "boolean" }, geofence_radius_meters: integer(25, 2000),
}, ["code", "max_occupancy", "address"], "active", { active: ["inactive"], inactive: ["active"] },
{ code: "SALA-01", max_occupancy: 30, address: "Endereço da instituição", floor: "Bloco A · 1º andar", accessibility: "", resources: ["Projetor", "Quadro"],
  latitude: null, longitude: null, geolocation_required: false });
room.uniqueFields = ["code"];
room.resourceScoped = true;
room.managePermission = "plugin.suinda-learning.manage";
room.authorizeCreate = async (_actor, _payload, context) => Boolean(
  await context.hasWorkspacePermission?.("plugin.suinda-learning.write")
    || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"),
);
room.authorizeRecord = async (_actor, _action, _state, _payload, context) => Boolean(
  await context.hasWorkspacePermission?.("plugin.suinda-learning.write")
    || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"),
);

const liveSession = kind("Aula ao vivo ou encontro", {
  cohort_record_id: recordRef("cohort"), room_record_id: recordRef("room", true), instructor_user_id: text(80), starts_at: dateTime, ends_at: dateTime, modality: choice("online", "in_person"),
  session_type: choice("regular", "makeup"), replacement_session_record_id: recordRef("session", true),
  makeup_capacity: { ...integer(0, 10000), description: "Vagas para reposição neste encontro; use zero para não publicá-lo como opção de reserva." },
  meeting_provider: choice("google_meet", "zoom", "teams", "other", "none"), meeting_url: optionalText(2000), meeting_connection_id: optionalText(80), meeting_owner_user_id: optionalText(80), zoom_meeting_id: optionalText(100), zoom_connection_id: optionalText(80), zoom_owner_user_id: optionalText(80), location: optionalText(1000), recording_url: optionalText(2000), reminder_sent_at: dateTime,
}, ["cohort_record_id", "starts_at", "ends_at", "modality"], "scheduled", { scheduled: ["live", "completed", "canceled"], live: ["completed", "canceled"], completed: [], canceled: [] }, { cohort_record_id: "cohort-record-id", room_record_id: null, starts_at: "2030-01-01T12:00:00Z", ends_at: "2030-01-01T13:00:00Z", modality: "online", meeting_provider: "none", session_type: "regular", replacement_session_record_id: null, makeup_capacity: 0 });

const academicCalendarEvent = kind("Evento do calendário acadêmico", {
  event_type: choice("holiday", "recess"), description: optionalText(4000),
  starts_at: dateTime, ends_at: dateTime, all_day: { type: "boolean" }, location: optionalText(1000),
  course_record_id: recordRef("course", true, "course_revision"), course_revision: { type: ["integer", "null"], minimum: 1 },
  cohort_record_id: recordRef("cohort", true),
}, ["event_type", "starts_at", "ends_at", "all_day"], "draft", { draft: ["published", "canceled"], published: ["canceled"], canceled: [] }, {
  event_type: "holiday", description: "Feriado da instituição", starts_at: "2030-04-21T00:00:00.000Z",
  ends_at: "2030-04-22T00:00:00.000Z", all_day: true, course_record_id: null, course_revision: null,
  cohort_record_id: null,
});
academicCalendarEvent.resourceScoped = true;
academicCalendarEvent.managePermission = "plugin.suinda-learning.manage";
async function academicEventStaff(actor: string, payload: Record<string, unknown>, context: RecordValidationContext) {
  if (await context.hasWorkspacePermission?.("plugin.suinda-learning.write")
    || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage")) return true;
  if (typeof payload.course_record_id !== "string" || !context.resolveLatestRecord) return false;
  const course = await context.resolveLatestRecord(payload.course_record_id);
  if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course") return false;
  const assigned = (members: unknown) => Array.isArray(members) && members.includes(actor);
  if (assigned(course.payload.instructor_ids) || assigned(course.payload.tutor_ids)) return true;
  if (typeof payload.cohort_record_id !== "string") return false;
  const cohort = await context.resolveLatestRecord(payload.cohort_record_id);
  return Boolean(cohort?.pluginId === "suinda-learning" && cohort.kind === "cohort"
    && cohort.payload.course_record_id === course.id && (assigned(cohort.payload.instructor_ids) || assigned(cohort.payload.tutor_ids)));
}
academicCalendarEvent.authorizeCreate = academicEventStaff;
academicCalendarEvent.authorizeRecord = async (actor, action, _state, payload, context) =>
  ["read", "write", "publish"].includes(action) && await academicEventStaff(actor, payload, context);
academicCalendarEvent.validate = combine(
  pinnedRecord("course_record_id", "course_revision", "course"),
  relatedRecord("cohort_record_id", "cohort"),
  async (payload, context) => {
    const start = typeof payload.starts_at === "string" ? Date.parse(payload.starts_at) : NaN;
    const end = typeof payload.ends_at === "string" ? Date.parse(payload.ends_at) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return [{ severity: "error", code: "academic_event_window_invalid", path: "ends_at", message: "O fim do evento precisa ocorrer depois do início." }];
    if (typeof payload.cohort_record_id === "string" && context.resolveLatestRecord) {
      const cohort = await context.resolveLatestRecord(payload.cohort_record_id);
      if (!payload.course_record_id || (cohort && (cohort.payload.course_record_id !== payload.course_record_id
        || Number(cohort.payload.course_revision) !== Number(payload.course_revision))))
        return [{ severity: "error", code: "academic_event_cohort_mismatch", path: "cohort_record_id", message: "A turma precisa pertencer à edição curricular selecionada." }];
    }
    return [];
  },
);

const attendance = kind("Frequência", {
  enrollment_record_id: recordRef("enrollment"), session_record_id: recordRef("session"), learner_user_id: text(80), status: choice("present", "absent", "justified", "late", "early_departure"),
  minutes_attended: integer(0, 100000), checkin_method: choice("manual", "qr", "teacher", "geolocation", "online"), geolocation_verified: { type: "boolean" }, justification_record_id: optionalText(80), makeup_request_record_id: recordRef("makeup_request", true), notes: optionalText(2000),
  attendance_key: text(180), marked_by_user_id: text(80), marked_at: dateTime,
}, ["enrollment_record_id", "session_record_id", "learner_user_id", "status", "attendance_key", "marked_by_user_id", "marked_at"], "recorded", { recorded: ["corrected"], corrected: [] }, { enrollment_record_id: "enrollment-record-id", session_record_id: "session-record-id", learner_user_id: "user-id", status: "present", attendance_key: "session:enrollment", marked_by_user_id: "teacher-id", marked_at: "2030-01-01T13:00:00Z", minutes_attended: 60, checkin_method: "teacher" });
Object.assign(attendance, learnerPrivateRecord("learner_user_id", false));
attendance.serverCreated = true;
attendance.uniqueFields = ["attendance_key"];

const paymentEntry = kind("Registro financeiro de pagamento", {
  enrollment_record_id: recordRef("enrollment"), learner_user_id: text(80), course_record_id: recordRef("course"), course_revision: integer(1),
  amount: number(0, 10000000), currency: text(3), payment_method: choice("pix", "bank_transfer", "cash", "card_external", "boleto", "scholarship", "refund", "waiver", "other"),
  refund_of_payment_entry_id: optionalText(80),
  payment_reference: optionalText(200), notes: optionalText(2000), paid_at: dateTime, recorded_by_user_id: text(80), payment_key: text(180),
}, ["enrollment_record_id", "learner_user_id", "course_record_id", "course_revision", "amount", "currency", "payment_method", "paid_at", "recorded_by_user_id", "payment_key"],
"recorded", { recorded: [] }, { enrollment_record_id: "enrollment-record-id", learner_user_id: "user-id", course_record_id: "course-record-id",
  course_revision: 1, amount: 100, currency: "BRL", payment_method: "pix", payment_reference: "TXID", notes: "Baixa manual", paid_at: "2030-01-01T12:00:00Z",
  recorded_by_user_id: "coordinator-id", payment_key: "enrollment:operation" }, ["recorded"]);
paymentEntry.serverCreated = true;
paymentEntry.resourceScoped = true;
paymentEntry.managePermission = "plugin.suinda-learning.manage";
paymentEntry.authorizeRecord = async (actor, action, _state, payload, context) => {
  if (action === "read" && context.resolveLatestRecord && typeof payload.enrollment_record_id === "string") {
    const enrollment = await context.resolveLatestRecord(payload.enrollment_record_id);
    if (enrollment?.kind === "enrollment" && enrollment.payload.learner_user_id === actor) return true;
  }
  return Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"));
};
paymentEntry.uniqueFields = ["payment_key"];

const makeupFeeEntry = kind("Baixa de taxa de reposição", {
  enrollment_record_id: recordRef("enrollment"), makeup_request_record_id: recordRef("makeup_request"), learner_user_id: text(80),
  entry_type: choice("payment", "waiver"), amount: { ...number(0.01, 1000000), description: "Valor recebido ou isentado." }, currency: text(3),
  payment_method: choice("pix", "bank_transfer", "cash", "card_external", "boleto", "other"), payment_reference: optionalText(200),
  notes: optionalText(2000), paid_at: dateTime, recorded_by_user_id: text(80), entry_key: text(180),
}, ["enrollment_record_id", "makeup_request_record_id", "learner_user_id", "entry_type", "amount", "currency", "paid_at", "recorded_by_user_id", "entry_key"],
"recorded", { recorded: [] }, { enrollment_record_id: "enrollment-record-id", makeup_request_record_id: "makeup-request-id",
  learner_user_id: "user-id", entry_type: "payment", amount: 25, currency: "BRL", payment_method: "pix",
  paid_at: "2030-01-01T12:00:00Z", recorded_by_user_id: "coordinator-id", entry_key: "makeup:request:operation" }, ["recorded"]);
makeupFeeEntry.serverCreated = true;
makeupFeeEntry.resourceScoped = true;
makeupFeeEntry.managePermission = "plugin.suinda-learning.manage";
makeupFeeEntry.personalOwnerField = "learner_user_id";
makeupFeeEntry.uniqueFields = ["entry_key"];
makeupFeeEntry.authorizeRecord = async (actor, action, _state, payload, context) =>
  action === "read" && payload.learner_user_id === actor
    || action === "read" && Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
      || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"));
makeupFeeEntry.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  relatedRecord("makeup_request_record_id", "makeup_request"),
  async (payload, context) => {
    if (!context.resolveLatestRecord) return [];
    const [enrollment, request] = await Promise.all([
      context.resolveLatestRecord(String(payload.enrollment_record_id || "")),
      context.resolveLatestRecord(String(payload.makeup_request_record_id || "")),
    ]);
    return enrollment?.pluginId === "suinda-learning" && enrollment.kind === "enrollment"
      && request?.pluginId === "suinda-learning" && request.kind === "makeup_request"
      && enrollment.id === request.payload.enrollment_record_id && enrollment.payload.learner_user_id === payload.learner_user_id
      && request.payload.learner_user_id === payload.learner_user_id
      ? [] : [{ severity: "error", code: "makeup_fee_relationship_invalid", path: "makeup_request_record_id", message: "A baixa precisa pertencer à matrícula e à solicitação de reposição do aluno." }];
  },
);

function validateAssessmentQuestions(rawQuestions: unknown, root: string) {
  if (!Array.isArray(rawQuestions)) return [];
  const issues: Array<{ severity: "error"; code: string; path: string; message: string }> = [];
  const ids = new Set<string>();
  for (const [index, raw] of rawQuestions.entries()) {
    const question = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const path = `${root}[${index}]`;
    if (typeof question.id !== "string" || !question.id.trim() || ids.has(question.id)) {
      issues.push({ severity: "error", code: "assessment_question_id_invalid", path: `${path}.id`, message: "Cada questão precisa ter um identificador único." });
    } else ids.add(question.id);
    if (!["single_choice", "multiple_choice", "short_answer", "essay"].includes(String(question.type)))
      issues.push({ severity: "error", code: "assessment_question_type_unsupported", path: `${path}.type`, message: "Use escolha única, múltipla, resposta curta ou questão discursiva." });
    if (typeof question.prompt !== "string" || !question.prompt.trim())
      issues.push({ severity: "error", code: "assessment_question_prompt_required", path: `${path}.prompt`, message: "Informe o enunciado da questão." });
    const options = Array.isArray(question.options) ? question.options : [];
    const optionIds = new Set<string>();
    const manual = question.type === "short_answer" || question.type === "essay";
    if (!manual && (options.length < 2 || options.length > 20 || options.some((rawOption) => {
      const option = rawOption && typeof rawOption === "object" ? rawOption as Record<string, unknown> : {};
      if (typeof option.id !== "string" || !option.id || typeof option.text !== "string" || !option.text.trim() || optionIds.has(option.id)) return true;
      optionIds.add(option.id);
      return false;
    }))) issues.push({ severity: "error", code: "assessment_options_invalid", path: `${path}.options`, message: "Cada questão precisa ter de duas a vinte alternativas válidas e únicas." });
    const correct = Array.isArray(question.correct_option_ids) ? question.correct_option_ids : [];
    if (!manual && (!correct.length || correct.some((value) => typeof value !== "string" || !optionIds.has(value))
      || new Set(correct).size !== correct.length || question.type === "single_choice" && correct.length !== 1))
      issues.push({ severity: "error", code: "assessment_correct_options_invalid", path: `${path}.correct_option_ids`, message: "Defina alternativas corretas válidas para esta questão." });
    if (typeof question.points !== "number" || !Number.isFinite(question.points) || question.points <= 0 || question.points > 1000)
      issues.push({ severity: "error", code: "assessment_question_points_invalid", path: `${path}.points`, message: "A pontuação da questão precisa ser maior que zero." });
    if (question.max_length !== undefined && (!Number.isInteger(question.max_length) || Number(question.max_length) < 100 || Number(question.max_length) > 50000))
      issues.push({ severity: "error", code: "assessment_question_max_length_invalid", path: `${path}.max_length`, message: "O limite de resposta deve ficar entre 100 e 50.000 caracteres." });
  }
  return issues;
}

function validateRubric(rawRubric: unknown) {
  if (!Array.isArray(rawRubric)) return [];
  const issues: Array<{ severity: "error"; code: string; path: string; message: string }> = [];
  const ids = new Set<string>();
  for (const [index, raw] of rawRubric.entries()) {
    const criterion = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const path = `rubric[${index}]`;
    const criterionId = typeof criterion.id === "string" && criterion.id.trim() ? criterion.id.trim() : `criterion-${index + 1}`;
    if (ids.has(criterionId))
      issues.push({ severity: "error", code: "assessment_rubric_id_invalid", path: `${path}.id`, message: "Cada critério precisa ter um identificador único." });
    else ids.add(criterionId);
    if (typeof criterion.criterion !== "string" || !criterion.criterion.trim())
      issues.push({ severity: "error", code: "assessment_rubric_criterion_required", path: `${path}.criterion`, message: "Informe o nome do critério." });
    if (typeof criterion.points !== "number" || !Number.isFinite(criterion.points) || criterion.points <= 0 || criterion.points > 1000)
      issues.push({ severity: "error", code: "assessment_rubric_points_invalid", path: `${path}.points`, message: "A pontuação máxima do critério precisa ser maior que zero." });
  }
  if (rawRubric.length > 100)
    issues.push({ severity: "error", code: "assessment_rubric_too_large", path: "rubric", message: "A rubrica aceita até cem critérios." });
  return issues;
}

const questionOptionSchema = {
  type: "object", properties: { id: text(80), text: text(1000) }, required: ["id", "text"],
};
const assessmentQuestionSchema = {
  type: "object", properties: {
    id: text(80), type: { enum: ["single_choice", "multiple_choice", "short_answer", "essay"], enumLabels: { single_choice: "Escolha única", multiple_choice: "Escolha múltipla", short_answer: "Resposta curta", essay: "Discursiva" } },
    prompt: text(12000), options: { type: "array", maxItems: 20, items: questionOptionSchema },
    correct_option_ids: list(20), points: number(0.01, 1000), max_length: integer(100, 50000),
    category: optionalText(120), difficulty: choice("beginner", "intermediate", "advanced"),
  }, required: ["id", "type", "prompt", "points"],
};
const questionBank = kind("Banco de questões", {
  category: optionalText(120), tags: list(50), questions: { type: "array", maxItems: 500, items: assessmentQuestionSchema },
}, ["questions"], "draft", { draft: ["published", "archived"], published: ["archived"], archived: [] },
{ questions: [{ id: "questao-1", type: "single_choice", prompt: "Escreva o enunciado.", options: [{ id: "a", text: "Alternativa A" }, { id: "b", text: "Alternativa B" }], correct_option_ids: ["a"], points: 1 }] });
questionBank.immutable = ["published", "archived"];
questionBank.validate = async (payload) => {
  const issues = validateAssessmentQuestions(payload.questions, "questions");
  if (!Array.isArray(payload.questions) || payload.questions.length === 0)
    issues.push({ severity: "error", code: "question_bank_empty", path: "questions", message: "Inclua pelo menos uma questão no banco." });
  return issues;
};
questionBank.authorizeRecord = async (_actor, action, _state, _payload, context) => {
  if (action === "read") {
    for (const permission of ["plugin.suinda-learning.write", "plugin.suinda-learning.publish", "plugin.suinda-learning.manage"])
      if (await context.hasPermission?.(permission) || await context.hasWorkspacePermission?.(permission)
        || context.recordId && await context.hasPermissionOnResource?.(permission, context.recordId)) return true;
    return false;
  }
  const permission = `plugin.suinda-learning.${action}`;
  return Boolean(await context.hasPermission?.(permission) || await context.hasWorkspacePermission?.(permission)
    || context.recordId && await context.hasPermissionOnResource?.(permission, context.recordId));
};

const questionBankRefs = {
  type: "array", maxItems: 100, uniqueItems: true,
  items: { type: "object", properties: { record_id: { ...recordRef("question_bank"), recordRevisionField: "revision" }, revision: integer(1, 100000) }, required: ["record_id", "revision"] },
};
const rubricSchema = { type: "array", maxItems: 100, items: { type: "object", properties: {
  id: { ...text(80), title: "ID do critério (opcional)" }, criterion: text(240), description: optionalText(2000), points: number(0.01, 1000),
}, required: ["criterion", "points"] } };

const assessment = kind("Avaliação", {
  course_record_id: recordRef("course"), cohort_record_id: recordRef("cohort", true), module_record_id: recordRef("module", true), assessment_type: choice("quiz", "exam", "assignment", "project", "practical"),
  instructions: text(12000), opens_at: dateTime, due_at: dateTime, time_limit_minutes: integer(0, 10080), max_attempts: integer(1, 100), passing_score: number(0, 100),
  recovery_for_assessment_id: { ...recordRef("assessment", true), recordRevisionField: "recovery_for_assessment_revision" },
  recovery_for_assessment_revision: { type: ["integer", "null"], minimum: 1, maximum: 100000 },
  required_for_certificate: { type: "boolean", description: "Quando ativo, a pessoa precisa concluir esta avaliação com a nota mínima configurada para receber o certificado." },
  questions_per_attempt: integer(0, 500), randomize_questions: { type: "boolean" }, randomize_options: { type: "boolean" },
  question_bank_refs: questionBankRefs, question_category_filter: optionalText(120), question_difficulty_filter: choice("beginner", "intermediate", "advanced"),
  question_set: { type: "array", maxItems: 500, items: assessmentQuestionSchema }, rubric: rubricSchema, group_submission: { type: "boolean" },
}, ["course_record_id", "assessment_type", "instructions"], "draft", { draft: ["published", "closed", "archived"], published: ["closed", "archived"], closed: ["archived"], archived: [] }, { course_record_id: "course-record-id", assessment_type: "assignment", instructions: "Descreva a atividade.", max_attempts: 1, passing_score: 70, required_for_certificate: true, questions_per_attempt: 0, randomize_questions: false, randomize_options: false, question_set: [], question_bank_refs: [], rubric: [], group_submission: false });
assessment.availableTransitions = async (state, payload) => {
  const transitions = assessment.transitions[state] || [];
  if (state === "draft" && ["quiz", "exam"].includes(String(payload.assessment_type))
    && (!Array.isArray(payload.question_set) || payload.question_set.length === 0)
    && (!Array.isArray(payload.question_bank_refs) || payload.question_bank_refs.length === 0))
    return transitions.filter((next) => next !== "published");
  return transitions;
};

const submission = kind("Entrega e correção", {
  assessment_record_id: recordRef("assessment"), learner_user_id: text(80), group_id: optionalText(80), group_member_user_ids: list(30), files: list(100), answer: optionalText(50000), submitted_at: dateTime,
  rubric_snapshot: rubricSchema, score: number(0, 100), criterion_scores: { type: "array", maxItems: 100, items: { type: "object", properties: { criterion_id: text(80), score: number(0, 1000), feedback: optionalText(4000) }, required: ["criterion_id", "score"] } },
  feedback: optionalText(12000), grader_user_id: optionalText(80), graded_at: dateTime, version: integer(1, 1000), late: { type: "boolean" },
}, ["assessment_record_id", "learner_user_id", "version"], "draft", { draft: ["submitted"], submitted: ["late", "grading"], late: ["grading"], grading: ["returned", "completed"], returned: ["resubmitted"], resubmitted: ["grading"], completed: [] }, { assessment_record_id: "assessment-record-id", learner_user_id: "user-id", version: 1, late: false });
Object.assign(submission, learnerPrivateRecord("learner_user_id", true, ["returned"]));
submission.selfServiceCreate = true;
submission.authorizeRecord = async (actor, action, state, payload, context) => {
  const groupMembers = Array.isArray(payload.group_member_user_ids) ? payload.group_member_user_ids : [];
  if (groupMembers.includes(actor) && (action === "read" || action === "write" && state === "returned" || action === "publish" && state === "returned")) return true;
  if (payload.learner_user_id === actor && (action === "read" || action === "write" && state === "draft" || action === "publish" && ["draft", "returned"].includes(state))) return true;
  return Boolean(context.recordId && await context.hasPermissionOnResource?.(`plugin.suinda-learning.${action}`, context.recordId)
    || await context.hasWorkspacePermission?.(`plugin.suinda-learning.${action}`));
};
submission.sensitiveAttachments = true;
submission.authorizeAttachment = async (actor, action, state, payload, context) => {
  if (Array.isArray(payload.group_member_user_ids) && payload.group_member_user_ids.includes(actor))
    return action === "read" || ["submitted", "late", "resubmitted"].includes(state);
  if (payload.learner_user_id === actor)
    return action === "read" || ["submitted", "late", "resubmitted"].includes(state);
  if (action !== "read") return false;
  if (await context.hasWorkspacePermission?.("plugin.suinda-learning.read")
    || await context.hasWorkspacePermission?.("plugin.suinda-learning.write")
    || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")) return true;
  if (typeof payload.assessment_record_id !== "string" || !context.listLatestRecords) return false;
  const [assessments, courses, cohorts] = await Promise.all([
    context.listLatestRecords("suinda-learning", "assessment", {}, undefined, 1000),
    context.listLatestRecords("suinda-learning", "course", {}, undefined, 1000),
    context.listLatestRecords("suinda-learning", "cohort", {}, undefined, 1000),
  ]);
  if (!assessments || !courses || !cohorts) return false;
  const assessmentRecord = assessments.find((record) => record.id === payload.assessment_record_id);
  if (!assessmentRecord) return false;
  const course = courses.find((record) => record.id === assessmentRecord.payload.course_record_id);
  if (Array.isArray(course?.payload.instructor_ids) && course.payload.instructor_ids.includes(actor)) return true;
  const cohort = cohorts.find((record) => record.id === assessmentRecord.payload.cohort_record_id);
  return [cohort?.payload.instructor_ids, cohort?.payload.tutor_ids]
    .some((members) => Array.isArray(members) && members.includes(actor));
};

const assessmentAttempt = kind("Tentativa de avaliação", {
  assessment_record_id: recordRef("assessment"), session_record_id: recordRef("assessment_session"), enrollment_record_id: recordRef("enrollment"), learner_user_id: text(80),
  attempt_number: integer(1, 100), attempt_key: text(240), operation_id: text(80), request_hash: text(64), answers: { type: "array", maxItems: 500, items: { type: "object" } },
  submitted_at: dateTime, passing_score: number(0, 100), grading_status: choice("pending", "completed"), score: number(0, 100), passed: { type: "boolean" }, feedback: optionalText(12000), graded_at: dateTime, grader_user_id: optionalText(80),
}, ["assessment_record_id", "session_record_id", "enrollment_record_id", "learner_user_id", "attempt_number", "attempt_key", "operation_id", "request_hash", "answers", "submitted_at", "grading_status"], "submitted", { submitted: ["grading", "completed"], grading: ["completed"], completed: [] },
{ assessment_record_id: "assessment-record-id", session_record_id: "assessment-session-id", enrollment_record_id: "enrollment-record-id", learner_user_id: "user-id", attempt_number: 1, attempt_key: "enrollment:assessment:1", operation_id: "operation-id", request_hash: "request-hash", answers: [], submitted_at: "2030-01-01T12:00:00Z", grading_status: "completed", score: 100, passed: true }, ["completed"]);
Object.assign(assessmentAttempt, learnerPrivateRecord("learner_user_id", true));
assessmentAttempt.serverCreated = true;
assessmentAttempt.uniqueFields = ["attempt_key", "operation_id", "session_record_id"];
assessmentAttempt.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  relatedRecord("session_record_id", "assessment_session"),
  async (payload, context) => {
    const enrollmentId = typeof payload.enrollment_record_id === "string" ? payload.enrollment_record_id : null;
    if (!enrollmentId || !context.resolveLatestRecord) return [];
    const enrollmentRecord = await context.resolveLatestRecord(enrollmentId);
    if (!enrollmentRecord || enrollmentRecord.payload.learner_user_id !== context.actorId
      || payload.learner_user_id !== context.actorId
      || !["enrolled", "active", "completed"].includes(enrollmentRecord.state)) {
      return [{ severity: "error", code: "assessment_attempt_owner_invalid", path: "learner_user_id", message: "A tentativa exige uma matrícula ativa do aluno autenticado." }];
    }
    return [];
  },
);

const assessmentSession = kind("Sessão cronometrada de avaliação", {
  assessment_record_id: recordRef("assessment"), enrollment_record_id: recordRef("enrollment"), learner_user_id: text(80),
  attempt_number: integer(1, 100), attempt_key: text(240), operation_id: text(80), request_hash: text(64), started_at: dateTime,
  assessment_revision: integer(1, 1000000), passing_score: number(0, 100),
  question_snapshot: { type: "array", maxItems: 500, items: { type: "object" } },
  expires_at: { type: ["string", "null"], format: "date-time" }, question_order: { type: "array", maxItems: 500, items: { type: "string", maxLength: 160 } },
}, ["assessment_record_id", "enrollment_record_id", "learner_user_id", "attempt_number", "attempt_key", "operation_id", "request_hash", "started_at", "expires_at", "question_order"], "started", { started: [] },
{ assessment_record_id: "assessment-record-id", enrollment_record_id: "enrollment-record-id", learner_user_id: "user-id", attempt_number: 1, attempt_key: "enrollment:assessment:1", operation_id: "operation-id", request_hash: "request-hash", started_at: "2030-01-01T12:00:00Z", expires_at: "2030-01-01T12:30:00Z", question_order: ["question-1"] }, ["started"]);
Object.assign(assessmentSession, learnerPrivateRecord("learner_user_id", true));
assessmentSession.serverCreated = true;
assessmentSession.uniqueFields = ["attempt_key", "operation_id"];
assessmentSession.authorizeRecord = async (actor, action, _state, payload, context) => {
  if (action === "read" && payload.learner_user_id === actor) return false;
  return Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"));
};
assessmentSession.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  async (payload, context) => payload.learner_user_id === context.actorId ? []
    : [{ severity: "error", code: "assessment_session_owner_invalid", path: "learner_user_id", message: "A sessão deve pertencer ao aluno autenticado." }],
);

const practice = kind("Prática supervisionada", {
  enrollment_record_id: recordRef("enrollment"), learner_user_id: text(80), supervisor_user_id: text(80), location: optionalText(1000), scheduled_at: dateTime,
  hours_claimed: number(0, 10000), hours_validated: number(0, 10000), activity_description: text(8000), completion_notes: optionalText(8000),
  observations: optionalText(8000), review_feedback: optionalText(4000), submitted_at: dateTime, reviewed_at: dateTime,
  validated_by_user_id: optionalText(80), validation_outcome: choice("pending", "approved", "rejected"),
}, ["enrollment_record_id", "learner_user_id", "activity_description"], "scheduled", { scheduled: ["in_progress", "canceled"], in_progress: ["submitted", "canceled"], submitted: ["validated", "needs_correction"], needs_correction: ["submitted"], validated: [], canceled: [] }, { enrollment_record_id: "enrollment-record-id", learner_user_id: "user-id", activity_description: "Atividade supervisionada", hours_claimed: 0, hours_validated: 0, validation_outcome: "pending" });
Object.assign(practice, learnerPrivateRecord("learner_user_id", false));
practice.authorizeRecord = async (actor, action, _state, payload, context) => {
  if (payload.learner_user_id === actor) return action === "read";
  if (!(["read", "write", "publish"].includes(action))) return false;
  if (await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")) return true;
  if (payload.supervisor_user_id === actor) return true;
  if (typeof payload.enrollment_record_id !== "string" || !context.resolveLatestRecord) return false;
  const enrollment = await context.resolveLatestRecord(payload.enrollment_record_id);
  if (!enrollment || enrollment.pluginId !== "suinda-learning" || enrollment.kind !== "enrollment") return false;
  const [course, cohort] = await Promise.all([
    typeof enrollment.payload.course_record_id === "string" ? context.resolveLatestRecord(enrollment.payload.course_record_id) : null,
    typeof enrollment.payload.cohort_record_id === "string" ? context.resolveLatestRecord(enrollment.payload.cohort_record_id) : null,
  ]);
  return [course?.payload.instructor_ids, cohort?.payload.instructor_ids, cohort?.payload.tutor_ids]
    .some((members) => Array.isArray(members) && members.includes(actor));
};
practice.validate = combine(relatedRecord("enrollment_record_id", "enrollment"), async (payload, context) => {
  if (!context.resolveLatestRecord || typeof payload.enrollment_record_id !== "string") return [];
  const enrollment = await context.resolveLatestRecord(payload.enrollment_record_id);
  return enrollment?.payload.learner_user_id === payload.learner_user_id
    ? []
    : [{ severity: "error", code: "practice_enrollment_owner_invalid", path: "learner_user_id", message: "A prática precisa pertencer ao aluno da matrícula vinculada." }];
});

export const defaultCertificateTemplate = {
  organization_name: "SUINDÁ · FORMAÇÃO",
  certificate_title: "CERTIFICADO",
  opening_text: "Certificamos que",
  completion_text: "concluiu o curso",
  signers_label: "Responsáveis acadêmicos",
  footer_text: "Certificado verificável pela plataforma Suindá",
  accent_color: "#123442",
  border_color: "#59c8d2",
};
const certificateTemplate = kind("Modelo de certificado", {
  template_key: { type: "string", pattern: "^[a-z][a-z0-9_-]{1,39}$" },
  ...Object.fromEntries(Object.entries(defaultCertificateTemplate).map(([key]) => [key, key.endsWith("color") ? { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } : text(300)])),
}, ["template_key", ...Object.keys(defaultCertificateTemplate)], "draft", { draft: ["published", "archived"], published: ["draft", "archived"], archived: [] }, {
  template_key: "default", ...defaultCertificateTemplate,
});
certificateTemplate.resourceScoped = true;
certificateTemplate.managePermission = "plugin.suinda-learning.manage";
certificateTemplate.uniqueFields = ["template_key"];

const certificate = kind("Certificado", {
  certificate_kind: choice("completion", "participation", "milestone"), participation_scope: optionalText(2000),
  milestone_key: optionalText(40), milestone_title: optionalText(120), milestone_lesson_titles: { type: "array", maxItems: 50, items: text(180) }, completed_at: dateTime,
  enrollment_record_id: recordRef("enrollment"), learner_user_id: text(80), certificate_code: text(120), workload_hours: number(0, 10000), issued_at: dateTime, expires_at: date,
  signer_names: list(20), template_record_id: optionalText(80), template_revision: integer(1, 1000000),
  template_snapshot: { type: "object", additionalProperties: false, properties: Object.fromEntries(Object.entries(defaultCertificateTemplate).map(([key]) => [key, key.endsWith("color") ? { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } : text(300)])), required: Object.keys(defaultCertificateTemplate) },
  file_record_id: optionalText(80), public_validation_enabled: { type: "boolean" }, revocation_reason: optionalText(2000),
}, ["enrollment_record_id", "learner_user_id", "certificate_code", "workload_hours"], "draft", { draft: ["issued", "canceled"], issued: ["revoked"], revoked: [], canceled: [] }, { certificate_kind: "completion", enrollment_record_id: "enrollment-record-id", learner_user_id: "user-id", certificate_code: "SUINDA-DEMO-0001", workload_hours: 1, public_validation_enabled: false }, ["certificate_code"]);
Object.assign(certificate, learnerPrivateRecord("learner_user_id", false));
certificate.uniqueFields = ["certificate_code"];
certificate.prepareTransition = async (_from, to, payload, context) => {
  if (to !== "issued") return payload;
  if (typeof payload.enrollment_record_id !== "string") throw new Error("O certificado precisa estar vinculado a uma matrícula.");
  if (payload.certificate_kind === "participation") {
    if (!await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"))
      throw new Error("A emissão de certificado de participação exige autorização da gestão acadêmica.");
    if (typeof payload.participation_scope !== "string" || !payload.participation_scope.trim())
      throw new Error("O certificado de participação precisa descrever as atividades abrangidas.");
    if (typeof payload.completed_at !== "string" || !Number.isFinite(Date.parse(payload.completed_at)))
      throw new Error("Informe a data em que a participação foi concluída.");
    if (typeof payload.workload_hours !== "number" || !Number.isFinite(payload.workload_hours) || payload.workload_hours <= 0)
      throw new Error("Informe uma carga horária positiva para as atividades abrangidas.");
  } else if (payload.certificate_kind === "milestone") {
    if (typeof payload.milestone_key !== "string" || !/^[a-z][a-z0-9_-]{1,39}$/.test(payload.milestone_key)
      || typeof payload.milestone_title !== "string" || !payload.milestone_title.trim())
      throw new Error("O certificado intermediário precisa identificar o marco configurado na versão do curso.");
    if (typeof payload.participation_scope !== "string" || !payload.participation_scope.trim())
      throw new Error("O certificado intermediário precisa registrar as aulas abrangidas.");
  } else {
  const attendance = await attendanceEligibility(payload.enrollment_record_id, context);
  if (!attendance) throw new Error("Não foi possível verificar a frequência da matrícula.");
  if (!attendance.eligible) throw new Error(`A frequência de ${attendance.percent}% está abaixo do mínimo de ${attendance.minimum}% para certificação.`);
  }
  const enrollment = await context.resolveLatestRecord?.(payload.enrollment_record_id);
  const completedAt = typeof payload.completed_at === "string" ? payload.completed_at
    : typeof enrollment?.payload.completed_at === "string" ? enrollment.payload.completed_at
      : new Date().toISOString();
  return { ...payload, certificate_kind: payload.certificate_kind === "participation" ? "participation" : payload.certificate_kind === "milestone" ? "milestone" : "completion",
    completed_at: completedAt,
    certificate_code: `SUINDA-${randomUUID()}`, public_validation_enabled: payload.public_validation_enabled !== false, issued_at: new Date().toISOString() };
};

const application = kind("Candidatura a bolsa", {
  program_record_id: recordRef("scholarship", false, "program_revision"), program_revision: integer(1), learner_user_id: text(80),
  enrollment_record_id: recordRef("enrollment"), course_record_id: recordRef("course", false, "course_revision"), course_revision: integer(1),
  application_key: text(180), documents: list(50), document_uploads: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false,
    required: ["attachment_id", "category", "file_name", "mime_type", "size_bytes", "sha256"], properties: {
      attachment_id: text(80), category: text(80), file_name: text(240), mime_type: text(160), size_bytes: integer(0, 8388608), sha256: text(64),
    } } },
  discount_percent: number(0, 100), score: number(0, 1000),
  scoring_criteria_snapshot: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false,
    properties: { id: { type: "string", pattern: "^[a-z][a-z0-9_-]{1,39}$" }, label: text(160), max_points: integer(1, 1000), guidance: optionalText(1000) },
    required: ["id", "label", "max_points"] } },
  criterion_scores: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false,
    properties: { criterion_id: { type: "string", pattern: "^[a-z][a-z0-9_-]{1,39}$" }, score: integer(0, 1000), feedback: optionalText(4000) },
    required: ["criterion_id", "score"] } },
  reviewer_user_id: optionalText(80), decision_reason: optionalText(4000), waitlist_position: integer(1),
  counterparty_requirements_snapshot: longTextList(50),
  terms_version: text(80), terms_text_snapshot: text(8000), terms_accepted_at: dateTime,
  terms_signature_name: text(240), terms_signature_user_id: text(80), terms_signature_at: dateTime,
  terms_signature_method: choice("authenticated_typed_name"),
  terms_signature_text_sha256: text(64), terms_signature_evidence_sha256: text(64),
  submitted_at: dateTime, approved_at: dateTime, waitlist_invited_at: dateTime, waitlist_called_position: integer(1),
}, ["program_record_id", "program_revision", "learner_user_id", "enrollment_record_id", "course_record_id", "course_revision", "application_key", "terms_version", "terms_text_snapshot", "terms_accepted_at", "submitted_at"], "draft", { draft: ["submitted", "withdrawn"], submitted: ["under_review", "waitlisted", "approved", "rejected", "withdrawn"], under_review: ["waitlisted", "approved", "rejected"], waitlisted: ["approved", "rejected", "withdrawn"], approved: [], rejected: [], withdrawn: [] }, { program_record_id: "scholarship-record-id", program_revision: 1, learner_user_id: "user-id", enrollment_record_id: "enrollment-record-id", course_record_id: "course-record-id", course_revision: 1, application_key: "scholarship:enrollment", discount_percent: 50, documents: [], document_uploads: [], terms_version: "v1", terms_text_snapshot: "Termos do programa", terms_accepted_at: "2030-01-01T12:00:00Z", submitted_at: "2030-01-01T12:00:00Z" });
Object.assign(application, learnerPrivateRecord());
application.selfServiceCreate = true;
// Scholarship evidence can contain income, household and other special-category data.
// Use the shared Orbit attachment envelope at rest, including copied revisions.
application.sensitiveAttachments = true;
application.uniqueFields = ["application_key"];
application.authorizeTransition = async () => false;
application.immutablePayloadFieldsAfterInitial = ["program_record_id", "program_revision", "learner_user_id", "enrollment_record_id", "course_record_id", "course_revision",
  "application_key", "counterparty_requirements_snapshot", "terms_version", "terms_text_snapshot", "terms_accepted_at", "terms_signature_name", "terms_signature_user_id",
  "terms_signature_at", "terms_signature_method", "terms_signature_text_sha256", "terms_signature_evidence_sha256", "scoring_criteria_snapshot"];

const scholarshipCounterparty = kind("Contrapartida de bolsa", {
  requirement_key: text(80), scholarship_application_id: recordRef("scholarship_application"),
  program_record_id: recordRef("scholarship", false, "program_revision"), program_revision: integer(1),
  enrollment_record_id: recordRef("enrollment"), learner_user_id: text(80), requirement_text: text(2000),
  evidence_text: optionalText(4000), evidence_files: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false,
    required: ["attachment_id", "file_name", "mime_type", "size_bytes", "sha256", "scan_status"],
    properties: { attachment_id: text(80), file_name: text(240), mime_type: choice("application/pdf", "image/png", "image/jpeg"),
      size_bytes: integer(1, 8388608), sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, scan_status: choice("clean", "not_configured") } } },
  submitted_at: dateTime, reviewer_user_id: optionalText(80), reviewed_at: dateTime, review_feedback: optionalText(2000),
}, ["requirement_key", "scholarship_application_id", "program_record_id", "program_revision", "enrollment_record_id", "learner_user_id", "requirement_text"],
"pending", { pending: ["submitted"], submitted: ["accepted", "revision_requested"], revision_requested: ["submitted"], accepted: [] },
{ requirement_key: "sha256", scholarship_application_id: "application-id", program_record_id: "program-id", program_revision: 1,
  enrollment_record_id: "enrollment-id", learner_user_id: "user-id", requirement_text: "Contrapartida conforme ao programa", evidence_files: [] });
scholarshipCounterparty.serverCreated = true;
scholarshipCounterparty.sensitiveAttachments = true;
scholarshipCounterparty.resourceScoped = true;
scholarshipCounterparty.managePermission = "plugin.suinda-learning.manage";
scholarshipCounterparty.personalOwnerField = "learner_user_id";
scholarshipCounterparty.uniqueFields = ["requirement_key"];
scholarshipCounterparty.immutablePayloadFieldsAfterInitial = ["requirement_key", "scholarship_application_id", "program_record_id", "program_revision", "enrollment_record_id", "learner_user_id", "requirement_text"];
scholarshipCounterparty.authorizeCreate = async () => false;
scholarshipCounterparty.authorizeTransition = async () => false;
const authorizeScholarshipCounterpartyRead = async (actor: string, action: string, _state: string, payload: Record<string, unknown>, context: RecordValidationContext) =>
  action === "read" && payload.learner_user_id === actor
    || Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
      || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"));
scholarshipCounterparty.authorizeRecord = authorizeScholarshipCounterpartyRead;
scholarshipCounterparty.authorizeAttachment = async (actor, action, state, payload, context) =>
  action === "read" && await authorizeScholarshipCounterpartyRead(actor, action, state, payload, context);
scholarshipCounterparty.validate = async (payload, context) => {
  if (!context.resolveLatestRecord || typeof payload.scholarship_application_id !== "string"
    || typeof payload.enrollment_record_id !== "string" || typeof payload.program_record_id !== "string") return [];
  const [applicationRecord, enrollmentRecord, programVersion] = await Promise.all([
    context.resolveLatestRecord(payload.scholarship_application_id),
    context.resolveLatestRecord(payload.enrollment_record_id),
    context.resolveRecord?.(payload.program_record_id, Number(payload.program_revision)),
  ]);
  if (applicationRecord?.pluginId !== "suinda-learning" || applicationRecord.kind !== "scholarship_application"
    || applicationRecord.state !== "approved" || applicationRecord.payload.learner_user_id !== payload.learner_user_id
    || applicationRecord.payload.enrollment_record_id !== payload.enrollment_record_id
    || applicationRecord.payload.program_record_id !== payload.program_record_id)
    return [{ severity: "error", code: "scholarship_counterparty.application_mismatch", path: "scholarship_application_id", message: "A contrapartida deve pertencer a uma bolsa aprovada do titular e matrícula selecionados." }];
  if (enrollmentRecord?.pluginId !== "suinda-learning" || enrollmentRecord.kind !== "enrollment"
    || enrollmentRecord.payload.learner_user_id !== payload.learner_user_id)
    return [{ severity: "error", code: "scholarship_counterparty.enrollment_mismatch", path: "enrollment_record_id", message: "A matrícula deve pertencer ao titular da contrapartida no mesmo workspace." }];
  if (!programVersion || programVersion.pluginId !== "suinda-learning" || programVersion.kind !== "scholarship")
    return [{ severity: "error", code: "scholarship_counterparty.program_mismatch", path: "program_record_id", message: "A revisão do programa não corresponde à candidatura aprovada." }];
  return [];
};

const scholarship = kind("Programa de bolsas", {
  description: text(4000), course_record_ids: recordList("course"), available_places: integer(0, 100000), discount_percent: number(0, 100), opens_at: dateTime, closes_at: dateTime,
  eligibility: list(50), required_documents: list(50), scoring_method: choice("manual", "weighted_v1"), scoring_criteria: { type: "array", maxItems: 100, items: { type: "object",
    properties: { id: { type: "string", pattern: "^[a-z][a-z0-9_-]{1,39}$" }, label: text(160), max_points: integer(1, 1000), guidance: optionalText(1000) },
  } }, counterparty_requirements: longTextList(50),
  terms_version: optionalText(80), concession_terms: optionalText(8000),
}, ["description", "available_places", "discount_percent"], "draft", { draft: ["open", "closed", "archived"], open: ["closed"], closed: ["archived"], archived: [] }, { description: "Programa de bolsas de demonstração", available_places: 1, discount_percent: 100, scoring_method: "manual", eligibility: [], required_documents: [] });
scholarship.validate = async (payload) => {
  if (payload.scoring_method !== "weighted_v1") return [];
  try {
    const rubric = normalizeScholarshipRubric(payload.scoring_criteria);
    if (!rubric.length) throw new Error("A rubrica ponderada precisa ter ao menos um critério.");
    return [];
  }
  catch (error) { return [{ severity: "error", code: "scholarship_rubric_invalid", path: "scoring_criteria", message: error instanceof Error ? error.message : "Rubrica de bolsa inválida." }]; }
};
scholarship.publicRead = {
  states: ["open"], fields: ["description", "course_record_ids", "available_places", "discount_percent", "opens_at", "closes_at", "eligibility", "required_documents", "scoring_method", "scoring_criteria", "counterparty_requirements", "terms_version", "concession_terms"],
};
scholarship.authorizeTransition = async (_from, to, payload) => to !== "open"
  || Number(payload.available_places) > 0 && Number(payload.discount_percent) > 0
    && Array.isArray(payload.course_record_ids) && payload.course_record_ids.length > 0
    && typeof payload.terms_version === "string" && Boolean(payload.terms_version.trim())
    && typeof payload.concession_terms === "string" && Boolean(payload.concession_terms.trim());

application.validate = combine(
  relatedRecord("program_record_id", "scholarship"),
  pinnedRecord("program_record_id", "program_revision", "scholarship"),
  relatedRecord("enrollment_record_id", "enrollment"),
  pinnedRecord("course_record_id", "course_revision", "course"),
  async (payload, context) => {
    if (!context.resolveLatestRecord || !context.resolveRecord) return [];
    const [program, course, enrollment, existingApplication] = await Promise.all([
      context.resolveRecord(String(payload.program_record_id || ""), Number(payload.program_revision)),
      context.resolveRecord(String(payload.course_record_id || ""), Number(payload.course_revision)),
      context.resolveLatestRecord(String(payload.enrollment_record_id || "")),
      context.recordId ? context.resolveLatestRecord(context.recordId) : Promise.resolve(null),
    ]);
    if (!program || program.kind !== "scholarship" || !course || course.kind !== "course" || !enrollment || enrollment.kind !== "enrollment")
      return [{ severity: "error", code: "scholarship_application_reference_invalid", path: "program_record_id", message: "Programa, curso ou inscrição da candidatura não foi encontrado." }];
    if (enrollment.payload.learner_user_id !== payload.learner_user_id || enrollment.payload.course_record_id !== course.id
      || Number(enrollment.payload.course_revision) !== Number(payload.course_revision))
      return [{ severity: "error", code: "scholarship_application_enrollment_mismatch", path: "enrollment_record_id", message: "A candidatura precisa pertencer à inscrição e revisão curricular selecionadas." }];
    let programRubric;
    try {
      programRubric = program.payload.scoring_method === "weighted_v1" ? normalizeScholarshipRubric(program.payload.scoring_criteria) : [];
      if (program.payload.scoring_method === "weighted_v1" && !programRubric.length)
        throw new Error("A rubrica ponderada do programa não contém critérios.");
    }
    catch (error) { return [{ severity: "error", code: "scholarship_rubric_invalid", path: "scoring_criteria_snapshot", message: error instanceof Error ? error.message : "A rubrica do programa é inválida." }]; }
    if (!context.recordId && JSON.stringify(payload.scoring_criteria_snapshot || []) !== JSON.stringify(programRubric))
      return [{ severity: "error", code: "scholarship_rubric_snapshot_mismatch", path: "scoring_criteria_snapshot", message: "A candidatura precisa fixar a rubrica exata da revisão do programa." }];
    const termsText = typeof program.payload.concession_terms === "string" ? program.payload.concession_terms : "";
    const expectedTermsHash = createHash("sha256").update(termsText, "utf8").digest("hex");
    const signatureName = typeof payload.terms_signature_name === "string" ? payload.terms_signature_name.trim().replace(/\s+/g, " ") : "";
    const signatureTime = payload.terms_signature_at;
    const signatureUser = payload.terms_signature_user_id;
    const signatureEvidence = createHash("sha256").update(JSON.stringify({
      version: "suinda-simple-signature-v1", method: payload.terms_signature_method, user_id: signatureUser, name: signatureName,
      program_id: program.id, program_revision: Number(payload.program_revision), terms_version: payload.terms_version,
      terms_sha256: expectedTermsHash, signed_at: signatureTime,
    })).digest("hex");
    const legacyWithoutSignature = Boolean(existingApplication && !existingApplication.payload.terms_signature_evidence_sha256);
    if (!legacyWithoutSignature && (!termsText || payload.terms_text_snapshot !== termsText || payload.terms_version !== program.payload.terms_version
      || payload.terms_signature_user_id !== payload.learner_user_id || !signatureName || typeof signatureTime !== "string"
      || payload.terms_signature_method !== "authenticated_typed_name" || payload.terms_accepted_at !== signatureTime || payload.terms_signature_text_sha256 !== expectedTermsHash
      || payload.terms_signature_evidence_sha256 !== signatureEvidence))
      return [{ severity: "error", code: "scholarship_signature_evidence_invalid", path: "terms_signature_evidence_sha256", message: "A evidência da assinatura deve corresponder à conta autenticada e à versão exata dos termos aceitos." }];
    const allowedCourses = Array.isArray(program.payload.course_record_ids) ? program.payload.course_record_ids : [];
    if (!allowedCourses.includes(course.id))
      return [{ severity: "error", code: "scholarship_course_not_eligible", path: "course_record_id", message: "Este programa não oferece bolsas para o curso selecionado." }];
    const manager = Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"));
    if (payload.learner_user_id !== context.actorId && !manager)
      return [{ severity: "error", code: "scholarship_applicant_mismatch", path: "learner_user_id", message: "A candidatura deve pertencer ao aluno autenticado." }];
    if (!context.recordId && (program.state !== "open" || typeof program.payload.opens_at === "string" && Date.parse(program.payload.opens_at) > Date.now()
      || typeof program.payload.closes_at === "string" && Date.parse(program.payload.closes_at) < Date.now()))
      return [{ severity: "error", code: "scholarship_window_closed", path: "program_record_id", message: "Este programa não está recebendo candidaturas agora." }];
    return [];
  },
);

const communication = kind("Comunicado", {
  audience_type: choice("workspace", "course", "cohort", "learner", "teacher"), audience_record_id: optionalText(80),
  audience_unit_record_id: recordRef("institution_unit", true), body: text(12000), channel: choice("internal", "email", "whatsapp", "push"),
  template_record_id: recordRef("announcement_template", true, "template_revision"), template_revision: integer(1, 1000000),
  scheduled_at: dateTime, sent_at: dateTime, requires_read_confirmation: { type: "boolean" }, template_code: optionalText(100),
}, ["audience_type", "body", "channel"], "draft", { draft: ["scheduled", "sent", "canceled"], scheduled: ["sent", "canceled"], sent: [], canceled: [] }, { audience_type: "workspace", body: "Comunicado de demonstração", channel: "internal", requires_read_confirmation: false });
communication.authorizeTransition = async (_from, to, payload, context) => {
  if (to === "sent") return false;
  if (to !== "scheduled") return true;
  if (!(["internal", "email"].includes(String(payload.channel))) || payload.audience_type !== "cohort"
    || typeof payload.audience_record_id !== "string" || typeof payload.scheduled_at !== "string"
    || !Number.isFinite(Date.parse(payload.scheduled_at)) || Date.parse(payload.scheduled_at) <= Date.now()
    || !context.resolveLatestRecord) return false;
  const cohortRecord = await context.resolveLatestRecord(payload.audience_record_id);
  if (cohortRecord?.pluginId !== "suinda-learning" || cohortRecord.kind !== "cohort"
    || !["enrolling", "active"].includes(cohortRecord.state)) return false;
  if (await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage")) return true;
  const assigned = (members: unknown) => Array.isArray(members) && members.includes(context.actorId);
  if (assigned(cohortRecord.payload.instructor_ids) || assigned(cohortRecord.payload.tutor_ids)) return true;
  const courseId = typeof cohortRecord.payload.course_record_id === "string" ? cohortRecord.payload.course_record_id : "";
  const courseRecord = courseId ? await context.resolveLatestRecord(courseId) : null;
  return courseRecord?.pluginId === "suinda-learning" && courseRecord.kind === "course"
    && assigned(courseRecord.payload.instructor_ids);
};

const announcementTemplate = kind("Modelo de comunicado", {
  title: text(240), body: text(12000),
}, ["title", "body"], "draft", {
  draft: ["published", "archived"], published: ["draft", "archived"], archived: [],
}, { title: "Aviso importante", body: "Escreva o comunicado que poderá ser reutilizado pelas turmas." });
announcementTemplate.resourceScoped = true;
announcementTemplate.managePermission = "plugin.suinda-learning.manage";
announcementTemplate.authorizeCreate = async (_actor, _payload, context) => Boolean(
  await context.hasWorkspacePermission?.("plugin.suinda-learning.write")
    || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.write")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"),
);
announcementTemplate.authorizeRecord = async (_actor, action, state, _payload, context) => {
  const write = await context.hasWorkspacePermission?.("plugin.suinda-learning.write")
    || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.write")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage");
  if (action === "read") return Boolean(write);
  if (action === "write") return Boolean(write && state === "draft");
  if (action === "publish") return Boolean(
    await context.hasWorkspacePermission?.("plugin.suinda-learning.publish")
      || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
      || await context.hasGlobalPermission?.("plugin.suinda-learning.publish")
      || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"),
  );
  return Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"));
};
announcementTemplate.authorizeTransition = async (from, to, _payload, context) => {
  if (to === "published") return Boolean(
    await context.hasWorkspacePermission?.("plugin.suinda-learning.publish")
      || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
      || await context.hasGlobalPermission?.("plugin.suinda-learning.publish")
      || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"),
  );
  if (to === "draft" && from === "published") return Boolean(
    await context.hasWorkspacePermission?.("plugin.suinda-learning.write")
      || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
      || await context.hasGlobalPermission?.("plugin.suinda-learning.write")
      || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"),
  );
  return Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
    || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"));
};
announcementTemplate.validate = async (payload) => [
  ...(typeof payload.title !== "string" || !payload.title.trim()
    ? [{ severity: "error" as const, code: "announcement_template.title_required", path: "title", message: "Informe o título do modelo." }]
    : []),
  ...(typeof payload.body !== "string" || !payload.body.trim()
    ? [{ severity: "error" as const, code: "announcement_template.body_required", path: "body", message: "Informe o conteúdo do modelo." }]
    : []),
];

const announcementReceipt = kind("Confirmação de leitura de comunicado", {
  receipt_key: text(200), announcement_record_id: recordRef("announcement"), enrollment_record_id: recordRef("enrollment"), learner_user_id: text(80), read_at: dateTime,
}, ["receipt_key", "announcement_record_id", "enrollment_record_id", "learner_user_id", "read_at"], "read", { read: [] }, { receipt_key: "receipt-key", announcement_record_id: "announcement-record-id", enrollment_record_id: "enrollment-record-id", learner_user_id: "user-id", read_at: "2026-01-01T00:00:00.000Z" });
announcementReceipt.serverCreated = true;
announcementReceipt.uniqueFields = ["receipt_key"];
announcementReceipt.resourceScoped = true;
announcementReceipt.authorizeCreate = async () => false;
announcementReceipt.authorizeRecord = async () => false;

const survey = kind("Pesquisa de qualidade", {
  target_type: choice("course", "cohort", "teacher", "module", "infrastructure"), target_record_id: optionalText(80), anonymous: { type: "boolean" }, questions: { type: "array", minItems: 1, maxItems: 100, items: { type: "object" } },
  responses_close_at: dateTime, nps_enabled: { type: "boolean" }, minimum_anonymous_responses: { type: "integer", minimum: 5, maximum: 1000 },
}, ["target_type", "questions"], "draft", { draft: ["open", "closed", "archived"], open: ["closed"], closed: ["archived"], archived: [] }, { target_type: "course", anonymous: true, questions: [{ type: "rating", label: "Como você avalia o curso?" }], nps_enabled: true });
const surveyResponse = kind("Resposta de pesquisa", {
  survey_record_id: recordRef("survey"), response_key: text(128), response_unit_record_id: optionalText(80), enrollment_record_id: optionalText(80), learner_user_id: optionalText(80), answers: { type: "array", minItems: 1, maxItems: 100, items: { type: "object" } }, submitted_at: dateTime,
}, ["survey_record_id", "response_key", "answers", "submitted_at"], "submitted", { submitted: [] }, { survey_record_id: "survey-record-id", response_key: "opaque-response-key", answers: [], submitted_at: "2026-01-01T00:00:00.000Z" });
surveyResponse.serverCreated = true;
surveyResponse.uniqueFields = ["response_key"];
surveyResponse.resourceScoped = true;
surveyResponse.managePermission = "plugin.suinda-learning.survey-response.read";
surveyResponse.authorizeCreate = async () => true;
surveyResponse.authorizeRecord = async () => false;

const path = kind("Trilha formativa", {
  description: text(4000), course_record_ids: { ...recordList("course"), minItems: 1 }, target_competencies: list(100),
  required_for_profiles: { ...list(100), description: "Use os mesmos valores das opções do campo personalizado professional_profile do perfil acadêmico." },
}, ["description", "course_record_ids"], "draft", { draft: ["published", "archived"], published: ["archived"], archived: [] }, { description: "Trilha de demonstração", course_record_ids: ["course-record-id"], target_competencies: [] });

const learningChallenge = kind("Desafio de aprendizagem", {
  description: text(2000), course_record_id: recordRef("course", true, "course_revision"), course_revision: { type: ["integer", "null"], minimum: 1 },
  cohort_record_id: recordRef("cohort", true), target_metric: choice("lessons", "assessments", "attendance", "practice_hours", "study_days"),
  target_value: number(1, 10000), opens_at: dateTime, closes_at: dateTime,
}, ["description", "target_metric", "target_value", "opens_at", "closes_at"], "draft",
{ draft: ["open", "archived"], open: ["closed"], closed: ["archived"], archived: [] },
{ description: "Conclua três aulas esta semana.", target_metric: "lessons", target_value: 3,
  opens_at: "2030-01-01T00:00:00Z", closes_at: "2030-01-07T23:59:59Z" });
learningChallenge.validate = combine(
  relatedRecord("course_record_id", "course"),
  pinnedRecord("course_record_id", "course_revision", "course"),
  relatedRecord("cohort_record_id", "cohort"),
  async (payload, context) => {
    if (payload.cohort_record_id && context.resolveLatestRecord) {
      const cohort = await context.resolveLatestRecord(String(payload.cohort_record_id));
      if (cohort && payload.course_record_id && cohort.payload.course_record_id !== payload.course_record_id)
        return [{ severity: "error", code: "challenge_scope_mismatch", path: "cohort_record_id", message: "A turma do desafio precisa pertencer ao curso selecionado." }];
    }
    return [];
  },
);
learningChallenge.authorizeTransition = async (_from, to, payload) => to !== "open"
  || Number.isFinite(Date.parse(String(payload.opens_at || "")))
    && Number.isFinite(Date.parse(String(payload.closes_at || "")))
    && Date.parse(String(payload.closes_at)) > Date.parse(String(payload.opens_at))
    && Date.parse(String(payload.closes_at)) > Date.now()
    && Date.parse(String(payload.closes_at)) - Date.parse(String(payload.opens_at)) <= 366 * 86400000
    && Number(payload.target_value) > 0;

type Validator = NonNullable<RecordKindContribution["validate"]>;
function relatedRecord(field: string, expectedKind: string): Validator {
  return async (payload, context) => {
    const recordId = payload[field];
    if (typeof recordId !== "string" || !context.resolveLatestRecord) return [];
    const record = await context.resolveLatestRecord(recordId);
    return record?.pluginId === "suinda-learning" && record.kind === expectedKind
      ? []
      : [{ severity: "error", code: "invalid_academic_reference", path: field, message: `Selecione um registro Suindá do tipo ${expectedKind}.` }];
  };
}
function publishedInstitutionUnit(field: string): Validator {
  return async (payload, context) => {
    const unitId = payload[field];
    if (typeof unitId !== "string" || !context.resolveLatestRecord) return [];
    const unit = await context.resolveLatestRecord(unitId);
    return unit?.pluginId === "suinda-learning" && unit.kind === "institution_unit" && unit.state === "published"
      ? []
      : [{ severity: "error", code: "institution_unit.invalid", path: field, message: "Selecione uma unidade institucional publicada deste workspace." }];
  };
}
function stableUnitAssignment(referenceField: "course_record_id" | "cohort_record_id"): Validator {
  return async (payload, context) => {
    if (!context.recordId || !context.resolveLatestRecord || !context.listLatestRecords) return [];
    const current = await context.resolveLatestRecord(context.recordId);
    if (!current || current.state === "draft") return [];
    const before = typeof current.payload.institution_unit_record_id === "string" ? current.payload.institution_unit_record_id : null;
    const after = typeof payload.institution_unit_record_id === "string" ? payload.institution_unit_record_id : null;
    if (before === after) return [];
    const enrollments = await context.listLatestRecords("suinda-learning", "enrollment", { [referenceField]: context.recordId }, undefined, 1000,
      `suinda-unit-assignment:${referenceField}:${context.recordId}`);
    if (!enrollments || enrollments.length >= 1000)
      return [{ severity: "error", code: "institution_unit.assignment_check_unavailable", path: "institution_unit_record_id", message: "Não foi possível verificar todas as matrículas para alterar a unidade. Tente novamente ou solicite revisão técnica." }];
    return enrollments.length
      ? [{ severity: "error", code: "institution_unit.assignment_frozen", path: "institution_unit_record_id", message: "A unidade não pode ser alterada depois da criação de matrículas; crie uma nova edição ou turma." }]
      : [];
  };
}
function pinnedRecord(field: string, revisionField: string, expectedKind: string): Validator {
  return async (payload, context) => {
    const recordId = payload[field], revision = payload[revisionField];
    if (typeof recordId !== "string" || !Number.isInteger(revision)) return [];
    const record = await context.resolveRecord(recordId, Number(revision));
    return record?.pluginId === "suinda-learning" && record.kind === expectedKind
      ? []
      : [{ severity: "error", code: "invalid_academic_snapshot", path: revisionField, message: `Selecione uma versão válida do registro ${expectedKind}.` }];
  };
}
function combine(...validators: Validator[]): Validator {
  return async (payload, context) => {
    const issues: Awaited<ReturnType<Validator>> = [];
    for (const validate of validators) issues.push(...await validate(payload, context));
    return issues;
  };
}
type CertificateAttendanceSession = { id: string; state: string; payload: { starts_at?: unknown; ends_at?: unknown } };
type CertificateAttendanceEntry = { payload: { session_record_id?: unknown; minutes_attended?: unknown } };
export function certificateAttendancePercent(
  sessions: CertificateAttendanceSession[], attendance: CertificateAttendanceEntry[], now = Date.now(),
) {
  const attendanceBySession = new Map(attendance.map((record) => [record.payload.session_record_id, record.payload]));
  let scheduledMinutes = 0, attendedMinutes = 0;
  for (const session of sessions) {
    if (session.state === "canceled") continue;
    const start = Date.parse(String(session.payload.starts_at || ""));
    const end = Date.parse(String(session.payload.ends_at || ""));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > now) continue;
    const duration = Math.floor((end - start) / 60_000);
    scheduledMinutes += duration;
    const minutes = Number(attendanceBySession.get(session.id)?.minutes_attended || 0);
    attendedMinutes += Math.max(0, Math.min(duration, Number.isFinite(minutes) ? minutes : 0));
  }
  return scheduledMinutes ? Math.round(attendedMinutes / scheduledMinutes * 10000) / 100 : null;
}
async function attendanceEligibility(enrollmentId: string, context: Parameters<Validator>[1]) {
  if (!context.resolveLatestRecord || !context.resolveRecord || !context.listLatestRecords) return null;
  const enrollmentRecord = await context.resolveLatestRecord(enrollmentId);
  if (!enrollmentRecord || enrollmentRecord.pluginId !== "suinda-learning" || enrollmentRecord.kind !== "enrollment") return null;
  const courseId = typeof enrollmentRecord.payload.course_record_id === "string" ? enrollmentRecord.payload.course_record_id : "";
  const courseRevision = Number(enrollmentRecord.payload.course_revision);
  if (!courseId || !Number.isInteger(courseRevision) || courseRevision < 1) return null;
  const course = await context.resolveRecord(courseId, courseRevision);
  if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course") return null;
  const minimum = Number(course.payload.attendance_min_percent ?? 75);
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) return null;
  const cohorts = typeof enrollmentRecord.payload.cohort_record_id === "string"
    ? [{ id: enrollmentRecord.payload.cohort_record_id }]
    : [];
  const sessionGroups = await Promise.all(cohorts.map((cohort) => context.listLatestRecords!(
    "suinda-learning", "session", { cohort_record_id: cohort.id }, undefined, 1000,
  )));
  if (sessionGroups.some((group) => !group)) return null;
  const sessions = sessionGroups.flatMap((group) => group || []);
  const attendance = await context.listLatestRecords("suinda-learning", "attendance", {
    enrollment_record_id: enrollmentId,
  }, undefined, 1000, `suinda-attendance:${enrollmentId}`);
  if (!attendance) return null;
  const percent = certificateAttendancePercent(sessions, attendance);
  return { eligible: percent === null || percent >= minimum, percent, minimum };
}
cohort.validate = combine(
  relatedRecord("course_record_id", "course"),
  pinnedRecord("course_record_id", "course_revision", "course"),
  publishedInstitutionUnit("institution_unit_record_id"),
  stableUnitAssignment("cohort_record_id"),
  async (payload, context) => {
    if (!context.recordId || typeof payload.capacity !== "number" || !context.listLatestRecords || !context.resolveLatestRecord) return [];
    const sessions = await context.listLatestRecords("suinda-learning", "session", { cohort_record_id: context.recordId }, undefined, 1000,
      `suinda-cohort-sessions:${context.recordId}`);
    if (!sessions) return [{ severity: "error", code: "cohort_schedule_unavailable", path: "capacity", message: "Não foi possível validar a capacidade das salas desta turma." }];
    for (const session of sessions) {
      const startsAt = Date.parse(String(session.payload.starts_at || ""));
      const endsAt = Date.parse(String(session.payload.ends_at || ""));
      const roomId = session.payload.room_record_id;
      if (!["scheduled", "live"].includes(session.state) || endsAt <= Date.now() || typeof roomId !== "string") continue;
      const room = await context.resolveLatestRecord(roomId);
      if (room?.pluginId === "suinda-learning" && room.kind === "room"
        && payload.capacity > Number(room.payload.max_occupancy || 0))
        return [{ severity: "error", code: "cohort_exceeds_room_capacity", path: "capacity", message: "A capacidade da turma não pode exceder a lotação da sala de um encontro futuro." }];
      if (!Number.isFinite(startsAt)) continue;
    }
    return [];
  },
);
enrollment.validate = combine(
  relatedRecord("course_record_id", "course"),
  pinnedRecord("course_record_id", "course_revision", "course"),
  publishedInstitutionUnit("institution_unit_record_id"),
  async (payload, context) => {
    if (!Object.hasOwn(payload, "institution_unit_record_id") || !context.resolveLatestRecord) return [];
    const course = typeof payload.course_record_id === "string" ? await context.resolveLatestRecord(payload.course_record_id) : null;
    const hasCohort = typeof payload.cohort_record_id === "string";
    const cohort = hasCohort ? await context.resolveLatestRecord(String(payload.cohort_record_id)) : null;
    if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course"
      || hasCohort && (!cohort || cohort.pluginId !== "suinda-learning" || cohort.kind !== "cohort" || cohort.payload.course_record_id !== course.id))
      return [{ severity: "error", code: "enrollment.institution_unit_reference_invalid", path: "institution_unit_record_id", message: "A unidade da matrícula precisa corresponder ao curso e à turma desta instituição." }];
    const unitId = typeof cohort?.payload.institution_unit_record_id === "string"
      ? cohort.payload.institution_unit_record_id : course.payload.institution_unit_record_id ?? null;
    const supplied = typeof payload.institution_unit_record_id === "string" ? payload.institution_unit_record_id : null;
    return supplied === unitId ? [] : [{ severity: "error", code: "enrollment.institution_unit_mismatch", path: "institution_unit_record_id", message: "A unidade da matrícula é determinada pelo curso e pela turma e precisa acompanhar a seleção de turma." }];
  },
  async (payload, context) => {
    if (typeof payload.course_record_id !== "string" || typeof payload.cohort_record_id !== "string" || !context.resolveLatestRecord) return [];
    const [courseRecord, cohortRecord] = await Promise.all([context.resolveLatestRecord(payload.course_record_id), context.resolveLatestRecord(payload.cohort_record_id)]);
    if (cohortRecord?.kind !== "cohort" || courseRecord?.id !== cohortRecord.payload.course_record_id)
      return [{ severity: "error", code: "academic_relationship_mismatch", path: "cohort_record_id", message: "A turma deve pertencer ao curso selecionado." }];
    if (!context.recordId && payload.learner_user_id === context.actorId
      && (cohortRecord.state !== "enrolling" || !enrollmentWindowOpen(cohortRecord.payload)))
      return [{ severity: "error", code: "cohort_enrollment_closed", path: "cohort_record_id", message: "A turma não está aceitando novas inscrições neste período." }];
    return [];
  },
  async (payload, context) => {
    if (typeof payload.course_record_id !== "string" || !context.resolveLatestRecord) return [];
    const courseRecord = await context.resolveLatestRecord(payload.course_record_id);
    if (courseRecord?.state !== "enrollment_open")
      return [{ severity: "error", code: "course_not_enrolling", path: "course_record_id", message: "O curso ainda não está publicado para receber inscrições." }];
    const courseOpensAt = courseRecord.payload.enrollment_opens_at;
    const courseClosesAt = courseRecord.payload.enrollment_closes_at;
    const now = Date.now();
    if (typeof courseOpensAt === "string" && Date.parse(courseOpensAt) > now)
      return [{ severity: "error", code: "course_enrollment_not_open", path: "course_record_id", message: "O período de inscrição deste curso ainda não começou." }];
    if (typeof courseClosesAt === "string" && Date.parse(courseClosesAt) < now)
      return [{ severity: "error", code: "course_enrollment_closed", path: "course_record_id", message: "O período de inscrição deste curso terminou." }];
    const selectedCohort = typeof payload.cohort_record_id === "string" && Number.isInteger(payload.cohort_revision)
      ? await context.resolveRecord(payload.cohort_record_id, Number(payload.cohort_revision)) : null;
    const savedAmount = context.recordId && payload.amount_due !== undefined ? payload.amount_due : undefined;
    const requiredAmount = Number(savedAmount ?? selectedCohort?.payload.price_amount ?? courseRecord.payload.price_amount ?? 0);
    if (requiredAmount > 0) {
      const staff = Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.write")
        || await context.hasWorkspacePermission?.("plugin.suinda-learning.manage"));
      const learnerAwaitingPayment = payload.learner_user_id === context.actorId && payload.payment_status === "pending";
      const staffHandlingPendingPayment = staff && Boolean(context.recordId) && payload.payment_status === "pending";
      const paymentConfirmed = payload.payment_status === "paid" || payload.payment_status === "waived";
      const learnerWithLedgerPayment = payload.learner_user_id === context.actorId && Boolean(context.recordId) && payload.payment_status === "paid";
      if (!learnerAwaitingPayment && !staffHandlingPendingPayment && !learnerWithLedgerPayment && (!staff || !paymentConfirmed))
        return [{ severity: "error", code: "payment_required", path: "course_record_id", message: "Este curso exige uma inscrição com pagamento confirmado." }];
      if (!learnerAwaitingPayment && paymentConfirmed && payload.payment_status === "paid") {
        if (!context.recordId || !context.resolveLatestRecord || !context.listLatestRecords)
          return [{ severity: "error", code: "payment_ledger_required", path: "payment_status", message: "Registre o pagamento pelo fluxo financeiro para atualizar esta matrícula." }];
        const current = await context.resolveLatestRecord(context.recordId);
        if (current?.payload.payment_status !== "paid") {
          const payments = await context.listLatestRecords("suinda-learning", "payment_entry", { enrollment_record_id: context.recordId }, "recorded", 1000);
          if (!payments || payments.reduce((total, payment) => total + (payment.payload.payment_method === "refund" ? -1 : 1) * Number(payment.payload.amount || 0), 0) < requiredAmount)
            return [{ severity: "error", code: "payment_ledger_incomplete", path: "payment_status", message: "Os lançamentos financeiros registrados não cobrem o valor integral do curso." }];
        }
      }
    }
    if (courseRecord.payload.format === "cohort" && typeof payload.cohort_record_id !== "string")
      return [{ severity: "error", code: "cohort_required", path: "cohort_record_id", message: "Selecione uma turma para este curso." }];
    if (courseRecord.payload.format === "open" && typeof payload.cohort_record_id === "string")
      return [{ severity: "error", code: "cohort_not_applicable", path: "cohort_record_id", message: "Este curso não recebe inscrição vinculada a uma turma." }];
    const fields = Array.isArray(courseRecord.payload.application_form_fields) ? courseRecord.payload.application_form_fields as Array<Record<string, unknown>> : [];
    const answers = payload.application_answers && typeof payload.application_answers === "object" && !Array.isArray(payload.application_answers)
      ? payload.application_answers as Record<string, unknown> : {};
    const allowedIds = new Set(fields.map((field) => String(field.id || "")));
    const trustedCsvSource = ["csv", "csv_invited"].includes(String(answers.import_source || ""))
      && Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.write"));
    const issues: Awaited<ReturnType<Validator>> = [];
    if (Object.keys(answers).some((key) => !allowedIds.has(key) && !(key === "import_source" && trustedCsvSource)))
      issues.push({ severity: "error", code: "application_form.unknown_answer", path: "application_answers", message: "A inscrição contém respostas que não pertencem ao formulário deste curso." });
    for (const field of fields) {
      const value = answers[String(field.id)];
      if (value === undefined || value === null || value === "") continue;
      const type = String(field.type);
      let valid = false;
      if (["text", "textarea", "phone", "email", "date"].includes(type)) {
        valid = typeof value === "string" && value.length <= Number(field.max_length || (type === "textarea" ? 4000 : 500));
        if (type === "email") valid = valid && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
        if (type === "date") valid = valid && /^\d{4}-\d{2}-\d{2}$/.test(String(value))
          && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
      } else if (type === "number") valid = typeof value === "number" && Number.isFinite(value);
      else if (type === "select") valid = typeof value === "string" && Array.isArray(field.options) && field.options.includes(value);
      else if (type === "multiselect") valid = Array.isArray(value) && value.every((item) => typeof item === "string" && Array.isArray(field.options) && field.options.includes(item)) && new Set(value).size === value.length;
      if (!valid) issues.push({ severity: "error", code: "application_form.invalid_answer", path: `application_answers.${field.id}`, message: `A resposta para “${field.label}” não é válida.` });
    }
    return issues;
  },
  async (payload, context) => {
    if (typeof payload.cohort_record_id !== "string" || !context.resolveLatestRecord) return [];
    const cohortRecord = await context.resolveLatestRecord(payload.cohort_record_id);
    if (!cohortRecord || cohortRecord.kind !== "cohort")
      return [{ severity: "error", code: "invalid_cohort", path: "cohort_record_id", message: "Selecione uma turma válida." }];
    if (cohortRecord.state !== "enrolling")
      return [{ severity: "error", code: "cohort_not_enrolling", path: "cohort_record_id", message: "A turma não está aberta para inscrições." }];
    let cohortPayload = cohortRecord.payload;
    if (payload.cohort_revision !== undefined) {
      const revision = Number(payload.cohort_revision);
      if (!Number.isInteger(revision) || revision < 1) return [{ severity: "error", code: "cohort_revision_invalid", path: "cohort_revision", message: "A revisão da turma é inválida." }];
      if (!context.recordId && revision !== cohortRecord.revision)
        return [{ severity: "error", code: "cohort_revision_mismatch", path: "cohort_revision", message: "A turma foi atualizada. Atualize a página e selecione novamente a turma." }];
      const snapshot = revision === cohortRecord.revision ? cohortRecord : await context.resolveRecord(payload.cohort_record_id, revision);
      if (!snapshot || snapshot.pluginId !== "suinda-learning" || snapshot.kind !== "cohort")
        return [{ severity: "error", code: "cohort_revision_missing", path: "cohort_revision", message: "A revisão escolhida da turma não está disponível." }];
      cohortPayload = snapshot.payload;
    }
    const courseRecord = typeof payload.course_record_id === "string" ? await context.resolveLatestRecord(payload.course_record_id) : null;
    if (!courseRecord || cohortPayload.course_record_id !== courseRecord.id || cohortPayload.course_revision !== courseRecord.revision)
      return [{ severity: "error", code: "academic_relationship_mismatch", path: "cohort_record_id", message: "A turma precisa pertencer à revisão curricular atual do curso." }];
    const opensAt = cohortPayload.enrollment_opens_at;
    const closesAt = cohortPayload.enrollment_closes_at;
    const now = Date.now();
    if (typeof opensAt === "string" && Date.parse(opensAt) > now)
      return [{ severity: "error", code: "cohort_enrollment_not_open", path: "cohort_record_id", message: "O período de inscrição desta turma ainda não começou." }];
    if (typeof closesAt === "string" && Date.parse(closesAt) < now)
      return [{ severity: "error", code: "cohort_enrollment_closed", path: "cohort_record_id", message: "O período de inscrição desta turma terminou." }];
    return [];
  },
);
paymentEntry.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  pinnedRecord("course_record_id", "course_revision", "course"),
  async (payload, context) => {
    if (typeof payload.enrollment_record_id !== "string" || !context.resolveLatestRecord) return [];
    const enrollment = await context.resolveLatestRecord(payload.enrollment_record_id);
    const course = typeof payload.course_record_id === "string" && Number.isInteger(payload.course_revision)
      ? await context.resolveRecord(payload.course_record_id, Number(payload.course_revision)) : null;
    if (!enrollment || enrollment.kind !== "enrollment" || enrollment.payload.learner_user_id !== payload.learner_user_id
      || enrollment.payload.course_record_id !== payload.course_record_id || Number(enrollment.payload.course_revision) !== Number(payload.course_revision))
      return [{ severity: "error", code: "payment_enrollment_mismatch", path: "enrollment_record_id", message: "O pagamento precisa pertencer ao curso e ao aluno desta matrícula." }];
    const maximum = Number(enrollment.payload.amount_due ?? course?.payload.price_amount ?? 0);
    if (!course || course.kind !== "course" || maximum <= 0 || Number(payload.amount) > maximum)
      return [{ severity: "error", code: "payment_amount_invalid", path: "amount", message: "O valor lançado não pode exceder o preço da revisão curricular." }];
    return [];
  },
);
learningModule.validate = combine(
  relatedRecord("course_record_id", "course"),
  pinnedRecord("course_record_id", "course_revision", "course"),
  async (payload, context) => {
    if (typeof payload.course_record_id !== "string" || !Number.isInteger(payload.course_version) || !context.resolveLatestRecord) return [];
    const courseRecord = await context.resolveLatestRecord(payload.course_record_id);
    return courseRecord && Number(courseRecord.payload.version) === Number(payload.course_version)
      ? []
      : [{ severity: "error", code: "curriculum_version_mismatch", path: "course_version", message: "O módulo precisa corresponder à versão curricular do curso." }];
  },
);
learningUnit.validate = combine(relatedRecord("module_record_id", "module"), async (payload, context) => {
  if (typeof payload.module_record_id !== "string" || !context.resolveLatestRecord) return [];
  const moduleRecord = await context.resolveLatestRecord(payload.module_record_id);
  const courseRecord = moduleRecord?.pluginId === "suinda-learning" && moduleRecord.kind === "module" && typeof moduleRecord.payload.course_record_id === "string"
    ? await context.resolveLatestRecord(moduleRecord.payload.course_record_id) : null;
  return courseRecord?.pluginId === "suinda-learning" && courseRecord.kind === "course"
    ? [] : [{ severity: "error" as const, code: "learning_unit_module_invalid", path: "module_record_id", message: "A unidade precisa pertencer a um módulo de um curso Suindá válido." }];
});
learningUnit.authorizeTransition = async (_from, to, _payload, context) => {
  if (to !== "archived" || !context.recordId || !context.listLatestRecords) return true;
  const lessons = await context.listLatestRecords("suinda-learning", "lesson", { unit_record_id: context.recordId }, undefined, 1000);
  return Boolean(lessons && lessons.length < 1000 && !lessons.some((lesson) => lesson.state !== "archived"));
};

const learningSeason = kind("Temporada de aprendizagem", {
  description: text(2000), opens_at: dateTime, closes_at: dateTime,
  course_record_ids: { ...recordList("course"), minItems: 2, maxItems: 20 },
  challenge_record_ids: { ...recordList("learning_challenge", 20), minItems: 1, maxItems: 20 },
}, ["description", "opens_at", "closes_at", "course_record_ids", "challenge_record_ids"], "draft",
{ draft: ["published", "archived"], published: ["closed", "archived"], closed: ["archived"], archived: [] },
{ description: "Temporada entre cursos", opens_at: "2030-01-01T00:00:00Z", closes_at: "2030-01-31T23:59:59Z",
  course_record_ids: ["course-record-id", "second-course-record-id"], challenge_record_ids: ["challenge-record-id"] });
learningSeason.validate = combine(async (payload, context) => {
  const opensAt = Date.parse(String(payload.opens_at || "")), closesAt = Date.parse(String(payload.closes_at || ""));
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt) || closesAt <= opensAt || closesAt - opensAt > 366 * 86400000)
    return [{ severity: "error", code: "season.invalid_window", path: "closes_at", message: "A temporada deve durar de 1 a 366 dias." }];
  if (!context.resolveLatestRecord) return [];
  const courses = await Promise.all((Array.isArray(payload.course_record_ids) ? payload.course_record_ids : []).map((recordId) => context.resolveLatestRecord!(String(recordId))));
  const challenges = await Promise.all((Array.isArray(payload.challenge_record_ids) ? payload.challenge_record_ids : []).map((recordId) => context.resolveLatestRecord!(String(recordId))));
  const courseIds = new Set(courses.filter(Boolean).map((record) => record!.id));
  if (courses.length < 2 || courses.some((record) => !record || record.pluginId !== "suinda-learning" || record.kind !== "course"))
    return [{ severity: "error", code: "season.invalid_courses", path: "course_record_ids", message: "Selecione ao menos dois cursos do mesmo workspace." }];
  if (!challenges.length || challenges.some((record) => !record || record.pluginId !== "suinda-learning" || record.kind !== "learning_challenge"
    || !["open", "closed"].includes(record.state) || !courseIds.has(String(record.payload.course_record_id))))
    return [{ severity: "error", code: "season.invalid_challenges", path: "challenge_record_ids", message: "Cada desafio precisa estar aberto ou encerrado e pertencer a um dos cursos selecionados." }];
  return [];
});
learningSeason.authorizeTransition = async (_from, to, payload, context) => to !== "published"
  || await context.hasWorkspacePermission?.("plugin.suinda-learning.publish") === true
    && Number.isFinite(Date.parse(String(payload.opens_at || "")))
    && Number.isFinite(Date.parse(String(payload.closes_at || "")))
    && Date.parse(String(payload.closes_at)) > Date.parse(String(payload.opens_at))
    && Date.parse(String(payload.closes_at)) - Date.parse(String(payload.opens_at)) <= 366 * 86400000;
lesson.validate = combine(relatedRecord("module_record_id", "module"), async (payload, context) => {
  const captionIssues = validateLessonCaptions(payload);
  const providerCaptionVideo = isProviderCaptionVideo(payload.content_url);
  const providerConfirmationIssues = payload.provider_captions_confirmed === true && (payload.content_type !== "video" || !providerCaptionVideo)
    ? [{ severity: "error" as const, code: "lesson.provider_captions_invalid", path: "provider_captions_confirmed", message: "Confirme legendas externas somente para vídeos do YouTube ou Vimeo." }]
    : [];
  const currentAttachments = context.transition?.to === "published" ? await context.listCurrentRecordAttachments?.() : undefined;
  const accessibilityIssues = context.transition?.to !== "published" ? [] : await (async () => {
    const missing = (path: string, message: string) => ({ severity: "error" as const, code: "lesson.accessibility_material_missing", path, message });
    const transcript = typeof payload.transcript === "string" && payload.transcript.trim().length > 0;
    if (payload.content_type === "audio") {
      const issues = [];
      if (!transcript) issues.push(missing("transcript", "Inclua a transcrição do áudio antes de publicar esta aula."));
      if (payload.transcript_reviewed !== true) issues.push(missing("transcript_reviewed", "Confira a transcrição completa da aula e confirme a revisão humana antes de publicar."));
      return issues;
    }
    const hasDocumentAttachment = currentAttachments?.some((attachment) => [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(attachment.mime_type)) === true;
    if ((["pdf", "presentation"].includes(String(payload.content_type)) || hasDocumentAttachment)
      && payload.document_accessibility_reviewed !== true)
      return [missing("document_accessibility_reviewed", "Revise a estrutura, a ordem de leitura, os títulos, os cabeçalhos de tabela, as alternativas de imagem e o idioma do documento com tecnologia assistiva antes de publicar.")];
    if (payload.content_type !== "video") return [];
    const issues = [];
    if (!transcript) issues.push(missing("transcript", "Inclua a transcrição da aula antes de publicar este vídeo."));
    if (payload.transcript_reviewed !== true) issues.push(missing("transcript_reviewed", "Confira a transcrição completa da aula e confirme a revisão humana antes de publicar."));
    if (providerCaptionVideo && payload.provider_captions_confirmed !== true)
      issues.push(missing("provider_captions_confirmed", "Confirme que o player externo oferece uma faixa de legendas ativável antes de publicar."));
    if (!providerCaptionVideo && !(typeof payload.captions_vtt === "string" && payload.captions_vtt.trim()))
      issues.push(missing("captions_vtt", "Inclua uma faixa de legendas WebVTT antes de publicar este vídeo."));
    if (payload.captions_reviewed !== true)
      issues.push(missing("captions_reviewed", "Confira cada legenda, os tempos, as falas e os sons relevantes com o vídeo e confirme a revisão humana antes de publicar."));
    return issues;
  })();
  const mediaIssues: RecordValidationIssue[] = [...captionIssues, ...providerConfirmationIssues, ...accessibilityIssues];
  if (context.transition?.to === "published") {
    const markdownIssues = lessonAccessibilityGaps({ state: "published", content_type: "article", body_markdown: payload.body_markdown }, []);
    for (const [auditCode, validationCode] of [
      ["markdown_image_alt_missing", "lesson.markdown_image_alt_missing"],
      ["markdown_link_name_missing", "lesson.markdown_link_name_missing"],
      ["markdown_table_header_missing", "lesson.markdown_table_header_missing"],
    ] as const) {
      const markdownIssue = markdownIssues.find((gap) => gap.code === auditCode);
      if (markdownIssue) mediaIssues.push({ severity: "error", code: validationCode, path: "body_markdown", message: markdownIssue.message });
    }
    const headingOrderIssue = markdownIssues.find((gap) => gap.code === "markdown_heading_order");
    if (headingOrderIssue) mediaIssues.push({ severity: "warning", code: "lesson.markdown_heading_order", path: "body_markdown", message: headingOrderIssue.message });
    const genericLinkNameIssue = markdownIssues.find((gap) => gap.code === "markdown_link_name_generic");
    if (genericLinkNameIssue) mediaIssues.push({ severity: "warning", code: "lesson.markdown_link_name_generic", path: "body_markdown", message: genericLinkNameIssue.message });
    const genericMarkdownAlt = markdownIssues.find((gap) => gap.code === "markdown_image_alt_generic");
    if (genericMarkdownAlt) mediaIssues.push({ severity: "warning", code: "lesson.markdown_image_alt_generic", path: "body_markdown", message: genericMarkdownAlt.message });
    const decorativeMarkdownAlt = markdownIssues.find((gap) => gap.code === "markdown_image_decorative_alt");
    if (decorativeMarkdownAlt) mediaIssues.push({ severity: "warning", code: "lesson.markdown_image_decorative_alt", path: "body_markdown", message: decorativeMarkdownAlt.message });
    const genericAttachmentAlt = lessonAccessibilityGaps({ state: "published", content_type: "article" }, currentAttachments || []).find((gap) => gap.code === "image_alt_generic");
    if (genericAttachmentAlt) mediaIssues.push({ severity: "warning", code: "lesson.image_alt_generic", path: "attachments", message: genericAttachmentAlt.message });
  }
  if (typeof payload.unit_record_id === "string") {
    const unit = await context.resolveLatestRecord?.(payload.unit_record_id);
    if (!unit || unit.pluginId !== "suinda-learning" || unit.kind !== "learning_unit" || unit.state !== "published" || unit.payload.module_record_id !== payload.module_record_id)
      return [...mediaIssues, { severity: "error" as const, code: "lesson_unit_module_mismatch", path: "unit_record_id", message: "Selecione uma unidade de aprendizagem publicada que pertença ao módulo desta aula." }];
  }
  const value = payload.content_url;
  if (value == null || value === "") return mediaIssues;
  try {
    const url = new URL(String(value));
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error("invalid external URL");
    return mediaIssues;
  } catch {
    return [...mediaIssues, { severity: "error" as const, code: "lesson.external_url_invalid", path: "content_url", message: "Use um endereço externo HTTP ou HTTPS válido, sem credenciais embutidas." }];
  }
});
lesson.authorizeTransition = async (_from, to, payload, context) => {
  if (to !== "published" || typeof payload.unit_record_id !== "string") return true;
  const unit = await context.resolveLatestRecord?.(payload.unit_record_id);
  return unit?.pluginId === "suinda-learning" && unit.kind === "learning_unit" && unit.state === "published"
    && unit.payload.module_record_id === payload.module_record_id;
};
room.validate = async (payload, context) => {
  if (payload.geolocation_required === true && (typeof payload.latitude !== "number" || typeof payload.longitude !== "number"
    || !Number.isInteger(payload.geofence_radius_meters) || Number(payload.geofence_radius_meters) < 25 || Number(payload.geofence_radius_meters) > 2000))
    return [{ severity: "error", code: "room_geolocation_incomplete", path: "geolocation_required", message: "Para exigir geolocalização, informe latitude, longitude e um raio entre 25 e 2.000 metros." }];
  if (!context.recordId || typeof payload.max_occupancy !== "number" || !context.listLatestRecords || !context.resolveLatestRecord) return [];
  const sessions = await context.listLatestRecords("suinda-learning", "session", { room_record_id: context.recordId }, undefined, 1000,
    `suinda-room-schedule:${context.recordId}`);
  if (!sessions) return [{ severity: "error", code: "room_schedule_unavailable", path: "max_occupancy", message: "Não foi possível validar a agenda e a lotação desta sala." }];
  if (sessions.length >= 1000) return [{ severity: "error", code: "room_schedule_limit", path: "max_occupancy", message: "A agenda desta sala excedeu o limite de validação; reduza a quantidade de encontros ativos antes de editar sua lotação." }];
  for (const session of sessions) {
    const startsAt = Date.parse(String(session.payload.starts_at || ""));
    const endsAt = Date.parse(String(session.payload.ends_at || ""));
    if (!["scheduled", "live"].includes(session.state) || !Number.isFinite(startsAt) || endsAt <= Date.now()) continue;
    const cohortId = session.payload.cohort_record_id;
    const cohortRecord = typeof cohortId === "string" ? await context.resolveLatestRecord(cohortId) : null;
    if (cohortRecord?.kind === "cohort" && Number(cohortRecord.payload.capacity || 0) > payload.max_occupancy)
      return [{ severity: "error", code: "room_capacity_below_cohort", path: "max_occupancy", message: "A lotação não pode ficar abaixo da capacidade da turma enquanto houver encontro futuro nesta sala." }];
  }
  return [];
};
enrollment.authorizeTransition = async (_from, to, payload, context) => {
  if (to === "submitted") {
    const manager = Boolean(await context.hasWorkspacePermission?.("plugin.suinda-learning.manage")
      || await context.hasGlobalPermission?.("plugin.suinda-learning.manage"));
    // Coupon validation and reservation must always go through the transactional submission route.
    if (payload.coupon_code || payload.coupon_record_id || payload.discount_amount || payload.amount_due !== undefined) return false;
    if (payload.learner_user_id === context.actorId && !manager) return false;
  }
  if (!["enrolled", "active", "completed", "failed"].includes(to)) return true;
  if (typeof payload.course_record_id !== "string" || !Number.isInteger(payload.course_revision)) return false;
  const course = await context.resolveRecord(payload.course_record_id, Number(payload.course_revision));
  if (!course || course.kind !== "course") return false;
  return !enrollmentHasOutstandingPrice(payload, course.payload);
};
room.availableTransitions = async (state, _payload, context) => {
  if (state !== "active") return state === "inactive" ? ["active"] : [];
  if (!context.recordId || !context.listLatestRecords) return ["inactive"];
  const sessions = await context.listLatestRecords("suinda-learning", "session", { room_record_id: context.recordId }, undefined, 1000,
    `suinda-room-schedule:${context.recordId}`);
  if (!sessions || sessions.length >= 1000) return [];
  const now = Date.now();
  const inUse = sessions.some((session) => ["scheduled", "live"].includes(session.state)
    && Date.parse(String(session.payload.ends_at || "")) > now);
  return inUse ? [] : ["inactive"];
};
liveSession.validate = combine(
  relatedRecord("cohort_record_id", "cohort"),
  async (payload, context) => {
    const issues: Awaited<ReturnType<Validator>> = [];
    const startsAt = typeof payload.starts_at === "string" ? Date.parse(payload.starts_at) : NaN;
    const endsAt = typeof payload.ends_at === "string" ? Date.parse(payload.ends_at) : NaN;
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt)
      issues.push({ severity: "error", code: "session_time_range_invalid", path: "ends_at", message: "O encontro deve terminar depois de sua data de início." });
    const cohortId = typeof payload.cohort_record_id === "string" ? payload.cohort_record_id : "";
    if (!cohortId || !context.listLatestRecords || !context.resolveLatestRecord) return issues;
    const cohortRecord = await context.resolveLatestRecord(cohortId);
    const courseId = typeof cohortRecord?.payload.course_record_id === "string" ? cohortRecord.payload.course_record_id : "";
    const courseRecord = courseId ? await context.resolveLatestRecord(courseId) : null;
    const makeup = payload.session_type === "makeup";
    if (makeup !== (typeof payload.replacement_session_record_id === "string"))
      issues.push({ severity: "error", code: "session_makeup_link_required", path: "replacement_session_record_id", message: "Encontros de reposição precisam apontar para o encontro original, e encontros regulares não podem ter esse vínculo." });
    if (makeup && typeof payload.replacement_session_record_id === "string") {
      const original = await context.resolveLatestRecord(payload.replacement_session_record_id);
      if (!original || original.pluginId !== "suinda-learning" || original.kind !== "session"
        || original.id === context.recordId || !["canceled", "completed"].includes(original.state)
        || !await (async () => {
          if (original.payload.cohort_record_id === cohortId) return true;
          const sourceCohort = context.resolveLatestRecord ? await context.resolveLatestRecord(String(original.payload.cohort_record_id || "")) : null;
          return sourceCohort?.kind === "cohort" && sourceCohort.payload.course_record_id === courseId
            && String(sourceCohort.payload.course_revision) === String(cohortRecord?.payload.course_revision);
        })()
        || original.payload.session_type === "makeup")
        issues.push({ severity: "error", code: "session_makeup_source_invalid", path: "replacement_session_record_id", message: "A reposição deve apontar para um encontro cancelado ou concluído do mesmo curso e edição curricular." });
    }
    if (makeup && context.recordId) {
      const reservations = await context.listLatestRecords("suinda-learning", "makeup_request",
        { replacement_session_record_id: context.recordId }, undefined, 1000,
        `suinda-makeup-reservations:${context.recordId}`);
      if (!reservations || reservations.length >= 1000)
        issues.push({ severity: "error", code: "makeup_capacity_unavailable", path: "makeup_capacity", message: "Não foi possível confirmar as reservas deste horário de reposição." });
      else {
        const reserved = reservations.filter((request) => ["submitted", "approved", "scheduled"].includes(request.state)).length;
        if (Number(payload.makeup_capacity || 0) < reserved)
          issues.push({ severity: "error", code: "makeup_capacity_below_reserved", path: "makeup_capacity", message: "A capacidade não pode ficar abaixo das vagas já reservadas." });
      }
    }
    const instructorId = typeof payload.instructor_user_id === "string" && payload.instructor_user_id.trim()
      ? payload.instructor_user_id.trim() : null;
    if (instructorId) {
      const assigned = [courseRecord?.payload.instructor_ids, cohortRecord?.payload.instructor_ids, cohortRecord?.payload.tutor_ids]
        .some((members) => Array.isArray(members) && members.includes(instructorId));
      if (!assigned) issues.push({ severity: "error", code: "session_instructor_unassigned", path: "instructor_user_id", message: "A pessoa docente precisa estar atribuída ao curso ou à turma do encontro." });
      const instructorSessions = await context.listLatestRecords("suinda-learning", "session", { instructor_user_id: instructorId }, undefined, 1000,
        `suinda-instructor-schedule:${instructorId}`);
      if (!instructorSessions || instructorSessions.length >= 1000)
        issues.push({ severity: "error", code: "instructor_schedule_unavailable", path: "instructor_user_id", message: "Não foi possível validar a agenda completa da pessoa docente." });
      else if (Number.isFinite(startsAt) && Number.isFinite(endsAt)) {
        const hasConflict = instructorSessions.some((other) => other.id !== context.recordId && ["scheduled", "live"].includes(other.state)
          && startsAt < Date.parse(String(other.payload.ends_at || ""))
          && endsAt > Date.parse(String(other.payload.starts_at || "")));
        if (hasConflict) issues.push({ severity: "error", code: "instructor_schedule_conflict", path: "starts_at", message: "A pessoa docente já tem outro encontro neste período." });
      }
    }
    const roomId = payload.room_record_id;
    if (typeof roomId !== "string") return issues;
    if (payload.modality !== "in_person")
      issues.push({ severity: "error", code: "room_modality_invalid", path: "room_record_id", message: "Uma sala física só pode ser vinculada a um encontro presencial." });
    const cohortSessions = await context.listLatestRecords("suinda-learning", "session", { cohort_record_id: cohortId }, undefined, 1000,
      `suinda-cohort-sessions:${cohortId}`);
    if (!cohortSessions) return [...issues, { severity: "error", code: "cohort_schedule_unavailable", path: "cohort_record_id", message: "Não foi possível validar a agenda da turma." }];
    const sessions = await context.listLatestRecords("suinda-learning", "session", { room_record_id: roomId }, undefined, 1000,
      `suinda-room-schedule:${roomId}`);
    if (!sessions) return [...issues, { severity: "error", code: "room_schedule_unavailable", path: "room_record_id", message: "Não foi possível validar a agenda da sala." }];
    if (sessions.length >= 1000) return [...issues, { severity: "error", code: "room_schedule_limit", path: "room_record_id", message: "A agenda da sala excedeu o limite de validação; não é possível confirmar sua disponibilidade." }];
    const roomRecord = await context.resolveLatestRecord(roomId);
    if (roomRecord?.pluginId !== "suinda-learning" || roomRecord.kind !== "room")
      return [...issues, { severity: "error", code: "invalid_room_reference", path: "room_record_id", message: "Selecione uma sala cadastrada no mesmo workspace." }];
    const currentSession = context.recordId ? await context.resolveLatestRecord(context.recordId) : null;
    const bookingStates = ["scheduled", "live"];
    if (roomRecord.state !== "active" && !["completed", "canceled"].includes(currentSession?.state || ""))
      issues.push({ severity: "error", code: "room_inactive", path: "room_record_id", message: "A sala está inativa e não pode receber um novo encontro." });
    if (cohortRecord?.kind === "cohort" && Number(cohortRecord.payload.capacity || 0) > Number(roomRecord.payload.max_occupancy || 0))
      issues.push({ severity: "error", code: "room_capacity_exceeded", path: "room_record_id", message: "A lotação da sala é menor que a capacidade configurada para a turma." });
    if (["completed", "canceled"].includes(currentSession?.state || "")) return issues;
    for (const other of sessions) {
      if (other.id === context.recordId || !bookingStates.includes(other.state)) continue;
      const otherStart = Date.parse(String(other.payload.starts_at || ""));
      const otherEnd = Date.parse(String(other.payload.ends_at || ""));
      if (Number.isFinite(otherStart) && Number.isFinite(otherEnd) && startsAt < otherEnd && endsAt > otherStart) {
        issues.push({ severity: "error", code: "room_schedule_conflict", path: "starts_at", message: "A sala já está reservada para outro encontro neste período." });
        break;
      }
    }
    return issues;
  },
);
attendance.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  relatedRecord("session_record_id", "session"),
  async (payload, context) => {
    if (typeof payload.enrollment_record_id !== "string" || typeof payload.session_record_id !== "string"
      || typeof payload.learner_user_id !== "string" || !context.resolveLatestRecord) return [];
    const [enrollmentRecord, sessionRecord] = await Promise.all([
      context.resolveLatestRecord(payload.enrollment_record_id), context.resolveLatestRecord(payload.session_record_id),
    ]);
    const issues = [];
    if (enrollmentRecord?.payload.learner_user_id !== payload.learner_user_id)
      issues.push({ severity: "error" as const, code: "learner_mismatch", path: "learner_user_id", message: "O aluno precisa corresponder à matrícula." });
    if (enrollmentRecord && sessionRecord && enrollmentRecord.payload.cohort_record_id !== sessionRecord.payload.cohort_record_id) {
      const request = typeof payload.makeup_request_record_id === "string" ? await context.resolveLatestRecord(payload.makeup_request_record_id) : null;
      const destinationCohort = await context.resolveLatestRecord(String(sessionRecord.payload.cohort_record_id || ""));
      if (!request || request.kind !== "makeup_request" || request.payload.enrollment_record_id !== enrollmentRecord.id
        || request.payload.replacement_session_record_id !== sessionRecord.id || !["scheduled", "completed"].includes(request.state)
        || request.payload.fee_status === "pending" || !destinationCohort
        || destinationCohort.payload.course_record_id !== enrollmentRecord.payload.course_record_id
        || String(destinationCohort.payload.course_revision) !== String(enrollmentRecord.payload.course_revision))
        issues.push({ severity: "error" as const, code: "attendance_cohort_mismatch", path: "session_record_id", message: "A sessão precisa pertencer à turma da matrícula ou a uma reposição válida." });
    }
    if (payload.attendance_key !== undefined && payload.attendance_key !== `${payload.session_record_id}:${payload.enrollment_record_id}`)
      issues.push({ severity: "error" as const, code: "attendance_key_invalid", path: "attendance_key", message: "A chave de frequência precisa corresponder à matrícula e sessão." });
    if (payload.marked_by_user_id !== undefined && payload.marked_by_user_id !== context.actorId)
      issues.push({ severity: "error" as const, code: "attendance_marker_invalid", path: "marked_by_user_id", message: "A frequência precisa registrar o docente autenticado." });
    return issues;
  },
);
attendanceJustification.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  relatedRecord("session_record_id", "session"),
  async (payload, context) => {
    if (typeof payload.enrollment_record_id !== "string" || typeof payload.session_record_id !== "string"
      || typeof payload.learner_user_id !== "string" || !context.resolveLatestRecord) return [];
    const [enrollmentRecord, sessionRecord] = await Promise.all([
      context.resolveLatestRecord(payload.enrollment_record_id), context.resolveLatestRecord(payload.session_record_id),
    ]);
    return enrollmentRecord?.payload.learner_user_id === payload.learner_user_id
      && enrollmentRecord.payload.cohort_record_id === sessionRecord?.payload.cohort_record_id
      && context.actorId === payload.learner_user_id
      ? []
      : [{ severity: "error", code: "attendance_justification_owner_invalid", path: "learner_user_id", message: "A justificativa deve pertencer ao aluno da matrícula e a um encontro da mesma turma." }];
  },
);
assessment.validate = combine(
  relatedRecord("course_record_id", "course"),
  relatedRecord("cohort_record_id", "cohort"),
  relatedRecord("module_record_id", "module"),
  pinnedRecord("recovery_for_assessment_id", "recovery_for_assessment_revision", "assessment"),
  async (payload, context) => {
    const inlineQuestions = Array.isArray(payload.question_set) ? payload.question_set : [];
    const refs = Array.isArray(payload.question_bank_refs) ? payload.question_bank_refs : [];
    const issues = [...validateAssessmentQuestions(inlineQuestions, "question_set"), ...validateRubric(payload.rubric)];
    const resolved = await Promise.all(refs.map(async (raw, index) => {
      const ref = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const record = typeof ref.record_id === "string" && Number.isInteger(ref.revision)
        ? await context.resolveRecord(ref.record_id, Number(ref.revision)) : null;
      if (!record || record.pluginId !== "suinda-learning" || record.kind !== "question_bank" || record.state !== "published") {
        issues.push({ severity: "error", code: "assessment_question_bank_invalid", path: `question_bank_refs[${index}]`, message: "Selecione uma versão publicada de um banco de questões do Suindá." });
        return [];
      }
      return Array.isArray(record.payload.questions) ? record.payload.questions : [];
    }));
    const questions = [...inlineQuestions, ...resolved.flat()];
    if (typeof payload.recovery_for_assessment_id === "string") {
      const original = Number.isInteger(payload.recovery_for_assessment_revision)
        ? await context.resolveRecord(payload.recovery_for_assessment_id, Number(payload.recovery_for_assessment_revision)) : null;
      if (!original || original.pluginId !== "suinda-learning" || original.kind !== "assessment" || original.state !== "published"
        || original.id === context.recordId || !["quiz", "exam"].includes(String(original.payload.assessment_type))
        || typeof original.payload.recovery_for_assessment_id === "string"
        || original.payload.course_record_id !== payload.course_record_id
        || (original.payload.cohort_record_id || null) !== (payload.cohort_record_id || null)
        || !["quiz", "exam"].includes(String(payload.assessment_type)))
        issues.push({ severity: "error", code: "assessment_recovery_source_invalid", path: "recovery_for_assessment_id", message: "A recuperação precisa apontar para uma versão publicada de questionário ou prova do mesmo curso e turma, sem criar outra recuperação." });
    } else if (payload.recovery_for_assessment_revision !== undefined && payload.recovery_for_assessment_revision !== null) {
      issues.push({ severity: "error", code: "assessment_recovery_revision_without_source", path: "recovery_for_assessment_revision", message: "Selecione a avaliação original antes de fixar sua versão." });
    }
    if (["quiz", "exam"].includes(String(payload.assessment_type)) && questions.length === 0)
      issues.push({ severity: "error", code: "assessment_questions_required", path: "question_bank_refs", message: "Inclua questões próprias ou selecione ao menos um banco publicado." });
    const ids = questions.map((raw) => raw && typeof raw === "object" ? (raw as Record<string, unknown>).id : undefined);
    if (new Set(ids).size !== ids.length)
      issues.push({ severity: "error", code: "assessment_question_id_duplicate", path: "question_bank_refs", message: "Os IDs das questões precisam ser únicos entre bancos e questões locais." });
    if (Number(payload.questions_per_attempt || 0) > questions.length)
      issues.push({ severity: "error", code: "assessment_question_sample_too_large", path: "questions_per_attempt", message: "A quantidade sorteada não pode superar o total de questões cadastradas." });
    return issues;
  },
);
assessment.authorizeRecord = async (_actor, action, _state, _payload, context) => {
  if (action === "read") {
    const staffPermissions = ["plugin.suinda-learning.write", "plugin.suinda-learning.publish", "plugin.suinda-learning.manage"];
    for (const permission of staffPermissions)
      if (await context.hasPermission?.(permission) || await context.hasWorkspacePermission?.(permission)
        || context.recordId && await context.hasPermissionOnResource?.(permission, context.recordId)) return true;
    return false;
  }
  const permission = `plugin.suinda-learning.${action}`;
  return Boolean(await context.hasPermission?.(permission) || await context.hasWorkspacePermission?.(permission)
    || context.recordId && await context.hasPermissionOnResource?.(permission, context.recordId));
};
submission.validate = relatedRecord("assessment_record_id", "assessment");
practice.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  async (payload, context) => {
    if (typeof payload.enrollment_record_id !== "string" || typeof payload.learner_user_id !== "string" || !context.resolveLatestRecord) return [];
    const enrollmentRecord = await context.resolveLatestRecord(payload.enrollment_record_id);
    return enrollmentRecord?.payload.learner_user_id === payload.learner_user_id
      ? []
      : [{ severity: "error", code: "learner_mismatch", path: "learner_user_id", message: "O aluno precisa corresponder à matrícula." }];
  },
);
certificate.validate = combine(
  relatedRecord("enrollment_record_id", "enrollment"),
  async (payload, context) => {
    if (typeof payload.enrollment_record_id !== "string" || !context.resolveLatestRecord) return [];
    const enrollmentRecord = await context.resolveLatestRecord(payload.enrollment_record_id);
    if (enrollmentRecord?.payload.learner_user_id !== payload.learner_user_id)
      return [{ severity: "error", code: "learner_mismatch", path: "learner_user_id", message: "O certificado precisa pertencer ao aluno matriculado." }];
    if (payload.certificate_kind === "participation") {
      if (typeof payload.participation_scope !== "string" || !payload.participation_scope.trim())
        return [{ severity: "error", code: "certificate_participation_scope_required", path: "participation_scope", message: "Descreva as atividades efetivamente abrangidas pelo certificado de participação." }];
      if (typeof payload.completed_at !== "string" || !Number.isFinite(Date.parse(payload.completed_at)))
        return [{ severity: "error", code: "certificate_participation_date_required", path: "completed_at", message: "Informe a data em que a participação foi concluída." }];
      if (typeof payload.workload_hours !== "number" || !Number.isFinite(payload.workload_hours) || payload.workload_hours <= 0)
        return [{ severity: "error", code: "certificate_participation_workload_invalid", path: "workload_hours", message: "A carga horária do escopo de participação precisa ser positiva." }];
      return enrollmentRecord && ["enrolled", "active", "paused", "completed"].includes(enrollmentRecord.state)
        ? []
        : [{ severity: "error", code: "certificate_participation_enrollment_invalid", path: "enrollment_record_id", message: "O certificado de participação exige uma matrícula vigente ou concluída." }];
    }
    if (payload.certificate_kind === "milestone") {
      if (typeof payload.milestone_key !== "string" || typeof payload.milestone_title !== "string" || !payload.milestone_title.trim())
        return [{ severity: "error", code: "certificate_milestone_fields_required", path: "milestone_key", message: "O certificado precisa identificar o marco intermediário da revisão do curso." }];
      if (typeof payload.participation_scope !== "string" || !payload.participation_scope.trim())
        return [{ severity: "error", code: "certificate_milestone_scope_required", path: "participation_scope", message: "Registre as aulas abrangidas pelo marco intermediário." }];
      if (!enrollmentRecord || !["enrolled", "active", "paused", "completed"].includes(enrollmentRecord.state))
        return [{ severity: "error", code: "certificate_milestone_enrollment_invalid", path: "enrollment_record_id", message: "O certificado intermediário exige matrícula vigente ou concluída." }];
      const courseId = typeof enrollmentRecord.payload.course_record_id === "string" ? enrollmentRecord.payload.course_record_id : "";
      const courseRevision = Number(enrollmentRecord.payload.course_revision);
      if (!courseId || !Number.isInteger(courseRevision) || !context.resolveRecord)
        return [{ severity: "error", code: "certificate_milestone_course_revision_missing", path: "enrollment_record_id", message: "A versão curricular vinculada à matrícula não pode ser verificada." }];
      const courseRecord = await context.resolveRecord(courseId, courseRevision);
      const configured = Array.isArray(courseRecord?.payload.intermediate_certificate_milestones)
        ? courseRecord.payload.intermediate_certificate_milestones as Array<Record<string, unknown>> : [];
      const milestone = configured.find((entry) => entry.milestone_key === payload.milestone_key);
      const requiredIds = Array.isArray(milestone?.required_lesson_ids)
        ? milestone.required_lesson_ids.filter((value): value is string => typeof value === "string") : [];
      if (!milestone || milestone.milestone_title !== payload.milestone_title || !requiredIds.length)
        return [{ severity: "error", code: "certificate_milestone_not_configured", path: "milestone_key", message: "O marco não corresponde à revisão curricular fixada na matrícula." }];
      const [progressRecords, lessonRecords] = await Promise.all([
        context.listLatestRecords?.("suinda-learning", "lesson_progress", { enrollment_record_id: String(payload.enrollment_record_id) }, "completed", 500),
        Promise.all(requiredIds.map((lessonId) => context.resolveLatestRecord?.(lessonId))),
      ]);
      const completedIds = new Set((progressRecords || []).filter((entry) => entry.payload.learner_user_id === payload.learner_user_id)
        .map((entry) => entry.payload.lesson_record_id).filter((value): value is string => typeof value === "string"));
      if (!requiredIds.every((lessonId) => completedIds.has(lessonId)))
        return [{ severity: "error", code: "certificate_milestone_lessons_incomplete", path: "milestone_key", message: "Todas as aulas configuradas para o marco precisam estar concluídas." }];
      for (const [index, lessonRecord] of lessonRecords.entries()) {
        const moduleId = typeof lessonRecord?.payload.module_record_id === "string" ? lessonRecord.payload.module_record_id : "";
        const moduleRecord = moduleId ? await context.resolveLatestRecord?.(moduleId) : null;
        if (lessonRecord?.pluginId !== "suinda-learning" || lessonRecord.kind !== "lesson"
          || moduleRecord?.pluginId !== "suinda-learning" || moduleRecord.kind !== "module"
          || moduleRecord.payload.course_record_id !== courseId || Number(moduleRecord.payload.course_version) !== Number(courseRecord?.payload.version))
          return [{ severity: "error", code: "certificate_milestone_lesson_course_mismatch", path: `participation_scope.${index}`, message: "As aulas do certificado não pertencem à versão curricular da matrícula." }];
      }
      if (!Array.isArray(payload.milestone_lesson_titles) || payload.milestone_lesson_titles.length !== requiredIds.length
        || payload.milestone_lesson_titles.some((value) => typeof value !== "string" || !value.trim()))
        return [{ severity: "error", code: "certificate_milestone_lesson_titles_invalid", path: "milestone_lesson_titles", message: "O certificado precisa listar as aulas que compõem o marco configurado." }];
      return [];
    }
    return enrollmentRecord?.state === "completed"
      ? []
      : [{ severity: "error", code: "enrollment_not_completed", path: "enrollment_record_id", message: "Só é possível emitir certificado após concluir a matrícula." }];
  },
);
path.validate = async (payload, context) => {
  if (!Array.isArray(payload.course_record_ids) || !context.resolveLatestRecord) return [];
  const courses = await Promise.all(payload.course_record_ids.filter((value): value is string => typeof value === "string").map((id) => context.resolveLatestRecord!(id)));
  return courses.every((record) => record?.pluginId === "suinda-learning" && record.kind === "course")
    ? []
    : [{ severity: "error", code: "invalid_academic_reference", path: "course_record_ids", message: "Todos os itens da trilha devem ser cursos do Suindá no mesmo workspace." }];
};

export const suindaRecordKinds: Record<string, RecordKindContribution> = {
  institution_unit: institutionUnit, course, cohort, institution_settings: institutionSettings, enrollment_coupon: enrollmentCoupon, enrollment, payment_entry: paymentEntry, makeup_fee_entry: makeupFeeEntry, learner_profile: learnerProfile, learner_profile_field: learnerProfileField, learner_privacy_request: learnerPrivacyRequest, privacy_notice: privacyNotice, learner_consent: learnerConsent, academic_term: academicTerm, academic_signature: academicSignature, staff_profile: staffProfile, staff_credential: staffCredential, course_favorite: courseFavorite, learner_document: learnerDocument, attendance_justification: attendanceJustification, makeup_request: makeupRequest, module: learningModule, learning_unit: learningUnit, lesson, lesson_progress: lessonProgress, media_progress: mediaProgress, learning_bookmark: learningBookmark, discussion_thread: discussionThread, discussion_reply: discussionReply, discussion_reaction: discussionReaction, alumni_post: alumniPost, alumni_reply: alumniReply, community_pin: communityPin, community_report: communityReport, learning_message: learningMessage, network_connection: networkConnection, community_direct_message: communityDirectMessage, study_group: studyGroup, study_group_member: studyGroupMember, study_group_message: studyGroupMessage, room, session: liveSession, academic_calendar_event: academicCalendarEvent, attendance, question_bank: questionBank, assessment, submission, assessment_attempt: assessmentAttempt, assessment_session: assessmentSession, practice,
  certificate, certificate_template: certificateTemplate, scholarship, scholarship_application: application, scholarship_counterparty: scholarshipCounterparty, announcement: communication, announcement_template: announcementTemplate, announcement_read_receipt: announcementReceipt, survey, survey_response: surveyResponse, learning_path: path, learning_challenge: learningChallenge, learning_season: learningSeason,
};

export const suindaPlugin: PluginDefinition = {
  id: "suinda-learning",
  name: "Suindá · Plataforma de cursos",
  version: "1.0.0",
  description: "Cursos, turmas, aprendizagem, avaliações, frequência, bolsas e certificação em workspaces do Orbit.",
  scope: "workspace",
  parentPlugin: "versioned-records",
  dependencies: ["versioned-records", "workspaces"],
  handlesRoute: (path) => path === "/public/suinda/courses"
    || path === "/public/suinda/payments/mercado-pago/webhook"
    || /^\/extensions\/suinda-learning\/courses\/[0-9a-f-]{36}\/duplicate$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/payment-provider$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/payment-reviews$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/payment-reviews\/[0-9a-f-]{36}\/reconcile$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/checkout$/.test(path)
    || /^\/extensions\/suinda-learning\/curriculum\/(?:course|module|learning_unit)\/[0-9a-f-]{36}\/reorder$/.test(path)
    || path === "/extensions/suinda-learning/me/data-export"
    || path === "/extensions/suinda-learning/me/transcript"
    || path === "/extensions/suinda-learning/me/recommendations"
    || path === "/extensions/suinda-learning/me/learning-paths"
    || path === "/extensions/suinda-learning/me/seasons"
    || path === "/extensions/suinda-learning/me/privacy-requests"
    || path === "/extensions/suinda-learning/me/privacy-workspaces"
    || path === "/extensions/suinda-learning/me/privacy-notices"
    || path === "/extensions/suinda-learning/me/privacy-consents"
    || path === "/extensions/suinda-learning/me/teaching/accessibility-audit/courses"
    || path === "/extensions/suinda-learning/me/teaching/scholarship-counterparties"
    || path === "/extensions/suinda-learning/me/teaching/scholarship-applications"
    || path === "/extensions/suinda-learning/me/teaching/financial-action-queue"
    || path === "/extensions/suinda-learning/me/teaching/admin/assessment-risks"
    || path === "/extensions/suinda-learning/me/teaching/admin/operations"
    || /^\/extensions\/suinda-learning\/me\/teaching\/unit-operations\/(?:assessment|document|risk|capacity)$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/accessibility-audit\/courses\/[0-9a-f-]{36}\/lessons$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/units\/[0-9a-f-]{36}\/team(?:\/[0-9a-f-]{36})?$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/signatures(?:\/[0-9a-f-]{36})?$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/privacy-retention-candidates$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/me\/privacy-requests$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/me\/privacy-requests\/[0-9a-f-]{36}\/identity-challenge(?:\/verify)?$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/privacy-requests\/[0-9a-f-]{36}\/categories$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/privacy-requests\/[0-9a-f-]{36}\/execute$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/privacy-requests$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/me\/privacy-notices\/[0-9a-f-]{36}\/response$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/privacy-consents\/[0-9a-f-]{36}\/withdraw$/.test(path)
    || /^\/public\/suinda\/calendar\/[A-Za-z0-9_-]{43}\.ics$/.test(path)
    || path === "/extensions/suinda-learning/me/calendar-subscription"
    || path === "/extensions/suinda-learning/me/alumni"
    || /^\/extensions\/suinda-learning\/me\/alumni\/enrollments\/[0-9a-f-]{36}(?:\/posts(?:\/[0-9a-f-]{36}\/replies)?)?$/.test(path)
    || path === "/extensions/suinda-learning/me/checkin"
    || /^\/extensions\/suinda-learning\/me\/teaching\/sessions\/[0-9a-f-]{36}\/checkin-code$/i.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/sessions\/[0-9a-f-]{36}\/attendance\/zoom-sync$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/sessions\/[0-9a-f-]{36}\/attendance\/(?:google-meet|teams)-sync$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/community(?:\/participants|\/reports|\/connections(?:\/[0-9a-f-]{36}\/(?:accept|decline|cancel|messages))?|\/threads\/[0-9a-f-]{36}\/(?:replies|reactions|pin|unpin)|\/groups(?:\/[0-9a-f-]{36}\/(?:join|leave|close))?)?$/.test(path)
    || path === "/extensions/suinda-learning/me/teaching/community-reports"
    || /^\/extensions\/suinda-learning\/me\/teaching\/community-reports\/[0-9a-f-]{36}\/(?:dismiss|remove)$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/courses\/[0-9a-f-]{36}\/community$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/community\/threads\/[0-9a-f-]{36}\/(?:pin|unpin)$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/messages$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/lessons\/[0-9a-f-]{36}\/media-progress$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/announcements\/[0-9a-f-]{36}\/read$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/actions$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/submit$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/coupon$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/enrollments\/[0-9a-f-]{36}\/payments$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/enrollments\/[0-9a-f-]{36}\/refunds$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/enrollments\/[0-9a-f-]{36}\/financial-cancellations$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/enrollments\/[0-9a-f-]{36}\/refunds$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/makeup-requests\/[0-9a-f-]{36}\/fee$/.test(path)
    || path === "/extensions/suinda-learning/me/scholarships"
    || path === "/extensions/suinda-learning/me/scholarship-counterparties"
    || /^\/extensions\/suinda-learning\/scholarship-counterparties\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}$/i.test(path)
    || /^\/extensions\/suinda-learning\/me\/scholarship-counterparties\/[0-9a-f-]{36}\/submission$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/scholarship-counterparties\/[0-9a-f-]{36}\/review$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/survey-reminder-policy$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/email-templates(?:\/[a-z_]+)?$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/practice-credit-policy$/.test(path)
    || path === "/extensions/suinda-learning/me/practice-credit-requests"
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/practice-credit-requests$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/practice-credit-requests(?:\/[0-9a-f-]{36}\/review)?$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/scholarship-applications$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/scholarship-applications\/[0-9a-f-]{36}\/review$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/documents$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/signatures(?:\/[0-9a-f-]{36})?$/.test(path)
    || /^\/public\/suinda\/courses\/[^/]+(?:\/cohorts)?$/.test(path)
    || /^\/public\/suinda\/certificates\/SUINDA-[0-9a-f-]{36}$/i.test(path)
    || path === "/extensions/suinda-learning/me/calendar.ics"
    || path === "/extensions/suinda-learning/me/reports"
    || path === "/extensions/suinda-learning/me/reports.pdf"
    || path === "/extensions/suinda-learning/me/finance-ledger.csv"
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/units\/[0-9a-f-]{36}\/team(?:\/[0-9a-f-]{36})?$/.test(path)
    || path === "/extensions/suinda-learning/me/teaching-profiles"
    || /^\/extensions\/suinda-learning\/me\/teaching-profiles\/[0-9a-f-]{36}$/i.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/staff-(?:credentials|directory)$/i.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/me\/staff-credentials$/i.test(path)
    || /^\/extensions\/suinda-learning\/staff-credentials\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}$/i.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/staff-honoraria$/i.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/staff-honoraria\/[0-9a-f-]{36}\/payments$/i.test(path)
    || path === "/extensions/suinda-learning/me/scholarships"
    || /^\/extensions\/suinda-learning\/me\/teaching\/surveys\/[0-9a-f-]{36}\/results$/.test(path)
    || path === "/extensions/suinda-learning/me/teaching/surveys"
    || /^\/extensions\/suinda-learning\/me\/teaching\/cohorts\/[0-9a-f-]{36}\/announcement-templates$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/cohorts\/[0-9a-f-]{36}\/announcements$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]{36}\/materials$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]{36}\/materials\/[0-9a-f-]{36}\/alt-text$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]{36}\/accessibility$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/surveys(?:\/[0-9a-f-]{36}\/responses)?$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/lessons\/[0-9a-f-]{36}\/materials\/[0-9a-f-]{36}\/preview$/.test(path)
    || path === "/extensions/suinda-learning/me/favorites"
    || /^\/extensions\/suinda-learning\/me\/favorites\/[0-9a-f-]{36}$/i.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/attendance-justifications$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/sessions\/[0-9a-f-]{36}\/attendance-justifications$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/sessions\/[0-9a-f-]{36}\/makeup-requests$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/practices\/[0-9a-f-]{36}\/submit$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/attendance-justifications\/[0-9a-f-]{36}\/review$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/assessment-attempts\/[0-9a-f-]{36}\/grade$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/practices\/[0-9a-f-]{36}\/review$/.test(path),
  routePermission: (path, method) => /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/practice-credit-policy$/.test(path) && method === "PUT"
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/privacy-requests\/[0-9a-f-]{36}\/(?:categories|execute)$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/privacy-requests$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/scholarship-counterparties\/[0-9a-f-]{36}\/review$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/staff-honoraria$/.test(path) && method === "POST"
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/staff-honoraria\/[0-9a-f-]{36}\/payments$/.test(path) && method === "POST"
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/practice-credit-requests(?:\/[0-9a-f-]{36}\/review)?$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/survey-reminder-policy$/.test(path) && method === "PUT"
    || /^\/extensions\/suinda-learning\/me\/teaching\/makeup-requests\/[0-9a-f-]{36}\/fee$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/enrollments\/[0-9a-f-]{36}\/refunds$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/enrollments\/[0-9a-f-]{36}\/financial-cancellations$/.test(path)
    ? "plugin.suinda-learning.manage"
    : /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/survey-reminder-policy$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/practice-credit-policy$/.test(path)
      ? "plugin.suinda-learning.read"
    : path === "/public/suinda/courses" && method === "GET"
    || path === "/public/suinda/payments/mercado-pago/webhook" && method === "POST"
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/checkout$/.test(path)
    || /^\/extensions\/suinda-learning\/curriculum\/(?:course|module|learning_unit)\/[0-9a-f-]{36}\/reorder$/.test(path)
    || /^\/extensions\/suinda-learning\/courses\/[0-9a-f-]{36}\/duplicate$/.test(path)
    || path === "/extensions/suinda-learning/me/data-export"
    || path === "/extensions/suinda-learning/me/transcript"
    || path === "/extensions/suinda-learning/me/recommendations"
    || path === "/extensions/suinda-learning/me/seasons"
    || path === "/extensions/suinda-learning/me/privacy-requests"
    || path === "/extensions/suinda-learning/me/privacy-workspaces"
    || path === "/extensions/suinda-learning/me/privacy-notices"
    || path === "/extensions/suinda-learning/me/privacy-consents"
    || /^\/extensions\/suinda-learning\/me\/teaching\/unit-operations\/(?:assessment|document|risk|capacity)$/.test(path)
    || path === "/extensions/suinda-learning/me/teaching/admin/assessment-risks"
    || path === "/extensions/suinda-learning/me/teaching/admin/operations"
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/units\/[0-9a-f-]{36}\/team(?:\/[0-9a-f-]{36})?$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/signatures(?:\/[0-9a-f-]{36})?$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/me\/privacy-requests$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/me\/privacy-requests\/[0-9a-f-]{36}\/identity-challenge(?:\/verify)?$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/me\/privacy-notices\/[0-9a-f-]{36}\/response$/.test(path)
    || /^\/extensions\/suinda-learning\/me\/privacy-consents\/[0-9a-f-]{36}\/withdraw$/.test(path)
    || /^\/public\/suinda\/calendar\/[A-Za-z0-9_-]{43}\.ics$/.test(path)
    || path === "/extensions/suinda-learning/me/calendar-subscription"
    || path === "/extensions/suinda-learning/me/alumni"
    || /^\/extensions\/suinda-learning\/me\/alumni\/enrollments\/[0-9a-f-]{36}(?:\/posts(?:\/[0-9a-f-]{36}\/replies)?)?$/.test(path)
    || path === "/extensions/suinda-learning/me/scholarship-counterparties"
    || /^\/extensions\/suinda-learning\/scholarship-counterparties\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}$/i.test(path)
    || /^\/extensions\/suinda-learning\/me\/teaching\/cohorts\/[0-9a-f-]{36}\/(?:announcement-templates|announcements)$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/email-templates(?:\/[a-z_]+)?$/.test(path)
    ? null
    : /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/privacy-retention-candidates$/.test(path)
      ? "plugin.suinda-learning.manage"
    : path === "/extensions/suinda-learning/me/reports"
    || path === "/extensions/suinda-learning/me/reports.pdf"
    || path === "/extensions/suinda-learning/me/finance-ledger.csv"
    || path === "/extensions/suinda-learning/me/checkin"
    || /^\/extensions\/suinda-learning\/me\/teaching\/sessions\/[0-9a-f-]{36}\/checkin-code$/i.test(path)
    || path === "/extensions/suinda-learning/me/teaching-profiles"
    || /^\/extensions\/suinda-learning\/me\/teaching-profiles\/[0-9a-f-]{36}$/i.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/staff-(?:credentials|directory)$/i.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/me\/staff-credentials$/i.test(path)
    || /^\/extensions\/suinda-learning\/staff-credentials\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}$/i.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/staff-honoraria$/i.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/payment-provider$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/payment-reviews$/.test(path)
    || /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]{36}\/payment-reviews\/[0-9a-f-]{36}\/reconcile$/.test(path)
    ? null
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/community(?:\/participants|\/reports|\/connections(?:\/[0-9a-f-]{36}\/(?:accept|decline|cancel|messages))?|\/threads\/[0-9a-f-]{36}\/(?:replies|reactions|pin|unpin)|\/groups(?:\/[0-9a-f-]{36}\/(?:join|leave|close))?)?$/.test(path)
    ? "plugin.suinda-learning.read"
    : path === "/extensions/suinda-learning/me/teaching/community-reports"
      || /^\/extensions\/suinda-learning\/me\/teaching\/community-reports\/[0-9a-f-]{36}\/(?:dismiss|remove)$/.test(path)
      || /^\/extensions\/suinda-learning\/me\/teaching\/courses\/[0-9a-f-]{36}\/community$/.test(path)
      || /^\/extensions\/suinda-learning\/me\/teaching\/community\/threads\/[0-9a-f-]{36}\/(?:pin|unpin)$/.test(path)
      ? null
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/messages$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/lessons\/[0-9a-f-]{36}\/media-progress$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/announcements\/[0-9a-f-]{36}\/read$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/actions$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/submit$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/coupon$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/documents$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/sessions\/[0-9a-f-]{36}\/makeup-requests$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/teaching\/attendance-justifications\//.test(path)
    ? "plugin.suinda-learning.manage"
    : /^\/extensions\/suinda-learning\/me\/teaching\/enrollments\/[0-9a-f-]{36}\/payments$/.test(path)
      ? "plugin.suinda-learning.manage"
    : /^\/extensions\/suinda-learning\/me\/teaching\/scholarship-applications\/[0-9a-f-]{36}\/review$/.test(path)
      ? "plugin.suinda-learning.manage"
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/scholarship-applications$/.test(path)
      ? null
    : /^\/extensions\/suinda-learning\/me\/scholarship-counterparties\/[0-9a-f-]{36}\/submission$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/teaching\/sessions\/[0-9a-f-]{36}\/attendance\/(?:zoom|google-meet|teams)-sync$/.test(path)
      ? "plugin.suinda-learning.write"
    : /^\/extensions\/suinda-learning\/me\/teaching\/assessment-attempts\/[0-9a-f-]{36}\/grade$/.test(path)
      ? "plugin.suinda-learning.write"
    : /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]{36}\/materials$/.test(path) && method === "GET"
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]{36}\/materials$/.test(path) && method === "POST"
      ? "plugin.suinda-learning.write"
    : /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]{36}\/materials\/[0-9a-f-]{36}\/alt-text$/.test(path)
      ? "plugin.suinda-learning.write"
    : /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]{36}\/accessibility$/.test(path)
      ? "plugin.suinda-learning.write"
    : /^\/extensions\/suinda-learning\/me\/teaching\/practices\/[0-9a-f-]{36}\/review$/.test(path)
      ? "plugin.suinda-learning.write"
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/practices\/[0-9a-f-]{36}\/submit$/.test(path)
      ? "plugin.suinda-learning.read"
    : /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]{36}\/practice-credit-requests$/.test(path)
      ? "plugin.suinda-learning.read"
    : path.startsWith("/extensions/suinda-learning/me/favorites")
      || path.includes("/attendance-justifications") ? "plugin.suinda-learning.read"
    : method === "GET" ? null : "plugin.suinda-learning.write",
  capabilities: [
    { id: "read", name: "Consultar dados acadêmicos", permissions: ["plugin.suinda-learning.read"] },
    { id: "write", name: "Gerir cursos e atividades", permissions: ["plugin.suinda-learning.write"] },
    { id: "publish", name: "Publicar e concluir fluxos acadêmicos", permissions: ["plugin.suinda-learning.publish"] },
    { id: "manage", name: "Administrar registros acadêmicos privados", permissions: ["plugin.suinda-learning.manage"] },
  ],
  contributions: {
    notifications: [
      { id: "announcement", label: "Comunicados acadêmicos" },
      { id: "community_reply", label: "Respostas da comunidade" },
      { id: "alumni_reply", label: "Respostas de ex-alunos" },
      { id: "community_connection", label: "Conexões da comunidade" },
      { id: "community_message", label: "Mensagens da comunidade" },
    ],
    navigation: [
      { id: "suinda", label: "Minha aprendizagem", href: "/suinda", permission: "plugin.suinda-learning.read", order: 5, group: { id: "learning", label: "Aprendizagem", order: 5 } },
      { id: "suinda-catalog", label: "Catálogo de cursos", href: "/suinda/catalog", permission: "plugin.suinda-learning.read", order: 6, group: { id: "learning", label: "Aprendizagem", order: 5 } },
    ],
    recordKinds: suindaRecordKinds,
  },
};
