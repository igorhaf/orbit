import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionRecords } from './plugins/records/records.service';
import { PluginRegistry } from './execution/registries';
import { DocumentScanner } from './plugins/records/documents';
import { gastroClinicPlugin } from './gastro-clinic.plugin';
import { isProtectedFieldEnvelope, protectRecordPayload, unprotectRecordPayload } from './data-protector';

test('Gastro clinic contribution declares patient, professional and appointment records under Orbit contracts', () => {
  assert.deepEqual(Object.keys(gastroClinicPlugin.contributions?.recordKinds || {}).sort(), ['appointment', 'appointment_waitlist', 'contact', 'encounter', 'insurance_plan', 'insurance_provider', 'patient', 'patient_coverage', 'professional', 'schedule_block', 'service_catalog', 'specialty']);
  assert.deepEqual(gastroClinicPlugin.dependencies, ['versioned-records', 'workspaces']);
  assert.equal(gastroClinicPlugin.parentPlugin, 'versioned-records');
  assert.deepEqual(gastroClinicPlugin.contributions?.calendarSources, [{ providerId: 'gastro-clinic', label: 'Agenda clínica' }]);
  assert.ok(gastroClinicPlugin.contributions?.navigation?.some(item => item.id === 'gastro-agenda' && item.href === '/calendar'));
  assert.ok(gastroClinicPlugin.contributions?.navigation?.some(item => item.id === 'gastro-appointments' && item.href === '/extensions/gastro-clinic?kind=appointment'));
  assert.ok(gastroClinicPlugin.contributions?.navigation?.some(item => item.id === 'gastro-schedule-blocks' && item.href === '/extensions/gastro-clinic?kind=schedule_block'));
  assert.ok(gastroClinicPlugin.contributions?.navigation?.some(item => item.id === 'gastro-patients' && item.href === '/extensions/gastro-clinic?kind=patient'));
  assert.equal(gastroClinicPlugin.contributions?.recordKinds?.appointment.schema.properties instanceof Object, true);
  assert.equal((gastroClinicPlugin.contributions?.recordKinds?.appointment.schema.properties as Record<string, Record<string, unknown>>).patient_id.recordKind, 'patient');
  assert.equal((gastroClinicPlugin.contributions?.recordKinds?.appointment.schema.properties as Record<string, Record<string, unknown>>).professional_id.recordKind, 'professional');
  const appointment = gastroClinicPlugin.contributions!.recordKinds!.appointment;
  assert.deepEqual(appointment.stateLabels, {
    scheduled: 'Agendado', confirmed: 'Confirmado', waiting: 'Aguardando atendimento', no_show: 'Não compareceu', completed: 'Paciente atendido', cancelled: 'Cancelado',
  });
  assert.deepEqual(appointment.hiddenTransitions, ['cancelled']);
  assert.deepEqual(appointment.detailActions?.[0].transition?.reasonChoices?.map(option => option.label), [
    'Desmarcado pela clínica', 'Desmarcado pelo paciente', 'Paciente não compareceu', 'Outro motivo', 'Não excluir',
  ]);
  assert.equal(appointment.detailActions?.[0].transition?.noOpValue, 'Não excluir');
  assert.doesNotThrow(() => new PluginRegistry().register({
    id: 'gastro-appointment-contract', name: 'Gastro appointment contract', version: '1.0.0',
    contributions: { recordKinds: { appointment } },
  }));
  const encounter = gastroClinicPlugin.contributions!.recordKinds!.encounter;
  assert.equal(encounter.initial, 'in_progress');
  assert.deepEqual(encounter.transitions, { in_progress: ['completed'], completed: [] });
  assert.deepEqual(encounter.immutable, ['completed']);
  assert.deepEqual(Object.keys(encounter.schema.properties || {}).sort(), ['patient_id', 'professional_id']);
  assert.ok(gastroClinicPlugin.contributions?.recordKinds?.patient.sensitiveFields?.includes('display_name'));
  assert.ok(gastroClinicPlugin.contributions?.recordKinds?.patient.sensitiveFields?.includes('birth_date'));
  assert.ok(gastroClinicPlugin.contributions?.recordKinds?.patient.sensitiveFields?.includes('mobile_phone'));
  assert.equal((gastroClinicPlugin.contributions?.recordKinds?.patient.schema.properties as Record<string, Record<string, unknown>>).email.format, 'email');
  const patientSchema = gastroClinicPlugin.contributions!.recordKinds!.patient.schema as Record<string, unknown>;
  const fieldGroups = patientSchema['x-orbit-field-groups'] as Array<{ id: string; fields: string[] }>;
  assert.deepEqual(fieldGroups.map(group => group.id), ['personal', 'care-team', 'complementary']);
  assert.deepEqual([...new Set(fieldGroups.flatMap(group => group.fields))].sort(), Object.keys(patientSchema.properties as Record<string, unknown>).sort());
});

