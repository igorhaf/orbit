import assert from "node:assert/strict";
import test from "node:test";
import { SuindaAccessProfilesService } from "./access-profiles";
import { AccessService } from "../../access/access";
import type { Db } from "../../db";

const ws = "00000000-0000-4000-8000-000000000010";
const other = "00000000-0000-4000-8000-000000000011";
const actor = "00000000-0000-4000-8000-000000000012";
const member = "00000000-0000-4000-8000-000000000013";
const root = "00000000-0000-4000-8000-000000000014";
const profile = "00000000-0000-4000-8000-000000000015";
const read = "plugin.suinda-learning.read";
const manage = "plugin.suinda-learning.manage";

function fixture() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let assigned = false; let isRoot = false; let revoked = ""; const nextId = profile;
  const db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT DISTINCT unnest")) return assigned && params[0] === ws && params[1] === member ? [{ permission: read }] : [];
      if (sql.includes("UPDATE users SET session_version")) return [{ id: params[0] }];
      if (sql.includes("INSERT INTO suinda_workspace_access_profile_members")) { assigned = true; return [{ user_id: member }]; }
      if (sql.includes("DELETE FROM suinda_workspace_access_profile_members")) { const was = assigned; assigned = false; return was ? [{ user_id: member }] : []; }
      if (sql.includes("FROM suinda_workspace_access_profile_members") && sql.includes("LIMIT 1")) return assigned ? [{ one: 1 }] : [];
      if (sql.includes("FROM suinda_workspace_access_profiles WHERE workspace_id=$1 ORDER BY")) return [];
      if (sql.includes("FROM workspace_members wm")) return [];
      if (sql.includes("RETURNING id")) return [{ id: nextId }];
      return [];
    },
    async one(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT u.is_root")) return params[1] === ws ? { is_root: isRoot } : null;
      if (sql.includes("LIMIT 1") && sql.includes("suinda_workspace_access_profile_members")) return assigned ? { one: 1 } : null;
      if (sql.includes("SELECT id FROM suinda_workspace_access_profiles")) return params[1] === ws ? { id: profile } : null;
      if (sql.includes("INSERT INTO suinda_workspace_access_profiles")) return { id: nextId };
      return null;
    },
  } as unknown as Db;
  const access = {
    registerScopedPermissionProvider(provider: (user: string, type: string, scope: string) => Promise<string[]>) { providerRef = provider; },
    async requireScoped(user: string, permission: string, type: string, scope: string) {
      assert.equal(type, "workspace"); if (scope !== ws) throw new Error("Acesso não autorizado.");
      if (user !== actor || ![manage, read].includes(permission)) throw new Error("Acesso não autorizado.");
      if (permission === read && !actorCanRead) throw new Error("Acesso não autorizado.");
    },
    catalog: () => [manage, read], revoke(user: string) { revoked = user; },
    async audit() {},
  } as unknown as AccessService;
  let actorCanRead = true;
  let providerRef: ((user: string, type: string, scope: string) => Promise<string[]>) | undefined;
  const service = new SuindaAccessProfilesService(db, access);
  service.onModuleInit();
  return { service, calls, get assigned() { return assigned; }, set isRoot(value: boolean) { isRoot = value; }, set actorCanRead(value: boolean) { actorCanRead = value; }, get revoked() { return revoked; }, provider: async (user: string, scope = ws) => providerRef!(user, "workspace", scope) };
}

test("custom grants are workspace-scoped and only visible while the user is a member", async () => {
  const f = fixture();
  await f.service.assign(actor, ws, member, profile);
  assert.deepEqual(await f.provider(member), [read]);
  assert.deepEqual(await f.provider(member, other), []);
});

test("manageable workspaces include exact workspace-scoped managers only", async () => {
  const db = {
    async query(sql: string) {
      if (sql.includes("FROM workspaces w") && sql.includes("workspace_members"))
        return [{ id: ws, name: "Unidade administrada" }, { id: other, name: "Outra unidade" }];
      return [];
    },
  } as unknown as Db;
  const access = {
    async hasScoped(user: string, permission: string, type: string, scope: string) {
      return user === actor && permission === manage && type === "workspace" && scope === ws;
    },
  } as unknown as AccessService;
  const service = new SuindaAccessProfilesService(db, access);
  assert.deepEqual(await service.manageableWorkspaces(actor), [{ id: ws, name: "Unidade administrada" }]);
});

test("AccessService exposes custom grants only in their exact workspace after membership checks", async () => {
  const db = {
    async one(sql: string, params: unknown[] = []) { return sql.includes("FROM users") ? { id: params[0], is_root: false, disabled: false, session_version: 0 } : null; },
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("SELECT DISTINCT unnest")) return params[0] === ws && params[1] === member ? [{ permission: read }] : [];
      return [];
    },
  } as unknown as Db;
  const access = new AccessService(db); access.registerPermissions([read]);
  access.registerScope("workspace", async (scope) => scope === ws);
  access.registerMembership("workspace", async (user, scope) => user === member && scope === ws);
  const service = new SuindaAccessProfilesService(db, access); service.onModuleInit();
  assert.ok((await access.effective(member, "workspace", ws)).includes(read));
  assert.equal(await access.has(member, read, "workspace", other), false);
});

test("profiles reject global privileges and permissions the manager cannot delegate", async () => {
  const f = fixture();
  await assert.rejects(f.service.save(actor, ws, undefined, { name: "Admin", permissions: ["access.manage"] }), /permissões registradas do Suindá/);
  f.actorCanRead = false;
  await assert.rejects(f.service.save(actor, ws, undefined, { name: "Leitor", permissions: [read] }), /Acesso não autorizado/);
});

test("assignment requires workspace membership, protects ROOT and revokes the target session", async () => {
  const f = fixture();
  await assert.rejects(f.service.assign(actor, other, member, profile), /Acesso não autorizado/);
  f.isRoot = true;
  await assert.rejects(f.service.assign(actor, ws, root, profile), /ROOT é protegida/);
  f.isRoot = false;
  assert.deepEqual(await f.service.assign(actor, ws, member, profile), { ok: true, changed: true });
  assert.equal(f.revoked, member);
  assert.ok(f.calls.some((call) => call.sql.includes("session_version=session_version+1") && call.params[0] === member));
});

test("assigned profiles cannot be deleted, and revocation removes the grant and revokes sessions", async () => {
  const f = fixture(); await f.service.assign(actor, ws, member, profile);
  await assert.rejects(f.service.remove(actor, ws, profile), /Revogue as atribuições/);
  assert.deepEqual(await f.service.revokeAssignment(actor, ws, member, profile), { ok: true, changed: true });
  assert.equal(f.assigned, false); assert.equal(f.revoked, member);
});
