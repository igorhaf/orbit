import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { SecretVault } from "../secrets";
import { suindaWhatsAppPlugin } from "./suinda-whatsapp.plugin";
import { SuindaWhatsAppService, suindaWhatsAppGraphUrl } from "./suinda-whatsapp";

const workspace = "11111111-1111-4111-8111-111111111111";
const manager = "22222222-2222-4222-8222-222222222222";
const learner = "33333333-3333-4333-8333-333333333333";
const learnerInOtherUnit = "55555555-5555-4555-8555-555555555555";
const unitA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const unitB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const announcementCohort = "55555555-5555-4555-8555-555555555556";
const token = "x".repeat(48);
const initialConfig = { wabaId: "123456789012345", phoneNumberId: "987654321098765", accessToken: token };
process.env.ORBIT_SECRET_KEY = "test-only-suinda-whatsapp-secret-key";

function harness(fetcher?: (url: URL, init: RequestInit) => Promise<Response>, announcementPayload: Record<string, unknown> = {}, includeCrossUnitLearner = false) {
  const deliveries = new Map<string, { request_hash: string; state: string; provider_message_id: string | null }>();
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    async one(sql: string, args: unknown[] = []) {
      calls.push({ sql, args });
      if (sql.includes("FROM workspaces")) return { id: workspace };
      if (sql.includes("FROM extension_records WHERE workspace_id=$1 AND plugin_id='suinda-learning'")) return { id: "record-1" };
      if (sql.includes("FROM suinda_whatsapp_config")) return { credentials_encrypted: vault.seal(initialConfig), announcement_template_name: "class_update", announcement_template_language: "pt_BR", updated_at: "2026-10-24T00:00:00Z" };
      if (sql.includes("FROM extension_records WHERE id=$1 AND workspace_id=$2")) return { id: "44444444-4444-4444-8444-444444444444", title: "Aula alterada", state: "sent", payload: { channel: "whatsapp", audience_type: "cohort", audience_record_id: announcementCohort, body: "A aula começará às 9h.\nLeve o material.", ...announcementPayload } };
      if (sql.includes("email='orbit-system-actor@orbit.invalid'")) return { id: "66666666-6666-4666-8666-666666666666" };
      if (sql.includes("FROM suinda_whatsapp_consents c JOIN users")) return { phone_e164: "+14155550123" };
      if (sql.includes("FROM suinda_whatsapp_consents")) return { phone_e164: "+14155550123", opted_in: true,
        categories: ["academic_reminder"], consented_at: "2026-10-24T00:00:00Z", revoked_at: null };
      if (sql.includes("INSERT INTO suinda_whatsapp_deliveries")) {
        const key = String(args[1]);
        if (deliveries.has(key)) return null;
        deliveries.set(key, { request_hash: String(args[2]), state: "sending", provider_message_id: null });
        return { idempotency_key: key };
      }
      if (sql.includes("SELECT request_hash,state")) return deliveries.get(String(args[1])) || null;
      return null;
    },
    async query(sql: string, args: unknown[] = []) {
      calls.push({ sql, args });
      if (sql.includes("SELECT DISTINCT e.payload->>'learner_user_id'")) {
        const candidates = [{ learner_user_id: learner, cohort_id: announcementCohort, enrollment_unit: null, cohort_unit: unitA, course_unit: unitA },
          ...(includeCrossUnitLearner ? [{ learner_user_id: learnerInOtherUnit, cohort_id: announcementCohort, enrollment_unit: unitB, cohort_unit: unitA, course_unit: unitA }] : [])];
        return candidates.filter((candidate) => candidate.cohort_id === args[1]
          && candidate.learner_user_id > String(args[2] || "")
          && (args[3] === null || args[3] === undefined || (candidate.enrollment_unit || candidate.cohort_unit || candidate.course_unit) === args[3]))
          .map(({ learner_user_id }) => ({ learner_user_id }));
      }
      if (sql.includes("UPDATE suinda_whatsapp_deliveries SET state='sent'")) {
        const row = deliveries.get(String(args[1])); if (row) { row.state = "sent"; row.provider_message_id = String(args[2]); }
      }
      if (sql.includes("UPDATE suinda_whatsapp_deliveries SET state='failed'")) {
        const row = deliveries.get(String(args[1])); if (row) row.state = "failed";
      }
      return [];
    },
  };
  const access = { async has() { return true; }, async audit() {} };
  const registry = { isEnabled(id: string) { return id === "suinda-whatsapp"; } };
  const service = new SuindaWhatsAppService(db as never, access as never, registry as never, vault, fetcher);
  return { service, calls, deliveries };
}

