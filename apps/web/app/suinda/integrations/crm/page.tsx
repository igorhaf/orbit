"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { CrmSyncPanel } from "@/plugins/suinda/CrmSyncPanel";

type Workspace = { id: string; name: string };

export default function CrmIntegrationPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const workspace = workspaces.find((item) => item.id === workspaceId);
  return <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 text-[#e8edf2] sm:px-6 lg:px-8">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Suindá · integrações</p>
      <h1 className="text-2xl font-semibold text-white sm:text-3xl">Sincronização com CRM</h1>
      <p className="max-w-3xl text-sm leading-6 text-[#aeb9c4]">Conecte um receptor CRM por instituição. A sincronização exige consentimento vigente e envia somente campos mínimos selecionados.</p>
    </header>
    {workspaces.length > 1 && <label className="grid max-w-xl gap-1 text-xs text-[#aeb9c4]">Instituição
      <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="min-h-11 rounded-lg border border-[#46515c] bg-[#1d2125] px-3 text-sm text-white focus:border-cyan-300 focus:outline-none">
        {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>}
    {loading && <p role="status" className="text-sm text-[#9fadbc]">Carregando instituições…</p>}
    {error && <p role="alert" className="max-w-2xl rounded-lg border border-rose-300/20 bg-rose-300/5 px-4 py-3 text-sm text-rose-100">{error}</p>}
    {workspace && <CrmSyncPanel workspaceId={workspace.id} workspaceName={workspace.name} />}
    <Link href="/suinda" className="inline-flex min-h-10 items-center text-sm text-cyan-200 underline underline-offset-4">Voltar à área Suindá</Link>
  </main>;
}
