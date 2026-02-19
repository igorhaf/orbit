"""
Utility functions for context generation.

JSON parsing, text cleaning, emoji removal, and semantic conversion.
Extracted from context_generator.py during modularization (PROMPT #249).
"""

from typing import Dict, List, Optional, Any
import json
import logging
import re

logger = logging.getLogger(__name__)


def _strip_markdown_json(content: str) -> str:
    """
    Remove markdown code blocks from JSON response.
    AI sometimes returns JSON wrapped in ```json ... ``` blocks.
    """
    content = re.sub(r'^```json\s*\n?', '', content, flags=re.MULTILINE)
    content = re.sub(r'\n?```\s*$', '', content, flags=re.MULTILINE)
    return content.strip()


def _strip_emojis(text) -> str:
    """
    PROMPT #185/186 - Remove emojis and special symbols from text.
    AI sometimes adds emojis despite explicit instructions not to.
    Handles non-string input (dict, list) by converting to string first.
    """
    if text is None:
        return ""
    if isinstance(text, dict):
        text = json.dumps(text, ensure_ascii=False, indent=2)
    elif isinstance(text, list):
        text = "\n".join(str(item) for item in text)
    elif not isinstance(text, str):
        text = str(text)

    # Remove emoji unicode ranges
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F1E0-\U0001F1FF"  # flags
        "\U00002702-\U000027B0"  # dingbats
        "\U000024C2-\U0001F251"  # enclosed characters
        "\U0001F900-\U0001F9FF"  # supplemental symbols
        "\U0001FA00-\U0001FA6F"  # chess symbols
        "\U0001FA70-\U0001FAFF"  # symbols extended-A
        "\U00002600-\U000026FF"  # misc symbols
        "\U0000FE00-\U0000FE0F"  # variation selectors
        "\U0000200D"             # zero width joiner
        "\U00002702-\U000027B0"  # dingbats extended
        "\U0000231A-\U0000231B"  # watch/hourglass
        "\U000023E9-\U000023F3"  # media control
        "\U000023F8-\U000023FA"  # media control extended
        "\U000025AA-\U000025AB"  # small squares
        "\U000025B6"             # play button
        "\U000025C0"             # reverse button
        "\U000025FB-\U000025FE"  # medium squares
        "\U00002614-\U00002615"  # umbrella/hot beverage
        "\U00002648-\U00002653"  # zodiac
        "\U0000267F"             # wheelchair
        "\U00002693"             # anchor
        "\U000026A1"             # high voltage
        "\U000026AA-\U000026AB"  # circles
        "\U000026BD-\U000026BE"  # sports
        "\U000026C4-\U000026C5"  # weather
        "\U000026D4"             # no entry
        "\U000026EA"             # church
        "\U000026F2-\U000026F3"  # fountain/golf
        "\U000026F5"             # sailboat
        "\U000026FA"             # tent
        "\U000026FD"             # fuel pump
        "\U00002934-\U00002935"  # arrows
        "\U00002B05-\U00002B07"  # arrows
        "\U00002B1B-\U00002B1C"  # squares
        "\U00002B50"             # star
        "\U00002B55"             # circle
        "\U00003030"             # wavy dash
        "\U0000303D"             # part alternation mark
        "\U00003297"             # circled ideograph
        "\U00003299"             # circled ideograph secret
        "\U0000200D"             # zero width joiner
        "\U00002328"             # keyboard
        "\U000023CF"             # eject
        "]+",
        flags=re.UNICODE
    )
    result = emoji_pattern.sub("", text)
    # Clean up double spaces left by emoji removal
    result = re.sub(r'  +', ' ', result)
    return result.strip()


def _dict_to_markdown_context(data: Dict, project_name: str = "") -> str:
    """
    PROMPT #186 - Convert a dict context_semantic to markdown string.

    When the AI returns context_semantic as a JSON dict instead of a markdown
    string, this function converts it to a proper markdown format.
    """
    parts = []

    if project_name:
        parts.append(f"# Contexto do Projeto: {project_name}")
        parts.append("")

    for key, value in data.items():
        if isinstance(value, str):
            parts.append(f"## {key}")
            parts.append(value)
            parts.append("")
        elif isinstance(value, list):
            parts.append(f"## {key}")
            for item in value:
                parts.append(f"- {item}")
            parts.append("")
        elif isinstance(value, dict):
            parts.append(f"## {key}")
            for sub_key, sub_value in value.items():
                parts.append(f"- **{sub_key}**: {sub_value}")
            parts.append("")
        else:
            parts.append(f"## {key}")
            parts.append(str(value))
            parts.append("")

    return "\n".join(parts)


