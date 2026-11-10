import { Body, Controller, Delete, Get, HttpException, Inject, Injectable, Param, Put, Req } from "@nestjs/common";
import { createHash, X509Certificate } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import signPdf from "@signpdf/signpdf";
import { Signer, SUBFILTER_ETSI_CADES_DETACHED } from "@signpdf/utils";
import { PDFDocument } from "pdf-lib";
import type { AccessRequest } from "../access/access";
import { AccessService } from "../access/access";
import { Db } from "../db";
import { SecretVault } from "../secrets";
import type { PluginDefinition } from "./contract";
import { PluginRegistry } from "../execution/registries";

const PLUGIN_ID = "suinda-certificate-signing";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_P12_BYTES = 4 * 1024 * 1024;
const SIGNATURE_PLACEHOLDER_BYTES = 16384;

type SigningSettings = {
  workspace_id: string;
  p12_encrypted: string;
  certificate_subject: string;
  certificate_serial: string;
  certificate_fingerprint: string;
  valid_from: string;
  valid_until: string;
  updated_at: string;
};
type ParsedCertificate = {
  subject: string;
  serial: string;
  fingerprint: string;
  valid_from: Date;
  valid_until: Date;
};

function fail(message: string, status = 400): never { throw new HttpException({ message }, status); }
function safeError(error: unknown) { return error instanceof Error ? error.message : "Falha na assinatura do certificado PDF."; }
function only(input: unknown, allowed: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !allowed.includes(key))) fail("A configuração de assinatura contém campos inválidos.");
  return input as Record<string, unknown>;
}

function decodeP12(value: unknown) {
  if (typeof value !== "string" || !value || value.length > Math.ceil(MAX_P12_BYTES * 4 / 3) + 8
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail("Envie um PKCS#12/PFX válido de até 4 MB.");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_P12_BYTES || bytes.toString("base64") !== value) fail("O arquivo PKCS#12 excede o limite ou está codificado incorretamente.");
  return bytes;
}

function runOpenSsl(args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const safeArgs = args.map((arg) => arg === "fd:3" ? `file:${join(cwd, "pkcs12.pass")}` : arg);
    const child = spawn(process.env.SUINDA_OPENSSL_BIN || "openssl", safeArgs, {
      cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000); });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(stderr.trim() || "OpenSSL recusou o PKCS#12 ou a operação de assinatura."));
      resolve(Buffer.concat(stdout));
    });
  });
}

