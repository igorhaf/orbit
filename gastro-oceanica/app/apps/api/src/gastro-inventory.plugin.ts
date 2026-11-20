import { createHash } from 'node:crypto';
import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { AccessService, id } from './access/access';
import type { AccessRequest } from './access/access';
import { Db } from './db';
import { PluginRegistry } from './execution/registries';
import type { PluginDefinition } from './plugins/contract';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type InventoryDirection = 'entry' | 'exit';
type ProductInput = { code?: unknown; name?: unknown; unit?: unknown; tracks_lots?: unknown };
type MovementInput = { product_id?: unknown; direction?: unknown; quantity?: unknown; operation_key?: unknown; lot_id?: unknown; lot_code?: unknown; expires_on?: unknown };
const fail = (message: string, status = 400): never => { throw new HttpException(message, status); };
const cleanText = (value: unknown, label: string, max: number, required = true) => {
  if (value === undefined || value === null || value === '') { if (!required) return null; return fail(`${label} é obrigatório.`); }
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > max) return fail(`${label} inválido.`);
  return value.trim();
};
const validDate = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return fail('Validade inválida.');
  return value;
};
const requestFingerprint = (value: Record<string, unknown>) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const gastroInventoryPlugin: PluginDefinition = {
  id: 'gastro-inventory', name: 'Estoque clínico', version: '1.1.0', parentPlugin: 'gastro-clinic', dependencies: ['gastro-clinic'],
  description: 'Produtos, lotes e movimentos de estoque com saldo transacional e histórico imutável.',
  capabilities: [
    { id: 'read', name: 'Consultar estoque', permissions: ['plugin.gastro-inventory.read'] },
    { id: 'write', name: 'Administrar estoque', permissions: ['plugin.gastro-inventory.write'] },
  ],
  handlesRoute: path => /^\/gastro-inventory(?:\/|$)/.test(path),
  routePermission: () => null,
  contributions: {
    navigation: [{ id: 'gastro-inventory', label: 'Estoque', href: '/gastro-inventory', permission: 'plugin.gastro-inventory.read', order: 26 }],
    profileSimulationExamples: context => context.permissions.includes('plugin.gastro-inventory.read') ? [
      {
        id: 'stock-overview', title: 'Visão demonstrativa do estoque', type: 'inventory_overview', state: 'in_stock',
        description: 'Exemplo sintético de saldo e materiais; nenhum produto ou movimento real é consultado.', is_demo: true,
      },
      {
        id: 'lot-review', title: 'Conferir lote de exemplo', type: 'inventory_lot', state: 'review',
        description: 'Cenário fictício para demonstrar lote e validade sem representar um item real.', is_demo: true,
      },
    ] : [],
  },
};

