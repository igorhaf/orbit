from sqlalchemy import Column, Integer, String, Text, Boolean, ForeignKey, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
from uuid import uuid4
from app.database import Base
import enum


class IssueSeverity(str, enum.Enum):
    """Severidade do issue de consistência"""
    CRITICAL = "critical"  # Impede execução
    WARNING = "warning"    # Pode causar bugs
    INFO = "info"          # Sugestão


class IssueStatus(str, enum.Enum):
    """Status do issue de consistência"""
    DETECTED = "detected"
    AUTO_FIXED = "auto_fixed"
    MANUAL_FIX_NEEDED = "manual_fix_needed"
    IGNORED = "ignored"


class ConsistencyIssue(Base):
    """
    Issue de consistência detectado entre tasks

    Armazena problemas encontrados durante validação cruzada:
    - Class names inconsistentes
    - Method names diferentes
    - Field names em formatos diferentes
    - Imports faltando
    - Tipos incompatíveis
    """
    __tablename__ = "consistency_issues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    # Issue details
    severity = Column(String(20), nullable=False)  # IssueSeverity enum
    status = Column(String(30), default="detected")  # IssueStatus enum

    category = Column(String(100))  # "naming", "import", "type", etc
    message = Column(Text, nullable=False)  # Descrição do problema

    # Location
    task_ids = Column(JSON, default=list)  # Lista de task IDs envolvidos
    file_paths = Column(JSON, default=list)  # Arquivos afetados
    line_numbers = Column(JSON, default=list)  # Linhas específicas (se aplicável)

    # Fix
    auto_fixable = Column(Boolean, default=False)
    fix_applied = Column(Text)  # Descrição da correção aplicada
    fix_suggestion = Column(Text)  # Sugestão de como corrigir

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    fixed_at = Column(DateTime, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="consistency_issues")
