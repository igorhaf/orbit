"""
Context Interview Fixed Questions
PROMPT #89 - Context Interview: Foundational Project Description

This module provides the fixed questions for the Context Interview.
The Context Interview is the FIRST interview for any project and establishes
the immutable context that guides all subsequent card generation.

Fixed Questions (Q1-Q3):
- Q1: Project Title (pre-filled with project.name)
- Q2: Problem Statement (what problem are you solving?)
- Q3: Project Vision (general overview of what it should do)

After Q3, AI generates contextual open-ended questions (Q4+) based on
the user's responses to gather more details about:
- Target users
- Key features
- Success criteria
- Technical constraints
- etc.

Maximum: 8-10 total questions (3 fixed + 5-7 AI-generated)
"""

from datetime import datetime
from typing import Dict, Optional
from sqlalchemy.orm import Session

from app.models.project import Project


# Total fixed questions for context interview
CONTEXT_FIXED_QUESTION_COUNT = 3


def get_context_fixed_question(
    question_number: int,
    project: Project,
    db: Session
) -> Optional[Dict]:
    """
    Returns fixed questions for Context Interview.

    PROMPT #89 - Context Interview Fixed Questions

    The Context Interview has 3 essential fixed questions:
    - Q1: Project title (confirm/edit)
    - Q2: Problem statement (what problem are you solving?)
    - Q3: Project vision (general overview)

    After these, AI takes over with contextual questions.

    Args:
        question_number: Question number (1-3 are fixed for context)
        project: Project instance
        db: Database session (for future expansions)

    Returns:
        Message dict with question, or None if beyond fixed questions
    """

    # Q1: Project Title
    if question_number == 1:
        return {
            "role": "assistant",
            "content": (
                "**Pergunta 1/3: Qual é o título do seu projeto?**\n\n"
                "Confirme ou edite o nome do projeto que será desenvolvido."
            ),
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-context",
            "question_type": "text",
            "question_number": 1,
            "prefilled_value": project.name or "",
            "metadata": {
                "field": "project_title",
                "required": True,
                "max_length": 255
            }
        }

    # Q2: Problem Statement
    elif question_number == 2:
        return {
            "role": "assistant",
            "content": (
                "**Pergunta 2/3: Qual problema você quer resolver?**\n\n"
                "Descreva o problema ou necessidade que motivou a criação deste projeto. "
                "Seja específico sobre:\n"
                "- Qual é a dor ou dificuldade atual?\n"
                "- Quem sofre com esse problema?\n"
                "- Quais são as consequências de não resolver?"
            ),
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-context",
            "question_type": "text",
            "question_number": 2,
            "metadata": {
                "field": "problem_statement",
                "required": True,
                "min_length": 50
            }
        }

    # Q3: Project Vision
    elif question_number == 3:
        return {
            "role": "assistant",
            "content": (
                "**Pergunta 3/3: Qual é a visão geral do projeto?**\n\n"
                "Descreva o que o projeto deve fazer quando estiver pronto. "
                "Não se preocupe com detalhes técnicos, foque em:\n"
                "- O que o sistema faz?\n"
                "- Quais são os principais resultados esperados?\n"
                "- Como será o sucesso do projeto?"
            ),
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-context",
            "question_type": "text",
            "question_number": 3,
            "metadata": {
                "field": "project_vision",
                "required": True,
                "min_length": 50
            }
        }

    # Q4+: AI contextual questions (not fixed)
    return None


def count_fixed_questions_context() -> int:
    """
    Returns the total number of fixed questions for context interview.

    Returns:
        3 (Q1: Title, Q2: Problem, Q3: Vision)
    """
    return CONTEXT_FIXED_QUESTION_COUNT


def is_fixed_question_complete_context(conversation_data: list) -> bool:
    """
    Check if all fixed questions have been answered.

    Args:
        conversation_data: List of conversation messages

    Returns:
        True if at least 6 messages (3 Q&A pairs for Q1-Q3)
    """
    if not conversation_data:
        return False

    # Count fixed question answers
    # Fixed questions have model="system/fixed-question-context"
    fixed_questions_asked = sum(
        1 for msg in conversation_data
        if msg.get('model') == 'system/fixed-question-context' and msg.get('role') == 'assistant'
    )

    # All 3 fixed questions must be asked
    return fixed_questions_asked >= CONTEXT_FIXED_QUESTION_COUNT


def get_context_ai_prompt(conversation_data: list, project: Project) -> str:
    """
    Build the prompt for AI to generate contextual questions.

    After the 3 fixed questions, AI generates open-ended questions
    to gather more details about the project.

    Args:
        conversation_data: Current conversation
        project: Project instance

    Returns:
        System prompt for AI to generate the next question
    """
    # Extract previous Q&A
    qa_pairs = []
    for i, msg in enumerate(conversation_data):
        if msg.get('role') == 'assistant':
            question = msg.get('content', '')
            # Find the user's answer (next message)
            if i + 1 < len(conversation_data):
                answer = conversation_data[i + 1].get('content', '')
                qa_pairs.append(f"P: {question}\nR: {answer}")

    qa_summary = "\n\n".join(qa_pairs)

    # Count current questions (both fixed and AI)
    question_count = len([m for m in conversation_data if m.get('role') == 'assistant'])

    # Maximum questions (8-10 total)
    remaining_questions = max(0, 8 - question_count)

    prompt = f"""Você é um entrevistador especializado em levantamento de requisitos de software.

Você está conduzindo uma Entrevista de Contexto para o projeto "{project.name}".

## Conversa Anterior
{qa_summary}

## Sua Tarefa
Gere UMA pergunta aberta para coletar mais informações sobre o projeto.

## Diretrizes
1. Faça perguntas que ajudem a entender:
   - Quem são os usuários do sistema
   - Quais funcionalidades são mais importantes
   - Quais são as restrições técnicas ou de prazo
   - Como o sucesso do projeto será medido

2. NÃO repita perguntas já feitas
3. Seja específico e direto
4. Use linguagem simples e acessível
5. Perguntas restantes: {remaining_questions}

## Formato
Responda APENAS com a pergunta, formatada assim:
**Pergunta {question_count + 1}: [Sua pergunta aqui]**

[Contexto ou explicação breve se necessário]

{f"IMPORTANTE: Esta é uma das últimas perguntas. Foque no que é mais essencial." if remaining_questions <= 2 else ""}
"""

    return prompt


def should_end_context_interview(conversation_data: list) -> bool:
    """
    Check if context interview should end (enough questions asked).

    Args:
        conversation_data: Current conversation

    Returns:
        True if 8+ questions asked (3 fixed + 5 AI)
    """
    if not conversation_data:
        return False

    # Count all questions (assistant messages)
    question_count = len([m for m in conversation_data if m.get('role') == 'assistant'])

    # End after 8 questions (or let user end earlier)
    return question_count >= 8
