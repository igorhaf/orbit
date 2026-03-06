"""
Backlog Generator - Utility Functions
Standalone helper functions used across the backlog generation pipeline.
Extracted from backlog_generator.py for modularity.
"""

import re
import json
import logging
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.task import Task, PriorityLevel
from app.models.spec import Spec
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


def get_business_rules_context(db: Session, project_id: UUID, max_rules: int = 15) -> str:
    """
    PROMPT #170 - Retrieve and format business rules for prompt injection.

    Business rules extracted from codebase memory scan (interfaces, validations,
    models, migrations) are HIGH PRIORITY context that MUST influence all card generation.

    Args:
        db: Database session
        project_id: Project UUID
        max_rules: Maximum number of rules to include

    Returns:
        Formatted business rules text for prompt injection, or empty string if none found
    """
    try:
        rag_service = RAGService(db)

        # Get all business rules for project
        rules = rag_service.get_business_rules(
            project_id=project_id,
            top_k=max_rules
        )

        if not rules:
            logger.info(f"📋 No business rules found for project {project_id}")
            return ""

        # Format rules for prompt injection
        formatted = rag_service.format_business_rules_for_prompt(rules)

        logger.info(f"📋 Retrieved {len(rules)} business rules for prompt injection")
        return formatted

    except Exception as e:
        logger.warning(f"⚠️  Failed to retrieve business rules: {e}")
        return ""


def strip_markdown_json(content: str) -> str:
    """
    Remove markdown code blocks from JSON response.

    AI sometimes returns JSON wrapped in ```json ... ``` blocks.
    This function strips those markers to get pure JSON.

    Args:
        content: Raw AI response that may contain markdown

    Returns:
        Clean JSON string without markdown markers
    """
    # Remove ```json and ``` markers
    content = re.sub(r'^```json\s*\n?', '', content, flags=re.MULTILINE)
    content = re.sub(r'\n?```\s*$', '', content, flags=re.MULTILINE)

    return content.strip()


def convert_semantic_to_human(semantic_markdown: str, semantic_map: Dict[str, str]) -> str:
    """
    PROMPT #85/86 - Convert semantic markdown to human-readable text.

    This function transforms semantic references (N1, P1, E1, etc.) into
    their actual meanings, creating natural prose from structured semantic text.

    Args:
        semantic_markdown: Markdown text with semantic identifiers (N1, P1, etc.)
        semantic_map: Dictionary mapping identifiers to their meanings

    Returns:
        Human-readable text with identifiers replaced by their meanings
    """
    if not semantic_map or not semantic_markdown:
        return semantic_markdown or ""

    human_text = semantic_markdown

    # PROMPT #86 - FIRST: Remove the entire "## Mapa Semântico" section BEFORE replacements
    # This prevents redundant output like "**Recepcionista**: Recepcionista"
    # Pattern matches: ## Mapa Semântico (or Mapa Semântico) followed by definition lines
    # until next ## heading or end of section
    human_text = re.sub(
        r'##\s*Mapa\s*Sem[aâ]ntico\s*\n+(?:[-*]\s*\*\*[^*]+\*\*:[^\n]*\n*)*',
        '',
        human_text,
        flags=re.IGNORECASE | re.MULTILINE
    )

    # Sort identifiers by length (longest first) to avoid partial replacements
    # e.g., replace "AC10" before "AC1"
    sorted_identifiers = sorted(semantic_map.keys(), key=len, reverse=True)

    for identifier in sorted_identifiers:
        meaning = semantic_map[identifier]
        # Replace identifier with meaning (case-sensitive, word boundaries)
        # Match: **N1**, N1, (N1), [N1], N1:, N1,, N1.
        pattern = rf'\b{re.escape(identifier)}\b'
        human_text = re.sub(pattern, meaning, human_text)

    # Clean up markdown formatting artifacts
    # Remove any remaining bullet points that look like semantic definitions
    human_text = re.sub(r'^[-*]\s*\*\*[^*]+\*\*:\s*[^\n]*$\n?', '', human_text, flags=re.MULTILINE)

    # Clean up double asterisks that might be left from **identifier** patterns
    human_text = re.sub(r'\*\*\*\*', '', human_text)

    # Clean up empty bullet points
    human_text = re.sub(r'^[-*]\s*$\n?', '', human_text, flags=re.MULTILINE)

    # Clean up multiple consecutive newlines
    human_text = re.sub(r'\n{3,}', '\n\n', human_text)

    return human_text.strip()


