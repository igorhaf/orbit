import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { createMercadoPagoPreference, getMercadoPagoPayment, isMercadoPagoPaymentReconciliationAllowed, mercadoPagoEventStatus, nextMercadoPagoCheckoutWorkflow, verifyMercadoPagoWebhookSignature } from "./mercado-pago";

const uuid = "6d986625-c82f-4db8-baf1-23f42b9ab81b";
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("Mercado Pago preference sends BRL amount, HTTPS URLs and an idempotency key", async () => {
  let request: RequestInit | undefined;
  const result = await createMercadoPagoPreference({ accessToken: "APP_USR-abcdefghijklmnop", idempotencyKey: uuid,
    externalReference: uuid, title: "Curso de teste", amount: 125.5, currency: "BRL", payerEmail: "aluno@example.org",
    notificationUrl: "https://api.example.org/public/webhook", returnUrl: "https://app.example.org/suinda", createdAt: "2026-10-24T10:00:00.000Z" },
  async (_input, init) => { request = init; return response({ id: "pref-1", init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1" }); });
  assert.equal(result.preference_id, "pref-1");
  assert.equal(request?.method, "POST");
  assert.equal(new Headers(request?.headers).get("X-Idempotency-Key"), uuid);
  assert.equal(new Headers(request?.headers).get("Authorization"), "Bearer APP_USR-abcdefghijklmnop");
  const body = JSON.parse(String(request?.body));
  assert.equal(body.items[0].unit_price, 125.5);
  assert.equal(body.items[0].currency_id, "BRL");
  assert.equal(body.external_reference, uuid);
  assert.equal(body.notification_url, "https://api.example.org/public/webhook");
});

test("Mercado Pago preference rejects non-HTTPS callbacks before network access", async () => {
  let called = false;
  await assert.rejects(() => createMercadoPagoPreference({ accessToken: "APP_USR-abcdefghijklmnop", idempotencyKey: uuid,
    externalReference: uuid, title: "Curso", amount: 10, currency: "BRL", payerEmail: "aluno@example.org",
    notificationUrl: "http://api.example.org/webhook", returnUrl: "https://app.example.org/suinda", createdAt: "2026-10-24T10:00:00.000Z" },
  async () => { called = true; return response({}); }), (error) => error instanceof HttpException && error.getStatus() === 503);
  assert.equal(called, false);
});

test("Mercado Pago webhook signature authenticates the provider manifest", () => {
  const secret = "webhook-secret-for-testing";
  const paymentId = "987654321";
  const requestId = "request-123";
  const timestamp = "1730000000";
  const manifest = `id:${paymentId};request-id:${requestId};ts:${timestamp};`;
  const digest = createHmac("sha256", secret).update(manifest).digest("hex");
  const input = { secret, requestId, paymentId, signature: `ts=${timestamp},v1=${digest}` };
  assert.equal(verifyMercadoPagoWebhookSignature(input), true);
  assert.equal(verifyMercadoPagoWebhookSignature({ ...input, paymentId: "987654322" }), false);
  assert.equal(verifyMercadoPagoWebhookSignature({ ...input, signature: `ts=${timestamp},v1=${"0".repeat(64)}` }), false);
});

test("Mercado Pago payment lookup trusts only validated provider response fields", async () => {
  const result = await getMercadoPagoPayment("APP_USR-abcdefghijklmnop", "123456", async (url, init) => {
    assert.equal(String(url), "https://api.mercadopago.com/v1/payments/123456");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer APP_USR-abcdefghijklmnop");
    return response({ id: 123456, status: "approved", external_reference: uuid, transaction_amount: 125.5,
      currency_id: "BRL", status_detail: "accredited", preference_id: "pref-1", payment_method_id: "pix", date_approved: "2026-10-24T10:00:00Z" });
  });
  assert.deepEqual(result, { id: "123456", status: "approved", external_reference: uuid, transaction_amount: 125.5,
    currency_id: "BRL", status_detail: "accredited", preference_id: "pref-1", collector_id: null, payment_method_id: "pix", date_approved: "2026-10-24T10:00:00Z" });
  await assert.rejects(() => getMercadoPagoPayment("token", "123456", async () => response({ id: 12, status: "approved" })),
    (error) => error instanceof HttpException && error.getStatus() === 502);
});

test("provider events never close an open manual payment review", () => {
  assert.deepEqual(nextMercadoPagoCheckoutWorkflow("review_required", "pending"), { status: "review_required", reviewReason: null });
  assert.deepEqual(nextMercadoPagoCheckoutWorkflow("review_required", "cancelled"), { status: "review_required", reviewReason: null });
  assert.deepEqual(nextMercadoPagoCheckoutWorkflow("pending", "refunded"), { status: "review_required", reviewReason: "provider_refund" });
  assert.deepEqual(nextMercadoPagoCheckoutWorkflow("pending", "charged_back"), { status: "review_required", reviewReason: "provider_chargeback" });
  assert.deepEqual(nextMercadoPagoCheckoutWorkflow("pending", "rejected"), { status: "rejected", reviewReason: null });
});

test("only verified approval after enrollment cancellation can use the receipt reconciliation action", () => {
  assert.equal(isMercadoPagoPaymentReconciliationAllowed("approved_after_cancellation", "approved"), true);
  assert.equal(isMercadoPagoPaymentReconciliationAllowed("approved_overpayment", "approved"), false);
  assert.equal(isMercadoPagoPaymentReconciliationAllowed("provider_refund", "approved"), false);
  assert.equal(isMercadoPagoPaymentReconciliationAllowed("provider_chargeback", "approved"), false);
  assert.equal(isMercadoPagoPaymentReconciliationAllowed("approved_after_cancellation", "pending"), false);
});

test("partial refunds with an approved payment have a separate webhook event identity", () => {
  assert.equal(mercadoPagoEventStatus("approved", "accredited"), "approved");
  assert.equal(mercadoPagoEventStatus("approved", "partially_refunded"), "approved:partially_refunded");
  assert.equal(mercadoPagoEventStatus("refunded", null), "refunded");
});
