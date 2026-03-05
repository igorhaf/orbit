/**
 * Financial Costs Analytics Page
 * PROMPT #249 - Split dashboard into dedicated analytics pages
 */

'use client';

import { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { analyticsApi } from '@/lib/api';
import type {
  CostAnalyticsResponse,
  CacheStatsResponse,
  ExecutionWithCost,
} from '@/lib/api/analytics';

const formatNumber = (num: number) => new Intl.NumberFormat('pt-BR').format(num);

const formatCost = (cost: number) => {
  if (cost < 0.0001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
};

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatShortDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

const getProviderColor = (provider: string) => {
  const colors: Record<string, string> = {
    anthropic: 'bg-purple-100 text-purple-800',
    openai: 'bg-green-100 text-green-800',
    google: 'bg-blue-100 text-blue-800',
    ollama: 'bg-orange-100 text-orange-800',
  };
  return colors[provider] || 'bg-gray-100 text-gray-800';
};

const getStatusColor = (status: string) => {
  if (status === 'success' || status === 'completed') return 'bg-green-100 text-green-800';
  if (status === 'error' || status === 'failed') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-800';
};

export default function CostsPage() {
  const [analytics, setAnalytics] = useState<CostAnalyticsResponse | null>(null);
  const [trendData, setTrendData] = useState<CostAnalyticsResponse | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStatsResponse | null>(null);
  const [executions, setExecutions] = useState<ExecutionWithCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(7);
  const [filterProvider, setFilterProvider] = useState<string>('');
  const [filterUsageType, setFilterUsageType] = useState<string>('');
  const execLimit = 5;

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
      const costParams = {
        ...dateParams,
        ...(filterProvider ? { provider: filterProvider } : {}),
        ...(filterUsageType ? { usage_type: filterUsageType } : {}),
      };
      // Fixed 30-day window for daily trend chart
      const trendEnd = new Date();
      const trendStart = new Date();
      trendStart.setDate(trendStart.getDate() - 30);
      const trendParams = { start_date: trendStart.toISOString(), end_date: trendEnd.toISOString() };

      const [analyticsData, trend30d, cacheData, execData] = await Promise.all([
        analyticsApi.getCostAnalytics(costParams),
        analyticsApi.getCostAnalytics(trendParams),
        analyticsApi.getCacheStats(),
        analyticsApi.getExecutionsWithCost({
          limit: execLimit,
          ...(filterProvider ? { provider: filterProvider } : {}),
          ...(filterUsageType ? { usage_type: filterUsageType } : {}),
        }),
      ]);
      setAnalytics(analyticsData);
      setTrendData(trend30d);
      setCacheStats(cacheData);
      setExecutions(execData);
    } catch (error) {
      console.error('Error fetching cost analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [dateRange, filterProvider, filterUsageType]);

  // Unique providers & usage types for filters
  const providers = analytics ? [...new Set(analytics.by_provider.map((p) => p.provider))] : [];
  const usageTypes = analytics ? [...new Set(analytics.by_usage_type.map((u) => u.usage_type))] : [];

  // Monthly projection
  const projectedMonthly = analytics
    ? (analytics.summary.total_cost / Math.max(dateRange, 1)) * 30
    : 0;

  // Cache savings
  const cacheSaved = cacheStats?.statistics?.total.estimated_cost_saved || 0;
  const tokensSaved = cacheStats?.statistics?.total.tokens_saved || 0;
  const totalWithoutCache = (analytics?.summary.total_cost || 0) + cacheSaved;
  const savingsPercent = totalWithoutCache > 0 ? (cacheSaved / totalWithoutCache) * 100 : 0;

  // Daily costs chart — fill all 30 days (backend only returns days with data)
  const dailyCosts = (() => {
    const raw = trendData?.daily_costs || [];
    const byDate = new Map(raw.map((d) => [d.date, d]));
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push(byDate.get(key) || { date: key, total_cost: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, execution_count: 0 });
    }
    return days;
  })();
  const maxDailyCost = Math.max(...dailyCosts.map((d) => d.total_cost), 0.0001);

  if (loading && !analytics) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Custos Financeiros</h1>
            <p className="mt-1 text-sm text-gray-500">
              Acompanhamento de custos, detalhamento por provedor e tipo, economias e projecoes
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
            <select
              value={filterProvider}
              onChange={(e) => { setFilterProvider(e.target.value); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Todos Provedores</option>
              {providers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              value={filterUsageType}
              onChange={(e) => { setFilterUsageType(e.target.value); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Todos os Tipos</option>
              {usageTypes.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
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
                  <div className="text-sm font-medium text-gray-500">Custo Total</div>
                  <div className="mt-2 text-3xl font-bold text-green-700">
                    {formatCost(analytics.summary.total_cost)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {formatNumber(analytics.summary.total_executions)} execucoes
                  </div>
                </div>
              </Card>

              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Custo Medio/Execucao</div>
                  <div className="mt-2 text-3xl font-bold text-blue-700">
                    {formatCost(analytics.summary.avg_cost_per_execution)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">Por chamada de IA</div>
                </div>
              </Card>

              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Economia do Cache</div>
                  <div className="mt-2 text-3xl font-bold text-emerald-700">
                    {formatCost(cacheSaved)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {formatNumber(tokensSaved)} tokens economizados
                  </div>
                  {savingsPercent > 0 && (
                    <div className="mt-1">
                      <span className="inline-flex px-1.5 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded">
                        {savingsPercent.toFixed(1)}% de economia
                      </span>
                    </div>
                  )}
                </div>
              </Card>

              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Projecao Mensal</div>
                  <div className="mt-2 text-3xl font-bold text-amber-600">
                    {formatCost(projectedMonthly)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">Baseado no consumo atual</div>
                  {dateRange < 7 && (
                    <div className="mt-1 text-xs text-amber-500">Periodo curto — projecao pode variar</div>
                  )}
                </div>
              </Card>
            </div>

            {/* Cost Breakdowns - Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Cost by Provider */}
              <Card>
                <div className="p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Custo por Provedor</h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provedor</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Custo</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Execucoes</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tokens</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">% Total</th>
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
                            <td className="px-4 py-3 text-right font-medium">{formatCost(p.total_cost)}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-500">{formatNumber(p.execution_count)}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-500">{formatNumber(p.total_tokens)}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-16 bg-gray-200 rounded-full h-1.5">
                                  <div
                                    className="bg-blue-500 h-1.5 rounded-full"
                                    style={{ width: `${analytics.summary.total_cost > 0 ? (p.total_cost / analytics.summary.total_cost) * 100 : 0}%` }}
                                  />
                                </div>
                                <span className="text-sm text-gray-500">
                                  {analytics.summary.total_cost > 0
                                    ? ((p.total_cost / analytics.summary.total_cost) * 100).toFixed(1)
                                    : '0'}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>

              {/* Cost by Usage Type */}
              <Card>
                <div className="p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Custo por Tipo de Uso</h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Custo</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Media</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Execucoes</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">% Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {analytics.by_usage_type.map((u) => (
                          <tr key={u.usage_type} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{u.usage_type}</td>
                            <td className="px-4 py-3 text-right font-medium">{formatCost(u.total_cost)}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-500">{formatCost(u.avg_cost_per_execution)}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-500">{formatNumber(u.execution_count)}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-500">
                              {analytics.summary.total_cost > 0
                                ? ((u.total_cost / analytics.summary.total_cost) * 100).toFixed(1)
                                : '0'}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>
            </div>

            {/* Daily Cost Trend - CSS Bar Chart */}
            {dailyCosts.length > 0 && (
              <Card>
                <div className="p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Tendencia de Custos Diarios <span className="text-sm font-normal text-gray-400">(ultimos 30 dias)</span></h2>
                  <div className="flex items-end gap-[3px]" style={{ height: '160px' }}>
                    {dailyCosts.map((day) => {
                      const heightPct = (day.total_cost / maxDailyCost) * 100;
                      return (
                        <div key={day.date} className="group relative flex-1 flex flex-col items-center justify-end h-full min-w-0">
                          <div
                            className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-sm cursor-pointer hover:from-blue-700 hover:to-blue-500 transition-colors"
                            style={{ height: `${Math.max(heightPct, 2)}%` }}
                          />
                          {/* Tooltip */}
                          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                              <div className="font-semibold">{formatShortDate(day.date)}</div>
                              <div>{formatCost(day.total_cost)}</div>
                              <div className="text-gray-300">{formatNumber(day.execution_count)} exec</div>
                            </div>
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* X-axis labels — show every 5th day */}
                  <div className="flex gap-[3px] mt-1">
                    {dailyCosts.map((day, i) => (
                      <div key={day.date} className="flex-1 text-center">
                        {i % 5 === 0 && (
                          <span className="text-[10px] text-gray-400">{formatShortDate(day.date)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {/* Recent Executions with Cost */}
            <Card>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Execucoes Recentes com Custo</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data/Hora</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provedor</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Modelo</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tokens</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Custo</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {executions.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                            Nenhuma execucao encontrada
                          </td>
                        </tr>
                      ) : (
                        executions.map((exec) => (
                          <tr key={exec.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{formatDate(exec.created_at)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getProviderColor(exec.provider)}`}>
                                {exec.provider}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700 max-w-[150px] truncate" title={exec.model_name || ''}>
                              {exec.model_name || '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">{exec.usage_type}</td>
                            <td className="px-4 py-3 text-right text-sm">{formatNumber(exec.total_tokens)}</td>
                            <td className="px-4 py-3 text-right text-sm font-medium">{formatCost(exec.cost)}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(exec.status)}`}>
                                {exec.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 text-xs text-gray-400 text-right">Ultimas {executions.length} execucoes</div>
              </div>
            </Card>

            {/* Savings Summary */}
            <Card>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Resumo de Economia</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <div className="text-sm text-gray-500">Custo Sem Cache</div>
                    <div className="text-xl font-bold text-gray-400 line-through">
                      {formatCost(totalWithoutCache)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Custo Real</div>
                    <div className="text-xl font-bold text-green-700">
                      {formatCost(analytics.summary.total_cost)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Economia Total</div>
                    <div className="text-xl font-bold text-emerald-600">
                      {formatCost(cacheSaved)}
                      <span className="text-sm font-normal text-gray-500 ml-2">
                        ({savingsPercent.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 min-w-[80px]">Economia</span>
                    <div className="flex-1 bg-gray-200 rounded-full h-3">
                      <div
                        className="bg-gradient-to-r from-emerald-500 to-green-400 h-3 rounded-full transition-all"
                        style={{ width: `${Math.min(savingsPercent, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-700 min-w-[50px] text-right">
                      {savingsPercent.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
