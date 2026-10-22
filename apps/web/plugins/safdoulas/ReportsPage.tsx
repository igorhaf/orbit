"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AccessShell, accessButton, accessInput, accessPanel } from "@/components/access-shell";
import { api, authenticatedBlob, User } from "@/lib/api";

type Workspace = { id: string; name: string };
type ProcessFilters = { q: string; state: string; type: string; region: string; modality: string; from: string; to: string };
type Dashboard = {
  generated_at: string;
  metrics: Array<{ key: string; label: string; value: number }>;
  process_states: Record<string, number>;
  sources: Array<{ plugin_id: string; label: string; count: number; possibly_truncated: boolean }>;
  disabled_plugins: string[];
  partial: boolean;
  perspectives: Array<{ id: "administration" | "accreditor" | "institution"; label: string; metrics: Array<{ key: string; label: string; value: number }>; process_states?: Record<string, number> }>;
  process_search: {
    total: number;
    truncated: boolean;
    rows: Array<{ id: string; protocol_number: string; state: string; process_type: string; opened_at: string; reference_label: string; region: string; modalities: string[] }>;
    options: { states: string[]; types: string[]; regions: string[]; modalities: string[] };
  };
};

const stateLabels: Record<string, string> = {
  draft: "Rascunho",
  submitted: "Enviado",
  received: "Recebido",
  identity_verification: "Verificação de identidade",
  triage: "Triagem",
  review: "Análise",
  diligence: "Diligência",
  deliberation: "Deliberação",
  decision: "Decisão",
  closed: "Encerrado",
  cancelled: "Cancelado",
};

