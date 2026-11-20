import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import { GastroReportsService, gastroReportsPlugin } from './gastro-reports.plugin';

const workspace = '00000000-0000-4000-8000-000000000010';
const record = (id: string, kind: string, title: string, payload: Record<string, unknown>, state = 'active', workspaceId = workspace) =>
  ({ id, workspace_id: workspaceId, kind, title, payload, state });

function fixture(options: { rows?: Array<{ id: string; appointment_at: string }>; details?: Record<string, ReturnType<typeof record>>; denied?: string[]; enabled?: boolean; permissionDeniedAt?: number } = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const permissions: unknown[][] = [];
  const db = {
    one: async () => ({ id: workspace }),
    query: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); return options.rows || []; },
  };
  let checks = 0;
  const access = { require: async (...args: unknown[]) => { permissions.push(args); checks += 1; if (options.permissionDeniedAt === checks) throw new HttpException('denied', 403); } };
  const plugins = { isEnabled: () => options.enabled !== false };
  const records = { detail: async (_plugin: string, id: string) => {
    if (options.denied?.includes(id)) throw new HttpException('denied', 403);
    const found = options.details?.[id];
    if (!found) throw new HttpException('missing', 404);
    return found;
  } };
  return { service: new GastroReportsService(db as never, access as never, plugins as never, records as never), calls, permissions, checks };
}

test('gastro reports is a child read capability with a read-only demonstration fixture', () => {
  assert.equal(gastroReportsPlugin.parentPlugin, 'gastro-clinic');
  assert.deepEqual(gastroReportsPlugin.dependencies, ['gastro-clinic']);
  assert.ok(gastroReportsPlugin.handlesRoute?.('/gastro-reports/workspaces/x/completed-appointments'));
  const examples = gastroReportsPlugin.contributions?.profileSimulationExamples?.({ permissions: ['plugin.gastro-reports.read'] } as never) || [];
  assert.equal(examples.length, 1);
  assert.equal(examples[0]?.is_demo, true);
});

test('completed appointments aggregate only authorized records and never return record ids or patient data', async () => {
  const date = '2026-11-20T13:00:00.000Z';
  const { service, calls, permissions } = fixture({
    rows: [{ id: 'appointment-a', appointment_at: date }, { id: 'appointment-denied', appointment_at: date }],
    denied: ['appointment-denied'],
    details: {
      'appointment-a': record('appointment-a', 'appointment', 'Private appointment title', { starts_at: date, professional_id: 'professional-a', service_id: 'service-a', insurance_provider_id: 'provider-a' }, 'completed'),
      'professional-a': record('professional-a', 'professional', 'Profissional sintético', {}),
      'service-a': record('service-a', 'service_catalog', 'Consulta demonstrativa', {}),
      'provider-a': record('provider-a', 'insurance_provider', 'Convênio demonstrativo', {}),
    },
  });
  const result = await service.completedAppointments(workspace, 'actor', '2026-11-01', '2026-11-30', 'service');
  assert.deepEqual(result.groups, [{ label: 'Consulta demonstrativa', count: 1 }]);
  assert.equal(result.total, 1);
  assert.equal(result.report_type, 'completed');
  assert.deepEqual(Object.keys(result).sort(), ['from', 'generated_at', 'group_by', 'groups', 'period_mode', 'report_type', 'subgroup_by', 'through', 'total']);
  assert.equal(JSON.stringify(result).includes('appointment-a'), false);
  assert.equal(JSON.stringify(result).includes('Private appointment title'), false);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /state=\$4/);
  assert.equal(calls[0]!.values[0], workspace);
  assert.equal(calls[0]!.values[1], '2026-11-01T00:00:00.000Z');
  assert.equal(calls[0]!.values[2], '2026-12-01T00:00:00.000Z');
  assert.equal(calls[0]!.values[3], 'completed');
  assert.equal(permissions.length, 2);
  assert.ok(permissions.every(args => args[1] === 'plugin.gastro-reports.read' && args[2] === 'workspace' && args[3] === workspace));
});

test('appointments and linked labels are constrained to the requested workspace and record kinds', async () => {
  const date = '2026-11-20T13:00:00.000Z';
  const { service } = fixture({
    rows: [{ id: 'appointment-a', appointment_at: date }],
    details: {
      'appointment-a': record('appointment-a', 'appointment', 'Demo', { starts_at: date, professional_id: 'foreign-professional' }, 'completed'),
      'foreign-professional': record('foreign-professional', 'professional', 'Nome de outro workspace', {}, 'active', '00000000-0000-4000-8000-000000000099'),
    },
  });
  const result = await service.completedAppointments(workspace, 'actor', '2026-11-20', '2026-11-20', 'professional');
  assert.deepEqual(result.groups, [{ label: 'Referência sem acesso', count: 1 }]);
  assert.equal(JSON.stringify(result).includes('Nome de outro workspace'), false);
});

test('all four primary groupers and their twelve distinct subgroups aggregate authorized references without exposing IDs', async () => {
  const date = '2026-11-20T13:00:00.000Z';
  const { service } = fixture({
    rows: [{ id: 'appointment-a', appointment_at: date }],
    details: {
      'appointment-a': record('appointment-a', 'appointment', 'Private title', {
        starts_at: date, patient_id: 'patient-a', insurance_provider_id: 'provider-a', service_id: 'service-a', professional_id: 'professional-a',
      }, 'completed'),
      'patient-a': record('patient-a', 'patient', 'Pessoa sintética', {}),
      'provider-a': record('provider-a', 'insurance_provider', 'Convênio sintético', {}),
      'service-a': record('service-a', 'service_catalog', 'Procedimento sintético', {}),
      'professional-a': record('professional-a', 'professional', 'Profissional sintético', {}),
    },
  });
  const categories = ['patient', 'insurance', 'service', 'professional'] as const;
  let combinations = 0;
  for (const primary of categories) for (const secondary of categories) {
    if (primary === secondary) continue;
    const result = await service.completedAppointments(workspace, 'actor', '2026-11-20', '2026-11-20', primary, secondary);
    assert.equal(result.group_by, primary);
    assert.equal(result.subgroup_by, secondary);
    assert.equal(result.total, 1);
    assert.equal(result.groups[0]?.count, 1);
    assert.equal(result.groups[0]?.subgroups?.[0]?.count, 1);
    assert.equal(JSON.stringify(result).includes('patient-a'), false);
    assert.equal(JSON.stringify(result).includes('appointment-a'), false);
    combinations += 1;
  }
  assert.equal(combinations, 12);
});

