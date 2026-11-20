import test from 'node:test';
import assert from 'node:assert/strict';
import { GastroClinicCalendarSource } from './gastro-clinic-calendar';

test('clinic calendar emits authorized generic read-only appointments without patient or purpose data', async () => {
  const db = { one: async () => ({ id: '00000000-0000-4000-8000-000000000010' }) };
  const calls: unknown[][] = [];
  const records = {
    calendarWindow: async (...args: unknown[]) => {
      calls.push(args);
      return args[1] === 'schedule_block' ? [
        { id: 'block-1', workspaceId: 'workspace-1', state: 'active', start: '2026-12-01T00:00:00.000Z', end: '2026-12-02T00:00:00.000Z', allDay: true },
        { id: 'block-2', workspaceId: 'workspace-1', state: 'cancelled', start: '2026-12-01T08:00:00.000Z', end: '2026-12-01T09:00:00.000Z', allDay: false },
      ] : [
        { id: 'appointment-1', workspaceId: 'workspace-1', state: 'scheduled', start: '2026-12-01T13:00:00.000Z', end: '2026-12-01T13:30:00.000Z' },
        { id: 'appointment-2', workspaceId: 'workspace-1', state: 'cancelled', start: '2026-12-01T14:00:00.000Z', end: '2026-12-01T14:30:00.000Z' },
      ];
    },
  };
  const source = new GastroClinicCalendarSource(db as never, records as never);
  const [calendar] = await source.listSources('actor-1');
  const items = await source.listItems('actor-1', [calendar.id], new Date('2026-12-01T00:00:00Z'), new Date('2026-12-02T00:00:00Z'));

  assert.equal(items.length, 2);
  assert.deepEqual(calls.map(call => [call[1], call[5], call[6], call[7] ?? null]), [
    ['appointment', 'starts_at', 'ends_at', null], ['schedule_block', 'starts_at', 'ends_at', 'all_day'],
  ]);
  assert.deepEqual(items.map(item => item.title), ['Bloqueio de horário', 'Agendamento']);
  assert.equal(items[0].allDay, true);
  assert.equal(items[0].externalResourceId, 'block-1');
  assert.deepEqual(items[0].metadata, { product: 'gastro-oceanica', recordKind: 'schedule_block' });
  assert.equal(items[1].resourceType, 'event');
  assert.equal(items[1].start, '2026-12-01T13:00:00.000Z');
  assert.equal(items[1].externalResourceId, 'appointment-1');
  assert.deepEqual(items[1].metadata, { product: 'gastro-oceanica', recordKind: 'appointment' });
  for (const item of items) {
    assert.equal(Object.hasOwn(item, 'attendees'), false);
    assert.equal(Object.hasOwn(item, 'patient_id'), false);
    assert.equal(Object.hasOwn(item, 'purpose'), false);
  }
});