def format_conversation(conversation: List[Dict]) -> str:
    """
    Format interview conversation for AI consumption.

    Args:
        conversation: List of message dicts with role/content

    Returns:
        Formatted conversation string
    """
    formatted = []
    for i, msg in enumerate(conversation):
        role = msg.get("role", "unknown").upper()
        content = msg.get("content", "")
        formatted.append(f"[{i}] {role}: {content}")

    return "\n\n".join(formatted)


def build_specs_context(
    specs: List[Spec],
    story: Task,
    max_specs: int = 10
) -> str:
    """
    Build Specs context for AI (relevant specs only).

    Strategy:
    1. Filter specs by relevance (keywords in story title/description)
    2. Limit to max_specs to avoid token bloat
    3. Format for AI consumption

    Args:
        specs: List of available Specs
        story: Story being decomposed
        max_specs: Maximum number of specs to include

    Returns:
        Formatted specs context string
    """
    if not specs:
        return "FRAMEWORK SPECIFICATIONS:\nNone available."

    # Simple relevance scoring (keyword matching)
    story_text = f"{story.title} {story.description}".lower()

    scored_specs = []
    for spec in specs:
        score = 0
        spec_keywords = [
            spec.category.lower(),
            spec.name.lower(),
            spec.spec_type.lower()
        ]

        for keyword in spec_keywords:
            if keyword in story_text:
                score += 1

        scored_specs.append((score, spec))

    # Sort by score (descending) and take top N
    scored_specs.sort(key=lambda x: x[0], reverse=True)
    top_specs = [spec for _, spec in scored_specs[:max_specs]]

    # Format specs
    formatted = ["FRAMEWORK SPECIFICATIONS (follow these patterns):"]
    for spec in top_specs:
        # PROMPT #54 - Token Optimization: Only add "..." if actually truncated
        content = spec.content[:500]
        truncated_suffix = "..." if len(spec.content) > 500 else ""

        formatted.append(f"""
---
Category: {spec.category}
Framework: {spec.name}
Type: {spec.spec_type}
Title: {spec.title}

Specification:
{content}{truncated_suffix}
---
""")

    return "\n".join(formatted)


def build_task_generation_prompt(project, task_type: str) -> str:
    """Build system prompt for task generation based on task type."""
    base_prompt = f"""You are an AI product manager generating actionable tasks for a software project.

PROJECT: {project.name}
TASK TYPE: {task_type.upper()}

Your task:
1. Analyze the interview conversation
2. Extract ONE clear, actionable task
3. Include acceptance criteria (measurable conditions)
4. Suggest story points (Fibonacci scale)
5. Assign appropriate priority and labels

Output ONLY valid JSON. Be concise but complete.
"""

    if task_type == "bug":
        return base_prompt + """
For BUG tasks, focus on:
- Clear reproduction steps
- Expected vs actual behavior
- Root cause if mentioned
- Fix approach
"""
    elif task_type == "feature":
        return base_prompt + """
For FEATURE tasks, focus on:
- User story (who, what, why)
- Functional requirements
- Acceptance criteria (how to test)
- Integration points
"""
    elif task_type == "refactor":
        return base_prompt + """
For REFACTOR tasks, focus on:
- Current code problems
- Desired outcome
- Behavior preservation (no functionality changes)
- Testing strategy
"""
    elif task_type == "enhancement":
        return base_prompt + """
For ENHANCEMENT tasks, focus on:
- Existing functionality
- Proposed improvements
- Benefits and value
- Backward compatibility
"""
    else:
        return base_prompt


def format_conversation_for_task(conversation: list) -> str:
    """Format conversation for AI analysis."""
    formatted = []
    for i, msg in enumerate(conversation, 1):
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        formatted.append(f"[{i}] {role.upper()}: {content}")
    return "\n\n".join(formatted)


def parse_priority(priority_str: str) -> PriorityLevel:
    """Parse priority string to enum."""
    priority_map = {
        "critical": PriorityLevel.CRITICAL,
        "high": PriorityLevel.HIGH,
        "medium": PriorityLevel.MEDIUM,
        "low": PriorityLevel.LOW,
        "trivial": PriorityLevel.TRIVIAL
    }
    return priority_map.get(priority_str.lower(), PriorityLevel.MEDIUM)
