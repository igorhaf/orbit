import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, verify, type JsonWebKeyInput } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import * as jsonld from "jsonld";
import Ajv2019 from "ajv-2019/dist/2019";
import addFormats from "ajv-formats";
import { SecretVault } from "../secrets";
import { openBadgeAchievementId, suindaOpenBadgesPlugin, SuindaOpenBadgesController, SuindaOpenBadgesService } from "./suinda-open-badges";

const workspaceId = "00000000-0000-4000-8000-000000000101";
const certificateId = "00000000-0000-4000-8000-000000000102";
const userId = "00000000-0000-4000-8000-000000000103";
const issuerConformanceEmail = "conformance@imsglobal.org";
const achievementCredentialSchema = JSON.parse(readFileSync(resolve(__dirname, "./suinda-open-badges-contexts/achievementcredential.schema.json"), "utf8"));
const validateAchievementCredential = (() => {
  const ajv = new Ajv2019({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(achievementCredentialSchema);
})();
const openBadgeContextSnapshots = new Map([
  ["https://www.w3.org/ns/credentials/v2", "credentials-v2.json"],
  ["https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json", "openbadges-v3.0.3.json"],
  ["https://www.w3.org/ns/credentials/status/v1", "credentials-status-v1.json"],
].map(([url, file]) => [url, JSON.parse(readFileSync(resolve(__dirname, `./suinda-open-badges-contexts/${file}`), "utf8"))] as const));

async function expandOpenBadgeSafe(credential: unknown) {
  const options = {
    safe: true,
    documentLoader: async (url: string) => {
      const document = openBadgeContextSnapshots.get(url);
      assert.ok(document, `unexpected remote JSON-LD context: ${url}`);
      return { documentUrl: url, document };
    },
  } as Parameters<typeof jsonld.expand>[1] & { safe: true };
  return jsonld.expand(credential as Parameters<typeof jsonld.expand>[0], options);
}

test("migration 197 and bootstrap schema isolate the encrypted workspace issuer key", () => {
  const migration = readFileSync(resolve(__dirname, "../../sql/migrations/197_suinda_open_badge_issuers.sql"), "utf8");
  const schema = readFileSync(resolve(__dirname, "../../sql/schema.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS suinda_open_badge_issuers/);
  assert.match(migration, /workspace_id uuid PRIMARY KEY REFERENCES workspaces/);
  assert.match(migration, /private_key_encrypted text NOT NULL/);
  assert.match(migration, /suinda_open_badge_credential_refs/);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS suinda_open_badge_issuers/);
});

test("migration 198 assigns each credential a workspace-scoped revocation-list position", () => {
  const migration = readFileSync(resolve(__dirname, "../../sql/migrations/198_suinda_open_badge_revocation_status.sql"), "utf8");
  const schema = readFileSync(resolve(__dirname, "../../sql/schema.sql"), "utf8");
  assert.match(migration, /suinda_open_badge_status_counters/);
  assert.match(migration, /status_list_number/);
  assert.match(migration, /status_list_index/);
  assert.match(migration, /UNIQUE\(workspace_id,status_list_number,status_list_index\)/);
  assert.doesNotMatch(schema, /suinda_open_badge_status_counters/);
});

test("migration 205 versions achievement identifiers while preserving legacy IDs", () => {
  const migration = readFileSync(resolve(__dirname, "../../sql/migrations/205_suinda_open_badge_achievement_identity.sql"), "utf8");
  const schema = readFileSync(resolve(__dirname, "../../sql/schema.sql"), "utf8");
  assert.match(migration, /achievement_version smallint NOT NULL DEFAULT 1/);
  assert.doesNotMatch(schema, /achievement_version smallint NOT NULL DEFAULT 1/);
  const shared = { issuerId: "https://issuer.test", courseId: "course/1", revision: 3 };
  assert.equal(openBadgeAchievementId({ ...shared, kind: "milestone", version: 1, milestoneKey: "foundations" }),
    "https://issuer.test/achievements/course%2F1/3/milestone");
  const firstMilestone = openBadgeAchievementId({ ...shared, kind: "milestone", version: 2, issuerSecret: "issuer-secret", milestoneKey: "foundations" });
  const normalizedMilestone = openBadgeAchievementId({ ...shared, kind: "milestone", version: 2, issuerSecret: "issuer-secret", milestoneKey: " foundations " });
  const otherMilestone = openBadgeAchievementId({ ...shared, kind: "milestone", version: 2, issuerSecret: "issuer-secret", milestoneKey: "advanced" });
  assert.equal(firstMilestone, normalizedMilestone);
  assert.notEqual(firstMilestone, otherMilestone);
  assert.match(firstMilestone, /[a-f0-9]{64}$/);
  const firstScope = openBadgeAchievementId({ ...shared, kind: "participation", version: 2, issuerSecret: "issuer-secret", participationScope: "Introdução" });
  const normalizedScope = openBadgeAchievementId({ ...shared, kind: "participation", version: 2, issuerSecret: "issuer-secret", participationScope: "  Introdução  " });
  const otherScope = openBadgeAchievementId({ ...shared, kind: "participation", version: 2, issuerSecret: "issuer-secret", participationScope: "Prática avançada" });
  assert.equal(firstScope, normalizedScope);
  assert.notEqual(firstScope, otherScope);
  assert.notEqual(firstScope, openBadgeAchievementId({ ...shared, kind: "participation", version: 2, issuerSecret: "other-secret", participationScope: "Introdução" }));
  assert.throws(() => openBadgeAchievementId({ ...shared, kind: "milestone", version: 2, milestoneKey: "foundations" }), /Identidade da conquista indisponível/);
});

test("Open Badges plugin is a Suindá child and recognizes only its own API routes", () => {
  assert.equal(suindaOpenBadgesPlugin.parentPlugin, "suinda-learning");
  assert.deepEqual(suindaOpenBadgesPlugin.dependencies, ["suinda-learning"]);
  assert.equal(suindaOpenBadgesPlugin.handlesRoute?.(`/extensions/suinda-open-badges/me/certificates/${certificateId}.jwt`), true);
  assert.equal(suindaOpenBadgesPlugin.handlesRoute?.(`/extensions/suinda-open-badges/workspaces/${workspaceId}/issuer`), true);
  assert.equal(suindaOpenBadgesPlugin.handlesRoute?.(`/public/suinda/open-badges/issuers/${workspaceId}/keys/1`), true);
  assert.equal(suindaOpenBadgesPlugin.handlesRoute?.(`/public/suinda/open-badges/issuers/${workspaceId}/status/0`), true);
  assert.equal(suindaOpenBadgesPlugin.handlesRoute?.("/.well-known/jwks.json"), true);
  assert.equal(suindaOpenBadgesPlugin.handlesRoute?.(`/extensions/suinda-open-badges/workspaces/${workspaceId}/issuer/private-key`), false);
  assert.equal(suindaOpenBadgesPlugin.handlesRoute?.(`/extensions/suinda-learning/me/certificates/${certificateId}.jwt`), false);
});

test("serves exported Open Badges VC-JWT as text/plain Compact JWS attachment", async () => {
  const headers = new Map<string, string>();
  let body = "";
  const controller = new SuindaOpenBadgesController({
    async exportCredential() {
      return { token: "header.payload.signature", file_name: "SUINDA-TEST.jwt", media_type: "text/plain" };
    },
  } as never);
  const response = {
    setHeader(name: string, value: string) { headers.set(name, value); return this; },
    send(value: string) { body = value; return value; },
  };

  await controller.export({ orbitUser: userId } as never, certificateId, response as never);

  assert.equal(headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.equal(headers.get("Content-Disposition"), 'attachment; filename="SUINDA-TEST.jwt"');
  assert.equal(headers.get("Cache-Control"), "private, no-store");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(body, "header.payload.signature");
});

test("exports an Open Badge VC-JWT signed by the workspace RSA key without exposing the learner email", async () => {
  const original = { secret: process.env.ORBIT_SECRET_KEY, publicUrl: process.env.API_PUBLIC_URL };
  process.env.ORBIT_SECRET_KEY = "suinda-open-badges-test-key";
  process.env.API_PUBLIC_URL = "https://badges.example.test";
  try {
    const vault = new SecretVault();
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const encrypted = vault.seal({ private_key_pem: privateKey });
    const issuerRow = { workspace_id: workspaceId, issuer_name: "Instituto de Teste", private_key_encrypted: encrypted };
    let credentialReference: { credential_id: string; identity_salt: string; status_list_number: number; status_list_index: number; achievement_version: number } | null = null;
    const database = {
      async one(sql: string) {
        if (sql.includes("SELECT $3::integer AS status_list_index")) return { status_list_index: 42 };
        if (sql.includes("FROM generate_series")) return { status_list_index: 42 };
        if (sql.includes("FROM suinda_open_badge_credential_refs")) return credentialReference;
        if (sql.includes("suinda_open_badge_status_counters")) return { allocated_index: "0" };
        if (sql.includes("INSERT INTO suinda_open_badge_credential_refs")) return credentialReference = {
          credential_id: "00000000-0000-4000-8000-000000000105", identity_salt: "0123456789abcdef0123456789abcdef", status_list_number: 0, status_list_index: 42, achievement_version: 2,
        };
        if (sql.includes("FROM extension_records c")) return {
          id: certificateId, workspace_id: workspaceId, state: "issued", certificate_code: "SUINDA-00000000-0000-4000-8000-000000000102",
          payload: { issued_at: "2026-10-20T12:30:00.000Z", certificate_kind: "completion" },
          learner_name: "Aluna Teste", learner_email: issuerConformanceEmail, course_title: "Curso de Teste",
          course_description: "Descrição curricular", course_revision: 2, course_id: "00000000-0000-4000-8000-000000000104", course_payload: {},
        };
        if (sql.includes("FROM suinda_open_badge_issuers")) return issuerRow;
        return null;
      },
      async query(sql: string) { return sql.includes("FROM suinda_open_badge_issuers") ? [issuerRow] : []; },
    };
    const access = { async has() { return true; }, async audit() {} };
    const registry = { isEnabled() { return true; } };
    const service = new SuindaOpenBadgesService(database as never, access as never, vault, registry as never);

    const exported = await service.exportCredential(certificateId, userId);
    const [encodedHeader, encodedPayload, encodedSignature] = exported.token.split(".");
    assert.ok(encodedHeader && encodedPayload && encodedSignature);
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as Record<string, string>;
    const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(header).sort(), ["alg", "kid", "typ"]);
    assert.equal(header.alg, "RS256");
    assert.equal(header.typ, "JWT");
    assert.equal(header.kid, `https://badges.example.test/public/suinda/open-badges/issuers/${workspaceId}/keys/1`);
    const key = createPublicKey(publicKey);
    assert.equal(verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), key, Buffer.from(encodedSignature, "base64url")), true);
    assert.equal(claims.iss, (claims.vc as { issuer: { id: string } }).issuer.id);
    assert.equal(claims.jti, (claims.vc as { id: string }).id);
    assert.equal(claims.nbf, Math.floor(Date.parse("2026-10-20T12:30:00.000Z") / 1000));
    const credential = claims.vc as { "@context": Array<string | Record<string, string>>; type: string[]; credentialSubject: Record<string, unknown>; issuer: { type: string[] }; credentialStatus: { statusListIndex: string; statusListCredential: string }; credentialSchema: Array<{ id: string; type: string }> };
    assert.deepEqual(credential["@context"], ["https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json", "https://www.w3.org/ns/credentials/status/v1", {
      "1EdTechJsonSchemaValidator2019": "https://purl.imsglobal.org/spec/vccs/v1p0#1EdTechJsonSchemaValidator2019",
    }]);
    assert.deepEqual(credential.credentialSchema, [{
      id: "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json",
      type: "1EdTechJsonSchemaValidator2019",
    }]);
    assert.equal(validateAchievementCredential(credential), true,
      `the emitted AchievementCredential must satisfy the official 1EdTech JSON Schema: ${JSON.stringify(validateAchievementCredential.errors)}`);
    const expandedCredential = await expandOpenBadgeSafe(credential);
    assert.equal(expandedCredential.length, 1);
    assert.ok(expandedCredential[0]?.["@type"]?.includes("https://purl.imsglobal.org/spec/vc/ob/vocab.html#OpenBadgeCredential"),
      "the emitted credential must expand in JSON-LD safe mode using pinned official contexts");
    assert.deepEqual(credential.type, ["VerifiableCredential", "OpenBadgeCredential"]);
    assert.equal((credential.credentialSubject.achievement as { id: string }).id,
      `https://badges.example.test/public/suinda/open-badges/issuers/${workspaceId}/achievements/00000000-0000-4000-8000-000000000104/2/completion`);
    assert.deepEqual(credential.issuer.type, ["Profile"]);
    assert.equal(JSON.stringify(claims).includes(issuerConformanceEmail), false);
    const subjectIdentity = (credential.credentialSubject.identifier as Array<{ identityHash: string; salt: string }>)[0];
    assert.match(subjectIdentity.identityHash, /^sha256\$[a-f0-9]{64}$/);
    assert.equal(subjectIdentity.salt, "0123456789abcdef0123456789abcdef");
    assert.equal(subjectIdentity.identityHash, `sha256$${createHash("sha256").update(`${issuerConformanceEmail}0123456789abcdef0123456789abcdef`, "utf8").digest("hex")}`,
      "the verifier can match the private hashed email identity to the official conformance recipient without exposing the email in the credential");
    assert.equal(credential.credentialStatus.statusListIndex, "42");
    assert.equal(credential.credentialStatus.statusListCredential, `https://badges.example.test/public/suinda/open-badges/issuers/${workspaceId}/status/0`);

    const publicJwk = await service.publicKey(workspaceId) as Record<string, unknown>;
    assert.equal(publicJwk.kid, header.kid);
    assert.equal(publicJwk.alg, "RS256");
    assert.equal(Object.hasOwn(publicJwk, "d"), false);
    assert.equal(verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`),
      createPublicKey({ key: publicJwk as JsonWebKeyInput["key"], format: "jwk" }), Buffer.from(encodedSignature, "base64url")), true,
    "the public JWK published by the issuer endpoint must verify the exported credential");
    const jwks = await service.publicJwks() as { keys: Array<Record<string, unknown>> };
    assert.equal(jwks.keys.length, 1);
    assert.equal(jwks.keys[0]?.kid, header.kid);
    assert.equal(jwks.keys[0]?.iss, claims.iss);
    assert.equal(jwks.keys[0]?.alg, "RS256");
    assert.equal(Object.hasOwn(jwks.keys[0] || {}, "d"), false);
    assert.equal(verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`),
      createPublicKey({ key: jwks.keys[0] as JsonWebKeyInput["key"], format: "jwk" }), Buffer.from(encodedSignature, "base64url")), true,
    "the issuer JWK Set must contain the public key identified by kid");
    const tampered = `${encodedHeader}.${encodedPayload.slice(0, -1)}${encodedPayload.endsWith("a") ? "b" : "a"}.${encodedSignature}`;
    const [tamperedHeader, tamperedPayload, tamperedSignature] = tampered.split(".");
    assert.equal(verify("RSA-SHA256", Buffer.from(`${tamperedHeader}.${tamperedPayload}`), key, Buffer.from(tamperedSignature!, "base64url")), false,
      "changing any signed JWT claim must invalidate the proof");
    const repeated = await service.exportCredential(certificateId, userId);
    const repeatedClaims = JSON.parse(Buffer.from(repeated.token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    assert.equal(repeatedClaims.jti, claims.jti, "re-export must keep the stable credential ID");
    assert.deepEqual(repeatedClaims.vc, claims.vc, "re-exporting an unchanged certificate must preserve its credential payload");
    const profile = await service.publicIssuer(workspaceId) as { id: string; type: string[]; name: string };
    assert.deepEqual(profile.type, ["Profile"]);
    assert.equal(profile.name, "Instituto de Teste");
  } finally {
    if (original.secret === undefined) delete process.env.ORBIT_SECRET_KEY;
    else process.env.ORBIT_SECRET_KEY = original.secret;
    if (original.publicUrl === undefined) delete process.env.API_PUBLIC_URL;
    else process.env.API_PUBLIC_URL = original.publicUrl;
  }
});

test("publishes a signed W3C BitstringStatusList and reflects revoked certificates", async () => {
  const original = { secret: process.env.ORBIT_SECRET_KEY, publicUrl: process.env.API_PUBLIC_URL };
  process.env.ORBIT_SECRET_KEY = "suinda-open-badges-status-test-key";
  process.env.API_PUBLIC_URL = "https://badges.example.test";
  try {
    const vault = new SecretVault();
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const encrypted = vault.seal({ private_key_pem: privateKey });
    const database = {
      async one(sql: string) {
        if (sql.includes("FROM suinda_open_badge_issuers")) return { workspace_id: workspaceId, issuer_name: "Instituto", private_key_encrypted: encrypted };
        return null;
      },
      async query() { return [{ status_list_index: 0 }, { status_list_index: 9 }]; },
    };
    const service = new SuindaOpenBadgesService(database as never, { async audit() {} } as never,
      vault, { isEnabled() { return true; } } as never);
    const result = await service.publicStatusList(workspaceId, "0");
    const [encodedHeader, encodedPayload, encodedSignature] = result.token.split(".");
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as Record<string, string>;
    const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as { iss: string; jti: string; nbf: number; exp: number; sub: string; vc: Record<string, unknown> };
    assert.equal(header.alg, "RS256");
    assert.equal(header.kid, `https://badges.example.test/public/suinda/open-badges/issuers/${workspaceId}/keys/1`);
    assert.equal(verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), createPublicKey(publicKey), Buffer.from(encodedSignature, "base64url")), true);
    const vc = claims.vc as { "@context": string[]; id: string; type: string[]; issuer: { id: string }; validFrom: string; validUntil: string; credentialSubject: { id: string; type: string; statusPurpose: string; encodedList: string } };
    assert.deepEqual(vc["@context"], ["https://www.w3.org/ns/credentials/v2", "https://www.w3.org/ns/credentials/status/v1"]);
    assert.deepEqual(vc.type, ["VerifiableCredential", "BitstringStatusListCredential"]);
    assert.equal(vc.credentialSubject.statusPurpose, "revocation");
    assert.equal(claims.iss, (vc.issuer as { id: string }).id);
    assert.equal(claims.jti, vc.id);
    assert.equal(claims.sub, vc.credentialSubject.id);
    assert.equal(claims.nbf, Date.parse(vc.validFrom) / 1000);
    assert.equal(claims.exp, Date.parse(vc.validUntil) / 1000);
    const bytes = gunzipSync(Buffer.from(vc.credentialSubject.encodedList.slice(1), "base64url"));
    assert.equal(bytes.length, 16384);
    assert.equal(bytes[0], 0x80);
    assert.equal(bytes[1], 0x40);
  } finally {
    if (original.secret === undefined) delete process.env.ORBIT_SECRET_KEY;
    else process.env.ORBIT_SECRET_KEY = original.secret;
    if (original.publicUrl === undefined) delete process.env.API_PUBLIC_URL;
    else process.env.API_PUBLIC_URL = original.publicUrl;
  }
});

