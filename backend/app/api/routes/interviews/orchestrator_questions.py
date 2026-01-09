"""
Orchestrator Interview Questions - PROMPT #91 / PROMPT #94 / PROMPT #97
Sistema de entrevistas orquestrador (para Stories/Tasks individuais)

IMPORTANT (PROMPT #97 FIX):
- Orchestrator mode is for STORIES/TASKS, not project setup
- Meta_prompt mode is for EPICS/PROJECT (has Q3-Q8 stack questions)

Fase 1 - Perguntas Fixas (Q1-Q2 APENAS):
- Q1: Task Title (na verdade Story/Task title)
- Q2: Task Description (na verdade Story/Task description)

Fase 2 - Perguntas IA (Q3+):
- Contexto máximo (título + descrição + informações do Epic)
- Baseadas no epic + story/task atual
- Nunca repetir perguntas
- Sempre respostas fechadas (radio/checkbox)

NOTE: Stack questions (Backend, Database, Frontend, CSS, Mobile) are ONLY in meta_prompt mode!
Orchestrator assumes stack is already defined from the Epic/Project.
"""

from datetime import datetime
from sqlalchemy.orm import Session
from typing import Optional, Dict

from app.models.project import Project
from app.models.spec import Spec
from sqlalchemy import func


def get_specs_for_category(db: Session, category: str) -> list:
    """
    Get available frameworks from specs for a specific category.
    Returns list of choices formatted for interview options.

    Opções DINÂMICAS extraídas do banco de specs.
    """
    specs = db.query(
        Spec.name,
        func.count(Spec.id).label('count')
    ).filter(
        Spec.category == category,
        Spec.is_active == True
    ).group_by(Spec.name).all()

    # Label mappings
    labels = {
        # Backend
        'laravel': 'Laravel (PHP)',
        'django': 'Django (Python)',
        'fastapi': 'FastAPI (Python)',
        'express': 'Express.js (Node.js)',

        # Database
        'postgresql': 'PostgreSQL',
        'mysql': 'MySQL',
        'mongodb': 'MongoDB',
        'sqlite': 'SQLite',

        # Frontend
        'nextjs': 'Next.js (React)',
        'react': 'React',
        'vue': 'Vue.js',
        'angular': 'Angular',

        # CSS
        'tailwind': 'Tailwind CSS',
        'bootstrap': 'Bootstrap',
        'materialui': 'Material UI',
        'custom': 'CSS Customizado',

        # Mobile
        'react-native': 'React Native',
        'flutter': 'Flutter',
        'ios-swift': 'Native iOS (Swift)',
        'android-kotlin': 'Native Android (Kotlin)',
        'ionic': 'Ionic',
    }

    choices = []
    for name, count in specs:
        label = labels.get(name, name.title())
        choices.append({
            "id": name,
            "label": label,
            "value": name
        })

    return choices


def get_orchestrator_fixed_question(
    question_number: int,
    project: Project,
    db: Session,
    previous_answers: Dict = None
) -> Optional[dict]:
    """
    Returns fixed questions for ORCHESTRATOR interview mode (Stories/Tasks).

    PROMPT #91 / PROMPT #94 / PROMPT #97 FIX

    Orchestrator is for STORIES/TASKS, not project setup:
    Q1: Task Title (text)
    Q2: Task Description (text)
    Q3+: AI contextual questions (returns None to trigger AI phase)

    Stack questions (Q3-Q8) are ONLY in meta_prompt mode (Epic/Project setup).

    Args:
        question_number: Question number
        project: Project instance
        db: Database session
        previous_answers: Dict with previous answers (not used in orchestrator)

    Returns:
        Message dict with question, or None if beyond Q2 (triggers AI contextual)
    """
    previous_answers = previous_answers or {}

    # Q1: Título
    if question_number == 1:
        return {
            "role": "assistant",
            "content": "🎯 Pergunta 1: Qual é o título do projeto?\n\nDigite o nome do seu projeto.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-orchestrator",
            "question_type": "text",
            "question_number": 1,
            "prefilled_value": project.name or ""
        }

    # Q2: Descrição
    elif question_number == 2:
        return {
            "role": "assistant",
            "content": "📝 Pergunta 2: Descreva brevemente o objetivo do projeto.\n\nForneça uma breve descrição do que o projeto faz e qual problema resolve.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-orchestrator",
            "question_type": "text",
            "question_number": 2,
            "prefilled_value": project.description or ""
        }

    # Q3+: No more fixed questions - move to AI contextual questions
    # PROMPT #97 FIX: Orchestrator mode is for Stories/Tasks, not project setup
    # Stack questions (Q3-Q8) are ONLY in meta_prompt mode (Epic/Project setup)
    # Orchestrator only asks Q1 (Title) and Q2 (Description), then AI contextual
    else:
        # Q3+ should go to AI contextual questions
        return None

    # Se chegou aqui, não tem mais perguntas fixas
    return None


def count_fixed_questions_orchestrator(system_type: str) -> int:
    """
    Retorna o número total de perguntas fixas para orchestrator mode.

    PROMPT #97 FIX: Orchestrator is for Stories/Tasks, not project setup.
    Only asks Q1 (Title) and Q2 (Description), then moves to AI contextual.

    Args:
        system_type: Tipo do sistema (não usado - mantido por compatibilidade)

    Returns:
        Always 2 (Q1: Title, Q2: Description)
    """
    # Orchestrator mode only has 2 fixed questions
    # Stack questions (Q3-Q8) are ONLY in meta_prompt mode
    return 2


def is_fixed_question_complete_orchestrator(conversation_data: list, system_type: str) -> bool:
    """
    Verifica se todas as perguntas fixas foram respondidas.

    Args:
        conversation_data: Lista de mensagens da conversa
        system_type: Tipo do sistema escolhido

    Returns:
        True se todas as perguntas fixas foram respondidas
    """
    total_fixed = count_fixed_questions_orchestrator(system_type)

    # Conta quantas perguntas fixas foram feitas
    fixed_count = sum(
        1 for msg in conversation_data
        if msg.get('model') == 'system/fixed-question-orchestrator' and msg.get('role') == 'assistant'
    )

    return fixed_count >= total_fixed
