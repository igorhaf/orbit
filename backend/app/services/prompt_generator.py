"""
Service para gerar prompts automaticamente usando IA
Analisa entrevistas e gera prompts estruturados para implementação
"""

from typing import List, Dict, Any
from uuid import UUID
from sqlalchemy.orm import Session
import json
import logging

from app.models.interview import Interview
from app.models.prompt import Prompt
from app.services.ai_orchestrator import AIOrchestrator

logger = logging.getLogger(__name__)


class PromptGenerator:
    """
    Serviço para geração automática de prompts usando AI Orchestrator
    """

    def __init__(self, db: Session):
        """
        Inicializa o gerador com AI Orchestrator

        Args:
            db: Sessão do banco de dados
        """
        self.orchestrator = AIOrchestrator(db)

    async def generate_from_interview(
        self,
        interview_id: str,
        db: Session
    ) -> List[Prompt]:
        """
        Analisa a entrevista e gera prompts estruturados

        Args:
            interview_id: UUID da entrevista
            db: Sessão do banco de dados

        Returns:
            Lista de prompts criados

        Raises:
            ValueError: Se a entrevista não for encontrada
            Exception: Se houver erro na geração
        """
        logger.info(f"Starting prompt generation for interview {interview_id}")

        # 1. Buscar interview
        interview = db.query(Interview).filter(
            Interview.id == UUID(interview_id)
        ).first()

        if not interview:
            raise ValueError(f"Interview {interview_id} not found")

        if not interview.conversation_data or len(interview.conversation_data) == 0:
            raise ValueError("Interview has no conversation data")

        # 2. Extrair conversa
        conversation = interview.conversation_data
        logger.info(f"Processing {len(conversation)} messages from interview")

        # 3. Criar prompt para análise
        analysis_prompt = self._create_analysis_prompt(conversation)

        # 4. Chamar AI Orchestrator para analisar
        logger.info("Calling AI Orchestrator for prompt generation...")
        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=[{
                "role": "user",
                "content": analysis_prompt
            }],
            max_tokens=4000
        )

        logger.info(f"Received response from {response['provider']} ({response['model']})")

        # 5. Parsear resposta e criar prompts
        prompts_data = self._parse_ai_response(response['content'])
        logger.info(f"Parsed {len(prompts_data)} prompts from AI response")

        # 6. Criar prompts no banco
        created_prompts = []
        for i, prompt_data in enumerate(prompts_data):
            prompt = Prompt(
                project_id=interview.project_id,
                content=prompt_data["content"],
                type=prompt_data.get("type", "feature"),
                is_reusable=prompt_data.get("is_reusable", False),
                components=prompt_data.get("components", []),
                version=1,
                created_from_interview_id=UUID(interview_id)
            )
            db.add(prompt)
            created_prompts.append(prompt)
            logger.info(f"Created prompt {i+1}: {prompt_data.get('type', 'feature')}")

        db.commit()
        logger.info(f"Successfully generated and saved {len(created_prompts)} prompts")

        return created_prompts

    def _create_analysis_prompt(self, conversation: List[Dict[str, Any]]) -> str:
        """
        Cria prompt para Claude analisar a entrevista

        Args:
            conversation: Lista de mensagens da conversa

        Returns:
            Prompt formatado para análise
        """
        conversation_text = "\n".join([
            f"{msg.get('role', 'unknown').upper()}: {msg.get('content', '')}"
            for msg in conversation
        ])

        return f"""Analise esta entrevista sobre um projeto de software e gere prompts estruturados para implementação.

CONVERSA DA ENTREVISTA:
{conversation_text}

TAREFA:
Analise a conversa e gere prompts profissionais e detalhados para implementar o projeto descrito. Cada prompt deve ser uma instrução clara e completa que pode ser usada diretamente por desenvolvedores ou IA para implementar uma funcionalidade específica.

FORMATO DE SAÍDA (JSON):
{{
  "prompts": [
    {{
      "name": "Setup Inicial do Projeto",
      "type": "setup",
      "content": "Crie um projeto Next.js 14 com TypeScript, Tailwind CSS e configuração Docker. Inclua: 1) Estrutura de pastas recomendada, 2) Configuração de ambiente, 3) Scripts package.json, 4) Dockerfile e docker-compose.yml...",
      "is_reusable": false,
      "components": ["docker", "nextjs", "typescript", "tailwind"],
      "priority": 1
    }},
    {{
      "name": "Implementar Sistema de Autenticação",
      "type": "feature",
      "content": "Implemente autenticação completa com: 1) JWT tokens, 2) Login/Register endpoints, 3) Middleware de proteção, 4) Refresh token logic, 5) Password hashing com bcrypt...",
      "is_reusable": true,
      "components": ["auth", "jwt", "bcrypt", "middleware"],
      "priority": 2
    }}
  ]
}}

DIRETRIZES PARA GERAÇÃO:
1. **Clareza**: Cada prompt deve ser específico e executável
2. **Contexto**: Inclua todo contexto técnico necessário
3. **Detalhamento**: Seja detalhado sobre o que implementar e como
4. **Priorização**: Ordene por ordem lógica de implementação
5. **Reusabilidade**: Marque como reutilizável se o prompt pode ser usado em outros projetos
6. **Componentes**: Liste todas as tecnologias/bibliotecas envolvidas
7. **Tipos válidos**: setup, feature, bug_fix, refactor, documentation, test
8. **Completude**: Cada prompt deve ser auto-contido e completo

IMPORTANTE:
- Gere entre 3 e 10 prompts (depende da complexidade do projeto)
- Prompts de "setup" geralmente NÃO são reutilizáveis
- Prompts de features genéricas (auth, pagination, etc) SÃO reutilizáveis
- O campo "content" deve ter instruções DETALHADAS (200-500 palavras)
- Inclua exemplos de código quando relevante no content

Retorne APENAS o JSON válido, sem texto adicional antes ou depois."""

    def _parse_ai_response(self, response_text: str) -> List[Dict[str, Any]]:
        """
        Parseia a resposta da IA e extrai os prompts

        Args:
            response_text: Texto de resposta da IA

        Returns:
            Lista de dicionários com dados dos prompts

        Raises:
            ValueError: Se o JSON for inválido
        """
        # Remover markdown se presente
        response_text = response_text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        # Parse JSON
        try:
            data = json.loads(response_text.strip())
            prompts = data.get("prompts", [])

            # Validar estrutura básica
            for prompt in prompts:
                if "content" not in prompt:
                    raise ValueError("Prompt missing required 'content' field")
                if "type" not in prompt:
                    prompt["type"] = "feature"  # Default type

            return prompts

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            logger.error(f"Response text: {response_text[:500]}")
            raise ValueError(f"Invalid JSON response from AI: {str(e)}")
