"""
Service central para orquestração de múltiplos modelos de IA
Gerencia Anthropic, OpenAI e Google AI de forma inteligente
"""

from typing import Dict, List, Optional, Literal
from sqlalchemy.orm import Session
import logging
import time
import json  # PROMPT #74 - For cache key generation
import os  # PROMPT #74 - For Redis env vars
import asyncio  # PROMPT #152 - For rate limit waiting
from datetime import datetime
from uuid import UUID

from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_execution import AIExecution  # PROMPT #54 - AI Execution Logging
from app.models.prompt import Prompt  # PROMPT #58 - Prompt Audit Logging
from app.models.task import Task, ItemType, PriorityLevel  # JIRA Transformation - Multi-dimensional model selection

logger = logging.getLogger(__name__)

UsageType = Literal[
    "prompt_generation",
    "task_execution",
    "commit_generation",
    "interview",
    "pattern_discovery",  # PROMPT #62 - AI-powered pattern discovery
    "memory",  # PROMPT #118 - Codebase memory scan and business rules extraction
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

    def __init__(self, db: Session, cache_service=None, enable_cache=True, enable_rag=True):
        """
        Inicializa o orquestrador

        Args:
            db: Sessão do banco de dados
            cache_service: CacheService opcional para caching (PROMPT #74)
            enable_cache: Se True, inicializa cache automaticamente se não fornecido (PROMPT #74)
            enable_rag: Se True, inicializa RAG service para retrieval-augmented generation (PROMPT #83)
        """
        self.db = db

        # PROMPT #74 - Auto-initialize cache if not provided
        if cache_service is None and enable_cache:
            cache_service = self._initialize_cache()

        self.cache_service = cache_service

        # PROMPT #83 - Initialize RAG service
        self.rag_service = None
        if enable_rag:
            try:
                from app.services.rag_service import RAGService
                self.rag_service = RAGService(db)
                logger.info("✅ RAG service initialized")
            except Exception as e:
                logger.warning(f"⚠️  RAG service initialization failed: {e}")
                self.rag_service = None

        self.clients: Dict[str, any] = {}
        self._initialize_clients()

        # PROMPT #152 - Initialize rate limiter
        self.rate_limiter = self._initialize_rate_limiter()

    def _initialize_cache(self):
        """
        Initialize cache service with Redis connection
        PROMPT #74 - Redis Cache Integration

        Returns:
            CacheService instance or None if initialization fails
        """
        try:
            import os
            # PROMPT #164 - CacheService moved from prompter to services
            from app.services.cache_service import CacheService

            # Try to connect to Redis
            redis_client = None
            redis_host = os.getenv("REDIS_HOST")

            if redis_host:
                try:
                    import redis
                    redis_client = redis.Redis(
                        host=redis_host,
                        port=int(os.getenv("REDIS_PORT", 6379)),
                        db=0,
                        decode_responses=True,
                        socket_connect_timeout=5,
                        socket_timeout=5,
                    )
                    # Test connection
                    redis_client.ping()
                    logger.info(f"✅ Redis cache connected: {redis_host}:{os.getenv('REDIS_PORT', 6379)}")
                except Exception as e:
                    logger.warning(f"⚠️  Redis connection failed: {e}. Using in-memory cache.")
                    redis_client = None

            # Initialize cache service
            cache = CacheService(
                redis_client=redis_client,
                enable_semantic=True if redis_client else False,  # Only enable if Redis available
                similarity_threshold=0.95
            )

            if redis_client and cache.enable_semantic:
                logger.info("✅ Semantic caching (L2) enabled in AIOrchestrator")

            return cache

        except Exception as e:
            logger.error(f"❌ Failed to initialize cache: {e}")
            return None

    def _initialize_rate_limiter(self):
        """
        Initialize rate limiter service with Redis connection
        PROMPT #152 - Rate Limiting per AI Model

        Returns:
            RateLimiterService instance or None if initialization fails
        """
        try:
            from app.services.rate_limiter import RateLimiterService

            redis_host = os.getenv("REDIS_HOST")
            if redis_host:
                import redis
                redis_client = redis.Redis(
                    host=redis_host,
                    port=int(os.getenv("REDIS_PORT", 6379)),
                    db=0,
                    decode_responses=True,
                    socket_connect_timeout=5,
                    socket_timeout=5,
                )
                # Test connection
                redis_client.ping()
                logger.info(f"✅ Rate limiter connected to Redis: {redis_host}")
                return RateLimiterService(redis_client)
            else:
                logger.warning("⚠️ REDIS_HOST not set, rate limiting disabled")
                return None

        except Exception as e:
            logger.warning(f"⚠️ Rate limiter initialization failed: {e}")
            return None

    def _initialize_clients(self):
        """
        Inicializa clientes de TODAS as APIs com modelos ativos no banco
        PROMPT #51 - Dynamic AI Model Integration
        PROMPT #75 - Async AI Clients (AsyncAnthropic, AsyncOpenAI, httpx)
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
                        # PROMPT #75 - Use AsyncAnthropic for non-blocking async calls
                        from anthropic import AsyncAnthropic
                        self.clients["anthropic"] = AsyncAnthropic(api_key=model.api_key)
                        logger.info(f"✅ AsyncAnthropic client initialized with API key from: {model.name}")
                        initialized_providers.add("anthropic")

                    elif provider_key == "openai":
                        # PROMPT #75 - Use AsyncOpenAI for non-blocking async calls
                        from openai import AsyncOpenAI
                        self.clients["openai"] = AsyncOpenAI(api_key=model.api_key)
                        logger.info(f"✅ AsyncOpenAI client initialized with API key from: {model.name}")
                        initialized_providers.add("openai")

                    elif provider_key == "google":
                        # PROMPT #75 - Use httpx.AsyncClient for Google Gemini (no native async SDK)
                        import httpx
                        self.clients["google"] = {
                            "api_key": model.api_key,
                            "http_client": httpx.AsyncClient(
                                timeout=30.0,
                                limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
                            )
                        }
                        logger.info(f"✅ Google async HTTP client initialized with API key from: {model.name}")
                        initialized_providers.add("google")

                    elif provider_key == "ollama":
                        # PROMPT #106 - Ollama local LLM integration
                        # PROMPT #107 - Increased timeout for CPU inference (can take 2-5 min without GPU)
                        import httpx
                        ollama_host = os.getenv("OLLAMA_HOST", "http://ollama:11434")
                        ollama_timeout = float(os.getenv("OLLAMA_TIMEOUT", "300"))  # 5 min default
                        self.clients["ollama"] = {
                            "base_url": ollama_host,
                            "http_client": httpx.AsyncClient(
                                timeout=ollama_timeout,
                                limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
                            )
                        }
                        logger.info(f"✅ Ollama async HTTP client initialized: {ollama_host} (timeout={ollama_timeout}s, from model: {model.name})")
                        initialized_providers.add("ollama")

                    elif provider_key == "cohere":
                        # PROMPT #122 - Cohere AI integration
                        import httpx
                        self.clients["cohere"] = {
                            "api_key": model.api_key,
                            "http_client": httpx.AsyncClient(
                                timeout=60.0,
                                limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
                            )
                        }
                        logger.info(f"✅ Cohere async HTTP client initialized with API key from: {model.name}")
                        initialized_providers.add("cohere")

            except Exception as e:
                logger.error(f"❌ Failed to initialize {model.provider} client: {e}")

        logger.info(f"📊 Initialized async providers: {list(initialized_providers)}")

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
        # Order by updated_at DESC para pegar o modelo mais recentemente editado
        db_model = self.db.query(AIModel).filter(
            AIModel.usage_type == usage_type,
            AIModel.is_active == True
        ).order_by(AIModel.updated_at.desc()).first()

        if db_model:
            provider = db_model.provider.lower()

            # Verificar se o provider está inicializado
            if provider in self.clients:
                # Extrair configurações do banco
                model_name = db_model.config.get("model_id", "")
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
                    "db_model_name": db_model.name,
                    # PROMPT #152 - Rate limiting config
                    "rate_limit_requests": db_model.rate_limit_requests,
                    "rate_limit_window_seconds": db_model.rate_limit_window_seconds
                }
            else:
                logger.warning(
                    f"⚠️  Model '{db_model.name}' configured for {usage_type} but "
                    f"provider '{provider}' not initialized"
                )

        # 2. Fallback: buscar modelo GENERAL como padrão
        logger.warning(f"⚠️  No specific model configured for {usage_type}, trying GENERAL fallback...")

        fallback_model = self.db.query(AIModel).filter(
            AIModel.usage_type == AIModelUsageType.GENERAL,
            AIModel.is_active == True
        ).order_by(AIModel.updated_at.desc()).first()

        if fallback_model and fallback_model.provider.lower() in self.clients:
            provider = fallback_model.provider.lower()
            model_name = fallback_model.config.get("model_id", "")
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
                "db_model_name": fallback_model.name,
                # PROMPT #152 - Rate limiting config
                "rate_limit_requests": fallback_model.rate_limit_requests,
                "rate_limit_window_seconds": fallback_model.rate_limit_window_seconds
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
            provider: Nome do provider (anthropic, openai, google, cohere)

        Returns:
            Nome do modelo padrão
        """
        defaults = {
            "anthropic": "claude-sonnet-4-20250514",
            "openai": "gpt-4o",
            "google": "gemini-1.5-flash",
            "cohere": "command-r-plus-08-2024"  # PROMPT #122 - Cohere AI (note: old command-r deprecated Sept 2025)
        }
        return defaults.get(provider, "claude-sonnet-4-20250514")

    def choose_model_for_task(self, task: Task) -> Dict[str, any]:
        """
        Multi-dimensional model selection for task execution
        JIRA Transformation - Phase 2

        Strategy:
        1. If task has explicit target_ai_model_id, use that (override)
        2. Otherwise, calculate complexity score from:
           - Priority: critical=5, high=4, medium=3, low=2, trivial=1
           - Item Type: Epic=5, Story=4, Task=3, Subtask=2, Bug=2
           - Story Points: 1-21 → 0-5 scale (Fibonacci normalized)
        3. Total score: 0-15
           - 0-5: Haiku (fast, cheap)
           - 6-10: Sonnet (balanced)
           - 11+: Opus (powerful, expensive)

        Args:
            task: Task object with priority, item_type, story_points

        Returns:
            Dict with provider, model, max_tokens, temperature, db_model_id, db_model_name

        Example:
            config = orchestrator.choose_model_for_task(task)
            # Returns: {"provider": "anthropic", "model": "claude-sonnet-4", ...}
        """
        # 1. Check for explicit override
        if task.target_ai_model_id:
            logger.info(f"🎯 Using explicit model override: {task.target_ai_model_id}")
            db_model = self.db.query(AIModel).filter(
                AIModel.id == task.target_ai_model_id,
                AIModel.is_active == True
            ).first()

            if db_model:
                provider = db_model.provider.lower()
                if provider in self.clients:
                    return {
                        "provider": provider,
                        "model": db_model.config.get("model_id", self._get_default_model(provider)),
                        "max_tokens": db_model.config.get("max_tokens", 4096),
                        "temperature": db_model.config.get("temperature", 0.7),
                        "db_model_id": str(db_model.id),
                        "db_model_name": db_model.name,
                        # PROMPT #152 - Rate limiting config
                        "rate_limit_requests": db_model.rate_limit_requests,
                        "rate_limit_window_seconds": db_model.rate_limit_window_seconds
                    }
                else:
                    logger.warning(f"⚠️  Explicit model {db_model.name} not initialized, falling back to scoring")
            else:
                logger.warning(f"⚠️  Explicit model {task.target_ai_model_id} not found, falling back to scoring")

        # 2. Calculate complexity score
        score = 0

        # Priority score (0-5)
        priority_scores = {
            PriorityLevel.CRITICAL: 5,
            PriorityLevel.HIGH: 4,
            PriorityLevel.MEDIUM: 3,
            PriorityLevel.LOW: 2,
            PriorityLevel.TRIVIAL: 1
        }
        score += priority_scores.get(task.priority, 3)  # Default to medium

        # Item type complexity (0-5)
        item_type_scores = {
            ItemType.EPIC: 5,
            ItemType.STORY: 4,
            ItemType.TASK: 3,
            ItemType.SUBTASK: 2,
            ItemType.BUG: 2
        }
        score += item_type_scores.get(task.item_type, 3)  # Default to task

        # Story points normalized to 0-5 scale
        if task.story_points:
            # Fibonacci: 1,2,3,5,8,13,21 → map to 0-5
            story_point_scores = {
                1: 1, 2: 1, 3: 2, 5: 3, 8: 4, 13: 5, 21: 5
            }
            # Find closest Fibonacci number
            closest = min(story_point_scores.keys(), key=lambda x: abs(x - task.story_points))
            score += story_point_scores[closest]
        else:
            score += 2  # Default to medium if no story points

        logger.info(
            f"📊 Task complexity score: {score}/15 "
            f"(priority={task.priority.value if task.priority else 'medium'}, "
            f"type={task.item_type.value}, "
            f"points={task.story_points or 'none'})"
        )

        # 3. Select model based on score
        if score <= 5:
            # Low complexity: Haiku (fast, cheap)
            target_usage = "general"  # Typically uses cheaper models
            logger.info(f"🚀 Low complexity ({score}) → Using Haiku-tier model")
        elif score <= 10:
            # Medium complexity: Sonnet (balanced)
            target_usage = "task_execution"  # Balanced model
            logger.info(f"⚖️  Medium complexity ({score}) → Using Sonnet-tier model")
        else:
            # High complexity: Opus (powerful)
            target_usage = "prompt_generation"  # Typically uses most powerful models
            logger.info(f"🎯 High complexity ({score}) → Using Opus-tier model")

        # 4. Get model config from database using usage_type
        return self.choose_model(target_usage)

    async def execute(
        self,
        usage_type: UsageType,
        messages: List[Dict],
        system_prompt: Optional[str] = None,
        max_tokens: Optional[int] = None,
        # PROMPT #58 - Additional context for prompt logging
        project_id: Optional[UUID] = None,
        interview_id: Optional[UUID] = None,
        task_id: Optional[UUID] = None,
        metadata: Optional[Dict] = None,
        # PROMPT #83 - RAG integration
        enable_rag: bool = False,  # Feature flag - opt-in for now
        rag_filter: Optional[Dict] = None,
        rag_top_k: int = 3,
        rag_similarity_threshold: float = 0.7
    ) -> Dict:
        """
        Executa chamada de IA usando modelo e configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        PROMPT #54 - AI Execution Logging
        PROMPT #58 - Prompt Audit Logging
        PROMPT #83 - RAG Integration (Retrieval-Augmented Generation)

        Args:
            usage_type: Tipo de uso para seleção do modelo
            messages: Lista de mensagens no formato [{"role": "user/assistant", "content": "..."}]
            system_prompt: System prompt opcional
            max_tokens: Máximo de tokens (se None, usa configuração do banco)
            project_id: ID do projeto (PROMPT #58 - para logging de prompts)
            interview_id: ID da entrevista (PROMPT #58 - para contexto)
            task_id: ID da task (PROMPT #58 - para contexto)
            metadata: Metadados adicionais (PROMPT #58 - para contexto)
            enable_rag: Se True, busca conhecimento relevante antes da execução (PROMPT #83)
            rag_filter: Filtros para RAG retrieval (project_id, type, etc.)
            rag_top_k: Número de documentos similares a recuperar (default: 3)
            rag_similarity_threshold: Threshold de similaridade (0.0-1.0, default: 0.7)

        Returns:
            Dicionário com response, usage, provider, model, db_model_info e rag_enhanced flag

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

        # PROMPT #152 - Rate Limiting Check
        # Wait if rate limit is exceeded before making API call
        if self.rate_limiter and model_config.get('rate_limit_requests'):
            can_proceed, wait_time = self.rate_limiter.check_rate_limit(
                model_config['db_model_id'],
                model_config['rate_limit_requests'],
                model_config['rate_limit_window_seconds']
            )
            if not can_proceed:
                logger.info(
                    f"⏳ Rate limit reached for {model_config['db_model_name']}, "
                    f"waiting {wait_time:.1f}s before proceeding..."
                )
                await asyncio.sleep(wait_time)
                logger.info(f"✅ Rate limit wait complete, proceeding with API call")

            # Record the request slot BEFORE the API call so that failed requests
            # (e.g. provider quota exceeded) are still counted against the limit.
            # Without this, a provider-side quota error would never be recorded
            # and the rate limiter would never throttle.
            self.rate_limiter.record_request(
                model_config['db_model_id'],
                model_config['rate_limit_window_seconds']
            )

        # PROMPT #83 - RAG Enhancement (before cache check)
        # PROMPT #89 - RAG Metrics Tracking
        rag_context_injected = False
        rag_metrics = {
            "rag_enabled": enable_rag,
            "rag_hit": False,
            "rag_results_count": 0,
            "rag_top_similarity": None,
            "rag_retrieval_time_ms": None
        }

        if enable_rag and self.rag_service and messages:
            try:
                # Extract query from last user message
                query = None
                for msg in reversed(messages):
                    if msg.get("role") == "user":
                        query = msg.get("content", "")
                        break

                if query:
                    # Build filter dict
                    filter_dict = rag_filter or {}
                    if project_id and "project_id" not in filter_dict:
                        filter_dict["project_id"] = project_id

                    # PROMPT #89 - Measure RAG retrieval time
                    rag_start_time = time.time()

                    # Retrieve relevant knowledge
                    rag_results = self.rag_service.retrieve(
                        query=query,
                        filter=filter_dict,
                        top_k=rag_top_k,
                        similarity_threshold=rag_similarity_threshold
                    )

                    # Calculate retrieval time
                    rag_metrics["rag_retrieval_time_ms"] = (time.time() - rag_start_time) * 1000

                    if rag_results:
                        # Update metrics
                        rag_metrics["rag_hit"] = True
                        rag_metrics["rag_results_count"] = len(rag_results)
                        rag_metrics["rag_top_similarity"] = rag_results[0]["similarity"] if rag_results else None

                        # Format RAG context for injection
                        rag_context_text = "\n".join([
                            f"[{i+1}] (similarity: {r['similarity']:.2f})\n{r['content']}"
                            for i, r in enumerate(rag_results)
                        ])

                        # Inject RAG context before last user message
                        rag_message = {
                            "role": "user",
                            "content": f"[RELEVANT CONTEXT FROM KNOWLEDGE BASE]\n\n{rag_context_text}\n\n[END CONTEXT]"
                        }
                        messages.insert(-1, rag_message)
                        rag_context_injected = True

                        logger.info(
                            f"🔍 RAG HIT: {len(rag_results)} docs (top similarity: {rag_metrics['rag_top_similarity']:.2f}, "
                            f"retrieval: {rag_metrics['rag_retrieval_time_ms']:.1f}ms)"
                        )
                    else:
                        logger.info(f"🔍 RAG MISS: No relevant docs found (threshold: {rag_similarity_threshold})")
            except Exception as e:
                logger.warning(f"⚠️  RAG retrieval failed: {e}")

        # PROMPT #74 - Check cache before execution
        if self.cache_service:
            # Prepare cache input (messages converted to single prompt string for caching)
            cache_input = {
                "prompt": json.dumps(messages),  # Serialize messages for consistent hashing
                "system_prompt": system_prompt or "",
                "usage_type": usage_type,
                "temperature": temperature,
                "model": model_name,
            }

            # Try to get from cache
            cached_result = self.cache_service.get(cache_input)
            if cached_result:
                logger.info(f"✅ Cache HIT ({cached_result.get('cache_type')}) - Saved API call!")
                # Return cached result in same format as execute() response
                return {
                    "provider": provider,
                    "model": model_name,
                    "content": cached_result["response"],
                    "usage": {
                        "input_tokens": 0,  # Cached, no tokens used
                        "output_tokens": 0,
                        "total_tokens": 0
                    },
                    "db_model_id": model_config["db_model_id"],
                    "db_model_name": model_config["db_model_name"],
                    "cache_hit": True,  # Flag indicating cache hit
                    "cache_type": cached_result.get("cache_type"),
                    "rag_enhanced": rag_context_injected  # PROMPT #83
                }

        # PROMPT #54 - Track execution time
        start_time = time.time()
        execution_log = None

        # PROMPT #159 - Store model_id for provider backoff extraction
        self._current_model_id = model_config.get("db_model_id")

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
            elif provider == "ollama":
                # PROMPT #106 - Ollama local LLM integration
                result = await self._execute_ollama(
                    model_name, messages, system_prompt, tokens_limit, temperature
                )
            elif provider == "cohere":
                # PROMPT #122 - Cohere AI integration
                result = await self._execute_cohere(
                    model_name, messages, system_prompt, tokens_limit, temperature
                )
            else:
                raise ValueError(f"Unknown provider: {provider}")

            # Adicionar informações do modelo do banco na resposta
            result["db_model_id"] = model_config["db_model_id"]
            result["db_model_name"] = model_config["db_model_name"]
            result["rag_enhanced"] = rag_context_injected  # PROMPT #83

            # PROMPT #54 - Log successful execution to database
            # PROMPT #89 - Include RAG metrics
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
                    created_at=datetime.utcnow(),
                    # PROMPT #89 - RAG metrics
                    rag_enabled=rag_metrics["rag_enabled"],
                    rag_hit=rag_metrics["rag_hit"],
                    rag_results_count=rag_metrics["rag_results_count"],
                    rag_top_similarity=rag_metrics["rag_top_similarity"],
                    rag_retrieval_time_ms=rag_metrics["rag_retrieval_time_ms"]
                )
                self.db.add(execution_log)
                self.db.commit()
                logger.info(f"✅ Logged execution to database: {execution_log.id}")

                # PROMPT #58 - Also log to Prompt table for audit page
                if project_id:  # Only log if project_id is provided
                    try:
                        # Extract user prompt from messages (usually the last user message)
                        user_prompt_text = ""
                        for msg in reversed(messages):
                            if msg.get("role") == "user":
                                user_prompt_text = msg.get("content", "")
                                break

                        # Calculate cost (rough estimate based on Claude pricing)
                        input_tokens = result.get("usage", {}).get("input_tokens", 0)
                        output_tokens = result.get("usage", {}).get("output_tokens", 0)
                        # Rough estimate: $3/million input, $15/million output for Claude Sonnet
                        cost = (input_tokens * 3 / 1_000_000) + (output_tokens * 15 / 1_000_000)

                        prompt_metadata = metadata or {}
                        if task_id:
                            prompt_metadata["task_id"] = str(task_id)

                        prompt_log = Prompt(
                            project_id=project_id,
                            created_from_interview_id=interview_id,
                            content=result.get("content", ""),  # Legacy field - use response
                            type=usage_type,
                            ai_model_used=f"{provider}/{model_name}",
                            system_prompt=system_prompt,
                            user_prompt=user_prompt_text,
                            response=result.get("content", ""),
                            input_tokens=input_tokens,
                            output_tokens=output_tokens,
                            total_cost_usd=cost,
                            execution_time_ms=execution_time_ms,
                            execution_metadata=prompt_metadata,
                            status="success",
                            created_at=datetime.utcnow(),
                            updated_at=datetime.utcnow()
                        )
                        self.db.add(prompt_log)
                        self.db.commit()
                        logger.info(f"✅ Logged prompt to audit: {prompt_log.id}")
                    except Exception as prompt_error:
                        logger.error(f"⚠️  Failed to log prompt to audit: {prompt_error}")
                        self.db.rollback()

            except Exception as log_error:
                logger.error(f"⚠️  Failed to log execution to database: {log_error}")
                # Don't fail the request if logging fails
                self.db.rollback()

            # PROMPT #74 - Store result in cache after successful execution
            if self.cache_service:
                try:
                    # Calculate cost for caching
                    input_tokens = result.get("usage", {}).get("input_tokens", 0)
                    output_tokens = result.get("usage", {}).get("output_tokens", 0)
                    # Rough estimate: $3/million input, $15/million output for Claude Sonnet
                    cost = (input_tokens * 3 / 1_000_000) + (output_tokens * 15 / 1_000_000)

                    cache_input = {
                        "prompt": json.dumps(messages),
                        "system_prompt": system_prompt or "",
                        "usage_type": usage_type,
                        "temperature": temperature,
                        "model": model_name,
                    }

                    cache_output = {
                        "response": result.get("content", ""),
                        "model": model_name,
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "cost": cost,
                    }

                    self.cache_service.set(cache_input, cache_output)
                    logger.info(f"💾 Cached response for future requests")
                except Exception as cache_error:
                    logger.error(f"⚠️  Failed to cache result: {cache_error}")
                    # Don't fail request if caching fails

            return result

        except Exception as e:
            logger.error(f"❌ Error with {provider} ({model_name}): {str(e)}")

            # PROMPT #54 - Log failed execution to database
            # PROMPT #89 - Include RAG metrics even on failure
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
                    created_at=datetime.utcnow(),
                    # PROMPT #89 - RAG metrics (even on failure)
                    rag_enabled=rag_metrics["rag_enabled"],
                    rag_hit=rag_metrics["rag_hit"],
                    rag_results_count=rag_metrics["rag_results_count"],
                    rag_top_similarity=rag_metrics["rag_top_similarity"],
                    rag_retrieval_time_ms=rag_metrics["rag_retrieval_time_ms"]
                )
                self.db.add(execution_log)
                self.db.commit()
                logger.info(f"✅ Logged failed execution to database: {execution_log.id}")

                # PROMPT #58 - Also log failed execution to Prompt table
                if project_id:
                    try:
                        user_prompt_text = ""
                        for msg in reversed(messages):
                            if msg.get("role") == "user":
                                user_prompt_text = msg.get("content", "")
                                break

                        prompt_metadata = metadata or {}
                        if task_id:
                            prompt_metadata["task_id"] = str(task_id)
                        prompt_metadata["error"] = str(e)

                        prompt_log = Prompt(
                            project_id=project_id,
                            created_from_interview_id=interview_id,
                            content="",  # No response due to error
                            type=usage_type,
                            ai_model_used=f"{provider}/{model_name}",
                            system_prompt=system_prompt,
                            user_prompt=user_prompt_text,
                            response=None,
                            input_tokens=0,
                            output_tokens=0,
                            total_cost_usd=0.0,
                            execution_time_ms=execution_time_ms,
                            execution_metadata=prompt_metadata,
                            status="error",
                            error_message=str(e),
                            created_at=datetime.utcnow(),
                            updated_at=datetime.utcnow()
                        )
                        self.db.add(prompt_log)
                        self.db.commit()
                        logger.info(f"✅ Logged failed prompt to audit: {prompt_log.id}")
                    except Exception as prompt_error:
                        logger.error(f"⚠️  Failed to log failed prompt: {prompt_error}")
                        self.db.rollback()

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
        PROMPT #75 - Async execution with await (non-blocking)
        """
        client = self.clients["anthropic"]  # AsyncAnthropic instance

        # PROMPT #75 - Await async call to yield to event loop during API request
        response = await client.messages.create(
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
        PROMPT #75 - Async execution with await (non-blocking)
        """
        client = self.clients["openai"]  # AsyncOpenAI instance

        # Adicionar system message se fornecido
        openai_messages = []
        if system_prompt:
            openai_messages.append({
                "role": "system",
                "content": system_prompt
            })
        openai_messages.extend(messages)

        # PROMPT #75 - Await async call to yield to event loop during API request
        response = await client.chat.completions.create(
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
        PROMPT #75 - Async execution with httpx AsyncClient (non-blocking)
        """
        google_config = self.clients["google"]  # Dict with api_key and http_client
        api_key = google_config["api_key"]
        http_client = google_config["http_client"]

        # Converter mensagens para formato Gemini
        conversation = []
        if system_prompt:
            conversation.append(f"System Instructions: {system_prompt}\n")

        for msg in messages:
            role = "User" if msg["role"] == "user" else "Model"
            conversation.append(f"{role}: {msg['content']}")

        prompt = "\n\n".join(conversation)

        # Construir URL e payload para Gemini API
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature
            }
        }

        # PROMPT #75 - Await async HTTP call to yield to event loop during API request
        try:
            response = await http_client.post(url, json=payload, timeout=120.0)
        except Exception as http_error:
            raise Exception(f"HTTP request failed: {type(http_error).__name__}: {str(http_error)}")

        # PROMPT #118 FIX - Better error handling for Gemini API
        try:
            data = response.json()
        except Exception as json_error:
            raise Exception(f"Failed to parse JSON response: {response.text[:500]}")

        # Check for API error in response body (Gemini can return errors with 200 status)
        if "error" in data:
            error_msg = data.get("error", {}).get("message", str(data["error"]))
            # PROMPT #159 - Extract retry time and set provider backoff
            # Error format: "...Please retry in 29.438272654s."
            if "retry in" in error_msg.lower():
                import re
                match = re.search(r"retry in (\d+\.?\d*)s", error_msg.lower())
                if match:
                    retry_seconds = float(match.group(1))
                    # Store model_id in instance for backoff (set by execute())
                    if hasattr(self, '_current_model_id') and self._current_model_id and self.rate_limiter:
                        self.rate_limiter.set_provider_backoff(self._current_model_id, retry_seconds)
            raise Exception(f"Gemini API Error: {error_msg}")

        # Check HTTP status
        response.raise_for_status()

        # Check if candidates exist
        candidates = data.get("candidates", [])
        if not candidates:
            # Check for safety blocks or other issues
            prompt_feedback = data.get("promptFeedback", {})
            block_reason = prompt_feedback.get("blockReason", "Unknown")
            raise Exception(f"Gemini returned no candidates. Block reason: {block_reason}")

        # Extract content from response
        candidate = candidates[0]
        content_data = candidate.get("content", {})
        parts = content_data.get("parts", [])

        if not parts:
            finish_reason = candidate.get("finishReason", "Unknown")
            raise Exception(f"Gemini returned empty content. Finish reason: {finish_reason}")

        content = parts[0].get("text", "")

        # Extract token usage from response (Gemini provides usageMetadata)
        usage_metadata = data.get("usageMetadata", {})

        return {
            "provider": "google",
            "model": model,
            "content": content,
            "usage": {
                "input_tokens": usage_metadata.get("promptTokenCount", 0),
                "output_tokens": usage_metadata.get("candidatesTokenCount", 0),
                "total_tokens": usage_metadata.get("totalTokenCount", 0)
            }
        }

    async def _execute_ollama(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float
    ) -> Dict:
        """
        Executa com Ollama local LLM usando configurações do banco
        PROMPT #106 - Ollama local LLM integration

        Ollama API é compatível com OpenAI, usando endpoint /api/chat
        Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
        """
        ollama_config = self.clients["ollama"]
        base_url = ollama_config["base_url"]
        http_client = ollama_config["http_client"]

        # Construir mensagens no formato Ollama (compatível com OpenAI)
        ollama_messages = []
        if system_prompt:
            ollama_messages.append({
                "role": "system",
                "content": system_prompt
            })
        ollama_messages.extend(messages)

        # Endpoint e payload para Ollama
        url = f"{base_url}/api/chat"

        payload = {
            "model": model,
            "messages": ollama_messages,
            "stream": False,
            "options": {
                "num_predict": max_tokens,
                "temperature": temperature
            }
        }

        logger.info(f"🦙 Calling Ollama: {url} with model {model} (this may take a while without GPU...)")

        try:
            response = await http_client.post(url, json=payload)
            response.raise_for_status()
        except Exception as e:
            logger.error(f"❌ Ollama request failed: {e}")
            logger.error(f"   Tip: Without GPU, large prompts can take 2-5+ minutes. Consider enabling GPU or using cloud APIs.")
            raise

        data = response.json()
        content = data.get("message", {}).get("content", "")

        # Log execution time info from response
        total_duration = data.get("total_duration", 0) / 1e9  # nanoseconds to seconds
        if total_duration > 0:
            logger.info(f"🦙 Ollama execution completed in {total_duration:.1f}s")

        # Ollama retorna token counts em eval_count e prompt_eval_count
        return {
            "provider": "ollama",
            "model": model,
            "content": content,
            "usage": {
                "input_tokens": data.get("prompt_eval_count", 0),
                "output_tokens": data.get("eval_count", 0),
                "total_tokens": data.get("prompt_eval_count", 0) + data.get("eval_count", 0)
            }
        }

    async def _execute_cohere(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float
    ) -> Dict:
        """
        Executa com Cohere AI usando configurações do banco
        PROMPT #122 - Cohere AI integration

        Cohere Chat API docs: https://docs.cohere.com/reference/chat

        Modelos disponíveis:
        - command-r-plus: Modelo mais poderoso para tarefas complexas
        - command-r: Modelo balanceado para uso geral
        - command-light: Modelo leve e rápido
        """
        cohere_config = self.clients["cohere"]
        api_key = cohere_config["api_key"]
        http_client = cohere_config["http_client"]

        # Converter mensagens para formato Cohere Chat
        # Cohere usa: role="USER" ou "CHATBOT", message="..."
        chat_history = []
        current_message = ""

        for msg in messages:
            role = msg.get("role", "user").lower()
            content = msg.get("content", "")

            # Cohere usa "USER" e "CHATBOT" como roles
            if role == "user":
                cohere_role = "USER"
            elif role == "assistant":
                cohere_role = "CHATBOT"
            else:
                cohere_role = "USER"

            chat_history.append({
                "role": cohere_role,
                "message": content
            })

        # A última mensagem do usuário vai no campo "message" separado
        if chat_history and chat_history[-1]["role"] == "USER":
            current_message = chat_history.pop()["message"]
        else:
            # Se não houver última mensagem do usuário, usar placeholder
            current_message = "Continue the conversation."

        # Construir payload para Cohere Chat API
        url = "https://api.cohere.ai/v1/chat"

        payload = {
            "model": model,
            "message": current_message,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        # Adicionar chat_history se existir
        if chat_history:
            payload["chat_history"] = chat_history

        # Adicionar preamble (system prompt) se fornecido
        if system_prompt:
            payload["preamble"] = system_prompt

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        logger.info(f"🟠 Calling Cohere: {url} with model {model}")

        try:
            response = await http_client.post(url, json=payload, headers=headers)
        except Exception as http_error:
            raise Exception(f"HTTP request failed: {type(http_error).__name__}: {str(http_error)}")

        # Parse response
        try:
            data = response.json()
        except Exception as json_error:
            raise Exception(f"Failed to parse JSON response: {response.text[:500]}")

        # Check for API error
        if response.status_code != 200:
            error_msg = data.get("message", str(data))
            raise Exception(f"Cohere API Error ({response.status_code}): {error_msg}")

        # Extract content from response
        content = data.get("text", "")

        # Extract token usage from response
        meta = data.get("meta", {})
        tokens = meta.get("tokens", {})

        return {
            "provider": "cohere",
            "model": model,
            "content": content,
            "usage": {
                "input_tokens": tokens.get("input_tokens", 0),
                "output_tokens": tokens.get("output_tokens", 0),
                "total_tokens": tokens.get("input_tokens", 0) + tokens.get("output_tokens", 0)
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