async function withP12Files<T>(p12: Buffer, passphrase: string, callback: (dir: string, p12Path: string, certPath: string, chainPath: string | null) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "suinda-pades-"));
  try {
    await chmod(dir, 0o700);
    const p12Path = join(dir, "institution.p12");
    const certPath = join(dir, "signer.pem");
    const chainPath = join(dir, "issuer-chain.pem");
    await writeFile(p12Path, p12, { mode: 0o600, flag: "wx" });
    await writeFile(join(dir, "pkcs12.pass"), passphrase, { mode: 0o600, flag: "wx" });
    await runOpenSsl(["pkcs12", "-in", p12Path, "-clcerts", "-nokeys", "-out", certPath, "-passin", "fd:3"], dir);
    await runOpenSsl(["pkcs12", "-in", p12Path, "-cacerts", "-nokeys", "-out", chainPath, "-passin", "fd:3"], dir);
    await chmod(certPath, 0o600);
    await chmod(chainPath, 0o600);
    const chain = (await readFile(chainPath, "utf8")).trim();
    return await callback(dir, p12Path, certPath, chain ? chainPath : null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function extractCertificate(p12Bytes: Buffer, passphrase: string): Promise<ParsedCertificate> {
  try {
    return await withP12Files(p12Bytes, passphrase, async (_dir, p12Path, certPath, chainPath) => {
      const pem = await readFile(certPath, "utf8");
      const certificates = [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)];
      if (!certificates.length) fail("O PKCS#12 precisa conter uma chave privada e certificado final.");
      const cert = new X509Certificate(certificates[0][0]);
      const certText = (await runOpenSsl(["x509", "-in", certPath, "-noout", "-text"], _dir)).toString("utf8");
      const key = cert.publicKey;
      if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
        fail("O certificado institucional precisa usar RSA de pelo menos 2048 bits.");
      }
      const now = Date.now();
      const validFrom = Date.parse(cert.validFrom);
      const validUntil = Date.parse(cert.validTo);
      if (now < validFrom) fail("O certificado institucional ainda não está válido.");
      if (now > validUntil) fail("O certificado institucional está expirado.");
      if (/X509v3 Basic Constraints:[^\n]*\n\s+CA:TRUE/i.test(certText)) fail("Envie o certificado final de assinatura, não um certificado de autoridade certificadora.");
      const keyUsage = certText.match(/X509v3 Key Usage:[^\n]*\n\s+([^\n]+)/i)?.[1];
      if (keyUsage && !/Digital Signature/i.test(keyUsage)) fail("O certificado não permite uso para assinatura digital.");
      const commonName = cert.subject.split(/\n|,/).map((item) => item.trim()).find((item) => item.startsWith("CN="))?.slice(3);
      const subject = commonName?.trim() ? commonName.trim().slice(0, 160) : "Certificado institucional";
      // Ask OpenSSL to sign and verify a short challenge before accepting the PKCS#12.
      const challengePath = join(_dir, "challenge.bin");
      const sigPath = join(_dir, "challenge.cms");
      await writeFile(challengePath, "Suindá institutional certificate validation", { mode: 0o600, flag: "wx" });
      await runOpenSsl(["cms", "-sign", "-binary", "-in", challengePath, "-signer", certPath,
        ...(chainPath ? ["-certfile", chainPath] : []), "-inkey", p12Path,
        "-keyform", "P12", "-passin", "fd:3", "-outform", "DER", "-out", sigPath, "-cades"], _dir);
      await runOpenSsl(["cms", "-verify", "-binary", "-inform", "DER", "-in", sigPath, "-content", challengePath,
        "-noverify", "-out", join(_dir, "verified.bin")], _dir);
      return {
        subject,
        serial: cert.serialNumber.slice(-64),
        fingerprint: createHash("sha256").update(cert.raw).digest("hex"),
        valid_from: new Date(validFrom),
        valid_until: new Date(validUntil),
      };
    });
  } catch (error) {
    if (error instanceof HttpException) throw error;
    fail("Não foi possível abrir ou validar o PKCS#12; confira arquivo, senha, correspondência da chave e disponibilidade do OpenSSL.");
  }
}

export async function signCertificatePdfWithP12(input: {
  pdf: Buffer;
  p12: Buffer;
  passphrase: string;
  signerName: string;
  signingTime?: Date;
}) {
  const pdfDoc = await PDFDocument.load(input.pdf, { updateMetadata: false });
  pdflibAddPlaceholder({
    pdfDoc,
    reason: "Assinatura institucional do certificado Suindá",
    contactInfo: "",
    name: input.signerName,
    location: "",
    signingTime: input.signingTime ?? new Date(),
    signatureLength: SIGNATURE_PLACEHOLDER_BYTES,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    appName: "Suindá / Orbit",
  });
  const prepared = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
  return withP12Files(input.p12, input.passphrase, async (_dir, p12Path, certPath, chainPath) => {
    class OpenSslP12Signer extends Signer {
      async sign(pdfBuffer: Buffer) {
        const contentPath = join(_dir, "signed-content.bin");
        const signaturePath = join(_dir, "signature.der");
        await writeFile(contentPath, pdfBuffer, { mode: 0o600, flag: "wx" });
        await runOpenSsl(["cms", "-sign", "-binary", "-in", contentPath, "-signer", certPath,
          ...(chainPath ? ["-certfile", chainPath] : []), "-inkey", p12Path,
          "-keyform", "P12", "-passin", "fd:3", "-outform", "DER", "-out", signaturePath, "-cades"], _dir);
        return readFile(signaturePath);
      }
    }
    return signPdf.sign(prepared, new OpenSslP12Signer(), input.signingTime);
  });
}

