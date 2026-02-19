"""
Context Generator Package.

Modularized from monolithic context_generator.py (6000 lines) into focused modules:
- utils.py: JSON parsing, text cleaning, semantic conversion
- context_interview.py: Context interview processing and locking
- business_rules.py: Business rule classification (Epic > Story)
- card_activator.py: Card activation with rich content generation
- draft_generator.py: Draft generation and batch processing
- service.py: Main ContextGeneratorService (composes all mixins)

All existing imports continue to work unchanged:
    from app.services.context_generator import ContextGeneratorService
"""

from .service import ContextGeneratorService

__all__ = ["ContextGeneratorService"]
