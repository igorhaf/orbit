from sqlalchemy import Column, Integer, String, Text, Boolean, Float, ForeignKey, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
from uuid import uuid4
from app.database import Base


class TaskResult(Base):
    """
    Resultado da execução de uma task

    Armazena:
    - Código gerado
    - Métricas de execução (tokens, custo, tempo)
    - Validação (passou/falhou, issues)
    - Tentativas necessárias
    """
    __tablename__ = "task_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)
    task_id = Column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Output
    output_code = Column(Text, nullable=False)  # Código gerado
    file_path = Column(String(500))  # Onde salvar o arquivo

    # Execution metadata
    model_used = Column(String(100))  # "claude-3-haiku-20240307" ou "claude-sonnet-4-20250514"
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    cost = Column(Float, default=0.0)  # Custo real da execução
    execution_time = Column(Float, default=0.0)  # Segundos

    # Validation
    validation_passed = Column(Boolean, default=False)
    validation_issues = Column(JSON, default=list)  # Lista de problemas encontrados
    attempts = Column(Integer, default=1)  # Quantas tentativas foram necessárias

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    task = relationship("Task", back_populates="result")
