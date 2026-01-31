"""
Option Parser for AI-Generated Questions
PROMPT #99 - Parse AI responses to extract structured options
PROMPT #109 - Extended to accept multiple bullet symbols (Gemini compatibility)
PROMPT #125 - Added AI-powered choice type analysis

Parses AI responses that contain options in text format and converts them
to structured options that the frontend can render as radio/checkbox buttons.
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


async def analyze_and_convert_choice_type(content: str, db) -> str:
    """
    PROMPT #125 - Use AI to analyze question and determine correct choice type.

    This function:
    1. Extracts the question text and options from the content
    2. Calls AI to determine if it should be single_choice or multiple_choice
    3. Converts the symbols if needed (○ to ☐ or vice versa)

    Args:
        content: The AI-generated question content with options
        db: Database session for AI orchestrator

    Returns:
        Content with correct symbols (○ for single, ☐ for multiple)
    """
    from app.services.ai_orchestrator import AIOrchestrator
    from app.prompts.loader import PromptLoader

    # First normalize the content
    normalized = _normalize_bullets(content)

    # Check if we have options
    has_radio = '○' in normalized
    has_checkbox = '☐' in normalized or '☑' in normalized

    if not has_radio and not has_checkbox:
        # No options, nothing to analyze
        logger.info("📋 No options found (no ○ or ☐), skipping choice type analysis")
        return content

    # PROMPT #125 FIX - Extract question text, handling markdown **bold** format
    # Format can be: **Pergunta 5: Quais são...** or ❓ Pergunta 5: Quais são...
    # First, try to find the question line (before options)
    lines = normalized.split('\n')
    question_text = ""
    for line in lines:
        # Skip empty lines and option lines
        line_stripped = line.strip()
        if not line_stripped:
            continue
        if line_stripped.startswith('○') or line_stripped.startswith('☐') or line_stripped.startswith('☑'):
            break
        # Check if this looks like a question line
        if 'pergunta' in line_stripped.lower() or '❓' in line_stripped:
            # Remove markdown bold markers and emoji
            clean_line = re.sub(r'\*\*', '', line_stripped)
            clean_line = re.sub(r'^❓\s*', '', clean_line)
            # Remove "Pergunta N:" prefix
            clean_line = re.sub(r'^Pergunta\s*\d+:?\s*', '', clean_line)
            question_text = clean_line.strip()
            break

    logger.info(f"📋 Extracted question for analysis: '{question_text[:80]}...' (has_radio={has_radio}, has_checkbox={has_checkbox})")

    # Extract options text
    if has_radio:
        options = re.findall(r'○\s*(.+?)(?=\n|$)', normalized)
    else:
        options = re.findall(r'[☐☑]\s*(.+?)(?=\n|$)', normalized)

    # Filter out instruction lines
    options = [opt.strip() for opt in options if not any(
        kw in opt.lower() for kw in ['escolha', 'selecione', 'marque', 'indique', 'todas que se aplicam']
    )]

    if not options or not question_text:
        logger.warning(f"⚠️  Cannot analyze choice type: question_text='{question_text[:50] if question_text else 'EMPTY'}', options={len(options) if options else 0}")
        return normalized

    logger.info(f"📋 Options extracted for analysis: {options[:3]}... (total: {len(options)})")
    options_text = "\n".join(f"- {opt}" for opt in options)

    try:
        # Load the analyzer prompt
        loader = PromptLoader()
        system_prompt, user_prompt = loader.render(
            "interviews/choice_type_analyzer",
            {
                "question_text": question_text,
                "options_text": options_text
            }
        )

        # Call AI to analyze (using prompt_generation for speed)
        orchestrator = AIOrchestrator(db)
        response = await orchestrator.execute(
            usage_type="prompt_generation",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=system_prompt,
            max_tokens=10  # We only need "SINGLE" or "MULTIPLE"
        )

        ai_answer = response.get("content", "").strip().upper()
        logger.info(f"🤖 Choice type analysis: '{question_text[:50]}...' -> {ai_answer}")

        # Determine current and desired type
        current_is_multiple = has_checkbox
        should_be_multiple = "MULTIPLE" in ai_answer

        if current_is_multiple == should_be_multiple:
            # Already correct type
            logger.info(f"✅ Choice type already correct: {'multiple' if should_be_multiple else 'single'}")
            return normalized

        # Need to convert
        if should_be_multiple:
            # Convert ○ to ☐
            logger.info("🔄 Converting single_choice (○) to multiple_choice (☐)")
            converted = re.sub(r'○\s*', '☐ ', normalized)
            # Add "Selecione todas que se aplicam" if not present
            if 'selecione todas' not in converted.lower():
                # Find the question line and add after it
                # PROMPT #125 FIX - Handle both formats: **Pergunta N:...** and ❓ Pergunta N:...
                # Try markdown format first
                if re.search(r'\*\*Pergunta\s*\d+:', converted):
                    converted = re.sub(
                        r'(\*\*Pergunta\s*\d+:?\s*[^\n]+\*\*)',
                        r'\1\n☑️ Selecione todas que se aplicam.',
                        converted,
                        count=1
                    )
                else:
                    # Try emoji format
                    converted = re.sub(
                        r'((?:❓\s*)?Pergunta\s*\d+:?\s*[^\n]+)',
                        r'\1\n☑️ Selecione todas que se aplicam.',
                        converted,
                        count=1
                    )
            logger.info(f"✅ Converted to multiple_choice. First 200 chars: {converted[:200]}")
            return converted
        else:
            # Convert ☐ to ○
            logger.info("🔄 Converting multiple_choice (☐) to single_choice (○)")
            converted = re.sub(r'[☐☑]\s*', '○ ', normalized)
            # Remove "Selecione todas que se aplicam" line
            converted = re.sub(r'\n?☑️?\s*[Ss]elecione todas que se aplicam\.?\n?', '\n', converted)
            logger.info(f"✅ Converted to single_choice. First 200 chars: {converted[:200]}")
            return converted

    except Exception as e:
        logger.error(f"❌ Error analyzing choice type: {e}")
        # Return normalized content on error (keeps original type)
        return normalized
