"""
Distributed Tracing with OpenTelemetry

Provides end-to-end tracing for prompt execution pipeline.
Integrates with Jaeger for visualization and debugging.
"""

import os
import logging
from typing import Optional, Dict, Any
from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.jaeger.thrift import JaegerExporter
from opentelemetry.sdk.resources import Resource, SERVICE_NAME

logger = logging.getLogger(__name__)


class TracingService:
    """
    OpenTelemetry tracing service for distributed tracing

    Provides context managers for creating spans and tracking
    execution flow through the Prompter architecture.

    Example:
        tracing = TracingService()

        with tracing.start_span("cache_check", {"cache_level": "L1"}):
            result = cache.get(key)
    """

    def __init__(self, service_name: str = "orbit-prompter"):
        """
        Initialize tracing service

        Args:
            service_name: Name of the service for tracing
        """
        self.service_name = service_name
        self.tracer: Optional[trace.Tracer] = None
        self.provider: Optional[TracerProvider] = None

        self._initialize()

    def _initialize(self):
        """Initialize OpenTelemetry tracer with Jaeger exporter"""

        try:
            # Create resource with service name
            resource = Resource.create({
                SERVICE_NAME: self.service_name,
                "service.version": "2.1.0",
                "deployment.environment": os.getenv("ENVIRONMENT", "development")
            })

            # Create tracer provider
            self.provider = TracerProvider(resource=resource)

            # Configure Jaeger exporter
            jaeger_host = os.getenv("JAEGER_AGENT_HOST", "localhost")
            jaeger_port = int(os.getenv("JAEGER_AGENT_PORT", 6831))

            jaeger_exporter = JaegerExporter(
                agent_host_name=jaeger_host,
                agent_port=jaeger_port,
            )

            # Add span processor
            span_processor = BatchSpanProcessor(jaeger_exporter)
            self.provider.add_span_processor(span_processor)

            # Set global tracer provider
            trace.set_tracer_provider(self.provider)

            # Get tracer
            self.tracer = trace.get_tracer(__name__)

            logger.info(f"✅ Tracing initialized: {jaeger_host}:{jaeger_port}")

        except Exception as e:
            logger.warning(f"⚠️  Tracing initialization failed: {e}. Tracing disabled.")
            self.tracer = None
            self.provider = None

    @contextmanager
    def start_span(
        self,
        name: str,
        attributes: Optional[Dict[str, Any]] = None,
        kind: trace.SpanKind = trace.SpanKind.INTERNAL
    ):
        """
        Start a new span

        Args:
            name: Span name
            attributes: Optional attributes to add to span
            kind: Span kind (INTERNAL, CLIENT, SERVER, etc.)

        Yields:
            Span object or None if tracing disabled

        Example:
            with tracing.start_span("cache_check", {"cache_level": "L1"}):
                result = cache.get(key)
        """
        if not self.tracer:
            yield None
            return

        with self.tracer.start_as_current_span(name, kind=kind) as span:
            if attributes:
                for key, value in attributes.items():
                    # Convert value to string if needed for OpenTelemetry compatibility
                    if isinstance(value, (str, int, float, bool)):
                        span.set_attribute(key, value)
                    else:
                        span.set_attribute(key, str(value))

            yield span

    def add_event(self, span, name: str, attributes: Optional[Dict] = None):
        """
        Add event to current span

        Args:
            span: Span object
            name: Event name
            attributes: Optional event attributes
        """
        if span:
            span.add_event(name, attributes=attributes or {})

    def set_attribute(self, span, key: str, value: Any):
        """
        Set attribute on span

        Args:
            span: Span object
            key: Attribute key
            value: Attribute value
        """
        if span:
            # Convert value to OpenTelemetry-compatible type
            if isinstance(value, (str, int, float, bool)):
                span.set_attribute(key, value)
            else:
                span.set_attribute(key, str(value))

    def record_exception(self, span, exception: Exception):
        """
        Record exception in span

        Args:
            span: Span object
            exception: Exception to record
        """
        if span:
            span.record_exception(exception)
            span.set_status(trace.Status(trace.StatusCode.ERROR, str(exception)))

    def set_status_ok(self, span):
        """Set span status to OK"""
        if span:
            span.set_status(trace.Status(trace.StatusCode.OK))

    def set_status_error(self, span, description: str = ""):
        """Set span status to ERROR"""
        if span:
            span.set_status(trace.Status(trace.StatusCode.ERROR, description))

    def shutdown(self):
        """Shutdown tracer provider and flush pending spans"""
        if self.provider:
            logger.info("Shutting down tracing service...")
            self.provider.shutdown()
            logger.info("Tracing service shutdown complete")


# Global instance
_tracing_service: Optional[TracingService] = None


def get_tracing_service() -> Optional[TracingService]:
    """
    Get global tracing service instance

    Returns:
        TracingService instance or None if tracing disabled
    """
    global _tracing_service

    # Check if tracing is enabled via environment variable
    if os.getenv("PROMPTER_USE_TRACING", "false").lower() != "true":
        return None

    if _tracing_service is None:
        _tracing_service = TracingService()

    return _tracing_service
