"""
Interview Handlers - Dual-Mode Interview System
PROMPT #68 - Extracted routing logic for better maintainability

This module contains the routing logic for both interview modes:
- Requirements Interview (new projects): Q1-Q7 stack → AI business questions
- Task-Focused Interview (existing projects): Q1 task type → AI focused questions
"""

from typing import Dict, Any
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
import logging
import os

from app.models.interview import Interview
from app.models.project import Project
from app.services.ai_orchestrator import AIOrchestrator

# Prompter Architecture
try:
    from app.prompter.facade import PrompterFacade
    PROMPTER_AVAILABLE = True
except ImportError:
    PROMPTER_AVAILABLE = False


logger = logging.getLogger(__name__)


async def handle_meta_prompt_interview(
    interview: Interview,
    project: Project,
    message_count: int,
    project_context: str,
    db: Session,
    get_fixed_question_meta_prompt_func,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """
    Handle META PROMPT interview mode (ALWAYS first interview).

    PROMPT #76 - Meta Prompt Feature

    Flow:
    - Q1-Q8: Fixed meta prompt questions (no AI)
    - Q9+: AI-generated contextual questions to clarify details

    The meta prompt gathers comprehensive information to generate:
    - Complete project hierarchy (Epics → Stories → Tasks → Subtasks)
    - Atomic prompts for each task/subtask
    - All fields populated (description, acceptance_criteria, priorities, etc.)

    Args:
        interview: Interview instance
        project: Project instance
        message_count: Current message count
        project_context: Project context string
        db: Database session
        get_fixed_question_meta_prompt_func: Function to get meta prompt fixed questions
        clean_ai_response_func: Function to clean AI responses
        prepare_context_func: Function to prepare interview context

    Returns:
        Response dict with success, message, and usage
    """
    logger.info(f"🎯 META PROMPT MODE - message_count={message_count}")

    # Map message_count to question number for fixed questions
    # Meta prompt has 8 fixed questions (Q1-Q8)
    question_map = {
        2: 1,   # After project creation → Ask Q1 (Vision & Problem)
        4: 2,   # After A1 → Ask Q2 (Main Features)
        6: 3,   # After A2 → Ask Q3 (User Roles)
        8: 4,   # After A3 → Ask Q4 (Business Rules)
        10: 5,  # After A4 → Ask Q5 (Data & Entities)
        12: 6,  # After A5 → Ask Q6 (Success Criteria)
        14: 7,  # After A6 → Ask Q7 (Technical Constraints)
        16: 8,  # After A7 → Ask Q8 (MVP Scope)
    }

    # Fixed meta prompt questions (Q1-Q8)
    if message_count in question_map:
        return _handle_fixed_question_meta(
            interview, project, message_count,
            question_map, db, get_fixed_question_meta_prompt_func
        )

    # AI contextual questions (Q9+) - to clarify details
    elif message_count >= 18:
        return await _handle_ai_meta_contextual_question(
            interview, project, message_count,
            project_context, db,
            clean_ai_response_func, prepare_context_func
        )

    else:
        # Unexpected state
        logger.error(f"Unexpected message_count={message_count} in meta prompt mode")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected interview state (message_count={message_count})"
        )


