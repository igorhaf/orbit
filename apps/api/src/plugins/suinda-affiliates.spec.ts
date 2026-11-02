import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { suindaAffiliatesPlugin, suindaAffiliateRecordKinds, SuindaAffiliatesService } from "./suinda-affiliates";

const workspace = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const affiliateId = "33333333-3333-4333-8333-333333333333";
const couponId = "44444444-4444-4444-8444-444444444444";
const enrollmentId = "55555555-5555-4555-8555-555555555555";
const paymentId = "66666666-6666-4666-8666-666666666666";
const refund1 = "77777777-7777-4777-8777-777777777777";
const refund2 = "88888888-8888-4888-8888-888888888888";
const associationId = "99999999-9999-4999-8999-999999999999";
const at = new Date("2026-10-01T00:00:00Z");

function harness(overrides: { permission?: boolean; affiliate?: unknown; coupon?: unknown; previous?: unknown; commissionRows?: unknown[] } = {}) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const written: Array<{ kind: string; payload: Record<string, unknown>; actor: string }> = [];
  const audits: unknown[][] = [];
  const refundEntries = new Set<string>();
  let earned = false;
  const db = {
    pool: { async connect() { return { async query(sql: string, args: unknown[] = []) {
      calls.push({ sql, args });
      if (sql.includes("INSERT INTO extension_records")) {
        const kind = String(args[2]); const payload = JSON.parse(String(args[4])) as Record<string, unknown>;
        written.push({ kind, payload, actor: String(args[5]) });
        if (kind === "commission_entry" && payload.commission_type === "earned") earned = true;
        if (kind === "commission_entry" && payload.commission_type === "refund_adjustment") refundEntries.add(String(payload.refund_payment_entry_id));
        return { rows: [{ id: kind === "affiliate" ? affiliateId : associationId }] };
      }
      return { rows: [] };
    }, release() {} }; } },
    async one(sql: string, args: unknown[] = []) {
      calls.push({ sql, args });
      if (sql.includes("FROM workspaces")) return { id: workspace };
      if (sql.includes("FROM users")) return { id: actor };
      if (sql.includes("AND kind='affiliate'")) return overrides.affiliate === undefined ? { id: affiliateId, title: "Parceiro", payload: {} } : overrides.affiliate;
      if (sql.includes("AND kind='enrollment_coupon'")) return overrides.coupon === undefined ? { id: couponId, title: "SUINDA", payload: { code: "SUINDA" } } : overrides.coupon;
      if (sql.includes("kind='enrollment'")) return { id: enrollmentId, payload: { coupon_record_id: couponId } };
      if (sql.includes("kind='affiliate_coupon'") && sql.includes("created_at <=")) return { id: associationId, created_at: at, payload: { affiliate_record_id: affiliateId, coupon_record_id: couponId, commission_rate_bps: 1000 } };
      if (sql.includes("kind='affiliate_coupon'")) return overrides.previous === undefined ? null : overrides.previous;
      if (sql.includes("commission_type'='earned")) return earned ? { id: "exists" } : null;
      return null;
    },
    async query(sql: string, args: unknown[] = []) {
      calls.push({ sql, args });
      if (sql.includes("FROM extension_records r") && sql.includes("commission_entry")) return overrides.commissionRows || [];
      if (sql.includes("p.kind='payment_entry'")) return [{ id: paymentId, workspace_id: workspace, plugin_id: "suinda-learning", kind: "payment_entry", title: "Pagamento", state: "recorded", revision: 1, payload: { enrollment_record_id: enrollmentId, amount: 100, currency: "BRL", payment_method: "pix" }, created_at: at }];
      if (sql.includes("payload->>'payment_method'='refund'")) return [
        { id: refund1, workspace_id: workspace, plugin_id: "suinda-learning", kind: "payment_entry", title: "Estorno 1", state: "recorded", revision: 1, payload: { amount: 25, payment_method: "refund" }, created_at: new Date("2026-10-02T00:00:00Z") },
        { id: refund2, workspace_id: workspace, plugin_id: "suinda-learning", kind: "payment_entry", title: "Estorno 2", state: "recorded", revision: 1, payload: { amount: 100, payment_method: "refund" }, created_at: new Date("2026-10-03T00:00:00Z") },
      ];
      if (sql.includes("commission_type'='refund_adjustment")) return [...refundEntries].map((refund_payment_entry_id) => ({ payload: written.find((x) => x.payload.refund_payment_entry_id === refund_payment_entry_id)?.payload || {} }));
      if (sql.includes("SUM((payload->>'amount')")) return [{ affiliate_record_id: affiliateId, currency: "BRL", balance: "0.00" }];
      return [];
    },
  };
  const access = { async has() { return overrides.permission !== false; }, async audit(...args: unknown[]) { audits.push(args); } };
  const registry = { isEnabled(id: string) { return id === "suinda-affiliates"; } };
  return { service: new SuindaAffiliatesService(db as never, access as never, registry as never), calls, written, audits };
}

