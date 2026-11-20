import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { formAccess, submissionAccess, documentAccess } from "./ownership";
import { ExtensionRecords } from "./records.service";
import { PluginRegistry } from "../../execution/registries";
import { genericPlugins } from "./catalog";
import { workspacesPlugin } from "../../workspaces/workspaces.plugin";
import { DocumentScanner } from "./documents";
import type { RecordValidationContext } from "../contract";
import { protectRecordPayload } from "../../data-protector";

const context = (owner: boolean, scoped = false): RecordValidationContext => ({
  actorId: "actor", recordId: "record", isRecordOwner: async () => owner,
  hasPermission: async (permission) => ["plugin.forms.read", "plugin.forms.write", "plugin.documents.write"].includes(permission),
  hasPermissionOnResource: async () => scoped,
  hasWorkspacePermission: async () => true,
  resolveRecord: async () => ({ id: "form", pluginId: "forms", kind: "form", state: "published", revision: 1, payload: {} }),
});
test("published form definitions can be shared without exposing another person's submissions", async () => {
  assert.equal(await formAccess.authorizeRecord?.("actor", "read", "published", {}, context(false)), true);
  assert.equal(await submissionAccess.authorizeRecord?.("actor", "read", "submitted", {}, context(false)), false);
  assert.equal(await submissionAccess.authorizeRecord?.("actor", "read", "submitted", {}, context(false, true)), true);
  assert.equal(await submissionAccess.authorizeRecord?.("actor", "publish", "draft", {}, context(true)), true);
  assert.equal(await submissionAccess.authorizeRecord?.("actor", "write", "submitted", {}, context(true)), false);
  assert.equal(await submissionAccess.authorizeCreate?.("actor", { form_id: "form", form_revision: 1 }, context(true)), true);
});
test("document owners may submit their files, while independent review and explicit grants remain required", async () => {
  assert.equal(await documentAccess.authorizeRecord?.("actor", "publish", "draft", {}, context(true)), true);
  assert.equal(await documentAccess.authorizeRecord?.("actor", "read", "published", {}, context(false)), false);
  assert.equal(await documentAccess.authorizeRecord?.("actor", "read", "published", {}, context(false, true)), true);
});
test("calendar window may project only a declared all-day boolean after resource authorization", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000061";
  const recordId = "00000000-0000-4000-8000-000000000062";
  const registry = new PluginRegistry();
  registry.register({ id: "calendar-fixture", name: "Calendar fixture", version: "1.0.0", contributions: { recordKinds: {
    block: { label: "Bloqueio", initial: "active", transitions: { active: [] }, example: {}, resourceScoped: true,
      schema: { type: "object", properties: { starts_at: { type: "string", format: "date-time" }, ends_at: { type: "string", format: "date-time" }, all_day: { type: "boolean" } } },
    },
  } } });
  const db = { async query() { return [{ id: recordId, workspace_id: workspaceId, state: "active", revision: 1,
    payload: { starts_at: "2026-12-01T00:00:00.000Z", ends_at: "2026-12-02T00:00:00.000Z", all_day: true } }]; } };
  const service = new ExtensionRecords(db as never, { has: async () => true } as never, registry, new DocumentScanner());
  Object.assign(service, { async canRecord(_user: string, _plugin: string, _kind: string, id: string) { return id === recordId; } });
  const start = new Date("2026-12-01T00:00:00.000Z"), end = new Date("2026-12-03T00:00:00.000Z");
  const projected = await service.calendarWindow("calendar-fixture", "block", "reader", start, end, "starts_at", "ends_at", "all_day");
  assert.deepEqual(projected, [{ id: recordId, workspaceId, state: "active", start: "2026-12-01T00:00:00.000Z", end: "2026-12-02T00:00:00.000Z", allDay: true }]);
  await assert.rejects(() => service.calendarWindow("calendar-fixture", "block", "reader", start, end, "starts_at", "ends_at", "starts_at"), /all-day field must be a declared boolean/);
});
test("an authoritative create denial cannot be overridden by broad plugin write permission", async () => {
  const registry = new PluginRegistry();
  for (const plugin of [workspacesPlugin, ...genericPlugins]) registry.register(plugin);
  registry.register({ id: "deny-create", name: "Deny create", version: "1.0.0", contributions: { recordKinds: { case: {
    label: "Case", initial: "draft", transitions: { draft: [] }, schema: { type: "object" }, example: {},
    resourceScoped: true, authorizeCreate: async () => false,
  } } } });
  const service = new ExtensionRecords({ one: async () => ({ id: "workspace" }) } as never,
    { has: async () => true } as never, registry, new DocumentScanner());
  await assert.rejects(() => service.create("deny-create", "00000000-0000-4000-8000-000000000001", "actor", {
    kind: "case", title: "Forged", payload: {}, operation_key: "00000000-0000-4000-8000-000000000002",
  }), /não autorizado para criar/);
});
test("search scans beyond the first page and never decrypts records before resource authorization", async () => {
  const previousKey = process.env.ORBIT_DATA_ENCRYPTION_KEY;
  process.env.ORBIT_DATA_ENCRYPTION_KEY = "record-search-test-key-with-sufficient-entropy";
  try {
    const workspaceId = "00000000-0000-4000-8000-000000000051";
    const pluginId = "search-fixture";
    const professionalId = "00000000-0000-4000-8000-000000000099";
    const records = Array.from({ length: 102 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const updatedAt = new Date(Date.UTC(2026, 0, 2, 0, 0, 0) - index * 1000).toISOString();
      const payload = index === 0
        ? { display_name: { __orbitProtectedField: true, value: "tampered" } }
        : index === 100
          ? protectRecordPayload({ display_name: "José Silva", cpf: "123.456.789-00", assigned_professional_ids: [professionalId] }, ["display_name", "cpf", "assigned_professional_ids"], { pluginId, kind: "patient", recordId: id, revision: 1 })
          : index === 50
            ? protectRecordPayload({ display_name: "Pessoa sem correspondência", cpf: "000.000.000-50", assigned_professional_ids: ["00000000-0000-4000-8000-000000000050"] }, ["display_name", "cpf", "assigned_professional_ids"], { pluginId, kind: "patient", recordId: id, revision: 1 })
          : { display_name: `Pessoa ${index}`, cpf: `000.000.000-${String(index).padStart(2, "0")}` };
      return { id, workspace_id: workspaceId, plugin_id: pluginId, kind: "patient", title: `GO-${index}`,
        state: "active", revision: 1, payload, created_by: "owner", updated_by: "owner", updated_at: updatedAt, cursor_updated_at: updatedAt };
    });
    const queries: unknown[][] = [];
    const audited: string[] = [];
    const db = {
      async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : null; },
      async query(_sql: string, args: unknown[]) {
        queries.push(args);
        const cursorId = args[4] as string | null;
        const index = cursorId ? records.findIndex((record) => record.id === cursorId) + 1 : 0;
        return records.slice(index, index + 100);
      },
    };
    const access = { registerRoutes() {}, registerScope() {}, registerMembership() {}, async has() {},
      async audit(_user: string, _action: string, target: string) { audited.push(target); } };
    const registry = new PluginRegistry();
    registry.register({ id: pluginId, name: "Search fixture", version: "1.0.0", scope: "workspace", contributions: { recordKinds: {
      patient: { label: "Pessoa", schema: { type: "object", properties: { display_name: { type: "string" }, cpf: { type: "string" },
        assigned_professional_ids: { type: "array", items: { type: "string", recordKind: "professional" } } } },
        initial: "active", transitions: { active: [] }, example: {}, resourceScoped: true,
        sensitiveFields: ["display_name", "cpf", "assigned_professional_ids"], searchableFields: ["display_name", "cpf"] },
      professional: { label: "Profissional", schema: { type: "object", properties: { display_name: { type: "string" } } },
        initial: "active", transitions: { active: [] }, example: {} },
    } } });
    const service = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
    Object.assign(service, { async canRecord(_user: string, _plugin: string, _kind: string, recordId: string) {
      return recordId === records[50]!.id || recordId === records[100]!.id;
    } });

    const result = await service.list(pluginId, workspaceId, "unit-reader", "123 456", "patient", "assigned_professional_ids", [professionalId]);
    assert.equal(queries.length, 2);
    assert.deepEqual(result.map((record) => record.id), [records[100]!.id]);
    assert.deepEqual(audited, [records[50]!.id, records[100]!.id]);
  } finally {
    if (previousKey === undefined) delete process.env.ORBIT_DATA_ENCRYPTION_KEY;
    else process.env.ORBIT_DATA_ENCRYPTION_KEY = previousKey;
  }
});
