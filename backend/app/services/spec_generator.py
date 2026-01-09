from typing import Dict
from app.orchestrators.registry import OrchestratorRegistry
from app.services.ai_orchestrator import AIOrchestrator
from sqlalchemy.orm import Session
import logging
import json

logger = logging.getLogger(__name__)

class SpecGenerator:
    """
    Gera especificação técnica completa usando orquestrador especializado
    """

    def __init__(self, db: Session):
        self.db = db
        self.ai_orchestrator = AIOrchestrator(db)

    async def generate(
        self,
        stack_key: str,
        interview_data: Dict
    ) -> Dict:
        """
        Gera spec técnica completa

        Custo esperado: ~$0.03 (Haiku/Gemini)
        """

        # Pega orquestrador especializado
        orchestrator = OrchestratorRegistry.get_orchestrator(stack_key)

        # Gera prompt usando conhecimento da stack
        prompt = orchestrator.generate_spec_prompt(interview_data)

        logger.info(f"Generating spec for {orchestrator.stack_name}...")

        # Usa GPT-4/Claude para spec generation
        response = await self.ai_orchestrator.execute(
            usage_type="prompt_generation",
            messages=[{
                "role": "user",
                "content": prompt
            }],
            max_tokens=3000
        )

        logger.info(f"Received response from {response['provider']} ({response['model']})")

        # Parse JSON
        content = response["content"]

        # Limpa markdown se presente
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]

        spec = json.loads(content.strip())

        # Adiciona metadata
        spec["_metadata"] = {
            "stack": stack_key,
            "stack_name": orchestrator.stack_name,
            "generated_by": f"{response['provider']}/{response['model']}",
            "cost": 0.03  # Estimativa
        }

        logger.info(f"✅ Spec generated")

        return spec
