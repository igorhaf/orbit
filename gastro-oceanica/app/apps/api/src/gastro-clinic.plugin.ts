import type { PluginDefinition, RecordValidationContext } from './plugins/contract';

const string = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const issue = (code: string, path: string, message: string) => ({ severity: 'error' as const, code, path, message });
const patientFieldGroups = [
  {
    id: 'personal', label: 'Dados pessoais',
    fields: ['code', 'display_name', 'civil_name', 'gender', 'social_gender', 'birth_date', 'cpf', 'rg', 'email', 'mobile_phone', 'home_phone', 'office_phone', 'indication', 'indication_observation', 'sms_reminders'],
  },
  { id: 'care-team', label: 'Acompanhamento administrativo', fields: ['assigned_professional_ids'] },
  {
    id: 'complementary', label: 'Dados complementares',
    fields: ['summary', 'zip_code', 'address', 'number', 'complement', 'neighborhood', 'city', 'state', 'country', 'birth_place', 'birth_state', 'nationality', 'ethnicity', 'religion', 'marital_status', 'education', 'occupation', 'related_person_name', 'related_person_relationship', 'related_person_profession', 'health_card_number', 'administrative_note', 'status_note', 'clinical_background', 'surgical_background', 'family_background', 'habits'],
  },
];
const professionalFieldGroups = [
  { id: 'profile', label: 'Perfil profissional', fields: ['code', 'display_name', 'team', 'specialty_id', 'active_for_agenda'] },
  { id: 'credentials', label: 'Contato e registros', fields: ['email', 'cpf', 'mobile_phone', 'council_number', 'rqe', 'cnes'] },
];

async function linked(context: RecordValidationContext, id: unknown, kind: string) {
  if (typeof id !== 'string' || !context.resolveLatestRecord) return null;
  const record = await context.resolveLatestRecord(id);
  return record?.pluginId === 'gastro-clinic' && record.kind === kind ? record : null;
}

async function validateSpecialtyReference(id: unknown, context: RecordValidationContext, path: string) {
  if (id === undefined || id === null || id === '') return [];
  const specialty = await linked(context, id, 'specialty');
  return specialty?.state === 'active' ? [] : [issue('specialty_reference', path, 'Selecione uma especialidade ativa deste mesmo espaço.')];
}

async function validateCoverageReferences(payload: Record<string, unknown>, context: RecordValidationContext) {
  const issues = [];
  const patient = await linked(context, payload.patient_id, 'patient');
  const provider = await linked(context, payload.provider_id, 'insurance_provider');
  const plan = payload.plan_id ? await linked(context, payload.plan_id, 'insurance_plan') : null;
  if (!patient || patient.state !== 'active') issues.push(issue('coverage_patient_reference', '/patient_id', 'Selecione um cadastro ativo deste mesmo espaço.'));
  if (!provider || provider.state !== 'active') issues.push(issue('coverage_provider_reference', '/provider_id', 'Selecione um convênio ativo deste mesmo espaço.'));
  if (payload.plan_id && (!plan || plan.state !== 'active' || plan.payload.provider_id !== payload.provider_id))
    issues.push(issue('coverage_plan_reference', '/plan_id', 'Selecione um plano ativo pertencente ao convênio escolhido.'));
  return issues;
}

