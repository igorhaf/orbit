# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 815 in / 905 out | Cost: $0.0053

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/models/task_relationship.py (python):
"""
TaskRelationship Model
Represents relationships between tasks (blocks, depends_on, relates_to, duplicates)
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum as SQLEnum, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class RelationshipType(str, enum.Enum):
    """Relationship types between tasks"""
    BLOCKS = "blocks"              # Source blocks Target
    BLOCKED_BY = "blocked_by"      # Source blocked by Target (inverse of blocks)
    DEPENDS_ON = "depends_on"      # Source depends on Target
    RELATES_TO = "relates_to"      # General relationship
    DUPLICATES = "duplicates"      # Source duplicates Target
    CLONES = "clones"              # Source is clone of Target


class TaskRelationship(Base):
    """
    TaskRelationship model - Represents directed relationships between tasks

    Attributes:
        id: Unique identifier
        source_task_id: Task initiating the relationship
        target_task_id: Task being related to
        relationship_type: Type of relationship
        created_at: When relationship was created
    """

    __tablename__ = "task_relationships"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    source_task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    target_task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Relationship metadata
    relationship_type = Column(
        SQLEnum(RelationshipType, name="relationship_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True
    )

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    source_task = relationship(
        "Task",
        foreign_keys=[source_task_id],
        back_populates="relationships_as_source"
    )
    target_task = relationship(
        "Task",
        foreign_keys=[target_task_id],
        back_populates="relationships_as_target"
    )

    # Composite indexes for performance
    # PROMPT #233 - DB-4 fix: prevent duplicate relationships
    __table_args__ = (
        Index('ix_task_rel_source_target', 'source_task_id', 'target_task_id'),
        Index('ix_task_rel_type_source', 'relationship_type', 'source_task_id'),
        UniqueConstraint('source_task_id', 'target_task_id', 'relationship_type',
                         name='uq_task_relationship_tuple'),
    )

    def __repr__(self) -> str:
        return f"<TaskRelationship({self.source_task_id} {self.relationship_type.value} {self.target_task_id})>"


## Response

{
  "business_rules": [
    {
      "rule_text": "O usuário pode criar relações entre tarefas com os tipos pré-definidos: bloqueia, é bloqueado, depende, relaciona, duplica e clona.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "Relações entre tarefas devem ser únicas para o mesmo tipo e pares de tarefas (não é permitido criar duas relações idênticas entre as mesmas tarefas com o mesmo tipo).",
      "rule_type": "constraint",
      "confidence": "high"
    },
    {
      "rule_text": "Cada relação deve ter um tipo específico que define a natureza da conexão entre as tarefas (ex: 'bloqueia' indica que uma tarefa impede a outra).",
      "rule_type": "domain",
      "confidence": "high"
    }
  ]
}
