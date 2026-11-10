import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import { MfaService } from "./mfa";
import type { Db } from "../db";

function database(query: (sql: string, args?: unknown[]) => Promise<{ rows: unknown[] }>) {
  const calls: string[] = [];
  const client = {
    async query(sql: string, args?: unknown[]) { calls.push(sql); return query(sql, args); },
    release() {},
  };
  const db = {
    pool: { async connect() { return client; } },
    async query(sql: string, args?: unknown[]) { calls.push(sql); return query(sql, args); },
    async one() { return null; },
  } as unknown as Db;
  return { db, calls };
}

test("MFA code issuance applies an account and purpose hourly limit", async () => {
  let mailSent = false;
  const { db, calls } = database(async (sql) => {
    if (sql.includes("SELECT email,email_verified,mfa_enabled,session_version")) return { rows: [{ email: "ada@example.test", email_verified: true, mfa_enabled: true, session_version: 0 }] };
    if (sql.includes("SELECT count(*)::text AS count")) return { rows: [{ count: "5" }] };
    return { rows: [] };
  });
  const service = new MfaService(db, { async send() {}, async sendMessage() { mailSent = true; return {}; } });
  await assert.rejects(() => service.requestLogin("00000000-0000-4000-8000-000000000001"), (error: unknown) => error instanceof HttpException && error.getStatus() === 429);
  assert.ok(calls.some((sql) => sql.includes("pg_advisory_xact_lock")));
  assert.equal(calls.some((sql) => sql.includes("INSERT INTO auth_mfa_challenges")), false);
  assert.equal(mailSent, false);
});

test("failed MFA codes commit the attempt count without a post-commit rollback", async () => {
  const { db, calls } = database(async (sql) => {
    if (sql.includes("SELECT c.id,c.user_id")) return { rows: [{
      id: "00000000-0000-4000-8000-000000000009", user_id: "00000000-0000-4000-8000-000000000001", purpose: "login",
      code_hash: "0".repeat(64), attempts: 0, expires_at: new Date(Date.now() + 60_000), consumed_at: null,
      challenge_session_version: 0, name: "Ada", email: "ada@example.test", avatar_url: null, preferences: {},
      is_root: false, disabled: false, email_verified: true, session_version: 0, mfa_enabled: true,
    }] };
    return { rows: [] };
  });
  const service = new MfaService(db, { async send() {} });
  await assert.rejects(() => service.completeChallenge("00000000-0000-4000-8000-000000000009", "123456", "login"), /Código inválido ou expirado/);
  assert.ok(calls.some((sql) => sql.includes("attempts=attempts+1")));
  assert.equal(calls.filter((sql) => sql === "COMMIT").length, 1);
  assert.equal(calls.includes("ROLLBACK"), false);
});
