"""
Model selection mixin for AIOrchestrator.
Contains choose_model(), choose_model_for_task(), and related helper methods.
"""

from typing import Any, Dict, List, Optional
import logging
import time

from .constants import (
    _model_config_cache, _model_config_cache_ts, _chain_config_cache,
    _chain_config_cache_ts, _MODEL_CACHE_TTL, UsageType,
    logger,
)

from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_flow_chain import AIFlowChain  # PROMPT #122 - AI Flow Fallback Chains
from app.models.task import Task, ItemType, PriorityLevel  # JIRA Transformation - Multi-dimensional model selection
from app.models.system_settings import SystemSettings  # PROMPT #207 - System default timeout


class ModelSelectorMixin:
    """Methods for model selection, chain resolution, and configuration."""

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
                    # Claudius business_mode: translate technical output to business language
                    "business_mode": db_model.config.get("business_mode", False),
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
        "content_generation": {"business_rule": 0.35},
        "rag_extraction": {"code_file": 0.35},
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
            _meta = r.get("metadata", {}) or {}
            doc_type = _meta.get("type", "") if isinstance(_meta, dict) else r.get("type", "")
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
                    # Claudius business_mode: translate technical output to business language
                    "business_mode": db_model.config.get("business_mode", False),
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
                "business_mode": fallback_model.config.get("business_mode", False),
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
           - Item Type: Epic=5, Story=4, Task=3, Bug=2
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
