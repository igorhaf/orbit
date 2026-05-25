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
  // v3.0 — full project snapshot for the unified AI Studio canvas
  // v3.6.1: cache-busting via timestamp pra evitar que o navegador sirva
  // snapshot stale após mudanças no backend.
  canvasSnapshot: () => request<{
    nodes: any[];
    edges: any[];
    subflows: Record<string, any>;
    catalog?: { models: any[]; utilities: any[] };
    types_schema?: Record<string, {
      inputs: Array<{ name: string; type: string; required: boolean }>;
      outputs: Array<{ name: string; type: string }>;
      dynamic_outputs: boolean;
    }>;
    meta: {
      model_count: number;
      chain_count: number;
      phase_count: number;
      graph_source?: 'default' | 'custom';
      control_flow_kinds?: string[];
    };
  }>(`/api/v1/ai-flow/canvas-snapshot?t=${Date.now()}`),

  // v3.7.0 — executa o grafo no engine real (Entrega B)
  runGraph: (payload?: {
    project_id?: string;
    graph?: { nodes: any[]; edges: any[]; subflows: Record<string, any> };
    initial_inputs?: Record<string, any>;
  }) =>
    request<{
      job_id?: string;
      run_id?: string;
      total_nodes?: number;
      status?: string;
      error?: string;
    }>('/api/v1/ai-flow/run', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  // v3.6.6 — reset layout (deleta o grafo salvo, força gerar default)
  canvasReset: () =>
    request<{ reset: boolean; had_saved_graph?: boolean; reason?: string }>(
      '/api/v1/ai-flow/canvas-reset',
      { method: 'POST' },
    ),

  // v3.4 — persist customized canvas state (models, phase_configs, graph)
  canvasSave: (payload: {
    models?: Array<{ ai_model_id: string; name?: string; config?: any; rate_limit_requests?: number; timeout_seconds?: number }>;
    phase_configs?: Record<string, any>;
    chain_overrides?: Record<string, string[]>;
    graph?: {
      nodes: any[];
      edges: any[];
      subflows: Record<string, any>;
    };
  }) =>
    request<{
      models_updated: number;
      profile_updated: boolean;
      profile_id?: string | null;
      chains_updated: number;
      errors: string[];
    }>('/api/v1/ai-flow/canvas-save', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

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

  // AI Flow Profiles (Named, Versioned)
  listProfiles: () => request<any[]>('/api/v1/ai-flow/profiles'),

  createProfile: (data: { name: string; usage_type: string; chain?: string[]; utility_nodes?: any[]; node_positions?: Record<string, any>; subflows?: Record<string, any> }) =>
    request<any>('/api/v1/ai-flow/profiles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProfile: (id: string, data: { name?: string; usage_type?: string; chain?: string[]; utility_nodes?: any[]; node_positions?: Record<string, any>; subflows?: Record<string, any> }) =>
    request<any>(`/api/v1/ai-flow/profiles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteProfile: (id: string) =>
    request<any>(`/api/v1/ai-flow/profiles/${id}`, { method: 'DELETE' }),

  activateProfile: (id: string) =>
    request<any>(`/api/v1/ai-flow/profiles/${id}/activate`, { method: 'POST' }),
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
