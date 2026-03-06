/**
 * Task, relationship, comment, transition, and backlog types
 */

import {
  TaskStatus,
  ItemType,
  PriorityLevel,
  SeverityLevel,
  ResolutionType,
  RelationshipType,
  CommentType,
} from './enums';

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

  // Meta Prompt Feature - Generated atomic prompt for task execution
  generated_prompt?: string | null;

  // PROMPT #127 - Track which AI model generated the content
  created_by_ai_model?: string | null;

  // REGRA #0 - Track if description/prompt were edited by human
  description_edited_by?: string | null;
  prompt_edited_by?: string | null;

  // PROMPT #95 - Blocking System for Modification Detection
  blocked_reason?: string | null;
  pending_modification?: {
    title: string;
    description: string;
    similarity_score: number;
    suggested_at: string;
    interview_id?: string;
    original_title?: string;
    original_description?: string;
    story_points?: number;
    priority?: string;
    acceptance_criteria?: string[];
    interview_insights?: Record<string, any>;
  } | null;

  // Complexity level (determines which Claude model runs the task)
  complexity: 'low' | 'medium' | 'high';

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
  generated_prompt?: string | null;

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
  generated_prompt?: string | null;

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

// JIRA TRANSFORMATION - NEW MODELS (PROMPT #62)

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
  comment_metadata?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface TaskCommentCreate {
  task_id: string;
  author: string;
  content: string;
  comment_type?: CommentType;
  comment_metadata?: Record<string, any> | null;
}

export interface TaskCommentUpdate {
  content?: string;
  comment_metadata?: Record<string, any> | null;
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

// BACKLOG VIEWS (PROMPT #62)

export interface BacklogItem extends TaskWithRelations {
  // Helper properties for UI
  depth?: number;  // Hierarchy depth (0 = root, 1 = child, etc.)
  isExpanded?: boolean;  // For tree view expand/collapse
  isSelected?: boolean;  // For bulk selection
}

export interface BacklogFilters {
  item_type?: ItemType[];
  priority?: PriorityLevel[];
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
