"""
Simple Interview Questions - PROMPT #91
Novo sistema de entrevistas simplificado

Fase 1 - Perguntas Fixas (Q1-Q8):
- Q1: Título
- Q2: Descrição
- Q3: Tipo de Sistema (Apenas API, API + Frontend, API + Mobile, API + Frontend + Mobile)
- Q4-Q8: Stack baseado no tipo escolhido (opções vêm dos specs)

Fase 2 - Perguntas IA:
- Contexto máximo (título + descrição + stack)
- Nunca repetir perguntas
- Sempre respostas fechadas (radio/checkbox)
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


def get_simple_fixed_question(
    question_number: int,
    project: Project,
    db: Session,
    previous_answers: Dict = None
) -> Optional[dict]:
    """
    Returns fixed questions for SIMPLE interview mode.

    PROMPT #91 - Novo Sistema Simplificado

    Q1: Título (text)
    Q2: Descrição (text)
    Q3: Tipo de Sistema (single_choice)
    Q4-Q8: Stack conforme tipo escolhido (opções dos specs)

    Args:
        question_number: Question number
        project: Project instance
        db: Database session
        previous_answers: Dict with previous answers (usado para Q4+ saber o tipo)

    Returns:
        Message dict with question, or None if beyond fixed questions
    """
    previous_answers = previous_answers or {}

    # Q1: Título
    if question_number == 1:
        return {
            "role": "assistant",
            "content": "🎯 Pergunta 1: Qual é o título do projeto?\n\nDigite o nome do seu projeto.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-simple",
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
            "model": "system/fixed-question-simple",
            "question_type": "text",
            "question_number": 2,
            "prefilled_value": project.description or ""
        }

    # Q3: Tipo de Sistema
    elif question_number == 3:
        return {
            "role": "assistant",
            "content": "🏗️ Pergunta 3: Que tipo de sistema você vai desenvolver?\n\nEscolha o tipo de aplicação que será construída:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-simple",
            "question_type": "single_choice",
            "question_number": 3,
            "options": {
                "type": "single",
                "choices": [
                    {
                        "id": "apenas_api",
                        "label": "🔌 Apenas API",
                        "value": "apenas_api",
                        "description": "API REST/GraphQL sem interface visual"
                    },
                    {
                        "id": "api_frontend",
                        "label": "💻 API + Frontend Web",
                        "value": "api_frontend",
                        "description": "API + aplicação web (SPA/SSR)"
                    },
                    {
                        "id": "api_mobile",
                        "label": "📱 API + Mobile",
                        "value": "api_mobile",
                        "description": "API + aplicativo móvel (iOS/Android)"
                    },
                    {
                        "id": "api_frontend_mobile",
                        "label": "🌐 API + Frontend + Mobile",
                        "value": "api_frontend_mobile",
                        "description": "Solução completa: API + Web + Mobile"
                    }
                ]
            }
        }

    # Q4-Q8: Stack (condicional baseado em Q3)
    system_type = previous_answers.get('system_type') or previous_answers.get('q3')

    # Mapeamento de perguntas por tipo de sistema
    stack_questions = {
        'apenas_api': [
            (4, "backend", "🔧 Pergunta 4: Qual framework de backend você vai usar?"),
            (5, "database", "🗄️ Pergunta 5: Qual banco de dados você vai usar?")
        ],
        'api_frontend': [
            (4, "backend", "🔧 Pergunta 4: Qual framework de backend você vai usar?"),
            (5, "database", "🗄️ Pergunta 5: Qual banco de dados você vai usar?"),
            (6, "frontend", "💻 Pergunta 6: Qual framework de frontend você vai usar?"),
            (7, "css", "🎨 Pergunta 7: Qual framework CSS você vai usar?")
        ],
        'api_mobile': [
            (4, "backend", "🔧 Pergunta 4: Qual framework de backend você vai usar?"),
            (5, "database", "🗄️ Pergunta 5: Qual banco de dados você vai usar?"),
            (6, "mobile", "📱 Pergunta 6: Qual framework mobile você vai usar?")
        ],
        'api_frontend_mobile': [
            (4, "backend", "🔧 Pergunta 4: Qual framework de backend você vai usar?"),
            (5, "database", "🗄️ Pergunta 5: Qual banco de dados você vai usar?"),
            (6, "frontend", "💻 Pergunta 6: Qual framework de frontend você vai usar?"),
            (7, "css", "🎨 Pergunta 7: Qual framework CSS você vai usar?"),
            (8, "mobile", "📱 Pergunta 8: Qual framework mobile você vai usar?")
        ]
    }

    if system_type and system_type in stack_questions:
        questions = stack_questions[system_type]

        # Procura a pergunta atual no mapeamento
        for q_num, category, question_text in questions:
            if q_num == question_number:
                choices = get_specs_for_category(db, category)

                if not choices:
                    # Se não tem specs para essa categoria, pula
                    return None

                options_text = "\n".join([f"○ {choice['label']}" for choice in choices])

                return {
                    "role": "assistant",
                    "content": f"{question_text}\n\n{options_text}\n\nPor favor, escolha uma das opções acima.",
                    "timestamp": datetime.utcnow().isoformat(),
                    "model": "system/fixed-question-simple",
                    "question_type": "single_choice",
                    "question_number": question_number,
                    "options": {
                        "type": "single",
                        "choices": choices
                    },
                    "stack_category": category  # Metadado para salvar no projeto
                }

    # Se chegou aqui, não tem mais perguntas fixas
    return None


def count_fixed_questions_simple(system_type: str) -> int:
    """
    Retorna o número total de perguntas fixas baseado no tipo de sistema.

    Args:
        system_type: Tipo do sistema (apenas_api, api_frontend, etc.)

    Returns:
        Número de perguntas fixas
    """
    question_count = {
        'apenas_api': 5,  # Q1, Q2, Q3, Q4 (backend), Q5 (database)
        'api_frontend': 7,  # Q1, Q2, Q3, Q4 (backend), Q5 (database), Q6 (frontend), Q7 (css)
        'api_mobile': 6,  # Q1, Q2, Q3, Q4 (backend), Q5 (database), Q6 (mobile)
        'api_frontend_mobile': 8  # Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8
    }

    return question_count.get(system_type, 5)  # Default: apenas_api


def is_fixed_question_complete_simple(conversation_data: list, system_type: str) -> bool:
    """
    Verifica se todas as perguntas fixas foram respondidas.

    Args:
        conversation_data: Lista de mensagens da conversa
        system_type: Tipo do sistema escolhido

    Returns:
        True se todas as perguntas fixas foram respondidas
    """
    total_fixed = count_fixed_questions_simple(system_type)

    # Conta quantas perguntas fixas foram feitas
    fixed_count = sum(
        1 for msg in conversation_data
        if msg.get('model') == 'system/fixed-question-simple' and msg.get('role') == 'assistant'
    )

    return fixed_count >= total_fixed
