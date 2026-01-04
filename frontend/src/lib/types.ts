/**
 * TypeScript Types for AI Orchestrator Frontend
 * These types mirror the backend Pydantic schemas
 */

// ============================================================================
// ENUMS
// ============================================================================

export enum TaskStatus {
  BACKLOG = 'backlog',
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  REVIEW = 'review',
  DONE = 'done',
}

// JIRA Transformation - New Enums (PROMPT #62)
export enum ItemType {
  EPIC = 'epic',
  STORY = 'story',
  TASK = 'task',
  SUBTASK = 'subtask',
  BUG = 'bug',
}

export enum PriorityLevel {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  TRIVIAL = 'trivial',
}

export enum SeverityLevel {
  BLOCKER = 'blocker',
  CRITICAL = 'critical',
  MAJOR = 'major',
  MINOR = 'minor',
  TRIVIAL = 'trivial',
}

export enum ResolutionType {
  FIXED = 'fixed',
  WONT_FIX = 'wont_fix',
  DUPLICATE = 'duplicate',
  CANNOT_REPRODUCE = 'cannot_reproduce',
  WORKS_AS_DESIGNED = 'works_as_designed',
}

export enum RelationshipType {
  BLOCKS = 'blocks',
  BLOCKED_BY = 'blocked_by',
  DEPENDS_ON = 'depends_on',
  RELATES_TO = 'relates_to',
  DUPLICATES = 'duplicates',
}

export enum CommentType {
  COMMENT = 'comment',
  SYSTEM = 'system',
  AI_INSIGHT = 'ai_insight',
  VALIDATION = 'validation',
}

export enum InterviewStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum ChatSessionStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum CommitType {
  FEAT = 'feat',
  FIX = 'fix',
  DOCS = 'docs',
  STYLE = 'style',
  REFACTOR = 'refactor',
  TEST = 'test',
  CHORE = 'chore',
  PERF = 'perf',
}

export enum AIModelUsageType {
  INTERVIEW = 'interview',
  PROMPT_GENERATION = 'prompt_generation',
  COMMIT_GENERATION = 'commit_generation',
  TASK_EXECUTION = 'task_execution',
  GENERAL = 'general',
}

// ============================================================================
// PROJECT
// ============================================================================

export interface Project {
  id: string;
  name: string;
  description: string | null;
  git_repository_info: Record<string, any> | null;

  // Stack configuration (PROMPT #46 - Phase 1)
  stack_backend?: string | null;
  stack_database?: string | null;
  stack_frontend?: string | null;
  stack_css?: string | null;

  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string | null;
  git_repository_info?: Record<string, any> | null;

  // Stack configuration (PROMPT #46 - Phase 1)
  stack_backend?: string | null;
  stack_database?: string | null;
  stack_frontend?: string | null;
  stack_css?: string | null;
}

export interface ProjectUpdate {
  name?: string;
  description?: string | null;
  git_repository_info?: Record<string, any> | null;

  // Stack configuration (PROMPT #46 - Phase 1)
  stack_backend?: string | null;
  stack_database?: string | null;
  stack_frontend?: string | null;
  stack_css?: string | null;
}

export interface ProjectWithRelations extends Project {
  interviews_count?: number;
  tasks_count?: number;
  prompts_count?: number;
}

// ============================================================================
// TASK (JIRA Transformation - Extended)
// ============================================================================

export interface Task {
  id: string;
  project_id: string;
  prompt_id: string | null;
  title: string;
  description: string | null;

  // JIRA Transformation - Classification & Hierarchy (PROMPT #62)
  item_type: ItemType;
  parent_id: string | null;

  // JIRA Transformation - Planning
  priority: PriorityLevel;
  severity?: SeverityLevel | null;
  story_points?: number | null;
  sprint_id?: string | null;

  // JIRA Transformation - Ownership
  reporter?: string | null;
  assignee?: string | null;

  // JIRA Transformation - Categorization
  labels: string[];
  components: string[];

  // JIRA Transformation - Workflow
  workflow_state: string;
  resolution?: ResolutionType | null;
  resolution_comment?: string | null;

  // JIRA Transformation - AI Orchestration
  prompt_template_id?: string | null;
  target_ai_model_id?: string | null;
  token_budget?: number | null;
  actual_tokens_used?: number | null;
  acceptance_criteria: string[];
  generation_context: Record<string, any>;

  // JIRA Transformation - Interview Traceability
  interview_question_ids: number[];
  interview_insights: Record<string, any>;

  // Legacy Kanban fields (for backward compatibility)
  status: TaskStatus;
  column: string;
  order: number;

  created_at: string;
  updated_at: string;
}

export interface TaskCreate {
  project_id: string;
  title: string;
  description?: string | null;

  // JIRA Transformation fields
  item_type?: ItemType;
  parent_id?: string | null;
  priority?: PriorityLevel;
  severity?: SeverityLevel | null;
  story_points?: number | null;
  sprint_id?: string | null;
  reporter?: string | null;
  assignee?: string | null;
  labels?: string[];
  components?: string[];
  workflow_state?: string;
  resolution?: ResolutionType | null;
  resolution_comment?: string | null;
  prompt_template_id?: string | null;
  target_ai_model_id?: string | null;
  token_budget?: number | null;
  acceptance_criteria?: string[];
  generation_context?: Record<string, any>;
  interview_question_ids?: number[];
  interview_insights?: Record<string, any>;

