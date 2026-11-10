"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type CrmConfig = { configured: boolean; endpoint: string | null; active: boolean; include_phone: boolean; deleting?: boolean };
type CrmStatus = { eligible_contacts: number; pending_deletions: number; last_sync_at: string | null };
type SyncResult = { queued: number; message: string };

const field = "min-h-10 w-full rounded-lg border border-[#46515c] bg-[#1d2125] px-3 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50";
const button = "inline-flex min-h-10 items-center justify-center rounded-lg border border-white/15 px-4 text-sm font-medium text-[#e8edf2] hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50";
const inputPath = (workspaceId: string) => `/extensions/suinda-crm/workspaces/${encodeURIComponent(workspaceId)}`;
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Ainda não sincronizado";

/** Consent-gated CRM receiver setup and contact synchronization for one institution. */
export function CrmSyncPanel({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [config, setConfig] = useState<CrmConfig | null>(null);
  const [status, setStatus] = useState<CrmStatus | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [active, setActive] = useState(true);
  const [includePhone, setIncludePhone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (isCurrent: () => boolean = () => true) => {
    if (!workspaceId) {
      if (isCurrent()) { setConfig(null); setStatus(null); setLoading(false); }
      return;
    }
    if (isCurrent()) { setLoading(true); setError(""); }
    try {
      const root = inputPath(workspaceId);
      const [nextConfig, nextStatus] = await Promise.all([
        api<CrmConfig>(`${root}/config`), api<CrmStatus>(`${root}/status`),
      ]);
      if (!isCurrent()) return;
      setConfig(nextConfig); setStatus(nextStatus); setEndpoint(nextConfig.endpoint || "");
      setActive(nextConfig.active); setIncludePhone(nextConfig.include_phone); setError("");
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : "Não foi possível carregar a integração de CRM.");
    } finally { if (isCurrent()) setLoading(false); }
  }, [workspaceId]);

  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => refresh(() => current));
    return () => { current = false; };
  }, [refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const body: { endpoint: string; bearer_token?: string; active: boolean; include_phone: boolean } = {
        endpoint: endpoint.trim(), active, include_phone: includePhone,
      };
      if (token) body.bearer_token = token;
      const saved = await api<CrmConfig>(`${inputPath(workspaceId)}/config`, { method: "PUT", body: JSON.stringify(body) });
      setConfig(saved); setEndpoint(saved.endpoint || ""); setActive(saved.active); setIncludePhone(saved.include_phone); setToken("");
      setMessage("Integração salva. O token fica protegido no servidor e não é exibido novamente.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a integração de CRM."); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!workspaceId || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await api(`${inputPath(workspaceId)}/config`, { method: "DELETE" });
      setConfig({ configured: false, endpoint: null, active: false, include_phone: false });
      setEndpoint(""); setToken(""); setActive(false); setIncludePhone(false);
      setMessage("A limpeza remota foi solicitada. As credenciais permanecerão protegidas até o receptor confirmar as exclusões.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível remover a integração de CRM."); }
    finally { setSaving(false); }
  }

  async function queueSync() {
    if (!workspaceId || syncing || !config?.active) return;
    setSyncing(true); setError(""); setMessage("");
    try {
      const result = await api<SyncResult>(`${inputPath(workspaceId)}/sync`, { method: "POST", body: JSON.stringify({}) });
      setMessage(result.message || `${result.queued} contato(s) elegível(is) enfileirado(s) para sincronização.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a sincronização de CRM."); }
    finally { setSyncing(false); }
  }

  const disabled = loading || saving || syncing || !workspaceId;
  return <section aria-labelledby="suinda-crm-title" className="rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-4 sm:p-5">
    <header>
      <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Integração institucional</p>
      <h2 id="suinda-crm-title" className="mt-1 text-lg font-semibold text-white">Sincronização com CRM</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-[#aeb9c4]">{workspaceName}: envie contatos para um receptor HTTPS compatível com o contrato Suindá. A sincronização inclui somente alunos com consentimento válido para a finalidade de CRM; nome e e-mail verificado são enviados, com telefone opcional quando habilitado.</p>
    </header>

    <p className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/[0.04] px-3 py-2 text-xs leading-5 text-amber-100">
      Antes de sincronizar, publique no aviso desta instituição a finalidade <code>crm_contact_sync</code>, consentimento obrigatório e as categorias exatas <code>learner_name</code> e <code>verified_email</code>. Se habilitar telefone, inclua também <code>learner_phone</code>. Sem o consentimento vigente do aluno para a revisão atual, os dados não entram na fila. Retiradas geram exclusão remota pendente.
    </p>

    <div className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Estado da sincronização">
      <div className="rounded-xl border border-white/10 bg-[#23292f] p-3"><p className="text-xs text-[#9fadbc]">Contatos com consentimento vigente</p><p className="mt-1 text-xl font-semibold text-white">{loading ? "—" : status?.eligible_contacts ?? 0}</p></div>
      <div className="rounded-xl border border-white/10 bg-[#23292f] p-3"><p className="text-xs text-[#9fadbc]">Exclusões remotas pendentes</p><p className="mt-1 text-xl font-semibold text-white">{loading ? "—" : status?.pending_deletions ?? 0}</p></div>
      <div className="rounded-xl border border-white/10 bg-[#23292f] p-3"><p className="text-xs text-[#9fadbc]">Última sincronização</p><p className="mt-1 text-sm font-medium text-white">{loading ? "Carregando…" : dateTime(status?.last_sync_at || null)}</p></div>
    </div>

    <form onSubmit={(event) => void save(event)} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
      <label className="grid gap-1 text-xs text-[#b6c2cf]">Endpoint HTTPS do CRM
        <input required type="url" inputMode="url" autoComplete="url" maxLength={2048} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://crm.exemplo.com/api/suinda" className={field} disabled={disabled} />
      </label>
      <label className="grid gap-1 text-xs text-[#b6c2cf]">Token Bearer {config?.configured && <span className="text-[#9fadbc]">(vazio mantém o token atual)</span>}
        <input type="password" autoComplete="new-password" maxLength={4096} value={token} onChange={(event) => setToken(event.target.value)} placeholder={config?.configured ? "Token salvo; não exibido" : "Token de acesso do CRM"} className={field} disabled={disabled} required={!config?.configured} />
      </label>
      <button type="submit" className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50" disabled={disabled}>{saving ? "Salvando…" : "Salvar integração"}</button>
      <label className="flex min-h-10 items-center gap-2 text-sm text-[#d2dae2] md:col-span-2">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} disabled={disabled} className="size-4 accent-cyan-200" />
        Ativar sincronização para este workspace
      </label>
      <label className="flex min-h-10 items-center gap-2 text-sm text-[#d2dae2] md:col-span-2">
        <input type="checkbox" checked={includePhone} onChange={(event) => setIncludePhone(event.target.checked)} disabled={disabled} className="size-4 accent-cyan-200" />
        Incluir telefone de contato do perfil acadêmico
      </label>
      {config?.configured && <button type="button" className={`${button} border-rose-200/20 text-rose-100 hover:bg-rose-200/5`} onClick={() => void remove()} disabled={disabled}>{config.deleting ? "Repetir limpeza remota" : "Remover e excluir contatos remotos"}</button>}
    </form>

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => void queueSync()} disabled={disabled || !config?.configured || !config.active} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50">{syncing ? "Enfileirando…" : "Sincronizar contatos consentidos"}</button>
      <button type="button" onClick={() => void refresh()} disabled={disabled} className={button}>Atualizar estado</button>
      {config?.configured && config.deleting && <p className="text-xs text-amber-100">A integração foi desativada e está aguardando confirmação das exclusões remotas; as credenciais ainda são necessárias para concluir a limpeza.</p>}
      {config?.configured && !config.active && !config.deleting && <p className="text-xs text-amber-100">A sincronização está desativada.</p>}
    </div>

    <div className="mt-3" aria-live="polite" aria-atomic="true">
      {loading && <p role="status" className="text-sm text-[#9fadbc]">Carregando configuração e estado…</p>}
      {error && <p role="alert" className="rounded-lg border border-rose-300/20 bg-rose-300/5 px-3 py-2 text-sm text-rose-100">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-emerald-300/20 bg-emerald-300/5 px-3 py-2 text-sm text-emerald-100">{message}</p>}
    </div>
  </section>;
}
