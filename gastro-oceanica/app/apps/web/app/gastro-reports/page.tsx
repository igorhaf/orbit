'use client';

import { useEffect, useState } from 'react';
import { AccessShell, accessButton, accessInput, accessPanel } from '@/components/access-shell';
import { api, getToken, type User, type Workspace } from '@/lib/api';
import { reportDateRange, type ReportPeriodPreset } from '@/lib/gastro-report-period';

type GroupBy = 'patient' | 'insurance' | 'service' | 'professional';
type ReportKind = 'completed' | 'patient_absences';
type ReportGroup = { label: string; count: number; subgroups?: Array<{ label: string; count: number }> };
type Report = { report_type: ReportKind; from: string | null; through: string; period_mode: 'range' | 'all'; group_by: GroupBy; subgroup_by: GroupBy | null; total: number; generated_at: string; groups: ReportGroup[] };
const groupLabels: Record<GroupBy, string> = { patient: 'Pessoa atendida', insurance: 'Convênio', service: 'Procedimento/serviço', professional: 'Profissional' };
const initialRange = reportDateRange('month')!;

export default function GastroReportsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [from, setFrom] = useState(initialRange.from);
  const [through, setThrough] = useState(initialRange.through);
  const [periodPreset, setPeriodPreset] = useState<ReportPeriodPreset>('month');
  const [reportKind, setReportKind] = useState<ReportKind>('completed');
  const [groupBy, setGroupBy] = useState<GroupBy>('insurance');
  const [subgroupBy, setSubgroupBy] = useState<GroupBy | ''>('');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) return;
    let active = true;
    Promise.all([api<User>('/auth/me'), api<Workspace[]>('/workspaces')]).then(([account, spaces]) => {
      if (!active) return;
      setUser(account);
      setWorkspaces(spaces);
      setWorkspace(spaces[0]?.id || '');
    }).catch(reason => { if (active) setError((reason as Error).message); });
    return () => { active = false; };
  }, []);

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    setBusy(true); setError(''); setReport(null);
    try {
      const query = new URLSearchParams({ from, through, group_by: groupBy });
      if (periodPreset === 'all') query.set('period_mode', 'all');
      if (reportKind === 'completed' && subgroupBy) query.set('sub_group_by', subgroupBy);
      const route = reportKind === 'completed' ? 'completed-appointments' : 'patient-absences';
      setReport(await api<Report>(`/gastro-reports/workspaces/${encodeURIComponent(workspace)}/${route}?${query}`));
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function selectPeriod(value: ReportPeriodPreset) {
    setPeriodPreset(value);
    const range = reportDateRange(value);
    if (range) { setFrom(range.from); setThrough(range.through); }
    setReport(null);
  }

  function selectReportKind(value: ReportKind) {
    setReportKind(value);
    setReport(null);
    if (value === 'patient_absences') {
      setGroupBy('patient'); setSubgroupBy(''); selectPeriod('last7');
    } else selectPeriod('month');
  }

  const rows = report?.groups.flatMap(group => report.subgroup_by
    ? (group.subgroups || []).map(subgroup => ({ primary: group.label, secondary: subgroup.label, count: subgroup.count }))
    : [{ primary: group.label, secondary: '', count: group.count }]) || [];

  return <AccessShell user={user} title="Relatórios administrativos">
    <p className="text-sm text-[#44546f]">Consulte totais administrativos derivados do estado atual dos agendamentos. Os relatórios não alteram registros.</p>
    <p className="rounded-lg border border-[#9aaeb1] bg-[#f1f6f5] p-3 text-sm text-[#193b3b]">Período interpretado em UTC, incluindo o dia inicial e o dia final. O relatório completo é limitado a 5.000 atendimentos e falha se exceder esse limite. O agrupamento respeita o acesso a cada agendamento e cadastro relacionado; ao agrupar por pessoa, só aparece o título do cadastro autorizado. Relatórios não representam faturamento nem critérios clínicos.</p>
    {error && <p role="alert" className="rounded-lg bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
    <form onSubmit={generate} className={`${accessPanel} grid gap-3 sm:grid-cols-2 lg:grid-cols-3`}>
      <label className="text-sm font-semibold">Relatório
        <select aria-label="Tipo de relatório" className={accessInput} value={reportKind} onChange={event => selectReportKind(event.target.value as ReportKind)}>
          <option value="completed">Atendimentos realizados</option><option value="patient_absences">Faltas por pessoa atendida</option>
        </select>
      </label>
      <label className="text-sm font-semibold">Workspace
        <select aria-label="Selecionar workspace do relatório" className={accessInput} required value={workspace} onChange={event => { setWorkspace(event.target.value); setReport(null); }}>
          <option value="">Selecione um workspace</option>
          {workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="text-sm font-semibold">Período
        <select aria-label="Período do relatório" className={accessInput} value={periodPreset} onChange={event => selectPeriod(event.target.value as ReportPeriodPreset)}>
          {reportKind === 'patient_absences' ? <><option value="today">Hoje</option><option value="last7">Últimos 7 dias</option><option value="last30">Últimos 30 dias</option><option value="custom">Personalizado</option></> : <><option value="today">Hoje</option><option value="week">Esta semana</option><option value="month">Este mês</option><option value="last30">Últimos 30 dias</option><option value="all">Todos</option><option value="custom">Personalizado</option></>}
        </select>
      </label>
      {periodPreset === 'all' ? <div className="flex items-end text-sm text-[#626f86]">Todos os registros disponíveis no workspace.</div> : <>
        <label className="text-sm font-semibold">Data inicial (UTC)<input required type="date" className={accessInput} value={from} onChange={event => { setFrom(event.target.value); setPeriodPreset('custom'); setReport(null); }}/></label>
        <label className="text-sm font-semibold">Data final (UTC)<input required type="date" className={accessInput} value={through} onChange={event => { setThrough(event.target.value); setPeriodPreset('custom'); setReport(null); }}/></label>
      </>}
      {reportKind === 'completed' && <label className="text-sm font-semibold">Agrupar por
        <select aria-label="Agrupamento principal" className={accessInput} value={groupBy} onChange={event => { setGroupBy(event.target.value as GroupBy); if (event.target.value === subgroupBy) setSubgroupBy(''); setReport(null); }}>
          {Object.entries(groupLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      }
      {reportKind === 'completed' && <label className="text-sm font-semibold">Subagrupar por (opcional)
        <select aria-label="Subagrupamento opcional" className={accessInput} value={subgroupBy} onChange={event => { setSubgroupBy(event.target.value as GroupBy | ''); setReport(null); }}>
          <option value="">Sem subagrupamento</option>
          {Object.entries(groupLabels).map(([value, label]) => <option key={value} value={value} disabled={value === groupBy}>{label}</option>)}
        </select>
      </label>
      }
      <button className={`${accessButton} self-end`} disabled={busy || !workspace}>{busy ? 'Consultando…' : 'Gerar relatório'}</button>
    </form>

    {report && <section className={`${accessPanel} space-y-4`} aria-live="polite">
      <div><h2 className="text-lg font-bold">{report.report_type === 'completed' ? 'Atendimentos realizados' : 'Faltas por pessoa atendida'}</h2><p className="text-sm text-[#626f86]">{report.period_mode === 'all' ? `Todo o histórico até ${new Date(`${report.through}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : `${new Date(`${report.from}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} a ${new Date(`${report.through}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`} · agrupado por {groupLabels[report.group_by]}{report.subgroup_by ? ` e ${groupLabels[report.subgroup_by]}` : ''} · {report.total} registros autorizados.</p></div>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[420px] border-collapse text-left text-sm"><thead><tr className="border-b"><th scope="col" className="p-2">{groupLabels[report.group_by]}</th>{report.subgroup_by && <th scope="col" className="p-2">{groupLabels[report.subgroup_by]}</th>}<th scope="col" className="p-2 text-right">Quantidade</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.primary}:${row.secondary}:${index}`} className="border-b"><th scope="row" className="p-2 font-medium">{row.primary}</th>{report.subgroup_by && <td className="p-2">{row.secondary}</td>}<td className="p-2 text-right tabular-nums">{row.count}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={report.subgroup_by ? 2 : 1} className="p-2">Total</th><td className="p-2 text-right font-semibold tabular-nums">{report.total}</td></tr></tfoot></table></div> : <p className="text-sm text-[#626f86]">Nenhum registro autorizado foi encontrado neste período.</p>}
      <p className="text-xs text-[#626f86]">Consulta gerada em {new Date(report.generated_at).toLocaleString('pt-BR')}.</p>
    </section>}
  </AccessShell>;
}