const vault = new SecretVault();

test("WhatsApp plugin is an optional child of Suindá learning and claims only its exact routes", () => {
  assert.deepEqual(suindaWhatsAppPlugin.dependencies, ["suinda-learning"]);
  assert.equal(suindaWhatsAppPlugin.handlesRoute?.(`/extensions/suinda-whatsapp/workspaces/${workspace}/configuration`), true);
  assert.equal(suindaWhatsAppPlugin.handlesRoute?.(`/extensions/suinda-whatsapp/workspaces/${workspace}/configuration/extra`), false);
});

test("Graph URL construction is pinned to HTTPS and the official host", () => {
  const url = suindaWhatsAppGraphUrl("1234567890", "messages");
  assert.equal(url.href, "https://graph.facebook.com/v22.0/1234567890/messages");
  assert.throws(() => suindaWhatsAppGraphUrl("//evil.example"), (error: unknown) => error instanceof HttpException);
});

test("workspace config encrypts credentials and never returns the access token", async () => {
  const { service, calls } = harness();
  const saved = await service.saveConfiguration(workspace, manager, {
    waba_id: initialConfig.wabaId, phone_number_id: initialConfig.phoneNumberId, access_token: token,
  });
  assert.deepEqual(saved, { configured: true, waba_id: initialConfig.wabaId, phone_number_id: initialConfig.phoneNumberId,
    access_token_configured: true, announcement_template_name: "class_update", announcement_template_language: "pt_BR", updated_at: "2026-10-24T00:00:00Z" });
  assert.ok(!JSON.stringify(saved).includes(token));
  const sealed = calls.find((call) => call.sql.includes("INSERT INTO suinda_whatsapp_config"))?.args[1];
  assert.equal(typeof sealed, "string");
  assert.ok(!String(sealed).includes(token));
});

test("only explicit, category-specific E.164 consent is accepted and consent reads mask the number", async () => {
  const { service, calls } = harness();
  await assert.rejects(service.setConsent(workspace, learner, { phone_e164: "+14155550123", opted_in: true, categories: [] }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  const saved = await service.setConsent(workspace, learner, { phone_e164: "+14155550123", opted_in: true, categories: ["academic_reminder", "survey_reminder"] });
  assert.equal(saved.opted_in, true);
  assert.equal("phone_e164" in saved, false);
  assert.match(saved.phone_masked || "", /^\+141••••123$/);
  assert.ok(calls.some((call) => call.sql.includes("suinda_whatsapp_consents") && call.args.includes(true)));
  await assert.rejects(service.setConsent(workspace, learner, { phone_e164: "4155550123", opted_in: true, categories: ["academic_reminder"] }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
});

test("survey reminders enter WhatsApp only through the separately selected consent category", async () => {
  const { service, calls } = harness();
  await service.enqueueNotification({ id: "77777777-7777-4777-8777-777777777777", plugin_id: "suinda-learning", user_id: learner,
    workspace_id: workspace, kind: "survey_reminder", title: "Pesquisa próxima do encerramento", body: "Responder à pesquisa", target_url: "/suinda/learning/test/surveys", created_at: new Date().toISOString() });
  const eligibility = calls.find((call) => call.sql.includes("FROM suinda_whatsapp_consents c JOIN users"));
  const queued = calls.find((call) => call.sql.includes("INSERT INTO suinda_whatsapp_notification_queue"));
  assert.equal(eligibility?.args[2], "survey_reminder");
  assert.equal(queued?.args[3], "survey_reminder");
});

test("approved-template delivery is bounded, consent-gated and idempotent", async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const { service, deliveries } = harness(async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) return Response.json({ data: [{ name: "course_reminder", status: "APPROVED", language: "pt_BR" }] });
    return Response.json({ messages: [{ id: "wamid.123" }] });
  });
  const input = { user_id: learner, category: "academic_reminder", template_name: "course_reminder", language: "pt_BR",
    parameters: ["Aula disponível"], idempotency_key: "delivery-0001" };
  const first = await service.sendTemplate(workspace, manager, input);
  const retry = await service.sendTemplate(workspace, manager, input);
  assert.deepEqual(first, { accepted: true, state: "sent", message_id: "wamid.123" });
  assert.deepEqual(retry, first);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.hostname, "graph.facebook.com");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.signal instanceof AbortSignal, true);
  assert.equal(requests[1].init.redirect, "error");
  assert.equal(deliveries.get("delivery-0001")?.state, "sent");
  assert.ok(!JSON.stringify(requests).includes("+14155550123"));
});

