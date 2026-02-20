import { request } from './base';
import { API_URL } from './base';

// PROMPT #147 - Knowledge Base API (Incremental RAG Feeding)
export const knowledgeApi = {
  // Business Rules
  listRules: (projectId: string, params?: { category?: string; source?: string; source_file?: string; limit?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.category) queryParams.append('category', params.category);
    if (params?.source) queryParams.append('source', params.source);
    if (params?.source_file) queryParams.append('source_file', params.source_file);
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

  // PROMPT #238 - Code files list for individual page
  getCodeFiles: (projectId: string) =>
    request<{
      project_id: string;
      total: number;
      by_language: Record<string, number>;
      files: Array<{
        id: string;
        file_path: string;
        language: string;
        source: string;
        created_at: string | null;
      }>;
    }>(`/api/v1/projects/${projectId}/knowledge/code-files`),

  // PROMPT #238 - Rules grouped by source file
  getRulesByFile: (projectId: string) =>
    request<{
      project_id: string;
      total_rules: number;
      total_files: number;
      files: Array<{
        source_file: string;
        rules_count: number;
      }>;
    }>(`/api/v1/projects/${projectId}/knowledge/rules-by-file`),

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

  // PROMPT #243 - Orbit Knowledge Upload (disk + RAG)
  uploadOrbitKnowledge: async (projectId: string, file: File) => {
    const url = `${API_URL}/api/v1/projects/${projectId}/knowledge/upload-orbit`;
    console.log('📤 Uploading orbit knowledge to', url);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      console.log('📥 Orbit Upload Response:', {
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: `Upload failed: ${response.status}` }));
        throw new Error(error.detail || `Upload failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Orbit knowledge upload success');
      return data as {
        filename: string;
        file_path: string;
        size_bytes: number;
        chunks_indexed: number;
        orbit_path: string;
      };
    } catch (error: any) {
      console.error('❌ Orbit knowledge upload failed:', error.message);
      throw error;
    }
  },

  listOrbitFiles: (projectId: string) =>
    request<{
      files: Array<{
        filename: string;
        size_bytes: number;
        modified_at: string;
      }>;
      total: number;
    }>(`/api/v1/projects/${projectId}/knowledge/orbit-files`),

  deleteOrbitFile: (projectId: string, filename: string) =>
    request<{ status: string; filename: string; chunks_deleted: number }>(
      `/api/v1/projects/${projectId}/knowledge/orbit-files/${encodeURIComponent(filename)}`,
      { method: 'DELETE' }
    ),
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
