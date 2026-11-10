import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import test from "node:test";
import { SecretVault } from "../secrets";
import { signCertificatePdfWithP12, suindaCertificateSigningPlugin, SuindaCertificateSigningService } from "./suinda-certificate-signing";

const workspaceId = "00000000-0000-4000-8000-000000000801";
const learnerId = "00000000-0000-4000-8000-000000000802";
const enrollmentId = "00000000-0000-4000-8000-000000000803";
const password = "fixture-password-only";

function makeFixtureP12(includeIntermediate = true) {
  const dir = mkdtempSync(join(tmpdir(), "suinda-pades-fixture-"));
  const rootKeyPath = join(dir, "root.key");
  const rootCertPath = join(dir, "root.crt");
  const intermediateKeyPath = join(dir, "intermediate.key");
  const intermediateRequestPath = join(dir, "intermediate.csr");
  const intermediateCertPath = join(dir, "intermediate.crt");
  const keyPath = join(dir, "fixture.key");
  const requestPath = join(dir, "fixture.csr");
  const certPath = join(dir, "fixture.crt");
  const p12Path = join(dir, "fixture.p12");
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3", "-subj",
      "/CN=Fixture Suinda Root", "-addext", "basicConstraints=critical,CA:TRUE,pathlen:1", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      "-keyout", rootKeyPath, "-out", rootCertPath], { stdio: "ignore" });
    execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=Fixture Suinda Intermediate",
      "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      "-keyout", intermediateKeyPath, "-out", intermediateRequestPath], { stdio: "ignore" });
    execFileSync("openssl", ["x509", "-req", "-in", intermediateRequestPath, "-CA", rootCertPath, "-CAkey", rootKeyPath,
      "-CAcreateserial", "-days", "2", "-copy_extensions", "copy", "-out", intermediateCertPath], { stdio: "ignore" });
    execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=Fixture Suinda Institution",
      "-addext", "keyUsage=critical,digitalSignature", "-addext", "basicConstraints=critical,CA:FALSE",
      "-keyout", keyPath, "-out", requestPath], { stdio: "ignore" });
    execFileSync("openssl", ["x509", "-req", "-in", requestPath, "-CA", intermediateCertPath, "-CAkey", intermediateKeyPath,
      "-CAcreateserial", "-days", "1", "-copy_extensions", "copy", "-out", certPath], { stdio: "ignore" });
    const exportArgs = ["pkcs12", "-export", "-inkey", keyPath, "-in", certPath];
    if (includeIntermediate) exportArgs.push("-certfile", intermediateCertPath);
    exportArgs.push("-out", p12Path, "-passout", `pass:${password}`);
    execFileSync("openssl", exportArgs, { stdio: "ignore" });
    return readFileSync(p12Path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createRegistry(enabled = true) {
  return { isEnabled: (pluginId: string) => pluginId === "suinda-learning" || pluginId === "suinda-certificate-signing" && enabled };
}

test("certificate signing child declares its parent, own routes and no production-generated keys", () => {
  assert.equal(suindaCertificateSigningPlugin.parentPlugin, "suinda-learning");
  assert.deepEqual(suindaCertificateSigningPlugin.dependencies, ["suinda-learning"]);
  assert.equal(suindaCertificateSigningPlugin.handlesRoute?.(`/extensions/suinda-certificate-signing/workspaces/${workspaceId}/config`), true);
  assert.equal(suindaCertificateSigningPlugin.handlesRoute?.(`/extensions/suinda-certificate-signing/me/enrollments/${enrollmentId}/status`), true);
  assert.equal(suindaCertificateSigningPlugin.handlesRoute?.("/extensions/suinda-certificate-signing/workspaces/not-a-uuid/config"), false);
  assert.doesNotMatch(readFileSync(resolve(__dirname, "./suinda-certificate-signing.ts"), "utf8"), /generateKeyPair|generateKeyPairSync/);
});

test("migration persists only the SecretVault envelope and first boot applies it after the base schema", () => {
  const migration = readFileSync(resolve(__dirname, "../../sql/migrations/201_suinda_certificate_pdf_signing.sql"), "utf8");
  const schema = readFileSync(resolve(__dirname, "../../sql/schema.sql"), "utf8");
  const bootstrap = readFileSync(resolve(__dirname, "../migrate.ts"), "utf8");
  assert.match(bootstrap, /sql\/schema\.sql/);
  assert.match(bootstrap, /migrateVersions\(pool\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS suinda_certificate_signing_settings/);
  assert.match(migration, /p12_encrypted text NOT NULL/);
  assert.match(migration, /certificate_fingerprint/);
  assert.doesNotMatch(migration, /p12_base64|passphrase text/i);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS suinda_certificate_signing_settings/);
});

test("workspace upload validates and encrypts only the supplied fixture PKCS#12", async () => {
  const p12 = makeFixtureP12();
  const oldSecret = process.env.ORBIT_SECRET_KEY;
  process.env.ORBIT_SECRET_KEY = "suinda-certificate-signing-fixture-key";
  const vault = new SecretVault();
  let savedValues: unknown[] = [];
  const db = {
    async one(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT id FROM workspaces")) return { id: workspaceId };
      if (sql.includes("INSERT INTO suinda_certificate_signing_settings")) {
        savedValues = values;
        return { workspace_id: values[0], p12_encrypted: values[1], certificate_subject: values[2], certificate_serial: values[3],
          certificate_fingerprint: values[4], valid_from: values[5], valid_until: values[6], updated_at: new Date().toISOString() };
      }
      return null;
    },
    async query() { return []; },
  };
  const access = { async has() { return true; }, async audit() {} };
  const service = new SuindaCertificateSigningService(db as never, access as never, vault, createRegistry() as never);
  try {
    const settings = await service.configure(workspaceId, learnerId, { p12_base64: p12.toString("base64"), passphrase: password });
    assert.equal(settings.configured, true);
    assert.equal(settings.usable, true);
    assert.equal(settings.subject, "Fixture Suinda Institution");
    assert.match(settings.fingerprint_sha256 || "", /^[0-9a-f]{64}$/);
    assert.equal("p12_encrypted" in settings, false);
    const stored = String(savedValues[1]);
    assert.equal(stored.includes(p12.toString("base64")), false);
    assert.equal(stored.includes(password), false);
    assert.deepEqual(vault.open(stored), { p12_base64: p12.toString("base64"), passphrase: password });
    await assert.rejects(() => service.configure(workspaceId, learnerId, { p12_base64: p12.toString("base64"), passphrase: "wrong-password" }), /PKCS#12|senha/);
  } finally {
    if (oldSecret === undefined) delete process.env.ORBIT_SECRET_KEY;
    else process.env.ORBIT_SECRET_KEY = oldSecret;
  }
});

test("fixture PKCS#12 signs the PDF ByteRange and embeds its intermediate certificate in CMS", async () => {
  const p12 = makeFixtureP12();
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]).drawText("Certificado de fixture Suindá");
  const unsigned = Buffer.from(await pdf.save({ useObjectStreams: false }));
  const signed = await signCertificatePdfWithP12({ pdf: unsigned, p12, passphrase: password, signerName: "Fixture Suinda Institution" });
  const text = signed.toString("latin1");
  assert.match(text, /\/SubFilter\s*\/ETSI\.CAdES\.detached/);
  const byteRange = text.match(/\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  assert.ok(byteRange, "signed PDF must declare a detached signature ByteRange");
  const firstLength = Number(byteRange[1]);
  const secondOffset = Number(byteRange[2]);
  const secondLength = Number(byteRange[3]);
  assert.ok(firstLength > 0 && secondOffset > firstLength && secondLength > 0);
  assert.equal(secondOffset + secondLength, signed.length);
  assert.ok(signed.includes(Buffer.from("Fixture Suinda Institution", "latin1")));
  const contentsHex = text.match(/\/Contents\s*<([0-9a-f]+)>/i)?.[1];
  assert.ok(contentsHex, "PDF signature dictionary must contain CMS bytes");
  const cms = Buffer.from(contentsHex, "hex");
  const derLength = cms.readUInt8(1) & 0x80 ? 2 + (cms.readUInt8(1) & 0x7f) + cms.readUIntBE(2, cms.readUInt8(1) & 0x7f) : 2 + cms.readUInt8(1);
  const detachedContents = Buffer.concat([signed.subarray(0, firstLength), signed.subarray(secondOffset, secondOffset + secondLength)]);
  const dir = mkdtempSync(join(tmpdir(), "suinda-pades-verify-"));
  const cmsPath = join(dir, "signature.der");
  const contentPath = join(dir, "byte-range.bin");
  const verifiedPath = join(dir, "verified.bin");
  const certificatesPath = join(dir, "certificates.pem");
  try {
    writeFileSync(cmsPath, cms.subarray(0, derLength), { mode: 0o600, flag: "wx" });
    writeFileSync(contentPath, detachedContents, { mode: 0o600, flag: "wx" });
    execFileSync("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-in", cmsPath, "-content", contentPath,
      "-noverify", "-out", verifiedPath], { stdio: "ignore" });
    assert.deepEqual(readFileSync(verifiedPath), detachedContents, "CMS verification output must equal the signed PDF ByteRange bytes");
    execFileSync("openssl", ["pkcs7", "-inform", "DER", "-in", cmsPath, "-print_certs", "-out", certificatesPath], { stdio: "ignore" });
    assert.match(readFileSync(certificatesPath, "utf8"), /Fixture Suinda Intermediate/,
      "CMS should carry the unavailable intermediate certificate needed to build a trust path");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fixture PKCS#12 without CA certificates remains compatible", async () => {
  const p12 = makeFixtureP12(false);
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]).drawText("Certificado Suindá sem cadeia incluída");
  const unsigned = Buffer.from(await pdf.save({ useObjectStreams: false }));
  const signed = await signCertificatePdfWithP12({ pdf: unsigned, p12, passphrase: password, signerName: "Fixture Suinda Institution" });
  assert.match(signed.toString("latin1"), /\/SubFilter\s*\/ETSI\.CAdES\.detached/);
});

test("certificate download stays byte-identical when the child plugin is disabled or unconfigured", async () => {
  const pdf = Buffer.from("%PDF fixture without signature");
  const disabledDb = { async one() { throw new Error("must not read settings when disabled"); }, async query() { return []; } };
  const disabled = new SuindaCertificateSigningService(disabledDb as never, {} as never, {} as SecretVault, createRegistry(false) as never);
  assert.deepEqual(await disabled.signPdf(workspaceId, pdf), { data: pdf, signed: false, reason: "plugin_disabled" });
  const emptyDb = { async one() { return null; }, async query() { return []; } };
  const empty = new SuindaCertificateSigningService(emptyDb as never, {} as never, {} as SecretVault, createRegistry() as never);
  assert.deepEqual(await empty.signPdf(workspaceId, pdf), { data: pdf, signed: false, reason: "not_configured" });
});
