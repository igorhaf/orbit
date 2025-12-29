# Models and Schemas Documentation

## 📋 Overview

This document describes all SQLAlchemy models and Pydantic schemas created for the AI Orchestrator system.

## 🗄️ Database Models (SQLAlchemy)

### 1. Project
**Table**: `projects`

The main entity representing an AI orchestration project.

**Fields**:
- `id`: UUID (primary key)
- `name`: String(255), indexed
- `description`: Text
- `git_repository_info`: JSON
- `created_at`: DateTime
- `updated_at`: DateTime

**Relationships**:
- `interviews`: One-to-many with Interview
- `prompts`: One-to-many with Prompt
- `tasks`: One-to-many with Task
- `commits`: One-to-many with Commit

---

### 2. Interview
**Table**: `interviews`

Represents a conversational interview session with AI to gather requirements.

**Fields**:
- `id`: UUID (primary key)
- `project_id`: UUID (foreign key)
- `conversation_data`: JSON (array of messages)
- `ai_model_used`: String(100)
- `status`: Enum (active, completed, cancelled)
- `created_at`: DateTime

**Relationships**:
- `project`: Many-to-one with Project
- `prompts`: One-to-many with Prompt

**Indexes**: id, project_id, status

---

### 3. Prompt
**Table**: `prompts`

Represents a composable prompt following the Prompter architecture.

**Fields**:
- `id`: UUID (primary key)
- `project_id`: UUID (foreign key)
- `created_from_interview_id`: UUID (foreign key, nullable)
- `parent_id`: UUID (self-reference, nullable)
- `content`: Text
- `type`: String(50)
- `is_reusable`: Boolean
- `components`: JSON (list)
- `version`: Integer
- `created_at`: DateTime
- `updated_at`: DateTime

**Relationships**:
- `project`: Many-to-one with Project
- `interview`: Many-to-one with Interview
- `parent`: Self-referential for versioning
- `children`: Self-referential for derived versions
- `tasks`: One-to-many with Task

**Indexes**: id, project_id, created_from_interview_id, parent_id, type

---

### 4. Task
**Table**: `tasks`

Represents a task in the Kanban board.

**Fields**:
- `id`: UUID (primary key)
- `prompt_id`: UUID (foreign key, nullable)
- `project_id`: UUID (foreign key)
- `title`: String(255)
- `description`: Text
- `status`: Enum (backlog, todo, in_progress, review, done)
- `column`: String(50)
- `order`: Integer
- `created_at`: DateTime
- `updated_at`: DateTime

**Relationships**:
- `prompt`: Many-to-one with Prompt
- `project`: Many-to-one with Project
- `chat_sessions`: One-to-many with ChatSession
- `commits`: One-to-many with Commit

**Indexes**: id, prompt_id, project_id, status

---

### 5. ChatSession
**Table**: `chat_sessions`

Represents a chat session with AI for executing a task.

**Fields**:
- `id`: UUID (primary key)
- `task_id`: UUID (foreign key)
- `messages`: JSON (array)
- `ai_model_used`: String(100)
- `status`: Enum (active, completed, failed)
- `created_at`: DateTime
- `updated_at`: DateTime

**Relationships**:
- `task`: Many-to-one with Task

**Indexes**: id, task_id, status

---

### 6. Commit
**Table**: `commits`

Represents an AI-generated commit following Conventional Commits.

**Fields**:
- `id`: UUID (primary key)
- `task_id`: UUID (foreign key)
- `project_id`: UUID (foreign key)
- `type`: Enum (feat, fix, docs, style, refactor, test, chore, perf)
- `message`: Text
- `changes`: JSON
- `created_by_ai_model`: String(100)
- `author`: String(100), default "AI System"
- `timestamp`: DateTime

**Relationships**:
- `task`: Many-to-one with Task
- `project`: Many-to-one with Project

**Indexes**: id, task_id, project_id, type, timestamp

---

### 7. AIModel
**Table**: `ai_models`

Represents an AI model configuration.

