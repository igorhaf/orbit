"""
Service central para orquestração de múltiplos modelos de IA
Gerencia Anthropic, OpenAI e Google AI de forma inteligente
"""

from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
import logging
import time
import json  # PROMPT #74 - For cache key generation
import os  # PROMPT #74 - For Redis env vars
import asyncio  # PROMPT #152 - For rate limit waiting
from datetime import datetime
from uuid import UUID

from .constants import (
    _get_model_semaphore, _safe_broadcast, UsageType, logger,
)
from .model_selector import ModelSelectorMixin
from .providers import ProvidersMixin
from .providers_stream import ProvidersStreamMixin

from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_flow_chain import AIFlowChain  # PROMPT #122 - AI Flow Fallback Chains
from app.models.ai_execution import AIExecution  # PROMPT #54 - AI Execution Logging
from app.models.prompt import Prompt  # PROMPT #58 - Prompt Audit Logging
from app.models.task import Task, ItemType, PriorityLevel  # JIRA Transformation - Multi-dimensional model selection
from app.models.system_settings import SystemSettings  # PROMPT #207 - System default timeout
from app.services.console_logger import get_console_logger  # PROMPT #168 - Real-time Console Logs
from app.services.utility_node_executor import UtilityNodeExecutor  # PROMPT #205 - Utility Node Execution


class AIOrchestrator(ModelSelectorMixin, ProvidersMixin, ProvidersStreamMixin):
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
        """Initialize the single Claudius client (v2.5: claudius-only lockdown).

        Uses any active claudius model row to pull base_url + api_key; if none
        exist yet (fresh install), falls back to env defaults.
        """
        model = (
            self.db.query(AIModel)
            .filter(AIModel.is_active == True, AIModel.provider == "claudius")
            .first()
        )
        api_key = (model.api_key if model else None) or os.getenv("CLAUDIUS_API_KEY", "not-needed")
        from anthropic import AsyncAnthropic
        claudius_base = os.getenv("CLAUDIUS_BASE_URL", "http://localhost:8001")
        self.clients["claudius"] = AsyncAnthropic(api_key=api_key, base_url=claudius_base)
        logger.info(f"✅ Claudius client initialized: {claudius_base}")

        # v2.5 lockdown removed the multi-provider loop that populated
        # `initialized_providers`; the orphaned reference raised NameError and
        # broke GET /cache/stats with a 500. Report what was actually set up.
        logger.info(f"📊 Initialized async providers: {list(self.clients.keys())}")

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
        trace_id: Optional[str] = None,
        # PROMPT #253 - Claudius extended thinking
        thinking: Optional[Dict] = None,
        # PROMPT #259 - Disable CWD for RAG-only calls
        disable_cwd: bool = False,
        # PROMPT #253 - Disable tools for pure text generation (prevents agent mode)
        disable_tools: bool = False,
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

        # PROMPT #253 - RAG Enhancement: inject context BEFORE chain/choose_model execution
        # Previously this was in the choose_model path only, so chain executions never got RAG context
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

                    # Measure RAG retrieval time
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
                        # Score and filter RAG results by relevance
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

                            # Merge RAG context into last user message
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

        if chains_to_try:
            last_error = None

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
                            project_id=project_id,
                            thinking=thinking,
                            disable_cwd=disable_cwd,
                            disable_tools=disable_tools,
                        )
                        result["chain_position"] = chain_idx + 1
                        result["chain_total"] = len(chain_model_list)
                        result["chain_fallback"] = chain_idx > 0 or chain_source == "general"
                        result["chain_source"] = chain_source
                        result["rag_enhanced"] = rag_context_injected
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
                                        project_id=project_id,
                                        thinking=thinking,
                                        disable_cwd=disable_cwd,
                                        disable_tools=disable_tools,
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
                            # Skip for RAG pipeline calls (skip_context_build=True)
                            _has_validator_node = any(
                                n.get("type") == "validator" and n.get("enabled", True)
                                for n in (_utility_nodes or [])
                            )
                            if not _has_validator_node and not result.get("error") and not _skip_context:
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

                        # v2.5: ollama removed; OOM special-case no longer relevant
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
                                            project_id=project_id,
                                            thinking=thinking,
                                            disable_cwd=disable_cwd,
                                            disable_tools=disable_tools,
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

        # PROMPT #253 - Resolve cwd for Claudius calls (choose_model path)
        _claudius_cwd = None
        if provider == "claudius":
            if disable_cwd:
                _claudius_cwd = "/tmp"
            elif project_id:
                try:
                    from app.models.project import Project as _CwdProject
                    _cwd_proj = self.db.query(_CwdProject).filter(_CwdProject.id == project_id).first()
                    if _cwd_proj and _cwd_proj.code_path:
                        _claudius_cwd = _cwd_proj.code_path
                except Exception:
                    pass

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
            # v2.5: claudius-only lockdown. Streaming first; fallback to non-streaming.
            _streamed_ok = True
            try:
                result = await self._execute_claudius_streaming(
                    model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                    stream_callback=_stream_cb, flush_callback=_flush_cb,
                    timeout_seconds=_resolved_timeout, cwd=_claudius_cwd,
                    thinking=thinking, disable_tools=disable_tools
                )

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
                _streamed_ok = False
                logger.warning(f"⚠️ Streaming failed, falling back to non-streaming: {stream_err}")
                result = await self._execute_claudius(
                    model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature,
                    timeout_seconds=_resolved_timeout, cwd=_claudius_cwd,
                    thinking=thinking, disable_tools=disable_tools
                )

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
                        # v2.5: claudius-only
                        result = await self._execute_claudius(
                            model_name, _effective_messages, _effective_system_prompt, tokens_limit, temperature
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
                    project_id=kwargs.get("project_id"),
                    thinking=kwargs.get("thinking"),
                    disable_cwd=kwargs.get("disable_cwd", False),
                    disable_tools=kwargs.get("disable_tools", False),
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
