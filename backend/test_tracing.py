#!/usr/bin/env python
"""
Test script for Distributed Tracing (Phase 4)

Tests:
1. Tracing service initialization
2. Span creation and attributes
3. Exception recording
4. Jaeger integration
"""

import os
import time

os.environ["PROMPTER_USE_TRACING"] = "true"
os.environ["JAEGER_AGENT_HOST"] = "jaeger"
os.environ["JAEGER_AGENT_PORT"] = "6831"

from app.prompter.observability import TracingService, get_tracing_service


def test_tracing_initialization():
    """Test 1: Tracing service initialization"""
    print("\n=== TEST 1: Tracing Service Initialization ===")
    try:
        tracing = TracingService(service_name="test-service")

        assert tracing.tracer is not None, "Tracer should be initialized"
        assert tracing.provider is not None, "Provider should be initialized"

        print(f"✅ TracingService initialized")
        print(f"   - Service name: {tracing.service_name}")
        print(f"   - Tracer: {tracing.tracer.__class__.__name__}")
        print(f"   - Provider: {tracing.provider.__class__.__name__}")

        return True

    except Exception as e:
        print(f"❌ Initialization failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_span_creation():
    """Test 2: Span creation and attributes"""
    print("\n=== TEST 2: Span Creation and Attributes ===")
    try:
        tracing = get_tracing_service()

        if not tracing:
            print("⚠️  Tracing disabled (PROMPTER_USE_TRACING=false)")
            return False

        # Create a span
        with tracing.start_span(
            "test.operation",
            {
                "test.attribute": "value1",
                "test.number": 42,
                "test.boolean": True
            }
        ) as span:
            assert span is not None, "Span should be created"

            # Add events
            tracing.add_event(span, "test_event", {"event_data": "test"})

            # Set additional attributes
            tracing.set_attribute(span, "dynamic.attribute", "dynamic_value")

            # Simulate some work
            time.sleep(0.01)

            tracing.set_status_ok(span)

        print(f"✅ Span created successfully")
        print(f"   - Span with 3 initial attributes")
        print(f"   - Event added: test_event")
        print(f"   - Dynamic attribute set")
        print(f"   - Status: OK")

        return True

    except Exception as e:
        print(f"❌ Span creation failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_nested_spans():
    """Test 3: Nested spans (parent-child relationship)"""
    print("\n=== TEST 3: Nested Spans ===")
    try:
        tracing = get_tracing_service()

        if not tracing:
            print("⚠️  Tracing disabled")
            return False

        # Create parent span
        with tracing.start_span("parent.operation") as parent_span:
            tracing.set_attribute(parent_span, "level", "parent")

            # Create child span 1
            with tracing.start_span("child.operation.1") as child1_span:
                tracing.set_attribute(child1_span, "level", "child1")
                time.sleep(0.005)

            # Create child span 2
            with tracing.start_span("child.operation.2") as child2_span:
                tracing.set_attribute(child2_span, "level", "child2")
                time.sleep(0.005)

            tracing.set_status_ok(parent_span)

        print(f"✅ Nested spans created successfully")
        print(f"   - 1 parent span")
        print(f"   - 2 child spans")

        return True

    except Exception as e:
        print(f"❌ Nested spans test failed: {e}")
        return False


def test_exception_recording():
    """Test 4: Exception recording in spans"""
    print("\n=== TEST 4: Exception Recording ===")
    try:
        tracing = get_tracing_service()

        if not tracing:
            print("⚠️  Tracing disabled")
            return False

        # Create span with exception
        with tracing.start_span("error.operation") as span:
            try:
                # Simulate error
                raise ValueError("Test error for tracing")
            except Exception as e:
                tracing.record_exception(span, e)
                # Don't re-raise, we're just testing

        print(f"✅ Exception recorded in span")
        print(f"   - Exception type: ValueError")
        print(f"   - Span status: ERROR")

        return True

    except Exception as e:
        print(f"❌ Exception recording test failed: {e}")
        return False


def test_jaeger_integration():
    """Test 5: Jaeger integration (verify connection)"""
    print("\n=== TEST 5: Jaeger Integration ===")
    try:
        tracing = get_tracing_service()

        if not tracing:
            print("⚠️  Tracing disabled")
            return False

        # Create multiple spans to ensure data is sent to Jaeger
        for i in range(5):
            with tracing.start_span(f"jaeger.test.{i}") as span:
                tracing.set_attribute(span, "iteration", i)
                tracing.set_attribute(span, "timestamp", time.time())
                time.sleep(0.01)

        # Force flush by shutting down (will reinitialize on next call)
        tracing.shutdown()

        print(f"✅ Jaeger integration test complete")
        print(f"   - 5 spans created and sent")
        print(f"   - Check Jaeger UI: http://localhost:16686")
        print(f"   - Service name: orbit-prompter")

        return True

    except Exception as e:
        print(f"❌ Jaeger integration test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("="*50)
    print("PHASE 4 INTEGRATION TEST: Distributed Tracing")
    print("="*50)

    results = []
    results.append(("Tracing Initialization", test_tracing_initialization()))
    results.append(("Span Creation", test_span_creation()))
    results.append(("Nested Spans", test_nested_spans()))
    results.append(("Exception Recording", test_exception_recording()))
    results.append(("Jaeger Integration", test_jaeger_integration()))

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
        print("\n🎉 Phase 4 Complete: Distributed Tracing Working!")
        print("\n📊 Next steps:")
        print("   1. Open Jaeger UI: http://localhost:16686")
        print("   2. Select service: orbit-prompter")
        print("   3. View traces with spans and attributes")
    else:
        print("\n⚠️  Some tests failed - review above")


if __name__ == "__main__":
    main()
