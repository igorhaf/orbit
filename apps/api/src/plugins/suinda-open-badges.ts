import { Body, Controller, Get, Header, HttpException, Inject, Injectable, Param, Post, Req, Res } from "@nestjs/common";
import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, randomInt, sign, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { AccessRequest } from "../access/access";
import { AccessService } from "../access/access";
import { Db } from "../db";
import { SecretVault } from "../secrets";
import type { PluginDefinition } from "./contract";
import { PluginRegistry } from "../execution/registries";
import { publicApiUrl } from "../public-api-url";
import type { Response } from "express";

const PLUGIN_ID = "suinda-open-badges";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OB_CONTEXT = "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json";
const VC_CONTEXT = "https://www.w3.org/ns/credentials/v2";
const STATUS_CONTEXT = "https://www.w3.org/ns/credentials/status/v1";
// 1EdTech specifies this credentialSchema type as a lexical value, but JSON-LD processors
// require @type terms to expand to absolute IRIs in safe mode. Keep the required wire value
// unchanged while giving processors a scoped IRI mapping under the validator specification.
const CREDENTIAL_SCHEMA_CONTEXT = { "1EdTechJsonSchemaValidator2019": "https://purl.imsglobal.org/spec/vccs/v1p0#1EdTechJsonSchemaValidator2019" };
const STATUS_LIST_CAPACITY = 131072;
type IssuerRow = { workspace_id: string; issuer_name: string; private_key_encrypted: string };
type CredentialReference = { credential_id: string; identity_salt: string; status_list_number: number; status_list_index: number; achievement_version?: number };

function fail(message: string, status = 400): never { throw new HttpException({ message }, status); }
function b64url(value: Buffer | string) { return Buffer.from(value).toString("base64url"); }
function certificateKind(value: unknown): "completion" | "participation" | "milestone" {
  return value === "participation" || value === "milestone" ? value : "completion";
}
function credentialSubjectId(credentialId: string) {
  const bytes = createHash("sha256").update(`suinda:open-badges:subject:v1\0${credentialId}`, "utf8").digest().subarray(0, 16);
  // UUIDv8 carries a domain-separated, deterministic pseudonym scoped to this credential.
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function openBadgeAchievementId(input: {
  issuerId: string; courseId: string; revision: number; kind: "completion" | "participation" | "milestone";
  version: number; issuerSecret?: string; milestoneKey?: string; participationScope?: string;
}) {
  const base = `${input.issuerId}/achievements/${encodeURIComponent(input.courseId)}/${input.revision}/${input.kind}`;
  // Preserve identifiers for credentials already exported before the scoped achievement identity was added.
  if (input.version < 2 || input.kind === "completion") return base;
  const value = input.kind === "milestone" ? input.milestoneKey?.trim() : input.participationScope?.trim();
  if (!value || !input.issuerSecret) throw new Error("Identidade da conquista indisponível para esta credencial.");
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(input.issuerSecret, "utf8"), Buffer.from(input.issuerId, "utf8"),
    Buffer.from("suinda:open-badges:achievement-identity:v1", "utf8"), 32));
  const identity = createHmac("sha256", key).update(`${input.kind}\0${value.normalize("NFKC")}`, "utf8").digest("hex");
  return `${base}/${identity}`;
}
function publicOrigin() {
  let url: URL;
  try { url = new URL(publicApiUrl()); } catch { return fail("Configure API_PUBLIC_URL para publicar credenciais verificáveis.", 503); }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return fail("A emissão Open Badges exige API_PUBLIC_URL HTTPS fora do ambiente local.", 503);
  }
  return url.toString().replace(/\/$/, "");
}
function issuerUrl(workspaceId: string) { return `${publicOrigin()}/public/suinda/open-badges/issuers/${workspaceId}`; }
function jwt(payload: Record<string, unknown>, privatePem: string, kid: string) {
  const header = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const input = `${header}.${body}`;
  const signature = sign("RSA-SHA256", Buffer.from(input), createPrivateKey(privatePem));
  return `${input}.${b64url(signature)}`;
}

