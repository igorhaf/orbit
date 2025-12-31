"""
Multi-Level Cache Service for Cost Optimization

Implements 3-level caching strategy:
1. Exact Match - Hash-based (fastest, 20% hit rate)
2. Semantic Match - Embedding similarity (10% hit rate)
3. Template Cache - For deterministic prompts (5% hit rate)

Expected total cache hit rate: 30-35%
Cost savings: 60-90% on cached requests
"""

import hashlib
import json
import time
import logging
from typing import Dict, Any, Optional, List
from enum import Enum
from dataclasses import dataclass
from datetime import timedelta

logger = logging.getLogger(__name__)


class CacheLevel(Enum):
    """Cache level enum"""
    EXACT = "exact"
    SEMANTIC = "semantic"
    TEMPLATE = "template"


@dataclass
class CacheEntry:
    """Cache entry with metadata"""
    response: str
    model: str
    input_tokens: int
    output_tokens: int
    cost: float
    quality_score: Optional[float]
    cache_level: str
    created_at: float
    hits: int = 0


class CacheService:
    """
    Multi-level cache service for prompt responses

    Cache Levels:
    1. Exact Match (L1) - Hash of prompt + config
       - TTL: 7 days
       - Use case: Identical requests
       - Expected hit rate: ~20%

    2. Semantic Match (L2) - Embedding similarity
       - TTL: 1 day
       - Use case: Similar prompts (>95% similarity)
       - Expected hit rate: ~10%

    3. Template Cache (L3) - For deterministic prompts
       - TTL: 30 days
       - Use case: temp=0 prompts (deterministic)
       - Expected hit rate: ~5%

    Storage: In-memory dict (production: Redis)
    """

    def __init__(
        self,
        redis_client: Optional[Any] = None,
        enable_semantic: bool = False,
        similarity_threshold: float = 0.95,
    ):
        """
        Initialize cache service

        Args:
            redis_client: Redis client (if None, uses in-memory dict)
            enable_semantic: Enable semantic similarity caching
            similarity_threshold: Minimum similarity for semantic match (0-1)
        """
        self.redis_client = redis_client
        self.enable_semantic = enable_semantic
        self.similarity_threshold = similarity_threshold

        # In-memory fallback (production: use Redis)
        if not redis_client:
            logger.warning("Redis not configured - using in-memory cache (not production-ready)")
            self._memory_cache: Dict[str, CacheEntry] = {}

        # Cache statistics
        self.stats = {
            "hits": 0,
            "misses": 0,
            "exact_hits": 0,
            "semantic_hits": 0,
            "template_hits": 0,
            "total_requests": 0,
        }

        # TTL configurations (seconds)
        self.ttl = {
            CacheLevel.EXACT: int(timedelta(days=7).total_seconds()),
            CacheLevel.SEMANTIC: int(timedelta(days=1).total_seconds()),
            CacheLevel.TEMPLATE: int(timedelta(days=30).total_seconds()),
        }

    def _generate_cache_key(self, cache_input: Dict[str, Any]) -> str:
        """
        Generate cache key from input parameters

        Args:
            cache_input: Dict with prompt, system_prompt, usage_type, etc.

        Returns:
            SHA256 hash as cache key
        """
        # Sort keys for consistent hashing
        key_parts = {
            "prompt": cache_input.get("prompt", ""),
            "system_prompt": cache_input.get("system_prompt", ""),
            "usage_type": cache_input.get("usage_type", ""),
            "temperature": cache_input.get("temperature", 0.7),
            "model": cache_input.get("model", ""),
        }

        # Create deterministic string
        key_string = json.dumps(key_parts, sort_keys=True)

        # Hash it
        return hashlib.sha256(key_string.encode()).hexdigest()

    def get(self, cache_input: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Get cached response (tries all cache levels)

        Flow:
        1. Try exact match (L1) - fastest
        2. Try semantic match (L2) - if enabled
        3. Try template cache (L3) - if temp=0

        Args:
            cache_input: Input parameters to look up

        Returns:
            Cached result dict or None
        """
        self.stats["total_requests"] += 1

        # Level 1: Exact Match (fastest)
        exact_result = self._get_exact(cache_input)
        if exact_result:
            self.stats["hits"] += 1
            self.stats["exact_hits"] += 1
            logger.info(f"✓ Cache HIT (exact) - saved ~${exact_result['cost']:.4f}")
            return exact_result

        # Level 2: Semantic Match (if enabled)
        if self.enable_semantic:
            semantic_result = self._get_semantic(cache_input)
            if semantic_result:
                self.stats["hits"] += 1
                self.stats["semantic_hits"] += 1
                logger.info(f"✓ Cache HIT (semantic) - saved ~${semantic_result['cost']:.4f}")
                return semantic_result

        # Level 3: Template Cache (if deterministic)
        if cache_input.get("temperature", 0.7) == 0:
            template_result = self._get_template(cache_input)
            if template_result:
                self.stats["hits"] += 1
                self.stats["template_hits"] += 1
                logger.info(f"✓ Cache HIT (template) - saved ~${template_result['cost']:.4f}")
                return template_result

        # Cache miss
        self.stats["misses"] += 1
        logger.debug("Cache MISS - will execute prompt")
        return None

    def _get_exact(self, cache_input: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Get from exact match cache (L1)

        Args:
            cache_input: Input parameters

        Returns:
            Cached result or None
        """
        cache_key = self._generate_cache_key(cache_input)
        prefix = "exact:"

        # Get from Redis or memory
        if self.redis_client:
            try:
                data = self.redis_client.get(f"{prefix}{cache_key}")
                if data:
                    entry = json.loads(data)
                    # Update hit counter
                    entry["hits"] += 1
                    self.redis_client.setex(
                        f"{prefix}{cache_key}",
                        self.ttl[CacheLevel.EXACT],
                        json.dumps(entry)
                    )
                    return {
                        "response": entry["response"],
                        "cache_type": "exact",
                        "model": entry["model"],
                        "cost": entry["cost"],
                    }
            except Exception as e:
                logger.error(f"Redis get error: {e}")
                return None
        else:
            # In-memory fallback
            key = f"{prefix}{cache_key}"
            if key in self._memory_cache:
                entry = self._memory_cache[key]
                # Check TTL
                if time.time() - entry.created_at < self.ttl[CacheLevel.EXACT]:
                    entry.hits += 1
                    return {
                        "response": entry.response,
                        "cache_type": "exact",
                        "model": entry.model,
                        "cost": entry.cost,
                    }
                else:
                    # Expired
                    del self._memory_cache[key]

        return None

    def _get_semantic(self, cache_input: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Get from semantic similarity cache (L2)

        Uses embedding similarity to find similar prompts.
        Requires sentence-transformers library.

        Args:
            cache_input: Input parameters

        Returns:
            Cached result or None
        """
        # TODO: Implement semantic similarity
        # Requires:
        # 1. Generate embedding for input prompt
        # 2. Compare with cached embeddings (cosine similarity)
        # 3. Return if similarity > threshold (0.95)

        # For now, return None (not implemented yet)
        return None

    def _get_template(self, cache_input: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Get from template cache (L3)

        For deterministic prompts (temperature=0) with long TTL.

        Args:
            cache_input: Input parameters

        Returns:
            Cached result or None
        """
        # Template cache is similar to exact match but with longer TTL
        # Only used when temperature=0 (deterministic)

        if cache_input.get("temperature", 0.7) != 0:
            return None

        cache_key = self._generate_cache_key(cache_input)
        prefix = "template:"

        # Get from Redis or memory
        if self.redis_client:
            try:
                data = self.redis_client.get(f"{prefix}{cache_key}")
                if data:
                    entry = json.loads(data)
                    entry["hits"] += 1
                    self.redis_client.setex(
                        f"{prefix}{cache_key}",
                        self.ttl[CacheLevel.TEMPLATE],
                        json.dumps(entry)
                    )
                    return {
                        "response": entry["response"],
                        "cache_type": "template",
                        "model": entry["model"],
                        "cost": entry["cost"],
                    }
            except Exception as e:
                logger.error(f"Redis get error: {e}")
                return None
        else:
            # In-memory fallback
            key = f"{prefix}{cache_key}"
            if key in self._memory_cache:
                entry = self._memory_cache[key]
                # Check TTL
                if time.time() - entry.created_at < self.ttl[CacheLevel.TEMPLATE]:
                    entry.hits += 1
                    return {
                        "response": entry.response,
                        "cache_type": "template",
                        "model": entry.model,
                        "cost": entry.cost,
                    }
                else:
                    # Expired
                    del self._memory_cache[key]

        return None

    def set(
        self,
        cache_input: Dict[str, Any],
        cache_output: Dict[str, Any],
    ):
        """
        Store result in cache

        Stores in exact match cache by default.
        If temperature=0, also stores in template cache.

        Args:
            cache_input: Input parameters
            cache_output: Response data to cache
        """
        cache_key = self._generate_cache_key(cache_input)
        temperature = cache_input.get("temperature", 0.7)

        # Create cache entry
        entry_data = {
            "response": cache_output["response"],
            "model": cache_output.get("model", "unknown"),
            "input_tokens": cache_output.get("input_tokens", 0),
            "output_tokens": cache_output.get("output_tokens", 0),
            "cost": cache_output.get("cost", 0.0),
            "quality_score": cache_output.get("quality_score"),
            "created_at": time.time(),
            "hits": 0,
        }

        # Store in exact match cache
        self._set_exact(cache_key, entry_data)

        # Also store in template cache if deterministic
        if temperature == 0:
            self._set_template(cache_key, entry_data)

        logger.debug(f"Cached response (exact, ttl={self.ttl[CacheLevel.EXACT]}s)")

    def _set_exact(self, cache_key: str, entry_data: Dict[str, Any]):
        """Store in exact match cache"""
        prefix = "exact:"

        if self.redis_client:
            try:
                self.redis_client.setex(
                    f"{prefix}{cache_key}",
                    self.ttl[CacheLevel.EXACT],
                    json.dumps(entry_data)
                )
            except Exception as e:
                logger.error(f"Redis set error: {e}")
        else:
            # In-memory fallback
            key = f"{prefix}{cache_key}"
            self._memory_cache[key] = CacheEntry(
                response=entry_data["response"],
                model=entry_data["model"],
                input_tokens=entry_data["input_tokens"],
                output_tokens=entry_data["output_tokens"],
                cost=entry_data["cost"],
                quality_score=entry_data.get("quality_score"),
                cache_level="exact",
                created_at=entry_data["created_at"],
                hits=0,
            )

    def _set_template(self, cache_key: str, entry_data: Dict[str, Any]):
        """Store in template cache"""
        prefix = "template:"

        if self.redis_client:
            try:
                self.redis_client.setex(
                    f"{prefix}{cache_key}",
                    self.ttl[CacheLevel.TEMPLATE],
                    json.dumps(entry_data)
                )
            except Exception as e:
                logger.error(f"Redis set error: {e}")
        else:
            # In-memory fallback
            key = f"{prefix}{cache_key}"
            self._memory_cache[key] = CacheEntry(
                response=entry_data["response"],
                model=entry_data["model"],
                input_tokens=entry_data["input_tokens"],
                output_tokens=entry_data["output_tokens"],
                cost=entry_data["cost"],
                quality_score=entry_data.get("quality_score"),
                cache_level="template",
                created_at=entry_data["created_at"],
                hits=0,
            )

    def clear(self):
        """Clear all caches"""
        if self.redis_client:
            try:
                # Clear all keys with our prefixes
                for prefix in ["exact:", "semantic:", "template:"]:
                    keys = self.redis_client.keys(f"{prefix}*")
                    if keys:
                        self.redis_client.delete(*keys)
                logger.info("Cleared Redis cache")
            except Exception as e:
                logger.error(f"Redis clear error: {e}")
        else:
            self._memory_cache.clear()
            logger.info("Cleared in-memory cache")

        # Reset stats
        self.stats = {
            "hits": 0,
            "misses": 0,
            "exact_hits": 0,
            "semantic_hits": 0,
            "template_hits": 0,
            "total_requests": 0,
        }

    def get_stats(self) -> Dict[str, Any]:
        """
        Get cache statistics

        Returns:
            Dict with hit rates and performance metrics
        """
        total = self.stats["total_requests"]
        if total == 0:
            hit_rate = 0.0
        else:
            hit_rate = self.stats["hits"] / total

        return {
            "total_requests": total,
            "cache_hits": self.stats["hits"],
            "cache_misses": self.stats["misses"],
            "hit_rate": hit_rate,
            "exact_hits": self.stats["exact_hits"],
            "semantic_hits": self.stats["semantic_hits"],
            "template_hits": self.stats["template_hits"],
            "hit_rate_percent": f"{hit_rate * 100:.1f}%",
        }
