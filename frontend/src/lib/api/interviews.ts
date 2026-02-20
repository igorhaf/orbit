import { request } from './base';

// Interviews API
export const interviewsApi = {
  // PROMPT #146 - Support filtering by project_id and status
  list: (params?: { project_id?: string; status?: string; skip?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.project_id) searchParams.append('project_id', params.project_id);
    if (params?.status) searchParams.append('status', params.status);
    if (params?.skip !== undefined) searchParams.append('skip', String(params.skip));
    if (params?.limit !== undefined) searchParams.append('limit', String(params.limit));
    const queryString = searchParams.toString();
    return request<any>(`/api/v1/interviews/${queryString ? `?${queryString}` : ''}`);
  },

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

  // PROMPT #87 - Delete interview
  delete: (id: string) =>
    request<any>(`/api/v1/interviews/${id}`, { method: 'DELETE' }),

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

  // PROMPT #59 - Provision project based on stack configuration
  provision: (id: string) =>
    request<{
      success: boolean;
      message: string;
      project_name: string;
      project_path: string;
      stack: any;
      credentials: any;
      next_steps: string[];
      script_used: string;
    }>(`/api/v1/interviews/${id}/provision`, {
      method: 'POST',
    }),

  // PROMPT #65 - Async endpoints (non-blocking)
  sendMessageAsync: (id: string, data: { content: string; selected_options?: string[] }) =>
    request<{ job_id: string; status: string; message: string }>(`/api/v1/interviews/${id}/send-message-async`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  generatePromptsAsync: (id: string) =>
    request<{ job_id: string; status: string; message: string }>(`/api/v1/interviews/${id}/generate-prompts-async`, {
      method: 'POST',
    }),

  saveStackAsync: (id: string, stack: { backend: string | null; database: string | null; frontend: string | null; css: string | null }) =>
    request<{ job_id: string; status: string; message: string }>(`/api/v1/interviews/${id}/save-stack-async`, {
      method: 'POST',
      body: JSON.stringify(stack),
    }),

  // PROMPT #89 - Generate context from Context Interview
  generateContext: (id: string) =>
    request<{
      success: boolean;
      context_semantic: string;
      context_human: string;
      semantic_map: Record<string, string>;
      interview_insights: any;
    }>(`/api/v1/interviews/${id}/generate-context`, {
      method: 'POST',
    }),
};
