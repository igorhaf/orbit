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
from app.api.routes.interviews.option_parser import parse_ai_question_options
from app.api.routes.interviews.response_cleaners import clean_ai_response
from app.api.routes.interviews.context_builders import prepare_interview_context

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

    # Build the unified open-ended prompt
    system_prompt = f"""Você é um Product Owner experiente conduzindo uma entrevista para coletar requisitos de software.

{project_context}
{parent_context}

**ESTILO DE ENTREVISTA - PERGUNTAS ABERTAS (PROMPT #78):**

Você deve fazer perguntas ABERTAS, como um assistente GPT. O usuário tem liberdade total para responder.

**REGRAS IMPORTANTES:**

1. ✅ **PERGUNTAS ABERTAS** - Faça perguntas abertas que permitam respostas livres
2. ✅ **SUGESTÕES OPCIONAIS** - Você PODE oferecer sugestões de resposta, mas são OPCIONAIS
3. ✅ **ACEITAR QUALQUER RESPOSTA** - O usuário pode responder livremente com texto
4. ✅ **CONTEXTO** - Use as respostas anteriores para fazer perguntas contextualizadas
5. ✅ **PROGRESSO NATURAL** - Avance naturalmente pelos tópicos relevantes
6. ✅ **UMA PERGUNTA POR VEZ** - Faça apenas uma pergunta por mensagem

**FORMATO DAS PERGUNTAS:**

Para perguntas abertas simples:
```
❓ Pergunta {question_number}: [Sua pergunta aqui]

💬 Responda livremente.
```

Para perguntas com sugestões (OPCIONAL):
```
❓ Pergunta {question_number}: [Sua pergunta aqui]

💡 Algumas sugestões (responda livremente ou escolha uma):
• Sugestão 1
• Sugestão 2
• Sugestão 3

💬 Ou descreva com suas próprias palavras.
```

**EXEMPLOS CORRETOS:**

✅ **Pergunta aberta simples:**
❓ Pergunta 1: O que você espera que este sistema faça?

💬 Responda livremente.

✅ **Pergunta com sugestões opcionais:**
❓ Pergunta 2: Qual é o principal problema que você quer resolver?

💡 Algumas sugestões (responda livremente ou escolha uma):
• Automatizar processos manuais
• Melhorar a experiência do usuário
• Reduzir custos operacionais
• Aumentar vendas

💬 Ou descreva com suas próprias palavras.

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

    This replaces all fixed question handlers with a single AI-driven flow.
    All questions are generated by AI, open-ended, with optional suggestions.

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

    # Retrieve previous questions from RAG for deduplication
    previous_questions_context = ""
    try:
        from app.services.rag_service import RAGService

        rag_service = RAGService(db)

        previous_questions = rag_service.retrieve(
            query="",
            filter={
                "type": "interview_question",
                "project_id": str(project.id)
            },
            top_k=30,
            similarity_threshold=0.0
        )

        if previous_questions:
            previous_questions_context = "\n\n**⚠️ PERGUNTAS JÁ FEITAS (NÃO REPITA):**\n"
            for i, pq in enumerate(previous_questions[:10], 1):
                previous_questions_context += f"{i}. {pq['content'][:80]}...\n"

            logger.info(f"✅ RAG: Retrieved {len(previous_questions)} previous questions for deduplication")

    except Exception as e:
        logger.warning(f"⚠️  RAG retrieval failed: {e}")

    # Add previous questions to system prompt
    system_prompt += previous_questions_context

    # Prepare optimized messages for AI
    optimized_messages = prepare_interview_context(
        conversation_data=interview.conversation_data,
        max_recent=10
    )

    # Call AI Orchestrator
    orchestrator = AIOrchestrator(db)

    try:
        response = await orchestrator.execute(
            usage_type="interview",
            messages=optimized_messages,
            system_prompt=system_prompt,
            max_tokens=1000,
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

❓ Pergunta {question_number}: Sobre o que você mencionou ("{last_user_response}..."), me conte mais detalhes:

○ Quais são os requisitos específicos?
○ Quem serão os usuários principais?
○ Há integrações necessárias?
○ Qual o prazo esperado?

💬 Ou descreva livremente o que precisa.""",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fallback",
            "question_number": question_number,
            "question_type": "single_choice",
            "options": {
                "type": "single",
                "choices": [
                    {"id": "requisitos", "label": "Quais são os requisitos específicos?", "value": "requisitos"},
                    {"id": "usuarios", "label": "Quem serão os usuários principais?", "value": "usuarios"},
                    {"id": "integracoes", "label": "Há integrações necessárias?", "value": "integracoes"},
                    {"id": "prazo", "label": "Qual o prazo esperado?", "value": "prazo"}
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
            "usage": {"fallback": True, "error": str(ai_error)[:100]}
        }


async def generate_first_question(
    interview: Interview,
    project: Project,
    db: Session,
    parent_task: Optional[Task] = None
) -> Dict[str, Any]:
    """
    Generate the first open-ended question for an interview.

    PROMPT #78 - Unified Open-Ended Interview System

    This replaces the fixed Q1 (Title) with an AI-generated open question.

    Args:
        interview: Interview instance
        project: Project instance
        db: Database session
        parent_task: Optional parent task for hierarchical interviews

    Returns:
        First question message dict
    """
    logger.info(f"🌟 Generating FIRST open-ended question for interview {interview.id}")

    # Build context for first question
    parent_context = ""
    if parent_task:
        parent_context = f"""
Você está criando um item dentro de "{parent_task.title}" ({parent_task.item_type}).
Contextualize sua primeira pergunta com base no card pai.
"""

    # Simple prompt for first question
    first_question_prompt = f"""Você é um Product Owner iniciando uma entrevista para coletar requisitos.

**PROJETO:** {project.name or 'Novo Projeto'}
**DESCRIÇÃO:** {project.description or 'Não definida'}
{parent_context}

**TAREFA:** Faça a PRIMEIRA pergunta da entrevista.

**REGRAS:**
1. Pergunta ABERTA (o usuário responde livremente)
2. Pode oferecer SUGESTÕES opcionais
3. Seja amigável e acolhedor
4. Use português brasileiro

**FORMATO:**
```
👋 Olá! Vou ajudar a definir os requisitos do seu projeto.

❓ Pergunta 1: [Sua pergunta inicial aqui]

💡 Algumas sugestões (responda livremente ou escolha uma):
• Sugestão 1
• Sugestão 2
• Sugestão 3

💬 Ou descreva com suas próprias palavras.
```

Gere a primeira pergunta agora!
"""

    # Call AI Orchestrator
    orchestrator = AIOrchestrator(db)

    try:
        response = await orchestrator.execute(
            usage_type="interview",
            messages=[],  # No previous messages
            system_prompt=first_question_prompt,
            max_tokens=500,
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

        logger.info(f"✅ First open-ended question generated successfully")

        return assistant_message

    except Exception as ai_error:
        logger.error(f"❌ Failed to generate first question: {str(ai_error)}", exc_info=True)

        # PROMPT #81 - Fallback: return a contextualized first question
        return {
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
            "allow_custom_response": True  # PROMPT #79 - User can type freely OR click options
        }
