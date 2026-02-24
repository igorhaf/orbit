"""
File Analyzer Mixin for CodebaseMemoryService

Contains methods for extracting code samples, calculating file relevance
scores, formatting samples for prompts, and related analysis helpers.

PROMPT #118 - Business logic directory/pattern detection
PROMPT #163 - Multi-phase analysis with configurable depth
PROMPT #169 - Framework-agnostic approach using conceptual heuristics
PROMPT #230 - Symbol extraction for 5-10x compression
"""

import json
import logging
import asyncio
from pathlib import Path
from typing import Dict, List, Optional, Any
from uuid import UUID

from app.services.symbol_extractor import extract_and_format_batch, extract_symbols, format_symbol_map  # PROMPT #230

logger = logging.getLogger(__name__)

# PROMPT #118 FIX - Directories that contain business logic
BUSINESS_LOGIC_DIRS = {
    "models", "model", "entities", "entity",
    "controllers", "controller", "handlers", "handler",
    "services", "service", "usecases", "use_cases",
    "repositories", "repository", "repos",
    "validators", "validation", "rules",
    "migrations", "database/migrations",
    "middleware", "middlewares",
    "requests", "forms", "dtos",
    "policies", "guards", "permissions",
    "observers", "listeners", "events",
    "jobs", "commands", "actions"
}

# PROMPT #118 FIX - Files that typically contain business logic
BUSINESS_LOGIC_PATTERNS = {
    # Models and entities
    "model", "entity", "domain",
    # Controllers and handlers
    "controller", "handler", "endpoint",
    # Services and use cases
    "service", "usecase", "interactor",
    # Validation and rules
    "validator", "rule", "policy", "guard",
    # Data and repositories
    "repository", "repo", "dao",
    # Migrations (database schema = business rules)
    "migration", "schema",
    # Middleware (business rules enforcement)
    "middleware", "filter",
    # Request validation (business rules)
    "request", "form", "dto",
    # Events and jobs
    "event", "listener", "job", "command"
}

# PROMPT #163 - Configurable scan depth settings
# PROMPT #165 - Added "local" profile for Ollama/local models
SCAN_DEPTH_CONFIG = {
    "quick": {
        "max_files": 30,
        "max_content_per_file": 5000,
        "phases": ["documentation", "quick_scan"],
        "files_per_phase": 15,
        "description": "Quick scan: 30 files, 2 phases (~1-2 min)"
    },
    "normal": {
        "max_files": 100,
        "max_content_per_file": 10000,
        "phases": ["documentation", "domain", "logic", "consolidation"],
        "files_per_phase": 25,
        "description": "Normal scan: 100 files, 4 phases (~5-10 min)"
    },
    "deep": {
        "max_files": None,  # No limit - read ALL files
        "max_content_per_file": 20000,
        "phases": "dynamic",  # Create phases as needed
        "files_per_phase": 15,
        "description": "Deep scan: ALL files, N phases (~15-30+ min)"
    },
    # PROMPT #165 - Profile optimized for local models (Ollama/Qwen)
    # PROMPT #236 - Increased max_files from 15->50 so chain prompting
    # can pick a proportional subset (50% of available, min 5, max 25)
    "local": {
        "max_files": 50,
        "max_content_per_file": 2000,  # Much smaller to fit in 32K context
        "phases": ["quick_scan"],  # Single phase for simplicity
        "files_per_phase": 10,
        "description": "Local model scan: up to 50 files, chain prompting (~5-15 min)"
    }
}

# Legacy constants (used as defaults, overridden by scan_depth)
MAX_FILES_FOR_AI = 100  # PROMPT #163 - Increased from 30
MAX_CONTENT_PER_FILE = 10000  # PROMPT #163 - Increased from 5000


