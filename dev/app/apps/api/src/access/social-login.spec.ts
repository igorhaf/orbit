import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as signJwt, type JsonWebKey, type KeyObject } from "node:crypto";
import { test } from "node:test";
import type { Db } from "../db";
import { SocialLoginService } from "./social-login";

const issuer = "https://idp.example.test";
const clientId = "orbit-demo-client";
const clientSecret = "fixture-only-secret";
const provider = "demo";
const publicApi = "http://127.0.0.1:4001";
const nonce = "synthetic-nonce-for-oidc-tests";
const verifier = "synthetic-code-verifier-012345678901234567890123456789012345678901";
const state = "S".repeat(43);
const subject = "synthetic-subject-001";
const account = {
  id: "00000000-0000-4000-8000-000000000101",
  name: "Aluna Exemplo",
  email: "aluna@example.test",
  avatar_url: null,
  preferences: {},
  is_root: false,
  disabled: false,
  email_verified: true,
  session_version: 0,
  mfa_enabled: false,
};

function configuredEnvironment<T>(callback: () => Promise<T>): Promise<T> {
  const keys = [
    "ORBIT_SOCIAL_PROVIDERS",
    "ORBIT_OAUTH_DEMO_CLIENT_ID",
    "ORBIT_OAUTH_DEMO_CLIENT_SECRET",
    "ORBIT_OAUTH_DEMO_ISSUER",
    "API_PUBLIC_URL",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.ORBIT_SOCIAL_PROVIDERS = provider;
  process.env.ORBIT_OAUTH_DEMO_CLIENT_ID = clientId;
  process.env.ORBIT_OAUTH_DEMO_CLIENT_SECRET = clientSecret;
  process.env.ORBIT_OAUTH_DEMO_ISSUER = issuer;
  process.env.API_PUBLIC_URL = publicApi;
  return callback().finally(() => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function jwt(privateKey: KeyObject, claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "demo-key-1" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${body}`;
  const signature = signJwt("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function metadata() {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
  };
}

function makeDatabase(options: { flow?: { nonce: string; code_verifier: string }; existingAccount?: boolean } = {}) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const socialStateClient = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (sql.includes("SELECT nonce,code_verifier FROM auth_social_states"))
        return { rows: options.flow ? [options.flow] : [], rowCount: options.flow ? 1 : 0 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const identityClient = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (sql.includes("FROM auth_social_identities"))
        return { rows: [], rowCount: 0 };
      if (sql.includes("FROM users WHERE lower(email)"))
        return { rows: options.existingAccount === false ? [] : [account], rowCount: options.existingAccount === false ? 0 : 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  let connection = 0;
  const db = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      return [];
    },
    pool: {
      async connect() {
        connection += 1;
        return (connection === 1 ? socialStateClient : identityClient) as never;
      },
    },
  } as unknown as Db;
  return { db, queries };
}

function fixtureFetcher(idToken: string, publicJwk: JsonWebKey, calls: string[]) {
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url === `${issuer}/.well-known/openid-configuration`)
      return new Response(JSON.stringify(metadata()), { status: 200, headers: { "content-type": "application/json" } });
    if (url === `${issuer}/token`) {
      assert.equal(init?.method, "POST");
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.equal(form.get("code"), "sample-authorization-code");
      assert.equal(form.get("client_id"), clientId);
      assert.equal(form.get("client_secret"), clientSecret);
      assert.equal(form.get("code_verifier"), verifier);
      return new Response(JSON.stringify({ id_token: idToken }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === `${issuer}/jwks`)
      return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "demo-key-1", alg: "RS256", use: "sig" }] }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`Unexpected synthetic OIDC URL: ${url}`);
  };
}

test("OIDC discovery and start use synthetic metadata and create a PKCE-bound single-use state", async () => {
  await configuredEnvironment(async () => {
    const { db, queries } = makeDatabase();
    const calls: string[] = [];
    const service = new SocialLoginService(db);
    Object.assign(service, { fetcher: fixtureFetcher("", {} as JsonWebKey, calls) });

    const result = await service.start(provider);
    const authorize = new URL(result.url);
    const insert = queries.find(({ sql }) => sql.includes("INSERT INTO auth_social_states"));
    assert.ok(insert);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], `${issuer}/.well-known/openid-configuration`);
    assert.equal(authorize.origin, issuer);
    assert.equal(authorize.pathname, "/authorize");
    assert.equal(authorize.searchParams.get("client_id"), clientId);
    assert.equal(authorize.searchParams.get("redirect_uri"), `${publicApi}/auth/social/demo/callback`);
    assert.equal(authorize.searchParams.get("response_type"), "code");
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorize.searchParams.get("code_challenge"),
      createHash("sha256").update(String(insert.values?.[3])).digest("base64url"));
    assert.equal(insert.values?.[0], createHash("sha256").update(String(authorize.searchParams.get("state"))).digest("hex"));
    assert.equal(insert.values?.[1], provider);
    assert.equal(insert.values?.[2], authorize.searchParams.get("nonce"));
    assert.match(String(insert.values?.[3]), /^[A-Za-z0-9_-]{64}$/);
  });
});

test("OIDC callback exchanges the code and links a generated RS256 identity only after issuer, audience and nonce checks", async () => {
  await configuredEnvironment(async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer,
      sub: subject,
      aud: clientId,
      exp: now + 300,
      iat: now,
      nonce,
      email: account.email,
      email_verified: true,
      name: account.name,
    };
    const calls: string[] = [];
    const { db, queries } = makeDatabase({ flow: { nonce, code_verifier: verifier } });
    const service = new SocialLoginService(db);
    Object.assign(service, { fetcher: fixtureFetcher(jwt(privateKey, claims), publicJwk, calls) });

    const result = await service.finish(provider, state, "sample-authorization-code");
    assert.equal(result.id, account.id);
    assert.equal(result.email, account.email);
    assert.deepEqual(calls, [
      `${issuer}/.well-known/openid-configuration`,
      `${issuer}/token`,
      `${issuer}/jwks`,
    ]);
    const tokenExchange = queries.find(({ sql }) => sql.includes("INSERT INTO auth_social_states"));
    assert.equal(tokenExchange, undefined);
    const identityInsert = queries.find(({ sql }) => sql.includes("INSERT INTO auth_social_identities"));
    assert.deepEqual(identityInsert?.values, [account.id, issuer, subject, account.email]);
    assert.ok(queries.some(({ sql, values }) => sql.includes("UPDATE auth_social_states SET consumed_at") && values?.length === 1));
  });
});

test("OIDC callback rejects invalid state and refuses untrusted or unverified example claims", async () => {
  await configuredEnvironment(async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    const now = Math.floor(Date.now() / 1000);
    const validClaims = {
      iss: issuer,
      sub: subject,
      aud: clientId,
      exp: now + 300,
      iat: now,
      nonce,
      email: account.email,
      email_verified: true,
    };

    const calls: string[] = [];
    const invalidState = makeDatabase({ flow: undefined });
    const stateService = new SocialLoginService(invalidState.db);
    Object.assign(stateService, { fetcher: fixtureFetcher("", publicJwk, calls) });
    await assert.rejects(() => stateService.finish(provider, state, "sample-authorization-code"), /expirou/);
    assert.equal(calls.length, 0);

    for (const invalid of [
      { iss: "https://other-idp.example.test" },
      { aud: "other-client" },
      { nonce: "wrong-synthetic-nonce" },
      { email_verified: false },
    ]) {
      const db = makeDatabase({ flow: { nonce, code_verifier: verifier } });
      const service = new SocialLoginService(db.db);
      const mockedFetch = fixtureFetcher(jwt(privateKey, { ...validClaims, ...invalid }), publicJwk, []);
      Object.assign(service, { fetcher: mockedFetch });
      await assert.rejects(() => service.finish(provider, state, "sample-authorization-code"));
      assert.equal(db.queries.some(({ sql }) => sql.includes("INSERT INTO auth_social_identities")), false);
    }
  });
});
