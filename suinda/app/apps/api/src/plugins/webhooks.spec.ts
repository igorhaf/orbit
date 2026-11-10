import "reflect-metadata";
import assert from "node:assert/strict";
import {test} from "node:test";
import {PluginRegistry} from "../execution/registries";
import { HttpException } from "@nestjs/common";
import {buildWebhookEnvelope,enqueueWebhookEvent,unsafeWebhookAddress,validatePublicHttpsTarget,webhookEventOptions,webhooksPlugin,WebhooksService} from "./webhooks";

test("webhook plugin owns only its workspace subscription routes and permission",()=>{
  assert.equal(webhooksPlugin.handlesRoute?.("/workspaces/00000000-0000-4000-8000-000000000001/webhooks"),true);
  assert.equal(webhooksPlugin.handlesRoute?.("/workspaces/00000000-0000-4000-8000-000000000001/members"),false);
  assert.equal(webhooksPlugin.routePermission?.("/workspaces/x/webhooks","POST"),"webhooks.manage");
});

test("plugins declaram eventos de domínio no contrato reutilizável sem acoplamento ao produto", () => {
  const registry = new PluginRegistry();
  registry.register(webhooksPlugin);
  registry.register({ id: "source-domain", name: "Source", version: "1.0.0" });
  registry.register({
    id: "source-events", name: "Source Events", version: "1.0.0", parentPlugin: "source-domain",
    dependencies: ["source-domain", "webhooks"],
    recordEvents: { sourcePluginId: "source-domain", events: [{ type: "source-domain.item.completed", label: "Item completo", version: 1 }], onSnapshot: () => ["source-domain.item.completed"] },
  });
  assert.deepEqual(registry.getById("source-events").recordEvents?.events, [{ type: "source-domain.item.completed", label: "Item completo", version: 1 }]);
  assert.deepEqual(webhookEventOptions(registry).map((event) => event.type), ["record.created", "record.updated", "source-domain.item.completed"]);
  registry.setEnabled("source-events", false);
  assert.deepEqual(webhookEventOptions(registry).map((event) => event.type), ["record.created", "record.updated"]);
});

test("webhook worker does not claim the whole workspace route prefix",()=>{
  const calls:string[]=[];
  const service=new WebhooksService({} as never,{registerPermissions:()=>calls.push("permissions"),registerRoutes:()=>calls.push("routes")} as never,{isEnabled:()=>false} as never);
  service.onModuleInit();
  service.onModuleDestroy();
  assert.deepEqual(calls,["permissions"]);
});

test("webhook destinations reject private, loopback, link-local, documentation and reserved addresses",()=>{
  for(const address of ["127.0.0.1","10.0.0.1","172.20.0.4","192.168.1.1","169.254.169.254","100.64.1.1","198.18.0.1","203.0.113.8","224.0.0.1","::1","fc00::1","fe80::1","2001:db8::1","::ffff:127.0.0.1"])
    assert.equal(unsafeWebhookAddress(address),true,address);
  for(const address of ["8.8.8.8","1.1.1.1","2606:4700:4700::1111"])
    assert.equal(unsafeWebhookAddress(address),false,address);
});

test("shared HTTPS transport rejects local ERP/webhook destinations before connecting", async () => {
  const rejected = (error: unknown) => error instanceof HttpException && error.getStatus() === 400;
  await assert.rejects(validatePublicHttpsTarget("http://8.8.8.8/path"), rejected);
  await assert.rejects(validatePublicHttpsTarget("https://127.0.0.1/metadata"), rejected);
  await assert.rejects(validatePublicHttpsTarget("https://user:pass@example.com/hook"), rejected);
});

test("webhook acadêmico usa envelope versionado sem alterar o contrato de eventos genéricos", () => {
  const generic = buildWebhookEnvelope({ id: "event-1", event_type: "record.created", event_version: 1, workspace_id: "workspace-1", record_id: "record-1", plugin_id: "forms", kind: "form", state: "draft", revision: 1, occurred_at: "2030-01-01T00:00:00Z" });
  assert.deepEqual(generic, { id: "event-1", type: "record.created", workspace_id: "workspace-1", record: { id: "record-1", plugin_id: "forms", kind: "form", state: "draft", revision: 1 }, occurred_at: "2030-01-01T00:00:00Z" });
  const academic = buildWebhookEnvelope({ id: "event-2", event_type: "suinda-learning.payment.recorded", event_version: 1, workspace_id: "workspace-1", record_id: "payment-1", plugin_id: "suinda-learning", kind: "payment_entry", state: "recorded", revision: 1, occurred_at: "2030-01-01T00:00:00Z" });
  assert.deepEqual(academic, { id: "event-2", type: "suinda-learning.payment.recorded", version: 1, workspace_id: "workspace-1", resource: { id: "payment-1", kind: "payment_entry", revision: 1 }, occurred_at: "2030-01-01T00:00:00Z" });
  assert.equal(JSON.stringify(academic).includes("recorded_by_user_id"), false);
});

test("eventos e entregas são escritos na mesma conexão transacional e deduplicados pela revisão", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let inserted = true;
  const client = { async query(sql: string, values: unknown[] = []) {
    calls.push({ sql, values });
    if (sql.includes("INSERT INTO webhook_events")) {
      if (!inserted) return { rows: [] };
      inserted = false;
      return { rows: [{ id: "event-1" }] };
    }
    return { rows: [] };
  } };
  const resource = { id: "record-1", workspace_id: "workspace-1", plugin_id: "suinda-learning", kind: "certificate", state: "issued", revision: 3 };
  await enqueueWebhookEvent(client as never, resource, "suinda-learning.certificate.issued", 1);
  await enqueueWebhookEvent(client as never, resource, "suinda-learning.certificate.issued", 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /WITH eligible AS MATERIALIZED/);
  assert.match(calls[0].sql, /inserted_event AS/);
  assert.match(calls[0].sql, /INSERT INTO webhook_deliveries/);
  assert.match(calls[0].sql, /WHERE EXISTS\(SELECT 1 FROM eligible\)/);
  assert.match(calls[0].sql, /ON CONFLICT\(workspace_id,record_id,revision,event_type\) DO NOTHING/);
  assert.equal(calls[0].values[6], "suinda-learning.certificate.issued");
  assert.equal(calls[0].values[7], 1);
});

test("eventos sem assinatura ativa compatível não são persistidos como órfãos", async () => {
  const calls: string[] = [];
  const client = { async query(sql: string) {
    calls.push(sql);
    return { rows: [] }; // CTE elegível vazio, como quando não há assinatura ativa para o evento.
  } };
  const resource = { id: "record-2", workspace_id: "workspace-1", plugin_id: "forms", kind: "form", state: "published", revision: 1 };

  await enqueueWebhookEvent(client as never, resource, "record.created", 1);

  assert.equal(calls.length, 1);
  assert.match(calls[0], /WHERE EXISTS\(SELECT 1 FROM eligible\)/);
  assert.match(calls[0], /INSERT INTO webhook_deliveries/);
  assert.match(calls[0], /FROM eligible CROSS JOIN inserted_event/);
});
