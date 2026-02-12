"""
Prompt Structure Normalizer - PROMPT #232

Ensures every prompt_generation call follows a consistent 4-section structure:
  [SYSTEM] - Role and methodology instructions
  [TASK] - What to generate
  [CONTEXT] - Parent context + RAG + business rules (deduped)
  [OUTPUT SCHEMA] - Expected JSON format

Works WITH the existing PromptLoader (YAML templates), not against it.
The normalizer wraps the assembled prompt, it doesn't replace the templates.
"""

import re
import logging
from typing import Tuple

logger = logging.getLogger(__name__)

# Regex to find JSON schema blocks in system prompts
_JSON_SCHEMA_PATTERN = re.compile(
    r'(?:```json\s*\n(.*?)\n\s*```|'           # Fenced code block
    r'(?:Retorne|Return|Responda|Output).*?JSON.*?:\s*\n(\{.*?\n\}))',  # Inline JSON after instruction
    re.DOTALL | re.IGNORECASE
)


class PromptStructureNormalizer:
    """
    Formats prompts into a consistent 4-section structure for
    optimal AI comprehension and reduced ambiguity.
    """

    @staticmethod
    def normalize(
        system_prompt: str,
        task_instructions: str,
        context: "CompressedContext",
        output_schema: str = "",
    ) -> Tuple[str, str]:
        """
        Build normalized system_prompt and user_prompt.

        Returns:
            (normalized_system_prompt, normalized_user_prompt)
        """
        # Build system prompt with [SYSTEM] + [OUTPUT SCHEMA]
        sys_parts = [f"[SYSTEM]\n{system_prompt}"]
        if output_schema:
            sys_parts.append(f"[OUTPUT SCHEMA]\n{output_schema}")
        normalized_system = "\n\n".join(sys_parts)

        # Build user prompt with [TASK] + [CONTEXT]
        user_parts = [f"[TASK]\n{task_instructions}"]

        context_sections = []
        if context.parent_context:
            context_sections.append(context.parent_context)
        if context.semantic_map_text:
            context_sections.append(context.semantic_map_text)
        if context.business_rules:
            context_sections.append(context.business_rules)
        if context.conversation_summary:
            context_sections.append(context.conversation_summary)

        if context_sections:
            user_parts.append("[CONTEXT]\n" + "\n\n".join(context_sections))

        normalized_user = "\n\n".join(user_parts)

        logger.info(
            f"📐 Normalized prompt: system={len(normalized_system)} chars, "
            f"user={len(normalized_user)} chars, "
            f"context_sections={len(context_sections)}"
        )

        return normalized_system, normalized_user

    @staticmethod
    def extract_output_schema(system_prompt: str) -> Tuple[str, str]:
        """
        Extract JSON schema examples from existing system prompts.
        Many current prompts embed the expected JSON inline.

        Returns:
            (system_prompt_without_schema, extracted_schema)
        """
        match = _JSON_SCHEMA_PATTERN.search(system_prompt)
        if not match:
            return system_prompt, ""

        schema = match.group(1) or match.group(2) or ""
        schema = schema.strip()

        if not schema or len(schema) < 10:
            return system_prompt, ""

        # Remove the schema block from the system prompt
        cleaned = system_prompt[:match.start()] + system_prompt[match.end():]
        # Clean up double newlines left by removal
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()

        logger.info(f"📐 Extracted output schema: {len(schema)} chars from system prompt")
        return cleaned, schema
