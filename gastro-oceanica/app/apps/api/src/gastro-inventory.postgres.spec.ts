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
import { GastroInventoryService, gastroInventoryPlugin } from './gastro-inventory.plugin';

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

test('Gastro inventory preserves atomic balances, idempotency, lot rules and immutable history in disposable PostgreSQL', { skip: !supported && 'PostgreSQL 16 binaries are unavailable; set ORBIT_TEST_PG_BINDIR to a local PostgreSQL 16 bin directory.' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-gastro-inventory-'));
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
    await pool.query(await readFile(join(__dirname, '../sql/migrations/300_gastro_inventory.sql'), 'utf8'));

    const actor = randomUUID(), workspace = randomUUID();
    await pool.query('INSERT INTO users(id,name) VALUES($1,$2)', [actor, 'Conta sintética']);
    await pool.query('INSERT INTO workspaces(id) VALUES($1)', [workspace]);
    const plugins = new PluginRegistry();
    plugins.register({ id: 'versioned-records', name: 'Registros versionados', version: '1.0.0' });
    plugins.register({ id: 'workspaces', name: 'Workspaces', version: '1.0.0' });
    plugins.register({ id: 'gastro-clinic', name: 'Gestão clínica', version: '1.0.0', dependencies: ['versioned-records', 'workspaces'] });
    plugins.register(gastroInventoryPlugin);
    const db = { pool, one: async (sql: string, params: unknown[] = []) => (await pool!.query(sql, params)).rows[0] ?? null, query: async (sql: string, params: unknown[] = []) => (await pool!.query(sql, params)).rows };
    const access = { require: async () => undefined, audit: async () => undefined };
    const inventory = new GastroInventoryService(db as never, access as never, plugins);

    const regular = await inventory.createProduct(workspace, actor, { code: 'KIT-01', name: 'Kit sintético', unit: 'unidade' }) as { id: string };
    const operation = randomUUID();
    const first = await inventory.move(workspace, actor, { product_id: regular.id, direction: 'entry', quantity: 3, operation_key: operation });
    const replay = await inventory.move(workspace, actor, { product_id: regular.id, direction: 'entry', quantity: 3, operation_key: operation }) as { replayed?: boolean; id: string };
    assert.equal(replay.id, first.id);
    assert.equal(replay.replayed, true);
    await assert.rejects(() => inventory.move(workspace, actor, { product_id: regular.id, direction: 'entry', quantity: 2, operation_key: operation }), /chave da operação/i);

    const exits = await Promise.allSettled([
      inventory.move(workspace, actor, { product_id: regular.id, direction: 'exit', quantity: 2, operation_key: randomUUID() }),
      inventory.move(workspace, actor, { product_id: regular.id, direction: 'exit', quantity: 2, operation_key: randomUUID() }),
    ]);
    assert.equal(exits.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(exits.filter(result => result.status === 'rejected').length, 1);
    assert.equal(Number((await pool.query('SELECT current_balance FROM gastro_inventory_products WHERE id=$1', [regular.id])).rows[0].current_balance), 1);

    const lotProduct = await inventory.createProduct(workspace, actor, { name: 'Produto por lote', unit: 'frasco', tracks_lots: true }) as { id: string };
    await assert.rejects(() => inventory.move(workspace, actor, { product_id: lotProduct.id, direction: 'entry', quantity: 2, operation_key: randomUUID() }), /lote/i);
    const expires = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    await inventory.move(workspace, actor, { product_id: lotProduct.id, direction: 'entry', quantity: 4, lot_code: 'LOTE-001', expires_on: expires, operation_key: randomUUID() });
    const lots = await inventory.lots(lotProduct.id, actor) as Array<{ id: string; current_balance: number }>;
    assert.equal(lots.length, 1);
    assert.equal(Number(lots[0].current_balance), 4);
    await inventory.move(workspace, actor, { product_id: lotProduct.id, direction: 'exit', quantity: 1, lot_id: lots[0].id, operation_key: randomUUID() });
    assert.equal(Number((await pool.query('SELECT current_balance FROM gastro_inventory_products WHERE id=$1', [lotProduct.id])).rows[0].current_balance), 3);
    await assert.rejects(() => inventory.archiveProduct(lotProduct.id, actor), /saldo/i);

    const history = await inventory.movements(workspace, actor) as Array<{ product_name: string }>;
    assert.ok(history.some(item => item.product_name === 'Produto por lote'));
    await assert.rejects(() => pool!.query('UPDATE gastro_inventory_movements SET quantity=0'));
    await inventory.move(workspace, actor, { product_id: regular.id, direction: 'exit', quantity: 1, operation_key: randomUUID() });
    await inventory.archiveProduct(regular.id, actor);
    assert.equal((await inventory.movements(workspace, actor) as Array<{ id: string }>).length, 5);
  } finally {
    await pool?.end();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise<void>(resolve => server!.once('exit', () => resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
