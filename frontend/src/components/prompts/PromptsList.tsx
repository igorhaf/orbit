/**
 * PromptsList Component
 * PROMPT #58 - Displays prompts in table format with audit information
 */

'use client';

import React, { useState } from 'react';
import { Prompt } from '@/lib/types';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Search, Filter, ChevronDown, ChevronUp, CheckCircle, XCircle } from 'lucide-react';

interface PromptsListProps {
  prompts: Prompt[];
  loading?: boolean;
}

export const PromptsList: React.FC<PromptsListProps> = ({
  prompts,
  loading = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Get unique types and statuses
  const uniqueTypes = Array.from(
    new Set(prompts.map(p => p.type).filter(Boolean))
  );

  const uniqueStatuses = Array.from(
    new Set(prompts.map(p => p.status).filter(Boolean))
  );

  // Filter prompts
  const filteredPrompts = prompts.filter(prompt => {
    const matchesSearch =
      (prompt.user_prompt || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (prompt.response || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (prompt.type || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (prompt.ai_model_used || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      filterStatus === 'all' || prompt.status === filterStatus;

    const matchesType =
      filterType === 'all' || prompt.type === filterType;

    return matchesSearch && matchesStatus && matchesType;
  });

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const formatCost = (cost?: number) => {
    if (!cost) return '$0.0000';
    return `$${cost.toFixed(4)}`;
  };

  const formatTime = (ms?: number) => {
    if (!ms) return '0ms';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const truncateText = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search prompts, responses, models..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Filter by Status */}
          {uniqueStatuses.length > 0 && (
            <div className="w-full md:w-48">
              <Select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                options={[
                  { value: 'all', label: 'All Status' },
                  ...uniqueStatuses.map(status => ({
                    value: status,
                    label: status === 'success' ? 'Success' : 'Error',
                  })),
                ]}
              />
            </div>
          )}

          {/* Filter by Type */}
          {uniqueTypes.length > 0 && (
            <div className="w-full md:w-48">
              <Select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                options={[
                  { value: 'all', label: 'All Types' },
                  ...uniqueTypes.map(type => ({
                    value: type,
                    label: type,
                  })),
                ]}
              />
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-600">
              Showing {filteredPrompts.length} of {prompts.length} prompts
            </span>
          </div>
          <div className="flex gap-2">
            <Badge variant="success">
              {prompts.filter(p => p.status === 'success').length} Success
            </Badge>
            <Badge variant="error">
              {prompts.filter(p => p.status === 'error').length} Errors
            </Badge>
            <Badge variant="info">
              {uniqueTypes.length} Types
            </Badge>
          </div>
        </div>
      </div>

      {/* Prompts Table */}
      {filteredPrompts.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <div className="text-gray-400 mb-4">
            <Search className="w-16 h-16 mx-auto" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No prompts found
          </h3>
          <p className="text-gray-600">
            {searchTerm || filterStatus !== 'all' || filterType !== 'all'
              ? 'Try adjusting your filters'
              : 'No prompts have been generated yet'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-12 px-4 py-3"></th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Model
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Input Preview
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Output Preview
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tokens
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cost
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPrompts.map((prompt) => {
                  const isExpanded = expandedRows.has(prompt.id);
                  const totalTokens = (prompt.input_tokens || 0) + (prompt.output_tokens || 0);

                  return (
                    <React.Fragment key={prompt.id}>
                      {/* Main Row */}
                      <tr
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${
                          isExpanded ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => toggleRow(prompt.id)}
                      >
                        <td className="px-4 py-4">
                          <button className="text-gray-400 hover:text-gray-600">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {prompt.status === 'success' ? (
                            <Badge variant="success" className="flex items-center gap-1 w-fit">
                              <CheckCircle className="w-3 h-3" />
                              Success
                            </Badge>
                          ) : (
                            <Badge variant="error" className="flex items-center gap-1 w-fit">
                              <XCircle className="w-3 h-3" />
                              Error
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Badge variant="info">{prompt.type}</Badge>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-900 font-mono">
                            {prompt.ai_model_used || 'N/A'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-700 max-w-xs">
                            {truncateText(prompt.user_prompt || prompt.content || 'N/A')}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-700 max-w-xs">
                            {truncateText(prompt.response || 'N/A')}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {totalTokens.toLocaleString()}
                          </div>
                          <div className="text-xs text-gray-500">
                            {prompt.input_tokens || 0} in / {prompt.output_tokens || 0} out
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <span className="text-sm font-medium text-gray-900">
                            {formatCost(prompt.total_cost_usd)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <span className="text-sm text-gray-900">
                            {formatTime(prompt.execution_time_ms)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-500">
                            {new Date(prompt.created_at).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </td>
                      </tr>

                      {/* Expanded Row */}
                      {isExpanded && (
                        <tr className="bg-blue-50">
                          <td colSpan={10} className="px-6 py-6">
                            <div className="space-y-6">
                              {/* System Prompt */}
                              {prompt.system_prompt && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-900 mb-2">
                                    System Prompt
                                  </h4>
                                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                                      {prompt.system_prompt}
                                    </pre>
                                  </div>
                                </div>
                              )}

                              {/* User Prompt / Input */}
                              <div>
                                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                                  Input (User Prompt)
                                </h4>
                                <div className="bg-white rounded-lg p-4 border border-gray-200">
                                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                                    {prompt.user_prompt || prompt.content || 'N/A'}
                                  </pre>
                                </div>
                              </div>

                              {/* Response / Output */}
                              <div>
                                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                                  Output (AI Response)
                                </h4>
                                <div className="bg-white rounded-lg p-4 border border-gray-200">
                                  {prompt.status === 'error' ? (
                                    <div className="text-red-700">
                                      <p className="font-semibold mb-2">Error:</p>
                                      <pre className="text-sm whitespace-pre-wrap font-mono">
                                        {prompt.error_message || 'Unknown error'}
                                      </pre>
                                    </div>
                                  ) : (
                                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                                      {prompt.response || 'N/A'}
                                    </pre>
                                  )}
                                </div>
                              </div>

                              {/* Metadata */}
                              {prompt.execution_metadata && Object.keys(prompt.execution_metadata).length > 0 && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-900 mb-2">
                                    Execution Metadata
                                  </h4>
                                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                                      {JSON.stringify(prompt.execution_metadata, null, 2)}
                                    </pre>
                                  </div>
                                </div>
                              )}

                              {/* Stats Summary */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-white rounded-lg p-3 border border-gray-200">
                                  <div className="text-xs text-gray-500 mb-1">Input Tokens</div>
                                  <div className="text-lg font-semibold text-gray-900">
                                    {(prompt.input_tokens || 0).toLocaleString()}
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg p-3 border border-gray-200">
                                  <div className="text-xs text-gray-500 mb-1">Output Tokens</div>
                                  <div className="text-lg font-semibold text-gray-900">
                                    {(prompt.output_tokens || 0).toLocaleString()}
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg p-3 border border-gray-200">
                                  <div className="text-xs text-gray-500 mb-1">Total Cost</div>
                                  <div className="text-lg font-semibold text-gray-900">
                                    {formatCost(prompt.total_cost_usd)}
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg p-3 border border-gray-200">
                                  <div className="text-xs text-gray-500 mb-1">Execution Time</div>
                                  <div className="text-lg font-semibold text-gray-900">
                                    {formatTime(prompt.execution_time_ms)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
