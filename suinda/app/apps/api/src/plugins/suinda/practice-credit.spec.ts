import test from "node:test";
import assert from "node:assert/strict";
import { allocatePracticeCredit, SuindaLearningService } from "./suinda.service";
import { suindaPlugin } from "./suinda.plugin";

const workspace = "00000000-0000-4000-8000-000000000001";
const request = "00000000-0000-4000-8000-000000000002";
const enrollment = "00000000-0000-4000-8000-000000000003";
const unitA = "00000000-0000-4000-8000-000000000004";
const unitB = "00000000-0000-4000-8000-000000000005";

test("alocação consome horas supervisionadas por prática sem ultrapassar o saldo auditado", () => {
  assert.deepEqual(allocatePracticeCredit(3, [
    { id: "practice-b", hours_validated: 4, credited_hours: 2 },
    { id: "practice-a", hours_validated: 2, credited_hours: 0.5 },
  ]), [
    { practice_record_id: "practice-a", hours_credited: 1.5 },
    { practice_record_id: "practice-b", hours_credited: 1.5 },
  ]);
  assert.equal(allocatePracticeCredit(5, [{ id: "practice-a", hours_validated: 2, credited_hours: 1 }]), null);
  assert.equal(allocatePracticeCredit(0, [{ id: "practice-a", hours_validated: 2, credited_hours: 0 }]), null);
});

test("rotas de crédito ficam limitadas às permissões acadêmicas e ao titular", () => {
  const policy = `/extensions/suinda-learning/workspaces/${workspace}/practice-credit-policy`;
  const own = "/extensions/suinda-learning/me/practice-credit-requests";
  const create = `/extensions/suinda-learning/me/enrollments/${enrollment}/practice-credit-requests`;
  const queue = `/extensions/suinda-learning/workspaces/${workspace}/practice-credit-requests`;
  const review = `${queue}/${request}/review`;
  assert.equal(suindaPlugin.handlesRoute?.(policy), true);
  assert.equal(suindaPlugin.routePermission?.(policy, "GET"), "plugin.suinda-learning.read");
  assert.equal(suindaPlugin.routePermission?.(policy, "PUT"), "plugin.suinda-learning.manage");
  assert.equal(suindaPlugin.routePermission?.(own, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(create, "POST"), "plugin.suinda-learning.read");
  assert.equal(suindaPlugin.routePermission?.(queue, "GET"), "plugin.suinda-learning.manage");
  assert.equal(suindaPlugin.routePermission?.(review, "POST"), "plugin.suinda-learning.manage");
  assert.equal(suindaPlugin.handlesRoute?.(`${queue}/not-a-uuid/review`), false);
});

test("fila multiunidade filtra antes da projeção e exige grants de gestão nos dois polos", async () => {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const db = { async query(sql: string, args: unknown[] = []) { statements.push({ sql, args }); return []; } };
  const service = new SuindaLearningService(db as never, {
    async has() { return false; }, async hasScoped(_user: string, _permission: string, _type: string, id: string) { return id === unitA; }, async audit() {},
  } as never, { isEnabled() { return true; } } as never, {} as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  { async authorizedUnits() { return [{ workspace_id: workspace, id: unitA }, { workspace_id: workspace, id: unitB }]; } } as never);

  assert.deepEqual(await service.practiceCreditRequests(workspace, "unit-manager"), []);
  assert.equal(statements.length, 1);
  assert.equal(statements[0].args[1], false);
  assert.deepEqual(statements[0].args[2], [unitA]);
  assert.equal(statements[0].args[3], null);
  assert.equal(statements[0].args[4], 500);
  assert.equal((statements[0].sql.match(/=ANY\(\$3::text\[\]\)/g) || []).length, 2,
    "SQL limita origem e destino antes de projetar nomes ou ledger");

  const noGrant = new SuindaLearningService(db as never, {
    async has() { return false; }, async hasScoped() { return false; },
  } as never, { isEnabled() { return true; } } as never, {} as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  { async authorizedUnits() { return [{ workspace_id: workspace, id: unitA }]; } } as never);
  await assert.rejects(noGrant.practiceCreditRequests(workspace, "reader"), /gestão acadêmica/);
});

test("decidir crédito de prática exige grant tanto na matrícula de origem quanto na de destino", async () => {
  let connected = false;
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM suinda_practice_credit_requests")) return { source_enrollment_id: enrollment, target_enrollment_id: request };
      return null;
    },
    pool: { async connect() { connected = true; throw new Error("A decisão não pode iniciar sem os dois grants."); } },
  };
  const service = new SuindaLearningService(db as never, {
    async has() { return false; }, async hasScoped() { return false; },
  } as never, { isEnabled() { return true; } } as never, {} as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  { async canManageRecord(_user: string, recordId: string) { return recordId === enrollment; } } as never);
  await assert.rejects(service.reviewPracticeCreditRequest(workspace, request, "unit-manager", {
    operation_key: "00000000-0000-4000-8000-000000000006", decision: "approved",
  }), /origem e destino/);
  assert.equal(connected, false);
});

test("fila de crédito prático pagina todos os pedidos e mantém pendentes primeiro", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    status: index % 2 === 0 ? "pending" : "approved",
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 501 - index)),
  }));
  const cursors: Array<string | null> = [];
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const audits: string[] = [];
  const db = { async query(sql: string, args: unknown[] = []) {
    queries.push({ sql, args });
    const cursor = args[3] as string | null;
    cursors.push(cursor);
    return rows.filter((row) => cursor === null || row.id > cursor).slice(0, Number(args[4]));
  } };
  const service = new SuindaLearningService(db as never, {
    async has() { return false; }, async hasScoped(_user: string, _permission: string, _type: string, id: string) { return id === unitA; },
    async audit(_user: string, _action: string, target: string) { audits.push(target); },
  } as never, { isEnabled() { return true; } } as never, {} as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  { async authorizedUnits() { return [{ workspace_id: workspace, id: unitA }, { workspace_id: workspace, id: unitB }]; } } as never);

  const result = await service.practiceCreditRequests(workspace, "unit-manager");

  assert.equal(result.length, 501);
  assert.deepEqual(cursors, [null, rows[499]!.id]);
  assert.equal(result[0]!.status, "pending");
  assert.deepEqual([...audits].sort(), rows.map((row) => row.id).sort());
  assert.equal(queries.length, 2);
  for (const { sql, args } of queries) {
    assert.equal((sql.match(/=ANY\(\$3::text\[\]\)/g) || []).length, 2);
    assert.deepEqual(args.slice(0, 3), [workspace, false, [unitA]]);
  }
});
