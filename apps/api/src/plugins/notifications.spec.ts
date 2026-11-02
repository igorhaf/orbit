import assert from "node:assert/strict";
import test from "node:test";
import { PluginNotifications } from "./notifications";
import webpush from "web-push";
import { Agent } from "node:https";
import { pinnedHttpsAgent, resolvePublicHttpsTarget, unsafeHttpsAddress } from "../secure-https-target";

function pendingDelivery(attemptCount = 1) {
  return { id: "delivery-1", user_id: "user-1", attempt_count: attemptCount, notification_plugin_id: "suinda-learning",
    title: "Encontro próximo", body: "Curso · amanhã", target_url: "/suinda", email: "learner@example.test", name: "Pessoa Aluna" };
}

test("notification email worker sends only to the currently opted-in verified account", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let accountEnabled = true;
  const db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("WITH due AS")) return [pendingDelivery()];
      return [];
    },
    async one(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return accountEnabled ? { email: "learner@example.test", name: "Pessoa Aluna" } : null;
    },
  };
  const sent: Array<{ to: string[]; subject: string; text: string }> = [];
  const worker = new PluginNotifications(db as never, { async send() {}, async sendMessage(to, subject, text) { sent.push({ to, subject, text }); return {}; } });
  await worker.dispatchNotificationEmails();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ["learner@example.test"]);
  assert.equal(sent[0].subject, "Suindá: Encontro próximo");
  assert.match(sent[0].text, /Abrir Suindá: http:\/\/localhost:3\d{3}\/suinda/);
  assert.match(sent[0].text, /Gerenciar notificações por e-mail/);
  assert.ok(calls.some((call) => call.sql.includes("status='sent'")));

  accountEnabled = false;
  calls.length = 0;
  sent.length = 0;
  await worker.dispatchNotificationEmails();
  assert.deepEqual(sent, []);
  assert.ok(calls.some((call) => call.sql.includes("status='cancelled'")));
});

test("notification email worker retries delivery failures with bounded attempts", async () => {
  const updates: unknown[][] = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("WITH due AS")) return [pendingDelivery(2)];
      if (sql.includes("SET status=$2")) updates.push(params);
      return [];
    },
    async one() { return { email: "learner@example.test", name: "Pessoa Aluna" }; },
  };
  const worker = new PluginNotifications(db as never, { async send() {}, async sendMessage() { throw new Error("SMTP indisponível"); } });
  await worker.dispatchNotificationEmails();
  assert.deepEqual(updates[0], ["delivery-1", "pending", 120]);
});

test("email worker fails expired sending rows at the attempt ceiling before claiming more work", async () => {
  const statements: string[] = [];
  const db = { async query(sql: string) { statements.push(sql); return []; } };
  const worker = new PluginNotifications(db as never, { async send() {}, async sendMessage() { return {}; } });
  await worker.dispatchNotificationEmails();
  assert.match(statements[0], /UPDATE notification_email_deliveries SET status='failed'/);
  assert.match(statements[0], /status='sending' AND attempt_count>=5/);
  assert.match(statements[0], /updated_at<=now\(\)-INTERVAL '5 minutes'/);
  assert.match(statements[1], /WITH due AS/);
});

test("notification email worker renders an enabled institutional template for its matching workspace event", async () => {
  const calls: string[] = [];
  const db = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes("WITH due AS")) return [{ ...pendingDelivery(), kind: "academic_reminder", workspace_id: "workspace-1",
        institution_name: "Instituto Exemplo", template_subject: "{{institution_name}} · {{notification_title}}",
        template_body: "Olá, {{learner_name}}.\n{{notification_body}}\n{{course_link}}" }];
      return [];
    },
    async one(sql: string) { calls.push(sql); return { email: "learner@example.test", name: "Pessoa Aluna" }; },
  };
  const sent: Array<{ subject: string; body: string }> = [];
  const worker = new PluginNotifications(db as never, { async send() {}, async sendMessage(_to, subject, body) { sent.push({ subject, body }); return {}; } });
  await worker.dispatchNotificationEmails();
  assert.equal(sent[0]?.subject, "Instituto Exemplo · Encontro próximo");
  assert.match(sent[0]?.body || "", /^Olá, Pessoa Aluna\.\nCurso · amanhã\nhttp:\/\/localhost:3\d{3}\/suinda$/);
  assert.ok(calls.some((statement) => statement.includes("workspace_email_templates")));
  assert.ok(calls.some((statement) => statement.includes("workspace_id=n.workspace_id")));
});

function useTestVapid() {
  const keys = webpush.generateVAPIDKeys();
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:push@example.test";
}

