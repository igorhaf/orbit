import "reflect-metadata";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { genericPlugins, recordPlugins, recordsBasePlugin } from "./catalog";
import {
  validate,
  validateDefinition,
  assertSemanticValidation,
  assertPayloadFieldsImmutable,
  deadlineDueAt,
  deadlineTransition,
  nextWorkflowState,
} from "./rules";
import { decodeDocument, DocumentScanner } from "./documents";
import { PluginRegistry } from "../../execution/registries";
import { workspacesPlugin } from "../../workspaces/workspaces.plugin";
import { validCnpj } from "../common/identifiers";
import { ExtensionRecords } from "./records.service";
import type { PluginDefinition } from "../contract";
import { protectRecordPayload, sealProtectedAttachment } from "../../data-protector";

test("versioned record routes delegate access decisions to their record service", () => {
  assert.equal(recordsBasePlugin.handlesRoute?.("/extensions"), true);
  assert.equal(recordsBasePlugin.handlesRoute?.("/extensions/example-plugin/records/123"), true);
  assert.equal(recordsBasePlugin.handlesRoute?.("/extensions/example-learning/me/records/enrollment"), true);
  assert.equal(recordsBasePlugin.handlesRoute?.("/git/status"), false);
  assert.equal(recordsBasePlugin.routePermission?.("/extensions/example-plugin/records/123", "GET"), null);
});

test("generic document records and independent reviews require resource-scoped access", () => {
  const definitions = genericPlugins.find((plugin) => plugin.id === "documents")?.contributions?.recordKinds || {};
  assert.equal(definitions.document?.resourceScoped, true);
  assert.equal(definitions.document?.sensitiveAttachments, true);
  assert.equal(definitions.review?.resourceScoped, true);
  assert.equal(definitions.document?.managePermission, "plugin.documents.manage");
  assert.equal(definitions.review?.managePermission, "plugin.documents.manage");
});

test("record-specific child-plugin authorization runs before workspace fallback", async () => {
  const calls: unknown[][] = [];
  const access = {
    async authorizeRecord(...args: unknown[]) { calls.push(args); return true; },
    async has() { throw new Error("workspace fallback should not run after delegated authorization"); },
  };
  const service = new ExtensionRecords({} as never, access as never, new PluginRegistry(), new DocumentScanner());
  const canRecord = (service as unknown as { canRecord: (user: string, plugin: string, kind: string, recordId: string, action: string) => Promise<boolean> }).canRecord.bind(service);
  assert.equal(await canRecord("learner", "suinda-learning", "course", "unit-course", "read"), true);
  assert.deepEqual(calls, [["learner", "suinda-learning", "course", "unit-course", "read"]]);
});

test("generic record collections fill the result page after filtering inaccessible resource-scoped rows", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000041";
  const records = Array.from({ length: 102 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "scoped-fixture", kind: "private_item", title: `Item ${index + 1}`,
    state: "published", revision: 1, payload: { value: index + 1 }, created_by: "owner", updated_by: "owner",
    updated_at: new Date(Date.UTC(2026, 0, 2, 0, 0, 0) - index * 1000).toISOString(),
    cursor_updated_at: new Date(Date.UTC(2026, 0, 2, 0, 0, 0) - index * 1000).toISOString(),
  }));
  const queries: unknown[][] = [];
  const audited: string[] = [];
  const db = {
    async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : null; },
    async query(_sql: string, args: unknown[]) {
      queries.push(args);
      const cursor = args[2] as string | null;
      return cursor === null ? records.slice(0, 100) : records.slice(100);
    },
  };
  const access = { registerRoutes() {}, registerScope() {}, registerMembership() {},
    async has() { return false; }, async audit(_user: string, _action: string, target: string) { audited.push(target); } };
  const registry = new PluginRegistry();
  registry.register({ id: "scoped-fixture", name: "Scoped fixture", version: "1.0.0", scope: "workspace",
    contributions: { recordKinds: { private_item: {
      label: "Private item", schema: { type: "object", properties: { value: { type: "integer" } } },
      initial: "draft", transitions: { draft: ["published"], published: [] }, example: { value: 1 }, resourceScoped: true,
    } } } });
  const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
  Object.assign(service, { async canRecord(_user: string, _plugin: string, _kind: string, recordId: string) {
    return recordId === records[100]!.id || recordId === records[101]!.id;
  } });
  const visible = await service.list("scoped-fixture", workspaceId, "unit-reader");
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0]?.slice(2), [null, null, 100]);
  assert.deepEqual(queries[1]?.slice(2), [records[99]!.cursor_updated_at, records[99]!.id, 100]);
  assert.deepEqual(visible.map((record) => record.id), records.slice(100).map((record) => record.id));
  assert.deepEqual(audited, records.slice(100).map((record) => record.id));
});