test('Gastro professional records expose observed administrative identifiers without account credentials', () => {
  const professional = gastroClinicPlugin.contributions!.recordKinds!.professional;
  const properties = professional.schema.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(professional.schema.required, ['code', 'display_name', 'team']);
  for (const field of ['email', 'cpf', 'mobile_phone', 'council_number', 'rqe', 'cnes']) assert.ok(properties[field]);
  assert.equal(properties.email.format, 'email');
  assert.ok(!('password' in properties) && !('confirmPassword' in properties));
  for (const field of ['display_name', 'email', 'cpf', 'mobile_phone', 'council_number', 'rqe', 'cnes'])
    assert.ok(professional.sensitiveFields?.includes(field), `${field} is protected before storage`);
  const fieldGroups = professional.schema['x-orbit-field-groups'] as Array<{ id: string; fields: string[] }>;
  assert.deepEqual(fieldGroups.map(group => group.id), ['profile', 'credentials']);
  assert.deepEqual([...new Set(fieldGroups.flatMap(group => group.fields))].sort(), Object.keys(properties).sort());
});

test('Gastro professional identifiers are encrypted and restored with the Orbit record protection contract', () => {
  const professional = gastroClinicPlugin.contributions!.recordKinds!.professional;
  const payload = {
    code: 'GO-DEMO-P02', display_name: 'Profissional sintético', team: 'Equipe demonstrativa',
    email: 'professional@example.invalid', cpf: 'cpf-sentinel', mobile_phone: 'phone-sentinel',
    council_number: 'council-sentinel', rqe: 'rqe-sentinel', cnes: 'cnes-sentinel',
  };
  const context = { pluginId: 'gastro-clinic', kind: 'professional', recordId: 'fixture-professional', revision: 1 };
  const originalKey = process.env.ORBIT_DATA_ENCRYPTION_KEY;
  try {
    process.env.ORBIT_DATA_ENCRYPTION_KEY = 'synthetic-test-key-only';
    const stored = protectRecordPayload(payload, professional.sensitiveFields || [], context);
    for (const field of ['display_name', 'email', 'cpf', 'mobile_phone', 'council_number', 'rqe', 'cnes']) {
      assert.equal(isProtectedFieldEnvelope(stored[field]), true, `${field} is encrypted`);
      assert.equal(JSON.stringify(stored).includes(String(payload[field as keyof typeof payload])), false, `${field} is not stored in plaintext`);
    }
    assert.deepEqual(unprotectRecordPayload(stored, professional.sensitiveFields || [], context), payload);
  } finally {
    if (originalKey === undefined) delete process.env.ORBIT_DATA_ENCRYPTION_KEY;
    else process.env.ORBIT_DATA_ENCRYPTION_KEY = originalKey;
  }
});

test('Gastro auxiliary contacts follow the observed required-name and optional-email contract', () => {
  const contact = gastroClinicPlugin.contributions!.recordKinds!.contact;
  assert.deepEqual(contact.schema.required, ['name']);
  assert.equal((contact.schema.properties as Record<string, Record<string, unknown>>).email.format, 'email');
  for (const field of ['name', 'email', 'phone', 'address']) assert.ok(contact.sensitiveFields?.includes(field));
  assert.deepEqual(contact.transitions, { active: ['inactive'], inactive: ['active'] });
});

