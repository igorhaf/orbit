import { request } from './base';

// AI Models API
export const aiModelsApi = {
  list: (params?: any) => request<any>('/api/v1/ai-models/'),

  get: (id: string) => request<any>(`/api/v1/ai-models/${id}`),

  create: (data: any) =>
    request<any>('/api/v1/ai-models/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: any) =>
    request<any>(`/api/v1/ai-models/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<any>(`/api/v1/ai-models/${id}`, { method: 'DELETE' }),

  toggle: (id: string) =>
    request<any>(`/api/v1/ai-models/${id}/toggle`, { method: 'PATCH' }),

  byUsageType: (usageType: string) =>
    request<any>(`/api/v1/ai-models/usage/${usageType}`),
};

// AI Flow Chains API (PROMPT #122 - Visual Fallback Chain Configuration)
export const aiFlowApi = {
  listChains: () => request<any>('/api/v1/ai-flow/chains'),

  getChain: (usageType: string) => request<any>(`/api/v1/ai-flow/chains/${usageType}`),

  upsertChain: (usageType: string, data: { chain: string[]; node_positions?: Record<string, { x: number; y: number }> | null; is_active?: boolean }) =>
    request<any>(`/api/v1/ai-flow/chains/${usageType}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteChain: (usageType: string) =>
    request<any>(`/api/v1/ai-flow/chains/${usageType}`, { method: 'DELETE' }),

  // PROMPT #124 - Metrics, Analytics, Optimize, Templates
  modelMetrics: (modelIds: string[], days: number = 7) => {
    const queryParams = new URLSearchParams();
    queryParams.append('model_ids', modelIds.join(','));
    queryParams.append('days', days.toString());
    return request<any>(`/api/v1/ai-flow/model-metrics?${queryParams.toString()}`);
  },

  chainAnalytics: (usageType?: string, days: number = 30) => {
    const queryParams = new URLSearchParams();
    if (usageType) queryParams.append('usage_type', usageType);
    queryParams.append('days', days.toString());
    return request<any>(`/api/v1/ai-flow/chain-analytics?${queryParams.toString()}`);
  },

  optimizeChain: (usageType: string, strategy: string = 'balanced', days: number = 30) =>
    request<any>(`/api/v1/ai-flow/optimize-chain/${usageType}`, {
      method: 'POST',
      body: JSON.stringify({ strategy, days }),
    }),

  chainTemplates: (usageType: string) =>
    request<any>(`/api/v1/ai-flow/chain-templates/${usageType}`),

  // PROMPT #204 - Utility Node Types
  utilityNodeTypes: () =>
    request<any>('/api/v1/ai-flow/utility-node-types'),
};

// PROMPT #257 - Contracts API (database-backed contracts for AI Flow)
export const contractsApi = {
  list: (params?: { domain?: string; usage_type?: string }) => {
    const queryParams = new URLSearchParams();
    if (params?.domain) queryParams.append('domain', params.domain);
    if (params?.usage_type) queryParams.append('usage_type', params.usage_type);
    const qs = queryParams.toString();
    return request<any>(`/api/v1/contracts/${qs ? '?' + qs : ''}`);
  },

  get: (name: string) => request<any>(`/api/v1/contracts/${name}`),

  byUsageType: (usageType: string) =>
    request<any>(`/api/v1/contracts/by-usage-type/${usageType}`),

  update: (name: string, data: any) =>
    request<any>(`/api/v1/contracts/${name}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// AI Executions API (PROMPT #54 - AI Execution Logging)
export const aiExecutionsApi = {
  list: (params?: {
    skip?: number;
    limit?: number;
    usage_type?: string;
    provider?: string;
    has_error?: boolean;
    start_date?: string;
    end_date?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.usage_type) queryParams.append('usage_type', params.usage_type);
    if (params?.provider) queryParams.append('provider', params.provider);
    if (params?.has_error !== undefined) queryParams.append('has_error', params.has_error.toString());
    if (params?.start_date) queryParams.append('start_date', params.start_date);
    if (params?.end_date) queryParams.append('end_date', params.end_date);

    const queryString = queryParams.toString();
    return request<any>(`/api/v1/ai-executions/${queryString ? '?' + queryString : ''}`);
  },

  get: (id: string) => request<any>(`/api/v1/ai-executions/${id}`),

  delete: (id: string) =>
    request<any>(`/api/v1/ai-executions/${id}`, { method: 'DELETE' }),

  deleteOld: (days: number) =>
    request<any>(`/api/v1/ai-executions/?days=${days}`, { method: 'DELETE' }),

  stats: (params?: { start_date?: string; end_date?: string }) => {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.append('start_date', params.start_date);
    if (params?.end_date) queryParams.append('end_date', params.end_date);

    const queryString = queryParams.toString();
    return request<any>(`/api/v1/ai-executions/stats${queryString ? '?' + queryString : ''}`);
  },
};
