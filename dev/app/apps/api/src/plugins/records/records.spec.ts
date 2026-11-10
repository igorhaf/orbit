import "reflect-metadata";
import assert from "node:assert/strict";
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

test("versioned record routes delegate access decisions to their record service", () => {
  assert.equal(recordsBasePlugin.handlesRoute?.("/extensions"), true);
  assert.equal(recordsBasePlugin.handlesRoute?.("/extensions/example-plugin/records/123"), true);
  assert.equal(recordsBasePlugin.handlesRoute?.("/git/status"), false);
  assert.equal(recordsBasePlugin.routePermission?.("/extensions/example-plugin/records/123", "GET"), null);
});

test("generic document records and independent reviews require resource-scoped access", () => {
  const definitions = genericPlugins.find((plugin) => plugin.id === "documents")?.contributions?.recordKinds || {};
  assert.equal(definitions.document?.resourceScoped, true);
  assert.equal(definitions.review?.resourceScoped, true);
  assert.equal(definitions.document?.managePermission, "plugin.documents.manage");
  assert.equal(definitions.review?.managePermission, "plugin.documents.manage");
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

test("validation context counts only latest workspace records and serializes capacity checks", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000071";
  const userId = "00000000-0000-4000-8000-000000000072";
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    queries.push({ sql, values });
    return sql.includes("COUNT(*)") ? [{ count: 2 }] : [];
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
      target_type: "safdoulas_process", target_id: "00000000-0000-4000-8000-000000000053",
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
