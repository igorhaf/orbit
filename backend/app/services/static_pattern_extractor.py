"""
PROMPT #234 - Static Pattern Extractor
Zero-AI-call pattern detection using symbol_extractor data.
Detects recurring code patterns across file groups by analyzing
imports, class hierarchies, function signatures, decorators, and naming conventions.
"""

import re
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from collections import Counter

from app.services.symbol_extractor import extract_symbols

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

HIGH_CONFIDENCE_THRESHOLD = 0.75
MIN_SHARED_RATIO = 0.6  # 60% of files must share a trait

# Category specificity bonus
SPECIFIC_CATEGORIES = {"controller", "model", "service", "component", "api", "test"}

# Max file content to read per file
MAX_FILE_CHARS = 8000


@dataclass
class StaticPattern:
    """Pattern detected purely from static code analysis."""
    group_key: str
    pattern_type: str
    title: str
    description: str
    template_content: str
    language: str
    confidence_score: float
    evidence: List[str] = field(default_factory=list)
    occurrences: int = 0
    key_characteristics: List[str] = field(default_factory=list)
    detection_method: str = "static_analysis"
    is_high_confidence: bool = False


class StaticPatternExtractor:
    """
    Zero-AI-call pattern extractor using symbol analysis.
    Reuses symbol_extractor.extract_symbols() from PROMPT #230.
    """

    def __init__(self):
        self.last_symbols_by_file: Dict[str, Dict] = {}

    def extract_patterns(
        self,
        project_path: Path,
        file_groups: Dict,
        max_samples: int = 10,
    ) -> List[StaticPattern]:
        """
        Main entry. For each file group, sample files, extract symbols,
        and detect recurring patterns. Caches symbols_by_file for later stages.
        """
        all_patterns: List[StaticPattern] = []
        self.last_symbols_by_file = {}

        for group_key, file_group in file_groups.items():
            file_paths = file_group.file_paths if hasattr(file_group, "file_paths") else file_group.get("file_paths", [])
            if len(file_paths) < 3:
                continue

            group_patterns = self._extract_group_patterns(
                project_path, group_key, file_group, max_samples
            )
            all_patterns.extend(group_patterns)

        logger.info(
            f"Static extraction: {len(all_patterns)} patterns from "
            f"{len(file_groups)} groups, {len(self.last_symbols_by_file)} files analyzed"
        )
        return all_patterns

    def _extract_group_patterns(
        self,
        project_path: Path,
        group_key: str,
        file_group,
        max_samples: int = 10,
    ) -> List[StaticPattern]:
        """Analyze a single file group for patterns."""
        file_paths = file_group.file_paths if hasattr(file_group, "file_paths") else file_group.get("file_paths", [])
        extension = file_group.extension if hasattr(file_group, "extension") else file_group.get("extension", "")
        estimated_category = file_group.estimated_category if hasattr(file_group, "estimated_category") else file_group.get("estimated_category", "general")

        # Sample files evenly
        step = max(1, len(file_paths) // max_samples)
        sampled = file_paths[::step][:max_samples]

        # Extract symbols for each file
        symbols_list: List[Dict] = []
        for fpath in sampled:
            full_path = project_path / fpath if not Path(fpath).is_absolute() else Path(fpath)
            try:
                content = full_path.read_text(encoding="utf-8", errors="replace")[:MAX_FILE_CHARS]
                symbols = extract_symbols(str(fpath), content)
                symbols_list.append(symbols)
                self.last_symbols_by_file[str(fpath)] = symbols
            except Exception as e:
                logger.debug(f"Skip {fpath}: {e}")
                continue

        if len(symbols_list) < 2:
            return []

        language = symbols_list[0].get("language", extension.lstrip("."))
        group_size = len(file_paths)
        is_specific = estimated_category in SPECIFIC_CATEGORIES

        patterns: List[StaticPattern] = []

        # Run detectors
        for detector in (
            self._detect_import_patterns,
            self._detect_class_hierarchy,
            self._detect_function_signatures,
            self._detect_decorator_patterns,
            self._detect_naming_conventions,
        ):
            p = detector(symbols_list, group_key, language, group_size, is_specific)
            if p:
                patterns.append(p)

        return patterns

    # ------------------------------------------------------------------
    # Detectors
    # ------------------------------------------------------------------

    def _detect_import_patterns(
        self, symbols_list: List[Dict], group_key: str,
        language: str, group_size: int, is_specific: bool,
    ) -> Optional[StaticPattern]:
        """Detect if files share common imports."""
        import_sets = [set(s.get("imports", [])) for s in symbols_list]
        if not any(import_sets):
            return None

        shared = _calculate_shared_items(import_sets, MIN_SHARED_RATIO)
        if not shared:
            return None

        top_imports = [imp for imp, _ in sorted(shared.items(), key=lambda x: -x[1])[:8]]
        avg_ratio = sum(shared.values()) / len(shared)

        confidence = self._score_confidence(avg_ratio, 1, group_size, is_specific)

        template_lines = [f"import {{{imp.split('.')[-1]}}}" for imp in top_imports[:5]]
        template = "\n".join(template_lines) + "\n\n// ... pattern body"

        return StaticPattern(
            group_key=group_key,
            pattern_type="import_pattern",
            title=f"Shared imports in {group_key}",
            description=f"{len(top_imports)} imports shared by >60% of files: {', '.join(top_imports[:5])}",
            template_content=template,
            language=language,
            confidence_score=confidence,
            evidence=[f"Import '{imp}' in {shared[imp]*100:.0f}% of files" for imp in top_imports[:5]],
            occurrences=group_size,
            key_characteristics=[f"common import: {imp}" for imp in top_imports[:5]],
            detection_method="static_analysis",
            is_high_confidence=confidence >= HIGH_CONFIDENCE_THRESHOLD,
        )

    def _detect_class_hierarchy(
        self, symbols_list: List[Dict], group_key: str,
        language: str, group_size: int, is_specific: bool,
    ) -> Optional[StaticPattern]:
        """Detect if files share class structure."""
        class_lists = [s.get("classes", []) for s in symbols_list]
        files_with_one_class = sum(1 for cl in class_lists if len(cl) == 1)
        ratio_one_class = files_with_one_class / len(symbols_list) if symbols_list else 0

        if ratio_one_class < MIN_SHARED_RATIO:
            return None

        # Check for common suffix/prefix in class names
        all_classes = [cl[0] for cl in class_lists if len(cl) == 1]
        suffixes = Counter()
        for name in all_classes:
            # Extract suffix (e.g., Controller, Service, Model)
            parts = re.findall(r"[A-Z][a-z]+", name)
            if len(parts) >= 2:
                suffixes[parts[-1]] += 1

        common_suffix = ""
        if suffixes:
            top_suffix, top_count = suffixes.most_common(1)[0]
            if top_count / len(all_classes) >= MIN_SHARED_RATIO:
                common_suffix = top_suffix

        confidence = self._score_confidence(
            ratio_one_class, 2 if common_suffix else 1, group_size, is_specific
        )

        desc = f"{files_with_one_class}/{len(symbols_list)} files have single class"
        if common_suffix:
            desc += f", most ending in '{common_suffix}'"

        template = f"class {{EntityName}}{common_suffix} {{\n    // methods\n}}"

        return StaticPattern(
            group_key=group_key,
            pattern_type="class_hierarchy",
            title=f"Class pattern in {group_key}" + (f" (*{common_suffix})" if common_suffix else ""),
            description=desc,
            template_content=template,
            language=language,
            confidence_score=confidence,
            evidence=[f"Single class per file: {ratio_one_class*100:.0f}%"]
                + ([f"Common suffix: {common_suffix}"] if common_suffix else []),
            occurrences=group_size,
            key_characteristics=["one-class-per-file"] + ([f"suffix:{common_suffix}"] if common_suffix else []),
            detection_method="static_analysis",
            is_high_confidence=confidence >= HIGH_CONFIDENCE_THRESHOLD,
        )

    def _detect_function_signatures(
        self, symbols_list: List[Dict], group_key: str,
        language: str, group_size: int, is_specific: bool,
    ) -> Optional[StaticPattern]:
        """Detect recurring function names across files."""
        func_sets = []
        for s in symbols_list:
            funcs = s.get("functions", [])
            names = set()
            for f in funcs:
                name = f["name"] if isinstance(f, dict) else str(f)
                names.add(name)
            func_sets.append(names)

        if not any(func_sets):
            return None

        shared = _calculate_shared_items(func_sets, MIN_SHARED_RATIO)
        if not shared:
            return None

        top_funcs = [fn for fn, _ in sorted(shared.items(), key=lambda x: -x[1])[:10]]
        avg_ratio = sum(shared.values()) / len(shared)

        complexity = min(len(top_funcs) / 3.0, 1.0)  # More shared funcs = higher complexity
        confidence = self._score_confidence(avg_ratio, 1 + complexity, group_size, is_specific)

        template_lines = [f"    def {fn}(self, ...):" for fn in top_funcs[:6]]
        template = "class {ClassName}:\n" + "\n".join(template_lines)

        return StaticPattern(
            group_key=group_key,
            pattern_type="function_signature",
            title=f"Shared functions in {group_key}",
            description=f"{len(top_funcs)} functions shared by >60% of files: {', '.join(top_funcs[:6])}",
            template_content=template,
            language=language,
            confidence_score=confidence,
            evidence=[f"Function '{fn}' in {shared[fn]*100:.0f}% of files" for fn in top_funcs[:5]],
            occurrences=group_size,
            key_characteristics=[f"common function: {fn}" for fn in top_funcs[:6]],
            detection_method="static_analysis",
            is_high_confidence=confidence >= HIGH_CONFIDENCE_THRESHOLD,
        )

    def _detect_decorator_patterns(
        self, symbols_list: List[Dict], group_key: str,
        language: str, group_size: int, is_specific: bool,
    ) -> Optional[StaticPattern]:
        """Detect recurring decorators/annotations across files."""
        dec_sets = [set(s.get("decorators", [])) for s in symbols_list]
        if not any(dec_sets):
            return None

        shared = _calculate_shared_items(dec_sets, MIN_SHARED_RATIO)
        if not shared:
            return None

        top_decs = [d for d, _ in sorted(shared.items(), key=lambda x: -x[1])[:6]]
        avg_ratio = sum(shared.values()) / len(shared)

        confidence = self._score_confidence(avg_ratio, 1, group_size, is_specific)

        template_lines = [f"@{d}" for d in top_decs[:4]]
        template = "\n".join(template_lines) + "\ndef {method_name}(...):"

        return StaticPattern(
            group_key=group_key,
            pattern_type="decorator_pattern",
            title=f"Shared decorators in {group_key}",
            description=f"{len(top_decs)} decorators shared by >60% of files: {', '.join(top_decs[:4])}",
            template_content=template,
            language=language,
            confidence_score=confidence,
            evidence=[f"Decorator '@{d}' in {shared[d]*100:.0f}% of files" for d in top_decs[:4]],
            occurrences=group_size,
            key_characteristics=[f"common decorator: @{d}" for d in top_decs[:4]],
            detection_method="static_analysis",
            is_high_confidence=confidence >= HIGH_CONFIDENCE_THRESHOLD,
        )

    def _detect_naming_conventions(
        self, symbols_list: List[Dict], group_key: str,
        language: str, group_size: int, is_specific: bool,
    ) -> Optional[StaticPattern]:
        """Detect naming convention patterns."""
        class_cases = Counter()
        func_cases = Counter()

        for s in symbols_list:
            for cls in s.get("classes", []):
                class_cases[_detect_case(cls)] += 1
            for f in s.get("functions", []):
                name = f["name"] if isinstance(f, dict) else str(f)
                func_cases[_detect_case(name)] += 1

        if not class_cases and not func_cases:
            return None

        characteristics = []
        total_classes = sum(class_cases.values())
        total_funcs = sum(func_cases.values())

        dominant_class_case = ""
        if total_classes > 0:
            top_case, top_count = class_cases.most_common(1)[0]
            if top_count / total_classes >= MIN_SHARED_RATIO:
                dominant_class_case = top_case
                characteristics.append(f"classes: {top_case}")

        dominant_func_case = ""
        if total_funcs > 0:
            top_case, top_count = func_cases.most_common(1)[0]
            if top_count / total_funcs >= MIN_SHARED_RATIO:
                dominant_func_case = top_case
                characteristics.append(f"functions: {top_case}")

        if not characteristics:
            return None

        complexity = len(characteristics)
        avg_ratio = 0.7  # Naming conventions are generally consistent
        confidence = self._score_confidence(avg_ratio, complexity, group_size, is_specific)

        desc_parts = []
        if dominant_class_case:
            desc_parts.append(f"Classes use {dominant_class_case}")
        if dominant_func_case:
            desc_parts.append(f"functions use {dominant_func_case}")

        return StaticPattern(
            group_key=group_key,
            pattern_type="naming_convention",
            title=f"Naming conventions in {group_key}",
            description="; ".join(desc_parts),
            template_content=f"// Naming: {', '.join(characteristics)}",
            language=language,
            confidence_score=confidence,
            evidence=characteristics,
            occurrences=group_size,
            key_characteristics=characteristics,
            detection_method="static_analysis",
            is_high_confidence=confidence >= HIGH_CONFIDENCE_THRESHOLD,
        )

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    @staticmethod
    def _score_confidence(
        shared_ratio: float,
        complexity: float,
        group_size: int,
        is_specific: bool,
    ) -> float:
        """
        Compute confidence score from 0.0 to 1.0.
        shared_ratio: avg fraction of files sharing the trait (0-1)
        complexity: number of traits detected (1-3)
        group_size: total files in the group
        is_specific: whether category is specific (controller, model, etc.)
        """
        size_factor = min(group_size / 20.0, 1.0)
        complexity_factor = min(complexity / 3.0, 1.0)
        specificity_bonus = 0.1 if is_specific else 0.0

        score = (
            shared_ratio * 0.4
            + complexity_factor * 0.3
            + size_factor * 0.2
            + specificity_bonus
        )
        return round(min(score, 1.0), 3)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _calculate_shared_items(
    item_sets: List[Set[str]], min_ratio: float
) -> Dict[str, float]:
    """
    For each item, calculate what fraction of sets contain it.
    Returns items above min_ratio threshold, mapped to their ratio.
    """
    if not item_sets:
        return {}

    total = len(item_sets)
    counts: Counter = Counter()
    for s in item_sets:
        for item in s:
            counts[item] += 1

    return {
        item: count / total
        for item, count in counts.items()
        if count / total >= min_ratio
    }


def _detect_case(name: str) -> str:
    """Detect naming case: PascalCase, camelCase, snake_case, UPPER_CASE, kebab-case."""
    if not name:
        return "unknown"
    if "_" in name:
        if name == name.upper():
            return "UPPER_SNAKE_CASE"
        return "snake_case"
    if "-" in name:
        return "kebab-case"
    if name[0].isupper() and any(c.islower() for c in name):
        return "PascalCase"
    if name[0].islower() and any(c.isupper() for c in name):
        return "camelCase"
    return "other"
