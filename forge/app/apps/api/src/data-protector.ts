import { configuredKeys, openJson, sealJson } from "./keyring-crypto";

const purpose = "orbit-record-sensitive-fields";
const fieldMarker = "orbit-field-v1:";
const attachmentMarker = Buffer.from([0x00, 0xff, 0x4f, 0x52, 0x42, 0x49, 0x54, 0x2d, 0x41, 0x54, 0x54, 0x2d, 0x31, 0x00]);
const unavailable = "Conteúdo protegido indisponível; confira a configuração de chaves.";

export type ProtectedFieldContext = {
  pluginId: string;
  kind: string;
  recordId: string;
  revision: number;
  path: string;
};

export type ProtectedAttachmentContext = {
  pluginId: string;
  kind: string;
  recordId: string;
  revision: number;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sha256: string;
};

function contextAad(context: ProtectedFieldContext) {
  if (!context.pluginId || !context.kind || !context.recordId || !Number.isInteger(context.revision) || context.revision < 1)
    throw new Error(unavailable);
  const segments = pathSegments(context.path);
  return JSON.stringify([purpose, context.pluginId, context.kind, context.recordId, context.revision, segments]);
}

function attachmentAad(context: ProtectedAttachmentContext) {
  if (!context.pluginId || !context.kind || !context.recordId || !context.attachmentId
    || !Number.isInteger(context.revision) || context.revision < 1 || !/^[a-f0-9]{64}$/.test(context.sha256))
    throw new Error(unavailable);
  return JSON.stringify(["orbit-record-attachment", context.pluginId, context.kind, context.recordId,
    context.revision, context.attachmentId, context.fileName, context.mimeType, context.sha256]);
}

function pathSegments(path: string) {
  const segments = path.split(".");
  if (!segments.length || segments.some((segment) => !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(segment) || segment === "__proto__"))
    throw new Error("Invalid protected field path.");
  return segments;
}

function getAtPath(source: Record<string, unknown>, segments: string[]) {
  let current: unknown = source;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setAtPath(source: Record<string, unknown>, segments: string[], value: unknown) {
  let current: Record<string, unknown> = source;
  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];
    if (!child || typeof child !== "object" || Array.isArray(child)) return false;
    current = child as Record<string, unknown>;
  }
  if (!Object.hasOwn(current, segments.at(-1)!)) return false;
  current[segments.at(-1)!] = value;
  return true;
}