test('Gastro coverage links active same-workspace people, providers and plans without billing side effects', async () => {
  const validate = gastroClinicPlugin.contributions!.recordKinds!.patient_coverage.validate!;
  const providerId = 'provider-a';
  const context = {
    resolveLatestRecord: async (id: string) => {
      if (id === 'patient') return { id, pluginId: 'gastro-clinic', kind: 'patient', state: 'active', revision: 1, payload: {} };
      if (id === providerId) return { id, pluginId: 'gastro-clinic', kind: 'insurance_provider', state: 'active', revision: 1, payload: {} };
      if (id === 'provider-b') return { id, pluginId: 'gastro-clinic', kind: 'insurance_provider', state: 'active', revision: 1, payload: {} };
      if (id === 'plan-a') return { id, pluginId: 'gastro-clinic', kind: 'insurance_plan', state: 'active', revision: 1, payload: { provider_id: providerId } };
      if (id === 'plan-b') return { id, pluginId: 'gastro-clinic', kind: 'insurance_plan', state: 'active', revision: 1, payload: { provider_id: 'provider-b' } };
      return null;
    },
  };
  assert.deepEqual(await validate({ patient_id: 'patient', provider_id: providerId, plan_id: 'plan-a' }, context as never), []);
  const issues = await validate({ patient_id: 'patient', provider_id: providerId, plan_id: 'plan-b' }, context as never);
  assert.deepEqual(issues.map(item => item.code), ['coverage_plan_reference']);
  assert.ok(gastroClinicPlugin.contributions!.recordKinds!.patient_coverage.sensitiveFields?.includes('member_number'));
});

test('Gastro coverage rejects inactive or inaccessible patient, provider and plan references', async () => {
  const validate = gastroClinicPlugin.contributions!.recordKinds!.patient_coverage.validate!;
  const states: Record<string, { kind: string; state: string; payload?: Record<string, unknown> }> = {
    'patient-active': { kind: 'patient', state: 'active' },
    patient: { kind: 'patient', state: 'inactive' },
    provider: { kind: 'insurance_provider', state: 'active' },
    plan: { kind: 'insurance_plan', state: 'active', payload: { provider_id: 'provider' } },
    'foreign-plan': { kind: 'insurance_plan', state: 'active', payload: { provider_id: 'other-provider' } },
    'inactive-provider': { kind: 'insurance_provider', state: 'inactive' },
    'inactive-plan': { kind: 'insurance_plan', state: 'inactive', payload: { provider_id: 'provider' } },
  };
  const context = {
    resolveLatestRecord: async (id: string) => {
      const entry = states[id];
      return entry ? { id, pluginId: 'gastro-clinic', ...entry, revision: 1, payload: entry.payload || {} } : null;
    },
  };
  const valid = { patient_id: 'patient-active', provider_id: 'provider', plan_id: 'plan' };
  const inactivePatient = await validate({ ...valid, patient_id: 'patient' }, context as never);
  assert.deepEqual(inactivePatient.map(item => item.code), ['coverage_patient_reference']);
  const inactiveProvider = await validate({ ...valid, provider_id: 'inactive-provider' }, context as never);
  assert.deepEqual(inactiveProvider.map(item => item.code), ['coverage_provider_reference', 'coverage_plan_reference']);
  const invalidPlan = await validate({ ...valid, plan_id: 'foreign-plan' }, context as never);
  assert.deepEqual(invalidPlan.map(item => item.code), ['coverage_plan_reference']);
  const inactivePlan = await validate({ ...valid, plan_id: 'inactive-plan' }, context as never);
  assert.deepEqual(inactivePlan.map(item => item.code), ['coverage_plan_reference']);
  const inaccessiblePatient = await validate({ ...valid, patient_id: 'unavailable' }, context as never);
  assert.deepEqual(inaccessiblePatient.map(item => item.code), ['coverage_patient_reference']);
});

test('Gastro waitlist preserves an auditable removal transition and accepts only an active patient', async () => {
  const definition = gastroClinicPlugin.contributions!.recordKinds!.appointment_waitlist;
  assert.equal(definition.initial, 'waiting');
  assert.deepEqual(definition.transitions, { waiting: ['removed'], removed: [] });
  assert.deepEqual(definition.immutable, ['removed']);
  const validate = definition.validate!;
  const context = {
    resolveLatestRecord: async (id: string) => id === 'active'
      ? { id, pluginId: 'gastro-clinic', kind: 'patient', state: 'active', revision: 1, payload: {} }
      : id === 'inactive'
        ? { id, pluginId: 'gastro-clinic', kind: 'patient', state: 'inactive', revision: 1, payload: {} }
        : id === 'foreign'
          ? { id, pluginId: 'other-product', kind: 'patient', state: 'active', revision: 1, payload: {} }
          : null,
  };
  assert.deepEqual(await validate({ patient_id: 'active' }, context as never), []);
  for (const patient_id of ['inactive', 'foreign', 'missing']) {
    const issues = await validate({ patient_id }, context as never);
    assert.deepEqual(issues.map(item => item.code), ['waitlist_patient_reference']);
  }
});