@Injectable()
export class GastroInventoryService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService, @Inject(PluginRegistry) private readonly plugins: PluginRegistry) {}

  private async workspace(user: string, workspaceId: string, write = false) {
    id(workspaceId);
    if (!this.plugins.isEnabled('gastro-inventory')) fail('O plugin de estoque ou uma dependência está desativado.', 409);
    await this.access.require(user, `plugin.gastro-inventory.${write ? 'write' : 'read'}`, 'workspace', workspaceId);
    if (!await this.db.one('SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL', [workspaceId])) fail('Workspace não encontrado ou arquivado.', 404);
  }

  async products(workspaceId: string, user: string, availability = 'all', expiry = 'all') {
    await this.workspace(user, workspaceId);
    if (!['all', 'available', 'empty'].includes(availability) || !['all', 'expired', '30days'].includes(expiry)) fail('Filtro de estoque inválido.');
    return this.db.query(`SELECT p.id,p.workspace_id,p.code,p.name,p.unit,p.tracks_lots,p.current_balance,p.archived_at,
        COALESCE(SUM(l.current_balance),0)::int AS lot_balance,
        MIN(l.expires_on) FILTER (WHERE l.current_balance>0) AS next_expiry,
        COUNT(*) FILTER (WHERE l.current_balance>0 AND l.expires_on<CURRENT_DATE)::int AS expired_lots,
        COUNT(*) FILTER (WHERE l.current_balance>0 AND l.expires_on>=CURRENT_DATE AND l.expires_on<CURRENT_DATE+30)::int AS expiring_lots
      FROM gastro_inventory_products p LEFT JOIN gastro_inventory_lots l ON l.product_id=p.id
      WHERE p.workspace_id=$1 AND p.archived_at IS NULL
        AND ($2='all' OR ($2='available' AND p.current_balance>0) OR ($2='empty' AND p.current_balance=0))
        AND ($3='all' OR ($3='expired' AND EXISTS(SELECT 1 FROM gastro_inventory_lots el WHERE el.product_id=p.id AND el.current_balance>0 AND el.expires_on<CURRENT_DATE))
          OR ($3='30days' AND EXISTS(SELECT 1 FROM gastro_inventory_lots el WHERE el.product_id=p.id AND el.current_balance>0 AND el.expires_on>=CURRENT_DATE AND el.expires_on<CURRENT_DATE+30)))
      GROUP BY p.id ORDER BY p.name,p.id`, [workspaceId, availability, expiry]);
  }

  async createProduct(workspaceId: string, user: string, input: ProductInput) {
    await this.workspace(user, workspaceId, true);
    const name = cleanText(input.name, 'Produto', 120)!;
    const unit = cleanText(input.unit, 'Unidade', 40)!;
    const code = cleanText(input.code, 'Código', 32, false);
    if (input.tracks_lots !== undefined && typeof input.tracks_lots !== 'boolean') fail('Controle por lote inválido.');
    try {
      const row = await this.db.one(`INSERT INTO gastro_inventory_products(workspace_id,code,name,unit,tracks_lots,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`, [workspaceId, code, name, unit, input.tracks_lots === true, user]);
      await this.access.audit(user, 'gastro_inventory.product.created', String(row?.id));
      return row;
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') fail('Já existe produto com este código neste workspace.', 409);
      throw error;
    }
  }

  async updateProduct(productId: string, user: string, input: ProductInput) {
    id(productId);
    const initial = await this.db.one<{ workspace_id: string }>('SELECT workspace_id FROM gastro_inventory_products WHERE id=$1 AND archived_at IS NULL', [productId]);
    if (!initial) throw new HttpException('Produto não encontrado.', 404);
    await this.workspace(user, initial.workspace_id, true);
    const name = cleanText(input.name, 'Produto', 120)!;
    const unit = cleanText(input.unit, 'Unidade', 40)!;
    const code = cleanText(input.code, 'Código', 32, false);
    if (input.tracks_lots !== undefined && typeof input.tracks_lots !== 'boolean') fail('Controle por lote inválido.');
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const product = (await client.query('SELECT workspace_id,unit,tracks_lots,current_balance FROM gastro_inventory_products WHERE id=$1 AND archived_at IS NULL FOR UPDATE', [productId])).rows[0];
      if (!product || product.workspace_id !== initial.workspace_id) fail('Produto não encontrado.', 404);
      const tracksLots = input.tracks_lots === undefined ? product.tracks_lots : input.tracks_lots;
      if (tracksLots !== product.tracks_lots) {
        const history = (await client.query('SELECT EXISTS(SELECT 1 FROM gastro_inventory_movements WHERE product_id=$1) AS exists', [productId])).rows[0];
        if (history.exists || Number(product.current_balance) !== 0) fail('O controle por lote não pode mudar depois do primeiro movimento.', 409);
      }
      const history = (await client.query('SELECT EXISTS(SELECT 1 FROM gastro_inventory_movements WHERE product_id=$1) AS exists', [productId])).rows[0];
      if (history.exists && unit !== product.unit) fail('A unidade não pode mudar depois do primeiro movimento.', 409);
      const row = (await client.query('UPDATE gastro_inventory_products SET code=$2,name=$3,unit=$4,tracks_lots=$5,updated_by=$6,updated_at=now() WHERE id=$1 RETURNING *', [productId, code, name, unit, tracksLots, user])).rows[0];
      await client.query('COMMIT');
      await this.access.audit(user, 'gastro_inventory.product.updated', productId);
      return row;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((error as { code?: string })?.code === '23505') fail('Já existe produto com este código neste workspace.', 409);
      throw error;
    } finally { client.release(); }
  }

  async archiveProduct(productId: string, user: string) {
    id(productId);
    const initial = await this.db.one<{ workspace_id: string }>('SELECT workspace_id FROM gastro_inventory_products WHERE id=$1 AND archived_at IS NULL', [productId]);
    if (!initial) throw new HttpException('Produto não encontrado.', 404);
    await this.workspace(user, initial.workspace_id, true);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const product = (await client.query('SELECT workspace_id,current_balance FROM gastro_inventory_products WHERE id=$1 AND archived_at IS NULL FOR UPDATE', [productId])).rows[0];
      if (!product || product.workspace_id !== initial.workspace_id) fail('Produto não encontrado.', 404);
      if (Number(product.current_balance) !== 0) fail('Zere o saldo antes de arquivar o produto.', 409);
      await client.query('UPDATE gastro_inventory_products SET archived_at=now(),updated_by=$2,updated_at=now() WHERE id=$1', [productId, user]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
    await this.access.audit(user, 'gastro_inventory.product.archived', productId);
    return { id: productId, archived: true };
  }

  async lots(productId: string, user: string) {
    id(productId);
    const product = await this.db.one<{ workspace_id: string }>('SELECT workspace_id FROM gastro_inventory_products WHERE id=$1 AND archived_at IS NULL', [productId]);
    if (!product) throw new HttpException('Produto não encontrado.', 404);
    await this.workspace(user, product.workspace_id);
    return this.db.query('SELECT id,product_id,code,expires_on,current_balance FROM gastro_inventory_lots WHERE product_id=$1 ORDER BY expires_on NULLS LAST,code,id', [productId]);
  }

  async movements(workspaceId: string, user: string, direction = 'all', limit = 100) {
    await this.workspace(user, workspaceId);
    if (!['all', 'entry', 'exit'].includes(direction) || !Number.isInteger(limit) || limit < 1 || limit > 500) fail('Filtro de histórico inválido.');
    return this.db.query(`SELECT m.id,m.product_id,m.lot_id,m.direction,m.quantity,m.actor_id,m.created_at,
        m.product_name_snapshot AS product_name,m.product_code_snapshot AS product_code,m.unit_snapshot AS unit,l.code AS lot_code,l.expires_on,u.name AS actor_name
      FROM gastro_inventory_movements m
      LEFT JOIN gastro_inventory_lots l ON l.id=m.lot_id JOIN users u ON u.id=m.actor_id
      WHERE m.workspace_id=$1 AND ($2='all' OR m.direction=$2)
      ORDER BY m.created_at DESC,m.id DESC LIMIT $3`, [workspaceId, direction, limit]);
  }

  async move(workspaceId: string, user: string, input: MovementInput) {
    await this.workspace(user, workspaceId, true);
    if (typeof input.product_id !== 'string' || !uuid.test(input.product_id)) fail('Produto inválido.');
    const productId = input.product_id;
    if (input.direction !== 'entry' && input.direction !== 'exit') fail('Tipo de movimentação inválido.');
    const direction = input.direction as InventoryDirection;
    if (!Number.isSafeInteger(input.quantity) || Number(input.quantity) < 1) fail('A quantidade deve ser um inteiro positivo.');
    if (typeof input.operation_key !== 'string' || !uuid.test(input.operation_key)) fail('Chave da operação inválida.');
    const quantity = Number(input.quantity);
    const lotCode = direction === 'entry' ? cleanText(input.lot_code, 'Lote', 80, false) : null;
    const expiresOn = direction === 'entry' ? validDate(input.expires_on) : null;
    let lotId = direction === 'exit' && input.lot_id ? String(input.lot_id) : null;
    if (lotId && !uuid.test(lotId)) fail('Lote inválido.');
    if (direction === 'exit' && input.lot_code !== undefined || direction === 'exit' && input.expires_on !== undefined) fail('A validade e o código do lote só se informam na entrada.');
    const command = { productId, direction, quantity, lotId, lotCode, expiresOn };
    const requestHash = requestFingerprint(command);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${workspaceId}:${input.operation_key}`]);
      const previous = (await client.query('SELECT id,request_hash FROM gastro_inventory_movements WHERE workspace_id=$1 AND operation_key=$2', [workspaceId, input.operation_key])).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) fail('A chave da operação já foi usada para outro movimento.', 409);
        const replay = await client.query('SELECT * FROM gastro_inventory_movements WHERE id=$1', [previous.id]);
        await client.query('COMMIT');
        return { ...replay.rows[0], replayed: true };
      }
      const product = (await client.query('SELECT id,workspace_id,code,name,unit,tracks_lots,current_balance FROM gastro_inventory_products WHERE id=$1 AND workspace_id=$2 AND archived_at IS NULL FOR UPDATE', [productId, workspaceId])).rows[0];
      if (!product) fail('Produto não encontrado neste workspace.', 404);
      if (product.tracks_lots && direction === 'entry' && !lotCode) fail('Informe o lote para este produto.');
      if (product.tracks_lots && direction === 'exit' && !lotId) fail('Selecione um lote para este produto.');
      if (!product.tracks_lots && (lotId || lotCode || expiresOn)) fail('Este produto não controla lotes.');
      if (direction === 'exit' && Number(product.current_balance) < quantity) fail('Saldo insuficiente para esta saída.', 400);
      if (direction === 'entry' && lotCode) {
        const existing = (await client.query('SELECT id,expires_on FROM gastro_inventory_lots WHERE product_id=$1 AND code=$2 FOR UPDATE', [productId, lotCode])).rows[0];
        if (existing && String(existing.expires_on || '') !== String(expiresOn || '')) fail('O código do lote já existe com outra validade.', 409);
        if (existing) lotId = existing.id;
        else lotId = (await client.query('INSERT INTO gastro_inventory_lots(product_id,code,expires_on) VALUES($1,$2,$3) RETURNING id', [productId, lotCode, expiresOn])).rows[0].id;
      }
      if (direction === 'exit' && lotId) {
        const lot = (await client.query('SELECT id,current_balance FROM gastro_inventory_lots WHERE id=$1 AND product_id=$2 FOR UPDATE', [lotId, productId])).rows[0];
        if (!lot) fail('Lote não pertence a este produto.', 404);
        if (Number(lot.current_balance) < quantity) fail('Saldo insuficiente no lote selecionado.', 400);
        await client.query('UPDATE gastro_inventory_lots SET current_balance=current_balance-$2 WHERE id=$1', [lotId, quantity]);
      } else if (direction === 'entry' && lotId) await client.query('UPDATE gastro_inventory_lots SET current_balance=current_balance+$2 WHERE id=$1', [lotId, quantity]);
      await client.query('UPDATE gastro_inventory_products SET current_balance=current_balance+$2,updated_by=$3,updated_at=now() WHERE id=$1', [productId, direction === 'entry' ? quantity : -quantity, user]);
      const movement = (await client.query(`INSERT INTO gastro_inventory_movements(workspace_id,product_id,lot_id,direction,quantity,product_name_snapshot,product_code_snapshot,unit_snapshot,operation_key,request_hash,actor_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [workspaceId, productId, lotId, direction, quantity, product.name, product.code, product.unit, input.operation_key, requestHash, user])).rows[0];
      await client.query('COMMIT');
      await this.access.audit(user, `gastro_inventory.${direction}`, movement.id);
      return movement;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}