def _robust_json_parse(response_text: str, context: str = "unknown") -> Dict:
    """
    PROMPT #148 - Robust JSON parsing with multiple recovery strategies.

    This function attempts multiple strategies to parse AI-generated JSON,
    handling common issues like:
    - Markdown code blocks
    - Truncated responses
    - Unescaped newlines in strings
    - Trailing commas

    Args:
        response_text: Raw AI response text
        context: Description of the context for logging

    Returns:
        Parsed JSON as a dictionary

    Raises:
        ValueError: If all parsing strategies fail
    """
    original_text = response_text
    result = None

    # Strategy 0: Direct parse
    try:
        result = json.loads(response_text)
        logger.info(f"[{context}] JSON parsed directly")
        return result
    except json.JSONDecodeError as e:
        logger.debug(f"[{context}] Direct parse failed: {e.msg} at pos {e.pos}")

    # Strategy 1: Strip markdown code blocks
    response_text = _strip_markdown_json(response_text)

    try:
        result = json.loads(response_text)
        logger.info(f"[{context}] JSON parsed after stripping markdown")
        return result
    except json.JSONDecodeError:
        pass

    # Strategy 2: Fix truncated response (find last complete })
    if response_text and not response_text.rstrip().endswith('}'):
        last_brace = response_text.rfind('}')
        if last_brace > 0:
            truncated_text = response_text[:last_brace + 1]
            try:
                result = json.loads(truncated_text)
                logger.info(f"[{context}] JSON parsed after truncation fix")
                return result
            except json.JSONDecodeError:
                pass

    # Strategy 3: Extract JSON object with regex
    json_match = re.search(r'\{[\s\S]*\}', response_text)
    if json_match:
        try:
            result = json.loads(json_match.group(0))
            logger.info(f"[{context}] JSON extracted with regex")
            return result
        except json.JSONDecodeError:
            pass

    # Strategy 4: Find balanced braces
    brace_start = response_text.find('{')
    if brace_start != -1:
        brace_count = 0
        brace_end = brace_start
        for i, char in enumerate(response_text[brace_start:], start=brace_start):
            if char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                if brace_count == 0:
                    brace_end = i + 1
                    break
        if brace_end > brace_start:
            try:
                result = json.loads(response_text[brace_start:brace_end])
                logger.info(f"[{context}] JSON extracted with balanced braces")
                return result
            except json.JSONDecodeError:
                pass

    # Strategy 5: Fix trailing commas
    fixed_text = re.sub(r',\s*([}\]])', r'\1', response_text)
    json_match = re.search(r'\{[\s\S]*\}', fixed_text)
    if json_match:
        try:
            result = json.loads(json_match.group(0))
            logger.info(f"[{context}] JSON parsed after fixing trailing commas")
            return result
        except json.JSONDecodeError:
            pass

    # Strategy 6: Fix unescaped newlines in strings
    json_match = re.search(r'\{[\s\S]*\}', response_text)
    if json_match:
        json_str = json_match.group(0)
        fixed_chars = []
        in_string = False
        escape_next = False

        for char in json_str:
            if escape_next:
                fixed_chars.append(char)
                escape_next = False
                continue
            if char == '\\':
                fixed_chars.append(char)
                escape_next = True
                continue
            if char == '"' and not escape_next:
                in_string = not in_string
                fixed_chars.append(char)
                continue
            if in_string and char == '\n':
                fixed_chars.append('\\n')
                continue
            if in_string and char == '\r':
                continue
            if in_string and char == '\t':
                fixed_chars.append('\\t')
                continue
            fixed_chars.append(char)

        json_str_fixed = ''.join(fixed_chars)
        try:
            result = json.loads(json_str_fixed)
            logger.info(f"[{context}] JSON parsed after newline fix")
            return result
        except json.JSONDecodeError:
            pass

    # Strategy 7: PROMPT #153 - Recover truncated arrays (especially "epics": [...])
    # When AI response has truncated array, try to salvage complete elements
    try:
        # Strip markdown first
        clean_text = _strip_markdown_json(response_text)

        # Look for "epics": [ pattern
        epics_match = re.search(r'"epics"\s*:\s*\[', clean_text)
        if epics_match:
            # Extract array content starting from [
            array_start = epics_match.end() - 1  # Position of [
            remaining = clean_text[array_start:]

            # Find complete JSON objects in the array
            complete_epics = []
            current_pos = 1  # Skip the opening [
            brace_count = 0
            obj_start = -1

            for i, char in enumerate(remaining[1:], start=1):
                if char == '{' and brace_count == 0:
                    obj_start = i
                    brace_count = 1
                elif char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0 and obj_start != -1:
                        # Complete object found
                        obj_str = remaining[obj_start:i+1]
                        try:
                            obj = json.loads(obj_str)
                            complete_epics.append(obj)
                            logger.debug(f"[{context}] Extracted complete epic: {obj.get('title', 'N/A')}")
                        except json.JSONDecodeError:
                            pass
                        obj_start = -1

            if complete_epics:
                logger.info(f"[{context}] Recovered {len(complete_epics)} complete epics from truncated response")
                return {"epics": complete_epics}

    except Exception as e:
        logger.debug(f"[{context}] Epic array recovery failed: {e}")

    # Strategy 8: Try to recover partial JSON with default values
    try:
        # Try to extract at least context_semantic
        semantic_match = re.search(r'"context_semantic"\s*:\s*"([^"]*(?:\\"[^"]*)*)"', response_text)
        if semantic_match:
            context_semantic = semantic_match.group(1).replace('\\"', '"')
            logger.warning(f"[{context}] Partial recovery: extracted context_semantic only")
            return {
                "context_semantic": context_semantic,
                "semantic_map": {},
                "interview_insights": {}
            }
    except Exception:
        pass

    # All strategies failed
    logger.error(f"[{context}] All JSON parsing strategies failed")
    logger.error(f"[{context}] Response preview: {original_text[:500]}...")

    raise ValueError(
        "AI response was not valid JSON. The response may have been truncated. "
        "Please try again with a shorter conversation or retry."
    )


