"""
ContextGeneratorService
PROMPT #89 - Generate project context from Context Interview
PROMPT #92 - Generate suggested epics from context
PROMPT #94 - Activate/Reject suggested epics

This service processes the Context Interview and generates:
- context_semantic: Structured semantic text for AI consumption
- context_human: Human-readable project description
- suggested_epics: List of macro-level epics covering all project modules

The context is the foundational, immutable description of the project
that guides all subsequent interviews and card generation.
"""

from typing import Dict, List, Optional, Any, Set
from uuid import UUID, uuid4
from datetime import datetime
from sqlalchemy.orm import Session
import asyncio
import json
import logging
import re

from app.models.project import Project
from app.models.interview import Interview, InterviewStatus
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.services.ai_orchestrator import AIOrchestrator
from app.services.rag_service import RAGService
# PROMPT #164 - PrompterFacade is deprecated, graceful fallback to AIOrchestrator
try:
    from app.prompter.facade import PrompterFacade
    PROMPTER_AVAILABLE = True
except ImportError:
    PROMPTER_AVAILABLE = False
    PrompterFacade = None
from app.prompts import PromptService, get_prompt_service

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


class ContextGeneratorService:
    """
    Service for generating project context from Context Interview.

    PROMPT #89 - Context Interview: Foundational Project Description

    This service:
    1. Analyzes the Context Interview conversation
    2. Generates structured semantic text (for AI)
    3. Converts to human-readable description
    4. Saves both to the Project model
    """

    def __init__(self, db: Session):
        self.db = db
        # PROMPT #164 - PrompterFacade deprecated, graceful fallback
        if PROMPTER_AVAILABLE and PrompterFacade:
            try:
                self.prompter = PrompterFacade(db)
            except RuntimeError:
                self.prompter = None
        else:
            self.prompter = None
        self.orchestrator = AIOrchestrator(db)
        # PROMPT #103 - Use PromptService for external prompts
        self.prompt_service = get_prompt_service(db)

    async def generate_context_from_interview(
        self,
        interview_id: UUID,
        project_id: UUID
    ) -> Dict:
        """
        Generate project context from Context Interview conversation.

        PROMPT #89 - Context Interview Processing

        Flow:
        1. Validate interview (must be context mode, have enough messages)
        2. AI analyzes conversation and generates structured context
        3. Extract semantic map and create human-readable version
        4. Save to Project model
        5. Mark interview as completed

        Args:
            interview_id: Context Interview ID
            project_id: Project ID

        Returns:
            {
                "context_semantic": str,
                "context_human": str,
                "semantic_map": Dict[str, str],
                "interview_insights": {
                    "project_vision": str,
                    "problem_statement": str,
                    "key_features": [str, ...],
                    "target_users": [str, ...],
                    "success_criteria": [str, ...]
                }
            }

        Raises:
            ValueError: If interview not found, wrong mode, or insufficient data
        """
        # 1. Validate interview
        interview = self.db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            raise ValueError(f"Interview {interview_id} not found")

        # Accept both "context" and "meta_prompt" modes for compatibility
        if interview.interview_mode not in ["context", "meta_prompt"]:
            raise ValueError(
                f"Interview {interview_id} is not a context interview "
                f"(mode: {interview.interview_mode}). Only 'context' mode supported."
            )

        # PROMPT #122 - Allow generating context from memory scan even without conversation
        # If project has initial_memory_context from codebase scan, we can generate context
        # with minimal conversation (just the AI greeting is enough)
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        has_memory_context = bool(project.initial_memory_context)
        message_count = len(interview.conversation_data or [])

        if has_memory_context:
            # With memory context, we only need 1 message (AI greeting) minimum
            if message_count < 1:
                raise ValueError(
                    f"Interview {interview_id} has no messages. "
                    "At least the initial AI message is required."
                )
            logger.info(f"📝 Generating context from memory scan + {message_count} messages")
        else:
            # Without memory context, require 6 messages (3 Q&A pairs)
            if message_count < 6:
                raise ValueError(
                    f"Interview {interview_id} has insufficient data. "
                    f"Need at least 6 messages (3 Q&A pairs), got {message_count}."
                )

        # Check if context is already locked
        if project.context_locked:
            raise ValueError(
                f"Project {project_id} context is already locked. "
                "Cannot regenerate context after first epic is created."
            )

        # 3. Build conversation summary for AI
        # PROMPT #122 - When conversation is minimal, use memory context as the main source
        if has_memory_context and message_count <= 2:
            # Use memory context as the primary source
            conversation_summary = self._build_memory_context_summary(project.initial_memory_context)
            logger.info("📋 Using memory context as primary source (minimal conversation)")
        else:
            # Use conversation as the primary source
            conversation_summary = self._build_conversation_summary(interview.conversation_data)

        # 4. Generate context using AI
        context_result = await self._generate_context_with_ai(
            project=project,
            conversation_summary=conversation_summary
        )

        # 4.5. PROMPT #175 - Validate context content before saving
        context_result = self._validate_context_content(context_result, project.name)

        # 5. Save to project - PROMPT #186: Final emoji strip before DB save
        project.context_semantic = _strip_emojis(context_result["context_semantic"])
        project.context_human = _strip_emojis(context_result["context_human"])
        project.description = _strip_emojis(context_result["context_human"])

        # 6. Mark interview as completed
        interview.status = InterviewStatus.COMPLETED

        self.db.commit()

        logger.info(f"✅ Context generated for project {project.name}")
        logger.info(f"   - Semantic: {len(context_result['context_semantic'])} chars")
        logger.info(f"   - Human: {len(context_result['context_human'])} chars")

        # 7. PROMPT #92 - Generate suggested epics from context
        try:
            suggested_epics = await self.generate_suggested_epics(
                project_id=project_id,
                context_human=context_result["context_human"],
                interview_insights=context_result.get("interview_insights", {})
            )
            context_result["suggested_epics"] = suggested_epics
            logger.info(f"   - Suggested Epics: {len(suggested_epics)}")
        except Exception as e:
            logger.error(f"Failed to generate suggested epics: {e}")
            context_result["suggested_epics"] = []

        # 8. PROMPT #120 - Generate closed cards for verified business rules
        try:
            business_rule_cards = await self.generate_business_rule_cards(
                project_id=project_id
            )
            context_result["business_rule_cards"] = business_rule_cards
            logger.info(f"   - Business Rule Cards: {len(business_rule_cards)}")
        except Exception as e:
            logger.error(f"Failed to generate business rule cards: {e}")
            context_result["business_rule_cards"] = []

        return context_result

    def _build_conversation_summary(self, conversation_data: List[Dict]) -> str:
        """
        Build a structured summary of the conversation for AI processing.

        Args:
            conversation_data: List of conversation messages

        Returns:
            Formatted conversation summary
        """
        summary_parts = []

        for i, msg in enumerate(conversation_data):
            role = msg.get("role", "unknown")
            content = msg.get("content", "")

            if role == "assistant":
                # AI question
                summary_parts.append(f"**Pergunta:** {content}")
            elif role == "user":
                # User answer
                summary_parts.append(f"**Resposta:** {content}")
                summary_parts.append("")  # Empty line between Q&A pairs

        return "\n".join(summary_parts)

    def _build_memory_context_summary(self, memory_context: Dict) -> str:
        """
        PROMPT #122 - Build a structured summary from memory scan context.

        When user skips the interview (clicks "Gerar Contexto" immediately),
        we use the codebase scan results as the primary context source.

        Args:
            memory_context: Dict with stack_info, key_features, business_rules, etc.

        Returns:
            Formatted context summary for AI processing
        """
        summary_parts = []

        # Stack info
        stack_info = memory_context.get("stack_info", {})
        if stack_info.get("detected_stack"):
            summary_parts.append(f"**Stack Tecnológica:** {stack_info['detected_stack']}")
            if stack_info.get("description"):
                summary_parts.append(f"   {stack_info['description']}")
            summary_parts.append("")

        # Scan summary
        scan_summary = memory_context.get("scan_summary", {})
        if scan_summary:
            langs = scan_summary.get("languages", {})
            if langs:
                lang_str = ", ".join([f"{k}: {v}" for k, v in langs.items()])
                summary_parts.append(f"**Linguagens Detectadas:** {lang_str}")
            summary_parts.append(f"**Arquivos Analisados:** {scan_summary.get('code_files', 0)} arquivos de código")
            summary_parts.append("")

        # Key features
        key_features = memory_context.get("key_features", [])
        if key_features:
            summary_parts.append("**Funcionalidades Principais Detectadas:**")
            for feature in key_features:
                summary_parts.append(f"- {feature}")
            summary_parts.append("")

        # Business rules
        business_rules = memory_context.get("business_rules", [])
        if business_rules:
            summary_parts.append("**Regras de Negócio Extraídas do Código:**")
            for i, rule in enumerate(business_rules, 1):
                summary_parts.append(f"{i}. {rule}")
            summary_parts.append("")

        # Interview context (the AI-generated summary from memory scan)
        interview_context = memory_context.get("interview_context", "")
        if interview_context:
            summary_parts.append("**Análise do Codebase:**")
            summary_parts.append(interview_context)
            summary_parts.append("")

        return "\n".join(summary_parts)

    async def _generate_context_with_ai(
        self,
        project: Project,
        conversation_summary: str
    ) -> Dict:
        """
        Use AI to generate structured context from conversation.

        Args:
            project: Project instance
            conversation_summary: Formatted conversation summary

        Returns:
            Dict with context_semantic, context_human, semantic_map, and insights
        """
        system_prompt = """Você é um especialista em análise de requisitos de software.

Sua tarefa é analisar uma entrevista de contexto de projeto e gerar:

1. **CONTEXTO SEMÂNTICO** (context_semantic):
   - Texto estruturado com identificadores semânticos
   - Use identificadores como: N1 (nome), P1 (problema), V1 (visão), U1 (usuário), F1 (funcionalidade)
   - Inclua um Mapa Semântico no final com todas as definições

2. **MAPA SEMÂNTICO** (semantic_map):
   - Dicionário JSON mapeando cada identificador para seu significado
   - Exemplo: {"N1": "Sistema de Vendas", "P1": "Gestão de estoque ineficiente"}

3. **INSIGHTS DA ENTREVISTA** (interview_insights):
   - project_vision: Visão geral do projeto
   - problem_statement: Problema que o projeto resolve
   - key_features: Lista de funcionalidades principais
   - target_users: Tipos de usuários do sistema
   - success_criteria: Critérios de sucesso

FORMATO DE RESPOSTA (JSON):
```json
{
    "context_semantic": "## Contexto do Projeto\\n\\n### Visão\\nN1 é um sistema que resolve P1...\\n\\n### Usuários\\n- U1: ...\\n\\n## Mapa Semântico\\n- **N1**: Nome do projeto\\n- **P1**: Problema principal",
    "semantic_map": {
        "N1": "Nome do Projeto",
        "P1": "Problema principal",
        "V1": "Visão do projeto",
        "U1": "Primeiro tipo de usuário",
        "F1": "Primeira funcionalidade"
    },
    "interview_insights": {
        "project_vision": "Desenvolver um sistema...",
        "problem_statement": "Atualmente o cliente enfrenta...",
        "key_features": ["Feature 1", "Feature 2"],
        "target_users": ["Admin", "Usuário Final"],
        "success_criteria": ["Reduzir tempo de...", "Aumentar eficiência..."]
    }
}
```

IMPORTANTE:
- O context_semantic DEVE SER UMA STRING de texto markdown, NAO um objeto/dicionario JSON
- O context_semantic deve ser rico e detalhado (minimo 500 caracteres)
- Use portugues brasileiro
- Os identificadores devem ser concisos (2-3 caracteres)
- O Mapa Semantico deve estar DENTRO do context_semantic no final
- Retorne APENAS o JSON, sem texto adicional
- NUNCA use blocos de codigo markdown (```json)
- NUNCA use emojis, icones ou simbolos especiais Unicode (nenhum emoji como casa, estrela, foguete, etc)
- Comece a resposta diretamente com { e termine com }"""

        # PROMPT #120 - Include business rules from memory scan in context
        # PROMPT #170 - Also retrieve business rules from RAG (may be more complete)
        business_rules_section = ""
        business_rules = []

        # First, try to get from initial_memory_context
        if project.initial_memory_context:
            memory_ctx = project.initial_memory_context
            business_rules = memory_ctx.get("business_rules", [])

        # Then, retrieve from RAG (may have additional rules from later analysis)
        try:
            from app.services.rag_service import RAGService
            rag_service = RAGService(self.db)

            rag_rules = rag_service.get_business_rules(
                project_id=project.id,
                top_k=20
            )

            if rag_rules:
                # Add RAG rules that aren't duplicates
                existing_rules_lower = set(r.lower() for r in business_rules)
                for rag_rule in rag_rules:
                    content = rag_rule.get("content", "")
                    if content.lower() not in existing_rules_lower:
                        business_rules.append(content)
                        existing_rules_lower.add(content.lower())

                logger.info(f"📋 Context: Retrieved {len(rag_rules)} business rules from RAG")
        except Exception as e:
            logger.warning(f"⚠️  Failed to retrieve business rules from RAG: {e}")

        if business_rules:
            business_rules_section = "\n\n## REGRAS DE NEGÓCIO VERIFICADAS NO CÓDIGO\n"
            business_rules_section += "(Estas regras foram extraídas automaticamente do código-fonte existente)\n\n"
            for i, rule in enumerate(business_rules, 1):
                business_rules_section += f"{i}. {rule}\n"

        user_prompt = f"""Analise a seguinte entrevista de contexto para o projeto "{project.name}":

{conversation_summary}
{business_rules_section}

IMPORTANTE: Se houver "REGRAS DE NEGÓCIO VERIFICADAS NO CÓDIGO" acima, inclua-as no context_semantic
em uma seção dedicada "## Regras de Negócio Existentes" com identificadores RN1, RN2, etc.

Gere o contexto semântico estruturado, o mapa semântico e os insights conforme especificado."""

        # Call AI
        messages = [{"role": "user", "content": user_prompt}]

        # PROMPT #144 - Increased max_tokens to avoid truncation
        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=8000,
            enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
            project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            # Note: temperature is configured in the AI model settings in the database
        )

        # Parse response - PROMPT #148: Use robust JSON parser
        response_text = response.get("content", "")
        logger.info(f"[generate_context] Raw response length: {len(response_text)} chars")

        # Use robust JSON parser with multiple recovery strategies
        result = _robust_json_parse(response_text, context="generate_context")

        # Validate required fields
        if "context_semantic" not in result:
            raise ValueError("AI response missing 'context_semantic' field")

        semantic_map = result.get("semantic_map", {})

        # PROMPT #186 - Handle context_semantic returned as dict instead of string
        raw_semantic = result["context_semantic"]
        if isinstance(raw_semantic, dict):
            logger.warning("[generate_context] context_semantic is a dict, converting to markdown string")
            context_semantic = _dict_to_markdown_context(raw_semantic, project.name)
        elif isinstance(raw_semantic, str):
            context_semantic = raw_semantic
        else:
            context_semantic = str(raw_semantic)

        context_semantic = _strip_emojis(context_semantic)

        # Convert semantic to human-readable
        context_human = _strip_emojis(_convert_semantic_to_human(context_semantic, semantic_map))

        # Remove the Mapa Semântico section from human text
        context_human = re.sub(
            r'##\s*Mapa\s*Sem[aâ]ntico\s*\n+(?:[-*]\s*\*\*[^*]+\*\*:[^\n]*\n*)*',
            '',
            context_human,
            flags=re.IGNORECASE | re.MULTILINE
        )
        context_human = context_human.strip()

        return {
            "context_semantic": context_semantic,
            "context_human": context_human,
            "semantic_map": semantic_map,
            "interview_insights": result.get("interview_insights", {})
        }

    async def generate_suggested_epics(
        self,
        project_id: UUID,
        context_human: str,
        interview_insights: Dict
    ) -> List[Dict]:
        """
        PROMPT #92 - Generate suggested epics from project context.
        PROMPT #121 - Exclude existing features from memory scan.

        Generates a comprehensive list of macro-level epics (modules) that
        cover the entire scope of the project based on the context interview.

        IMPORTANT (PROMPT #121): Features already existing in the code (detected
        by memory scan) are NOT included as suggested epics. These are already
        documented as closed cards (PROMPT #120). Suggested epics are only for
        NEW functionality to be developed.

        All epics are created as suggestions (inactive) with labels=["suggested"].
        They appear grayed out in the UI until the user activates them.

        Args:
            project_id: Project ID
            context_human: Human-readable project context
            interview_insights: Insights extracted from the context interview

        Returns:
            List of suggested epic dictionaries
        """
        # PROMPT #121 - Get existing features from memory scan
        project = self.db.query(Project).filter(Project.id == project_id).first()
        existing_features = []
        existing_business_rules = []
        if project and project.initial_memory_context:
            memory_ctx = project.initial_memory_context
            existing_features = memory_ctx.get("key_features", [])
            existing_business_rules = memory_ctx.get("business_rules", [])

        # Build section about existing features
        # PROMPT #185 - Removed emojis from prompts
        existing_section = ""
        if existing_features or existing_business_rules:
            existing_section = """

ATENCAO - FUNCIONALIDADES JA EXISTENTES NO CODIGO:
As seguintes funcionalidades JA FORAM IMPLEMENTADAS e verificadas no codigo-fonte.
NAO gere epicos para estas features - elas ja existem e estao documentadas como cards fechados.
Sugira apenas funcionalidades NOVAS que ainda precisam ser desenvolvidas."""

            if existing_features:
                existing_section += "\n\nFEATURES JA IMPLEMENTADAS (nao sugerir epicos para estas):"
                for f in existing_features:
                    existing_section += f"\n- [JA EXISTE] {f}"

            if existing_business_rules:
                existing_section += "\n\nREGRAS DE NEGOCIO JA IMPLEMENTADAS (nao sugerir epicos para estas):"
                for rule in existing_business_rules[:5]:  # Limit to first 5 for brevity
                    existing_section += f"\n- [JA EXISTE] {rule[:100]}..."

        system_prompt = """Você é um arquiteto de software especialista em decomposição de sistemas.

Sua tarefa é analisar o contexto de um projeto e gerar uma lista de Épicos (módulos macro) para NOVAS funcionalidades a serem desenvolvidas.

REGRAS CRÍTICAS:
1. NÃO sugira épicos para funcionalidades que JÁ EXISTEM no código (marcadas com [JA EXISTE])
2. Sugira APENAS épicos para funcionalidades NOVAS que ainda precisam ser desenvolvidas
3. Se uma feature já existe ([JA EXISTE]), NÃO inclua épico similar ou relacionado
4. Foque em melhorias, extensões e novas capacidades que o sistema AINDA NÃO TEM

REGRAS GERAIS:
1. Cada épico representa um MÓDULO ou ÁREA FUNCIONAL macro do sistema
2. Use nomes CURTOS e DESCRITIVOS para os épicos (máx 50 caracteres)
3. A descrição deve ser breve (1-2 frases) explicando o escopo do módulo
4. Ordene por prioridade/dependência lógica (fundacionais primeiro)

FORMATO DE RESPOSTA (JSON):
```json
{
    "epics": [
        {
            "title": "Nova Funcionalidade X",
            "description": "Descrição da nova funcionalidade que ainda não existe no sistema.",
            "priority": "high",
            "order": 1
        }
    ]
}
```

PRIORIDADES VÁLIDAS: critical, high, medium, low

IMPORTANTE:
- Se o sistema já tem muitas features implementadas, é normal ter POUCOS épicos sugeridos
- Pode retornar lista vazia se todas as features principais já existem
- NÃO repita funcionalidades existentes com nomes diferentes
- Retorne APENAS o JSON, sem texto adicional
- NUNCA use emojis ou simbolos especiais nos títulos ou descrições"""

        # Build user prompt with context
        key_features = interview_insights.get("key_features", [])
        target_users = interview_insights.get("target_users", [])

        features_text = "\n".join([f"- {f}" for f in key_features]) if key_features else "Não especificadas"
        users_text = "\n".join([f"- {u}" for u in target_users]) if target_users else "Não especificados"

        user_prompt = f"""Analise o seguinte contexto de projeto e gere épicos apenas para NOVAS funcionalidades:

## CONTEXTO DO PROJETO
{context_human}

## FUNCIONALIDADES DESEJADAS (da entrevista)
{features_text}

## USUÁRIOS DO SISTEMA
{users_text}
{existing_section}

Gere a lista de Épicos apenas para funcionalidades NOVAS que ainda não existem no sistema.
Se todas as principais features já existem, retorne uma lista com poucos ou nenhum épico."""

        # Call AI
        messages = [{"role": "user", "content": user_prompt}]

        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=4000,
            enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
            project_id=str(project.id)  # PROMPT #125 - Log to prompts table
        )

        # Parse response
        response_text = response.get("content", "")
        response_text = _strip_markdown_json(response_text)

        try:
            result = json.loads(response_text)
            epics = result.get("epics", [])
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse epic suggestions as JSON: {e}")
            logger.error(f"Response text: {response_text[:500]}...")
            # Return empty list on error - don't fail the whole process
            return []

        # Save epics to database
        saved_epics = []
        priority_map = {
            "critical": PriorityLevel.CRITICAL,
            "high": PriorityLevel.HIGH,
            "medium": PriorityLevel.MEDIUM,
            "low": PriorityLevel.LOW
        }

        for i, epic_data in enumerate(epics):
            try:
                epic = Task(
                    id=uuid4(),
                    project_id=project_id,
                    title=epic_data.get("title", f"Épico {i+1}")[:255],
                    description=epic_data.get("description", ""),
                    item_type=ItemType.EPIC,
                    status=TaskStatus.BACKLOG,
                    priority=priority_map.get(epic_data.get("priority", "medium"), PriorityLevel.MEDIUM),
                    order=epic_data.get("order", i + 1),
                    labels=["suggested"],  # Mark as suggested (inactive)
                    workflow_state="draft",  # Draft state for suggested items
                    reporter="system",
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                self.db.add(epic)
                saved_epics.append({
                    "id": str(epic.id),
                    "title": epic.title,
                    "description": epic.description,
                    "priority": epic_data.get("priority", "medium"),
                    "order": epic.order
                })
            except Exception as e:
                logger.error(f"Failed to create epic '{epic_data.get('title')}': {e}")
                continue

        self.db.commit()

        logger.info(f"✅ Generated {len(saved_epics)} suggested epics for project {project_id}")

        return saved_epics

    async def generate_business_rule_cards(
        self,
        project_id: UUID
    ) -> List[Dict]:
        """
        PROMPT #120 - Generate closed cards for verified business rules.
        PROMPT #193 - Hierarchical structure: Epic > Story > Task > Subtask.
        PROMPT #285 - Duplicate protection: skips if business_rule cards already exist.

        Uses AI to classify business rules into a proper hierarchy grouped
        by business domain. Each level of the tree maps to an item_type:
        - Level 0 = Epic (business domain/module)
        - Level 1 = Story (business rule)
        - Level 2 = Task (technical aspect)
        - Level 3 = Subtask (implementation detail)

        All cards are CLOSED/DONE since they represent already-implemented rules.

        Falls back to flat structure (1 Epic + N Stories) if AI classification fails.

        Args:
            project_id: Project ID

        Returns:
            List of created business rule card dictionaries
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            logger.error(f"Project {project_id} not found")
            return []

        # Check if project has memory context with business rules
        if not project.initial_memory_context:
            logger.info(f"Project {project_id} has no initial_memory_context, skipping business rules")
            return []

        business_rules = project.initial_memory_context.get("business_rules", [])
        if not business_rules:
            logger.info(f"Project {project_id} has no business rules in memory context")
            return []

        # PROMPT #285 - Duplicate protection: check if business_rule cards already exist
        existing_br_cards = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.labels.contains(["business_rule"]),
            Task.workflow_state == "closed"
        ).count()

        if existing_br_cards > 0:
            logger.info(
                f"Project {project_id} already has {existing_br_cards} business_rule cards, "
                f"skipping to avoid duplicates"
            )
            return []

        logger.info(f"Generating {len(business_rules)} business rule cards for project {project.name}")

        # PROMPT #193 - Try hierarchical classification via AI
        hierarchy = await self._classify_rules_hierarchy(project, business_rules)

        if hierarchy:
            # Create cards recursively from AI-classified hierarchy
            saved_cards = self._create_hierarchy_cards(project_id, hierarchy)
            self.db.commit()
            logger.info(f"Generated {len(saved_cards)} hierarchical business rule cards")
            return saved_cards

        # Fallback: flat structure (original PROMPT #120 behavior)
        logger.warning("Hierarchical classification failed, using flat structure")
        return self._create_flat_business_rule_cards(project_id, business_rules)

    async def _classify_rules_hierarchy(
        self,
        project: Any,
        business_rules: List[str]
    ) -> Optional[List[Dict]]:
        """
        PROMPT #193 - Use AI to classify business rules into hierarchical structure.
        PROMPT #264 - Added retry logic (2 attempts) with timeout and detailed logging.

        Returns list of hierarchy nodes or None if classification fails.
        """
        import json
        import traceback

        from app.contracts.loader import ContractLoader
        loader = ContractLoader()

        # Format rules as numbered text
        rules_text = "\n".join([f"{i}. {rule}" for i, rule in enumerate(business_rules, 1)])

        # Get additional context from memory
        memory_ctx = project.initial_memory_context or {}
        key_features = memory_ctx.get("key_features", [])
        entities = memory_ctx.get("entities", [])

        features_text = "\n".join([f"- {f}" for f in key_features]) if key_features else ""
        entities_text = "\n".join([f"- {e}" for e in entities]) if entities else ""

        system_prompt, user_prompt = loader.render(
            "memory/business_rules_hierarchy",
            {
                "project_name": project.name,
                "rules_text": rules_text,
                "key_features": features_text,
                "entities": entities_text
            }
        )

        # PROMPT #264 - Retry logic with 2 attempts
        max_retries = 2
        for attempt in range(max_retries):
            try:
                response = await asyncio.wait_for(
                    self.orchestrator.execute(
                        usage_type="memory",
                        messages=[{"role": "user", "content": user_prompt}],
                        system_prompt=system_prompt,
                        max_tokens=6000,
                        project_id=str(project.id)
                    ),
                    timeout=120
                )

                content = response.get("content", "")

                # Parse JSON response
                json_start = content.find("{")
                json_end = content.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    parsed = json.loads(content[json_start:json_end])
                    hierarchy = parsed.get("hierarchy", [])
                    if hierarchy and isinstance(hierarchy, list):
                        logger.info(f"AI classified rules into {len(hierarchy)} domain groups (attempt {attempt + 1})")
                        return hierarchy

                logger.warning(f"AI response did not contain valid hierarchy (attempt {attempt + 1}/{max_retries})")

            except json.JSONDecodeError as e:
                logger.warning(f"JSON parse error in hierarchy classification (attempt {attempt + 1}/{max_retries}): {e}")
            except asyncio.TimeoutError:
                logger.warning(f"Hierarchy classification timed out after 120s (attempt {attempt + 1}/{max_retries})")
            except Exception as e:
                logger.error(f"Hierarchy classification failed (attempt {attempt + 1}/{max_retries}): {e}")
                logger.error(traceback.format_exc())

        logger.warning(f"Hierarchy classification failed after {max_retries} attempts, will use flat fallback")
        return None

    def _create_hierarchy_cards(
        self,
        project_id: UUID,
        nodes: List[Dict],
        parent_id: Optional[UUID] = None,
        depth: int = 0,
        order_start: int = 0
    ) -> List[Dict]:
        """
        PROMPT #193 - Recursively create cards from AI-classified hierarchy.

        Maps depth to item_type:
        - 0 = Epic, 1 = Story, 2 = Task, 3+ = Subtask
        """
        DEPTH_TO_TYPE = {
            0: ItemType.EPIC,
            1: ItemType.STORY,
            2: ItemType.TASK,
            3: ItemType.SUBTASK
        }

        saved_cards = []

        for i, node in enumerate(nodes):
            item_type = DEPTH_TO_TYPE.get(depth, ItemType.SUBTASK)
            title = node.get("title", "Sem titulo")[:200]
            description = node.get("description", "")

            card = Task(
                id=uuid4(),
                project_id=project_id,
                parent_id=parent_id,
                title=title,
                description=description,
                generated_prompt=description,
                item_type=item_type,
                status=TaskStatus.DONE,
                priority=PriorityLevel.HIGH if depth == 0 else PriorityLevel.MEDIUM,
                order=order_start + i,
                labels=["business_rule", "verified", "from_code"],
                workflow_state="closed",
                resolution="fixed",
                reporter="system",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            self.db.add(card)

            saved_cards.append({
                "id": str(card.id),
                "title": card.title,
                "item_type": item_type.value if hasattr(item_type, 'value') else str(item_type),
                "workflow_state": "closed",
                "depth": depth
            })

            # Recurse into children (max depth 3 = subtask)
            children = node.get("children", [])
            if children and depth < 3:
                child_cards = self._create_hierarchy_cards(
                    project_id, children, parent_id=card.id, depth=depth + 1
                )
                saved_cards.extend(child_cards)

        return saved_cards

    def _create_flat_business_rule_cards(
        self,
        project_id: UUID,
        business_rules: List[str]
    ) -> List[Dict]:
        """
        PROMPT #120 - Original flat structure fallback.
        Creates 1 Epic + N Stories for business rules.
        """
        saved_cards = []

        parent_epic = Task(
            id=uuid4(),
            project_id=project_id,
            title="Regras de Negocio Documentadas",
            description=f"Regras de negocio verificadas no codigo-fonte. Total: {len(business_rules)}",
            item_type=ItemType.EPIC,
            status=TaskStatus.DONE,
            priority=PriorityLevel.HIGH,
            order=0,
            labels=["business_rule", "verified", "from_code"],
            workflow_state="closed",
            resolution="fixed",
            reporter="system",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        self.db.add(parent_epic)
        saved_cards.append({
            "id": str(parent_epic.id),
            "title": parent_epic.title,
            "item_type": "epic",
            "workflow_state": "closed"
        })

        for i, rule in enumerate(business_rules, 1):
            rule_title = rule.split(":")[0] if ":" in rule else rule[:80]
            if len(rule_title) > 80:
                rule_title = rule_title[:77] + "..."

            story = Task(
                id=uuid4(),
                project_id=project_id,
                parent_id=parent_epic.id,
                title=f"RN{i}: {rule_title}",
                description=rule,
                generated_prompt=f"RN{i}: {rule}",
                item_type=ItemType.STORY,
                status=TaskStatus.DONE,
                priority=PriorityLevel.MEDIUM,
                order=i,
                labels=["business_rule", "verified", "from_code"],
                workflow_state="closed",
                resolution="fixed",
                reporter="system",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            self.db.add(story)
            saved_cards.append({
                "id": str(story.id),
                "title": story.title,
                "item_type": "story",
                "workflow_state": "closed"
            })

        self.db.commit()
        logger.info(f"Generated {len(saved_cards)} flat business rule cards (fallback)")
        return saved_cards

    async def lock_context(self, project_id: UUID) -> bool:
        """
        Lock the project context, making it immutable.

        PROMPT #89 - Context is locked automatically when first epic is generated.

        Args:
            project_id: Project ID

        Returns:
            True if locked successfully

        Raises:
            ValueError: If project not found or context already locked
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if project.context_locked:
            logger.warning(f"Project {project_id} context is already locked")
            return True

        if not project.context_semantic:
            raise ValueError(
                f"Cannot lock context for project {project_id}: no context generated yet"
            )

        project.context_locked = True
        project.context_locked_at = datetime.utcnow()
        self.db.commit()

        logger.info(f"🔒 Context locked for project {project.name}")

        # PROMPT #162 - Index project context in RAG for cross-project learning
        try:
            rag_service = RAGService(self.db)
            rag_service.store_project_context(
                project_id=project.id,
                context_semantic=project.context_semantic,
                context_human=project.context_human or ""
            )
            logger.info(f"📚 Project context indexed in RAG: {project.name}")
        except Exception as e:
            logger.error(f"❌ Error indexing context in RAG: {str(e)}")

        return True

    def is_context_ready(self, project_id: UUID) -> bool:
        """
        Check if project context is ready (generated and optionally locked).

        Args:
            project_id: Project ID

        Returns:
            True if context_semantic is not empty
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return False

        return bool(project.context_semantic)

    def is_context_locked(self, project_id: UUID) -> bool:
        """
        Check if project context is locked.

        Args:
            project_id: Project ID

        Returns:
            True if context is locked
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return False

        return project.context_locked

    async def activate_suggested_epic(self, epic_id: UUID) -> Dict:
        """
        PROMPT #94 - Activate a suggested item by generating full content.

        Takes a suggested item (with labels=["suggested"] and workflow_state="draft")
        and generates full semantic content using the project context.

        Works with any item type (Epic, Story, Task, Subtask).

        Flow:
        1. Validate item is a suggested item
        2. Fetch project context
        3. Generate full item content using AI (semantic markdown + human description)
        4. Update item with generated content
        5. Remove "suggested" label and change workflow_state to "open"
        6. Lock project context if this is the first activated item (for Epics)

        Args:
            epic_id: Item ID to activate (named epic_id for backwards compatibility)

        Returns:
            Dict with activated item data:
            {
                "id": str,
                "title": str,
                "description": str,
                "generated_prompt": str,
                "semantic_map": Dict,
                "acceptance_criteria": List[str],
                "story_points": int,
                "priority": str,
                "activated": True
            }

        Raises:
            ValueError: If item not found, not suggested, or project has no context
        """
        # 1. Fetch item
        epic = self.db.query(Task).filter(Task.id == epic_id).first()
        if not epic:
            raise ValueError(f"Item {epic_id} not found")

        # Check if it's a suggested item
        is_suggested = (
            epic.labels and "suggested" in epic.labels
        ) or epic.workflow_state == "draft"

        if not is_suggested:
            raise ValueError(
                f"Item {epic_id} is not a suggested item. "
                "It may have already been activated."
            )

        # 2. Fetch project and context
        project = self.db.query(Project).filter(Project.id == epic.project_id).first()
        if not project:
            raise ValueError(f"Project {epic.project_id} not found")

        if not project.context_semantic:
            raise ValueError(
                f"Project {project.id} has no context. "
                "Please complete the Context Interview first."
            )

        # 3. Generate full epic content using AI
        epic_content = await self._generate_full_epic_content(
            project=project,
            epic_title=epic.title,
            epic_description=epic.description
        )

        # 3.5. Validate and restructure AI response
        epic_content = self._validate_and_restructure_content(
            epic_content, epic.title, epic.description, project
        )

        # 4. Update epic with generated content
        epic.description = epic_content["description"]
        epic.generated_prompt = epic_content["generated_prompt"]
        epic.acceptance_criteria = epic_content.get("acceptance_criteria", [])
        epic.story_points = epic_content.get("story_points")
        # PROMPT #127 - Track which AI model generated the content
        epic.created_by_ai_model = epic_content.get("ai_model_used")

        # PROMPT #95 - Store complete interview_insights for traceability
        # Includes semantic_map, key_requirements, business_goals, technical_constraints
        epic.interview_insights = epic.interview_insights or {}
        epic.interview_insights["semantic_map"] = epic_content.get("semantic_map", {})
        epic.interview_insights["activated_from_suggestion"] = True
        epic.interview_insights["activation_timestamp"] = datetime.utcnow().isoformat()

        # Merge additional interview_insights from AI response
        ai_insights = epic_content.get("interview_insights", {})
        if ai_insights:
            epic.interview_insights["key_requirements"] = ai_insights.get("key_requirements", [])
            epic.interview_insights["business_goals"] = ai_insights.get("business_goals", [])
            epic.interview_insights["technical_constraints"] = ai_insights.get("technical_constraints", [])

        # 5. Remove "suggested" label and change workflow_state
        if epic.labels and "suggested" in epic.labels:
            epic.labels = [l for l in epic.labels if l != "suggested"]
        epic.workflow_state = "open"
        epic.updated_at = datetime.utcnow()

        # 6. Lock project context (first item activated = context locked)
        if not project.context_locked and epic.item_type == ItemType.EPIC:
            project.context_locked = True
            project.context_locked_at = datetime.utcnow()
            logger.info(f"🔒 Context locked for project {project.name} (first item activated)")

            # PROMPT #162 - Index project context in RAG for cross-project learning
            try:
                rag_service = RAGService(self.db)
                rag_service.store_project_context(
                    project_id=project.id,
                    context_semantic=project.context_semantic,
                    context_human=project.context_human or ""
                )
                logger.info(f"📚 Project context indexed in RAG: {project.name}")
            except Exception as e:
                logger.error(f"❌ Error indexing context in RAG: {str(e)}")

        # PROMPT #126 - Update project status to "active" when first epic is approved
        if epic.item_type == ItemType.EPIC and hasattr(project, 'status'):
            from app.models.project import ProjectStatus
            if project.status != ProjectStatus.active:
                project.status = ProjectStatus.active
                logger.info(f"✅ Project status changed to 'active': {project.name}")

        self.db.commit()
        self.db.refresh(epic)

        # PROMPT #95 - Enhanced logging
        logger.info(f"✅ Item activated: {epic.title} ({epic.item_type.value if epic.item_type else 'unknown'})")
        logger.info(f"   - Description: {len(epic.description or '')} chars")
        logger.info(f"   - Description preview: {(epic.description or '')[:300]}...")
        logger.info(f"   - Generated Prompt: {len(epic.generated_prompt or '')} chars")
        logger.info(f"   - Generated Prompt preview: {(epic.generated_prompt or '')[:300]}...")
        logger.info(f"   - Acceptance Criteria: {len(epic.acceptance_criteria or [])} items")
        logger.info(f"   - Story Points: {epic.story_points}")
        logger.info(f"   - Labels: {epic.labels}")
        logger.info(f"   - Workflow State: {epic.workflow_state}")
        logger.info(f"   - Interview Insights keys: {list(epic.interview_insights.keys()) if epic.interview_insights else []}")
        if epic.interview_insights:
            logger.info(f"   - Key Requirements: {len(epic.interview_insights.get('key_requirements', []))} items")
            logger.info(f"   - Business Goals: {len(epic.interview_insights.get('business_goals', []))} items")
            logger.info(f"   - Technical Constraints: {len(epic.interview_insights.get('technical_constraints', []))} items")

        # PROMPT #264 - Re-enable auto-generation of draft children after activation
        # (Previously disabled by PROMPT #127)
        children_count = 0
        try:
            if epic.item_type == ItemType.EPIC:
                children = await self._generate_draft_stories(epic, project, count=10)
                children_count = len(children)
            elif epic.item_type == ItemType.STORY:
                children = await self._generate_draft_tasks(epic, project, count=8)
                children_count = len(children)
            elif epic.item_type == ItemType.TASK:
                children = await self._generate_draft_subtasks(epic, project, count=5)
                children_count = len(children)
            logger.info(f"✅ Auto-generated {children_count} draft children for {epic.title}")
        except Exception as e:
            logger.warning(f"⚠️ Auto-generation of children failed (non-blocking): {e}")

        # PROMPT #162 - Index activated card in RAG for semantic search
        try:
            rag_service = RAGService(self.db)
            rag_service.store_card(
                card_id=epic.id,
                title=epic.title,
                description=epic.description,
                generated_prompt=epic.generated_prompt,
                item_type=epic.item_type.value if epic.item_type else "epic",
                parent_id=epic.parent_id,
                labels=epic.labels,
                workflow_state=epic.workflow_state,
                project_id=epic.project_id
            )
            logger.info(f"📇 Epic indexed in RAG: {epic.title}")
        except Exception as e:
            logger.error(f"❌ Error indexing epic in RAG: {str(e)}")
            # Don't fail activation if RAG indexing fails

        return {
            "id": str(epic.id),
            "title": epic.title,
            "description": epic.description,
            "generated_prompt": epic.generated_prompt,
            "semantic_map": epic_content.get("semantic_map", {}),
            "acceptance_criteria": epic.acceptance_criteria,
            "story_points": epic.story_points,
            "priority": epic.priority.value if epic.priority else "medium",
            "activated": True,
            "children_generated": children_count
        }

    async def generate_children(self, parent_id: UUID, count: int = 10) -> Dict:
        """
        PROMPT #127 - Generate draft children for an approved item on-demand.

        Called via "Generate Stories/Tasks/Subtasks" button in the UI.
        The parent must be an approved (non-draft) item.

        Epic -> generates Stories
        Story -> generates Tasks
        Task -> generates Subtasks
        Subtask -> no children (leaf node)

        Args:
            parent_id: The parent item ID
            count: Number of children to generate

        Returns:
            Dict with children_generated count
        """
        parent = self.db.query(Task).filter(Task.id == parent_id).first()
        if not parent:
            raise ValueError(f"Item {parent_id} not found")

        project = self.db.query(Project).filter(Project.id == parent.project_id).first()
        if not project:
            raise ValueError(f"Project {parent.project_id} not found")

        if parent.item_type == ItemType.EPIC:
            children = await self._generate_draft_stories(parent, project, count=count)
        elif parent.item_type == ItemType.STORY:
            children = await self._generate_draft_tasks(parent, project, count=count)
        elif parent.item_type == ItemType.TASK:
            children = await self._generate_draft_subtasks(parent, project, count=count)
        else:
            raise ValueError(f"Cannot generate children for item_type={parent.item_type.value}")

        child_type = {
            ItemType.EPIC: "stories",
            ItemType.STORY: "tasks",
            ItemType.TASK: "subtasks",
        }.get(parent.item_type, "items")

        logger.info(f"📝 Generated {len(children)} {child_type} for {parent.item_type.value}: {parent.title}")

        return {
            "parent_id": str(parent.id),
            "parent_title": parent.title,
            "children_generated": len(children),
            "child_type": child_type,
        }

    def _validate_and_restructure_content(
        self,
        content: Dict,
        title: str,
        original_description: str,
        project: Project,
        item_type: str = "epic"
    ) -> Dict:
        """
        PROMPT #173/#175 - Validate and restructure AI-generated content.

        Ensures all required fields are present and non-empty.
        If critical fields are empty/missing, rebuilds them from available data.
        Type-aware defaults based on item_type (epic/story/task/subtask).

        Required contract:
        - description: non-empty string (human-readable)
        - generated_prompt: non-empty string (semantic markdown for AI)
        - acceptance_criteria: list with at least 1 item
        - story_points: integer > 0 (skipped for subtask)
        """
        # PROMPT #175 - Type-aware defaults
        ITEM_DEFAULTS = {
            "epic":    {"min_description": 50, "min_prompt": 50, "default_story_points": 13},
            "story":   {"min_description": 50, "min_prompt": 50, "default_story_points": 8},
            "task":    {"min_description": 30, "min_prompt": 30, "default_story_points": 3},
            "subtask": {"min_description": 20, "min_prompt": 20, "default_story_points": None},
        }
        defaults = ITEM_DEFAULTS.get(item_type, ITEM_DEFAULTS["epic"])
        MIN_DESCRIPTION_LEN = defaults["min_description"]
        MIN_PROMPT_LEN = defaults["min_prompt"]
        default_story_points = defaults["default_story_points"]

        description = content.get("description", "") or ""
        generated_prompt = content.get("generated_prompt", "") or ""
        acceptance_criteria = content.get("acceptance_criteria", []) or []
        story_points = content.get("story_points")
        semantic_map = content.get("semantic_map", {}) or {}
        interview_insights = content.get("interview_insights", {}) or {}

        issues = []

        # --- Validate description ---
        if len(description.strip()) < MIN_DESCRIPTION_LEN:
            issues.append(f"description too short ({len(description.strip())} chars)")

            # Restructure: rebuild from generated_prompt or semantic_map
            if len(generated_prompt.strip()) >= MIN_PROMPT_LEN:
                description = generated_prompt
                logger.info("  Restructured: description rebuilt from generated_prompt")
            elif semantic_map:
                # Build description from semantic map entries
                desc_parts = [f"# {title}\n"]
                for key, value in semantic_map.items():
                    desc_parts.append(f"- **{key}**: {value}")
                description = "\n".join(desc_parts)
                logger.info("  Restructured: description rebuilt from semantic_map")
            else:
                # Last resort: use original description + project context
                project_context = (project.context_human or project.context_semantic or "")[:1000]
                description = (
                    f"# {title}\n\n"
                    f"## Visão Geral\n\n"
                    f"{original_description or 'Módulo do sistema.'}\n\n"
                    f"## Contexto do Projeto\n\n"
                    f"Parte do projeto **{project.name}**.\n\n"
                    f"{project_context}\n\n"
                    f"*Conteúdo gerado automaticamente. Edite para adicionar detalhes técnicos.*"
                )
                logger.info("  Restructured: description rebuilt from title + project context")

        # --- Validate generated_prompt ---
        if len(generated_prompt.strip()) < MIN_PROMPT_LEN:
            issues.append(f"generated_prompt too short ({len(generated_prompt.strip())} chars)")

            # Restructure: use description as prompt
            if len(description.strip()) >= MIN_PROMPT_LEN:
                generated_prompt = description
                logger.info("  Restructured: generated_prompt copied from description")

        # --- Validate acceptance_criteria ---
        if not acceptance_criteria or len(acceptance_criteria) == 0:
            issues.append("acceptance_criteria empty")

            # Try to extract from description
            extracted = []
            if description:
                import re as _re
                for line in description.split("\n"):
                    line = line.strip()
                    if _re.match(r'^[-*]\s*\[[ xX]?\]', line) or _re.match(r'^\d+\.\s*\[[ xX]?\]', line):
                        criterion = _re.sub(r'^[\d\.\-\*\s\[\]xX]+', '', line).strip()
                        if criterion and len(criterion) > 5:
                            extracted.append(criterion)
                    elif _re.match(r'^[-*]\s*\*?\*?AC\d+', line, _re.IGNORECASE):
                        criterion = _re.sub(r'^[-*]\s*\*?\*?AC\d+[:\s]*', '', line, flags=_re.IGNORECASE).strip()
                        if criterion and len(criterion) > 5:
                            extracted.append(criterion)

            if extracted:
                acceptance_criteria = extracted[:15]
                logger.info(f"  Restructured: {len(acceptance_criteria)} criteria extracted from description")
            else:
                # PROMPT #175 - Type-aware fallback criteria
                fallback_criteria = {
                    "epic": [
                        f"Módulo '{title}' implementado e funcional",
                        "Testes unitários cobrindo os fluxos principais",
                        "Documentação técnica atualizada",
                    ],
                    "story": [
                        f"Story '{title}' funcional e testada",
                        "Critérios de aceitação verificados",
                        "Testes de integração passando",
                    ],
                    "task": [
                        f"Task '{title}' implementada",
                        "Testes unitários adicionados",
                    ],
                    "subtask": [
                        f"Subtask '{title}' concluída",
                    ],
                }
                acceptance_criteria = fallback_criteria.get(item_type, fallback_criteria["epic"])
                logger.info(f"  Restructured: fallback acceptance_criteria generated for {item_type}")

        # --- Validate story_points (skip for subtask) ---
        if default_story_points is not None:
            if not story_points or not isinstance(story_points, (int, float)) or story_points <= 0:
                issues.append(f"story_points invalid ({story_points})")
                story_points = default_story_points
                logger.info(f"  Restructured: story_points set to default {default_story_points}")

        # --- Log validation results ---
        if issues:
            logger.warning(
                f"⚠️ Content validation found {len(issues)} issues for '{title[:50]}': "
                f"{', '.join(issues)}"
            )
            logger.info(f"  Final description: {len(description)} chars")
            logger.info(f"  Final generated_prompt: {len(generated_prompt)} chars")
            logger.info(f"  Final acceptance_criteria: {len(acceptance_criteria)} items")
            logger.info(f"  Final story_points: {story_points}")
        else:
            logger.info(f"✅ Content validation passed for '{title[:50]}'")

        # Return restructured content
        result = {
            **content,
            "description": description,
            "generated_prompt": generated_prompt,
            "acceptance_criteria": acceptance_criteria,
            "semantic_map": semantic_map,
            "interview_insights": interview_insights,
        }
        if default_story_points is not None:
            result["story_points"] = int(story_points)
        return result

    def _validate_context_content(
        self,
        context_result: Dict,
        project_name: str
    ) -> Dict:
        """
        PROMPT #175/186 - Validate context generation output.

        Ensures context_semantic and context_human meet minimum quality
        before saving to the project. Also ensures both are strings (not dicts).
        """
        MIN_CONTEXT_LEN = 100

        context_semantic = context_result.get("context_semantic", "") or ""
        context_human = context_result.get("context_human", "") or ""

        # PROMPT #186 - Ensure both are strings, convert dicts to markdown
        if isinstance(context_semantic, dict):
            logger.warning("  _validate_context_content: context_semantic is dict, converting to markdown")
            context_semantic = _dict_to_markdown_context(context_semantic, project_name)
        elif not isinstance(context_semantic, str):
            context_semantic = str(context_semantic)

        if isinstance(context_human, dict):
            logger.warning("  _validate_context_content: context_human is dict, converting to markdown")
            context_human = _dict_to_markdown_context(context_human, project_name)
        elif not isinstance(context_human, str):
            context_human = str(context_human)

        # PROMPT #186 - Always strip emojis as final safety net
        context_semantic = _strip_emojis(context_semantic)
        context_human = _strip_emojis(context_human)

        issues = []

        if len(context_semantic.strip()) < MIN_CONTEXT_LEN:
            issues.append(f"context_semantic too short ({len(context_semantic.strip())} chars)")
            if len(context_human.strip()) >= MIN_CONTEXT_LEN:
                context_semantic = context_human
                logger.info("  Restructured: context_semantic copied from context_human")
            else:
                context_semantic = (
                    f"# Projeto: {project_name}\n\n"
                    f"Contexto gerado automaticamente. "
                    f"Informacoes insuficientes da entrevista para gerar contexto detalhado.\n\n"
                    f"*Edite para adicionar detalhes.*"
                )
                logger.info("  Restructured: context_semantic built from fallback")

        if len(context_human.strip()) < MIN_CONTEXT_LEN:
            issues.append(f"context_human too short ({len(context_human.strip())} chars)")
            if len(context_semantic.strip()) >= MIN_CONTEXT_LEN:
                context_human = context_semantic
                logger.info("  Restructured: context_human copied from context_semantic")

        if issues:
            logger.warning(
                f"Context validation found {len(issues)} issues for '{project_name[:50]}': "
                f"{', '.join(issues)}"
            )
        else:
            logger.info(f"Context validation passed for '{project_name[:50]}'")

        return {
            **context_result,
            "context_semantic": context_semantic,
            "context_human": context_human,
        }

    async def _generate_full_epic_content(
        self,
        project: Project,
        epic_title: str,
        epic_description: str
    ) -> Dict:
        """
        Generate full epic content using AI and project context.

        Uses PROMPT #83 Semantic References Methodology to generate:
        - Semantic markdown (generated_prompt) for AI consumption
        - Human description for reading
        - Acceptance criteria
        - Story points estimation
        - Interview insights (key requirements, business goals, technical constraints)

        PROMPT #95 - Enhanced to match the rich structure from Epic Interview flow.

        Args:
            project: Project instance with context
            epic_title: Epic title (from suggested epic)
            epic_description: Epic minimal description (from suggested epic)

        Returns:
            Dict with full epic content
        """
        # PROMPT #96 - Enhanced prompt for DETAILED epic content generation
        system_prompt = """Você é um Arquiteto de Software e Product Owner especialista gerando especificações técnicas DETALHADAS para Epics.

OBJETIVO: Gerar uma especificação COMPLETA e DETALHADA do módulo/funcionalidade, incluindo:
- Campos e atributos com tipos de dados
- Regras de negócio específicas
- Fluxos e estados
- Interface do usuário
- Integrações e APIs
- Validações e constraints

METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:

**Categorias de Identificadores (use TODAS que forem aplicáveis):**

**Entidades e Dados:**
- **N** (Nouns/Entidades): N1, N2... = Entidades de domínio (Ex: N1=Usuário, N2=Imóvel)
- **ATTR** (Atributos): ATTR1, ATTR2... = Campos/atributos específicos (Ex: ATTR1=nome:string, ATTR2=email:string)
- **D** (Data/Estruturas): D1, D2... = Tabelas, schemas, models (Ex: D1=tabela_usuarios)
- **ENUM** (Enumerações): ENUM1, ENUM2... = Valores fixos (Ex: ENUM1=TipoUsuario[admin,corretor,cliente])
- **REL** (Relacionamentos): REL1, REL2... = Relações entre entidades (Ex: REL1=N1 possui muitos N2)

**Lógica e Regras:**
- **RN** (Regras de Negócio): RN1, RN2... = Regras específicas (Ex: RN1=Email deve ser único)
- **VAL** (Validações): VAL1, VAL2... = Validações de entrada (Ex: VAL1=CPF válido)
- **CALC** (Cálculos): CALC1, CALC2... = Fórmulas e cálculos (Ex: CALC1=comissão=valor*0.05)
- **COND** (Condições): COND1, COND2... = Condições lógicas (Ex: COND1=se status=ativo)

**Fluxos e Processos:**
- **P** (Processos): P1, P2... = Fluxos de trabalho (Ex: P1=Cadastro de imóvel)
- **EST** (Estados): EST1, EST2... = Estados possíveis (Ex: EST1=rascunho, EST2=publicado)
- **TRANS** (Transições): TRANS1, TRANS2... = Transições de estado (Ex: TRANS1=EST1→EST2)
- **STEP** (Etapas): STEP1, STEP2... = Passos do processo (Ex: STEP1=preencher dados)

**Interface:**
- **TELA** (Telas): TELA1, TELA2... = Telas/páginas (Ex: TELA1=Dashboard, TELA2=Listagem)
- **COMP** (Componentes): COMP1, COMP2... = Componentes UI (Ex: COMP1=FormularioCadastro)
- **BTN** (Botões/Ações): BTN1, BTN2... = Ações do usuário (Ex: BTN1=Salvar, BTN2=Cancelar)
- **FILTRO** (Filtros): FILTRO1... = Filtros disponíveis (Ex: FILTRO1=por status)

**Integrações:**
- **API** (Endpoints): API1, API2... = Endpoints REST (Ex: API1=POST /usuarios)
- **S** (Serviços): S1, S2... = Serviços externos (Ex: S1=serviço de email)
- **EVENTO** (Eventos): EVENTO1... = Eventos do sistema (Ex: EVENTO1=usuario_criado)

**Critérios:**
- **AC** (Acceptance Criteria): AC1, AC2... = Critérios de aceitação
- **PERF** (Performance): PERF1... = Requisitos de performance
- **SEG** (Segurança): SEG1... = Requisitos de segurança

Sua tarefa:
1. Analise o contexto do projeto e o épico sugerido
2. Crie um **Mapa Semântico EXTENSO** com MÍNIMO 25-35 identificadores
3. DETALHE especificamente:
   - TODOS os campos/atributos com seus TIPOS DE DADOS
   - TODAS as regras de negócio com condições específicas
   - TODOS os estados e transições
   - TODAS as telas e componentes principais
   - TODOS os endpoints necessários
4. Escreva a descrição usando APENAS identificadores do mapa
5. Defina critérios de aceitação específicos e mensuráveis

ESTRUTURA OBRIGATÓRIA DO description_markdown:

```
# Epic: [Título]

## Mapa Semântico

### Entidades
- **N1**: [entidade]
- **N2**: [entidade]

### Atributos de [Entidade Principal]
- **ATTR1**: [campo]: [tipo] - [descrição]
- **ATTR2**: [campo]: [tipo] - [descrição]
...

### Enumerações
- **ENUM1**: [nome][valor1, valor2, valor3]
...

### Regras de Negócio
- **RN1**: [regra específica]
- **RN2**: [regra específica]
...

### Validações
- **VAL1**: [validação]
...

### Estados e Transições
- **EST1**: [estado1]
- **EST2**: [estado2]
- **TRANS1**: EST1 → EST2 quando [condição]
...

### Telas e Componentes
- **TELA1**: [nome da tela] - [descrição]
- **COMP1**: [componente] em TELA1
...

### Endpoints
- **API1**: [método] [rota] - [descrição]
...

## Descrição Funcional

[Narrativa DETALHADA usando os identificadores. Descreva o fluxo completo,
como as telas interagem, quais validações são aplicadas em cada etapa,
como os estados mudam, etc.]

## Fluxo Principal

1. STEP1: [descrição usando identificadores]
2. STEP2: [descrição usando identificadores]
...

## Critérios de Aceitação

1. **AC1**: [critério específico e mensurável]
2. **AC2**: [critério específico e mensurável]
...

## Regras de Negócio Detalhadas

### RN1: [Nome da Regra]
- **Condição**: [quando se aplica]
- **Ação**: [o que acontece]
- **Exceção**: [casos especiais]

...

## Especificação de Dados

### Tabela: [nome]
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| ATTR1 | string | Sim | ... |
| ATTR2 | integer | Não | ... |

## Considerações Técnicas

- [consideração 1]
- [consideração 2]
```

Retorne APENAS JSON válido (sem markdown code blocks):
{
    "title": "Título do Epic",
    "semantic_map": {
        "N1": "...", "N2": "...",
        "ATTR1": "campo: tipo - descrição",
        "RN1": "regra específica",
        "EST1": "estado", "TRANS1": "transição",
        "TELA1": "tela", "API1": "endpoint"
    },
    "description_markdown": "[MARKDOWN COMPLETO seguindo a estrutura acima]",
    "story_points": 13,
    "priority": "high",
    "acceptance_criteria": ["AC1: critério", "AC2: critério"],
    "interview_insights": {
        "key_requirements": ["requisito 1", "requisito 2"],
        "business_goals": ["objetivo 1", "objetivo 2"],
        "technical_constraints": ["restrição 1", "restrição 2"]
    }
}

**REGRAS CRÍTICAS:**
- MÍNIMO 25 identificadores no mapa semântico
- DETALHE campos com TIPOS DE DADOS (string, integer, boolean, date, etc)
- DETALHE regras de negócio com CONDIÇÕES ESPECÍFICAS
- INCLUA telas e componentes UI
- INCLUA endpoints da API
- A descrição deve ter MÍNIMO 1500 caracteres
- TUDO EM PORTUGUÊS
"""

        # PROMPT #162 - Fetch relevant interview answers from RAG
        interview_context = ""
        try:
            rag_service = RAGService(self.db)
            relevant_answers = rag_service.get_relevant_interview_answers(
                query=f"{epic_title} {epic_description or ''}",
                project_id=project.id,
                top_k=5,
                similarity_threshold=0.5
            )
            if relevant_answers:
                interview_context = "\n\n## RESPOSTAS RELEVANTES DA ENTREVISTA\n"
                interview_context += "*(O usuário mencionou isto durante a entrevista de contexto)*\n\n"
                for i, answer in enumerate(relevant_answers, 1):
                    content = answer.get("content", "")[:500]
                    interview_context += f"- {content}\n"
                logger.info(f"📝 Added {len(relevant_answers)} relevant interview answers to epic context")
        except Exception as e:
            logger.warning(f"Could not fetch interview answers: {e}")

        # PROMPT #182 - Explicitly fetch business rules from RAG
        business_rules_context = ""
        try:
            rag_service = RAGService(self.db)
            rules = rag_service.get_business_rules(project_id=project.id, top_k=20)
            if rules:
                business_rules_context = rag_service.format_business_rules_for_prompt(rules, max_chars=6000)
                logger.info(f"📋 Injected {len(rules)} business rules into epic content generation")
        except Exception as e:
            logger.warning(f"Could not fetch business rules for epic: {e}")

        user_prompt = f"""Gere a ESPECIFICAÇÃO TÉCNICA COMPLETA para este Epic/Módulo.

## CONTEXTO DO PROJETO
**Nome:** {project.name}
**Descrição:** {project.description or 'Não especificada'}

**Contexto Semântico do Projeto (REUTILIZE estes identificadores):**
{project.context_semantic or 'Não disponível'}{interview_context}

**Contexto Legível do Projeto:**
{project.context_human or 'Não disponível'}

{business_rules_context}
{f'''ATENÇÃO CRÍTICA: As regras de negócio acima foram extraídas DIRETAMENTE do código-fonte do projeto.
Você DEVE:
1. INCORPORAR estas regras no Mapa Semântico (como RN1, RN2, VAL1, etc.) com seus conteúdos REAIS
2. USAR as regras nos Critérios de Aceitação — cada regra relevante deve ter um AC correspondente
3. DETALHAR as regras na seção "Regras de Negócio Detalhadas" com condições, ações e exceções REAIS
4. RESPEITAR a hierarquia e estrutura das regras do código existente
NÃO invente regras genéricas — USE as regras REAIS listadas acima.''' if business_rules_context else ''}

## EPIC/MÓDULO A ESPECIFICAR
**Título:** {epic_title}
**Descrição Inicial:** {epic_description}

## REQUISITOS DA ESPECIFICAÇÃO

Você DEVE incluir detalhes sobre:

### 1. MODELO DE DADOS (obrigatório)
- Liste TODOS os campos/atributos necessários
- Especifique o TIPO DE DADO de cada campo (string, integer, boolean, date, decimal, text, json, etc)
- Indique se é obrigatório ou opcional
- Descreva validações específicas de cada campo

### 2. REGRAS DE NEGÓCIO (obrigatório)
- {f'INCORPORE as regras de negócio do projeto listadas acima' if business_rules_context else 'Liste TODAS as regras de negócio do módulo'}
- Especifique CONDIÇÕES de cada regra (quando se aplica)
- Especifique AÇÕES de cada regra (o que acontece)
- Especifique EXCEÇÕES (casos especiais)

### 3. ESTADOS E FLUXOS (obrigatório)
- Liste TODOS os estados possíveis
- Especifique TODAS as transições entre estados
- Indique as CONDIÇÕES para cada transição

### 4. INTERFACE DO USUÁRIO (obrigatório)
- Liste TODAS as telas necessárias
- Descreva os componentes principais de cada tela
- Indique os botões e ações disponíveis
- Descreva filtros e ordenações

### 5. ENDPOINTS DA API (obrigatório)
- Liste TODOS os endpoints REST necessários
- Especifique método HTTP e rota
- Descreva parâmetros de entrada e saída

### 6. INTEGRAÇÕES (se aplicável)
- Serviços externos necessários
- Eventos do sistema

## FORMATO DE SAÍDA

Use a estrutura EXATA especificada no system prompt:
- Mapa semântico com MÍNIMO 25 identificadores
- Seções: Entidades, Atributos, Enumerações, Regras, Validações, Estados, Telas, Endpoints
- Tabela de especificação de dados
- Fluxo principal detalhado

## EXEMPLO DE NÍVEL DE DETALHE ESPERADO

Para um módulo de "Cadastro de Imóveis", esperamos ver:
- ATTR1: titulo: string(100) - Título do anúncio, obrigatório
- ATTR2: descricao: text - Descrição detalhada, obrigatório, mínimo 50 caracteres
- ATTR3: preco: decimal(10,2) - Valor do imóvel em reais
- ATTR4: tipo: enum[casa,apartamento,terreno,comercial] - Tipo do imóvel
- ATTR5: quartos: integer - Número de quartos, 0-10
- ATTR6: banheiros: integer - Número de banheiros, 0-10
- ATTR7: area_m2: decimal(8,2) - Área em metros quadrados
- ATTR8: endereco_cep: string(8) - CEP, validação de formato
- RN1: Preço deve ser maior que zero
- RN2: Área deve ser maior que zero
- EST1: rascunho, EST2: pendente_aprovacao, EST3: publicado, EST4: vendido
- TELA1: Lista de Imóveis com filtros por tipo, preço, localização
- TELA2: Formulário de Cadastro com wizard de 3 etapas
- API1: GET /imoveis - listar com paginação e filtros
- API2: POST /imoveis - criar novo imóvel
- API3: PUT /imoveis/:id - atualizar imóvel

GERE ESTE NÍVEL DE DETALHE PARA O MÓDULO "{epic_title}".

Retorne como JSON seguindo o schema do system prompt."""

        # Call AI - PROMPT #96: Increased max_tokens to 8000 for detailed specs
        messages = [{"role": "user", "content": user_prompt}]

        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=4000,  # Increased to allow for detailed specifications
            enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
            project_id=str(project.id)  # PROMPT #125 - Log to prompts table
        )

        # PROMPT #127 - Capture AI model used for tracking
        ai_model_used = response.get("model", "unknown")

        # Parse response - PROMPT #95: Enhanced JSON extraction
        response_text = response.get("content", "")
        original_response = response_text  # Keep original for debugging
        logger.info(f"📥 Raw AI response length: {len(response_text)} chars")

        # Step 0: Try parsing raw response before any transformation
        result = None
        parse_method = "none"
        last_error = None

        try:
            result = json.loads(response_text)
            parse_method = "raw_direct"
            logger.info("✅ JSON parsed from raw response directly")
        except json.JSONDecodeError as e:
            last_error = e
            logger.warning(f"Raw parse failed at position {e.pos}: {e.msg}")

        # Step 1: Strip markdown code blocks
        if result is None:
            response_text = _strip_markdown_json(response_text)

        # Step 2: Try multiple JSON extraction strategies

        # Strategy 1: Direct JSON parse after strip
        if result is None:
            try:
                result = json.loads(response_text)
                parse_method = "direct"
                logger.info("✅ JSON parsed directly after strip")
            except json.JSONDecodeError as e:
                last_error = e
                logger.warning(f"Direct parse failed at position {e.pos}/{len(response_text)}: {e.msg}")
                # Show context around error position
                start = max(0, e.pos - 50)
                end = min(len(response_text), e.pos + 50)
                logger.warning(f"Context around error: ...{response_text[start:end]}...")

        # Strategy 2: Extract JSON object with regex (greedy)
        if result is None:
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                try:
                    result = json.loads(json_match.group(0))
                    parse_method = "regex_greedy"
                    logger.info("✅ JSON extracted with greedy regex")
                except json.JSONDecodeError:
                    pass

        # Strategy 3: Find balanced braces (handles nested objects)
        if result is None:
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
                        parse_method = "balanced_braces"
                        logger.info("✅ JSON extracted with balanced braces")
                    except json.JSONDecodeError:
                        pass

        # Strategy 4: Try to fix common JSON issues
        if result is None:
            # Remove trailing commas before closing braces/brackets
            fixed_text = re.sub(r',\s*([}\]])', r'\1', response_text)
            # Try parsing fixed text
            json_match = re.search(r'\{[\s\S]*\}', fixed_text)
            if json_match:
                try:
                    result = json.loads(json_match.group(0))
                    parse_method = "fixed_trailing_commas"
                    logger.info("✅ JSON parsed after fixing trailing commas")
                except json.JSONDecodeError as e:
                    logger.debug(f"Trailing comma fix failed: {e}")

        # Strategy 5: Fix unescaped newlines in JSON strings
        if result is None:
            # This is a common issue where AI returns JSON with literal newlines in strings
            # instead of \n escape sequences
            try:
                json_match = re.search(r'\{[\s\S]*\}', response_text)
                if json_match:
                    json_str = json_match.group(0)

                    # Aggressive approach: escape all literal newlines that appear within strings
                    # by finding string boundaries and escaping newlines inside them
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
                            continue  # Skip carriage returns

                        if in_string and char == '\t':
                            fixed_chars.append('\\t')
                            continue

                        fixed_chars.append(char)

                    json_str_fixed = ''.join(fixed_chars)

                    try:
                        result = json.loads(json_str_fixed)
                        parse_method = "fixed_newlines_aggressive"
                        logger.info("✅ JSON parsed after aggressive newline fix")
                    except json.JSONDecodeError as e:
                        logger.warning(f"Aggressive newline fix failed at {e.pos}: {e.msg}")

            except Exception as e:
                logger.warning(f"Newline fix failed: {e}")

        # Strategy 6: Try to truncate at the last valid JSON point
        if result is None:
            try:
                json_match = re.search(r'\{[\s\S]*', response_text)
                if json_match:
                    json_str = json_match.group(0)

                    # Find the position of the error and try truncating before it
                    for truncate_at in range(len(json_str), max(len(json_str) - 500, 0), -10):
                        test_str = json_str[:truncate_at]
                        # Try to close any open structures
                        open_braces = test_str.count('{') - test_str.count('}')
                        open_brackets = test_str.count('[') - test_str.count(']')
                        open_quotes = test_str.count('"') % 2

                        if open_quotes == 1:
                            test_str += '"'
                        test_str += ']' * open_brackets
                        test_str += '}' * open_braces

                        try:
                            result = json.loads(test_str)
                            # Verify it has required fields
                            if isinstance(result, dict) and ('description_markdown' in result or 'semantic_map' in result):
                                parse_method = "truncated_recovery"
                                logger.info(f"✅ JSON recovered by truncating at position {truncate_at}")
                                break
                            else:
                                result = None
                        except:
                            continue
            except Exception as e:
                logger.warning(f"Truncation recovery failed: {e}")

        # Strategy 7: Last resort - try Python's ast.literal_eval for simple cases
        if result is None:
            try:
                import ast
                # This can handle some cases where json.loads fails
                result = ast.literal_eval(response_text)
                if isinstance(result, dict):
                    parse_method = "ast_literal_eval"
                    logger.info("✅ JSON parsed with ast.literal_eval")
                else:
                    result = None
            except:
                pass

        if result:
            logger.info(f"✅ AI response parsed successfully (method: {parse_method})")
            logger.info(f"   - title: {result.get('title', 'N/A')}")
            logger.info(f"   - semantic_map keys: {list(result.get('semantic_map', {}).keys())}")
            logger.info(f"   - description_markdown length: {len(result.get('description_markdown', ''))}")
            logger.info(f"   - acceptance_criteria count: {len(result.get('acceptance_criteria', []))}")
            logger.info(f"   - story_points: {result.get('story_points', 'N/A')}")
            logger.info(f"   - interview_insights keys: {list(result.get('interview_insights', {}).keys())}")

            # PROMPT #101 FIX (v2): Extract acceptance_criteria from multiple sources if empty
            # When JSON is truncated, acceptance_criteria field is lost
            if not result.get('acceptance_criteria'):
                extracted_criteria = []

                # Strategy 1: Extract from semantic_map (AC1, AC2, etc. keys)
                if result.get('semantic_map'):
                    semantic_map = result.get('semantic_map', {})
                    for key in sorted(semantic_map.keys()):
                        if key.startswith('AC') and len(key) > 2 and key[2:].replace('.', '').isdigit():
                            extracted_criteria.append(f"{key}: {semantic_map[key]}")
                    if extracted_criteria:
                        logger.info(f"   - Found {len(extracted_criteria)} AC keys in semantic_map")

                # Strategy 2: Extract from description_markdown
                if not extracted_criteria and result.get('description_markdown'):
                    desc = result.get('description_markdown', '')
                    # Look for "## Critérios de Aceitação" section
                    criteria_section = re.search(
                        r'##\s*(?:Critérios de Aceitação|Acceptance Criteria|Critérios)\s*\n((?:[\s\S](?!##))*)',
                        desc,
                        re.IGNORECASE
                    )
                    if criteria_section:
                        criteria_text = criteria_section.group(1)
                        # Extract lines that look like criteria (numbered, bulleted, or with AC prefix)
                        for line in criteria_text.split('\n'):
                            line = line.strip()
                            # Match patterns like: "1. **AC1**: ...", "- AC1: ...", "* [x] ...", etc.
                            if line and (
                                re.match(r'^\d+\.\s*\*?\*?AC\d+', line, re.IGNORECASE) or
                                re.match(r'^[-*]\s*\*?\*?AC\d+', line, re.IGNORECASE) or
                                re.match(r'^\d+\.\s*\[[ xX]?\]', line) or
                                re.match(r'^[-*]\s*\[[ xX]?\]', line)
                            ):
                                # Clean up the line
                                criterion = re.sub(r'^[\d\.\-\*\s\[\]xX]+', '', line).strip()
                                criterion = re.sub(r'^\*+', '', criterion).strip()
                                if criterion and len(criterion) > 5:
                                    extracted_criteria.append(criterion)
                        if extracted_criteria:
                            logger.info(f"   - Found {len(extracted_criteria)} criteria in description_markdown")

                # Apply extracted criteria
                if extracted_criteria:
                    result['acceptance_criteria'] = extracted_criteria[:15]  # Limit to 15 criteria
                    logger.info(f"   - acceptance_criteria RECOVERED: {len(result['acceptance_criteria'])} items")
        else:
            # All parsing strategies failed
            logger.error(f"❌ Failed to parse AI response as JSON after all strategies")
            logger.error(f"Response text (first 1500 chars): {response_text[:1500]}...")

            # Fallback: PROMPT #96 - Try to extract content from raw response
            logger.warning("🔄 JSON parsing failed - attempting to extract content from raw response...")

            # Try to extract useful content from the response even if JSON parsing failed
            # The AI might have returned text that contains useful information

            # Extract project context
            project_context = project.context_human or project.description or ""

            # PROMPT #96 - Better fallback: Make a simpler request to the AI
            # asking just for a text description without JSON
            logger.info("📤 Attempting simplified AI request for epic content...")

            # Extract key info from project context for better prompting
            context_preview = project_context[:3000] if project_context else "Não disponível"

            simple_system_prompt = f"""Você é um Arquiteto de Software Sênior com 20 anos de experiência.

Sua tarefa é escrever uma ESPECIFICAÇÃO TÉCNICA COMPLETA E DETALHADA para um módulo de software.

REGRAS IMPORTANTES:
1. Seja EXTREMAMENTE ESPECÍFICO - use nomes reais de campos, tabelas, endpoints
2. NÃO use placeholders genéricos como "campo1", "tabela1", "endpoint1"
3. BASEIE-SE no contexto do projeto para gerar nomes e estruturas realistas
4. Cada seção deve ter MÍNIMO 5 itens detalhados
5. Use Markdown formatado corretamente
6. Responda APENAS em PORTUGUÊS

CONTEXTO DO PROJETO PARA REFERÊNCIA:
{context_preview}

Use este contexto para gerar especificações REALISTAS e ESPECÍFICAS para o módulo solicitado."""

            simple_prompt = f"""# Especificação Técnica: {epic_title}

**Projeto:** {project.name}

**Descrição do Módulo:** {epic_description}

Por favor, gere uma especificação técnica COMPLETA e DETALHADA para este módulo seguindo EXATAMENTE esta estrutura:

---

## 1. VISÃO GERAL
Escreva 2-3 parágrafos explicando:
- O propósito principal do módulo
- Como ele se integra com o restante do sistema
- O valor que ele entrega para o usuário

---

## 2. MODELO DE DADOS

### Entidade Principal: [Nome da Entidade]
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | uuid | Sim | Identificador único |
| ... | ... | ... | ... |

Liste MÍNIMO 10 campos com seus tipos de dados reais (string, text, integer, boolean, decimal, date, datetime, json, enum, etc.)

### Relacionamentos
- [Entidade] tem muitos [Outra Entidade]
- etc.

---

## 3. REGRAS DE NEGÓCIO

Liste MÍNIMO 8 regras de negócio específicas no formato:
- **RN1 - [Nome]**: [Descrição detalhada da regra, quando se aplica, o que acontece]
- **RN2 - [Nome]**: ...

---

## 4. ESTADOS E TRANSIÇÕES

### Estados Possíveis
| Estado | Descrição | Ações Permitidas |
|--------|-----------|------------------|
| ... | ... | ... |

### Fluxo de Transições
1. [Estado A] → [Estado B]: quando [condição]
2. ...

---

## 5. INTERFACE DO USUÁRIO

### Telas Principais
1. **[Nome da Tela]**
   - Propósito: ...
   - Componentes: ...
   - Ações disponíveis: ...

Liste MÍNIMO 4 telas com detalhes.

### Componentes Reutilizáveis
- [Componente 1]: [descrição]
- ...

---

## 6. API REST

### Endpoints
| Método | Rota | Descrição | Request Body | Response |
|--------|------|-----------|--------------|----------|
| GET | /api/... | ... | - | Lista de ... |
| POST | /api/... | ... | {{ campo1, campo2 }} | Objeto criado |
| ... | ... | ... | ... | ... |

Liste MÍNIMO 6 endpoints.

---

## 7. VALIDAÇÕES E ERROS

### Validações de Entrada
- [Campo]: [Validação] - Mensagem de erro
- ...

### Códigos de Erro
- 400: ...
- 404: ...
- ...

---

## 8. CRITÉRIOS DE ACEITAÇÃO

Liste MÍNIMO 8 critérios de aceitação específicos e mensuráveis:
1. [ ] ...
2. [ ] ...

---

## 9. CONSIDERAÇÕES TÉCNICAS

- Segurança: ...
- Performance: ...
- Escalabilidade: ...
- Integrações: ...

---

GERE A ESPECIFICAÇÃO COMPLETA AGORA, preenchendo TODOS os campos com dados REALISTAS baseados no contexto do projeto "{project.name}"."""

            try:
                simple_messages = [{"role": "user", "content": simple_prompt}]
                simple_response = await self.orchestrator.execute(
                    usage_type="prompt_generation",
                    messages=simple_messages,
                    system_prompt=simple_system_prompt,
                    max_tokens=4000,  # Increased to allow more detailed response
                    enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
                    project_id=str(project.id)  # PROMPT #125 - Log to prompts table
                )

                raw_content = simple_response.get("content", "")
                logger.info(f"✅ Simplified request returned {len(raw_content)} chars")

                if len(raw_content) > 500:
                    # Use the raw content as the description
                    fallback_description = f"# Epic: {epic_title}\n\n{raw_content}"

                    # Try to extract acceptance criteria from the response
                    extracted_criteria = []
                    criteria_match = re.search(
                        r'(?:CRITÉRIOS DE ACEITAÇÃO|ACCEPTANCE CRITERIA)[:\s]*\n((?:[\-\*\d\.\[\]]+[^\n]+\n?)+)',
                        raw_content,
                        re.IGNORECASE
                    )
                    if criteria_match:
                        criteria_text = criteria_match.group(1)
                        # Extract each criterion
                        for line in criteria_text.split('\n'):
                            line = line.strip()
                            if line and (line.startswith('-') or line.startswith('*') or
                                        line.startswith('[') or re.match(r'^\d+\.', line)):
                                # Clean up the criterion text
                                criterion = re.sub(r'^[\-\*\[\]\d\.\s]+', '', line).strip()
                                if criterion and len(criterion) > 10:
                                    extracted_criteria.append(criterion)

                    logger.info(f"   - Extracted {len(extracted_criteria)} acceptance criteria from response")

                    # Try to extract key requirements from "Regras de Negócio" section
                    extracted_requirements = []
                    rules_match = re.search(
                        r'(?:REGRAS DE NEGÓCIO|BUSINESS RULES)[:\s]*\n((?:[\-\*]+\s*\*\*RN\d+[^\n]+\n?)+)',
                        raw_content,
                        re.IGNORECASE
                    )
                    if rules_match:
                        rules_text = rules_match.group(1)
                        for line in rules_text.split('\n'):
                            if '**RN' in line or '- RN' in line:
                                rule = re.sub(r'^[\-\*\s]+\*\*RN\d+[^:]*:\*\*\s*', '', line).strip()
                                if rule and len(rule) > 10:
                                    extracted_requirements.append(rule[:200])

                    result = {
                        "title": epic_title,
                        "semantic_map": {},
                        "description_markdown": fallback_description,
                        "acceptance_criteria": extracted_criteria[:10] if extracted_criteria else [
                            f"Módulo {epic_title} completamente implementado",
                            "Todos os endpoints funcionando corretamente",
                            "Interface de usuário responsiva e intuitiva",
                            "Testes automatizados com cobertura adequada",
                            "Documentação atualizada"
                        ],
                        "story_points": 13,
                        "interview_insights": {
                            "key_requirements": extracted_requirements[:5] if extracted_requirements else [
                                f"Implementar {epic_title} conforme especificação",
                                "Seguir padrões de código do projeto"
                            ],
                            "business_goals": [
                                f"Entregar funcionalidade completa de {epic_title}",
                                "Melhorar experiência do usuário"
                            ],
                            "technical_constraints": [
                                "Compatível com arquitetura existente",
                                "Performance adequada"
                            ]
                        }
                    }
                    logger.info("✅ Using simplified AI response as fallback content")
                else:
                    raise ValueError("Response too short")

            except Exception as fallback_error:
                logger.error(f"❌ Simplified request also failed: {fallback_error}")

                # Last resort: use project context to build something meaningful
                fallback_description = f"""# Epic: {epic_title}

## Visão Geral

{epic_description}

## Contexto do Projeto

Este módulo faz parte do projeto **{project.name}**.

{project_context[:2000] if project_context else 'Contexto não disponível.'}

## Próximos Passos

Para completar a especificação deste módulo, é necessário definir:
- Modelo de dados com campos e tipos
- Regras de negócio específicas
- Estados e transições
- Telas e componentes de interface
- Endpoints da API

NOTA: Esta e uma especificacao preliminar. A geracao automatica de conteudo detalhado falhou.
Por favor, edite manualmente para adicionar os detalhes técnicos necessários.
"""

                result = {
                    "title": epic_title,
                    "semantic_map": {},
                    "description_markdown": fallback_description,
                    "acceptance_criteria": [
                        "Módulo deve estar completamente implementado",
                        "Testes devem cobrir os principais fluxos",
                        "Documentação deve estar atualizada"
                    ],
                    "story_points": 13,
                    "interview_insights": {
                        "key_requirements": [
                            f"Implementar {epic_title} conforme especificação",
                            "Seguir padrões de código do projeto",
                            "Garantir integração com módulos existentes"
                        ],
                        "business_goals": [
                            f"Entregar funcionalidade de {epic_title}",
                            "Melhorar experiência do usuário",
                            "Atender requisitos do negócio"
                        ],
                        "technical_constraints": [
                            f"{epic_title} deve ser compatível com a arquitetura existente",
                            "Deve seguir os padrões de dados do projeto",
                            "Deve ter performance adequada"
                        ]
                    }
                }

        # Extract and process content
        semantic_map = result.get("semantic_map", {})
        description_markdown = result.get("description_markdown", "")

        # generated_prompt = semantic markdown (for AI/child cards)
        generated_prompt = description_markdown

        # PROMPT #180 - Include acceptance criteria in generated_prompt
        acceptance_criteria = result.get("acceptance_criteria", [])
        if acceptance_criteria:
            generated_prompt += "\n\n## Critérios de Aceitação\n\n"
            for ac in acceptance_criteria:
                generated_prompt += f"- {ac}\n"

        # description = human-readable (converted from semantic)
        description = _convert_semantic_to_human(description_markdown, semantic_map)

        # Remove Mapa Semântico section from human description
        description = re.sub(
            r'##\s*Mapa\s*Sem[aâ]ntico\s*\n+(?:[-*]\s*\*\*[^*]+\*\*:[^\n]*\n*)*',
            '',
            description,
            flags=re.IGNORECASE | re.MULTILINE
        )
        description = description.strip()

        # PROMPT #95 - Include interview_insights in return
        # PROMPT #127 - Include AI model used for tracking
        return {
            "title": result.get("title", epic_title),
            "description": description,
            "generated_prompt": generated_prompt,
            "semantic_map": semantic_map,
            "acceptance_criteria": acceptance_criteria,
            "story_points": result.get("story_points"),
            "interview_insights": result.get("interview_insights", {}),
            "ai_model_used": ai_model_used  # PROMPT #127
        }

    async def reject_suggested_epic(self, epic_id: UUID) -> bool:
        """
        PROMPT #94 - Reject (delete) a suggested item.

        Works with any item type (Epic, Story, Task, Subtask).

        Args:
            epic_id: Item ID to reject (named epic_id for backwards compatibility)

        Returns:
            True if deleted successfully

        Raises:
            ValueError: If item not found or not a suggested item
        """
        # Fetch item
        epic = self.db.query(Task).filter(Task.id == epic_id).first()
        if not epic:
            raise ValueError(f"Item {epic_id} not found")

        # Check if it's a suggested item
        is_suggested = (
            epic.labels and "suggested" in epic.labels
        ) or epic.workflow_state == "draft"

        if not is_suggested:
            raise ValueError(
                f"Item {epic_id} is not a suggested item. "
                "Only suggested items can be rejected."
            )

        item_title = epic.title

        # Delete the item
        self.db.delete(epic)
        self.db.commit()

        logger.info(f"❌ Suggested item rejected and deleted: {item_title}")

        return True

    # ============================================================
    # PROMPT #102 - Hierarchical Draft Generation
    # Auto-generate child cards when parent is activated
    # EACH CARD gets FULL EPIC-LEVEL content (generated individually)
    # ============================================================

    async def _generate_draft_stories(
        self,
        epic: Task,
        project: Project,
        count: int = 15
    ) -> List[Task]:
        """
        PROMPT #257 - Generate stories with FULL CONTENT using stories_from_epic.yaml.

        Uses the existing rich YAML prompt to generate complete Stories
        with description, semantic_map, acceptance_criteria, and story_points.

        Args:
            epic: The activated epic
            project: The project with context
            count: Number of stories to generate (default 15)

        Returns:
            List of created Story tasks with full content
        """
        logger.info(f"Generating {count} stories with full content for: {epic.title}")

        # Extract epic's semantic map for context
        epic_semantic_map = {}
        if epic.interview_insights and isinstance(epic.interview_insights, dict):
            epic_semantic_map = epic.interview_insights.get("semantic_map", {})

        semantic_map_text = ""
        if epic_semantic_map:
            semantic_map_text = "\nMAPA SEMANTICO DO EPIC:\n"
            semantic_map_text += json.dumps(epic_semantic_map, indent=2, ensure_ascii=False)

        # PROMPT #257 - Fetch business rules from RAG for context injection
        business_rules_text = ""
        try:
            rag_service = RAGService(self.db)
            rules = rag_service.get_business_rules(project_id=project.id, top_k=20)
            if rules:
                business_rules_text = rag_service.format_business_rules_for_prompt(rules, max_chars=6000)
        except Exception as e:
            logger.warning(f"Could not fetch business rules for stories: {e}")

        try:
            # PROMPT #257 - Use PromptLoader with stories_from_epic.yaml
            from app.prompts.loader import get_prompt_loader
            loader = get_prompt_loader()

            system_prompt, user_prompt = loader.render(
                "backlog/stories_from_epic",
                {
                    "epic_title": epic.title,
                    "epic_description": (epic.description or "Nao especificada")[:5000],
                    "epic_story_points": epic.story_points or 13,
                    "epic_priority": epic.priority.value if epic.priority else "medium",
                    "epic_acceptance_criteria": "\n".join(epic.acceptance_criteria or []),
                    "semantic_map_text": semantic_map_text,
                    "epic_interview_insights": json.dumps(epic.interview_insights, ensure_ascii=False) if epic.interview_insights else "",
                    "business_rules_text": business_rules_text,
                    "rag_context": "",
                }
            )

            # Append count instruction to user prompt
            user_prompt += f"\n\nGere exatamente {count} Stories como array JSON."

            orchestrator = AIOrchestrator(self.db)
            response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=8000,
                enable_rag=True,
                project_id=str(project.id)
            )

            response_content = response.get("content", "")
            stories_data = self._parse_json_response(response_content)

            if not stories_data or not isinstance(stories_data, list):
                logger.warning("AI did not return valid stories array, falling back to title-only")
                return await self._generate_draft_stories_fallback(epic, project, count)

            stories_data = stories_data[:count]
            logger.info(f"Generated {len(stories_data)} complete story objects for epic: {epic.title}")

            # Create Story tasks with full content
            created_stories = []
            skipped_count = 0
            rag_svc = RAGService(self.db)

            for i, story_data in enumerate(stories_data):
                try:
                    if isinstance(story_data, str):
                        story_data = {"title": story_data}

                    story_title = story_data.get("title", f"Story {i+1}")

                    # PROMPT #162 - Check for similar cards (auto-skip)
                    similar_cards = rag_svc.find_similar_cards(
                        title=story_title,
                        description=None,
                        project_id=epic.project_id,
                        item_type="story",
                        similarity_threshold=0.85,
                        top_k=1
                    )
                    if similar_cards:
                        logger.info(f"Skipping similar story: '{story_title[:50]}...'")
                        skipped_count += 1
                        continue

                    # Extract content from AI response
                    description = story_data.get("description_markdown", story_data.get("description", ""))
                    generated_prompt = story_data.get("description_markdown", "")
                    acceptance_criteria = story_data.get("acceptance_criteria", [])
                    story_points = story_data.get("story_points", 5)
                    priority_str = story_data.get("priority", "medium").lower()
                    story_semantic_map = story_data.get("semantic_map", {})

                    # Map priority string to enum
                    priority_map = {
                        "critical": PriorityLevel.CRITICAL,
                        "high": PriorityLevel.HIGH,
                        "medium": PriorityLevel.MEDIUM,
                        "low": PriorityLevel.LOW,
                        "trivial": PriorityLevel.TRIVIAL,
                    }
                    priority = priority_map.get(priority_str, PriorityLevel.MEDIUM)

                    story = Task(
                        project_id=epic.project_id,
                        parent_id=epic.id,
                        item_type=ItemType.STORY,
                        title=story_title,
                        description=description or f"Story derivada do Epic: {epic.title}",
                        generated_prompt=generated_prompt,
                        acceptance_criteria=acceptance_criteria,
                        story_points=story_points if isinstance(story_points, int) else 5,
                        priority=priority,
                        labels=["suggested"],
                        workflow_state="draft",
                        status=TaskStatus.BACKLOG,
                        order=i,
                        reporter="system",
                        interview_insights={
                            "derived_from_epic": str(epic.id),
                            "semantic_map": story_semantic_map,
                        },
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    self.db.add(story)
                    created_stories.append(story)
                    logger.info(f"Created story {i+1}/{len(stories_data)}: {story_title[:50]}...")

                except Exception as story_error:
                    logger.error(f"Error creating story '{story_data}': {str(story_error)}")

            if skipped_count > 0:
                logger.info(f"Skipped {skipped_count} duplicate stories")

            self.db.commit()
            logger.info(f"Created {len(created_stories)} stories with full content")
            return created_stories

        except Exception as e:
            logger.error(f"Error generating stories: {str(e)}")
            import traceback
            traceback.print_exc()
            return await self._generate_draft_stories_fallback(epic, project, count)

    async def _generate_draft_stories_fallback(
        self,
        epic: Task,
        project: Project,
        count: int = 15
    ) -> List[Task]:
        """Fallback: create stories with basic titles when AI fails."""
        fallback_titles = self._generate_fallback_story_titles(epic)
        created_stories = []
        for i, title in enumerate(fallback_titles[:min(5, count)]):
            story = Task(
                project_id=epic.project_id,
                parent_id=epic.id,
                item_type=ItemType.STORY,
                title=title,
                description=f"Story derivada do Epic: {epic.title}",
                generated_prompt="",
                acceptance_criteria=[],
                story_points=5,
                priority=PriorityLevel.MEDIUM,
                labels=["suggested"],
                workflow_state="draft",
                status=TaskStatus.BACKLOG,
                order=i,
                interview_insights={"derived_from_epic": str(epic.id)}
            )
            self.db.add(story)
            created_stories.append(story)

        self.db.commit()
        return created_stories

    def _generate_fallback_story_titles(self, epic: Task) -> List[str]:
        """Generate fallback story titles when AI fails."""
        base_title = epic.title.replace("Epic: ", "").replace("Módulo: ", "")
        return [
            f"Como usuário, eu quero configurar {base_title}, para personalizar o sistema",
            f"Como usuário, eu quero visualizar lista de {base_title}, para acompanhar dados",
            f"Como usuário, eu quero criar registros em {base_title}, para adicionar informações",
            f"Como usuário, eu quero editar registros de {base_title}, para atualizar dados",
            f"Como usuário, eu quero excluir registros de {base_title}, para remover dados obsoletos",
            f"Como usuário, eu quero buscar em {base_title}, para encontrar dados específicos",
            f"Como usuário, eu quero filtrar {base_title} por status, para organizar visualização",
            f"Como usuário, eu quero exportar dados de {base_title}, para análise externa",
            f"Como usuário, eu quero importar dados para {base_title}, para carga em massa",
            f"Como usuário, eu quero validar dados de {base_title}, para garantir integridade",
            f"Como administrador, eu quero gerenciar permissões de {base_title}, para controle de acesso",
            f"Como usuário, eu quero receber notificações de {base_title}, para acompanhamento",
            f"Como usuário, eu quero ver histórico de {base_title}, para auditoria",
            f"Como usuário, eu quero gerar relatórios de {base_title}, para análise",
            f"Como usuário, eu quero integrar {base_title} com outros módulos, para automação"
        ]

    def _parse_json_response(self, content: str) -> Any:
        """Parse JSON from AI response, handling various formats."""
        import re

        # Remove markdown code blocks
        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*', '', content)
        content = content.strip()

        try:
            return json.loads(content)
        except json.JSONDecodeError:
            # Try to find JSON array in content
            match = re.search(r'\[[\s\S]*\]', content)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return None

    async def _generate_draft_tasks(
        self,
        story: Task,
        project: Project,
        count: int = 8
    ) -> List[Task]:
        """
        PROMPT #257 - Generate tasks with FULL CONTENT using tasks_from_story.yaml.

        Args:
            story: The activated story
            project: The project with context
            count: Number of tasks to generate (default 8)

        Returns:
            List of created Task items with full content
        """
        logger.info(f"Generating {count} tasks with full content for story: {story.title}")

        # Get parent epic and story semantic maps for context
        parent_epic = None
        epic_semantic_map = {}
        story_semantic_map = {}

        if story.parent_id:
            parent_epic = self.db.query(Task).filter(Task.id == story.parent_id).first()
            if parent_epic and parent_epic.interview_insights:
                epic_semantic_map = parent_epic.interview_insights.get("semantic_map", {})

        if story.interview_insights:
            story_semantic_map = story.interview_insights.get("semantic_map", {})

        combined_semantic_map = {**epic_semantic_map, **story_semantic_map}
        semantic_map_text = ""
        if combined_semantic_map:
            semantic_map_text = "\nMAPA SEMANTICO DO EPIC/STORY:\n"
            semantic_map_text += json.dumps(combined_semantic_map, indent=2, ensure_ascii=False)

        # PROMPT #257 - Fetch business rules from RAG
        business_rules_text = ""
        try:
            rag_service = RAGService(self.db)
            rules = rag_service.get_business_rules(project_id=project.id, top_k=20)
            if rules:
                business_rules_text = rag_service.format_business_rules_for_prompt(rules, max_chars=6000)
        except Exception as e:
            logger.warning(f"Could not fetch business rules for tasks: {e}")

        try:
            # PROMPT #257 - Use PromptLoader with tasks_from_story.yaml
            from app.prompts.loader import get_prompt_loader
            loader = get_prompt_loader()

            system_prompt, user_prompt = loader.render(
                "backlog/tasks_from_story",
                {
                    "story_title": story.title,
                    "story_description": (story.description or "Nao especificada")[:5000],
                    "story_story_points": story.story_points or 8,
                    "story_priority": story.priority.value if story.priority else "medium",
                    "story_acceptance_criteria": "\n".join(story.acceptance_criteria or []),
                    "semantic_map_text": semantic_map_text,
                    "business_rules_text": business_rules_text,
                    "rag_context": "",
                }
            )

            user_prompt += f"\n\nGere exatamente {count} Tasks como array JSON."

            orchestrator = AIOrchestrator(self.db)
            response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=6000,
                enable_rag=True,
                project_id=str(project.id)
            )

            response_content = response.get("content", "")
            tasks_data = self._parse_json_response(response_content)

            if not tasks_data or not isinstance(tasks_data, list):
                logger.warning("AI did not return valid tasks array, falling back to title-only")
                return self._generate_draft_tasks_fallback(story)

            tasks_data = tasks_data[:count]
            logger.info(f"Generated {len(tasks_data)} complete task objects for story: {story.title}")

            # Create Task objects with full content
            created_tasks = []
            skipped_count = 0
            rag_svc = RAGService(self.db)

            for i, task_data in enumerate(tasks_data):
                try:
                    if isinstance(task_data, str):
                        task_data = {"title": task_data}

                    task_title = task_data.get("title", f"Task {i+1}")

                    # PROMPT #162 - Check for similar cards
                    similar_cards = rag_svc.find_similar_cards(
                        title=task_title,
                        description=None,
                        project_id=story.project_id,
                        item_type="task",
                        similarity_threshold=0.85,
                        top_k=1
                    )
                    if similar_cards:
                        logger.info(f"Skipping similar task: '{task_title[:50]}...'")
                        skipped_count += 1
                        continue

                    description = task_data.get("description_markdown", task_data.get("description", ""))
                    generated_prompt = task_data.get("description_markdown", "")
                    acceptance_criteria = task_data.get("acceptance_criteria", [])
                    story_points = task_data.get("story_points", 3)
                    priority_str = task_data.get("priority", "medium").lower()
                    task_semantic_map = task_data.get("semantic_map", {})

                    priority_map = {
                        "critical": PriorityLevel.CRITICAL,
                        "high": PriorityLevel.HIGH,
                        "medium": PriorityLevel.MEDIUM,
                        "low": PriorityLevel.LOW,
                        "trivial": PriorityLevel.TRIVIAL,
                    }
                    priority = priority_map.get(priority_str, story.priority or PriorityLevel.MEDIUM)

                    task = Task(
                        project_id=story.project_id,
                        parent_id=story.id,
                        item_type=ItemType.TASK,
                        title=task_title,
                        description=description or f"Task derivada da Story: {story.title}",
                        generated_prompt=generated_prompt,
                        acceptance_criteria=acceptance_criteria,
                        story_points=story_points if isinstance(story_points, int) else 3,
                        priority=priority,
                        labels=["suggested"],
                        workflow_state="draft",
                        status=TaskStatus.BACKLOG,
                        order=i,
                        reporter="system",
                        interview_insights={
                            "derived_from_story": str(story.id),
                            "semantic_map": task_semantic_map,
                        },
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    self.db.add(task)
                    created_tasks.append(task)
                    logger.info(f"Created task {i+1}/{len(tasks_data)}: {task_title[:50]}...")

                except Exception as task_error:
                    logger.error(f"Error creating task '{task_data}': {str(task_error)}")

            if skipped_count > 0:
                logger.info(f"Skipped {skipped_count} duplicate tasks")

            self.db.commit()
            logger.info(f"Created {len(created_tasks)} tasks with full content")
            return created_tasks

        except Exception as e:
            logger.error(f"Error generating tasks: {str(e)}")
            import traceback
            traceback.print_exc()
            return self._generate_draft_tasks_fallback(story)

    def _generate_draft_tasks_fallback(self, story: Task) -> List[Task]:
        """Fallback: create tasks with basic titles when AI fails."""
        fallback_titles = self._generate_fallback_task_titles(story)
        created_tasks = []
        for i, title in enumerate(fallback_titles[:5]):
            task = Task(
                project_id=story.project_id,
                parent_id=story.id,
                item_type=ItemType.TASK,
                title=title,
                description=f"Task derivada da Story: {story.title}",
                generated_prompt="",
                acceptance_criteria=[],
                story_points=3,
                priority=story.priority or PriorityLevel.MEDIUM,
                labels=["suggested"],
                workflow_state="draft",
                status=TaskStatus.BACKLOG,
                order=i,
                interview_insights={"derived_from_story": str(story.id)}
            )
            self.db.add(task)
            created_tasks.append(task)
        self.db.commit()
        return created_tasks

    def _generate_fallback_task_titles(self, story: Task) -> List[str]:
        """Generate fallback task titles when AI fails."""
        base_title = story.title[:50] if story.title else "funcionalidade"
        return [
            "Criar modelo de dados e migrations",
            "Implementar endpoints da API REST",
            "Criar componentes de UI",
            "Implementar validações e regras de negócio",
            "Escrever testes unitários",
            "Implementar integração com serviços",
            "Documentar implementação"
        ]

    async def _generate_draft_subtasks(
        self,
        task: Task,
        project: Project,
        count: int = 5
    ) -> List[Task]:
        """
        PROMPT #257 - Generate subtasks with FULL CONTENT using subtasks_from_task.yaml.

        Args:
            task: The activated task
            project: The project with context
            count: Number of subtasks to generate (default 5)

        Returns:
            List of created Subtask items with full content
        """
        logger.info(f"Generating {count} subtasks with full content for task: {task.title}")

        # Get task semantic map for context
        task_semantic_map = {}
        if task.interview_insights:
            task_semantic_map = task.interview_insights.get("semantic_map", {})

        # Get parent story and grandparent epic for hierarchy context
        parent_story = None
        grandparent_epic = None
        if task.parent_id:
            parent_story = self.db.query(Task).filter(Task.id == task.parent_id).first()
            if parent_story and parent_story.parent_id:
                grandparent_epic = self.db.query(Task).filter(Task.id == parent_story.parent_id).first()

        semantic_map_text = ""
        if task_semantic_map:
            semantic_map_text = "\nMAPA SEMANTICO DA TASK:\n"
            semantic_map_text += json.dumps(task_semantic_map, indent=2, ensure_ascii=False)

        # PROMPT #257 - Fetch business rules from RAG
        business_rules_text = ""
        try:
            rag_service = RAGService(self.db)
            rules = rag_service.get_business_rules(project_id=project.id, top_k=15)
            if rules:
                business_rules_text = rag_service.format_business_rules_for_prompt(rules, max_chars=4000)
        except Exception as e:
            logger.warning(f"Could not fetch business rules for subtasks: {e}")

        try:
            # PROMPT #257 - Use PromptLoader with subtasks_from_task.yaml
            from app.prompts.loader import get_prompt_loader
            loader = get_prompt_loader()

            system_prompt, user_prompt = loader.render(
                "backlog/subtasks_from_task",
                {
                    "task_title": task.title,
                    "task_description": (task.description or "Nao especificada")[:3000],
                    "task_story_points": task.story_points or 3,
                    "task_priority": task.priority.value if task.priority else "medium",
                    "task_acceptance_criteria": "\n".join(task.acceptance_criteria or []),
                    "semantic_map_text": semantic_map_text,
                    "business_rules_text": business_rules_text,
                    "parent_story_title": parent_story.title if parent_story else "",
                    "parent_epic_title": grandparent_epic.title if grandparent_epic else "",
                }
            )

            user_prompt += f"\n\nGere exatamente {count} Subtasks como array JSON."

            orchestrator = AIOrchestrator(self.db)
            response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=4000,
                enable_rag=True,
                project_id=str(project.id)
            )

            response_content = response.get("content", "")
            subtasks_data = self._parse_json_response(response_content)

            if not subtasks_data or not isinstance(subtasks_data, list):
                logger.warning("AI did not return valid subtasks array, falling back to title-only")
                return self._generate_draft_subtasks_fallback(task)

            subtasks_data = subtasks_data[:count]
            logger.info(f"Generated {len(subtasks_data)} complete subtask objects for task: {task.title}")

            # Create Subtask objects with full content
            created_subtasks = []
            skipped_count = 0
            rag_svc = RAGService(self.db)

            for i, st_data in enumerate(subtasks_data):
                try:
                    if isinstance(st_data, str):
                        st_data = {"title": st_data}

                    subtask_title = st_data.get("title", f"Subtask {i+1}")

                    # PROMPT #162 - Check for similar cards
                    similar_cards = rag_svc.find_similar_cards(
                        title=subtask_title,
                        description=None,
                        project_id=task.project_id,
                        item_type="subtask",
                        similarity_threshold=0.85,
                        top_k=1
                    )
                    if similar_cards:
                        logger.info(f"Skipping similar subtask: '{subtask_title[:50]}...'")
                        skipped_count += 1
                        continue

                    description = st_data.get("description_markdown", st_data.get("description", ""))
                    generated_prompt = st_data.get("description_markdown", "")
                    acceptance_criteria = st_data.get("acceptance_criteria", [])
                    story_points = st_data.get("story_points", 1)
                    priority_str = st_data.get("priority", "medium").lower()
                    st_semantic_map = st_data.get("semantic_map", {})

                    priority_map = {
                        "critical": PriorityLevel.CRITICAL,
                        "high": PriorityLevel.HIGH,
                        "medium": PriorityLevel.MEDIUM,
                        "low": PriorityLevel.LOW,
                        "trivial": PriorityLevel.TRIVIAL,
                    }
                    priority = priority_map.get(priority_str, task.priority or PriorityLevel.MEDIUM)

                    subtask = Task(
                        project_id=task.project_id,
                        parent_id=task.id,
                        item_type=ItemType.SUBTASK,
                        title=subtask_title,
                        description=description or f"Subtask derivada da Task: {task.title}",
                        generated_prompt=generated_prompt,
                        acceptance_criteria=acceptance_criteria,
                        story_points=story_points if isinstance(story_points, int) else 1,
                        priority=priority,
                        labels=["suggested"],
                        workflow_state="draft",
                        status=TaskStatus.BACKLOG,
                        order=i,
                        reporter="system",
                        interview_insights={
                            "derived_from_task": str(task.id),
                            "semantic_map": st_semantic_map,
                        },
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    self.db.add(subtask)
                    created_subtasks.append(subtask)
                    logger.info(f"Created subtask {i+1}/{len(subtasks_data)}: {subtask_title[:50]}...")

                except Exception as subtask_error:
                    logger.error(f"Error creating subtask '{st_data}': {str(subtask_error)}")

            if skipped_count > 0:
                logger.info(f"Skipped {skipped_count} duplicate subtasks")

            self.db.commit()
            logger.info(f"Created {len(created_subtasks)} subtasks with full content")
            return created_subtasks

        except Exception as e:
            logger.error(f"Error generating subtasks: {str(e)}")
            import traceback
            traceback.print_exc()
            return self._generate_draft_subtasks_fallback(task)

    def _generate_draft_subtasks_fallback(self, task: Task) -> List[Task]:
        """Fallback: create subtasks with basic titles when AI fails."""
        fallback_titles = self._generate_fallback_subtask_titles(task)
        created_subtasks = []
        for i, title in enumerate(fallback_titles[:3]):
            subtask = Task(
                project_id=task.project_id,
                parent_id=task.id,
                item_type=ItemType.SUBTASK,
                title=title,
                description=f"Subtask derivada da Task: {task.title}",
                generated_prompt="",
                acceptance_criteria=[],
                story_points=1,
                priority=task.priority or PriorityLevel.MEDIUM,
                labels=["suggested"],
                workflow_state="draft",
                status=TaskStatus.BACKLOG,
                order=i,
                interview_insights={"derived_from_task": str(task.id)}
            )
            self.db.add(subtask)
            created_subtasks.append(subtask)
        self.db.commit()
        return created_subtasks

    def _generate_fallback_subtask_titles(self, task: Task) -> List[str]:
        """Generate fallback subtask titles when AI fails."""
        base_title = task.title[:30] if task.title else "item"
        return [
            f"Implementar lógica principal de {base_title}",
            f"Adicionar validações para {base_title}",
            f"Escrever testes para {base_title}",
            f"Documentar {base_title}"
        ]

    async def activate_suggested_story(self, story_id: UUID) -> Dict:
        """
        PROMPT #102 - Activate a suggested story and generate draft tasks.

        Similar to activate_suggested_epic but for stories.
        After activation, auto-generates 5-8 draft tasks.

        Args:
            story_id: Story ID to activate

        Returns:
            Dict with activated story data and children_generated count
        """
        # Fetch story
        story = self.db.query(Task).filter(Task.id == story_id).first()
        if not story:
            raise ValueError(f"Story {story_id} not found")

        if story.item_type != ItemType.STORY:
            raise ValueError(f"Item {story_id} is not a Story (type: {story.item_type})")

        # Check if suggested
        is_suggested = (story.labels and "suggested" in story.labels) or story.workflow_state == "draft"
        if not is_suggested:
            raise ValueError(f"Story {story_id} is not a suggested item")

        # Fetch project
        project = self.db.query(Project).filter(Project.id == story.project_id).first()
        if not project:
            raise ValueError(f"Project {story.project_id} not found")

        # Generate full story content
        story_content = await self._generate_full_story_content(story, project)

        # PROMPT #175 - Validate and restructure AI response before saving
        story_content = self._validate_and_restructure_content(
            story_content, story.title, story.description, project, item_type="story"
        )

        # Update story
        story.description = story_content.get("description", story.description)
        story.generated_prompt = story_content.get("generated_prompt")
        story.acceptance_criteria = story_content.get("acceptance_criteria", [])
        story.story_points = story_content.get("story_points", story.story_points)
        # PROMPT #127 - Track which AI model generated the content
        story.created_by_ai_model = story_content.get("ai_model_used")

        # Store insights
        story.interview_insights = story.interview_insights or {}
        story.interview_insights["semantic_map"] = story_content.get("semantic_map", {})
        story.interview_insights["activated_from_suggestion"] = True
        story.interview_insights["activation_timestamp"] = datetime.utcnow().isoformat()

        # Remove suggested label
        if story.labels and "suggested" in story.labels:
            story.labels = [l for l in story.labels if l != "suggested"]
        story.workflow_state = "open"
        story.updated_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(story)

        logger.info(f"✅ Story activated: {story.title}")

        # PROMPT #127 - Removed auto-generation of draft tasks.
        # Children are now generated on-demand via "Generate Tasks" button.

        # PROMPT #162 - Index activated card in RAG for semantic search
        try:
            rag_service = RAGService(self.db)
            rag_service.store_card(
                card_id=story.id,
                title=story.title,
                description=story.description,
                generated_prompt=story.generated_prompt,
                item_type="story",
                parent_id=story.parent_id,
                labels=story.labels,
                workflow_state=story.workflow_state,
                project_id=story.project_id
            )
            logger.info(f"📇 Story indexed in RAG: {story.title}")
        except Exception as e:
            logger.error(f"❌ Error indexing story in RAG: {str(e)}")

        return {
            "id": str(story.id),
            "title": story.title,
            "description": story.description,
            "generated_prompt": story.generated_prompt,
            "acceptance_criteria": story.acceptance_criteria,
            "story_points": story.story_points,
            "priority": story.priority.value if story.priority else "medium",
            "activated": True,
            "children_generated": 0
        }

    async def _generate_full_story_content(self, story: Task, project: Project, parent_epic: Task = None) -> Dict:
        """
        Generate FULL EPIC-LEVEL content for a story using AI.

        Uses the SAME detailed prompt structure as _generate_full_epic_content.
        Includes ALL parent context (Epic semantic map, project context).

        Args:
            story: The story to generate content for (may only have title)
            project: The project
            parent_epic: The parent Epic (passed directly for full context access)
        """

        # Get parent epic for context - use passed epic or fetch from DB
        if not parent_epic and story.parent_id:
            parent_epic = self.db.query(Task).filter(Task.id == story.parent_id).first()

        epic_semantic_map = {}
        if parent_epic and parent_epic.interview_insights:
            epic_semantic_map = parent_epic.interview_insights.get("semantic_map", {})

        # SAME DETAILED PROMPT AS EPIC - Adapted for Story
        system_prompt = """Você é um Arquiteto de Software e Product Owner especialista gerando especificações técnicas DETALHADAS para User Stories.

OBJETIVO: Gerar uma especificação COMPLETA e DETALHADA da User Story, incluindo:
- Campos e atributos com tipos de dados
- Regras de negócio específicas
- Fluxos e estados
- Interface do usuário
- Integrações e APIs
- Validações e constraints

METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:

**Categorias de Identificadores (use TODAS que forem aplicáveis):**

**Entidades e Dados:**
- **N** (Nouns/Entidades): N1, N2... = Entidades de domínio (Ex: N1=Usuário, N2=Imóvel)
- **ATTR** (Atributos): ATTR1, ATTR2... = Campos/atributos específicos (Ex: ATTR1=nome:string, ATTR2=email:string)
- **D** (Data/Estruturas): D1, D2... = Tabelas, schemas, models (Ex: D1=tabela_usuarios)
- **ENUM** (Enumerações): ENUM1, ENUM2... = Valores fixos (Ex: ENUM1=TipoUsuario[admin,corretor,cliente])
- **REL** (Relacionamentos): REL1, REL2... = Relações entre entidades (Ex: REL1=N1 possui muitos N2)

**Lógica e Regras:**
- **RN** (Regras de Negócio): RN1, RN2... = Regras específicas (Ex: RN1=Email deve ser único)
- **VAL** (Validações): VAL1, VAL2... = Validações de entrada (Ex: VAL1=CPF válido)
- **CALC** (Cálculos): CALC1, CALC2... = Fórmulas e cálculos (Ex: CALC1=comissão=valor*0.05)
- **COND** (Condições): COND1, COND2... = Condições lógicas (Ex: COND1=se status=ativo)

**Fluxos e Processos:**
- **P** (Processos): P1, P2... = Fluxos de trabalho (Ex: P1=Cadastro de imóvel)
- **EST** (Estados): EST1, EST2... = Estados possíveis (Ex: EST1=rascunho, EST2=publicado)
- **TRANS** (Transições): TRANS1, TRANS2... = Transições de estado (Ex: TRANS1=EST1→EST2)
- **STEP** (Etapas): STEP1, STEP2... = Passos do processo (Ex: STEP1=preencher dados)

**Interface:**
- **TELA** (Telas): TELA1, TELA2... = Telas/páginas (Ex: TELA1=Dashboard, TELA2=Listagem)
- **COMP** (Componentes): COMP1, COMP2... = Componentes UI (Ex: COMP1=FormularioCadastro)
- **BTN** (Botões/Ações): BTN1, BTN2... = Ações do usuário (Ex: BTN1=Salvar, BTN2=Cancelar)
- **FILTRO** (Filtros): FILTRO1... = Filtros disponíveis (Ex: FILTRO1=por status)

**Integrações:**
- **API** (Endpoints): API1, API2... = Endpoints REST (Ex: API1=POST /usuarios)
- **S** (Serviços): S1, S2... = Serviços externos (Ex: S1=serviço de email)
- **EVENTO** (Eventos): EVENTO1... = Eventos do sistema (Ex: EVENTO1=usuario_criado)

**Critérios:**
- **AC** (Acceptance Criteria): AC1, AC2... = Critérios de aceitação
- **PERF** (Performance): PERF1... = Requisitos de performance
- **SEG** (Segurança): SEG1... = Requisitos de segurança

**IMPORTANTE:** REUTILIZE os identificadores do Epic pai (N1, N2, ATTR1, etc.) e ESTENDA com novos específicos desta Story.

ESTRUTURA OBRIGATÓRIA DO description_markdown:

```
# Story: [Título no formato User Story]

## Mapa Semântico

### Entidades (Reutilizadas do Epic)
- **N1**: [reutilizado do Epic]
- **N2**: [reutilizado do Epic]

### Atributos Relevantes
- **ATTR1**: [campo]: [tipo] - [descrição]
- **ATTR2**: [campo]: [tipo] - [descrição]
...

### Regras de Negócio
- **RN1**: [regra específica]
- **RN2**: [regra específica]
...

### Validações
- **VAL1**: [validação]
...

### Estados e Transições
- **EST1**: [estado1]
- **TRANS1**: EST1 → EST2 quando [condição]
...

### Telas e Componentes
- **TELA1**: [nome da tela] - [descrição]
- **COMP1**: [componente] em TELA1
...

### Endpoints
- **API1**: [método] [rota] - [descrição]
...

## Descrição Funcional

[Narrativa DETALHADA usando os identificadores. Descreva o fluxo completo,
como as telas interagem, quais validações são aplicadas em cada etapa,
como os estados mudam, etc. MÍNIMO 1500 caracteres.]

## Fluxo Principal

1. STEP1: [descrição usando identificadores]
2. STEP2: [descrição usando identificadores]
...

## Critérios de Aceitação

1. **AC1**: [critério específico e mensurável]
2. **AC2**: [critério específico e mensurável]
...

## Regras de Negócio Detalhadas

### RN1: [Nome da Regra]
- **Condição**: [quando se aplica]
- **Ação**: [o que acontece]
- **Exceção**: [casos especiais]

...

## Especificação de Dados

### Campos Envolvidos
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| ATTR1 | string | Sim | ... |
| ATTR2 | integer | Não | ... |

## Considerações Técnicas

- [consideração 1]
- [consideração 2]
```

Retorne APENAS JSON válido (sem markdown code blocks):
{
    "title": "Título da Story",
    "semantic_map": {
        "N1": "reutilizado do Epic", "N2": "...",
        "ATTR1": "campo: tipo - descrição",
        "RN1": "regra específica",
        "EST1": "estado", "TRANS1": "transição",
        "TELA1": "tela", "API1": "endpoint",
        "AC1": "critério de aceitação"
    },
    "description_markdown": "[MARKDOWN COMPLETO seguindo a estrutura acima - MÍNIMO 1500 caracteres]",
    "story_points": 5,
    "priority": "high",
    "acceptance_criteria": ["AC1: critério", "AC2: critério", "AC3: critério", "AC4: critério", "AC5: critério"],
    "interview_insights": {
        "key_requirements": ["requisito 1", "requisito 2"],
        "business_goals": ["objetivo 1", "objetivo 2"],
        "technical_constraints": ["restrição 1", "restrição 2"]
    }
}

**REGRAS CRÍTICAS:**
- MÍNIMO 20 identificadores no mapa semântico
- REUTILIZE identificadores do Epic (N1-N9, ATTR1-ATTR9, etc.)
- ESTENDA com novos identificadores específicos desta Story
- DETALHE campos com TIPOS DE DADOS (string, integer, boolean, date, etc)
- DETALHE regras de negócio com CONDIÇÕES ESPECÍFICAS
- INCLUA telas e componentes UI
- INCLUA endpoints da API
- A descrição deve ter MÍNIMO 1500 caracteres
- MÍNIMO 5 critérios de aceitação
- TUDO EM PORTUGUÊS
"""

        # PROMPT #232 - Compressed context replaces NO TRUNCATION pattern
        from app.services.prompt_context_compressor import PromptContextCompressor
        _compressor = PromptContextCompressor(self.db)
        _ctx = _compressor.compress_hierarchy_context(
            item_type="story",
            item_title=story.title,
            project=project,
            parent_card=parent_epic,
            max_context_tokens=8000,
        )

        user_prompt = f"""Gere a ESPECIFICAÇÃO TÉCNICA COMPLETA para a User Story abaixo.

A Story deve ter o MESMO NÍVEL DE DETALHAMENTO do Epic pai.
Os critérios de aceitação devem ser ESPECÍFICOS para esta Story, não genéricos.

## CONTEXTO DO PROJETO
**Nome:** {project.name}
**Contexto:**
{(project.context_human or project.context_semantic or 'Não disponível')[:3000]}

{_ctx.parent_context}
{_ctx.semantic_map_text}

{_ctx.business_rules}
{f'ATENÇÃO: As regras de negócio acima DEVEM influenciar esta Story.' if _ctx.business_rules and 'Consulte' not in _ctx.business_rules else ''}

## STORY A ESPECIFICAR
**Título da Story:** {story.title}

## REGRAS OBRIGATÓRIAS

1. **REUTILIZE os identificadores do Epic** (N1, N2, ATTR1, RN1, etc.)
2. **ESTENDA com NOVOS identificadores específicos desta Story** (ex: se Epic tem N1-N5, adicione N6-N10)
3. **Critérios de Aceitação ESPECÍFICOS** - baseados no título e contexto da Story, NÃO genéricos como "funcionalidade implementada"
4. **description_markdown MÍNIMO 1500 caracteres** com estrutura completa
5. **MÍNIMO 20 identificadores** no mapa semântico
6. **MÍNIMO 5 critérios de aceitação** específicos e mensuráveis
7. **Inclua**: campos com tipos de dados, regras de negócio, telas/componentes, endpoints API

## EXEMPLO DE CRITÉRIOS DE ACEITAÇÃO ESPECÍFICOS (para uma Story de cadastro de usuário):
- "AC1: Formulário de cadastro exibe campos nome, email, senha e confirmação de senha"
- "AC2: Email é validado com formato correto e verificação de unicidade no banco"
- "AC3: Senha deve ter mínimo 8 caracteres, incluindo letra maiúscula e número"
- "AC4: Após cadastro bem-sucedido, usuário recebe email de confirmação"
- "AC5: Usuário não confirmado não consegue fazer login"

## EXEMPLO DE CRITERIOS GENERICOS (NAO USE):
- "Funcionalidade implementada" [RUIM]
- "Testes passam" [RUIM]
- "Codigo revisado" [RUIM]

Retorne APENAS o JSON, sem explicações."""

        try:
            # PROMPT #100: Disable cache for individual content generation
            # Semantic cache matches similar prompts, causing duplicate content
            orchestrator = AIOrchestrator(self.db, enable_cache=False)
            response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=6000,
                enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
                project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            )

            # PROMPT #127 - Capture AI model used for tracking
            ai_model_used = response.get("model", "unknown")

            content = response.get("content", "")
            # PROMPT #178 - Use robust parser (8 strategies) instead of simple _parse_json_response
            try:
                result = _robust_json_parse(content, context=f"story_content:{story.title[:30]}")
            except ValueError:
                result = None

            if result and isinstance(result, dict):
                # Convert semantic to human description
                semantic_map = result.get("semantic_map", {})
                description_markdown = result.get("description_markdown", "")
                result["description"] = _convert_semantic_to_human(description_markdown, semantic_map)
                # PROMPT #180 - Include acceptance criteria in generated_prompt
                acceptance_criteria = result.get("acceptance_criteria", [])
                prompt_with_criteria = description_markdown
                if acceptance_criteria:
                    prompt_with_criteria += "\n\n## Critérios de Aceitação\n\n"
                    for ac in acceptance_criteria:
                        prompt_with_criteria += f"- {ac}\n"
                result["generated_prompt"] = prompt_with_criteria
                result["ai_model_used"] = ai_model_used  # PROMPT #127
                return result

            # PROMPT #179 - Extract clean content from raw response (never dump raw JSON)
            logger.warning(f"⚠️ Story JSON parsing failed, extracting clean content from raw response")
            raw_content = content.strip() if content else ""
            extracted = _extract_content_from_raw_response(raw_content, story.title, "Story")

            if extracted:
                # Successfully extracted clean content from raw response
                extracted.setdefault("acceptance_criteria", [
                    f"AC1: {story.title} completamente implementada",
                    "AC2: Testes unitários cobrindo os fluxos principais",
                    "AC3: Integração com módulos dependentes verificada",
                    "AC4: Interface de usuário funcional e responsiva",
                    "AC5: Documentação técnica atualizada"
                ])
                # PROMPT #180 - Append criteria to generated_prompt
                ac_list = extracted.get("acceptance_criteria", [])
                if ac_list and "## Critérios de Aceitação" not in extracted.get("generated_prompt", ""):
                    extracted["generated_prompt"] = extracted.get("generated_prompt", "") + "\n\n## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in ac_list)
                extracted.setdefault("semantic_map", epic_semantic_map)
                extracted.setdefault("story_points", story.story_points or 5)
                extracted.setdefault("interview_insights", {"derived_from_epic": str(parent_epic.id) if parent_epic else None})
                extracted["ai_model_used"] = ai_model_used
                return extracted

            # No usable content extracted - build from parent context
            epic_desc = (parent_epic.description or parent_epic.generated_prompt or "") if parent_epic else ""
            project_ctx = (project.context_human or project.context_semantic or "")[:2000]
            story_ac = [
                f"AC1: {story.title} completamente implementada",
                "AC2: Testes unitários cobrindo os fluxos principais",
                "AC3: Integração com módulos dependentes verificada",
                "AC4: Interface de usuário funcional e responsiva",
                "AC5: Documentação técnica atualizada"
            ]
            fallback_desc = (
                f"# Story: {story.title}\n\n"
                f"## Visão Geral\n\n"
                f"{story.description or story.title}\n\n"
                f"## Contexto do Epic\n\n"
                f"**{parent_epic.title if parent_epic else 'N/A'}**\n\n"
                f"{epic_desc[:2000]}\n\n"
                f"## Contexto do Projeto\n\n"
                f"{project_ctx}\n\n"
            )
            # PROMPT #180 - Include criteria in generated_prompt
            fallback_prompt = fallback_desc + "## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in story_ac)
            return {
                "description": fallback_desc.rstrip() + "\n\n*Conteúdo gerado como fallback. Edite para adicionar detalhes técnicos.*",
                "generated_prompt": fallback_prompt,
                "acceptance_criteria": story_ac,
                "semantic_map": epic_semantic_map,
                "story_points": story.story_points or 5,
                "interview_insights": {"derived_from_epic": str(parent_epic.id) if parent_epic else None},
                "ai_model_used": ai_model_used  # PROMPT #127
            }

        except Exception as e:
            logger.error(f"Error generating story content: {e}")
            # PROMPT #178 - Even on exception, provide meaningful content from parent context
            epic_desc = ""
            if story.parent_id:
                try:
                    pe = self.db.query(Task).filter(Task.id == story.parent_id).first()
                    if pe:
                        epic_desc = f"## Contexto do Epic\n\n**{pe.title}**\n\n{(pe.description or pe.generated_prompt or '')[:2000]}"
                except Exception:
                    pass
            project_ctx = (project.context_human or project.context_semantic or "")[:1500] if project else ""
            fallback = (
                f"# Story: {story.title}\n\n"
                f"{story.description or ''}\n\n"
                f"{epic_desc}\n\n"
                f"## Contexto do Projeto\n\n{project_ctx}\n\n"
                f"*Conteúdo gerado como fallback após erro. Edite para adicionar detalhes.*"
            )
            return {
                "description": fallback,
                "generated_prompt": fallback,
                "acceptance_criteria": [f"{story.title} implementada e funcional"],
                "semantic_map": {},
                "story_points": story.story_points or 5,
                "ai_model_used": None  # PROMPT #127
            }

    async def activate_suggested_task(self, task_id: UUID) -> Dict:
        """
        PROMPT #102 - Activate a suggested task and generate draft subtasks.

        After activation, auto-generates 3-5 draft subtasks.

        Args:
            task_id: Task ID to activate

        Returns:
            Dict with activated task data and children_generated count
        """
        # Fetch task
        task = self.db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise ValueError(f"Task {task_id} not found")

        if task.item_type != ItemType.TASK:
            raise ValueError(f"Item {task_id} is not a Task (type: {task.item_type})")

        # Check if suggested
        is_suggested = (task.labels and "suggested" in task.labels) or task.workflow_state == "draft"
        if not is_suggested:
            raise ValueError(f"Task {task_id} is not a suggested item")

        # Fetch project
        project = self.db.query(Project).filter(Project.id == task.project_id).first()
        if not project:
            raise ValueError(f"Project {task.project_id} not found")

        # Fetch parent story and grandparent epic for full context
        parent_story = None
        grandparent_epic = None
        if task.parent_id:
            parent_story = self.db.query(Task).filter(Task.id == task.parent_id).first()
            if parent_story and parent_story.parent_id:
                grandparent_epic = self.db.query(Task).filter(Task.id == parent_story.parent_id).first()

        # Generate full task content with complete hierarchy context
        task_content = await self._generate_full_task_content(task, project, parent_story, grandparent_epic)

        # PROMPT #175 - Validate and restructure AI response before saving
        task_content = self._validate_and_restructure_content(
            task_content, task.title, task.description, project, item_type="task"
        )

        # Update task
        task.description = task_content.get("description", task.description)
        task.generated_prompt = task_content.get("generated_prompt")
        task.acceptance_criteria = task_content.get("acceptance_criteria", [])
        task.story_points = task_content.get("story_points", task.story_points)
        # PROMPT #127 - Track which AI model generated the content
        task.created_by_ai_model = task_content.get("ai_model_used")

        # Store insights
        task.interview_insights = task.interview_insights or {}
        task.interview_insights["activated_from_suggestion"] = True
        task.interview_insights["activation_timestamp"] = datetime.utcnow().isoformat()

        # Remove suggested label
        if task.labels and "suggested" in task.labels:
            task.labels = [l for l in task.labels if l != "suggested"]
        task.workflow_state = "open"
        task.updated_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(task)

        logger.info(f"✅ Task activated: {task.title}")

        # PROMPT #127 - Removed auto-generation of draft subtasks.
        # Children are now generated on-demand via "Generate Subtasks" button.

        # PROMPT #162 - Index activated card in RAG for semantic search
        try:
            rag_service = RAGService(self.db)
            rag_service.store_card(
                card_id=task.id,
                title=task.title,
                description=task.description,
                generated_prompt=task.generated_prompt,
                item_type="task",
                parent_id=task.parent_id,
                labels=task.labels,
                workflow_state=task.workflow_state,
                project_id=task.project_id
            )
            logger.info(f"📇 Task indexed in RAG: {task.title}")
        except Exception as e:
            logger.error(f"❌ Error indexing task in RAG: {str(e)}")

        return {
            "id": str(task.id),
            "title": task.title,
            "description": task.description,
            "generated_prompt": task.generated_prompt,
            "acceptance_criteria": task.acceptance_criteria,
            "story_points": task.story_points,
            "priority": task.priority.value if task.priority else "medium",
            "activated": True,
            "children_generated": 0
        }

    async def _generate_full_task_content(self, task: Task, project: Project, parent_story: Task = None, grandparent_epic: Task = None) -> Dict:
        """
        Generate FULL EPIC-LEVEL content for a task using AI.

        Uses the SAME detailed prompt structure as _generate_full_epic_content.
        Includes ALL parent context (Epic + Story semantic maps, project context).

        Args:
            task: The task to generate content for (may only have title)
            project: The project
            parent_story: The parent Story (passed directly for full context access)
            grandparent_epic: The grandparent Epic (passed directly for full context access)
        """

        # Get parent story and grandparent epic for full context
        # Use passed parameters or fetch from DB if not provided
        story_semantic_map = {}
        epic_semantic_map = {}

        if not parent_story and task.parent_id:
            parent_story = self.db.query(Task).filter(Task.id == task.parent_id).first()

        if parent_story:
            if parent_story.interview_insights:
                story_semantic_map = parent_story.interview_insights.get("semantic_map", {})
            if not grandparent_epic and parent_story.parent_id:
                grandparent_epic = self.db.query(Task).filter(Task.id == parent_story.parent_id).first()

        if grandparent_epic and grandparent_epic.interview_insights:
            epic_semantic_map = grandparent_epic.interview_insights.get("semantic_map", {})

        # Combine all semantic maps for context
        combined_semantic_map = {**epic_semantic_map, **story_semantic_map}

        # SAME DETAILED PROMPT AS EPIC - Adapted for Task
        system_prompt = """Você é um Arquiteto de Software e Tech Lead especialista gerando especificações técnicas DETALHADAS para Tasks de desenvolvimento.

OBJETIVO: Gerar uma especificação TÉCNICA COMPLETA da Task, incluindo:
- Arquivos a criar/modificar
- Funções e métodos com assinaturas
- Parâmetros e tipos de retorno
- Validações e tratamento de erros
- Testes necessários
- Comandos e código de exemplo

METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:

**Categorias de Identificadores (use TODAS que forem aplicáveis):**

**Código e Arquivos:**
- **FILE** (Arquivos): FILE1, FILE2... = Arquivos a criar/modificar (Ex: FILE1=src/models/User.ts)
- **FUNC** (Funções): FUNC1, FUNC2... = Funções/métodos (Ex: FUNC1=createUser(data: UserDTO): Promise<User>)
- **CLASS** (Classes): CLASS1, CLASS2... = Classes a criar (Ex: CLASS1=UserService)
- **PARAM** (Parâmetros): PARAM1, PARAM2... = Parâmetros de funções (Ex: PARAM1=userId: string)
- **RET** (Retornos): RET1, RET2... = Tipos de retorno (Ex: RET1=Promise<User>)
- **IMPORT** (Imports): IMPORT1... = Imports necessários (Ex: IMPORT1=import { User } from './models')

**Dados e Tipos:**
- **N** (Entidades): N1, N2... = Entidades envolvidas (reutilizar do Epic/Story)
- **ATTR** (Atributos): ATTR1, ATTR2... = Campos com tipos (reutilizar do Epic/Story)
- **TYPE** (Tipos): TYPE1, TYPE2... = Tipos/interfaces (Ex: TYPE1=UserDTO)
- **SCHEMA** (Schemas): SCHEMA1... = Schemas de validação (Ex: SCHEMA1=createUserSchema)

**Lógica:**
- **VAL** (Validações): VAL1, VAL2... = Validações a implementar
- **ERR** (Erros): ERR1, ERR2... = Erros a tratar (Ex: ERR1=UserNotFoundError)
- **LOG** (Logs): LOG1... = Logs a adicionar
- **COND** (Condições): COND1... = Condições lógicas

**Integração:**
- **API** (Endpoints): API1, API2... = Endpoints (reutilizar do Epic/Story)
- **QUERY** (Queries): QUERY1... = Queries de banco (Ex: QUERY1=SELECT * FROM users WHERE id = ?)
- **CMD** (Comandos): CMD1... = Comandos a executar (Ex: CMD1=npm run migrate)

**Testes:**
- **TEST** (Testes): TEST1, TEST2... = Casos de teste (Ex: TEST1=should create user with valid data)
- **MOCK** (Mocks): MOCK1... = Mocks necessários
- **FIXTURE** (Fixtures): FIXTURE1... = Dados de teste

**Critérios:**
- **AC** (Acceptance Criteria): AC1, AC2... = Critérios de aceitação técnicos

**IMPORTANTE:** REUTILIZE os identificadores do Epic/Story (N1, N2, ATTR1, API1, etc.) e ESTENDA com novos específicos desta Task.

ESTRUTURA OBRIGATÓRIA DO description_markdown:

```
# Task: [Título Técnico]

## Mapa Semântico

### Entidades (Reutilizadas)
- **N1**: [do Epic/Story]

### Arquivos
- **FILE1**: [caminho/arquivo.ext] - [descrição do que fazer]
- **FILE2**: [caminho/arquivo.ext] - [descrição]

### Funções a Implementar
- **FUNC1**: [assinatura completa com tipos]
- **FUNC2**: [assinatura completa com tipos]

### Tipos/Interfaces
- **TYPE1**: [definição do tipo]

### Validações
- **VAL1**: [validação específica]
- **VAL2**: [validação específica]

### Tratamento de Erros
- **ERR1**: [erro e como tratar]

### Queries/Comandos
- **QUERY1**: [query SQL ou comando]
- **CMD1**: [comando terminal]

### Testes Necessários
- **TEST1**: [caso de teste]
- **TEST2**: [caso de teste]

## Descrição Técnica

[Narrativa DETALHADA usando os identificadores. Descreva EXATAMENTE:
- O QUE implementar (quais arquivos, funções)
- COMO implementar (lógica, algoritmo)
- ONDE implementar (localização no código)
MÍNIMO 1200 caracteres.]

## Passos de Implementação

1. STEP1: [passo detalhado com identificadores]
2. STEP2: [passo detalhado]
...

## Código de Exemplo

```[linguagem]
// Exemplo de implementação de FUNC1
[código de exemplo]
```

## Critérios de Aceitação Técnicos

1. **AC1**: [critério técnico específico]
2. **AC2**: [critério técnico específico]
...

## Comandos Necessários

```bash
[comandos a executar]
```

## Considerações Técnicas

- [consideração 1]
- [consideração 2]
```

Retorne APENAS JSON válido:
{
    "title": "Título da Task",
    "semantic_map": {
        "N1": "reutilizado", "ATTR1": "reutilizado",
        "FILE1": "caminho/arquivo.ext",
        "FUNC1": "assinatura(params): ReturnType",
        "VAL1": "validação",
        "ERR1": "erro",
        "TEST1": "caso de teste",
        "AC1": "critério"
    },
    "description_markdown": "[MARKDOWN COMPLETO - MÍNIMO 1200 caracteres]",
    "story_points": 3,
    "acceptance_criteria": ["AC1: critério", "AC2: critério", "AC3: critério", "AC4: critério"],
    "interview_insights": {
        "files_to_modify": ["arquivo1", "arquivo2"],
        "dependencies": ["dep1", "dep2"],
        "commands": ["cmd1", "cmd2"]
    }
}

**REGRAS CRÍTICAS:**
- MÍNIMO 15 identificadores no mapa semântico
- REUTILIZE identificadores do Epic/Story
- INCLUA arquivos específicos (FILE1, FILE2...)
- INCLUA funções com assinaturas completas (FUNC1, FUNC2...)
- INCLUA casos de teste (TEST1, TEST2...)
- A descrição deve ter MÍNIMO 1200 caracteres
- MÍNIMO 4 critérios de aceitação
- INCLUA código de exemplo quando aplicável
- TUDO EM PORTUGUÊS
"""

        # PROMPT #232 - Compressed context replaces NO TRUNCATION pattern
        from app.services.prompt_context_compressor import PromptContextCompressor
        _compressor = PromptContextCompressor(self.db)
        _ctx = _compressor.compress_hierarchy_context(
            item_type="task",
            item_title=task.title,
            project=project,
            parent_card=parent_story,
            grandparent_card=grandparent_epic,
            max_context_tokens=6000,
        )

        user_prompt = f"""Gere a ESPECIFICAÇÃO TÉCNICA COMPLETA para esta Task.

A Task deve ter o MESMO NÍVEL DE DETALHAMENTO do Epic e da Story pai.
Os critérios de aceitação devem ser TÉCNICOS e ESPECÍFICOS para esta Task.

## CONTEXTO DO PROJETO
**Nome:** {project.name}

**Contexto do Projeto:**
{project.context_human or project.context_semantic or 'Não disponível'}

{_ctx.parent_context}
{_ctx.semantic_map_text}

{_ctx.business_rules}

## TASK A ESPECIFICAR
**Título da Task:** {task.title}

## REGRAS OBRIGATÓRIAS

1. **REUTILIZE os identificadores do Epic/Story** (N1, N2, ATTR1, API1, etc.)
2. **ESTENDA com identificadores TÉCNICOS** (FILE1, FUNC1, CLASS1, TEST1, etc.)
3. **Critérios de Aceitação TÉCNICOS** - específicos para implementação
4. **description_markdown MÍNIMO 1200 caracteres** com estrutura técnica completa
5. **MÍNIMO 15 identificadores** no mapa semântico
6. **MÍNIMO 4 critérios de aceitação** técnicos e mensuráveis
7. **INCLUA**: arquivos específicos, funções com assinaturas, código de exemplo

## EXEMPLO DE CRITÉRIOS DE ACEITAÇÃO TÉCNICOS:
- "AC1: Endpoint POST /api/users retorna 201 com dados do usuário criado"
- "AC2: Validação retorna 400 se email inválido ou já existente"
- "AC3: Testes unitários cobrem casos de sucesso e erro"
- "AC4: Logs de criação de usuário registrados corretamente"

## EXEMPLO DE CRITÉRIOS GENÉRICOS (NÃO USE):
- "Implementação completa" ❌
- "Código revisado" ❌
- "Funciona corretamente" ❌

Retorne APENAS o JSON, sem explicações."""

        try:
            # PROMPT #100: Disable cache for individual content generation
            orchestrator = AIOrchestrator(self.db, enable_cache=False)
            response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=6000,
                enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
                project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            )

            # PROMPT #127 - Capture AI model used for tracking
            ai_model_used = response.get("model", "unknown")

            content = response.get("content", "")
            # PROMPT #178 - Use robust parser (8 strategies) instead of simple _parse_json_response
            try:
                result = _robust_json_parse(content, context=f"task_content:{task.title[:30]}")
            except ValueError:
                result = None

            if result and isinstance(result, dict):
                # Convert semantic to human description
                semantic_map = result.get("semantic_map", {})
                description_markdown = result.get("description_markdown", "")
                result["description"] = _convert_semantic_to_human(description_markdown, semantic_map)
                # PROMPT #180 - Include acceptance criteria in generated_prompt
                acceptance_criteria = result.get("acceptance_criteria", [])
                prompt_with_criteria = description_markdown
                if acceptance_criteria:
                    prompt_with_criteria += "\n\n## Critérios de Aceitação\n\n"
                    for ac in acceptance_criteria:
                        prompt_with_criteria += f"- {ac}\n"
                result["generated_prompt"] = prompt_with_criteria
                result["ai_model_used"] = ai_model_used  # PROMPT #127
                return result

            # PROMPT #179 - Extract clean content from raw response (never dump raw JSON)
            logger.warning(f"⚠️ Task JSON parsing failed, extracting clean content from raw response")
            raw_content = content.strip() if content else ""
            extracted = _extract_content_from_raw_response(raw_content, task.title, "Task")

            if extracted:
                extracted.setdefault("acceptance_criteria", [
                    f"AC1: {task.title} implementada",
                    "AC2: Testes unitários adicionados",
                    "AC3: Code review aprovado",
                    "AC4: Sem bugs ou regressões"
                ])
                # PROMPT #180 - Append criteria to generated_prompt
                ac_list = extracted.get("acceptance_criteria", [])
                if ac_list and "## Critérios de Aceitação" not in extracted.get("generated_prompt", ""):
                    extracted["generated_prompt"] = extracted.get("generated_prompt", "") + "\n\n## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in ac_list)
                extracted.setdefault("semantic_map", combined_semantic_map)
                extracted.setdefault("story_points", task.story_points or 3)
                extracted["ai_model_used"] = ai_model_used
                return extracted

            # No usable content extracted - build from parent context
            story_desc = (parent_story.description or parent_story.generated_prompt or "") if parent_story else ""
            epic_desc = (grandparent_epic.description or grandparent_epic.generated_prompt or "") if grandparent_epic else ""
            task_ac = [
                f"AC1: {task.title} implementada",
                "AC2: Testes unitários adicionados",
                "AC3: Code review aprovado",
                "AC4: Sem bugs ou regressões"
            ]
            fallback_desc = (
                f"# Task: {task.title}\n\n"
                f"## Visão Geral\n\n{task.description or task.title}\n\n"
                f"## Contexto da Story\n\n**{parent_story.title if parent_story else 'N/A'}**\n\n"
                f"{story_desc[:1500]}\n\n"
                f"## Contexto do Epic\n\n**{grandparent_epic.title if grandparent_epic else 'N/A'}**\n\n"
                f"{epic_desc[:1000]}\n\n"
            )
            # PROMPT #180 - Include criteria in generated_prompt
            fallback_prompt = fallback_desc + "## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in task_ac)
            return {
                "description": fallback_desc.rstrip() + "\n\n*Conteúdo gerado como fallback. Edite para adicionar detalhes técnicos.*",
                "generated_prompt": fallback_prompt,
                "acceptance_criteria": task_ac,
                "semantic_map": combined_semantic_map,
                "story_points": task.story_points or 3,
                "ai_model_used": ai_model_used  # PROMPT #127
            }

        except Exception as e:
            logger.error(f"Error generating task content: {e}")
            # PROMPT #178 - Provide meaningful content from parent context even on exception
            story_ctx = ""
            if task.parent_id:
                try:
                    ps = self.db.query(Task).filter(Task.id == task.parent_id).first()
                    if ps:
                        story_ctx = f"## Contexto da Story\n\n**{ps.title}**\n\n{(ps.description or ps.generated_prompt or '')[:1500]}"
                except Exception:
                    pass
            fallback = (
                f"# Task: {task.title}\n\n"
                f"{task.description or ''}\n\n"
                f"{story_ctx}\n\n"
                f"*Conteúdo gerado como fallback após erro. Edite para adicionar detalhes.*"
            )
            return {
                "description": fallback,
                "generated_prompt": fallback,
                "acceptance_criteria": [f"{task.title} implementada"],
                "story_points": task.story_points or 2,
                "ai_model_used": None  # PROMPT #127
            }

    async def activate_suggested_subtask(self, subtask_id: UUID) -> Dict:
        """
        PROMPT #102 - Activate a suggested subtask.

        Subtasks are leaf nodes - no children generated.
        Generates FULL DETAILED content (same level as Epic/Story/Task).

        Args:
            subtask_id: Subtask ID to activate

        Returns:
            Dict with activated subtask data
        """
        # Fetch subtask
        subtask = self.db.query(Task).filter(Task.id == subtask_id).first()
        if not subtask:
            raise ValueError(f"Subtask {subtask_id} not found")

        if subtask.item_type != ItemType.SUBTASK:
            raise ValueError(f"Item {subtask_id} is not a Subtask (type: {subtask.item_type})")

        # Check if suggested
        is_suggested = (subtask.labels and "suggested" in subtask.labels) or subtask.workflow_state == "draft"
        if not is_suggested:
            raise ValueError(f"Subtask {subtask_id} is not a suggested item")

        # Fetch project
        project = self.db.query(Project).filter(Project.id == subtask.project_id).first()
        if not project:
            raise ValueError(f"Project {subtask.project_id} not found")

        # Fetch full hierarchy for complete context
        parent_task = None
        grandparent_story = None
        great_grandparent_epic = None
        if subtask.parent_id:
            parent_task = self.db.query(Task).filter(Task.id == subtask.parent_id).first()
            if parent_task and parent_task.parent_id:
                grandparent_story = self.db.query(Task).filter(Task.id == parent_task.parent_id).first()
                if grandparent_story and grandparent_story.parent_id:
                    great_grandparent_epic = self.db.query(Task).filter(Task.id == grandparent_story.parent_id).first()

        # Generate FULL subtask content with complete hierarchy context
        subtask_content = await self._generate_full_subtask_content(subtask, project, parent_task, grandparent_story, great_grandparent_epic)

        # PROMPT #175 - Validate and restructure AI response before saving
        subtask_content = self._validate_and_restructure_content(
            subtask_content, subtask.title, subtask.description, project, item_type="subtask"
        )

        # Update subtask with generated content
        subtask.description = subtask_content.get("description", subtask.description)
        subtask.generated_prompt = subtask_content.get("generated_prompt")
        subtask.acceptance_criteria = subtask_content.get("acceptance_criteria", [])
        # PROMPT #127 - Track which AI model generated the content
        subtask.created_by_ai_model = subtask_content.get("ai_model_used")

        # Store semantic map and insights
        subtask.interview_insights = subtask.interview_insights or {}
        subtask.interview_insights["semantic_map"] = subtask_content.get("semantic_map", {})
        subtask.interview_insights["activated_from_suggestion"] = True
        subtask.interview_insights["activation_timestamp"] = datetime.utcnow().isoformat()

        # Merge additional insights
        if subtask_content.get("interview_insights"):
            subtask.interview_insights.update(subtask_content["interview_insights"])

        # Remove suggested label
        if subtask.labels and "suggested" in subtask.labels:
            subtask.labels = [l for l in subtask.labels if l != "suggested"]
        subtask.workflow_state = "open"
        subtask.updated_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(subtask)

        logger.info(f"✅ Subtask activated: {subtask.title}")

        # PROMPT #162 - Index activated card in RAG for semantic search
        try:
            rag_service = RAGService(self.db)
            rag_service.store_card(
                card_id=subtask.id,
                title=subtask.title,
                description=subtask.description,
                generated_prompt=subtask.generated_prompt,
                item_type="subtask",
                parent_id=subtask.parent_id,
                labels=subtask.labels,
                workflow_state=subtask.workflow_state,
                project_id=subtask.project_id
            )
            logger.info(f"📇 Subtask indexed in RAG: {subtask.title}")
        except Exception as e:
            logger.error(f"❌ Error indexing subtask in RAG: {str(e)}")

        return {
            "id": str(subtask.id),
            "title": subtask.title,
            "description": subtask.description,
            "generated_prompt": subtask.generated_prompt,
            "acceptance_criteria": subtask.acceptance_criteria,
            "story_points": subtask.story_points or 1,
            "priority": subtask.priority.value if subtask.priority else "medium",
            "activated": True,
            "children_generated": 0  # Subtasks don't have children
        }

    async def _generate_full_subtask_content(self, subtask: Task, project: Project, parent_task: Task = None, grandparent_story: Task = None, great_grandparent_epic: Task = None) -> Dict:
        """
        Generate FULL EPIC-LEVEL content for a subtask using AI.

        Uses the SAME detailed prompt structure as other items.
        Includes ALL parent context (Epic + Story + Task semantic maps).

        Args:
            subtask: The subtask to generate content for (may only have title)
            project: The project
            parent_task: The parent Task (passed directly for full context access)
            grandparent_story: The grandparent Story (passed directly for full context access)
            great_grandparent_epic: The great-grandparent Epic (passed directly for full context access)
        """

        # Get full hierarchy context: Task -> Story -> Epic
        # Use passed parameters or fetch from DB if not provided
        task_semantic_map = {}
        story_semantic_map = {}
        epic_semantic_map = {}

        if not parent_task and subtask.parent_id:
            parent_task = self.db.query(Task).filter(Task.id == subtask.parent_id).first()

        if parent_task:
            if parent_task.interview_insights:
                task_semantic_map = parent_task.interview_insights.get("semantic_map", {})
            if not grandparent_story and parent_task.parent_id:
                grandparent_story = self.db.query(Task).filter(Task.id == parent_task.parent_id).first()

        if grandparent_story:
            if grandparent_story.interview_insights:
                story_semantic_map = grandparent_story.interview_insights.get("semantic_map", {})
            if not great_grandparent_epic and grandparent_story.parent_id:
                great_grandparent_epic = self.db.query(Task).filter(Task.id == grandparent_story.parent_id).first()

        if great_grandparent_epic and great_grandparent_epic.interview_insights:
            epic_semantic_map = great_grandparent_epic.interview_insights.get("semantic_map", {})

        # Combine all semantic maps
        combined_semantic_map = {**epic_semantic_map, **story_semantic_map, **task_semantic_map}

        system_prompt = """Você é um Desenvolvedor Sênior gerando especificações DETALHADAS para Subtasks de implementação.

OBJETIVO: Gerar uma especificação COMPLETA da Subtask, incluindo:
- Código específico a escrever
- Linhas exatas a modificar
- Comandos a executar
- Validações e testes

METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:

**Categorias de Identificadores:**
- **N** (Entidades): Reutilizar do Epic/Story/Task
- **ATTR** (Atributos): Reutilizar do Epic/Story/Task
- **FILE** (Arquivos): FILE1... = Arquivo específico a modificar
- **LINE** (Linhas): LINE1... = Linhas de código específicas
- **FUNC** (Funções): FUNC1... = Função específica a implementar/modificar
- **CODE** (Código): CODE1... = Bloco de código a adicionar
- **VAL** (Validações): VAL1... = Validação específica
- **TEST** (Testes): TEST1... = Teste específico
- **CMD** (Comandos): CMD1... = Comando a executar
- **AC** (Critérios): AC1, AC2... = Critérios de aceitação

ESTRUTURA OBRIGATÓRIA DO description_markdown:

```
# Subtask: [Título - Ação Específica]

## Mapa Semântico

### Entidades (Reutilizadas)
- **N1**: [do Epic/Story/Task]

### Arquivo(s) a Modificar
- **FILE1**: [caminho/completo/arquivo.ext]

### Código a Adicionar/Modificar
- **CODE1**: [descrição do bloco de código]
- **LINE1**: [linha específica]

### Função(ões) Envolvida(s)
- **FUNC1**: [nome da função]

### Validações
- **VAL1**: [validação]

### Teste(s)
- **TEST1**: [caso de teste]

### Comando(s)
- **CMD1**: [comando]

## Descrição Técnica Detalhada

[Narrativa DETALHADA descrevendo EXATAMENTE:
- O QUE modificar (arquivo, função, linha)
- O CÓDIGO a escrever
- COMO testar
MÍNIMO 800 caracteres.]

## Código a Implementar

```[linguagem]
// Código específico a adicionar
[código completo]
```

## Passos de Execução

1. [Passo específico com arquivo/linha]
2. [Passo específico]
...

## Comandos a Executar

```bash
[comandos]
```

## Critérios de Aceitação

1. **AC1**: [critério específico]
2. **AC2**: [critério específico]
...
```

Retorne APENAS JSON válido:
{
    "title": "Título da Subtask",
    "semantic_map": {
        "N1": "reutilizado",
        "FILE1": "caminho/arquivo.ext",
        "LINE1": "linha específica",
        "CODE1": "descrição do código",
        "FUNC1": "função",
        "VAL1": "validação",
        "TEST1": "teste",
        "CMD1": "comando",
        "AC1": "critério"
    },
    "description_markdown": "[MARKDOWN COMPLETO - MÍNIMO 800 caracteres]",
    "acceptance_criteria": ["AC1: critério", "AC2: critério", "AC3: critério"],
    "interview_insights": {
        "code_to_add": "código",
        "files_to_modify": ["arquivo1"],
        "commands": ["cmd1"]
    }
}

**REGRAS CRÍTICAS:**
- MÍNIMO 10 identificadores no mapa semântico
- REUTILIZE identificadores do Epic/Story/Task
- INCLUA código específico a escrever
- INCLUA arquivo e localização exata
- description_markdown com MÍNIMO 800 caracteres
- MÍNIMO 3 critérios de aceitação
- TUDO EM PORTUGUÊS
"""

        # Build COMPLETE context from Epic + Story + Task - NO TRUNCATION
        epic_full_spec = ""
        story_full_spec = ""
        task_full_spec = ""
        semantic_map_text = ""

        if great_grandparent_epic:
            epic_full_spec = f"""
## ===== ESPECIFICAÇÃO COMPLETA DO EPIC (BISAVÔ) =====

**Título do Epic:** {great_grandparent_epic.title}

**Descrição do Epic:**
{great_grandparent_epic.description or 'N/A'}

**ESPECIFICAÇÃO TÉCNICA COMPLETA DO EPIC (generated_prompt):**
{great_grandparent_epic.generated_prompt or 'N/A'}

## ===== FIM DA ESPECIFICAÇÃO DO EPIC =====
"""

        if grandparent_story:
            story_full_spec = f"""
## ===== ESPECIFICAÇÃO COMPLETA DA STORY (AVÔ) =====

**Título da Story:** {grandparent_story.title}

**Descrição da Story:**
{grandparent_story.description or 'N/A'}

**ESPECIFICAÇÃO TÉCNICA COMPLETA DA STORY (generated_prompt):**
{grandparent_story.generated_prompt or 'N/A'}

## ===== FIM DA ESPECIFICAÇÃO DA STORY =====
"""

        if parent_task:
            task_full_spec = f"""
## ===== ESPECIFICAÇÃO COMPLETA DA TASK (PAI DIRETO) =====

**Título da Task:** {parent_task.title}

**Descrição da Task:**
{parent_task.description or 'N/A'}

**ESPECIFICAÇÃO TÉCNICA COMPLETA DA TASK (generated_prompt):**
{parent_task.generated_prompt or 'N/A'}

## ===== FIM DA ESPECIFICAÇÃO DA TASK =====
"""

        if combined_semantic_map:
            semantic_map_text = "\n\n## MAPA SEMÂNTICO COMBINADO (EPIC + STORY + TASK - VOCÊ DEVE REUTILIZAR):\n"
            semantic_map_text += json.dumps(combined_semantic_map, indent=2, ensure_ascii=False)
            semantic_map_text += "\n\n**OBRIGATÓRIO:** Reutilize TODOS os identificadores relevantes e estenda com novos específicos desta Subtask."

        # PROMPT #182 - Explicitly fetch business rules from RAG
        business_rules_context = ""
        try:
            rag_service = RAGService(self.db)
            rules = rag_service.get_business_rules(project_id=project.id, top_k=10)
            if rules:
                business_rules_context = rag_service.format_business_rules_for_prompt(rules, max_chars=2000)
                logger.info(f"📋 Injected {len(rules)} business rules into subtask content generation")
        except Exception as e:
            logger.warning(f"Could not fetch business rules for subtask: {e}")

        user_prompt = f"""Gere a ESPECIFICAÇÃO COMPLETA para esta Subtask.

A Subtask deve ter o MESMO NÍVEL DE DETALHAMENTO do Epic/Story/Task pai.
Os critérios de aceitação devem ser ESPECÍFICOS para esta Subtask.

## CONTEXTO DO PROJETO
**Nome:** {project.name}

**Contexto do Projeto:**
{project.context_human or project.context_semantic or 'Não disponível'}

{epic_full_spec}
{story_full_spec}
{task_full_spec}
{semantic_map_text}

{business_rules_context}
{f'ATENÇÃO: As regras de negócio acima foram extraídas do código-fonte. IMPLEMENTE as regras relevantes nesta Subtask.' if business_rules_context else ''}

## SUBTASK A ESPECIFICAR
**Título da Subtask:** {subtask.title}

## REGRAS OBRIGATÓRIAS

1. **REUTILIZE os identificadores do Epic/Story/Task** (N1, ATTR1, API1, FILE1, FUNC1, etc.)
2. **ESTENDA com identificadores ESPECÍFICOS** (CODE1, LINE1, etc.)
3. **Critérios de Aceitação ESPECÍFICOS** - para esta subtask exata
4. **description_markdown MÍNIMO 800 caracteres** com estrutura técnica
5. **MÍNIMO 10 identificadores** no mapa semântico
6. **MÍNIMO 3 critérios de aceitação** específicos
7. **INCLUA**: código específico a escrever, arquivo e localização exata

## EXEMPLO DE CRITÉRIOS DE ACEITAÇÃO ESPECÍFICOS:
- "AC1: Arquivo src/models/User.ts modificado com novo campo 'avatar'"
- "AC2: Função createUser atualizada para aceitar parâmetro 'avatarUrl'"
- "AC3: Teste unitário adicionado para validar upload de avatar"

## EXEMPLO DE CRITÉRIOS GENÉRICOS (NÃO USE):
- "Código implementado" ❌
- "Funciona corretamente" ❌

Retorne APENAS o JSON, sem explicações."""

        try:
            # PROMPT #100: Disable cache for individual content generation
            orchestrator = AIOrchestrator(self.db, enable_cache=False)
            response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=6000,
                enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
                project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            )

            # PROMPT #127 - Capture AI model used for tracking
            ai_model_used = response.get("model", "unknown")

            content = response.get("content", "")
            # PROMPT #178 - Use robust parser (8 strategies) instead of simple _parse_json_response
            try:
                result = _robust_json_parse(content, context=f"subtask_content:{subtask.title[:30]}")
            except ValueError:
                result = None

            if result and isinstance(result, dict):
                semantic_map = result.get("semantic_map", {})
                description_markdown = result.get("description_markdown", "")
                result["description"] = _convert_semantic_to_human(description_markdown, semantic_map)
                # PROMPT #180 - Include acceptance criteria in generated_prompt
                acceptance_criteria = result.get("acceptance_criteria", [])
                prompt_with_criteria = description_markdown
                if acceptance_criteria:
                    prompt_with_criteria += "\n\n## Critérios de Aceitação\n\n"
                    for ac in acceptance_criteria:
                        prompt_with_criteria += f"- {ac}\n"
                result["generated_prompt"] = prompt_with_criteria
                result["ai_model_used"] = ai_model_used  # PROMPT #127
                return result

            # PROMPT #179 - Extract clean content from raw response (never dump raw JSON)
            logger.warning(f"⚠️ Subtask JSON parsing failed, extracting clean content from raw response")
            raw_content = content.strip() if content else ""
            extracted = _extract_content_from_raw_response(raw_content, subtask.title, "Subtask")

            if extracted:
                extracted.setdefault("acceptance_criteria", [
                    f"AC1: {subtask.title} implementada",
                    "AC2: Testes passam",
                    "AC3: Code review aprovado"
                ])
                # PROMPT #180 - Append criteria to generated_prompt
                ac_list = extracted.get("acceptance_criteria", [])
                if ac_list and "## Critérios de Aceitação" not in extracted.get("generated_prompt", ""):
                    extracted["generated_prompt"] = extracted.get("generated_prompt", "") + "\n\n## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in ac_list)
                extracted.setdefault("semantic_map", combined_semantic_map)
                extracted["ai_model_used"] = ai_model_used
                return extracted

            # No usable content extracted - build from parent context
            task_desc = (parent_task.description or parent_task.generated_prompt or "") if parent_task else ""
            story_desc = (grandparent_story.description or grandparent_story.generated_prompt or "") if grandparent_story else ""
            subtask_ac = [
                f"AC1: {subtask.title} implementada",
                "AC2: Testes passam",
                "AC3: Code review aprovado"
            ]
            fallback_desc = (
                f"# Subtask: {subtask.title}\n\n"
                f"## Visão Geral\n\n{subtask.description or subtask.title}\n\n"
                f"## Contexto da Task\n\n**{parent_task.title if parent_task else 'N/A'}**\n\n"
                f"{task_desc[:1500]}\n\n"
                f"## Contexto da Story\n\n**{grandparent_story.title if grandparent_story else 'N/A'}**\n\n"
                f"{story_desc[:1000]}\n\n"
            )
            # PROMPT #180 - Include criteria in generated_prompt
            fallback_prompt = fallback_desc + "## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in subtask_ac)
            return {
                "description": fallback_desc.rstrip() + "\n\n*Conteúdo gerado como fallback. Edite para adicionar detalhes técnicos.*",
                "generated_prompt": fallback_prompt,
                "acceptance_criteria": subtask_ac,
                "semantic_map": combined_semantic_map,
                "ai_model_used": ai_model_used  # PROMPT #127
            }

        except Exception as e:
            logger.error(f"Error generating subtask content: {e}")
            # PROMPT #178 - Provide meaningful content from parent context even on exception
            task_ctx = ""
            if subtask.parent_id:
                try:
                    pt = self.db.query(Task).filter(Task.id == subtask.parent_id).first()
                    if pt:
                        task_ctx = f"## Contexto da Task\n\n**{pt.title}**\n\n{(pt.description or pt.generated_prompt or '')[:1500]}"
                except Exception:
                    pass
            fallback = (
                f"# Subtask: {subtask.title}\n\n"
                f"{subtask.description or ''}\n\n"
                f"{task_ctx}\n\n"
                f"*Conteúdo gerado como fallback após erro. Edite para adicionar detalhes.*"
            )
            return {
                "description": fallback,
                "generated_prompt": fallback,
                "acceptance_criteria": [f"{subtask.title} concluída"],
                "semantic_map": {},
                "ai_model_used": None  # PROMPT #127
            }

    # =========================================================================
    # PROMPT #153 - Background Card Generation from Memory Scan
    # =========================================================================

    async def generate_cards_from_memory(
        self,
        project_id: UUID,
        job_manager=None,
        job_id: Optional[UUID] = None,
        epic_count: int = 10
    ) -> Dict:
        """
        PROMPT #153 - Generate suggested epics and business rule cards from memory scan.
        PROMPT #155 - Now supports incremental epic generation with progress updates.

        This method generates cards using ONLY the memory scan data (initial_memory_context),
        without requiring a Context Interview to be completed. This allows cards to be
        generated in background immediately after the memory scan finishes.

        Two types of cards are generated:
        1. **Business Rule Cards (closed)**: Rules verified in existing code
        2. **Suggested Epics (drafts)**: New functionality to be developed

        Args:
            project_id: Project ID
            job_manager: Optional JobManager for progress updates (PROMPT #155)
            job_id: Optional job UUID for progress updates (PROMPT #155)

        Returns:
            Dict with generation results:
            {
                "success": True/False,
                "business_rule_cards": [...],
                "suggested_epics": [...],
                "context_auto_generated": True/False
            }
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            logger.error(f"❌ Project {project_id} not found for card generation")
            return {"success": False, "error": "Project not found"}

        if not project.initial_memory_context:
            logger.warning(f"⚠️ Project {project_id} has no memory context for card generation")
            return {"success": False, "error": "No memory context available"}

        logger.info(f"🎯 Starting card generation from memory for project: {project.name}")

        result = {
            "success": True,
            "business_rule_cards": [],
            "suggested_epics": [],
            "context_auto_generated": False
        }

        # PROMPT #156 - Check only for suggested epics, not all cards.
        # Business rule cards are generated first and should not block epic generation.
        existing_suggested_epics = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.labels.contains(["suggested"]),
            Task.item_type == ItemType.EPIC
        ).count()

        if existing_suggested_epics > 0:
            logger.info(f"ℹ️ Project {project_id} already has {existing_suggested_epics} suggested epics, skipping epic generation")
            # Still allow business rule cards to be regenerated if missing
            result["skipped_epics"] = True

        # Step 1: Generate rich context from memory scan (if no context exists)
        # PROMPT #264 - Use rich context (4 AI calls: architecture, business domain,
        # features, consolidation) instead of basic deterministic auto-context
        if not project.context_semantic:
            try:
                rich_context = await self.generate_rich_context_from_memory(
                    project_id=project_id,
                    progress_callback=None,
                    ai_timeout=120
                )
                result["context_auto_generated"] = True
                logger.info(f"✅ Rich context generated for project {project.name}")
            except Exception as e:
                logger.warning(f"⚠️ Rich context failed, falling back to auto-context: {e}")
                # Fallback to basic deterministic context
                try:
                    auto_context = await self._generate_auto_context_from_memory(project)
                    result["context_auto_generated"] = True
                    logger.info(f"✅ Auto-generated context (fallback) for project {project.name}")
                except Exception as e2:
                    logger.warning(f"⚠️ Auto-context also failed: {e2}")
                    # Continue anyway - we can still generate cards

        # Step 2: Generate business rule cards (closed)
        try:
            business_rule_cards = await self.generate_business_rule_cards(project_id)
            result["business_rule_cards"] = business_rule_cards
            logger.info(f"✅ Generated {len(business_rule_cards)} business rule cards")
        except Exception as e:
            logger.error(f"❌ Failed to generate business rule cards: {e}")

        # Step 3: Generate suggested epics from memory context
        # PROMPT #156 - Skip only if suggested epics already exist
        # PROMPT #155 - Use incremental generation if job_manager is provided
        if result.get("skipped_epics"):
            logger.info("⏭️ Skipping epic generation - suggested epics already exist")
        else:
            try:
                if job_manager and job_id:
                    # Calculate batches from epic_count
                    import math
                    epics_per_batch = min(epic_count, 5)
                    max_batches = math.ceil(epic_count / epics_per_batch) if epics_per_batch > 0 else 1
                    logger.info(f"📊 Epic generation: {epic_count} epics requested ({max_batches} batches x {epics_per_batch})")
                    # Incremental generation with WebSocket updates
                    epic_result = await self.generate_epics_incrementally(
                        project=project,
                        job_manager=job_manager,
                        job_id=job_id,
                        max_batches=max_batches,
                        epics_per_batch=epics_per_batch
                    )
                    result["suggested_epics"] = epic_result.get("epics", [])
                    result["batches_processed"] = epic_result.get("batches_processed", 0)
                    logger.info(f"✅ Generated {len(result['suggested_epics'])} suggested epics (incremental)")
                else:
                    # Legacy single-call generation
                    suggested_epics = await self._generate_suggested_epics_from_memory(project)
                    result["suggested_epics"] = suggested_epics
                    logger.info(f"✅ Generated {len(suggested_epics)} suggested epics")
            except Exception as e:
                logger.error(f"❌ Failed to generate suggested epics: {e}")

        logger.info(f"🎉 Card generation complete for project {project.name}")
        logger.info(f"   - Business Rules: {len(result['business_rule_cards'])}")
        logger.info(f"   - Suggested Epics: {len(result['suggested_epics'])}")

        return result

    async def _generate_auto_context_from_memory(self, project: Project) -> Dict:
        """
        PROMPT #153 - Auto-generate project context from memory scan data.

        Creates a basic context (semantic and human) from the memory scan results
        without requiring an interview. This context is used for card generation.

        Args:
            project: Project instance with initial_memory_context

        Returns:
            Dict with context_semantic and context_human
        """
        memory_ctx = project.initial_memory_context
        if not memory_ctx:
            raise ValueError("No memory context available")

        # Build a summary from memory scan
        stack_info = memory_ctx.get("stack_info", {})
        key_features = memory_ctx.get("key_features", [])
        business_rules = memory_ctx.get("business_rules", [])
        interview_context = memory_ctx.get("interview_context", "")
        suggested_title = _strip_emojis(memory_ctx.get("suggested_title", project.name))

        # Generate semantic context
        semantic_parts = [
            f"# Contexto do Projeto: {suggested_title}",
            "",
            "## Stack Tecnológica",
        ]

        if stack_info.get("detected_stack"):
            semantic_parts.append(f"- **Stack**: {stack_info['detected_stack']}")
        if stack_info.get("languages"):
            langs = ", ".join(stack_info.get("languages", []))
            semantic_parts.append(f"- **Linguagens**: {langs}")

        if key_features:
            semantic_parts.extend(["", "## Funcionalidades Principais"])
            for i, feature in enumerate(key_features, 1):
                semantic_parts.append(f"- F{i}: {feature}")

        if business_rules:
            semantic_parts.extend(["", "## Regras de Negócio Identificadas"])
            for i, rule in enumerate(business_rules, 1):
                semantic_parts.append(f"- RN{i}: {rule}")

        if interview_context:
            semantic_parts.extend(["", "## Análise do Codebase", interview_context])

        context_semantic = _strip_emojis("\n".join(semantic_parts))

        # PROMPT #185 - Generate human-readable context with ALL sections (not just title)
        human_parts = [
            f"# {suggested_title}",
            "",
        ]

        if interview_context:
            human_parts.append(_strip_emojis(interview_context))
            human_parts.append("")

        if stack_info.get("detected_stack"):
            human_parts.extend(["## Stack Tecnológica", ""])
            human_parts.append(f"- Stack: {stack_info['detected_stack']}")
            if stack_info.get("languages"):
                langs = ", ".join(stack_info.get("languages", []))
                human_parts.append(f"- Linguagens: {langs}")
            human_parts.append("")

        if key_features:
            human_parts.extend(["## Funcionalidades Principais", ""])
            for feature in key_features:
                human_parts.append(f"- {feature}")
            human_parts.append("")

        if business_rules:
            human_parts.extend(["## Regras de Negocio", ""])
            for i, rule in enumerate(business_rules, 1):
                human_parts.append(f"{i}. {rule}")
            human_parts.append("")

        context_human = _strip_emojis("\n".join(human_parts))

        # Update project with auto-generated context
        project.context_semantic = context_semantic
        project.context_human = context_human
        project.description = context_human
        self.db.commit()

        return {
            "context_semantic": context_semantic,
            "context_human": context_human
        }

    async def _generate_suggested_epics_from_memory(self, project: Project) -> List[Dict]:
        """
        PROMPT #153 - Generate suggested epics from memory scan data.

        Uses AI to analyze the memory scan results and suggest new epics
        for functionality that doesn't exist yet in the codebase.

        Args:
            project: Project instance with initial_memory_context

        Returns:
            List of suggested epic dictionaries
        """
        memory_ctx = project.initial_memory_context
        if not memory_ctx:
            return []

        existing_features = memory_ctx.get("key_features", [])
        existing_rules = memory_ctx.get("business_rules", [])
        interview_context = memory_ctx.get("interview_context", "")
        stack_info = memory_ctx.get("stack_info", {})

        # Build the prompt
        system_prompt = """Você é um arquiteto de software especialista em decomposição de sistemas.

