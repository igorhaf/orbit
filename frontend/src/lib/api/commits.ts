import { request } from './base';
import { jobsApi } from './jobs';

// Commits API
// PROMPT #108 - Generate methods now return job_id for polling
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

  // PROMPT #108 - Returns job_id for polling
  autoGenerate: (chatSessionId: string) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/commits/auto-generate/${chatSessionId}`, {
      method: 'POST',
    }),

  // PROMPT #108 - Generate with polling (waits for completion)
  autoGenerateWithPolling: async (
    chatSessionId: string,
    onProgress?: (percent: number, message: string | null) => void
  ) => {
    const { job_id } = await commitsApi.autoGenerate(chatSessionId);
    return jobsApi.poll(job_id, onProgress);
  },

  // PROMPT #108 - Returns job_id for polling
  generateManual: (taskId: string, data: { description: string }) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/commits/generate-manual/${taskId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // PROMPT #108 - Generate with polling (waits for completion)
  generateManualWithPolling: async (
    taskId: string,
    data: { description: string },
    onProgress?: (percent: number, message: string | null) => void
  ) => {
    const { job_id } = await commitsApi.generateManual(taskId, data);
    return jobsApi.poll(job_id, onProgress);
  },
};
