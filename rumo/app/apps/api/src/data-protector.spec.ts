import assert from "node:assert/strict";
import { test } from "node:test";
import {
  openProtectedField,
  openProtectedAttachment,
  isProtectedAttachmentEnvelope,
  protectRecordPayload,
  protectedProjectionFields,
  sealProtectedAttachment,
  sealProtectedField,
  unprotectRecordPayload,
} from "./data-protector";

const envKeys = ["ORBIT_DATA_ENCRYPTION_KEY", "ORBIT_DATA_ENCRYPTION_KEY_PREVIOUS"];
async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try { await run(); }
  finally {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const context = { pluginId: "sample", kind: "profile", recordId: "record-1", revision: 2, path: "private.phone" };
const recordContext = { pluginId: context.pluginId, kind: context.kind, recordId: context.recordId, revision: context.revision };
const attachmentContext = { pluginId: "suinda-learning", kind: "learner_document", recordId: "record-1", revision: 2,
  attachmentId: "attachment-1", fileName: "documento.pdf", mimeType: "application/pdf", sha256: "a".repeat(64) };

test("sensitive field envelopes authenticate plugin, record, revision and path", async () => withEnv({ ORBIT_DATA_ENCRYPTION_KEY: "data-key-one-with-adequate-entropy" }, () => {
  const sealed = sealProtectedField("+55 81 99999-0000", context);
  assert.ok(sealed.startsWith("orbit-field-v1:v2."));
  assert.equal(openProtectedField(sealed, context), "+55 81 99999-0000");
  for (const change of [
    { ...context, pluginId: "other" }, { ...context, kind: "other" }, { ...context, recordId: "record-2" },
    { ...context, revision: 3 }, { ...context, path: "private.email" },
  ]) assert.throws(() => openProtectedField(sealed, change), /Conteúdo protegido indisponível/);
}));

test("protected record payloads write encrypted values, dual-read legacy values and rotate keys", async () => withEnv({ ORBIT_DATA_ENCRYPTION_KEY: "data-key-old-with-adequate-entropy" }, () => {
  const input = { owner_id: "learner-1", private: { phone: "+55 81 99999-0000", note: null }, public_bio: "hello" };
  const encrypted = protectRecordPayload(input, ["private.phone", "private.note"], recordContext);
  assert.equal(encrypted.owner_id, input.owner_id);
  assert.equal(encrypted.public_bio, input.public_bio);
  assert.equal(encrypted.private && typeof encrypted.private === "object" && (encrypted.private as Record<string, unknown>).phone === input.private.phone, false);
  assert.deepEqual(unprotectRecordPayload(encrypted, ["private.phone", "private.note"], recordContext), input);
  process.env.ORBIT_DATA_ENCRYPTION_KEY = "data-key-new-with-adequate-entropy";
  process.env.ORBIT_DATA_ENCRYPTION_KEY_PREVIOUS = "data-key-old-with-adequate-entropy";
  assert.deepEqual(unprotectRecordPayload(encrypted, ["private.phone", "private.note"], recordContext), input);
  const rotated = protectRecordPayload(input, ["private.phone"], { pluginId: context.pluginId, kind: context.kind, recordId: context.recordId, revision: 3 });
  assert.deepEqual(unprotectRecordPayload(rotated, ["private.phone"], { pluginId: context.pluginId, kind: context.kind, recordId: context.recordId, revision: 3 }), input);
  delete process.env.ORBIT_DATA_ENCRYPTION_KEY_PREVIOUS;
  assert.throws(() => unprotectRecordPayload(encrypted, ["private.phone"], { pluginId: context.pluginId, kind: context.kind, recordId: context.recordId, revision: context.revision }), /Conteúdo protegido indisponível/);
}));

test("ciphertext corruption fails closed and protected fields are removed from public projections", async () => withEnv({ ORBIT_DATA_ENCRYPTION_KEY: "data-key-with-adequate-entropy" }, () => {
  const sealed = sealProtectedField("private marker", context);
  const envelope = sealed.slice("orbit-field-v1:".length).split(".");
  envelope[3] = `${envelope[3][0] === "A" ? "B" : "A"}${envelope[3].slice(1)}`;
  assert.throws(() => openProtectedField(`orbit-field-v1:${envelope.join(".")}`, context), /Conteúdo protegido indisponível/);
  assert.deepEqual(protectedProjectionFields(["private", "public_bio", "private.phone"], ["private.phone"]), ["public_bio"]);
  assert.deepEqual(unprotectRecordPayload({ phone: "legacy phone" }, ["phone"], { pluginId: "sample", kind: "profile", recordId: "r", revision: 1 }), { phone: "legacy phone" });
}));

test("sensitive attachment bytes are encrypted and authenticated to their record revision and metadata", async () => withEnv({ ORBIT_DATA_ENCRYPTION_KEY: "attachment-key-with-adequate-entropy" }, () => {
  const plain = Buffer.from("private academic document");
  const sealed = sealProtectedAttachment(plain, attachmentContext);
  assert.notDeepEqual(sealed, plain);
  assert.equal(isProtectedAttachmentEnvelope(sealed), true);
  assert.deepEqual(openProtectedAttachment(sealed, attachmentContext), plain);
  assert.deepEqual(openProtectedAttachment(plain, attachmentContext), plain);
  for (const change of [
    { ...attachmentContext, pluginId: "other" }, { ...attachmentContext, recordId: "record-2" },
    { ...attachmentContext, revision: 3 }, { ...attachmentContext, attachmentId: "attachment-2" },
    { ...attachmentContext, fileName: "other.pdf" }, { ...attachmentContext, sha256: "b".repeat(64) },
  ]) assert.throws(() => openProtectedAttachment(sealed, change), /Conteúdo protegido indisponível/);
}));
