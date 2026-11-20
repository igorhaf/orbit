import assert from "node:assert/strict";
import test from "node:test";
import { FeaturesController, FeaturesService } from "./features";

function preferencesService(failOn?: string) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      if (failOn && sql.includes(failOn)) throw new Error("transaction failure");
      return { rows: [] };
    },
    release() { statements.push({ sql: "RELEASE", params: [] }); },
  };
  const db = {
    pool: { async connect() { return client; } },
    async one() { return { id: "user-1", preferences: {} }; },
    async query() { return []; },
  };
  return { service: new FeaturesService(db as never), statements };
}

test("global notification opt-out atomically cancels pending email and push deliveries", async () => {
  const { service, statements } = preferencesService();
  await service.updatePreferences("user-1", { notifications: false });
  const sql = statements.map((statement) => statement.sql);
  assert.equal(sql[0], "BEGIN");
  assert.match(sql[1], /UPDATE users SET preferences/);
  assert.match(sql[2], /UPDATE notification_email_deliveries SET status='cancelled'.*status='pending'/);
  assert.match(sql[3], /UPDATE notification_push_deliveries SET status='cancelled'.*status='pending'/);
  assert.equal(sql[4], "COMMIT");
  assert.equal(sql[5], "RELEASE");
});

test("email opt-out atomically cancels email only and keeps push subscriptions queued", async () => {
  const { service, statements } = preferencesService();
  await service.updatePreferences("user-1", { emailNotifications: false });
  const sql = statements.map((statement) => statement.sql);
  assert.equal(sql[0], "BEGIN");
  assert.match(sql[2], /UPDATE notification_email_deliveries SET status='cancelled'.*status='pending'/);
  assert.equal(sql.some((statement) => statement.includes("notification_push_deliveries")), false);
  assert.equal(sql.at(-2), "COMMIT");
  assert.equal(sql.at(-1), "RELEASE");
});

test("failed opt-out cancellation rolls the preference update back", async () => {
  const { service, statements } = preferencesService("notification_push_deliveries");
  await assert.rejects(service.updatePreferences("user-1", { notifications: false }), /transaction failure/);
  assert.equal(statements.at(-2)?.sql, "ROLLBACK");
  assert.equal(statements.at(-1)?.sql, "RELEASE");
  assert.equal(statements.some((statement) => statement.sql === "COMMIT"), false);
});

test("security activity exposes only allowlisted labels for the requested account", async () => {
  const db = { async query(sql:string,args:unknown[]) {
    assert.match(sql,/actor_id=\$1/);
    assert.match(sql,/action=ANY\(\$2::text\[\]\)/);
    assert.deepEqual(args[0],"user-1");
    return [
      {id:"1",action:"account.password.changed",created_at:new Date("2026-01-01T00:00:00Z"),target:"secret@example.test"},
      {id:"2",action:"user.updated",created_at:new Date("2026-01-02T00:00:00Z"),target:"another-user"},
      {id:"3",action:"account.password.admin_changed",created_at:new Date("2026-01-03T00:00:00Z"),target:"user-1"},
    ];
  } };
  const service = new FeaturesService(db as never);
  assert.deepEqual(await service.securityActivity("user-1"),[
    {id:"1",label:"Senha alterada",created_at:new Date("2026-01-01T00:00:00Z")},
    {id:"3",label:"Senha redefinida pela administração",created_at:new Date("2026-01-03T00:00:00Z")},
  ]);
});

test("profile changes and their audit event commit atomically", async () => {
  const {service,statements} = preferencesService();
  await service.updateProfile("user-1",{name:"Novo nome"});
  assert.deepEqual(statements.slice(0,4).map(item=>item.sql),[
    "BEGIN",
    "UPDATE users SET name=COALESCE($2,name),avatar_url=CASE WHEN $3::boolean THEN $4::text ELSE avatar_url END WHERE id=$1",
    "INSERT INTO access_audit(actor_id,action) VALUES($1,'account.profile.updated')",
    "COMMIT",
  ]);
});

test("account histories reject ROOT act-as requests for another account",()=>{
  const controller=new FeaturesController(new FeaturesService({} as never),{} as never,{} as never) as unknown as {accountHistoryUser(req:unknown):string};
  assert.equal(controller.accountHistoryUser({orbitActor:"user-1",orbitUser:"user-1"}),"user-1");
  assert.throws(()=>controller.accountHistoryUser({orbitActor:"root",orbitUser:"user-1"}),/somente ao titular/);
});
