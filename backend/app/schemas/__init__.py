"""
Pydantic Schemas
Request/Response models for API validation

Import all schemas here for easy access
"""

from app.schemas.project import (
    ProjectBase,
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectWithRelations,
)

from app.schemas.interview import (
    ConversationMessage,
    InterviewBase,
    InterviewCreate,
    InterviewUpdate,
    InterviewAddMessage,
    InterviewResponse,
)

from app.schemas.prompt import (
    PromptBase,
    PromptCreate,
    PromptUpdate,
    PromptResponse,
    PromptGenerateRequest,
)

from app.schemas.task import (
    TaskBase,
    TaskCreate,
    TaskUpdate,
    TaskMove,
    TaskResponse,
    TaskWithRelations,
)

from app.schemas.chat_session import (
    ChatMessage,
    ChatSessionBase,
    ChatSessionCreate,
    ChatSessionUpdate,
    ChatSessionAddMessage,
    ChatSessionResponse,
)

from app.schemas.commit import (
    CommitBase,
    CommitCreate,
    CommitUpdate,
    CommitResponse,
    CommitGenerateRequest,
)

from app.schemas.ai_model import (
    AIModelBase,
    AIModelCreate,
    AIModelUpdate,
    AIModelResponse,
    AIModelDetailResponse,
)

from app.schemas.system_settings import (
    SystemSettingsBase,
    SystemSettingsCreate,
    SystemSettingsUpdate,
    SystemSettingsResponse,
    SystemSettingsBulkUpdate,
)

__all__ = [
    # Project schemas
    "ProjectBase",
    "ProjectCreate",
    "ProjectUpdate",
    "ProjectResponse",
    "ProjectWithRelations",
    # Interview schemas
    "ConversationMessage",
    "InterviewBase",
    "InterviewCreate",
    "InterviewUpdate",
    "InterviewAddMessage",
    "InterviewResponse",
    # Prompt schemas
    "PromptBase",
    "PromptCreate",
    "PromptUpdate",
    "PromptResponse",
    "PromptGenerateRequest",
    # Task schemas
    "TaskBase",
    "TaskCreate",
    "TaskUpdate",
    "TaskMove",
    "TaskResponse",
    "TaskWithRelations",
    # ChatSession schemas
    "ChatMessage",
    "ChatSessionBase",
    "ChatSessionCreate",
    "ChatSessionUpdate",
    "ChatSessionAddMessage",
    "ChatSessionResponse",
    # Commit schemas
    "CommitBase",
    "CommitCreate",
    "CommitUpdate",
    "CommitResponse",
    "CommitGenerateRequest",
    # AIModel schemas
    "AIModelBase",
    "AIModelCreate",
    "AIModelUpdate",
    "AIModelResponse",
    "AIModelDetailResponse",
    # SystemSettings schemas
    "SystemSettingsBase",
    "SystemSettingsCreate",
    "SystemSettingsUpdate",
    "SystemSettingsResponse",
    "SystemSettingsBulkUpdate",
]