Sua tarefa é analisar o contexto de um projeto existente e sugerir épicos (módulos macro)
para NOVAS funcionalidades que podem ser desenvolvidas para MELHORAR o sistema.

REGRAS CRÍTICAS:
1. As funcionalidades listadas JÁ EXISTEM no código - NÃO sugira épicos para elas
2. Sugira APENAS épicos para funcionalidades NOVAS que agregariam valor
3. Foque em: integrações, automações, melhorias de UX, relatórios avançados, APIs
4. Sugira entre 5 e 15 épicos, priorizados por valor de negócio

FORMATO DE RESPOSTA (JSON):
```json
{
    "epics": [
        {
            "title": "Título do Épico",
            "description": "Descrição breve do módulo (1-2 frases)",
            "priority": "high|medium|low",
            "order": 1
        }
    ]
}
```

IMPORTANTE:
- Retorne APENAS o JSON, sem texto adicional
- Prioridades: high (essencial), medium (importante), low (nice-to-have)
- Ordene por prioridade e dependência lógica"""

        # Build user prompt with context
        user_parts = [
            "## Análise do Projeto",
            f"**Nome:** {project.name}",
            ""
        ]

        if stack_info.get("detected_stack"):
            user_parts.append(f"**Stack:** {stack_info['detected_stack']}")

        if interview_context:
            user_parts.extend(["", "## Descrição do Sistema", interview_context])

        if existing_features:
            user_parts.extend(["", "## Funcionalidades JÁ EXISTENTES (NÃO sugerir épicos para estas):"])
            for f in existing_features:
                user_parts.append(f"- [JA EXISTE] {f}")

        if existing_rules:
            user_parts.extend(["", "## Regras de Negócio JÁ IMPLEMENTADAS:"])
            for rule in existing_rules[:10]:
                user_parts.append(f"- {rule[:100]}...")

        user_parts.extend([
            "",
            "## Sua Tarefa",
            "Sugira épicos para NOVAS funcionalidades que MELHORARIAM este sistema.",
            "Lembre-se: as features listadas acima JÁ EXISTEM - foque em funcionalidades NOVAS."
        ])

        user_prompt = "\n".join(user_parts)

        try:
            response = await self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=3000,
                project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            )

            content = response.get("content", "")
            result = _robust_json_parse(content, "suggested_epics_from_memory")

            epics = result.get("epics", []) if result else []

            # Create epic records
            saved_epics = []
            for i, epic_data in enumerate(epics):
                title = epic_data.get("title", f"Épico {i+1}")
                description = epic_data.get("description", "")
                priority_str = epic_data.get("priority", "medium").lower()
                order = epic_data.get("order", i + 1)

                # Map priority string to enum
                priority_map = {
                    "critical": PriorityLevel.CRITICAL,
                    "high": PriorityLevel.HIGH,
                    "medium": PriorityLevel.MEDIUM,
                    "low": PriorityLevel.LOW
                }
                priority = priority_map.get(priority_str, PriorityLevel.MEDIUM)

                # Create task record
                epic = Task(
                    id=uuid4(),
                    project_id=project.id,
                    title=title,
                    description=description,
                    item_type=ItemType.EPIC,
                    status=TaskStatus.TODO,
                    priority=priority,
                    order=order + 100,  # After business rule cards
                    labels=["suggested"],  # Mark as suggested
                    workflow_state="draft",  # Draft state - not active
                    reporter="system",
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                self.db.add(epic)

                saved_epics.append({
                    "id": str(epic.id),
                    "title": title,
                    "description": description,
                    "priority": priority_str,
                    "order": order
                })

            self.db.commit()
            logger.info(f"✅ Created {len(saved_epics)} suggested epics for project {project.name}")

            return saved_epics

        except Exception as e:
            logger.error(f"❌ Error generating suggested epics from memory: {e}")
            return []

    # =========================================================================
    # PROMPT #155 - INCREMENTAL EPIC GENERATION
    # =========================================================================

    async def generate_epics_incrementally(
        self,
        project: Project,
        job_manager,
        job_id: UUID,
        max_batches: int = 4,
        epics_per_batch: int = 5
    ) -> Dict[str, Any]:
        """
        PROMPT #155 - Geração incremental de épicos.

        Gera épicos em lotes menores, salvando cada lote no banco
        e notificando o frontend via WebSocket após cada batch.

        Args:
            project: Project instance
            job_manager: JobManager instance for progress updates
            job_id: UUID of the current job
            max_batches: Maximum number of batches to generate (default: 4)
            epics_per_batch: Number of epics per batch (default: 5)

        Returns:
            Dict with success status, total_epics, batches_processed, and epics list
        """
        all_epics = []
        existing_titles = set()  # Evita duplicatas entre batches
        batches_processed = 0

        # Get memory context for prompt building
        memory_ctx = project.initial_memory_context or {}
        existing_features = memory_ctx.get("key_features", [])
        interview_context = memory_ctx.get("interview_context", "")
        stack_info = memory_ctx.get("stack_info", {})

        for batch_num in range(1, max_batches + 1):
            batches_processed = batch_num

            # Calculate and update progress
            progress = (batch_num / max_batches) * 90  # Max 90%, save 10% for finalization
            job_manager.update_progress(
                job_id,
                progress,
                f"Generating epics (batch {batch_num}/{max_batches})..."
            )

            # Generate batch of epics
            batch_epics = await self._generate_epic_batch(
                project=project,
                batch_number=batch_num,
                epics_per_batch=epics_per_batch,
                existing_titles=existing_titles,
                existing_features=existing_features,
                interview_context=interview_context,
                stack_info=stack_info
            )

            if not batch_epics:
                # AI indicated no more relevant epics
                logger.info(f"📋 Batch {batch_num}: No more epics to generate")
                break

            # Save epics to database immediately
            saved_epics = self._save_epic_batch(project, batch_epics)
            all_epics.extend(saved_epics)

            # Update set of existing titles to avoid duplicates
            for epic in batch_epics:
                existing_titles.add(epic.get("title", "").lower())

            # Broadcast to frontend (epics created in this batch)
            await self._broadcast_epic_batch(project.id, saved_epics, batch_num, max_batches)

            logger.info(f"✅ Batch {batch_num}: Generated {len(saved_epics)} epics")

        return {
            "success": True,
            "total_epics": len(all_epics),
            "batches_processed": batches_processed,
            "epics": all_epics
        }

    async def _generate_epic_batch(
        self,
        project: Project,
        batch_number: int,
        epics_per_batch: int,
        existing_titles: set,
        existing_features: List[str],
        interview_context: str,
        stack_info: Dict
    ) -> List[Dict]:
        """
        PROMPT #155 - Generate a batch of epics, excluding already generated titles.

        Args:
            project: Project instance
            batch_number: Current batch number (1-based)
            epics_per_batch: Number of epics to generate
            existing_titles: Set of lowercase titles already generated
            existing_features: List of features that already exist in code
            interview_context: AI analysis of the codebase
            stack_info: Stack detection info

        Returns:
            List of epic dictionaries or empty list if no more epics
        """
        # Build exclusion list from already generated epics
        exclude_list = "\n".join([f"- {t}" for t in existing_titles]) if existing_titles else "Nenhum ainda"

        # Build exclusion list from existing features (from memory scan)
        features_list = "\n".join([f"- [JA EXISTE] {f}" for f in existing_features]) if existing_features else "Nenhuma"

        system_prompt = f"""Você é um Product Owner especialista em decomposição de software.
