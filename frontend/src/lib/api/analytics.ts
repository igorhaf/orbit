/**
 * Analytics API Client
 * Typed API calls for cost analytics, cache stats, AI execution stats, and RAG metrics
 * PROMPT #249 - Split dashboard into Tokens & Costs pages
 */

import { request } from './base';

// ---- Types ----

export interface CostSummary {
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_executions: number;
  avg_cost_per_execution: number;
  date_range_start: string | null;
  date_range_end: string | null;
}

export interface CostByProvider {
  provider: string;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  execution_count: number;
}

export interface CostByUsageType {
  usage_type: string;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  execution_count: number;
  avg_cost_per_execution: number;
}

export interface DailyCost {
  date: string;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  execution_count: number;
}

export interface CostAnalyticsResponse {
  summary: CostSummary;
  by_provider: CostByProvider[];
  by_usage_type: CostByUsageType[];
  daily_costs: DailyCost[];
}

export interface CacheStatistics {
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
}

export interface CacheStatsResponse {
  enabled: boolean;
  backend: string;
  message?: string;
  statistics?: CacheStatistics;
}

export interface AIExecutionStats {
  total_executions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  executions_by_provider: Record<string, number>;
  executions_by_usage_type: Record<string, number>;
  avg_execution_time_ms: number | null;
}

export interface RagStats {
  total_rag_enabled: number;
  total_rag_hits: number;
  hit_rate: number;
  avg_results_count: number;
  avg_top_similarity: number;
  avg_retrieval_time_ms: number;
  by_usage_type: Array<{
    usage_type: string;
    total: number;
    hits: number;
    hit_rate: number;
    avg_results_count: number;
    avg_top_similarity: number;
    avg_retrieval_time_ms: number;
  }>;
}

export interface ExecutionWithCost {
  id: string;
  usage_type: string;
  provider: string;
  model_name: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  execution_time_ms: number | null;
  status: string;
  created_at: string;
  cost: number;
  input_cost: number;
  output_cost: number;
}

// ---- API Client ----

export const analyticsApi = {
  getCostAnalytics: (params?: {
    start_date?: string;
    end_date?: string;
    provider?: string;
    usage_type?: string;
  }) => {
    const qp = new URLSearchParams();
    if (params?.start_date) qp.append('start_date', params.start_date);
    if (params?.end_date) qp.append('end_date', params.end_date);
    if (params?.provider) qp.append('provider', params.provider);
    if (params?.usage_type) qp.append('usage_type', params.usage_type);
    const qs = qp.toString();
    return request<CostAnalyticsResponse>(`/api/v1/cost/analytics${qs ? '?' + qs : ''}`);
  },

  getCacheStats: () =>
    request<CacheStatsResponse>('/api/v1/cache/stats'),

  getExecutionStats: (params?: { start_date?: string; end_date?: string }) => {
    const qp = new URLSearchParams();
    if (params?.start_date) qp.append('start_date', params.start_date);
    if (params?.end_date) qp.append('end_date', params.end_date);
    const qs = qp.toString();
    return request<AIExecutionStats>(`/api/v1/ai-executions/stats${qs ? '?' + qs : ''}`);
  },

  getRagStats: (params?: {
    start_date?: string;
    end_date?: string;
    usage_type?: string;
  }) => {
    const qp = new URLSearchParams();
    if (params?.start_date) qp.append('start_date', params.start_date);
    if (params?.end_date) qp.append('end_date', params.end_date);
    if (params?.usage_type) qp.append('usage_type', params.usage_type);
    const qs = qp.toString();
    return request<RagStats>(`/api/v1/cost/rag-stats${qs ? '?' + qs : ''}`);
  },

  getExecutionsWithCost: (params?: {
    limit?: number;
    offset?: number;
    provider?: string;
    usage_type?: string;
  }) => {
    const qp = new URLSearchParams();
    if (params?.limit !== undefined) qp.append('limit', params.limit.toString());
    if (params?.offset !== undefined) qp.append('offset', params.offset.toString());
    if (params?.provider) qp.append('provider', params.provider);
    if (params?.usage_type) qp.append('usage_type', params.usage_type);
    const qs = qp.toString();
    return request<ExecutionWithCost[]>(`/api/v1/cost/executions-with-cost${qs ? '?' + qs : ''}`);
  },
};