test("unapproved templates fail generically, persist idempotent failure and never expose provider secrets", async () => {
  const requests: URL[] = [];
  const { service, deliveries } = harness(async (url) => {
    requests.push(url);
    return Response.json({ data: [{ name: "course_reminder", status: "PENDING", language: "pt_BR" }] });
  });
  const input = { user_id: learner, category: "academic_reminder", template_name: "course_reminder", language: "pt_BR",
    parameters: [], idempotency_key: "delivery-0002" };
  await assert.rejects(service.sendTemplate(workspace, manager, input), (error: unknown) => {
    assert.ok(error instanceof HttpException);
    const message = JSON.stringify(error.getResponse());
    assert.ok(!message.includes(token) && !message.includes("+14155550123") && !message.includes("PENDING"));
    return error.getStatus() === 502;
  });
  assert.equal(requests.length, 1);
  assert.equal(deliveries.get("delivery-0002")?.state, "failed");
});

test("scheduled and immediate announcements only target opted-in learners using the configured approved template", async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const { service } = harness(async (url, init) => {
    requests.push({ url, init });
    if (url.pathname.endsWith("message_templates")) return Response.json({ data: [{ name: "class_update", status: "APPROVED", language: "pt_BR" }] });
    return Response.json({ messages: [{ id: "wamid.announcement" }] });
  });
  await service.assertReady(workspace);
  assert.deepEqual(await service.dispatchAnnouncement(workspace, "44444444-4444-4444-8444-444444444444"),
    { recipient_count: 1, sent_count: 1, failed_count: 0 });
  assert.equal(requests.length, 2);
  const sendBody = JSON.parse(String(requests[1].init.body)) as { template: { components: Array<{ parameters: Array<{ text: string }> }> } };
  assert.deepEqual(sendBody.template.components[0].parameters.map((parameter) => parameter.text), ["Aula alterada", "A aula começará às 9h.\nLeve o material."]);
});

