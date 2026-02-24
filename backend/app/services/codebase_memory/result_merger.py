"""
Result Merger Mixin for CodebaseMemoryService

Contains methods for merging phase results, parsing phase responses,
scoring confidence, reranking samples, and title validation/generation.

PROMPT #163 - Multi-phase analysis result consolidation
PROMPT #165 - Title validation and fallback generation
PROMPT #230 - Confidence scoring and sample reranking
"""

import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)


class ResultMergerMixin:
    """Mixin providing result merging, parsing, scoring, and title logic."""

    def _parse_phase_response(self, content: str) -> Dict:
        """
        Parse JSON response from a phase analysis.

        PROMPT #230 - Uses _try_parse_json from PROMPT #229 for robust
        4-strategy autocorrection instead of ad-hoc parsing.
        """
        from app.services.utility_node_executor import UtilityNodeExecutor

        default = {
            "partial_title": "",
            "business_rules_found": [],
            "features_found": [],
            "entities_found": [],
            "insights": ""
        }

        if not content or not content.strip():
            return default

        parsed = UtilityNodeExecutor._try_parse_json(content.strip(), auto_repair=True)
        if parsed and isinstance(parsed, dict):
            return parsed

        logger.warning(f"Failed to parse phase response even with autocorrection")
        return default

    def _score_phase_confidence(self, result: Dict) -> int:
        """
        PROMPT #230 - Score the quality of a phase analysis result.

        Returns 0-100 confidence score. Used to decide if a larger model
        should be used for re-analysis.
        """
        score = 0
        if result.get("partial_title"):
            score += 20
        rules = result.get("business_rules_found", [])
        if len(rules) >= 3:
            score += 30
        elif len(rules) >= 1:
            score += 15
        features = result.get("features_found", [])
        if len(features) >= 3:
            score += 20
        elif len(features) >= 1:
            score += 10
        if result.get("entities_found"):
            score += 15
        if result.get("insights") and len(result.get("insights", "")) > 20:
            score += 15
        return score

    def _rerank_samples_for_phase(self, samples: List[Dict], phase_name: str) -> List[Dict]:
        """
        PROMPT #230 - Rerank code samples by relevance to the current phase.

        Uses symbol extraction keywords for fast local reranking (no AI).
        """
        phase_keywords = {
            "documentation": {"readme", "config", "package", "composer", "setup", "install", "docker"},
            "domain": {"model", "entity", "migration", "schema", "domain", "table", "column", "relationship"},
            "logic": {"service", "controller", "handler", "usecase", "validator", "middleware", "policy", "guard"},
            "quick_scan": set(),  # No reranking for quick scan
        }
        keywords = phase_keywords.get(phase_name, set())
        if not keywords:
            return samples

        def phase_score(sample: Dict) -> float:
            filename = sample.get("filename", "").lower()
            content = sample.get("content", "").lower()[:2000]
            score = 0.0
            for kw in keywords:
                if kw in filename:
                    score += 3.0
                if kw in content:
                    score += 1.0
            return score

        return sorted(samples, key=phase_score, reverse=True)

    def _merge_phase_results(self, all_phases: Dict, stack_info: Dict) -> Dict:
        """Merge results from all phases without AI consolidation (fallback)."""
        all_rules = []
        all_features = []
        all_entities = []
        best_title = ""

        for phase_name, phase_data in all_phases.items():
            if isinstance(phase_data, dict):
                all_rules.extend(phase_data.get("business_rules_found", []))
                all_features.extend(phase_data.get("features_found", []))
                all_entities.extend(phase_data.get("entities_found", []))
                if phase_data.get("partial_title") and not best_title:
                    best_title = phase_data.get("partial_title")

        # Deduplicate
        all_rules = list(dict.fromkeys(all_rules))
        all_features = list(dict.fromkeys(all_features))
        all_entities = list(dict.fromkeys(all_entities))

        # PROMPT #165 - Validate and improve title
        final_title = self._validate_title(best_title, self.current_folder_name, stack_info) if best_title else self._generate_fallback_title(stack_info, self.current_folder_name)

        # PROMPT #266 - Increased limits to avoid losing extracted data
        return {
            "suggested_title": final_title,
            "business_rules": all_rules[:200],
            "key_features": all_features[:50],
            "entities": all_entities[:50],
            "interview_context": f"Este projeto foi analisado em múltiplas fases. Foram encontradas {len(all_rules)} regras de negócio e {len(all_features)} funcionalidades."
        }

    def _validate_title(self, title: str, folder_name: str, stack_info: Dict) -> str:
        """
        PROMPT #165 - Validate title to avoid generic fallbacks.
        PROMPT #169 - Improved validation to reject "Sistema de X" patterns.

        Ensures title is:
        - At least 4 words long (more descriptive)
        - Not just folder name or technology name
        - Not generic "Sistema de X" pattern
        - Descriptive of the system's purpose
        """
        if not title:
            return self._generate_fallback_title(stack_info, folder_name)

        # Clean the title
        title = title.strip()

        # Check if too short (less than 4 words for better descriptions)
        words = title.split()
        if len(words) < 4:
            logger.warning(f"⚠️ Title too short ({len(words)} words): '{title}'")
            # Try to expand with stack info
            stack = stack_info.get("detected_stack", "")
            if stack and len(words) >= 2:
                return f"{title} - Aplicação {stack.title()}"
            return self._generate_fallback_title(stack_info, folder_name)

        # Check if it's just the folder name
        clean_folder = folder_name.replace("-", " ").replace("_", " ").lower()
        if title.lower() == f"sistema {clean_folder}" or title.lower() == f"sistema de {clean_folder}":
            logger.warning(f"⚠️ Title is just folder name: '{title}'")
            # This is too generic - try to add context from stack
            stack = stack_info.get("detected_stack", "")
            if stack:
                return f"{title} - Aplicação {stack.title()}"
            return title

        # Check for generic "Sistema de X" patterns (only 3 words)
        title_lower = title.lower()
        if title_lower.startswith("sistema de ") and len(words) <= 3:
            logger.warning(f"⚠️ Title is generic 'Sistema de X': '{title}'")
            stack = stack_info.get("detected_stack", "")
            if stack:
                return f"{title} - Aplicação {stack.title()}"
            return title

        # Check for generic patterns
        generic_patterns = [
            "sistema sistema", "projeto projeto",
            "laravel project", "php application",
            "react app", "node project"
        ]
        if title_lower in generic_patterns:
            return self._generate_fallback_title(stack_info, folder_name)

        return title

    def _generate_fallback_title(self, stack_info: Dict, folder_name: str = "") -> str:
        """
        Generate fallback title based on folder name and stack detection.

        PROMPT #118 FIX - Prioritize folder name over stack name.
        PROMPT #165 - Improved to generate more descriptive titles.
        """
        # PROMPT #118 FIX - Use folder name as primary source
        if folder_name and folder_name not in {"src", "app", "project", "code", "backend", "frontend"}:
            # Clean up folder name: my-project -> My Project
            clean_name = folder_name.replace("-", " ").replace("_", " ").title()

            # PROMPT #165 - Try to make title more descriptive based on stack
            stack = stack_info.get("detected_stack", "")
            if stack:
                stack_clean = stack.replace("_", " ").title()
                # Avoid redundancy like "Sistema Contas - Aplicação Contas"
                if stack_clean.lower() not in clean_name.lower():
                    return f"Sistema {clean_name} - Aplicação {stack_clean}"

            return f"Sistema de Gestão {clean_name}"

        stack = stack_info.get("detected_stack", "")
        if stack:
            return f"Sistema {stack.replace('_', ' ').title()}"

        return "Software Project"
