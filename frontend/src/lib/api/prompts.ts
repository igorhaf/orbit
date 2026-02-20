import { request } from './base';

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

  deleteAll: (projectId: string) =>
    request<any>(`/api/v1/prompts/?project_id=${projectId}`, { method: 'DELETE' }),

  versions: (id: string) =>
    request<any>(`/api/v1/prompts/${id}/versions`),

  createVersion: (id: string, content: string) =>
    request<any>(`/api/v1/prompts/${id}/version?new_content=${encodeURIComponent(content)}`, {
      method: 'POST',
    }),

  reusable: () =>
    request<any>('/api/v1/prompts/reusable/all'),
};
