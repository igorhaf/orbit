"""
Interview Handlers - Multi-Mode Interview System
PROMPT #68 - Extracted routing logic for better maintainability
PROMPT #91 - Simple Interview Mode

This module contains the routing logic for all interview modes:
- Simple Interview (first interview - PROMPT #91): Q1-Q8 conditional → AI contextual questions
- Meta Prompt Interview (first interview - PROMPT #76): Q1-Q17 fixed → AI contextual questions
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


async def handle_orchestrator_interview(
    interview: Interview,
    project: Project,
    message_count: int,
    db: Session,
    get_orchestrator_fixed_question_func,
    count_fixed_questions_orchestrator_func,
    is_fixed_question_complete_orchestrator_func,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """
    Handle ORCHESTRATOR interview mode (PROMPT #91/94 - First interview orchestrator).

    This mode "orchestrates" project foundation collection and hierarchy generation.

    Flow (PROMPT #94 FASE 3 - Specialized Sections):
    - Q1-Q3: Basic info (title, description, system type) - Always asked
    - Q4-Q8: Stack questions (conditional based on system type from Q3)
      - apenas_api: Q4 backend, Q5 database (5 total)
      - api_frontend: Q4 backend, Q5 database, Q6 frontend, Q7 CSS (7 total)
      - api_mobile: Q4 backend, Q5 database, Q6 mobile (6 total)
      - api_frontend_mobile: Q4-Q8 all stacks (8 total)
    - Q9+: AI contextual questions with specialized sections (PROMPT #94 FASE 3):
      - **Business Section** (ALWAYS) - business rules, validations, workflows (4-6 questions)
      - **Design Section** (if stack_frontend OR stack_css) - UX/UI, layout, components (3-5 questions)
      - **Mobile Section** (if stack_mobile) - mobile navigation, native features (3-5 questions)

    Sections are applied conditionally based on project stack, resulting in:
    - API-only projects: Business section only (~10-12 questions total)
    - API + Frontend: Business + Design sections (~13-17 questions total)
    - API + Mobile: Business + Mobile sections (~13-17 questions total)
    - Full stack (API + Frontend + Mobile): All 3 sections (~16-20 questions total)

    After completion, can generate complete hierarchy (Epic → Stories → Tasks → Subtasks).

    Args:
        interview: Interview instance
        project: Project instance
        message_count: Current message count
        db: Database session
        get_orchestrator_fixed_question_func: Function to get orchestrator fixed questions
        count_fixed_questions_orchestrator_func: Function to count total fixed questions
        is_fixed_question_complete_orchestrator_func: Function to check if fixed phase is complete
        clean_ai_response_func: Function to clean AI responses
        prepare_context_func: Function to prepare interview context

    Returns:
        Response dict with success, message, and usage
    """
    logger.info(f"🎯 ORCHESTRATOR MODE - message_count={message_count}")

    # Get system_type from previous answers (if Q3 was answered)
    system_type = None
    previous_answers = {}

    # Extract previous answers from conversation
    for i, msg in enumerate(interview.conversation_data):
        if msg.get('role') == 'user':
            # Determine which question this answers
            question_num = (i + 1) // 2
            previous_answers[f'q{question_num}'] = msg.get('content', '')

            # If this is Q3 answer, extract system_type
            if question_num == 3:
                # Extract system_type from answer
                content = msg.get('content', '').lower()
                if 'apenas_api' in content or 'apenas api' in content:
                    system_type = 'apenas_api'
                elif 'api_frontend_mobile' in content or 'api + frontend + mobile' in content:
                    system_type = 'api_frontend_mobile'
                elif 'api_mobile' in content or 'api + mobile' in content:
                    system_type = 'api_mobile'
                elif 'api_frontend' in content or 'api + frontend' in content:
                    system_type = 'api_frontend'

                previous_answers['system_type'] = system_type
                logger.info(f"Extracted system_type: {system_type}")

    # Calculate current question number (messages are: Q, A, Q, A...)
    # Start interview adds Q1 → conversation_data = [Q1] (length=1)
    # User answers → conversation_data = [Q1, A1] (length=2) → next question is Q2
    # message_count=2 ([Q1, A1]) → question_number=2
    # message_count=4 ([Q1, A1, Q2, A2]) → question_number=3
    question_number = (message_count // 2) + 1

    # Check if we're still in fixed questions phase
    # Need to know system_type to determine total fixed questions
    if system_type:
        total_fixed = count_fixed_questions_orchestrator_func(system_type)
        in_fixed_phase = question_number <= total_fixed
    else:
        # Before Q3 is answered, we don't know total fixed questions yet
        # Q1, Q2, Q3 are always asked
        in_fixed_phase = question_number <= 3

    if in_fixed_phase:
        # Fixed question phase
        logger.info(f"Returning fixed Question {question_number}")

        assistant_message = get_orchestrator_fixed_question_func(
            question_number=question_number,
            project=project,
            db=db,
            previous_answers=previous_answers
        )

        if not assistant_message:
            # No more fixed questions (conditional questions ended)
            # Move to AI phase
            logger.info(f"No fixed question {question_number} (conditional questions complete)")
            return await _handle_ai_orchestrator_contextual_question(
                interview, project, message_count,
                previous_answers, db,
                clean_ai_response_func, prepare_context_func
            )

        # Add fixed question to conversation
        interview.conversation_data.append(assistant_message)

        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(interview, "conversation_data")
        db.commit()
        db.refresh(interview)

        return {
            "success": True,
            "message": assistant_message,
            "usage": {
                "model": "system/fixed-question-simple",
                "input_tokens": 0,
                "output_tokens": 0,
                "total_cost_usd": 0.0
            }
        }

    else:
        # AI contextual questions phase
        return await _handle_ai_orchestrator_contextual_question(
            interview, project, message_count,
            previous_answers, db,
            clean_ai_response_func, prepare_context_func
        )


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
    PROMPT #77 - Topic Selection
    PROMPT #79 - Stack Questions Added
    PROMPT #81 - Project Modules Question Added
    PROMPT #97 - System Type Question Added

    Flow:
    - Q1-Q18: Fixed meta prompt questions (no AI)
      - Q1-Q2: Project info (title, description)
      - Q3: System type (Apenas API, API+Frontend, API+Mobile, API+Frontend+Mobile)
      - Q4-Q8: Stack (backend, database, frontend, CSS, mobile)
      - Q9: Project modules (Backend/API, Frontend Web, Mobile App, etc.)
      - Q10-Q17: Concept (vision, features, roles, rules, data, success, constraints, MVP)
      - Q18: Focus topics selection
    - Q19+: AI-generated contextual questions to clarify details

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
    # Meta prompt has 18 fixed questions (Q1-Q18) - PROMPT #97
    # PROMPT #97 FIX - Questions are sent at ODD message_counts (1, 3, 5...)
    question_map = {
        1: 1,   # message_count=1 → Ask Q1 (Title)
        3: 2,   # message_count=3 → Ask Q2 (Description)
        5: 3,   # message_count=5 → Ask Q3 (System Type) - PROMPT #97
        7: 4,   # message_count=7 → Ask Q4 (Backend Framework)
        9: 5,   # message_count=9 → Ask Q5 (Database)
        11: 6,  # message_count=11 → Ask Q6 (Frontend Framework)
        13: 7,  # message_count=13 → Ask Q7 (CSS Framework)
        15: 8,  # message_count=15 → Ask Q8 (Mobile Framework)
        17: 9,  # message_count=17 → Ask Q9 (Project Modules) - PROMPT #81
        19: 10, # message_count=19 → Ask Q10 (Vision & Problem)
        21: 11, # message_count=21 → Ask Q11 (Main Features)
        23: 12, # message_count=23 → Ask Q12 (User Roles)
        25: 13, # message_count=25 → Ask Q13 (Business Rules)
        27: 14, # message_count=27 → Ask Q14 (Data & Entities)
        29: 15, # message_count=29 → Ask Q15 (Success Criteria)
        31: 16, # message_count=31 → Ask Q16 (Technical Constraints)
        33: 17, # message_count=33 → Ask Q17 (MVP Scope)
        35: 18, # message_count=35 → Ask Q18 (Focus Topics Selection) - PROMPT #77
    }

    # Fixed meta prompt questions (Q1-Q18)
    if message_count in question_map:
        return _handle_fixed_question_meta(
            interview, project, message_count,
            question_map, db, get_fixed_question_meta_prompt_func
        )

    # After Q18: Extract focus topics from user's answer
    # PROMPT #97 FIX - User answers Q18 at message_count=36 (not 37)
    elif message_count == 36:
        # User just answered Q18 (topic selection)
        # Extract topics and save them
        user_answer = interview.conversation_data[-1]["content"]
        focus_topics = _extract_focus_topics(user_answer)

        logger.info(f"Extracted focus_topics: {focus_topics}")
        interview.focus_topics = focus_topics

        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(interview, "focus_topics")
        db.commit()

        # Continue to AI contextual questions
        return await _handle_ai_meta_contextual_question(
            interview, project, message_count, focus_topics,
            project_context, db,
            clean_ai_response_func, prepare_context_func
        )

    # AI contextual questions (Q19+) - guided by selected topics
    # PROMPT #97 FIX - AI questions start at message_count=37 (not 38)
    elif message_count >= 37:
        focus_topics = interview.focus_topics or []
        return await _handle_ai_meta_contextual_question(
            interview, project, message_count, focus_topics,
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


def _extract_focus_topics(user_answer: str) -> list:
    """
    Extract focus topics from user's answer to Q9.
    PROMPT #77 - Meta Prompt Topic Selection

    The answer might be:
    - A JSON array: ["business_rules", "design_ux", "security"]
    - Text with topic IDs separated by commas: "business_rules, design_ux, security"
    - Text with topic labels: "Regras de Negócio, Design e UX/UI"

    Returns list of topic IDs.
    """
    import json
    import re

    # Try to parse as JSON array
    try:
        topics = json.loads(user_answer)
        if isinstance(topics, list):
            return topics
    except (json.JSONDecodeError, TypeError):
        pass

    # Try to extract topic IDs from text
    # Look for known topic IDs in the answer
    known_topics = [
        "business_rules",
        "design_ux",
        "architecture",
        "security",
        "performance",
        "integrations",
        "workflows",
        "data_model",
        "deployment",
        "testing"
    ]

    found_topics = []
    answer_lower = user_answer.lower()

    for topic in known_topics:
        if topic in answer_lower:
            found_topics.append(topic)

    # If no topics found by ID, try by keywords
    if not found_topics:
        keyword_map = {
            "negócio": "business_rules",
            "regra": "business_rules",
            "design": "design_ux",
            "ux": "design_ux",
            "ui": "design_ux",
            "interface": "design_ux",
            "arquitetura": "architecture",
            "conceito": "architecture",
            "segurança": "security",
            "seguranca": "security",
            "performance": "performance",
            "escalabilidade": "performance",
            "integração": "integrations",
            "integracao": "integrations",
            "api": "integrations",
            "workflow": "workflows",
            "processo": "workflows",
            "fluxo": "workflows",
            "dados": "data_model",
            "entidade": "data_model",
            "modelo": "data_model",
            "deploy": "deployment",
            "infraestrutura": "deployment",
            "teste": "testing",
            "qualidade": "testing"
        }

        for keyword, topic in keyword_map.items():
            if keyword in answer_lower and topic not in found_topics:
                found_topics.append(topic)

    logger.info(f"Extracted {len(found_topics)} topics from answer: {found_topics}")
    return found_topics


def _handle_fixed_question_meta(
    interview: Interview,
    project: Project,
    message_count: int,
    question_map: dict,
    db: Session,
    get_fixed_question_meta_prompt_func
) -> Dict[str, Any]:
    """Handle fixed meta prompt questions (Q1-Q9)."""
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


async def _handle_ai_orchestrator_contextual_question(
    interview: Interview,
    project: Project,
    message_count: int,
    previous_answers: dict,
    db: Session,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """Handle AI-generated contextual questions in orchestrator interview mode.

    PROMPT #91/94 - Orchestrator Interview Mode
    """
    logger.info(f"Using AI for orchestrator contextual question (message_count={message_count})")

    # Build context from previous answers
    title = previous_answers.get('q1', project.name or '')
    description = previous_answers.get('q2', project.description or '')
    system_type = previous_answers.get('system_type', 'api_frontend')

    # Extract stack choices from Q4-Q8
    stack_backend = previous_answers.get('q4', project.stack_backend or '')
    stack_database = previous_answers.get('q5', project.stack_database or '')
    stack_frontend = previous_answers.get('q6', project.stack_frontend or '')
    stack_css = previous_answers.get('q7', project.stack_css or '')
    stack_mobile = previous_answers.get('q8', project.stack_mobile or '')

    # Build rich context
    context = f"""
**INFORMAÇÕES DO PROJETO:**
- Título: {title}
- Descrição: {description}
- Tipo de Sistema: {system_type}
- Stack Backend: {stack_backend}
- Stack Database: {stack_database}"""

    if stack_frontend:
        context += f"\n- Stack Frontend: {stack_frontend}"
    if stack_css:
        context += f"\n- Stack CSS: {stack_css}"
    if stack_mobile:
        context += f"\n- Stack Mobile: {stack_mobile}"

    # PROMPT #94 FASE 3 - Determine which specialized sections to apply
    # Business: ALWAYS (all projects have business rules)
    # Design: If stack_frontend OR stack_css exists
    # Mobile: If stack_mobile exists
    has_design_section = bool(stack_frontend or stack_css)
    has_mobile_section = bool(stack_mobile)

    # Calculate question number for section prompts
    question_num = (message_count // 2) + 1

    # PROMPT #94 FASE 3 - Import specialized section builders
    from .interviews.context_builders import (
        build_business_section_prompt,
        build_design_section_prompt,
        build_mobile_section_prompt
    )

    # Determine which section we're currently in based on question count
    # Rough estimation: Q9-Q14 = Business, Q15-Q19 = Design (if applicable), Q20+ = Mobile (if applicable)
    # This is a simple heuristic - in practice, sections flow naturally

    # Build specialized section prompt based on context
    # For now, we'll include all applicable sections and let AI naturally progress through them
    specialized_sections = ""

    # Always include Business section
    specialized_sections += "\n" + build_business_section_prompt(project, question_num)

    # Include Design section if applicable
    if has_design_section:
        specialized_sections += "\n\n---\n" + build_design_section_prompt(project, question_num)

    # Include Mobile section if applicable
    if has_mobile_section:
        specialized_sections += "\n\n---\n" + build_mobile_section_prompt(project, question_num)

    # Build system prompt with specialized sections
    system_prompt = f"""Você é um analista de requisitos experiente conduzindo uma entrevista para um projeto de software.

{context}

**ESTRUTURA DA ENTREVISTA (PROMPT #94 FASE 3):**

Você completou as perguntas fixas (Q1-Q8) sobre projeto e stack.
Agora entramos nas **SEÇÕES ESPECIALIZADAS** de perguntas contextuais.

**Seções disponíveis nesta entrevista:**
1. ✅ **BUSINESS** - Regras de negócio (SEMPRE aplicada)
{'2. ✅ **DESIGN** - UX/UI e Design Visual (aplicada pois projeto tem frontend/CSS)' if has_design_section else ''}
{'3. ✅ **MOBILE** - Desenvolvimento Mobile (aplicada pois projeto tem mobile)' if has_mobile_section else ''}

**INSTRUÇÕES PARA CONDUÇÃO:**

1. **Progrida naturalmente através das seções** na ordem acima
2. **Comece com Business** (regras de negócio, validações, fluxos)
3. **Depois vá para Design** (se aplicável - UX/UI, layout, componentes)
4. **Finalize com Mobile** (se aplicável - navegação, recursos nativos)
5. **Não anuncie explicitamente "mudança de seção"** - apenas mude o foco das perguntas naturalmente
6. **Cada seção: 3-6 perguntas focadas** no tema
7. **Total da entrevista: 10-15 perguntas contextuais**

{specialized_sections}

**REGRAS GERAIS - SIGA EXATAMENTE:**
1. ❌ **NUNCA faça perguntas abertas** (texto livre)
2. ✅ **SEMPRE forneça opções** para o cliente escolher
3. ✅ **Use ESCOLHA ÚNICA (radio)** quando só pode haver UMA resposta
4. ✅ **Use MÚLTIPLA ESCOLHA (checkbox)** quando pode haver VÁRIAS respostas
5. ✅ Forneça sempre **3-5 opções relevantes** baseadas no contexto
6. ✅ **NUNCA REPITA** uma pergunta já feita
7. ✅ **INCREMENTE contexto** com cada resposta anterior
8. ✅ Analise todas as respostas anteriores antes de perguntar
9. ✅ Faça perguntas relevantes para a seção atual

Conduza em PORTUGUÊS. Continue com a próxima pergunta relevante da seção apropriada!

Após completar todas as seções aplicáveis (10-15 perguntas total), conclua a entrevista.
"""

    # Call AI Orchestrator
    return await _execute_ai_question(
        interview, project, system_prompt, db,
        clean_ai_response_func, prepare_context_func
    )


async def _handle_ai_meta_contextual_question(
    interview: Interview,
    project: Project,
    message_count: int,
    focus_topics: list,
    project_context: str,
    db: Session,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """Handle AI-generated contextual questions (Q10+) in meta prompt mode.

    PROMPT #84 - RAG Phase 2: Enhanced with domain knowledge retrieval
    """
    logger.info(f"Using AI for meta contextual question (message_count={message_count}, topics={focus_topics})")

    # PROMPT #84 - RAG Phase 2: Retrieve relevant domain knowledge
    rag_context = ""
    try:
        from app.services.rag_service import RAGService

        rag_service = RAGService(db)

        # Build query from project description + focus topics
        query_parts = [project.description or project.name]
        if focus_topics:
            query_parts.extend(focus_topics)
        query = " ".join(query_parts)

        # Retrieve domain templates (global knowledge, no project_id filter)
        domain_docs = rag_service.retrieve(
            query=query,
            filter={"type": "domain_template"},  # Only domain templates
            top_k=3,
            similarity_threshold=0.6
        )

        if domain_docs:
            rag_context = "\n**CONHECIMENTO DE DOMÍNIO RELEVANTE:**\n"
            rag_context += "Baseado em projetos similares, considere estes aspectos:\n\n"
            for i, doc in enumerate(domain_docs, 1):
                rag_context += f"{i}. {doc['content']}\n"
            rag_context += "\n**Use este conhecimento para fazer perguntas mais relevantes!**\n"

            logger.info(f"✅ RAG: Retrieved {len(domain_docs)} domain templates for contextual questions")

    except Exception as e:
        logger.warning(f"⚠️  RAG retrieval failed for contextual questions: {e}")

    # Build focus area text based on selected topics
    topic_labels = {
        "business_rules": "Regras de Negócio",
        "design_ux": "Design e UX/UI",
        "architecture": "Conceito e Arquitetura",
        "security": "Segurança",
        "performance": "Performance e Escalabilidade",
        "integrations": "Integrações",
        "workflows": "Workflows e Processos",
        "data_model": "Modelagem de Dados",
        "deployment": "Deploy e Infraestrutura",
        "testing": "Testes e Qualidade"
    }

    if focus_topics:
        focus_text = "\n**TÓPICOS SELECIONADOS PELO CLIENTE:**\n"
        focus_text += "O cliente quer aprofundar especialmente nestes aspectos:\n"
        for topic in focus_topics:
            label = topic_labels.get(topic, topic)
            focus_text += f"- {label}\n"
        focus_text += "\n**IMPORTANTE: Priorize suas perguntas contextuais nestes tópicos selecionados!**\n"
    else:
        focus_text = ""

    # Build system prompt for contextual clarification questions
    system_prompt = f"""Você é um Product Owner experiente conduzindo uma entrevista de Meta Prompt para definir um projeto completo.

**CONTEXTO DO PROJETO:**
{project_context}

{rag_context}

{focus_text}

**INFORMAÇÕES JÁ COLETADAS:**
Você já fez 17 perguntas fixas sobre:
1. Título do projeto
2. Descrição e objetivo
3. Framework de backend
4. Banco de dados
5. Framework de frontend
6. Framework CSS
7. Framework mobile
8. Módulos/componentes do projeto (Backend/API, Frontend Web, Mobile App, etc.)
9. Visão do projeto e problema a resolver
10. Principais funcionalidades (Auth, CRUD, Reports, etc.)
11. Perfis de usuários e permissões
12. Regras de negócio
13. Entidades/dados principais
14. Critérios de sucesso
15. Restrições técnicas
16. Escopo e prioridades do MVP
17. Tópicos que o cliente quer aprofundar

Analise as respostas anteriores e faça perguntas contextualizadas para:
- **ESCLARECER DETALHES** que ficaram vagos ou ambíguos
- **APROFUNDAR** em funcionalidades complexas mencionadas
- **DESCOBRIR DEPENDÊNCIAS** entre módulos/features
- **VALIDAR PREMISSAS** sobre escopo, usuários ou regras de negócio
- **IDENTIFICAR EDGE CASES** ou cenários especiais

**REGRAS CRÍTICAS - SIGA EXATAMENTE:**
1. ❌ **NUNCA faça perguntas abertas** (texto livre)
2. ✅ **SEMPRE forneça opções** para o cliente escolher
3. ✅ **Use ESCOLHA ÚNICA (radio)** quando só pode haver UMA resposta
   - Exemplos: "Qual arquitetura?" / "Como será o deploy?" / "Qual método de pagamento?"
4. ✅ **Use MÚLTIPLA ESCOLHA (checkbox)** quando pode haver VÁRIAS respostas
   - Exemplos: "Quais integrações?" / "Quais tipos de relatório?" / "Quais notificações?"
5. ✅ Forneça sempre **3-5 opções relevantes** baseadas no contexto do projeto
6. ✅ Analise bem as respostas anteriores antes de perguntar
7. ✅ Não fuja do conceito que o cliente quer
8. ✅ Faça 1 pergunta por vez, contextualizada e específica

**FORMATO OBRIGATÓRIO:**

Para ESCOLHA ÚNICA (quando só pode haver 1 resposta):
❓ Pergunta [número]: [Sua pergunta]

○ Opção 1
○ Opção 2
○ Opção 3
○ Opção 4

Escolha UMA opção.

Para MÚLTIPLA ESCOLHA (quando pode haver várias respostas):
❓ Pergunta [número]: [Sua pergunta]

☐ Opção 1
☐ Opção 2
☐ Opção 3
☐ Opção 4

☑️ Selecione todas que se aplicam.

**EXEMPLOS CORRETOS:**

✅ BOM (Escolha única - só pode haver 1 arquitetura):
❓ Pergunta 17: Qual arquitetura você pretende usar para o backend?

○ Arquitetura em camadas (MVC)
○ Clean Architecture (DDD)
○ Arquitetura monolítica simples
○ Microserviços

Escolha UMA opção.

✅ BOM (Múltipla escolha - pode ter várias integrações):
❓ Pergunta 18: Quais integrações externas o sistema precisará?

☐ Gateway de pagamento (Stripe, PagSeguro, etc.)
☐ Serviço de e-mail (SendGrid, AWS SES)
☐ Armazenamento de arquivos (AWS S3, Google Cloud Storage)
☐ API de geolocalização
☐ Serviço de SMS

☑️ Selecione todas que se aplicam.

❌ ERRADO (pergunta aberta - NUNCA FAÇA ISSO):
❓ Pergunta 17: Descreva a arquitetura que você pretende usar.
💬 Digite sua resposta aqui.

**Conduza em PORTUGUÊS.** Continue com a próxima pergunta relevante!

Após 3-5 perguntas contextuais (total ~20-22 perguntas), conclua a entrevista informando que o projeto será gerado.
"""

    # Call AI Orchestrator
    return await _execute_ai_question(
        interview, project, system_prompt, db,
        clean_ai_response_func, prepare_context_func
    )


async def handle_subtask_focused_interview(
    interview: Interview,
    project: Project,
    message_count: int,
    db: Session,
    build_subtask_focused_prompt_func,
    clean_ai_response_func,
    prepare_context_func,
    parent_task = None
) -> Dict[str, Any]:
    """
    Handle SUBTASK-FOCUSED interview mode (PROMPT #94 FASE 2).

    This mode generates ATOMIC subtasks (1 action = 1 prompt super rápido).
    NO fixed questions - AI starts immediately at Q1.
    AI decides how many questions to ask (no fixed limit, just good sense).

    Flow:
    - Q1+: AI contextual questions from the start
    - Focus on maximum decomposition (atomic subtasks)
    - Each subtask = 1 executable action in minutes, not hours

    Output: Multiple atomic subtasks (prompts super rápidos)

    Args:
        interview: Interview instance
        project: Project instance
        message_count: Current message count
        db: Database session
        build_subtask_focused_prompt_func: Function to build subtask-focused prompt
        clean_ai_response_func: Function to clean AI responses
        prepare_context_func: Function to prepare interview context
        parent_task: Optional parent task for context

    Returns:
        Response dict with success, message, and usage
    """
    logger.info(f"🎯 SUBTASK-FOCUSED MODE - message_count={message_count}")

    # Extract previous answers
    previous_answers = {}
    for i, msg in enumerate(interview.conversation_data):
        if msg.get('role') == 'user':
            question_num = (i + 1) // 2
            previous_answers[f'q{question_num}'] = msg.get('content', '')

    # No fixed questions in subtask_focused mode
    # AI questions start immediately at Q1 (message_count >= 2)
    if message_count >= 2:
        return await _handle_ai_subtask_focused_question(
            interview, project, message_count, parent_task,
            previous_answers, db, build_subtask_focused_prompt_func,
            clean_ai_response_func, prepare_context_func
        )
    else:
        # Unexpected state
        logger.error(f"Unexpected message_count={message_count} in subtask-focused mode")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected interview state (message_count={message_count})"
        )


async def _handle_ai_subtask_focused_question(
    interview: Interview,
    project: Project,
    message_count: int,
    parent_task,
    previous_answers: Dict[str, Any],
    db: Session,
    build_subtask_focused_prompt_func,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """
    Handle AI-generated questions for subtask-focused interviews.

    PROMPT #94 FASE 2 - Atomic subtask decomposition:
    - AI decides how many questions (no fixed limit)
    - Focus on generating atomic subtasks (1 action per subtask)
    - Each subtask should be executable in minutes

    Args:
        interview: Interview instance
        project: Project instance
        message_count: Current message count
        parent_task: Parent task for context
        previous_answers: Dict of previous answers
        db: Database session
        build_subtask_focused_prompt_func: Function to build prompt
        clean_ai_response_func: Function to clean AI responses
        prepare_context_func: Function to prepare interview context

    Returns:
        Response dict with success, message, and usage
    """
    logger.info(f"Using AI for subtask decomposition question (message_count={message_count})")

    # Check if PrompterFacade is available
    use_prompter = (
        PROMPTER_AVAILABLE and
        os.getenv("PROMPTER_USE_TEMPLATES", "false").lower() == "true"
    )

    # Generate system prompt for atomic subtask decomposition
    if use_prompter:
        try:
            prompter = PrompterFacade(db)
            question_num = (message_count // 2) + 1
            system_prompt = prompter.generate_interview_question(
                project=project,
                interview_type="subtask_focused",
                question_number=question_num,
                context={
                    "parent_task": parent_task.title if parent_task else None,
                    "previous_answers": previous_answers
                }
            )
            logger.info("✅ Using PrompterFacade for subtask_focused question generation")
        except Exception as e:
            logger.warning(f"⚠️ PrompterFacade failed: {e}, falling back to direct prompt")
            use_prompter = False

    if not use_prompter:
        # Fallback: Use direct prompt building
        system_prompt = build_subtask_focused_prompt_func(
            project=project,
            parent_task=parent_task,
            message_count=message_count,
            previous_answers=previous_answers
        )

    # Call AI Orchestrator
    return await _execute_ai_question(
        interview, project, system_prompt, db,
        clean_ai_response_func, prepare_context_func
    )

async def handle_task_orchestrated_interview(
    interview: Interview,
    project: Project,
    message_count: int,
    db: Session,
    get_task_orchestrated_fixed_question_func,
    count_fixed_questions_task_orchestrated_func,
    is_fixed_question_complete_task_orchestrated_func,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """
    Handle TASK_ORCHESTRATED interview mode (PROMPT #97 - Tasks within Stories).

    This mode is for creating individual TASKS within a Story.
    Same layout as orchestrator: Q1 (Title) + Q2 (Description) + AI contextual.

    Flow:
    - Q1-Q2: Basic info (title, description)
    - Q3+: AI contextual questions (based on Epic + Story + Task context)

    Args:
        interview: Interview instance
        project: Project instance
        message_count: Current message count
        db: Database session
        get_task_orchestrated_fixed_question_func: Function to get task_orchestrated fixed questions
        count_fixed_questions_task_orchestrated_func: Function to count total fixed questions
        is_fixed_question_complete_task_orchestrated_func: Function to check if fixed phase is complete
        clean_ai_response_func: Function to clean AI responses
        prepare_context_func: Function to prepare interview context

    Returns:
        Response dict with success, message, and usage
    """
    logger.info(f"🎯 TASK_ORCHESTRATED MODE - message_count={message_count}")

    previous_answers = {}

    # Extract previous answers from conversation
    for i, msg in enumerate(interview.conversation_data):
        if msg.get('role') == 'user':
            question_num = (i + 1) // 2
            previous_answers[f'q{question_num}'] = msg.get('content', '')

    # Calculate current question number
    question_number = (message_count // 2) + 1

    # Task orchestrated always has 2 fixed questions
    total_fixed = count_fixed_questions_task_orchestrated_func()
    in_fixed_phase = question_number <= total_fixed

    if in_fixed_phase:
        # Fixed question phase
        logger.info(f"Returning fixed Question {question_number}")

        assistant_message = get_task_orchestrated_fixed_question_func(
            question_number=question_number,
            project=project,
            db=db,
            previous_answers=previous_answers
        )

        if not assistant_message:
            # No more fixed questions - move to AI phase
            logger.info(f"No fixed question {question_number} (moving to AI contextual)")
            return await _handle_ai_orchestrator_contextual_question(
                interview, project, message_count,
                previous_answers, db,
                clean_ai_response_func, prepare_context_func
            )

        # Add fixed question to conversation
        interview.conversation_data.append(assistant_message)

        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(interview, "conversation_data")
        db.commit()
        db.refresh(interview)

        return {
            "success": True,
            "message": assistant_message,
            "usage": {
                "model": "system/fixed-question-task-orchestrated",
                "input_tokens": 0,
                "output_tokens": 0,
                "total_cost_usd": 0.0
            }
        }

    else:
        # AI contextual questions phase
        return await _handle_ai_orchestrator_contextual_question(
            interview, project, message_count,
            previous_answers, db,
            clean_ai_response_func, prepare_context_func
        )


async def handle_subtask_orchestrated_interview(
    interview: Interview,
    project: Project,
    message_count: int,
    db: Session,
    get_subtask_orchestrated_fixed_question_func,
    count_fixed_questions_subtask_orchestrated_func,
    is_fixed_question_complete_subtask_orchestrated_func,
    clean_ai_response_func,
    prepare_context_func
) -> Dict[str, Any]:
    """
    Handle SUBTASK_ORCHESTRATED interview mode (PROMPT #97 - Subtasks within Tasks).

    This mode is for creating individual SUBTASKS within a Task.
    Same layout as orchestrator: Q1 (Title) + Q2 (Description) + AI contextual.

    Flow:
    - Q1-Q2: Basic info (title, description)
    - Q3+: AI contextual questions (based on Epic + Story + Task + Subtask context)

    Args:
        interview: Interview instance
        project: Project instance
        message_count: Current message count
        db: Database session
        get_subtask_orchestrated_fixed_question_func: Function to get subtask_orchestrated fixed questions
        count_fixed_questions_subtask_orchestrated_func: Function to count total fixed questions
        is_fixed_question_complete_subtask_orchestrated_func: Function to check if fixed phase is complete
        clean_ai_response_func: Function to clean AI responses
        prepare_context_func: Function to prepare interview context

    Returns:
        Response dict with success, message, and usage
    """
    logger.info(f"🎯 SUBTASK_ORCHESTRATED MODE - message_count={message_count}")

    previous_answers = {}

    # Extract previous answers from conversation
    for i, msg in enumerate(interview.conversation_data):
        if msg.get('role') == 'user':
            question_num = (i + 1) // 2
            previous_answers[f'q{question_num}'] = msg.get('content', '')

    # Calculate current question number
    question_number = (message_count // 2) + 1

    # Subtask orchestrated always has 2 fixed questions
    total_fixed = count_fixed_questions_subtask_orchestrated_func()
    in_fixed_phase = question_number <= total_fixed

    if in_fixed_phase:
        # Fixed question phase
        logger.info(f"Returning fixed Question {question_number}")

        assistant_message = get_subtask_orchestrated_fixed_question_func(
            question_number=question_number,
            project=project,
            db=db,
            previous_answers=previous_answers
        )

        if not assistant_message:
            # No more fixed questions - move to AI phase
            logger.info(f"No fixed question {question_number} (moving to AI contextual)")
            return await _handle_ai_orchestrator_contextual_question(
                interview, project, message_count,
                previous_answers, db,
                clean_ai_response_func, prepare_context_func
            )

        # Add fixed question to conversation
        interview.conversation_data.append(assistant_message)

        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(interview, "conversation_data")
        db.commit()
        db.refresh(interview)

        return {
            "success": True,
            "message": assistant_message,
            "usage": {
                "model": "system/fixed-question-subtask-orchestrated",
                "input_tokens": 0,
                "output_tokens": 0,
                "total_cost_usd": 0.0
            }
        }

    else:
        # AI contextual questions phase
        return await _handle_ai_orchestrator_contextual_question(
            interview, project, message_count,
            previous_answers, db,
            clean_ai_response_func, prepare_context_func
        )
