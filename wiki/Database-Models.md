# Database Models

PostgreSQL with pgvector extension. All models use UUID primary keys.

## Core Models

| Model | Table | Description |
|-------|-------|-------------|
| `Project` | `projects` | Main project entity with code_path, stack, description |
| `Task` | `tasks` | Cards (Epic/Story/Task/Bug) with hierarchy |
| `TaskComment` | `task_comments` | Comments on cards |
| `TaskResult` | `task_results` | Task execution results |
| `TaskRelationship` | `task_relationships` | Relationships between cards |
| `StatusTransition` | `status_transitions` | Status change audit log |

## Interview Models

| Model | Table | Description |
|-------|-------|-------------|
| `Interview` | `interviews` | Interview sessions |
| `ChatSession` | `chat_sessions` | Chat sessions for task execution |
| `ProjectChat` | `project_chats` | RAG-powered project Q&A |

## AI Models

| Model | Table | Description |
|-------|-------|-------------|
| `AIModel` | `ai_models` | Configured AI providers with API keys |
| `AIExecution` | `ai_executions` | Log of every AI API call |
| `AIFlowChain` | `ai_flow_chains` | Fallback chain configurations |
| `AIFlowProfile` | `ai_flow_profiles` | Versioned flow profiles |

## Pipeline Models

| Model | Table | Description |
|-------|-------|-------------|
| `PipelineRun` | `pipeline_runs` | Pipeline execution history with scores |
| `PipelineArtifact` | `pipeline_artifacts` | Per-phase intermediate outputs |
| `PipelineProfile` | `pipeline_profiles` | Configurable pipeline settings |

## Knowledge Models

| Model | Table | Description |
|-------|-------|-------------|
| `Spec` | `specs` | Framework/project specifications |
| `SpecHistory` | `spec_history` | Spec version history |
| `DiscoveryQueue` | `discovery_queue` | Pending spec discoveries |
| `RAGFileState` | `rag_file_state` | File indexing state tracking |
| `WikiPage` | `wiki_pages` | Wiki documentation pages |

## System Models

| Model | Table | Description |
|-------|-------|-------------|
| `AsyncJob` | `async_jobs` | Background job tracking |
| `JobLogEntry` | `job_log_entries` | Job execution logs |
| `Prompt` | `prompts` | Generated prompts |
| `PromptTemplate` | `prompt_templates` | Reusable prompt templates |
| `PromptQueue` | `prompt_queue` | Priority prompt queue |
| `Contract` | `contracts` | Contract definitions |
| `Commit` | `commits` | Git commit records |
| `ProjectAnalysis` | `project_analyses` | Codebase analysis results |
| `SystemSettings` | `system_settings` | Key-value system config |

## Key Enums

| Enum | Values |
|------|--------|
| `TaskStatus` | backlog, todo, in_progress, review, done, blocked |
| `ItemType` | epic, story, task, bug |
| `PriorityLevel` | critical, high, medium, low, trivial |
| `JobStatus` | pending, running, completed, failed, cancelled |
| `InterviewStatus` | pending, in_progress, completed, archived |

## Column Types

All text fields that may contain AI-generated content use `TEXT` (no VARCHAR limits) to prevent truncation errors.
