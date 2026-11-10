"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type Workspace = { id: string; name: string };
type IssuerSettings = { configured: boolean; issuer_name: string | null; issuer_url: string | null };

export default function OpenBadgesSettingsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [issuerName, setIssuerName] = useState("");
  const [issuerUrl, setIssuerUrl] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void api<Workspace[]>("/workspaces").then((items) => {
      if (!active) return;
      setWorkspaces(items);
      const requested = new URLSearchParams(window.location.search).get("workspaceId") || "";
      setWorkspaceId(requested && items.some((item) => item.id === requested) ? requested : items[0]?.id || "");
      if (!items.length) setError("Nenhum workspace administrável foi encontrado.");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar as instituições.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void api<IssuerSettings>(`/extensions/suinda-open-badges/workspaces/${encodeURIComponent(workspaceId)}/issuer`).then((settings) => {
      if (!active) return;
      setError(""); setMessage("");
      setIssuerName(settings.issuer_name || ""); setIssuerUrl(settings.issuer_url || "");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível consultar o emissor.");
    });
    return () => { active = false; };
  }, [workspaceId]);

  async function save() {
    if (!workspaceId || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const settings = await api<IssuerSettings & { issuer_name: string }>(`/extensions/suinda-open-badges/workspaces/${encodeURIComponent(workspaceId)}/issuer`, {
        method: "POST", body: JSON.stringify({ issuer_name: issuerName }),
      });
      setIssuerName(settings.issuer_name); setIssuerUrl(settings.issuer_url || ""); setMessage("Emissor Open Badges salvo.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o emissor."); }
    finally { setSaving(false); }
  }

  return <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 text-[#e8edf2] sm:px-6 lg:px-8">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Suindá · integrações</p>
      <h1 className="text-2xl font-semibold text-white sm:text-3xl">Certificados Open Badges</h1>
      <p className="max-w-3xl text-sm leading-6 text-[#aeb9c4]">Configure o nome institucional que assina as credenciais portáteis Open Badges 3.0. O Orbit gera e guarda a chave privada cifrada; validadores públicos recebem apenas a chave pública.</p>
    </header>
    {workspaces.length > 1 && <label className="grid max-w-xl gap-1 text-xs text-[#aeb9c4]">Instituição
      <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="min-h-11 rounded-lg border border-[#46515c] bg-[#1d2125] px-3 text-sm text-white focus:border-cyan-300 focus:outline-none">
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
    </label>}
    {loading && <p role="status" className="text-sm text-[#9fadbc]">Carregando instituições…</p>}
    {workspaceId && <section className="max-w-2xl space-y-4 rounded-xl border border-[#3b4754] bg-[#1d2125] p-5">
      <label className="grid gap-1 text-sm text-[#c2ccd6]">Nome oficial do emissor
        <input value={issuerName} onChange={(event) => setIssuerName(event.target.value)} maxLength={160} className="min-h-11 rounded-lg border border-[#46515c] bg-[#171a1d] px-3 text-white focus:border-cyan-300 focus:outline-none" placeholder="Nome da instituição" />
      </label>
      <button type="button" onClick={() => void save()} disabled={saving || !issuerName.trim()} className="min-h-10 rounded-lg bg-cyan-200 px-4 font-semibold text-slate-950 disabled:opacity-50">{saving ? "Salvando…" : "Salvar emissor"}</button>
      {issuerUrl && <p className="break-all text-xs text-[#aeb9c4]">Perfil público do emissor: <a className="underline underline-offset-4" href={issuerUrl} target="_blank" rel="noreferrer">{issuerUrl}</a></p>}
      {message && <p role="status" className="text-sm text-emerald-200">{message}</p>}
    </section>}
    {error && <p role="alert" className="max-w-2xl rounded-lg border border-rose-300/20 bg-rose-300/5 px-4 py-3 text-sm text-rose-100">{error}</p>}
    <Link href="/suinda" className="inline-flex min-h-10 items-center text-sm text-cyan-200 underline underline-offset-4">Voltar à área Suindá</Link>
  </main>;
}
