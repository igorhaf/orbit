"""
Option Parser for AI-Generated Questions
PROMPT #99 - Parse AI responses to extract structured options
PROMPT #109 - Extended to accept multiple bullet symbols (Gemini compatibility)

Parses AI responses that contain options in text format and converts them
to structured options that the frontend can render as radio/checkbox buttons.
"""

import re
from typing import Dict, List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

# PROMPT #109 - Common bullet symbols that AI might use instead of ○
# We normalize all of these to ○ before parsing
BULLET_SYMBOLS = [
    '○',  # White circle (U+25CB) - our standard
    '●',  # Black circle (U+25CF)
    '•',  # Bullet (U+2022)
    '◦',  # White bullet (U+25E6)
    '◉',  # Fisheye (U+25C9)
    '◯',  # Large circle (U+25EF)
    '⚪',  # White circle emoji
    '⚫',  # Black circle emoji
    '·',  # Middle dot (U+00B7)
    '-',  # Hyphen (common fallback)
    '*',  # Asterisk (common fallback)
    '–',  # En dash (U+2013)
    '—',  # Em dash (U+2014)
]

# Checkbox symbols
CHECKBOX_SYMBOLS = [
    '☐',  # Ballot box (U+2610) - our standard
    '☑',  # Ballot box with check (U+2611)
    '☒',  # Ballot box with X (U+2612)
    '□',  # White square (U+25A1)
    '■',  # Black square (U+25A0)
    '▢',  # White square with rounded corners (U+25A2)
    '▣',  # White square containing black small square (U+25A3)
]


def _normalize_bullets(content: str) -> str:
    """
    PROMPT #109 - Normalize various bullet symbols to our standard ○

    This ensures that AI responses using different bullet styles are
    still parsed correctly.
    """
    normalized = content

    # First, handle checkbox symbols (convert to ☐)
    for symbol in CHECKBOX_SYMBOLS:
        if symbol != '☐' and symbol != '☑':
            normalized = normalized.replace(symbol, '☐')

    # Then, handle regular bullets (convert to ○)
    # Only convert if they appear at the start of a line (option context)
    for symbol in BULLET_SYMBOLS:
        if symbol != '○':
            # Replace symbol at start of line (with optional whitespace before)
            pattern = rf'(^|\n)\s*{re.escape(symbol)}\s+'
            normalized = re.sub(pattern, r'\1○ ', normalized)

    return normalized


def parse_ai_question_options(content: str) -> Tuple[str, Optional[Dict]]:
    """
    Parse AI question content to extract options and determine question type.

    PROMPT #109 - Extended to normalize bullets before parsing (Gemini compatibility)

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
    1. Normalizes various bullet symbols to ○ (for Gemini compatibility)
    2. Detects if question has options (○ for radio, ☐ for checkbox)
    3. Extracts the options from the text
    4. Returns structured data for frontend rendering

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
    # PROMPT #109 - First, check if we have ANY bullet-like symbols
    found_symbols = [s for s in BULLET_SYMBOLS + CHECKBOX_SYMBOLS if s in content]
    has_any_bullet = len(found_symbols) > 0

    if has_any_bullet:
        logger.info(f"🔄 Found bullet symbols in AI response: {found_symbols}")
        # Normalize bullets for parsing
        normalized_content = _normalize_bullets(content)
        logger.info(f"📝 After normalization - has ○: {'○' in normalized_content}, has ☐: {'☐' in normalized_content}")
    else:
        logger.warning(f"⚠️  No bullet symbols found in AI response (length: {len(content)} chars)")
        logger.warning(f"⚠️  First 500 chars: {content[:500]}")
        normalized_content = content

    # Detect question type by symbols (after normalization)
    has_radio = '○' in normalized_content  # Single choice (radio buttons)
    has_checkbox = '☐' in normalized_content or '☑' in normalized_content  # Multiple choice (checkboxes)

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

    # Extract all options (use normalized_content for parsing)
    matches = re.findall(option_pattern, normalized_content, re.MULTILINE)

    if not matches:
        logger.warning(f"⚠️  Found {question_type} symbols but could not extract options")
        return normalized_content, None

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
        return normalized_content, None

    logger.info(f"✅ Parsed {question_type} question with {len(choices)} options")

    # Return normalized content (for consistent display) + structured options
    return normalized_content, {
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