class FileAnalyzerMixin:
    """Mixin providing file analysis, scoring, and sample extraction."""

    # Class-level constants
    BUSINESS_LOGIC_DIRS = BUSINESS_LOGIC_DIRS
    BUSINESS_LOGIC_PATTERNS = BUSINESS_LOGIC_PATTERNS
    SCAN_DEPTH_CONFIG = SCAN_DEPTH_CONFIG
    MAX_FILES_FOR_AI = MAX_FILES_FOR_AI
    MAX_CONTENT_PER_FILE = MAX_CONTENT_PER_FILE

    def _extract_code_samples(
        self,
        root_path: Path,
        scan_data: Dict,
        config: Optional[Dict] = None
    ) -> List[Dict[str, str]]:
        """
        Extract representative code samples for AI analysis.

        PROMPT #169 - Framework-agnostic approach using conceptual heuristics:

        Prioritization is based on CONTENT CHARACTERISTICS, not naming conventions:
        1. Larger files (more code = more logic)
        2. Files with more imports/dependencies (more interconnected = more central)
        3. Files deeper in directory structure (more specific to the domain)
        4. Avoid files that look like config/boilerplate by content pattern

        This works for ANY language/framework without hardcoded naming patterns.

        Args:
            root_path: Root path of codebase
            scan_data: Scan statistics from _scan_codebase
            config: Optional scan depth config (from SCAN_DEPTH_CONFIG)

        Returns:
            List of {filename, content, type} dicts
        """
        # PROMPT #163 - Use config limits or defaults
        max_files = config.get("max_files", self.MAX_FILES_FOR_AI) if config else self.MAX_FILES_FOR_AI
        max_content = config.get("max_content_per_file", self.MAX_CONTENT_PER_FILE) if config else self.MAX_CONTENT_PER_FILE

        # For "deep" mode, max_files is None (no limit)
        if max_files is None:
            max_files = float('inf')

        samples = []
        scored_files = []

        # Collect all code files with their scores
        key_files = scan_data.get("key_files", [])

        for file_path in key_files:
            full_path = root_path / file_path
            if not full_path.exists():
                continue

            try:
                content = full_path.read_text(encoding="utf-8", errors="ignore")
                score = self._calculate_file_relevance_score(file_path, content)

                scored_files.append({
                    "filename": file_path,
                    "content": content,
                    "score": score,
                    "type": "code"
                })
            except Exception as e:
                logger.warning(f"Failed to read {file_path}: {e}")

        # Sort by relevance score (higher = more relevant)
        scored_files.sort(key=lambda x: x["score"], reverse=True)

        # Take top N files based on score
        for file_data in scored_files:
            if len(samples) >= max_files:
                break

            samples.append({
                "filename": file_data["filename"],
                "content": file_data["content"][:max_content],
                "type": file_data["type"]
            })

        # Add README only if we have space and found one
        if len(samples) < max_files:
            for config_file in scan_data.get("config_files", []):
                if "readme" in config_file.lower():
                    full_path = root_path / config_file
                    if full_path.exists():
                        try:
                            content = full_path.read_text(encoding="utf-8", errors="ignore")
                            samples.append({
                                "filename": config_file,
                                "content": content[:max_content],
                                "type": "documentation"
                            })
                            break
                        except Exception as e:
                            logger.warning(f"Failed to read {config_file}: {e}")

        logger.info(f"📂 Extracted {len(samples)} code samples (max_files={max_files}, scored from {len(scored_files)} candidates)")
        return samples

    def _calculate_file_relevance_score(self, file_path: str, content: str) -> float:
        """
        Calculate a relevance score for a file based on conceptual heuristics.

        PROMPT #169 - Framework-agnostic scoring:
        - Larger files tend to have more business logic
        - Files with more imports are more interconnected (central to the system)
        - Deeper paths are more domain-specific
        - Penalize files that look like boilerplate/config

        Returns a score where higher = more relevant for understanding business logic.
        """
        score = 0.0
        lines = content.split('\n')
        line_count = len(lines)

        # 1. File size score (larger files tend to have more logic)
        # Cap at 1000 lines to avoid over-weighting massive files
        size_score = min(line_count, 1000) / 100.0  # 0-10 points
        score += size_score

        # 2. Import/dependency density (more imports = more interconnected)
        import_patterns = [
            'import ', 'from ', 'require(', 'use ', 'include ',
            '#include', 'using ', '@import', 'load '
        ]
        import_count = sum(1 for line in lines[:100] if any(p in line for p in import_patterns))
        import_score = min(import_count, 20) / 2.0  # 0-10 points
        score += import_score

        # 3. Path depth score (deeper = more specific)
        path_depth = file_path.count('/') + file_path.count('\\')
        depth_score = min(path_depth, 5) * 1.5  # 0-7.5 points
        score += depth_score

        # 4. Function/method density (more functions = more logic)
        function_patterns = [
            'def ', 'function ', 'func ', 'fn ', '=> {',
            'public function', 'private function', 'protected function',
            'public static', 'private static',
            'async ', 'pub fn', 'func ('
        ]
        function_count = sum(1 for line in lines if any(p in line for p in function_patterns))
        function_score = min(function_count, 30) / 3.0  # 0-10 points
        score += function_score

        # 5. Class/struct definitions (indicates domain objects)
        class_patterns = ['class ', 'struct ', 'interface ', 'trait ', 'enum ', 'type ']
        class_count = sum(1 for line in lines if any(p in line for p in class_patterns))
        class_score = min(class_count, 10) * 0.5  # 0-5 points
        score += class_score

        # 6. BONUSES for context/branding files (PROMPT #169)
        # These files often contain system names, domains, and business context

        # Bonus for domain names (government, company, etc.)
        domain_patterns = [
            '.gov.br', '.gov', '.gob.', '.edu.br', '.org.br',
            'Route::domain', '@domain', 'domain =', 'host =',
            'APP_URL', 'BASE_URL', 'SITE_URL'
        ]
        if any(p in content for p in domain_patterns):
            score += 10.0  # High bonus - domain info is very valuable for context

        # Bonus for HTML titles (branding context)
        if '<title>' in content and '</title>' in content:
            score += 8.0  # Titles contain system names!

        # Bonus for route files (URL structure = system structure)
        if 'Route::' in content or '@route' in content or 'router.' in content:
            score += 5.0

        # 7. PENALTIES for likely non-business files

        # Penalty for config-like content
        config_indicators = [
            '"version":', "'version':", 'version =',
            '"name":', "'name':", '"dependencies":',
            'module.exports', 'export default {',
            '<?xml', '<!DOCTYPE', '<configuration>'
        ]
        if any(indicator in content[:500] for indicator in config_indicators):
            score -= 5.0

        # Penalty for test files
        if any(p in file_path.lower() for p in ['test', 'spec', '_test.', '.test.', 'tests/']):
            score -= 3.0

        # Penalty for migration/schema files (they define structure, not logic)
        if any(p in file_path.lower() for p in ['migration', 'schema', 'seed', 'fixture']):
            score -= 2.0

        # Penalty for very small files (likely stubs or simple configs)
        if line_count < 20:
            score -= 3.0

        # Penalty for files with mostly comments/empty lines
        non_empty_lines = [l for l in lines if l.strip() and not l.strip().startswith(('#', '//', '/*', '*', '--', ';'))]
        if len(non_empty_lines) < line_count * 0.3:
            score -= 2.0

        return max(score, 0.0)  # Don't go negative

    # =========================================================================
    # PROMPT #163 - Multi-phase Analysis Methods
    # =========================================================================

    def _is_domain_file(self, filename: str) -> bool:
        """Check if file is domain/model related."""
        lower = filename.lower()
        return any(p in lower for p in ["model", "entity", "migration", "schema", "domain"])

    def _is_logic_file(self, filename: str) -> bool:
        """Check if file is logic/service related."""
        lower = filename.lower()
        return any(p in lower for p in ["controller", "service", "handler", "usecase", "validator", "request", "policy"])

    def _format_samples_for_prompt(self, samples: List[Dict], use_symbols: bool = True) -> str:
        """
        Format code samples as a string for the prompt.

        PROMPT #230 - Uses symbol extraction by default for 5-10x compression.
        Falls back to raw code for documentation/config files.
        """
        if not use_symbols:
            # Legacy mode: raw code
            parts = []
            for sample in samples:
                parts.append(f"\n### File: {sample['filename']} ({sample['type']})")
                parts.append("```")
                parts.append(sample["content"])
                parts.append("```\n")
            return "\n".join(parts)

        # PROMPT #230 - Symbol extraction mode
        code_samples = [s for s in samples if s.get("type") == "code"]
        doc_samples = [s for s in samples if s.get("type") != "code"]

        parts = []

        # Documentation files: include raw content (they're already compact)
        for sample in doc_samples:
            content = sample.get("content", "")[:3000]  # Cap docs at 3K
            parts.append(f"\n### File: {sample['filename']} ({sample['type']})")
            parts.append(content)

        # Code files: use symbol extraction
        if code_samples:
            parts.append("\n### ARCHITECTURAL SYMBOL MAP (extracted from code files)")
            parts.append(extract_and_format_batch(code_samples))

        return "\n".join(parts)