  // Legacy Kanban
  status?: TaskStatus;
  column?: string;
  order?: number;
  prompt_id?: string | null;
}

export interface TaskUpdate {
  title?: string;
  description?: string | null;

  // JIRA Transformation fields
  item_type?: ItemType;
  parent_id?: string | null;
  priority?: PriorityLevel;
  severity?: SeverityLevel | null;
  story_points?: number | null;
  sprint_id?: string | null;
  reporter?: string | null;
  assignee?: string | null;
  labels?: string[];
  components?: string[];
  workflow_state?: string;
  resolution?: ResolutionType | null;
  resolution_comment?: string | null;
  prompt_template_id?: string | null;
  target_ai_model_id?: string | null;
  token_budget?: number | null;
  acceptance_criteria?: string[];
  generation_context?: Record<string, any>;
  interview_question_ids?: number[];
  interview_insights?: Record<string, any>;

  // Legacy Kanban
  status?: TaskStatus;
  column?: string;
  order?: number;
  prompt_id?: string | null;
}

export interface TaskMove {
  // For hierarchy moves
  new_parent_id?: string | null;

  // For Kanban moves (backward compatibility)
  new_status?: TaskStatus;
  new_column?: string;
  new_order?: number;
}

export interface TaskWithRelations extends Task {
  // Hierarchy
  children?: Task[];

  // Relationships
  relationships_as_source?: TaskRelationship[];
  relationships_as_target?: TaskRelationship[];

  // Comments
  comments?: TaskComment[];

  // Status Transitions
  transitions?: StatusTransition[];

  // Legacy counts (backward compatibility)
  chat_sessions_count?: number;
  commits_count?: number;
}

// ============================================================================
// JIRA TRANSFORMATION - NEW MODELS (PROMPT #62)
// ============================================================================

export interface TaskRelationship {
  id: string;
  source_task_id: string;
  target_task_id: string;
  relationship_type: RelationshipType;
  created_at: string;
}

export interface TaskRelationshipCreate {
  source_task_id: string;
  target_task_id: string;
  relationship_type: RelationshipType;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author: string;
  content: string;
  comment_type: CommentType;
  metadata?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface TaskCommentCreate {
  task_id: string;
  author: string;
  content: string;
  comment_type?: CommentType;
  metadata?: Record<string, any> | null;
}

export interface TaskCommentUpdate {
  content?: string;
  metadata?: Record<string, any> | null;
}

export interface StatusTransition {
  id: string;
  task_id: string;
  from_status: string;
  to_status: string;
  transitioned_by?: string | null;
  transition_reason?: string | null;
  created_at: string;
}

export interface StatusTransitionCreate {
  to_status: string;
  transitioned_by?: string | null;
  transition_reason?: string | null;
}

// ============================================================================
// BACKLOG VIEWS (PROMPT #62)
// ============================================================================

export interface BacklogItem extends TaskWithRelations {
  // Helper properties for UI
  depth?: number;  // Hierarchy depth (0 = root, 1 = child, etc.)
  isExpanded?: boolean;  // For tree view expand/collapse
  isSelected?: boolean;  // For bulk selection
}

export interface BacklogFilters {
  item_type?: ItemType[];
  priority?: PriorityLevel[];
  assignee?: string;
  labels?: string[];
  status?: TaskStatus[];
  search?: string;
}

export interface BacklogGenerationSuggestion {
  title: string;
  description: string;
  story_points: number;
  priority: string;
  acceptance_criteria: string[];
  interview_insights?: Record<string, any>;
  interview_question_ids?: number[];
  parent_id?: string;
  _metadata?: Record<string, any>;
}

export interface BacklogGenerationResponse {
  suggestions: BacklogGenerationSuggestion[];
  metadata: Record<string, any>;
}

// ============================================================================
// INTERVIEW
// ============================================================================

export interface MessageOption {
  id: string;
  label: string;
  value: string;
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
}

export interface InterviewCreate {
  project_id: string;
  ai_model_used: string;
  conversation_data?: ConversationMessage[];
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

// ============================================================================
// PROMPT
// ============================================================================

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

// ============================================================================
// AI MODEL
// ============================================================================

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  usage_type: AIModelUsageType;
  is_active: boolean;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AIModelCreate {
  name: string;
  provider: string;
  api_key: string;
  usage_type?: AIModelUsageType;
  is_active?: boolean;
  config?: Record<string, any>;
}

export interface AIModelUpdate {
  name?: string;
  provider?: string;
  api_key?: string;
  usage_type?: AIModelUsageType;
  is_active?: boolean;
  config?: Record<string, any>;
}

export interface AIModelDetail extends AIModel {
  api_key_preview?: string;
}

// ============================================================================
// CHAT SESSION
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  provider?: string;  // AI provider used (anthropic, openai, google)
  model?: string;     // Specific model used (claude-sonnet-4, gpt-4-turbo, etc)
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

// ============================================================================
// COMMIT
// ============================================================================

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

// ============================================================================
// SYSTEM SETTINGS
// ============================================================================

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

// ============================================================================
// KANBAN BOARD
// ============================================================================

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

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

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

// ============================================================================
// FORM STATE TYPES
// ============================================================================

export interface FormState<T> {
  data: T;
  errors: Partial<Record<keyof T, string>>;
  isSubmitting: boolean;
  isValid: boolean;
}

// ============================================================================
// UI STATE TYPES
// ============================================================================

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
