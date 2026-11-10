"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SuindaSubscriptions } from "@/plugins/suinda/SuindaSubscriptions";

type Workspace = { id: string; name: string };

export default function SuindaSubscriptionsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const requested = new URLSearchParams(window.location.search).get("workspaceId") || "";
    void api<Workspace[]>("/workspaces").then((items) => {
      if (!active) return;
      setWorkspaces(items);
      // A course page can pass its institution's workspace even when a student
      // does not have an administrative workspace membership.
      setWorkspaceId(requested || items[0]?.id || "");
      if (!requested && !items.length) setError("Abra esta página a partir de um curso para consultar os planos da instituição.");
    }).catch((cause: unknown) => {
      if (!active) return;
      if (requested) setWorkspaceId(requested);
      else setError(cause instanceof Error ? cause.message : "Não foi possível carregar os workspaces.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 text-[#e8edf2] sm:px-6 lg:px-8">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Suindá · acesso recorrente</p>
      <h1 className="text-2xl font-semibold text-white sm:text-3xl">Planos e assinaturas</h1>
      <p className="max-w-3xl text-sm leading-6 text-[#aeb9c4]">Os planos podem agrupar cursos da instituição. A equipe confirma o recebimento manualmente; uma assinatura ativa libera o conteúdo incluído sem criar matrícula nem substituir as regras de pagamento do curso.</p>
    </header>
    {workspaces.length > 1 && <label className="grid max-w-xl gap-1 text-xs text-[#aeb9c4]">Instituição
      <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="min-h-11 rounded-lg border border-[#46515c] bg-[#1d2125] px-3 text-sm text-white focus:border-cyan-300 focus:outline-none">
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
    </label>}
    {loading && <p role="status" className="text-sm text-[#9fadbc]">Carregando planos…</p>}
    {error && !workspaceId && <p role="status" className="rounded-lg border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">{error}</p>}
    {!loading && workspaceId && <SuindaSubscriptions key={workspaceId} workspaceId={workspaceId} />}
  </main>;
}
