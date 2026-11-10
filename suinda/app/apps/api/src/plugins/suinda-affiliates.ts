import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Query, Req } from "@nestjs/common";
import type { AccessRequest } from "../access/access";
import { AccessService } from "../access/access";
import { Db } from "../db";
import type { PluginDefinition, RecordKindContribution } from "./contract";
import { PluginRegistry } from "../execution/registries";

export const SUINDA_AFFILIATES = "suinda-affiliates";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMISSION_PAGE_SIZE = 100;
const PERMISSION = `plugin.${SUINDA_AFFILIATES}.manage`;
function fail(message: string, status: number): never { throw new HttpException({ message }, status); }
function id(value: unknown, message: string) { if (typeof value !== "string" || !UUID.test(value)) fail(message, 400); return value; }
function amountCents(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}
const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const ref = { type: "string", pattern: UUID.source };
const affiliateSchema = objectSchema({ display_name: { type: "string", minLength: 1, maxLength: 180 }, user_id: { type: ["string", "null"], pattern: UUID.source }, contact_reference: { type: ["string", "null"], maxLength: 180 } }, ["display_name"]);
const associationSchema = objectSchema({ affiliate_record_id: ref, coupon_record_id: ref, commission_rate_bps: { type: "integer", minimum: 0, maximum: 10000 }, effective_from: { type: "string", format: "date-time" } }, ["affiliate_record_id", "coupon_record_id", "commission_rate_bps", "effective_from"]);
const commissionSchema = objectSchema({ affiliate_record_id: ref, association_record_id: ref, coupon_record_id: ref, source_payment_entry_id: ref, refund_payment_entry_id: { type: ["string", "null"], pattern: UUID.source }, enrollment_record_id: ref, commission_type: { type: "string", enum: ["earned", "refund_adjustment"] }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, amount: { type: "number", minimum: -10000000, maximum: 10000000 }, source_amount: { type: "number", minimum: 0 }, commission_rate_bps: { type: "integer", minimum: 0, maximum: 10000 }, payment_recorded_at: { type: "string", format: "date-time" }, calculation_policy: { type: "string", const: "confirmed_net_proportional_v1" } }, ["affiliate_record_id", "association_record_id", "coupon_record_id", "source_payment_entry_id", "enrollment_record_id", "commission_type", "currency", "amount", "source_amount", "commission_rate_bps", "payment_recorded_at", "calculation_policy"]);
const managerScope: Pick<RecordKindContribution, "resourceScoped" | "managePermission" | "authorizeRecord" | "authorizeCreate"> = {
  resourceScoped: true, managePermission: PERMISSION,
  authorizeRecord: async (_actor, _action, _state, _payload, context) => Boolean(await context.hasWorkspacePermission?.(PERMISSION)),
  authorizeCreate: async (_actor, _payload, context) => Boolean(await context.hasWorkspacePermission?.(PERMISSION)),
};
export const suindaAffiliateRecordKinds: Record<string, RecordKindContribution> = {
  affiliate: { label: "Afiliado Suindá", schema: affiliateSchema, initial: "active", transitions: { active: ["archived"], archived: [] }, stateLabels: { active: "Ativo", archived: "Arquivado" }, example: { display_name: "Parceiro educacional", user_id: null, contact_reference: null }, ...managerScope },
  affiliate_coupon: { label: "Associação de afiliado e cupom", schema: associationSchema, initial: "active", transitions: { active: ["archived"], archived: [] }, stateLabels: { active: "Ativa", archived: "Arquivada" }, immutable: ["affiliate_record_id", "coupon_record_id", "commission_rate_bps", "effective_from"], uniqueFields: ["effective_from"], example: { affiliate_record_id: "uuid", coupon_record_id: "uuid", commission_rate_bps: 1000, effective_from: "2030-01-01T00:00:00.000Z" }, ...managerScope },
  commission_entry: { label: "Lançamento de comissão de afiliado", schema: commissionSchema, initial: "recorded", transitions: { recorded: [] }, stateLabels: { recorded: "Apurada" }, immutable: Object.keys(commissionSchema.properties as Record<string, unknown>), example: { affiliate_record_id: "uuid", association_record_id: "uuid", coupon_record_id: "uuid", source_payment_entry_id: "uuid", refund_payment_entry_id: null, enrollment_record_id: "uuid", commission_type: "earned", currency: "BRL", amount: 10, source_amount: 100, commission_rate_bps: 1000, payment_recorded_at: "2030-01-01T00:00:00.000Z", calculation_policy: "confirmed_net_proportional_v1" }, serverCreated: true, ...managerScope },
};

