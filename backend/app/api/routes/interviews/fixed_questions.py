"""
Fixed Interview Questions
PROMPT #69 - Refactor interviews.py

Functions for generating fixed questions (Q1-Q7 for requirements mode, Q1 for task-focused mode).
Questions have dynamic options pulled from specs database.
"""

from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.project import Project
from app.models.spec import Spec


def get_specs_for_category(db: Session, category: str) -> list:
    """
    Get available frameworks from specs for a specific category.
    Returns list of choices formatted for interview options.

    DYNAMIC SYSTEM: Options come from specs table, not hardcoded.
    """
    # Query distinct frameworks for this category
    specs = db.query(
        Spec.name,
        func.count(Spec.id).label('count')
    ).filter(
        Spec.category == category,
        Spec.is_active == True
    ).group_by(Spec.name).all()

    # Label mappings (same as in specs.py for consistency)
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
    }

    # Format choices
    choices = []
    for name, count in specs:
        label = labels.get(name, name.title())
        choices.append({
            "id": name,
            "label": label,
            "value": name
        })

    return choices


def get_fixed_question(question_number: int, project: Project, db: Session) -> dict:
    """
    Returns fixed questions with DYNAMIC options from specs.
    Questions 1-2: Title and Description (text input, prefilled)
    Questions 3-7: Stack questions (single choice, OPTIONS FROM SPECS)

    PROMPT #57 - Fixed Questions Without AI
    PROMPT #67 - Mobile Support (Q7 added)
    DYNAMIC SYSTEM: Questions 3-7 pull options from specs table
    """

    # Questions 1-2: Static (Title and Description)
    if question_number == 1:
        return {
            "role": "assistant",
            "content": "❓ Pergunta 1: Qual é o título do projeto?\n\nDigite o título do seu projeto.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "text",
            "prefilled_value": project.name,
            "question_number": 1
        }

    if question_number == 2:
        return {
            "role": "assistant",
            "content": "❓ Pergunta 2: Descreva brevemente o objetivo do projeto.\n\nForneça uma breve descrição do que o projeto faz.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "text",
            "prefilled_value": project.description,
            "question_number": 2
        }

    # Questions 3-7: DYNAMIC (Stack - from specs)
    category_map = {
        3: ("backend", "❓ Pergunta 3: Qual framework de backend você vai usar?"),
        4: ("database", "❓ Pergunta 4: Qual banco de dados você vai usar?"),
        5: ("frontend", "❓ Pergunta 5: Qual framework de frontend você vai usar?"),
        6: ("css", "❓ Pergunta 6: Qual framework CSS você vai usar?"),
        7: ("mobile", "📱 Pergunta 7: Qual framework mobile você deseja usar?")
    }

    if question_number in category_map:
        category, question_text = category_map[question_number]

        # Get dynamic choices from specs
        choices = get_specs_for_category(db, category)

        # Build options text for display (for backward compatibility with text parsing)
        # NOTE: We don't include "◉ Escolha uma opção" anymore because MessageParser
        # incorrectly treats it as an option (it starts with ◉ symbol)
        options_text = "\n".join([f"○ {choice['label']}" for choice in choices])

        return {
            "role": "assistant",
            "content": f"{question_text}\n\n{options_text}\n\nPor favor, escolha uma das opções acima.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "single_choice",
            "question_number": question_number,
            "options": {
                "type": "single",
                "choices": choices
            }
        }

    return None


def get_fixed_question_task_focused(question_number: int, project: Project, db: Session) -> dict:
    """
    Returns fixed questions for TASK-FOCUSED interviews.
    PROMPT #68 - Dual-Mode Interview System

    Task-focused interviews skip stack questions and focus on task details.
    Q1: Task Type Selection (bug/feature/refactor/enhancement)
    Q2+: AI-generated based on selected task type

    Args:
        question_number: Question number (only Q1 is fixed for task-focused)
        project: Project instance
        db: Database session

    Returns:
        Message dict with question, or None if not a fixed question
    """
    if question_number == 1:
        return {
            "role": "assistant",
            "content": "❓ Que tipo de trabalho você precisa fazer?\n\nSelecione o tipo de tarefa:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-task-focused",
            "question_type": "single_choice",
            "question_number": 1,
            "options": {
                "type": "single",
                "choices": [
                    {
                        "id": "bug",
                        "label": "🐛 Bug Fix",
                        "value": "bug",
                        "description": "Corrigir um problema ou erro existente"
                    },
                    {
                        "id": "feature",
                        "label": "✨ New Feature",
                        "value": "feature",
                        "description": "Adicionar uma nova funcionalidade"
                    },
                    {
                        "id": "refactor",
                        "label": "🔧 Refactoring",
                        "value": "refactor",
                        "description": "Melhorar a estrutura do código sem alterar funcionalidade"
                    },
                    {
                        "id": "enhancement",
                        "label": "⚡ Enhancement",
                        "value": "enhancement",
                        "description": "Melhorar uma funcionalidade existente"
                    }
                ]
            }
        }

    # Q2+ are AI-generated, not fixed
    return None
