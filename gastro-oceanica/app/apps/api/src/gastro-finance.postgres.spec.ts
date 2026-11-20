import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { PluginRegistry } from './execution/registries';
import { GastroFinanceService, gastroFinancePlugin } from './gastro-finance.plugin';

const bindir = process.env.ORBIT_TEST_PG_BINDIR || '/usr/lib/postgresql/16/bin';
const supported = ['/initdb', '/postgres'].every(file => {
  try { execFileSync('test', ['-x', `${bindir}${file}`]); return true; } catch { return false; }
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate an ephemeral PostgreSQL port.');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForPostgres(pool: Pool, process: ChildProcess, getError: () => string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Disposable PostgreSQL exited with code ${process.exitCode}: ${getError()}`);
    try { await pool.query('SELECT 1'); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error(`Disposable PostgreSQL did not become ready: ${getError()}`);
}

test('Gastro finance enforces idempotency, serial settlement, reversal and immutable audit history in disposable PostgreSQL', { skip: !supported && 'PostgreSQL 16 binaries are unavailable; set ORBIT_TEST_PG_BINDIR to a local PostgreSQL 16 bin directory.' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-gastro-finance-'));
  const port = await freePort();
  let server: ChildProcess | undefined;
  let serverError = '';
  let pool: Pool | undefined;
  try {
    const role = process.env.USER || 'orbit_test';
    execFileSync(join(bindir, 'initdb'), ['-D', directory, '--no-locale', '--encoding=UTF8', '--auth=trust', `--username=${role}`], { stdio: 'ignore' });
    server = spawn(join(bindir, 'postgres'), ['-D', directory, '-h', '127.0.0.1', '-p', String(port), '-F', '-c', 'listen_addresses=127.0.0.1', '-c', `unix_socket_directories=${directory}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    server.stderr?.on('data', chunk => { serverError = (serverError + String(chunk)).slice(-2000); });
    pool = new Pool({ connectionString: `postgresql://${encodeURIComponent(role)}@127.0.0.1:${port}/postgres`, connectionTimeoutMillis: 500 });
    await waitForPostgres(pool, server, () => serverError.trim());
    await pool.query('CREATE TABLE users(id uuid PRIMARY KEY,name text NOT NULL); CREATE TABLE workspaces(id uuid PRIMARY KEY,archived_at timestamptz);');
    await pool.query(await readFile(join(__dirname, '../sql/migrations/301_gastro_finance.sql'), 'utf8'));

    const actor = randomUUID(), workspace = randomUUID(), otherWorkspace = randomUUID();
    await pool.query('INSERT INTO users(id,name) VALUES($1,$2)', [actor, 'Conta sintética']);
    await pool.query('INSERT INTO workspaces(id) VALUES($1),($2)', [workspace, otherWorkspace]);
    const plugins = new PluginRegistry();
    plugins.register({ id: 'workspaces', name: 'Workspaces', version: '1.0.0' });
    plugins.register({ id: 'versioned-records', name: 'Registros versionados', version: '1.0.0' });
    plugins.register({ id: 'gastro-clinic', name: 'Gestão clínica', version: '1.0.0', dependencies: ['versioned-records', 'workspaces'] });
    plugins.register(gastroFinancePlugin);
    const permissionCalls: string[] = [];
    const db = { pool, one: async (sql: string, params: unknown[] = []) => (await pool!.query(sql, params)).rows[0] ?? null, query: async (sql: string, params: unknown[] = []) => (await pool!.query(sql, params)).rows };
    const access = { require: async (_user: string, permission: string) => { permissionCalls.push(permission); }, audit: async () => undefined };
    const finance = new GastroFinanceService(db as never, access as never, plugins);

    const operationKey = randomUUID();
    const receivable = await finance.createEntry(workspace, actor, { direction: 'receivable', category: 'service', amount_minor: 10_000, due_on: '2026-12-15', operation_key: operationKey }) as { id: string; balance_minor: string; replayed: boolean };
    assert.equal(receivable.balance_minor, '10000');
    assert.equal(receivable.replayed, false);
    assert.equal((await finance.createEntry(workspace, actor, { direction: 'receivable', category: 'service', amount_minor: 10_000, due_on: '2026-12-15', operation_key: operationKey }) as { id: string; replayed: boolean }).id, receivable.id);
    await assert.rejects(() => finance.createEntry(workspace, actor, { direction: 'receivable', category: 'service', amount_minor: 9_000, operation_key: operationKey }), /chave de operação/i);

    const settlementKeyA = randomUUID(), settlementKeyB = randomUUID();
    const settlements = await Promise.allSettled([
      finance.settle(workspace, actor, receivable.id, { amount_minor: 7_000, method: 'pix', operation_key: settlementKeyA }),
      finance.settle(workspace, actor, receivable.id, { amount_minor: 7_000, method: 'pix', operation_key: settlementKeyB }),
    ]);
    assert.equal(settlements.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(settlements.filter(result => result.status === 'rejected').length, 1);
    const firstSettlement = settlements.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<{ movement_id: string; entry: { status: string; balance_minor: string } }>;
    const successfulKey = settlements[0]?.status === 'fulfilled' ? settlementKeyA : settlementKeyB;
    assert.equal(firstSettlement.value.entry.status, 'partial');
    assert.equal(firstSettlement.value.entry.balance_minor, '3000');
    assert.equal((await finance.settle(workspace, actor, receivable.id, { amount_minor: 7_000, method: 'pix', operation_key: successfulKey })).replayed, true);

    const finalSettlement = await finance.settle(workspace, actor, receivable.id, { amount_minor: 3_000, method: 'cash', operation_key: randomUUID() });
    assert.equal(finalSettlement.entry.status, 'settled');
    assert.equal(finalSettlement.entry.balance_minor, '0');
    const reversalKey = randomUUID();
    assert.equal((await finance.reverse(workspace, actor, firstSettlement.value.movement_id, { reason: 'entered_in_error', operation_key: reversalKey })).replayed, false);
    assert.equal((await finance.reverse(workspace, actor, firstSettlement.value.movement_id, { reason: 'entered_in_error', operation_key: reversalKey })).replayed, true);
    const afterReversal = (await finance.entries(workspace, actor, 'all', 'partial'))[0] as { id: string; balance_minor: string; status: string };
    assert.equal(afterReversal.id, receivable.id);
    assert.equal(afterReversal.balance_minor, '7000');
    await assert.rejects(() => finance.reverse(workspace, actor, firstSettlement.value.movement_id, { reason: 'entered_in_error', operation_key: randomUUID() }), /já foi estornada/i);
    await assert.rejects(() => finance.voidEntry(workspace, actor, receivable.id), /histórico financeiro/i);

    const untouched = await finance.createEntry(workspace, actor, { direction: 'payable', category: 'supplies', amount_minor: 4_250, operation_key: randomUUID() }) as { id: string; status: string };
    assert.equal((await finance.voidEntry(workspace, actor, untouched.id)).status, 'void');
    await assert.rejects(() => finance.settle(otherWorkspace, actor, receivable.id, { amount_minor: 1, method: 'pix', operation_key: randomUUID() }), /não encontrado neste workspace/i);
    assert.ok(permissionCalls.includes('plugin.gastro-finance.read'));
    assert.ok(permissionCalls.includes('plugin.gastro-finance.write'));
    const history = await finance.movements(workspace, actor);
    assert.equal(history.length, 3);
    await assert.rejects(() => pool!.query('UPDATE gastro_finance_movements SET amount_minor=0'));
    await assert.rejects(() => pool!.query('DELETE FROM gastro_finance_movements'));
    await assert.rejects(() => pool!.query("UPDATE gastro_finance_entries SET status='void' WHERE id=$1", [receivable.id]));
  } finally {
    await pool?.end();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise<void>(resolve => server!.once('exit', () => resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