test("unit announcements resolve enrollment over cohort and course while legacy cohort payloads retain recipients", async () => {
  const fetcher = async (url: URL) => url.pathname.endsWith("message_templates")
    ? Response.json({ data: [{ name: "class_update", status: "APPROVED", language: "pt_BR" }] })
    : Response.json({ messages: [{ id: "wamid.unit-announcement" }] });
  const announcementId = "44444444-4444-4444-8444-444444444444";
  const unitScoped = harness(fetcher, { audience_unit_record_id: unitA }, true);
  assert.deepEqual(await unitScoped.service.dispatchAnnouncement(workspace, announcementId),
    { recipient_count: 1, sent_count: 1, failed_count: 0 });
  assert.deepEqual([...unitScoped.deliveries.keys()].filter((key) => key.startsWith(`announce:${announcementId}:`)),
    [`announce:${announcementId}:${learner}`]);
  const scopedQuery = unitScoped.calls.find((call) => call.sql.includes("SELECT DISTINCT e.payload->>'learner_user_id'"));
  assert.ok(scopedQuery);
  assert.equal(scopedQuery.args[3], unitA);
  assert.match(scopedQuery.sql, /COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id'/);
  assert.match(scopedQuery.sql, /NULLIF\(co\.payload->>'institution_unit_record_id',''\),NULLIF\(course\.payload->>'institution_unit_record_id',''\)/);

  const legacy = harness(fetcher, {}, true);
  assert.deepEqual(await legacy.service.dispatchAnnouncement(workspace, announcementId),
    { recipient_count: 2, sent_count: 2, failed_count: 0 });
  assert.deepEqual([...legacy.deliveries.keys()].filter((key) => key.startsWith(`announce:${announcementId}:`)),
    [`announce:${announcementId}:${learner}`, `announce:${announcementId}:${learnerInOtherUnit}`]);
  const legacyQuery = legacy.calls.find((call) => call.sql.includes("SELECT DISTINCT e.payload->>'learner_user_id'"));
  assert.ok(legacyQuery);
  assert.equal(legacyQuery.args[3], null);
});

test("disabled child plugin blocks its routes and internal send operations", async () => {
  const { service } = harness();
  const disabled = new SuindaWhatsAppService({} as never, {} as never, { isEnabled: () => false } as never, vault);
  await assert.rejects(disabled.consent(workspace, learner), (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  assert.ok(service);
});

test("notification queue accepts only eligible Suindá WhatsApp notification categories", async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  let eligible = true;
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM suinda_whatsapp_consents c JOIN users")) return eligible ? { user_id: learner } : null;
      return null;
    },
    async query(sql: string, args: unknown[] = []) { calls.push({ sql, args }); return []; },
  };
  const service = new SuindaWhatsAppService(db as never, {} as never, { isEnabled: () => true } as never, vault);
  const notification = (overrides: Partial<Parameters<typeof service.enqueueNotification>[0]> = {}) => ({
    id: "77777777-7777-4777-8777-777777777777", plugin_id: "suinda-learning", user_id: learner, workspace_id: workspace,
    kind: "academic_reminder", title: "Encontro", body: "Amanhã", target_url: null, created_at: "2026-10-24T00:00:00Z", ...overrides,
  });

  await service.enqueueNotification(notification());
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO suinda_whatsapp_notification_queue/);
  assert.deepEqual(calls[0].args.slice(1), [workspace, learner, "academic_reminder"]);
  calls.length = 0;
  await service.enqueueNotification(notification({ kind: "comment" }));
  await service.enqueueNotification(notification({ plugin_id: "cards" }));
  await service.enqueueNotification(notification({ workspace_id: null }));
  assert.deepEqual(calls, []);

  eligible = false;
  await service.enqueueNotification(notification({ kind: "attendance_risk" }));
  assert.deepEqual(calls, []);
});