test("generic personal record history includes records beyond the previous 500 row cap", async () => {
  const userId = "00000000-0000-4000-8000-000000000042";
  const records = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
    workspace_id: "00000000-0000-4000-8000-000000000041", plugin_id: "personal-fixture", kind: "profile",
    title: `Profile ${index + 1}`, state: "draft", revision: 1, payload: { owner_id: userId, value: index + 1 },
    created_by: userId, updated_by: userId,
  }));
  const audited: string[] = [];
  const db = { async query(sql: string, args: unknown[]) {
    assert.doesNotMatch(sql, /\bLIMIT\b/i);
    assert.deepEqual(args, ["personal-fixture", "profile", "owner_id", userId]);
    return records;
  } };
  const access = { registerRoutes() {}, registerScope() {}, registerMembership() {}, async has() {},
    async audit(_user: string, _action: string, target: string) { audited.push(target); } };
  const registry = new PluginRegistry();
  registry.register({ id: "personal-fixture", name: "Personal fixture", version: "1.0.0",
    contributions: { recordKinds: { profile: { label: "Profile", schema: { type: "object", properties: {
      owner_id: { type: "string" }, value: { type: "integer" },
    } }, initial: "draft", transitions: { draft: [] }, example: { owner_id: userId, value: 1 }, resourceScoped: true,
      personalOwnerField: "owner_id" } } } });
  const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
  Object.assign(service, { async canRecord() { return true; } });
  const visible = await service.mine("personal-fixture", "profile", userId);
  assert.equal(visible.length, 501);
  assert.equal(visible.at(-1)?.id, records.at(-1)?.id);
  assert.equal(audited.length, 501);
});

test("enabled child-plugin policies can remove restricted records from public projections", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000041";
  const rows = ["public-course", "corporate-course"].map((id) => ({ id, workspace_id: workspaceId, workspace_name: "Workspace",
    plugin_id: "policy-fixture", kind: "course", title: id, state: "published", revision: 1, payload: { summary: "public" }, created_by: "owner", updated_by: "owner" }));
  const db = { async query() { return rows; }, async one() { return null; } };
  const access = { registerRoutes() {}, registerScope() {}, registerMembership() {}, async has() { return true; }, async audit() {} };
  const registry = new PluginRegistry();
  registry.register({ id: "policy-fixture", name: "Policy fixture", version: "1.0.0", contributions: { recordKinds: { course: {
    label: "Course", schema: { type: "object", properties: { summary: { type: "string" } } }, initial: "draft", transitions: { draft: ["published"], published: [] },
    example: { summary: "Public" }, publicRead: { states: ["published"], fields: ["summary"] },
  } } } });
  registry.register({ id: "policy-child", name: "Policy child", version: "1.0.0", recordAccessPolicies: [{ targetPluginId: "policy-fixture", targetKind: "course",
    async isPubliclyAvailable(record) { return record.id !== "corporate-course"; } }] });
  const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
  const visible = await service.publicList("policy-fixture", "course");
  assert.deepEqual(visible.map((record) => record.id), ["public-course"]);
});

test("generic document download opens authenticated ciphertext only with its original file metadata", async () => {
  const priorKey = process.env.ORBIT_DATA_ENCRYPTION_KEY;
  process.env.ORBIT_DATA_ENCRYPTION_KEY = "generic-document-attachment-test-key-with-entropy";
  try {
    const recordId = "00000000-0000-4000-8000-000000000031";
    const workspaceId = "00000000-0000-4000-8000-000000000032";
    const plain = Buffer.from("private course document");
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(plain).digest("hex");
    const context = { pluginId: "documents", kind: "document", recordId, revision: 3,
      attachmentId: "extension_file", fileName: "aula.pdf", mimeType: "application/pdf", sha256 };
    const encrypted = sealProtectedAttachment(plain, context);
    let fileName = "aula.pdf";
    const db = {
      async one(sql: string) {
        if (sql.includes("extension_record_versions")) return { payload: { file_revision: 3, file_name: fileName,
          mime_type: "application/pdf", sha256, variant: "original" } };
        if (sql.includes("extension_files")) return { data: encrypted, sha256 };
        return null;
      },
      async query() { return []; },
    };
    const access = { registerRoutes() {}, registerScope() {}, registerMembership() {}, async has() { return true; }, async audit() {} };
    const registry = new PluginRegistry();
    registry.register(workspacesPlugin);
    for (const plugin of genericPlugins) registry.register(plugin);
    const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
    Object.defineProperty(service, "record", { value: async () => ({ id: recordId, workspace_id: workspaceId,
      plugin_id: "documents", kind: "document", title: "Aula", state: "published", revision: 3,
      payload: {}, created_by: "owner", updated_by: "owner" }) });

    const result = await service.download(recordId, 3, "reader");
    assert.deepEqual(result.data, plain);
    assert.equal(result.file_name, "aula.pdf");
    fileName = "arquivo-renomeado.pdf";
    await assert.rejects(service.download(recordId, 3, "reader"), /Conteúdo protegido indisponível/);
  } finally {
    if (priorKey === undefined) delete process.env.ORBIT_DATA_ENCRYPTION_KEY;
    else process.env.ORBIT_DATA_ENCRYPTION_KEY = priorKey;
  }
});

test("reading a resource-scoped record writes an audit event for that exact record", async () => {
  const recordId = "00000000-0000-4000-8000-000000000021";
  const workspaceId = "00000000-0000-4000-8000-000000000022";
  const readerId = "00000000-0000-4000-8000-000000000023";
  const record = {
    id: recordId, workspace_id: workspaceId, plugin_id: "documents", kind: "document",
    title: "Evidence", state: "published", revision: 1, payload: {}, created_by: "owner", updated_by: "owner",
  };
  const audits: unknown[][] = [];
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM extension_records")) return record;
      if (sql.includes("FROM workspaces")) return { id: workspaceId };
      return null;
    },
    async query() { return []; },
  };
  const access = {
    registerRoutes() {}, registerScope() {}, registerMembership() {},
    async has() { return false; },
    async hasScoped(_user: string, permission: string, _type: string, scope: string) {
      return permission === "plugin.documents.read" && scope === recordId;
    },
    async audit(...args: unknown[]) { audits.push(args); },
  };
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
  service.onModuleInit();
  assert.equal((await service.detail("documents", recordId, readerId)).id, recordId);
  assert.deepEqual(audits, [[readerId, "documents.record.read", recordId, { type: "extension_record", id: recordId }]]);
});

