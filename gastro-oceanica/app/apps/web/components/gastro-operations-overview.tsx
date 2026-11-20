'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, CalendarDays, ClipboardList, Users } from 'lucide-react';
import { api, type User, type Workspace } from '@/lib/api';

type Count = { kind: string; state: string; count: number };
type Summary = { counts: Count[] };

const cards = [
  { kind: 'patient', label: 'Pessoas atendidas', state: null, icon: Users },
  { kind: 'professional', label: 'Profissionais ativos', state: 'active', icon: Activity },
  { kind: 'appointment', label: 'Agendamentos', state: null, icon: CalendarDays },
  { kind: 'encounter', label: 'Atendimentos em andamento', state: 'in_progress', icon: ClipboardList },
] as const;

export function GastroOperationsOverview({ user }: { user: User }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    api<Workspace[]>('/workspaces').then(rows => {
      if (!active) return;
      setWorkspaces(rows);
      setWorkspaceId(current => rows.some(workspace => workspace.id === current) ? current : rows[0]?.id || '');
      setWorkspaceLoadFailed(false);
    }).catch(() => {
      if (active) {
        setWorkspaces([]);
        setWorkspaceId('');
        setWorkspaceLoadFailed(true);
      }
    }).finally(() => {
      if (active) setLoadingWorkspaces(false);
    });
    return () => { active = false; };
  }, [user.id, workspaceReload]);

  const loadSummary = useCallback(async () => {
    if (!workspaceId) { setSummary(null); return; }
    setLoadingSummary(true);
    try {
      const result = await api<Summary>(`/extensions/gastro-clinic/workspaces/${encodeURIComponent(workspaceId)}/summary`);
      setSummary(result);
      setUnavailable(false);
    } catch {
      setSummary(null);
      setUnavailable(true);
    } finally {
      setLoadingSummary(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadSummary(); }, 0);
    const refresh = () => { void loadSummary(); };
    window.addEventListener('data:changed', refresh);
    return () => { window.clearTimeout(initialLoad); window.removeEventListener('data:changed', refresh); };
  }, [loadSummary]);

  const countFor = (kind: string, state: string | null) => {
    if (!summary) return null;
    const matches = summary.counts.filter(item => item.kind === kind && (!state || item.state === state));
    return matches.reduce((total, item) => total + item.count, 0);
  };

  return <section aria-labelledby="gastro-operations-title" className="mb-7 rounded-2xl border border-[#d9e3e8] bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.12em] text-[#52716f]">ROTINA ASSISTENCIAL E ADMINISTRATIVA</p>
        <h2 id="gastro-operations-title" className="mt-1 text-xl font-bold tracking-tight text-[#193b3b]">Painel do workspace</h2>
        <p className="mt-1 max-w-2xl text-sm text-[#52666a]">Indicadores agregados dos registros que sua conta pode consultar. O painel não exibe nomes, contatos nem finalidade de atendimentos.</p>
      </div>
      <label className="min-w-[220px] text-sm font-medium text-[#33494d]">Workspace
        <select aria-label="Selecionar workspace da Gastro Oceânica" disabled={loadingWorkspaces || workspaces.length === 0} value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-[#9aaeb1] bg-white px-3 text-sm text-[#193b3b] focus:border-[#176c67] focus:outline-none focus:ring-2 focus:ring-[#176c67]/20">
          {workspaces.length === 0 && <option value="">{loadingWorkspaces ? 'Carregando…' : 'Nenhum workspace disponível'}</option>}
          {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
      </label>
    </div>

    {workspaces.length > 0 && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-live="polite">
        {cards.map(card => {
          const Icon = card.icon;
          const value = countFor(card.kind, card.state);
          return <article key={card.kind} className="rounded-xl border border-[#e0e9e9] bg-[#f7faf9] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[#52666a]"><Icon size={17} aria-hidden="true"/><span>{card.label}</span></div>
            <p className="mt-3 text-3xl font-bold tabular-nums text-[#193b3b]">{loadingSummary ? '…' : value === null ? '—' : value}</p>
          </article>;
        })}
      </div>
      <p className="mt-3 min-h-5 text-xs text-[#52666a]" role={unavailable ? 'status' : undefined}>
        {loadingSummary ? 'Atualizando indicadores…' : unavailable ? 'Indicadores indisponíveis para este workspace ou perfil.' : summary?.counts.length === 0 ? 'Nenhum indicador foi disponibilizado no escopo atual.' : 'Os valores refletem apenas registros autorizados no workspace selecionado.'}
      </p>
    </>}

    {workspaces.length === 0 && !loadingWorkspaces && <div className="mt-5 rounded-lg bg-[#f7faf9] p-4 text-sm text-[#52666a]">
      <p>{workspaceLoadFailed ? 'Não foi possível carregar os workspaces agora.' : 'Crie ou peça acesso a um workspace para visualizar a operação.'}</p>
      {workspaceLoadFailed && <button type="button" onClick={() => setWorkspaceReload(value => value + 1)} className="mt-2 min-h-10 rounded-lg border border-[#9aaeb1] px-3 font-semibold text-[#193b3b] hover:bg-[#f1f6f5]">Tentar novamente</button>}
    </div>}

    <nav aria-label="Acessos rápidos da Gastro Oceânica" className="mt-4 flex flex-wrap gap-2">
      <Link href="/extensions/gastro-clinic" className="inline-flex min-h-11 items-center rounded-lg bg-[#176c67] px-4 text-sm font-semibold text-white hover:bg-[#125a56]">Abrir cadastros</Link>
      <Link href="/extensions/gastro-clinic?kind=patient" className="inline-flex min-h-11 items-center rounded-lg border border-[#9aaeb1] px-4 text-sm font-semibold text-[#193b3b] hover:bg-[#f1f6f5]">Pessoas atendidas</Link>
      <Link href="/extensions/gastro-clinic?kind=appointment" className="inline-flex min-h-11 items-center rounded-lg border border-[#9aaeb1] px-4 text-sm font-semibold text-[#193b3b] hover:bg-[#f1f6f5]">Agendamentos</Link>
      <Link href="/calendar" className="inline-flex min-h-11 items-center rounded-lg border border-[#9aaeb1] px-4 text-sm font-semibold text-[#193b3b] hover:bg-[#f1f6f5]">Abrir agenda</Link>
      <Link href="/gastro-reports" className="inline-flex min-h-11 items-center rounded-lg border border-[#9aaeb1] px-4 text-sm font-semibold text-[#193b3b] hover:bg-[#f1f6f5]">Relatórios</Link>
      <Link href="/gastro-inventory" className="inline-flex min-h-11 items-center rounded-lg border border-[#9aaeb1] px-4 text-sm font-semibold text-[#193b3b] hover:bg-[#f1f6f5]">Abrir estoque</Link>
      <Link href="/gastro-finance" className="inline-flex min-h-11 items-center rounded-lg border border-[#9aaeb1] px-4 text-sm font-semibold text-[#193b3b] hover:bg-[#f1f6f5]">Abrir financeiro</Link>
    </nav>
  </section>;
}
