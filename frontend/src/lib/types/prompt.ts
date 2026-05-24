/**
 * Prompt, Commit, and ChatSession types
 */

import { ChatSessionStatus, CommitType } from './enums';

// PROMPT

export interface Prompt {
  id: string;
  project_id: string;
  created_from_interview_id: string | null;
  parent_id: string | null;
  version: number;
  content: string;
  type: string;
  is_reusable: boolean;
  components: string[];
  created_at: string;
  updated_at: string;

  // PROMPT #58 - AI Execution Audit Fields
  ai_model_used?: string;
  system_prompt?: string;
  user_prompt?: string;
  response?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_cost_usd?: number;
  execution_time_ms?: number;
  execution_metadata?: Record<string, any>;
  status?: 'success' | 'error';
  error_message?: string;
}

export interface PromptCreate {
  project_id: string;
  content: string;
  type?: string;
  is_reusable?: boolean;
  components?: string[];
  created_from_interview_id?: string | null;
  parent_id?: string | null;
}

export interface PromptUpdate {
  content?: string;
  type?: string;
  is_reusable?: boolean;
  components?: string[];
}

export interface PromptGenerateRequest {
  interview_id: string;
  project_id: string;
}

// CHAT SESSION

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  provider?: string;  // v2.5: always 'claudius'
  model?: string;     // Claude model (claude-sonnet-4-6, claude-opus-4-7, claude-haiku-4-5)
}

export interface ChatSession {
  id: string;
  task_id: string;
  ai_model_used: string;
  messages: ChatMessage[];
  status: ChatSessionStatus;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionCreate {
  task_id: string;
  ai_model_used: string;
  messages?: ChatMessage[];
}

export interface ChatSessionUpdate {
  messages?: ChatMessage[];
  status?: ChatSessionStatus;
}

export interface ChatSessionAddMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// COMMIT

export interface Commit {
  id: string;
  task_id: string;
  project_id: string;
  type: CommitType;
  message: string;
  changes: Record<string, any>;
  created_by_ai_model: string;
  author: string;
  timestamp: string;
}

export interface CommitCreate {
  task_id: string;
  project_id: string;
  type: CommitType;
  message: string;
  changes?: Record<string, any>;
  created_by_ai_model: string;
  author?: string;
}

export interface CommitUpdate {
  message?: string;
  changes?: Record<string, any>;
}

export interface CommitGenerateRequest {
  task_id: string;
  project_id: string;
  changes_context?: string;
}

export interface CommitStatistics {
  statistics: Array<{
    type: string;
    count: number;
  }>;
  total: number;
}