test("push config is optional and subscription is an independent opt-in with a bounded HTTPS endpoint", async () => {
  const previous = [process.env.WEB_PUSH_VAPID_PUBLIC_KEY, process.env.WEB_PUSH_VAPID_PRIVATE_KEY, process.env.WEB_PUSH_VAPID_SUBJECT];
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_VAPID_SUBJECT;
  try {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      async one(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return sql.includes("EXISTS") ? { subscribed: true } : { user_id: "user-1" };
      },
      async query(sql: string, params: unknown[] = []) { calls.push({ sql, params }); return []; },
    };
    const service = new PluginNotifications(db as never);
    assert.deepEqual(await service.pushConfig("user-1"), { enabled: false, public_key: null, subscribed: true });
    await assert.rejects(() => service.subscribePush("user-1", {}), /indisponíveis/);
    useTestVapid();
    const p256dh = Buffer.alloc(65, 7).toString("base64url");
    const auth = Buffer.alloc(16, 9).toString("base64url");
    await service.subscribePush("user-1", { endpoint: "https://8.8.8.8/opaque", keys: { p256dh, auth } });
    assert.ok(calls.some((call) => call.sql.includes("INSERT INTO notification_push_subscriptions") && call.params[0] === "user-1"));
    await assert.rejects(() => service.subscribePush("user-1", { endpoint: "http://push.example.test/opaque", keys: { p256dh, auth } }), /inválida/);
    await assert.rejects(() => service.subscribePush("user-1", { endpoint: "https://127.0.0.1/opaque", keys: { p256dh, auth } }), /inválida/);
    await assert.rejects(() => service.subscribePush("user-1", { endpoint: "https://[2001:db8::1]/opaque", keys: { p256dh, auth } }), /inválida/);
    await assert.rejects(() => service.subscribePush("user-1", { endpoint: "https://169.254.169.254/latest/meta-data", keys: { p256dh, auth } }), /inválida/);
    assert.ok(!calls.some((call) => call.sql.includes("preferences->>'notifications'") && call.sql.includes("notification_push_subscriptions")));
    const insert = calls.find((call) => call.sql.includes("INSERT INTO notification_push_subscriptions"));
    assert.match(insert?.sql || "", /WHERE notification_push_subscriptions\.user_id=EXCLUDED\.user_id/);
  } finally {
    ["WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_SUBJECT"].forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    });
  }
});

test("push subscription cannot claim a device endpoint already owned by another account", async () => {
  const previous = [process.env.WEB_PUSH_VAPID_PUBLIC_KEY, process.env.WEB_PUSH_VAPID_PRIVATE_KEY, process.env.WEB_PUSH_VAPID_SUBJECT];
  useTestVapid();
  const db = {
    async one(sql: string) { return sql.includes("INSERT INTO notification_push_subscriptions") ? null : { subscribed: false }; },
    async query() { return []; },
  };
  try {
    const p256dh = Buffer.alloc(65, 7).toString("base64url");
    const auth = Buffer.alloc(16, 9).toString("base64url");
    await assert.rejects(() => new PluginNotifications(db as never).subscribePush("other-user", {
      endpoint: "https://8.8.8.8/private-token", keys: { p256dh, auth },
    }), /outra conta/);
  } finally {
    ["WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_SUBJECT"].forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    });
  }
});

test("push worker retries transient failures and removes expired subscriptions", async () => {
  const previous = [process.env.WEB_PUSH_VAPID_PUBLIC_KEY, process.env.WEB_PUSH_VAPID_PRIVATE_KEY, process.env.WEB_PUSH_VAPID_SUBJECT];
  useTestVapid();
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let statusCode = 503;
  const oldSender = webpush.sendNotification;
  webpush.sendNotification = (async (_subscription, _payload, options) => {
    assert.ok(options?.agent instanceof Agent, "Suindá worker supplies a DNS-pinned HTTPS agent to web-push");
    throw Object.assign(new Error("push delivery failed"), { statusCode });
  }) as typeof webpush.sendNotification;
  const db = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      if (sql.includes("WITH due AS")) return [{ id: "delivery-1", subscription_id: "subscription-1", user_id: "user-1", attempt_count: 2,
        endpoint: "https://8.8.8.8/private-token", p256dh: "private-key", auth: "private-auth", title: "Private title", body: "Private body", target_url: "/" }];
      return [];
    },
    async one() { return { enabled: true }; },
  };
  try {
    const service = new PluginNotifications(db as never);
    await service.dispatchNotificationPushes();
    assert.ok(statements.some((statement) => statement.sql.includes("SET status=$2") && statement.params[1] === "pending" && statement.params[2] === 120));
    statements.length = 0;
    statusCode = 410;
    await service.dispatchNotificationPushes();
    assert.ok(statements.some((statement) => statement.sql.includes("DELETE FROM notification_push_subscriptions") && statement.params[0] === "subscription-1"));
  } finally {
    webpush.sendNotification = oldSender;
    ["WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_SUBJECT"].forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    });
  }
});

