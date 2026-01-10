"""
Option Parser for AI-Generated Questions
PROMPT #99 - Parse AI responses to extract structured options

Parses AI responses that contain options in text format and converts them
to structured options that the frontend can render as radio/checkbox buttons.
"""

import re
from typing import Dict, List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


def parse_ai_question_options(content: str) -> Tuple[str, Optional[Dict]]:
    """
    Parse AI question content to extract options and determine question type.

    The AI generates questions with options in this format:

    Single choice (radio):
        ❓ Pergunta 19: Qual arquitetura?

        ○ Opção 1
        ○ Opção 2
        ○ Opção 3

        Escolha UMA opção.

    Multiple choice (checkbox):
        ❓ Pergunta 20: Quais integrações?

        ☐ Opção 1
        ☐ Opção 2
        ☐ Opção 3

        ☑️ Selecione todas que se aplicam.

    This function:
    1. Detects if question has options (○ for radio, ☐ for checkbox)
    2. Extracts the options from the text
    3. Returns structured data for frontend rendering

    Args:
        content: Raw AI response content

    Returns:
        Tuple of (cleaned_content, options_dict)
        - cleaned_content: Original content (kept for display)
        - options_dict: Structured options or None if no options found
            {
                "question_type": "single_choice" | "multiple_choice",
                "options": {
                    "type": "single" | "multiple",
                    "choices": [
                        {"id": "option_1", "label": "Opção 1", "value": "option_1"},
                        ...
                    ]
                }
            }
    """
    # Detect question type by symbols
    has_radio = '○' in content  # Single choice (radio buttons)
    has_checkbox = '☐' in content or '☑' in content  # Multiple choice (checkboxes)

    if not has_radio and not has_checkbox:
        # No options found, return as-is (open question - should not happen if AI follows instructions)
        logger.warning("⚠️  AI question has no options (○ or ☐). AI may not be following instructions!")
        return content, None

    # Determine question type
    if has_checkbox:
        question_type = "multiple_choice"
        option_type = "multiple"
        # Extract checkbox options
        option_pattern = r'(?:☐|☑)\s*(.+?)(?=\n|$)'
    else:
        question_type = "single_choice"
        option_type = "single"
        # Extract radio options
        option_pattern = r'○\s*(.+?)(?=\n|$)'

    # Extract all options
    matches = re.findall(option_pattern, content, re.MULTILINE)

    if not matches:
        logger.warning(f"⚠️  Found {question_type} symbols but could not extract options")
        return content, None

    # Build choices array
    choices = []
    for i, match in enumerate(matches, 1):
        option_text = match.strip()

        # Skip if this looks like an instruction line (not an actual option)
        if any(keyword in option_text.lower() for keyword in [
            'escolha', 'selecione', 'marque', 'indique', 'todas que se aplicam'
        ]):
            continue

        # Create option ID from text (slugified)
        option_id = _slugify(option_text)

        choices.append({
            "id": option_id,
            "label": option_text,
            "value": option_id
        })

    if not choices:
        logger.warning("⚠️  No valid options extracted after filtering instruction lines")
        return content, None

    logger.info(f"✅ Parsed {question_type} question with {len(choices)} options")

    # Return original content + structured options
    return content, {
        "question_type": question_type,
        "options": {
            "type": option_type,
            "choices": choices
        }
    }


def _slugify(text: str) -> str:
    """
    Convert text to slug-style ID.

    Examples:
        "Laravel (PHP)" -> "laravel_php"
        "Clean Architecture (DDD)" -> "clean_architecture_ddd"
        "Gateway de pagamento" -> "gateway_de_pagamento"
    """
    # Remove special characters, keep only alphanumeric and spaces
    text = re.sub(r'[^\w\s-]', '', text.lower())

    # Replace spaces and hyphens with underscores
    text = re.sub(r'[-\s]+', '_', text)

    # Remove leading/trailing underscores
    text = text.strip('_')

    return text[:50]  # Limit length