test("exact version snapshots enforce current record access and return the requested immutable version", async () => {
  const recordId = "00000000-0000-4000-8000-000000000041";
  const workspaceId = "00000000-0000-4000-8000-000000000042";
  const readerId = "00000000-0000-4000-8000-000000000043";
  const record = {
    id: recordId, workspace_id: workspaceId, plugin_id: "documents", kind: "document",
    title: "Evidence", state: "published", revision: 8, payload: { sha256: "latest" }, created_by: readerId, updated_by: readerId,
  };
  const version = { revision: 2, state: "draft", payload: { sha256: "pinned" }, created_at: "2026-10-01T00:00:00Z", actor_id: "author" };
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    async one(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      if (sql.includes("FROM workspaces")) return { id: workspaceId };
      if (sql.includes("FROM extension_records")) return record;
      if (sql.includes("FROM extension_record_versions")) return version;
      if (sql.includes("SELECT created_by")) return { created_by: readerId };
      return null;
    },
    async query(sql: string) { return sql.includes("SELECT created_by") ? [{ created_by: readerId }] : []; },
  };
  const access = {
    registerRoutes() {}, registerScope() {}, registerMembership() {},
    async has(_user: string, permission: string) { return permission === "plugin.documents.read"; },
    async audit() {},
  };
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
  const snapshot = await service.versionSnapshot("documents", recordId, 2, readerId);
  assert.equal(snapshot.revision, 2);
  assert.deepEqual(snapshot.payload, { sha256: "pinned" });
  assert.equal(snapshot.workspace_id, workspaceId);
  assert.deepEqual(queries.at(-1)?.values, [recordId, 2]);
  await assert.rejects(service.versionSnapshot("documents", recordId, 0, readerId), /Versão de registro inválida/);
});

test("sensitive generic record payloads are stored as ciphertext and opened only after record access", async () => {
  const oldKey = process.env.ORBIT_DATA_ENCRYPTION_KEY;
  process.env.ORBIT_DATA_ENCRYPTION_KEY = "record-data-protection-test-key-with-entropy";
  try {
    const recordId = "00000000-0000-4000-8000-000000000051";
    const workspaceId = "00000000-0000-4000-8000-000000000052";
    const readerId = "00000000-0000-4000-8000-000000000053";
    const rawPayload = protectRecordPayload(
      { owner_id: readerId, private_phone: "+1-555-0100", public_bio: "Public biography" },
      ["private_phone"], { pluginId: "sensitive-fixture", kind: "profile", recordId, revision: 2 },
    );
    const record = {
      id: recordId, workspace_id: workspaceId, plugin_id: "sensitive-fixture", kind: "profile", title: "Profile",
      state: "published", revision: 2, payload: rawPayload, created_by: readerId, updated_by: readerId,
    };
    const version = {
      record_id: recordId, revision: 2, title: "Profile", state: "published", payload: rawPayload,
      reason: "Updated", actor_id: readerId, created_at: "2026-10-01T00:00:00Z",
    };
    const db = {
      async one(sql: string) {
        if (sql.includes("FROM workspaces")) return { id: workspaceId };
        if (sql.includes("FROM extension_record_versions")) return version;
        if (sql.includes("FROM extension_records")) return record;
        if (sql.includes("SELECT created_by")) return { created_by: readerId };
        return null;
      },
      async query(sql: string) {
        if (sql.includes("FROM extension_record_versions")) return [version];
        if (sql.includes("FROM extension_record_links")) return [];
        if (sql.includes("FROM extension_records")) return [{ ...record, workspace_name: "Workspace" }];
        return [];
      },
    };
    const access = {
      registerRoutes() {}, registerScope() {}, registerMembership() {},
      async has() { return true; }, async hasScoped() { return true; }, async require() {}, async requireScoped() {}, async audit() {},
    };
    const registry = new PluginRegistry();
    registry.register(workspacesPlugin);
    registry.register({
      id: "sensitive-fixture", name: "Sensitive fixture", version: "1.0.0", scope: "workspace",
      contributions: { recordKinds: { profile: {
        label: "Profile", schema: { type: "object", properties: { owner_id: { type: "string" }, private_phone: { type: "string" }, public_bio: { type: "string" } } },
        initial: "draft", transitions: { draft: ["published"], published: [] }, example: {}, resourceScoped: true,
        personalOwnerField: "owner_id", sensitiveFields: ["private_phone"],
        publicRead: { states: ["published"], fields: ["private_phone", "public_bio"] },
      } } },
    });
    const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
    assert.equal((record.payload.private_phone as string).startsWith("orbit-field-v1:"), true);
    assert.deepEqual((await service.list("sensitive-fixture", workspaceId, readerId))[0].payload, {
      owner_id: readerId, private_phone: "+1-555-0100", public_bio: "Public biography",
    });
    const detail = await service.detail("sensitive-fixture", recordId, readerId);
    assert.deepEqual(detail.payload, { owner_id: readerId, private_phone: "+1-555-0100", public_bio: "Public biography" });
    assert.deepEqual(detail.versions[0].payload, detail.payload);
    assert.deepEqual((await service.versionSnapshot("sensitive-fixture", recordId, 2, readerId)).payload, detail.payload);
    const publicRecord = (await service.publicList("sensitive-fixture", "profile"))[0];
    assert.deepEqual(publicRecord.payload, { public_bio: "Public biography" });
    assert.equal(JSON.stringify([detail, publicRecord]).includes("orbit-field-v1:"), false);
  } finally {
    if (oldKey === undefined) delete process.env.ORBIT_DATA_ENCRYPTION_KEY;
    else process.env.ORBIT_DATA_ENCRYPTION_KEY = oldKey;
  }
});

