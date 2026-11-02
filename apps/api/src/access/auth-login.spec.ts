import assert from "node:assert/strict";
import { test } from "node:test";
import type { LoginAccount } from "./login-attempts";
import { resolveLoginFactors } from "./auth-login";

const account = (mfa_enabled: boolean): LoginAccount => ({
  id: "00000000-0000-4000-8000-000000000001", name: "Ada", email: "ada@example.test", avatar_url: null,
  preferences: {}, is_root: false, disabled: false, email_verified: true, session_version: 0, mfa_enabled,
});

test("password auth with MFA returns a challenge before a session account", async () => {
  let requested = 0;
  let passwordReservationReleased = 0;
  const result = await resolveLoginFactors("ada@example.test", null, null, async () => account(true), {
    async completeChallenge() { throw new Error("not expected"); },
    async requestLogin() { requested++; return { challenge_id: "challenge", email_hint: "a•••@example.test" }; },
  }, async () => { passwordReservationReleased++; });
  assert.equal(requested, 1);
  assert.equal(passwordReservationReleased, 1);
  assert.deepEqual(result, { kind: "challenge", email: "ada@example.test", challenge: { challenge_id: "challenge", email_hint: "a•••@example.test" } });
});

test("MFA completion accepts only the account matching the login email", async () => {
  const result = await resolveLoginFactors("ada@example.test", "challenge", "123456", async () => null, {
    async completeChallenge() { return account(true); },
    async requestLogin() { throw new Error("not expected"); },
  });
  assert.deepEqual(result, { kind: "account", account: account(true) });
  await assert.rejects(() => resolveLoginFactors("other@example.test", "challenge", "123456", async () => null, {
    async completeChallenge() { return account(true); },
    async requestLogin() { throw new Error("not expected"); },
  }), /Código inválido ou expirado/);
});