function clonePayload(payload: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function activeKey() {
  const key = process.env.ORBIT_DATA_ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("Configure ORBIT_DATA_ENCRYPTION_KEY to protect sensitive record fields.");
  return key;
}

function keyring() {
  return configuredKeys(process.env.ORBIT_DATA_ENCRYPTION_KEY, process.env.ORBIT_DATA_ENCRYPTION_KEY_PREVIOUS);
}

export function isProtectedFieldEnvelope(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(fieldMarker);
}

/** Encrypts a JSON value using AES-256-GCM and authenticates its record identity and path. */
export function sealProtectedField(value: unknown, context: ProtectedFieldContext): string {
  try {
    return fieldMarker + sealJson(value, activeKey(), purpose, contextAad(context));
  } catch {
    throw new Error(unavailable);
  }
}

/** Opens ciphertext only with the exact field context. Unmarked values are legacy plaintext for staged migration. */
export function openProtectedField<T = unknown>(value: unknown, context: ProtectedFieldContext): T {
  if (!isProtectedFieldEnvelope(value)) return value as T;
  try {
    return openJson<T>(value.slice(fieldMarker.length), keyring(), purpose, contextAad(context));
  } catch {
    throw new Error(unavailable);
  }
}

export function isProtectedAttachmentEnvelope(value: Buffer): boolean {
  return value.subarray(0, attachmentMarker.length).equals(attachmentMarker);
}

export function protectedAttachmentPrefix(): Buffer { return Buffer.from(attachmentMarker); }

/** Encrypts attachment bytes without changing the plaintext checksum stored alongside them. */
export function sealProtectedAttachment(value: Buffer, context: ProtectedAttachmentContext): Buffer {
  try {
    const envelope = sealJson(value.toString("base64"), activeKey(), "orbit-record-attachment-v1", attachmentAad(context));
    return Buffer.concat([attachmentMarker, Buffer.from(envelope, "utf8")]);
  } catch {
    throw new Error(unavailable);
  }
}

/** Opens protected attachment bytes; legacy plaintext remains readable during staged backfill. */
export function openProtectedAttachment(value: Buffer, context: ProtectedAttachmentContext): Buffer {
  if (!isProtectedAttachmentEnvelope(value)) return value;
  try {
    const envelope = value.subarray(attachmentMarker.length).toString("utf8");
    const decoded = openJson<string>(envelope, keyring(), "orbit-record-attachment-v1", attachmentAad(context));
    const bytes = Buffer.from(decoded, "base64");
    if (!bytes.length || bytes.toString("base64") !== decoded) throw new Error(unavailable);
    return bytes;
  } catch {
    throw new Error(unavailable);
  }
}

/** Applies the legacy-readable, write-encrypted policy to declared top-level or nested JSON paths. */
export function protectRecordPayload(
  payload: Record<string, unknown>, fields: string[] | undefined, context: Omit<ProtectedFieldContext, "path">,
): Record<string, unknown> {
  const result = clonePayload(payload);
  const seen = new Set<string>();
  for (const path of fields || []) {
    const segments = pathSegments(path);
    if (seen.has(path) || [...seen].some((prior) => prior.startsWith(`${path}.`) || path.startsWith(`${prior}.`)))
      throw new Error("Overlapping protected field paths are invalid.");
    seen.add(path);
    const value = getAtPath(result, segments);
    if (value === undefined || value === null) continue;
    const fieldContext = { ...context, path };
    if (isProtectedFieldEnvelope(value)) {
      // Verify an existing envelope against this exact row/revision/path instead of nesting ciphertext.
      openProtectedField(value, fieldContext);
      continue;
    }
    setAtPath(result, segments, sealProtectedField(value, fieldContext));
  }
  return result;
}

/** Decrypts declared fields. Invalid ciphertext and missing/incorrect keys always fail closed. */
export function unprotectRecordPayload<T extends Record<string, unknown>>(
  payload: T, fields: string[] | undefined, context: Omit<ProtectedFieldContext, "path">,
): T {
  const result = clonePayload(payload);
  const seen = new Set<string>();
  for (const path of fields || []) {
    const segments = pathSegments(path);
    if (seen.has(path) || [...seen].some((prior) => prior.startsWith(`${path}.`) || path.startsWith(`${prior}.`)))
      throw new Error("Overlapping protected field paths are invalid.");
    seen.add(path);
    const value = getAtPath(result, segments);
    if (value === undefined || value === null) continue;
    if (!setAtPath(result, segments, openProtectedField(value, { ...context, path })))
      throw new Error(unavailable);
  }
  return result as T;
}

export function protectedProjectionFields(fields: string[], sensitiveFields: string[] | undefined) {
  const sensitive = sensitiveFields || [];
  return fields.filter((field) => !sensitive.some((path) => field === path || field.startsWith(`${path}.`) || path.startsWith(`${field}.`)));
}

export function redactProtectedPaths<T extends Record<string, unknown>>(payload: T, sensitiveFields: string[] | undefined): T {
  const result = clonePayload(payload);
  const root = result as Record<string, unknown>;
  for (const path of sensitiveFields || []) {
    const segments = pathSegments(path);
    let current: Record<string, unknown> = root;
    let present = true;
    for (const segment of segments.slice(0, -1)) {
      const child = current[segment];
      if (!child || typeof child !== "object" || Array.isArray(child)) { present = false; break; }
      current = child as Record<string, unknown>;
    }
    if (present) delete current[segments.at(-1)!];
  }
  return result as T;
}

export function assertNoProtectedFieldEnvelope(value: unknown): void {
  if (isProtectedFieldEnvelope(value)) throw new Error(unavailable);
  if (Array.isArray(value)) {
    for (const item of value) assertNoProtectedFieldEnvelope(item);
  } else if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    for (const item of Object.values(value)) assertNoProtectedFieldEnvelope(item);
  }
}