test("generic create persists ciphertext in current rows, immutable versions and idempotency responses", async () => {
  const oldKey = process.env.ORBIT_DATA_ENCRYPTION_KEY;
  process.env.ORBIT_DATA_ENCRYPTION_KEY = "record-create-protection-test-key-with-entropy";
  try {
    const workspaceId = "00000000-0000-4000-8000-000000000062";
    const userId = "00000000-0000-4000-8000-000000000063";
    const operationKey = "00000000-0000-4000-8000-000000000064";
    const stored: { payload?: Record<string, unknown>; versionPayload?: Record<string, unknown>; response?: Record<string, unknown>; requestHash?: string } = {};
    let retry = false;
    const client = {
      async query(sql: string, values: unknown[] = []) {
        if (sql.includes("SELECT request_hash,response FROM extension_operations"))
          return { rows: retry && stored.response ? [{ request_hash: stored.requestHash, response: stored.response }] : [] };
        if (sql.includes("INSERT INTO extension_records")) {
          stored.payload = JSON.parse(String(values[6]));
          return { rows: [{
            id: values[0], workspace_id: values[1], plugin_id: values[2], kind: values[3], title: values[4], state: values[5],
            revision: 1, payload: stored.payload, created_by: values[7], updated_by: values[7],
          }] };
        }
        if (sql.includes("INSERT INTO extension_record_versions")) { stored.versionPayload = JSON.parse(String(values[4])); return { rows: [] }; }
        if (sql.includes("INSERT INTO extension_operations")) {
          stored.requestHash = String(values[4]); stored.response = JSON.parse(String(values[5])); return { rows: [] };
        }
        return { rows: [] };
      },
      release() {},
    };
    const db = {
      async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : null; },
      pool: { async connect() { return client; } },
    };
    const access = {
      registerRoutes() {}, registerScope() {}, registerMembership() {},
      async require() {}, async has() { return true; }, async audit() {},
    };
    const registry = new PluginRegistry();
    registry.register(workspacesPlugin);
    registry.register({
      id: "sensitive-fixture", name: "Sensitive fixture", version: "1.0.0", scope: "workspace",
      contributions: { recordKinds: { profile: {
        label: "Profile", schema: { type: "object", properties: { private_phone: { type: "string" }, owner_id: { type: "string" } }, required: ["private_phone", "owner_id"] },
        initial: "draft", transitions: { draft: ["published"], published: [] }, example: { private_phone: "example", owner_id: "user" }, sensitiveFields: ["private_phone"],
        selfServiceCreate: true, resourceScoped: true, personalOwnerField: "owner_id",
        authorizeCreate: async (actor, payload) => payload.owner_id === actor,
      } } },
    });
    let policyCalls = 0;
    registry.register({ id: "creation-policy", name: "Creation policy", version: "1.0.0", recordAccessPolicies: [{
      targetPluginId: "sensitive-fixture", targetKind: "profile",
      async validateSelfServiceCreate(payload) { policyCalls++; return payload.owner_id === userId ? [] : [{ severity: "error", code: "owner_mismatch", path: "owner_id", message: "Owner mismatch" }]; },
    }] });
    const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
    const body = {
      kind: "profile", title: "Profile", operation_key: operationKey,
      payload: { private_phone: "+1-555-0199", owner_id: userId },
    };
    const created = await service.create("sensitive-fixture", workspaceId, userId, body);
    assert.equal(created.payload.private_phone, "+1-555-0199");
    assert.equal(policyCalls, 1);
    assert.ok(String(stored.payload?.private_phone).startsWith("orbit-field-v1:"));
    assert.ok(String(stored.versionPayload?.private_phone).startsWith("orbit-field-v1:"));
    assert.ok(JSON.stringify(stored.response).includes("orbit-field-v1:"));
    assert.equal(JSON.stringify([stored.payload, stored.versionPayload, stored.response]).includes("+1-555-0199"), false);
    retry = true;
    const replayed = await service.create("sensitive-fixture", workspaceId, userId, body);
    assert.deepEqual(replayed.payload, created.payload);
  } finally {
    if (oldKey === undefined) delete process.env.ORBIT_DATA_ENCRYPTION_KEY;
    else process.env.ORBIT_DATA_ENCRYPTION_KEY = oldKey;
  }
});

test("the generic record API rejects plugin-generated kinds", async () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register({
    id: "generated-records", name: "Generated records", version: "1.0.0",
    contributions: { recordKinds: { output: {
      label: "Output", schema: { type: "object", properties: { source: { type: "string" } }, required: ["source"], additionalProperties: false },
      initial: "generated", transitions: { generated: [] }, serverCreated: true, example: { source: "example" },
    } } },
  });
  const service = new ExtensionRecords({} as never, {} as never, registry, new DocumentScanner());
  await assert.rejects(service.create("generated-records", "workspace", "actor", {
    kind: "output", title: "Forged output", payload: { source: "manual" }, operation_key: "00000000-0000-4000-8000-000000000051",
  }), /criado por uma operação do plugin/);
});

