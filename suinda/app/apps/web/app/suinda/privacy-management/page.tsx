"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

type Workspace = { workspace_id: string; workspace_name: string };
type CategoryDecision = { category: string; decision: string; legal_basis: string; decision_reference: string; mapping: unknown[] };
type PrivacyRequest = { id: string; workspace_id: string; title: string; state: string; payload: { learner_user_id: string; request_type: string; request_scope: string; request_description: string; requested_categories?: string[] }; category_decisions: CategoryDecision[] };
const emptyMapping = `[]`;
function allRequestedCategoriesApproved(request: PrivacyRequest) {
  const decisions = new Map(request.category_decisions.map((item) => [item.category, item.decision]));
  const categories = request.payload.requested_categories || [];
  return categories.length > 0 && categories.every((category) => decisions.get(category) === "approved");
}

export default function SuindaPrivacyManagementPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [decision, setDecision] = useState<Record<string, string>>({});
  const [basis, setBasis] = useState<Record<string, string>>({});
  const [reference, setReference] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadWorkspaces = useCallback(async () => {
    const values = await api<Workspace[]>("/extensions/suinda-learning/me/privacy-workspaces");
    setWorkspaces(values);
    setWorkspace((current) => values.some((item) => item.workspace_id === current) ? current : values[0]?.workspace_id || "");
  }, []);
  const loadRequests = useCallback(async (target = workspace) => {
    if (!target) { setRequests([]); return; }
    setRequests(await api<PrivacyRequest[]>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(target)}/privacy-requests`));
  }, [workspace]);
  useEffect(() => { Promise.resolve().then(loadWorkspaces).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar as instituições.")); }, [loadWorkspaces]);
  useEffect(() => { if (workspace) Promise.resolve().then(() => loadRequests(workspace)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar as solicitações.")); }, [workspace, loadRequests]);

  async function saveDecision(request: PrivacyRequest, category: string) {
    const key = `${request.id}:${category}`;
    setBusy(true); setError(""); setNotice("");
    try {
      const parsed = JSON.parse(mapping[key] || emptyMapping);
      if (!Array.isArray(parsed)) throw new Error("O mapa deve ser uma lista JSON.");
      await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspace)}/privacy-requests/${encodeURIComponent(request.id)}/categories`, {
        method: "POST", body: JSON.stringify({ category, decision: decision[key] || "denied", legal_basis: basis[key] || "", decision_reference: reference[key] || "", mapping: parsed }),
      });
      setNotice(`Decisão da categoria “${category}” registrada com trilha de auditoria.`); await loadRequests();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar a decisão."); }
    finally { setBusy(false); }
  }
  async function execute(request: PrivacyRequest) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ state: string; reason?: string; unmapped_record_kinds?: string[] }>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspace)}/privacy-requests/${encodeURIComponent(request.id)}/execute`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID() }),
      });
      if (result.state === "blocked") setNotice(`Execução bloqueada sem alterações: ${result.reason || "revise o mapeamento"}${result.unmapped_record_kinds?.length ? ` · Tipos sem mapa: ${result.unmapped_record_kinds.join(", ")}` : ""}`);
      else setNotice("Execução de privacidade concluída.");
      await loadRequests();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível executar a solicitação."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[#1d2125] px-4 py-7 text-[#dee4ea] sm:px-8 sm:py-10"><div className="mx-auto max-w-5xl">
    <Link href="/suinda/teacher-dashboard" className="inline-flex min-h-10 items-center gap-2 text-sm text-[#b6c2cf] hover:text-cyan-100"><ArrowLeft size={16} aria-hidden="true" /> Painel docente</Link>
    <header className="mt-5 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><p className="text-xs font-semibold uppercase tracking-[.14em] text-cyan-200">Suindá · Coordenação</p><h1 className="mt-2 text-2xl font-semibold text-white">Solicitações de privacidade</h1><p className="mt-2 text-sm leading-6 text-[#b6c2cf]">Decida cada categoria com fundamento e referência. Para aprovar eliminação, descreva os tipos, caminhos JSON e anexos cobertos; o executor bloqueia qualquer tipo sem mapeamento. Prazos vencidos nunca executam expurgo.</p></header>
    <section className="mt-6 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7"><label className="text-sm font-medium text-[#b6c2cf]">Instituição<select value={workspace} onChange={(event) => setWorkspace(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-white">{workspaces.map((item) => <option key={item.workspace_id} value={item.workspace_id}>{item.workspace_name}</option>)}</select></label>
      {error && <p role="alert" className="mt-4 text-sm text-rose-200">{error}</p>}{notice && <p role="status" className="mt-4 text-sm text-amber-100">{notice}</p>}
      {!requests.length ? <p className="mt-5 text-sm text-[#9fadbc]">Nenhuma solicitação neste workspace.</p> : <div className="mt-5 grid gap-4">{requests.map((request) => <article key={request.id} className="rounded-xl border border-white/[0.08] bg-black/10 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium text-white">{request.payload.request_type} · {request.payload.request_scope}</h2><p className="mt-1 text-xs text-[#9fadbc]">Estado: {request.state} · Titular: {request.payload.learner_user_id.slice(0, 8)}…</p></div><span className="rounded-full bg-cyan-200/10 px-2.5 py-1 text-xs text-cyan-100">{request.payload.requested_categories?.join(" · ") || "Sem categorias"}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#b6c2cf]">{request.payload.request_description}</p>
        {request.payload.request_type === "elimination" && <div className="mt-4 grid gap-3">{(request.payload.requested_categories || []).map((category) => { const key = `${request.id}:${category}`; const saved = request.category_decisions.find((item) => item.category === category); return <fieldset key={category} className="rounded-lg border border-[#3b4754] p-3"><legend className="px-1 text-sm font-medium text-cyan-100">{category}{saved ? ` · decisão anterior: ${saved.decision}` : " · sem decisão"}</legend><div className="grid gap-3 md:grid-cols-2"><label className="text-xs text-[#9fadbc]">Decisão<select value={decision[key] || saved?.decision || "denied"} onChange={(event) => setDecision((old) => ({ ...old, [key]: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white"><option value="denied">Não aprovar</option><option value="approved">Aprovar com mapa</option></select></label><label className="text-xs text-[#9fadbc]">Fundamento da decisão<input value={basis[key] ?? saved?.legal_basis ?? ""} onChange={(event) => setBasis((old) => ({ ...old, [key]: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" /></label><label className="text-xs text-[#9fadbc] md:col-span-2">Referência da decisão<input value={reference[key] ?? saved?.decision_reference ?? ""} onChange={(event) => setReference((old) => ({ ...old, [key]: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" /></label><label className="text-xs text-[#9fadbc] md:col-span-2">Mapa JSON da categoria<textarea spellCheck={false} value={mapping[key] ?? JSON.stringify(saved?.mapping ?? JSON.parse(emptyMapping), null, 2)} onChange={(event) => setMapping((old) => ({ ...old, [key]: event.target.value }))} className="mt-1 min-h-36 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 font-mono text-xs text-white" /><span className="mt-1 block">O mapa inicia vazio. Para aprovar, descreva explicitamente os tipos, caminhos e anexos da categoria; não copie um exemplo sem conferir o esquema e a finalidade institucional. Cada entrada contém `record_kind`, `redaction_paths`, `attachments` e `preserve_record`. Use `plugin_id: &quot;suinda-teacher-evaluation&quot;` somente para avaliação docente; sem este campo, o mapa se aplica a `suinda-learning`. Para `account_profile`, inclua `user_account` com caminhos `name` e `email`; o servidor também inutiliza a senha, remove logins sociais e desliga MFA. Esses mapas só são aceitos nesse escopo. Não use índices de arrays; os caminhos precisam existir em todas as revisões.</span></label></div><button type="button" disabled={busy} onClick={() => void saveDecision(request, category)} className="mt-3 min-h-10 rounded-lg border border-cyan-100/30 px-3 text-xs text-cyan-100 disabled:opacity-50">Registrar decisão auditável</button></fieldset>; })}<button type="button" disabled={busy || !allRequestedCategoriesApproved(request) || request.state === "completed" || request.state === "blocked"} onClick={() => void execute(request)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50"><ShieldCheck size={16} aria-hidden="true" />Executar categorias aprovadas</button></div>}
      </article>)}</div>}
      <button type="button" onClick={() => void loadRequests().catch(() => undefined)} disabled={!workspace || busy} className="mt-5 inline-flex min-h-10 items-center gap-2 text-xs text-[#b6c2cf] disabled:opacity-50"><RefreshCw size={14} aria-hidden="true" />Atualizar lista</button>
    </section>
  </div></main>;
}
