/**
 * AI Model, AI Flow Chain, Profile, and Utility Node types
 */

import { AIModelUsageType } from './enums';

// AI MODEL

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  api_key: string;
  usage_type: AIModelUsageType;
  is_active: boolean;
  config: Record<string, any>;
  // Rate Limiting (PROMPT #152)
  rate_limit_requests?: number | null;
  rate_limit_window_seconds?: number | null;
  // Timeout (PROMPT #207)
  timeout_seconds?: number | null;
  // Concurrency (PROMPT #228)
  max_concurrent_requests?: number | null;
  created_at: string;
  updated_at: string;
}

export interface AIModelCreate {
  name: string;
  provider: string;
  api_key: string;
  usage_type?: AIModelUsageType;
  is_active?: boolean;
  config?: Record<string, any>;
  // Rate Limiting (PROMPT #152)
  rate_limit_requests?: number | null;
  rate_limit_window_seconds?: number | null;
  // Timeout (PROMPT #207)
  timeout_seconds?: number | null;
  // Concurrency (PROMPT #228)
  max_concurrent_requests?: number | null;
}

export interface AIModelUpdate {
  name?: string;
  provider?: string;
  api_key?: string;
  usage_type?: AIModelUsageType;
  is_active?: boolean;
  config?: Record<string, any>;
  // Rate Limiting (PROMPT #152)
  rate_limit_requests?: number | null;
  rate_limit_window_seconds?: number | null;
  // Timeout (PROMPT #207)
  timeout_seconds?: number | null;
  // Concurrency (PROMPT #228)
  max_concurrent_requests?: number | null;
}

export interface AIModelDetail extends AIModel {
  api_key_preview?: string;
}

// AI FLOW CHAIN (PROMPT #122)

export interface AIFlowChain {
  id: string;
  usage_type: string;
  chain: string[];
  node_positions?: Record<string, { x: number; y: number }> | null;
  utility_nodes?: AIFlowUtilityNode[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  models?: AIFlowChainModel[];
}

export interface AIFlowChainModel {
  id: string;
  name: string;
  provider: string;
  usage_type: string;
  is_active: boolean;
  config: Record<string, any>;
  rate_limit_requests?: number | null;
  rate_limit_window_seconds?: number | null;
  // Concurrency (PROMPT #228)
  max_concurrent_requests?: number | null;
}

// PROMPT #124 - AI Flow Metrics, Animation, Analytics & Smart Reorder

export interface AIFlowModelMetrics {
  model_id: string;
  model_name: string;
  provider: string;
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  success_rate: number;
  health: 'green' | 'yellow' | 'red';
  avg_latency_ms: number;
  avg_cost_per_call: number;
  last_execution_at: string | null;
  fallback_count: number;
}

export interface AIFlowModelMetricsResponse {
  metrics: AIFlowModelMetrics[];
  lookback_days: number;
}

export interface AIFlowChainModelStats {
  model_id: string;
  model_name: string;
  provider: string;
  total_attempts: number;
  failures: number;
  failure_rate: number;
  avg_cost: number;
  avg_latency_ms: number;
  times_as_primary: number;
  times_as_fallback: number;
}

export interface AIFlowChainAnalyticsItem {
  usage_type: string;
  total_executions: number;
  total_cost: number;
  fallback_rate: number;
  avg_chain_depth: number;
  primary_success_rate: number;
  models: AIFlowChainModelStats[];
  cost_savings: number;
}

export interface AIFlowChainAnalyticsResponse {
  analytics: AIFlowChainAnalyticsItem[];
  most_failing_model: AIFlowChainModelStats | null;
  total_cost_all_chains: number;
  total_fallback_savings: number;
  lookback_days: number;
}

export interface AIFlowOptimizeModelScore {
  model_id: string;
  model_name: string;
  provider: string;
  score: number;
  reasoning: string;
}

export interface AIFlowOptimizeChainResponse {
  current_order: string[];
  recommended_order: string[];
  strategy: string;
  models: AIFlowOptimizeModelScore[];
  estimated_improvement: Record<string, string>;
}

export interface AIFlowChainTemplate {
  id: string;
  name: string;
  description: string;
  chain: string[];
  models: Array<Record<string, any>>;
  utility_nodes?: AIFlowUtilityNode[] | null;
}

export interface AIFlowChainTemplatesResponse {
  templates: AIFlowChainTemplate[];
}

export interface AIFlowWebSocketEvent {
  type: 'chain_attempt_start' | 'chain_attempt_success' | 'chain_attempt_failed' | 'chain_exhausted';
  data: Record<string, any>;
}

// PROMPT #204 - Utility Node Types
export type UtilityNodeType = 'cache' | 'rag_context' | 'prompt_transformer' | 'router' | 'retry' | 'validator' | 'cost_guard' | 'rate_limiter' | 'timeout' | 'prompt_queue';  // PROMPT #215

export interface AIFlowUtilityNode {
  id: string;
  type: UtilityNodeType;
  label: string;
  enabled: boolean;
  config: Record<string, any>;
  position?: { x: number; y: number } | null;
}

export interface AIFlowUtilityNodeType {
  type: UtilityNodeType;
  label: string;
  description: string;
  icon: string;
  color: string;
  default_config: Record<string, any>;
}

// AI FLOW PROFILES (Named, Versioned)

export interface AIFlowProfile {
  id: string;
  name: string;
  usage_type: string;
  version: number;
  chain: string[];
  utility_nodes?: AIFlowUtilityNode[] | null;
  node_positions?: Record<string, { x: number; y: number }> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