test('patient grouping reveals the patient title only after record-level authorization', async () => {
  const date = '2026-11-20T13:00:00.000Z';
  const unauthorized = fixture({
    rows: [{ id: 'appointment-a', appointment_at: date }],
    denied: ['patient-a'],
    details: {
      'appointment-a': record('appointment-a', 'appointment', 'Private title', { starts_at: date, patient_id: 'patient-a' }, 'completed'),
      'patient-a': record('patient-a', 'patient', 'Pessoa cujo acesso foi negado', {}),
    },
  });
  const result = await unauthorized.service.completedAppointments(workspace, 'actor', '2026-11-20', '2026-11-20', 'patient');
  assert.deepEqual(result.groups, [{ label: 'Referência sem acesso', count: 1 }]);
  assert.equal(JSON.stringify(result).includes('Pessoa cujo acesso foi negado'), false);
});

test('patient absence report includes only current no-show transitions and authorized patient labels', async () => {
  const date = '2026-11-20T13:00:00.000Z';
  const { service, calls } = fixture({
    rows: [{ id: 'absence-a', appointment_at: date }],
    details: {
      'absence-a': record('absence-a', 'appointment', 'Private appointment', { starts_at: date, patient_id: 'patient-a' }, 'no_show'),
      'patient-a': record('patient-a', 'patient', 'Pessoa sintética', {}),
    },
  });
  const result = await service.patientAbsences(workspace, 'actor', '2026-11-14', '2026-11-20');
  assert.equal(result.report_type, 'patient_absences');
  assert.equal(result.group_by, 'patient');
  assert.deepEqual(result.groups, [{ label: 'Pessoa sintética', count: 1 }]);
  assert.equal(calls[0]?.values[3], 'no_show');
  assert.equal(JSON.stringify(result).includes('patient-a'), false);
  assert.equal(JSON.stringify(result).includes('absence-a'), false);
});

test('period and group filters fail closed and disabled dependencies block the report', async () => {
  const { service } = fixture();
  await assert.rejects(service.completedAppointments(workspace, 'actor', '2026-02-30', '2026-03-01', 'service'), /período válido/);
  await assert.rejects(service.completedAppointments(workspace, 'actor', '2026-02-02', '2026-02-01', 'service'), /período válido/);
  await assert.rejects(service.completedAppointments(workspace, 'actor', '2025-01-01', '2026-01-02', 'service'), /366 dias/);
  const all = await service.completedAppointments(workspace, 'actor', '0001-01-01', '2026-11-30', 'service', undefined, 'all');
  assert.equal(all.from, null);
  assert.equal(all.period_mode, 'all');
  await assert.rejects(service.completedAppointments(workspace, 'actor', '1900-01-01', '2026-11-30', 'service', undefined, 'all'), /início de histórico/);
  await assert.rejects(service.completedAppointments(workspace, 'actor', '0001-01-01', '2026-11-30', 'service', undefined, 'weekly'), /Tipo de período/);
  await assert.rejects(service.completedAppointments(workspace, 'actor', '2026-11-01', '2026-11-30', 'cid'), /Agrupamento de relatório inválido/);
  await assert.rejects(service.completedAppointments(workspace, 'actor', '2026-11-01', '2026-11-30', 'patient', 'patient'), /precisam ser diferentes/);
  const disabled = fixture({ enabled: false });
  await assert.rejects(disabled.service.completedAppointments(workspace, 'actor', '2026-11-01', '2026-11-30', 'service'), /plugin de relatórios/);
  assert.equal(disabled.calls.length, 0);
});

test('full-range report fails instead of returning a partial result above the cap', async () => {
  const tooMany = fixture({ rows: Array.from({ length: 5_001 }, (_, index) => ({ id: `appointment-${index}`, appointment_at: '2026-11-20T13:00:00.000Z' })) });
  await assert.rejects(tooMany.service.completedAppointments(workspace, 'actor', '0001-01-01', '2026-11-30', 'service', undefined, 'all'), error => error instanceof HttpException && error.getStatus() === 413);
});

test('workspace report permission is required before querying and checked again before returning', async () => {
  const deniedBeforeRead = fixture({ permissionDeniedAt: 1 });
  await assert.rejects(deniedBeforeRead.service.completedAppointments(workspace, 'actor', '2026-11-01', '2026-11-30', 'service'), /denied/);
  assert.equal(deniedBeforeRead.calls.length, 0);

  const deniedBeforeReturn = fixture({
    permissionDeniedAt: 2,
    rows: [{ id: 'appointment-a', appointment_at: '2026-11-20T13:00:00.000Z' }],
    details: { 'appointment-a': record('appointment-a', 'appointment', 'Do not return', { starts_at: '2026-11-20T13:00:00.000Z', service_id: null }, 'completed') },
  });
  await assert.rejects(deniedBeforeReturn.service.completedAppointments(workspace, 'actor', '2026-11-01', '2026-11-30', 'service'), /denied/);
});