test('Gastro ROOT simulation offers a read-only synthetic waitlist example only with read permission', () => {
  const examples = gastroClinicPlugin.contributions!.profileSimulationExamples!;
  assert.ok(examples({ permissions: ['plugin.gastro-clinic.read'] } as never).some(example => example.id === 'lista-espera-demo' && example.is_demo));
  assert.deepEqual(examples({ permissions: [] } as never), []);
});

test('Gastro encounter only accepts active same-product patient and professional references', async () => {
  const validate = gastroClinicPlugin.contributions!.recordKinds!.encounter.validate!;
  const validContext = {
    resolveLatestRecord: async (id: string) => id === 'patient'
      ? { id, pluginId: 'gastro-clinic', kind: 'patient', state: 'active', revision: 1, payload: {} }
      : { id, pluginId: 'gastro-clinic', kind: 'professional', state: 'active', revision: 1, payload: { active_for_agenda: true } },
  };
  assert.deepEqual(await validate({ patient_id: 'patient', professional_id: 'professional' }, validContext as never), []);

  const invalidContext = {
    resolveLatestRecord: async (id: string) => id === 'patient'
      ? { id, pluginId: 'other-product', kind: 'patient', state: 'active', revision: 1, payload: {} }
      : { id, pluginId: 'gastro-clinic', kind: 'professional', state: 'inactive', revision: 1, payload: {} },
  };
  const issues = await validate({ patient_id: 'patient', professional_id: 'professional' }, invalidContext as never);
  assert.deepEqual(issues.map(item => item.code).sort(), ['encounter_patient_reference', 'encounter_professional_reference']);
});

test('Gastro patient antecedents are optional protected fields and fail closed without the encryption key', () => {
  const definition = gastroClinicPlugin.contributions!.recordKinds!.patient;
  const fields = definition.sensitiveFields!;
  for (const field of ['display_name', 'civil_name', 'email', 'mobile_phone', 'birth_date', 'cpf', 'address', 'ethnicity', 'clinical_background'])
    assert.ok(fields.includes(field), `${field} is protected before storage`);
  const payload = {
    code: 'GO-DEMO-001', display_name: 'Pessoa sintética',
    birth_date: '1990-01-01', mobile_phone: 'phone-sentinel', email: 'patient@example.invalid', address: 'address-sentinel',
    clinical_background: 'marcador sintético', surgical_background: 'marcador sintético',
    family_background: 'marcador sintético', habits: 'marcador sintético',
  };
  const originalKey = process.env.ORBIT_DATA_ENCRYPTION_KEY;
  try {
    delete process.env.ORBIT_DATA_ENCRYPTION_KEY;
    assert.throws(() => protectRecordPayload(payload, fields, {
      pluginId: 'gastro-clinic', kind: 'patient', recordId: 'fixture-1', revision: 1,
    }), /Conteúdo protegido indisponível/);

    process.env.ORBIT_DATA_ENCRYPTION_KEY = 'synthetic-test-key-only';
    const context = { pluginId: 'gastro-clinic', kind: 'patient', recordId: 'fixture-1', revision: 1 };
    const stored = protectRecordPayload(payload, fields, context);
    for (const field of ['display_name', 'birth_date', 'mobile_phone', 'email', 'address', 'clinical_background', 'surgical_background', 'family_background', 'habits']) {
      assert.equal(isProtectedFieldEnvelope(stored[field]), true, `${field} is encrypted before storage`);
      assert.equal(JSON.stringify(stored).includes(String(payload[field as keyof typeof payload])), false, `${field} does not remain in plaintext`);
    }
    assert.deepEqual(unprotectRecordPayload(stored, fields, context), payload);

    const coverageDefinition = gastroClinicPlugin.contributions!.recordKinds!.patient_coverage;
    const coveragePayload = { patient_id: 'patient-1', provider_id: 'provider-1', member_number: 'member-number-sentinel' };
    const coverageContext = { pluginId: 'gastro-clinic', kind: 'patient_coverage', recordId: 'coverage-1', revision: 1 };
    const storedCoverage = protectRecordPayload(coveragePayload, coverageDefinition.sensitiveFields || [], coverageContext);
    assert.equal(isProtectedFieldEnvelope(storedCoverage.member_number), true);
    assert.equal(JSON.stringify(storedCoverage).includes(coveragePayload.member_number), false);
    assert.deepEqual(unprotectRecordPayload(storedCoverage, coverageDefinition.sensitiveFields || [], coverageContext), coveragePayload);
  } finally {
    if (originalKey === undefined) delete process.env.ORBIT_DATA_ENCRYPTION_KEY;
    else process.env.ORBIT_DATA_ENCRYPTION_KEY = originalKey;
  }
});