def _extract_content_from_raw_response(raw_content: str, item_title: str, item_type: str = "Story") -> Dict:
    """
    PROMPT #179 - Extract usable content from raw AI response when JSON parsing fails.

    Instead of dumping raw JSON as the description, this function:
    1. Tries regex extraction of description_markdown + semantic_map from truncated JSON
    2. If found, converts semantic identifiers to human-readable text
    3. Also extracts acceptance_criteria and story_points if available
    4. Falls back to stripping JSON blocks and using any surrounding text

    Returns dict with 'description', 'generated_prompt', 'acceptance_criteria', 'semantic_map', 'story_points'
    or None if no usable content could be extracted.
    """
    if not raw_content or len(raw_content) < 50:
        return None

    extracted = {}

    # Try to extract semantic_map from the raw response
    semantic_map = {}
    sm_match = re.search(r'"semantic_map"\s*:\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}', raw_content, re.DOTALL)
    if sm_match:
        sm_text = sm_match.group(1)
        # Extract individual key-value pairs from the semantic_map
        pairs = re.findall(r'"(\w+)"\s*:\s*"([^"]*(?:\\"[^"]*)*)"', sm_text)
        for key, value in pairs:
            semantic_map[key] = value.replace('\\"', '"')

    # Try to extract description_markdown
    desc_match = re.search(
        r'"description_markdown"\s*:\s*"((?:[^"\\]|\\.)*)"',
        raw_content, re.DOTALL
    )
    description_markdown = ""
    if desc_match:
        description_markdown = desc_match.group(1)
        # Unescape JSON string escapes
        description_markdown = description_markdown.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')

    # Try to extract acceptance_criteria
    ac_list = []
    ac_match = re.search(r'"acceptance_criteria"\s*:\s*\[(.*?)\]', raw_content, re.DOTALL)
    if ac_match:
        ac_items = re.findall(r'"((?:[^"\\]|\\.)*)"', ac_match.group(1))
        ac_list = [item.replace('\\n', '\n').replace('\\"', '"') for item in ac_items if len(item) > 5]

    # Try to extract story_points
    sp_match = re.search(r'"story_points"\s*:\s*(\d+)', raw_content)
    story_points = int(sp_match.group(1)) if sp_match else None

    # Build clean content
    if description_markdown and len(description_markdown) > 100:
        # We have description_markdown - convert semantic identifiers to human text
        if semantic_map:
            human_desc = _convert_semantic_to_human(description_markdown, semantic_map)
        else:
            human_desc = description_markdown

        extracted['description'] = human_desc
        # PROMPT #180 - Include acceptance criteria in generated_prompt
        prompt_text = description_markdown
        if ac_list:
            prompt_text += "\n\n## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in ac_list)
        extracted['generated_prompt'] = prompt_text
        extracted['semantic_map'] = semantic_map
        if ac_list:
            extracted['acceptance_criteria'] = ac_list
        if story_points:
            extracted['story_points'] = story_points
        logger.info(f"[{item_type}:{item_title[:30]}] Extracted content from raw response: desc={len(human_desc)} chars, map={len(semantic_map)} keys")
        return extracted

    # description_markdown not found or too short - try stripping JSON blocks
    # Remove ```json ... ``` blocks entirely
    stripped = re.sub(r'```(?:json)?\s*\n?[\s\S]*?\n?```', '', raw_content)
    # Remove lone ``` markers
    stripped = re.sub(r'```\w*', '', stripped)
    stripped = stripped.strip()

    if stripped and len(stripped) > 100 and not stripped.lstrip().startswith('{'):
        # There's useful text outside the JSON blocks (and it's not raw JSON)
        if semantic_map:
            stripped = _convert_semantic_to_human(stripped, semantic_map)
        extracted['description'] = stripped
        # PROMPT #180 - Include criteria in generated_prompt
        prompt_text = stripped
        if ac_list:
            prompt_text += "\n\n## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in ac_list)
        extracted['generated_prompt'] = prompt_text
        extracted['semantic_map'] = semantic_map
        if ac_list:
            extracted['acceptance_criteria'] = ac_list
        if story_points:
            extracted['story_points'] = story_points
        logger.info(f"[{item_type}:{item_title[:30]}] Used stripped non-JSON text: {len(stripped)} chars")
        return extracted

    # Last resort: if we have semantic_map, build a description from it
    if semantic_map and len(semantic_map) >= 5:
        built_desc = f"# {item_type}: {item_title}\n\n## Mapa Semântico\n\n"
        for key, value in list(semantic_map.items())[:20]:
            built_desc += f"- **{key}**: {value}\n"
        if ac_list:
            built_desc += "\n## Critérios de Aceitação\n\n"
            for ac in ac_list:
                built_desc += f"- {ac}\n"
        extracted['description'] = built_desc
        extracted['generated_prompt'] = built_desc
        extracted['semantic_map'] = semantic_map
        if ac_list:
            extracted['acceptance_criteria'] = ac_list
        if story_points:
            extracted['story_points'] = story_points
        logger.info(f"[{item_type}:{item_title[:30]}] Built description from semantic_map: {len(semantic_map)} keys")
        return extracted

    return None


def _convert_semantic_to_human(semantic_text: str, semantic_map: Dict[str, str]) -> str:
    """
    PROMPT #89 - Convert semantic text to human-readable text.

    This function transforms semantic references (identifiers like N1, P1, etc.)
    into their actual meanings, creating natural prose.

    Args:
        semantic_text: Text with semantic identifiers
        semantic_map: Dictionary mapping identifiers to meanings

    Returns:
        Human-readable text with identifiers replaced
    """
    if not semantic_map or not semantic_text:
        return semantic_text or ""

    human_text = semantic_text

    # Sort identifiers by length (longest first) to avoid partial replacements
    sorted_identifiers = sorted(semantic_map.keys(), key=len, reverse=True)

    for identifier in sorted_identifiers:
        meaning = semantic_map[identifier]
        pattern = rf'\b{re.escape(identifier)}\b'
        human_text = re.sub(pattern, meaning, human_text)

    # Clean up multiple consecutive newlines
    human_text = re.sub(r'\n{3,}', '\n\n', human_text)

    return human_text.strip()
