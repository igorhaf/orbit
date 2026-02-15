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
        `Nao e possivel conectar ao backend em ${API_URL}. ` +
        `Certifique-se de que o backend esta em execucao com: uvicorn app.main:app --reload`
      );
    }

    if (error.message.includes('CORS')) {
      throw new Error(
        `Erro de CORS. Backend precisa permitir origem ${typeof window !== 'undefined' ? window.location.origin : 'localhost:3000'}. ` +
        `Verifique a configuracao de CORS do backend.`
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

// Backlog Generation API (JIRA Transformation - PROMPT #62)
// PROMPT #108 - Generate methods now return job_id for polling
export const backlogGenerationApi = {
  // Returns job_id - use jobsApi.poll() to wait for result
  generateEpic: (interviewId: string, projectId: string) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/backlog/interview/${interviewId}/generate-epic?project_id=${projectId}`, {
      method: 'POST',
    }),

  // PROMPT #108 - Generate with polling (waits for completion)
  generateEpicWithPolling: async (
    interviewId: string,
    projectId: string,
    onProgress?: (percent: number, message: string | null) => void
  ) => {
    const { job_id } = await backlogGenerationApi.generateEpic(interviewId, projectId);
    return jobsApi.poll(job_id, onProgress);
  },

  // Returns job_id - use jobsApi.poll() to wait for result
  generateStories: (epicId: string, projectId: string) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/backlog/epic/${epicId}/generate-stories?project_id=${projectId}`, {
      method: 'POST',
    }),

  // PROMPT #108 - Generate with polling
  generateStoriesWithPolling: async (
    epicId: string,
    projectId: string,
    onProgress?: (percent: number, message: string | null) => void
  ) => {
    const { job_id } = await backlogGenerationApi.generateStories(epicId, projectId);
    return jobsApi.poll(job_id, onProgress);
  },

  // Returns job_id - use jobsApi.poll() to wait for result
  generateTasks: (storyId: string, projectId: string) =>
    request<{
      job_id: string;
      status: string;
      message: string;
    }>(`/api/v1/backlog/story/${storyId}/generate-tasks?project_id=${projectId}`, {
      method: 'POST',
    }),

  // PROMPT #108 - Generate with polling
  generateTasksWithPolling: async (
    storyId: string,
    projectId: string,
    onProgress?: (percent: number, message: string | null) => void
  ) => {
    const { job_id } = await backlogGenerationApi.generateTasks(storyId, projectId);
    return jobsApi.poll(job_id, onProgress);
  },

  approveEpic: (suggestion: any, projectId: string, interviewId: string) =>
    request<any>(`/api/v1/backlog/approve-epic?project_id=${projectId}&interview_id=${interviewId}`, {
      method: 'POST',
      body: JSON.stringify(suggestion),
    }),

  approveStories: (suggestions: any[], projectId: string) =>
    request<any>(`/api/v1/backlog/approve-stories?project_id=${projectId}`, {
      method: 'POST',
      body: JSON.stringify(suggestions),
    }),

  approveTasks: (suggestions: any[], projectId: string) =>
    request<any>(`/api/v1/backlog/approve-tasks?project_id=${projectId}`, {
      method: 'POST',
      body: JSON.stringify(suggestions),
    }),
};

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

// AI Flow Chains API (PROMPT #122 - Visual Fallback Chain Configuration)
export const aiFlowApi = {
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

// RAG API (PROMPT #90 - RAG Monitoring & Code Indexing)
export const ragApi = {
  stats: (params?: {
    start_date?: string;
    end_date?: string;
    usage_type?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.append('start_date', params.start_date);
    if (params?.end_date) queryParams.append('end_date', params.end_date);
    if (params?.usage_type) queryParams.append('usage_type', params.usage_type);

    const queryString = queryParams.toString();
    return request<any>(`/api/v1/cost/rag-stats${queryString ? '?' + queryString : ''}`);
  },

  indexCode: (projectId: string, force?: boolean) =>
    request<any>(`/api/v1/projects/${projectId}/index-code`, {
      method: 'POST',
      body: force !== undefined ? JSON.stringify({ force }) : undefined,
    }),

  codeStats: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/code-stats`),

  // PROMPT #218 - Continuous RAG Evolution
  continuousScan: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/rag/scan`, {
      method: 'POST',
    }),

  continuousStatus: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/rag/status`),

  continuousFiles: (projectId: string, status?: string, page: number = 1) =>
    request<any>(`/api/v1/projects/${projectId}/rag/files?page=${page}${status ? '&status=' + status : ''}`),

  continuousReset: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/rag/reset`, {
      method: 'DELETE',
    }),

  // PROMPT #239 - Enrichment status for living wiki
  enrichmentStatus: (projectId: string) =>
    request<any>(`/api/v1/projects/${projectId}/rag/enrichment-status`),
};

// PROMPT #80 - Backlog Generation API (Epic → Stories → Tasks)
export const backlogApi = {
  // Generate Epic suggestion from interview (returns suggestion, not created yet)
  generateEpic: (interviewId: string, projectId: string) =>
    request<{
      suggestions: Array<{
        title: string;
        description: string;
        story_points?: number;
        priority: string;
        acceptance_criteria?: string[];
        interview_insights?: {
          key_requirements?: string[];
          business_goals?: string[];
          technical_constraints?: string[];
        };
        interview_question_ids?: number[];
        _metadata?: Record<string, any>;
      }>;
      metadata: Record<string, any>;
    }>(`/api/v1/backlog/interview/${interviewId}/generate-epic?project_id=${projectId}`, {
      method: 'POST',
    }),

  // Approve and create Epic in database
  approveEpic: (suggestion: any, projectId: string, interviewId: string) =>
    request<any>(`/api/v1/backlog/approve-epic?project_id=${projectId}&interview_id=${interviewId}`, {
      method: 'POST',
      body: JSON.stringify(suggestion),
    }),

  // Generate Stories from Epic
  generateStories: (epicId: string, projectId: string) =>
    request<any>(`/api/v1/backlog/epic/${epicId}/generate-stories?project_id=${projectId}`, {
      method: 'POST',
    }),

  // Approve and create Stories
  approveStories: (suggestions: any[], projectId: string) =>
    request<any>(`/api/v1/backlog/approve-stories?project_id=${projectId}`, {
      method: 'POST',
      body: JSON.stringify(suggestions),
    }),

  // Generate Tasks from Story
  generateTasks: (storyId: string, projectId: string) =>
    request<any>(`/api/v1/backlog/story/${storyId}/generate-tasks?project_id=${projectId}`, {
      method: 'POST',
    }),

  // Approve and create Tasks
  approveTasks: (suggestions: any[], projectId: string) =>
    request<any>(`/api/v1/backlog/approve-tasks?project_id=${projectId}`, {
      method: 'POST',
      body: JSON.stringify(suggestions),
    }),
};

// PROMPT #147 - Knowledge Base API (Incremental RAG Feeding)
export const knowledgeApi = {
  // Business Rules
  listRules: (projectId: string, params?: { category?: string; source?: string; limit?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.category) queryParams.append('category', params.category);
    if (params?.source) queryParams.append('source', params.source);
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());

    const queryString = queryParams.toString();
    return request<Array<{
      id: string;
      title: string;
      description: string;
      category: string;
      source: string;
      created_at: string;
    }>>(`/api/v1/projects/${projectId}/knowledge/rules${queryString ? '?' + queryString : ''}`);
  },

  addRule: (projectId: string, data: {
    title: string;
    description: string;
    category: 'validation' | 'workflow' | 'calculation' | 'permission' | 'integration';
  }) =>
    request<{ id: string; status: string; message: string }>(`/api/v1/projects/${projectId}/knowledge/rules`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteRule: (projectId: string, ruleId: string) =>
    request<{ status: string; id: string }>(`/api/v1/projects/${projectId}/knowledge/rules/${ruleId}`, {
      method: 'DELETE',
    }),

  // Documents
  listDocuments: (projectId: string) =>
    request<{
      documents: Array<{
        filename: string;
        chunks: number;
        uploaded_at: string | null;
      }>;
      total: number;
    }>(`/api/v1/projects/${projectId}/knowledge/documents`),

  uploadDocument: async (projectId: string, file: File) => {
    const url = `${API_URL}/api/v1/projects/${projectId}/knowledge/upload`;
    console.log('📤 Uploading document to', url);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
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
      console.log('✅ Document upload success');
      return data as { filename: string; chunks_indexed: number; total_chars: number };
    } catch (error: any) {
      console.error('❌ Document upload failed:', error.message);
      throw error;
    }
  },

  deleteDocument: (projectId: string, filename: string) =>
    request<{ status: string; filename: string; chunks_deleted: number }>(`/api/v1/projects/${projectId}/knowledge/documents/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),

  // Search
  search: (projectId: string, params: {
    query: string;
    include_global?: boolean;
    top_k?: number;
    similarity_threshold?: number;
  }) => {
    const queryParams = new URLSearchParams();
    queryParams.append('query', params.query);
    if (params.include_global !== undefined) queryParams.append('include_global', params.include_global.toString());
    if (params.top_k !== undefined) queryParams.append('top_k', params.top_k.toString());
    if (params.similarity_threshold !== undefined) queryParams.append('similarity_threshold', params.similarity_threshold.toString());

    return request<{
      query: string;
      project_id: string;
      results: Array<{
        id: string;
        content: string;
        similarity: number;
        metadata: Record<string, any>;
      }>;
      total_results: number;
    }>(`/api/v1/projects/${projectId}/knowledge/search?${queryParams.toString()}`);
  },

  // Statistics
  getStats: (projectId: string) =>
    request<{
      project_id: string;
      total_documents: number;
      interview_answers: number;
      domain_templates: number;
      project_specific: number;
    }>(`/api/v1/projects/${projectId}/knowledge/stats`),

  getFullStats: (projectId: string) =>
    request<{
      total_documents: number;
      business_rules_count: number;
      interview_answers_count: number;
      code_files_count: number;
      documents_count: number;
      by_category: Record<string, number>;
      by_source: Record<string, number>;
    }>(`/api/v1/projects/${projectId}/knowledge/full-stats`),

  // PROMPT #172 - Global RAG Stats (all projects)
  getGlobalStats: () =>
    request<{
      success: boolean;
      stats: {
        total_documents: number;
        by_type: Record<string, number>;
        cards_breakdown: {
          epic?: number;
          story?: number;
          task?: number;
          subtask?: number;
        };
        project_id: string | null;
      };
    }>('/api/v1/knowledge/global-stats'),

  // PROMPT #172 - Per-project RAG Stats for comparison table
  getProjectsStats: () =>
    request<{
      success: boolean;
      projects: Array<{
        project_id: string;
        project_name: string;
        total_documents: number;
        code_files: number;
        cards: number;
        business_rules: number;
        interview_answers: number;
        project_context: number;
        documents: number;
      }>;
      totals: {
        total_documents: number;
        code_files: number;
        cards: number;
        business_rules: number;
        interview_answers: number;
        project_context: number;
        documents: number;
      };
      global_only: {
        total_documents: number;
        framework_specs: number;
        prompt_docs: number;
      };
    }>('/api/v1/knowledge/projects-stats'),
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
