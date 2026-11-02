"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type PaymentReview = {
  checkout_id: string;
  enrollment_title: string;
  learner_name: string;
  amount: number;
  currency: string;
  provider_status: string | null;
  review_reason: string | null;
  provider_payment_id: string | null;
  created_at: string;
};
type PaymentReviewResponse = { items: PaymentReview[] };

const statusNames: Record<string, string> = {
  approved: "Aprovado pelo provedor",
  authorized: "Autorizado",
  pending: "Pendente",
  in_process: "Em processamento",
  rejected: "Recusado pelo provedor",
  cancelled: "Cancelado",
  refunded: "Estornado",
  charged_back: "Contestado",
};

const reviewReasons: Record<string, string> = {
  provider_refund: "O provedor informou uma devolução; falta reconciliar os lançamentos financeiros.",
  provider_chargeback: "O provedor informou uma contestação; o resultado financeiro precisa ser reconciliado.",
  approved_after_cancellation: "Pagamento aprovado depois do cancelamento da matrícula.",
  approved_overpayment: "O valor aprovado excede o saldo em aberto; a conciliação do excedente ainda está pendente.",
};

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(amount);
  } catch {
    return `${Number(amount).toLocaleString("pt-BR")} ${currency}`;
  }
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data indisponível" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function PaymentReviewQueue({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<PaymentReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [success, setSuccess] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setLoading(false);
        setError("Selecione um workspace para consultar pagamentos em revisão.");
      });
      return () => { cancelled = true; };
    }

    void Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true); setError(""); setItems([]); setNotes({}); setForbidden(false); setSubmitError(""); setSuccess("");
    });
    void api<PaymentReviewResponse>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/payment-reviews`)
      .then((result) => { if (!cancelled) setItems(Array.isArray(result.items) ? result.items : []); })
      .catch((cause: unknown) => {
        if (!cancelled && cause && typeof cause === "object" && "status" in cause && cause.status === 403) setForbidden(true);
        else if (!cancelled) setError("Não foi possível carregar os pagamentos em revisão. Tente novamente mais tarde.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, refreshVersion]);

  async function reconcile(event: FormEvent<HTMLFormElement>, item: PaymentReview) {
    event.preventDefault();
    const justification = notes[item.checkout_id] || "";
    if (item.provider_status !== "approved" || justification.trim().length < 10 || justification.length > 1000 || submittingId) return;
    setSubmittingId(item.checkout_id);
    setSubmitError("");
    setSuccess("");
    try {
      await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/payment-reviews/${encodeURIComponent(item.checkout_id)}/reconcile`, {
        method: "POST",
        body: JSON.stringify({ operation_key: crypto.randomUUID(), resolution: "record_payment", notes: justification.trim() }),
      });
      setSuccess(`Conciliação de “${item.enrollment_title}” registrada.`);
      setNotes((current) => ({ ...current, [item.checkout_id]: "" }));
      setRefreshVersion((version) => version + 1);
    } catch {
      setSubmitError("Não foi possível registrar a conciliação. Confira os dados e tente novamente.");
    } finally {
      setSubmittingId("");
    }
  }

  if (forbidden) return null;
  return (
    <section aria-labelledby="suinda-payment-review-title" className="rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-4 sm:p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Financeiro</p>
        <h2 id="suinda-payment-review-title" className="mt-1 text-base font-semibold text-white">Pagamentos em revisão</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">Confira cada pagamento no painel do Mercado Pago e reconcilie o resultado com os dados da matrícula antes de resolver a revisão.</p>
      </div>

      <div className="mt-4" aria-live="polite" aria-atomic="true">
        {loading ? <p role="status" className="text-sm text-[#9fadbc]">Carregando pagamentos…</p>
          : error ? <p role="alert" className="text-sm text-rose-200">{error}</p>
            : items.length === 0 ? <p className="rounded-xl border border-white/[0.08] bg-black/10 p-4 text-sm text-[#9fadbc]">Não há pagamentos aguardando revisão neste workspace.</p>
              : <ul className="grid gap-3">{items.map((item) => (
                <li key={item.checkout_id} className="rounded-xl border border-white/[0.08] bg-black/10 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-semibold text-[#dee4ea]">{item.enrollment_title}</h3>
                      <p className="mt-1 text-xs text-[#b6c2cf]">Aluno: {item.learner_name}</p>
                    </div>
                    <p className="text-sm font-semibold text-white">{money(item.amount, item.currency)}</p>
                  </div>
                  <dl className="mt-3 grid gap-x-5 gap-y-2 border-t border-white/[0.08] pt-3 text-xs sm:grid-cols-2">
                    <div className="sm:col-span-2"><dt className="text-[#9fadbc]">Motivo da revisão</dt><dd className="mt-0.5 text-[#c6d0da]">{item.review_reason ? reviewReasons[item.review_reason] || item.review_reason : "Conferência financeira pendente"}</dd></div>
                    <div><dt className="text-[#9fadbc]">Estado no Mercado Pago</dt><dd className="mt-0.5 text-[#c6d0da]">{item.provider_status ? statusNames[item.provider_status] || item.provider_status : "Sem estado informado"}</dd></div>
                    <div><dt className="text-[#9fadbc]">Identificador do pagamento</dt><dd className="mt-0.5 break-all font-mono text-[#c6d0da]">{item.provider_payment_id || "Ainda não informado"}</dd></div>
                    <div><dt className="text-[#9fadbc]">Recebido em</dt><dd className="mt-0.5 text-[#c6d0da]">{dateTime(item.created_at)}</dd></div>
                  </dl>
                  {item.provider_status === "approved" && item.review_reason === "approved_after_cancellation" && <form onSubmit={(event) => void reconcile(event, item)} className="mt-4 border-t border-white/[0.08] pt-3">
                    <label htmlFor={`payment-review-notes-${item.checkout_id}`} className="grid gap-1.5 text-xs font-medium text-[#b6c2cf]">
                      Justificativa da conciliação
                      <textarea
                        id={`payment-review-notes-${item.checkout_id}`}
                        value={notes[item.checkout_id] || ""}
                        onChange={(event) => setNotes((current) => ({ ...current, [item.checkout_id]: event.target.value }))}
                        minLength={10}
                        maxLength={1000}
                        required
                        disabled={Boolean(submittingId)}
                        aria-describedby={`payment-review-notes-help-${item.checkout_id}`}
                        className="min-h-24 w-full resize-y rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-sm text-[#dee4ea] placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50"
                        placeholder="Registre a conferência realizada no painel Mercado Pago"
                      />
                      <span id={`payment-review-notes-help-${item.checkout_id}`} className="font-normal leading-5 text-[#9fadbc]">Explique a conferência no painel Mercado Pago (10 a 1000 caracteres).</span>
                    </label>
                    <button type="submit" disabled={item.provider_status !== "approved" || item.review_reason !== "approved_after_cancellation" || Boolean(submittingId) || (notes[item.checkout_id] || "").trim().length < 10 || (notes[item.checkout_id] || "").length > 1000} className="mt-3 min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
                      {submittingId === item.checkout_id ? "Registrando conciliação…" : "Conciliar pagamento aprovado"}
                    </button>
                  </form>}
                </li>
              ))}</ul>}
      </div>
      <div className="mt-3" aria-live="polite" aria-atomic="true">
        {success && <p role="status" className="text-sm text-emerald-200">{success}</p>}
        {submitError && <p role="alert" className="text-sm text-rose-200">{submitError}</p>}
      </div>
    </section>
  );
}
