"""
Tests for Prompter Cache Service

Tests the multi-level caching system.
"""

import pytest
import time
from app.prompter.optimization import CacheService, CacheLevel


class TestCacheService:
    """Test CacheService functionality"""

    def setup_method(self):
        """Setup test cache service"""
        self.cache = CacheService(
            redis_client=None,  # Use in-memory for testing
            enable_semantic=False,
            similarity_threshold=0.95
        )

    def test_cache_initialization(self):
        """Test cache initializes correctly"""
        assert self.cache is not None
        assert not self.cache.enable_semantic
        assert self.cache.similarity_threshold == 0.95
        assert self.cache.stats["total_requests"] == 0

    def test_exact_match_cache_hit(self):
        """Test exact match cache hit"""
        # Setup
        cache_input = {
            "prompt": "Test prompt",
            "system_prompt": "Test system",
            "usage_type": "test",
            "temperature": 0.7,
            "model": "test-model"
        }

        cache_output = {
            "response": "Test response",
            "model": "test-model",
            "input_tokens": 100,
            "output_tokens": 50,
            "cost": 0.01,
            "quality_score": 0.9
        }

        # First request - cache miss
        result = self.cache.get(cache_input)
        assert result is None
        assert self.cache.stats["misses"] == 1

        # Store in cache
        self.cache.set(cache_input, cache_output)

        # Second request - cache hit
        result = self.cache.get(cache_input)
        assert result is not None
        assert result["response"] == "Test response"
        assert result["cache_type"] == "exact"
        assert self.cache.stats["hits"] == 1
        assert self.cache.stats["exact_hits"] == 1

    def test_cache_miss_different_prompt(self):
        """Test cache miss when prompt is different"""
        cache_input1 = {
            "prompt": "Test prompt 1",
            "system_prompt": "Test system",
            "usage_type": "test",
            "temperature": 0.7,
            "model": "test-model"
        }

        cache_input2 = {
            "prompt": "Test prompt 2",  # Different prompt
            "system_prompt": "Test system",
            "usage_type": "test",
            "temperature": 0.7,
            "model": "test-model"
        }

        cache_output = {
            "response": "Test response",
            "model": "test-model",
            "input_tokens": 100,
            "output_tokens": 50,
            "cost": 0.01
        }

        # Store first prompt
        self.cache.set(cache_input1, cache_output)

        # Try to get second prompt - should miss
        result = self.cache.get(cache_input2)
        assert result is None

    def test_template_cache_deterministic(self):
        """Test template cache for deterministic prompts (temp=0)"""
        cache_input = {
            "prompt": "Test prompt",
            "system_prompt": "Test system",
            "usage_type": "test",
            "temperature": 0,  # Deterministic
            "model": "test-model"
        }

        cache_output = {
            "response": "Test response",
            "model": "test-model",
            "input_tokens": 100,
            "output_tokens": 50,
            "cost": 0.01
        }

        # Store in cache
        self.cache.set(cache_input, cache_output)

        # Should be stored in both exact and template cache
        result = self.cache.get(cache_input)
        assert result is not None
        assert result["response"] == "Test response"

    def test_cache_statistics(self):
        """Test cache statistics tracking"""
        cache_input = {
            "prompt": "Test prompt",
            "system_prompt": None,
            "usage_type": "test",
            "temperature": 0.7,
            "model": "test-model"
        }

        cache_output = {
            "response": "Test response",
            "model": "test-model",
            "input_tokens": 100,
            "output_tokens": 50,
            "cost": 0.01
        }

        # Miss
        self.cache.get(cache_input)
        # Hit
        self.cache.set(cache_input, cache_output)
        self.cache.get(cache_input)
        # Another miss
        cache_input["prompt"] = "Different prompt"
        self.cache.get(cache_input)

        stats = self.cache.get_stats()
        assert stats["total_requests"] == 3
        assert stats["cache_hits"] == 1
        assert stats["cache_misses"] == 2
        assert stats["hit_rate"] == pytest.approx(1/3)

    def test_cache_clear(self):
        """Test cache clearing"""
        cache_input = {
            "prompt": "Test prompt",
            "system_prompt": None,
            "usage_type": "test",
            "temperature": 0.7,
            "model": "test-model"
        }

        cache_output = {
            "response": "Test response",
            "model": "test-model",
            "input_tokens": 100,
            "output_tokens": 50,
            "cost": 0.01
        }

        # Store
        self.cache.set(cache_input, cache_output)
        assert self.cache.get(cache_input) is not None

        # Clear
        self.cache.clear()

        # Stats should be reset
        assert self.cache.stats["total_requests"] == 0
        assert self.cache.stats["hits"] == 0

        # Cache should be empty (this will increment total_requests to 1)
        assert self.cache.get(cache_input) is None
        assert self.cache.stats["total_requests"] == 1  # One miss after clear

    def test_cache_key_generation(self):
        """Test cache key generation is consistent"""
        cache_input = {
            "prompt": "Test prompt",
            "system_prompt": "Test system",
            "usage_type": "test",
            "temperature": 0.7,
            "model": "test-model"
        }

        # Same input should generate same key
        key1 = self.cache._generate_cache_key(cache_input)
        key2 = self.cache._generate_cache_key(cache_input)
        assert key1 == key2

        # Different input should generate different key
        cache_input["prompt"] = "Different prompt"
        key3 = self.cache._generate_cache_key(cache_input)
        assert key1 != key3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