test("notification queue sends an eligible academic reminder and records the delivery state", async () => {
  const states: Array<{ state: string; id: unknown }> = [];
  const delivered = new Map<string, { request_hash: string; state: string; provider_message_id: string | null }>();
  const row = { notification_id: "77777777-7777-4777-8777-777777777777", workspace_id: workspace, user_id: learner,
    category: "academic_reminder", title: "Encontro próximo", body: "Aula amanhã" };
  const db = {
    async query(sql: string, args: unknown[] = []) {
      if (sql.includes("WITH selected AS")) return [row];
      if (sql.includes("UPDATE suinda_whatsapp_notification_queue SET state=$2")) states.push({ state: String(args[1]), id: args[0] });
      if (sql.includes("UPDATE suinda_whatsapp_deliveries SET state='sent'")) {
        const delivery = delivered.get(String(args[1]));
        if (delivery) { delivery.state = "sent"; delivery.provider_message_id = String(args[2]); }
      }
      return [];
    },
    async one(sql: string, args: unknown[] = []) {
      if (sql.includes("orbit-system-actor@orbit.invalid")) return { id: manager };
      if (sql.includes("AS eligible")) return { eligible: true };
      if (sql.includes("announcement_template_name,announcement_template_language")) return { credentials_encrypted: vault.seal(initialConfig),
        announcement_template_name: "class_update", announcement_template_language: "pt_BR" };
      if (sql.includes("credentials_encrypted")) return { credentials_encrypted: vault.seal(initialConfig) };
      if (sql.includes("academic_reminders_enabled")) return { enabled: true };
      if (sql.includes("SELECT c.phone_e164 FROM suinda_whatsapp_consents")) return { phone_e164: "+14155550123" };
      if (sql.includes("INSERT INTO suinda_whatsapp_deliveries")) {
        const key = String(args[1]);
        if (delivered.has(key)) return null;
        delivered.set(key, { request_hash: String(args[2]), state: "sending", provider_message_id: null });
        return { idempotency_key: key };
      }
      if (sql.includes("SELECT request_hash,state")) return delivered.get(String(args[1])) || null;
      return null;
    },
  };
  const requests: URL[] = [];
  const fetcher = async (url: URL) => {
    requests.push(url);
    return url.pathname.endsWith("message_templates")
      ? Response.json({ data: [{ name: "class_update", status: "APPROVED", language: "pt_BR" }] })
      : Response.json({ messages: [{ id: "wamid.notice" }] });
  };
  const service = new SuindaWhatsAppService(db as never, { async audit() {} } as never,
    { isEnabled: () => true } as never, vault, fetcher);

  await service.processNotificationQueue();

  assert.deepEqual(states, [{ state: "sent", id: row.notification_id }]);
  assert.equal(requests.length, 2);
  assert.equal(delivered.get(`notice:${row.notification_id}:${learner}`)?.state, "sent");
});

test("notification queue skips reminders when the learner's Suindá preference is disabled", async () => {
  const states: unknown[][] = [];
  const db = {
    async query(sql: string, args: unknown[] = []) {
      if (sql.includes("WITH selected AS")) return [{ notification_id: "77777777-7777-4777-8777-777777777777", workspace_id: workspace,
        user_id: learner, category: "academic_reminder", title: "Encontro", body: "Amanhã" }];
      if (sql.includes("UPDATE suinda_whatsapp_notification_queue SET state=$2")) states.push(args);
      return [];
    },
    async one(sql: string) {
      if (sql.includes("orbit-system-actor@orbit.invalid")) return { id: manager };
      if (sql.includes("announcement_template_name,announcement_template_language")) return { announcement_template_name: "class_update", announcement_template_language: "pt_BR" };
      if (sql.includes("credentials_encrypted")) return { credentials_encrypted: vault.seal(initialConfig) };
      if (sql.includes("academic_reminders_enabled")) return { enabled: false };
      return null;
    },
  };
  const service = new SuindaWhatsAppService(db as never, {} as never, { isEnabled: () => true } as never, vault,
    async () => { throw new Error("não deve enviar"); });
  await service.processNotificationQueue();
  assert.deepEqual(states, [["77777777-7777-4777-8777-777777777777", "skipped"]]);
});

test("notification queue leaves delivery pending until WhatsApp is configured", async () => {
  const states: unknown[][] = [];
  const db = {
    async query(sql: string, args: unknown[] = []) {
      if (sql.includes("WITH selected AS")) return [{ notification_id: "77777777-7777-4777-8777-777777777777", workspace_id: workspace,
        user_id: learner, category: "academic_reminder", title: "Encontro", body: "Amanhã" }];
      if (sql.includes("UPDATE suinda_whatsapp_notification_queue SET state=$2")) states.push(args);
      return [];
    },
    async one(sql: string) {
      if (sql.includes("orbit-system-actor@orbit.invalid")) return { id: manager };
      if (sql.includes("announcement_template_name,announcement_template_language")) return null;
      if (sql.includes("AS eligible")) return { eligible: true };
      return null;
    },
  };
  const service = new SuindaWhatsAppService(db as never, {} as never, { isEnabled: () => true } as never, vault);
  await service.processNotificationQueue();
  assert.deepEqual(states, [["77777777-7777-4777-8777-777777777777", "pending"]]);
});
