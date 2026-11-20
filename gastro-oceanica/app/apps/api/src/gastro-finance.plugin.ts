import { createHash } from 'node:crypto';
import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Query, Req } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AccessService, id } from './access/access';
import type { AccessRequest } from './access/access';
import { Db } from './db';
import { PluginRegistry } from './execution/registries';
import type { PluginDefinition } from './plugins/contract';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxAmountMinor = 99_999_999_999_999;
const categories = ['service', 'supplies', 'facility', 'staff', 'utilities', 'other'] as const;
const methods = ['cash', 'pix', 'bank_transfer', 'card', 'other'] as const;
const reversalReasons = ['duplicate', 'entered_in_error', 'refund', 'other'] as const;
type EntryDirection = 'receivable' | 'payable';
type EntryCategory = typeof categories[number];
type SettlementMethod = typeof methods[number];
type ReversalReason = typeof reversalReasons[number];
type EntryInput = { direction?: unknown; category?: unknown; amount_minor?: unknown; due_on?: unknown; operation_key?: unknown };
type SettlementInput = { amount_minor?: unknown; method?: unknown; operation_key?: unknown };
type ReversalInput = { reason?: unknown; operation_key?: unknown };
type EntryRow = { id: string; workspace_id: string; direction: EntryDirection; category: EntryCategory; amount_minor: string; settled_minor: string; balance_minor: string; currency: 'BRL'; due_on: string | null; status: 'open' | 'partial' | 'settled' | 'void'; created_by: string; created_at: string };

const fail = (message: string, status = 400): never => { throw new HttpException(message, status); };
const fingerprint = (value: Record<string, unknown>) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const entryProjection = `SELECT e.id,e.workspace_id,e.direction,e.category,e.amount_minor::text,
    COALESCE(SUM(CASE WHEN m.movement_type='settlement' THEN m.amount_minor ELSE -m.amount_minor END),0)::text AS settled_minor,
    (e.amount_minor-COALESCE(SUM(CASE WHEN m.movement_type='settlement' THEN m.amount_minor ELSE -m.amount_minor END),0))::text AS balance_minor,
    e.currency,e.due_on,e.created_by,e.created_at,
    CASE WHEN e.status='void' THEN 'void' WHEN COALESCE(SUM(CASE WHEN m.movement_type='settlement' THEN m.amount_minor ELSE -m.amount_minor END),0)=0 THEN 'open'
      WHEN COALESCE(SUM(CASE WHEN m.movement_type='settlement' THEN m.amount_minor ELSE -m.amount_minor END),0)=e.amount_minor THEN 'settled' ELSE 'partial' END AS status
  FROM gastro_finance_entries e LEFT JOIN gastro_finance_movements m ON m.entry_id=e.id`;

const validDate = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return fail('Data de vencimento inválida.');
  return value;
};
const operationKey = (value: unknown) => {
  if (typeof value !== 'string' || !uuid.test(value)) return fail('Chave de operação inválida.');
  return value;
};
const amount = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maxAmountMinor) return fail('O valor deve ser um inteiro positivo em centavos dentro do limite permitido.');
  return value;
};

export const gastroFinancePlugin: PluginDefinition = {
  id: 'gastro-finance', name: 'Financeiro administrativo', version: '1.0.0', parentPlugin: 'gastro-clinic', dependencies: ['gastro-clinic'],
  description: 'Lançamentos internos a pagar e receber, liquidações e estornos auditáveis; não emite documentos fiscais.',
  capabilities: [
    { id: 'read', name: 'Consultar lançamentos financeiros', permissions: ['plugin.gastro-finance.read'] },
    { id: 'write', name: 'Administrar lançamentos financeiros', permissions: ['plugin.gastro-finance.write'] },
  ],
  handlesRoute: path => /^\/gastro-finance(?:\/|$)/.test(path),
  routePermission: () => null,
  contributions: {
    navigation: [{ id: 'gastro-finance', label: 'Financeiro', href: '/gastro-finance', permission: 'plugin.gastro-finance.read', order: 28 }],
    profileSimulationExamples: context => context.permissions.includes('plugin.gastro-finance.read') ? [
      { id: 'receivable-demo', title: 'Serviços administrativos', type: 'A receber', state: 'parcial', description: 'R$ 280,00 fictícios · exercício de consulta somente leitura.', is_demo: true },
      { id: 'payable-demo', title: 'Suprimentos', type: 'A pagar', state: 'em aberto', description: 'R$ 145,00 fictícios · exercício de consulta somente leitura.', is_demo: true },
    ] : [],
  },
};