async def handle_requirements_interview(
    interview: Interview,
    project: Project,
    message_count: int,
    project_context: str,
    stack_context: str,
    db: Session,
    get_fixed_question_func,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """
    Handle REQUIREMENTS interview mode (new projects).

    Flow:
    - Q1-Q7: Fixed stack questions (no AI)
    - Q8+: AI-generated business questions

    Args:
        interview: Interview instance
        project: Project instance
        message_count: Current message count
        project_context: Project context string
        stack_context: Stack context string
        db: Database session
        get_fixed_question_func: Function to get fixed questions
        clean_ai_response_func: Function to clean AI responses
        prepare_context_func: Function to prepare interview context

    Returns:
        Response dict with success, message, and usage
    """
    logger.info(f"📋 REQUIREMENTS MODE - message_count={message_count}")

    # Map message_count to question number for fixed questions
    question_map = {
        2: 2,   # After A1 (Title) → Ask Q2 (Description)
        4: 3,   # After A2 (Description) → Ask Q3 (Backend)
        6: 4,   # After A3 (Backend) → Ask Q4 (Database)
        8: 5,   # After A4 (Database) → Ask Q5 (Frontend)
        10: 6,  # After A5 (Frontend) → Ask Q6 (CSS)
        12: 7,  # After A6 (CSS) → Ask Q7 (Mobile)
    }

    # Fixed stack questions (Q1-Q7)
    if message_count in question_map:
        return _handle_fixed_question(
            interview, project, message_count,
            question_map, db, get_fixed_question_func
        )

    # AI business questions (Q8+)
    elif message_count >= 14:
        return await _handle_ai_business_question(
            interview, project, message_count,
            project_context, stack_context, db,
            clean_ai_response_func, prepare_context_func
        )

    else:
        # Unexpected state
        logger.error(f"Unexpected message_count={message_count} in requirements mode")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected interview state (message_count={message_count})"
        )


async def handle_task_focused_interview(
    interview: Interview,
    project: Project,
    message_count: int,
    stack_context: str,
    db: Session,
    get_fixed_question_task_focused_func,
    extract_task_type_func,
    build_task_focused_prompt_func,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """
    Handle TASK-FOCUSED interview mode (existing projects).

    Flow:
    - Q1: Task type selection (bug/feature/refactor/enhancement) - Fixed
    - Q2+: AI-generated questions tailored to task type

    Args:
        interview: Interview instance
        project: Project instance
        message_count: Current message count
        stack_context: Stack context string
        db: Database session
        get_fixed_question_task_focused_func: Function to get Q1
        extract_task_type_func: Function to extract task type from answer
        build_task_focused_prompt_func: Function to build task-specific prompt
        clean_ai_response_func: Function to clean AI responses
        prepare_context_func: Function to prepare interview context

    Returns:
        Response dict with success, message, and usage
    """
    logger.info(f"🎯 TASK-FOCUSED MODE - message_count={message_count}")

    # Q1: Task type selection (fixed question)
    if message_count == 2:
        logger.info("Returning Q1: Task type selection")
        assistant_message = get_fixed_question_task_focused_func(1, project, db)

        if not assistant_message:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get task type question"
            )

        interview.conversation_data.append(assistant_message)

        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(interview, "conversation_data")
        db.commit()
        db.refresh(interview)

        return {
            "success": True,
            "message": assistant_message,
            "usage": {
                "model": "system/fixed-question-task-focused",
                "input_tokens": 0,
                "output_tokens": 0,
                "total_cost_usd": 0.0
            }
        }

    # After Q1: Extract task type from user's answer
    elif message_count == 3:
        # User just answered Q1 (task type)
        # Extract task type and save it
        user_answer = interview.conversation_data[-1]["content"]
        task_type = extract_task_type_func(user_answer)

        logger.info(f"Extracted task_type: {task_type}")
        interview.task_type_selection = task_type

        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(interview, "task_type_selection")
        db.commit()

        # Continue to AI questions
        return await _handle_ai_task_focused_question(
            interview, project, message_count, task_type,
            stack_context, db, build_task_focused_prompt_func,
            clean_ai_response_func, prepare_context_func
        )

    # Q2+: AI-generated questions based on task type
    elif message_count >= 4:
        task_type = interview.task_type_selection or "feature"

        return await _handle_ai_task_focused_question(
            interview, project, message_count, task_type,
            stack_context, db, build_task_focused_prompt_func,
            clean_ai_response_func, prepare_context_func
        )

    else:
        # Unexpected state
        logger.error(f"Unexpected message_count={message_count} in task-focused mode")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected interview state (message_count={message_count})"
        )


# ========== Private Helper Functions ==========

