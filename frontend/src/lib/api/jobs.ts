import { request } from './base';

// Job status type
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobResponse {
  id: string;
  job_type: string;
  status: JobStatus;
  progress_percent: number | null;
  progress_message: string | null;
  result: any | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  // PROMPT #133 - Deep linking support
  deep_link?: string | null;
  notification_title?: string | null;
  project_id?: string | null;
  task_id?: string | null;
  interview_id?: string | null;
  // PROMPT #120 - Job priority system
  priority?: number | null;
  // PROMPT #299 - AI model name
  ai_model_name?: string | null;
  // PROMPT #298 - Sub-job hierarchy
  parent_job_id?: string | null;
  phase_label?: string | null;
  children_count?: number;
  input_data?: any | null;
}

// Jobs API (PROMPT #65 - Async Job System)
// PROMPT #108 - Added polling utility for background queue
// PROMPT #135 - Added comprehensive job queue management endpoints
export const jobsApi = {
  get: (jobId: string) =>
    request<JobResponse>(`/api/v1/jobs/${jobId}`),

  // PROMPT #286 - Job log entries for detail view
  logs: (jobId: string) =>
    request<{ job_id: string; logs: Array<{ id: string; job_id: string; timestamp: string; level: string; message: string; progress_percent: number | null }>; total: number }>(`/api/v1/jobs/${jobId}/logs`),

  delete: (jobId: string) =>
    request<void>(`/api/v1/jobs/${jobId}`, { method: 'DELETE' }),

  // PROMPT #65 - Cancel a running or pending job
  cancel: (jobId: string) =>
    request<{ id: string; status: string; message: string }>(`/api/v1/jobs/${jobId}/cancel`, {
      method: 'PATCH',
    }),

  // PROMPT #135 - List all jobs with filtering and pagination
  list: (params?: {
    status?: string;
    job_type?: string;
    project_id?: string;
    limit?: number;
    offset?: number;
    sort_by?: string;
    sort_order?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.job_type) queryParams.append('job_type', params.job_type);
    if (params?.project_id) queryParams.append('project_id', params.project_id);
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.offset !== undefined) queryParams.append('offset', params.offset.toString());
    if (params?.sort_by) queryParams.append('sort_by', params.sort_by);
    if (params?.sort_order) queryParams.append('sort_order', params.sort_order);

    const queryString = queryParams.toString();
    return request<{
      jobs: JobResponse[];
      total: number;
      limit: number;
      offset: number;
    }>(`/api/v1/jobs/${queryString ? '?' + queryString : ''}`);
  },

  // PROMPT #135 - Get job statistics
  stats: (params?: { project_id?: string; hours?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.project_id) queryParams.append('project_id', params.project_id);
    if (params?.hours !== undefined) queryParams.append('hours', params.hours.toString());

    const queryString = queryParams.toString();
    return request<{
      total_jobs: number;
      by_status: Record<string, number>;
      by_type: Record<string, number>;
      avg_duration_seconds: number;
      jobs_per_hour: Array<{ hour: string; count: number }>;
      error_rate: number;
      recent_errors: Array<{
        id: string;
        job_type: string;
        error: string;
        notification_title: string | null;
        completed_at: string | null;
      }>;
      time_range_hours: number;
    }>(`/api/v1/jobs/stats${queryString ? '?' + queryString : ''}`);
  },

  // PROMPT #135 - List available job types
  types: () =>
    request<Array<{ value: string; label: string }>>('/api/v1/jobs/types'),

  // PROMPT #135 - List available job statuses
  statuses: () =>
    request<Array<{ value: string; label: string }>>('/api/v1/jobs/statuses'),

  // PROMPT #135 - Bulk delete jobs
  bulkDelete: (params: {
    status?: string;
    job_type?: string;
    older_than_hours?: number;
  }) => {
    const queryParams = new URLSearchParams();
    if (params.status) queryParams.append('status', params.status);
    if (params.job_type) queryParams.append('job_type', params.job_type);
    if (params.older_than_hours !== undefined) queryParams.append('older_than_hours', params.older_than_hours.toString());

    const queryString = queryParams.toString();
    return request<{ deleted_count: number; message: string }>(`/api/v1/jobs/bulk?${queryString}`, {
      method: 'DELETE',
    });
  },

  // PROMPT #135 - Cleanup old jobs
  cleanup: (days: number = 7) =>
    request<{ deleted_count: number; cutoff_days: number; message: string }>(`/api/v1/jobs/cleanup?days=${days}`, {
      method: 'POST',
    }),

  // PROMPT #298 - Get children of a parent job
  getChildren: (jobId: string) =>
    request<{ children: JobResponse[] }>(`/api/v1/jobs/${jobId}/children`),

  // Bulk delete jobs by specific IDs
  bulkDeleteByIds: (jobIds: string[]) =>
    request<{ deleted_count: number; message: string }>('/api/v1/jobs/bulk/delete-by-ids', {
      method: 'POST',
      body: JSON.stringify(jobIds),
    }),

  // Bulk cancel jobs by specific IDs
  bulkCancelByIds: (jobIds: string[]) =>
    request<{ cancelled_count: number; skipped_count: number; message: string }>('/api/v1/jobs/bulk/cancel-by-ids', {
      method: 'POST',
      body: JSON.stringify(jobIds),
    }),

  // PROMPT #243 - Executor pause/resume
  pauseExecutor: () =>
    request<{ paused: boolean; message: string }>('/api/v1/jobs/executor/pause', { method: 'PATCH' }),

  resumeExecutor: () =>
    request<{ paused: boolean; message: string }>('/api/v1/jobs/executor/resume', { method: 'PATCH' }),

  executorStatus: () =>
    request<{ paused: boolean; queue_size: number; active_jobs: number }>('/api/v1/jobs/executor/status'),

  // PROMPT #108 - Poll until job completes
  // Returns the job result when completed, throws error when failed
  poll: async (
    jobId: string,
    onProgress?: (percent: number, message: string | null) => void,
    intervalMs: number = 1000,
    timeoutMs: number = 300000 // 5 min timeout
  ): Promise<any> => {
    const startTime = Date.now();

    while (true) {
      const job = await jobsApi.get(jobId);

      // Update progress callback
      if (onProgress && job.progress_percent !== null) {
        onProgress(job.progress_percent, job.progress_message);
      }

      // Check final states
      if (job.status === 'completed') {
        return job.result;
      }

      if (job.status === 'failed') {
        throw new Error(job.error || 'Job falhou');
      }

      if (job.status === 'cancelled') {
        throw new Error('Job foi cancelado');
      }

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Timeout na consulta do job');
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  },
};
