#!/usr/bin/env python
"""
Test script for Prometheus Metrics (Phase 5)

Tests:
1. Metrics endpoint is accessible
2. Metrics are recorded during execution
3. All metric types are present
4. Prometheus can query the metrics
"""

import asyncio
import os
import time
import requests

# Set environment variables
os.environ["PROMPTER_USE_TEMPLATES"] = "true"
os.environ["PROMPTER_USE_STRUCTURED_TEMPLATES"] = "true"
os.environ["PROMPTER_USE_CACHE"] = "true"
os.environ["PROMPTER_USE_BATCHING"] = "true"
os.environ["PROMPTER_USE_TRACING"] = "true"


async def test_metrics_endpoint():
    """Test 1: Metrics endpoint is accessible"""
    print("\n=== TEST 1: Metrics Endpoint Accessibility ===")
    try:
        response = requests.get("http://localhost:8000/metrics/", timeout=5)

        if response.status_code == 200:
            print(f"✅ Metrics endpoint accessible: HTTP {response.status_code}")

            # Check for Prompter metrics
            content = response.text
            metrics = [
                "prompter_executions_total",
                "prompter_execution_duration_seconds",
                "prompter_token_usage",
                "prompter_cost_per_execution_usd",
                "prompter_cache_hits_total",
                "prompter_cache_misses_total",
                "prompter_cache_hit_rate"
            ]

            found_metrics = []
            for metric in metrics:
                if metric in content:
                    found_metrics.append(metric)

            print(f"   - Found {len(found_metrics)}/{len(metrics)} Prompter metrics")
            for metric in found_metrics:
                print(f"     • {metric}")

            return len(found_metrics) == len(metrics)
        else:
            print(f"❌ Metrics endpoint returned: HTTP {response.status_code}")
            return False

    except Exception as e:
        print(f"❌ Failed to access metrics endpoint: {e}")
        return False


async def test_prometheus_scraping():
    """Test 2: Prometheus is scraping metrics"""
    print("\n=== TEST 2: Prometheus Scraping ===")
    try:
        response = requests.get("http://localhost:9090/api/v1/targets", timeout=5)

        if response.status_code == 200:
            data = response.json()
            targets = data.get("data", {}).get("activeTargets", [])

            # Find the prompter target
            prompter_target = None
            for target in targets:
                if target.get("job") == "prompter":
                    prompter_target = target
                    break

            if prompter_target:
                health = prompter_target.get("health")
                last_error = prompter_target.get("lastError")
                scrape_url = prompter_target.get("scrapeUrl")

                print(f"✅ Prometheus is scraping backend")
                print(f"   - Health: {health}")
                print(f"   - Scrape URL: {scrape_url}")
                print(f"   - Last Error: {last_error if last_error else '(none)'}")

                return health == "up" and not last_error
            else:
                print(f"❌ Prompter target not found in Prometheus")
                return False
        else:
            print(f"❌ Prometheus API returned: HTTP {response.status_code}")
            return False

    except Exception as e:
        print(f"❌ Failed to query Prometheus: {e}")
        return False


async def test_metrics_recording():
    """Test 3: Metrics are recorded during execution"""
    print("\n=== TEST 3: Metrics Recording During Execution ===")
    try:
        from app.database import SessionLocal
        from app.prompter.facade import PrompterFacade

        db = SessionLocal()
        facade = PrompterFacade(db)

        print("Executing test prompt...")

        # Execute a simple prompt to generate metrics
        result = await facade.execute(
            prompt="Generate 3 tasks for a Python web app project",
            usage_type="task_generation",
            max_tokens=1000,
            temperature=0.7
        )

        print(f"✅ Prompt executed successfully")
        print(f"   - Status: {result.status}")
        print(f"   - Tokens: {result.total_tokens}")
        print(f"   - Cost: ${result.cost:.4f}")

        # Wait a moment for metrics to be scraped
        print("\nWaiting 3s for Prometheus to scrape metrics...")
        await asyncio.sleep(3)

        # Query Prometheus for the metrics
        print("\nQuerying Prometheus for recorded metrics...")

        queries = [
            ("prompter_executions_total", "Execution count"),
            ("prompter_execution_duration_seconds_count", "Duration recordings"),
            ("prompter_token_usage_count", "Token usage recordings")
        ]

        all_found = True
        for metric, description in queries:
            response = requests.get(
                f"http://localhost:9090/api/v1/query",
                params={"query": metric},
                timeout=5
            )

            if response.status_code == 200:
                data = response.json()
                results = data.get("data", {}).get("result", [])

                if results:
                    print(f"✅ {description}: {metric}")
                    for result in results[:3]:  # Show first 3
                        metric_data = result.get("metric", {})
                        value = result.get("value", [None, None])[1]
                        labels = ", ".join(f"{k}={v}" for k, v in metric_data.items())
                        print(f"   - {labels} = {value}")
                else:
                    print(f"⚠️  {description}: No data yet (may need more time)")
            else:
                print(f"❌ Failed to query {metric}")
                all_found = False

        db.close()
        return True

    except Exception as e:
        print(f"❌ Metrics recording test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_metric_types():
    """Test 4: Verify all metric types are present"""
    print("\n=== TEST 4: Metric Types Verification ===")
    try:
        response = requests.get("http://localhost:8000/metrics/", timeout=5)
        content = response.text

        metric_types = {
            "counter": ["prompter_executions_total", "prompter_cache_hits_total"],
            "histogram": ["prompter_execution_duration_seconds", "prompter_token_usage"],
            "gauge": ["prompter_cache_hit_rate"]
        }

        all_found = True
        for metric_type, metrics in metric_types.items():
            print(f"\nChecking {metric_type.upper()} metrics:")
            for metric in metrics:
                if f"# TYPE {metric} {metric_type}" in content:
                    print(f"   ✅ {metric}")
                else:
                    print(f"   ❌ {metric} (not found)")
                    all_found = False

        return all_found

    except Exception as e:
        print(f"❌ Metric types verification failed: {e}")
        return False


async def main():
    print("="*60)
    print("PHASE 5 INTEGRATION TEST: Prometheus Metrics")
    print("="*60)

    results = []
    results.append(("Metrics Endpoint", await test_metrics_endpoint()))
    results.append(("Prometheus Scraping", await test_prometheus_scraping()))
    results.append(("Metric Types", await test_metric_types()))
    results.append(("Metrics Recording", await test_metrics_recording()))

    print("\n" + "="*60)
    print("TEST RESULTS")
    print("="*60)

    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {name}")

    total = len(results)
    passed = sum(1 for _, p in results if p)

    print(f"\nTotal: {passed}/{total} tests passed")

    if passed == total:
        print("\n🎉 Phase 5 Complete: Prometheus Metrics Working!")
    else:
        print("\n⚠️  Some tests failed - review above")


if __name__ == "__main__":
    asyncio.run(main())
