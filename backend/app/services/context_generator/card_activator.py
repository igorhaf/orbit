"""
Card activation aggregator mixin.

Combines all card activation sub-mixins into a single CardActivatorMixin
that provides the complete activation API for epics, stories, and tasks.

Original monolithic file (2281 lines) split into focused modules:
- content_formatter.py: Shared validation and formatting methods
- epic_activator.py: Epic activation and content generation
- story_activator.py: Story activation and content generation
- task_activator.py: Task activation and content generation

Extracted from context_generator.py during modularization (PROMPT #249).
Split into sub-modules during further modularization.

All existing imports continue to work unchanged:
    from .card_activator import CardActivatorMixin
"""

from .content_formatter import ContentFormatterMixin
from .epic_activator import EpicActivatorMixin
from .story_activator import StoryActivatorMixin
from .task_activator import TaskActivatorMixin


class CardActivatorMixin(
    ContentFormatterMixin,
    EpicActivatorMixin,
    StoryActivatorMixin,
    TaskActivatorMixin,
):
    """
    Aggregator mixin providing card activation and rich content generation methods.

    Composes functionality from focused sub-mixin modules:
    - ContentFormatterMixin: _validate_and_restructure_content, _validate_context_content
    - EpicActivatorMixin: activate_suggested_epic, reject_suggested_epic, _generate_full_epic_content
    - StoryActivatorMixin: activate_suggested_story, _generate_full_story_content
    - TaskActivatorMixin: activate_suggested_task, _generate_full_task_content
    """
    pass
