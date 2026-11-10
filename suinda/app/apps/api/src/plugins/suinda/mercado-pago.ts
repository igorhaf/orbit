import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpException } from "@nestjs/common";

const API = "https://api.mercadopago.com";
const MAX_RESPONSE_BYTES = 64 * 1024;

export function nextMercadoPagoCheckoutWorkflow(currentStatus: string, providerStatus: string) {
  const providerReason = providerStatus === "refunded" ? "provider_refund"
    : providerStatus === "charged_back" ? "provider_chargeback" : null;
  if (currentStatus === "review_required") return { status: "review_required", reviewReason: null };
  if (providerReason) return { status: "review_required", reviewReason: providerReason };
  if (providerStatus === "cancelled") return { status: "cancelled", reviewReason: null };
  if (providerStatus === "rejected") return { status: "rejected", reviewReason: null };
  return { status: "pending", reviewReason: null };
}

export function isMercadoPagoPaymentReconciliationAllowed(reviewReason: string | null, providerStatus: string | null) {
  return reviewReason === "approved_after_cancellation" && providerStatus === "approved";
}

export function mercadoPagoEventStatus(status: string, statusDetail: string | null) {
  return status === "approved" && statusDetail === "partially_refunded" ? "approved:partially_refunded" : status;
}

function publicHttpsUrl(value: string, label: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpException(`${label} inválida.`, 503); }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost"
    || !url.hostname.includes(".") || url.hostname.endsWith(".local") || url.hostname.endsWith(".test"))
    throw new HttpException(`${label} precisa usar um endereço HTTPS público.`, 503);
  return url.toString();
}

async function readJson(response: Response) {
  let text: string;
  try {
    text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("too large");
  } catch { throw new HttpException("Resposta inválida do provedor de pagamentos.", 502); }
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new HttpException("Resposta inválida do provedor de pagamentos.", 502); }
  if (!response.ok) throw new HttpException("O provedor de pagamentos não aceitou a operação.", 502);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpException("Resposta inválida do provedor de pagamentos.", 502);
  return body as Record<string, unknown>;
}

export async function createMercadoPagoPreference(input: {
  accessToken: string; idempotencyKey: string; externalReference: string; title: string;
  amount: number; currency: string; payerEmail: string; notificationUrl: string; returnUrl: string; createdAt: string;
}, fetcher: typeof fetch = fetch) {
  if (!input.accessToken || input.accessToken.length > 2048 || !/^[0-9a-f-]{36}$/i.test(input.idempotencyKey)
    || !/^[0-9a-f-]{36}$/i.test(input.externalReference) || !input.title.trim() || input.title.length > 256
    || !Number.isFinite(input.amount) || input.amount <= 0 || Math.round(input.amount * 100) !== input.amount * 100
    || input.currency.toUpperCase() !== "BRL" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.payerEmail))
    throw new HttpException("Dados da cobrança online inválidos.", 400);
  const notificationUrl = publicHttpsUrl(input.notificationUrl, "O endereço de notificação");
  const returnUrl = publicHttpsUrl(input.returnUrl, "O endereço de retorno");
  const createdAt = new Date(input.createdAt);
  if (Number.isNaN(createdAt.getTime())) throw new HttpException("Data de criação da cobrança inválida.", 400);
  const expiresAt = new Date(createdAt.getTime() + 4 * 24 * 60 * 60 * 1000);
  let response: Response;
  try {
    response = await fetcher(`${API}/checkout/preferences`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json", "X-Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ items: [{ id: input.externalReference, title: input.title.trim(), quantity: 1,
        currency_id: "BRL", unit_price: input.amount }], external_reference: input.externalReference,
        notification_url: notificationUrl, back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
        auto_return: "approved", payer: { email: input.payerEmail }, expires: true,
        expiration_date_from: createdAt.toISOString(), expiration_date_to: expiresAt.toISOString() }),
    });
  } catch { throw new HttpException("Não foi possível conectar ao provedor de pagamentos.", 502); }
  const body = await readJson(response);
  const preferenceId = typeof body.id === "string" ? body.id : "";
  const checkoutUrl = typeof body.init_point === "string" ? body.init_point : "";
  let parsed: URL | null = null;
  try { parsed = new URL(checkoutUrl); } catch { /* validated below */ }
  const host = parsed?.hostname.toLowerCase() || "";
  const trusted = host === "mercadopago.com.br" || host.endsWith(".mercadopago.com.br")
    || host === "mercadopago.com" || host.endsWith(".mercadopago.com");
  if (!preferenceId || !parsed || parsed.protocol !== "https:" || !trusted)
    throw new HttpException("O provedor retornou uma preferência inválida.", 502);
  return { preference_id: preferenceId, checkout_url: parsed.toString() };
}

export function verifyMercadoPagoWebhookSignature(input: {
  secret: string; signature: string | undefined; requestId: string | undefined; paymentId: string | undefined;
}) {
  if (!input.secret || input.secret.length > 4096 || !input.signature || !input.requestId || input.requestId.length > 200
    || !input.paymentId || !/^\d{1,30}$/.test(input.paymentId)) return false;
  const fields = new Map(input.signature.split(",").map((part) => {
    const separator = part.indexOf("=");
    return separator < 1 ? ["", ""] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  const timestamp = fields.get("ts") || "";
  const digest = fields.get("v1") || "";
  if (!/^\d{1,20}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(digest)) return false;
  const manifest = `id:${input.paymentId};request-id:${input.requestId};ts:${timestamp};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest();
  const actual = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function getMercadoPagoPayment(accessToken: string, paymentId: string, fetcher: typeof fetch = fetch) {
  if (!accessToken || accessToken.length > 2048 || !/^\d{1,30}$/.test(paymentId))
    throw new HttpException("Identificador de pagamento inválido.", 400);
  let response: Response;
  try {
    response = await fetcher(`${API}/v1/payments/${paymentId}`, { method: "GET", redirect: "error",
      signal: AbortSignal.timeout(12_000), headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  } catch { throw new HttpException("Não foi possível confirmar o pagamento no provedor.", 502); }
  const body = await readJson(response);
  if (String(body.id) !== paymentId || typeof body.status !== "string" || typeof body.external_reference !== "string"
    || typeof body.transaction_amount !== "number" || typeof body.currency_id !== "string")
    throw new HttpException("O provedor retornou um pagamento incompleto.", 502);
  return { id: paymentId, status: body.status, external_reference: body.external_reference,
    transaction_amount: body.transaction_amount, currency_id: body.currency_id,
    status_detail: typeof body.status_detail === "string" ? body.status_detail : null,
    preference_id: typeof body.preference_id === "string" ? body.preference_id : null,
    collector_id: typeof body.collector_id === "number" ? body.collector_id : null,
    payment_method_id: typeof body.payment_method_id === "string" ? body.payment_method_id : null,
    date_approved: typeof body.date_approved === "string" ? body.date_approved : null };
}