@Injectable()
export class GastroFinanceService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService, @Inject(PluginRegistry) private readonly plugins: PluginRegistry) {}

  private async workspace(user: string, workspaceId: string, write = false) {
    id(workspaceId);
    if (!this.plugins.isEnabled('gastro-finance')) fail('O plugin financeiro ou uma dependência está desativado.', 409);
    await this.access.require(user, `plugin.gastro-finance.${write ? 'write' : 'read'}`, 'workspace', workspaceId);
    if (!await this.db.one('SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL', [workspaceId])) fail('Workspace não encontrado ou arquivado.', 404);
  }

  async entries(workspaceId: string, user: string, direction = 'all', status = 'all', limit = 200) {
    await this.workspace(user, workspaceId);
    if (!['all', 'receivable', 'payable'].includes(direction) || !['all', 'open', 'partial', 'settled', 'void'].includes(status)
      || !Number.isInteger(limit) || limit < 1 || limit > 500) fail('Filtro financeiro inválido.');
    return this.db.query<EntryRow>(`${entryProjection}
      WHERE e.workspace_id=$1 AND ($2='all' OR e.direction=$2)
      GROUP BY e.id HAVING ($3='all' OR
        ($3='void' AND e.status='void') OR
        ($3='open' AND e.status='open' AND COALESCE(SUM(CASE WHEN m.movement_type='settlement' THEN m.amount_minor ELSE -m.amount_minor END),0)=0) OR
        ($3='partial' AND e.status='open' AND COALESCE(SUM(CASE WHEN m.movement_type='settlement' THEN m.amount_minor ELSE -m.amount_minor END),0)>0 AND COALESCE(SUM(CASE WHEN m.movement_type='settlement' THEN m.amount_minor ELSE -m.amount_minor END),0)<e.amount_minor) OR
        ($3='settled' AND e.status='open' AND COALESCE(SUM(CASE WHEN m.movement_type='settlement' THEN m.amount_minor ELSE -m.amount_minor END),0)=e.amount_minor))
      ORDER BY e.created_at DESC,e.id DESC LIMIT $4`, [workspaceId, direction, status, limit]);
  }

  async movements(workspaceId: string, user: string, limit = 200) {
    await this.workspace(user, workspaceId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) fail('Limite de histórico inválido.');
    return this.db.query(`SELECT m.id,m.entry_id,m.movement_type,m.amount_minor::text,m.method,m.reverses_id,m.reversal_reason,m.actor_id,m.created_at,e.direction,e.category,
        EXISTS(SELECT 1 FROM gastro_finance_movements r WHERE r.reverses_id=m.id) AS is_reversed
      FROM gastro_finance_movements m JOIN gastro_finance_entries e ON e.id=m.entry_id
      WHERE m.workspace_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT $2`, [workspaceId, limit]);
  }

  private async entry(client: PoolClient, workspaceId: string, entryId: string) {
    const row = await client.query<EntryRow>(`${entryProjection} WHERE e.workspace_id=$1 AND e.id=$2 GROUP BY e.id`, [workspaceId, entryId]);
    if (!row.rows[0]) fail('Lançamento não encontrado neste workspace.', 404);
    return row.rows[0];
  }

  async createEntry(workspaceId: string, user: string, input: EntryInput) {
    await this.workspace(user, workspaceId, true);
    if (input.direction !== 'receivable' && input.direction !== 'payable') fail('Tipo de lançamento inválido.');
    if (typeof input.category !== 'string' || !categories.includes(input.category as EntryCategory)) fail('Categoria financeira inválida.');
    const amountMinor = amount(input.amount_minor), dueOn = validDate(input.due_on), key = operationKey(input.operation_key);
    const command = { direction: input.direction, category: input.category, amount_minor: amountMinor, due_on: dueOn };
    const requestHash = fingerprint(command), client = await this.db.pool.connect();
    let row: EntryRow, replayed = false;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${workspaceId}:${key}`]);
      const previous = (await client.query<{ id: string; request_hash: string }>('SELECT id,request_hash FROM gastro_finance_entries WHERE workspace_id=$1 AND operation_key=$2', [workspaceId, key])).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) fail('A chave de operação já foi usada para outro lançamento.', 409);
        row = await this.entry(client, workspaceId, previous.id); replayed = true;
      } else {
        const inserted = (await client.query<{ id: string }>(`INSERT INTO gastro_finance_entries(workspace_id,direction,category,amount_minor,due_on,operation_key,request_hash,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [workspaceId, input.direction, input.category, amountMinor, dueOn, key, requestHash, user])).rows[0];
        row = await this.entry(client, workspaceId, inserted.id);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
    if (!replayed) await this.access.audit(user, 'gastro_finance.entry.created', row.id);
    return { ...row, replayed };
  }

  async settle(workspaceId: string, user: string, entryId: string, input: SettlementInput) {
    await this.workspace(user, workspaceId, true); id(entryId);
    const amountMinor = amount(input.amount_minor), key = operationKey(input.operation_key);
    if (typeof input.method !== 'string' || !methods.includes(input.method as SettlementMethod)) fail('Forma de liquidação inválida.');
    const command = { entry_id: entryId, amount_minor: amountMinor, method: input.method };
    const requestHash = fingerprint(command), client = await this.db.pool.connect();
    let movementId = '', entryRow: EntryRow, replayed = false;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${workspaceId}:${key}`]);
      const previous = (await client.query<{ id: string; entry_id: string; request_hash: string }>('SELECT id,entry_id,request_hash FROM gastro_finance_movements WHERE workspace_id=$1 AND operation_key=$2', [workspaceId, key])).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) fail('A chave de operação já foi usada para outro movimento.', 409);
        if (previous.entry_id !== entryId) fail('A chave de operação pertence a outro lançamento.', 409);
        movementId = previous.id; replayed = true;
      } else {
        const locked = (await client.query<{ id: string; workspace_id: string; status: string; amount_minor: string }>('SELECT id,workspace_id,status,amount_minor::text FROM gastro_finance_entries WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [entryId, workspaceId])).rows[0];
        if (!locked) fail('Lançamento não encontrado neste workspace.', 404);
        if (locked.status !== 'open') fail('O lançamento está anulado e não aceita liquidações.', 409);
        const balance = await client.query<{ balance_minor: string }>(`SELECT (e.amount_minor-COALESCE(SUM(CASE WHEN m.movement_type='settlement' THEN m.amount_minor ELSE -m.amount_minor END),0))::text AS balance_minor
          FROM gastro_finance_entries e LEFT JOIN gastro_finance_movements m ON m.entry_id=e.id WHERE e.id=$1 GROUP BY e.id`, [entryId]);
        if (amountMinor > Number(balance.rows[0]?.balance_minor ?? 0)) fail('O valor excede o saldo em aberto.', 409);
        movementId = (await client.query<{ id: string }>(`INSERT INTO gastro_finance_movements(workspace_id,entry_id,movement_type,amount_minor,method,operation_key,request_hash,actor_id)
          VALUES($1,$2,'settlement',$3,$4,$5,$6,$7) RETURNING id`, [workspaceId, entryId, amountMinor, input.method, key, requestHash, user])).rows[0].id;
      }
      entryRow = await this.entry(client, workspaceId, entryId);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
    if (!replayed) await this.access.audit(user, 'gastro_finance.settlement.created', movementId);
    return { entry: entryRow!, movement_id: movementId, replayed };
  }

  async reverse(workspaceId: string, user: string, movementId: string, input: ReversalInput) {
    await this.workspace(user, workspaceId, true); id(movementId);
    const key = operationKey(input.operation_key);
    if (typeof input.reason !== 'string' || !reversalReasons.includes(input.reason as ReversalReason)) fail('Motivo de estorno inválido.');
    const command = { movement_id: movementId, reason: input.reason }, requestHash = fingerprint(command), client = await this.db.pool.connect();
    let reversalId = '', replayed = false;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${workspaceId}:${key}`]);
      const previous = (await client.query<{ id: string; reverses_id: string | null; request_hash: string }>('SELECT id,reverses_id,request_hash FROM gastro_finance_movements WHERE workspace_id=$1 AND operation_key=$2', [workspaceId, key])).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash || previous.reverses_id !== movementId) fail('A chave de operação já foi usada para outro movimento.', 409);
        reversalId = previous.id; replayed = true;
      } else {
        const original = (await client.query<{ id: string; entry_id: string; amount_minor: string; method: SettlementMethod; movement_type: string }>(`SELECT id,entry_id,amount_minor::text,method,movement_type
          FROM gastro_finance_movements WHERE id=$1 AND workspace_id=$2`, [movementId, workspaceId])).rows[0];
        if (!original || original.movement_type !== 'settlement') fail('Liquidação não encontrada neste workspace.', 404);
        await client.query('SELECT id FROM gastro_finance_entries WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [original.entry_id, workspaceId]);
        if (await client.query('SELECT id FROM gastro_finance_movements WHERE reverses_id=$1', [movementId]).then(result => result.rows[0])) fail('Esta liquidação já foi estornada.', 409);
        reversalId = (await client.query<{ id: string }>(`INSERT INTO gastro_finance_movements(workspace_id,entry_id,movement_type,amount_minor,method,operation_key,request_hash,reverses_id,reversal_reason,actor_id)
          VALUES($1,$2,'reversal',$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [workspaceId, original.entry_id, original.amount_minor, original.method, key, requestHash, movementId, input.reason, user])).rows[0].id;
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
    if (!replayed) await this.access.audit(user, 'gastro_finance.settlement.reversed', reversalId);
    return { id: reversalId, replayed };
  }

  async voidEntry(workspaceId: string, user: string, entryId: string) {
    await this.workspace(user, workspaceId, true); id(entryId);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const entry = (await client.query<{ id: string; status: string }>('SELECT id,status FROM gastro_finance_entries WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [entryId, workspaceId])).rows[0];
      if (!entry) fail('Lançamento não encontrado neste workspace.', 404);
      if (entry.status !== 'open') fail('Somente lançamentos abertos podem ser anulados.', 409);
      if ((await client.query('SELECT id FROM gastro_finance_movements WHERE entry_id=$1 LIMIT 1', [entryId])).rows.length) fail('Lançamentos com histórico financeiro não podem ser anulados.', 409);
      await client.query("UPDATE gastro_finance_entries SET status='void' WHERE id=$1 AND workspace_id=$2", [entryId, workspaceId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
    await this.access.audit(user, 'gastro_finance.entry.voided', entryId);
    return { id: entryId, status: 'void' };
  }
}

@Controller('gastro-finance')
export class GastroFinanceController {
  constructor(@Inject(GastroFinanceService) private readonly finance: GastroFinanceService) {}
  @Get('workspaces/:workspace/entries') entries(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Query('direction') direction?: string, @Query('status') status?: string, @Query('limit') limit?: string) { return this.finance.entries(workspace, String(req.orbitUser), direction, status, limit === undefined ? 200 : Number(limit)); }
  @Post('workspaces/:workspace/entries') createEntry(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Body() body: EntryInput) { return this.finance.createEntry(workspace, String(req.orbitUser), body); }
  @Post('workspaces/:workspace/entries/:id/settlements') settle(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Param('id') entry: string, @Body() body: SettlementInput) { return this.finance.settle(workspace, String(req.orbitUser), entry, body); }
  @Post('workspaces/:workspace/entries/:id/void') voidEntry(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Param('id') entry: string) { return this.finance.voidEntry(workspace, String(req.orbitUser), entry); }
  @Get('workspaces/:workspace/movements') movements(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Query('limit') limit?: string) { return this.finance.movements(workspace, String(req.orbitUser), limit === undefined ? 200 : Number(limit)); }
  @Post('workspaces/:workspace/movements/:id/reversal') reverse(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Param('id') movement: string, @Body() body: ReversalInput) { return this.finance.reverse(workspace, String(req.orbitUser), movement, body); }
}
