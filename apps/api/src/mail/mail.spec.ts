import assert from "node:assert/strict";
import test from "node:test";
import { PluginRegistry } from "../execution/registries";
import { MailProviderRegistry } from "./provider-registry";
import { plainText, sanitizeMailHtml, validateCompose } from "./security";
import { MailProvider } from "./types";
import { MailService, mailPluginDefinition } from "./mail.service";

const provider = (id: "gmail" | "outlook_mail"): MailProvider => ({
  id,
  name: id,
  async listThreads() { return { items: [] }; },
  async getThread() { return { id: "thread", subject: "Subject", participants: [], unread: false, metadata: {} }; },
  async getMessage() { return { id: "message", threadId: "thread", subject: "Subject", to: [], cc: [], unread: false, attachments: [], metadata: {} }; },
  async search() { return { items: [] }; },
  async createDraft() { return { id: "draft", threadId: "", subject: "Subject", to: [], cc: [], unread: false, attachments: [], metadata: {} }; },
  async send() { return { id: "sent", threadId: "", subject: "Subject", to: [], cc: [], unread: false, attachments: [], metadata: {} }; },
  async reply() { return { id: "reply", threadId: "thread", subject: "Subject", to: [], cc: [], unread: false, attachments: [], metadata: {} }; },
});

test("mail providers share one provider contract", () => {
  const registry = new MailProviderRegistry();
  registry.register(provider("gmail"));
  registry.register(provider("outlook_mail"));
  assert.deepEqual(registry.list().map((item) => item.id), ["gmail", "outlook_mail"]);
  assert.throws(() => registry.register(provider("gmail")), /duplicado/);
});

test("mail content is sanitized before reaching Orbit UI", () => {
  const dirty = '<p onclick="steal()">Hello</p><script>steal()</script><a href="javascript:steal()">x</a>';
  const safe = sanitizeMailHtml(dirty);
  assert.doesNotMatch(safe, /script|onclick|javascript:/i);
  assert.equal(plainText("<p>Hello&nbsp;Orbit</p>"), "Hello Orbit");
  assert.throws(() => validateCompose({ to: [{ address: "bad" }], subject: "x", text: "y" }), /inválido/);
});

test("mail plugins expose actions, permissions and connection providers", () => {
  const fakeService = {
    compose: async () => ({}), list: async () => ({}), thread: async () => ({}), message: async () => ({}),
  } as never;
  const plugins = new PluginRegistry();
  plugins.register(mailPluginDefinition("gmail", "Gmail", fakeService));
  plugins.register(mailPluginDefinition("outlook_mail", "Outlook Mail", fakeService));
  assert.equal(plugins.getAction("gmail", "send").permissions?.[0], "mail.send");
  assert.equal(plugins.connectionProviders().length, 2);
});

test("outbound mail monitoring stores only actor and outcome, never recipient or message content", async () => {
  const sent: unknown[][] = [];
  const db = { async query(sql: string, values: unknown[]) { sent.push([sql, ...values]); return []; } };
  const providers = new MailProviderRegistry();
  providers.register(provider("gmail"));
  const service = new MailService(db as never, {} as never, providers, {} as never);
  const connection = "bda6fdae-28b9-49cf-956e-2dd2cc540e42";
  await service.compose("cfeadace-49c9-4a66-8a06-cc2980f7edb8", "gmail", connection, "send", {
    to: [{ address: "private@example.test" }], subject: "Sensitive subject", text: "Sensitive body",
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "INSERT INTO access_audit(actor_id,action) VALUES($1,'mail.delivery.succeeded')");
  assert.deepEqual(sent[0].slice(1), ["cfeadace-49c9-4a66-8a06-cc2980f7edb8"]);
  assert.equal(JSON.stringify(sent).includes("private@example.test"), false);
  assert.equal(JSON.stringify(sent).includes("Sensitive"), false);
});