test("resolving a live record link reads the latest revision inside the same workspace and checks access", async () => {
  const recordId = "00000000-0000-4000-8000-000000000031";
  const workspaceId = "00000000-0000-4000-8000-000000000032";
  const linked = { id: recordId, pluginId: "sample-record-links", kind: "sample_item", state: "active", revision: 7, payload: { label: "Sample" } };
  let query = "";
  let parameters: unknown[] = [];
  let ownershipParameters: unknown[] = [];
  const permissionChecks: unknown[][] = [];
  const db = {
    async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : null; },
    async query(sql: string, values: unknown[]) {
      if (sql.includes("SELECT created_by")) { ownershipParameters = values; return [{ created_by: "00000000-0000-4000-8000-000000000033" }]; }
      query = sql; parameters = values; return [linked];
    },
  };
  const access = {
    registerRoutes() {}, registerScope() {}, registerMembership() {},
    async has() { return false; }, async hasScoped() { return false; }, async require(...args: unknown[]) { permissionChecks.push(args); },
  };
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  const samplePlugin: PluginDefinition = {
    id: "sample-record-links", name: "Sample record links", version: "1.0.0", dependencies: ["versioned-records"],
    contributions: { recordKinds: { sample_item: {
      label: "Sample item", schema: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false },
      initial: "draft", transitions: { draft: ["active"], active: [] }, example: { label: "Sample" },
    } } },
  };
  registry.register(samplePlugin);
  const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
  const validation = (service as unknown as { validationContext(workspace: string, user: string): { resolveLatestRecord(id: string): Promise<unknown>; isRecordOwner(id: string, owner: string): Promise<boolean> } })
    .validationContext(workspaceId, "reader");

  assert.deepEqual(await validation.resolveLatestRecord(recordId), linked);
  assert.match(query, /ORDER BY v\.revision DESC LIMIT 1/);
  assert.deepEqual(parameters, [recordId, workspaceId]);
  assert.deepEqual(permissionChecks, [["reader", "plugin.sample-record-links.read", "workspace", workspaceId]]);
  assert.equal(await validation.isRecordOwner(recordId, "00000000-0000-4000-8000-000000000033"), true);
  assert.equal(await validation.isRecordOwner(recordId, "00000000-0000-4000-8000-000000000034"), false);
  assert.deepEqual(ownershipParameters, [recordId, workspaceId]);
});

test("plugin semantic errors block record mutations while warnings remain reviewable", () => {
  assert.doesNotThrow(() => assertSemanticValidation([
    { severity: "warning", code: "pending", path: "field", message: "Ainda precisa de revisão." },
  ]));
  assert.throws(() => assertSemanticValidation([
    { severity: "error", code: "invalid", path: "answers[0]", message: "Resposta obrigatória ausente." },
  ]), /answers\[0\]: Resposta obrigatória ausente/);
});

test("validation context lists only safe metadata from the current record revision", async () => {
  const recordId = "00000000-0000-4000-8000-000000000073";
  const workspaceId = "00000000-0000-4000-8000-000000000074";
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  let attachmentTableAvailable = true;
  const db = {
    async one(sql: string) {
      assert.match(sql, /to_regclass\('extension_record_attachments'\)/);
      return { available: attachmentTableAvailable };
    },
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      return [{ mime_type: "application/pdf" }];
    },
  };
  const service = new ExtensionRecords(db as never, {} as never, new PluginRegistry(), new DocumentScanner());
  const validation = (service as unknown as { validationContext(workspace: string, user: string, client?: unknown, recordId?: string): {
    listCurrentRecordAttachments(): Promise<Array<{ mime_type: string }> | null>;
  } }).validationContext(workspaceId, "reviewer", undefined, recordId);

  assert.deepEqual(await validation.listCurrentRecordAttachments(), [{ mime_type: "application/pdf" }]);
  assert.match(queries[0].sql, /a\.revision=\(SELECT max\(v\.revision\)/);
  assert.match(queries[0].sql, /r\.workspace_id=\$2/);
  assert.doesNotMatch(queries[0].sql, /SELECT .*data|uploaded_by|file_name/);
  assert.deepEqual(queries[0].values, [recordId, workspaceId]);
  attachmentTableAvailable = false;
  assert.equal(await validation.listCurrentRecordAttachments(), null);
});

