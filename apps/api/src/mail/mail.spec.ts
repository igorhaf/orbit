import assert from "node:assert/strict";
import test from "node:test";
import { PluginRegistry } from "../execution/registries";
import { MailProviderRegistry } from "./provider-registry";
import { plainText, sanitizeMailHtml, validateCompose } from "./security";
import { MailProvider } from "./types";
import { mailPluginDefinition } from "./mail.service";

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

test("mail plugins expose actions, permissions and normalized trigger", () => {
  const fakeService = {
    compose: async () => ({}), list: async () => ({}), thread: async () => ({}), message: async () => ({}),
  } as never;
  const plugins = new PluginRegistry();
  plugins.register(mailPluginDefinition("gmail", "Gmail", fakeService));
  plugins.register(mailPluginDefinition("outlook_mail", "Outlook Mail", fakeService));
  assert.equal(plugins.getAction("gmail", "send").permissions?.[0], "mail.send");
  assert.equal(plugins.getTrigger("outlook_mail", "received").metadata?.event, "email.received");
  assert.equal(plugins.connectionProviders().length, 2);
});
