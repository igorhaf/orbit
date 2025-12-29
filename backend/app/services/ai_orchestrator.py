"""
Service central para orquestração de múltiplos modelos de IA
Gerencia Anthropic, OpenAI e Google AI de forma inteligente
"""

from typing import Dict, List, Optional, Literal
from sqlalchemy.orm import Session
import logging
import time
from datetime import datetime
from uuid import UUID

from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_execution import AIExecution  # PROMPT #54 - AI Execution Logging

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
        Inicializa clientes de TODAS as APIs com modelos ativos no banco
        PROMPT #51 - Dynamic AI Model Integration
        """
        # Buscar TODOS os AI Models ativos (não apenas o primeiro de cada provider)
        models = self.db.query(AIModel).filter(
            AIModel.is_active == True
        ).all()

        # Armazenar providers únicos já inicializados
        initialized_providers = set()

        for model in models:
            try:
                provider_key = model.provider.lower()

                # Inicializar cada provider apenas uma vez, mas usando API key do primeiro modelo ativo
                if provider_key not in initialized_providers:
                    if provider_key == "anthropic":
                        from anthropic import Anthropic
                        self.clients["anthropic"] = Anthropic(api_key=model.api_key)
                        logger.info(f"✅ Anthropic client initialized with API key from: {model.name}")
                        initialized_providers.add("anthropic")

                    elif provider_key == "openai":
                        from openai import OpenAI
                        self.clients["openai"] = OpenAI(api_key=model.api_key)
                        logger.info(f"✅ OpenAI client initialized with API key from: {model.name}")
                        initialized_providers.add("openai")

                    elif provider_key == "google":
                        import google.generativeai as genai
                        genai.configure(api_key=model.api_key)
                        self.clients["google"] = genai
                        logger.info(f"✅ Google AI client initialized with API key from: {model.name}")
                        initialized_providers.add("google")

            except Exception as e:
                logger.error(f"❌ Failed to initialize {model.provider} client: {e}")

        logger.info(f"📊 Initialized providers: {list(initialized_providers)}")

    def choose_model(self, usage_type: UsageType) -> Dict[str, any]:
        """
        Escolhe modelo dinamicamente do banco baseado no usage_type
        PROMPT #51 - Dynamic AI Model Integration

        Args:
            usage_type: Tipo de uso (prompt_generation, task_execution, etc)

        Returns:
            Dicionário com provider, model, max_tokens, temperature e config completo

        Raises:
            ValueError: Se nenhum modelo estiver disponível para o usage_type
        """
        # 1. Buscar modelo ativo do banco com o usage_type específico
        db_model = self.db.query(AIModel).filter(
            AIModel.usage_type == usage_type,
            AIModel.is_active == True
        ).first()

        if db_model:
            provider = db_model.provider.lower()

            # Verificar se o provider está inicializado
            if provider in self.clients:
                # Extrair configurações do banco
                model_name = db_model.config.get("model", "")
                max_tokens = db_model.config.get("max_tokens", 4096)
                temperature = db_model.config.get("temperature", 0.7)

                logger.info(
                    f"🎯 Using {db_model.name} ({provider}/{model_name}) "
                    f"for {usage_type} [max_tokens={max_tokens}, temp={temperature}]"
                )

                return {
                    "provider": provider,
                    "model": model_name if model_name else self._get_default_model(provider),
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "db_model_id": str(db_model.id),
                    "db_model_name": db_model.name
                }
            else:
                logger.warning(
                    f"⚠️  Model '{db_model.name}' configured for {usage_type} but "
                    f"provider '{provider}' not initialized"
                )

        # 2. Fallback: buscar QUALQUER modelo ativo que esteja inicializado
        logger.warning(f"⚠️  No specific model configured for {usage_type}, trying fallback...")

        fallback_model = self.db.query(AIModel).filter(
            AIModel.is_active == True
        ).first()

        if fallback_model and fallback_model.provider.lower() in self.clients:
            provider = fallback_model.provider.lower()
            model_name = fallback_model.config.get("model", "")
            max_tokens = fallback_model.config.get("max_tokens", 4096)
            temperature = fallback_model.config.get("temperature", 0.7)

            logger.info(
                f"🔄 Fallback to {fallback_model.name} ({provider}/{model_name}) for {usage_type}"
            )

            return {
                "provider": provider,
                "model": model_name if model_name else self._get_default_model(provider),
                "max_tokens": max_tokens,
                "temperature": temperature,
                "db_model_id": str(fallback_model.id),
                "db_model_name": fallback_model.name
            }

        # 3. Nenhum modelo disponível
        raise ValueError(
            f"❌ No active AI model configured for '{usage_type}'. "
            f"Please configure an AI model in /ai-models page."
        )

    def _get_default_model(self, provider: str) -> str:
        """
        Retorna modelo padrão caso não esteja configurado no banco

        Args:
            provider: Nome do provider (anthropic, openai, google)

        Returns:
            Nome do modelo padrão
        """
        defaults = {
            "anthropic": "claude-sonnet-4-20250514",
            "openai": "gpt-4o",
            "google": "gemini-1.5-flash"
        }
        return defaults.get(provider, "claude-sonnet-4-20250514")

    async def execute(
        self,
        usage_type: UsageType,
        messages: List[Dict],
        system_prompt: Optional[str] = None,
        max_tokens: Optional[int] = None
    ) -> Dict:
        """
        Executa chamada de IA usando modelo e configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        PROMPT #54 - AI Execution Logging

        Args:
            usage_type: Tipo de uso para seleção do modelo
            messages: Lista de mensagens no formato [{"role": "user/assistant", "content": "..."}]
            system_prompt: System prompt opcional
            max_tokens: Máximo de tokens (se None, usa configuração do banco)

        Returns:
            Dicionário com response, usage, provider, model e db_model_info

        Raises:
            Exception: Se a execução falhar em todos os providers
        """
        # Escolher modelo do banco com suas configurações
        model_config = self.choose_model(usage_type)
        provider = model_config["provider"]
        model_name = model_config["model"]

        # Usar max_tokens do banco se não foi especificado
        tokens_limit = max_tokens if max_tokens is not None else model_config["max_tokens"]
        temperature = model_config["temperature"]

        logger.info(f"📤 Executing with config: max_tokens={tokens_limit}, temperature={temperature}")

        # PROMPT #54 - Track execution time
        start_time = time.time()
        execution_log = None

        try:
            if provider == "anthropic":
                result = await self._execute_anthropic(
                    model_name, messages, system_prompt, tokens_limit, temperature
                )
            elif provider == "openai":
                result = await self._execute_openai(
                    model_name, messages, system_prompt, tokens_limit, temperature
                )
            elif provider == "google":
                result = await self._execute_google(
                    model_name, messages, system_prompt, tokens_limit, temperature
                )
            else:
                raise ValueError(f"Unknown provider: {provider}")

            # Adicionar informações do modelo do banco na resposta
            result["db_model_id"] = model_config["db_model_id"]
            result["db_model_name"] = model_config["db_model_name"]

            # PROMPT #54 - Log successful execution to database
            execution_time_ms = int((time.time() - start_time) * 1000)
            try:
                execution_log = AIExecution(
                    ai_model_id=UUID(model_config["db_model_id"]) if model_config.get("db_model_id") else None,
                    usage_type=usage_type,
                    input_messages=messages,
                    system_prompt=system_prompt,
                    response_content=result.get("content", ""),
                    input_tokens=result.get("usage", {}).get("input_tokens"),
                    output_tokens=result.get("usage", {}).get("output_tokens"),
                    total_tokens=result.get("usage", {}).get("total_tokens"),
                    provider=provider,
                    model_name=model_name,
                    temperature=str(temperature),
                    max_tokens=tokens_limit,
                    execution_time_ms=execution_time_ms,
                    created_at=datetime.utcnow()
                )
                self.db.add(execution_log)
                self.db.commit()
                logger.info(f"✅ Logged execution to database: {execution_log.id}")
            except Exception as log_error:
                logger.error(f"⚠️  Failed to log execution to database: {log_error}")
                # Don't fail the request if logging fails
                self.db.rollback()

            return result

        except Exception as e:
            logger.error(f"❌ Error with {provider} ({model_name}): {str(e)}")

            # PROMPT #54 - Log failed execution to database
            execution_time_ms = int((time.time() - start_time) * 1000)
            try:
                execution_log = AIExecution(
                    ai_model_id=UUID(model_config["db_model_id"]) if model_config.get("db_model_id") else None,
                    usage_type=usage_type,
                    input_messages=messages,
                    system_prompt=system_prompt,
                    response_content=None,
                    input_tokens=None,
                    output_tokens=None,
                    total_tokens=None,
                    provider=provider,
                    model_name=model_name,
                    temperature=str(temperature),
                    max_tokens=tokens_limit,
                    error_message=str(e),
                    execution_time_ms=execution_time_ms,
                    created_at=datetime.utcnow()
                )
                self.db.add(execution_log)
                self.db.commit()
                logger.info(f"✅ Logged failed execution to database: {execution_log.id}")
            except Exception as log_error:
                logger.error(f"⚠️  Failed to log error to database: {log_error}")
                self.db.rollback()

            # Re-raise - removido fallback automático para garantir uso do modelo configurado
            raise

    async def _execute_anthropic(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float
    ) -> Dict:
        """
        Executa com Anthropic Claude usando configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        """
        client = self.clients["anthropic"]

        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
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
        max_tokens: int,
        temperature: float
    ) -> Dict:
        """
        Executa com OpenAI GPT usando configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        """
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
            max_tokens=max_tokens,
            temperature=temperature
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
        max_tokens: int,
        temperature: float
    ) -> Dict:
        """
        Executa com Google Gemini usando configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        """
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

        # Gerar resposta com configurações do banco
        response = model_instance.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                max_output_tokens=max_tokens,
                temperature=temperature
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
