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
import Layout from '@/components/layout/Layout';
import Breadcrumbs from '@/components/layout/Breadcrumbs';
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

export default function CostAnalyticsPage() {
  const [analytics, setAnalytics] = useState<CostAnalytics | null>(null);
  const [executions, setExecutions] = useState<ExecutionWithCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedUsageType, setSelectedUsageType] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState(7); // Last 7 days

  useEffect(() => {
    fetchAnalytics();
    fetchExecutions();
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
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Cost Analytics', href: '/cost-analytics' }
          ]}
        />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Cost Analytics', href: '/cost-analytics' }
        ]}
      />

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

            <Button onClick={() => { fetchAnalytics(); fetchExecutions(); }}>
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
