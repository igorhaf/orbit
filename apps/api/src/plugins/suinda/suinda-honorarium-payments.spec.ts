import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PluginRegistry } from "../../execution/registries";
import { workspacesPlugin } from "../../workspaces/workspaces.plugin";
import { genericPlugins } from "../records/catalog";
import { DocumentScanner } from "../records/documents";
import { suindaPlugin } from "./suinda.plugin";
import { SuindaLearningService } from "./suinda.service";

const workspaceId = "00000000-0000-4000-8000-000000000701";
const honorariumId = "00000000-0000-4000-8000-000000000702";
const staffUserId = "00000000-0000-4000-8000-000000000703";
const managerId = "00000000-0000-4000-8000-000000000704";
const unitId = "00000000-0000-4000-8000-000000000705";
const operation = () => randomUUID();

function createHarness(manager = true, managedUnits: string[] = [], ledgerUnit: string | null = unitId, revokeOnGrantLock = false) {
  const ledger = { id: honorariumId, workspace_id: workspaceId, staff_user_id: staffUserId,
    institution_unit_record_id: ledgerUnit, amount: "100.00", currency: "BRL" };
  const payments: Array<Record<string, unknown>> = [];
  const audits: unknown[][] = [];
  const activeUnits = new Set(managedUnits);
  const locks = new Map<string, Promise<void>>();
  const acquire = async (key: string) => {
    const previous = locks.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    locks.set(key, previous.then(() => current));
    await previous;
    return () => { release(); if (locks.get(key) === current) locks.delete(key); };
  };
  const db = {
    async one(sql: string) {
      if (sql.includes("SELECT r.id FROM extension_records") && sql.includes("kind='course'")) return { id: "assigned" };
      return null;
    },
    async query() { return []; },
    pool: {
      async connect() {
        let releaseHonorarium: (() => void) | undefined;
        const releases: Array<() => void> = [];
        return {
          async query(sql: string, values: unknown[] = []) {
            if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
              if (sql === "COMMIT" || sql === "ROLLBACK") {
                releaseHonorarium?.(); releaseHonorarium = undefined;
                while (releases.length) releases.pop()?.();
              }
              return { rows: [] };
            }
            if (sql.includes("pg_advisory_xact_lock")) {
              releases.push(await acquire(String(values[0])));
              return { rows: [] };
            }
            if (sql.includes("FROM suinda_staff_honorarium_payments WHERE workspace_id=$1 AND operation_key=$2")) {
              return { rows: payments.filter((payment) => payment.workspace_id === values[0] && payment.operation_key === values[1]) };
            }
            if (sql.includes("FROM access_grants g JOIN access_roles role")) {
              if (revokeOnGrantLock) activeUnits.delete(String(values[1]));
              return { rows: activeUnits.has(String(values[1])) ? [{ role_id: "unit-manager" }] : [] };
            }
            if (sql.includes("FROM suinda_staff_honorarium_ledger") && sql.includes("FOR UPDATE")) {
              releaseHonorarium = await acquire(`honorarium:${String(values[0])}`);
              return { rows: ledger.id === values[0] && ledger.workspace_id === values[1] ? [ledger] : [] };
            }
            if (sql.includes("COALESCE(SUM(amount),0)::text")) {
              const total = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
              return { rows: [{ paid_amount: total.toFixed(2) }] };
            }
            if (sql.includes("INSERT INTO suinda_staff_honorarium_payments")) {
              const row = { id: values[0], workspace_id: values[1], honorarium_id: values[2], staff_user_id: values[3],
                paid_on: values[4], amount: values[5], currency: values[6], reference: values[7], notes: values[8],
                operation_key: values[9], created_by: values[10], created_at: "2026-10-24T00:00:00.000Z" };
              payments.push(row);
              return { rows: [row] };
            }
            if (sql.includes("INSERT INTO access_audit")) { audits.push(values); return { rows: [] }; }
            throw new Error(`Unexpected SQL in focused spec: ${sql}`);
          },
          release() {},
        };
      },
    },
  };
  const access = { async has() { return manager; }, async hasScoped(_user: string, _permission: string, _type: string, unit: string) { return activeUnits.has(unit); } };
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(suindaPlugin);
  const service = new SuindaLearningService(db as never, access as never, registry, new DocumentScanner());
  if (managedUnits.length) Object.defineProperty(service, "unitRecordAccess", { value: { async authorizedUnits() {
    return managedUnits.map((id) => ({ id, workspace_id: workspaceId }));
  } } });
  return { service, payments, audits };
}

const payload = (operation_key: string, amount: number, extras: Record<string, unknown> = {}) => ({
  operation_key, paid_on: "2026-10-24", amount, ...extras,
});

test("baixa exige gestão e repete a mesma resposta para a mesma chave e conteúdo", async () => {
  const { service, payments, audits } = createHarness();
  const key = operation();
  const first = await service.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(key, 35.5, { reference: "PIX-1" }));
  const repeated = await service.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(key, 35.5, { reference: "PIX-1" }));
  assert.deepEqual(repeated, first);
  assert.equal(payments.length, 1);
  assert.equal(audits.length, 1);
  await assert.rejects(service.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(key, 30)), /chave de operação já foi usada/i);
  assert.equal(payments.length, 1);
  assert.equal(audits.length, 1);
});

test("baixas concorrentes bloqueiam excedente e vínculo preserva workspace, pessoa e moeda do honorário", async () => {
  const { service, payments } = createHarness();
  const results = await Promise.allSettled([
    service.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(operation(), 60)),
    service.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(operation(), 50)),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].workspace_id, workspaceId);
  assert.equal(payments[0].staff_user_id, staffUserId);
  assert.equal(payments[0].currency, "BRL");
});

test("baixa não aceita gerente ausente, saldo excedido ou data inválida", async () => {
  const { service } = createHarness(false);
  await assert.rejects(service.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(operation(), 1)), /somente a gestão/i);
  const manager = createHarness(true).service;
  await assert.rejects(manager.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(operation(), 100.01)), /excede o saldo/i);
  await assert.rejects(manager.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(operation(), 1, { paid_on: "2026-02-30" })), /YYYY-MM-DD/i);
});

test("gestor de unidade pode dar baixa somente em honorário da unidade autorizada", async () => {
  const scoped = createHarness(false, [unitId]);
  const saved = await scoped.service.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(operation(), 25));
  assert.equal(saved.amount, "25.00");
  assert.equal(scoped.payments.length, 1);
  const otherUnit = "00000000-0000-4000-8000-000000000706";
  const outOfScope = createHarness(false, [unitId], otherUnit);
  await assert.rejects(outOfScope.service.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(operation(), 25)), /Gestão da unidade não autorizada/);
  assert.equal(outOfScope.payments.length, 0);
  const revoked = createHarness(false, [unitId], unitId, true);
  await assert.rejects(revoked.service.createStaffHonorariumPayment(workspaceId, honorariumId, managerId, payload(operation(), 25)), /Gestão da unidade não autorizada/);
  assert.equal(revoked.payments.length, 0, "revocation before the transactional grant lock prevents the payment insert");
});
