"""
Response Cleaning Utilities
PROMPT #69 - Refactor interviews.py

Functions for cleaning AI responses before showing to users.
Removes internal analysis blocks, structured data, and command-style directives.
"""

import re
import logging

logger = logging.getLogger(__name__)


def clean_ai_response(content: str) -> str:
    """
    Remove internal analysis blocks from AI response before showing to user.

    PROMPT #53 - Clean Interview Responses

    Removes blocks like:
    - CONTEXT_ANALYSIS: {...}
    - STEP 1: CONTEXT_ANALYSIS
    - Any internal structured analysis that shouldn't be visible

    Args:
        content: Raw AI response content

    Returns:
        Cleaned content with only user-facing question
    """
    logger.info(f"🧹 Cleaning AI response (length: {len(content)} chars)")

    # Pattern 1: Remove entire ACTION blocks (e.g., "ACTION: REQUIREMENTS_INTERVIEW")
    content = re.sub(
        r'ACTION:\s*\w+.*?(?=❓|$)',
        '',
        content,
        flags=re.DOTALL | re.IGNORECASE
    )

    # Pattern 2: Remove all STEP blocks (STEP 1, STEP 2, etc.)
    content = re.sub(
        r'STEP\s+\d+:.*?(?=❓|STEP|$)',
        '',
        content,
        flags=re.DOTALL | re.IGNORECASE
    )

    # Pattern 3: Remove CONTEXT_ANALYSIS blocks
    content = re.sub(
        r'CONTEXT_ANALYSIS:.*?(?=❓|$)',
        '',
        content,
        flags=re.DOTALL | re.IGNORECASE
    )

    # Pattern 4: Remove command-style lines (CLASSIFY, SELECT, EXTRACT, ANALYZE, etc.)
    content = re.sub(
        r'^\s*(CLASSIFY|SELECT|EXTRACT|ANALYZE|IDENTIFY|DETECT|CREATE|GENERATE|PRIORITIZE|EVALUATE)\s+.*?$',
        '',
        content,
        flags=re.MULTILINE | re.IGNORECASE
    )

    # Pattern 5: Remove structured data sections
    content = re.sub(
        r'^\s*(project_context|conversation_history|already_covered|missing_info|question_priority|remaining_topics|single_most_relevant|Constraints):.*?(?=^❓|^[A-Z]|\Z)',
        '',
        content,
        flags=re.MULTILINE | re.DOTALL
    )

    # Pattern 4: Remove lines that are clearly internal structure
    lines = content.split('\n')
    cleaned_lines = []
    skip_block = False

    for line in lines:
        stripped = line.strip()

        # Skip empty lines at start
        if not stripped and not cleaned_lines:
            continue

        # Detect start of internal analysis block
        if any(marker in stripped.lower() for marker in [
            'action:',
            'step 1:',
            'step 2:',
            'step 3:',
            'context_analysis',
            'question_prioritization',
            'project_context:',
            'conversation_history:',
            'already_covered_topics:',
            'remaining_topics',
            'missing_information:',
            'question_priority:',
            'single_most_relevant',
            'constraints:',
            'classify ',
            'select ',
            'extract ',
            'analyze ',
            'identify ',
            'detect ',
            'core features:',
            'business rules:',
            'integrations and users:',
            'performance and security:'
        ]):
            skip_block = True
            continue

        # Detect end of internal block (when we hit actual question)
        if stripped.startswith('❓') or stripped.startswith('Pergunta'):
            skip_block = False

        # Keep line if not in skip block
        if not skip_block:
            cleaned_lines.append(line)

    content = '\n'.join(cleaned_lines)

    # Clean up excessive whitespace
    content = re.sub(r'\n{3,}', '\n\n', content)
    content = content.strip()

    logger.info(f"✨ Cleaned response (new length: {len(content)} chars)")

    return content
