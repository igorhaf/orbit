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
from app.api.websocket import broadcast_chain_event  # PROMPT #124 - Chain animation

from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_flow_chain import AIFlowChain  # PROMPT #122 - AI Flow Fallback Chains

# PROMPT #288 - In-memory cache for model configs and chains (avoids 5-7 DB queries per execute())
_model_config_cache: Dict = {}
_model_config_cache_ts: float = 0
_chain_config_cache: Dict = {}
_chain_config_cache_ts: float = 0
_MODEL_CACHE_TTL = 60  # seconds - models rarely change
from app.models.ai_execution import AIExecution  # PROMPT #54 - AI Execution Logging
from app.models.prompt import Prompt  # PROMPT #58 - Prompt Audit Logging
from app.models.task import Task, ItemType, PriorityLevel  # JIRA Transformation - Multi-dimensional model selection
from app.models.system_settings import SystemSettings  # PROMPT #207 - System default timeout
from app.services.console_logger import get_console_logger  # PROMPT #168 - Real-time Console Logs
from app.services.utility_node_executor import UtilityNodeExecutor  # PROMPT #205 - Utility Node Execution

logger = logging.getLogger(__name__)

# PROMPT #228 - Module-level semaphore pool for concurrency control per model.
# Shared across all AIOrchestrator instances within the same process.
_model_semaphores: Dict[str, asyncio.Semaphore] = {}


def _get_model_semaphore(model_id: str, max_concurrent: int) -> asyncio.Semaphore:
    """Get or create a semaphore for a given model with the specified concurrency limit."""
    existing = _model_semaphores.get(model_id)
    if existing is None or existing._value != max_concurrent:
        _model_semaphores[model_id] = asyncio.Semaphore(max_concurrent)
    return _model_semaphores[model_id]


def _safe_broadcast(event_type: str, data: dict):
    """PROMPT #234 EH-2: Safe wrapper for broadcast_chain_event via asyncio.create_task.
    Logs errors instead of silently dropping them."""
    async def _do_broadcast():
        try:
            await broadcast_chain_event(event_type, data)
        except Exception as e:
            logger.warning(f"Failed to broadcast chain event '{event_type}': {e}")

    try:
        asyncio.create_task(_do_broadcast())
    except RuntimeError:
        # No running event loop
        logger.debug(f"No event loop for broadcast '{event_type}', skipping")


# PROMPT #235 - usage_types whose executions are saved to satellite/memory/
# (interview excluded - too verbose; general excluded - too broad)
_SAVE_USAGE_TYPES = {
    "prompt_generation", "task_execution",
    "commit_generation", "memory", "pattern_discovery",
}


