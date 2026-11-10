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