test("validation context counts only latest workspace records and serializes capacity checks", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000071";
  const userId = "00000000-0000-4000-8000-000000000072";
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    queries.push({ sql, values });
    return sql.includes("GROUP BY answer.item") ? [] : sql.includes("COUNT(*)") ? [{ count: 2 }] : [];
  } };
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register({
    id: "capacity-test", name: "Capacity test", version: "1.0.0", dependencies: ["versioned-records"],
  });
  const service = new ExtensionRecords(db as never, {} as never, registry, new DocumentScanner());
  const validation = (service as unknown as { validationContext(workspace: string, user: string): {
    countLatestRecordsByPayloadValue(plugin: string, kind: string, state: string, field: string, value: string, lockScope?: string): Promise<number | null>;
    countLatestRecordsMatchingPayload(plugin: string, kind: string, state: string, match: Record<string, string>, lockScope?: string, excludeRecordId?: string): Promise<number | null>;
    aggregateLatestNumericArrayValues(plugin: string, kind: string, state: string, parentField: string, parentId: string, arrayField: string, keyField: string, valueField: string): Promise<{ recordCount: number; groups: Array<{ key: string; count: number; average: number }> } | null>;
    nextLatestRecordOrdinal(plugin: string, kind: string, state: string, field: string, match: Record<string, string>, lockScope?: string, excludeRecordId?: string): Promise<number | null>;
  } }).validationContext(workspaceId, userId);

  assert.equal(await validation.countLatestRecordsByPayloadValue("capacity-test", "assignment", "assigned", "reviewer_ids", userId, "capacity:user"), 2);
  assert.match(queries[0].sql, /pg_advisory_xact_lock/);
  assert.match(queries[1].sql, /DISTINCT ON \(r\.id\)/);
  assert.match(queries[1].sql, /r\.workspace_id=\$1/);
  assert.match(queries[1].sql, /payload->\$5/);
  assert.deepEqual(queries[1].values, [workspaceId, "capacity-test", "assignment", "assigned", "reviewer_ids", userId, null]);
  assert.equal(await validation.countLatestRecordsMatchingPayload("capacity-test", "evaluation", "submitted", { assignment_record_id: userId, evaluator_user_id: userId }, "reviewer-evaluation", userId), 2);
  assert.match(queries[2].sql, /pg_advisory_xact_lock/);
  assert.match(queries[3].sql, /payload @> \$5::jsonb/);
  assert.deepEqual(queries[3].values, [workspaceId, "capacity-test", "evaluation", "submitted", JSON.stringify({ assignment_record_id: userId, evaluator_user_id: userId }), userId]);
  const aggregate = await validation.aggregateLatestNumericArrayValues("capacity-test", "survey_response", "submitted",
    "survey_record_id", userId, "answers", "question_id", "value");
  assert.deepEqual(aggregate, { recordCount: 2, groups: [] });
  assert.match(queries[4].sql, /COUNT\(\*\)::int AS count/);
  assert.deepEqual(queries[4].values, [workspaceId, "capacity-test", "survey_response", "submitted", "survey_record_id", userId]);
  assert.match(queries[5].sql, /jsonb_array_elements/);
  assert.match(queries[5].sql, /GROUP BY answer\.item->>\$8/);
  assert.doesNotMatch(queries[5].sql, /SELECT r\.\*|SELECT payload/);
  assert.deepEqual(queries[5].values, [workspaceId, "capacity-test", "survey_response", "submitted", "survey_record_id", userId, "answers", "question_id", "value"]);
  assert.equal(await validation.nextLatestRecordOrdinal("capacity-test", "evaluation", "waitlisted", "position", { assignment_record_id: userId }, "waitlist:assignment"), 1);
  assert.match(queries[6].sql, /pg_advisory_xact_lock/);
  assert.match(queries[7].sql, /MAX\(CASE WHEN jsonb_typeof\(payload->\$5\)='number'/);
  assert.deepEqual(queries[7].values, [workspaceId, "capacity-test", "evaluation", "waitlisted", "position", JSON.stringify({ assignment_record_id: userId }), null]);
});

test("declared payload snapshots can change only before a record leaves its initial state", () => {
  assert.doesNotThrow(() => assertPayloadFieldsImmutable("draft", "draft", { source_id: "old" }, { source_id: "new" }, ["source_id"]));
  assert.doesNotThrow(() => assertPayloadFieldsImmutable("draft", "submitted", { source_id: "fixed" }, { source_id: "fixed" }, ["source_id"]));
  assert.throws(() => assertPayloadFieldsImmutable("draft", "submitted", { source_id: "fixed" }, { source_id: "changed" }, ["source_id"]), /não podem ser alterados/);
});

test("generic sample contracts reject unknown fields and accept neutral examples", () => {
  for (const { plugin, kinds } of recordPlugins)
    for (const [kind, definition] of Object.entries(kinds)) {
      if (plugin.id === "documents" && kind === "document") continue;
      assert.doesNotThrow(() => {
        validate(definition.schema, definition.example);
        validateDefinition(plugin.id, kind, definition.example);
      }, `${plugin.id}.${kind}`);
      assert.throws(() =>
        validate(definition.schema, {
          ...definition.example,
          invented_field: "forbidden",
        }),
      );
    }
  assert.throws(() => validate({ type: "object" }, undefined));
  assert.throws(() =>
    validateDefinition("forms", "form", {
      schema: {
        type: "object",
        properties: { value: { $ref: "https://example.invalid/schema" } },
      },
    }),
  );
});

test("policy parameters, matrices and workflows enforce semantic consistency", () => {
  assert.throws(
    () =>
      validateDefinition("policy-parameters", "policy", {
        parameters: [{ code: "days", value: 0, minimum: 1 }],
      }),
    /fora dos limites/,
  );
  assert.throws(
    () =>
      validateDefinition("policy-parameters", "policy", {
        parameters: [
          { code: "days", value: 1 },
          { code: "days", value: 2 },
        ],
      }),
    /repetido/,
  );
  assert.throws(
    () =>
      validateDefinition("assessments", "matrix", {
        outcomes: ["ok"],
        dimensions: [
          { code: "d", criteria: [{ code: "c", outcomes: ["unknown"] }] },
        ],
      }),
    /não definido/,
  );
  assert.throws(
    () =>
      validateDefinition("workflows", "definition", {
        states: ["a"],
        initial_state: "b",
        transitions: [],
      }),
    /inicial/,
  );
  const definition = {
    states: ["open", "done"],
    initial_state: "open",
    transitions: [{ from: "open", to: "done" }],
  };
  assert.equal(nextWorkflowState(definition, "open", "done"), "done");
  assert.throws(
    () => nextWorkflowState(definition, "done", "open"),
    /não prevista/,
  );
});

