'use client';

/**
 * Cost Analytics Dashboard
 *
 * PROMPT #54.2 - Phase 2: Cost Analytics Dashboard
 *
 * Features:
 * - Summary cards (total cost, executions, avg cost)
 * - Cost breakdown by provider
 * - Cost breakdown by usage type
 * - Daily cost trend
 * - Recent executions table with costs
 */

import { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface CostSummary {
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_executions: number;
  avg_cost_per_execution: number;
  date_range_start: string | null;
  date_range_end: string | null;
}

interface CostByProvider {
  provider: string;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  execution_count: number;
}

interface CostByUsageType {
  usage_type: string;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  execution_count: number;
  avg_cost_per_execution: number;
}

interface DailyCost {
  date: string;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  execution_count: number;
}

interface CostAnalytics {
  summary: CostSummary;
  by_provider: CostByProvider[];
  by_usage_type: CostByUsageType[];
  daily_costs: DailyCost[];
}

interface ExecutionWithCost {
  id: string;
  usage_type: string;
  provider: string;
  model_name: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  input_cost: number;
  output_cost: number;
  created_at: string;
}

interface CacheStats {
  enabled: boolean;
  backend: string;
  message?: string;
  statistics?: {
    l1_exact_match: { hits: number; misses: number; hit_rate: number };
    l2_semantic: { hits: number; misses: number; hit_rate: number; enabled: boolean };
    l3_template: { hits: number; misses: number; hit_rate: number };
    total: {
      hits: number;
      misses: number;
      requests: number;
      hit_rate: number;
      tokens_saved: number;
      estimated_cost_saved: number;
    };
  };
}

export default function CostAnalyticsPage() {
  const [analytics, setAnalytics] = useState<CostAnalytics | null>(null);
  const [executions, setExecutions] = useState<ExecutionWithCost[]>([]);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedUsageType, setSelectedUsageType] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState(7); // Last 7 days

  useEffect(() => {
    fetchAnalytics();
    fetchExecutions();
    fetchCacheStats();
  }, [selectedProvider, selectedUsageType, dateRange]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      if (selectedProvider) params.append('provider', selectedProvider);
      if (selectedUsageType) params.append('usage_type', selectedUsageType);

      // Calculate start date based on dateRange
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - dateRange);
      params.append('start_date', startDate.toISOString());
      params.append('end_date', endDate.toISOString());

      const response = await fetch(`http://localhost:8000/api/v1/cost/analytics?${params}`);
      if (!response.ok) throw new Error('Failed to fetch analytics');

      const data = await response.json();
      setAnalytics(data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchExecutions = async () => {
    try {
      const params = new URLSearchParams();
      params.append('limit', '50');
      if (selectedProvider) params.append('provider', selectedProvider);
      if (selectedUsageType) params.append('usage_type', selectedUsageType);

      const response = await fetch(`http://localhost:8000/api/v1/cost/executions-with-cost?${params}`);
      if (!response.ok) throw new Error('Failed to fetch executions');

      const data = await response.json();
      setExecutions(data);
    } catch (error) {
      console.error('Error fetching executions:', error);
    }
  };

  const fetchCacheStats = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/v1/cache/stats');
      if (!response.ok) throw new Error('Failed to fetch cache stats');

      const data = await response.json();
      setCacheStats(data);
    } catch (error) {
      console.error('Error fetching cache stats:', error);
    }
  };

  const formatCost = (cost: number) => {
    if (cost < 0.0001) return `$${cost.toFixed(6)}`;
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getProviderColor = (provider: string) => {
    const colors: Record<string, string> = {
      'anthropic': 'bg-purple-100 text-purple-800',
      'openai': 'bg-green-100 text-green-800',
      'google': 'bg-blue-100 text-blue-800',
    };
    return colors[provider] || 'bg-gray-100 text-gray-800';
  };

  if (loading && !analytics) {
    return (
      <Layout>
        <Breadcrumbs />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
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
            <h1 className="text-2xl font-bold text-gray-900">Cost Analytics</h1>
            <p className="mt-1 text-sm text-gray-500">
              AI execution costs and token usage analytics
            </p>
          </div>

          <div className="flex gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(Number(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>

            <Button onClick={() => { fetchAnalytics(); fetchExecutions(); fetchCacheStats(); }}>
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        {analytics && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Total Cost</div>
                  <div className="mt-2 text-3xl font-bold text-gray-900">
                    {formatCost(analytics.summary.total_cost)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {formatNumber(analytics.summary.total_executions)} executions
                  </div>
                </div>
              </Card>

              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Avg Cost/Execution</div>
                  <div className="mt-2 text-3xl font-bold text-gray-900">
                    {formatCost(analytics.summary.avg_cost_per_execution)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Per AI call
                  </div>
                </div>
              </Card>

              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Total Tokens</div>
                  <div className="mt-2 text-3xl font-bold text-gray-900">
                    {formatNumber(analytics.summary.total_tokens)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {formatNumber(analytics.summary.total_input_tokens)} in + {formatNumber(analytics.summary.total_output_tokens)} out
                  </div>
                </div>
              </Card>

              <Card>
                <div className="p-6">
                  <div className="text-sm font-medium text-gray-500">Total Executions</div>
                  <div className="mt-2 text-3xl font-bold text-gray-900">
                    {formatNumber(analytics.summary.total_executions)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    AI calls made
                  </div>
                </div>
              </Card>
            </div>

            {/* Cache Performance */}
            {cacheStats && (
              <Card>
                <div className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Cache Performance</h2>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      cacheStats.enabled
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {cacheStats.enabled ? `✓ ${cacheStats.backend.toUpperCase()}` : '✗ Disabled'}
                    </span>
                  </div>

                  {!cacheStats.enabled ? (
                    <div className="text-sm text-gray-500">
                      {cacheStats.message || 'Cache is not enabled'}
                    </div>
                  ) : cacheStats.statistics && (
                    <>
                      {/* Overall Cache Stats */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div>
                          <div className="text-sm text-gray-500">Overall Hit Rate</div>
                          <div className="text-2xl font-bold text-green-600">
                            {(cacheStats.statistics.total.hit_rate * 100).toFixed(1)}%
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {formatNumber(cacheStats.statistics.total.hits)} hits / {formatNumber(cacheStats.statistics.total.requests)} requests
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Cost Saved</div>
                          <div className="text-2xl font-bold text-blue-600">
                            {formatCost(cacheStats.statistics.total.estimated_cost_saved)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            From cached responses
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Tokens Saved</div>
                          <div className="text-xl font-semibold text-purple-600">
                            {formatNumber(cacheStats.statistics.total.tokens_saved)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Not sent to AI
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Cache Hits</div>
                          <div className="text-xl font-semibold text-gray-900">
                            {formatNumber(cacheStats.statistics.total.hits)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Successful retrievals
                          </div>
                        </div>
                      </div>

                      {/* Multi-Level Cache Breakdown */}
                      <div className="border-t pt-4">
                        <h3 className="text-sm font-semibold text-gray-700 mb-3">Cache Levels</h3>
                        <div className="space-y-3">
                          {/* L1 - Exact Match */}
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">L1 - Exact Match</span>
                                <span className="text-xs text-gray-500">(SHA256 hash, 7 days TTL)</span>
                              </div>
                              <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                                <div
                                  className="bg-green-500 h-2 rounded-full"
                                  style={{ width: `${cacheStats.statistics.l1_exact_match.hit_rate * 100}%` }}
                                ></div>
                              </div>
                            </div>
                            <div className="ml-4 text-right">
                              <div className="text-sm font-semibold text-gray-900">
                                {(cacheStats.statistics.l1_exact_match.hit_rate * 100).toFixed(1)}%
                              </div>
                              <div className="text-xs text-gray-500">
                                {formatNumber(cacheStats.statistics.l1_exact_match.hits)} hits
                              </div>
                            </div>
                          </div>

                          {/* L2 - Semantic Similarity */}
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">L2 - Semantic</span>
                                <span className="text-xs text-gray-500">(95% similarity, 1 day TTL)</span>
                                {!cacheStats.statistics.l2_semantic.enabled && (
                                  <span className="text-xs text-orange-600">(needs Redis)</span>
                                )}
                              </div>
                              <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full"
                                  style={{ width: `${cacheStats.statistics.l2_semantic.hit_rate * 100}%` }}
                                ></div>
                              </div>
                            </div>
                            <div className="ml-4 text-right">
                              <div className="text-sm font-semibold text-gray-900">
                                {(cacheStats.statistics.l2_semantic.hit_rate * 100).toFixed(1)}%
                              </div>
                              <div className="text-xs text-gray-500">
                                {formatNumber(cacheStats.statistics.l2_semantic.hits)} hits
                              </div>
                            </div>
                          </div>

                          {/* L3 - Template Cache */}
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">L3 - Template</span>
                                <span className="text-xs text-gray-500">(Deterministic, 30 days TTL)</span>
                              </div>
                              <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                                <div
                                  className="bg-purple-500 h-2 rounded-full"
                                  style={{ width: `${cacheStats.statistics.l3_template.hit_rate * 100}%` }}
                                ></div>
                              </div>
                            </div>
                            <div className="ml-4 text-right">
                              <div className="text-sm font-semibold text-gray-900">
                                {(cacheStats.statistics.l3_template.hit_rate * 100).toFixed(1)}%
                              </div>
                              <div className="text-xs text-gray-500">
                                {formatNumber(cacheStats.statistics.l3_template.hits)} hits
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </Card>
            )}

            {/* Cost by Provider */}
            <Card>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Cost by Provider</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Executions</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tokens</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">% of Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {analytics.by_provider.map((provider) => (
                        <tr key={provider.provider} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getProviderColor(provider.provider)}`}>
                              {provider.provider}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right font-medium">
                            {formatCost(provider.total_cost)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-500">
                            {formatNumber(provider.execution_count)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-500">
                            {formatNumber(provider.total_tokens)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-500">
                            {((provider.total_cost / analytics.summary.total_cost) * 100).toFixed(1)}%
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
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Cost by Usage Type</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usage Type</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg/Call</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Executions</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tokens</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {analytics.by_usage_type.map((usage) => (
                        <tr key={usage.usage_type} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                            {usage.usage_type}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right font-medium">
                            {formatCost(usage.total_cost)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-500">
                            {formatCost(usage.avg_cost_per_execution)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-500">
                            {formatNumber(usage.execution_count)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-500">
                            {formatNumber(usage.total_tokens)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>

            {/* Recent Executions */}
            <Card>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Executions</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usage Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Model</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Input</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Output</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {executions.map((execution) => (
                        <tr key={execution.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(execution.created_at)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getProviderColor(execution.provider)}`}>
                              {execution.provider}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                            {execution.usage_type}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                            {execution.model_name || 'N/A'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-500">
                            {formatNumber(execution.input_tokens)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-500">
                            {formatNumber(execution.output_tokens)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right font-medium text-gray-900">
                            {formatCost(execution.cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