export default function SafdoulasReportsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [filters, setFilters] = useState<ProcessFilters>({ q: "", state: "", type: "", region: "", modality: "", from: "", to: "" });
  const [filterQuery, setFilterQuery] = useState("");
  const [activePerspective, setActivePerspective] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const canExport = Boolean(user?.is_root || user?.permissions?.includes("plugin.safdoulas-reporting.export"));
  const perspective = dashboard?.perspectives.find((item) => item.id === activePerspective) || dashboard?.perspectives[0];

  useEffect(() => {
    let active = true;
    Promise.all([api<User>("/auth/me"), api<Workspace[]>("/workspaces")])
      .then(([account, spaces]) => {
        if (!active) return;
        setUser(account);
        setWorkspaces(spaces);
        setWorkspaceId((current) => current || spaces[0]?.id || "");
        if (spaces.length === 0) setLoading(false);
      })
      .catch((reason) => { if (active) { setError((reason as Error).message); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    api<Dashboard>(`/safdoulas/reports/${workspaceId}/dashboard${filterQuery ? `?${filterQuery}` : ""}`)
      .then((data) => { if (active) setDashboard(data); })
      .catch((reason) => { if (active) { setDashboard(null); setError((reason as Error).message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, filterQuery, refreshVersion]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value.trim()) query.set(key, value.trim());
    setLoading(true);
    setError("");
    setFilterQuery(query.toString());
    setRefreshVersion((value) => value + 1);
  }

  async function exportCsv() {
    if (!workspaceId) return;
    setExporting(true);
    setError("");
    try {
      const blob = await authenticatedBlob(`/safdoulas/reports/${workspaceId}/export.csv`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "safdoulas-indicadores.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <AccessShell user={user} title="Painéis SAFDOULAS">
      <p className="max-w-3xl text-sm text-[#44546f]">
        Os indicadores são calculados somente sobre processos e registros que seu perfil pode consultar neste workspace.
      </p>
      <section className={`${accessPanel} grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end`} aria-label="Filtros do painel">
        <label className="min-w-0 space-y-1 text-sm font-semibold" htmlFor="report-workspace">
          Workspace
          <select id="report-workspace" value={workspaceId} onChange={(event) => { setLoading(true); setError(""); setFilterQuery(""); setFilters({ q: "", state: "", type: "", region: "", modality: "", from: "", to: "" }); setWorkspaceId(event.target.value); }} className={accessInput}>
            <option value="">Selecione um workspace</option>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void exportCsv()} disabled={!canExport || !workspaceId || exporting || loading} className={accessButton} title={!canExport ? "Seu perfil não pode exportar relatórios." : undefined}>
          {exporting ? "Preparando…" : "Exportar CSV"}
        </button>
      </section>
      {error && <p role="alert" className="rounded-lg border border-[#f5c2c7] bg-[#fff1f0] p-3 text-sm text-[#ae2a19]">{error}</p>}
      {!workspaces.length && !error && <p className={accessPanel}>Nenhum workspace está disponível para este perfil.</p>}
      {loading && <p role="status" className={accessPanel}>Atualizando indicadores…</p>}
      {dashboard && !loading && <>
        {dashboard.partial && <p role="status" className="rounded-lg border border-[#e6c76b] bg-[#fff7d6] p-3 text-sm">Algumas listas atingiram o limite de consulta de 100 registros; os totais correspondentes podem estar incompletos.</p>}
        {dashboard.disabled_plugins.length > 0 && <p role="status" className="rounded-lg border border-[#dfe1e6] bg-white p-3 text-sm">Seções suspensas: {dashboard.disabled_plugins.join(", ")}. Os demais módulos continuam disponíveis.</p>}
        {dashboard.perspectives.length > 1 && <nav aria-label="Perspectiva do painel" className="flex flex-wrap gap-2">
          {dashboard.perspectives.map((item) => <button key={item.id} type="button" aria-pressed={perspective?.id === item.id} onClick={() => setActivePerspective(item.id)} className={`${accessButton} ${perspective?.id === item.id ? "!bg-[#0c66e4]" : "!bg-[#44546f]"}`}>{item.label}</button>)}
        </nav>}
        {!perspective && <p className={accessPanel}>Este perfil não tem uma perspectiva de painel habilitada neste workspace.</p>}
        {perspective && <>
          <section aria-label={`Indicadores: ${perspective.label}`} className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {perspective.metrics.map((metric) => <article key={metric.key} className={`${accessPanel} min-w-0`}><h2 className="text-sm font-semibold text-[#44546f]">{metric.label}</h2><p className="mt-2 text-3xl font-bold tabular-nums">{metric.value}</p></article>)}
          </section>
          {perspective.process_states && <section className={`${accessPanel} min-w-0`}>
            <h2 className="text-lg font-semibold">Processos por etapa</h2>
            {Object.keys(perspective.process_states).length ? <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(perspective.process_states).map(([state, count]) => <div key={state} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[#dfe1e6] px-3 py-2"><dt className="break-words text-sm">{stateLabels[state] || state}</dt><dd className="shrink-0 font-semibold tabular-nums">{count}</dd></div>)}
            </dl> : <p className="mt-3 text-sm text-[#626f86]">Nenhum processo visível neste workspace.</p>}
          </section>}
        <section className={`${accessPanel} min-w-0`} aria-labelledby="process-search-heading">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h2 id="process-search-heading" className="text-lg font-semibold">Pesquisar processos</h2><p className="mt-1 text-sm text-[#626f86]">Os filtros de instituição, curso, região e modalidade usam apenas referências liberadas para seu perfil.</p></div>
            <span className="text-sm text-[#626f86]">{dashboard.process_search.total} resultado(s)</span>
          </div>
          <form onSubmit={applyFilters} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="min-w-0 space-y-1 text-sm font-medium">Texto<input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} maxLength={120} placeholder="Protocolo, instituição ou curso" className={accessInput}/></label>
            <label className="min-w-0 space-y-1 text-sm font-medium">Etapa<select value={filters.state} onChange={(event) => setFilters({ ...filters, state: event.target.value })} className={accessInput}><option value="">Todas</option>{dashboard.process_search.options.states.map((state) => <option key={state} value={state}>{stateLabels[state] || state}</option>)}</select></label>
            <label className="min-w-0 space-y-1 text-sm font-medium">Processo<select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })} className={accessInput}><option value="">Todos</option>{dashboard.process_search.options.types.map((type) => <option key={type} value={type}>{type === "course_accreditation" ? "Acreditação de curso" : type === "accreditor_selection" ? "Seleção de acreditadoras" : type}</option>)}</select></label>
            <label className="min-w-0 space-y-1 text-sm font-medium">UF<select value={filters.region} onChange={(event) => setFilters({ ...filters, region: event.target.value })} className={accessInput}><option value="">Todas</option>{dashboard.process_search.options.regions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
            <label className="min-w-0 space-y-1 text-sm font-medium">Modalidade<select value={filters.modality} onChange={(event) => setFilters({ ...filters, modality: event.target.value })} className={accessInput}><option value="">Todas</option>{dashboard.process_search.options.modalities.map((modality) => <option key={modality} value={modality}>{modality}</option>)}</select></label>
            <label className="min-w-0 space-y-1 text-sm font-medium">A partir de<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className={accessInput}/></label>
            <label className="min-w-0 space-y-1 text-sm font-medium">Até<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className={accessInput}/></label>
            <div className="flex flex-wrap items-end gap-2"><button type="submit" disabled={loading} className={accessButton}>Aplicar filtros</button><button type="button" onClick={() => { setFilters({ q: "", state: "", type: "", region: "", modality: "", from: "", to: "" }); setFilterQuery(""); setLoading(true); setRefreshVersion((value) => value + 1); }} className={`${accessButton} !bg-[#44546f]`}>Limpar</button></div>
          </form>
          {dashboard.process_search.truncated && <p role="status" className="mt-3 rounded-lg border border-[#e6c76b] bg-[#fff7d6] p-3 text-sm">A lista foi limitada a 100 processos; refine os filtros para restringir os resultados.</p>}
          {dashboard.process_search.rows.length ? <ul className="mt-4 grid min-w-0 gap-2 md:grid-cols-2">
            {dashboard.process_search.rows.map((process) => <li key={process.id} className="min-w-0 rounded-lg border border-[#dfe1e6] p-3"><div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><strong className="break-words">{process.reference_label}</strong><span className="rounded-full bg-[#e9f2ff] px-2 py-1 text-xs font-semibold">{stateLabels[process.state] || process.state}</span></div><p className="mt-2 break-all text-sm text-[#44546f]">{process.protocol_number || "Sem protocolo"}</p><p className="mt-1 text-xs text-[#626f86]">{process.process_type === "course_accreditation" ? "Acreditação de curso" : "Seleção de acreditadoras"} · {process.opened_at ? new Date(process.opened_at).toLocaleDateString("pt-BR") : "Data não informada"}{process.region ? ` · ${process.region}` : ""}{process.modalities.length ? ` · ${process.modalities.join(", ")}` : ""}</p></li>)}
          </ul> : <p className="mt-4 text-sm text-[#626f86]">Nenhum processo corresponde aos filtros e registros visíveis para seu perfil.</p>}
        </section>
        <details className={accessPanel}>
          <summary className="cursor-pointer font-semibold">Cobertura das fontes de dados</summary>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {dashboard.sources.map((source) => <li key={source.plugin_id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[#dfe1e6] px-3 py-2 text-sm"><span className="break-words">{source.label}</span><span className="shrink-0 tabular-nums">{source.count}{source.possibly_truncated ? "+" : ""}</span></li>)}
          </ul>
        </details>
        <p className="text-xs text-[#626f86]">Atualizado em {new Date(dashboard.generated_at).toLocaleString("pt-BR")} · O CSV contém somente indicadores agregados e a exportação é auditada.</p>
        </>}
      </>}
    </AccessShell>
  );
}
