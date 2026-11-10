import assert from "node:assert/strict";
import test from "node:test";
import { AuthLifecycle } from "./auth-lifecycle";

function lifecycle(existing: Record<string, unknown> | undefined) {
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      statements.push({ sql, values });
      if (sql.includes("SELECT id,email_verified,is_root,disabled FROM users")) return { rows: existing ? [existing] : [] };
      if (sql.startsWith("INSERT INTO users")) return { rows: [{ id: "00000000-0000-4000-8000-000000000101" }] };
      return { rows: [] };
    },
  };
  const db = { query: async () => [{ requests: 1 }] };
  const auth = new AuthLifecycle(db as never, {} as never, {} as never);
  return { auth, client, statements };
}

test("convite de equipe cria conta pendente com somente o papel base e token de ativação", async () => {
  const oldProduct = process.env.ORBIT_PRODUCT;
  process.env.ORBIT_PRODUCT = "suinda";
  try {
    const { auth, client, statements } = lifecycle(undefined);
    const prepared = await auth.prepareSuindaStaffInvitation(client as never, " DOCENTE@example.com ", " Docente ");
    assert.equal(prepared.active, false);
    assert.equal(prepared.email, "docente@example.com");
    assert.ok(prepared.token);
    assert.ok(statements.some(({ sql }) => sql.includes("INSERT INTO access_grants(user_id,role_id) VALUES($1,'user')")));
    assert.ok(!statements.some(({ sql }) => sql.includes("suinda_student") || sql.includes("coordinator")));
    assert.ok(statements.some(({ sql }) => sql.includes("VALUES($1,$2,'invite',now()+interval '30 minutes')")));
  } finally {
    if (oldProduct === undefined) delete process.env.ORBIT_PRODUCT;
    else process.env.ORBIT_PRODUCT = oldProduct;
  }
});

test("conta ativa existente é devolvida sem editar nome, estado ou papéis", async () => {
  const oldProduct = process.env.ORBIT_PRODUCT;
  process.env.ORBIT_PRODUCT = "suinda";
  try {
    const existing = { id: "00000000-0000-4000-8000-000000000102", email_verified: true, is_root: false, disabled: false };
    const { auth, client, statements } = lifecycle(existing);
    const prepared = await auth.prepareSuindaStaffInvitation(client as never, "active@example.com", "Novo nome não aplicado");
    assert.deepEqual(prepared, { user_id: existing.id, token: null, email: "active@example.com", active: true });
    assert.equal(statements.some(({ sql }) => /INSERT INTO access_grants|UPDATE users|INSERT INTO account_auth_tokens/.test(sql)), false);
  } finally {
    if (oldProduct === undefined) delete process.env.ORBIT_PRODUCT;
    else process.env.ORBIT_PRODUCT = oldProduct;
  }
});

test("convite de equipe recusa conta ROOT e conta desativada", async () => {
  const oldProduct = process.env.ORBIT_PRODUCT;
  process.env.ORBIT_PRODUCT = "suinda";
  try {
    for (const existing of [
      { id: "root", email_verified: true, is_root: true, disabled: false },
      { id: "disabled", email_verified: true, is_root: false, disabled: true },
    ]) {
      const { auth, client } = lifecycle(existing);
      await assert.rejects(auth.prepareSuindaStaffInvitation(client as never, "staff@example.com", "Staff"));
    }
  } finally {
    if (oldProduct === undefined) delete process.env.ORBIT_PRODUCT;
    else process.env.ORBIT_PRODUCT = oldProduct;
  }
});