export const gastroClinicPlugin: PluginDefinition = {
  id: 'gastro-clinic',
  name: 'Gestão clínica administrativa',
  version: '1.0.0',
  parentPlugin: 'versioned-records',
  dependencies: ['versioned-records', 'workspaces'],
    description: 'Cadastros administrativos e agenda. O catálogo não define protocolos, prontuários ou condutas clínicas.',
  capabilities: [
    { id: 'read', name: 'Consultar cadastros clínicos', permissions: ['plugin.gastro-clinic.read'] },
    { id: 'write', name: 'Administrar cadastros e agenda', permissions: ['plugin.gastro-clinic.write'] },
  ],
  contributions: {
    navigation: [
      { id: 'gastro-agenda', label: 'Agenda', href: '/calendar', permission: 'plugin.gastro-clinic.read', order: 18 },
      { id: 'gastro-appointments', label: 'Agendamentos', href: '/extensions/gastro-clinic?kind=appointment', permission: 'plugin.gastro-clinic.read', order: 19 },
      { id: 'gastro-schedule-blocks', label: 'Bloqueios de horário', href: '/extensions/gastro-clinic?kind=schedule_block', permission: 'plugin.gastro-clinic.read', order: 20 },
      { id: 'gastro-patients', label: 'Pessoas atendidas', href: '/extensions/gastro-clinic?kind=patient', permission: 'plugin.gastro-clinic.read', order: 21 },
      { id: 'gastro-clinic', label: 'Cadastros', href: '/extensions/gastro-clinic', permission: 'plugin.gastro-clinic.read', order: 22 },
    ],
    calendarSources: [{ providerId: 'gastro-clinic', label: 'Agenda clínica' }],
    profileSimulationExamples: context => context.permissions.includes('plugin.gastro-clinic.read') ? [
      { id: 'paciente-demo', title: 'Pessoa demonstrativa · GO-001', type: 'patient', state: 'active', description: 'Cadastro sintético sem dados de saúde ou contato.', is_demo: true },
      { id: 'contato-demo', title: 'Contato auxiliar demonstrativo', type: 'contact', state: 'active', description: 'Registro fictício, somente para visualizar o cadastro auxiliar.', is_demo: true },
      { id: 'agenda-demo', title: 'Agenda administrativa de exemplo', type: 'appointment', state: 'scheduled', description: 'Horário fictício para demonstração dos cadastros e da agenda.', is_demo: true },
      { id: 'schedule-block-demo', title: 'Bloqueio de agenda demonstrativo', type: 'schedule_block', state: 'active', description: 'Intervalo fictício de agenda, sem recorrência ou bloqueio de consultas relacionadas.', is_demo: true },
      { id: 'lista-espera-demo', title: 'Lista de espera demonstrativa', type: 'appointment_waitlist', state: 'waiting', description: 'Exemplo fictício; não cria agendamento nem envia comunicação.', is_demo: true },
      { id: 'atendimento-demo', title: 'Atendimento demonstrativo', type: 'encounter', state: 'in_progress', description: 'Ciclo administrativo fictício, sem anotação clínica ou assinatura.', is_demo: true },
      { id: 'convenio-demo', title: 'Convênio demonstrativo', type: 'insurance_provider', state: 'active', description: 'Cadastro fictício, sem integração de faturamento.', is_demo: true },
      { id: 'cobertura-demo', title: 'Cobertura demonstrativa', type: 'patient_coverage', state: 'active', description: 'Vínculo fictício sem número de beneficiário ou dados pessoais.', is_demo: true },
    ] : [],
    recordKinds: {
      specialty: {
        label: 'Especialidade (cadastro)', initial: 'active', transitions: { active: ['inactive'], inactive: ['active'] },
        stateLabels: { active: 'Ativa', inactive: 'Inativa' }, uniqueFields: ['code'], resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        schema: { type: 'object', additionalProperties: false, required: ['code', 'name'], properties: { code: { ...string(32), pattern: '^GO-[A-Z0-9-]+$' }, name: string(100), description: { type: 'string', maxLength: 300 } } },
        example: { code: 'GO-ESP-001', name: 'Especialidade demonstrativa', description: 'Rótulo administrativo configurado pela instituição.' },
      },
      patient: {
        label: 'Pessoa atendida', initial: 'active', transitions: { active: ['inactive'], inactive: ['active'] },
        stateLabels: { active: 'Ativo', inactive: 'Inativo' }, uniqueFields: ['code'], resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        searchableFields: ['code', 'display_name', 'mobile_phone', 'home_phone', 'office_phone', 'cpf'],
        sensitiveFields: [
          'display_name', 'civil_name', 'gender', 'social_gender', 'email', 'mobile_phone', 'home_phone', 'office_phone', 'sms_reminders',
          'birth_date', 'cpf', 'rg', 'summary', 'indication', 'indication_observation', 'zip_code', 'address',
          'number', 'complement', 'neighborhood', 'city', 'state', 'country', 'birth_place', 'birth_state',
          'nationality', 'ethnicity', 'religion', 'marital_status', 'education', 'occupation',
          'related_person_name', 'related_person_relationship', 'related_person_profession', 'health_card_number',
          'administrative_note', 'status_note', 'clinical_background', 'surgical_background', 'family_background', 'habits', 'assigned_professional_ids',
        ],
        schema: { type: 'object', additionalProperties: false, required: ['code', 'display_name', 'birth_date'], properties: {
          code: { ...string(32), pattern: '^GO-[A-Z0-9-]+$' }, display_name: string(120),
          assigned_professional_ids: { type: 'array', uniqueItems: true, maxItems: 100, items: { type: 'string', format: 'uuid', recordKind: 'professional' }, title: 'Profissionais responsáveis' },
          civil_name: { type: 'string', maxLength: 120 },
          gender: { type: 'string', enum: ['Masculino', 'Feminino'], title: 'Sexo' },
          social_gender: { type: 'string', enum: ['Cisgênero', 'Transgênero', 'Não binário', 'Agênero'], title: 'Gênero social' },
          email: { type: 'string', maxLength: 254, format: 'email' },
          mobile_phone: { type: 'string', maxLength: 40, title: 'Celular' },
          home_phone: { type: 'string', maxLength: 40, title: 'Telefone residencial' },
          office_phone: { type: 'string', maxLength: 40, title: 'Telefone comercial' },
          birth_date: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', title: 'Data de nascimento' },
          cpf: { type: 'string', maxLength: 20 }, rg: { type: 'string', maxLength: 32 },
          summary: { type: 'string', maxLength: 1000, title: 'Resumo administrativo', format: 'textarea' },
          indication: { type: 'string', enum: ['Encaminhamento médico', 'Guia médico', 'Hospital', 'Indicação de paciente', 'Internet', 'Outro'], title: 'Como conheceu?' },
          indication_observation: { type: 'string', maxLength: 300, title: 'Detalhe da indicação' },
          sms_reminders: { type: 'boolean', title: 'Autoriza lembretes por SMS', default: false },
          zip_code: { type: 'string', maxLength: 20, title: 'CEP' },
          address: { type: 'string', maxLength: 160, title: 'Endereço' },
          number: { type: 'string', maxLength: 30, title: 'Número' },
          complement: { type: 'string', maxLength: 100, title: 'Complemento' },
          neighborhood: { type: 'string', maxLength: 100, title: 'Bairro' },
          city: { type: 'string', maxLength: 100, title: 'Cidade' },
          state: { type: 'string', enum: ['Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará', 'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro', 'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'] },
          country: { type: 'string', maxLength: 80, title: 'País' },
          birth_place: { type: 'string', maxLength: 100, title: 'Naturalidade' },
          birth_state: { type: 'string', enum: ['Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará', 'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro', 'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'], title: 'Estado de nascimento' },
          nationality: { type: 'string', maxLength: 80 },
          ethnicity: { type: 'string', enum: ['Amarela', 'Branca', 'Negra', 'Parda', 'Indígenas e Quilombolas'], title: 'Etnia' },
          religion: { type: 'string', maxLength: 100 },
          marital_status: { type: 'string', enum: ['Solteiro', 'Casado', 'Separado', 'Divorciado', 'Viúvo', 'União estável'], title: 'Estado civil' },
          education: { type: 'string', enum: ['Nenhuma', 'Ensino fundamental', 'Ensino fundamental incompleto', 'Ensino médio', 'Ensino médio incompleto', 'Ensino superior', 'Ensino superior incompleto', 'Pós graduação', 'Mestrado', 'Doutorado'], title: 'Escolaridade' },
          occupation: { type: 'string', maxLength: 120, title: 'Ocupação' },
          related_person_name: { type: 'string', maxLength: 120, title: 'Pessoa relacionada' },
          related_person_relationship: { type: 'string', maxLength: 80, title: 'Parentesco' },
          related_person_profession: { type: 'string', maxLength: 120, title: 'Profissão da pessoa relacionada' },
          health_card_number: { type: 'string', maxLength: 40, title: 'Número do cartão de saúde' },
          administrative_note: { type: 'string', maxLength: 300 }, status_note: { type: 'string', maxLength: 300 },
          clinical_background: { type: 'string', maxLength: 10000, title: 'Antecedentes clínicos', format: 'textarea' },
          surgical_background: { type: 'string', maxLength: 10000, title: 'Antecedentes cirúrgicos', format: 'textarea' },
          family_background: { type: 'string', maxLength: 10000, title: 'Antecedentes familiares', format: 'textarea' },
          habits: { type: 'string', maxLength: 10000, title: 'Hábitos', format: 'textarea' },
        }, 'x-orbit-field-groups': patientFieldGroups },
        example: { code: 'GO-DEMO-001', display_name: 'Pessoa demonstrativa', birth_date: '1990-01-01', mobile_phone: '000000000' },
        validate: async (payload, context) => {
          const issues = [];
          const assignedProfessionals = Array.isArray(payload.assigned_professional_ids) ? payload.assigned_professional_ids : [];
          for (const [index, professionalId] of assignedProfessionals.entries()) {
            const professional = await linked(context, professionalId, 'professional');
            if (!professional || professional.state !== 'active')
              issues.push(issue('patient_professional_reference', `/assigned_professional_ids/${index}`, 'Selecione profissionais ativos deste mesmo espaço.'));
          }
          const birthDate = typeof payload.birth_date === 'string' ? payload.birth_date : '';
          const parsedBirthDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? new Date(`${birthDate}T00:00:00.000Z`) : null;
          const validBirthDate = parsedBirthDate && !Number.isNaN(parsedBirthDate.valueOf()) && parsedBirthDate.toISOString().slice(0, 10) === birthDate;
          if (birthDate && !validBirthDate) issues.push(issue('patient_birth_date_invalid', '/birth_date', 'Informe uma data de nascimento válida.'));
          if (validBirthDate && birthDate > new Date().toISOString().slice(0, 10)) issues.push(issue('patient_birth_date_future', '/birth_date', 'A data de nascimento não pode estar no futuro.'));
          if (![payload.mobile_phone, payload.home_phone, payload.office_phone].some(value => typeof value === 'string' && value.trim()))
            issues.push(issue('patient_contact_required', '/mobile_phone', 'Informe ao menos um telefone de contato.'));
          return issues;
        },
      },
      contact: {
        label: 'Contato auxiliar', initial: 'active', transitions: { active: ['inactive'], inactive: ['active'] },
        stateLabels: { active: 'Ativo', inactive: 'Inativo' }, resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        sensitiveFields: ['name', 'email', 'phone', 'zip_code', 'address', 'number', 'complement', 'neighborhood', 'city', 'state', 'observation'],
        schema: { type: 'object', additionalProperties: false, required: ['name'], properties: {
          name: { ...string(120), title: 'Nome' },
          email: { type: 'string', maxLength: 254, format: 'email', title: 'E-mail' },
          phone: { type: 'string', maxLength: 40, title: 'Telefone' },
          zip_code: { type: 'string', maxLength: 20, title: 'CEP' },
          address: { type: 'string', maxLength: 160, title: 'Endereço' },
          number: { type: 'integer', title: 'Número' },
          complement: { type: 'string', maxLength: 100, title: 'Complemento' },
          neighborhood: { type: 'string', maxLength: 100, title: 'Bairro' },
          city: { type: 'string', maxLength: 100, title: 'Cidade' },
          state: { type: 'string', enum: ['Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará', 'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro', 'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'] },
          observation: { type: 'string', maxLength: 1000, format: 'textarea', title: 'Observação administrativa' },
        } },
        example: { name: 'Contato demonstrativo', email: 'contato@example.invalid' },
      },
      professional: {
        label: 'Profissional', initial: 'active', transitions: { active: ['inactive'], inactive: ['active'] },
        stateLabels: { active: 'Ativo', inactive: 'Inativo' }, uniqueFields: ['code'], resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        sensitiveFields: ['display_name', 'email', 'cpf', 'mobile_phone', 'council_number', 'rqe', 'cnes'],
        schema: { type: 'object', additionalProperties: false, required: ['code', 'display_name', 'team'], properties: {
          code: { ...string(32), pattern: '^GO-[A-Z0-9-]+$' },
          display_name: { ...string(120), title: 'Nome profissional' },
          team: { ...string(80), title: 'Equipe' },
          specialty_id: { type: 'string', format: 'uuid', title: 'Especialidade', recordKind: 'specialty' },
          active_for_agenda: { type: 'boolean', title: 'Ativo para agenda' },
          email: { type: 'string', maxLength: 254, format: 'email', title: 'E-mail' },
          cpf: { type: 'string', maxLength: 20, title: 'CPF' },
          mobile_phone: { type: 'string', maxLength: 40, title: 'Celular' },
          council_number: { type: 'string', maxLength: 80, title: 'Número do conselho' },
          rqe: { type: 'string', maxLength: 80, title: 'RQE' },
          cnes: { type: 'string', maxLength: 80, title: 'CNES' },
        }, 'x-orbit-field-groups': professionalFieldGroups },
        example: { code: 'GO-DEMO-P01', display_name: 'Profissional demonstrativo', team: 'Equipe de exemplo', active_for_agenda: true },
        validate: async (payload, context) => validateSpecialtyReference(payload.specialty_id, context, '/specialty_id'),
      },
      service_catalog: {
        label: 'Serviço (catálogo administrativo)', initial: 'active', transitions: { active: ['inactive'], inactive: ['active'] },
        stateLabels: { active: 'Ativo', inactive: 'Inativo' }, uniqueFields: ['code'], resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        schema: { type: 'object', additionalProperties: false, required: ['code', 'name'], properties: { code: { ...string(32), pattern: '^GO-[A-Z0-9-]+$' }, name: string(120), description: { type: 'string', maxLength: 500 }, specialty_id: { type: 'string', format: 'uuid', title: 'Especialidade', recordKind: 'specialty' }, duration_minutes: { type: 'integer', minimum: 1, maximum: 1440 } } },
        example: { code: 'GO-SRV-001', name: 'Serviço demonstrativo', description: 'Entrada administrativa; não representa protocolo ou recomendação clínica.' },
        validate: async (payload, context) => validateSpecialtyReference(payload.specialty_id, context, '/specialty_id'),
      },
      insurance_provider: {
        label: 'Convênio', initial: 'active', transitions: { active: ['inactive'], inactive: ['active'] },
        stateLabels: { active: 'Ativo', inactive: 'Inativo' }, uniqueFields: ['code'], resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        schema: { type: 'object', additionalProperties: false, required: ['code', 'name'], properties: {
          code: { ...string(32), pattern: '^GO-[A-Z0-9-]+$' }, name: string(120),
          description: { type: 'string', maxLength: 300 },
        } },
        example: { code: 'GO-CONV-001', name: 'Convênio demonstrativo' },
      },
      insurance_plan: {
        label: 'Plano de convênio', initial: 'active', transitions: { active: ['inactive'], inactive: ['active'] },
        stateLabels: { active: 'Ativo', inactive: 'Inativo' }, uniqueFields: ['code'], resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        schema: { type: 'object', additionalProperties: false, required: ['code', 'name', 'provider_id'], properties: {
          code: { ...string(32), pattern: '^GO-[A-Z0-9-]+$' }, name: string(120),
          provider_id: { type: 'string', format: 'uuid', title: 'Convênio', recordKind: 'insurance_provider' },
        } },
        example: { code: 'GO-PLANO-001', name: 'Plano demonstrativo', provider_id: '00000000-0000-4000-8000-000000000003' },
        validate: async (payload, context) => {
          const provider = await linked(context, payload.provider_id, 'insurance_provider');
          return provider?.state === 'active' ? [] : [issue('plan_provider_reference', '/provider_id', 'Selecione um convênio ativo deste mesmo espaço.')];
        },
      },
      patient_coverage: {
        label: 'Cobertura de convênio', initial: 'active', transitions: { active: ['inactive'], inactive: ['active'] },
        stateLabels: { active: 'Ativa', inactive: 'Inativa' }, resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        sensitiveFields: ['member_number'],
        schema: { type: 'object', additionalProperties: false, required: ['patient_id', 'provider_id'], properties: {
          patient_id: { type: 'string', format: 'uuid', title: 'Pessoa atendida', recordKind: 'patient' },
          provider_id: { type: 'string', format: 'uuid', title: 'Convênio', recordKind: 'insurance_provider' },
          plan_id: { type: 'string', format: 'uuid', title: 'Plano', recordKind: 'insurance_plan' },
          member_number: { type: 'string', maxLength: 80, title: 'Código do beneficiário' },
          expires_on: { type: 'string', format: 'date', title: 'Validade' },
          no_expiry: { type: 'boolean', title: 'Sem validade informada' },
          accommodation: { type: 'string', maxLength: 100, title: 'Acomodação' },
        } },
        example: { patient_id: '00000000-0000-4000-8000-000000000001', provider_id: '00000000-0000-4000-8000-000000000003' },
        validate: validateCoverageReferences,
      },
      appointment_waitlist: {
        label: 'Lista de espera', initial: 'waiting', transitions: { waiting: ['removed'], removed: [] },
        stateLabels: { waiting: 'Aguardando', removed: 'Removido' }, immutable: ['removed'], resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        schema: { type: 'object', additionalProperties: false, required: ['patient_id'], properties: {
          patient_id: { type: 'string', format: 'uuid', title: 'Pessoa atendida', recordKind: 'patient' },
        } },
        example: { patient_id: '00000000-0000-4000-8000-000000000001' },
        validate: async (payload, context) => {
          const patient = await linked(context, payload.patient_id, 'patient');
          return patient?.state === 'active' ? [] : [issue('waitlist_patient_reference', '/patient_id', 'Selecione uma pessoa atendida ativa deste mesmo espaço.')];
        },
      },
      appointment: {
        label: 'Agendamento', initial: 'scheduled', transitions: {
          scheduled: ['confirmed', 'waiting', 'no_show', 'completed', 'cancelled'],
          confirmed: ['waiting', 'no_show', 'completed', 'cancelled'],
          waiting: ['no_show', 'completed', 'cancelled'], no_show: [], completed: [], cancelled: [],
        },
        stateLabels: { scheduled: 'Agendado', confirmed: 'Confirmado', waiting: 'Aguardando atendimento', no_show: 'Não compareceu', completed: 'Paciente atendido', cancelled: 'Cancelado' },
        hiddenTransitions: ['cancelled'], immutable: ['no_show', 'completed', 'cancelled'], resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        detailActions: [{
          id: 'cancel-appointment', label: 'Cancelar agendamento', description: 'O cancelamento mantém o registro e seu histórico; não exclui o agendamento.',
          states: ['scheduled', 'confirmed', 'waiting'], permission: 'write',
          transition: {
            state: 'cancelled', confirmation: 'Confirmar o cancelamento deste agendamento?',
            reasonChoices: [
              { value: 'Desmarcado pela clínica', label: 'Desmarcado pela clínica' },
              { value: 'Desmarcado pelo paciente', label: 'Desmarcado pelo paciente' },
              { value: 'Paciente não compareceu', label: 'Paciente não compareceu' },
              { value: 'Outro motivo', label: 'Outro motivo' },
              { value: 'Não excluir', label: 'Não excluir' },
            ],
            noOpValue: 'Não excluir', noOpLabel: 'Não excluir',
          },
        }],
        sensitiveFields: ['purpose'],
        schema: { type: 'object', additionalProperties: false, required: ['patient_id', 'professional_id', 'starts_at', 'ends_at', 'purpose'], properties: {
          patient_id: { type: 'string', format: 'uuid', title: 'Pessoa atendida', recordKind: 'patient' },
          professional_id: { type: 'string', format: 'uuid', title: 'Profissional', recordKind: 'professional' },
          service_id: { type: 'string', format: 'uuid', title: 'Procedimento/serviço', recordKind: 'service_catalog' },
          insurance_provider_id: { type: 'string', format: 'uuid', title: 'Convênio', recordKind: 'insurance_provider' },
          starts_at: { type: 'string', format: 'date-time' }, ends_at: { type: 'string', format: 'date-time' }, purpose: string(160),
        } },
        example: { patient_id: '00000000-0000-4000-8000-000000000001', professional_id: '00000000-0000-4000-8000-000000000002', starts_at: '2026-12-01T13:00:00.000Z', ends_at: '2026-12-01T13:30:00.000Z', purpose: 'Atendimento administrativo demonstrativo' },
        validate: async (payload, context) => {
          const issues = [];
          const starts = typeof payload.starts_at === 'string' ? Date.parse(payload.starts_at) : NaN;
          const ends = typeof payload.ends_at === 'string' ? Date.parse(payload.ends_at) : NaN;
          if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) issues.push(issue('appointment_time_order', '/ends_at', 'O horário final deve ser posterior ao inicial.'));
          const patient = await linked(context, payload.patient_id, 'patient');
          const professional = await linked(context, payload.professional_id, 'professional');
          const service = payload.service_id === undefined ? null : await linked(context, payload.service_id, 'service_catalog');
          const provider = payload.insurance_provider_id === undefined ? null : await linked(context, payload.insurance_provider_id, 'insurance_provider');
          if (!patient || patient.state !== 'active') issues.push(issue('appointment_patient_reference', '/patient_id', 'Selecione um cadastro ativo deste mesmo espaço.'));
          if (!professional || professional.state !== 'active' || professional.payload.active_for_agenda === false) issues.push(issue('appointment_professional_reference', '/professional_id', 'Selecione um profissional ativo para agenda neste mesmo espaço.'));
          if (payload.service_id !== undefined && (!service || service.state !== 'active')) issues.push(issue('appointment_service_reference', '/service_id', 'Selecione um procedimento/serviço ativo deste mesmo espaço.'));
          if (payload.insurance_provider_id !== undefined && (!provider || provider.state !== 'active')) issues.push(issue('appointment_provider_reference', '/insurance_provider_id', 'Selecione um convênio ativo deste mesmo espaço.'));
          return issues;
        },
      },
      schedule_block: {
        label: 'Bloqueio de horário', initial: 'active', transitions: { active: ['cancelled'], cancelled: [] },
        stateLabels: { active: 'Ativo', cancelled: 'Cancelado' }, immutable: ['cancelled'], resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        sensitiveFields: ['description'],
        schema: { type: 'object', additionalProperties: false, required: ['professional_id', 'starts_at', 'ends_at'], properties: {
          professional_id: { type: 'string', format: 'uuid', title: 'Profissional', recordKind: 'professional' },
          starts_at: { type: 'string', format: 'date-time', title: 'Início' },
          ends_at: { type: 'string', format: 'date-time', title: 'Fim' },
          all_day: { type: 'boolean', title: 'Dia inteiro', default: false },
          description: { type: 'string', maxLength: 300, title: 'Descrição' },
        } },
        example: { professional_id: '00000000-0000-4000-8000-000000000002', starts_at: '2026-12-01T00:00:00.000Z', ends_at: '2026-12-02T00:00:00.000Z', all_day: true, description: 'Bloqueio demonstrativo de dia inteiro' },
        validate: async (payload, context) => {
          const issues = [];
          const starts = typeof payload.starts_at === 'string' ? Date.parse(payload.starts_at) : NaN;
          const ends = typeof payload.ends_at === 'string' ? Date.parse(payload.ends_at) : NaN;
          if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) issues.push(issue('schedule_block_time_order', '/ends_at', 'O horário final deve ser posterior ao inicial.'));
          const professional = await linked(context, payload.professional_id, 'professional');
          if (!professional || professional.state !== 'active' || professional.payload.active_for_agenda === false) issues.push(issue('schedule_block_professional_reference', '/professional_id', 'Selecione um profissional ativo para agenda neste mesmo espaço.'));
          return issues;
        },
      },
      encounter: {
        label: 'Atendimento', initial: 'in_progress', transitions: { in_progress: ['completed'], completed: [] },
        stateLabels: { in_progress: 'Em andamento', completed: 'Finalizado sem assinatura' }, immutable: ['completed'], resourceScoped: true, managePermission: 'plugin.gastro-clinic.write',
        schema: { type: 'object', additionalProperties: false, required: ['patient_id', 'professional_id'], properties: {
          patient_id: { type: 'string', format: 'uuid', title: 'Pessoa atendida', recordKind: 'patient' },
          professional_id: { type: 'string', format: 'uuid', title: 'Profissional', recordKind: 'professional' },
        } },
        example: { patient_id: '00000000-0000-4000-8000-000000000001', professional_id: '00000000-0000-4000-8000-000000000002' },
        validate: async (payload, context) => {
          const issues = [];
          const patient = await linked(context, payload.patient_id, 'patient');
          const professional = await linked(context, payload.professional_id, 'professional');
          if (!patient || patient.state !== 'active') issues.push(issue('encounter_patient_reference', '/patient_id', 'Selecione um cadastro ativo deste mesmo espaço.'));
          if (!professional || professional.state !== 'active' || professional.payload.active_for_agenda === false) issues.push(issue('encounter_professional_reference', '/professional_id', 'Selecione um profissional ativo neste mesmo espaço.'));
          return issues;
        },
      },
    },
  },
};
