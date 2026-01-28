"""
Context Interview Fixed Questions
PROMPT #89 - Context Interview: Foundational Project Description
PROMPT #93 - Unlimited Context Interview (user decides when to end)
PROMPT #118 - Skip Q2/Q3 if memory scan context exists

This module provides the fixed questions for the Context Interview.
The Context Interview is the FIRST interview for any project and establishes
the immutable context that guides all subsequent card generation.

Fixed Questions (Q1-Q3):
- Q1: Project Title (pre-filled with project.name)
- Q2: Problem Statement (what problem are you solving?) - SKIPPED if memory context exists
- Q3: Project Vision (general overview of what it should do) - SKIPPED if memory context exists

PROMPT #118: If project has initial_memory_context from codebase scan, Q2 and Q3
are skipped because the AI already has context from analyzing the code.
The interview goes directly from Q1 (title confirmation) to AI-generated questions.

After fixed questions, AI generates contextual CLOSED questions with options based on
the user's responses and memory context to gather more details about:
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


# Total fixed questions for context interview (without memory context)
CONTEXT_FIXED_QUESTION_COUNT = 3
# Fixed questions when memory context exists (only Q1)
CONTEXT_FIXED_QUESTION_COUNT_WITH_MEMORY = 1


def has_memory_context(project: Project) -> bool:
    """
    Check if project has initial memory context from codebase scan.

    PROMPT #118 - Memory scan context

    Args:
        project: Project instance

    Returns:
        True if initial_memory_context is set
    """
    return bool(project.initial_memory_context)


def get_context_fixed_question(
    question_number: int,
    project: Project,
    db: Session
) -> Optional[Dict]:
    """
    Returns fixed questions for Context Interview.

    PROMPT #89 - Context Interview Fixed Questions
    PROMPT #118 - Skip Q2/Q3 if memory context exists

    The Context Interview has 3 essential fixed questions:
    - Q1: Project title (confirm/edit) - ALWAYS ASKED
    - Q2: Problem statement (what problem are you solving?) - SKIPPED if memory context exists
    - Q3: Project vision (general overview) - SKIPPED if memory context exists

    If the project has initial_memory_context from codebase scan, we skip Q2 and Q3
    because the AI already has context about the project from analyzing the code.

    After fixed questions, AI takes over with contextual questions.

    Args:
        question_number: Question number (1-3 are fixed for context)
        project: Project instance
        db: Database session (for future expansions)

    Returns:
        Message dict with question, or None if beyond fixed questions
    """
    # PROMPT #118 - Check if we have memory context
    memory_context_exists = has_memory_context(project)

    # Q1: Project Title - ALWAYS asked
    if question_number == 1:
        # If we have memory context, mention that the title was suggested by AI
        content = "**Pergunta 1: Qual é o título do seu projeto?**\n\n"
        if memory_context_exists:
            content += "Este título foi sugerido com base na análise do seu código. Confirme ou edite se necessário."
        else:
            content += "Confirme ou edite o nome do projeto que será desenvolvido."

        return {
            "role": "assistant",
            "content": content,
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-context",
            "question_type": "text",
            "question_number": 1,
            "prefilled_value": project.name or "",
            "metadata": {
                "field": "project_title",
                "required": True,
                "max_length": 255,
                "has_memory_context": memory_context_exists
            }
        }

    # PROMPT #118 - Skip Q2 and Q3 if memory context exists
    if memory_context_exists:
        # Go directly to AI questions after Q1
        return None

    # Q2: Problem Statement (only if no memory context)
    if question_number == 2:
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

    # Q3: Project Vision (only if no memory context)
    if question_number == 3:
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


def count_fixed_questions_context(project: Optional[Project] = None) -> int:
    """
    Returns the total number of fixed questions for context interview.

    PROMPT #118 - Returns 1 if memory context exists (only Q1)

    Args:
        project: Optional Project instance to check for memory context

    Returns:
        1 if memory context exists (only Q1: Title)
        3 if no memory context (Q1: Title, Q2: Problem, Q3: Vision)
    """
    if project and has_memory_context(project):
        return CONTEXT_FIXED_QUESTION_COUNT_WITH_MEMORY
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

    After the fixed questions, AI generates CLOSED questions with options
    to gather more details about the project.

    PROMPT #109: Updated to use closed questions format with options.
    PROMPT #118: Include memory scan context if available.

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

    # PROMPT #118 - Include memory context if available
    memory_context = ""
    if has_memory_context(project):
        memory_context = f"""
## Contexto Extraído do Código (Memory Scan)
O código do projeto foi analisado e o seguinte contexto foi extraído:

{project.initial_memory_context}

Use este contexto para fazer perguntas mais específicas e relevantes.
Não pergunte sobre o que já está claro no contexto acima.
Foque em detalhes que complementem o que já foi descoberto.
"""

    # PROMPT #109 - Load prompt from YAML (no hardcoded fallback - follows CLAUDE.md rule)
    loader = PromptLoader()
    system_prompt, _ = loader.render(
        "interviews/context_interview_ai",
        {
            "project_name": project.name,
            "qa_summary": qa_summary,
            "question_count": question_count + 1,
            "memory_context": memory_context  # PROMPT #118
        }
    )
    return system_prompt


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
