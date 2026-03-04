"""
Content formatting and validation mixin.

Shared formatting methods used by all activator mixins:
- _validate_and_restructure_content: Validates and restructures AI-generated content
- _validate_context_content: Validates context generation output

Extracted from card_activator.py during modularization.
"""

from typing import Dict, List, Optional, Any
import logging
import re

from app.models.project import Project
from .utils import (
    _strip_emojis,
    _dict_to_markdown_context,
)

logger = logging.getLogger(__name__)


class ContentFormatterMixin:
    """Mixin providing content validation and formatting methods."""

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
        Type-aware defaults based on item_type (epic/story/task).

        Required contract:
        - description: non-empty string (human-readable)
        - generated_prompt: non-empty string (semantic markdown for AI)
        - acceptance_criteria: list with at least 1 item
        - story_points: integer > 0
        """
        # PROMPT #175 - Type-aware defaults
        ITEM_DEFAULTS = {
            "epic":    {"min_description": 50, "min_prompt": 50, "default_story_points": 13},
            "story":   {"min_description": 50, "min_prompt": 50, "default_story_points": 8},
            "task":    {"min_description": 30, "min_prompt": 30, "default_story_points": 3},
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
                }
                acceptance_criteria = fallback_criteria.get(item_type, fallback_criteria["epic"])
                logger.info(f"  Restructured: fallback acceptance_criteria generated for {item_type}")

        # --- Validate story_points ---
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
                    f"Informações insuficientes da entrevista para gerar contexto detalhado.\n\n"
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
