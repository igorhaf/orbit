import assert from "node:assert/strict";
import test from "node:test";
import webpush from "web-push";
import { Agent } from "node:https";
import { PluginNotifications } from "./notifications";
import { pinnedHttpsAgent, resolvePublicHttpsTarget, unsafeHttpsAddress } from "../secure-https-target";

function useTestVapid() {
  const keys = webpush.generateVAPIDKeys();
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:push@example.test";
}

function withVapidEnv(testBody: () => Promise<void>) {
  const previous = [process.env.WEB_PUSH_VAPID_PUBLIC_KEY, process.env.WEB_PUSH_VAPID_PRIVATE_KEY, process.env.WEB_PUSH_VAPID_SUBJECT];
  return testBody().finally(() => {
    ["WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_SUBJECT"].forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    });
  });
}

test("email worker sends only to currently verified accounts with both notification preferences enabled", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let enabled = true;
  const db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("WITH due AS")) return [{ id: "delivery-1", user_id: "user-1", attempt_count: 1,
        title: "A tarefa venceu", body: "Revise o cartão", target_url: "/boards", email: "person@example.test", name: "Pessoa" }];
      return [];
    },
    async one(sql: string) { calls.push({ sql, params: [] }); return enabled ? { email: "person@example.test", name: "Pessoa" } : null; },
  };
  const sent: Array<{ to: string[]; subject: string; text: string }> = [];
  const worker = new PluginNotifications(db as never, { async send() {}, async sendMessage(to, subject, text) { sent.push({ to, subject, text }); return {}; } });
  await worker.dispatchNotificationEmails();
  assert.deepEqual(sent[0]?.to, ["person@example.test"]);
  assert.equal(sent[0]?.subject, "Orbit: A tarefa venceu");
  assert.match(sent[0]?.text || "", /Abrir Orbit: http:\/\/localhost:3000\/boards/);
  assert.ok(calls.some((call) => call.sql.includes("emailNotifications")));
  assert.ok(calls.some((call) => call.sql.includes("status='sent'")));

  enabled = false;
  calls.length = 0;
  sent.length = 0;
  await worker.dispatchNotificationEmails();
  assert.deepEqual(sent, []);
  assert.ok(calls.some((call) => call.sql.includes("status='cancelled'")));
});

test("email worker retries delivery failures with bounded exponential delay", async () => {
  const updates: unknown[][] = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("WITH due AS")) return [{ id: "delivery-1", user_id: "user-1", attempt_count: 2,
        title: "Tarefa", body: "", target_url: null, email: "person@example.test", name: "Pessoa" }];
      if (sql.includes("SET status=$2")) updates.push(params);
      return [];
    },
    async one() { return { email: "person@example.test", name: "Pessoa" }; },
  };
  const worker = new PluginNotifications(db as never, { async send() {}, async sendMessage() { throw new Error("SMTP unavailable"); } });
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

test("push subscription is optional until VAPID is configured and accepts only bounded HTTPS subscriptions", () => withVapidEnv(async () => {
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_VAPID_SUBJECT;
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async one(sql: string, params: unknown[] = []) { calls.push({ sql, params }); return { subscribed: true }; },
    async query(sql: string, params: unknown[] = []) { calls.push({ sql, params }); return []; },
  };
  const service = new PluginNotifications(db as never);
  assert.deepEqual(await service.pushConfig("user-1"), { enabled: false, public_key: null, subscribed: true });
  await assert.rejects(() => service.subscribePush("user-1", {}), /indisponíveis/);

  useTestVapid();
  const p256dh = Buffer.alloc(65, 7).toString("base64url");
  const auth = Buffer.alloc(16, 9).toString("base64url");
  await service.subscribePush("user-1", { endpoint: "https://8.8.8.8/device-token", keys: { p256dh, auth } });
  await assert.rejects(() => service.subscribePush("user-1", { endpoint: "http://push.example.test/device-token", keys: { p256dh, auth } }), /inválida/);
  await assert.rejects(() => service.subscribePush("user-1", { endpoint: "https://127.0.0.1/device-token", keys: { p256dh, auth } }), /inválida/);
  await assert.rejects(() => service.subscribePush("user-1", { endpoint: "https://169.254.169.254/latest/meta-data", keys: { p256dh, auth } }), /inválida/);
  const insert = calls.find((call) => call.sql.includes("INSERT INTO notification_push_subscriptions"));
  assert.equal(insert?.params[0], "user-1");
  assert.match(insert?.sql || "", /WHERE notification_push_subscriptions\.user_id=EXCLUDED\.user_id/);
}));

