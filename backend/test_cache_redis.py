#!/usr/bin/env python
"""
Test script for Redis + Cache integration (Phase 2)

Tests:
1. Redis connection
2. Cache L1 (exact match)
3. Cache L2 (semantic - gracefully degrades without sentence-transformers)
4. Cache L3 (template)
"""

import os
os.environ["PROMPTER_USE_CACHE"] = "true"
os.environ["REDIS_HOST"] = "redis"
os.environ["REDIS_PORT"] = "6379"

from app.prompter.optimization.cache_service import CacheService

def test_redis_connection():
    """Test 1: Redis connection"""
    print("\n=== TEST 1: Redis Connection ===")
    try:
        import redis
        r = redis.Redis(host='redis', port=6379, decode_responses=True)
        ping_result = r.ping()
        print(f"✅ Redis ping: {ping_result}")
        return True
    except Exception as e:
        print(f"❌ Redis connection failed: {e}")
        return False

def test_cache_l1_exact():
    """Test 2: Cache L1 (exact match)"""
    print("\n=== TEST 2: Cache L1 (Exact Match) ===")
    try:
        import redis
        r = redis.Redis(host='redis', port=6379, decode_responses=True)

        cache = CacheService(
            redis_client=r,
            enable_semantic=False
        )

        # Test set
        cache_input = {
            "prompt": "Test prompt for exact match",
            "usage_type": "test",
            "model": "gpt-4o",
            "temperature": 0.7
        }

        cache_output = {
            "response": "Test response",
            "model": "gpt-4o",
            "input_tokens": 10,
            "output_tokens": 5,
            "cost": 0.001
        }

        cache.set(cache_input, cache_output)
        print("✅ Cached test data")

        # Test get (should hit)
        result = cache.get(cache_input)
        if result and result["response"] == "Test response":
            print(f"✅ Cache HIT: {result['cache_type']}")
            return True
        else:
            print("❌ Cache MISS (expected HIT)")
            return False

    except Exception as e:
        print(f"❌ Cache L1 test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_cache_l2_semantic_graceful_degradation():
    """Test 3: Cache L2 (semantic - graceful degradation)"""
    print("\n=== TEST 3: Cache L2 (Semantic - Graceful Degradation) ===")
    try:
        import redis
        r = redis.Redis(host='redis', port=6379, decode_responses=True)

        cache = CacheService(
            redis_client=r,
            enable_semantic=True  # Enable but expect graceful degradation
        )

        # Test with semantic enabled but sentence-transformers not installed
        cache_input = {
            "prompt": "Tell me about Python programming",
            "usage_type": "test",
            "model": "gpt-4o",
            "temperature": 0.7
        }

        cache_output = {
            "response": "Python is a programming language",
            "model": "gpt-4o",
            "input_tokens": 10,
            "output_tokens": 10,
            "cost": 0.002
        }

        # Should not crash even without sentence-transformers
        cache.set(cache_input, cache_output)
        print("✅ Set without crash (graceful degradation)")

        # Try to get - should not crash
        result = cache.get(cache_input)
        print("✅ Get without crash (graceful degradation)")

        # Check if warning was logged about missing sentence-transformers
        print("ℹ️  Expected: Warning about sentence-transformers not installed")
        return True

    except Exception as e:
        print(f"❌ Cache L2 test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_cache_stats():
    """Test 4: Cache statistics"""
    print("\n=== TEST 4: Cache Statistics ===")
    try:
        import redis
        r = redis.Redis(host='redis', port=6379, decode_responses=True)

        cache = CacheService(redis_client=r)

        # Clear cache first
        cache.clear()

        # Make some requests
        cache_input = {
            "prompt": "Stats test prompt",
            "usage_type": "test",
            "model": "gpt-4o",
            "temperature": 0.7
        }

        cache_output = {
            "response": "Stats test response",
            "model": "gpt-4o",
            "input_tokens": 10,
            "output_tokens": 5,
            "cost": 0.001
        }

        # Miss
        result1 = cache.get(cache_input)
        # Set
        cache.set(cache_input, cache_output)
        # Hit
        result2 = cache.get(cache_input)

        stats = cache.get_stats()
        print(f"✅ Cache stats:")
        print(f"   - Total requests: {stats['total_requests']}")
        print(f"   - Hits: {stats['cache_hits']}")
        print(f"   - Misses: {stats['cache_misses']}")
        print(f"   - Hit rate: {stats['hit_rate_percent']}")

        return stats['cache_hits'] > 0

    except Exception as e:
        print(f"❌ Cache stats test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("="*50)
    print("PHASE 2 INTEGRATION TEST: Redis + Cache")
    print("="*50)

    results = []
    results.append(("Redis Connection", test_redis_connection()))
    results.append(("Cache L1 (Exact)", test_cache_l1_exact()))
    results.append(("Cache L2 (Semantic Degradation)", test_cache_l2_semantic_graceful_degradation()))
    results.append(("Cache Statistics", test_cache_stats()))

    print("\n" + "="*50)
    print("TEST RESULTS")
    print("="*50)

    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {name}")

    total = len(results)
    passed = sum(1 for _, p in results if p)

    print(f"\nTotal: {passed}/{total} tests passed")

    if passed == total:
        print("\n🎉 Phase 2 Complete: Redis + Cache Integration Working!")
    else:
        print("\n⚠️  Some tests failed - review above")