export const suindaOpenBadgesPlugin: PluginDefinition = {
  id: PLUGIN_ID, name: "Suindá · Open Badges", version: "1.0.0",
  description: "Credenciais acadêmicas portáveis Open Badges 3.0 assinadas como VC-JWT.",
  scope: "workspace", parentPlugin: "suinda-learning", dependencies: ["suinda-learning"],
  capabilities: [
    { id: "read", name: "Exportar credenciais Open Badges", permissions: [`plugin.${PLUGIN_ID}.read`] },
    { id: "manage", name: "Configurar emissor Open Badges", permissions: [`plugin.${PLUGIN_ID}.manage`] },
  ],
  handlesRoute: (path) => /^\/extensions\/suinda-open-badges\/(?:me\/certificates\/[0-9a-f-]{36}\.jwt|workspaces\/[0-9a-f-]{36}\/issuer)$/.test(path)
    || /^\/public\/suinda\/open-badges\/issuers\/[0-9a-f-]{36}(?:\/keys\/1|\/status\/\d{1,12})?$/.test(path)
    || path === "/.well-known/jwks.json",
  routePermission: (path, method) => path === "/.well-known/jwks.json" && method !== "GET" ? `plugin.${PLUGIN_ID}.manage` : null,
};

@Injectable()
export class SuindaOpenBadgesService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService,
    @Inject(SecretVault) private readonly vault: SecretVault, @Inject(PluginRegistry) private readonly registry: PluginRegistry) {}

  private available() {
    if (!this.registry.isEnabled(PLUGIN_ID) || !this.registry.isEnabled("suinda-learning")) fail("A emissão Open Badges está desativada.", 503);
  }

  private async manager(userId: string, workspaceId: string) {
    if (!UUID.test(workspaceId)) fail("Workspace inválido.");
    const exists = await this.db.one<{ id: string }>("SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL", [workspaceId]);
    if (!exists) fail("Workspace não encontrado.", 404);
    const allowed = await this.access.has(userId, "plugin.suinda-learning.manage", "workspace", workspaceId)
      || await this.access.has(userId, "plugin.suinda-learning.manage");
    if (!allowed) {
      await this.access.audit(userId, "access.denied", `${PLUGIN_ID}.issuer.manage`, { type: "workspace", id: workspaceId });
      fail("A gestão do emissor não está autorizada neste workspace.", 403);
    }
    return workspaceId;
  }

  async issuerSettings(workspaceId: string, userId: string) {
    this.available();
    const workspace = await this.manager(userId, workspaceId);
    const row = await this.db.one<{ issuer_name: string; updated_at: string }>(
      "SELECT issuer_name,updated_at FROM suinda_open_badge_issuers WHERE workspace_id=$1", [workspace]);
    return { configured: Boolean(row), issuer_name: row?.issuer_name ?? null, issuer_url: row ? issuerUrl(workspace) : null, updated_at: row?.updated_at ?? null };
  }

  async configureIssuer(workspaceId: string, userId: string, input: unknown) {
    this.available();
    const workspace = await this.manager(userId, workspaceId);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => key !== "issuer_name")) fail("Envie somente o nome do emissor.");
    const name = String((input as { issuer_name?: unknown }).issuer_name ?? "").trim();
    if (!name || name.length > 160 || [...name].some((character) => { const code = character.codePointAt(0) ?? 0; return code < 32 || code === 127; })) {
      fail("O nome do emissor deve ter entre 1 e 160 caracteres.");
    }
    let existing = await this.db.one<IssuerRow>("SELECT workspace_id,issuer_name,private_key_encrypted FROM suinda_open_badge_issuers WHERE workspace_id=$1", [workspace]);
    if (!existing) {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001,
        privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
      const encrypted = this.vault.seal({ private_key_pem: privateKey });
      existing = await this.db.one<IssuerRow>(
        `INSERT INTO suinda_open_badge_issuers(workspace_id,issuer_name,private_key_encrypted,created_by,updated_by)
         VALUES($1,$2,$3,$4,$4) RETURNING workspace_id,issuer_name,private_key_encrypted`, [workspace, name, encrypted, userId]);
    } else {
      existing = await this.db.one<IssuerRow>(
        `UPDATE suinda_open_badge_issuers SET issuer_name=$2,updated_by=$3,updated_at=now()
         WHERE workspace_id=$1 RETURNING workspace_id,issuer_name,private_key_encrypted`, [workspace, name, userId]);
    }
    await this.access.audit(userId, `${PLUGIN_ID}.issuer.configured`, workspace, { type: "workspace", id: workspace });
    return { configured: true, issuer_name: existing!.issuer_name, issuer_url: issuerUrl(workspace) };
  }

  private async loadIssuer(workspaceId: string) {
    const row = await this.db.one<IssuerRow>("SELECT workspace_id,issuer_name,private_key_encrypted FROM suinda_open_badge_issuers WHERE workspace_id=$1", [workspaceId]);
    if (!row) fail("O emissor Open Badges deste workspace ainda não foi configurado.", 409);
    let secrets: { private_key_pem?: unknown };
    try { secrets = this.vault.open(row.private_key_encrypted); } catch { return fail("A chave do emissor não pôde ser aberta; verifique as chaves Orbit configuradas.", 503); }
    if (typeof secrets.private_key_pem !== "string") fail("A chave privada do emissor está inválida.", 503);
    const privateKey = createPrivateKey(secrets.private_key_pem);
    if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) fail("A chave RSA do emissor não atende ao mínimo criptográfico.", 503);
    const base = issuerUrl(workspaceId);
    return { row, privatePem: secrets.private_key_pem, issuerId: base, kid: `${base}/keys/1` };
  }

  async publicIssuer(workspaceId: string) {
    this.available();
    if (!UUID.test(workspaceId)) fail("Emissor não encontrado.", 404);
    const { row, issuerId } = await this.loadIssuer(workspaceId);
    return { "@context": [OB_CONTEXT], id: issuerId, type: ["Profile"], name: row.issuer_name, url: issuerId };
  }

  async publicKey(workspaceId: string) {
    this.available();
    if (!UUID.test(workspaceId)) fail("Chave não encontrada.", 404);
    const { row, kid } = await this.loadIssuer(workspaceId);
    const privateKey = createPrivateKey(this.vault.open<{ private_key_pem: string }>(row.private_key_encrypted).private_key_pem);
    const publicKey = createPublicKey(privateKey);
    const jwk = publicKey.export({ format: "jwk" });
    return { ...jwk, kid, use: "sig", alg: "RS256", kty: "RSA" };
  }

  async publicJwks() {
    this.available();
    const issuers = await this.db.query<IssuerRow>(
      "SELECT workspace_id,issuer_name,private_key_encrypted FROM suinda_open_badge_issuers ORDER BY workspace_id",
    );
    const keys = issuers.map((issuer) => {
      let privatePem: unknown;
      try { privatePem = this.vault.open<{ private_key_pem?: unknown }>(issuer.private_key_encrypted).private_key_pem; }
      catch { return fail("Uma chave de emissor não pôde ser aberta; verifique as chaves Orbit configuradas.", 503); }
      if (typeof privatePem !== "string") fail("Uma chave de emissor armazenada está inválida.", 503);
      const privateKey = createPrivateKey(privatePem);
      if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
        fail("Uma chave RSA de emissor não atende ao mínimo criptográfico.", 503);
      }
      const issuerId = issuerUrl(issuer.workspace_id);
      const jwk = createPublicKey(privateKey).export({ format: "jwk" });
      return { ...jwk, kid: `${issuerId}/keys/1`, use: "sig", alg: "RS256", kty: "RSA", iss: issuerId };
    });
    return { keys };
  }

  private async credentialReference(certificateId: string, workspaceId: string) {
    let ref = await this.db.one<CredentialReference>(
      "SELECT credential_id,identity_salt,status_list_number,status_list_index,achievement_version FROM suinda_open_badge_credential_refs WHERE certificate_id=$1 AND workspace_id=$2", [certificateId, workspaceId]);
    if (ref) return ref;
    const sequence = await this.db.one<{ allocated_index: string }>(
      `INSERT INTO suinda_open_badge_status_counters(workspace_id,next_index) VALUES($1,1)
       ON CONFLICT(workspace_id) DO UPDATE SET next_index=suinda_open_badge_status_counters.next_index+1
       RETURNING (next_index-1)::text AS allocated_index`, [workspaceId]);
    if (!sequence) fail("Não foi possível alocar o status da credencial.", 503);
    const index = BigInt(sequence.allocated_index);
    const statusListNumber = Number(index / BigInt(STATUS_LIST_CAPACITY));
    const persistAt = async (statusListIndex: number) => this.db.one<CredentialReference>(
      `INSERT INTO suinda_open_badge_credential_refs(certificate_id,workspace_id,credential_id,identity_salt,status_list_number,status_list_index,achievement_version)
       VALUES($1,$2,$3,$4,$5,$6,2) ON CONFLICT DO NOTHING
       RETURNING credential_id,identity_salt,status_list_number,status_list_index,achievement_version`,
      [certificateId, workspaceId, randomUUID(), randomBytes(16).toString("hex"), statusListNumber, statusListIndex]);
    for (let attempt = 0; attempt < 16 && !ref; attempt += 1) {
      // W3C recommends random status-list positions to reduce inferences about issuance order.
      // Random point lookups stay cheap for the normal sparse-list case.
      const candidate = randomInt(STATUS_LIST_CAPACITY);
      const slot = await this.db.one<{ status_list_index: number }>(
        `SELECT $3::integer AS status_list_index
         WHERE NOT EXISTS (
           SELECT 1 FROM suinda_open_badge_credential_refs occupied
           WHERE occupied.workspace_id=$1 AND occupied.status_list_number=$2
             AND occupied.status_list_index=$3
         )`,
        [workspaceId, statusListNumber, candidate]);
      if (!slot) continue;
      ref = await persistAt(slot.status_list_index);
      if (ref) break;
      ref = await this.db.one<CredentialReference>(
        "SELECT credential_id,identity_salt,status_list_number,status_list_index,achievement_version FROM suinda_open_badge_credential_refs WHERE certificate_id=$1 AND workspace_id=$2",
        [certificateId, workspaceId]);
    }
    if (!ref) {
      // If random probes repeatedly hit occupied positions, find a remaining slot without
      // loading the list into application memory. This fallback is only used for dense lists.
      const start = randomInt(STATUS_LIST_CAPACITY);
      const slot = await this.db.one<{ status_list_index: number }>(
        `SELECT (($3::integer + slots.step) % $4)::integer AS status_list_index
         FROM generate_series(0,$4::integer-1) AS slots(step)
         WHERE NOT EXISTS (
           SELECT 1 FROM suinda_open_badge_credential_refs occupied
           WHERE occupied.workspace_id=$1 AND occupied.status_list_number=$2
             AND occupied.status_list_index=(($3::integer + slots.step) % $4)
         )
         ORDER BY slots.step LIMIT 1`,
        [workspaceId, statusListNumber, start, STATUS_LIST_CAPACITY]);
      if (slot) ref = await persistAt(slot.status_list_index);
      if (!ref) ref = await this.db.one<CredentialReference>(
        "SELECT credential_id,identity_salt,status_list_number,status_list_index,achievement_version FROM suinda_open_badge_credential_refs WHERE certificate_id=$1 AND workspace_id=$2",
        [certificateId, workspaceId]);
    }
    if (!ref) fail("Não foi possível preparar a credencial para exportação.", 503);
    return ref;
  }

  async publicStatusList(workspaceId: string, listNumberInput: string) {
    this.available();
    if (!UUID.test(workspaceId) || !/^\d{1,12}$/.test(listNumberInput)) fail("Lista de status não encontrada.", 404);
    const listNumber = Number(listNumberInput);
    if (!Number.isSafeInteger(listNumber)) fail("Lista de status não encontrada.", 404);
    const { row, privatePem, issuerId, kid } = await this.loadIssuer(workspaceId);
    const revoked = await this.db.query<{ status_list_index: number }>(
      `SELECT refs.status_list_index FROM suinda_open_badge_credential_refs refs
       JOIN extension_records cert ON cert.id=refs.certificate_id AND cert.workspace_id=refs.workspace_id
         AND cert.plugin_id='suinda-learning' AND cert.kind='certificate'
       WHERE refs.workspace_id=$1 AND refs.status_list_number=$2 AND cert.state='revoked'`, [workspaceId, listNumber]);
    const bits = Buffer.alloc(STATUS_LIST_CAPACITY / 8);
    for (const row of revoked) {
      const index = Number(row.status_list_index);
      if (Number.isInteger(index) && index >= 0 && index < STATUS_LIST_CAPACITY) bits[index >> 3] |= 1 << (7 - (index & 7));
    }
    const listId = `${issuerId}/status/${listNumber}`;
    const validFrom = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    const validUntil = new Date(Date.parse(validFrom) + 300_000).toISOString();
    const credential = {
      "@context": [VC_CONTEXT, STATUS_CONTEXT], id: listId,
      type: ["VerifiableCredential", "BitstringStatusListCredential"],
      issuer: { id: issuerId, type: ["Profile"], name: row.issuer_name }, validFrom, validUntil,
      credentialSubject: {
        id: `${listId}#list`, type: "BitstringStatusList", statusPurpose: "revocation",
        encodedList: `u${gzipSync(bits).toString("base64url")}`,
      },
    };
    const claims = { iss: issuerId, jti: listId, nbf: Math.floor(Date.parse(validFrom) / 1000), exp: Math.floor(Date.parse(validUntil) / 1000), sub: `${listId}#list`, vc: credential };
    return { token: jwt(claims, privatePem, kid), media_type: "application/vc+jwt" };
  }

  async exportCredential(certificateId: string, userId: string) {
    this.available();
    if (!UUID.test(certificateId)) fail("Certificado não encontrado.", 404);
    const row = await this.db.one<{
      id: string; workspace_id: string; state: string; certificate_code: string; payload: Record<string, unknown>;
      learner_name: string; learner_email: string; course_title: string; course_description: string | null;
      course_revision: number; course_id: string; course_payload: Record<string, unknown>;
    }>(
      `SELECT c.id,c.workspace_id,c.state,c.payload,c.payload->>'certificate_code' AS certificate_code,
         u.name AS learner_name,u.email AS learner_email,cv.title AS course_title,cv.payload->>'description' AS course_description,
         cv.revision AS course_revision,cv.record_id::text AS course_id,cv.payload AS course_payload
       FROM extension_records c
       JOIN users u ON u.id::text=c.payload->>'learner_user_id'
       JOIN extension_records e ON e.id::text=c.payload->>'enrollment_record_id' AND e.workspace_id=c.workspace_id
         AND e.plugin_id='suinda-learning' AND e.kind='enrollment'
       JOIN extension_record_versions cv ON cv.record_id=(e.payload->>'course_record_id')::uuid
         AND cv.revision=(e.payload->>'course_revision')::integer
       WHERE c.id=$1 AND c.plugin_id='suinda-learning' AND c.kind='certificate' AND c.payload->>'learner_user_id'=$2`,
      [certificateId, userId]);
    if (!row || row.state !== "issued") fail("Certificado não encontrado ou indisponível.", 404);
    if (!/^SUINDA-[0-9a-f-]{36}$/i.test(row.certificate_code)) fail("Código do certificado inválido.", 409);
    const { row: issuer, privatePem, issuerId, kid } = await this.loadIssuer(row.workspace_id);
    const issuedAtValue = new Date(String(row.payload.issued_at || ""));
    if (!Number.isFinite(issuedAtValue.getTime())) fail("A data de emissão do certificado está inválida.", 409);
    const issuedAt = new Date(Math.floor(issuedAtValue.getTime() / 1000) * 1000);
    const expiresAtRaw = typeof row.payload.expires_at === "string" ? row.payload.expires_at : null;
    const validUntil = expiresAtRaw ? `${expiresAtRaw}T23:59:59.000Z` : undefined;
    const identity = await this.credentialReference(row.id, row.workspace_id);
    const identitySalt = identity.identity_salt;
    const normalizedEmail = row.learner_email.trim().normalize("NFKC").toLowerCase();
    const identityHash = createHash("sha256").update(`${normalizedEmail}${identitySalt}`, "utf8").digest("hex");
    const credentialId = `urn:uuid:${identity.credential_id}`;
    const kind = certificateKind(row.payload.certificate_kind);
    const certificateTitle = kind === "participation" ? "Certificado de participação" : kind === "milestone" ? "Certificado de marco" : "Certificado de conclusão";
    const milestoneTitle = typeof row.payload.milestone_title === "string" ? row.payload.milestone_title : "";
    const participationScope = typeof row.payload.participation_scope === "string" ? row.payload.participation_scope.trim() : "";
    const criteriaNarrative = kind === "participation"
      ? `Participação comprovada no escopo: ${participationScope || row.course_title}.`
      : kind === "milestone"
        ? `Conclusão do marco ${milestoneTitle || "acadêmico"} do curso ${row.course_title}.`
        : `Conclusão dos requisitos acadêmicos da revisão ${row.course_revision} do curso ${row.course_title}.`;
    const completedAt = typeof row.payload.completed_at === "string" ? new Date(row.payload.completed_at) : null;
    const awardedDate = completedAt && Number.isFinite(completedAt.getTime()) ? completedAt.toISOString() : undefined;
    const achievementVersion = identity.achievement_version ?? 1;
    const achievementId = openBadgeAchievementId({ issuerId, courseId: row.course_id, revision: row.course_revision, kind,
      version: achievementVersion, issuerSecret: privatePem,
      milestoneKey: typeof row.payload.milestone_key === "string" ? row.payload.milestone_key : undefined,
      participationScope });
    const achievementName = achievementVersion >= 2 && kind !== "completion" ? `${row.course_title} · ${certificateTitle}` : row.course_title;
    const achievementDescription = achievementVersion >= 2 && kind !== "completion"
      ? criteriaNarrative : row.course_description || `Conquista acadêmica: ${row.course_title}`;
    const credential = {
      "@context": [VC_CONTEXT, OB_CONTEXT, STATUS_CONTEXT, CREDENTIAL_SCHEMA_CONTEXT],
      id: credentialId,
      type: ["VerifiableCredential", "OpenBadgeCredential"],
      name: `${certificateTitle} · ${row.course_title}`,
      description: kind === "participation" && participationScope ? participationScope : kind === "milestone" && milestoneTitle ? milestoneTitle : `Conclusão de ${row.course_title}`,
      issuer: { id: issuerId, type: ["Profile"], name: issuer.issuer_name },
      validFrom: issuedAt.toISOString(), ...(validUntil ? { validUntil } : {}),
      ...(awardedDate ? { awardedDate } : {}),
      credentialSchema: [{ id: "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json", type: "1EdTechJsonSchemaValidator2019" }],
      credentialStatus: {
        id: `${issuerId}/status/${identity.status_list_number}#${identity.status_list_index}`,
        type: "BitstringStatusListEntry", statusPurpose: "revocation",
        statusListIndex: String(identity.status_list_index), statusListCredential: `${issuerId}/status/${identity.status_list_number}`,
      },
      credentialSubject: {
        id: credentialSubjectId(credentialId),
        type: ["AchievementSubject"],
        identifier: [{ type: "IdentityObject", identityType: "emailAddress", hashed: true, salt: identitySalt, identityHash: `sha256$${identityHash}` }],
        achievement: {
          id: achievementId, type: ["Achievement"], name: achievementName,
          humanCode: row.certificate_code,
          description: achievementDescription,
          criteria: { narrative: criteriaNarrative },
        },
      },
    };
    const safeCredential = JSON.parse(JSON.stringify(credential)) as Record<string, unknown>;
    const claims: Record<string, unknown> = {
      iss: issuerId, jti: credentialId, nbf: Math.floor(issuedAt.getTime() / 1000), sub: (safeCredential.credentialSubject as { id: string }).id,
      vc: safeCredential,
    };
    if (validUntil) claims.exp = Math.floor(Date.parse(validUntil) / 1000);
    const token = jwt(claims, privatePem, kid);
    await this.access.audit(userId, `${PLUGIN_ID}.credential.exported`, row.id, { type: "extension_record", id: row.id });
    return { token, file_name: `${row.certificate_code}.jwt`, media_type: "text/plain", certificate_code: row.certificate_code };
  }
}

