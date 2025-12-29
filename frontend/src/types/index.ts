/**
 * Type Definitions
 * Shared TypeScript types and interfaces
 */

// Health check response
export interface HealthResponse {
  status: string
  version: string
  environment: string
  app_name: string
}

// Project types
export interface Project {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  git_repository_info?: Record<string, unknown>
}

export interface ProjectCreate {
  name: string
  description: string
  git_repository_info?: Record<string, unknown>
}

// Interview types
export interface Interview {
  id: string
  project_id: string
  conversation_data: ConversationMessage[]
  ai_model_used: string
  created_at: string
  status: 'active' | 'completed' | 'cancelled'
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

// Prompt types
export interface Prompt {
  id: string
  content: string
  type: string
  is_reusable: boolean
  components: string[]
  project_id: string
  version: number
  parent_id?: string
}

// Task types
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done'

export interface Task {
  id: string
  title: string
  description: string
  prompt_id?: string
  status: TaskStatus
  order: number
  column: TaskStatus
  created_at: string
  updated_at: string
}

// AI Model types
export interface AIModel {
  id: string
  name: string
  provider: string
  api_key: string
  usage_type: string
  is_active: boolean
}

// Commit types
export type CommitType = 'feat' | 'fix' | 'docs' | 'style' | 'refactor' | 'test' | 'chore' | 'perf'

export interface Commit {
  id: string
  type: CommitType
  message: string
  changes: Record<string, unknown>
  created_by_ai_model: string
  task_id: string
  timestamp: string
}
