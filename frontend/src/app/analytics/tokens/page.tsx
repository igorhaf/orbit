/**
 * Tokens & Performance Analytics Page
 * PROMPT #249 - Split dashboard into dedicated analytics pages
 */

'use client';

import { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { analyticsApi, knowledgeApi } from '@/lib/api';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import type {
  CostAnalyticsResponse,
  CacheStatsResponse,
  AIExecutionStats,
  RagStats,
} from '@/lib/api/analytics';

interface ProjectStats {
  project_id: string;
  project_name: string;
  total_documents: number;
  code_files: number;
  cards: number;
  business_rules: number;
  interview_answers: number;
  project_context: number;
  documents: number;
}

interface ProjectsStatsResponse {
  success: boolean;
  projects: ProjectStats[];
  totals: {
    total_documents: number;
    code_files: number;
    cards: number;
    business_rules: number;
    interview_answers: number;
    project_context: number;
    documents: number;
  };
}

const formatNumber = (num: number) => new Intl.NumberFormat('pt-BR').format(num);

const formatMs = (ms: number | null) => {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const getProviderColor = (provider: string) => {
  const colors: Record<string, string> = {
    anthropic: 'bg-purple-100 text-purple-800',
    openai: 'bg-green-100 text-green-800',
    google: 'bg-blue-100 text-blue-800',
    ollama: 'bg-orange-100 text-orange-800',
  };
  return colors[provider] || 'bg-gray-100 text-gray-800';
};

const getProviderBarColor = (provider: string) => {
  const colors: Record<string, string> = {
    anthropic: 'bg-purple-500',
    openai: 'bg-green-500',
    google: 'bg-blue-500',
    ollama: 'bg-orange-500',
  };
  return colors[provider] || 'bg-gray-500';
};

export default function TokensPage() {
  const [analytics, setAnalytics] = useState<CostAnalyticsResponse | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStatsResponse | null>(null);
  const [execStats, setExecStats] = useState<AIExecutionStats | null>(null);
  const [ragStats, setRagStats] = useState<RagStats | null>(null);
  const [projectsStats, setProjectsStats] = useState<ProjectsStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(7);
  const { rate: usdBrlRate } = useExchangeRate();
  const brlRate = usdBrlRate || 5.70;

  const getDateParams = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - dateRange);
    return { start_date: start.toISOString(), end_date: end.toISOString() };
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const dateParams = getDateParams();
      const [analyticsData, cacheData, execData, ragData, projData] = await Promise.all([
        analyticsApi.getCostAnalytics(dateParams),
        analyticsApi.getCacheStats(),
        analyticsApi.getExecutionStats(dateParams),
        analyticsApi.getRagStats(dateParams),
        knowledgeApi.getProjectsStats(),
      ]);
      setAnalytics(analyticsData);
      setCacheStats(cacheData);
      setExecStats(execData);
      setRagStats(ragData);
      if (projData.success) setProjectsStats(projData);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [dateRange]);

  // Auto-refresh cache stats every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      analyticsApi.getCacheStats().then(setCacheStats).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !analytics) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600" />
        </div>
      </Layout>
    );
  }

  const maxProviderTokens = analytics
    ? Math.max(...analytics.by_provider.map((p) => p.total_tokens), 1)
    : 1;

  const totalExecsByProvider = execStats?.executions_by_provider || {};
  const maxExecCount = Math.max(...Object.values(totalExecsByProvider), 1);
  const totalExecs = Object.values(totalExecsByProvider).reduce((a, b) => a + b, 0) || 1;

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tokens & Desempenho</h1>
            <p className="mt-1 text-sm text-gray-500">
              Consumo de tokens, desempenho de execucao, cache e metricas RAG
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(Number(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value={1}>Ultimas 24 horas</option>
              <option value={7}>Ultimos 7 dias</option>
              <option value={30}>Ultimos 30 dias</option>
              <option value={90}>Ultimos 90 dias</option>
            </select>
            <Button onClick={fetchAll}>Atualizar</Button>
          </div>
        </div>

        {analytics && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Tokens Totais</div>
                  <div className="mt-2 text-3xl font-bold text-purple-700">
                    {formatNumber(analytics.summary.total_tokens)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {formatNumber(analytics.summary.total_input_tokens)} in + {formatNumber(analytics.summary.total_output_tokens)} out
                  </div>
                </div>
              </Card>

              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Total de Execucoes</div>
                  <div className="mt-2 text-3xl font-bold text-blue-700">
                    {formatNumber(analytics.summary.total_executions)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">Chamadas de IA realizadas</div>
                </div>
              </Card>

              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Tempo Medio de Execucao</div>
                  <div className="mt-2 text-3xl font-bold text-orange-600">
                    {formatMs(execStats?.avg_execution_time_ms ?? null)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">Latencia media por chamada</div>
                </div>
              </Card>

              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Taxa de Acerto do Cache</div>
                  <div className="mt-2 text-3xl font-bold text-green-600">
                    {cacheStats?.statistics
                      ? `${(cacheStats.statistics.total.hit_rate * 100).toFixed(1)}%`
                      : '—'}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {cacheStats?.statistics
                      ? `${formatNumber(cacheStats.statistics.total.hits)} hits de ${formatNumber(cacheStats.statistics.total.requests)} requisicoes`
                      : 'Cache indisponivel'}
                  </div>
                </div>
              </Card>
            </div>

            {/* Consumo por Provedor */}
            <Card>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Consumo de Tokens por Provedor</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provedor</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tokens Entrada</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tokens Saida</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Execucoes</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-48">Proporcao</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {analytics.by_provider.map((p) => (
                        <tr key={p.provider} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getProviderColor(p.provider)}`}>
                              {p.provider}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-sm">{formatNumber(p.input_tokens)}</td>
                          <td className="px-4 py-3 text-right text-sm">{formatNumber(p.output_tokens)}</td>
                          <td className="px-4 py-3 text-right text-sm font-medium">{formatNumber(p.total_tokens)}</td>
                          <td className="px-4 py-3 text-right text-sm text-gray-500">{formatNumber(p.execution_count)}</td>
                          <td className="px-4 py-3">
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${getProviderBarColor(p.provider)}`}
                                style={{ width: `${(p.total_tokens / maxProviderTokens) * 100}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>

            {/* Consumo por Tipo de Uso */}
            <Card>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Consumo de Tokens por Tipo de Uso</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo de Uso</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tokens Entrada</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tokens Saida</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Execucoes</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Media/Chamada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {[...analytics.by_usage_type]
                        .sort((a, b) => b.total_tokens - a.total_tokens)
                        .map((u) => (
                          <tr key={u.usage_type} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{u.usage_type}</td>
                            <td className="px-4 py-3 text-right text-sm">{formatNumber(u.input_tokens)}</td>
                            <td className="px-4 py-3 text-right text-sm">{formatNumber(u.output_tokens)}</td>
                            <td className="px-4 py-3 text-right text-sm font-medium">{formatNumber(u.total_tokens)}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-500">{formatNumber(u.execution_count)}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-500">
                              {u.execution_count > 0 ? formatNumber(Math.round(u.total_tokens / u.execution_count)) : '—'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>

            {/* Cache Performance */}
            {cacheStats && (
              <Card>
                <div className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Desempenho do Cache</h2>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      cacheStats.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {cacheStats.enabled ? `Ativo - ${cacheStats.backend.toUpperCase()}` : 'Desabilitado'}
                    </span>
                  </div>

                  {!cacheStats.enabled ? (
                    <div className="text-sm text-gray-500">{cacheStats.message || 'Cache nao esta habilitado'}</div>
                  ) : cacheStats.statistics && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div>
                          <div className="text-sm text-gray-500">Taxa de Acerto Geral</div>
                          <div className="text-2xl font-bold text-green-600">
                            {(cacheStats.statistics.total.hit_rate * 100).toFixed(1)}%
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {formatNumber(cacheStats.statistics.total.hits)} hits / {formatNumber(cacheStats.statistics.total.requests)} requests
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Tokens Economizados</div>
                          <div className="text-2xl font-bold text-purple-600">
                            {formatNumber(cacheStats.statistics.total.tokens_saved)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">Nao enviados para IA</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Custo Economizado</div>
                          <div className="text-2xl font-bold text-blue-600">
                            R$ {(cacheStats.statistics.total.estimated_cost_saved * brlRate).toFixed(2)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">De respostas em cache</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Acertos do Cache</div>
                          <div className="text-2xl font-bold text-gray-900">
                            {formatNumber(cacheStats.statistics.total.hits)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">Recuperacoes bem-sucedidas</div>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h3 className="text-sm font-semibold text-gray-700 mb-3">Niveis de Cache</h3>
                        <div className="space-y-3">
                          {/* L1 */}
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">L1 - Correspondencia Exata</span>
                                <span className="text-xs text-gray-500">(SHA256, 7 dias TTL)</span>
                              </div>
                              <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${cacheStats.statistics.l1_exact_match.hit_rate * 100}%` }} />
                              </div>
                            </div>
                            <div className="ml-4 text-right">
                              <div className="text-sm font-semibold">{(cacheStats.statistics.l1_exact_match.hit_rate * 100).toFixed(1)}%</div>
                              <div className="text-xs text-gray-500">{formatNumber(cacheStats.statistics.l1_exact_match.hits)} hits</div>
                            </div>
                          </div>
                          {/* L2 */}
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">L2 - Semantico</span>
                                <span className="text-xs text-gray-500">(95% similaridade, 1 dia TTL)</span>
                                {!cacheStats.statistics.l2_semantic.enabled && (
                                  <span className="text-xs text-orange-600">(requer Redis)</span>
                                )}
                              </div>
                              <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                                <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${cacheStats.statistics.l2_semantic.hit_rate * 100}%` }} />
                              </div>
                            </div>
                            <div className="ml-4 text-right">
                              <div className="text-sm font-semibold">{(cacheStats.statistics.l2_semantic.hit_rate * 100).toFixed(1)}%</div>
                              <div className="text-xs text-gray-500">{formatNumber(cacheStats.statistics.l2_semantic.hits)} hits</div>
                            </div>
                          </div>
                          {/* L3 */}
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">L3 - Template</span>
                                <span className="text-xs text-gray-500">(Deterministico, 30 dias TTL)</span>
                              </div>
                              <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                                <div className="bg-purple-500 h-2 rounded-full" style={{ width: `${cacheStats.statistics.l3_template.hit_rate * 100}%` }} />
                              </div>
                            </div>
                            <div className="ml-4 text-right">
                              <div className="text-sm font-semibold">{(cacheStats.statistics.l3_template.hit_rate * 100).toFixed(1)}%</div>
                              <div className="text-xs text-gray-500">{formatNumber(cacheStats.statistics.l3_template.hits)} hits</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </Card>
            )}

            {/* RAG Metrics */}
            {ragStats && (
              <Card>
                <div className="p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Metricas RAG</h2>

                  {ragStats.total_rag_enabled === 0 ? (
                    <div className="text-sm text-gray-500 text-center py-8">
                      Nenhuma execucao RAG no periodo selecionado
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div>
                          <div className="text-sm text-gray-500">Total RAG Habilitado</div>
                          <div className="text-2xl font-bold text-gray-900">{formatNumber(ragStats.total_rag_enabled)}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Acertos RAG</div>
                          <div className="text-2xl font-bold text-green-600">{formatNumber(ragStats.total_rag_hits)}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Taxa de Acerto</div>
                          <div className="text-2xl font-bold text-blue-600">{ragStats.hit_rate.toFixed(1)}%</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Tempo Medio Recuperacao</div>
                          <div className="text-2xl font-bold text-orange-600">{formatMs(ragStats.avg_retrieval_time_ms)}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-6">
                        <div>
                          <div className="text-sm text-gray-500">Media de Resultados</div>
                          <div className="text-xl font-semibold text-gray-900">{ragStats.avg_results_count.toFixed(1)}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Similaridade Media Top</div>
                          <div className="text-xl font-semibold text-gray-900">{(ragStats.avg_top_similarity * 100).toFixed(1)}%</div>
                        </div>
                      </div>

                      {ragStats.by_usage_type.length > 0 && (
                        <div className="border-t pt-4">
                          <h3 className="text-sm font-semibold text-gray-700 mb-3">RAG por Tipo de Uso</h3>
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead>
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Acertos</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Taxa</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Similaridade</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Tempo</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {ragStats.by_usage_type.map((r) => (
                                  <tr key={r.usage_type} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 text-sm font-medium text-gray-900">{r.usage_type}</td>
                                    <td className="px-4 py-2 text-right text-sm">{formatNumber(r.total)}</td>
                                    <td className="px-4 py-2 text-right text-sm">{formatNumber(r.hits)}</td>
                                    <td className="px-4 py-2 text-right text-sm">{r.hit_rate.toFixed(1)}%</td>
                                    <td className="px-4 py-2 text-right text-sm">{(r.avg_top_similarity * 100).toFixed(1)}%</td>
                                    <td className="px-4 py-2 text-right text-sm">{formatMs(r.avg_retrieval_time_ms)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Card>
            )}

            {/* Base de Conhecimento RAG — projects comparison */}
            {projectsStats && projectsStats.projects.length > 0 && (
              <Card>
                <div className="p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    Base de Conhecimento RAG
                    <span className="text-sm font-normal text-gray-400 ml-2">({projectsStats.projects.length} projetos)</span>
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Projeto</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Codigo</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cards</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Regras</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Respostas</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Docs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {projectsStats.projects.map((p) => (
                          <tr key={p.project_id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.project_name}</td>
                            <td className="px-4 py-3 text-right text-sm font-bold text-purple-700">{formatNumber(p.total_documents)}</td>
                            <td className="px-4 py-3 text-right text-sm text-blue-600">{formatNumber(p.code_files)}</td>
                            <td className="px-4 py-3 text-right text-sm text-green-600">{formatNumber(p.cards)}</td>
                            <td className="px-4 py-3 text-right text-sm text-orange-600">{formatNumber(p.business_rules)}</td>
                            <td className="px-4 py-3 text-right text-sm text-yellow-600">{formatNumber(p.interview_answers)}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-600">{formatNumber(p.documents)}</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-semibold">
                          <td className="px-4 py-3 text-sm text-gray-900">TOTAL</td>
                          <td className="px-4 py-3 text-right text-sm text-purple-700">{formatNumber(projectsStats.totals.total_documents)}</td>
                          <td className="px-4 py-3 text-right text-sm text-blue-600">{formatNumber(projectsStats.totals.code_files)}</td>
                          <td className="px-4 py-3 text-right text-sm text-green-600">{formatNumber(projectsStats.totals.cards)}</td>
                          <td className="px-4 py-3 text-right text-sm text-orange-600">{formatNumber(projectsStats.totals.business_rules)}</td>
                          <td className="px-4 py-3 text-right text-sm text-yellow-600">{formatNumber(projectsStats.totals.interview_answers)}</td>
                          <td className="px-4 py-3 text-right text-sm text-gray-600">{formatNumber(projectsStats.totals.documents)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-400">
                    <span>Codigo = Arquivos indexados</span>
                    <span>Cards = Epicos, Stories, Tasks, Subtasks</span>
                    <span>Regras = Regras de negocio</span>
                    <span>Respostas = Entrevistas</span>
                    <span>Docs = Documentos enviados</span>
                  </div>
                </div>
              </Card>
            )}

            {/* Execuções por Provedor - horizontal bars */}
            {execStats && Object.keys(totalExecsByProvider).length > 0 && (
              <Card>
                <div className="p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Execucoes por Provedor</h2>
                  <div className="space-y-3">
                    {Object.entries(totalExecsByProvider)
                      .sort(([, a], [, b]) => b - a)
                      .map(([provider, count]) => (
                        <div key={provider} className="flex items-center gap-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full min-w-[80px] justify-center ${getProviderColor(provider)}`}>
                            {provider}
                          </span>
                          <div className="flex-1">
                            <div className="w-full bg-gray-100 rounded-full h-5">
                              <div
                                className={`h-5 rounded-full flex items-center px-2 ${getProviderBarColor(provider)}`}
                                style={{ width: `${Math.max((count / maxExecCount) * 100, 5)}%` }}
                              >
                                <span className="text-xs font-medium text-white">{formatNumber(count)}</span>
                              </div>
                            </div>
                          </div>
                          <span className="text-sm text-gray-500 min-w-[50px] text-right">
                            {((count / totalExecs) * 100).toFixed(1)}%
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
