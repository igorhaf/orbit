/**
 * Claudius — Quota tracking API client.
 * Talks to orbit-backend which proxies to claudius-backend.
 *
 * v2.3.0
 */
import { request } from './base';

export type QuotaTier = 'pro' | 'max_5x' | 'max_20x';

export interface QuotaSnapshot {
  tier: QuotaTier | string;
  limits: {
    prompts_5h: number;
    weekly_sonnet_h: number;
    weekly_opus_h: number;
    tokens_in_5h?: number;
    tokens_out_5h?: number;
  };
  source?: 'jsonl' | 'local_fallback';
  cycle_start: string;
  cycle_end_estimate: string;
  cycle_start_anchored?: string | null;
  cycle_resets_at?: string | null;
  time_elapsed_pct?: number;
  time_remaining_sec?: number;
  prompts_used: number;
  prompts_max: number;
  prompts_pct: number;
  pct?: number;  // worst-case across prompts/tokens (color driver)
  tokens?: {
    input: number;
    output: number;
    cache_read: number;
    cache_creation: number;
    total: number;
  };
  tokens_limits?: { input_5h: number; output_5h: number };
  tokens_remaining?: { input: number; output: number };
  tokens_pct?: { input: number; output: number };
  // Legacy (v2.3.0):
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  exhausted: boolean;
  resets_at: string | null;
  exhausted_message: string | null;
  available: boolean;
  error?: string;
}

export type PipelineMode = 'aggressive' | 'balanced' | 'conservative';

export interface PhaseEstimate {
  phase: string;
  units: number;
  input_tokens: number;
  output_tokens: number;
}

export interface PlanResult {
  mode: PipelineMode;
  fits: boolean;
  recommendation: 'proceed' | 'adjust' | 'wait';
  reason: string;
  estimate: {
    total_input: number;
    total_output: number;
    by_phase: PhaseEstimate[];
  };
  remaining: { input: number; output: number };
  budget: { input: number; output: number };
  suggested_profile?: Record<string, any> | null;
  suggested_mode?: PipelineMode | null;
  quota_source?: string;
  cycle_resets_at?: string | null;
  time_remaining_sec?: number;
}

export interface QuotaProbeResult {
  available: boolean;
  reason: 'ok' | 'quota_exhausted' | 'http_error' | 'unreachable';
  resets_at: string | null;
  raw: string;
}

export interface QuotaEvent {
  id: number;
  timestamp: string;
  event_type: 'call' | 'exhausted' | 'available';
  input_tokens: number;
  output_tokens: number;
  model: string;
  resets_at: string;
  raw_text: string;
}

export const claudiusApi = {
  quotaStatus: () => request<QuotaSnapshot>('/api/v1/claudius/quota/status'),

  quotaProbe: () =>
    request<QuotaProbeResult>('/api/v1/claudius/quota/probe', { method: 'POST' }),

  quotaHistory: (limit = 50) =>
    request<{ events: QuotaEvent[]; error?: string }>(
      `/api/v1/claudius/quota/history?limit=${limit}`,
    ),

  quotaSetTier: (tier: QuotaTier) =>
    request<QuotaSnapshot>('/api/v1/claudius/quota/tier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    }),

  quotaScanNow: () =>
    request<{ scan: { scanned_files: number; new_events: number; errors: number }; snapshot: QuotaSnapshot }>(
      '/api/v1/claudius/quota/scan-now',
      { method: 'POST' },
    ),

  quotaPlan: (project_meta: Record<string, any>, mode: PipelineMode = 'balanced', profile?: Record<string, any>) =>
    request<PlanResult>('/api/v1/claudius/quota/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_meta, mode, profile }),
    }),
};
