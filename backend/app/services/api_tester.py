from typing import Dict, List, Optional
import anthropic
import openai
from google import generativeai as genai
import time
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class APITester:
    """
    Testa spec generation com todas as APIs disponíveis
    """

    def __init__(
        self,
        anthropic_key: str,
        openai_key: str,
        google_key: str
    ):
        self.anthropic_client = anthropic.Anthropic(api_key=anthropic_key)
        self.openai_client = openai.OpenAI(api_key=openai_key)
        genai.configure(api_key=google_key)

        self.test_prompt = self._get_test_prompt()

    def _get_test_prompt(self) -> str:
        """
        Prompt de teste padrão - mesmo usado no SpecGenerator
        """
        return """
You are a technical architect specializing in PHP + MySQL.

PROJECT REQUIREMENTS:
- Name: Book Catalog
- Description: Simple catalog to manage books
- Main Entities: Book
- Required Features: CRUD, search

STACK CONTEXT:
STACK: PHP 8.2+ with MySQL 8.0+

ARCHITECTURE:
- MVC (Model-View-Controller) pattern
- Repository pattern for data access
- Service layer for business logic
- PSR-4 autoloading standard

YOUR TASK:
Generate a COMPLETE technical specification for this project.

Return a detailed JSON following this structure:
{
    "database": {
        "tables": [
            {
                "name": "books",
                "fields": [
                    {"name": "id", "type": "INT PRIMARY KEY AUTO_INCREMENT"},
                    {"name": "title", "type": "VARCHAR(255)"}
                ]
            }
        ]
    },
    "files": [
        {
            "path": "src/Controllers/BookController.php",
            "type": "controller",
            "entity": "Book"
        }
    ]
}

Be specific and follow PHP best practices.
"""

    async def test_anthropic(self) -> Dict:
        """
        Testa Anthropic Claude Haiku
        """
        logger.info("🧪 Testing Anthropic Claude Haiku...")

        result = {
            "provider": "anthropic",
            "model": "claude-3-haiku-20240307",
            "success": False,
            "error": None,
            "response_time": 0,
            "estimated_cost": 0,
            "spec_valid": False,
            "spec": None
        }

        try:
            start_time = time.time()

            response = self.anthropic_client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=3000,
                messages=[{
                    "role": "user",
                    "content": self.test_prompt
                }]
            )

            end_time = time.time()
            result["response_time"] = round(end_time - start_time, 2)

            # Parse response
            content = response.content[0].text
            logger.debug(f"Anthropic raw response (first 500 chars): {content[:500]}")

            # Limpar markdown
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            logger.debug(f"Cleaned content (first 500 chars): {content[:500]}")

            # Validar JSON
            spec = json.loads(content.strip())

            # Calcular custo (Haiku: $0.80 per MTok input, $4.00 per MTok output)
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens

            cost = (input_tokens / 1_000_000 * 0.80) + \
                   (output_tokens / 1_000_000 * 4.00)

            result["estimated_cost"] = round(cost, 4)
            result["spec"] = spec
            result["spec_valid"] = True
            result["success"] = True

            logger.info(f"✅ Anthropic: {result['response_time']:.2f}s, ${result['estimated_cost']:.4f}")

        except Exception as e:
            result["error"] = str(e)
            logger.error(f"❌ Anthropic failed: {str(e)}")

        return result

    async def test_openai(self) -> Dict:
        """
        Testa OpenAI GPT-4o-mini
        """
        logger.info("🧪 Testing OpenAI GPT-4o-mini...")

        result = {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "success": False,
            "error": None,
            "response_time": 0,
            "estimated_cost": 0,
            "spec_valid": False,
            "spec": None
        }

        try:
            start_time = time.time()

            response = self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{
                    "role": "user",
                    "content": self.test_prompt
                }],
                max_tokens=3000,
                response_format={"type": "json_object"}  # Force JSON
            )

            end_time = time.time()
            result["response_time"] = round(end_time - start_time, 2)

            # Parse response
            content = response.choices[0].message.content
            spec = json.loads(content)

            # Calcular custo (GPT-4o-mini: $0.150 per MTok input, $0.600 per MTok output)
            input_tokens = response.usage.prompt_tokens
            output_tokens = response.usage.completion_tokens

            cost = (input_tokens / 1_000_000 * 0.150) + \
                   (output_tokens / 1_000_000 * 0.600)

            result["estimated_cost"] = round(cost, 4)
            result["spec"] = spec
            result["spec_valid"] = True
            result["success"] = True

            logger.info(f"✅ OpenAI: {result['response_time']:.2f}s, ${result['estimated_cost']:.4f}")

        except Exception as e:
            result["error"] = str(e)
            logger.error(f"❌ OpenAI failed: {str(e)}")

        return result

    async def test_google(self) -> Dict:
        """
        Testa Google Gemini 2.5 Flash
        """
        logger.info("🧪 Testing Google Gemini 2.5 Flash...")

        result = {
            "provider": "google",
            "model": "gemini-2.5-flash",
            "success": False,
            "error": None,
            "response_time": 0,
            "estimated_cost": 0,
            "spec_valid": False,
            "spec": None
        }

        try:
            start_time = time.time()

            model = genai.GenerativeModel('gemini-2.5-flash')
            response = model.generate_content(self.test_prompt)

            end_time = time.time()
            result["response_time"] = round(end_time - start_time, 2)

            # Parse response
            content = response.text

            # Limpar markdown
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            spec = json.loads(content.strip())

            # Calcular custo (Gemini 1.5 Flash: $0.075 per MTok input, $0.30 per MTok output)
            # Nota: Google não retorna tokens exatos, estimar
            estimated_input_tokens = len(self.test_prompt.split()) * 1.3
            estimated_output_tokens = len(content.split()) * 1.3

            cost = (estimated_input_tokens / 1_000_000 * 0.075) + \
                   (estimated_output_tokens / 1_000_000 * 0.30)

            result["estimated_cost"] = round(cost, 4)
            result["spec"] = spec
            result["spec_valid"] = True
            result["success"] = True

            logger.info(f"✅ Google: {result['response_time']:.2f}s, ${result['estimated_cost']:.4f}")

        except Exception as e:
            result["error"] = str(e)
            logger.error(f"❌ Google failed: {str(e)}")

        return result

    async def test_all(self) -> Dict:
        """
        Testa todas as APIs e compara resultados
        """
        logger.info("🚀 Starting API comparison test...")

        results = {
            "test_date": datetime.now().isoformat(),
            "test_prompt": self.test_prompt,
            "providers": {}
        }

        # Testar cada API
        anthropic_result = await self.test_anthropic()
        openai_result = await self.test_openai()
        google_result = await self.test_google()

        results["providers"]["anthropic"] = anthropic_result
        results["providers"]["openai"] = openai_result
        results["providers"]["google"] = google_result

        # Comparar e escolher melhor
        winner = self._choose_best_api(
            anthropic_result,
            openai_result,
            google_result
        )

        results["winner"] = winner
        results["recommendation"] = self._get_recommendation(winner)

        return results

    def _choose_best_api(
        self,
        anthropic: Dict,
        openai: Dict,
        google: Dict
    ) -> Dict:
        """
        Escolhe melhor API baseado em critérios
        """

        # Filtrar apenas APIs que funcionaram
        working_apis = []

        if anthropic["success"]:
            working_apis.append({
                "provider": "anthropic",
                "model": anthropic["model"],
                "cost": anthropic["estimated_cost"],
                "response_time": anthropic["response_time"],
                "score": 0
            })

        if openai["success"]:
            working_apis.append({
                "provider": "openai",
                "model": openai["model"],
                "cost": openai["estimated_cost"],
                "response_time": openai["response_time"],
                "score": 0
            })

        if google["success"]:
            working_apis.append({
                "provider": "google",
                "model": google["model"],
                "cost": google["estimated_cost"],
                "response_time": google["response_time"],
                "score": 0
            })

        if not working_apis:
            return {
                "provider": None,
                "reason": "Nenhuma API funcionou!"
            }

        # Calcular score (menor é melhor)
        # Score = custo_normalizado * 0.7 + tempo_normalizado * 0.3

        # Normalizar custos (0-1)
        min_cost = min(api["cost"] for api in working_apis)
        max_cost = max(api["cost"] for api in working_apis)

        for api in working_apis:
            if max_cost - min_cost > 0:
                cost_score = (api["cost"] - min_cost) / (max_cost - min_cost)
            else:
                cost_score = 0

            api["score"] = cost_score * 0.7

        # Normalizar tempo (0-1)
        min_time = min(api["response_time"] for api in working_apis)
        max_time = max(api["response_time"] for api in working_apis)

        for api in working_apis:
            if max_time - min_time > 0:
                time_score = (api["response_time"] - min_time) / (max_time - min_time)
            else:
                time_score = 0

            api["score"] += time_score * 0.3

        # Escolher menor score
        winner = min(working_apis, key=lambda x: x["score"])

        return {
            "provider": winner["provider"],
            "model": winner["model"],
            "cost": winner["cost"],
            "response_time": winner["response_time"],
            "reason": f"Melhor custo-benefício (${winner['cost']:.4f}, {winner['response_time']:.2f}s)"
        }

    def _get_recommendation(self, winner: Dict) -> str:
        """
        Gera recomendação de implementação
        """

        if not winner.get("provider"):
            return "❌ Nenhuma API disponível. Verifique créditos/quotas."

        provider = winner["provider"]
        model = winner["model"]
        cost = winner["cost"]

        return f"""
✅ RECOMENDAÇÃO: Usar {provider.upper()} ({model})

Motivo: {winner['reason']}

Custo por spec: ${cost:.4f}
Custo para 50 projetos: ${cost * 50:.2f}

AÇÃO NECESSÁRIA:
1. Atualizar AIOrchestrator para usar "{provider}" como primary
2. Ou usar diretamente no SpecGenerator

Código sugerido:
Atualizar strategy 'general' no AIOrchestrator para usar {provider} como primary.
"""
