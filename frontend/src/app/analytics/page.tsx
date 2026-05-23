/**
 * Analytics unificado — tokens, custos, cache e RAG num so lugar.
 * Substitui as paginas separadas /analytics/tokens e /analytics/costs (mantidas como redirects).
 */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Spinner } from '@/components/ui';
import {
  analyticsApi,
  knowledgeApi,
  CostAnalyticsResponse,
  CacheStatsResponse,
  AIExecutionStats,
  RagStats,
  ProjectsStatsResponse,
} from '@/lib/api';
import { useExchangeRate } from '@/hooks/useExchangeRate';

const RANGES = [
  { value: 1, label: 'Hoje' },
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
];

function fmtBRL(usd: number, brlRate: number): string {
  return (usd * brlRate).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString('pt-BR');
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

interface KpiProps {
  label: string;
  value: string;
  hint?: string;
  trend?: number | null;
  accent?: 'blue' | 'purple' | 'green' | 'amber' | 'gray';
}

function KpiCard({ label, value, hint, accent = 'gray' }: KpiProps) {
  const cls: Record<string, string> = {
    blue: 'border-blue-100 bg-blue-50/40',
    purple: 'border-purple-100 bg-purple-50/40',
    green: 'border-green-100 bg-green-50/40',
    amber: 'border-amber-100 bg-amber-50/40',
    gray: 'border-gray-100 bg-white',
  };
  return (
    <div className={`rounded-xl border ${cls[accent]} p-4`}>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

function HorizontalBar({ label, value, max, suffix, color = 'bg-blue-500' }: {
  label: string; value: number; max: number; suffix?: string; color?: string;
}) {
  const pctW = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-700">{label}</span>
        <span className="text-gray-600 font-medium">
          {fmtNum(value)}{suffix ? ` ${suffix}` : ''}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pctW}%` }} />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState(7);
  const [loading, setLoading] = useState(true);
  const [cost, setCost] = useState<CostAnalyticsResponse | null>(null);
  const [cache, setCache] = useState<CacheStatsResponse | null>(null);
  const [execs, setExecs] = useState<AIExecutionStats | null>(null);
  const [rag, setRag] = useState<RagStats | null>(null);
  const [projects, setProjects] = useState<ProjectsStatsResponse | null>(null);
  const { rate: usdBrlRate } = useExchangeRate();
  const brlRate = usdBrlRate || 5.7;

  const dateParams = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - dateRange);
    return { start_date: start.toISOString(), end_date: end.toISOString() };
  }, [dateRange]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.allSettled([
      analyticsApi.getCostAnalytics(dateParams),
      analyticsApi.getCacheStats(),
      analyticsApi.getExecutionStats(dateParams),
      analyticsApi.getRagStats(dateParams),
      knowledgeApi.getProjectsStats(),
    ]).then((res) => {
      if (!active) return;
      if (res[0].status === 'fulfilled') setCost(res[0].value);
      if (res[1].status === 'fulfilled') setCache(res[1].value);
      if (res[2].status === 'fulfilled') setExecs(res[2].value);
      if (res[3].status === 'fulfilled') setRag(res[3].value);
      if (res[4].status === 'fulfilled' && res[4].value?.success) setProjects(res[4].value);
      setLoading(false);
    });
    return () => { active = false; };
  }, [dateRange]);

  // refresh cache a cada 30s
  useEffect(() => {
    const id = setInterval(() => {
      analyticsApi.getCacheStats().then(setCache).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const totalCostUsd = cost?.summary?.total_cost_usd || 0;
  const totalTokens = (cost?.summary?.total_input_tokens || 0) + (cost?.summary?.total_output_tokens || 0);
  const cacheHits = cache?.statistics?.total?.hit_rate || 0;
  const tokensSaved = cache?.statistics?.total?.tokens_saved || 0;
  const costSaved = cache?.statistics?.total?.estimated_cost_saved || 0;
  const avgExecMs = execs?.avg_execution_time_ms || 0;

  const maxProviderTokens = useMemo(() => {
    if (!cost?.by_provider?.length) return 1;
    return Math.max(...cost.by_provider.map((p: any) => p.total_tokens), 1);
  }, [cost]);

  const maxProviderCost = useMemo(() => {
    if (!cost?.by_provider?.length) return 1;
    return Math.max(...cost.by_provider.map((p: any) => p.total_cost_usd), 1);
  }, [cost]);

  if (loading && !cost) {
    return (
      <Layout>
        <Breadcrumbs />
        <Spinner.Block label="Carregando analytics..." size="xl" />
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
            <p className="mt-1 text-sm text-gray-500">
              Consumo de tokens, custos, cache e desempenho num panorama unificado.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(Number(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <button
              onClick={() => { setDateRange(dateRange); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              title="Recarregar"
            >
              ↻
            </button>
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Custo total"
            value={fmtBRL(totalCostUsd, brlRate)}
            hint={`US$ ${totalCostUsd.toFixed(4)}`}
            accent="purple"
          />
          <KpiCard
            label="Tokens consumidos"
            value={fmtNum(totalTokens)}
            hint={`${fmtNum(cost?.summary?.total_input_tokens || 0)} in · ${fmtNum(cost?.summary?.total_output_tokens || 0)} out`}
            accent="blue"
          />
          <KpiCard
            label="Cache hit rate"
            value={pct(cacheHits)}
            hint={`${fmtNum(tokensSaved)} tokens economizados`}
            accent="green"
          />
          <KpiCard
            label="Latencia media"
            value={avgExecMs > 0 ? `${(avgExecMs / 1000).toFixed(1)}s` : '-'}
            hint={`${execs?.total_executions ?? 0} execucoes`}
            accent="amber"
          />
        </div>

        {/* Two columns: tokens (left) / costs (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tokens por provedor */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Tokens por provedor</h2>
              <Link href="/ai-executions" className="text-xs text-blue-600 hover:underline">
                ver execucoes
              </Link>
            </div>
            {cost?.by_provider?.length ? (
              <div className="space-y-3">
                {cost.by_provider.map((p: any) => (
                  <HorizontalBar
                    key={p.provider}
                    label={p.provider}
                    value={p.total_tokens}
                    max={maxProviderTokens}
                    suffix="tokens"
                    color="bg-blue-500"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Sem dados no periodo.</p>
            )}
          </div>

          {/* Custo por provedor */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Custo por provedor</h2>
              <span className="text-xs text-gray-500">USD → BRL @ {brlRate.toFixed(2)}</span>
            </div>
            {cost?.by_provider?.length ? (
              <div className="space-y-3">
                {cost.by_provider.map((p: any) => (
                  <HorizontalBar
                    key={p.provider}
                    label={p.provider}
                    value={p.total_cost_usd * brlRate}
                    max={maxProviderCost * brlRate}
                    suffix="BRL"
                    color="bg-purple-500"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Sem dados no periodo.</p>
            )}
          </div>

          {/* Por usage_type — tokens */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Tokens por uso</h2>
            {cost?.by_usage_type?.length ? (
              <div className="space-y-3">
                {cost.by_usage_type.map((u: any) => (
                  <HorizontalBar
                    key={u.usage_type}
                    label={u.usage_type}
                    value={u.total_tokens}
                    max={Math.max(...cost.by_usage_type.map((x: any) => x.total_tokens), 1)}
                    suffix="tokens"
                    color="bg-cyan-500"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Sem dados no periodo.</p>
            )}
          </div>

          {/* Cache + RAG */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Cache & RAG</h2>
            {cache?.statistics ? (
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-gray-100 p-3">
                  <div className="text-xs text-gray-500">L1 exato</div>
                  <div className="text-lg font-semibold">{pct(cache.statistics.l1_exact_match.hit_rate)}</div>
                  <div className="text-xs text-gray-400">{fmtNum(cache.statistics.l1_exact_match.hits)} hits</div>
                </div>
                <div className="rounded-lg border border-gray-100 p-3">
                  <div className="text-xs text-gray-500">L2 semantico</div>
                  <div className="text-lg font-semibold">{pct(cache.statistics.l2_semantic.hit_rate)}</div>
                  <div className="text-xs text-gray-400">
                    {cache.statistics.l2_semantic.enabled ? `${fmtNum(cache.statistics.l2_semantic.hits)} hits` : 'desabilitado'}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 p-3">
                  <div className="text-xs text-gray-500">L3 template</div>
                  <div className="text-lg font-semibold">{pct(cache.statistics.l3_template.hit_rate)}</div>
                  <div className="text-xs text-gray-400">{fmtNum(cache.statistics.l3_template.hits)} hits</div>
                </div>
                <div className="col-span-3 rounded-lg border border-green-100 bg-green-50/50 p-3">
                  <div className="text-xs text-gray-600">Economia estimada (cache)</div>
                  <div className="text-base font-semibold text-green-700">
                    {fmtBRL(costSaved, brlRate)} · {fmtNum(tokensSaved)} tokens
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Cache desabilitado ou sem dados.</p>
            )}
            {rag && (
              <div className="border-t border-gray-100 pt-3">
                <div className="text-xs text-gray-500 mb-1">RAG</div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span><span className="text-gray-500">Hit rate:</span> <strong>{pct(rag.hit_rate || 0)}</strong></span>
                  <span><span className="text-gray-500">Similaridade media:</span> <strong>{(rag.avg_top_similarity || 0).toFixed(3)}</strong></span>
                  <span><span className="text-gray-500">Latencia:</span> <strong>{Math.round(rag.avg_retrieval_time_ms || 0)}ms</strong></span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tendencia diaria */}
        {cost?.daily_costs?.length ? (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Tendencia diaria</h2>
            <div className="space-y-1.5">
              {cost.daily_costs.map((d: any) => {
                const maxDaily = Math.max(...cost.daily_costs.map((x: any) => x.cost_usd), 1);
                const w = (d.cost_usd / maxDaily) * 100;
                return (
                  <div key={d.date} className="flex items-center gap-3 text-sm">
                    <span className="text-xs text-gray-500 w-24">{d.date}</span>
                    <div className="flex-1 h-3 rounded bg-gray-100 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-400 to-purple-500" style={{ width: `${w}%` }} />
                    </div>
                    <span className="text-xs text-gray-700 font-medium w-24 text-right">
                      {fmtBRL(d.cost_usd, brlRate)}
                    </span>
                    <span className="text-xs text-gray-500 w-20 text-right">
                      {fmtNum((d.input_tokens || 0) + (d.output_tokens || 0))} tok
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Projects breakdown se disponivel */}
        {projects && (projects as any).by_project?.length ? (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Por projeto</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">Projeto</th>
                    <th className="py-2 pr-3 text-right">Tokens</th>
                    <th className="py-2 pr-3 text-right">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {(projects as any).by_project.slice(0, 10).map((p: any) => (
                    <tr key={p.project_id} className="border-b border-gray-50">
                      <td className="py-2 pr-3 text-gray-800">{p.name || p.project_id?.slice(0, 8)}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{fmtNum(p.total_tokens || 0)}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{fmtBRL(p.total_cost_usd || 0, brlRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