export const suindaCertificateSigningPlugin: PluginDefinition = {
  id: PLUGIN_ID,
  name: "Suindá · Assinatura de certificados PDF",
  version: "1.0.0",
  description: "Assina os PDFs acadêmicos com certificado institucional PKCS#12 informado por cada workspace.",
  scope: "workspace",
  parentPlugin: "suinda-learning",
  dependencies: ["suinda-learning"],
  capabilities: [{ id: "manage", name: "Configurar assinatura de certificados", permissions: [`plugin.${PLUGIN_ID}.manage`] }],
  handlesRoute: (path) => /^\/extensions\/suinda-certificate-signing\/(?:workspaces\/[0-9a-f-]{36}\/config|me\/enrollments\/[0-9a-f-]{36}\/status)$/.test(path),
  routePermission: () => null,
};

@Injectable()
export class SuindaCertificateSigningService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService,
    @Inject(SecretVault) private readonly vault: SecretVault, @Inject(PluginRegistry) private readonly registry: PluginRegistry) {}

  private available() {
    if (!this.registry.isEnabled(PLUGIN_ID) || !this.registry.isEnabled("suinda-learning")) fail("A assinatura de certificados PDF está desativada.", 503);
  }

  private async manager(userId: string, workspaceInput: string) {
    if (!UUID.test(workspaceInput)) fail("Workspace inválido.");
    const workspace = await this.db.one<{ id: string }>("SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL", [workspaceInput]);
    if (!workspace) fail("Workspace não encontrado.", 404);
    const allowed = await this.access.has(userId, "plugin.suinda-learning.manage", "workspace", workspaceInput)
      || await this.access.has(userId, "plugin.suinda-learning.manage");
    if (!allowed) {
      await this.access.audit(userId, "access.denied", `${PLUGIN_ID}.config.manage`, { type: "workspace", id: workspaceInput });
      fail("A configuração de assinatura não está autorizada neste workspace.", 403);
    }
    return workspaceInput;
  }

  private safeSettings(row: SigningSettings | null) {
    const now = Date.now();
    const validFrom = row ? Date.parse(row.valid_from) : NaN;
    const validUntil = row ? Date.parse(row.valid_until) : NaN;
    return {
      configured: Boolean(row),
      usable: Boolean(row && Number.isFinite(validFrom) && Number.isFinite(validUntil) && validFrom <= now && validUntil >= now),
      subject: row?.certificate_subject ?? null,
      serial: row?.certificate_serial ?? null,
      fingerprint_sha256: row?.certificate_fingerprint ?? null,
      valid_from: row?.valid_from ?? null,
      valid_until: row?.valid_until ?? null,
      updated_at: row?.updated_at ?? null,
      sub_filter: row ? SUBFILTER_ETSI_CADES_DETACHED : null,
    };
  }

  async settings(workspaceId: string, userId: string) {
    this.available();
    const workspace = await this.manager(userId, workspaceId);
    const row = await this.db.one<SigningSettings>("SELECT * FROM suinda_certificate_signing_settings WHERE workspace_id=$1", [workspace]);
    return this.safeSettings(row);
  }

  async configure(workspaceId: string, userId: string, input: unknown) {
    this.available();
    const workspace = await this.manager(userId, workspaceId);
    const body = only(input, ["p12_base64", "passphrase"]);
    const p12 = decodeP12(body.p12_base64);
    if (typeof body.passphrase !== "string" || body.passphrase.length < 1 || body.passphrase.length > 1024) {
      fail("Informe a senha do certificado PKCS#12 (máximo de 1.024 caracteres).");
    }
    const metadata = await extractCertificate(p12, body.passphrase);
    const encrypted = this.vault.seal({ p12_base64: p12.toString("base64"), passphrase: body.passphrase });
    const row = await this.db.one<SigningSettings>(
      `INSERT INTO suinda_certificate_signing_settings(workspace_id,p12_encrypted,certificate_subject,certificate_serial,
         certificate_fingerprint,valid_from,valid_until,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT(workspace_id) DO UPDATE SET p12_encrypted=EXCLUDED.p12_encrypted,
         certificate_subject=EXCLUDED.certificate_subject,certificate_serial=EXCLUDED.certificate_serial,
         certificate_fingerprint=EXCLUDED.certificate_fingerprint,valid_from=EXCLUDED.valid_from,
         valid_until=EXCLUDED.valid_until,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING *`,
      [workspace, encrypted, metadata.subject, metadata.serial, metadata.fingerprint, metadata.valid_from, metadata.valid_until, userId],
    );
    await this.access.audit(userId, `${PLUGIN_ID}.configured`,
      `${workspace}; fingerprint_sha256=${metadata.fingerprint}; valid_until=${metadata.valid_until.toISOString()}`,
      { type: "workspace", id: workspace });
    return this.safeSettings(row);
  }

  async remove(workspaceId: string, userId: string) {
    this.available();
    const workspace = await this.manager(userId, workspaceId);
    const result = await this.db.query("DELETE FROM suinda_certificate_signing_settings WHERE workspace_id=$1", [workspace]);
    await this.access.audit(userId, `${PLUGIN_ID}.removed`, workspace, { type: "workspace", id: workspace });
    return { removed: result.length > 0 };
  }

  async learnerStatus(enrollmentId: string, userId: string) {
    if (!UUID.test(enrollmentId)) fail("Matrícula não encontrada.", 404);
    const enrollment = await this.db.one<{ workspace_id: string }>(
      `SELECT workspace_id FROM extension_records WHERE id=$1 AND plugin_id='suinda-learning' AND kind='enrollment'
         AND payload->>'learner_user_id'=$2 AND state=ANY(ARRAY['enrolled','active','paused','completed'])`, [enrollmentId, userId]);
    if (!enrollment) fail("Matrícula não encontrada.", 404);
    if (!this.registry.isEnabled(PLUGIN_ID) || !this.registry.isEnabled("suinda-learning")) {
      return { ...this.safeSettings(null), reason: "plugin_disabled" as const };
    }
    const row = await this.db.one<SigningSettings>("SELECT * FROM suinda_certificate_signing_settings WHERE workspace_id=$1", [enrollment.workspace_id]);
    return { ...this.safeSettings(row), reason: row ? "configured" as const : "not_configured" as const };
  }

  async signPdf(workspaceId: string, pdf: Buffer) {
    if (!this.registry.isEnabled(PLUGIN_ID) || !this.registry.isEnabled("suinda-learning")) {
      return { data: pdf, signed: false as const, reason: "plugin_disabled" as const };
    }
    const row = await this.db.one<SigningSettings>("SELECT * FROM suinda_certificate_signing_settings WHERE workspace_id=$1", [workspaceId]);
    if (!row) return { data: pdf, signed: false as const, reason: "not_configured" as const };
    let secret: { p12_base64?: unknown; passphrase?: unknown };
    try { secret = this.vault.open(row.p12_encrypted); }
    catch { return fail("A credencial institucional não pôde ser aberta; verifique a chave do cofre Orbit.", 503); }
    if (typeof secret.p12_base64 !== "string" || typeof secret.passphrase !== "string") fail("A credencial institucional armazenada está incompleta.", 503);
    const p12 = decodeP12(secret.p12_base64);
    const metadata = await extractCertificate(p12, secret.passphrase);
    if (metadata.fingerprint !== row.certificate_fingerprint) fail("A impressão digital da credencial armazenada não corresponde à configuração; salve-a novamente.", 503);
    try {
      const signed = await signCertificatePdfWithP12({ pdf, p12, passphrase: secret.passphrase, signerName: metadata.subject });
      return { data: signed, signed: true as const, reason: "signed" as const, sub_filter: SUBFILTER_ETSI_CADES_DETACHED };
    } catch (error) {
      fail(`Não foi possível assinar este PDF com o certificado institucional: ${safeError(error)}`, 503);
    }
  }
}

@Controller("extensions/suinda-certificate-signing")
export class SuindaCertificateSigningController {
  constructor(@Inject(SuindaCertificateSigningService) private readonly service: SuindaCertificateSigningService) {}

  @Get("workspaces/:workspaceId/config") settings(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    return this.service.settings(workspaceId, String(req.orbitUser));
  }
  @Put("workspaces/:workspaceId/config") configure(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: unknown) {
    return this.service.configure(workspaceId, String(req.orbitUser), body);
  }
  @Delete("workspaces/:workspaceId/config") remove(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    return this.service.remove(workspaceId, String(req.orbitUser));
  }
  @Get("me/enrollments/:enrollmentId/status") learnerStatus(@Req() req: AccessRequest, @Param("enrollmentId") enrollmentId: string) {
    return this.service.learnerStatus(enrollmentId, String(req.orbitUser));
  }
}