test('Gastro patient registration requires a valid non-future birth date and at least one phone', async () => {
  const definition = gastroClinicPlugin.contributions!.recordKinds!.patient;
  assert.ok((definition.schema.required as string[] | undefined)?.includes('birth_date'));
  const validate = definition.validate!;
  for (const birth_date of ['1990-02-30', '2099-01-01']) {
    const issues = await validate({ birth_date, mobile_phone: '000000000' }, {} as never);
    assert.ok(issues.some(item => item.path === '/birth_date'));
  }
  const noPhone = await validate({ birth_date: '1990-01-01', mobile_phone: '   ', home_phone: '', office_phone: '' }, {} as never);
  assert.deepEqual(noPhone.map(item => item.code), ['patient_contact_required']);
  const valid = await validate({ birth_date: '1990-01-01', office_phone: '000000000' }, {} as never);
  assert.deepEqual(valid, []);
});

test('Gastro appointment validation fails closed for invalid time and references outside the product domain', async () => {
  const validate = gastroClinicPlugin.contributions!.recordKinds!.appointment.validate!;
  const context = {
    resolveRecord: async () => null,
    resolveLatestRecord: async (id: string) => id === 'patient' ? { id, pluginId: 'gastro-clinic', kind: 'patient', state: 'inactive', revision: 1, payload: {} }
      : id === 'professional' ? { id, pluginId: 'other-product', kind: 'professional', state: 'active', revision: 1, payload: {} } : null,
  };
  const issues = await validate({ patient_id: 'patient', professional_id: 'professional', starts_at: '2026-12-01T13:30:00Z', ends_at: '2026-12-01T13:00:00Z', purpose: 'Demonstrativo' }, context as never);
  assert.deepEqual(issues.map(item => item.code).sort(), ['appointment_patient_reference', 'appointment_professional_reference', 'appointment_time_order'].sort());
});

test('Gastro appointment can reference active same-workspace service and insurance records without billing effects', async () => {
  const definition = gastroClinicPlugin.contributions!.recordKinds!.appointment;
  const properties = definition.schema.properties as Record<string, Record<string, unknown>>;
  assert.equal(properties.service_id.recordKind, 'service_catalog');
  assert.equal(properties.insurance_provider_id.recordKind, 'insurance_provider');
  const validate = definition.validate!;
  const context = {
    resolveLatestRecord: async (id: string) => {
      const entries: Record<string, { id: string; kind: string; state: string; pluginId: string; revision: number; payload: Record<string, unknown> }> = {
        patient: { id, pluginId: 'gastro-clinic', kind: 'patient', state: 'active', revision: 1, payload: {} },
        professional: { id, pluginId: 'gastro-clinic', kind: 'professional', state: 'active', revision: 1, payload: { active_for_agenda: true } },
        service: { id, pluginId: 'gastro-clinic', kind: 'service_catalog', state: 'active', revision: 1, payload: {} },
        provider: { id, pluginId: 'gastro-clinic', kind: 'insurance_provider', state: 'active', revision: 1, payload: {} },
        inactive: { id, pluginId: 'gastro-clinic', kind: 'service_catalog', state: 'inactive', revision: 1, payload: {} },
        foreign: { id, pluginId: 'another-product', kind: 'insurance_provider', state: 'active', revision: 1, payload: {} },
      };
      return entries[id] || null;
    },
  };
  const base = { patient_id: 'patient', professional_id: 'professional', starts_at: '2026-12-01T13:00:00Z', ends_at: '2026-12-01T13:30:00Z', purpose: 'Demonstração administrativa' };
  assert.deepEqual(await validate(base, context as never), []);
  assert.deepEqual(await validate({ ...base, service_id: 'service', insurance_provider_id: 'provider' }, context as never), []);
  const issues = await validate({ ...base, service_id: 'inactive', insurance_provider_id: 'foreign' }, context as never);
  assert.deepEqual(issues.map(item => item.code).sort(), ['appointment_provider_reference', 'appointment_service_reference']);
});

