/**
 * Project domain types
 */

export interface Project {
  id: string;
  name: string;
  description: string | null;
  git_repository_info: Record<string, any> | null;

  // PROMPT #111 - code_path é OBRIGATÓRIO e IMUTÁVEL
  code_path: string;

  // Stack configuration (PROMPT #46 - Phase 1)
  stack_backend?: string | null;
  stack_database?: string | null;
  stack_frontend?: string | null;
  stack_css?: string | null;

  // Context fields (PROMPT #89 - Context Interview)
  context_semantic?: string | null;
  context_human?: string | null;
  context_locked?: boolean;
  context_locked_at?: string | null;

  // PROMPT #121 - Project lifecycle status
  // draft: Initial state
  // processing: Pipeline running (scan + context)
  // active: Ready to use
  status?: 'draft' | 'processing' | 'active';

  // PROMPT #121 - Memory scan data
  initial_memory_context?: Record<string, any> | null;

  // PROMPT #236 - Deletion protection
  protected?: boolean;

  // PROMPT #241 - User-editable ignore paths
  ignore_paths?: string[] | null;

  // PROMPT #243 - Pinned fragments (persisted text selections)
  pinned_fragments?: string[] | null;

  // PROMPT #282 - Track which AI model generated the description
  description_ai_model?: string | null;

  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  // PROMPT #111 - code_path é OBRIGATÓRIO na criação (imutável depois)
  code_path: string;
  description?: string | null;
  git_repository_info?: Record<string, any> | null;

  // Stack configuration (PROMPT #46 - Phase 1)
  stack_backend?: string | null;
  stack_database?: string | null;
  stack_frontend?: string | null;
  stack_css?: string | null;

  // PROMPT #118 - Initial memory context from codebase scan
  // If provided, context interview skips Q2/Q3 (problem/vision)
  initial_memory_context?: string | null;
}

export interface ProjectUpdate {
  name?: string;
  description?: string | null;
  git_repository_info?: Record<string, any> | null;
  // PROMPT #111 - code_path NÃO está aqui porque é IMUTÁVEL após criação

  // Stack configuration (PROMPT #46 - Phase 1)
  stack_backend?: string | null;
  stack_database?: string | null;
  stack_frontend?: string | null;
  stack_css?: string | null;

  // PROMPT #241 - User-editable ignore paths
  ignore_paths?: string[] | null;

  // PROMPT #243 - Pinned fragments
  pinned_fragments?: string[] | null;
}

export interface ProjectWithRelations extends Project {
  interviews_count?: number;
  tasks_count?: number;
  prompts_count?: number;
}
