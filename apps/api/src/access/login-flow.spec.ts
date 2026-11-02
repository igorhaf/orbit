import assert from "node:assert/strict";
import { test } from "node:test";
import type { LoginAccount } from "./login-attempts";
import { completeLogin } from "./login-flow";

const account: LoginAccount = { id: "account-1", name: "Person", email: "person@example.test", avatar_url: null, preferences: {}, is_root: false, disabled: false, email_verified: true, session_version: 4, mfa_enabled: true };

test("MFA-enabled password authentication returns a challenge without issuing a session", async () => {
  let issued = 0, sent = 0, accepted = 0;
  const result = await completeLogin({
    email: account.email, challengeId: null, code: undefined,
    authenticate: async () => account,
    mfa: { async completeChallenge() { throw new Error("should not consume challenge"); }, async requestLogin(userId) { assert.equal(userId, account.id); sent++; return { challenge_id: "challenge-1", email_hint: "p•••@example.test" }; } },
    async onAuthenticationSuccess() { accepted++; },
    async issueSession() { issued++; return { token: "must-not-be-created" }; },
  });
  assert.deepEqual(result, { mfa_required: true, challenge_id: "challenge-1", email_hint: "p•••@example.test", email: account.email });
  assert.equal(sent, 1);
  assert.equal(accepted, 1);
  assert.equal(issued, 0);
});

test("a valid second factor is required before the login session callback runs", async () => {
  let issued = 0, accepted = 0;
  const result = await completeLogin({
    email: account.email, challengeId: "challenge-1", code: "123456",
    async authenticate() { throw new Error("password path must not run"); },
    mfa: { async completeChallenge(id, code, purpose) { assert.equal(id, "challenge-1"); assert.equal(code, "123456"); assert.equal(purpose, "login"); return account; }, async requestLogin() { throw new Error("a second challenge must not be sent"); } },
    async onAuthenticationSuccess() { accepted++; },
    async issueSession(user) { issued++; assert.equal(user.id, account.id); return { token: "session-issued-after-mfa" }; },
  });
  assert.deepEqual(result, { token: "session-issued-after-mfa" });
  assert.equal(issued, 1);
  assert.equal(accepted, 1);
});
