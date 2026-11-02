"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Workspace = { id: string; name: string };
type Affiliate = { id: string; title: string; payload: { display_name: string }; state: string };
type Coupon = { id: string; title: string; code: string; discount_context: string; partner_name: string | null };
type Association = { id: string; affiliate_title: string; coupon_code: string; payload: { commission_rate_bps: number; effective_from: string }; state: string };
type Commission = { id: string; title: string; payload: { commission_type: string; currency: string; amount: number; source_amount: number; payment_recorded_at: string }; created_at: string };
type CommissionPage = { items: Commission[]; next_cursor: string | null };
type Reconciliation = { created_entries: number; balances: Array<{ affiliate_record_id: string; currency: string; balance: string }>; transfers_executed: false };

const panel = "rounded-2xl border border-white/10 bg-[#2c333a] p-4 sm:p-5";
const input = "min-h-10 rounded-lg border border-[#46515c] bg-[#1d2125] px-3 text-sm text-white placeholder:text-[#9fadbc] focus:border-cyan-300 focus:outline-none disabled:opacity-50";
const operationKey = () => crypto.randomUUID();

export default function SuindaAffiliates() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [associations, setAssociations] = useState<Association[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [commissionCursor, setCommissionCursor] = useState<string | null>(null);
  const [loadingCommissions, setLoadingCommissions] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [affiliateId, setAffiliateId] = useState("");
  const [couponId, setCouponId] = useState("");
  const [ratePercent, setRatePercent] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);

  useEffect(() => {
    let active = true;
    void api<Workspace[]>("/workspaces").then((items) => {
      if (!active) return;
      setWorkspaces(items); setWorkspaceId(items[0]?.id || "");
      if (!items.length) setError("Nenhum workspace autorizado está disponível.");
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar workspaces."));
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setError("");
    const base = `/extensions/suinda-affiliates/workspaces/${encodeURIComponent(workspaceId)}`;
    const [affiliateRows, couponRows, associationRows, commissionPage] = await Promise.all([
      api<Affiliate[]>(`${base}/affiliates`), api<Coupon[]>(`${base}/coupons`),
      api<Association[]>(`${base}/associations`), api<CommissionPage>(`${base}/commissions`),
    ]);
    setAffiliates(affiliateRows); setCoupons(couponRows); setAssociations(associationRows); setCommissions(commissionPage.items); setCommissionCursor(commissionPage.next_cursor);
    setAffiliateId((current) => affiliateRows.some((item) => item.id === current) ? current : affiliateRows[0]?.id || "");
    setCouponId((current) => couponRows.some((item) => item.id === current) ? current : couponRows[0]?.id || "");
  }, [workspaceId]);

  async function loadMoreCommissions() {
    if (!workspaceId || !commissionCursor || loadingCommissions) return;
    setLoadingCommissions(true); setError("");
    try {
      const base = `/extensions/suinda-affiliates/workspaces/${encodeURIComponent(workspaceId)}/commissions`;
      const page = await api<CommissionPage>(`${base}?cursor=${encodeURIComponent(commissionCursor)}`);
      setCommissions((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCommissionCursor(page.next_cursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar mais lançamentos."); }
    finally { setLoadingCommissions(false); }
  }
  useEffect(() => { void Promise.resolve().then(() => refresh()).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar afiliados.")); }, [refresh]);

  async function createAffiliate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspaceId || !name.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-affiliates/workspaces/${encodeURIComponent(workspaceId)}/affiliates`, {
        method: "POST", body: JSON.stringify({ display_name: name.trim(), contact_reference: contact.trim() || null }),
      });
      setName(""); setContact(""); setMessage("Afiliado cadastrado neste workspace."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível cadastrar o afiliado."); }
    finally { setBusy(false); }
  }

  async function associate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspaceId || !affiliateId || !couponId) return;
    const percent = Number(ratePercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100 || Math.round(percent * 100) !== percent * 100) { setError("Informe uma taxa entre 0% e 100%, com até duas casas decimais."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-affiliates/workspaces/${encodeURIComponent(workspaceId)}/associations`, {
        method: "POST", body: JSON.stringify({ affiliate_record_id: affiliateId, coupon_record_id: couponId, commission_rate_bps: Math.round(percent * 100) }),
      });
      setMessage("Cupom associado. Esta taxa passa a valer para pagamentos registrados a partir de agora."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível associar o cupom."); }
    finally { setBusy(false); }
  }

  async function reconcile() {
    if (!workspaceId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<Reconciliation>(`/extensions/suinda-affiliates/workspaces/${encodeURIComponent(workspaceId)}/commissions/reconcile`, { method: "POST", body: JSON.stringify({ operation_key: operationKey() }) });
      setReconciliation(result); setMessage(`${result.created_entries} lançamento(s) novo(s) apurado(s). Nenhum repasse foi executado.`); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível apurar as comissões."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 text-[#e8edf2] sm:px-6 lg:px-8">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Suindá · parcerias</p>
      <h1 className="text-2xl font-semibold text-white sm:text-3xl">Afiliados e comissões</h1>
      <p className="max-w-3xl text-sm leading-6 text-[#aeb9c4]">Associe cupons publicados a afiliados, defina uma taxa por período e apure comissões sobre recebimentos registrados. Reembolsos geram ajustes proporcionais. Os repasses são processados fora do sistema.</p>
    </header>
    {workspaces.length > 1 && <label className="grid max-w-xl gap-1 text-xs text-[#aeb9bc]">Workspace
      <select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setReconciliation(null); }} className={input}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    </label>}
    {(error || message) && <p role={error ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${error ? "border-rose-300/20 bg-rose-300/5 text-rose-100" : "border-cyan-300/20 bg-cyan-300/5 text-cyan-100"}`}>{error || message}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={panel} aria-labelledby="suinda-affiliate-create"><h2 id="suinda-affiliate-create" className="text-lg font-semibold text-white">Cadastrar afiliado</h2>
        <form onSubmit={(event) => void createAffiliate(event)} className="mt-4 grid gap-3">
          <label className="grid gap-1 text-xs text-[#b6c2cf]">Nome do parceiro<input required maxLength={180} value={name} onChange={(event) => setName(event.target.value)} className={input} /></label>
          <label className="grid gap-1 text-xs text-[#b6c2cf]">Referência de contato opcional<input maxLength={180} value={contact} onChange={(event) => setContact(event.target.value)} className={input} /></label>
          <button disabled={busy || !workspaceId} className="min-h-10 justify-self-start rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">{busy ? "Salvando…" : "Cadastrar afiliado"}</button>
        </form>
      </section>
      <section className={panel} aria-labelledby="suinda-affiliate-associate"><h2 id="suinda-affiliate-associate" className="text-lg font-semibold text-white">Associar cupom e comissão</h2>
        <form onSubmit={(event) => void associate(event)} className="mt-4 grid gap-3">
          <label className="grid gap-1 text-xs text-[#b6c2cf]">Afiliado<select required value={affiliateId} onChange={(event) => setAffiliateId(event.target.value)} className={input}><option value="">Selecione</option>{affiliates.map((item) => <option key={item.id} value={item.id}>{item.payload.display_name || item.title}</option>)}</select></label>
          <label className="grid gap-1 text-xs text-[#b6c2cf]">Cupom publicado<select required value={couponId} onChange={(event) => setCouponId(event.target.value)} className={input}><option value="">Selecione</option>{coupons.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}</select></label>
          <label className="grid max-w-56 gap-1 text-xs text-[#b6c2cf]">Comissão (%)<input required type="number" min="0" max="100" step="0.01" value={ratePercent} onChange={(event) => setRatePercent(event.target.value)} className={input} /></label>
          <button disabled={busy || !affiliateId || !couponId} className="min-h-10 justify-self-start rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">{busy ? "Salvando…" : "Associar cupom"}</button>
        </form>
      </section>
    </div>
    <section className={panel} aria-labelledby="suinda-affiliate-links"><h2 id="suinda-affiliate-links" className="text-lg font-semibold text-white">Associações vigentes e históricas</h2>
      <div role="region" aria-label="Associações entre afiliados, cupons e comissões" tabIndex={0} className="mt-3 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs uppercase tracking-wide text-[#9fadbc]"><tr><th className="py-2 pr-4">Afiliado</th><th className="py-2 pr-4">Cupom</th><th className="py-2 pr-4">Taxa</th><th className="py-2 pr-4">Início da vigência</th></tr></thead><tbody>{associations.map((item) => <tr key={item.id} className="border-t border-white/10"><td className="py-3 pr-4">{item.affiliate_title}</td><td className="py-3 pr-4">{item.coupon_code}</td><td className="py-3 pr-4">{(item.payload.commission_rate_bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</td><td className="py-3 pr-4">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.payload.effective_from))}</td></tr>)}</tbody></table>{!associations.length && <p className="py-4 text-sm text-[#9fadbc]">Nenhuma associação cadastrada neste workspace.</p>}</div>
    </section>
    <section className={panel} aria-labelledby="suinda-commission-report"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="suinda-commission-report" className="text-lg font-semibold text-white">Apuração de comissões</h2><p className="mt-1 text-xs text-[#9fadbc]">Somente pagamentos registrados. Estornos reduzem o saldo; recebimentos continuam no ledger financeiro existente.</p></div><button type="button" disabled={busy || !workspaceId} onClick={() => void reconcile()} className="min-h-10 rounded-lg border border-cyan-200/25 bg-cyan-200/10 px-4 text-sm font-medium text-cyan-100 hover:bg-cyan-200/15 disabled:opacity-50">{busy ? "Apurando…" : "Conciliar pagamentos"}</button></div>
      {reconciliation && <ul className="mt-4 flex flex-wrap gap-3 text-xs text-[#b6c2cf]">{reconciliation.balances.map((item) => <li key={`${item.affiliate_record_id}:${item.currency}`} className="rounded-lg border border-white/10 px-3 py-2">Saldo por afiliado ({item.currency}): {new Intl.NumberFormat("pt-BR", { style: "currency", currency: item.currency }).format(Number(item.balance))}</li>)}</ul>}
      <div role="region" aria-label="Lançamentos e apuração das comissões" tabIndex={0} className="mt-4 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs uppercase tracking-wide text-[#9fadbc]"><tr><th className="py-2 pr-4">Lançamento</th><th className="py-2 pr-4">Tipo</th><th className="py-2 pr-4">Valor da comissão</th><th className="py-2 pr-4">Base</th><th className="py-2 pr-4">Registrado</th></tr></thead><tbody>{commissions.map((item) => <tr key={item.id} className="border-t border-white/10"><td className="py-3 pr-4">{item.title}</td><td className="py-3 pr-4">{item.payload.commission_type === "refund_adjustment" ? "Estorno proporcional" : "Comissão apurada"}</td><td className="py-3 pr-4">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: item.payload.currency }).format(Number(item.payload.amount))}</td><td className="py-3 pr-4">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: item.payload.currency }).format(Number(item.payload.source_amount))}</td><td className="py-3 pr-4">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(item.created_at))}</td></tr>)}</tbody></table>{!commissions.length && <p className="py-4 text-sm text-[#9fadbc]">Nenhuma comissão foi apurada.</p>}</div>
      {commissionCursor && <button type="button" onClick={() => void loadMoreCommissions()} disabled={loadingCommissions || busy} className="mt-3 min-h-10 rounded-lg border border-white/15 px-4 text-sm text-[#d8e1e9] hover:bg-white/5 disabled:opacity-50">{loadingCommissions ? "Carregando…" : "Carregar mais lançamentos"}</button>}
    </section>
  </main>;
}
