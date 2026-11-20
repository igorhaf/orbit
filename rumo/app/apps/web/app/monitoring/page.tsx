'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, RefreshCw, Save, TriangleAlert } from 'lucide-react';
import { api, Board, getToken, User } from '@/lib/api';
import { AppHeader, WorkspaceSidebar } from '@/components/ui';

type AlertProfile = {
  role_id: string;
  role_name: string;
  enabled: boolean;
  minimum_requests: number;
  failure_rate_percent: number;
  route_latency_ms: number;
  queue_failures: boolean;
  backup_failures: boolean;
  outbound_mail_failures: boolean;
};
type MonitoringSnapshot = {
  status: 'ok' | 'degraded';
  startedAt: string;
  uptimeSeconds: number;
  dependencies: Record<string, string>;
  requestMetrics: { retention: string; seriesLimit: number; routes: Array<{ route: string; count: number; successes: number; errors: number; averageLatencyMs: number; maxLatencyMs: number }> };
  operationalMetrics: {
    window: string;
    queues: { status: string; byKindAndStatus: Array<{ kind: string; status: string; count: number; average_duration_ms: number }> };
    backups: { status: string; byKindAndStatus: Array<{ kind: string; status: string; count: number }> };
    blindedAccesses: { status: string; count: number };
    documentEvents: { status: string; count: number };
    documentGeneration: { status: string; successes: number; failures: number };
    outboundMail: { status: string; attempts: number; failures: number };
  };
  alertProfiles: { status: string };
  alerts: Array<{ profile_id: string; code: string; severity: 'warning' | 'critical'; route?: string }>;
};

function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <article className="rounded-xl border border-[#dfe1e6] bg-white p-4">
    <h2 className="text-sm font-semibold text-[#626f86]">{label}</h2>
    <p className="mt-2 text-2xl font-bold text-[#172b4d]">{value}</p>
    {detail && <p className="mt-1 text-xs text-[#626f86]">{detail}</p>}
  </article>;
}

