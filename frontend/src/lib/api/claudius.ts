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
  };
  cycle_start: string;
  cycle_end_estimate: string;
  prompts_used: number;
  prompts_max: number;
  prompts_pct: number;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  exhausted: boolean;
  resets_at: string | null;
  exhausted_message: string | null;
  available: boolean;
  error?: string;
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
};