Gere EXATAMENTE {epics_per_batch} épicos de software para o projeto.

## REGRAS CRÍTICAS:

1. Gere APENAS {epics_per_batch} épicos nesta resposta (nem mais, nem menos)
2. NÃO repita épicos já gerados em batches anteriores (lista abaixo)
3. NÃO sugira épicos para funcionalidades que JÁ EXISTEM no código
4. Se não houver mais {epics_per_batch} épicos RELEVANTES a sugerir, retorne lista vazia
5. Responda APENAS com JSON válido, sem texto adicional

## ÉPICOS JÁ GERADOS (NÃO REPETIR):
{exclude_list}

## FUNCIONALIDADES JÁ EXISTENTES NO CÓDIGO (NÃO CRIAR ÉPICOS PARA ESTAS):
{features_list}

## FORMATO DE RESPOSTA:
```json
{{
    "epics": [
        {{
            "title": "Título claro e conciso",
            "description": "Descrição breve do módulo (1-2 frases)",
            "priority": "high|medium|low"
        }}
    ],
    "has_more": true
}}
```

Se não houver mais épicos relevantes, retorne:
```json
{{"epics": [], "has_more": false}}
```

IMPORTANTE:
- Foque em: integrações, automações, melhorias de UX, relatórios, APIs, segurança
- Prioridades: high (essencial), medium (importante), low (nice-to-have)
- Seja específico e prático"""

        # Build user prompt
        user_parts = [f"## Projeto: {project.name}"]

        if stack_info.get("detected_stack"):
            user_parts.append(f"**Stack:** {stack_info['detected_stack']}")

        if interview_context:
            user_parts.extend(["", "## Descrição do Sistema:", interview_context[:2000]])  # Limit context size

        user_parts.extend([
            "",
            f"## Tarefa",
            f"Gere o lote {batch_number} de {epics_per_batch} épicos para NOVAS funcionalidades.",
            "Lembre-se: não repita épicos já gerados e não sugira funcionalidades existentes."
        ])

        user_prompt = "\n".join(user_parts)

        try:
            response = await self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=2000,  # Smaller since only 5 epics
                project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            )

            content = response.get("content", "")
            result = _robust_json_parse(content, f"epic_batch_{batch_number}")

            epics = result.get("epics", []) if result else []

            # Check if AI indicated no more epics
            has_more = result.get("has_more", True) if result else True
            if not has_more and not epics:
                return []

            return epics

        except Exception as e:
            logger.error(f"❌ Error generating epic batch {batch_number}: {e}")
            return []

    def _save_epic_batch(self, project: Project, epics: List[Dict]) -> List[Dict]:
        """
        PROMPT #155 - Save a batch of epics to the database as drafts.

        Args:
            project: Project instance
            epics: List of epic dictionaries from AI

        Returns:
            List of saved epic dictionaries with IDs
        """
        saved = []
        base_order = 100  # Start after business rule cards

        for i, epic_data in enumerate(epics):
            # PROMPT #175 - Validate batch epic fields
            title = (epic_data.get("title") or f"Untitled Epic").strip()[:255]
            if not title or title == "Untitled Epic":
                title = f"Epic {i + 1} - {project.name}"
                logger.warning(f"  Batch epic has empty/default title, using fallback: {title}")
            description = (epic_data.get("description") or "")
            priority_str = (epic_data.get("priority") or "medium").lower()

            # Map priority string to enum
            priority_map = {
                "critical": PriorityLevel.CRITICAL,
                "high": PriorityLevel.HIGH,
                "medium": PriorityLevel.MEDIUM,
                "low": PriorityLevel.LOW
            }
            priority = priority_map.get(priority_str, PriorityLevel.MEDIUM)

            task = Task(
                id=uuid4(),
                project_id=project.id,
                title=title,
                description=description,
                item_type=ItemType.EPIC,
                status=TaskStatus.TODO,
                priority=priority,
                order=base_order + i,
                labels=["suggested"],
                workflow_state="draft",
                reporter="system",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            self.db.add(task)

            saved.append({
                "id": str(task.id),
                "title": task.title,
                "description": task.description,
                "priority": priority_str,
                "item_type": "epic",
                "workflow_state": "draft",
                "labels": ["suggested"]
            })

        self.db.commit()
        return saved

    async def _broadcast_epic_batch(
        self,
        project_id: UUID,
        epics: List[Dict],
        batch_num: int,
        total_batches: int
    ):
        """
        PROMPT #155 - Broadcast newly created epics to frontend via WebSocket.

        Args:
            project_id: UUID of the project
            epics: List of saved epic dictionaries
            batch_num: Current batch number
            total_batches: Total number of batches
        """
        try:
            from app.api.websocket import broadcast_job_event

            await broadcast_job_event("epics_batch_created", {
                "project_id": str(project_id),
                "batch_number": batch_num,
                "total_batches": total_batches,
                "epics_count": len(epics),
                "epics": epics
            })

            logger.debug(f"📡 Broadcast epic batch {batch_num}: {len(epics)} epics")

        except Exception as e:
            logger.warning(f"⚠️ Failed to broadcast epic batch: {e}")

    async def generate_rich_context_from_memory(
        self,
        project_id: UUID,
        progress_callback=None,
        ai_timeout: int = 120
    ) -> Dict:
        """
        PROMPT #121 - Generate rich project context from memory scan data using AI.

        Makes 3 focused AI calls (architecture, business domain, features) then
        consolidates into context_semantic + context_human via a 4th AI call.

        PROMPT #240 - Each AI call has a timeout (default 120s) to prevent hanging.

        Args:
            project_id: Project UUID
            progress_callback: Optional async function(percent, message) for progress updates

        Returns:
            Dict with context_semantic, context_human, description
        """
        from app.prompts.loader import PromptLoader

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        memory_ctx = project.initial_memory_context
        if not memory_ctx:
            raise ValueError(f"No memory context for project {project_id}")

        loader = PromptLoader()

        stack_info = memory_ctx.get("stack_info", {})
        key_features = memory_ctx.get("key_features", [])
        business_rules = memory_ctx.get("business_rules", [])
        interview_context = memory_ctx.get("interview_context", "")
        scan_summary = memory_ctx.get("scan_summary", interview_context)

        # Format stack_info as text
        stack_text_parts = []
        if stack_info.get("detected_stack"):
            stack_text_parts.append(f"Stack: {stack_info['detected_stack']}")
        if stack_info.get("languages"):
            stack_text_parts.append(f"Linguagens: {', '.join(stack_info['languages'])}")
        if stack_info.get("frameworks"):
            stack_text_parts.append(f"Frameworks: {', '.join(stack_info['frameworks'])}")
        if stack_info.get("databases"):
            stack_text_parts.append(f"Bancos de Dados: {', '.join(stack_info['databases'])}")
        stack_text = "\n".join(stack_text_parts) if stack_text_parts else "Nao detectada"

        async def report_progress(percent, message):
            if progress_callback:
                await progress_callback(percent, message)

        # --- Step 1: Architecture Analysis (40-55%) ---
        await report_progress(40, "Analyzing architecture...")
        architecture_analysis = ""
        try:
            sys_prompt, usr_prompt = loader.render(
                "context/rich_context_architecture",
                {
                    "project_name": project.name,
                    "stack_info": stack_text,
                    "scan_summary": scan_summary or "Resumo nao disponivel"
                }
            )
            response = await asyncio.wait_for(
                self.orchestrator.execute(
                    usage_type="memory",
                    messages=[{"role": "user", "content": usr_prompt}],
                    system_prompt=sys_prompt,
                    max_tokens=4000,
                    enable_rag=True,
                    project_id=str(project.id)
                ),
                timeout=ai_timeout
            )
            architecture_analysis = response.get("content", "")
            logger.info(f"Architecture analysis complete for {project.name}")
        except asyncio.TimeoutError:
            logger.warning(f"Architecture analysis timed out after {ai_timeout}s for {project.name}")
            architecture_analysis = "Analise arquitetural indisponivel: timeout"
        except Exception as e:
            logger.error(f"Architecture analysis failed: {e}")
            architecture_analysis = f"Analise arquitetural indisponivel: {str(e)}"

        # --- Step 2: Business Domain Analysis (55-70%) ---
        await report_progress(55, "Analyzing business domain...")
        business_domain_analysis = ""
        if business_rules:
            try:
                sys_prompt, usr_prompt = loader.render(
                    "context/rich_context_business_domain",
                    {
                        "project_name": project.name,
                        "business_rules": business_rules,
                        "key_features": key_features
                    }
                )
                response = await asyncio.wait_for(
                    self.orchestrator.execute(
                        usage_type="memory",
                        messages=[{"role": "user", "content": usr_prompt}],
                        system_prompt=sys_prompt,
                        max_tokens=4000,
                        enable_rag=True,
                        project_id=str(project.id)
                    ),
                    timeout=ai_timeout
                )
                business_domain_analysis = response.get("content", "")
                logger.info(f"Business domain analysis complete for {project.name}")
            except asyncio.TimeoutError:
                logger.warning(f"Business domain analysis timed out after {ai_timeout}s for {project.name}")
                business_domain_analysis = "Analise de dominio indisponivel: timeout"
            except Exception as e:
                logger.error(f"Business domain analysis failed: {e}")
                business_domain_analysis = f"Analise de dominio indisponivel: {str(e)}"
        else:
            business_domain_analysis = "Nenhuma regra de negocio detectada no codebase."

        # --- Step 3: Feature Landscape (70-85%) ---
        await report_progress(70, "Mapeando funcionalidades...")
        feature_landscape = ""
        if key_features:
            try:
                sys_prompt, usr_prompt = loader.render(
                    "context/rich_context_features",
                    {
                        "project_name": project.name,
                        "key_features": key_features,
                        "business_rules": business_rules,
                        "interview_context": interview_context
                    }
                )
                response = await asyncio.wait_for(
                    self.orchestrator.execute(
                        usage_type="memory",
                        messages=[{"role": "user", "content": usr_prompt}],
                        system_prompt=sys_prompt,
                        max_tokens=4000,
                        enable_rag=True,
                        project_id=str(project.id)
                    ),
                    timeout=ai_timeout
                )
                feature_landscape = response.get("content", "")
                logger.info(f"Feature landscape complete for {project.name}")
            except asyncio.TimeoutError:
                logger.warning(f"Feature landscape timed out after {ai_timeout}s for {project.name}")
                feature_landscape = "Mapa de funcionalidades indisponivel: timeout"
            except Exception as e:
                logger.error(f"Feature landscape failed: {e}")
                feature_landscape = f"Mapa de funcionalidades indisponivel: {str(e)}"
        else:
            feature_landscape = "Nenhuma funcionalidade detectada no codebase."

        # --- Step 4: Consolidation (85-95%) ---
        await report_progress(85, "Consolidating context...")
        try:
            sys_prompt, usr_prompt = loader.render(
                "context/rich_context_consolidation",
                {
                    "project_name": project.name,
                    "architecture_analysis": architecture_analysis,
                    "business_domain_analysis": business_domain_analysis,
                    "feature_landscape": feature_landscape
                }
            )
            response = await asyncio.wait_for(
                self.orchestrator.execute(
                    usage_type="memory",
                    messages=[{"role": "user", "content": usr_prompt}],
                    system_prompt=sys_prompt,
                    max_tokens=8000,
                    enable_rag=True,
                    project_id=str(project.id)
                ),
                timeout=ai_timeout * 2  # Consolidation gets double timeout (larger output)
            )

            content = response.get("content", "")

            # Parse JSON response
            # PROMPT #192 - Robust JSON parsing for AI responses with unescaped newlines
            import json
            context_semantic = ""
            context_human = ""
            try:
                # Try to extract JSON from the response
                json_start = content.find("{")
                json_end = content.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    json_str = content[json_start:json_end]
                    try:
                        parsed = json.loads(json_str)
                    except json.JSONDecodeError:
                        # AI often returns JSON with unescaped newlines inside string values
                        # Fix by escaping newlines within JSON string values
                        import re
                        # Extract values using regex for each known key
                        sem_match = re.search(r'"context_semantic"\s*:\s*"(.*?)"(?:\s*,\s*"context_human")', json_str, re.DOTALL)
                        hum_match = re.search(r'"context_human"\s*:\s*"(.*?)"(?:\s*[,}])\s*$', json_str, re.DOTALL)
                        if sem_match and hum_match:
                            context_semantic = sem_match.group(1).replace('\\n', '\n')
                            context_human = hum_match.group(1).replace('\\n', '\n')
                            parsed = None  # Skip the parsed.get below
                        else:
                            # Last resort: try to fix newlines by replacing them in string values
                            fixed = re.sub(r'(?<=": ")(.*?)(?="[,}])', lambda m: m.group(0).replace('\n', '\\n'), json_str, flags=re.DOTALL)
                            parsed = json.loads(fixed)
                    if parsed is not None:
                        context_semantic = parsed.get("context_semantic", "")
                        context_human = parsed.get("context_human", "")
            except (json.JSONDecodeError, Exception) as e:
                logger.warning(f"Could not parse consolidation JSON: {e}, using raw content")
                context_semantic = content
                context_human = content

            if not context_semantic:
                context_semantic = content
            if not context_human:
                context_human = content

        except asyncio.TimeoutError:
            logger.warning(f"Consolidation timed out after {ai_timeout * 2}s for {project.name}, using direct combination")
            context_semantic = f"# {project.name}\n\n{architecture_analysis}\n\n{business_domain_analysis}\n\n{feature_landscape}"
            context_human = context_semantic
        except Exception as e:
            logger.error(f"Consolidation failed: {e}")
            # Fallback: combine the 3 analyses directly
            context_semantic = f"# {project.name}\n\n{architecture_analysis}\n\n{business_domain_analysis}\n\n{feature_landscape}"
            context_human = context_semantic

        # --- Save to project ---
        project.context_semantic = context_semantic
        project.context_human = context_human
        # PROMPT #277 - Validate before saving as description
        # Reject hallucinated content that doesn't match expected structure
        expected_sections = ["visao geral", "stack", "arquitetura", "regras", "features", "dominio", "funcionalidade"]
        ctx_lower = (context_human or "").lower()
        if any(s in ctx_lower for s in expected_sections):
            project.description = context_human
        else:
            logger.warning(f"Rich context rejected as description for {project.name}: no valid sections found")
        self.db.commit()

        # --- Store in RAG ---
        try:
            rag_service = RAGService(self.db)
            rag_service.store_project_context(
                project_id=project.id,
                context_semantic=context_semantic,
                context_human=context_human
            )
            logger.info(f"Rich context stored in RAG for {project.name}")
        except Exception as e:
            logger.error(f"Failed to store rich context in RAG: {e}")

        await report_progress(95, "Contexto gerado com sucesso")

        logger.info(f"Rich context generation complete for {project.name}")

        return {
            "context_semantic": context_semantic,
            "context_human": context_human,
            "description": context_human
        }
