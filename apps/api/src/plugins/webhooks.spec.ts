import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import { PluginRegistry } from "../execution/registries";
import { ExtensionRecords, type ExtensionRecord } from "./records/records.service";
import { buildWebhookEnvelope, enqueueWebhookEvent, unsafeWebhookAddress, validatePublicHttpsTarget, webhookEventOptions, webhooksPlugin } from "./webhooks";

test("plugin webhooks expõe eventos genéricos e eventos de domínio declarados", () => {
  const registry = new PluginRegistry();
  registry.register(webhooksPlugin);
  registry.register({ id: "records", name: "Records", version: "1.0.0" });
  registry.register({ id: "records-events", name: "Records events", version: "1.0.0", dependencies: ["records"], recordEvents: {
    sourcePluginId: "records",
    events: [{ type: "records.item.published", label: "Item publicado", version: 1 }],
    onSnapshot: () => ["records.item.published"],
  } });
  assert.deepEqual(webhookEventOptions(registry).map(({ type }) => type), ["record.created", "record.updated", "records.item.published"]);
  registry.setEnabled("records-events", false);
  assert.deepEqual(webhookEventOptions(registry).map(({ type }) => type), ["record.created", "record.updated"]);
  assert.throws(() => registry.register({ id: "invalid-events", name: "Invalid", version: "1.0.0", dependencies: ["records"], recordEvents: {
    sourcePluginId: "records", events: [{ type: "not-valid", label: "Invalid", version: 0 }], onSnapshot: () => [],
  } }));
  assert.throws(() => registry.register({ id: "unlinked-events", name: "Unlinked", version: "1.0.0", recordEvents: {
    sourcePluginId: "records", events: [{ type: "records.item.created", label: "Created", version: 1 }], onSnapshot: () => [],
  } }), /Eventos de registro inválidos/);
});

test("envelopes de eventos excluem título, payload e dados pessoais", () => {
  const generic = buildWebhookEnvelope({ id: "event-1", event_type: "record.created", event_version: 1, workspace_id: "workspace-1", record_id: "record-1", plugin_id: "records", kind: "item", state: "draft", revision: 1, occurred_at: "2030-01-01T00:00:00Z" });
  const domain = buildWebhookEnvelope({ id: "event-2", event_type: "records.item.published", event_version: 2, workspace_id: "workspace-1", record_id: "record-1", plugin_id: "records", kind: "item", state: "published", revision: 2, occurred_at: "2030-01-01T00:00:00Z" });
  assert.deepEqual(generic, { id: "event-1", type: "record.created", workspace_id: "workspace-1", record: { id: "record-1", plugin_id: "records", kind: "item", state: "draft", revision: 1 }, occurred_at: "2030-01-01T00:00:00Z" });
  assert.deepEqual(domain, { id: "event-2", type: "records.item.published", version: 2, workspace_id: "workspace-1", resource: { id: "record-1", kind: "item", revision: 2 }, occurred_at: "2030-01-01T00:00:00Z" });
  assert.equal(JSON.stringify([generic, domain]).includes("payload"), false);
  assert.equal(JSON.stringify([generic, domain]).includes("title"), false);
});

test("eventos só são persistidos com assinaturas compatíveis e entregas usam a mesma transação", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const subscriptions = [
    { id: "subscription-1", active: true, event_types: ["records.item.published"] },
    { id: "subscription-2", active: true, event_types: ["record.created", "records.item.published"] },
    { id: "subscription-inactive", active: false, event_types: ["records.item.published"] },
  ];
  const events = new Set<string>();
  const deliveries = new Set<string>();
  const client = { async query(sql: string, values: unknown[] = []) {
    calls.push({ sql, values });
    assert.match(sql, /WITH matching_subscriptions AS MATERIALIZED/);
    const [workspaceId, recordId, , , , revision, eventType] = values as [string, string, string, string, string, number, string, number];
    const key = [workspaceId, recordId, revision, eventType].join("|");
    const matching = subscriptions.filter((item) => item.active && item.event_types.includes(eventType));
    if (!matching.length || events.has(key)) return { rows: [] };
    events.add(key);
    for (const subscription of matching) deliveries.add(`${subscription.id}|event-1`);
    return { rows: [{ id: "event-1" }] };
  } };
  const resource = { id: "record-1", workspace_id: "workspace-1", plugin_id: "records", kind: "item", state: "published", revision: 2, payload: { email: "private@example.com" } };
  await enqueueWebhookEvent(client as never, resource, "records.item.published", 1);
  await enqueueWebhookEvent(client as never, resource, "records.item.published", 1);
  assert.equal(calls.length, 2, "each event is handled by one statement on the caller's transaction");
  assert.match(calls[0].sql, /ON CONFLICT\(workspace_id,record_id,revision,event_type\) DO NOTHING/);
  assert.match(calls[0].sql, /WHERE EXISTS\(SELECT 1 FROM matching_subscriptions\)/);
  assert.match(calls[0].sql, /FROM matching_subscriptions subscriptions CROSS JOIN inserted_event/);
  assert.equal(calls[0].values[6], "records.item.published");
  assert.equal(calls[0].values.includes(resource.payload), false);
  assert.equal(events.size, 1, "idempotent snapshots create one event");
  assert.deepEqual([...deliveries].sort(), ["subscription-1|event-1", "subscription-2|event-1"]);
});

