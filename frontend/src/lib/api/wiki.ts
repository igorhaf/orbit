import { request } from './base';

// PROMPT #261 - Wiki API (Multi-page Wiki System)
export const wikiApi = {
  list: (projectId: string, parentId?: string) => {
    const params = parentId ? `?parent_id=${parentId}` : '';
    return request<any[]>(`/api/v1/projects/${projectId}/wiki${params}`);
  },

  tree: (projectId: string) =>
    request<any[]>(`/api/v1/projects/${projectId}/wiki/tree`),

  get: (projectId: string, slug: string) =>
    request<any>(`/api/v1/projects/${projectId}/wiki/${slug}`),

  create: (projectId: string, data: { title: string; slug: string; content: string; parent_id?: string; order_index?: number; source?: string }) =>
    request<any>(`/api/v1/projects/${projectId}/wiki`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (projectId: string, slug: string, data: { title?: string; content?: string; parent_id?: string; order_index?: number }) =>
    request<any>(`/api/v1/projects/${projectId}/wiki/${slug}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (projectId: string, slug: string) =>
    request<void>(`/api/v1/projects/${projectId}/wiki/${slug}`, {
      method: 'DELETE',
    }),

  generateFromContext: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/wiki/generate-from-context`, {
      method: 'POST',
    }),

  enrichRules: (projectId: string, force: boolean = false) =>
    request<any>(`/api/v1/projects/${projectId}/wiki/enrich-rules?force=${force}`, {
      method: 'POST',
    }),

  relink: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/wiki/relink`, {
      method: 'POST',
    }),
};