export default function MonitoringPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [profiles, setProfiles] = useState<AlertProfile[]>([]);
  const [profileLoadError, setProfileLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyRole, setBusyRole] = useState('');
  const canWrite = Boolean(user?.is_root || user?.permissions?.includes('monitoring.write'));

  const load = useCallback(async () => {
    setError('');
    const [me, allBoards, metrics] = await Promise.all([
      api<User>('/auth/me'), api<Board[]>('/boards'), api<MonitoringSnapshot>('/monitoring'),
    ]);
    setUser(me);
    setBoards(allBoards);
    setSnapshot(metrics);
    if (metrics.alertProfiles.status !== 'available') {
      setProfiles([]);
      setProfileLoadError('A configuração de alertas ainda não está habilitada no banco DEV. O código está pronto; a migration aguarda a etapa autorizada de backup.');
      return;
    }
    try {
      const configured = await api<AlertProfile[]>('/monitoring/alert-profiles');
      setProfiles(configured);
      setProfileLoadError('');
    } catch (reason) {
      setProfiles([]);
      setProfileLoadError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!getToken()) { router.push('/'); return; }
      void load().catch(reason => setError((reason as Error).message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, router]);

  function changeProfile(roleId: string, patch: Partial<AlertProfile>) {
    setProfiles(current => current.map(profile => profile.role_id === roleId ? { ...profile, ...patch } : profile));
  }

  async function save(profile: AlertProfile) {
    setBusyRole(profile.role_id);
    setError('');
    setMessage('');
    try {
      await api(`/monitoring/alert-profiles/${encodeURIComponent(profile.role_id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: profile.enabled,
          minimum_requests: Number(profile.minimum_requests),
          failure_rate_percent: Number(profile.failure_rate_percent),
          route_latency_ms: Number(profile.route_latency_ms),
          queue_failures: profile.queue_failures,
          backup_failures: profile.backup_failures,
          outbound_mail_failures: profile.outbound_mail_failures,
        }),
      });
      setMessage(`Alertas do perfil “${profile.role_name}” salvos.`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusyRole('');
    }
  }

  const metrics = snapshot?.operationalMetrics;
  const requestCount = snapshot?.requestMetrics.routes.reduce((total, route) => total + route.count, 0) || 0;
  const requestErrors = snapshot?.requestMetrics.routes.reduce((total, route) => total + route.errors, 0) || 0;
  const failedQueues = metrics?.queues.byKindAndStatus.filter(row => ['error', 'failed'].includes(row.status)).reduce((total, row) => total + row.count, 0) || 0;
  const failedBackups = metrics?.backups.byKindAndStatus.filter(row => row.status === 'failed').reduce((total, row) => total + row.count, 0) || 0;

  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
    <AppHeader user={user} boards={boards}/>
    <div className="flex min-h-0 flex-1">
      <WorkspaceSidebar boards={boards} onCreate={() => router.push('/boards?create=1')} onChoose={id => router.push(id ? `/board/${id}` : '/boards')}/>
      <main className="min-w-0 flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Activity className="text-[#0c66e4]"/>Monitoramento</h1><p className="mt-1 text-sm text-[#626f86]">Saúde operacional, falhas e alertas associados aos perfis de acesso.</p></div>
            <button type="button" onClick={() => void load().catch(reason => setError((reason as Error).message))} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#c1c7d0] bg-white px-3 text-sm font-semibold"><RefreshCw size={16}/>Atualizar</button>
          </header>
          {error && <p role="alert" className="rounded-lg bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
          {message && <p role="status" className="rounded-lg bg-[#dcfff1] p-3 text-sm text-[#216e4e]">{message}</p>}
          {snapshot && <>
            <section aria-label="Resumo operacional" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="API" value={snapshot.status === 'ok' ? 'Saudável' : 'Degradada'} detail={`Iniciada ${new Date(snapshot.startedAt).toLocaleString('pt-BR')}`}/>
              <Metric label="Dependências" value={Object.values(snapshot.dependencies).every(value => value === 'ok') ? 'Disponíveis' : 'Com falhas'} detail={Object.entries(snapshot.dependencies).map(([name, state]) => `${name}: ${state}`).join(' · ')}/>
              <Metric label="Requisições HTTP" value={requestCount} detail={`${requestErrors} respostas 5xx · ${snapshot.requestMetrics.retention}`}/>
              <Metric label="Alertas ativos" value={snapshot.alerts.length} detail={`${snapshot.alerts.filter(alert => alert.severity === 'critical').length} críticos · ${snapshot.alerts.filter(alert => alert.severity === 'warning').length} avisos`}/>
              <Metric label="Falhas de fila" value={metrics?.queues.status === 'available' ? failedQueues : 'Indisponível'} detail="Janela dos últimos 30 dias"/>
              <Metric label="Falhas de backup" value={metrics?.backups.status === 'available' ? failedBackups : 'Indisponível'} detail="Janela dos últimos 30 dias"/>
              <Metric label="Acessos cegados" value={metrics?.blindedAccesses.status === 'available' ? metrics.blindedAccesses.count : 'Indisponível'} detail="Eventos de auditoria, sem dados do processo"/>
              <Metric label="Geração documental" value={metrics?.documentGeneration.status === 'available' ? metrics.documentGeneration.successes : 'Indisponível'} detail={`${metrics?.documentGeneration.failures ?? 0} falhas · eventos de auditoria, sem conteúdo`}/>
              <Metric label="E-mail de saída" value={metrics?.outboundMail.status === 'available' ? metrics.outboundMail.failures : 'Indisponível'} detail={`${metrics?.outboundMail.attempts ?? 0} tentativas · falhas na janela`}/>
            </section>

            <section className="rounded-xl border border-[#dfe1e6] bg-white p-4 sm:p-5">
              <div className="mb-4"><h2 className="text-lg font-bold">Alertas por perfil</h2><p className="text-sm text-[#626f86]">Cada perfil define seus próprios limites. Os privilégios de leitura e gravação são conferidos pela API.</p></div>
              {profileLoadError && <p role="status" className="mb-4 flex items-start gap-2 rounded-lg bg-[#fff7d6] p-3 text-sm text-[#7f5f01]"><TriangleAlert size={17} className="mt-0.5 shrink-0"/>{profileLoadError.includes('monitoring_alert_profiles') ? 'A configuração de alertas ainda não está habilitada no banco DEV. O código está pronto; a migration aguarda a etapa autorizada de backup.' : profileLoadError}</p>}
              {profiles.length === 0 && !profileLoadError && <p className="text-sm text-[#626f86]">Nenhum perfil de acesso encontrado.</p>}
              <div className="space-y-4">{profiles.map(profile => <article key={profile.role_id} className="rounded-lg border border-[#dfe1e6] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="font-semibold">{profile.role_name}</h3><p className="text-xs text-[#626f86]">{profile.role_id}</p></div>
                  <button type="button" role="switch" aria-checked={profile.enabled} disabled={!canWrite || busyRole === profile.role_id} onClick={() => changeProfile(profile.role_id, { enabled: !profile.enabled })} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold ${profile.enabled ? 'bg-[#dcfff1] text-[#216e4e]' : 'bg-[#f1f2f4] text-[#44546f]'} disabled:cursor-not-allowed disabled:opacity-60`}><span aria-hidden="true" className={`h-3 w-3 rounded-full ${profile.enabled ? 'bg-[#22a06b]' : 'bg-[#8590a2]'}`}/>{profile.enabled ? 'Alertas ligados' : 'Alertas desligados'}</button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="grid gap-1 text-sm">Mínimo de requisições<input type="number" min={1} max={100000} disabled={!canWrite} value={profile.minimum_requests} onChange={event => changeProfile(profile.role_id, { minimum_requests: Number(event.target.value) })} className="min-h-11 rounded-lg border border-[#c1c7d0] px-3"/></label>
                  <label className="grid gap-1 text-sm">Taxa de falha (%)<input type="number" min={0} max={100} step={0.1} disabled={!canWrite} value={profile.failure_rate_percent} onChange={event => changeProfile(profile.role_id, { failure_rate_percent: Number(event.target.value) })} className="min-h-11 rounded-lg border border-[#c1c7d0] px-3"/></label>
                  <label className="grid gap-1 text-sm">Latência máxima (ms)<input type="number" min={1} max={600000} disabled={!canWrite} value={profile.route_latency_ms} onChange={event => changeProfile(profile.role_id, { route_latency_ms: Number(event.target.value) })} className="min-h-11 rounded-lg border border-[#c1c7d0] px-3"/></label>
                  <div className="flex flex-wrap gap-3 sm:col-span-2 xl:col-span-1">{([['queue_failures','Falhas em filas'],['backup_failures','Falhas em backups'],['outbound_mail_failures','Falhas de e-mail']] as const).map(([field,label]) => <label key={field} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={!canWrite} checked={profile[field]} onChange={event => changeProfile(profile.role_id, { [field]: event.target.checked })}/>{label}</label>)}</div>
                </div>
                {canWrite && <button type="button" disabled={Boolean(busyRole)} onClick={() => void save(profile)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#0c66e4] px-4 font-semibold text-white disabled:opacity-60"><Save size={16}/>{busyRole === profile.role_id ? 'Salvando…' : 'Salvar perfil'}</button>}
              </article>)}</div>
              {!canWrite && profiles.length > 0 && <p className="mt-3 text-sm text-[#626f86]">Seu perfil pode consultar os alertas, mas não alterar as regras.</p>}
            </section>

            <section className="rounded-xl border border-[#dfe1e6] bg-white p-4 sm:p-5">
              <h2 className="mb-3 text-lg font-bold">Alertas ativos</h2>
              {snapshot.alerts.length === 0 ? <p className="text-sm text-[#626f86]">Nenhum alerta para os perfis associados à sua conta.</p> : <ul className="space-y-2">{snapshot.alerts.map((alert, index) => <li key={`${alert.profile_id}-${alert.code}-${alert.route || index}`} className="rounded-lg bg-[#f7f8fa] p-3 text-sm"><strong>{alert.severity === 'critical' ? 'Crítico' : 'Aviso'}</strong> · {alert.code} · perfil {alert.profile_id}{alert.route && ` · ${alert.route}`}</li>)}</ul>}
            </section>
          </>}
        </div>
      </main>
    </div>
  </div>;
}
