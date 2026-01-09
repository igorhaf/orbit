#!/usr/bin/env python
"""
Test script for A/B Testing Framework (Phase 7)

Tests:
1. Experiment creation
2. Variant assignment (deterministic)
3. Traffic split distribution
4. Metrics collection
5. Results aggregation
"""

import asyncio
from app.prompter.observability import get_ab_testing_service


async def test_experiment_creation():
    """Test 1: Create A/B experiment"""
    print("\n=== TEST 1: Experiment Creation ===")
    try:
        ab_service = get_ab_testing_service()

        experiment = ab_service.create_experiment(
            experiment_id="test_experiment",
            name="Test Experiment",
            description="Testing A/B framework",
            control_version=1,
            variants=[
                {"name": "variant_a", "weight": 0.3, "template_version": 2},
                {"name": "variant_b", "weight": 0.2, "template_version": 3},
            ]
        )

        print(f"✅ Experiment created: {experiment.id}")
        print(f"   - Name: {experiment.name}")
        print(f"   - Control weight: {experiment.control.weight}")
        print(f"   - Variants: {len(experiment.variants)}")
        print(f"   - Status: {experiment.status.value}")

        # Verify weights sum to 1.0
        total_weight = experiment.control.weight + sum(v.weight for v in experiment.variants)
        assert abs(total_weight - 1.0) < 0.001, f"Weights must sum to 1.0, got {total_weight}"
        print(f"   - Total weight: {total_weight:.3f} ✓")

        return True

    except Exception as e:
        print(f"❌ Experiment creation failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_variant_assignment():
    """Test 2: Variant assignment is deterministic"""
    print("\n=== TEST 2: Deterministic Variant Assignment ===")
    try:
        ab_service = get_ab_testing_service()

        # Create simple experiment
        ab_service.create_experiment(
            experiment_id="determinism_test",
            name="Determinism Test",
            description="Testing deterministic assignment",
            control_version=1,
            variants=[
                {"name": "variant_50", "weight": 0.5, "template_version": 2}
            ]
        )

        # Test same assignment_key always gets same variant
        test_keys = ["user-123", "user-456", "proj-abc"]

        print("Testing deterministic assignment...")
        for key in test_keys:
            # Get variant 3 times for same key
            v1 = ab_service.get_variant("determinism_test", key)
            v2 = ab_service.get_variant("determinism_test", key)
            v3 = ab_service.get_variant("determinism_test", key)

            # All should be same
            assert v1.name == v2.name == v3.name, "Assignment is not deterministic!"
            print(f"   ✅ {key} → {v1.name} (consistent)")

        return True

    except Exception as e:
        print(f"❌ Variant assignment test failed: {e}")
        return False


async def test_traffic_distribution():
    """Test 3: Traffic split matches weights"""
    print("\n=== TEST 3: Traffic Distribution ===")
    try:
        ab_service = get_ab_testing_service()

        # Create 50/50 experiment
        ab_service.create_experiment(
            experiment_id="distribution_test",
            name="Distribution Test",
            description="Testing traffic distribution",
            control_version=1,
            variants=[
                {"name": "variant_50", "weight": 0.5, "template_version": 2}
            ]
        )

        # Simulate 1000 users
        num_users = 1000
        assignments = {"control": 0, "variant_50": 0}

        for i in range(num_users):
            variant = ab_service.get_variant("distribution_test", f"user-{i}")
            assignments[variant.name] += 1

        # Check distribution is close to 50/50
        control_pct = (assignments["control"] / num_users) * 100
        variant_pct = (assignments["variant_50"] / num_users) * 100

        print(f"   Distribution (n={num_users}):")
        print(f"   - Control: {assignments['control']} ({control_pct:.1f}%)")
        print(f"   - Variant: {assignments['variant_50']} ({variant_pct:.1f}%)")

        # Allow 5% deviation from expected 50%
        assert abs(control_pct - 50.0) < 5.0, "Control distribution too far from 50%"
        assert abs(variant_pct - 50.0) < 5.0, "Variant distribution too far from 50%"
        print("   ✅ Distribution within expected range")

        return True

    except Exception as e:
        print(f"❌ Traffic distribution test failed: {e}")
        return False


async def test_metrics_collection():
    """Test 4: Metrics collection"""
    print("\n=== TEST 4: Metrics Collection ===")
    try:
        ab_service = get_ab_testing_service()

        # Create experiment
        ab_service.create_experiment(
            experiment_id="metrics_test",
            name="Metrics Test",
            description="Testing metrics collection",
            control_version=1,
            variants=[
                {"name": "variant_a", "weight": 0.5, "template_version": 2}
            ]
        )

        # Record some metrics
        print("Recording metrics...")

        # Control metrics
        for i in range(10):
            ab_service.record_metric("metrics_test", "control", "latency", 2.0 + (i * 0.1))
            ab_service.record_metric("metrics_test", "control", "cost", 0.05)
            ab_service.record_metric("metrics_test", "control", "quality", 0.80)

        # Variant metrics (slightly better)
        for i in range(10):
            ab_service.record_metric("metrics_test", "variant_a", "latency", 1.5 + (i * 0.1))
            ab_service.record_metric("metrics_test", "variant_a", "cost", 0.03)
            ab_service.record_metric("metrics_test", "variant_a", "quality", 0.90)

        print("   ✅ Metrics recorded for both variants")

        # Get results
        results = ab_service.get_results("metrics_test")
        print(f"   - Variants: {len(results['variants'])}")
        print(f"   - Total samples: {results['summary']['total_samples']}")

        return True

    except Exception as e:
        print(f"❌ Metrics collection test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_results_analysis():
    """Test 5: Results aggregation and analysis"""
    print("\n=== TEST 5: Results Analysis ===")
    try:
        ab_service = get_ab_testing_service()

        # Get results from previous test
        results = ab_service.get_results("metrics_test")

        if not results or "variants" not in results:
            print("⚠️  No results available (run test 4 first)")
            return False

        print("\n📊 Experiment Results:")

        # Show variant metrics
        for variant_data in results["variants"]:
            variant_name = variant_data["variant_name"]
            metrics = variant_data["metrics"]

            print(f"\n   Variant: {variant_name}")
            for metric_name, metric_stats in metrics.items():
                print(f"     {metric_name}:")
                print(f"       - Mean: {metric_stats['mean']:.3f}")
                print(f"       - Count: {metric_stats['count']}")
                print(f"       - Std: {metric_stats['std']:.3f}")

        # Show comparisons
        if "comparisons" in results["summary"]:
            print("\n📈 Comparisons to Control:")
            for comparison in results["summary"]["comparisons"]:
                variant = comparison["variant"]
                print(f"\n   {variant}:")
                for metric_name, metric_comp in comparison["metrics"].items():
                    pct_diff = metric_comp["pct_difference"]
                    direction = "🔺" if pct_diff > 0 else "🔻"
                    print(f"     {metric_name}: {direction} {abs(pct_diff):.1f}%")

        print("\n✅ Results analysis complete")
        return True

    except Exception as e:
        print(f"❌ Results analysis failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_experiment_lifecycle():
    """Test 6: Experiment lifecycle (pause/resume/complete)"""
    print("\n=== TEST 6: Experiment Lifecycle ===")
    try:
        ab_service = get_ab_testing_service()

        # Create experiment
        ab_service.create_experiment(
            experiment_id="lifecycle_test",
            name="Lifecycle Test",
            description="Testing lifecycle",
            control_version=1,
            variants=[{"name": "variant", "weight": 0.5, "template_version": 2}]
        )

        exp = ab_service.get_experiment("lifecycle_test")
        print(f"   Initial status: {exp.status.value}")
        assert exp.status.value == "active"

        # Pause
        ab_service.pause_experiment("lifecycle_test")
        exp = ab_service.get_experiment("lifecycle_test")
        print(f"   After pause: {exp.status.value}")
        assert exp.status.value == "paused"

        # Resume
        ab_service.resume_experiment("lifecycle_test")
        exp = ab_service.get_experiment("lifecycle_test")
        print(f"   After resume: {exp.status.value}")
        assert exp.status.value == "active"

        # Complete
        ab_service.complete_experiment("lifecycle_test")
        exp = ab_service.get_experiment("lifecycle_test")
        print(f"   After complete: {exp.status.value}")
        assert exp.status.value == "completed"

        print("   ✅ Lifecycle transitions working correctly")
        return True

    except Exception as e:
        print(f"❌ Lifecycle test failed: {e}")
        return False


async def main():
    print("="*60)
    print("PHASE 7 INTEGRATION TEST: A/B Testing Framework")
    print("="*60)

    results = []
    results.append(("Experiment Creation", await test_experiment_creation()))
    results.append(("Variant Assignment", await test_variant_assignment()))
    results.append(("Traffic Distribution", await test_traffic_distribution()))
    results.append(("Metrics Collection", await test_metrics_collection()))
    results.append(("Results Analysis", await test_results_analysis()))
    results.append(("Experiment Lifecycle", await test_experiment_lifecycle()))

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
        print("\n🎉 Phase 7 Complete: A/B Testing Framework Working!")
        print("\nNext: Run setup_ab_experiment.py to create real experiment")
    else:
        print("\n⚠️  Some tests failed - review above")


if __name__ == "__main__":
    asyncio.run(main())
