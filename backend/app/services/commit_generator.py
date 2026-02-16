"""
Service para gerar mensagens de commit automáticas usando IA (Gemini)
Analisa mudanças e gera commits seguindo Conventional Commits
PROMPT #233 - Refactored with diff complexity analyzer, change summarizer, PromptLoader
"""

from typing import Dict
from uuid import UUID
from sqlalchemy.orm import Session
from datetime import datetime
import json
import logging

from app.models.task import Task
from app.models.commit import Commit
from app.models.chat_session import ChatSession
# PROMPT #233 - Structured change summarization + diff complexity analysis
from app.services.commit_change_summarizer import summarize_changes
from app.services.commit_diff_analyzer import analyze_commit_complexity
from app.prompts.loader import PromptLoader

logger = logging.getLogger(__name__)


class CommitGenerator:
    """
    Gera mensagens de commit profissionais usando IA
    Usa Gemini via orquestrador (rápido e barato)
    """

    async def generate_from_task_completion(
        self,
        task_id: str,
        chat_session_id: str,
        db: Session
    ) -> Commit:
        """
        Gera commit automaticamente quando task é completada

        Args:
            task_id: UUID da task
            chat_session_id: UUID da chat session
            db: Sessão do banco de dados

        Returns:
            Commit criado

        Raises:
            ValueError: Se task ou session não forem encontrados
        """
        from app.services.ai_orchestrator import AIOrchestrator

        logger.info(f"Generating commit for task {task_id} from session {chat_session_id}")

        # 1. Buscar task
        task = db.query(Task).filter(Task.id == UUID(task_id)).first()
        if not task:
            raise ValueError(f"Tarefa {task_id} não encontrada")

        # 2. Buscar chat session para extrair contexto
        session = db.query(ChatSession).filter(
            ChatSession.id == UUID(chat_session_id)
        ).first()

        if not session or not session.messages:
            raise ValueError("Nenhuma conversa encontrada para esta tarefa")

        # 3. PROMPT #233 - Structured change summarization
        changes_summary = summarize_changes(session.messages, task.title)

        # 4. PROMPT #233 - Diff complexity analysis for model routing
        complexity = analyze_commit_complexity(
            changes_summary, task.title, task.description
        )

        # 5. PROMPT #233 - Use PromptLoader instead of hardcoded prompt
        loader = PromptLoader()
        _, commit_prompt = loader.render("commits/commit_message", {
            "task_title": task.title,
            "task_description": task.description or "No description",
            "task_status": task.status.value,
            "changes": changes_summary,
        })

        # 6. Usar orquestrador with complexity-based routing
        orchestrator = AIOrchestrator(db)

        logger.info(
            f"Calling AI Orchestrator for commit generation "
            f"(complexity={complexity['complexity']}, tier={complexity['recommended_tier']})"
        )
        response = await orchestrator.execute(
            usage_type="commit_generation",
            messages=[{
                "role": "user",
                "content": commit_prompt
            }],
            max_tokens=complexity["estimated_tokens"],
            project_id=task.project_id,
            task_id=task.id,
            metadata={
                "chat_session_id": chat_session_id,
                "query_classification": complexity,
            }
        )

        logger.info(f"Received commit from {response['provider']} ({response['model']})")

        # 6. Parse resposta
        commit_data = self._parse_commit_response(response["content"])

        # 7. Criar commit no banco
        commit = Commit(
            task_id=UUID(task_id),
            project_id=task.project_id,
            type=commit_data["type"],
            message=commit_data["message"],
            changes={
                "summary": changes_summary,
                "full_context": commit_data.get("description", "")
            },
            created_by_ai_model=f"{response['provider']}/{response['model']}",
            timestamp=datetime.utcnow()
        )

        db.add(commit)
        db.commit()
        db.refresh(commit)

        logger.info(f"✅ Commit generated: {commit.message}")

        return commit

    async def generate_manual(
        self,
        task_id: str,
        changes_description: str,
        db: Session
    ) -> Commit:
        """
        Gera commit manualmente com descrição fornecida pelo usuário

        Args:
            task_id: UUID da task
            changes_description: Descrição das mudanças
            db: Sessão do banco de dados

        Returns:
            Commit criado

        Raises:
            ValueError: Se task não for encontrada
        """
        from app.services.ai_orchestrator import AIOrchestrator

        logger.info(f"Generating manual commit for task {task_id}")

        # Buscar task
        task = db.query(Task).filter(Task.id == UUID(task_id)).first()
        if not task:
            raise ValueError(f"Tarefa {task_id} não encontrada")

        # PROMPT #233 - Diff complexity analysis for model routing
        complexity = analyze_commit_complexity(
            changes_description, task.title, task.description
        )

        # PROMPT #233 - Use PromptLoader instead of hardcoded prompt
        loader = PromptLoader()
        _, commit_prompt = loader.render("commits/commit_message", {
            "task_title": task.title,
            "task_description": task.description or "No description",
            "task_status": task.status.value,
            "changes": changes_description,
        })

        # Usar orquestrador with complexity-based routing
        orchestrator = AIOrchestrator(db)

        response = await orchestrator.execute(
            usage_type="commit_generation",
            messages=[{
                "role": "user",
                "content": commit_prompt
            }],
            max_tokens=complexity["estimated_tokens"],
            project_id=task.project_id,
            task_id=task.id,
            metadata={
                "manual": True,
                "changes_description": changes_description,
                "query_classification": complexity,
            }
        )

        # Parse e salvar
        commit_data = self._parse_commit_response(response["content"])

        commit = Commit(
            task_id=UUID(task_id),
            project_id=task.project_id,
            type=commit_data["type"],
            message=commit_data["message"],
            changes={"description": changes_description},
            created_by_ai_model=f"{response['provider']}/{response['model']}",
            timestamp=datetime.utcnow()
        )

        db.add(commit)
        db.commit()
        db.refresh(commit)

        logger.info(f"✅ Manual commit generated: {commit.message}")

        return commit

    def _parse_commit_response(self, response_text: str) -> Dict:
        """
        Parse resposta da IA

        Args:
            response_text: Resposta da IA em JSON

        Returns:
            Dicionário com dados do commit
        """
        # Limpar markdown se presente
        response_text = response_text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        try:
            data = json.loads(response_text.strip())
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse commit response: {response_text[:200]}")
            # Fallback: criar commit genérico
            return {
                "type": "chore",
                "message": "chore: atualizar tarefa",
                "description": "Tarefa concluida"
            }

        # Construir mensagem completa
        scope = data.get("scope", "")
        scope_str = f"({scope})" if scope else ""
        subject = data.get("subject", "update")

        message = f"{data['type']}{scope_str}: {subject}"

        return {
            "type": data["type"],
            "message": message,
            "description": data.get("description", "")
        }