**Fields**:
- `id`: UUID (primary key)
- `name`: String(100), unique
- `provider`: String(50)
- `api_key`: String(255) (should be encrypted)
- `usage_type`: Enum (interview, prompt_generation, commit_generation, task_execution, general)
- `is_active`: Boolean
- `config`: JSON
- `created_at`: DateTime
- `updated_at`: DateTime

**Indexes**: id, name (unique), provider, usage_type, is_active

---

### 8. SystemSettings
**Table**: `system_settings`

Represents system-wide configuration settings.

**Fields**:
- `id`: UUID (primary key)
- `key`: String(100), unique
- `value`: JSON
- `description`: Text
- `updated_at`: DateTime

**Indexes**: id, key (unique)

---

## 📝 Pydantic Schemas

For each model, the following schemas are created:

### Pattern:
1. **{Model}Base**: Base fields for the model
2. **{Model}Create**: Fields required for creation
3. **{Model}Update**: Fields that can be updated (all optional)
4. **{Model}Response**: Response schema with all fields including ID and timestamps

### Special Schemas:

#### Project
- `ProjectWithRelations`: Includes counts of related entities

#### Interview
- `ConversationMessage`: Schema for individual messages
- `InterviewAddMessage`: Schema for adding a message

#### Prompt
- `PromptGenerateRequest`: Request to generate prompts from interview

#### Task
- `TaskMove`: Schema for moving tasks in Kanban
- `TaskWithRelations`: Includes counts of related entities

#### ChatSession
- `ChatMessage`: Schema for individual chat messages
- `ChatSessionAddMessage`: Schema for adding a message

#### Commit
- `CommitGenerateRequest`: Request for AI to generate a commit

#### AIModel
- `AIModelDetailResponse`: Response with masked API key

#### SystemSettings
- `SystemSettingsBulkUpdate`: Bulk update multiple settings

---

## 🔗 Relationship Summary

```
Project
  ├── interviews (1:N)
  │     └── prompts (1:N)
  ├── prompts (1:N)
  │     ├── parent (self-ref)
  │     └── tasks (1:N)
  ├── tasks (1:N)
  │     ├── chat_sessions (1:N)
  │     └── commits (1:N)
  └── commits (1:N)

AIModel (standalone)
SystemSettings (standalone)
```

---

## 🎯 Usage Examples

### Creating a Project
```python
from app.schemas import ProjectCreate
from app.models import Project

project_data = ProjectCreate(
    name="My AI Project",
    description="An amazing AI orchestration project"
)
```

### Creating a Task
```python
from app.schemas import TaskCreate
from app.models.task import TaskStatus

task_data = TaskCreate(
    title="Implement authentication",
    description="Add user authentication system",
    project_id=project_id,
    status=TaskStatus.TODO
)
```

### Moving a Task in Kanban
```python
from app.schemas import TaskMove
from app.models.task import TaskStatus

move_data = TaskMove(
    new_status=TaskStatus.IN_PROGRESS,
    new_column="in_progress",
    new_order=1
)
```

---

## 🔐 Security Considerations

1. **AIModel.api_key**: Should be encrypted before storage
2. **Validation**: All schemas include proper validation
3. **Cascading Deletes**: Configured on foreign keys where appropriate
4. **Indexes**: Added on frequently queried fields

---

## 📊 Database Migrations

Migrations are managed by Alembic:

- Initial migration: `001_create_initial_tables.py`
- Location: `backend/alembic/versions/`

To apply migrations:
```bash
# Using Docker
./scripts/apply_migrations.sh

# Or manually
docker-compose exec backend poetry run alembic upgrade head
```

---

## ✅ Validation

All Pydantic schemas include:
- Type validation
- String length constraints
- Required vs optional fields
- Default values
- Custom validators where needed

---

## 🚀 Next Steps

1. Create CRUD operations in `app/api/routes/`
2. Implement service layer for business logic
3. Add unit tests for models and schemas
4. Implement API endpoints
5. Add authentication and authorization