@Controller('gastro-inventory')
export class GastroInventoryController {
  constructor(@Inject(GastroInventoryService) private readonly inventory: GastroInventoryService) {}
  @Get('workspaces/:workspace/products') products(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Query('availability') availability?: string, @Query('expiry') expiry?: string) { return this.inventory.products(workspace, String(req.orbitUser), availability, expiry); }
  @Post('workspaces/:workspace/products') create(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Body() body: ProductInput) { return this.inventory.createProduct(workspace, String(req.orbitUser), body); }
  @Patch('products/:id') update(@Req() req: AccessRequest, @Param('id') productId: string, @Body() body: ProductInput) { return this.inventory.updateProduct(productId, String(req.orbitUser), body); }
  @Post('products/:id/archive') archive(@Req() req: AccessRequest, @Param('id') productId: string) { return this.inventory.archiveProduct(productId, String(req.orbitUser)); }
  @Get('products/:id/lots') lots(@Req() req: AccessRequest, @Param('id') productId: string) { return this.inventory.lots(productId, String(req.orbitUser)); }
  @Get('workspaces/:workspace/movements') movements(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Query('direction') direction?: string, @Query('limit') limit?: string) { const count = limit === undefined ? 100 : Number(limit); return this.inventory.movements(workspace, String(req.orbitUser), direction, count); }
  @Post('workspaces/:workspace/movements') move(@Req() req: AccessRequest, @Param('workspace') workspace: string, @Body() body: MovementInput) { return this.inventory.move(workspace, String(req.orbitUser), body); }
}
