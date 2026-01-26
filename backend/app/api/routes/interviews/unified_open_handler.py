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
from app.api.routes.interviews.option_parser import parse_ai_question_options
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
    previous_answers: Optional[Dict] = None
) -> str:
    """
    Build the system prompt for unified open-ended interviews.

    PROMPT #78 - Unified Open-Ended Interview System

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

    Returns:
        System prompt string
    """
    previous_answers = previous_answers or {}
    question_number = (message_count // 2) + 1

    # Build project context
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

    # Add parent task context for hierarchical interviews
    parent_context = ""
    if parent_task:
        parent_context = f"""
**CARD PAI:**
- Tipo: {parent_task.item_type or 'Task'}
- Título: {parent_task.title}
- Descrição: {parent_task.description or 'Não definida'}
"""

    # PROMPT #81 - Use XML structure for clarity
    system_prompt = f"""Você está conduzindo uma entrevista de requisitos de software.

<project>
{project_context}
</project>
{parent_context}

<instructions>
Gere a próxima pergunta (Pergunta {question_number}) usando este formato EXATO:

❓ Pergunta {question_number}: [Sua pergunta fechada aqui]

○ [Primeira opção]
○ [Segunda opção]
○ [Terceira opção]
○ [Quarta opção]

💬 Ou descreva com suas próprias palavras.
</instructions>

<critical_rules>
- GERE APENAS UMA PERGUNTA POR RESPOSTA (nunca duas ou mais)
- Use SOMENTE "○" (círculo vazio Unicode)
- NUNCA use "•" ou "💡 Algumas sugestões"
- Opções são RESPOSTAS, não perguntas
- 3-5 opções obrigatórias
- Contextualize com respostas anteriores
</critical_rules>

<example_output>
❓ Pergunta {question_number}: Qual tipo de usuário terá acesso ao sistema?

○ Administradores com acesso total
○ Usuários internos da empresa
○ Clientes externos
○ Parceiros e fornecedores

💬 Ou descreva com suas próprias palavras.
</example_output>

Gere a Pergunta {question_number} agora:

**TÓPICOS A EXPLORAR (não pergunte tudo, use bom senso):**

- Visão geral e objetivo do projeto
- Principais funcionalidades esperadas
- Quem são os usuários
- Regras de negócio importantes
- Integrações necessárias
- Prioridades e MVP
- Requisitos técnicos especiais

**QUANDO CONCLUIR:**

Após 8-15 perguntas (ou quando tiver informações suficientes), conclua a entrevista:
```
✅ Obrigado! Coletei as informações necessárias para gerar o projeto.

Resumo do que entendi:
- [Ponto 1]
- [Ponto 2]
- [Ponto 3]

Vou gerar as tarefas do projeto agora.
```

**OUTPUT:** Português (Brasil). Continue com a próxima pergunta!
"""

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

        logger.info(f"📋 Context Interview - question_number={question_number}, fixed_count={count_fixed_questions_context()}")

        # Check if we're still in fixed questions phase (Q1-Q3)
        if question_number <= count_fixed_questions_context():
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
        previous_answers=previous_answers
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
        response = await orchestrator.execute(
            usage_type="interview",
            messages=messages,  # PROMPT #82 - Full context (not summarized)
            system_prompt=system_prompt,
            max_tokens=1500,  # PROMPT #109 - Increased from 1000 to prevent truncation
            project_id=interview.project_id,
            interview_id=interview.id
        )

        # Clean response
        cleaned_content = clean_ai_response(response["content"])

        # Parse for structured options (optional - for suggestion clicks)
        parsed_content, parsed_options = parse_ai_question_options(cleaned_content)

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
                    {"id": "usuarios", "label": "Perfil dos usuários e permissões", "value": "usuarios"},
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

    # Build context for first question
    parent_context = ""
    if parent_task:
        parent_context = f"""
Você está criando um item dentro de "{parent_task.title}" ({parent_task.item_type}).
Contextualize sua primeira pergunta com base no card pai.
"""

    # PROMPT #81 - Use XML structure for clarity
    first_question_prompt = f"""Gere a primeira pergunta de uma entrevista de requisitos.

<project>
<name>{project.name or 'Novo Projeto'}</name>
<description>{project.description or 'Não definida'}</description>
</project>
{parent_context}

<instructions>
Sua resposta DEVE seguir este formato EXATO (incluindo os símbolos "○"):

👋 Olá! Vou ajudar a definir os requisitos do seu projeto "{project.name or 'Novo Projeto'}".

❓ Pergunta 1: [Sua pergunta fechada aqui - algo como "Qual é o principal objetivo?"]

○ [Primeira opção de resposta]
○ [Segunda opção de resposta]
○ [Terceira opção de resposta]
○ [Quarta opção de resposta]

💬 Ou descreva com suas próprias palavras.
</instructions>

<critical_rules>
- GERE APENAS UMA PERGUNTA (a Pergunta 1, nunca duas ou mais)
- Use SOMENTE o símbolo "○" (círculo vazio Unicode) para cada opção
- NUNCA use "•" (bullet point)
- NUNCA use "💡 Algumas sugestões"
- As opções devem ser RESPOSTAS diretas, não perguntas
- Forneça exatamente 3-5 opções
</critical_rules>

<example_output>
👋 Olá! Vou ajudar a definir os requisitos do seu projeto "Sistema de Vendas".

❓ Pergunta 1: Qual é a principal funcionalidade que você precisa?

○ Gerenciamento de produtos e estoque
○ Controle de vendas e pedidos
○ Relatórios e dashboards
○ Integração com pagamentos

💬 Ou descreva com suas próprias palavras.
</example_output>

Gere sua resposta agora seguindo o formato do example_output:"""

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

        response = await orchestrator.execute(
            usage_type="interview",
            messages=initial_messages,
            system_prompt=first_question_prompt,
            max_tokens=1000,  # PROMPT #109 - Increased from 500 to prevent truncation
            project_id=interview.project_id,
            interview_id=interview.id
        )

        # Clean response
        cleaned_content = clean_ai_response(response["content"])

        # Parse for suggestions
        parsed_content, parsed_options = parse_ai_question_options(cleaned_content)

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
                    {"id": "autenticacao", "label": "Sistema de autenticação e controle de acesso", "value": "autenticacao"},
                    {"id": "gerenciamento_dados", "label": "Interface para gerenciamento de dados", "value": "gerenciamento_dados"},
                    {"id": "integracao", "label": "Integração com sistemas externos", "value": "integracao"},
                    {"id": "processamento", "label": "Processamento e análise de informações", "value": "processamento"}
                ]
            },
            "allow_custom_response": True,  # PROMPT #79 - User can type freely OR click options
            "fallback_error": str(ai_error)  # PROMPT #81 - Include error for UI display
        }

        return fallback_message