test("push worker cancels queued deliveries when VAPID is not configured", async () => {
  const previous = [process.env.WEB_PUSH_VAPID_PUBLIC_KEY, process.env.WEB_PUSH_VAPID_PRIVATE_KEY, process.env.WEB_PUSH_VAPID_SUBJECT];
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_VAPID_SUBJECT;
  const statements: string[] = [];
  const db = { async query(sql: string) { statements.push(sql); return []; }, async one() { return null; } };
  try {
    await new PluginNotifications(db as never).dispatchNotificationPushes();
    assert.ok(statements.some((statement) => statement.includes("status='cancelled'")));
  } finally {
    ["WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_SUBJECT"].forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    });
  }
});

test("push worker fails expired sending rows at the attempt ceiling before checking VAPID", async () => {
  const previous = [process.env.WEB_PUSH_VAPID_PUBLIC_KEY, process.env.WEB_PUSH_VAPID_PRIVATE_KEY, process.env.WEB_PUSH_VAPID_SUBJECT];
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_VAPID_SUBJECT;
  const statements: string[] = [];
  const db = { async query(sql: string) { statements.push(sql); return []; } };
  try {
    await new PluginNotifications(db as never).dispatchNotificationPushes();
    assert.match(statements[0], /UPDATE notification_push_deliveries SET status='failed'/);
    assert.match(statements[0], /status='sending' AND attempt_count>=5/);
    assert.match(statements[0], /updated_at<=now\(\)-INTERVAL '5 minutes'/);
    assert.ok(statements.some((statement) => statement.includes("status='cancelled'")));
  } finally {
    ["WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_SUBJECT"].forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    });
  }
});

test("public HTTPS target validation rejects private DNS answers and pins a validated address", async () => {
  assert.equal(unsafeHttpsAddress("127.0.0.1"), true);
  assert.equal(unsafeHttpsAddress("10.20.0.1"), true);
  assert.equal(unsafeHttpsAddress("169.254.169.254"), true);
  assert.equal(unsafeHttpsAddress("::1"), true);
  assert.equal(unsafeHttpsAddress("fc00::1"), true);
  assert.equal(unsafeHttpsAddress("2001:db8::1"), true);
  assert.equal(unsafeHttpsAddress("8.8.8.8"), false);

  await assert.rejects(() => resolvePublicHttpsTarget("https://push.example.test/subscription", (async () => [
    { address: "8.8.8.8", family: 4 }, { address: "10.0.0.5", family: 4 },
  ]) as never), /public addresses/);
  const target = await resolvePublicHttpsTarget("https://push.example.test/subscription", (async () => [
    { address: "8.8.8.8", family: 4 },
  ]) as never);
  const agent = pinnedHttpsAgent(target);
  try {
    assert.ok(agent instanceof Agent);
    const lookup = agent.options.lookup as unknown as (hostname: string, options: unknown,
      callback: (error: Error | null, address: string, family: number) => void) => void;
    const result = await new Promise<{ error: Error | null; address: string; family: number }>((resolve) => {
      lookup("push.example.test", {}, (error, address, family) => resolve({ error, address, family }));
    });
    assert.equal(result.error, null);
    assert.deepEqual({ address: result.address, family: result.family }, { address: "8.8.8.8", family: 4 });
    const mismatch = await new Promise<Error | null>((resolve) => {
      lookup("attacker.example.test", {}, (error) => resolve(error));
    });
    assert.equal(mismatch?.name, "UnsafeHttpsTargetError");
  } finally { agent.destroy(); }
});

test("notification observers run only after a notification is inserted and preferences allow it", async () => {
  const inserted = {
    id: "notification-1", plugin_id: "suinda-learning", user_id: "user-1", workspace_id: "workspace-1",
    kind: "academic_reminder", title: "Encontro", body: "Amanhã", target_url: "/suinda", created_at: "2026-10-24T00:00:00Z",
  };
  let insertResult: typeof inserted | null = inserted;
  let enabled = true;
  const db = {
    async one(sql: string) {
      if (sql.includes("preferences->>'notifications'")) return { enabled };
      return insertResult;
    },
  };
  const service = new PluginNotifications(db as never);
  const seen: unknown[] = [];
  const unregister = service.registerDeliveryObserver(async (notification) => { seen.push(notification); });

  assert.deepEqual(await service.publish("suinda-learning", "user-1", { kind: "academic_reminder", title: "Encontro", workspaceId: "workspace-1" }), inserted);
  assert.deepEqual(seen, [inserted]);

  insertResult = null;
  assert.equal(await service.publish("suinda-learning", "user-1", { kind: "academic_reminder", title: "Encontro", workspaceId: "workspace-1" }), null);
  enabled = false;
  insertResult = inserted;
  assert.equal(await service.publish("suinda-learning", "user-1", { kind: "academic_reminder", title: "Encontro", workspaceId: "workspace-1" }), null);
  assert.deepEqual(seen, [inserted]);
  unregister();
});