test("deadlines preserve elapsed pause time and reject invalid or completed operations", () => {
  const start = new Date("2030-01-01T00:00:00Z");
  const payload = {
    duration_days: 5,
    started_at: start.toISOString(),
    due_at: deadlineDueAt(start, 5),
  };
  const paused = deadlineTransition(
    "running",
    payload,
    "pause",
    new Date("2030-01-02T00:00:00Z"),
  );
  const resumed = deadlineTransition(
    paused.state,
    paused.payload,
    "resume",
    new Date("2030-01-04T00:00:00Z"),
  );
  assert.equal(resumed.payload.due_at, "2030-01-08T00:00:00.000Z");
  const extended = deadlineTransition(
    resumed.state,
    resumed.payload,
    "extend",
    new Date("2030-01-04T00:00:00Z"),
    2,
  );
  assert.equal(extended.payload.due_at, "2030-01-10T00:00:00.000Z");
  assert.throws(
    () => deadlineTransition("completed", payload, "extend", start, 2),
    /concluído/,
  );
  assert.throws(
    () => deadlineTransition("running", payload, "resume", start),
    /incompatível/,
  );
  assert.throws(() => deadlineDueAt(start, 0));
});

test("plugin deadline effects update only same-workspace generic clocks and retain transition reasons", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000051";
  const deadlineId = "00000000-0000-4000-8000-000000000052";
  const now = new Date();
  const clock: { id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown>; created_by: string; updated_by: string } = {
    id: deadlineId, workspace_id: workspaceId, plugin_id: "deadlines", kind: "clock", title: "Prazo do processo",
    state: "running", revision: 1,
    payload: {
      duration_days: 3, started_at: new Date(now.getTime() - 60_000).toISOString(),
      due_at: new Date(now.getTime() + 3 * 86400000).toISOString(), paused_at: null,
      target_type: "external_process", target_id: "00000000-0000-4000-8000-000000000053",
    }, created_by: "actor", updated_by: "actor",
  };
  const saved: unknown[][] = [];
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  const service = new ExtensionRecords({} as never, {} as never, registry, new DocumentScanner());
  const internal = service as unknown as {
    applyDeadlineEffects: (client: unknown, workspace: string, user: string, effects: Array<{ recordId: string; event: "pause" | "resume"; reason: string }>) => Promise<void>;
    save: (...args: unknown[]) => Promise<unknown>;
  };
  internal.save = async (...args) => { saved.push(args); return {}; };
  const client = { query: async () => ({ rows: [clock] }) };
  await internal.applyDeadlineEffects(client, workspaceId, "actor", [{ recordId: deadlineId, event: "pause", reason: "Aguardando complementação." }]);
  assert.equal(saved[0][5], "paused");
  assert.equal((saved[0][4] as Record<string, unknown>).paused_at !== null, true);
  assert.equal(saved[0][6], "Aguardando complementação.");

  clock.state = "paused";
  clock.payload.paused_at = new Date(Date.now() - 120_000).toISOString();
  const dueBeforeResume = String(clock.payload.due_at);
  saved.length = 0;
  await internal.applyDeadlineEffects(client, workspaceId, "actor", [{ recordId: deadlineId, event: "resume", reason: "Resposta recebida." }]);
  assert.equal(saved[0][5], "running");
  assert.equal((saved[0][4] as Record<string, unknown>).paused_at, null);
  assert.ok(Date.parse(String((saved[0][4] as Record<string, unknown>).due_at)) > Date.parse(dueBeforeResume));

  await assert.rejects(
    () => internal.applyDeadlineEffects(client, "another-workspace", "actor", [{ recordId: deadlineId, event: "pause", reason: "Não deve atravessar workspace." }]),
    /neste workspace/,
  );
});

test("plugin transition resource-role effects are validated and written atomically through scoped RBAC", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000061";
  const recordId = "00000000-0000-4000-8000-000000000062";
  const userId = "00000000-0000-4000-8000-000000000063";
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = { async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    if (sql.includes("FROM users WHERE id=$1")) return { rows: [{ id: userId, is_root: false }] };
    if (sql.includes("FROM access_roles")) return { rows: [{ id: "reviewer" }] };
    if (sql.includes("FROM extension_records")) return { rows: [{ id: recordId, plugin_id: "documents", kind: "document" }] };
    return { rows: [] };
  } };
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  const service = new ExtensionRecords({} as never, {} as never, registry, new DocumentScanner());
  const apply = (service as unknown as { applyRecordRoleEffects(client: unknown, workspace: string, actor: string, effects: Array<{ userId: string; roleId: string; recordId: string; effect: "grant" | "revoke" }>): Promise<void> }).applyRecordRoleEffects.bind(service);
  await apply(client, workspaceId, "actor", [{ userId, roleId: "reviewer", recordId, effect: "grant" }]);
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO access_grants") && call.values?.[2] === recordId));
  assert.ok(calls.some((call) => call.sql.includes("UPDATE users SET session_version=session_version+1")));
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO access_audit") && call.values?.[1] === "role.scope.grant"));
  await assert.rejects(() => apply(client, workspaceId, "actor", [{ userId, roleId: "invalid role", recordId, effect: "revoke" }]), /Efeito de papel/);
});

