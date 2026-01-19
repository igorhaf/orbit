"""
ContextGeneratorService
PROMPT #89 - Generate project context from Context Interview

This service processes the Context Interview and generates:
- context_semantic: Structured semantic text for AI consumption
- context_human: Human-readable project description

The context is the foundational, immutable description of the project
that guides all subsequent interviews and card generation.
"""

from typing import Dict, List, Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
import json
import logging
import re

from app.models.project import Project
from app.models.interview import Interview, InterviewStatus
from app.services.ai_orchestrator import AIOrchestrator
from app.prompter.facade import PrompterFacade

logger = logging.getLogger(__name__)


def _strip_markdown_json(content: str) -> str:
    """
    Remove markdown code blocks from JSON response.
    AI sometimes returns JSON wrapped in ```json ... ``` blocks.
    """
    content = re.sub(r'^```json\s*\n?', '', content, flags=re.MULTILINE)
    content = re.sub(r'\n?```\s*$', '', content, flags=re.MULTILINE)
    return content.strip()


def _convert_semantic_to_human(semantic_text: str, semantic_map: Dict[str, str]) -> str:
    """
    PROMPT #89 - Convert semantic text to human-readable text.

    This function transforms semantic references (identifiers like N1, P1, etc.)
    into their actual meanings, creating natural prose.

    Args:
        semantic_text: Text with semantic identifiers
        semantic_map: Dictionary mapping identifiers to meanings

    Returns:
        Human-readable text with identifiers replaced
    """
    if not semantic_map or not semantic_text:
        return semantic_text or ""

    human_text = semantic_text

    # Sort identifiers by length (longest first) to avoid partial replacements
    sorted_identifiers = sorted(semantic_map.keys(), key=len, reverse=True)

    for identifier in sorted_identifiers:
        meaning = semantic_map[identifier]
        pattern = rf'\b{re.escape(identifier)}\b'
        human_text = re.sub(pattern, meaning, human_text)

    # Clean up multiple consecutive newlines
    human_text = re.sub(r'\n{3,}', '\n\n', human_text)

    return human_text.strip()


