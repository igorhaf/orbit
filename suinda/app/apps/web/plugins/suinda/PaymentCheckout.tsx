"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type CheckoutStatus = "not_started" | "creating" | "pending" | "approved" | "rejected" | "cancelled" | "review_required" | "failed";
type Checkout = {
  status: CheckoutStatus;
  amount?: number | null;
  currency?: string | null;
  checkout_url?: string | null;
};
type CheckoutCreated = { checkout_id: string; status: CheckoutStatus; checkout_url: string | null };

const statusCopy: Record<CheckoutStatus, string> = {
  not_started: "Pagamento ainda não iniciado",
  creating: "Preparando o pagamento…",
  pending: "Pagamento aguardando confirmação",
  approved: "Pagamento aprovado",
  rejected: "Pagamento não aprovado",
  cancelled: "Pagamento cancelado",
  review_required: "Pagamento em análise pela instituição",
  failed: "Não foi possível concluir o pagamento",
};

function formatAmount(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount == null || !Number.isFinite(amount)) return null;
  const code = currency || "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(amount);
  } catch {
    return `${amount.toLocaleString("pt-BR")} ${code}`;
  }
}

function isMercadoPagoCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "mercadopago.com.br" || url.hostname.endsWith(".mercadopago.com.br")
      || url.hostname === "mercadopago.com" || url.hostname.endsWith(".mercadopago.com"));
  } catch {
    return false;
  }
}

export function PaymentCheckout({ enrollmentId, amount, currency }: { enrollmentId: string; amount: number; currency: string }) {
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let receivedFirst = false;
    const startedAt = Date.now();
    if (!enrollmentId) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setError("Não foi possível identificar a matrícula para consultar o pagamento.");
        setLoading(false);
      });
      return () => { cancelled = true; };
    }

    const path = `/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/checkout`;
    const refresh = async () => {
      try {
        const result = await api<Checkout>(path);
        if (cancelled) return;
        receivedFirst = true;
        setCheckout(result);
        setError("");
        if (["approved", "rejected", "cancelled", "review_required", "failed"].includes(result.status)
          || Date.now() - startedAt >= 180_000) {
          clearInterval(timer);
        }
      } catch {
        if (!cancelled && !receivedFirst) setError("Não foi possível carregar o estado do pagamento. Tente novamente mais tarde.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [enrollmentId]);

  async function startCheckout() {
    if (posting || !enrollmentId) return;
    setPosting(true);
    setError("");
    if (checkout?.checkout_url && isMercadoPagoCheckoutUrl(checkout.checkout_url)) {
      window.location.assign(checkout.checkout_url);
      setPosting(false);
      return;
    }
    const path = `/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/checkout`;
    try {
      const result = await api<CheckoutCreated>(path, {
        method: "POST",
        body: JSON.stringify({ operation_key: crypto.randomUUID() }),
      });
      if (!result.checkout_url || !isMercadoPagoCheckoutUrl(result.checkout_url)) {
        setCheckout((current) => ({ ...current, status: result.status }));
        setError("O pagamento foi iniciado, mas o endereço seguro do Mercado Pago não está disponível. Atualize o estado ou tente novamente.");
        return;
      }
      window.location.assign(result.checkout_url);
    } catch {
      setError("Não foi possível iniciar o pagamento. Tente novamente ou contate a instituição.");
    } finally {
      setPosting(false);
    }
  }

  const currentStatus = checkout?.status;
  const unavailable = loading || posting || !enrollmentId || !currentStatus
    || ["creating", "approved", "review_required"].includes(currentStatus);
  const shownAmount = formatAmount(checkout?.amount ?? amount, checkout?.currency ?? currency);

  return (
    <section aria-labelledby="suinda-payment-checkout-title" className="rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Inscrição</p>
      <h2 id="suinda-payment-checkout-title" className="mt-1 text-base font-semibold text-white">Pagamento do curso</h2>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/10 p-3">
        <div>
          <p className="text-xs text-[#9fadbc]">Valor</p>
          <p className="mt-0.5 text-lg font-semibold text-[#dee4ea]">{shownAmount || "Valor indisponível"}</p>
        </div>
        <p className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-[#c6d0da]" aria-live="polite" aria-atomic="true">
          {loading ? "Consultando pagamento…" : currentStatus ? statusCopy[currentStatus] : "Estado do pagamento indisponível"}
        </p>
      </div>

      <p className="mt-3 text-xs leading-5 text-[#9fadbc]">Você será direcionado ao Mercado Pago para concluir o pagamento. A confirmação será atualizada após o retorno seguro da instituição financeira.</p>
      {error && <p role="alert" aria-live="assertive" className="mt-3 text-sm text-rose-200">{error}</p>}

      {currentStatus !== "approved" && currentStatus !== "review_required" && <button
        type="button"
        onClick={() => void startCheckout()}
        disabled={unavailable}
        className="mt-4 min-h-11 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {posting ? "Preparando pagamento…" : "Pagar com Mercado Pago"}
      </button>}
    </section>
  );
}
