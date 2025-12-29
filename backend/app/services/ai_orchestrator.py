"""
Service central para orquestração de múltiplos modelos de IA
Gerencia Anthropic, OpenAI e Google AI de forma inteligente
"""

from typing import Dict, List, Optional, Literal
from sqlalchemy.orm import Session
import logging

from app.models.ai_model import AIModel, AIModelUsageType

logger = logging.getLogger(__name__)

UsageType = Literal[
    "prompt_generation",
    "task_execution",
    "commit_generation",
    "interview",
    "general"
]


class AIOrchestrator:
    """
    Orquestrador central que escolhe e gerencia múltiplos modelos de IA

    Estratégia de seleção:
    - prompt_generation: GPT-4 (melhor análise e planejamento)
    - task_execution: Claude (melhor para código)
    - commit_generation: Gemini (rápido e barato)
    - interview: Claude (melhor conversa técnica)
    - general: Gemini (barato para queries simples)
    """

    def __init__(self, db: Session):
        """
        Inicializa o orquestrador

        Args:
            db: Sessão do banco de dados
        """
        self.db = db
        self.clients: Dict[str, any] = {}
        self._initialize_clients()

    def _initialize_clients(self):
        """
        Inicializa clientes das 3 APIs disponíveis
        """
        # Buscar AI Models ativos
        models = self.db.query(AIModel).filter(
            AIModel.is_active == True
        ).all()

        for model in models:
            try:
                if model.provider == "anthropic" and "anthropic" not in self.clients:
                    from anthropic import Anthropic
                    self.clients["anthropic"] = Anthropic(api_key=model.api_key)
                    logger.info(f"✅ Anthropic client initialized (model: {model.name})")

                elif model.provider == "openai" and "openai" not in self.clients:
                    from openai import OpenAI
                    self.clients["openai"] = OpenAI(api_key=model.api_key)
                    logger.info(f"✅ OpenAI client initialized (model: {model.name})")

                elif model.provider == "google" and "google" not in self.clients:
                    import google.generativeai as genai
                    genai.configure(api_key=model.api_key)
                    self.clients["google"] = genai
                    logger.info(f"✅ Google AI client initialized (model: {model.name})")

            except Exception as e:
                logger.error(f"❌ Failed to initialize {model.provider} client: {e}")

    def choose_model(self, usage_type: UsageType) -> Dict[str, str]:
        """
        Escolhe o melhor modelo baseado no tipo de uso

        Args:
            usage_type: Tipo de uso (prompt_generation, task_execution, etc)

        Returns:
            Dicionário com provider e model

        Raises:
            ValueError: Se nenhum provider estiver disponível
        """
        # Estratégias de seleção otimizadas
        strategies = {
            "prompt_generation": {
                "primary": {"provider": "anthropic", "model": "claude-3-haiku-20240307"},
                "fallback": {"provider": "openai", "model": "gpt-4o"}
            },
            "task_execution": {
                "primary": {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
                "fallback": {"provider": "openai", "model": "gpt-4o"}
            },
            "commit_generation": {
                "primary": {"provider": "google", "model": "gemini-1.5-flash"},
                "fallback": {"provider": "anthropic", "model": "claude-haiku-3-20250514"}
            },
            "interview": {
                "primary": {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
                "fallback": {"provider": "openai", "model": "gpt-4o"}
            },
            "general": {
                "primary": {"provider": "google", "model": "gemini-1.5-flash"},
                "fallback": {"provider": "anthropic", "model": "claude-haiku-3-20250514"}
            }
        }

        strategy = strategies.get(usage_type, strategies["task_execution"])

        # Verificar se provider primário está disponível
        if strategy["primary"]["provider"] in self.clients:
            logger.info(f"🎯 Using {strategy['primary']['provider']} ({strategy['primary']['model']}) for {usage_type}")
            return strategy["primary"]

        # Tentar fallback
        if strategy["fallback"]["provider"] in self.clients:
            logger.warning(f"⚠️  Primary provider unavailable. Fallback to {strategy['fallback']['provider']} for {usage_type}")
            return strategy["fallback"]

        raise ValueError(f"No AI provider available for {usage_type}. Initialize at least one provider.")

    async def execute(
        self,
        usage_type: UsageType,
        messages: List[Dict],
        system_prompt: Optional[str] = None,
        max_tokens: int = 4000
    ) -> Dict:
        """
        Executa chamada de IA usando o modelo apropriado

        Args:
            usage_type: Tipo de uso para seleção do modelo
            messages: Lista de mensagens no formato [{"role": "user/assistant", "content": "..."}]
            system_prompt: System prompt opcional
            max_tokens: Máximo de tokens na resposta

        Returns:
            Dicionário com response, usage, provider e model

        Raises:
            Exception: Se a execução falhar em todos os providers
        """
        model_config = self.choose_model(usage_type)
        provider = model_config["provider"]
        model_name = model_config["model"]

        try:
            if provider == "anthropic":
                return await self._execute_anthropic(
                    model_name, messages, system_prompt, max_tokens
                )
            elif provider == "openai":
                return await self._execute_openai(
                    model_name, messages, system_prompt, max_tokens
                )
            elif provider == "google":
                return await self._execute_google(
                    model_name, messages, system_prompt, max_tokens
                )
            else:
                raise ValueError(f"Unknown provider: {provider}")

        except Exception as e:
            logger.error(f"❌ Error with {provider} ({model_name}): {str(e)}")

            # Tentar fallback se ainda não foi usado
            try:
                fallback_config = self.choose_model(usage_type)
                if fallback_config["provider"] != provider and fallback_config["provider"] in self.clients:
                    logger.info(f"🔄 Trying fallback provider {fallback_config['provider']}...")
                    provider = fallback_config["provider"]
                    model_name = fallback_config["model"]

                    if provider == "anthropic":
                        return await self._execute_anthropic(
                            model_name, messages, system_prompt, max_tokens
                        )
                    elif provider == "openai":
                        return await self._execute_openai(
                            model_name, messages, system_prompt, max_tokens
                        )
                    elif provider == "google":
                        return await self._execute_google(
                            model_name, messages, system_prompt, max_tokens
                        )
            except Exception as fallback_error:
                logger.error(f"❌ Fallback also failed: {str(fallback_error)}")

            # Re-raise original exception if fallback fails
            raise

    async def _execute_anthropic(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int
    ) -> Dict:
        """Executa com Anthropic Claude"""
        client = self.clients["anthropic"]

        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt if system_prompt else "You are a helpful AI assistant.",
            messages=messages
        )

        return {
            "provider": "anthropic",
            "model": model,
            "content": response.content[0].text,
            "usage": {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
                "total_tokens": response.usage.input_tokens + response.usage.output_tokens
            }
        }

    async def _execute_openai(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int
    ) -> Dict:
        """Executa com OpenAI GPT"""
        client = self.clients["openai"]

        # Adicionar system message se fornecido
        openai_messages = []
        if system_prompt:
            openai_messages.append({
                "role": "system",
                "content": system_prompt
            })
        openai_messages.extend(messages)

        response = client.chat.completions.create(
            model=model,
            messages=openai_messages,
            max_tokens=max_tokens
        )

        return {
            "provider": "openai",
            "model": model,
            "content": response.choices[0].message.content,
            "usage": {
                "input_tokens": response.usage.prompt_tokens,
                "output_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens
            }
        }

    async def _execute_google(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int
    ) -> Dict:
        """Executa com Google Gemini"""
        genai = self.clients["google"]

        # Configurar modelo
        model_instance = genai.GenerativeModel(model)

        # Converter mensagens para formato Gemini
        conversation = []
        if system_prompt:
            conversation.append(f"System Instructions: {system_prompt}\n")

        for msg in messages:
            role = "User" if msg["role"] == "user" else "Model"
            conversation.append(f"{role}: {msg['content']}")

        prompt = "\n\n".join(conversation)

        # Gerar resposta
        response = model_instance.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                max_output_tokens=max_tokens,
                temperature=0.7
            )
        )

        return {
            "provider": "google",
            "model": model,
            "content": response.text,
            "usage": {
                "input_tokens": 0,  # Gemini não retorna token count facilmente
                "output_tokens": 0,
                "total_tokens": 0
            }
        }

    def get_available_providers(self) -> List[str]:
        """
        Retorna lista de providers disponíveis

        Returns:
            Lista de nomes de providers
        """
        return list(self.clients.keys())

    def get_strategies(self) -> Dict[str, Dict]:
        """
        Retorna estratégias de seleção de modelos

        Returns:
            Dicionário com estratégias para cada usage_type
        """
        usage_types: List[UsageType] = [
            "prompt_generation",
            "task_execution",
            "commit_generation",
            "interview",
            "general"
        ]

        strategies = {}
        for usage_type in usage_types:
            try:
                strategies[usage_type] = self.choose_model(usage_type)
            except ValueError:
                strategies[usage_type] = {"provider": "none", "model": "unavailable"}

        return strategies
