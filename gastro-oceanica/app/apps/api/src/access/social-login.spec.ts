import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign as signSignature, type KeyObject } from "node:crypto";
import { test } from "node:test";
import type { Db } from "../db";
import { SocialLoginService } from "./social-login";
import type { LoginAccount } from "./login-attempts";

const issuer = "https://idp.example.test";
const clientId = "orbit-demo-client";
const clientSecret = "synthetic-client-secret";
const nonce = "fixture-nonce-value";
const verifier = "fixture-code-verifier-with-enough-entropy-for-test-only";
const state = "A".repeat(43);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "demo-key-1", alg: "RS256", use: "sig" };

const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/keys`,
};

type Claims = {
  iss: string;
  sub: string;
  aud: string | string[];
  azp?: string;
  exp: number;
  iat: number;
  nonce: string;
  email: string;
  email_verified: boolean;
  name?: string;
};

function signedIdToken(claims: Partial<Claims> = {}, signer: KeyObject = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "demo-key-1", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    sub: "synthetic-subject-001",
    aud: clientId,
    exp: now + 300,
    iat: now,
    nonce,
    email: "learner@suinda.example.test",
    email_verified: true,
    name: "Aluna de Demonstração",
    ...claims,
  })).toString("base64url");
  const input = `${header}.${payload}`;
  const signature = signSignature("RSA-SHA256", Buffer.from(input), signer).toString("base64url");
  return `${input}.${signature}`;
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function configuredEnv<T>(run: () => Promise<T>) {
  const keys = [
    "ORBIT_SOCIAL_PROVIDERS",
    "ORBIT_OAUTH_EXAMPLE_CLIENT_ID",
    "ORBIT_OAUTH_EXAMPLE_CLIENT_SECRET",
    "ORBIT_OAUTH_EXAMPLE_ISSUER",
    "API_PUBLIC_URL",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.ORBIT_SOCIAL_PROVIDERS = "example";
  process.env.ORBIT_OAUTH_EXAMPLE_CLIENT_ID = clientId;
  process.env.ORBIT_OAUTH_EXAMPLE_CLIENT_SECRET = clientSecret;
  process.env.ORBIT_OAUTH_EXAMPLE_ISSUER = issuer;
  process.env.API_PUBLIC_URL = "https://orbit.example.test";
  return run().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function fixtureDb(options: { flow?: { nonce: string; code_verifier: string }; account?: LoginAccount } = {}) {
  const dbQueries: Array<{ sql: string; values: unknown[] }> = [];
  const clientQueries: Array<{ sql: string; values: unknown[] }> = [];
  let consumed = false;
  const account = options.account ?? {
    id: randomUUID(), name: "Aluna de Demonstração", email: "learner@suinda.example.test",
    avatar_url: null, preferences: {}, is_root: false, disabled: false,
    email_verified: true, session_version: 0, mfa_enabled: false,
  } satisfies LoginAccount;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      clientQueries.push({ sql, values });
      if (sql.includes("SELECT nonce,code_verifier FROM auth_social_states")) {
        return { rows: consumed || !options.flow ? [] : [options.flow], rowCount: consumed || !options.flow ? 0 : 1 };
      }
      if (sql.includes("UPDATE auth_social_states SET consumed_at")) {
        consumed = true;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM auth_social_identities")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM users WHERE lower(email)")) return { rows: [account], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const db = {
    async query(sql: string, values: unknown[] = []) {
      dbQueries.push({ sql, values });
      return [];
    },
    pool: { async connect() { return client; } },
  } as unknown as Db;
  return { db, account, dbQueries, clientQueries, get consumed() { return consumed; } };
}

function fixtureFetch(token: string, options: { discovery?: Record<string, unknown>; jwks?: unknown; tokenStatus?: number } = {}) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === `${issuer}/.well-known/openid-configuration`)
      return response(options.discovery ?? metadata);
    if (url === metadata.token_endpoint) {
      return response({ id_token: token }, options.tokenStatus ?? 200);
    }
    if (url === metadata.jwks_uri) return response(options.jwks ?? { keys: [jwk] });
    throw new Error(`URL externa sem fixture: ${url}`);
  };
  return { fetcher, requests };
}

test("OIDC discovery and authorization start use synthetic metadata, state, nonce and PKCE", async () => configuredEnv(async () => {
  const dbFixture = fixtureDb();
  const provider = fixtureFetch("unused");
  const service = new SocialLoginService(dbFixture.db, provider.fetcher);
  const result = await service.start("example");
  const authorization = new URL(result.url);
  const savedState = dbFixture.dbQueries.find((query) => query.sql.includes("INSERT INTO auth_social_states"));
  assert.ok(savedState);
  assert.equal(authorization.origin, issuer);
  assert.equal(authorization.pathname, "/authorize");
  assert.equal(authorization.searchParams.get("client_id"), clientId);
  assert.equal(authorization.searchParams.get("redirect_uri"), "https://orbit.example.test/auth/social/example/callback");
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("scope"), "openid email profile");
  assert.match(authorization.searchParams.get("state") || "", /^[A-Za-z0-9_-]{40,60}$/);
  assert.match(authorization.searchParams.get("nonce") || "", /^[A-Za-z0-9_-]{40,60}$/);
  assert.equal(savedState.values[0], createHash("sha256").update(authorization.searchParams.get("state")!).digest("hex"));
  assert.equal(savedState.values[1], "example");
  assert.equal(savedState.values[2], authorization.searchParams.get("nonce"));
  assert.equal(String(savedState.values[3]).length, 64);
  assert.equal(authorization.searchParams.get("code_challenge"), createHash("sha256").update(String(savedState.values[3])).digest("base64url"));
  assert.deepEqual(provider.requests.map((request) => request.url), [`${issuer}/.well-known/openid-configuration`]);
}));

test("OIDC callback exchanges a code, verifies RS256/JWKS claims and links only a verified sample account", async () => configuredEnv(async () => {
  const dbFixture = fixtureDb({ flow: { nonce, code_verifier: verifier } });
  const provider = fixtureFetch(signedIdToken());
  const service = new SocialLoginService(dbFixture.db, provider.fetcher);
  const result = await service.finish("example", state, "synthetic-code-123");
  assert.equal(result.id, dbFixture.account.id);
  assert.equal(result.email, "learner@suinda.example.test");
  assert.equal(dbFixture.consumed, true);
  const tokenRequest = provider.requests.find((request) => request.url === metadata.token_endpoint);
  assert.ok(tokenRequest);
  assert.equal(tokenRequest.init?.method, "POST");
  assert.equal(tokenRequest.init?.headers && new Headers(tokenRequest.init.headers).get("content-type"), "application/x-www-form-urlencoded");
  const tokenForm = new URLSearchParams(String(tokenRequest.init?.body));
  assert.equal(tokenForm.get("grant_type"), "authorization_code");
  assert.equal(tokenForm.get("code"), "synthetic-code-123");
  assert.equal(tokenForm.get("client_id"), clientId);
  assert.equal(tokenForm.get("client_secret"), clientSecret);
  assert.equal(tokenForm.get("redirect_uri"), "https://orbit.example.test/auth/social/example/callback");
  assert.equal(tokenForm.get("code_verifier"), verifier);
  assert.ok(dbFixture.clientQueries.some((query) => query.sql.includes("INSERT INTO auth_social_identities")
    && query.values[0] === dbFixture.account.id
    && query.values[1] === issuer
    && query.values[2] === "synthetic-subject-001"
    && query.values[3] === "learner@suinda.example.test"));
  assert.deepEqual(provider.requests.map((request) => request.url), [
    `${issuer}/.well-known/openid-configuration`, metadata.token_endpoint, metadata.jwks_uri,
  ]);
}));

test("OIDC callback accepts only a first-use state and does not contact the provider for a replay", async () => configuredEnv(async () => {
  const dbFixture = fixtureDb({ flow: { nonce, code_verifier: verifier } });
  const provider = fixtureFetch(signedIdToken());
  const service = new SocialLoginService(dbFixture.db, provider.fetcher);
  await service.finish("example", state, "synthetic-code-123");
  const requestCountAfterFirstUse = provider.requests.length;
  await assert.rejects(() => service.finish("example", state, "synthetic-code-123"), /tentativa de login expirou/i);
  assert.equal(provider.requests.length, requestCountAfterFirstUse);
}));

test("OIDC callback rejects invalid issuer, audience, nonce, expiry, time, verification, azp and signature claims", async () => configuredEnv(async () => {
  const alternate = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const invalidTokens = [
    signedIdToken({ iss: "https://other.example.test" }),
    signedIdToken({ aud: "another-client" }),
    signedIdToken({ nonce: "different-nonce" }),
    signedIdToken({ exp: Math.floor(Date.now() / 1000) - 1 }),
    signedIdToken({ iat: Math.floor(Date.now() / 1000) + 61 }),
    signedIdToken({ email_verified: false }),
    signedIdToken({ aud: [clientId, "another-client"], azp: "another-client" }),
    signedIdToken({}, alternate),
  ];
  for (const token of invalidTokens) {
    const dbFixture = fixtureDb({ flow: { nonce, code_verifier: verifier } });
    const provider = fixtureFetch(token);
    const service = new SocialLoginService(dbFixture.db, provider.fetcher);
    await assert.rejects(() => service.finish("example", state, "synthetic-code-123"), /identidade|assinatura/i);
    assert.equal(dbFixture.clientQueries.some((query) => query.sql.includes("INSERT INTO auth_social_identities")), false);
  }
}));

test("OIDC rejects discovery metadata with an issuer mismatch before starting authorization", async () => configuredEnv(async () => {
  const dbFixture = fixtureDb();
  const provider = fixtureFetch("unused", { discovery: { ...metadata, issuer: "https://other.example.test" } });
  const service = new SocialLoginService(dbFixture.db, provider.fetcher);
  await assert.rejects(() => service.start("example"), /configuração OpenID Connect inválida/i);
  assert.equal(dbFixture.dbQueries.some((query) => query.sql.includes("INSERT INTO auth_social_states")), false);
}));

test("OIDC discovery refuses insecure provider endpoints", async () => configuredEnv(async () => {
  const dbFixture = fixtureDb();
  const provider = fixtureFetch("unused", { discovery: { ...metadata, jwks_uri: "http://idp.example.test/keys" } });
  const service = new SocialLoginService(dbFixture.db, provider.fetcher);
  await assert.rejects(() => service.start("example"), /endpoints inseguros/i);
  assert.equal(dbFixture.dbQueries.some((query) => query.sql.includes("INSERT INTO auth_social_states")), false);
}));

test("OIDC callback rejects malformed code/state and a provider that refuses token exchange", async () => configuredEnv(async () => {
  const dbFixture = fixtureDb({ flow: { nonce, code_verifier: verifier } });
  const provider = fixtureFetch("unused", { tokenStatus: 401 });
  const service = new SocialLoginService(dbFixture.db, provider.fetcher);
  await assert.rejects(() => service.finish("example", "short", "bad"), /resposta de login social inválida/i);
  await assert.rejects(() => service.finish("example", state, "synthetic-code-123"), /provedor recusou a autenticação/i);
  assert.equal(provider.requests.some((request) => request.url === metadata.jwks_uri), false);
}));