test('Gastro schedule blocks validate a positive interval and an active same-product professional', async () => {
  const validate = gastroClinicPlugin.contributions!.recordKinds!.schedule_block.validate!;
  const context = { resolveLatestRecord: async (id: string) => id === 'professional'
    ? { id, pluginId: 'gastro-clinic', kind: 'professional', state: 'active', revision: 1, payload: { active_for_agenda: true } }
    : null };
  assert.deepEqual(await validate({ professional_id: 'professional', starts_at: '2026-12-01T00:00:00.000Z', ends_at: '2026-12-02T00:00:00.000Z', all_day: true }, context as never), []);
  const invalid = await validate({ professional_id: 'missing', starts_at: '2026-12-02T00:00:00.000Z', ends_at: '2026-12-01T00:00:00.000Z' }, context as never);
  assert.deepEqual(invalid.map(item => item.code).sort(), ['schedule_block_professional_reference', 'schedule_block_time_order']);
  const definition = gastroClinicPlugin.contributions!.recordKinds!.schedule_block;
  assert.deepEqual(definition.transitions, { active: ['cancelled'], cancelled: [] });
  assert.deepEqual(definition.immutable, ['cancelled']);
});

test('Gastro administrative catalog links only to active specialties from the same product', async () => {
  const validate = gastroClinicPlugin.contributions!.recordKinds!.service_catalog.validate!;
  const issues = await validate({ code: 'GO-SRV-001', name: 'Serviço demonstrativo', specialty_id: 'external-id' }, {
    resolveLatestRecord: async () => ({ id: 'external-id', pluginId: 'other-product', kind: 'specialty', state: 'active', revision: 1, payload: {} }),
  } as never);
  assert.deepEqual(issues.map(item => item.code), ['specialty_reference']);
});

test('patient professional assignments accept only active Gastro professionals from the same workspace', async () => {
  const validate = gastroClinicPlugin.contributions!.recordKinds!.patient.validate!;
  const context = {
    resolveLatestRecord: async (id: string) => id === 'active-professional'
      ? { id, pluginId: 'gastro-clinic', kind: 'professional', state: 'active', revision: 1, payload: {} }
      : id === 'inactive-professional'
        ? { id, pluginId: 'gastro-clinic', kind: 'professional', state: 'inactive', revision: 1, payload: {} }
        : { id, pluginId: 'other-product', kind: 'professional', state: 'active', revision: 1, payload: {} },
  };
  const issues = await validate({ assigned_professional_ids: ['active-professional', 'inactive-professional', 'external-professional'], birth_date: '1990-01-01', mobile_phone: '555' }, context as never);
  assert.deepEqual(issues.map(item => item.code), ['patient_professional_reference', 'patient_professional_reference']);
});

test('Gastro home summary counts only records the current user can read', async () => {
  const workspaceId = '00000000-0000-4000-8000-000000000091';
  const rows = [
    { id: 'visible-patient', kind: 'patient', state: 'active' },
    { id: 'hidden-patient', kind: 'patient', state: 'active' },
    { id: 'visible-appointment', kind: 'appointment', state: 'scheduled' },
    { id: 'hidden-appointment', kind: 'appointment', state: 'scheduled' },
  ];
  const queryArgs: unknown[][] = [];
  const db = {
    async one() { return { id: workspaceId }; },
    async query(sql: string, args: unknown[]) {
      queryArgs.push(args);
      assert.match(sql, /WHERE workspace_id=\$1 AND plugin_id=\$2/);
      return rows;
    },
  };
  const access = { async has() { return false; } };
  const registry = new PluginRegistry();
  registry.register({ id: 'gastro-clinic', name: 'Gastro fixture', version: '1.0.0', contributions: { recordKinds: {
    patient: { label: 'Pessoa', schema: { type: 'object' }, initial: 'active', transitions: { active: [] }, example: {}, resourceScoped: true },
    appointment: { label: 'Agendamento', schema: { type: 'object' }, initial: 'scheduled', transitions: { scheduled: [] }, example: {}, resourceScoped: true },
  } } });
  const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
  const readable = new Set(['visible-patient', 'visible-appointment']);
  Object.assign(service, { async canRecord(_user: string, _plugin: string, _kind: string, recordId: string) { return readable.has(recordId); } });

  const visible = await service.summary('gastro-clinic', workspaceId, 'fixture-user');
  assert.deepEqual(visible.counts, [
    { kind: 'patient', state: 'active', count: 1 },
    { kind: 'appointment', state: 'scheduled', count: 1 },
  ]);
  assert.deepEqual(queryArgs[0], [workspaceId, 'gastro-clinic', ['patient', 'appointment']]);

  readable.clear();
  assert.deepEqual(await service.summary('gastro-clinic', workspaceId, 'fixture-user'), { counts: [] });
});
