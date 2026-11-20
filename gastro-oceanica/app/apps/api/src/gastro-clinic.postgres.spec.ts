import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { Db } from './db';
import { AccessService } from './access/access';
import { migrateVersions } from './migrations';
import { PluginRegistry } from './execution/registries';
import { WorkspacesService, workspacesPlugin } from './workspaces/workspaces.plugin';
import { genericPlugins } from './plugins/records/catalog';
import { ExtensionRecords } from './plugins/records/records.service';
import { DocumentScanner } from './plugins/records/documents';
import { gastroClinicPlugin } from './gastro-clinic.plugin';
import { isProtectedFieldEnvelope } from './data-protector';

const bindir = process.env.ORBIT_TEST_PG_BINDIR || '/usr/lib/postgresql/16/bin';
const supported = ['/initdb', '/postgres'].every(file => {
  try { execFileSync('test', ['-x', `${bindir}${file}`]); return true; } catch { return false; }
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate an ephemeral PostgreSQL port.');
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return address.port;
}

test('Gastro coverage and waitlist persist with workspace authorization and protected beneficiary number in disposable PostgreSQL', { skip: !supported && 'PostgreSQL 16 binaries are unavailable; set ORBIT_TEST_PG_BINDIR to a local PostgreSQL 16 bin directory.', timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-gastro-clinic-'));
  const port = await freePort();
  let server: ChildProcess | undefined;
  let serverError = '';
  let pool: Pool | undefined;
  const previousKey = process.env.ORBIT_DATA_ENCRYPTION_KEY;
  try {
    const role = process.env.USER || 'orbit_test';
    execFileSync(join(bindir, 'initdb'), ['-D', directory, '--no-locale', '--encoding=UTF8', '--auth=trust', `--username=${role}`], { stdio: 'ignore' });
    server = spawn(join(bindir, 'postgres'), ['-D', directory, '-h', '127.0.0.1', '-p', String(port), '-F', '-c', 'listen_addresses=127.0.0.1', '-c', `unix_socket_directories=${directory}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    server.stderr?.on('data', chunk => { serverError = (serverError + String(chunk)).slice(-2000); });
    pool = new Pool({ connectionString: `postgresql://${encodeURIComponent(role)}@127.0.0.1:${port}/postgres`, connectionTimeoutMillis: 500 });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`Disposable PostgreSQL exited with code ${server.exitCode}: ${serverError.trim()}`);
      try { await pool.query('SELECT 1'); break; } catch { await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
    }
    await pool.query(await readFile(resolve(__dirname, '../sql/schema.sql'), 'utf8'));
    await pool.query(await readFile(resolve(__dirname, '../sql/pre-022-compat.sql'), 'utf8'));
    await migrateVersions(pool);

    const owner = randomUUID(), workspace = randomUUID(), otherWorkspace = randomUUID();
    await pool.query('INSERT INTO users(id,name,email,password_hash,is_root) VALUES($1,$2,$3,$4,true)', [owner, 'Conta sintética', `${owner}@example.test`, 'not-a-login']);
    await pool.query('INSERT INTO workspaces(id,name,owner_id) VALUES($1,$2,$3),($4,$5,$3)', [workspace, 'Clínica sintética', owner, otherWorkspace, 'Outro espaço sintético']);
    await pool.query('INSERT INTO workspace_members(workspace_id,user_id) VALUES($1,$2),($3,$2)', [workspace, owner, otherWorkspace]);

    const db = new Db();
    await db.pool.end();
    db.pool = pool;
    const registry = new PluginRegistry();
    registry.register(workspacesPlugin);
    for (const plugin of genericPlugins) registry.register(plugin);
    registry.register(gastroClinicPlugin);
    const access = new AccessService(db);
    access.registerPlugins(registry.list());
    await new WorkspacesService(db, access).onModuleInit();
    const records = new ExtensionRecords(db, access, registry, new DocumentScanner());
    records.onModuleInit();

    process.env.ORBIT_DATA_ENCRYPTION_KEY = 'synthetic-gastro-clinic-test-key';
    const create = (space: string, kind: string, title: string, payload: Record<string, unknown>) => records.create('gastro-clinic', space, owner, {
      kind, title, payload, operation_key: randomUUID(),
    }) as Promise<{ id: string; revision: number }>;

    const patient = await create(workspace, 'patient', 'Paciente sintético', {
      code: 'GO-TEST-001', display_name: 'Paciente Sintético', birth_date: '1990-01-01', mobile_phone: '0000000000',
    });
    const provider = await create(workspace, 'insurance_provider', 'Convênio sintético', { code: 'GO-TEST-CONV-001', name: 'Convênio Sintético' });
    const plan = await create(workspace, 'insurance_plan', 'Plano sintético', { code: 'GO-TEST-PLAN-001', name: 'Plano Sintético', provider_id: provider.id });
    const coverage = await create(workspace, 'patient_coverage', 'Cobertura sintética', {
      patient_id: patient.id, provider_id: provider.id, plan_id: plan.id, member_number: 'MEMBER-SENTINEL-001',
    });
    const storedCoverage = await pool.query<{ payload: Record<string, unknown> }>('SELECT payload FROM extension_record_versions WHERE record_id=$1 AND revision=$2', [coverage.id, coverage.revision]);
    assert.equal(isProtectedFieldEnvelope(storedCoverage.rows[0]?.payload.member_number), true);
    assert.equal(JSON.stringify(storedCoverage.rows[0]?.payload).includes('MEMBER-SENTINEL-001'), false);

    await assert.rejects(() => create(otherWorkspace, 'patient_coverage', 'Vínculo entre espaços', {
      patient_id: patient.id, provider_id: provider.id,
    }), /referência|espaço|workspace/i);

    const waiting = await create(workspace, 'appointment_waitlist', 'Espera sintética', { patient_id: patient.id });
    await records.transition('gastro-clinic', waiting.id, owner, {
      state: 'removed', expected_revision: waiting.revision, reason: 'Remoção solicitada no fluxo administrativo.', operation_key: randomUUID(),
    });
    const history = await pool.query<{ state: string }>('SELECT state FROM extension_record_versions WHERE record_id=$1 ORDER BY revision', [waiting.id]);
    assert.deepEqual(history.rows.map(row => row.state), ['waiting', 'removed']);
  } finally {
    if (previousKey === undefined) delete process.env.ORBIT_DATA_ENCRYPTION_KEY;
    else process.env.ORBIT_DATA_ENCRYPTION_KEY = previousKey;
    await pool?.end();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise<void>(resolveExit => server!.once('exit', () => resolveExit()));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
