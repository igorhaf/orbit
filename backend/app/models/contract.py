"""
Contract Model - Stores prompt contracts in the database
PROMPT #257 - Contracts in Database + Visual Nodes in AI Flow

Replaces YAML-based contract storage with PostgreSQL persistence.
Each contract represents a prompt template, business rule, or configuration
that can be visualized as a node in the AI Flow diagram.
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, Boolean, DateTime, Integer, String, Text, JSON
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Contract(Base):
    """
    Contract model - Stores AI prompt contracts in the database.

    Replaces YAML files from backend/app/contracts/ with DB persistence.
    Each contract can be visualized as a node in the AI Flow diagram.
    """

    __tablename__ = "contracts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)
    name = Column(Text, unique=True, nullable=False, index=True)  # e.g., "generation/epic_from_interview"
    version = Column(Integer, default=1, nullable=False)
    domain = Column(String(50), nullable=False, default="generation", index=True)  # business, interview, generation, memory, component
    category = Column(Text, nullable=False, default="")  # subcategory folder
    usage_type = Column(String(50), nullable=False, default="general", index=True)  # maps to AI Flow chain
    description = Column(Text, default="")

    # Main content
    system_prompt = Column(Text, default="")
    user_prompt = Column(Text, default="")

    # Structured metadata (JSON)
    semantic_map = Column(JSON, default=dict)    # semantic identifiers N:, P:, E:, etc.
    variables = Column(JSON, default=dict)       # required/optional vars
    governance = Column(JSON, default=dict)      # status, owner, change_log
    rules = Column(JSON, default=dict)           # validations, constraints
    validators = Column(JSON, default=list)      # output validators
    execution = Column(JSON, default=dict)       # estimated_tokens, temperature, etc.
    data = Column(JSON, default=dict)            # data-only contracts (business rules, thresholds)
    components = Column(JSON, default=list)       # component references ["semantic_methodology"]
    tags = Column(JSON, default=list)

    # Control
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Contract(id={self.id}, name='{self.name}', domain='{self.domain}', usage_type='{self.usage_type}')>"