def _handle_fixed_question(
    interview: Interview,
    project: Project,
    message_count: int,
    question_map: dict,
    db: Session,
    get_fixed_question_func
) -> Dict[str, Any]:
    """Handle fixed stack questions (Q1-Q7) in requirements mode."""
    question_number = question_map[message_count]
    logger.info(f"Returning fixed Question {question_number}")

    assistant_message = get_fixed_question_func(question_number, project, db)

    if not assistant_message:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get fixed question {question_number}"
        )

    interview.conversation_data.append(assistant_message)

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(interview, "conversation_data")
    db.commit()
    db.refresh(interview)

    return {
        "success": True,
        "message": assistant_message,
        "usage": {
            "model": "system/fixed-question",
            "input_tokens": 0,
            "output_tokens": 0,
            "total_cost_usd": 0.0
        }
    }


async def _handle_ai_business_question(
    interview: Interview,
    project: Project,
    message_count: int,
    project_context: str,
    stack_context: str,
    db: Session,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """Handle AI-generated business questions (Q8+) in requirements mode."""
    logger.info(f"Using AI for business question (message_count={message_count})")

    # Check if PrompterFacade is available
    use_prompter = (
        PROMPTER_AVAILABLE and
        os.getenv("PROMPTER_USE_TEMPLATES", "false").lower() == "true"
    )

    # Generate system prompt
    if use_prompter:
        try:
            prompter = PrompterFacade(db)
            question_num = (message_count // 2) + 1
            system_prompt = prompter.generate_interview_question(
                project=project,
                conversation_history=interview.conversation_data,
                question_number=question_num
            )
        except Exception as e:
            logger.warning(f"PrompterFacade failed, falling back to legacy: {e}")
            use_prompter = False

    if not use_prompter:
        # Legacy hardcoded prompt
        system_prompt = f"""Você é um analista de requisitos de IA coletando requisitos técnicos para um projeto de software.

**Conduza em PORTUGUÊS.** Use este contexto:
{project_context}
{stack_context}

**Formato de Pergunta:**
❓ Pergunta [número]: [Sua pergunta contextual]

Para ESCOLHA ÚNICA:
○ Opção 1
○ Opção 2
○ Opção 3
◉ [Escolha uma opção]

Para MÚLTIPLA ESCOLHA:
☐ Opção 1
☐ Opção 2
☐ Opção 3
☑️ [Selecione todas que se aplicam]

**Regras:**
- Uma pergunta por vez com 3-5 opções mínimo
- Construa contexto com respostas anteriores
- Incremente número da pergunta (você está na pergunta 7+)
- Após 8-12 perguntas total, conclua a entrevista

**Tópicos:** Funcionalidades principais, usuários e permissões, integrações de terceiros, deploy e infraestrutura, performance e escalabilidade.

Continue com próxima pergunta relevante!
"""

    # Call AI Orchestrator
    return await _execute_ai_question(
        interview, project, system_prompt, db,
        clean_ai_response_func, prepare_context_func
    )


async def _handle_ai_task_focused_question(
    interview: Interview,
    project: Project,
    message_count: int,
    task_type: str,
    stack_context: str,
    db: Session,
    build_task_focused_prompt_func,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """Handle AI-generated task-focused questions (Q2+) in task-focused mode."""
    logger.info(f"Using AI for task-focused question (type={task_type}, message_count={message_count})")

    # Build task-specific prompt
    system_prompt = build_task_focused_prompt_func(
        project, task_type, message_count, stack_context
    )

    # Call AI Orchestrator
    return await _execute_ai_question(
        interview, project, system_prompt, db,
        clean_ai_response_func, prepare_context_func
    )


async def _execute_ai_question(
    interview: Interview,
    project: Project,
    system_prompt: str,
    db: Session,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """Execute AI question via AIOrchestrator."""
    orchestrator = AIOrchestrator(db)

    try:
        # Optimize context
        optimized_messages = prepare_context_func(
            conversation_data=interview.conversation_data,
            max_recent=5
        )

        # Call AI
        response = await orchestrator.execute(
            usage_type="interview",
            messages=optimized_messages,
            system_prompt=system_prompt,
            max_tokens=1000,
            project_id=interview.project_id,
            interview_id=interview.id
        )

        # Clean response
        cleaned_content = clean_ai_response_func(response["content"])

        # Build assistant message
        assistant_message = {
            "role": "assistant",
            "content": cleaned_content,
            "timestamp": datetime.utcnow().isoformat(),
            "model": f"{response['provider']}/{response['model']}"
        }

        # Append to conversation
        interview.conversation_data.append(assistant_message)
        interview.ai_model_used = response["model"]

        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(interview, "conversation_data")
        db.commit()
        db.refresh(interview)

        logger.info(f"AI responded successfully")

        return {
            "success": True,
            "message": assistant_message,
            "usage": response.get("usage", {})
        }

    except Exception as ai_error:
        logger.error(f"AI execution failed: {str(ai_error)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get AI response: {str(ai_error)}"
        )


def _handle_fixed_question_meta(
    interview: Interview,
    project: Project,
    message_count: int,
    question_map: dict,
    db: Session,
    get_fixed_question_meta_prompt_func
) -> Dict[str, Any]:
    """Handle fixed meta prompt questions (Q1-Q8)."""
    question_number = question_map[message_count]
    logger.info(f"Returning fixed Meta Prompt Question {question_number}")

    assistant_message = get_fixed_question_meta_prompt_func(question_number, project, db)

    if not assistant_message:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get fixed meta prompt question {question_number}"
        )

    interview.conversation_data.append(assistant_message)

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(interview, "conversation_data")
    db.commit()
    db.refresh(interview)

    return {
        "success": True,
        "message": assistant_message,
        "usage": {
            "model": "system/fixed-question-meta-prompt",
            "input_tokens": 0,
            "output_tokens": 0,
            "total_cost_usd": 0.0
        }
    }


async def _handle_ai_meta_contextual_question(
    interview: Interview,
    project: Project,
    message_count: int,
    project_context: str,
    db: Session,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """Handle AI-generated contextual questions (Q9+) in meta prompt mode."""
    logger.info(f"Using AI for meta contextual question (message_count={message_count})")

    # Build system prompt for contextual clarification questions
    system_prompt = f"""Você é um Product Owner experiente conduzindo uma entrevista de Meta Prompt para definir um projeto completo.

**CONTEXTO DO PROJETO:**
{project_context}

**INFORMAÇÕES JÁ COLETADAS:**
Você já fez 8 perguntas fixas sobre:
1. Visão do projeto e problema a resolver
2. Principais módulos/funcionalidades
3. Perfis de usuários e permissões
4. Regras de negócio
5. Entidades/dados principais
6. Critérios de sucesso
7. Restrições técnicas
8. Escopo e prioridades do MVP

Analise as respostas anteriores e faça perguntas contextualizadas para:
- **ESCLARECER DETALHES** que ficaram vagos ou ambíguos
- **APROFUNDAR** em funcionalidades complexas mencionadas
- **DESCOBRIR DEPENDÊNCIAS** entre módulos/features
- **VALIDAR PREMISSAS** sobre escopo, usuários ou regras de negócio
- **IDENTIFICAR EDGE CASES** ou cenários especiais

**IMPORTANTE:**
- Analise bem as respostas dadas nas perguntas fixas
- Não fuja do conceito que o cliente quer
- Foque em clarificar, não em expandir escopo desnecessariamente
- Faça 1 pergunta por vez, contextualizada e específica

**Formato de Pergunta:**
❓ Pergunta [número]: [Sua pergunta contextual]

Para ESCOLHA ÚNICA:
○ Opção 1
○ Opção 2
○ Opção 3

Para MÚLTIPLA ESCOLHA:
☐ Opção 1
☐ Opção 2
☐ Opção 3
☑️ [Selecione todas que se aplicam]

Para TEXTO LIVRE:
💬 Descreva sua resposta

**Conduza em PORTUGUÊS.** Continue com a próxima pergunta relevante!

Após 3-5 perguntas contextuais (total ~12-14 perguntas), conclua a entrevista informando que o projeto será gerado.
"""

    # Call AI Orchestrator
    return await _execute_ai_question(
        interview, project, system_prompt, db,
        clean_ai_response_func, prepare_context_func
    )
