#!/usr/bin/env python
"""
Test script for BatchService (Phase 3)

Tests:
1. Batch service initialization
2. Request submission and batching
3. Batch statistics
4. Performance improvement
"""

import os
import asyncio
import time

os.environ["PROMPTER_USE_BATCHING"] = "true"

from app.prompter.optimization.batch_service import BatchService


async def mock_ai_call(prompt: str, delay: float = 0.1):
    """Mock AI call that simulates processing time"""
    await asyncio.sleep(delay)
    return {"response": f"Response to: {prompt}", "tokens": 100, "cost": 0.001}


async def test_batch_initialization():
    """Test 1: Batch service initialization"""
    print("\n=== TEST 1: Batch Service Initialization ===")
    try:
        batch = BatchService(
            batch_size=5,
            batch_window_ms=50,
            max_queue_size=100
        )
        print(f"✅ BatchService initialized")
        print(f"   - Batch size: {batch.batch_size}")
        print(f"   - Window: {batch.batch_window_ms}ms")
        print(f"   - Max queue: {batch.max_queue_size}")
        return True
    except Exception as e:
        print(f"❌ Initialization failed: {e}")
        return False


async def test_batch_submission():
    """Test 2: Request submission and batching"""
    print("\n=== TEST 2: Request Submission and Batching ===")
    try:
        batch = BatchService(batch_size=5, batch_window_ms=100)

        # Submit 10 requests (should create 2 batches)
        print("Submitting 10 requests...")
        start_time = time.time()

        tasks = [
            batch.submit("test_usage", mock_ai_call, prompt=f"Test prompt {i}")
            for i in range(10)
        ]

        results = await asyncio.gather(*tasks)
        duration = (time.time() - start_time) * 1000  # ms

        print(f"✅ All 10 requests completed in {duration:.1f}ms")
        print(f"   - Results received: {len(results)}")
        print(f"   - First result: {results[0]['response'][:30]}...")

        # Check stats
        stats = batch.get_stats()
        print(f"   - Batches executed: {stats['batches_executed']}")
        print(f"   - Avg batch size: {stats['avg_batch_size']}")

        return len(results) == 10 and stats['batches_executed'] >= 2

    except Exception as e:
        print(f"❌ Batch submission test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_batch_statistics():
    """Test 3: Batch statistics"""
    print("\n=== TEST 3: Batch Statistics ===")
    try:
        batch = BatchService(batch_size=3, batch_window_ms=50)

        # Submit 6 requests
        tasks = [
            batch.submit("stats_test", mock_ai_call, prompt=f"Stats {i}", delay=0.05)
            for i in range(6)
        ]

        await asyncio.gather(*tasks)

        stats = batch.get_stats()
        print(f"✅ Batch statistics:")
        print(f"   - Total requests: {stats['total_requests']}")
        print(f"   - Batches executed: {stats['batches_executed']}")
        print(f"   - Avg batch size: {stats['avg_batch_size']}")
        print(f"   - Avg wait time: {stats['avg_wait_time_ms']:.1f}ms")
        print(f"   - Efficiency: {stats['efficiency']}")

        return stats['total_requests'] == 6 and stats['batches_executed'] == 2

    except Exception as e:
        print(f"❌ Statistics test failed: {e}")
        return False


async def test_performance_improvement():
    """Test 4: Performance improvement vs sequential execution"""
    print("\n=== TEST 4: Performance Improvement ===")
    try:
        # Sequential execution (baseline)
        print("Running sequential execution (baseline)...")
        start_sequential = time.time()
        for i in range(5):
            await mock_ai_call(f"Sequential {i}", delay=0.1)
        sequential_time = (time.time() - start_sequential) * 1000  # ms

        # Batched execution
        print("Running batched execution...")
        batch = BatchService(batch_size=10, batch_window_ms=50)
        start_batched = time.time()

        tasks = [
            batch.submit("perf_test", mock_ai_call, prompt=f"Batched {i}", delay=0.1)
            for i in range(5)
        ]

        await asyncio.gather(*tasks)
        batched_time = (time.time() - start_batched) * 1000  # ms

        improvement = ((sequential_time - batched_time) / sequential_time) * 100

        print(f"✅ Performance comparison:")
        print(f"   - Sequential: {sequential_time:.1f}ms")
        print(f"   - Batched: {batched_time:.1f}ms")
        print(f"   - Improvement: {improvement:.1f}%")

        # Batched should be faster (requests run in parallel)
        return batched_time < sequential_time

    except Exception as e:
        print(f"❌ Performance test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    print("="*50)
    print("PHASE 3 INTEGRATION TEST: Request Batching")
    print("="*50)

    results = []
    results.append(("Batch Initialization", await test_batch_initialization()))
    results.append(("Batch Submission", await test_batch_submission()))
    results.append(("Batch Statistics", await test_batch_statistics()))
    results.append(("Performance Improvement", await test_performance_improvement()))

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
        print("\n🎉 Phase 3 Complete: Request Batching Working!")
    else:
        print("\n⚠️  Some tests failed - review above")


if __name__ == "__main__":
    asyncio.run(main())
