/**
 * Common types: Settings, Kanban, Analytics, API responses, form/UI state, RAG stats, Prompt Queue
 */

import { TaskStatus } from './enums';
import { Task } from './task';

// SYSTEM SETTINGS

export interface SystemSettings {
  id: string;
  key: string;
  value: any;
  description: string | null;
  updated_at: string;
}

export interface SystemSettingsCreate {
  key: string;
  value: any;
  description?: string | null;
}

export interface SystemSettingsUpdate {
  value?: any;
  description?: string | null;
}

export interface SystemSettingsBulkUpdate {
  settings: Record<string, any>;
}

// KANBAN BOARD

export interface KanbanColumn {
  id: string;
  title: string;
  status: TaskStatus;
  tasks: Task[];
}

export interface KanbanBoard {
  project_id: string;
  columns: KanbanColumn[];
}

// BLOCKING ANALYTICS (PROMPT #97)

export interface BlockingAnalytics {
  // Current state
  total_blocked: number;
  total_approved: number;
  total_rejected: number;

  // Rates
  approval_rate: number;  // % of resolved modifications that were approved
  rejection_rate: number;  // % of resolved modifications that were rejected
  blocking_rate: number;  // % of all tasks that got blocked

  // Similarity metrics
  avg_similarity_score: number;
  similarity_distribution: {
    '90+': number;
    '80-90': number;
    '70-80': number;
    '<70': number;
  };

  // Timeline
  blocked_by_date: Array<{
    date: string;
    count: number;
  }>;

  // Project breakdown
  blocked_by_project: Array<{
    project_id: string;
    project_name: string;
    count: number;
  }>;
}

// API RESPONSE TYPES

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

export interface ApiError {
  detail: string;
  error_type?: string;
  technical_details?: string;
}

// FORM STATE TYPES

export interface FormState<T> {
  data: T;
  errors: Partial<Record<keyof T, string>>;
  isSubmitting: boolean;
  isValid: boolean;
}

// UI STATE TYPES

export interface LoadingState {
  isLoading: boolean;
  message?: string;
}

export interface ToastNotification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
}

// RAG MONITORING & CODE INDEXING (PROMPT #90)

export interface RagStats {
  total_rag_enabled: number;
  total_rag_hits: number;
  hit_rate: number;
  avg_results_count: number;
  avg_top_similarity: number;
  avg_retrieval_time_ms: number;
  by_usage_type: RagUsageTypeStats[];
}

export interface RagUsageTypeStats {
  usage_type: string;
  total: number;
  hits: number;
  hit_rate: number;
  avg_results_count: number;
  avg_top_similarity: number;
  avg_retrieval_time_ms: number;
}

export interface CodeIndexingStats {
  project_id: string;
  total_documents: number;
  avg_content_length: number;
  document_types: string[];
}

export interface IndexCodeJob {
  job_id: string;
  status: 'completed' | 'pending' | 'failed';
  message: string;
  result?: {
    files_scanned: number;
    files_indexed: number;
    files_skipped: number;
    languages: Record<string, number>;
    total_lines: number;
  };
}

// PROMPT #172 - GLOBAL RAG STATS

export interface GlobalRagStats {
  total_documents: number;
  by_type: {
    [key: string]: number;  // card, interview_answer, project_context, code_file, etc.
  };
  cards_breakdown: {
    epic?: number;
    story?: number;
    task?: number;
  };
  project_id: string | null;
}

// PROMPT QUEUE (PROMPT #215)

export interface PromptQueueItem {
  id: string;
  project_id: string;
  task_id: string;
  position: number;
  status: string;
  priority_score: number;
  hierarchy_score: number;
  age_score: number;
  dependency_score: number;
  manual_override: boolean;
  execution_job_id: string | null;
  execution_notes: string | null;
  created_at: string;
  updated_at: string;
  executed_at: string | null;
  // Joined task info
  task_title: string | null;
  task_item_type: string | null;
  task_priority: string | null;
  task_workflow_state: string | null;
  task_parent_id: string | null;
  task_created_at: string | null;
  task_labels: string[] | null;
}

export interface PromptQueueResponse {
  project_id: string;
  items: PromptQueueItem[];
  total: number;
  pending_count: number;
  ready_count: number;
  executing_count: number;
  completed_count: number;
}
