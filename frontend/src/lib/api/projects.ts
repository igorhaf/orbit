import { request } from './base';

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

  // PROMPT #89 - Context Interview endpoints
  getContext: (id: string) =>
    request<any>(`/api/v1/projects/${id}/context`),

  lockContext: (id: string) =>
    request<any>(`/api/v1/projects/${id}/lock-context`, { method: 'POST' }),

  // PROMPT #121 - Create project and run full pipeline
  createAndProcess: (codePath: string, scanDepth: string = 'normal') =>
    request<any>(`/api/v1/projects/create-and-process?code_path=${encodeURIComponent(codePath)}&scan_depth=${scanDepth}`, {
      method: 'POST',
    }),

  // PROMPT #121 - Generate epics from memory
  generateCards: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/generate-cards`, {
      method: 'POST',
    }),

  // PROMPT #237 - Generate full hierarchy (Epics → Stories → Tasks → Subtasks)
  generateHierarchy: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/generate-hierarchy`, {
      method: 'POST',
    }),

  // PROMPT #111 - Browse folders for project creation
  browseFolders: (path: string = '') =>
    request<{
      current_path: string;
      relative_path: string;
      parent_path: string | null;
      folders: Array<{
        name: string;
        path: string;
        full_path: string;
        is_project: boolean;
      }>;
      can_select: boolean;
      error?: string;
    }>(`/api/v1/projects/browse-folders?path=${encodeURIComponent(path)}`),

  // Browse files for file picker
  browseFiles: (path: string = '') =>
    request<{
      current_path: string;
      relative_path: string;
      parent_path: string | null;
      folders: Array<{
        name: string;
        path: string;
        full_path: string;
      }>;
      files: Array<{
        name: string;
        path: string;
        full_path: string;
        extension: string;
        size: number;
      }>;
      error?: string;
    }>(`/api/v1/projects/browse-files?path=${encodeURIComponent(path)}`),
};
