/**
 * AI Executions Page
 * Displays AI execution logs with filtering and detailed view
 * PROMPT #54 - AI Execution Logging System
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { aiExecutionsApi } from '@/lib/api';
import { Activity, RefreshCw, TrendingUp, Database, Clock, AlertCircle } from 'lucide-react';
import { useNotification } from '@/hooks';

interface AIExecution {
  id: string;
  usage_type: string;
  provider: string;
  model_name: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  error_message: string | null;
  created_at: string;
}

interface AIExecutionDetail {
  id: string;
  ai_model_id: string | null;
  usage_type: string;
  provider: string;
  model_name: string;
  input_messages: any[];
  system_prompt: string | null;
  response_content: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  temperature: string | null;
  max_tokens: number | null;
  execution_metadata: any;
  error_message: string | null;
  execution_time_ms: number | null;
  created_at: string;
}

interface Stats {
  total_executions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  executions_by_provider: Record<string, number>;
  executions_by_usage_type: Record<string, number>;
  avg_execution_time_ms: number | null;
}

export default function AIExecutionsPage() {
  const { showError, NotificationComponent } = useNotification();
  const [executions, setExecutions] = useState<AIExecution[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<AIExecutionDetail | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterUsageType, setFilterUsageType] = useState<string>('');
  const [filterProvider, setFilterProvider] = useState<string>('');
  const [filterHasError, setFilterHasError] = useState<string>('');

  const loadExecutions = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {};
      if (filterUsageType) params.usage_type = filterUsageType;
      if (filterProvider) params.provider = filterProvider;
      if (filterHasError === 'true') params.has_error = true;
      if (filterHasError === 'false') params.has_error = false;

      const [executionsData, statsData] = await Promise.all([
        aiExecutionsApi.list(params),
        aiExecutionsApi.stats()
      ]);

      setExecutions(executionsData);
      setStats(statsData);
    } catch (err: any) {
      console.error('Failed to load executions:', err);
      setError(err.message || 'Failed to load executions');
    } finally {
      setLoading(false);
    }
  };

  const loadExecutionDetail = async (id: string) => {
    try {
      const detail = await aiExecutionsApi.get(id);
      setSelectedExecution(detail);
    } catch (err: any) {
      console.error('Failed to load execution detail:', err);
      showError('Failed to load execution details');
    }
  };

  useEffect(() => {
    loadExecutions();
  }, [filterUsageType, filterProvider, filterHasError]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatNumber = (num: number | null) => {
    if (num === null || num === undefined) return 'N/A';
    return num.toLocaleString();
  };

  const getUsageTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'prompt_generation': 'Prompt Generation',
      'task_execution': 'Task Execution',
      'commit_generation': 'Commit Generation',
      'interview': 'Interview',
      'general': 'General'
    };
    return labels[type] || type;
  };

  const getProviderColor = (provider: string) => {
    const colors: Record<string, string> = {
      'anthropic': 'bg-purple-100 text-purple-700',
      'openai': 'bg-green-100 text-green-700',
      'google': 'bg-blue-100 text-blue-700'
    };
    return colors[provider] || 'bg-gray-100 text-gray-700';
  };

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 rounded-lg">
              <Activity className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">AI Executions</h1>
              <p className="text-gray-600 mt-1">
                Monitor and analyze AI model execution logs
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={loadExecutions}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Executions</p>
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(stats.total_executions)}</p>
                  </div>
                  <Database className="w-8 h-8 text-indigo-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Tokens</p>
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(stats.total_tokens)}</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Input Tokens</p>
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(stats.total_input_tokens)}</p>
                  </div>
                  <Activity className="w-8 h-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Avg Exec Time</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {stats.avg_execution_time_ms ? `${Math.round(stats.avg_execution_time_ms)}ms` : 'N/A'}
                    </p>
                  </div>
                  <Clock className="w-8 h-8 text-orange-500" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Usage Type
                </label>
                <select
                  value={filterUsageType}
                  onChange={(e) => setFilterUsageType(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="">All Types</option>
                  <option value="prompt_generation">Prompt Generation</option>
                  <option value="task_execution">Task Execution</option>
                  <option value="commit_generation">Commit Generation</option>
                  <option value="interview">Interview</option>
                  <option value="general">General</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Provider
                </label>
                <select
                  value={filterProvider}
                  onChange={(e) => setFilterProvider(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="">All Providers</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="google">Google (Gemini)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <select
                  value={filterHasError}
                  onChange={(e) => setFilterHasError(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="">All Status</option>
                  <option value="false">Successful Only</option>
                  <option value="true">Errors Only</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error State */}
        {error && (
          <Card className="bg-red-50 border-red-200">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-red-900 mb-1">Error</h3>
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Executions Table */}
        <Card>
          <CardHeader>
            <CardTitle>Execution History ({executions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12">
                <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-3" />
                <p className="text-gray-600">Loading executions...</p>
              </div>
            ) : executions.length === 0 ? (
              <div className="text-center py-12">
                <Activity className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No executions found</p>
                <p className="text-sm text-gray-500 mt-1">
                  Executions will appear here as AI models are used
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Time
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Usage Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Provider
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Model
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Tokens
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {executions.map((execution) => (
                      <tr
                        key={execution.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => loadExecutionDetail(execution.id)}
                      >
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(execution.created_at)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-indigo-100 text-indigo-700">
                            {getUsageTypeLabel(execution.usage_type)}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getProviderColor(execution.provider)}`}>
                            {execution.provider}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">
                          {execution.model_name}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                          {execution.total_tokens ? (
                            <div>
                              <span className="font-medium">{formatNumber(execution.total_tokens)}</span>
                              <span className="text-xs text-gray-500 ml-1">
                                ({formatNumber(execution.input_tokens)} in / {formatNumber(execution.output_tokens)} out)
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400">N/A</span>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-center">
                          {execution.error_message ? (
                            <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">
                              Error
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                              Success
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-center text-sm">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              loadExecutionDetail(execution.id);
                            }}
                          >
                            View Details
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail Modal */}
        {selectedExecution && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Execution Details</h2>
                  <Button variant="outline" onClick={() => setSelectedExecution(null)}>
                    Close
                  </Button>
                </div>

                <div className="space-y-6">
                  {/* Basic Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-500">ID</label>
                      <p className="text-sm text-gray-900 font-mono">{selectedExecution.id}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Timestamp</label>
                      <p className="text-sm text-gray-900">{formatDate(selectedExecution.created_at)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Usage Type</label>
                      <p className="text-sm text-gray-900">{getUsageTypeLabel(selectedExecution.usage_type)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Provider</label>
                      <p className="text-sm text-gray-900">{selectedExecution.provider}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Model</label>
                      <p className="text-sm text-gray-900">{selectedExecution.model_name}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Execution Time</label>
                      <p className="text-sm text-gray-900">
                        {selectedExecution.execution_time_ms ? `${selectedExecution.execution_time_ms}ms` : 'N/A'}
                      </p>
                    </div>
                  </div>

                  {/* Tokens */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Token Usage</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <p className="text-sm text-blue-600 font-medium">Input Tokens</p>
                        <p className="text-2xl font-bold text-blue-900">{formatNumber(selectedExecution.input_tokens)}</p>
                      </div>
                      <div className="bg-green-50 p-4 rounded-lg">
                        <p className="text-sm text-green-600 font-medium">Output Tokens</p>
                        <p className="text-2xl font-bold text-green-900">{formatNumber(selectedExecution.output_tokens)}</p>
                      </div>
                      <div className="bg-purple-50 p-4 rounded-lg">
                        <p className="text-sm text-purple-600 font-medium">Total Tokens</p>
                        <p className="text-2xl font-bold text-purple-900">{formatNumber(selectedExecution.total_tokens)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Parameters */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Parameters</h3>
                    <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                      <div>
                        <span className="text-sm font-medium text-gray-500">Temperature:</span>
                        <span className="text-sm text-gray-900 ml-2">{selectedExecution.temperature || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-500">Max Tokens:</span>
                        <span className="text-sm text-gray-900 ml-2">{selectedExecution.max_tokens || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {/* System Prompt */}
                  {selectedExecution.system_prompt && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">System Prompt</h3>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono">{selectedExecution.system_prompt}</pre>
                      </div>
                    </div>
                  )}

                  {/* Input Messages */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Input Messages</h3>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono">
                        {JSON.stringify(selectedExecution.input_messages, null, 2)}
                      </pre>
                    </div>
                  </div>

                  {/* Response */}
                  {selectedExecution.response_content && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">Response</h3>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono">{selectedExecution.response_content}</pre>
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {selectedExecution.error_message && (
                    <div>
                      <h3 className="text-lg font-semibold text-red-900 mb-3">Error Message</h3>
                      <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                        <pre className="text-sm text-red-900 whitespace-pre-wrap font-mono">{selectedExecution.error_message}</pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {NotificationComponent}
      </div>
    </Layout>
  );
}