test("plugin is an optional child of Suindá and contributes manager-scoped, server-created ledger records", () => {
  assert.equal(suindaAffiliatesPlugin.parentPlugin, "suinda-learning");
  assert.deepEqual(suindaAffiliatesPlugin.dependencies, ["suinda-learning"]);
  assert.equal(suindaAffiliatesPlugin.handlesRoute?.(`/extensions/suinda-affiliates/workspaces/${workspace}/commissions/reconcile`), true);
  assert.equal(suindaAffiliatesPlugin.handlesRoute?.(`/extensions/suinda-affiliates/workspaces/${workspace}/coupons`), true);
  assert.equal(suindaAffiliatesPlugin.contributions?.navigation?.[0]?.href, "/suinda/affiliates");
  assert.equal(suindaAffiliatesPlugin.handlesRoute?.(`/extensions/suinda-affiliates/workspaces/${workspace}/commissions/reconcile/other`), false);
  assert.equal(suindaAffiliateRecordKinds.commission_entry.serverCreated, true);
  assert.equal(suindaAffiliateRecordKinds.commission_entry.transitions.recorded.length, 0);
  assert.equal(suindaAffiliateRecordKinds.affiliate_coupon.immutable?.includes("commission_rate_bps"), true);
});

test("affiliate creation validates input, existing active account and workspace permission", async () => {
  const { service, calls, written } = harness();
  const created = await service.createAffiliate(workspace, actor, { display_name: " Parceiro ", user_id: actor });
  assert.equal(created.display_name, "Parceiro");
  assert.equal(written[0].kind, "affiliate");
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO extension_record_versions")));
  await assert.rejects(service.createAffiliate(workspace, actor, { display_name: "X", extra: true }), (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  const denied = harness({ permission: false });
  await assert.rejects(denied.service.createAffiliate(workspace, actor, { display_name: "Parceiro" }), (error: unknown) => error instanceof HttpException && error.getStatus() === 403);
});

test("coupon association is workspace-bound and each commission rate is a separately versioned record", async () => {
  const { service, written } = harness();
  const first = await service.associateCoupon(workspace, actor, { affiliate_record_id: affiliateId, coupon_record_id: couponId, commission_rate_bps: 1000 });
  const next = await service.associateCoupon(workspace, actor, { affiliate_record_id: affiliateId, coupon_record_id: couponId, commission_rate_bps: 1250 });
  assert.equal(first.commission_rate_bps, 1000);
  assert.equal(next.commission_rate_bps, 1250);
  assert.equal(written.filter((row) => row.kind === "affiliate_coupon").length, 2);
  await assert.rejects(service.associateCoupon(workspace, actor, { affiliate_record_id: affiliateId, coupon_record_id: couponId, commission_rate_bps: 10001 }), (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  const collision = harness({ previous: { id: "old", payload: { affiliate_record_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } });
  await assert.rejects(collision.service.associateCoupon(workspace, actor, { affiliate_record_id: affiliateId, coupon_record_id: couponId, commission_rate_bps: 1000 }), (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
});

test("reconcile records confirmed attributed payments and proportional refund adjustments once", async () => {
  const { service, written, audits } = harness();
  const first = await service.reconcile(workspace, actor);
  assert.equal(first.created_entries, 3);
  assert.equal(first.transfers_executed, false);
  const entries = written.filter((row) => row.kind === "commission_entry");
  assert.deepEqual(entries.map((row) => row.payload.amount), [10, -2.5, -7.5]);
  assert.deepEqual(entries.map((row) => row.payload.commission_type), ["earned", "refund_adjustment", "refund_adjustment"]);
  assert.equal(entries.reduce((sum, row) => sum + Number(row.payload.amount), 0), 0, "reembolso acima do pagamento original não pode estornar comissão extra");
  assert.ok(first.balances);
  await service.reconcile(workspace, actor);
  assert.equal(written.filter((row) => row.kind === "commission_entry").length, 3);
  assert.equal(audits.filter((entry) => String(entry[1]).endsWith("commission.reconcile")).length, 2);
});

test("commission report paginates past 2,000 entries with a stable workspace-scoped cursor", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, title: `Comissão ${index + 1}`,
    payload: { commission_type: "earned", currency: "BRL", amount: 1, source_amount: 10 },
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 101 - index)),
  }));
  const { service, calls, audits } = harness({ commissionRows: rows });
  const page = await service.report(workspace, actor);
  assert.equal(page.items.length, 100);
  assert.ok(page.next_cursor);
  const query = calls.find((call) => call.sql.includes("FROM extension_records r") && call.sql.includes("commission_entry"));
  assert.match(query!.sql, /ORDER BY r\.created_at DESC,r\.id DESC LIMIT \$5/);
  assert.ok(!query!.sql.includes("LIMIT 2000"));
  assert.equal(query!.args[0], workspace);
  assert.equal(query!.args[4], 101);
  assert.equal(audits.filter((entry) => String(entry[1]).endsWith("commission.report.read")).length, 1);
  await assert.rejects(service.report(workspace, actor, "not-a-valid-cursor"), (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
});
