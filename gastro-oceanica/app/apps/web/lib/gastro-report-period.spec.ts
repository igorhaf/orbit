import assert from 'node:assert/strict';
import test from 'node:test';
import { reportDateRange } from './gastro-report-period';

test('report presets use UTC dates and include today', () => {
  const now = new Date('2026-11-18T23:50:00-03:00');
  assert.deepEqual(reportDateRange('today', now), { from: '2026-11-19', through: '2026-11-19', periodMode: 'range' });
  assert.deepEqual(reportDateRange('last7', now), { from: '2026-11-13', through: '2026-11-19', periodMode: 'range' });
  assert.deepEqual(reportDateRange('week', now), { from: '2026-11-16', through: '2026-11-19', periodMode: 'range' });
  assert.deepEqual(reportDateRange('month', now), { from: '2026-11-01', through: '2026-11-19', periodMode: 'range' });
  assert.deepEqual(reportDateRange('last30', now), { from: '2026-10-21', through: '2026-11-19', periodMode: 'range' });
  assert.deepEqual(reportDateRange('all', now), { from: '0001-01-01', through: '2026-11-19', periodMode: 'all' });
  assert.equal(reportDateRange('custom', now), null);
});
