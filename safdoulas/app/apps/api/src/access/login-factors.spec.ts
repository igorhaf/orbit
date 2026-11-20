import assert from "node:assert/strict";
import { test } from "node:test";
import type { LoginAccount } from "./login-attempts";
import { resolveLoginFactors } from "./login-factors";

const account = (mfa_enabled: boolean): LoginAccount => ({
  id: "00000000-0000-4000-8000-000000000001", name: "Ada", email: "ada@example.test", avatar_url: null,
  preferences: {}, is_root: false, disabled: false, email_verified: true, session_version: 0, mfa_enabled,
});

test("password authentication requests an MFA challenge before returning an account", async () => {
  const order: string[] = [];
  const result = await resolveLoginFactors("ada@example.test", null, null, async () => account(true), {
    async completeChallenge() { throw new Error("not expected"); },
    async requestLogin(userId) { order.push(`challenge:${userId}`); return { challenge_id: "challenge", email_hint: "a•••@example.test" }; },
  }, async () => { order.push("password-verified"); });
  assert.deepEqual(result, { kind: "challenge", email: account(true).email, challenge: { challenge_id: "challenge", email_hint: "a•••@example.test" } });
  assert.deepEqual(order, ["password-verified", `challenge:${account(true).id}`]);
});

test("valid MFA completion returns the account and clears authentication failure state", async () => {
  let cleared = 0;
  const result = await resolveLoginFactors("ada@example.test", "challenge", "123456", async () => { throw new Error("password must not be checked"); }, {
    async completeChallenge(id, code, purpose) { assert.equal(id, "challenge"); assert.equal(code, "123456"); assert.equal(purpose, "login"); return account(true); },
    async requestLogin() { throw new Error("a second challenge must not be sent"); },
  }, async verified => { assert.equal(verified.id, account(true).id); cleared++; });
  assert.deepEqual(result, { kind: "account", account: account(true) });
  assert.equal(cleared, 1);
});

test("rejects mismatched email and rejects MFA completion for an account without MFA", async () => {
  const mfa = {
    async completeChallenge() { return account(false); },
    async requestLogin() { return { challenge_id: "challenge", email_hint: "a•••@example.test" }; },
  };
  await assert.rejects(() => resolveLoginFactors("other@example.test", "challenge", "123456", async () => null, mfa), /Código inválido ou expirado/);
  await assert.rejects(() => resolveLoginFactors("ada@example.test", "challenge", "123456", async () => null, mfa), /Código inválido ou expirado/);
});

test("password-only accounts pass through without requesting MFA", async () => {
  let requested = 0;
  const result = await resolveLoginFactors("ada@example.test", null, null, async () => account(false), {
    async completeChallenge() { throw new Error("not expected"); },
    async requestLogin() { requested++; return { challenge_id: "challenge", email_hint: "a•••@example.test" }; },
  });
  assert.deepEqual(result, { kind: "account", account: account(false) });
  assert.equal(requested, 0);
});
