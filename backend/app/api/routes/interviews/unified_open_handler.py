"""
Unified Open-Ended Interview Handler
PROMPT #78 - Unified Open-Ended Interview System

All interviews now use the same open-ended question format:
- Questions are open-ended (like GPT), not fixed
- AI generates questions freely based on context
- Response options are SUGGESTIONS, not requirements
- User can respond freely with text or click suggestions

This replaces all the fixed question modes (meta_prompt, requirements, task_focused, etc.)
"""

from typing import Dict, Any, Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from fastapi import HTTPException, status
import logging

from app.models.interview import Interview
from app.models.project import Project
from app.models.task import Task
from app.services.ai_orchestrator import AIOrchestrator
from app.services.interview_question_deduplicator import InterviewQuestionDeduplicator
# PROMPT #103 - External prompts support
from app.prompts import get_prompt_service
from app.prompts.loader import PromptLoader
from app.api.routes.interviews.option_parser import parse_ai_question_options, analyze_and_convert_choice_type
from app.services.interview_query_classifier import classify_interview_query
from app.api.routes.interviews.response_cleaners import clean_ai_response
# PROMPT #89: Context Interview fixed questions
from app.api.routes.interviews.context_questions import (
    get_context_fixed_question,
    count_fixed_questions_context,
    is_fixed_question_complete_context,
    get_context_ai_prompt,
    should_end_context_interview
)
# PROMPT #82: prepare_interview_context NO LONGER used for interviews (full context always sent)

logger = logging.getLogger(__name__)