test("push endpoint cannot be reassigned from its existing account owner", () => withVapidEnv(async () => {
  useTestVapid();
  const db = { async one(sql: string) { return sql.includes("INSERT INTO notification_push_subscriptions") ? null : { subscribed: false }; }, async query() { return []; } };
  const p256dh = Buffer.alloc(65, 7).toString("base64url");
  const auth = Buffer.alloc(16, 9).toString("base64url");
  await assert.rejects(() => new PluginNotifications(db as never).subscribePush("user-2", {
    endpoint: "https://8.8.8.8/device-token", keys: { p256dh, auth },
  }), /outra conta/);
}));

test("push worker retries transient failures, removes expired endpoints, and respects account preferences", () => withVapidEnv(async () => {
  useTestVapid();
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let statusCode = 503;
  let enabled = true;
  const oldSender = webpush.sendNotification;
  webpush.sendNotification = (async (_subscription, _payload, options) => {
    assert.ok(options?.agent instanceof Agent, "worker supplies the DNS-pinned HTTPS agent to web-push");
    throw Object.assign(new Error("push failed"), { statusCode });
  }) as typeof webpush.sendNotification;
  const db = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      if (sql.includes("WITH due AS")) return [{ id: "delivery-1", subscription_id: "subscription-1", user_id: "user-1", attempt_count: 2,
        endpoint: "https://8.8.8.8/private-token", p256dh: "public-key", auth: "auth-key", title: "Title", body: "Body", target_url: "/" }];
      return [];
    },
    async one() { return { enabled }; },
  };
  try {
    const service = new PluginNotifications(db as never);
    await service.dispatchNotificationPushes();
    assert.ok(statements.some((statement) => statement.sql.includes("SET status=$2") && statement.params[1] === "pending" && statement.params[2] === 120));
    statements.length = 0;
    statusCode = 410;
    await service.dispatchNotificationPushes();
    assert.ok(statements.some((statement) => statement.sql.includes("DELETE FROM notification_push_subscriptions") && statement.params[0] === "subscription-1"));
    statements.length = 0;
    enabled = false;
    statusCode = 503;
    await service.dispatchNotificationPushes();
    assert.ok(statements.some((statement) => statement.sql.includes("status='cancelled'")));
  } finally {
    webpush.sendNotification = oldSender;
  }
}));

test("push worker cancels queued deliveries when VAPID is not configured", () => withVapidEnv(async () => {
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_VAPID_SUBJECT;
  const statements: string[] = [];
  const db = { async query(sql: string) { statements.push(sql); return []; }, async one() { return null; } };
  await new PluginNotifications(db as never).dispatchNotificationPushes();
  assert.ok(statements.some((statement) => statement.includes("status='cancelled'")));
}));

test("push worker fails expired sending rows at the attempt ceiling before checking VAPID", () => withVapidEnv(async () => {
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_VAPID_SUBJECT;
  const statements: string[] = [];
  const db = { async query(sql: string) { statements.push(sql); return []; } };
  await new PluginNotifications(db as never).dispatchNotificationPushes();
  assert.match(statements[0], /UPDATE notification_push_deliveries SET status='failed'/);
  assert.match(statements[0], /status='sending' AND attempt_count>=5/);
  assert.match(statements[0], /updated_at<=now\(\)-INTERVAL '5 minutes'/);
  assert.match(statements[1], /status='cancelled'/);
}));

test("public HTTPS target validation rejects private DNS answers and the agent pins the accepted address", async () => {
  assert.equal(unsafeHttpsAddress("127.0.0.1"), true);
  assert.equal(unsafeHttpsAddress("10.20.0.1"), true);
  assert.equal(unsafeHttpsAddress("169.254.169.254"), true);
  assert.equal(unsafeHttpsAddress("::1"), true);
  assert.equal(unsafeHttpsAddress("fc00::1"), true);
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