@Controller("extensions/suinda-open-badges")
export class SuindaOpenBadgesController {
  constructor(@Inject(SuindaOpenBadgesService) private readonly badges: SuindaOpenBadgesService) {}
  @Get("workspaces/:workspaceId/issuer") settings(@Req() req: AccessRequest, @Param("workspaceId") workspace: string) {
    return this.badges.issuerSettings(workspace, String(req.orbitUser));
  }
  @Post("workspaces/:workspaceId/issuer") configure(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Body() body: unknown) {
    return this.badges.configureIssuer(workspace, String(req.orbitUser), body);
  }
  @Get("me/certificates/:certificateId.jwt") async export(@Req() req: AccessRequest, @Param("certificateId") id: string, @Res() res: Response) {
    const result = await this.badges.exportCredential(id, String(req.orbitUser));
    res.setHeader("Content-Type", `${result.media_type}; charset=utf-8`);
    res.setHeader("Content-Disposition", `attachment; filename="${result.file_name}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(result.token);
  }
}

@Controller("public/suinda/open-badges/issuers")
export class SuindaOpenBadgesPublicController {
  constructor(@Inject(SuindaOpenBadgesService) private readonly badges: SuindaOpenBadgesService) {}
  @Get(":workspaceId") @Header("Access-Control-Allow-Origin", "*")
  issuer(@Param("workspaceId") workspace: string) { return this.badges.publicIssuer(workspace); }
  @Get(":workspaceId/keys/1") @Header("Access-Control-Allow-Origin", "*")
  key(@Param("workspaceId") workspace: string) { return this.badges.publicKey(workspace); }
  @Get(":workspaceId/status/:listNumber") @Header("Access-Control-Allow-Origin", "*") @Header("Cache-Control", "public, max-age=300")
  async status(@Param("workspaceId") workspace: string, @Param("listNumber") listNumber: string, @Res() res: Response) {
    const result = await this.badges.publicStatusList(workspace, listNumber);
    res.setHeader("Content-Type", `${result.media_type}; charset=utf-8`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(result.token);
  }
}

@Controller()
export class SuindaOpenBadgesJwksController {
  constructor(@Inject(SuindaOpenBadgesService) private readonly badges: SuindaOpenBadgesService) {}
  @Get(".well-known/jwks.json") @Header("Access-Control-Allow-Origin", "*") @Header("Cache-Control", "public, max-age=300")
  @Header("Content-Type", "application/jwk-set+json; charset=utf-8")
  jwks() { return this.badges.publicJwks(); }
}