test("plugin validation receives the proposed state transition without changing the record payload", async () => {
  const record = { id: "00000000-0000-4000-8000-000000000064", workspace_id: "00000000-0000-4000-8000-000000000065",
    plugin_id: "transition-context-fixture", kind: "item", title: "Material", state: "draft", revision: 1, payload: { value: "content" }, created_by: "user", updated_by: "user" };
  let transition: { from: string; to: string } | undefined;
  const registry = new PluginRegistry();
  registry.register({ id: "transition-context-fixture", name: "Transition context fixture", version: "1.0.0", contributions: { recordKinds: { item: {
    label: "Item", schema: { type: "object", properties: { value: { type: "string" } } }, initial: "draft", transitions: { draft: ["published"], published: [] },
    example: { value: "sample" }, async validate(_payload, context) { transition = context.transition; return []; },
  } } } });
  const service = new ExtensionRecords({} as never, {} as never, registry, new DocumentScanner());
  const client = { async query() { return { rows: [] }; } };
  Object.assign(service, {
    async record() { return record; },
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
    async lock() { return record; },
    async save(_client: unknown, _current: typeof record, _user: string, _title: string, payload: Record<string, unknown>, state: string) { return { ...record, payload, state, revision: 2 }; },
    async snapshot(_client: unknown, updated: unknown) { return updated; },
    async applyTransitionEffects() {},
  });
  await service.transition(record.plugin_id, record.id, "user", { state: "published", expected_revision: 1,
    operation_key: "00000000-0000-4000-8000-000000000066", reason: "Revisão concluída" });
  assert.deepEqual(transition, { from: "draft", to: "published" });
});

test("document ingestion rejects traversal, forged formats and unavailable configured scanners", async () => {
  const content = Buffer.from("%PDF-1.7\nexample").toString("base64");
  assert.equal(
    decodeDocument(content, "application/pdf", "sample.pdf").size_bytes,
    16,
  );
  assert.throws(() => decodeDocument(content, "image/png", "sample.png"));
  assert.throws(() =>
    decodeDocument(content, "application/pdf", "../sample.pdf"),
  );
  assert.throws(() =>
    decodeDocument("malformed?", "application/pdf", "sample.pdf"),
  );
  const previous = process.env.ORBIT_DOCUMENT_SCANNER_BIN;
  try {
    delete process.env.ORBIT_DOCUMENT_SCANNER_BIN;
    assert.equal(
      await new DocumentScanner().scan(Buffer.from("test")),
      "not_configured",
    );
    process.env.ORBIT_DOCUMENT_SCANNER_BIN = "/missing/orbit-scanner";
    await assert.rejects(
      () => new DocumentScanner().scan(Buffer.from("test")),
      /indisponível/,
    );
  } finally {
    if (previous === undefined) delete process.env.ORBIT_DOCUMENT_SCANNER_BIN;
    else process.env.ORBIT_DOCUMENT_SCANNER_BIN = previous;
  }
});

test("generic document scanner streams bytes to clamd and distinguishes clean from infected", async () => {
  const previousUrl = process.env.ORBIT_DOCUMENT_SCANNER_URL;
  const previousBinary = process.env.ORBIT_DOCUMENT_SCANNER_BIN;
  const commands: Buffer[][] = [];
  let response = "stream: OK\0";
  const server = createServer((socket) => {
    const packets: Buffer[] = [];
    commands.push(packets);
    socket.on("data", (chunk) => {
      packets.push(Buffer.from(chunk));
      if (Buffer.concat(packets).includes(Buffer.alloc(4))) {
        socket.end(Buffer.from(response, "binary"));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.ORBIT_DOCUMENT_SCANNER_URL = `tcp://127.0.0.1:${address.port}`;
  delete process.env.ORBIT_DOCUMENT_SCANNER_BIN;
  try {
    assert.equal(await new DocumentScanner().scan(Buffer.from("clean test bytes")), "clean");
    response = "stream: Eicar-Test-Signature FOUND\0";
    await assert.rejects(new DocumentScanner().scan(Buffer.from("infected test bytes")), /conteúdo malicioso/);
    assert.ok(Buffer.concat(commands[0] || []).includes(Buffer.from("zINSTREAM\0")));
    assert.ok(Buffer.concat(commands[1] || []).includes(Buffer.from("zINSTREAM\0")));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousUrl === undefined) delete process.env.ORBIT_DOCUMENT_SCANNER_URL;
    else process.env.ORBIT_DOCUMENT_SCANNER_URL = previousUrl;
    if (previousBinary === undefined) delete process.env.ORBIT_DOCUMENT_SCANNER_BIN;
    else process.env.ORBIT_DOCUMENT_SCANNER_BIN = previousBinary;
  }
});

test("generic plugins coexist and suspend transitively without losing their configured state", () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.setEnabled("versioned-records", false);
  for (const { plugin } of recordPlugins)
    assert.equal(registry.isEnabled(plugin.id), false);
  registry.setEnabled("privacy", false);
  registry.setEnabled("versioned-records", true);
  assert.equal(registry.isEnabled("privacy"), false);
  assert.equal(registry.isEnabled("forms"), true);
  registry.setEnabled("workspaces", false);
  assert.equal(registry.isEnabled("forms"), false);
  registry.setEnabled("workspaces", true);
  assert.equal(registry.isEnabled("forms"), true);
});

test("the reusable organization identifier validator rejects invalid check digits", () => {
  assert.equal(validCnpj("11.222.333/0001-81"), true);
  assert.equal(validCnpj("11.222.333/0001-82"), false);
  assert.equal(validCnpj("00.000.000/0000-00"), false);
});
