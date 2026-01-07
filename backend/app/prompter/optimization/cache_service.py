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

        # PROMPT #74 - Cache statistics (persisted in Redis if available)
        # Redis keys for stats
        self.stats_keys = {
            "hits": "cache:stats:hits",
            "misses": "cache:stats:misses",
            "exact_hits": "cache:stats:exact_hits",
            "semantic_hits": "cache:stats:semantic_hits",
            "template_hits": "cache:stats:template_hits",
            "total_requests": "cache:stats:total_requests",
        }

        # Initialize stats (from Redis or in-memory)
        if self.redis_client:
            # Load stats from Redis (or initialize to 0)
            try:
                for key in self.stats_keys.keys():
                    if not self.redis_client.exists(self.stats_keys[key]):
                        self.redis_client.set(self.stats_keys[key], 0)
            except Exception as e:
                logger.warning(f"Failed to initialize Redis stats: {e}")

        # In-memory stats (fallback when Redis unavailable)
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

    def _increment_stat(self, stat_name: str, amount: int = 1):
        """
        Increment a statistic counter (in Redis if available, else in-memory)

        PROMPT #74 - Redis-persisted stats

        Args:
            stat_name: Name of stat to increment (hits, misses, etc.)
            amount: Amount to increment by (default 1)
        """
        if self.redis_client and stat_name in self.stats_keys:
            try:
                self.redis_client.incr(self.stats_keys[stat_name], amount)
            except Exception as e:
                logger.warning(f"Failed to increment Redis stat {stat_name}: {e}")
                # Fallback to in-memory
                self.stats[stat_name] = self.stats.get(stat_name, 0) + amount
        else:
            # In-memory stats
            self.stats[stat_name] = self.stats.get(stat_name, 0) + amount

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
        # PROMPT #74 - Increment stats in Redis
        self._increment_stat("total_requests")

        # Level 1: Exact Match (fastest)
        exact_result = self._get_exact(cache_input)
        if exact_result:
            self._increment_stat("hits")
            self._increment_stat("exact_hits")
            logger.info(f"✓ Cache HIT (exact) - saved ~${exact_result['cost']:.4f}")
            return exact_result

        # Level 2: Semantic Match (if enabled)
        if self.enable_semantic:
            semantic_result = self._get_semantic(cache_input)
            if semantic_result:
                self._increment_stat("hits")
                self._increment_stat("semantic_hits")
                logger.info(f"✓ Cache HIT (semantic) - saved ~${semantic_result['cost']:.4f}")
                return semantic_result

        # Level 3: Template Cache (if deterministic)
        if cache_input.get("temperature", 0.7) == 0:
            template_result = self._get_template(cache_input)
            if template_result:
                self._increment_stat("hits")
                self._increment_stat("template_hits")
                logger.info(f"✓ Cache HIT (template) - saved ~${template_result['cost']:.4f}")
                return template_result

        # Cache miss
        self._increment_stat("misses")
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
        if not self.enable_semantic:
            return None

        try:
            # Generate embedding for current prompt
            prompt = cache_input.get("prompt", "")
            if not prompt:
                return None

            embedding = self._generate_embedding(prompt)
            if embedding is None:
                return None

            # Search for similar prompts in cache
            usage_type = cache_input.get("usage_type", "")
            prefix = "semantic:"
            pattern = f"{prefix}{usage_type}:*"

            best_match = None
            best_similarity = 0.0

            if self.redis_client:
                try:
                    # Get all semantic cache keys for this usage_type
                    keys = self.redis_client.keys(pattern)

                    for key in keys:
                        cached_data = self.redis_client.get(key)
                        if not cached_data:
                            continue

                        cached = json.loads(cached_data)
                        cached_embedding = cached.get("embedding")

                        if not cached_embedding:
                            continue

                        # Calculate cosine similarity
                        similarity = self._cosine_similarity(embedding, cached_embedding)

                        if similarity > best_similarity and similarity >= self.similarity_threshold:
                            best_similarity = similarity
                            best_match = cached

                    if best_match:
                        logger.info(f"✓ Semantic cache hit (similarity: {best_similarity:.3f})")
                        return {
                            "response": best_match["response"],
                            "cache_type": "semantic",
                            "model": best_match["model"],
                            "cost": best_match["cost"],
                            "similarity": best_similarity,
                        }
                except Exception as e:
                    logger.error(f"Semantic cache search error: {e}")
                    return None
            else:
                # In-memory fallback
                for key, entry in self._memory_cache.items():
                    if not key.startswith(prefix):
                        continue

                    # Check TTL
                    if time.time() - entry.created_at > self.ttl[CacheLevel.SEMANTIC]:
                        continue

                    # Get embedding from entry (would need to store it)
                    # For in-memory, we'd need to add embedding field to CacheEntry
                    # Skip for now as Redis is the primary storage
                    pass

            return None

        except Exception as e:
            logger.error(f"Semantic cache error: {e}")
            return None

    def _generate_embedding(self, text: str):
        """
        Generate embedding vector for text using sentence-transformers

        Uses lazy loading to avoid import errors if library not installed.

        Args:
            text: Text to embed

        Returns:
            Embedding list or None if error
        """
        try:
            # Lazy load sentence-transformers
            if not hasattr(self, '_embedding_model'):
                try:
                    from sentence_transformers import SentenceTransformer
                    self._embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
                    logger.info("✓ Loaded sentence-transformers model: all-MiniLM-L6-v2")
                except ImportError:
                    logger.warning("sentence-transformers not installed - semantic cache disabled")
                    self._embedding_model = None
                    return None

            if self._embedding_model is None:
                return None

            # Generate embedding and convert to list for JSON serialization
            import numpy as np
            embedding = self._embedding_model.encode(text, normalize_embeddings=True)
            return embedding.tolist()

        except Exception as e:
            logger.error(f"Embedding generation error: {e}")
            return None

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """
        Calculate cosine similarity between two vectors

        Args:
            a: First vector (list of floats)
            b: Second vector (list of floats)

        Returns:
            Similarity score (0-1)
        """
        try:
            import numpy as np

            a_arr = np.array(a)
            b_arr = np.array(b)

            # Cosine similarity
            dot_product = np.dot(a_arr, b_arr)
            norm_a = np.linalg.norm(a_arr)
            norm_b = np.linalg.norm(b_arr)

            if norm_a == 0 or norm_b == 0:
                return 0.0

            similarity = dot_product / (norm_a * norm_b)
            return float(similarity)

        except Exception as e:
            logger.error(f"Cosine similarity calculation error: {e}")
            return 0.0

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
        If semantic caching enabled, also stores with embedding.
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

        # Store in exact match cache (L1)
        self._set_exact(cache_key, entry_data)

        # Store in semantic cache (L2) if enabled
        if self.enable_semantic:
            prompt = cache_input.get("prompt", "")
            usage_type = cache_input.get("usage_type", "")
            if prompt:
                embedding = self._generate_embedding(prompt)
                if embedding is not None:
                    self._set_semantic(usage_type, cache_key, entry_data, embedding)

        # Also store in template cache (L3) if deterministic
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

    def _set_semantic(
        self,
        usage_type: str,
        cache_key: str,
        entry_data: Dict[str, Any],
        embedding: List[float]
    ):
        """
        Store in semantic cache with embedding

        Args:
            usage_type: Type of usage (for grouping similar prompts)
            cache_key: Unique cache key
            entry_data: Cache entry data
            embedding: Prompt embedding vector
        """
        prefix = "semantic:"
        # Include usage_type in key for efficient filtering
        semantic_key = f"{prefix}{usage_type}:{cache_key[:16]}"

        # Add embedding to entry data
        semantic_entry = {
            **entry_data,
            "embedding": embedding,
        }

        if self.redis_client:
            try:
                self.redis_client.setex(
                    semantic_key,
                    self.ttl[CacheLevel.SEMANTIC],
                    json.dumps(semantic_entry)
                )
                logger.debug(f"Stored semantic cache (ttl={self.ttl[CacheLevel.SEMANTIC]}s)")
            except Exception as e:
                logger.error(f"Redis semantic set error: {e}")
        else:
            # In-memory fallback (would need to extend CacheEntry to include embedding)
            # For now, skip as Redis is the primary storage for semantic cache
            pass

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

                # PROMPT #74 - Also clear stats in Redis
                for redis_key in self.stats_keys.values():
                    self.redis_client.set(redis_key, 0)

                logger.info("Cleared Redis cache and stats")
            except Exception as e:
                logger.error(f"Redis clear error: {e}")
        else:
            self._memory_cache.clear()
            logger.info("Cleared in-memory cache")

        # Reset in-memory stats
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
        Get cache statistics (from Redis if available)

        PROMPT #74 - Read stats from Redis for multi-instance consistency

        Returns:
            Dict with hit rates and performance metrics
        """
        # PROMPT #74 - Read stats from Redis if available
        if self.redis_client:
            try:
                stats = {}
                for stat_name, redis_key in self.stats_keys.items():
                    value = self.redis_client.get(redis_key)
                    stats[stat_name] = int(value) if value else 0
            except Exception as e:
                logger.warning(f"Failed to read stats from Redis: {e}, using in-memory")
                stats = self.stats
        else:
            stats = self.stats

        total = stats["total_requests"]
        if total == 0:
            hit_rate = 0.0
        else:
            hit_rate = stats["hits"] / total

        return {
            "total_requests": total,
            "cache_hits": stats["hits"],
            "cache_misses": stats["misses"],
            "hit_rate": hit_rate,
            "exact_hits": stats["exact_hits"],
            "semantic_hits": stats["semantic_hits"],
            "template_hits": stats["template_hits"],
            "hit_rate_percent": f"{hit_rate * 100:.1f}%",
        }