def build_unified_open_prompt(
    project: Project,
    interview: Interview,
    message_count: int,
    parent_task: Optional[Task] = None,
    previous_answers: Optional[Dict] = None,
    db: Optional[Session] = None  # PROMPT #132 - For hierarchy loading
) -> str:
    """
    Build the system prompt for unified open-ended interviews.

    PROMPT #78 - Unified Open-Ended Interview System
    PROMPT #109 - Now uses PromptLoader to load from YAML (follows CLAUDE.md rule)
    PROMPT #132 - Enhanced to include full hierarchy context

    Key principles:
    1. Questions are OPEN-ENDED (like GPT)
    2. User can respond FREELY
    3. AI can offer SUGGESTIONS (optional)
    4. No fixed questions - AI decides what to ask

    Args:
        project: Project instance
        interview: Interview instance
        message_count: Current message count
        parent_task: Optional parent task for hierarchical interviews
        previous_answers: Dict of previous answers
        db: Database session for hierarchy loading (PROMPT #132)

    Returns:
        System prompt string
    """
    previous_answers = previous_answers or {}
    question_number = (message_count // 2) + 1

    # PROMPT #195 - Card-focused interviews use specialized prompts
    # When interview_mode is "card_focused", use build_card_focused_prompt
    # which includes motivation type, card details, and hierarchy-aware context
    if interview.interview_mode == "card_focused" and parent_task:
        from app.api.routes.interviews.card_focused_prompts import (
            build_card_focused_prompt, get_card_hierarchy
        )

        # Extract motivation_type, card title, card description from Q1-Q3 answers
        motivation_type = "feature"  # default
        card_title = ""
        card_description = ""
        user_answers = [
            msg.get('content', '')
            for msg in interview.conversation_data
            if msg.get('role') == 'user'
        ]
        if len(user_answers) >= 1:
            motivation_type = user_answers[0].lower()
        if len(user_answers) >= 2:
            card_title = user_answers[1]
        if len(user_answers) >= 3:
            card_description = user_answers[2]

        # Build stack context
        stack_context = ""
        if project.stack_backend:
            stack_context = f"""
STACK TÉCNICA:
- Backend: {project.stack_backend}
- Database: {project.stack_database or 'Não definido'}
- Frontend: {project.stack_frontend or 'Não definido'}
- CSS: {project.stack_css or 'Não definido'}
- Mobile: {project.stack_mobile or 'Não definido'}
"""

        # Get full hierarchy
        hierarchy = get_card_hierarchy(parent_task, db) if db else []

        logger.info(f"🎯 Card-focused prompt: motivation={motivation_type}, title={card_title[:50]}, parent={parent_task.title[:50]}")

        return build_card_focused_prompt(
            project=project,
            motivation_type=motivation_type,
            card_title=card_title,
            card_description=card_description,
            message_count=message_count,
            parent_card=parent_task,
            stack_context=stack_context,
            current_card=parent_task,  # PROMPT #198 - Full card for rich context
            hierarchy=hierarchy if hierarchy else None
        )

    # Build project context (dynamic, passed to template)
    project_context = f"""
**PROJETO:**
- Nome: {project.name or 'Não definido'}
- Descrição: {project.description or 'Não definida'}
"""

    # Add stack context if available
    if project.stack_backend:
        project_context += f"""
**STACK TÉCNICA:**
- Backend: {project.stack_backend}
- Database: {project.stack_database or 'Não definido'}
- Frontend: {project.stack_frontend or 'Não definido'}
- CSS: {project.stack_css or 'Não definido'}
- Mobile: {project.stack_mobile or 'Não definido'}
"""

    # PROMPT #132 - Add full hierarchy context for hierarchical interviews
    parent_context = ""
    if parent_task:
        from app.api.routes.interviews.card_focused_prompts import get_card_hierarchy, build_hierarchy_context

        # Try to get full hierarchy
        hierarchy = get_card_hierarchy(parent_task, db) if db else []

        if hierarchy:
            # Full hierarchy available - use rich context
            parent_context = build_hierarchy_context(hierarchy)
        else:
            # Fallback to single parent
            parent_context = f"""
**CARD PAI:**
- Tipo: {parent_task.item_type or 'Task'}
- Título: {parent_task.title}
- Descrição: {parent_task.description or 'Não definida'}
"""

    # PROMPT #109 - Load from YAML (no hardcoded prompts - follows CLAUDE.md rule)
    loader = PromptLoader()
    system_prompt, _ = loader.render(
        "interviews/unified_open",
        {
            "project_context": project_context,
            "question_number": question_number,
            "parent_context": parent_context
        }
    )

    return system_prompt


async def handle_unified_open_interview(
    interview: Interview,
    project: Project,
    message_count: int,
    db: Session,
    parent_task: Optional[Task] = None
) -> Dict[str, Any]:
    """
    Handle unified open-ended interview.

    PROMPT #78 - Unified Open-Ended Interview System
    PROMPT #90 - Context Interview uses fixed questions Q1-Q3

    This replaces all fixed question handlers with a single AI-driven flow.
    Exception: Context interviews use fixed Q1-Q3 from context_questions.py

    Args:
        interview: Interview instance
        project: Project instance
        message_count: Current message count
        db: Database session
        parent_task: Optional parent task for hierarchical interviews

    Returns:
        Response dict with success, message, and usage
    """
    logger.info(f"🌟 UNIFIED OPEN-ENDED MODE - message_count={message_count}, interview_mode={interview.interview_mode}")

    # PROMPT #90 - Context Interview uses fixed questions Q1-Q3
    if interview.interview_mode == "context":
        # Calculate question number (user message = answer to previous question)
        question_number = (message_count // 2) + 1

        # PROMPT #233 - LI-1 fix: pass project to enable memory context optimization (PROMPT #118)
        logger.info(f"📋 Context Interview - question_number={question_number}, fixed_count={count_fixed_questions_context(project)}")

        # Check if we're still in fixed questions phase (Q1-Q3)
        if question_number <= count_fixed_questions_context(project):
            fixed_question = get_context_fixed_question(question_number, project, db)
            if fixed_question:
                # Append to conversation
                interview.conversation_data.append(fixed_question)
                flag_modified(interview, "conversation_data")
                interview.ai_model_used = "system/fixed-question-context"

                db.commit()
                db.refresh(interview)

                logger.info(f"✅ Context Interview: Returning FIXED Q{question_number}")

                return {
                    "success": True,
                    "message": fixed_question,
                    "usage": {"fixed_question": True}
                }

        # Check if interview should end
        if should_end_context_interview(interview.conversation_data):
            logger.info(f"✅ Context Interview complete - generating summary")
            # Return completion message
            completion_message = {
                "role": "assistant",
                "content": (
                    "✅ **Entrevista de Contexto Completa!**\n\n"
                    "Coletei todas as informações necessárias para estabelecer o contexto do projeto.\n\n"
                    "Clique em **'Gerar Contexto'** para processar as informações e criar o contexto do projeto."
                ),
                "timestamp": datetime.utcnow().isoformat(),
                "model": "system/context-complete",
                "question_type": "completion",
                "is_complete": True
            }

            interview.conversation_data.append(completion_message)
            flag_modified(interview, "conversation_data")

            db.commit()
            db.refresh(interview)

            return {
                "success": True,
                "message": completion_message,
                "usage": {"context_complete": True}
            }

        # After fixed questions, use AI to generate contextual questions
        logger.info(f"📋 Context Interview - generating AI contextual question (Q{question_number})")

        # PROMPT #118 FIX - Use get_context_ai_prompt() which includes initial_memory_context
        # This ensures the AI has the rich context from codebase scan
        system_prompt = get_context_ai_prompt(interview.conversation_data, project)
        logger.info(f"📋 Context Interview - using context AI prompt with memory_context")

    # PROMPT #217 - Card-focused Interview uses fixed questions Q1-Q3
    elif interview.interview_mode == "card_focused":
        from app.api.routes.interviews.card_focused_questions import (
            get_card_focused_fixed_question,
            count_fixed_questions_card_focused
        )

        question_number = (message_count // 2) + 1
        total_fixed = count_fixed_questions_card_focused()

        logger.info(f"📋 Card-Focused Interview - question_number={question_number}, fixed_count={total_fixed}")

        # Check if we're still in fixed questions phase (Q1-Q3)
        if question_number <= total_fixed:
            # Extract previous answers for context
            previous_answers = {}
            for i, msg in enumerate(interview.conversation_data):
                if msg.get('role') == 'user':
                    q_num = (i + 1) // 2
                    previous_answers[f'question_{q_num}'] = msg.get('content', '')

            fixed_question = get_card_focused_fixed_question(
                question_number=question_number,
                project=project,
                db=db,
                parent_card=parent_task,
                previous_answers=previous_answers
            )
            if fixed_question:
                # Store motivation type from Q1 answer
                if question_number == 2:
                    # Q1 answer is the SECOND user message (index 1)
                    # Index 0 is the initial user message that started the interview
                    user_answers = [
                        msg.get('content', '')
                        for msg in interview.conversation_data
                        if msg.get('role') == 'user'
                    ]
                    if len(user_answers) >= 2:
                        interview.motivation_type = user_answers[1].lower()[:50]
                    elif user_answers:
                        interview.motivation_type = user_answers[0].lower()[:50]

                interview.conversation_data.append(fixed_question)
                flag_modified(interview, "conversation_data")
                interview.ai_model_used = "system/fixed-question-card-focused"

                db.commit()
                db.refresh(interview)

                logger.info(f"✅ Card-Focused Interview: Returning FIXED Q{question_number}")

                return {
                    "success": True,
                    "message": fixed_question,
                    "usage": {"fixed_question": True}
                }

        # After fixed questions (Q4+), use AI with card-focused context
        logger.info(f"📋 Card-Focused Interview - generating AI contextual question (Q{question_number})")

        # Extract previous answers
        previous_answers = {}
        for i, msg in enumerate(interview.conversation_data):
            if msg.get('role') == 'user':
                q_num = (i + 1) // 2
                previous_answers[f'q{q_num}'] = msg.get('content', '')

        # Build system prompt (delegates to build_card_focused_prompt)
        system_prompt = build_unified_open_prompt(
            project=project,
            interview=interview,
            message_count=message_count,
            parent_task=parent_task,
            previous_answers=previous_answers,
            db=db
        )

    else:
        # Non-context, non-card-focused interviews use the unified open prompt
        # Extract previous answers from conversation
        previous_answers = {}
        for i, msg in enumerate(interview.conversation_data):
            if msg.get('role') == 'user':
                question_num = (i + 1) // 2
                previous_answers[f'q{question_num}'] = msg.get('content', '')

        # Build system prompt
        system_prompt = build_unified_open_prompt(
            project=project,
            interview=interview,
            message_count=message_count,
            parent_task=parent_task,
            previous_answers=previous_answers,
            db=db  # PROMPT #132 - Pass db for hierarchy loading
        )

    # PROMPT #82 - Retrieve previous questions from RAG for deduplication (IMPROVED)
    previous_questions_context = ""
    try:
        from app.services.rag_service import RAGService

        rag_service = RAGService(db)

        # PROMPT #82 - Build semantic query from interview context (not empty!)
        interview_context_query = f"""Projeto: {project.name}
Descrição: {project.description}
Progresso: {len(interview.conversation_data) // 2} perguntas feitas"""

        previous_questions = rag_service.retrieve(
            query=interview_context_query,  # ✅ Semantic context!
            filter={
                "type": "interview_question",
                "project_id": str(project.id)
            },
            top_k=10,  # ✅ Reduced from 30 to 10
            similarity_threshold=0.0  # ✅ No threshold (already filtered by project_id)
        )

        if previous_questions:
            # PROMPT #82 - Use XML tags and FULL questions (not truncated!)
            previous_questions_context = """

<previous_questions>
⚠️ CRÍTICO: As perguntas abaixo JÁ FORAM FEITAS neste projeto.
NÃO REPITA estas perguntas nem perguntas muito similares!

"""
            for i, pq in enumerate(previous_questions[:10], 1):
                # Show FULL question (no truncation to 80 chars)
                question_content = pq.get('content', '[NO CONTENT]')
                previous_questions_context += f"{i}. {question_content}\n\n"

            previous_questions_context += """</previous_questions>

Gere uma pergunta DIFERENTE das acima.
"""

            logger.info(f"✅ RAG: Retrieved {len(previous_questions)} previous questions for deduplication")

    except Exception as e:
        logger.warning(f"⚠️  RAG retrieval failed: {e}")

    # PROMPT #82 - Insert RAG context at BEGINNING of system_prompt (high prominence)
    if previous_questions_context:
        logger.info(f"📋 RAG context added to system_prompt ({len(previous_questions_context)} chars)")
        system_prompt = previous_questions_context + "\n\n" + system_prompt

    # PROMPT #82 - INTERVIEWS: Always send FULL context (no summarization)
    # Interviews are short (~15-20 questions = ~40 messages)
    # Cost increase is minimal, context quality is critical to avoid question repetition
    messages = [
        {"role": msg["role"], "content": msg["content"]}
        for msg in interview.conversation_data
    ]

    logger.info(f"📝 Interview context: {len(messages)} messages, system_prompt: {len(system_prompt)} chars")

    # Call AI Orchestrator
    # PROMPT #82 - Disable cache for interviews to avoid question repetition
    # Each interview question MUST be unique, cache returns same response causing repetition
    orchestrator = AIOrchestrator(db, enable_cache=False)

    try:
        # PROMPT #231 - Classify the last user message to route to appropriate model tier
        last_user_msg = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                last_user_msg = msg.get("content", "")
                break
        _classification = classify_interview_query(
            question_text=last_user_msg,
            options=None,
            conversation_history_length=len(messages),
        )

        response = await orchestrator.execute(
            usage_type="interview",
            messages=messages,  # PROMPT #82 - Full context (not summarized)
            system_prompt=system_prompt,
            max_tokens=2000,  # PROMPT #149 - Increased to 2000 to ensure 5-8 options always fit
            project_id=interview.project_id,
            interview_id=interview.id,
            enable_rag=True,  # PROMPT #124 - Enable RAG for interviews
            metadata={"query_classification": _classification},  # PROMPT #231
        )

        # Clean response
        cleaned_content = clean_ai_response(response["content"])

        # PROMPT #125 - Use AI to analyze and determine correct choice type (single vs multiple)
        analyzed_content = await analyze_and_convert_choice_type(cleaned_content, db)

        # Parse for structured options (optional - for suggestion clicks)
        parsed_content, parsed_options = parse_ai_question_options(analyzed_content)

        # Build assistant message
        question_number = (message_count // 2) + 1

        # Determine question type based on parsed options
        if parsed_options:
            # Has options - use single_choice or multiple_choice from parser
            question_type = parsed_options.get("question_type", "single_choice")
            assistant_message = {
                "role": "assistant",
                "content": parsed_content,
                "timestamp": datetime.utcnow().isoformat(),
                "model": f"{response['provider']}/{response['model']}",
                "question_number": question_number,
                "question_type": question_type,
                "options": parsed_options.get("options", {}),
                "allow_custom_response": True  # PROMPT #79 - User can type freely OR click options
            }
        else:
            # No options - pure open-ended question
            assistant_message = {
                "role": "assistant",
                "content": parsed_content,
                "timestamp": datetime.utcnow().isoformat(),
                "model": f"{response['provider']}/{response['model']}",
                "question_number": question_number,
                "question_type": "text"  # Pure text input
            }

        # Append to conversation
        interview.conversation_data.append(assistant_message)
        flag_modified(interview, "conversation_data")
        interview.ai_model_used = response["model"]

        db.commit()
        db.refresh(interview)

        # Store question in RAG for deduplication
        try:
            deduplicator = InterviewQuestionDeduplicator(db)
            deduplicator.store_question(
                project_id=project.id,
                interview_id=interview.id,
                interview_mode=interview.interview_mode,
                question_text=parsed_content,
                question_number=question_number,
                is_fixed=False
            )
            logger.info(f"✅ Stored Q{question_number} in RAG")
        except Exception as e:
            logger.error(f"❌ Failed to store question in RAG: {e}")

        logger.info(f"✅ AI responded successfully with open-ended question Q{question_number}")

        return {
            "success": True,
            "message": assistant_message,
            "usage": response.get("usage", {})
        }

    except Exception as ai_error:
        logger.error(f"❌ AI execution failed: {str(ai_error)}", exc_info=True)

        # PROMPT #81 - Fallback: return a contextualized follow-up question
        question_number = (message_count // 2) + 1

        # Get last user response for context
        last_user_response = ""
        for msg in reversed(interview.conversation_data):
            if msg.get('role') == 'user':
                last_user_response = msg.get('content', '')[:100]
                break

        fallback_message = {
            "role": "assistant",
            "content": f"""📋 Continuando a entrevista para o projeto "{project.name}"...

❓ Pergunta {question_number}: Qual aspecto do projeto você gostaria de detalhar agora?

○ Requisitos técnicos e funcionais
○ Perfil dos usuários e permissões
○ Integrações com outros sistemas
○ Cronograma e prioridades

💬 Ou descreva com suas próprias palavras.""",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fallback",
            "question_number": question_number,
            "question_type": "single_choice",
            "options": {
                "type": "single",
                "choices": [
                    {"id": "requisitos", "label": "Requisitos técnicos e funcionais", "value": "requisitos"},
                    {"id": "usuários", "label": "Perfil dos usuários e permissões", "value": "usuários"},
                    {"id": "integracoes", "label": "Integrações com outros sistemas", "value": "integracoes"},
                    {"id": "cronograma", "label": "Cronograma e prioridades", "value": "cronograma"}
                ]
            },
            "allow_custom_response": True
        }

        # Save fallback message to conversation
        interview.conversation_data.append(fallback_message)
        flag_modified(interview, "conversation_data")
        interview.ai_model_used = "system/fallback"

        db.commit()
        db.refresh(interview)

        logger.warning(f"⚠️  Using fallback question Q{question_number} for interview {interview.id}")

        return {
            "success": True,
            "message": fallback_message,
            "usage": {"fallback": True, "error": str(ai_error)}
        }


async def generate_first_question(
    interview: Interview,
    project: Project,
    db: Session,
    parent_task: Optional[Task] = None
) -> Dict[str, Any]:
    """
    Generate the first question for an interview.

    PROMPT #78 - Unified Open-Ended Interview System
    PROMPT #90 - Context Interview uses fixed questions

    For context interviews (interview_mode="context"), uses fixed Q1 from context_questions.
    For other interviews, generates an AI open-ended question.

    Args:
        interview: Interview instance
        project: Project instance
        db: Database session
        parent_task: Optional parent task for hierarchical interviews

    Returns:
        First question message dict
    """
    logger.info(f"🌟 Generating FIRST question for interview {interview.id} (mode={interview.interview_mode})")

    # PROMPT #90 - Context Interview uses fixed questions
    if interview.interview_mode == "context":
        logger.info(f"📋 Using FIXED Q1 for Context Interview")
        fixed_question = get_context_fixed_question(1, project, db)
        if fixed_question:
            return fixed_question

    # PROMPT #217 - Card-focused Interview uses fixed Q1 (motivation type)
    if interview.interview_mode == "card_focused":
        from app.api.routes.interviews.card_focused_questions import get_card_focused_fixed_question
        logger.info(f"📋 Using FIXED Q1 for Card-Focused Interview (parent: {parent_task.title if parent_task else 'None'})")
        fixed_question = get_card_focused_fixed_question(
            question_number=1,
            project=project,
            db=db,
            parent_card=parent_task
        )
        if fixed_question:
            return fixed_question

    # Build context for first question
    parent_context = ""
    if parent_task:
        parent_context = f"""
Você esta criando um item dentro de "{parent_task.title}" ({parent_task.item_type}).
Contextualize sua primeira pergunta com base no card pai.
"""

    # PROMPT #109 - Load from YAML (no hardcoded prompts - follows CLAUDE.md rule)
    loader = PromptLoader()
    first_question_prompt, _ = loader.render(
        "interviews/first_question",
        {
            "project_name": project.name or 'Novo Projeto',
            "project_description": project.description or 'Não definida',
            "parent_context": parent_context
        }
    )

    # Call AI Orchestrator
    # PROMPT #82 - Disable cache for interviews to avoid question repetition
    # Each interview question MUST be unique, cache returns same response causing repetition
    orchestrator = AIOrchestrator(db, enable_cache=False)

    try:
        # PROMPT #81 - Use few-shot example to force format
        initial_messages = [
            {"role": "user", "content": "Comece a entrevista para um projeto de e-commerce."},
            {"role": "assistant", "content": """👋 Olá! Vou ajudar a definir os requisitos do seu projeto "E-commerce".

❓ Pergunta 1: Qual é a principal funcionalidade que você precisa?

○ Catálogo de produtos com busca
○ Carrinho de compras
○ Sistema de pagamento
○ Painel administrativo

💬 Ou descreva com suas próprias palavras."""},
            {"role": "user", "content": f"Ótimo formato! Agora comece a entrevista para o projeto \"{project.name}\". IMPORTANTE: Use EXATAMENTE o mesmo formato da pergunta anterior, com \"○\" (círculo vazio)."}
        ]

        # PROMPT #231 - First question is always simple (closed with options)
        _first_classification = classify_interview_query(
            question_text=f"Start interview for project {project.name}",
            options=["option1", "option2", "option3", "option4"],
            conversation_history_length=0,
        )

        response = await orchestrator.execute(
            usage_type="interview",
            messages=initial_messages,
            system_prompt=first_question_prompt,
            max_tokens=1500,  # PROMPT #149 - Increased to 1500 to ensure 5-8 options always fit
            project_id=interview.project_id,
            interview_id=interview.id,
            enable_rag=True,  # PROMPT #124 - Enable RAG for interviews
            metadata={"query_classification": _first_classification},  # PROMPT #231
        )

        # Clean response
        cleaned_content = clean_ai_response(response["content"])

        # PROMPT #125 - Use AI to analyze and determine correct choice type (single vs multiple)
        analyzed_content = await analyze_and_convert_choice_type(cleaned_content, db)

        # Parse for suggestions
        parsed_content, parsed_options = parse_ai_question_options(analyzed_content)

        # Build assistant message with proper question type
        if parsed_options:
            # Has options - use single_choice or multiple_choice from parser
            question_type = parsed_options.get("question_type", "single_choice")
            assistant_message = {
                "role": "assistant",
                "content": parsed_content,
                "timestamp": datetime.utcnow().isoformat(),
                "model": f"{response['provider']}/{response['model']}",
                "question_number": 1,
                "question_type": question_type,
                "options": parsed_options.get("options", {}),
                "allow_custom_response": True  # PROMPT #79 - User can type freely OR click options
            }
        else:
            # No options - pure text input
            assistant_message = {
                "role": "assistant",
                "content": parsed_content,
                "timestamp": datetime.utcnow().isoformat(),
                "model": f"{response['provider']}/{response['model']}",
                "question_number": 1,
                "question_type": "text"  # Pure text input
            }

        # PROMPT #82 - Store Q1 in RAG for deduplication (prevents Q2 from being same as Q1)
        try:
            deduplicator = InterviewQuestionDeduplicator(db)
            deduplicator.store_question(
                project_id=project.id,
                interview_id=interview.id,
                interview_mode=interview.interview_mode,
                question_text=parsed_content,
                question_number=1,
                is_fixed=False
            )
            logger.info(f"✅ Stored Q1 in RAG for deduplication")
        except Exception as e:
            logger.error(f"❌ Failed to store Q1 in RAG: {e}")

        logger.info(f"✅ First open-ended question generated successfully")

        return assistant_message

    except Exception as ai_error:
        logger.error(f"❌ Failed to generate first question: {str(ai_error)}", exc_info=True)

        # PROMPT #81 - Fallback: return a contextualized first question with error info
        fallback_message = {
            "role": "assistant",
            "content": f"""👋 Olá! Vou ajudar a refinar os requisitos do projeto "{project.name}".

📋 Você descreveu: "{project.description}"

❓ Pergunta 1: Com base nisso, qual seria a primeira funcionalidade principal que você precisa implementar?

○ Sistema de autenticação e controle de acesso
○ Interface para gerenciamento de dados
○ Integração com sistemas externos
○ Processamento e análise de informações

💬 Ou descreva com suas próprias palavras.""",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fallback",
            "question_number": 1,
            "question_type": "single_choice",
            "options": {
                "type": "single",
                "choices": [
                    {"id": "autenticação", "label": "Sistema de autenticação e controle de acesso", "value": "autenticação"},
                    {"id": "gerenciamento_dados", "label": "Interface para gerenciamento de dados", "value": "gerenciamento_dados"},
                    {"id": "integração", "label": "Integração com sistemas externos", "value": "integração"},
                    {"id": "processamento", "label": "Processamento e análise de informações", "value": "processamento"}
                ]
            },
            "allow_custom_response": True,  # PROMPT #79 - User can type freely OR click options
            "fallback_error": str(ai_error)  # PROMPT #81 - Include error for UI display
        }

        return fallback_message
