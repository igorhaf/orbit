import assert from "node:assert/strict";
import { test } from "node:test";
import { MfaService } from "./mfa";
import type { Db } from "../db";

test("an invalid MFA code commits its attempt counter without rolling back", async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("FROM auth_mfa_challenges c JOIN users")) return { rows: [{
        id: "00000000-0000-4000-8000-000000000001", user_id: "00000000-0000-4000-8000-000000000002", purpose: "login",
        code_hash: "0".repeat(64), attempts: 0, expires_at: new Date(Date.now() + 60_000), consumed_at: null,
        challenge_session_version: 3, name: "Person", email: "person@example.test", avatar_url: null, preferences: {},
        is_root: false, disabled: false, email_verified: true, session_version: 3, mfa_enabled: true,
      }] };
      return { rows: [] };
    }, release() { statements.push("RELEASE"); },
  };
  const db = { pool: { async connect() { return client; } } } as unknown as Db;
  const service = new MfaService(db, {} as never);
  await assert.rejects(() => service.completeChallenge("00000000-0000-4000-8000-000000000001", "123456", "login"), /Código inválido/);
  assert.ok(statements.some((sql) => sql.includes("attempts=attempts+1")));
  assert.ok(statements.includes("COMMIT"));
  assert.equal(statements.includes("ROLLBACK"), false);
});

test("MFA code issuance is serialized and capped at five attempts per purpose per hour", async () => {
  const statements: string[] = [];
  let mailed = 0;
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("SELECT email,email_verified,mfa_enabled,session_version FROM users")) return { rows: [{ email: "person@example.test", email_verified: true, mfa_enabled: true, session_version: 1 }] };
      if (sql.includes("SELECT count(*)::text AS count FROM auth_mfa_challenges")) return { rows: [{ count: "5" }] };
      return { rows: [] };
    }, release() {},
  };
  const db = { pool: { async connect() { return client; } } } as unknown as Db;
  const service = new MfaService(db, { async sendMessage() { mailed++; return {}; } } as never);
  await assert.rejects(() => service.requestLogin("00000000-0000-4000-8000-000000000001"), /Limite de códigos de verificação/);
  assert.ok(statements.some((sql) => sql.includes("pg_advisory_xact_lock")));
  assert.ok(statements.some((sql) => sql.includes("created_at>now()-interval '1 hour'")));
  assert.equal(statements.some((sql) => sql.includes("INSERT INTO auth_mfa_challenges")), false);
  assert.equal(mailed, 0);
});
