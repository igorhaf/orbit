"""
Context Interview Fixed Questions
PROMPT #89 - Context Interview: Foundational Project Description
PROMPT #93 - Unlimited Context Interview (user decides when to end)

This module provides the fixed questions for the Context Interview.
The Context Interview is the FIRST interview for any project and establishes
the immutable context that guides all subsequent card generation.

Fixed Questions (Q1-Q3):
- Q1: Project Title (pre-filled with project.name)
- Q2: Problem Statement (what problem are you solving?)
- Q3: Project Vision (general overview of what it should do)

After Q3, AI generates contextual CLOSED questions with options (Q4+) based on
the user's responses to gather more details about:
- Target users
- Key features
- Success criteria
- Technical constraints
- etc.

IMPORTANT (PROMPT #93): The interview is UNLIMITED. The user decides when
to end by clicking the "Generate Context" button. The AI will keep asking
relevant questions until the user chooses to stop.
"""

from datetime import datetime
from typing import Dict, Optional
from sqlalchemy.orm import Session

from app.prompts.loader import PromptLoader

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
                "**Pergunta 1: Qual é o título do seu projeto?**\n\n"
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
                "**Pergunta 2: Qual problema você quer resolver?**\n\n"
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
                "**Pergunta 3: Qual é a visão geral do projeto?**\n\n"
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

    After the 3 fixed questions, AI generates CLOSED questions with options
    to gather more details about the project.

    PROMPT #109: Updated to use closed questions format with options.

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

    # PROMPT #109 - Load prompt from YAML with closed questions format
    try:
        loader = PromptLoader()
        system_prompt, _ = loader.render(
            "interviews/context_interview_ai",
            {
                "project_name": project.name,
                "qa_summary": qa_summary,
                "question_count": question_count + 1
            }
        )
        return system_prompt
    except Exception as e:
        # Fallback to hardcoded prompt if loader fails
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"Failed to load context_interview_ai prompt: {e}. Using fallback.")

        # PROMPT #109 - Fallback prompt with closed questions format
        prompt = f"""Voce e um entrevistador especializado em levantamento de requisitos de software.

Voce esta conduzindo uma Entrevista de Contexto para o projeto "{project.name}".

## Conversa Anterior
{qa_summary}

## Sua Tarefa
Gere UMA pergunta FECHADA para coletar mais informacoes sobre o projeto.

## Formato OBRIGATORIO
Responda EXATAMENTE neste formato:

**Pergunta {question_count + 1}: [Sua pergunta aqui]**

○ [Primeira opcao]
○ [Segunda opcao]
○ [Terceira opcao]
○ [Quarta opcao]

💬 Ou descreva com suas proprias palavras.

## REGRAS CRITICAS
- GERE APENAS UMA PERGUNTA POR RESPOSTA (nunca duas ou mais)
- Use SOMENTE "○" (circulo vazio Unicode) para marcar opcoes
- NUNCA use "•" (bullet) ou outros simbolos
- Forneca entre 3-5 opcoes de resposta
- Opcoes devem ser RESPOSTAS concretas, nao perguntas
- SEMPRE inclua a linha "💬 Ou descreva com suas proprias palavras."
- Contextualize com respostas anteriores

## Topicos a Explorar
1. Quem sao os usuarios do sistema (perfis, permissoes)
2. Quais funcionalidades sao mais importantes (prioridades)
3. Quais sao as restricoes tecnicas ou de prazo
4. Como o sucesso do projeto sera medido (metricas)
5. Integracoes com outros sistemas
6. Requisitos de seguranca e performance
7. Fluxos de trabalho e processos de negocios

## NAO Repita Perguntas Ja Feitas
Analise a conversa anterior e evite repetir topicos ja abordados.
"""

        return prompt


def should_end_context_interview(conversation_data: list) -> bool:
    """
    PROMPT #93 - Context interview is UNLIMITED.

    The user decides when to end by clicking the "Generate Context" button.
    This function always returns False - the interview never ends automatically.

    Args:
        conversation_data: Current conversation

    Returns:
        Always False - user decides when to end
    """
    # PROMPT #93: Interview is unlimited - user clicks "Generate Context" to end
    # Never automatically end the interview
    return False
