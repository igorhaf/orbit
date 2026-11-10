import assert from "node:assert/strict";
import test from "node:test";
import { FeaturesController, FeaturesService } from "./features";

function preferencesFixture(failOn?: string) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let preferences: Record<string, unknown> = { notifications: true, emailNotifications: false };
  let savedPreferences: Record<string, unknown> | null = null;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      if (sql === "BEGIN") savedPreferences = { ...preferences };
      if (failOn && sql.includes(failOn)) throw new Error("transaction failure");
      if (sql.includes("UPDATE users SET preferences")) preferences = { ...preferences, ...JSON.parse(String(params[1])) as Record<string, unknown> };
      if (sql === "ROLLBACK" && savedPreferences) preferences = savedPreferences;
      return { rows: [], rowCount: 1 };
    },
    release() { statements.push({ sql: "RELEASE", params: [] }); },
  };
  const db = {
    pool: { async connect() { return client; } },
    async query() { return []; },
    async one(sql: string) {
      if (sql.includes("FROM users")) return { id: "00000000-0000-4000-8000-000000000001", name: "Pessoa", email: "person@example.test", preferences };
      return null;
    },
  };
  const access = { async me() { return { permissions: [] }; } };
  return { service: new FeaturesService(db as never, undefined, access as never), statements, getPreferences: () => preferences };
}

test("email opt-out transactionally cancels only pending email deliveries", async () => {
  const { service, statements } = preferencesFixture();
  const enabled = await service.updatePreferences("00000000-0000-4000-8000-000000000001", { emailNotifications: true });
  assert.equal((enabled as { preferences: Record<string, unknown> }).preferences.emailNotifications, true);
  assert.equal(statements.some((statement) => statement.sql.includes("notification_email_deliveries")), false);

  statements.length = 0;
  const disabled = await service.updatePreferences("00000000-0000-4000-8000-000000000001", { emailNotifications: false });
  assert.equal((disabled as { preferences: Record<string, unknown> }).preferences.emailNotifications, false);
  const sql = statements.map((statement) => statement.sql);
  assert.equal(sql[0], "BEGIN");
  assert.match(sql[1], /UPDATE users SET preferences/);
  assert.match(sql[2], /UPDATE notification_email_deliveries SET status='cancelled'.*status='pending'/);
  assert.equal(sql.some((statement) => statement.includes("notification_push_deliveries")), false);
  assert.equal(sql[3], "COMMIT");
  assert.equal(sql[4], "RELEASE");
  await assert.rejects(service.updatePreferences("00000000-0000-4000-8000-000000000001", { emailNotifications: "yes" }), /Preferência emailNotifications inválida/);
});

test("global opt-out cancels pending email and push deliveries in the preference transaction", async () => {
  const { service, statements } = preferencesFixture();
  await service.updatePreferences("00000000-0000-4000-8000-000000000001", { notifications: false });
  const sql = statements.map((statement) => statement.sql);
  assert.deepEqual(sql.slice(0, 6), [
    "BEGIN",
    "UPDATE users SET preferences=preferences || $2::jsonb WHERE id=$1",
    "UPDATE notification_email_deliveries SET status='cancelled',updated_at=now() WHERE user_id=$1 AND status='pending'",
    "UPDATE notification_push_deliveries SET status='cancelled',updated_at=now() WHERE user_id=$1 AND status='pending'",
    "COMMIT",
    "RELEASE",
  ]);
});

test("failed queue cancellation rolls back the preference change", async () => {
  const { service, statements, getPreferences } = preferencesFixture("notification_push_deliveries");
  await assert.rejects(service.updatePreferences("00000000-0000-4000-8000-000000000001", { notifications: false }), /transaction failure/);
  assert.equal(getPreferences().notifications, true);
  assert.equal(statements.at(-2)?.sql, "ROLLBACK");
  assert.equal(statements.at(-1)?.sql, "RELEASE");
  assert.equal(statements.some((statement) => statement.sql === "COMMIT"), false);
});

test("security activity returns localized allowlisted events without audit payloads",async()=>{
  const db={async query(sql:string,args:unknown[]){assert.match(sql,/actor_id=\$1/);assert.match(sql,/action=ANY\(\$2::text\[\]\)/);assert.equal(args[0],"account-1");return[
    {id:"1",action:"account.email_change.completed",created_at:new Date("2026-02-03T00:00:00Z"),target:"private@example.test"},
    {id:"2",action:"account.email_change.admin_requested",created_at:new Date("2026-02-02T00:00:00Z"),target:"other-account"},
    {id:"3",action:"account.access.admin_changed",created_at:new Date("2026-02-04T00:00:00Z"),target:"account-1"},
  ]}};
  const service=new FeaturesService(db as never);
  assert.deepEqual(await service.securityActivity("account-1"),[
    {id:"1",label:"E-mail alterado",created_at:new Date("2026-02-03T00:00:00Z")},
    {id:"3",label:"Acesso atualizado pela administração",created_at:new Date("2026-02-04T00:00:00Z")},
  ]);
});

test("account history is private to the signed-in identity even under root act-as",()=>{
  const controller=new FeaturesController(new FeaturesService({} as never),{} as never,{} as never) as unknown as {accountHistoryUser(req:unknown):string};
  assert.equal(controller.accountHistoryUser({orbitActor:"account-1",orbitUser:"account-1"}),"account-1");
  assert.throws(()=>controller.accountHistoryUser({orbitActor:"root",orbitUser:"account-1"}),/somente ao titular/);
});
