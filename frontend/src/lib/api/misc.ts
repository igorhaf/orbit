import { request } from './base';
import { API_URL } from './base';

// System Settings API
export const settingsApi = {
  list: () => request<any>('/api/v1/settings/'),

  get: (key: string) => request<any>(`/api/v1/settings/${key}`),

  set: (key: string, value: any, description?: string) => {
    return request<any>(`/api/v1/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, description }),
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

  // PROMPT #250 - Global Blocklist
  getBlocklist: () =>
    request<{ directories: string[]; file_patterns: string[] }>('/api/v1/settings/blocklist'),

  saveBlocklist: (data: { directories: string[]; file_patterns: string[] }) =>
    request<{ directories: string[]; file_patterns: string[] }>('/api/v1/settings/blocklist', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  getBlocklistSuggestions: () =>
    request<Array<{ path: string; type: string; source_project: string; rationale: string }>>('/api/v1/settings/blocklist/suggestions'),

  approveBlocklistSuggestions: (items: Array<{ path: string; type: string }>) =>
    request<{ blocklist: any; remaining_suggestions: number }>('/api/v1/settings/blocklist/suggestions/approve', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  rejectBlocklistSuggestions: (items: Array<{ path: string; type: string }>) =>
    request<{ remaining_suggestions: number }>('/api/v1/settings/blocklist/suggestions/reject', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  addFileToBlocklist: (filePath: string) =>
    request<{ directories: string[]; file_patterns: string[] }>('/api/v1/settings/blocklist/add-file', {
      method: 'POST',
      body: JSON.stringify({ file_path: filePath }),
    }),
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

// PROMPT #215 - Prompt Queue API
export const promptQueueApi = {
  get: (projectId: string, statusFilter?: string) => {
    const params = statusFilter ? `?status_filter=${statusFilter}` : '';
    return request<any>(`/api/v1/projects/${projectId}/queue${params}`);
  },

  add: (projectId: string, taskId: string) =>
    request<any>(`/api/v1/projects/${projectId}/queue`, {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId }),
    }),

  bulkAdd: (projectId: string, taskIds: string[]) =>
    request<any>(`/api/v1/projects/${projectId}/queue/bulk`, {
      method: 'POST',
      body: JSON.stringify({ task_ids: taskIds }),
    }),

  remove: (projectId: string, queueItemId: string) =>
    request<void>(`/api/v1/projects/${projectId}/queue/${queueItemId}`, {
      method: 'DELETE',
    }),

  clearCompleted: (projectId: string) =>
    request<void>(`/api/v1/projects/${projectId}/queue`, {
      method: 'DELETE',
    }),

  reorder: (projectId: string, orderedIds: string[]) =>
    request<any>(`/api/v1/projects/${projectId}/queue/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ ordered_ids: orderedIds }),
    }),

  autoSort: (projectId: string, strategy: string = 'balanced') =>
    request<any>(`/api/v1/projects/${projectId}/queue/auto-sort`, {
      method: 'POST',
      body: JSON.stringify({ strategy }),
    }),

  populate: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/queue/populate`, {
      method: 'POST',
    }),

  updateStatus: (projectId: string, queueItemId: string, newStatus: string) =>
    request<any>(`/api/v1/projects/${projectId}/queue/${queueItemId}/status?new_status=${newStatus}`, {
      method: 'PATCH',
    }),

  stats: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/queue/stats`),
};

// PROMPT #282 - Project Chat API (RAG-based knowledge chat)
export const projectChatsApi = {
  list: (projectId: string) =>
    request<any[]>(`/api/v1/projects/${projectId}/chats`),

  create: (projectId: string, data?: { title?: string }) =>
    request<any>(`/api/v1/projects/${projectId}/chats`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  get: (projectId: string, chatId: string) =>
    request<any>(`/api/v1/projects/${projectId}/chats/${chatId}`),

  delete: (projectId: string, chatId: string) =>
    request<any>(`/api/v1/projects/${projectId}/chats/${chatId}`, {
      method: 'DELETE',
    }),

  updateTitle: (projectId: string, chatId: string, title: string) =>
    request<any>(`/api/v1/projects/${projectId}/chats/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  sendMessage: (projectId: string, chatId: string, content: string) =>
    request<any>(`/api/v1/projects/${projectId}/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
};
