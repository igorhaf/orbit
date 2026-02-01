"""
Option Parser for AI-Generated Questions
PROMPT #99 - Parse AI responses to extract structured options
PROMPT #109 - Extended to accept multiple bullet symbols (Gemini compatibility)
PROMPT #125 v2 - All questions are now multiple choice (checkbox) for better UX

Parses AI responses that contain options in text format and converts them
to structured options that the frontend can render as checkbox buttons.
"""

import re
from typing import Dict, List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

# Flag to track if we're inside an async context (for AI analysis)
_db_session = None

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

# PROMPT #142 - Unicode variation selector (U+FE0F) that appears after emojis
# Example: ☑️ = ☑ (U+2611) + ️ (U+FE0F)
VARIATION_SELECTOR = '\uFE0F'


def _normalize_bullets(content: str) -> str:
    """
    PROMPT #109 - Normalize various bullet symbols to our standard ○
    PROMPT #142 - Handle Unicode variation selector (U+FE0F)

    This ensures that AI responses using different bullet styles are
    still parsed correctly.
    """
    normalized = content

    # PROMPT #142 - Remove variation selectors that can cause parsing issues
    # Example: ☑️ becomes ☑, ☐️ becomes ☐
    normalized = normalized.replace(VARIATION_SELECTOR, '')

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
    PROMPT #143 - Updated to use "-" (hyphen) as primary option marker (no emojis)

    The AI generates questions with options in this format:

    **Pergunta 19:** Qual arquitetura?
    Selecione uma ou mais opcoes:

    - Opcao 1
    - Opcao 2
    - Opcao 3

    Ou descreva com suas proprias palavras.

    This function:
    1. Detects if question has options (lines starting with "- ")
    2. Extracts the options from the text
    3. Returns structured data for frontend rendering

    Args:
        content: Raw AI response content

    Returns:
        Tuple of (cleaned_content, options_dict)
        - cleaned_content: Original content (kept for display)
        - options_dict: Structured options or None if no options found
            {
                "question_type": "multiple_choice",
                "options": {
                    "type": "multiple",
                    "choices": [
                        {"id": "option_1", "label": "Opcao 1", "value": "option_1"},
                        ...
                    ]
                }
            }
    """
    # PROMPT #143 - Remove variation selector for compatibility
    normalized_content = _normalize_bullets(content)

    # PROMPT #143 - Detect options by hyphen at start of line (primary format)
    # Pattern: line starting with "- " followed by option text
    hyphen_options = re.findall(r'^[\s]*-\s+(.+?)$', normalized_content, re.MULTILINE)

    # Also check for legacy checkbox/radio symbols (backwards compatibility)
    checkbox_options = re.findall(r'☐\s*(.+?)(?=\n|$)', normalized_content, re.MULTILINE)
    radio_options = re.findall(r'○\s*(.+?)(?=\n|$)', normalized_content, re.MULTILINE)

    # PROMPT #143 - Prioritize hyphen format (new format without emojis)
    if hyphen_options:
        matches = hyphen_options
        logger.info(f"Found {len(hyphen_options)} hyphen options (-)")
    elif checkbox_options:
        matches = checkbox_options
        logger.info(f"Found {len(checkbox_options)} checkbox options (legacy)")
    elif radio_options:
        matches = radio_options
        logger.info(f"Found {len(radio_options)} radio options (legacy)")
    else:
        logger.warning(f"No options found in AI response (length: {len(content)} chars)")
        return content, None

    # PROMPT #143 - All questions are now multiple choice
    question_type = "multiple_choice"
    option_type = "multiple"

    # Build choices array
    choices = []
    for i, match in enumerate(matches, 1):
        option_text = match.strip()

        # PROMPT #142 - Only filter out COMPLETE instruction phrases, not partial matches
        # This allows options like "Selecione a versão mais recente" to pass through
        instruction_phrases = [
            'selecione uma ou mais',
            'selecione todas',
            'escolha uma ou mais',
            'escolha todas',
            'marque todas',
            'indique todas',
            'todas que se aplicam',
            'ou descreva com suas proprias palavras',
            'ou descreva com suas próprias palavras',
        ]

        is_instruction = any(phrase in option_text.lower() for phrase in instruction_phrases)

        if is_instruction:
            logger.info(f"Skipping instruction line: '{option_text[:50]}...'")
            continue

        # Create option ID from text (slugified)
        option_id = _slugify(option_text)

        choices.append({
            "id": option_id,
            "label": option_text,
            "value": option_id
        })

    if not choices:
        logger.warning("No valid options extracted after filtering instruction lines")
        return normalized_content, None

    logger.info(f"Parsed {question_type} question with {len(choices)} options")

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


async def analyze_and_convert_choice_type(content: str, db) -> str:
    """
    PROMPT #125 v2 - Always convert to multiple choice.
    PROMPT #143 - Updated to use "-" format without emojis.

    Simplified approach: ALL questions should be multiple choice to provide
    better UX. Users can select one or more options as needed.

    This function:
    1. Normalizes bullet symbols (removes variation selectors)
    2. Converts legacy symbols to "-" format if needed
    3. Adds "Selecione uma ou mais opcoes:" instruction if needed

    Args:
        content: The AI-generated question content with options
        db: Database session (kept for API compatibility, not used)

    Returns:
        Content normalized for parsing
    """
    # First normalize the content (remove variation selectors)
    normalized = _normalize_bullets(content)

    # PROMPT #143 - Check if we have options (new format with "-" or legacy)
    has_hyphen = bool(re.search(r'^[\s]*-\s+', normalized, re.MULTILINE))
    has_radio = '○' in normalized
    has_checkbox = '☐' in normalized or '☑' in normalized

    # If using new hyphen format, return as is
    if has_hyphen:
        logger.info("Already using hyphen format (-), no conversion needed")
        return normalized

    if not has_radio and not has_checkbox:
        # No options, nothing to convert
        logger.info("No options found, skipping conversion")
        return content

    # Convert legacy ○ and ☐ to hyphen format
    logger.info("Converting legacy symbols to hyphen format")
    converted = normalized
    converted = re.sub(r'○\s*', '- ', converted)
    converted = re.sub(r'☐\s*', '- ', converted)
    converted = re.sub(r'☑\s*', '', converted)  # Remove checked checkbox (instruction line)

    # Add "Selecione uma ou mais opcoes:" if not present
    if 'selecione' not in converted.lower():
        # Find the question line and add after it
        if re.search(r'\*\*Pergunta\s*\d+:', converted):
            converted = re.sub(
                r'(\*\*Pergunta\s*\d+:?\s*[^\n]+\*\*)',
                r'\1\nSelecione uma ou mais opcoes:',
                converted,
                count=1
            )
        else:
            converted = re.sub(
                r'(Pergunta\s*\d+:?\s*[^\n]+)',
                r'\1\nSelecione uma ou mais opcoes:',
                converted,
                count=1
            )

    logger.info(f"Converted to hyphen format. First 200 chars: {converted[:200]}")
    return converted
