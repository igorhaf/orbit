"""
Service para gerar mensagens de commit automáticas usando IA (Gemini)
Analisa mudanças e gera commits seguindo Conventional Commits
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
# PROMPT #103 - External prompts support
from app.prompts import get_prompt_service

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
            raise ValueError(f"Task {task_id} not found")

        # 2. Buscar chat session para extrair contexto
        session = db.query(ChatSession).filter(
            ChatSession.id == UUID(chat_session_id)
        ).first()

        if not session or not session.messages:
            raise ValueError("No conversation found for this task")

        # 3. Extrair resumo das mudanças
        changes_summary = self._extract_changes_summary(session.messages)

        # 4. Criar prompt para IA gerar commit
        commit_prompt = self._create_commit_prompt(task, changes_summary)

        # 5. Usar orquestrador (vai usar Gemini!)
        orchestrator = AIOrchestrator(db)

        logger.info("Calling AI Orchestrator for commit generation (will use Gemini)...")
        response = await orchestrator.execute(
            usage_type="commit_generation",  # Usa Gemini!
            messages=[{
                "role": "user",
                "content": commit_prompt
            }],
            max_tokens=500,
            # PROMPT #58 - Add context for prompt logging
            project_id=task.project_id,
            task_id=task.id,
            metadata={"chat_session_id": chat_session_id}
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
            raise ValueError(f"Task {task_id} not found")

        # Criar prompt
        commit_prompt = self._create_commit_prompt(task, changes_description)

        # Usar orquestrador
        orchestrator = AIOrchestrator(db)

        response = await orchestrator.execute(
            usage_type="commit_generation",
            messages=[{
                "role": "user",
                "content": commit_prompt
            }],
            max_tokens=500,
            # PROMPT #58 - Add context for prompt logging
            project_id=task.project_id,
            task_id=task.id,
            metadata={"manual": True, "changes_description": changes_description}
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

    def _extract_changes_summary(self, messages: list) -> str:
        """
        Extrai resumo das mudanças da conversa

        Args:
            messages: Lista de mensagens da chat session

        Returns:
            Resumo das mudanças
        """
        # Pegar últimas mensagens do assistente (onde está o código/solução)
        assistant_messages = [
            msg["content"]
            for msg in messages
            if msg.get("role") == "assistant"
        ]

        if not assistant_messages:
            return "Task completed"

        # Usar última mensagem como contexto principal
        last_message = assistant_messages[-1]

        # Limitar tamanho (primeiros 800 caracteres)
        return last_message[:800] if len(last_message) > 800 else last_message

    def _create_commit_prompt(self, task: Task, changes: str) -> str:
        """
        Cria prompt para IA gerar commit message

        Args:
            task: Task a ser commitada
            changes: Descrição das mudanças

        Returns:
            Prompt formatado
        """
        return f"""Generate a professional git commit message following Conventional Commits specification.

TASK INFORMATION:
Title: {task.title}
Description: {task.description or 'No description'}
Status: {task.status.value}

CHANGES MADE:
{changes}

CONVENTIONAL COMMIT TYPES:
- feat: New feature
- fix: Bug fix
- docs: Documentation only
- style: Code style/formatting (no logic change)
- refactor: Code refactoring
- test: Adding tests
- chore: Maintenance, dependencies
- perf: Performance improvement

FORMAT:
type(scope): subject

RULES:
1. Subject in lowercase
2. No period at end
3. Maximum 72 characters
4. Be specific and clear
5. Use English
6. Use imperative mood (e.g., "add" not "added")

EXAMPLES:
- feat(auth): implement JWT authentication
- fix(api): resolve database connection timeout
- docs(readme): update installation guide
- refactor(user): simplify profile update logic
- perf(query): optimize database indexes

RESPONSE FORMAT (JSON):
{{
  "type": "feat",
  "scope": "auth",
  "subject": "implement JWT authentication",
  "description": "Brief explanation of what was done"
}}

Generate the commit message based on the task and changes above.
Return ONLY the JSON, no markdown or extra text."""

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
                "message": "chore: update task",
                "description": "Task completed"
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
