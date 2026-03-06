"""
Context Generator Package.

Modularized from monolithic context_generator.py (6000 lines) into focused modules:
- utils.py: JSON parsing, text cleaning, semantic conversion
- context_interview.py: Context interview processing and locking
- business_rules.py: Business rule classification (Epic > Story)
- card_activator.py: Card activation aggregator (composes sub-mixins below)
  - content_formatter.py: Shared validation and formatting methods
  - epic_activator.py: Epic activation and content generation
  - story_activator.py: Story activation and content generation
  - task_activator.py: Task/Subtask activation and content generation
- draft_generator.py: Draft generation and batch processing (composes sub-mixins below)
  - draft_helpers.py: Shared helper functions (dedup, hierarchy, wiki context)
  - draft_stories.py: Draft story generation from epics
  - draft_tasks.py: Draft task generation from stories
- service.py: Main ContextGeneratorService (composes all mixins)

All existing imports continue to work unchanged:
    from app.services.context_generator import ContextGeneratorService
"""

from .service import ContextGeneratorService

__all__ = ["ContextGeneratorService"]
