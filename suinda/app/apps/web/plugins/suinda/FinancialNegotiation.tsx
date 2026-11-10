"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, send } from "@/lib/api";

type Terms = { requested_total_amount: number; currency: string; installment_count: number; first_due_on: string; interval_days: number; current_balance_snapshot: number };
type Case = { id: string; workspace_id: string; enrollment_id: string; request_type: "negotiation" | "renegotiation"; status: string;
  latest_terms: Terms; revision: number; learner_name?: string; events?: Array<{ sequence: number; event_type: string; notes: string | null; created_at: string }> };
type CasePage = { items: Case[]; total: number; has_more: boolean; next_cursor: string | null; limit: number };
const textInput = "min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white";
const statusName: Record<string, string> = { pending_institution: "Aguardando instituição", pending_student: "Aguardando aluno", agreed_draft: "Acordo em rascunho", agreed_formalized: "Cronograma formalizado", declined: "Recusada", withdrawn: "Retirada" };

function dateAfter(days: number) { const date = new Date(Date.now() + days * 86_400_000); return date.toISOString().slice(0, 10); }
function termsText(terms: Terms) { return `${terms.requested_total_amount.toFixed(2)} ${terms.currency} · ${terms.installment_count} parcela(s) · primeira em ${terms.first_due_on} · intervalo ${terms.interval_days} dias`; }

