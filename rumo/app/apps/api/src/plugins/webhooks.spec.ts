import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import { PluginRegistry } from "../execution/registries";
import { ExtensionRecords, type ExtensionRecord } from "./records/records.service";
import { buildWebhookEnvelope, CLAIM_WEBHOOK_DELIVERIES_SQL, enqueueWebhookEvent, unsafeWebhookAddress, validatePublicHttpsTarget, webhookEventOptions, WebhooksService, webhooksPlugin } from "./webhooks";

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

test("eventos e entregas são idempotentes e usam a conexão da transação", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let inserted = true;
  const client = { async query(sql: string, values: unknown[] = []) {
    calls.push({ sql, values });
    if (sql.includes("INSERT INTO webhook_events")) return inserted ? (inserted = false, { rows: [{ id: "event-1" }] }) : { rows: [] };
    return { rows: [] };
  } };
  const resource = { id: "record-1", workspace_id: "workspace-1", plugin_id: "records", kind: "item", state: "published", revision: 2, payload: { email: "private@example.com" } };
  await enqueueWebhookEvent(client as never, resource, "records.item.published", 1);
  await enqueueWebhookEvent(client as never, resource, "records.item.published", 1);
  assert.equal(calls.length, 2, "each attempt uses one atomic SQL statement");
  assert.match(calls[0].sql, /matching_subscriptions AS MATERIALIZED/);
  assert.match(calls[0].sql, /INSERT INTO webhook_events[\s\S]*WHERE EXISTS \(SELECT 1 FROM matching_subscriptions\)/);
  assert.match(calls[0].sql, /INSERT INTO webhook_deliveries[\s\S]*FROM matching_subscriptions AS subscriptions CROSS JOIN inserted_event AS events/);
  assert.match(calls[0].sql, /ON CONFLICT\(workspace_id,record_id,revision,event_type\) DO NOTHING/);
  assert.match(calls[0].sql, /ON CONFLICT\(subscription_id,event_id\) DO NOTHING/);
  assert.equal(calls[0].values[6], "records.item.published");
  assert.equal(calls[0].values.includes(resource.payload), false);
});

test("eventos não geram armazenamento quando nenhum workspace assinou o tipo", async () => {
  const calls: string[] = [];
  const client = { async query(sql: string) { calls.push(sql); return { rows: [] }; } };
  await enqueueWebhookEvent(client as never, {
    id: "record-1", workspace_id: "workspace-1", plugin_id: "records", kind: "item", state: "draft", revision: 1,
  }, "record.created", 1);
  assert.equal(calls.length, 1, "no-assignee path is a single SQL statement with no follow-up write");
  assert.match(calls[0], /matching_subscriptions AS MATERIALIZED \([\s\S]*workspace_id=\$1 AND active AND \$7=ANY\(event_types\)/);
  assert.match(calls[0], /WHERE EXISTS \(SELECT 1 FROM matching_subscriptions\)/);
  assert.match(calls[0], /FROM matching_subscriptions AS subscriptions CROSS JOIN inserted_event AS events/,
    "deliveries are generated only from the exact materialized subscription set and inserted event");
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
  assert.equal(calls.some((sql) => sql.includes("Private title") || sql.includes("private@example.com")), false);
});

test("destinos rejeitam HTTP e endereços não públicos", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fc00::1", "2001:db8::1"])
    assert.equal(unsafeWebhookAddress(address), true, address);
  assert.equal(unsafeWebhookAddress("8.8.8.8"), false);
  await assert.rejects(validatePublicHttpsTarget("http://8.8.8.8/hook"), (error) => error instanceof HttpException && error.getStatus() === 400);
  await assert.rejects(validatePublicHttpsTarget("https://127.0.0.1/hook"), (error) => error instanceof HttpException && error.getStatus() === 400);
});

test("reconcilia webhooks stale no teto e impede nova tentativa acima do CHECK", async () => {
  assert.match(CLAIM_WEBHOOK_DELIVERIES_SQL, /stale_exhausted AS \([\s\S]*status='dead_letter'[\s\S]*last_error='ATTEMPTS_EXHAUSTED'[\s\S]*attempt_count>=8/);
  assert.match(CLAIM_WEBHOOK_DELIVERIES_SQL, /d\.status='pending'[\s\S]*d\.attempt_count<8[\s\S]*d\.status='sending'[\s\S]*d\.attempt_count<8/);
  assert.match(CLAIM_WEBHOOK_DELIVERIES_SQL, /attempt_count=d\.attempt_count\+1/);

  const calls: string[] = [];
  const service = new WebhooksService(
    { async query(sql: string) { calls.push(sql); return []; } } as never,
    {} as never,
    { isEnabled() { return true; } } as never,
  );
  await service.dispatch();
  assert.deepEqual(calls, [CLAIM_WEBHOOK_DELIVERIES_SQL]);
});
