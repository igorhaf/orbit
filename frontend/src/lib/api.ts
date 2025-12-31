/**
 * API Client for ORBIT Backend
 * Provides typed API calls with comprehensive error handling and logging
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Log inicial
if (typeof window !== 'undefined') {
  console.log('🔧 ORBIT API Client initialized');
  console.log('📍 API URL:', API_URL);
}

// Base request function com logs detalhados
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  console.log('📡 API Request:', {
    method: options.method || 'GET',
    url,
    hasBody: !!options.body,
  });

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    console.log('📥 API Response:', {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
    });

    // Se não for OK, tentar pegar erro do backend
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch {
        // Se não conseguir parsear JSON, usa mensagem padrão
      }

      console.error('❌ API Error:', errorMessage);
      throw new Error(errorMessage);
    }

    // Handle 204 No Content (e.g., successful delete)
    if (response.status === 204) {
      console.log('✅ API Success (No Content)');
      return null as T;
    }

    const data = await response.json();
    console.log('✅ API Success');
    return data;

  } catch (error: any) {
    console.error('❌ API Request Failed:', {
      url,
      error: error.message,
    });

    // Melhorar mensagens de erro comuns
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error(
        `Cannot connect to backend at ${API_URL}. ` +
        `Please ensure backend is running with: uvicorn app.main:app --reload`
      );
    }

    if (error.message.includes('CORS')) {
      throw new Error(
        `CORS error. Backend needs to allow origin ${typeof window !== 'undefined' ? window.location.origin : 'localhost:3000'}. ` +
        `Check backend CORS configuration.`
      );
    }

    throw error;
  }
}

// Projects API
export const projectsApi = {
  list: (params?: { skip?: number; limit?: number; search?: string }) => {
    const queryParams = new URLSearchParams();
    if (params?.search) queryParams.append('search', params.search);
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());

    const queryString = queryParams.toString();
    const url = `/api/v1/projects/${queryString ? '?' + queryString : ''}`;

    console.log('🔍 Fetching projects:', url);
    return request<any>(url);
  },

  get: (id: string) => request<any>(`/api/v1/projects/${id}`),

  create: (data: any) =>
    request<any>('/api/v1/projects/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: any) =>
    request<any>(`/api/v1/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<any>(`/api/v1/projects/${id}`, { method: 'DELETE' }),

  summary: (id: string) =>
    request<any>(`/api/v1/projects/${id}/summary`),
};

// Tasks (Kanban) API
export const tasksApi = {
  list: (params?: any) => {
    const queryParams = new URLSearchParams();
    if (params?.project_id) queryParams.append('project_id', params.project_id);
    const queryString = queryParams.toString();
    return request<any>(`/api/v1/tasks/${queryString ? '?' + queryString : ''}`);
  },

  get: (id: string) => request<any>(`/api/v1/tasks/${id}`),

  create: (data: any) =>
    request<any>('/api/v1/tasks/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: any) =>
    request<any>(`/api/v1/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<any>(`/api/v1/tasks/${id}`, { method: 'DELETE' }),

  move: (id: string, data: { new_status: string; new_order?: number }) =>
    request<any>(`/api/v1/tasks/${id}/move`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  kanban: (projectId: string) =>
    request<any>(`/api/v1/tasks/kanban/${projectId}`),
};

// Interviews API
export const interviewsApi = {
  list: (params?: any) => request<any>('/api/v1/interviews/'),

  get: (id: string) => request<any>(`/api/v1/interviews/${id}`),

  create: (data: any) =>
    request<any>('/api/v1/interviews/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: any) =>
    request<any>(`/api/v1/interviews/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  addMessage: (id: string, message: any) =>
    request<any>(`/api/v1/interviews/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  updateStatus: (id: string, status: string) =>
    request<any>(`/api/v1/interviews/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  prompts: (id: string) =>
    request<any>(`/api/v1/interviews/${id}/prompts`),

  generatePrompts: (id: string) =>
    request<any>(`/api/v1/interviews/${id}/generate-prompts`, {
      method: 'POST',
    }),

  start: (id: string) =>
    request<any>(`/api/v1/interviews/${id}/start`, {
      method: 'POST',
    }),

  sendMessage: (id: string, data: { content: string; selected_options?: string[] }) =>
    request<any>(`/api/v1/interviews/${id}/send-message`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  saveStack: (id: string, stack: { backend: string; database: string; frontend: string; css: string }) =>
    request<any>(`/api/v1/interviews/${id}/save-stack`, {
      method: 'POST',
      body: JSON.stringify(stack),
    }),

  // PROMPT #57 - Update project title/description during interview
  updateProjectInfo: (id: string, data: { title?: string; description?: string }) =>
    request<any>(`/api/v1/interviews/${id}/update-project-info`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

// Prompts API
export const promptsApi = {
  list: (params?: any) => request<any>('/api/v1/prompts/'),

  get: (id: string) => request<any>(`/api/v1/prompts/${id}`),

  create: (data: any) =>
    request<any>('/api/v1/prompts/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: any) =>
    request<any>(`/api/v1/prompts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<any>(`/api/v1/prompts/${id}`, { method: 'DELETE' }),

  deleteAll: () =>
    request<any>('/api/v1/prompts/', { method: 'DELETE' }),

  versions: (id: string) =>
    request<any>(`/api/v1/prompts/${id}/versions`),

  createVersion: (id: string, content: string) =>
    request<any>(`/api/v1/prompts/${id}/version?new_content=${encodeURIComponent(content)}`, {
      method: 'POST',
    }),

  reusable: () =>
    request<any>('/api/v1/prompts/reusable/all'),
};

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

// Chat Sessions API
export const chatSessionsApi = {
  list: (params?: any) => request<any>('/api/v1/chat-sessions/'),

  get: (id: string) => request<any>(`/api/v1/chat-sessions/${id}`),

  create: (data: any) =>
    request<any>('/api/v1/chat-sessions/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: any) =>
    request<any>(`/api/v1/chat-sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<any>(`/api/v1/chat-sessions/${id}`, { method: 'DELETE' }),

  addMessage: (id: string, message: any) =>
    request<any>(`/api/v1/chat-sessions/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  updateStatus: (id: string, status: string) =>
    request<any>(`/api/v1/chat-sessions/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  sendMessage: (id: string, content: string) =>
    request<any>(`/api/v1/chat-sessions/${id}/send-message`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  execute: (id: string) =>
    request<any>(`/api/v1/chat-sessions/${id}/execute`, {
      method: 'POST',
    }),
};

// Commits API
export const commitsApi = {
  list: (params?: any) => request<any>('/api/v1/commits/'),

  get: (id: string) => request<any>(`/api/v1/commits/${id}`),

  create: (data: any) =>
    request<any>('/api/v1/commits/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<any>(`/api/v1/commits/${id}`, { method: 'DELETE' }),

  byProject: (projectId: string, params?: any) =>
    request<any>(`/api/v1/commits/project/${projectId}`),

  byTask: (taskId: string) =>
    request<any>(`/api/v1/commits/task/${taskId}`),

  statistics: (projectId?: string) => {
    const params = projectId ? `?project_id=${projectId}` : '';
    return request<any>(`/api/v1/commits/types/statistics${params}`);
  },

  autoGenerate: (chatSessionId: string) =>
    request<any>(`/api/v1/commits/auto-generate/${chatSessionId}`, {
      method: 'POST',
    }),

  generateManual: (taskId: string, data: { description: string }) =>
    request<any>(`/api/v1/commits/generate-manual/${taskId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// System Settings API
export const settingsApi = {
  list: () => request<any>('/api/v1/settings/'),

  get: (key: string) => request<any>(`/api/v1/settings/${key}`),

  set: (key: string, value: any, description?: string) => {
    const params = description ? `?description=${encodeURIComponent(description)}` : '';
    return request<any>(`/api/v1/settings/${key}${params}`, {
      method: 'PUT',
      body: JSON.stringify(value),
    });
  },

  delete: (key: string) =>
    request<any>(`/api/v1/settings/${key}`, { method: 'DELETE' }),

  bulk: (settings: Record<string, any>) =>
    request<any>('/api/v1/settings/bulk', {
      method: 'POST',
      body: JSON.stringify({ settings }),
    }),

  byPrefix: (prefix: string) =>
    request<any>(`/api/v1/settings/grouped/by-prefix?prefix=${encodeURIComponent(prefix)}`),
};

// Project Analyzers API
export const analyzersApi = {
  list: (params?: any) => {
    const queryParams = new URLSearchParams();
    if (params?.project_id) queryParams.append('project_id', params.project_id);
    const queryString = queryParams.toString();
    return request<any>(`/api/v1/analyzers/${queryString ? '?' + queryString : ''}`);
  },

  get: (id: string) => request<any>(`/api/v1/analyzers/${id}`),

  upload: async (formData: FormData) => {
    const url = `${API_URL}/api/v1/analyzers/`;
    console.log('📤 Uploading file to', url);

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        // Note: Não incluir Content-Type header para FormData
      });

      console.log('📥 Upload Response:', {
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: `Upload failed: ${response.status}` }));
        throw new Error(error.detail || `Upload failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Upload success');
      return data;
    } catch (error: any) {
      console.error('❌ Upload failed:', error.message);
      throw error;
    }
  },

  delete: (id: string) =>
    request<any>(`/api/v1/analyzers/${id}`, { method: 'DELETE' }),

  generateOrchestrator: (id: string) =>
    request<any>(`/api/v1/analyzers/${id}/generate-orchestrator`, {
      method: 'POST',
    }),

  getOrchestratorCode: (id: string) =>
    request<any>(`/api/v1/analyzers/${id}/orchestrator-code`),
};

// Consistency Issues API
export const consistencyApi = {
  list: (params?: any) => {
    const queryParams = new URLSearchParams();
    if (params?.project_id) queryParams.append('project_id', params.project_id);
    const queryString = queryParams.toString();
    return request<any>(`/api/v1/consistency-issues/${queryString ? '?' + queryString : ''}`);
  },

  get: (id: string) =>
    request<any>(`/api/v1/consistency-issues/${id}`),

  update: (id: string, data: any) =>
    request<any>(`/api/v1/consistency-issues/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<any>(`/api/v1/consistency-issues/${id}`, { method: 'DELETE' }),

  analyze: (projectId: string) =>
    request<any>(`/api/v1/consistency-issues/analyze/${projectId}`, {
      method: 'POST',
    }),

  byProject: (projectId: string, params?: any) =>
    request<any>(`/api/v1/consistency-issues/project/${projectId}`),
};
