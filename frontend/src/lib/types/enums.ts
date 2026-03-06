/**
 * Enums - All enumeration types used across the ORBIT frontend
 */

export enum TaskStatus {
  BACKLOG = 'backlog',
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  REVIEW = 'review',
  DONE = 'done',
  BLOCKED = 'blocked', // PROMPT #95 - Pending modification approval
}

// JIRA Transformation - New Enums (PROMPT #62)
export enum ItemType {
  EPIC = 'epic',
  STORY = 'story',
  TASK = 'task',
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
  PATTERN_DISCOVERY = 'pattern_discovery',
  MEMORY = 'memory',  // PROMPT #118 - Codebase memory scan and business rules extraction
  QUEUE_ORCHESTRATION = 'queue_orchestration',  // PROMPT #215 - Prompt queue execution
  GENERAL = 'general',
}
