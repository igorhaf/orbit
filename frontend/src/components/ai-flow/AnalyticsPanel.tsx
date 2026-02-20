/**
 * Analytics Panel
 * PROMPT #124 - Chain Analytics Dashboard
 *
 * Collapsible panel showing chain analytics (cost, fallback rate, savings, etc.).
 */

'use client';

import React from 'react';
import { USAGE_TYPE_OPTIONS } from './FlowConstants';
import type {
  AIFlowChainAnalyticsResponse,
  AIFlowChainAnalyticsItem,
} from '@/lib/types';

export interface AnalyticsPanelProps {
  analytics: AIFlowChainAnalyticsResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

export default function AnalyticsPanel({
  analytics,
  loading,
  onRefresh,
}: AnalyticsPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-sm text-gray-500">Carregando analiticos...</span>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="text-center py-6 text-sm text-gray-400">
        Nenhum dado analitico disponivel. Execucoes da cadeia aparecerao aqui.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-600 font-medium">Custo Total</div>
          <div className="text-lg font-bold text-blue-900">${analytics.total_cost_all_chains.toFixed(4)}</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="text-xs text-green-600 font-medium">Economia de Fallback</div>
          <div className="text-lg font-bold text-green-900">${analytics.total_fallback_savings.toFixed(4)}</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="text-xs text-amber-600 font-medium">Mais Falhas</div>
          <div className="text-sm font-bold text-amber-900 truncate">
            {analytics.most_failing_model?.model_name || 'Nenhum'}
          </div>
          {analytics.most_failing_model && (
            <div className="text-[10px] text-amber-600">{(analytics.most_failing_model.failure_rate * 100).toFixed(1)}% falha</div>
          )}
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <div className="text-xs text-purple-600 font-medium">Periodo</div>
          <div className="text-lg font-bold text-purple-900">{analytics.lookback_days}d</div>
        </div>
      </div>

      {/* Per operation breakdown */}
      {analytics.analytics.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Operacao</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Execucoes</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Taxa de Fallback</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Sucesso Primario</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Prof. Media</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Custo Total</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Economia</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {analytics.analytics.map((item: AIFlowChainAnalyticsItem) => (
                <tr key={item.usage_type} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {USAGE_TYPE_OPTIONS.find(o => o.value === item.usage_type)?.label || item.usage_type}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{item.total_executions}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-medium ${item.fallback_rate > 0.3 ? 'text-red-600' : item.fallback_rate > 0.1 ? 'text-amber-600' : 'text-green-600'}`}>
                      {(item.fallback_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-medium ${item.primary_success_rate > 0.9 ? 'text-green-600' : item.primary_success_rate > 0.7 ? 'text-amber-600' : 'text-red-600'}`}>
                      {(item.primary_success_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{item.avg_chain_depth.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">${item.total_cost.toFixed(4)}</td>
                  <td className="px-3 py-2 text-right text-green-600 font-medium">${item.cost_savings.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onRefresh} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
          Atualizar Analiticos
        </button>
      </div>
    </div>
  );
}
