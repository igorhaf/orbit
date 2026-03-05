import { request } from './base';
import { jobsApi } from './jobs';

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

  // JIRA Transformation - Hierarchy (PROMPT #62)
  getChildren: (taskId: string) =>
    request<any>(`/api/v1/tasks/${taskId}/children`),

  getDescendants: (taskId: string) =>
    request<any>(`/api/v1/tasks/${taskId}/descendants`),

  getAncestors: (taskId: string) =>
    request<any>(`/api/v1/tasks/${taskId}/ancestors`),

  moveInHierarchy: (taskId: string, data: { new_parent_id?: string | null; validate_rules?: boolean }) =>
    request<any>(`/api/v1/tasks/${taskId}/move-hierarchy`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  validateChild: (taskId: string, childType: string) =>
    request<any>(`/api/v1/tasks/${taskId}/validate-child?child_type=${childType}`),

  // JIRA Transformation - Relationships (PROMPT #62)
  createRelationship: (taskId: string, data: any) =>
    request<any>(`/api/v1/tasks/${taskId}/relationships`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getRelationships: (taskId: string) =>
    request<any>(`/api/v1/tasks/${taskId}/relationships`),

  deleteRelationship: (relationshipId: string) =>
    request<any>(`/api/v1/relationships/${relationshipId}`, { method: 'DELETE' }),

  // JIRA Transformation - Comments (PROMPT #62)
  createComment: (taskId: string, data: any) =>
    request<any>(`/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getComments: (taskId: string) =>
    request<any>(`/api/v1/tasks/${taskId}/comments`),

  updateComment: (commentId: string, data: any) =>
    request<any>(`/api/v1/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteComment: (commentId: string) =>
    request<any>(`/api/v1/comments/${commentId}`, { method: 'DELETE' }),

  // JIRA Transformation - Status Transitions (PROMPT #62)
  transitionStatus: (taskId: string, data: any) =>
    request<any>(`/api/v1/tasks/${taskId}/transition`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getTransitions: (taskId: string) =>
    request<any>(`/api/v1/tasks/${taskId}/transitions`),

  getValidTransitions: (taskId: string) =>
    request<any>(`/api/v1/tasks/${taskId}/valid-transitions`),

  // JIRA Transformation - Backlog View (PROMPT #62)
  getBacklog: (projectId: string, filters?: any) => {
    const queryParams = new URLSearchParams();
    if (filters?.item_type) {
      filters.item_type.forEach((type: string) => queryParams.append('item_type', type));
    }
    if (filters?.priority) {
      filters.priority.forEach((priority: string) => queryParams.append('priority', priority));
    }
    if (filters?.assignee) queryParams.append('assignee', filters.assignee);
    if (filters?.labels) {
      filters.labels.forEach((label: string) => queryParams.append('labels', label));
    }
    if (filters?.status) {
      filters.status.forEach((status: string) => queryParams.append('status', status));
    }

    const queryString = queryParams.toString();
    return request<any>(`/api/v1/tasks/projects/${projectId}/backlog${queryString ? '?' + queryString : ''}`);
  },

  // PROMPT #68 - Task Exploration: Create sub-interview from task
  createInterview: (taskId: string) =>
    request<any>(`/api/v1/tasks/${taskId}/create-interview`, {
      method: 'POST',
    }),

  // PROMPT #95 - Blocking System: Get, Approve, Reject blocked tasks
  getBlocked: (projectId: string) => {
    const queryParams = new URLSearchParams();
    queryParams.append('project_id', projectId);
    return request<any>(`/api/v1/tasks/blocked?${queryParams.toString()}`);
  },

  approveModification: (taskId: string) =>
    request<any>(`/api/v1/tasks/${taskId}/approve-modification`, {
      method: 'POST',
    }),

  rejectModification: (taskId: string, reason?: string) =>
    request<any>(`/api/v1/tasks/${taskId}/reject-modification`, {
      method: 'POST',
      body: JSON.stringify(reason ? { rejection_reason: reason } : {}),
    }),

  // PROMPT #97 - Blocking Analytics
  getBlockingAnalytics: (projectId?: string, days: number = 30) => {
    const queryParams = new URLSearchParams();
    if (projectId) {
      queryParams.append('project_id', projectId);
    }
    queryParams.append('days', days.toString());
    return request<any>(`/api/v1/tasks/analytics/blocking?${queryParams.toString()}`);
  },

  // PROMPT #94 - Activate/Reject Suggested Epics
  // PROMPT #102 - Extended to support all item types with hierarchical draft generation
  // PROMPT #108 - Returns job_id for polling (background execution)
  activateSuggestedEpic: (taskId: string) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/tasks/${taskId}/activate`, {
      method: 'POST',
    }),

  // PROMPT #108 - Activate with polling (waits for completion)
  activateSuggestedEpicWithPolling: async (
    taskId: string,
    onProgress?: (percent: number, message: string | null) => void
  ) => {
    const { job_id } = await tasksApi.activateSuggestedEpic(taskId);
    return jobsApi.poll(job_id, onProgress);
  },

  rejectSuggestedEpic: (taskId: string) =>
    request<void>(`/api/v1/tasks/${taskId}/reject`, {
      method: 'DELETE',
    }),

  // PROMPT #127 - Generate children on-demand
  generateChildren: (taskId: string, count: number) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/tasks/${taskId}/generate-children`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    }),

  // PROMPT #241 - Orbit Folder: Export prompt to orbit/prompts/
  exportPrompt: (taskId: string) =>
    request<{
      task_id: string;
      filename: string;
      file_path: string;
      orbit_path: string;
      message: string;
    }>(`/api/v1/tasks/${taskId}/export-prompt`, {
      method: 'POST',
    }),

  // PROMPT #241 - Orbit Folder: Get orbit/ folder status for a project
  getOrbitStatus: (projectId: string) =>
    request<{
      project_id: string;
      exists: boolean;
      orbit_path: string | null;
      prompts: number;
      results: number;
      knowledge: number;
    }>(`/api/v1/tasks/project/${projectId}/orbit-status`),

  // PROMPT #242 - Orbit Folder: Check for result file in orbit/results/
  checkResult: (taskId: string) =>
    request<{
      task_id: string;
      found: boolean;
      title: string | null;
      status: string | null;
      filename: string | null;
      message: string;
    }>(`/api/v1/tasks/${taskId}/check-result`, {
      method: 'POST',
    }),

  // Generate AI description for a card (any status, not just suggested)
  generateDescription: (taskId: string) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/tasks/${taskId}/generate-description`, {
      method: 'POST',
    }),

  // PROMPT #248 - Generate semantic prompt from card + RAG/wiki/git context
  // Returns job_id for polling (background execution)
  generateSemanticPrompt: (taskId: string, force?: boolean) =>
    request<{
      job_id?: string;
      status?: string;
      message?: string;
      // Fallback fields for REGRA #0 inline response (human-edited check)
      success?: boolean;
      prompt?: string | null;
    }>(`/api/v1/tasks/${taskId}/generate-semantic-prompt`, {
      method: 'POST',
      body: JSON.stringify({ force: force || false }),
    }),

  // PROMPT #248 - Generate semantic prompt with polling (waits for completion)
  generateSemanticPromptWithPolling: async (
    taskId: string,
    force?: boolean,
    onProgress?: (percent: number, message: string | null) => void
  ) => {
    const res = await tasksApi.generateSemanticPrompt(taskId, force);

    // REGRA #0: inline response when prompt was human-edited
    if (res.success === false && !res.job_id) {
      return res;
    }

    if (!res.job_id) {
      throw new Error(res.message || 'Falha ao criar job');
    }

    const result = await jobsApi.poll(res.job_id, onProgress);
    return result;
  },

  // PROMPT #253 - AI title suggestion
  suggestTitle: (data: {
    user_input: string;
    item_type: string;
    project_id: string;
    parent_id?: string | null;
  }) =>
    request<{ suggested_title: string }>('/api/v1/tasks/suggest-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // PROMPT #108 - Execute single task (returns job_id)
  execute: (taskId: string, maxAttempts: number = 3) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/tasks/${taskId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ max_attempts: maxAttempts }),
    }),

  // PROMPT #108 - Execute all tasks in project (returns job_id)
  executeAll: (projectId: string) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/tasks/projects/${projectId}/execute-all`, {
      method: 'POST',
    }),

  // PROMPT #131 - Run card inference from interview data
  runCardInference: (taskId: string, interviewId: string) =>
    request<any>(`/api/v1/tasks/${taskId}/card-inference`, {
      method: 'POST',
      body: JSON.stringify({ interview_id: interviewId }),
    }),
};