def _save_prompt_to_satellite(db: Session, prompt_log) -> None:
    """
    PROMPT #235 - Save a successful AI execution as markdown in satellite/memory/.

    Only writes for usage_types in _SAVE_USAGE_TYPES.
    Only writes if project has code_path and satellite/memory/ already exists.
    REGRA #0: never overwrites an existing file.
    """
    try:
        if not prompt_log.project_id:
            return
        if prompt_log.type not in _SAVE_USAGE_TYPES:
            return

        from pathlib import Path as _Path
        from app.models.project import Project

        project = db.query(Project).filter(
            Project.id == prompt_log.project_id
        ).first()
        if not project or not project.code_path:
            return

        from app.services.orbit_folder import SATELLITE_DIR
        memory_dir = _Path(project.code_path) / SATELLITE_DIR / "memory"
        if not memory_dir.exists():
            return  # KB not initialized yet - skip silently

        date_str = (prompt_log.created_at or datetime.utcnow()).strftime("%Y-%m-%d")
        prompt_id_short = str(prompt_log.id).replace("-", "")[:8]
        filename = f"{date_str}_{prompt_log.type}_{prompt_id_short}.md"
        file_path = memory_dir / filename

        # REGRA #0 - never overwrite
        if file_path.exists():
            return

        cost = prompt_log.total_cost_usd or 0.0
        content = (
            f"# {prompt_log.type} — {date_str}\n\n"
            f"**Model:** {prompt_log.ai_model_used or 'unknown'}\n"
            f"**Status:** {prompt_log.status or 'unknown'}\n"
            f"**Tokens:** {prompt_log.input_tokens or 0} in / "
            f"{prompt_log.output_tokens or 0} out | "
            f"Cost: ${cost:.4f}\n\n"
            f"## System Prompt\n\n{prompt_log.system_prompt or ''}\n\n"
            f"## User Prompt\n\n{prompt_log.user_prompt or ''}\n\n"
            f"## Response\n\n{prompt_log.response or ''}\n"
        )

        file_path.write_text(content, encoding="utf-8")
        logger.debug(f"Saved prompt log to satellite: {filename}")

    except Exception as e:
        logger.warning(f"Failed to save prompt to satellite (non-critical): {e}")


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

        # PROMPT #205 - Initialize utility node executor
        self.utility_executor = UtilityNodeExecutor(
            redis_client=self.rate_limiter.redis if self.rate_limiter else None,
            rag_service=self.rag_service,
            db=self.db,
            cache_service=self.cache_service,
        )

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
                        ollama_timeout = float(os.getenv("OLLAMA_TIMEOUT", "600"))  # 10 min default (aligned with model timeout)
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

                    elif provider_key == "claudio":
                        # PROMPT #246 - Claudio local proxy (Anthropic-compatible API, no API key)
                        from anthropic import AsyncAnthropic
                        claudio_base = os.getenv("CLAUDIO_BASE_URL", "http://localhost:8001")
                        self.clients["claudio"] = AsyncAnthropic(
                            api_key=model.api_key or "not-needed",
                            base_url=claudio_base
                        )
                        logger.info(f"✅ Claudio (AsyncAnthropic) client initialized: {claudio_base} (from model: {model.name})")
                        initialized_providers.add("claudio")

            except Exception as e:
                logger.error(f"❌ Failed to initialize {model.provider} client: {e}")

        logger.info(f"📊 Initialized async providers: {list(initialized_providers)}")

    def _get_chain_models(self, usage_type: UsageType) -> Optional[List[Dict]]:
        """
        PROMPT #122 - Get ordered list of model configs from AIFlowChain.
        PROMPT #288 - Cached for 60s to avoid 5-7 DB queries per execute().
        Returns None if no chain exists or chain is inactive/empty.
        """
        global _chain_config_cache, _chain_config_cache_ts

        now = time.time()
        cache_key = usage_type

        # Check in-memory cache
        if now - _chain_config_cache_ts < _MODEL_CACHE_TTL and cache_key in _chain_config_cache:
            return _chain_config_cache[cache_key]

        chain = self.db.query(AIFlowChain).filter(
            AIFlowChain.usage_type == usage_type,
            AIFlowChain.is_active == True
        ).first()

        if not chain or not chain.chain:
            _chain_config_cache[cache_key] = None
            _chain_config_cache_ts = now
            return None

        model_configs = []
        for model_id in chain.chain:
            db_model = self._get_cached_model(model_id)

            if db_model and db_model.provider.lower() in self.clients:
                provider = db_model.provider.lower()
                model_name = db_model.config.get("model_id", "")
                model_configs.append({
                    "provider": provider,
                    "model": model_name if model_name else self._get_default_model(provider),
                    "max_tokens": db_model.config.get("max_tokens", 4096),
                    "temperature": db_model.config.get("temperature", 0.7),
                    # PROMPT #221 - Sampling parameters for Ollama
                    "top_p": db_model.config.get("top_p"),
                    "top_k": db_model.config.get("top_k"),
                    "db_model_id": str(db_model.id),
                    "db_model_name": db_model.name,
                    "api_key": db_model.api_key,  # PROMPT #127 - Pass API key for chain execution
                    "rate_limit_requests": db_model.rate_limit_requests,
                    "rate_limit_window_seconds": db_model.rate_limit_window_seconds,
                    # PROMPT #207 - Per-model timeout
                    "timeout_seconds": db_model.timeout_seconds,
                    # PROMPT #228 - Concurrency limit
                    "max_concurrent_requests": db_model.max_concurrent_requests,
                    # PROMPT #289 - Ollama context/batch/keep_alive from model config
                    "context_length": db_model.config.get("context_length"),
                    "num_batch": db_model.config.get("num_batch"),
                    "keep_alive": db_model.config.get("keep_alive"),
                })
            else:
                logger.warning(
                    f"⚠️  Skipping model {model_id} in chain: "
                    f"{'não encontrado ou inativo' if not db_model else 'provedor não inicializado'}"
                )

        result = model_configs if model_configs else None
        _chain_config_cache[cache_key] = result
        _chain_config_cache_ts = now
        return result

    def _get_cached_model(self, model_id) -> Optional[AIModel]:
        """PROMPT #288 - Get AI model with in-memory caching (60s TTL)."""
        global _model_config_cache, _model_config_cache_ts

        now = time.time()
        model_id_str = str(model_id)

        if now - _model_config_cache_ts < _MODEL_CACHE_TTL and model_id_str in _model_config_cache:
            return _model_config_cache[model_id_str]

        # Refresh full cache if expired
        if now - _model_config_cache_ts >= _MODEL_CACHE_TTL:
            models = self.db.query(AIModel).filter(AIModel.is_active == True).all()
            _model_config_cache = {str(m.id): m for m in models}
            _model_config_cache_ts = now

        return _model_config_cache.get(model_id_str)

    def _get_chain_utility_nodes(self, usage_type: UsageType) -> List[Dict]:
        """
        PROMPT #205 - Get utility nodes from AIFlowChain for a usage_type.
        Returns empty list if no chain or no utility nodes configured.
        """
        chain = self.db.query(AIFlowChain).filter(
            AIFlowChain.usage_type == usage_type,
            AIFlowChain.is_active == True
        ).first()

        if not chain or not chain.utility_nodes:
            return []

        return [n for n in chain.utility_nodes if n.get("enabled", True)]

    # PROMPT #231 - Provider speed profiles (tokens per second estimates)
    PROVIDER_SPEED_PROFILES = {
        "ollama": 15,
        "anthropic": 80,
        "openai": 60,
        "google": 70,
    }

    def _resolve_timeout(self, model_config: Dict, utility_nodes: List[Dict],
                         provider: str = None, estimated_tokens: int = None) -> float:
        """
        PROMPT #207 - Resolve timeout using 3-layer hierarchy:
          1. Timeout Node (from diagram utility nodes) - highest priority
          2. AI Model timeout_seconds field - middle priority
          3. SystemSettings default_api_timeout_seconds - fallback

        PROMPT #231 - Enhanced with adaptive timeout:
          After resolving the static timeout, calculates an adaptive timeout
          based on estimated output tokens and provider speed.
          Uses max(static, adaptive) to never reduce below configured value.

        Returns timeout in seconds (float).
        """
        # Layer 1: Timeout Node from diagram
        for node in utility_nodes:
            if node.get("type") == "timeout" and node.get("enabled", True):
                node_timeout = node.get("config", {}).get("timeout_seconds")
                if node_timeout is not None:
                    timeout = float(node_timeout)
                    logger.info(f"⏱️ Timeout from diagram node: {timeout}s")
                    return timeout

        # Layer 2: AI Model timeout_seconds field
        static_timeout = None
        model_timeout = model_config.get("timeout_seconds")
        if model_timeout is not None:
            static_timeout = float(model_timeout)
            logger.info(f"⏱️ Timeout from AI Model: {static_timeout}s")

        # Layer 3: SystemSettings default
        if static_timeout is None:
            try:
                setting = self.db.query(SystemSettings).filter(
                    SystemSettings.key == "default_api_timeout_seconds"
                ).first()
                if setting and setting.value:
                    static_timeout = float(setting.value)
                    logger.info(f"⏱️ Timeout from system settings: {static_timeout}s")
            except Exception as e:
                logger.warning(f"⚠️ Failed to read default timeout from settings: {e}")

        if static_timeout is None:
            static_timeout = 120.0

        # PROMPT #231 - Adaptive timeout based on estimated tokens and provider speed
        if estimated_tokens and provider:
            speed = self.PROVIDER_SPEED_PROFILES.get(provider, 50)
            adaptive_timeout = (estimated_tokens / speed) * 1.5 + 5.0
            if adaptive_timeout > static_timeout:
                logger.info(
                    f"⏱️ Adaptive timeout: {adaptive_timeout:.1f}s "
                    f"(est {estimated_tokens} tokens @ {speed} tok/s for {provider}) "
                    f"> static {static_timeout}s"
                )
                return adaptive_timeout

        return static_timeout

    # PROMPT #232 - RAG relevance scoring
    # Type boosts for prompt_generation usage
    _RAG_TYPE_BOOSTS = {
        "prompt_generation": {"business_rule": 0.15, "interview_answer": 0.10, "spec": 0.05},
        "task_execution": {"spec": 0.15, "code_context": 0.10},
    }

    def _score_and_filter_rag_results(
        self,
        rag_results: List[Dict],
        query: str,
        usage_type: str,
        min_score: float = 0.3,
    ) -> List[Dict]:
        """
        PROMPT #232 - Score RAG results by combined relevance and filter low-quality ones.

        Combined score = embedding_similarity * 0.6 + keyword_overlap * 0.3 + type_boost * 0.1
        """
        type_boosts = self._RAG_TYPE_BOOSTS.get(usage_type, {})

        scored = []
        for r in rag_results:
            sim = r.get("similarity", 0.0)
            kw = self._keyword_overlap_score(r.get("content", ""), query)
            doc_type = r.get("type", "")
            boost = type_boosts.get(doc_type, 0.0)

            combined = sim * 0.6 + kw * 0.3 + boost
            r["relevance_score"] = round(combined, 3)
            if combined >= min_score:
                scored.append(r)

        scored.sort(key=lambda x: x["relevance_score"], reverse=True)
        return scored

    @staticmethod
    def _keyword_overlap_score(content: str, query: str) -> float:
        """Fraction of query words that appear in content (case-insensitive)."""
        if not query:
            return 0.0
        query_words = set(query.lower().split())
        content_words = set(content.lower().split())
        if not query_words:
            return 0.0
        return len(query_words & content_words) / len(query_words)

    # PROMPT #288 - Cache for choose_model results
    _choose_model_cache: Dict[str, Dict] = {}
    _choose_model_cache_ts: float = 0

    def choose_model(self, usage_type: UsageType) -> Dict[str, any]:
        """
        Escolhe modelo dinamicamente do banco baseado no usage_type
        PROMPT #51 - Dynamic AI Model Integration
        PROMPT #122 - AI Flow chain check added
        PROMPT #288 - Cached for 60s to avoid redundant DB queries

        Args:
            usage_type: Tipo de uso (prompt_generation, task_execution, etc)

        Returns:
            Dicionário com provider, model, max_tokens, temperature e config completo

        Raises:
            ValueError: Se nenhum modelo estiver disponível para o usage_type
        """
        now = time.time()
        if (now - self._choose_model_cache_ts < _MODEL_CACHE_TTL
                and usage_type in self._choose_model_cache):
            return self._choose_model_cache[usage_type]

        # 1. Buscar modelo ativo do banco com o usage_type específico
        db_model = self.db.query(AIModel).filter(
            AIModel.usage_type == usage_type,
            AIModel.is_active == True
        ).order_by(AIModel.updated_at.desc()).first()

        def _cache_and_return(result: Dict) -> Dict:
            """Store result in cache and return."""
            self._choose_model_cache[usage_type] = result
            self._choose_model_cache_ts = time.time()
            return result

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

                return _cache_and_return({
                    "provider": provider,
                    "model": model_name if model_name else self._get_default_model(provider),
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    # PROMPT #221 - Sampling parameters for Ollama
                    "top_p": db_model.config.get("top_p"),
                    "top_k": db_model.config.get("top_k"),
                    "db_model_id": str(db_model.id),
                    "db_model_name": db_model.name,
                    # PROMPT #152 - Rate limiting config
                    "rate_limit_requests": db_model.rate_limit_requests,
                    "rate_limit_window_seconds": db_model.rate_limit_window_seconds,
                    # PROMPT #207 - Per-model timeout
                    "timeout_seconds": db_model.timeout_seconds,
                    # PROMPT #228 - Concurrency limit
                    "max_concurrent_requests": db_model.max_concurrent_requests,
                    # PROMPT #289 - Ollama context/batch/keep_alive from model config
                    "context_length": db_model.config.get("context_length"),
                    "num_batch": db_model.config.get("num_batch"),
                    "keep_alive": db_model.config.get("keep_alive"),
                })
            else:
                logger.warning(
                    f"⚠️  Model '{db_model.name}' configured for {usage_type} but "
                    f"provedor '{provider}' não inicializado"
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

            return _cache_and_return({
                "provider": provider,
                "model": model_name if model_name else self._get_default_model(provider),
                "max_tokens": max_tokens,
                "temperature": temperature,
                # PROMPT #221 - Sampling parameters for Ollama
                "top_p": fallback_model.config.get("top_p"),
                "top_k": fallback_model.config.get("top_k"),
                "db_model_id": str(fallback_model.id),
                "db_model_name": fallback_model.name,
                # PROMPT #152 - Rate limiting config
                "rate_limit_requests": fallback_model.rate_limit_requests,
                "rate_limit_window_seconds": fallback_model.rate_limit_window_seconds,
                # PROMPT #207 - Per-model timeout
                "timeout_seconds": fallback_model.timeout_seconds,
                # PROMPT #228 - Concurrency limit
                "max_concurrent_requests": fallback_model.max_concurrent_requests,
                # PROMPT #289 - Ollama context/batch/keep_alive from model config
                "context_length": fallback_model.config.get("context_length"),
                "num_batch": fallback_model.config.get("num_batch"),
                "keep_alive": fallback_model.config.get("keep_alive"),
            })

        # 3. Fallback: tentar diagrama 'general' (chain) se existir
        if usage_type != "general":
            general_chain = self._get_chain_models("general")
            if general_chain:
                logger.info(
                    f"🔗 choose_model fallback: no settings model, using first model from general chain"
                )
                return _cache_and_return(general_chain[0])

        # 4. Nenhum modelo disponível
        raise ValueError(
            f"Nenhum modelo de IA ativo configurado para '{usage_type}'. "
            f"Configure um modelo de IA na página /ai-models."
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
                        # PROMPT #221 - Sampling parameters for Ollama
                        "top_p": db_model.config.get("top_p"),
                        "top_k": db_model.config.get("top_k"),
                        "db_model_id": str(db_model.id),
                        "db_model_name": db_model.name,
                        # PROMPT #152 - Rate limiting config
                        "rate_limit_requests": db_model.rate_limit_requests,
                        "rate_limit_window_seconds": db_model.rate_limit_window_seconds,
                        # PROMPT #228 - Concurrency limit
                        "max_concurrent_requests": db_model.max_concurrent_requests,
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
        rag_similarity_threshold: float = 0.7,
        # PROMPT #296 - Observability
        trace_id: Optional[str] = None
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
        # PROMPT #124 - Chain tracking context (used by AIExecution logging below)
        _chain_ctx = {"usage_type": None, "position": None, "total": None, "fallback": False, "source": None}

        # PROMPT #123 - Chain-based fallback: try each model in the chain before failing
        # Try chains in order: specific usage_type chain → general chain → choose_model()
        chains_to_try = []

        # 1. Chain for the specific usage_type
        chain_models = self._get_chain_models(usage_type)
        if chain_models and len(chain_models) > 0:
            chains_to_try.append(("specific", usage_type, chain_models))

        # 2. Chain for 'general' as fallback (only if usage_type is not already general)
        if usage_type != "general":
            general_chain_models = self._get_chain_models("general")
            if general_chain_models and len(general_chain_models) > 0:
                chains_to_try.append(("general", "general", general_chain_models))

        # PROMPT #288 - Skip classification for deterministic/template prompts
        # Callers pass metadata={"skip_context_build": True} to avoid wasted work
        _skip_context = metadata.get("skip_context_build", False) if metadata else False

        # PROMPT #235 - General Operation Flow: classify + build context as universal fallback
        _general_classification = None
        if not _skip_context and not (metadata and metadata.get("query_classification")):
            try:
                from app.services.general_query_classifier import classify_general_query
                _general_classification = classify_general_query(messages, system_prompt)
                if metadata is None:
                    metadata = {}
                metadata["query_classification"] = _general_classification
            except Exception as _gc_err:
                logger.warning(f"General classifier skipped: {_gc_err}")

        # PROMPT #235 - Apply dynamic context builder when general classifier ran
        _pre_built_messages = messages
        _pre_built_system = system_prompt
        if _general_classification and not _skip_context:
            try:
                from app.services.general_context_builder import build_context
                _ctx_result = build_context(messages, system_prompt, _general_classification)
                _pre_built_messages = _ctx_result["messages"]
                _pre_built_system = _ctx_result["system_prompt"]
                if max_tokens is None:
                    max_tokens = _ctx_result["recommended_max_tokens"]
            except Exception as _cb_err:
                logger.warning(f"Context builder skipped: {_cb_err}")

        # PROMPT #205 - Load utility nodes for this usage_type
        _utility_nodes = self._get_chain_utility_nodes(usage_type)
        _utility_pre_done = False
        _effective_messages = list(_pre_built_messages)
        _effective_system_prompt = _pre_built_system

        # PROMPT #206 - Shared context for utility node overrides
        _util_context = {}

        if _utility_nodes:
            logger.info(f"🔧 Utility nodes loaded: {[n['type'] for n in _utility_nodes]}")
            # PROMPT #206 - Pass model caps so utility nodes can't exceed them
            _model_rate_caps = {}
            _model_max_tokens = None
            if chains_to_try:
                # Use first model in chain as the ceiling
                first_model = chains_to_try[0][2][0] if chains_to_try[0][2] else {}
                _model_rate_caps = {
                    "rate_limit_requests": first_model.get("rate_limit_requests"),
                    "rate_limit_window_seconds": first_model.get("rate_limit_window_seconds"),
                }
                _model_max_tokens = first_model.get("max_tokens")
            # PROMPT #231 - Calculate total chain length for router node
            _chain_total = sum(len(c[2]) for c in chains_to_try) if chains_to_try else 1
            _util_context = {
                "usage_type": usage_type,
                "project_id": str(project_id) if project_id else None,
                "model_rate_caps": _model_rate_caps,
                "model_max_tokens": _model_max_tokens,
                "_chain_total": _chain_total,
                "_original_system_prompt": system_prompt,  # PROMPT #235 - for general classifier in router
            }
            # PROMPT #231 - Pass query classification from metadata to utility context
            if metadata and "query_classification" in metadata:
                _util_context["query_classification"] = metadata["query_classification"]
            early_result, _effective_messages, _effective_system_prompt = (
                self.utility_executor.pre_process(
                    _utility_nodes, messages, system_prompt, _util_context
                )
            )
            _utility_pre_done = True

            if early_result is not None:
                logger.info(f"⚡ Utility node short-circuit: {early_result.get('model', 'unknown')}")
                return early_result

            # Handle rate_limit_wait from utility rate limiter node
            if _util_context.get("_rate_limit_wait"):
                wait_time = _util_context["_rate_limit_wait"]
                logger.info(f"⏳ Utility Rate Limiter: waiting {wait_time:.1f}s")
                await asyncio.sleep(wait_time)

            # PROMPT #207 - Resolve timeout from diagram node and store in context for chain path
            for node in _utility_nodes:
                if node.get("type") == "timeout" and node.get("enabled", True):
                    node_timeout = node.get("config", {}).get("timeout_seconds")
                    if node_timeout is not None:
                        _util_context["_override_timeout"] = float(node_timeout)
                        break

        # PROMPT #205 - Get retry config from utility nodes
        _retry_config = UtilityNodeExecutor.get_retry_config(_utility_nodes) if _utility_nodes else None

        if chains_to_try:
            last_error = None
            _skip_providers = set()  # PROMPT #229 - Smart fallback: skip providers on OOM

            # PROMPT #231 - Apply router start_index to skip cheap models for complex queries
            _router_start_index = _util_context.get("_router_start_index", 0) if _util_context else 0
            if _router_start_index > 0:
                logger.info(f"🔀 Router: skipping first {_router_start_index} model(s) in chain")

            for chain_source, chain_usage, chain_model_list in chains_to_try:
                for chain_idx, chain_model_config in enumerate(chain_model_list):
                    # PROMPT #231 - Skip models before router start index (first chain only)
                    if chain_source == "specific" and chain_idx < _router_start_index:
                        logger.info(
                            f"🔀 Router skip [{chain_source}] {chain_idx+1}/{len(chain_model_list)}: "
                            f"{chain_model_config['db_model_name']} (below router start_index)"
                        )
                        continue
                    # PROMPT #229 - Smart fallback: skip providers flagged by previous failures
                    if chain_model_config.get("provider") in _skip_providers:
                        logger.warning(
                            f"🔗 Chain skip [{chain_source}]: {chain_model_config['db_model_name']} "
                            f"(provider {chain_model_config['provider']} flagged - GPU thrashing prevention)"
                        )
                        continue
                    _chain_ctx = {
                        "usage_type": chain_usage,
                        "position": chain_idx + 1,
                        "total": len(chain_model_list),
                        "fallback": chain_idx > 0 or chain_source == "general",
                        "source": chain_source,
                    }
                    try:
                        logger.info(
                            f"🔗 Chain attempt [{chain_source}] {chain_idx+1}/{len(chain_model_list)}: "
                            f"{chain_model_config['db_model_name']} ({chain_model_config['provider']}/{chain_model_config['model']})"
                        )
                        # PROMPT #124 - Broadcast chain attempt start
                        _safe_broadcast("chain_attempt_start", {
                            "usage_type": usage_type,
                            "chain_source": chain_source,
                            "model_id": chain_model_config.get("db_model_id", ""),
                            "model_name": chain_model_config["db_model_name"],
                            "provider": chain_model_config["provider"],
                            "chain_position": chain_idx + 1,
                            "chain_total": len(chain_model_list),
                        })
                        result = await self._execute_with_config(
                            model_config=chain_model_config,
                            messages=_effective_messages,
                            system_prompt=_effective_system_prompt,
                            max_tokens=max_tokens,
                            overrides=_util_context if _util_context else None,
                        )
                        result["chain_position"] = chain_idx + 1
                        result["chain_total"] = len(chain_model_list)
                        result["chain_fallback"] = chain_idx > 0 or chain_source == "general"
                        result["chain_source"] = chain_source
                        # PROMPT #124 - Broadcast chain attempt success
                        _safe_broadcast("chain_attempt_success", {
                            "usage_type": usage_type,
                            "model_id": chain_model_config.get("db_model_id", ""),
                            "model_name": chain_model_config["db_model_name"],
                            "provider": chain_model_config["provider"],
                            "chain_position": chain_idx + 1,
                            "execution_time_ms": result.get("usage", {}).get("execution_time_ms"),
                            "total_tokens": result.get("usage", {}).get("total_tokens"),
                        })
                        # PROMPT #124 - Log successful chain execution
                        try:
                            chain_exec_log = AIExecution(
                                ai_model_id=UUID(chain_model_config["db_model_id"]) if chain_model_config.get("db_model_id") else None,
                                usage_type=usage_type,
                                input_messages=messages,
                                system_prompt=system_prompt,
                                response_content=result.get("content", ""),
                                input_tokens=result.get("usage", {}).get("input_tokens"),
                                output_tokens=result.get("usage", {}).get("output_tokens"),
                                total_tokens=result.get("usage", {}).get("total_tokens"),
                                provider=chain_model_config["provider"],
                                model_name=chain_model_config["model"],
                                temperature=str(chain_model_config.get("temperature", "")),
                                max_tokens=max_tokens if max_tokens else chain_model_config.get("max_tokens"),
                                execution_time_ms=result.get("usage", {}).get("execution_time_ms"),
                                created_at=datetime.utcnow(),
                                chain_usage_type=chain_usage,
                                chain_position=chain_idx + 1,
                                chain_total=len(chain_model_list),
                                chain_fallback=chain_idx > 0 or chain_source == "general",
                                chain_source=chain_source,
                            )
                            self.db.add(chain_exec_log)
                            self.db.commit()
                        except Exception as log_err:
                            logger.error(f"Failed to log chain execution: {log_err}")
                            self.db.rollback()

                        # PROMPT #125 - Log to Prompt table for /prompts page (chain path)
                        if project_id:
                            try:
                                user_prompt_text = ""
                                for msg in reversed(messages):
                                    if msg.get("role") == "user":
                                        user_prompt_text = msg.get("content", "")
                                        break
                                input_tokens = result.get("usage", {}).get("input_tokens", 0)
                                output_tokens = result.get("usage", {}).get("output_tokens", 0)
                                # PROMPT #233 - CF-1 fix: use dynamic pricing instead of hardcoded Claude pricing
                                from app.utils.pricing import calculate_cost
                                _chain_model_name = chain_model_config.get('model', '')
                                _cost_info = calculate_cost(input_tokens, output_tokens, _chain_model_name)
                                cost = _cost_info["total_cost"]
                                prompt_metadata = metadata or {}
                                if task_id:
                                    prompt_metadata["task_id"] = str(task_id)
                                prompt_log = Prompt(
                                    project_id=project_id,
                                    created_from_interview_id=interview_id,
                                    content=result.get("content", ""),
                                    type=usage_type,
                                    ai_model_used=f"{chain_model_config['provider']}/{chain_model_config['model']}",
                                    system_prompt=system_prompt,
                                    user_prompt=user_prompt_text,
                                    response=result.get("content", ""),
                                    input_tokens=input_tokens,
                                    output_tokens=output_tokens,
                                    total_cost_usd=cost,
                                    execution_time_ms=result.get("usage", {}).get("execution_time_ms"),
                                    execution_metadata=prompt_metadata,
                                    status="success",
                                    created_at=datetime.utcnow(),
                                    updated_at=datetime.utcnow()
                                )
                                self.db.add(prompt_log)
                                self.db.commit()
                                logger.info(f"✅ Logged prompt to audit (chain path): {prompt_log.id}")
                                _save_prompt_to_satellite(self.db, prompt_log)  # PROMPT #235
                            except Exception as prompt_error:
                                logger.error(f"⚠️  Failed to log prompt (chain path): {prompt_error}")
                                self.db.rollback()

                        # PROMPT #205 - Post-process with utility nodes (chain path)
                        if _utility_nodes and _utility_pre_done:
                            _util_context_post = {
                                "usage_type": usage_type,
                                "model_name": chain_model_config.get("model", ""),
                                "provider": chain_model_config.get("provider", ""),
                                "db_model_id": chain_model_config.get("db_model_id", ""),
                                "db_model_name": chain_model_config.get("db_model_name", ""),
                            }
                            result = self.utility_executor.post_process(
                                _utility_nodes, result, _effective_messages,
                                _effective_system_prompt, _util_context_post
                            )
                            # Handle validator retry
                            if result.get("retry_needed") and _retry_config:
                                max_retries = _retry_config["max_retries"]
                                backoff_base = _retry_config["backoff_base_ms"] / 1000.0
                                backoff_mult = _retry_config["backoff_multiplier"]
                                for retry_attempt in range(max_retries):
                                    wait = backoff_base * (backoff_mult ** retry_attempt)
                                    logger.info(
                                        f"🔄 Retry Node: attempt {retry_attempt+1}/{max_retries} "
                                        f"(waiting {wait:.1f}s, reason: {result.get('validation_error', 'unknown')})"
                                    )
                                    await asyncio.sleep(wait)
                                    result = await self._execute_with_config(
                                        model_config=chain_model_config,
                                        messages=_effective_messages,
                                        system_prompt=_effective_system_prompt,
                                        max_tokens=max_tokens,
                                        overrides=_util_context if _util_context else None,
                                    )
                                    result = self.utility_executor.post_process(
                                        _utility_nodes, result, _effective_messages,
                                        _effective_system_prompt, _util_context_post
                                    )
                                    if not result.get("retry_needed"):
                                        logger.info(f"✅ Retry Node: success on attempt {retry_attempt+1}")
                                        break
                                else:
                                    logger.warning(f"⚠️ Retry Node: all {max_retries} retries exhausted")

                        # PROMPT #229 - Attach observability metrics
                        if _util_context.get("_rag_metrics"):
                            result["rag_metrics"] = _util_context["_rag_metrics"]

                        # PROMPT #235 - General response validator as default safety net
                        # Only runs if no validator utility node already handled it
                        _has_validator_node = any(
                            n.get("type") == "validator" and n.get("enabled", True)
                            for n in (_utility_nodes or [])
                        )
                        if not _has_validator_node and not result.get("error"):
                            try:
                                from app.services.general_response_validator import validate_response
                                _val = validate_response(
                                    result.get("content", ""),
                                    _general_classification,
                                    _effective_messages,
                                )
                                result["general_validation"] = {
                                    "confidence": _val["confidence"],
                                    "issues": _val["issues"],
                                }
                                if _val["should_escalate"]:
                                    logger.warning(
                                        f"General validator: escalation recommended "
                                        f"({_val['escalation_reason']})"
                                    )
                                    # Continue to next model in chain instead of returning
                                    last_error = Exception(_val["escalation_reason"])
                                    continue
                            except Exception as _gv_err:
                                logger.warning(f"General validator skipped: {_gv_err}")

                        return result
                    except Exception as e:
                        last_error = e
                        # PROMPT #229 - Classify error for smart fallback
                        from app.services.error_classifier import classify_error
                        _error_class = classify_error(e)

                        if _error_class == "oom" and chain_model_config.get("provider") == "ollama":
                            logger.warning(
                                f"🧠 OOM on Ollama model {chain_model_config['db_model_name']}. "
                                f"Skipping ALL remaining Ollama models to prevent GPU thrashing."
                            )
                            _skip_providers.add("ollama")

                        if _error_class == "permanent":
                            logger.warning(
                                f"🚫 Permanent error on {chain_model_config['db_model_name']}: "
                                f"{str(e)[:100]}. Skipping to next model."
                            )
                            # Fall through to chain fallback (skip retry for permanent errors)
                        elif _retry_config:
                            # PROMPT #205 - Handle retry on transient errors (chain path)
                            # PROMPT #229 - Only retry transient/oom errors, not permanent
                            error_str = str(e).lower()
                            retry_on = _retry_config.get("retry_on", [])
                            should_retry = any(
                                trigger in error_str
                                for trigger in retry_on
                            )
                            if should_retry:
                                max_retries = _retry_config["max_retries"]
                                backoff_base = _retry_config["backoff_base_ms"] / 1000.0
                                backoff_mult = _retry_config["backoff_multiplier"]
                                for retry_attempt in range(max_retries):
                                    wait = backoff_base * (backoff_mult ** retry_attempt)
                                    logger.info(
                                        f"🔄 Retry Node (error): attempt {retry_attempt+1}/{max_retries} "
                                        f"(waiting {wait:.1f}s, error: {str(e)[:100]})"
                                    )
                                    await asyncio.sleep(wait)
                                    try:
                                        result = await self._execute_with_config(
                                            model_config=chain_model_config,
                                            messages=_effective_messages,
                                            system_prompt=_effective_system_prompt,
                                            max_tokens=max_tokens,
                                            overrides=_util_context if _util_context else None,
                                        )
                                        logger.info(f"✅ Retry Node (error): success on attempt {retry_attempt+1}")
                                        # Post-process the retried result
                                        if _utility_nodes and _utility_pre_done:
                                            _util_context_post = {
                                                "usage_type": usage_type,
                                                "model_name": chain_model_config.get("model", ""),
                                                "provider": chain_model_config.get("provider", ""),
                                            }
                                            result = self.utility_executor.post_process(
                                                _utility_nodes, result, _effective_messages,
                                                _effective_system_prompt, _util_context_post
                                            )
                                        return result
                                    except Exception as retry_err:
                                        logger.warning(f"🔄 Retry Node (error): attempt {retry_attempt+1} failed: {retry_err}")
                                        last_error = retry_err
                                        continue

                        logger.warning(
                            f"🔗 Chain fallback [{chain_source}]: {chain_model_config['db_model_name']} failed: {e}. "
                            f"{'Trying next model...' if chain_idx < len(chain_model_list)-1 else 'No more models in this chain.'}"
                        )
                        # PROMPT #124 - Broadcast chain attempt failed
                        next_model = chain_model_list[chain_idx + 1]["db_model_name"] if chain_idx < len(chain_model_list) - 1 else None
                        _safe_broadcast("chain_attempt_failed", {
                            "usage_type": usage_type,
                            "model_id": chain_model_config.get("db_model_id", ""),
                            "model_name": chain_model_config["db_model_name"],
                            "provider": chain_model_config["provider"],
                            "chain_position": chain_idx + 1,
                            "chain_total": len(chain_model_list),
                            "error": str(e)[:200],
                            "next_model": next_model,
                        })
                        # PROMPT #124 - Log failed chain attempt
                        try:
                            chain_fail_log = AIExecution(
                                ai_model_id=UUID(chain_model_config["db_model_id"]) if chain_model_config.get("db_model_id") else None,
                                usage_type=usage_type,
                                input_messages=messages,
                                system_prompt=system_prompt,
                                response_content=None,
                                provider=chain_model_config["provider"],
                                model_name=chain_model_config["model"],
                                temperature=str(chain_model_config.get("temperature", "")),
                                max_tokens=max_tokens if max_tokens else chain_model_config.get("max_tokens"),
                                error_message=str(e),
                                created_at=datetime.utcnow(),
                                chain_usage_type=chain_usage,
                                chain_position=chain_idx + 1,
                                chain_total=len(chain_model_list),
                                chain_fallback=chain_idx > 0 or chain_source == "general",
                                chain_source=chain_source,
                            )
                            self.db.add(chain_fail_log)
                            self.db.commit()
                        except Exception as log_err:
                            logger.error(f"Failed to log chain failure: {log_err}")
                            self.db.rollback()
                        continue
                logger.warning(f"🔗 All models in {chain_source} chain for '{chain_usage}' failed, trying next chain...")

            # All chains exhausted — fall through to choose_model() as last resort
            logger.warning(
                f"🔗 All chain models exhausted for '{usage_type}'. "
                f"Falling back to choose_model()..."
            )

        # No chain or all chains failed — use choose_model() (settings model → general model)
        model_config = self.choose_model(usage_type)
        provider = model_config["provider"]
        model_name = model_config["model"]

        # Usar max_tokens do banco se não foi especificado
        tokens_limit = max_tokens if max_tokens is not None else model_config["max_tokens"]
        temperature = model_config["temperature"]
        # PROMPT #221 - Sampling parameters for Ollama
        _top_p = model_config.get("top_p")
        _top_k = model_config.get("top_k")
        # PROMPT #289 - Ollama context/batch/keep_alive from model config
        _num_ctx = model_config.get("context_length")
        _num_batch = model_config.get("num_batch")
        _keep_alive = model_config.get("keep_alive")

        # PROMPT #205 - If utility pre-process wasn't done yet (no chain path), do it now
        if _utility_nodes and not _utility_pre_done:
            # PROMPT #206 - Pass model caps (rate limit + max_tokens)
            _util_context = {
                "usage_type": usage_type,
                "project_id": str(project_id) if project_id else None,
                "model_name": model_name,
                "provider": provider,
                "temperature": temperature,
                "model_max_tokens": model_config.get("max_tokens"),
                "model_rate_caps": {
                    "rate_limit_requests": model_config.get("rate_limit_requests"),
                    "rate_limit_window_seconds": model_config.get("rate_limit_window_seconds"),
                },
            }
            early_result, _effective_messages, _effective_system_prompt = (
                self.utility_executor.pre_process(
                    _utility_nodes, messages, system_prompt, _util_context
                )
            )
            _utility_pre_done = True
            if early_result is not None:
                logger.info(f"⚡ Utility node short-circuit (no-chain): {early_result.get('model', 'unknown')}")
                return early_result
            if _util_context.get("_rate_limit_wait"):
                wait_time = _util_context["_rate_limit_wait"]
                logger.info(f"⏳ Utility Rate Limiter (no-chain): waiting {wait_time:.1f}s")
                await asyncio.sleep(wait_time)

        # PROMPT #206 - Apply utility node overrides to max_tokens and temperature
        if _util_context.get("_override_max_tokens") is not None:
            tokens_limit = _util_context["_override_max_tokens"]
            logger.info(f"🔧 Override max_tokens → {tokens_limit}")
        if _util_context.get("_override_temperature") is not None:
            temperature = _util_context["_override_temperature"]
            logger.info(f"🔧 Override temperature → {temperature}")

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

        if enable_rag and self.rag_service and _effective_messages:
            try:
                # Extract query from last user message
                query = None
                for msg in reversed(_effective_messages):
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
                        # PROMPT #232 - Score and filter RAG results by relevance
                        scored_results = self._score_and_filter_rag_results(
                            rag_results, query, usage_type
                        )
                        rag_metrics["rag_hit"] = True
                        rag_metrics["rag_results_count"] = len(scored_results)
                        rag_metrics["rag_filtered_out"] = len(rag_results) - len(scored_results)
                        rag_metrics["rag_top_similarity"] = scored_results[0]["similarity"] if scored_results else None

                        if scored_results:
                            # Format RAG context for injection (with relevance scores)
                            rag_context_text = "\n".join([
                                f"[{i+1}] (relevance: {r.get('relevance_score', r['similarity']):.2f})\n{r['content']}"
                                for i, r in enumerate(scored_results)
                            ])

                            # PROMPT #233 - LI-3 fix: merge RAG context into last user message
                            # instead of creating a separate user message (which breaks alternating roles for OpenAI/Gemini)
                            if _effective_messages and _effective_messages[-1].get("role") == "user":
                                _effective_messages[-1]["content"] = (
                                    f"[RELEVANT CONTEXT FROM KNOWLEDGE BASE]\n\n{rag_context_text}\n\n[END CONTEXT]\n\n"
                                    + _effective_messages[-1]["content"]
                                )
                            else:
                                # Fallback: insert as separate message if last isn't user
                                rag_message = {
                                    "role": "user",
                                    "content": f"[RELEVANT CONTEXT FROM KNOWLEDGE BASE]\n\n{rag_context_text}\n\n[END CONTEXT]"
                                }
                                _effective_messages.insert(-1, rag_message)
                            rag_context_injected = True

                        logger.info(
                            f"🔍 RAG scored: {len(rag_results)} → {len(scored_results)} results "
                            f"({rag_metrics['rag_filtered_out']} discarded, "
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
                "prompt": json.dumps(_effective_messages),  # Serialize messages for consistent hashing
                "system_prompt": _effective_system_prompt or "",
                "usage_type": usage_type,
                "temperature": temperature,
                "model": model_name,
            }

            # Try to get from cache
            cached_result = self.cache_service.get(cache_input)
            if cached_result:
                logger.info(f"✅ Cache HIT ({cached_result.get('cache_type')}) - Saved API call!")

                # PROMPT #168 - Console logging for cache hit
                console = get_console_logger()
                asyncio.create_task(console.log_ai_response(
                    model=f"{provider}/{model_name}",
                    response_preview=cached_result.get("response", "")[:300],
                    full_response=cached_result.get("response", "")[:10000],
                    tokens_used=0,
                    duration_ms=0,
                    project_id=project_id if project_id else None,
                    cache_hit=True,
                    trace_id=trace_id
                ))

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

        # PROMPT #228 - Concurrency control: acquire semaphore slot before API call
        _concurrency_sem = None
        _max_concurrent = model_config.get('max_concurrent_requests')
        if _max_concurrent:
            _concurrency_sem = _get_model_semaphore(model_config['db_model_id'], _max_concurrent)
            await _concurrency_sem.acquire()
            logger.info(
                f"🔒 Concurrency slot acquired for {model_config['db_model_name']} "
                f"(max: {_max_concurrent})"
            )

        # PROMPT #54 - Track execution time
        start_time = time.time()
        execution_log = None

        # PROMPT #159 - Store model_id for provider backoff extraction
        self._current_model_id = model_config.get("db_model_id")

        # PROMPT #168 - Console logging for real-time visibility
        console = get_console_logger()
        # Extract prompt preview for logging
        prompt_preview = ""
        for msg in _effective_messages:
            if msg.get("role") == "user":
                prompt_preview = msg.get("content", "")[:500]
                break

        # Log AI prompt being sent
        asyncio.create_task(console.log_ai_prompt(
            model=f"{provider}/{model_name}",
            usage_type=usage_type,
            prompt_preview=prompt_preview,
            full_prompt=json.dumps(_effective_messages, ensure_ascii=False)[:5000],
            project_id=project_id if project_id else None,
            trace_id=trace_id
        ))

        # PROMPT #207 - Resolve timeout using hierarchy: diagram node → model → settings
        _resolved_timeout = self._resolve_timeout(model_config, _utility_nodes)

        # PROMPT #217 - Create streaming callback for real-time console output
        import uuid as _uuid
        _stream_id = str(_uuid.uuid4())
        _model_label = f"{provider}/{model_name}"
        _stream_cb, _chunk_counter, _flush_cb = self._create_stream_callback(
            stream_id=_stream_id,
            model_label=_model_label,
            project_id=str(project_id) if project_id else None,
        )

        try:
            # PROMPT #217 - Try streaming first, fall back to non-streaming on error
            _streamed_ok = True  # PROMPT #276 - Track if streaming succeeded to avoid duplicate console log
            try:
                if provider == "anthropic":
                    result = await self._execute_anthropic_streaming(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        stream_callback=_stream_cb, flush_callback=_flush_cb,
                        timeout_seconds=_resolved_timeout
                    )
                elif provider == "openai":
                    result = await self._execute_openai_streaming(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        stream_callback=_stream_cb, flush_callback=_flush_cb,
                        timeout_seconds=_resolved_timeout
                    )
                elif provider == "google":
                    result = await self._execute_google_streaming(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        stream_callback=_stream_cb, flush_callback=_flush_cb,
                        timeout_seconds=_resolved_timeout
                    )
                elif provider == "ollama":
                    result = await self._execute_ollama_streaming(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        stream_callback=_stream_cb, flush_callback=_flush_cb,
                        timeout_seconds=_resolved_timeout, top_p=_top_p, top_k=_top_k,
                        num_ctx=_num_ctx, num_batch=_num_batch, keep_alive=_keep_alive
                    )
                elif provider == "cohere":
                    result = await self._execute_cohere_streaming(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        stream_callback=_stream_cb, flush_callback=_flush_cb,
                        timeout_seconds=_resolved_timeout
                    )
                elif provider == "claudio":
                    # PROMPT #246 - Claudio uses Anthropic protocol via local proxy
                    result = await self._execute_anthropic_streaming(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        stream_callback=_stream_cb, flush_callback=_flush_cb,
                        timeout_seconds=_resolved_timeout, client_key="claudio"
                    )
                else:
                    raise ValueError(f"Provedor desconhecido: {provider}")

                # Emit stream completion event
                asyncio.create_task(console.log_ai_streaming_chunk(
                    stream_id=_stream_id,
                    model=_model_label,
                    chunk_text="",
                    chunk_index=_chunk_counter[0] + 1,
                    is_complete=True,
                    accumulated_text=result.get("content", ""),
                    project_id=str(project_id) if project_id else None,
                ))

            except Exception as stream_err:
                # Fallback to non-streaming if streaming fails
                _streamed_ok = False
                logger.warning(f"⚠️ Streaming failed, falling back to non-streaming: {stream_err}")
                if provider == "anthropic":
                    result = await self._execute_anthropic(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        timeout_seconds=_resolved_timeout
                    )
                elif provider == "openai":
                    result = await self._execute_openai(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        timeout_seconds=_resolved_timeout
                    )
                elif provider == "google":
                    result = await self._execute_google(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        timeout_seconds=_resolved_timeout
                    )
                elif provider == "ollama":
                    result = await self._execute_ollama(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        timeout_seconds=_resolved_timeout, top_p=_top_p, top_k=_top_k,
                        num_ctx=_num_ctx, num_batch=_num_batch, keep_alive=_keep_alive
                    )
                elif provider == "cohere":
                    result = await self._execute_cohere(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        timeout_seconds=_resolved_timeout
                    )
                elif provider == "claudio":
                    # PROMPT #246 - Claudio non-streaming fallback
                    result = await self._execute_anthropic(
                        model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                        timeout_seconds=_resolved_timeout, client_key="claudio"
                    )
                else:
                    raise ValueError(f"Provedor desconhecido: {provider}")

            # Adicionar informações do modelo do banco na resposta
            result["db_model_id"] = model_config["db_model_id"]
            result["db_model_name"] = model_config["db_model_name"]
            result["rag_enhanced"] = rag_context_injected  # PROMPT #83

            # PROMPT #168/#276 - Console logging for AI response
            # Only log here if streaming failed (fallback path), to avoid duplicate with streaming completion log
            if not _streamed_ok:
                response_content = result.get("content", "")
                execution_time_ms_console = int((time.time() - start_time) * 1000)
                # PROMPT #296 - Calculate cost for observability
                _in_tok = result.get("usage", {}).get("input_tokens", 0)
                _out_tok = result.get("usage", {}).get("output_tokens", 0)
                _cost = None
                try:
                    from app.utils.pricing import calculate_cost
                    _cost_info = calculate_cost(_in_tok, _out_tok, model_name)
                    _cost = _cost_info.get("total_cost")
                except Exception:
                    pass
                asyncio.create_task(console.log_ai_response(
                    model=f"{provider}/{model_name}",
                    response_preview=response_content[:300] if response_content else "No response",
                    full_response=response_content[:10000] if response_content else None,
                    tokens_used=result.get("usage", {}).get("total_tokens"),
                    duration_ms=execution_time_ms_console,
                    project_id=project_id if project_id else None,
                    cache_hit=False,
                    trace_id=trace_id,
                    cost_usd=_cost,
                    input_tokens=_in_tok,
                    output_tokens=_out_tok
                ))

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

                        # PROMPT #233 - CF-1 fix: use dynamic pricing instead of hardcoded Claude pricing
                        input_tokens = result.get("usage", {}).get("input_tokens", 0)
                        output_tokens = result.get("usage", {}).get("output_tokens", 0)
                        from app.utils.pricing import calculate_cost
                        _cost_info = calculate_cost(input_tokens, output_tokens, model_name)
                        cost = _cost_info["total_cost"]

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
                        _save_prompt_to_satellite(self.db, prompt_log)  # PROMPT #235
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
                    # PROMPT #233 - CF-1 fix: use dynamic pricing instead of hardcoded Claude pricing
                    input_tokens = result.get("usage", {}).get("input_tokens", 0)
                    output_tokens = result.get("usage", {}).get("output_tokens", 0)
                    from app.utils.pricing import calculate_cost
                    _cost_info = calculate_cost(input_tokens, output_tokens, model_name)
                    cost = _cost_info["total_cost"]

                    cache_input = {
                        "prompt": json.dumps(_effective_messages),
                        "system_prompt": _effective_system_prompt or "",
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

            # PROMPT #205 - Post-process with utility nodes (non-chain path)
            if _utility_nodes and _utility_pre_done:
                _util_context_post = {
                    "usage_type": usage_type,
                    "model_name": model_name,
                    "provider": provider,
                    "db_model_id": model_config.get("db_model_id", ""),
                    "db_model_name": model_config.get("db_model_name", ""),
                    "temperature": temperature,
                }
                result = self.utility_executor.post_process(
                    _utility_nodes, result, _effective_messages,
                    _effective_system_prompt, _util_context_post
                )
                # Handle validator retry (non-chain path)
                if result.get("retry_needed") and _retry_config:
                    max_retries = _retry_config["max_retries"]
                    backoff_base = _retry_config["backoff_base_ms"] / 1000.0
                    backoff_mult = _retry_config["backoff_multiplier"]
                    for retry_attempt in range(max_retries):
                        wait = backoff_base * (backoff_mult ** retry_attempt)
                        logger.info(
                            f"🔄 Retry Node (no-chain): attempt {retry_attempt+1}/{max_retries} "
                            f"(waiting {wait:.1f}s, reason: {result.get('validation_error', 'unknown')})"
                        )
                        await asyncio.sleep(wait)
                        if provider == "anthropic":
                            result = await self._execute_anthropic(
                                model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature
                            )
                        elif provider == "openai":
                            result = await self._execute_openai(
                                model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature
                            )
                        elif provider == "google":
                            result = await self._execute_google(
                                model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature
                            )
                        elif provider == "ollama":
                            result = await self._execute_ollama(
                                model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                                top_p=_top_p, top_k=_top_k,
                                num_ctx=_num_ctx, num_batch=_num_batch, keep_alive=_keep_alive
                            )
                        elif provider == "cohere":
                            result = await self._execute_cohere(
                                model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature
                            )
                        elif provider == "claudio":
                            result = await self._execute_anthropic(
                                model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                                client_key="claudio"
                            )
                        result = self.utility_executor.post_process(
                            _utility_nodes, result, _effective_messages,
                            _effective_system_prompt, _util_context_post
                        )
                        if not result.get("retry_needed"):
                            logger.info(f"✅ Retry Node (no-chain): success on attempt {retry_attempt+1}")
                            break
                    else:
                        logger.warning(f"⚠️ Retry Node (no-chain): all {max_retries} retries exhausted")

            # PROMPT #235 - General response validator (non-chain path)
            _has_validator_node = any(
                n.get("type") == "validator" and n.get("enabled", True)
                for n in (_utility_nodes or [])
            )
            if not _has_validator_node and not result.get("error"):
                try:
                    from app.services.general_response_validator import validate_response
                    _val = validate_response(
                        result.get("content", ""),
                        _general_classification,
                        _effective_messages,
                    )
                    result["general_validation"] = {
                        "confidence": _val["confidence"],
                        "issues": _val["issues"],
                    }
                    if _val["should_escalate"]:
                        logger.warning(
                            f"General validator (no-chain): quality low "
                            f"({_val['escalation_reason']})"
                        )
                except Exception as _gv_err:
                    logger.warning(f"General validator skipped (no-chain): {_gv_err}")

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

        finally:
            # PROMPT #228 - Release concurrency slot
            if _concurrency_sem is not None:
                _concurrency_sem.release()
                logger.info(f"🔓 Concurrency slot released for {model_config.get('db_model_name', 'unknown')}")

    async def execute_with_chain(
        self,
        usage_type: UsageType,
        messages: List[Dict],
        system_prompt: Optional[str] = None,
        max_tokens: Optional[int] = None,
        **kwargs
    ) -> Dict:
        """
        PROMPT #122 - Execute AI call with chain-based fallback.
        If an AIFlowChain exists for usage_type, tries each model in sequence.
        Falls back to standard execute() if no chain exists.
        """
        chain_models = self._get_chain_models(usage_type)

        if not chain_models:
            return await self.execute(
                usage_type=usage_type,
                messages=messages,
                system_prompt=system_prompt,
                max_tokens=max_tokens,
                **kwargs
            )

        last_error = None
        for i, model_config in enumerate(chain_models):
            try:
                logger.info(
                    f"🔗 Chain attempt {i+1}/{len(chain_models)}: "
                    f"{model_config['db_model_name']} ({model_config['provider']}/{model_config['model']})"
                )

                result = await self._execute_with_config(
                    model_config=model_config,
                    messages=messages,
                    system_prompt=system_prompt,
                    max_tokens=max_tokens,
                )

                result["chain_position"] = i + 1
                result["chain_total"] = len(chain_models)
                result["chain_fallback"] = i > 0
                return result

            except Exception as e:
                last_error = e
                logger.warning(
                    f"🔗 Chain fallback: {model_config['db_model_name']} failed: {e}. "
                    f"{'Trying next model...' if i < len(chain_models)-1 else 'No more models in chain.'}"
                )
                continue

        raise Exception(
            f"Todos os {len(chain_models)} modelos na cadeia de fluxo para '{usage_type}' falharam. "
            f"Último erro: {last_error}"
        )

    async def _execute_with_config(
        self,
        model_config: Dict,
        messages: List[Dict],
        system_prompt: Optional[str] = None,
        max_tokens: Optional[int] = None,
        overrides: Optional[Dict] = None,
    ) -> Dict:
        """
        PROMPT #122 - Execute with a specific model config (for chain-based execution).
        Bypasses choose_model() and uses the provided config directly.

        PROMPT #206 - overrides dict can contain:
          - _override_max_tokens: capped by model (can reduce, not increase)
          - _override_temperature: free value (0.0-2.0)
        """
        provider = model_config["provider"]
        model_name = model_config["model"]
        tokens_limit = max_tokens if max_tokens is not None else model_config["max_tokens"]
        temperature = model_config["temperature"]

        # PROMPT #221 - Sampling parameters (primarily for Ollama)
        top_p = model_config.get("top_p")
        top_k = model_config.get("top_k")
        # PROMPT #289 - Ollama context/batch/keep_alive from model config
        _num_ctx = model_config.get("context_length")
        _num_batch = model_config.get("num_batch")
        _keep_alive = model_config.get("keep_alive")

        # PROMPT #206 - Apply utility node overrides
        if overrides:
            if overrides.get("_override_max_tokens") is not None:
                tokens_limit = overrides["_override_max_tokens"]
                logger.info(f"🔧 Override max_tokens → {tokens_limit}")
            if overrides.get("_override_temperature") is not None:
                temperature = overrides["_override_temperature"]
                logger.info(f"🔧 Override temperature → {temperature}")

        # Rate limiting check
        if self.rate_limiter and model_config.get("rate_limit_requests"):
            can_proceed, wait_time = self.rate_limiter.check_rate_limit(
                model_config["db_model_id"],
                model_config["rate_limit_requests"],
                model_config["rate_limit_window_seconds"],
            )
            if not can_proceed:
                logger.info(f"⏳ Rate limit for {model_config['db_model_name']}, waiting {wait_time:.1f}s")
                await asyncio.sleep(wait_time)
            self.rate_limiter.record_request(
                model_config["db_model_id"],
                model_config["rate_limit_window_seconds"],
            )

        # PROMPT #228 - Concurrency control for chain execution
        _chain_sem = None
        _chain_max_concurrent = model_config.get('max_concurrent_requests')
        if _chain_max_concurrent:
            _chain_sem = _get_model_semaphore(model_config['db_model_id'], _chain_max_concurrent)
            await _chain_sem.acquire()
            logger.info(
                f"🔒 Chain concurrency slot acquired for {model_config['db_model_name']} "
                f"(max: {_chain_max_concurrent})"
            )

        # PROMPT #127 - Pass API key from chain model config to override default client key
        api_key_override = model_config.get("api_key")

        # PROMPT #207 - Resolve timeout: diagram node → model config → system settings
        resolved_timeout = None
        if overrides and overrides.get("_override_timeout") is not None:
            resolved_timeout = float(overrides["_override_timeout"])
            logger.info(f"⏱️ Chain timeout from diagram node: {resolved_timeout}s")
        elif model_config.get("timeout_seconds"):
            resolved_timeout = float(model_config["timeout_seconds"])
            logger.info(f"⏱️ Chain timeout from model config: {resolved_timeout}s")
        else:
            # Fallback to system settings
            try:
                setting = self.db.query(SystemSettings).filter(
                    SystemSettings.key == "default_api_timeout_seconds"
                ).first()
                if setting and setting.value:
                    resolved_timeout = float(setting.value)
            except Exception:
                pass
            if not resolved_timeout:
                resolved_timeout = 120.0

        # PROMPT #231 - Adaptive timeout: if router estimated tokens, adjust timeout
        if overrides:
            _est_tokens = overrides.get("_router_estimated_tokens")
            _provider = model_config.get("provider")
            if _est_tokens and _provider:
                _speed = self.PROVIDER_SPEED_PROFILES.get(_provider, 50)
                _adaptive = (_est_tokens / _speed) * 1.5 + 5.0
                if _adaptive > resolved_timeout:
                    logger.info(
                        f"⏱️ Chain adaptive timeout: {_adaptive:.1f}s "
                        f"(est {_est_tokens} tokens @ {_speed} tok/s) > static {resolved_timeout}s"
                    )
                    resolved_timeout = _adaptive

        # PROMPT #217 - Streaming dispatch with fallback to non-streaming
        import uuid as _uuid
        _stream_id = str(_uuid.uuid4())
        _model_label = f"{provider}/{model_name}"
        _stream_cb, _chunk_counter, _flush_cb = self._create_stream_callback(
            stream_id=_stream_id, model_label=_model_label,
        )

        try:
            try:
                if provider == "anthropic":
                    result = await self._execute_anthropic_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "openai":
                    result = await self._execute_openai_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "google":
                    result = await self._execute_google_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "ollama":
                    result = await self._execute_ollama_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, timeout_seconds=resolved_timeout, top_p=top_p, top_k=top_k, num_ctx=_num_ctx, num_batch=_num_batch, keep_alive=_keep_alive)
                elif provider == "cohere":
                    result = await self._execute_cohere_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "claudio":
                    result = await self._execute_anthropic_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, timeout_seconds=resolved_timeout, client_key="claudio")
                else:
                    raise ValueError(f"Provedor desconhecido: {provider}")

                # Emit stream completion
                console = get_console_logger()
                asyncio.create_task(console.log_ai_streaming_chunk(
                    stream_id=_stream_id, model=_model_label,
                    chunk_text="", chunk_index=_chunk_counter[0] + 1,
                    is_complete=True, accumulated_text=result.get("content", ""),
                ))
            except Exception as stream_err:
                logger.warning(f"⚠️ Chain streaming failed, falling back: {stream_err}")
                if provider == "anthropic":
                    result = await self._execute_anthropic(model_name, messages, system_prompt, tokens_limit, temperature, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "openai":
                    result = await self._execute_openai(model_name, messages, system_prompt, tokens_limit, temperature, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "google":
                    result = await self._execute_google(model_name, messages, system_prompt, tokens_limit, temperature, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "ollama":
                    result = await self._execute_ollama(model_name, messages, system_prompt, tokens_limit, temperature, timeout_seconds=resolved_timeout, top_p=top_p, top_k=top_k, num_ctx=_num_ctx, num_batch=_num_batch, keep_alive=_keep_alive)
                elif provider == "cohere":
                    result = await self._execute_cohere(model_name, messages, system_prompt, tokens_limit, temperature, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "claudio":
                    result = await self._execute_anthropic(model_name, messages, system_prompt, tokens_limit, temperature, timeout_seconds=resolved_timeout, client_key="claudio")
                else:
                    raise ValueError(f"Provedor desconhecido: {provider}")

            result["db_model_id"] = model_config["db_model_id"]
            result["db_model_name"] = model_config["db_model_name"]
            return result
        finally:
            # PROMPT #228 - Release concurrency slot
            if _chain_sem is not None:
                _chain_sem.release()
                logger.info(f"🔓 Chain concurrency slot released for {model_config.get('db_model_name', 'unknown')}")

    async def _execute_anthropic(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        client_key: str = "anthropic",
    ) -> Dict:
        """
        Executa com Anthropic Claude (ou Claudio proxy) usando configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        PROMPT #75 - Async execution with await (non-blocking)
        PROMPT #207 - Configurable timeout
        PROMPT #246 - client_key param for Claudio support
        """
        client = self.clients.get(client_key) or self.clients.get("anthropic")

        # PROMPT #127 - Use override key if provided (chain execution)
        # Skip override for claudio (no API key needed)
        if client_key != "claudio" and api_key_override and api_key_override not in ("CONFIGURE_VIA_WEB_INTERFACE", "configure-via-web-interface"):
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=api_key_override)

        # PROMPT #75 - Await async call to yield to event loop during API request
        # PROMPT #207 - Apply configurable timeout
        api_call = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt if system_prompt else "You are a helpful AI assistant.",
            messages=messages
        )
        if timeout_seconds:
            response = await asyncio.wait_for(api_call, timeout=timeout_seconds)
        else:
            response = await api_call

        return {
            "provider": client_key,
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
        temperature: float,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """
        Executa com OpenAI GPT usando configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        PROMPT #75 - Async execution with await (non-blocking)
        PROMPT #207 - Configurable timeout
        """
        client = self.clients["openai"]  # AsyncOpenAI instance

        # PROMPT #127 - Use override key if provided (chain execution)
        if api_key_override and api_key_override not in ("CONFIGURE_VIA_WEB_INTERFACE", "configure-via-web-interface"):
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=api_key_override)

        # Adicionar system message se fornecido
        openai_messages = []
        if system_prompt:
            openai_messages.append({
                "role": "system",
                "content": system_prompt
            })
        openai_messages.extend(messages)

        # PROMPT #75 - Await async call to yield to event loop during API request
        # PROMPT #207 - Apply configurable timeout
        api_call = client.chat.completions.create(
            model=model,
            messages=openai_messages,
            max_tokens=max_tokens,
            temperature=temperature
        )
        if timeout_seconds:
            response = await asyncio.wait_for(api_call, timeout=timeout_seconds)
        else:
            response = await api_call

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
        temperature: float,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """
        Executa com Google Gemini usando configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        PROMPT #75 - Async execution with httpx AsyncClient (non-blocking)
        PROMPT #207 - Configurable timeout
        """
        google_config = self.clients["google"]  # Dict with api_key and http_client
        api_key = api_key_override or google_config["api_key"]
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
        # PROMPT #207 - Use configurable timeout (was hardcoded 120.0)
        effective_timeout = timeout_seconds if timeout_seconds else 120.0
        try:
            response = await http_client.post(url, json=payload, timeout=effective_timeout)
        except Exception as http_error:
            raise Exception(f"Requisicao HTTP falhou: {type(http_error).__name__}: {str(http_error)}")

        # PROMPT #118 FIX - Better error handling for Gemini API
        try:
            data = response.json()
        except Exception as json_error:
            raise Exception(f"Falha ao analisar resposta JSON: {response.text[:500]}")

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
            raise Exception(f"Erro da API Gemini: {error_msg}")

        # Check HTTP status
        response.raise_for_status()

        # Check if candidates exist
        candidates = data.get("candidates", [])
        if not candidates:
            # Check for safety blocks or other issues
            prompt_feedback = data.get("promptFeedback", {})
            block_reason = prompt_feedback.get("blockReason", "Unknown")
            raise Exception(f"Gemini não retornou candidatos. Motivo do bloqueio: {block_reason}")

        # Extract content from response
        candidate = candidates[0]
        content_data = candidate.get("content", {})
        parts = content_data.get("parts", [])

        if not parts:
            finish_reason = candidate.get("finishReason", "Unknown")
            raise Exception(f"Gemini retornou conteúdo vazio. Motivo da conclusão: {finish_reason}")

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
        temperature: float,
        timeout_seconds: Optional[float] = None,
        top_p: Optional[float] = None,
        top_k: Optional[int] = None,
        num_ctx: Optional[int] = None,
        num_batch: Optional[int] = None,
        keep_alive: Optional[str] = None,
    ) -> Dict:
        """
        Executa com Ollama local LLM usando configurações do banco
        PROMPT #106 - Ollama local LLM integration
        PROMPT #207 - Configurable timeout
        PROMPT #221 - top_p/top_k sampling parameters

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

        # PROMPT #221 - Build options with optional top_p/top_k
        # PROMPT #224 - Add num_ctx to limit context window
        # PROMPT #229 - Ollama GPU optimization: num_gpu layers, keep_alive
        # PROMPT #289 - Read num_ctx/num_batch/keep_alive from model config instead of hardcoding
        options = {
            "num_predict": max_tokens,
            "temperature": temperature,
            "num_ctx": num_ctx or 4096,
            "num_gpu": 99,  # PROMPT #229 - Offload all layers to GPU for max throughput
            "num_batch": num_batch or 512,  # PROMPT #229 - Batch size for prompt eval
        }
        if top_p is not None:
            options["top_p"] = top_p
        if top_k is not None:
            options["top_k"] = top_k

        payload = {
            "model": model,
            "messages": ollama_messages,
            "stream": False,
            "options": options,
            "keep_alive": keep_alive or "5m",  # PROMPT #289 - Configurable keep_alive
        }

        logger.info(f"🦙 Calling Ollama: {url} with model {model} (options={options})")

        # PROMPT #207 - Use configurable timeout if provided (Ollama client already has its own timeout)
        try:
            if timeout_seconds:
                response = await asyncio.wait_for(http_client.post(url, json=payload), timeout=timeout_seconds)
            else:
                response = await http_client.post(url, json=payload)
            response.raise_for_status()
        except asyncio.TimeoutError:
            raise Exception(f"Requisicao Ollama expirou apos {timeout_seconds}s")
        except Exception as e:
            logger.error(f"❌ Ollama request failed: {e}")
            logger.error(f"   Tip: Without GPU, large prompts can take 2-5+ minutes. Consider enabling GPU or using cloud APIs.")
            raise

        data = response.json()

        # PROMPT #218 - Ollama returns HTTP 200 with {"error": "..."} for OOM and other errors
        if "error" in data:
            error_msg = data["error"]
            logger.error(f"❌ Ollama returned error: {error_msg}")
            raise Exception(f"Erro Ollama: {error_msg}")

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
        temperature: float,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """
        Executa com Cohere AI usando configurações do banco
        PROMPT #122 - Cohere AI integration
        PROMPT #207 - Configurable timeout

        Cohere Chat API docs: https://docs.cohere.com/reference/chat

        Modelos disponíveis:
        - command-r-plus: Modelo mais poderoso para tarefas complexas
        - command-r: Modelo balanceado para uso geral
        - command-light: Modelo leve e rápido
        """
        cohere_config = self.clients["cohere"]
        api_key = api_key_override or cohere_config["api_key"]
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

        # PROMPT #207 - Use configurable timeout
        effective_timeout = timeout_seconds if timeout_seconds else 60.0
        try:
            response = await http_client.post(url, json=payload, headers=headers, timeout=effective_timeout)
        except Exception as http_error:
            raise Exception(f"Requisicao HTTP falhou: {type(http_error).__name__}: {str(http_error)}")

        # Parse response
        try:
            data = response.json()
        except Exception as json_error:
            raise Exception(f"Falha ao analisar resposta JSON: {response.text[:500]}")

        # Check for API error
        if response.status_code != 200:
            error_msg = data.get("message", str(data))
            raise Exception(f"Erro da API Cohere ({response.status_code}): {error_msg}")

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

    # ===================================================================
    # PROMPT #217 - Streaming provider methods for real-time console output
    # ===================================================================

    def _create_stream_callback(
        self,
        stream_id: str,
        model_label: str,
        project_id: Optional[str] = None,
        job_id: Optional[str] = None,
    ):
        """
        Create a callback for streaming chunks to console logger.
        Uses time-based batching: accumulates chunks for 200ms or 50 chars,
        then flushes as one SSE event (~5 events/sec instead of 50+).
        """
        console = get_console_logger()
        chunk_counter = [0]
        buffer = []
        last_flush = [time.time()]

        async def callback(chunk_text: str):
            chunk_counter[0] += 1
            buffer.append(chunk_text)
            now = time.time()
            buffered_text = "".join(buffer)

            # Flush every 200ms or when buffer >= 50 chars
            # PROMPT #221 - Fire-and-forget to prevent streaming stalls
            if now - last_flush[0] >= 0.2 or len(buffered_text) >= 50:
                asyncio.create_task(console.log_ai_streaming_chunk(
                    stream_id=stream_id,
                    model=model_label,
                    chunk_text=buffered_text,
                    chunk_index=chunk_counter[0],
                    is_complete=False,
                    project_id=project_id,
                    job_id=job_id,
                ))
                buffer.clear()
                last_flush[0] = now

        async def flush_remaining():
            """Flush any remaining buffered text"""
            if buffer:
                buffered_text = "".join(buffer)
                asyncio.create_task(console.log_ai_streaming_chunk(
                    stream_id=stream_id,
                    model=model_label,
                    chunk_text=buffered_text,
                    chunk_index=chunk_counter[0],
                    is_complete=False,
                    project_id=project_id,
                    job_id=job_id,
                ))
                buffer.clear()

        return callback, chunk_counter, flush_remaining

    async def _execute_anthropic_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        client_key: str = "anthropic",
    ) -> Dict:
        """Anthropic/Claudio streaming using client.messages.stream()
        PROMPT #246 - client_key param for Claudio support
        """
        client = self.clients.get(client_key) or self.clients.get("anthropic")

        # Skip override for claudio (no API key needed)
        if client_key != "claudio" and api_key_override and api_key_override not in ("CONFIGURE_VIA_WEB_INTERFACE", "configure-via-web-interface"):
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=api_key_override)

        accumulated = ""
        input_tokens = 0
        output_tokens = 0
        _stream_start = time.time()

        async with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt or "You are a helpful AI assistant.",
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                accumulated += text
                await stream_callback(text)

            await flush_callback()
            final_message = await stream.get_final_message()
            input_tokens = final_message.usage.input_tokens
            output_tokens = final_message.usage.output_tokens

        # PROMPT #233 - CQ-3 fix: include execution_time_ms in streaming responses
        _streaming_time_ms = int((time.time() - _stream_start) * 1000)
        return {
            "provider": client_key,
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "execution_time_ms": _streaming_time_ms,
            }
        }

    async def _execute_openai_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """OpenAI streaming using stream=True"""
        client = self.clients["openai"]

        if api_key_override and api_key_override not in ("CONFIGURE_VIA_WEB_INTERFACE", "configure-via-web-interface"):
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=api_key_override)

        openai_messages = []
        if system_prompt:
            openai_messages.append({"role": "system", "content": system_prompt})
        openai_messages.extend(messages)

        accumulated = ""
        input_tokens = 0
        output_tokens = 0
        _stream_start = time.time()

        response_stream = await client.chat.completions.create(
            model=model,
            messages=openai_messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
            stream_options={"include_usage": True},
        )

        async for chunk in response_stream:
            if chunk.choices and chunk.choices[0].delta.content:
                text = chunk.choices[0].delta.content
                accumulated += text
                await stream_callback(text)
            if hasattr(chunk, 'usage') and chunk.usage:
                input_tokens = chunk.usage.prompt_tokens or 0
                output_tokens = chunk.usage.completion_tokens or 0

        await flush_callback()

        return {
            "provider": "openai",
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "execution_time_ms": int((time.time() - _stream_start) * 1000),
            }
        }

    async def _execute_google_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """Google Gemini streaming using streamGenerateContent with alt=sse"""
        google_config = self.clients["google"]
        api_key = api_key_override or google_config["api_key"]
        http_client = google_config["http_client"]

        conversation = []
        if system_prompt:
            conversation.append(f"System Instructions: {system_prompt}\n")
        for msg in messages:
            role = "User" if msg["role"] == "user" else "Model"
            conversation.append(f"{role}: {msg['content']}")
        prompt = "\n\n".join(conversation)

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?key={api_key}&alt=sse"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
            }
        }

        accumulated = ""
        input_tokens = 0
        output_tokens = 0
        effective_timeout = timeout_seconds or 120.0
        _stream_start = time.time()

        async with http_client.stream("POST", url, json=payload, timeout=effective_timeout) as response:
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    data = json.loads(line[6:])
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for part in parts:
                            text = part.get("text", "")
                            if text:
                                accumulated += text
                                await stream_callback(text)
                    usage_meta = data.get("usageMetadata", {})
                    if usage_meta:
                        input_tokens = usage_meta.get("promptTokenCount", input_tokens)
                        output_tokens = usage_meta.get("candidatesTokenCount", output_tokens)
                except json.JSONDecodeError:
                    pass

        await flush_callback()

        return {
            "provider": "google",
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "execution_time_ms": int((time.time() - _stream_start) * 1000),
            }
        }

    async def _execute_ollama_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        timeout_seconds: Optional[float] = None,
        top_p: Optional[float] = None,
        top_k: Optional[int] = None,
        num_ctx: Optional[int] = None,
        num_batch: Optional[int] = None,
        keep_alive: Optional[str] = None,
    ) -> Dict:
        """Ollama streaming using stream=True (NDJSON response)
        PROMPT #221 - Added top_p/top_k and streaming timeout
        """
        ollama_config = self.clients["ollama"]
        base_url = ollama_config["base_url"]
        http_client = ollama_config["http_client"]

        ollama_messages = []
        if system_prompt:
            ollama_messages.append({"role": "system", "content": system_prompt})
        ollama_messages.extend(messages)

        # PROMPT #221 - Build options with optional top_p/top_k
        # PROMPT #224 - Add num_ctx to limit context window (saves memory, speeds up inference)
        # PROMPT #229 - Ollama GPU optimization: num_gpu layers, batch size
        # PROMPT #289 - Read num_ctx/num_batch/keep_alive from model config instead of hardcoding
        options = {
            "num_predict": max_tokens,
            "temperature": temperature,
            "num_ctx": num_ctx or 4096,
            "num_gpu": 99,  # PROMPT #229 - Offload all layers to GPU
            "num_batch": num_batch or 512,  # PROMPT #229 - Batch size for prompt eval
        }
        if top_p is not None:
            options["top_p"] = top_p
        if top_k is not None:
            options["top_k"] = top_k

        url = f"{base_url}/api/chat"
        payload = {
            "model": model,
            "messages": ollama_messages,
            "stream": True,
            "options": options,
            "keep_alive": keep_alive or "5m",  # PROMPT #289 - Configurable keep_alive
        }

        effective_timeout = timeout_seconds or 300.0
        logger.info(f"🦙 Calling Ollama (streaming): {url} with model {model} (timeout={effective_timeout}s)")

        accumulated = ""
        input_tokens = 0
        output_tokens = 0

        # PROMPT #221 - Wrap streaming loop with timeout to prevent indefinite hangs
        async def _consume_stream(response):
            nonlocal accumulated, input_tokens, output_tokens
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    chunk_text = data.get("message", {}).get("content", "")
                    if chunk_text:
                        accumulated += chunk_text
                        await stream_callback(chunk_text)
                    if data.get("done"):
                        input_tokens = data.get("prompt_eval_count", 0)
                        output_tokens = data.get("eval_count", 0)
                except json.JSONDecodeError:
                    pass

        async with http_client.stream("POST", url, json=payload, timeout=effective_timeout) as response:
            await asyncio.wait_for(
                _consume_stream(response),
                timeout=effective_timeout
            )

        await flush_callback()

        # PROMPT #230 - Strip <think>...</think> tags from qwen3 thinking mode
        import re
        cleaned = re.sub(r'<think>[\s\S]*?</think>\s*', '', accumulated).strip()
        if cleaned != accumulated:
            logger.info(f"🧠 Stripped thinking tags from Ollama response ({len(accumulated)} → {len(cleaned)} chars)")
            accumulated = cleaned

        return {
            "provider": "ollama",
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            }
        }

    async def _execute_cohere_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """Cohere streaming using stream=True (NDJSON with event_type)"""
        cohere_config = self.clients["cohere"]
        api_key = api_key_override or cohere_config["api_key"]
        http_client = cohere_config["http_client"]

        chat_history = []
        current_message = ""
        for msg in messages:
            role = msg.get("role", "user").lower()
            cohere_role = "USER" if role == "user" else "CHATBOT"
            chat_history.append({"role": cohere_role, "message": msg.get("content", "")})

        if chat_history and chat_history[-1]["role"] == "USER":
            current_message = chat_history.pop()["message"]
        else:
            current_message = "Continue the conversation."

        url = "https://api.cohere.ai/v1/chat"
        payload = {
            "model": model,
            "message": current_message,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if chat_history:
            payload["chat_history"] = chat_history
        if system_prompt:
            payload["preamble"] = system_prompt

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        accumulated = ""
        input_tokens = 0
        output_tokens = 0
        effective_timeout = timeout_seconds or 60.0

        async with http_client.stream("POST", url, json=payload, headers=headers, timeout=effective_timeout) as response:
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    event_type = data.get("event_type", "")
                    if event_type == "text-generation":
                        text = data.get("text", "")
                        if text:
                            accumulated += text
                            await stream_callback(text)
                    elif event_type == "stream-end":
                        response_data = data.get("response", {})
                        meta = response_data.get("meta", {})
                        tokens = meta.get("tokens", {})
                        input_tokens = tokens.get("input_tokens", 0)
                        output_tokens = tokens.get("output_tokens", 0)
                except json.JSONDecodeError:
                    pass

        await flush_callback()

        return {
            "provider": "cohere",
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
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