class ContextGeneratorService:
    """
    Service for generating project context from Context Interview.

    PROMPT #89 - Context Interview: Foundational Project Description

    This service:
    1. Analyzes the Context Interview conversation
    2. Generates structured semantic text (for AI)
    3. Converts to human-readable description
    4. Saves both to the Project model
    """

    def __init__(self, db: Session):
        self.db = db
        try:
            self.prompter = PrompterFacade(db)
        except RuntimeError:
            self.prompter = None
        self.orchestrator = AIOrchestrator(db)

    async def generate_context_from_interview(
        self,
        interview_id: UUID,
        project_id: UUID
    ) -> Dict:
        """
        Generate project context from Context Interview conversation.

        PROMPT #89 - Context Interview Processing

        Flow:
        1. Validate interview (must be context mode, have enough messages)
        2. AI analyzes conversation and generates structured context
        3. Extract semantic map and create human-readable version
        4. Save to Project model
        5. Mark interview as completed

        Args:
            interview_id: Context Interview ID
            project_id: Project ID

        Returns:
            {
                "context_semantic": str,
                "context_human": str,
                "semantic_map": Dict[str, str],
                "interview_insights": {
                    "project_vision": str,
                    "problem_statement": str,
                    "key_features": [str, ...],
                    "target_users": [str, ...],
                    "success_criteria": [str, ...]
                }
            }

        Raises:
            ValueError: If interview not found, wrong mode, or insufficient data
        """
        # 1. Validate interview
        interview = self.db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            raise ValueError(f"Interview {interview_id} not found")

        # Accept both "context" and "meta_prompt" modes for compatibility
        if interview.interview_mode not in ["context", "meta_prompt"]:
            raise ValueError(
                f"Interview {interview_id} is not a context interview "
                f"(mode: {interview.interview_mode}). Only 'context' mode supported."
            )

        # Minimum 6 messages (3 Q&A pairs - Q1, Q2, Q3 at least)
        if not interview.conversation_data or len(interview.conversation_data) < 6:
            raise ValueError(
                f"Interview {interview_id} has insufficient data. "
                f"Need at least 6 messages (3 Q&A pairs), got {len(interview.conversation_data or [])}."
            )

        # 2. Get project
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Check if context is already locked
        if project.context_locked:
            raise ValueError(
                f"Project {project_id} context is already locked. "
                "Cannot regenerate context after first epic is created."
            )

        # 3. Build conversation summary for AI
        conversation_summary = self._build_conversation_summary(interview.conversation_data)

        # 4. Generate context using AI
        context_result = await self._generate_context_with_ai(
            project=project,
            conversation_summary=conversation_summary
        )

        # 5. Save to project
        project.context_semantic = context_result["context_semantic"]
        project.context_human = context_result["context_human"]
        project.description = context_result["context_human"]  # Also update description

        # 6. Mark interview as completed
        interview.status = InterviewStatus.COMPLETED

        self.db.commit()

        logger.info(f"✅ Context generated for project {project.name}")
        logger.info(f"   - Semantic: {len(context_result['context_semantic'])} chars")
        logger.info(f"   - Human: {len(context_result['context_human'])} chars")

        return context_result

    def _build_conversation_summary(self, conversation_data: List[Dict]) -> str:
        """
        Build a structured summary of the conversation for AI processing.

        Args:
            conversation_data: List of conversation messages

        Returns:
            Formatted conversation summary
        """
        summary_parts = []

        for i, msg in enumerate(conversation_data):
            role = msg.get("role", "unknown")
            content = msg.get("content", "")

            if role == "assistant":
                # AI question
                summary_parts.append(f"**Pergunta:** {content}")
            elif role == "user":
                # User answer
                summary_parts.append(f"**Resposta:** {content}")
                summary_parts.append("")  # Empty line between Q&A pairs

        return "\n".join(summary_parts)

    async def _generate_context_with_ai(
        self,
        project: Project,
        conversation_summary: str
    ) -> Dict:
        """
        Use AI to generate structured context from conversation.

        Args:
            project: Project instance
            conversation_summary: Formatted conversation summary

        Returns:
            Dict with context_semantic, context_human, semantic_map, and insights
        """
        system_prompt = """Você é um especialista em análise de requisitos de software.

Sua tarefa é analisar uma entrevista de contexto de projeto e gerar:

1. **CONTEXTO SEMÂNTICO** (context_semantic):
   - Texto estruturado com identificadores semânticos
   - Use identificadores como: N1 (nome), P1 (problema), V1 (visão), U1 (usuário), F1 (funcionalidade)
   - Inclua um Mapa Semântico no final com todas as definições

2. **MAPA SEMÂNTICO** (semantic_map):
   - Dicionário JSON mapeando cada identificador para seu significado
   - Exemplo: {"N1": "Sistema de Vendas", "P1": "Gestão de estoque ineficiente"}

3. **INSIGHTS DA ENTREVISTA** (interview_insights):
   - project_vision: Visão geral do projeto
   - problem_statement: Problema que o projeto resolve
   - key_features: Lista de funcionalidades principais
   - target_users: Tipos de usuários do sistema
   - success_criteria: Critérios de sucesso

FORMATO DE RESPOSTA (JSON):
```json
{
    "context_semantic": "## Contexto do Projeto\\n\\n### Visão\\nN1 é um sistema que resolve P1...\\n\\n### Usuários\\n- U1: ...\\n\\n## Mapa Semântico\\n- **N1**: Nome do projeto\\n- **P1**: Problema principal",
    "semantic_map": {
        "N1": "Nome do Projeto",
        "P1": "Problema principal",
        "V1": "Visão do projeto",
        "U1": "Primeiro tipo de usuário",
        "F1": "Primeira funcionalidade"
    },
    "interview_insights": {
        "project_vision": "Desenvolver um sistema...",
        "problem_statement": "Atualmente o cliente enfrenta...",
        "key_features": ["Feature 1", "Feature 2"],
        "target_users": ["Admin", "Usuário Final"],
        "success_criteria": ["Reduzir tempo de...", "Aumentar eficiência..."]
    }
}
```

IMPORTANTE:
- O context_semantic deve ser rico e detalhado (mínimo 500 caracteres)
- Use português brasileiro
- Os identificadores devem ser concisos (2-3 caracteres)
- O Mapa Semântico deve estar DENTRO do context_semantic no final
- Retorne APENAS o JSON, sem texto adicional"""

        user_prompt = f"""Analise a seguinte entrevista de contexto para o projeto "{project.name}":

{conversation_summary}

Gere o contexto semântico estruturado, o mapa semântico e os insights conforme especificado."""

        # Call AI
        messages = [{"role": "user", "content": user_prompt}]

        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=4000
            # Note: temperature is configured in the AI model settings in the database
        )

        # Parse response
        response_text = response.get("content", "")
        response_text = _strip_markdown_json(response_text)

        try:
            result = json.loads(response_text)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            logger.error(f"Response text: {response_text[:500]}...")
            raise ValueError("AI response was not valid JSON. Please try again.")

        # Validate required fields
        if "context_semantic" not in result:
            raise ValueError("AI response missing 'context_semantic' field")

        semantic_map = result.get("semantic_map", {})
        context_semantic = result["context_semantic"]

        # Convert semantic to human-readable
        context_human = _convert_semantic_to_human(context_semantic, semantic_map)

        # Remove the Mapa Semântico section from human text
        context_human = re.sub(
            r'##\s*Mapa\s*Sem[aâ]ntico\s*\n+(?:[-*]\s*\*\*[^*]+\*\*:[^\n]*\n*)*',
            '',
            context_human,
            flags=re.IGNORECASE | re.MULTILINE
        )
        context_human = context_human.strip()

        return {
            "context_semantic": context_semantic,
            "context_human": context_human,
            "semantic_map": semantic_map,
            "interview_insights": result.get("interview_insights", {})
        }

    async def lock_context(self, project_id: UUID) -> bool:
        """
        Lock the project context, making it immutable.

        PROMPT #89 - Context is locked automatically when first epic is generated.

        Args:
            project_id: Project ID

        Returns:
            True if locked successfully

        Raises:
            ValueError: If project not found or context already locked
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if project.context_locked:
            logger.warning(f"Project {project_id} context is already locked")
            return True

        if not project.context_semantic:
            raise ValueError(
                f"Cannot lock context for project {project_id}: no context generated yet"
            )

        project.context_locked = True
        project.context_locked_at = datetime.utcnow()
        self.db.commit()

        logger.info(f"🔒 Context locked for project {project.name}")

        return True

    def is_context_ready(self, project_id: UUID) -> bool:
        """
        Check if project context is ready (generated and optionally locked).

        Args:
            project_id: Project ID

        Returns:
            True if context_semantic is not empty
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return False

        return bool(project.context_semantic)

    def is_context_locked(self, project_id: UUID) -> bool:
        """
        Check if project context is locked.

        Args:
            project_id: Project ID

        Returns:
            True if context is locked
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return False

        return project.context_locked