type DbRecord = { id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown>; created_at: Date | string };
type Payment = DbRecord;

@Injectable()
export class SuindaAffiliatesService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService, @Inject(PluginRegistry) private readonly registry: PluginRegistry) {}
  private async manager(workspace: string, actor: string) {
    const scope = id(workspace, "Workspace inválido.");
    if (!this.registry.isEnabled(SUINDA_AFFILIATES)) fail("Afiliados do Suindá estão desativados.", 409);
    if (!await this.db.one("SELECT id FROM workspaces WHERE id=$1", [scope])) fail("Workspace não encontrado.", 404);
    if (!await this.access.has(actor, PERMISSION, "workspace", scope)) fail("A gestão de afiliados exige permissão neste workspace.", 403);
    return scope;
  }
  private async writeRecord(workspace: string, actor: string, kind: string, title: string, payload: Record<string, unknown>, reason: string) {
    const client = await this.db.pool.connect();
    let recordId: string;
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(`INSERT INTO extension_records(workspace_id,plugin_id,kind,title,state,payload,created_by,updated_by)
        VALUES($1,$2,$3,$4,'${kind === "commission_entry" ? "recorded" : "active"}',$5::jsonb,$6,$6)
        ${kind === "commission_entry" ? "ON CONFLICT DO NOTHING" : ""} RETURNING id`, [workspace, SUINDA_AFFILIATES, kind, title, JSON.stringify(payload), actor]);
      if (!result.rows[0]) { await client.query("COMMIT"); return null; }
      recordId = result.rows[0].id;
      await client.query("INSERT INTO extension_record_versions(record_id,revision,title,state,payload,reason,actor_id) VALUES($1,1,$2,$3,$4::jsonb,$5,$6)", [recordId, title, kind === "commission_entry" ? "recorded" : "active", JSON.stringify(payload), reason, actor]);
      await client.query("INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,'workspace',$4)", [actor, `${SUINDA_AFFILIATES}.${kind}.created`, recordId, workspace]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return recordId!;
  }
  async createAffiliate(workspace: string, actor: string, input: unknown) {
    const scope = await this.manager(workspace, actor);
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("Cadastro de afiliado inválido.", 400);
    const body = input as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["display_name", "user_id", "contact_reference"].includes(key)) || typeof body.display_name !== "string" || !body.display_name.trim() || body.display_name.length > 180 || (body.user_id !== undefined && body.user_id !== null && !UUID.test(String(body.user_id))) || (body.contact_reference !== undefined && body.contact_reference !== null && (typeof body.contact_reference !== "string" || body.contact_reference.length > 180))) fail("Cadastro de afiliado inválido.", 400);
    if (body.user_id && !await this.db.one("SELECT id FROM users WHERE id=$1 AND disabled=false", [body.user_id])) fail("Usuário afiliado não encontrado ou desativado.", 404);
    const payload = { display_name: body.display_name.trim(), user_id: body.user_id || null, contact_reference: body.contact_reference || null };
    const recordId = await this.writeRecord(scope, actor, "affiliate", payload.display_name, payload, "Cadastro de afiliado");
    if (!recordId) fail("Não foi possível registrar o afiliado.", 503);
    return { id: recordId, ...payload, state: "active" };
  }
  async listAffiliates(workspace: string, actor: string) {
    const scope = await this.manager(workspace, actor);
    await this.access.audit(actor, `${SUINDA_AFFILIATES}.affiliate.list`, scope, { type: "workspace", id: scope });
    return this.db.query(`SELECT id,title,payload,state,created_at FROM extension_records
      WHERE workspace_id=$1 AND plugin_id=$2 AND kind='affiliate' AND state='active' ORDER BY title,id`, [scope, SUINDA_AFFILIATES]);
  }
  async listCoupons(workspace: string, actor: string) {
    const scope = await this.manager(workspace, actor);
    await this.access.audit(actor, `${SUINDA_AFFILIATES}.coupon.list`, scope, { type: "workspace", id: scope });
    return this.db.query(`SELECT id,title,payload->>'code' AS code,payload->>'discount_context' AS discount_context,
        payload->>'partner_name' AS partner_name,created_at FROM extension_records
      WHERE workspace_id=$1 AND plugin_id='suinda-learning' AND kind='enrollment_coupon' AND state='published' ORDER BY title,id`, [scope]);
  }
  async listAssociations(workspace: string, actor: string) {
    const scope = await this.manager(workspace, actor);
    await this.access.audit(actor, `${SUINDA_AFFILIATES}.association.list`, scope, { type: "workspace", id: scope });
    return this.db.query(`SELECT a.id,a.title,a.state,a.payload,a.created_at,
        affiliate.title AS affiliate_title,coupon.payload->>'code' AS coupon_code
      FROM extension_records a
      JOIN extension_records affiliate ON affiliate.id::text=a.payload->>'affiliate_record_id' AND affiliate.workspace_id=a.workspace_id
        AND affiliate.plugin_id=$2 AND affiliate.kind='affiliate'
      JOIN extension_records coupon ON coupon.id::text=a.payload->>'coupon_record_id' AND coupon.workspace_id=a.workspace_id
        AND coupon.plugin_id='suinda-learning' AND coupon.kind='enrollment_coupon'
      WHERE a.workspace_id=$1 AND a.plugin_id=$2 AND a.kind='affiliate_coupon'
      ORDER BY a.created_at DESC,a.id DESC`, [scope, SUINDA_AFFILIATES]);
  }
  async associateCoupon(workspace: string, actor: string, input: unknown) {
    const scope = await this.manager(workspace, actor);
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("Associação de cupom inválida.", 400);
    const body = input as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["affiliate_record_id", "coupon_record_id", "commission_rate_bps"].includes(key)) || !UUID.test(String(body.affiliate_record_id)) || !UUID.test(String(body.coupon_record_id)) || !Number.isInteger(body.commission_rate_bps) || Number(body.commission_rate_bps) < 0 || Number(body.commission_rate_bps) > 10000) fail("Associação de cupom inválida.", 400);
    const [affiliate, coupon] = await Promise.all([
      this.db.one<DbRecord>("SELECT * FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id=$3 AND kind='affiliate' AND state='active'", [body.affiliate_record_id, scope, SUINDA_AFFILIATES]),
      this.db.one<DbRecord>("SELECT * FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id='suinda-learning' AND kind='enrollment_coupon' AND state='published'", [body.coupon_record_id, scope]),
    ]);
    if (!affiliate || !coupon) fail("Afiliado ativo e cupom publicado precisam pertencer a este workspace.", 404);
    const previous = await this.db.one<DbRecord>(`SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 AND kind='affiliate_coupon'
      AND payload->>'coupon_record_id'=$3 ORDER BY created_at DESC,id DESC LIMIT 1`, [scope, SUINDA_AFFILIATES, coupon.id]);
    if (previous && previous.payload.affiliate_record_id !== affiliate.id) fail("Este cupom já está atribuído a outro afiliado. Preserve a atribuição histórica e use um novo cupom para trocar de afiliado.", 409);
    const payload = { affiliate_record_id: affiliate.id, coupon_record_id: coupon.id, commission_rate_bps: Number(body.commission_rate_bps), effective_from: new Date().toISOString() };
    const recordId = await this.writeRecord(scope, actor, "affiliate_coupon", `${affiliate.title} · ${String(coupon.payload.code)}`, payload, "Nova versão de taxa de comissão; vigência baseada no registro do pagamento");
    if (!recordId) fail("Não foi possível registrar a associação do cupom.", 503);
    return { id: recordId, ...payload, state: "active" };
  }
  async reconcile(workspace: string, actor: string) {
    const scope = await this.manager(workspace, actor);
    const payments = await this.db.query<Payment>(`SELECT p.* FROM extension_records p
      WHERE p.workspace_id=$1 AND p.plugin_id='suinda-learning' AND p.kind='payment_entry' AND p.state='recorded'
        AND p.payload->>'payment_method' <> 'refund' AND p.payload->>'payment_method' <> 'waiver' AND p.payload->>'payment_method' <> 'scholarship'
      ORDER BY p.created_at,p.id`, [scope]);
    let created = 0;
    for (const payment of payments) {
      const enrollmentId = String(payment.payload.enrollment_record_id || "");
      const enrollment = await this.db.one<DbRecord>("SELECT * FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id='suinda-learning' AND kind='enrollment'", [enrollmentId, scope]);
      const couponId = enrollment?.payload.coupon_record_id;
      if (!couponId || !UUID.test(String(couponId))) continue;
      const assoc = await this.db.one<DbRecord>(`SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 AND kind='affiliate_coupon'
        AND payload->>'coupon_record_id'=$3 AND created_at <= $4 ORDER BY created_at DESC,id DESC LIMIT 1`, [scope, SUINDA_AFFILIATES, couponId, payment.created_at]);
      if (!assoc) continue;
      const priorEarned = await this.db.one("SELECT id FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 AND kind='commission_entry' AND payload->>'association_record_id'=$3 AND payload->>'source_payment_entry_id'=$4 AND payload->>'commission_type'='earned'", [scope, SUINDA_AFFILIATES, assoc.id, payment.id]);
      if (!priorEarned) {
        const rate = Number(assoc.payload.commission_rate_bps);
        const cents = Math.round(amountCents(payment.payload.amount) * rate / 10000);
        if (cents > 0) {
          const payload = { affiliate_record_id: assoc.payload.affiliate_record_id, association_record_id: assoc.id, coupon_record_id: couponId,
            source_payment_entry_id: payment.id, refund_payment_entry_id: null, enrollment_record_id: enrollmentId, commission_type: "earned",
            currency: String(payment.payload.currency || "BRL").toUpperCase(), amount: cents / 100, source_amount: amountCents(payment.payload.amount) / 100,
            commission_rate_bps: rate, payment_recorded_at: new Date(payment.created_at).toISOString(), calculation_policy: "confirmed_net_proportional_v1" };
          if (await this.writeRecord(scope, actor, "commission_entry", `Comissão · ${String(payload.currency)} ${payload.amount.toFixed(2)}`, payload, "Apuração de pagamento registrado com cupom atribuído")) created++;
        }
      }
      const refunds = await this.db.query<Payment>(`SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id='suinda-learning' AND kind='payment_entry' AND state='recorded'
        AND payload->>'payment_method'='refund' AND payload->>'refund_of_payment_entry_id'=$2 ORDER BY created_at,id`, [scope, payment.id]);
      const sourceCents = amountCents(payment.payload.amount);
      if (!sourceCents) continue;
      let cumulativeRefundCents = 0;
      let cumulativeCommissionCents = 0;
      const earnedCents = Math.round(sourceCents * Number(assoc.payload.commission_rate_bps) / 10000);
      const existingRefunds = await this.db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 AND kind='commission_entry'
        AND payload->>'source_payment_entry_id'=$3 AND payload->>'commission_type'='refund_adjustment' ORDER BY created_at,id`, [scope, SUINDA_AFFILIATES, payment.id]);
      const alreadyByRefund = new Set(existingRefunds.map((row) => String(row.payload.refund_payment_entry_id)));
      for (const refund of refunds) {
        const refundCents = amountCents(refund.payload.amount);
        const nextCumulative = Math.min(sourceCents, cumulativeRefundCents + refundCents);
        const nextTarget = Math.round(earnedCents * nextCumulative / sourceCents);
        const adjustment = nextTarget - cumulativeCommissionCents;
        cumulativeRefundCents = nextCumulative;
        cumulativeCommissionCents = nextTarget;
        if (alreadyByRefund.has(refund.id)) continue;
        if (adjustment <= 0) continue;
        const payload = { affiliate_record_id: assoc.payload.affiliate_record_id, association_record_id: assoc.id, coupon_record_id: couponId,
          source_payment_entry_id: payment.id, refund_payment_entry_id: refund.id, enrollment_record_id: enrollmentId, commission_type: "refund_adjustment",
          currency: String(payment.payload.currency || "BRL").toUpperCase(), amount: -adjustment / 100, source_amount: refundCents / 100,
          commission_rate_bps: Number(assoc.payload.commission_rate_bps), payment_recorded_at: new Date(refund.created_at).toISOString(), calculation_policy: "confirmed_net_proportional_v1" };
        if (await this.writeRecord(scope, actor, "commission_entry", `Estorno proporcional · ${String(payload.currency)} ${Math.abs(payload.amount).toFixed(2)}`, payload, "Ajuste proporcional a reembolso registrado; sem gerar repasse")) created++;
      }
    }
    await this.access.audit(actor, `${SUINDA_AFFILIATES}.commission.reconcile`, String(created), { type: "workspace", id: scope });
    const balance = await this.db.query<{ affiliate_record_id: string; currency: string; balance: string }>(`SELECT payload->>'affiliate_record_id' affiliate_record_id,payload->>'currency' currency,
      SUM((payload->>'amount')::numeric)::text balance FROM extension_records WHERE workspace_id=$1 AND plugin_id=$2 AND kind='commission_entry' AND state='recorded'
      GROUP BY payload->>'affiliate_record_id',payload->>'currency' ORDER BY 1,2`, [scope, SUINDA_AFFILIATES]);
    return { created_entries: created, balances: balance, transfers_executed: false };
  }
  async report(workspace: string, actor: string, cursor?: string) {
    const scope = await this.manager(workspace, actor);
    let cursorCreatedAt: Date | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, "base64url").toString("utf8").split("|");
        if (decoded.length !== 2 || !decoded[0] || !UUID.test(decoded[1]!)) throw new Error("invalid cursor");
        const parsed = new Date(decoded[0]);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== decoded[0]) throw new Error("invalid cursor");
        cursorCreatedAt = parsed;
        cursorId = decoded[1]!;
      } catch { fail("Cursor de comissões inválido.", 400); }
    }
    const rows = await this.db.query<DbRecord & { created_at: Date | string }>(
      `SELECT r.id,r.title,r.payload,r.created_at FROM extension_records r
       WHERE r.workspace_id=$1 AND r.plugin_id=$2 AND r.kind='commission_entry' AND r.state='recorded'
         AND ($3::timestamptz IS NULL OR (r.created_at,r.id)<($3::timestamptz,$4::uuid))
       ORDER BY r.created_at DESC,r.id DESC LIMIT $5`,
      [scope, SUINDA_AFFILIATES, cursorCreatedAt, cursorId, COMMISSION_PAGE_SIZE + 1],
    );
    const hasMore = rows.length > COMMISSION_PAGE_SIZE;
    const entries = rows.slice(0, COMMISSION_PAGE_SIZE);
    const last = entries[entries.length - 1];
    await this.access.audit(actor, `${SUINDA_AFFILIATES}.commission.report.read`, String(entries.length), { type: "workspace", id: scope });
    return { items: entries, next_cursor: hasMore && last ? Buffer.from(`${new Date(last.created_at).toISOString()}|${last.id}`).toString("base64url") : null };
  }
}

@Controller("extensions/suinda-affiliates/workspaces/:workspace")
export class SuindaAffiliatesController {
  constructor(@Inject(SuindaAffiliatesService) private readonly service: SuindaAffiliatesService) {}
  @Get("affiliates") listAffiliates(@Param("workspace") workspace: string, @Req() req: AccessRequest) { return this.service.listAffiliates(workspace, String(req.orbitUser)); }
  @Get("coupons") coupons(@Param("workspace") workspace: string, @Req() req: AccessRequest) { return this.service.listCoupons(workspace, String(req.orbitUser)); }
  @Post("affiliates") create(@Param("workspace") workspace: string, @Req() req: AccessRequest, @Body() body: unknown) { return this.service.createAffiliate(workspace, String(req.orbitUser), body); }
  @Get("associations") listAssociations(@Param("workspace") workspace: string, @Req() req: AccessRequest) { return this.service.listAssociations(workspace, String(req.orbitUser)); }
  @Post("associations") associate(@Param("workspace") workspace: string, @Req() req: AccessRequest, @Body() body: unknown) { return this.service.associateCoupon(workspace, String(req.orbitUser), body); }
  @Post("commissions/reconcile") reconcile(@Param("workspace") workspace: string, @Req() req: AccessRequest) { return this.service.reconcile(workspace, String(req.orbitUser)); }
  @Get("commissions") report(@Param("workspace") workspace: string, @Req() req: AccessRequest, @Query("cursor") cursor?: string) { return this.service.report(workspace, String(req.orbitUser), cursor); }
}

export const suindaAffiliatesPlugin: PluginDefinition = {
  id: SUINDA_AFFILIATES, parentPlugin: "suinda-learning", name: "Afiliados e comissões Suindá", version: "1.0.0",
  description: "Atribui cupons a afiliados e mantém apuração auditável de comissões líquidas sem executar transferências.", dependencies: ["suinda-learning"],
  handlesRoute: (path) => /^\/extensions\/suinda-affiliates\/workspaces\/[0-9a-f-]{36}\/(?:affiliates|coupons|associations|commissions(?:\/reconcile)?)$/.test(path),
  routePermission: () => null, capabilities: [{ id: "manage", name: "Gerenciar afiliados e comissões", permissions: [PERMISSION] }],
  contributions: { navigation: [{ id: SUINDA_AFFILIATES, label: "Afiliados e comissões", href: "/suinda/affiliates", permission: PERMISSION, order: 77 }], recordKinds: suindaAffiliateRecordKinds },
};