export function FinancialNegotiationForEnrollment({ enrollmentId }: { enrollmentId: string }) {
  const [items, setItems] = useState<Case[]>([]);
  const [requestType, setRequestType] = useState<"negotiation" | "renegotiation">("negotiation");
  const [amount, setAmount] = useState("");
  const [installments, setInstallments] = useState(1);
  const [firstDue, setFirstDue] = useState(dateAfter(7));
  const [interval, setInterval] = useState(30);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (cursor?: string, append = false) => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=50` : "?limit=50";
    try {
      const page = await api<CasePage>(`/extensions/suinda-financial-negotiation/me/enrollments/${encodeURIComponent(enrollmentId)}/cases${query}`);
      setItems((current) => append ? [...current, ...page.items.filter((row) => !current.some((item) => item.id === row.id))] : page.items);
      setNextCursor(page.next_cursor); setTotal(page.total);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar as propostas financeiras."); }
  }, [enrollmentId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await send(`/extensions/suinda-financial-negotiation/me/enrollments/${encodeURIComponent(enrollmentId)}/cases`, "POST", {
        operation_key: crypto.randomUUID(), request_type: requestType, requested_total_amount: Number(amount),
        installment_count: installments, first_due_on: firstDue, interval_days: interval, notes,
      });
      setAmount(""); setNotes(""); setMessage("Proposta registrada para análise da instituição."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar a proposta."); }
    finally { setBusy(false); }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try { await load(nextCursor, true); } finally { setLoadingMore(false); }
  }

  async function respond(item: Case, action: "accept_draft" | "decline" | "withdraw") {
    setBusy(true); setError(""); setMessage("");
    try {
      await send(`/extensions/suinda-financial-negotiation/me/cases/${encodeURIComponent(item.id)}/respond`, "POST", {
        operation_key: crypto.randomUUID(), expected_revision: item.revision, action,
      });
      setMessage(action === "accept_draft" ? "Aceite bilateral registrado; o novo cronograma já está vigente." : "Resposta registrada."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível responder à proposta."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="financial-negotiation-student-title" className="mt-4 space-y-4 rounded-2xl border border-violet-200/15 bg-[#2c333a] p-4 sm:p-5">
    <div><h3 id="financial-negotiation-student-title" className="font-semibold text-white">Negociação financeira</h3><p className="mt-1 text-xs leading-5 text-[#9fadbc]">A proposta só entra em vigor após a aprovação da instituição e seu aceite. O aceite cria uma nova revisão imutável do cronograma; os pagamentos já registrados permanecem preservados.</p></div>
    <form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs text-[#9fadbc]">Solicitação<select value={requestType} onChange={(event) => setRequestType(event.target.value as typeof requestType)} className={textInput}><option value="negotiation">Negociação financeira</option><option value="renegotiation">Renegociação de parcelas</option></select></label>
      <label className="grid gap-1 text-xs text-[#9fadbc]">Valor total proposto<input required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className={textInput}/></label>
      <label className="grid gap-1 text-xs text-[#9fadbc]">Parcelas<input required type="number" min="1" max="24" value={installments} onChange={(event) => setInstallments(Number(event.target.value))} className={textInput}/></label>
      <label className="grid gap-1 text-xs text-[#9fadbc]">Primeiro vencimento<input required type="date" value={firstDue} onChange={(event) => setFirstDue(event.target.value)} className={textInput}/></label>
      <label className="grid gap-1 text-xs text-[#9fadbc]">Intervalo entre parcelas (dias)<input required type="number" min="1" max="365" value={interval} onChange={(event) => setInterval(Number(event.target.value))} className={textInput}/></label>
      <label className="grid gap-1 text-xs text-[#9fadbc] sm:col-span-2">Justificativa (opcional)<textarea maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} className={`${textInput} py-2`}/></label>
      <button disabled={busy} className="min-h-10 rounded-lg border border-violet-200/20 bg-violet-200/10 px-4 text-sm font-medium text-violet-100 disabled:opacity-50 sm:col-span-2">{busy ? "Enviando…" : "Enviar proposta"}</button>
    </form>
    {items.length > 0 && <p className="text-xs text-[#9fadbc]">Exibindo {items.length} de {total} proposta(s).</p>}
    {items.map((item) => <article key={item.id} className="rounded-xl border border-white/10 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong className="text-white">{item.request_type === "renegotiation" ? "Renegociação" : "Negociação"}</strong><span className="text-xs text-cyan-100">{statusName[item.status] || item.status}</span></div><p className="mt-1 text-xs text-[#b6c2cf]">{termsText(item.latest_terms)}</p>
      {item.status === "pending_student" && <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void respond(item, "accept_draft")} className="min-h-9 rounded-lg bg-emerald-200/10 px-3 text-xs text-emerald-100">Aceitar rascunho</button><button type="button" disabled={busy} onClick={() => void respond(item, "decline")} className="min-h-9 rounded-lg border border-white/10 px-3 text-xs text-[#c6d0da]">Recusar</button></div>}
      {item.status === "pending_institution" && <button type="button" disabled={busy} onClick={() => void respond(item, "withdraw")} className="mt-3 min-h-9 rounded-lg border border-white/10 px-3 text-xs text-[#c6d0da]">Retirar proposta</button>}
      {item.status === "agreed_draft" && <p className="mt-2 text-xs text-amber-100">Proposta antiga acordada como rascunho. Peça à instituição que envie uma nova proposta para formalizar o cronograma.</p>}
      {item.status === "agreed_formalized" && <p className="mt-2 text-xs text-emerald-100">Cronograma versionado formalizado e vigente desde o aceite bilateral. Os lançamentos de pagamento não foram alterados.</p>}</article>)}
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}{message && <p role="status" className="text-xs text-emerald-200">{message}</p>}
    {nextCursor && <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="min-h-9 rounded-lg border border-white/10 px-3 text-xs text-[#c6d0da] disabled:opacity-50">{loadingMore ? "Carregando…" : "Carregar mais propostas"}</button>}
  </section>;
}

export function FinancialNegotiationManagement({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<Case[]>([]);
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [installments, setInstallments] = useState(1);
  const [firstDue, setFirstDue] = useState(dateAfter(7));
  const [interval, setInterval] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(async (cursor?: string, append = false) => {
    if (!workspaceId) return;
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=50` : "?limit=50";
    try {
      const page = await api<CasePage>(`/extensions/suinda-financial-negotiation/workspaces/${encodeURIComponent(workspaceId)}/cases${query}`);
      setItems((current) => append ? [...current, ...page.items.filter((row) => !current.some((item) => item.id === row.id))] : page.items);
      setNextCursor(page.next_cursor); setTotal(page.total);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a fila financeira."); }
  }, [workspaceId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function respond(item: Case, action: "approve_draft" | "counteroffer" | "decline") {
    setBusy(true); setError(""); setMessage("");
    try {
      await send(`/extensions/suinda-financial-negotiation/workspaces/${encodeURIComponent(workspaceId)}/cases/${encodeURIComponent(item.id)}/respond`, "POST", {
        operation_key: crypto.randomUUID(), expected_revision: item.revision, action,
        ...(action === "counteroffer" ? { requested_total_amount: Number(amount), installment_count: installments, first_due_on: firstDue, interval_days: interval } : {}),
      });
      setSelected(""); setMessage(action === "counteroffer" ? "Contraproposta registrada para aceite do aluno." : "Decisão institucional registrada."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível responder."); }
    finally { setBusy(false); }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try { await load(nextCursor, true); } finally { setLoadingMore(false); }
  }

  const item = items.find((candidate) => candidate.id === selected);
  return <section aria-labelledby="financial-negotiation-management-title" className="mt-4 space-y-3 rounded-2xl border border-violet-200/15 bg-[#2c333a] p-4 sm:p-5">
    <div><h3 id="financial-negotiation-management-title" className="font-semibold text-white">Propostas financeiras</h3><p className="mt-1 text-xs leading-5 text-[#9fadbc]">A aprovação institucional solicita o aceite do aluno. O cronograma só recebe uma nova revisão quando o aluno aceita; o ledger de pagamentos permanece intacto.</p></div>
    <p className="text-xs text-[#9fadbc]">Exibindo {items.length} de {total} proposta(s).</p>
    {items.length === 0 && <p className="text-sm text-[#9fadbc]">Nenhuma proposta neste workspace.</p>}
    {items.map((candidate) => <article key={candidate.id} className="rounded-xl border border-white/10 p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm text-white">{candidate.learner_name || "Aluno"} · {candidate.request_type === "renegotiation" ? "Renegociação" : "Negociação"}</strong><span className="text-xs text-cyan-100">{statusName[candidate.status] || candidate.status}</span></div><p className="mt-1 text-xs text-[#b6c2cf]">Matrícula {candidate.enrollment_id} · {termsText(candidate.latest_terms)}</p>
      {candidate.status === "pending_institution" && <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void respond(candidate, "approve_draft")} className="min-h-9 rounded-lg bg-emerald-200/10 px-3 text-xs text-emerald-100">Aceitar termos (aguardar aluno)</button><button type="button" disabled={busy} onClick={() => {setSelected(candidate.id);setAmount(String(candidate.latest_terms.requested_total_amount));setInstallments(candidate.latest_terms.installment_count);setFirstDue(candidate.latest_terms.first_due_on);setInterval(candidate.latest_terms.interval_days);}} className="min-h-9 rounded-lg border border-cyan-200/20 px-3 text-xs text-cyan-100">Contrapropor</button><button type="button" disabled={busy} onClick={() => void respond(candidate, "decline")} className="min-h-9 rounded-lg border border-white/10 px-3 text-xs text-[#c6d0da]">Recusar</button></div>}
      {candidate.status === "agreed_draft" && <p className="mt-2 text-xs text-amber-100">Proposta antiga acordada como rascunho, sem cronograma formalizado.</p>}
      {candidate.status === "agreed_formalized" && <p className="mt-2 text-xs text-emerald-100">Cronograma versionado formalizado. Pagamentos permanecem nos registros originais.</p>}
    </article>)}
    {item && <form onSubmit={(event) => {event.preventDefault();void respond(item,"counteroffer");}} className="grid gap-3 rounded-xl border border-cyan-200/15 p-3 sm:grid-cols-2"><h4 className="font-medium text-white sm:col-span-2">Contraproposta · {item.learner_name || "Aluno"}</h4><label className="grid gap-1 text-xs text-[#9fadbc]">Valor total<input required type="number" min="0.01" step="0.01" value={amount} onChange={(event)=>setAmount(event.target.value)} className={textInput}/></label><label className="grid gap-1 text-xs text-[#9fadbc]">Parcelas<input required type="number" min="1" max="24" value={installments} onChange={(event)=>setInstallments(Number(event.target.value))} className={textInput}/></label><label className="grid gap-1 text-xs text-[#9fadbc]">Primeiro vencimento<input required type="date" value={firstDue} onChange={(event)=>setFirstDue(event.target.value)} className={textInput}/></label><label className="grid gap-1 text-xs text-[#9fadbc]">Intervalo (dias)<input required type="number" min="1" max="365" value={interval} onChange={(event)=>setInterval(Number(event.target.value))} className={textInput}/></label><button disabled={busy} className="min-h-10 rounded-lg border border-cyan-200/20 px-3 text-sm text-cyan-100 sm:col-span-2">Enviar contraproposta</button></form>}
    {nextCursor && <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="min-h-9 rounded-lg border border-white/10 px-3 text-xs text-[#c6d0da] disabled:opacity-50">{loadingMore ? "Carregando…" : "Carregar mais propostas"}</button>}
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}{message && <p role="status" className="text-xs text-emerald-200">{message}</p>}
  </section>;
}
