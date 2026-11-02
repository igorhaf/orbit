import assert from "node:assert/strict";
import { test } from "node:test";
import { suindaDomainWebhookEvents } from "./domain-webhook-events";

const record = (kind: string, state: string, revision = 1, payload: Record<string, unknown> = {}) => ({
  plugin_id: "suinda-learning", kind, state, revision, payload,
});

test("eventos acadêmicos só representam a entrada na conclusão ou emissão", () => {
  assert.deepEqual(suindaDomainWebhookEvents(record("enrollment", "active", 4), "completed"), []);
  assert.deepEqual(suindaDomainWebhookEvents(record("enrollment", "completed", 5), "active"), ["suinda-learning.enrollment.completed"]);
  assert.deepEqual(suindaDomainWebhookEvents(record("enrollment", "completed", 5)), []);
  assert.deepEqual(suindaDomainWebhookEvents(record("enrollment", "completed", 1)), ["suinda-learning.enrollment.completed"]);
  assert.deepEqual(suindaDomainWebhookEvents(record("certificate", "issued", 3), "issued"), []);
  assert.deepEqual(suindaDomainWebhookEvents(record("certificate", "issued", 4), "draft"), ["suinda-learning.certificate.issued"]);
  assert.deepEqual(suindaDomainWebhookEvents(record("certificate", "revoked", 2), "issued"), ["suinda-learning.certificate.revoked"]);
  assert.deepEqual(suindaDomainWebhookEvents(record("certificate", "canceled", 2), "draft"), []);
});

test("pagamentos excluem créditos e isenções e emitem reembolso separado", () => {
  assert.deepEqual(suindaDomainWebhookEvents(record("payment_entry", "recorded", 1, { payment_method: "pix" })), ["suinda-learning.payment.recorded"]);
  assert.deepEqual(suindaDomainWebhookEvents(record("payment_entry", "recorded", 1, { payment_method: "refund" })), ["suinda-learning.payment.refunded"]);
  assert.deepEqual(suindaDomainWebhookEvents(record("payment_entry", "recorded", 1, { payment_method: "scholarship" })), []);
  assert.deepEqual(suindaDomainWebhookEvents(record("payment_entry", "recorded", 1, { payment_method: "waiver" })), []);
});

test("outros plugins não publicam eventos de domínio Suindá", () => {
  assert.deepEqual(suindaDomainWebhookEvents({ ...record("certificate", "issued"), plugin_id: "other-plugin" }), []);
});
