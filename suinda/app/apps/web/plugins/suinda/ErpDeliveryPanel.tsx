"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type Unit = { unit_record_id: string; unit_name: string };
type ErpConfig = { configured: boolean; endpoint: string | null; active: boolean };
type Batch = {
  id: string; from: string; to: string; unit_record_id: string | null; entry_count: number; payload_sha256: string;
  status: "pending" | "sending" | "delivered" | "failed"; attempt_count: number; remote_status: number | null;
  created_at: string; last_attempt_at: string | null;
};
type BatchList = { batches: Batch[] };
type BatchPage = BatchList & { total: number; has_more: boolean; next_cursor: string | null; limit: number };
type BatchDelivery = { batch: Batch; delivery: "delivered" | "failed"; message?: string };

const field = "min-h-10 w-full rounded-lg border border-[#46515c] bg-[#1d2125] px-3 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50";
const button = "inline-flex min-h-10 items-center justify-center rounded-lg border border-white/15 px-4 text-sm font-medium text-[#e8edf2] hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50";
const panel = "rounded-2xl border border-white/10 bg-[#2c333a] p-4 sm:p-5";
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;
const pathFor = (workspaceId: string) => `/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/erp`;
const localDate = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

/** Workspace-scoped, manual ERP delivery for minimized accounting journal batches. */
export function ErpDeliveryPanel({ workspaceId, units }: { workspaceId: string; units: Unit[] }) {
  const [config, setConfig] = useState<ErpConfig | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [active, setActive] = useState(true);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [batchTotal, setBatchTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [unitId, setUnitId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!workspaceId) { setConfig(null); setBatches([]); setNextCursor(null); setBatchTotal(0); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const base = pathFor(workspaceId);
      const [nextConfig, nextBatches] = await Promise.all([
        api<ErpConfig>(`${base}/config`), api<BatchPage>(`${base}/batches?limit=50`),
      ]);
      setConfig(nextConfig); setEndpoint(nextConfig.endpoint || ""); setActive(nextConfig.active);
      setBatches(nextBatches.batches); setNextCursor(nextBatches.next_cursor); setBatchTotal(nextBatches.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a integração com ERP.");
    } finally { setLoading(false); }
  }, [workspaceId]);

  async function loadMoreBatches() {
    if (!workspaceId || !nextCursor || loadingMore) return;
    setLoadingMore(true); setError("");
    try {
      const page = await api<BatchPage>(`${pathFor(workspaceId)}/batches?limit=50&cursor=${encodeURIComponent(nextCursor)}`);
      setBatches((current) => {
        const seen = new Set(current.map((batch) => batch.id));
        return [...current, ...page.batches.filter((batch) => !seen.has(batch.id))];
      });
      setBatchTotal(page.total); setNextCursor(page.next_cursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os próximos lotes ERP."); }
    finally { setLoadingMore(false); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspaceId || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const body: { endpoint: string; bearer_token?: string; active: boolean } = { endpoint: endpoint.trim(), active };
      if (token.trim()) body.bearer_token = token;
      const saved = await api<ErpConfig>(`${pathFor(workspaceId)}/config`, { method: "PUT", body: JSON.stringify(body) });
      setConfig(saved); setEndpoint(saved.endpoint || ""); setToken("");
      setMessage("Configuração salva. O token fica protegido no servidor e não é exibido novamente.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a integração."); }
    finally { setBusy(false); }
  }

  async function removeConfig() {
    if (!workspaceId || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`${pathFor(workspaceId)}/config`, { method: "DELETE" });
      setConfig({ configured: false, endpoint: null, active: false }); setEndpoint(""); setToken(""); setActive(false);
      setMessage("Integração removida. Os lotes históricos foram preservados.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível remover a integração."); }
    finally { setBusy(false); }
  }

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspaceId || busy) return;
    if (from > to) { setError("A data inicial deve ser anterior ou igual à data final."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const body: { from: string; to: string; unit_record_id?: string } = { from, to };
      if (unitId) body.unit_record_id = unitId;
      const result = await api<BatchDelivery>(`${pathFor(workspaceId)}/batches`, { method: "POST", body: JSON.stringify(body) });
      setMessage(result.delivery === "delivered"
        ? `Lote ${result.batch.id} entregue ao ERP (${result.batch.entry_count} lançamentos).`
        : `Lote ${result.batch.id} criado, mas a entrega falhou. ${result.message || "Você pode tentar novamente pelo histórico."}`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar e enviar o lote contábil."); }
    finally { setBusy(false); }
  }

  async function retry(batch: Batch) {
    if (!workspaceId || retryingId) return;
    setRetryingId(batch.id); setError(""); setMessage("");
    try {
      const result = await api<BatchDelivery>(`${pathFor(workspaceId)}/batches/${encodeURIComponent(batch.id)}/retry`, { method: "POST", body: JSON.stringify({}) });
      setMessage(result.delivery === "delivered" ? `Lote ${batch.id} entregue ao ERP.` : `A nova tentativa do lote ${batch.id} falhou. ${result.message || "Tente novamente mais tarde."}`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível tentar novamente a entrega."); }
    finally { setRetryingId(""); }
  }

  return <section className={panel} aria-labelledby="suinda-erp-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Contabilidade</p>
        <h2 id="suinda-erp-title" className="mt-1 text-lg font-semibold text-white">Integração com ERP</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#aeb9c4]">Envie lotes do diário contábil para um receptor HTTPS. Cada lote mantém o mesmo identificador e conteúdo em novas tentativas; o receptor deve respeitar a chave de idempotência.</p>
      </div>
      <button type="button" className={button} onClick={() => void refresh()} disabled={loading || busy} aria-label="Atualizar integração e histórico">Atualizar</button>
    </div>

    <div className="mt-4" aria-live="polite" aria-atomic="true">
      {loading && <p role="status" className="text-sm text-[#9fadbc]">Carregando integração…</p>}
      {(error || message) && <p role={error ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-300/20 bg-rose-300/5 text-rose-100" : "border-cyan-300/20 bg-cyan-300/5 text-cyan-100"}`}>{error || message}</p>}
    </div>

    <form onSubmit={(event) => void saveConfig(event)} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
      <label className="grid gap-1 text-xs text-[#b6c2cf]">Endpoint HTTPS do receptor ERP
        <input required type="url" inputMode="url" autoComplete="url" maxLength={2048} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://erp.exemplo.com/api/lancamentos" className={field} disabled={loading || busy} />
      </label>
      <label className="grid gap-1 text-xs text-[#b6c2cf]">Token Bearer {config?.configured && <span className="text-[#9fadbc]">(deixe vazio para manter o atual)</span>}
        <input type="password" autoComplete="new-password" maxLength={4096} value={token} onChange={(event) => setToken(event.target.value)} placeholder={config?.configured ? "Token salvo; não exibido" : "Token de acesso do receptor"} className={field} disabled={loading || busy} required={!config?.configured} />
      </label>
      <button type="submit" className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50" disabled={loading || busy || !workspaceId}>{busy ? "Salvando…" : "Salvar integração"}</button>
      <label className="flex min-h-10 items-center gap-2 text-sm text-[#d2dae2] md:col-span-2">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} disabled={loading || busy} className="size-4 accent-cyan-200" />
        Ativar entregas para este workspace
      </label>
      {config?.configured && <button type="button" className={`${button} border-rose-200/20 text-rose-100 hover:bg-rose-200/5`} onClick={() => void removeConfig()} disabled={loading || busy}>Remover integração</button>}
    </form>

    <form onSubmit={(event) => void createBatch(event)} className="mt-5 rounded-xl border border-white/10 bg-[#23292f] p-4">
      <h3 className="font-semibold text-white">Gerar e enviar lote</h3>
      <p className="mt-1 text-xs leading-5 text-[#9fadbc]">O conteúdo inclui somente data, descrição financeira genérica, moeda, contas, valor e identificadores de lançamento. Não inclui dados de alunos nem credenciais.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs text-[#b6c2cf]">De<input type="date" required value={from} onChange={(event) => setFrom(event.target.value)} className={field} disabled={loading || busy} /></label>
        <label className="grid gap-1 text-xs text-[#b6c2cf]">Até<input type="date" required value={to} onChange={(event) => setTo(event.target.value)} className={field} disabled={loading || busy} /></label>
        <label className="grid gap-1 text-xs text-[#b6c2cf]">Unidade (opcional)<select value={unitId} onChange={(event) => setUnitId(event.target.value)} className={field} disabled={loading || busy}><option value="">Todas as unidades autorizadas</option>{units.map((unit) => <option key={unit.unit_record_id} value={unit.unit_record_id}>{unit.unit_name}</option>)}</select></label>
        <button type="submit" className="min-h-10 self-end rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50" disabled={loading || busy || !workspaceId || !config?.configured || !config.active}>{busy ? "Enviando…" : "Gerar e enviar"}</button>
      </div>
      {config?.configured && !config.active && <p className="mt-2 text-xs text-amber-100">Ative a integração para permitir novos envios.</p>}
      {config?.configured && config.active && <p className="mt-2 text-xs text-[#9fadbc]">Antes do envio, confira o período e a unidade selecionados.</p>}
    </form>

    <div className="mt-5">
      <h3 className="font-semibold text-white">Histórico de lotes</h3>
      {!loading && batchTotal > 0 && <p className="mt-1 text-xs text-[#9fadbc]" role="status">Exibindo {batches.length} de {batchTotal} lotes.</p>}
      {!loading && batches.length === 0 ? <p className="mt-2 text-sm text-[#9fadbc]">Nenhum lote enviado ainda.</p> : <div role="region" aria-label="Histórico de lotes ERP, tabela horizontal" tabIndex={0} className="mt-3 overflow-x-auto rounded-xl border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">Lotes enviados ao sistema ERP e estado das entregas</caption>
          <thead className="bg-[#23292f] text-xs uppercase tracking-wide text-[#9fadbc]"><tr><th scope="col" className="px-3 py-3">Período</th><th scope="col" className="px-3 py-3">Lançamentos</th><th scope="col" className="px-3 py-3">Lote / SHA-256</th><th scope="col" className="px-3 py-3">Entrega</th><th scope="col" className="px-3 py-3">Atualizado</th><th scope="col" className="px-3 py-3">Ação</th></tr></thead>
          <tbody className="divide-y divide-white/10">{batches.map((batch) => <tr key={batch.id} className="align-top text-[#d6dee6]"><td className="px-3 py-3">{batch.from} — {batch.to}<span className="block text-xs text-[#9fadbc]">{batch.unit_record_id ? units.find((unit) => unit.unit_record_id === batch.unit_record_id)?.unit_name || "Unidade" : "Todas as unidades"}</span></td><td className="px-3 py-3">{batch.entry_count}</td><td className="px-3 py-3"><span className="block font-mono text-xs">{batch.id}</span><span className="block max-w-52 truncate font-mono text-[11px] text-[#9fadbc]" title={batch.payload_sha256}>{batch.payload_sha256}</span></td><td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-xs ${batch.status === "delivered" ? "border-emerald-200/20 bg-emerald-200/10 text-emerald-100" : batch.status === "failed" ? "border-rose-200/20 bg-rose-200/10 text-rose-100" : "border-amber-200/20 bg-amber-200/10 text-amber-100"}`}>{batch.status === "delivered" ? "Entregue" : batch.status === "failed" ? "Falhou" : batch.status === "sending" ? "Processando" : "Pendente"}</span><span className="mt-1 block text-xs text-[#9fadbc]">{batch.attempt_count} tentativa(s){batch.remote_status ? ` · HTTP ${batch.remote_status}` : ""}</span></td><td className="px-3 py-3 text-xs">{localDate(batch.last_attempt_at || batch.created_at)}</td><td className="px-3 py-3">{batch.status !== "delivered" && <button type="button" className={button} onClick={() => void retry(batch)} disabled={loading || busy || Boolean(retryingId) || !config?.active || batch.status === "sending"}>{retryingId === batch.id ? "Tentando…" : "Tentar novamente"}</button>}</td></tr>)}</tbody>
        </table>
      </div>}
      {nextCursor && <button type="button" className={`${button} mt-3`} onClick={() => void loadMoreBatches()} disabled={loadingMore || loading}>{loadingMore ? "Carregando…" : "Carregar mais lotes"}</button>}
    </div>
  </section>;
}
