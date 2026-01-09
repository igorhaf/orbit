"""
Subtask-Orchestrated Interview Questions - PROMPT #97
Sistema de entrevistas orquestrador para Subtasks individuais

Mesmo layout do orchestrator mode:
- Q1: Subtask Title
- Q2: Subtask Description
- Q3+: AI contextual questions (baseadas no Epic + Story + Task + Subtask context)

IMPORTANT:
- Subtask mode is for individual SUBTASKS within a Task
- NO stack questions (stack already defined in Epic via meta_prompt)
- Assumes Task, Story, and Epic context are available
"""

from datetime import datetime
from sqlalchemy.orm import Session
from typing import Optional, Dict

from app.models.project import Project


def get_subtask_orchestrated_fixed_question(
    question_number: int,
    project: Project,
    db: Session,
    previous_answers: Dict = None
) -> Optional[dict]:
    """
    Returns fixed questions for SUBTASK_ORCHESTRATED interview mode.

    PROMPT #97 - Subtask-Orchestrated Mode

    Q1: Subtask Title (text)
    Q2: Subtask Description (text)
    Q3+: AI contextual questions (returns None to trigger AI phase)

    Args:
        question_number: Question number
        project: Project instance
        db: Database session
        previous_answers: Dict with previous answers (not used)

    Returns:
        Message dict with question, or None if beyond Q2 (triggers AI contextual)
    """
    previous_answers = previous_answers or {}

    # Q1: Subtask Title
    if question_number == 1:
        return {
            "role": "assistant",
            "content": "🎯 Pergunta 1: Qual é o título da subtask?\n\nDigite o nome da sua subtask.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-subtask-orchestrated",
            "question_type": "text",
            "question_number": 1,
            "prefilled_value": project.name or ""
        }

    # Q2: Subtask Description
    elif question_number == 2:
        return {
            "role": "assistant",
            "content": "📝 Pergunta 2: Descreva brevemente o objetivo da subtask.\n\nForneça uma breve descrição do que a subtask deve fazer (deve ser uma ação atômica).",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-subtask-orchestrated",
            "question_type": "text",
            "question_number": 2,
            "prefilled_value": project.description or ""
        }

    # Q3+: No more fixed questions - move to AI contextual questions
    else:
        # Q3+ should go to AI contextual questions
        return None

    # Se chegou aqui, não tem mais perguntas fixas
    return None


def count_fixed_questions_subtask_orchestrated(system_type: str = None) -> int:
    """
    Retorna o número total de perguntas fixas para subtask_orchestrated mode.

    PROMPT #97 - Subtask-Orchestrated Mode
    Only asks Q1 (Title) and Q2 (Description), then moves to AI contextual.

    Args:
        system_type: Não usado - mantido por compatibilidade

    Returns:
        Always 2 (Q1: Title, Q2: Description)
    """
    return 2


def is_fixed_question_complete_subtask_orchestrated(conversation_data: list, system_type: str = None) -> bool:
    """
    Verifica se todas as perguntas fixas foram respondidas.

    Args:
        conversation_data: Lista de mensagens da conversa
        system_type: Não usado - mantido por compatibilidade

    Returns:
        True se todas as perguntas fixas foram respondidas
    """
    total_fixed = count_fixed_questions_subtask_orchestrated()

    # Conta quantas perguntas fixas foram feitas
    fixed_count = sum(
        1 for msg in conversation_data
        if msg.get('model') == 'system/fixed-question-subtask-orchestrated' and msg.get('role') == 'assistant'
    )

    return fixed_count >= total_fixed