test("revoked certificates are not issued as new credentials", async () => {
  const database = { async one() { return { id: certificateId, workspace_id: workspaceId, state: "revoked" }; } };
  const service = new SuindaOpenBadgesService(database as never, { async has() { return true; } } as never,
    new SecretVault(), { isEnabled() { return true; } } as never);
  await assert.rejects(service.exportCredential(certificateId, userId), /Certificado não encontrado ou indisponível/);
});

test("an issued certificate owned by another learner returns 404 without exporting a credential", async () => {
  const otherLearnerId = "00000000-0000-4000-8000-000000000104";
  let certificateLookupCount = 0;
  const database = {
    async one(sql: string, params: unknown[]) {
      if (!sql.includes("FROM extension_records c")) return null;
      assert.match(sql, /c\.payload->>'learner_user_id'=\$2/, "certificate lookup must enforce owner isolation in SQL");
      certificateLookupCount += 1;
      const issuedCertificate = {
        id: certificateId,
        workspace_id: workspaceId,
        state: "issued",
        payload: { learner_user_id: otherLearnerId },
      };
      return issuedCertificate.payload.learner_user_id === params[1] ? issuedCertificate : null;
    },
  };
  const service = new SuindaOpenBadgesService(database as never, { async has() { return true; } } as never,
    new SecretVault(), { isEnabled() { return true; } } as never);

  await assert.rejects(service.exportCredential(certificateId, userId), (error: unknown) => {
    assert.equal((error as { getStatus?: () => number }).getStatus?.(), 404);
    assert.match(String((error as Error).message), /Certificado não encontrado ou indisponível/);
    return true;
  });
  assert.equal(certificateLookupCount, 1, "the ownership-filtered lookup must stop before issuer/key loading or credential creation");
});