test("snapshots without active matching subscriptions create no orphan webhook event", async () => {
  const calls: string[] = [];
  const activeSubscriptions: Array<{ event_types: string[] }> = [
    { event_types: ["record.created"] },
    { event_types: ["records.item.published"] },
  ];
  const persistedEvents: string[] = [];
  const persistedDeliveries: string[] = [];
  const client = { async query(sql: string, values: unknown[] = []) {
    calls.push(sql);
    assert.match(sql, /WITH matching_subscriptions AS MATERIALIZED/);
    assert.match(sql, /WHERE EXISTS\(SELECT 1 FROM matching_subscriptions\)/);
    assert.match(sql, /FROM matching_subscriptions subscriptions CROSS JOIN inserted_event/);
    const eventType = String(values[6]);
    const matching = activeSubscriptions.filter((item) => item.event_types.includes(eventType));
    if (matching.length) {
      persistedEvents.push(eventType);
      persistedDeliveries.push(...matching.map(() => eventType));
      return { rows: [{ id: "event-1" }] };
    }
    return { rows: [] };
  } };
  const resource = { id: "record-2", workspace_id: "workspace-1", plugin_id: "records", kind: "item", state: "draft", revision: 1 };
  await enqueueWebhookEvent(client as never, resource, "record.updated", 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes("INSERT INTO webhook_events"), true);
  assert.equal(persistedEvents.length, 0, "there is no event row without a matching subscription");
  assert.equal(persistedDeliveries.length, 0, "the same atomic statement has no delivery row to attach");
});

test("snapshot enfileira eventos genéricos e declarados na mesma transação", async () => {
  const registry = new PluginRegistry();
  registry.register({ id: "records", name: "Records", version: "1.0.0", contributions: { recordKinds: {
    item: { label: "Item", schema: { type: "object" }, initial: "draft", transitions: { draft: [] }, example: {} },
  } } });
  registry.register({ id: "records-events", name: "Events", version: "1.0.0", dependencies: ["records"], recordEvents: {
    sourcePluginId: "records", events: [{ type: "records.item.published", label: "Published", version: 1 }],
    onSnapshot: (record, previousState) => record.state === "published" && previousState !== "published" ? ["records.item.published"] : [],
  } });
  const calls: string[] = [];
  const client = { async query(sql: string) { calls.push(sql); return { rows: [{ id: "event-1" }] }; } };
  const service = new ExtensionRecords({} as never, {} as never, registry, {} as never);
  const record = { id: "item-1", workspace_id: "workspace-1", plugin_id: "records", kind: "item", title: "Private title", state: "published", revision: 2, payload: { email: "private@example.com" }, created_by: "user-1", updated_by: "user-1" } satisfies ExtensionRecord;
  await (service as unknown as { snapshot: (client: unknown, record: ExtensionRecord, user: string, reason: string, previousState?: string) => Promise<ExtensionRecord> }).snapshot(client, record, "user-1", "Published", "draft");
  assert.equal(calls.filter((sql) => sql.includes("INSERT INTO webhook_events")).length, 2);
  assert.equal(calls.filter((sql) => sql.includes("INSERT INTO webhook_deliveries")).length, 2);
  assert.equal(calls.filter((sql) => sql.includes("WITH matching_subscriptions AS MATERIALIZED")).length, 2,
    "both event types are enqueued with a single statement each");
  assert.equal(calls.some((sql) => sql.includes("Private title") || sql.includes("private@example.com")), false);
});

test("destinos rejeitam HTTP e endereços não públicos", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fc00::1", "2001:db8::1"])
    assert.equal(unsafeWebhookAddress(address), true, address);
  assert.equal(unsafeWebhookAddress("8.8.8.8"), false);
  await assert.rejects(validatePublicHttpsTarget("http://8.8.8.8/hook"), (error) => error instanceof HttpException && error.getStatus() === 400);
  await assert.rejects(validatePublicHttpsTarget("https://127.0.0.1/hook"), (error) => error instanceof HttpException && error.getStatus() === 400);
});
