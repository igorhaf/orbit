import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import { Pool } from 'pg';
import type { Pool as PgPool } from 'pg';
import { GastroReportsService } from './gastro-reports.plugin';

const postgresBin = '/usr/lib/postgresql/16/bin';
const workspace = '00000000-0000-4000-8000-000000000010';

test('Gastro completed-attendance report reads authorized current records in a disposable PostgreSQL 16 cluster', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-gastro-reports-'));
  const data = join(directory, 'data');
  const port = 55447;
  const run = (binary: string, args: string[]) => execFileSync(join(postgresBin, binary), args, {
    env: { PATH: '/usr/bin:/bin', LANG: 'C' }, timeout: 15000, stdio: 'pipe',
  });
  let running = false;
  let pool: PgPool | undefined;
  try {
    run('initdb', ['-D', data, '-U', userInfo().username, '-A', 'trust', '--no-locale']);
    run('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-o',
      `-k ${directory} -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700`, '-w', 'start']);
    running = true;
    const dbPool = new Pool({ host: directory, port, database: 'postgres', user: userInfo().username, max: 3, connectionTimeoutMillis: 2000 });
    pool = dbPool;
    await dbPool.query('CREATE TABLE workspaces(id uuid PRIMARY KEY,archived_at timestamptz); CREATE TABLE extension_records(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,plugin_id text NOT NULL,kind text NOT NULL,state text NOT NULL,title text NOT NULL,payload jsonb NOT NULL)');
    await dbPool.query('INSERT INTO workspaces VALUES($1,NULL),($2,NULL)', [workspace, '00000000-0000-4000-8000-000000000099']);
    const insert = async (id: string, starts_at: string, state = 'completed', space = workspace, service: string | null = null, patient: string | null = null) => {
      await dbPool.query('INSERT INTO extension_records VALUES($1,$2,\'gastro-clinic\',\'appointment\',$3,$4,$5::jsonb)',
        [id, space, state, 'Título de agendamento privado', JSON.stringify({ starts_at, service_id: service, patient_id: patient })]);
    };
    await insert('00000000-0000-4000-8000-000000000101', '2026-11-01T01:30:00+01:00', 'completed', workspace, '00000000-0000-4000-8000-000000000201');
    await insert('00000000-0000-4000-8000-000000000102', '2026-11-30T23:30:00Z');
    await insert('00000000-0000-4000-8000-000000000103', '2026-11-20T13:00:00Z', 'completed', workspace, '00000000-0000-4000-8000-000000000201');
    await insert('00000000-0000-4000-8000-000000000104', '2026-11-01T00:30:00+01:00');
    await insert('00000000-0000-4000-8000-000000000105', '2026-12-01T00:00:00Z');
    await insert('00000000-0000-4000-8000-000000000106', 'not-a-date');
    await insert('00000000-0000-4000-8000-000000000107', '2026-11-15T12:00:00Z', 'scheduled');
    await insert('00000000-0000-4000-8000-000000000108', '2026-11-15T12:00:00Z', 'completed', '00000000-0000-4000-8000-000000000099');
    await insert('00000000-0000-4000-8000-000000000109', '2026-11-22T12:00:00Z', 'no_show', workspace, null, '00000000-0000-4000-8000-000000000301');
    await dbPool.query('INSERT INTO extension_records VALUES($1,$2,\'gastro-clinic\',\'service_catalog\',\'active\',$3,$4::jsonb)',
      ['00000000-0000-4000-8000-000000000201', workspace, 'Consulta demonstrativa', '{}']);
    await dbPool.query('INSERT INTO extension_records VALUES($1,$2,\'gastro-clinic\',\'patient\',\'active\',$3,$4::jsonb)',
      ['00000000-0000-4000-8000-000000000301', workspace, 'Pessoa demonstrativa', '{}']);

    const db = {
      one: async (sql: string, values: unknown[]) => (await dbPool.query(sql, values)).rows[0] || null,
      query: async (sql: string, values: unknown[]) => (await dbPool.query(sql, values)).rows,
    };
    const access = { require: async () => undefined };
    const plugins = { isEnabled: () => true };
    const allowed = new Set([
      '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000105',
      '00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-000000000109',
      '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301',
    ]);
    const records = { detail: async (_plugin: string, id: string) => {
      if (!allowed.has(id)) throw new HttpException('denied', 403);
      const row = (await dbPool.query('SELECT * FROM extension_records WHERE id=$1', [id])).rows[0];
      if (!row) throw new HttpException('missing', 404);
      return { ...row, payload: row.payload };
    } };
    const service = new GastroReportsService(db as never, access as never, plugins as never, records as never);
    const report = await service.completedAppointments(workspace, 'actor', '2026-11-01', '2026-11-30', 'service');
    assert.equal(report.total, 2);
    assert.deepEqual(report.groups, [{ label: 'Consulta demonstrativa', count: 1 }, { label: 'Não informado', count: 1 }]);
    assert.equal(JSON.stringify(report).includes('00000000-0000-4000-8000-000000000101'), false);
    assert.equal(JSON.stringify(report).includes('Título de agendamento privado'), false);
    const all = await service.completedAppointments(workspace, 'actor', '0001-01-01', '2026-11-30', 'service', undefined, 'all');
    assert.equal(all.period_mode, 'all');
    assert.equal(all.from, null);
    assert.equal(all.total, 3);
    const absences = await service.patientAbsences(workspace, 'actor', '2026-11-01', '2026-11-30');
    assert.equal(absences.total, 1);
    assert.deepEqual(absences.groups, [{ label: 'Pessoa demonstrativa', count: 1 }]);
  } finally {
    await pool?.end().catch(() => undefined);
    if (running) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    await rm(directory, { recursive: true, force: true });
  }
});
