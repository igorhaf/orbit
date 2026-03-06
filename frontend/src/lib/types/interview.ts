/**
 * Interview domain types
 */

import { InterviewStatus } from './enums';

export interface MessageOption {
  id: string;
  label: string;
  value: string;
  icon?: string;
}

export interface MessageOptions {
  type: 'single' | 'multiple';
  choices: MessageOption[];
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  options?: MessageOptions;
  selected_options?: string[];

  // PROMPT #57 - Fixed Questions Without AI
  model?: string;                    // AI model or "system/fixed-question"
  question_type?: 'text' | 'single_choice' | 'multiple_choice';  // Type of question
  question_number?: number;          // Question number (1-6 for fixed questions)
  prefilled_value?: string;          // Pre-filled value for text questions (Q1, Q2)
}

export interface Interview {
  id: string;
  project_id: string;
  ai_model_used: string;
  conversation_data: ConversationMessage[];
  status: InterviewStatus;
  created_at: string;
  interview_mode?: string; // "meta_prompt" | "requirements" | "task_focused" | "context" | "card_inference"
  task_type_selection?: string; // For task-focused interviews
  focus_topics?: string[]; // For meta prompt interviews (PROMPT #77)
  parent_task_id?: string | null; // PROMPT #130 - Parent task for card interviews
  motivation_type?: string; // PROMPT #130 - Card motivation type (bug, feature, etc.)
}

export interface InterviewCreate {
  project_id: string;
  ai_model_used: string;
  conversation_data?: ConversationMessage[];
  parent_task_id?: string | null; // PROMPT #130 - Parent task for card interviews
  use_card_focused?: boolean; // PROMPT #130 - Enable card inference mode
}

export interface InterviewUpdate {
  conversation_data?: ConversationMessage[];
  status?: InterviewStatus;
}

export interface InterviewAddMessage {
  role?: 'user' | 'assistant';
  content: string;
  selected_options?: string[];
}

// Stack Configuration (PROMPT #46 - Phase 1)
export interface StackConfiguration {
  backend: string;
  database: string;
  frontend: string;
  css: string;
}

// Project Info Update (PROMPT #57 - Editable Title/Description)
export interface ProjectInfoUpdate {
  title?: string;
  description?: string;
}
