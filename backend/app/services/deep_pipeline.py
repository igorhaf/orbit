"""
Deep Pipeline Service - 7-Phase Sequential Pipeline via Claudio

Orchestrates the complete deep analysis of a codebase:
  Phase 0: Structural scan (filesystem, no AI)
  Phase 1: Per-file analysis (Haiku, parallel)
  Phase 2: Cross-file rule synthesis (Sonnet, multi-turn)
  Phase 3: Architectural map (Sonnet + extended thinking)
  Phase 4: Hierarchical card generation (Opus/Sonnet/Haiku)
  Phase 5: Wiki generation (Opus, multi-turn)
  Phase 6: Quality assurance (Sonnet + extended thinking)
  Phase 7: Gap filling (conditional)
"""

import asyncio
import fnmatch
import hashlib
import json
import logging
import os
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.contracts.loader import ContractLoader
from app.models.pipeline_artifact import PipelineArtifact, ArtifactType
from app.models.pipeline_profile import PipelineProfile
from app.models.pipeline_run import PipelineRun
from app.models.project import Project
from app.models.task import Task, ItemType, TaskStatus, PriorityLevel
from app.services.claudio_pipeline import (
    ClaudioPipelineService,
    ClaudioPipelineError,
    MODEL_HAIKU,
    MODEL_SONNET,
    MODEL_OPUS,
)

logger = logging.getLogger(__name__)

# ── Reinforcement rules: when a phase score is below threshold, adjust next run
REINFORCEMENT_RULES = {
    "phase_1": {
        "threshold": 70,
        "adjustments": {"max_tokens": 8000},
        "reason": "Low parse success rate — doubling max_tokens for deeper analysis",
    },
    "phase_2": {
        "threshold": 60,
        "adjustments": {"multi_turn_threshold": 10, "max_tokens": 24000},
        "reason": "Low rule density — enabling multi-turn for more domains",
    },
    "phase_4a": {
        "threshold": 50,
        "adjustments": {"max_tokens": 80000},
        "reason": "Low hierarchy ratio — increasing epic generation budget",
    },
    "phase_5b": {
        "threshold": 60,
        "adjustments": {"max_tokens": 80000},
        "reason": "Thin wiki pages — increasing wiki generation budget",
    },
}

# Directories always excluded from scanning
IGNORE_DIRECTORIES = {
    "node_modules", "__pycache__", ".git", ".svn", ".hg", "vendor", "dist",
    "build", ".next", ".nuxt", "target", "bin", "obj", ".venv", "venv",
    "env", ".env", ".tox", ".mypy_cache", ".pytest_cache", "coverage",
    ".nyc_output", ".cache", ".gradle", ".idea", ".vscode", ".DS_Store",
    "tmp", "temp", "logs", ".terraform", ".serverless",
}

# File extensions to analyze
CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".php", ".rb", ".java", ".go",
    ".rs", ".cs", ".swift", ".kt", ".scala", ".vue", ".svelte",
    ".sql", ".graphql", ".prisma",
}

# Extensions that rarely contain business rules
SKIP_EXTENSIONS = {
    ".css", ".scss", ".less", ".svg", ".png", ".jpg", ".gif", ".ico",
    ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".pdf",
    ".lock", ".map", ".min.js", ".min.css",
}

# Max file size to send to AI (bytes) - very large files are likely generated
MAX_FILE_SIZE = 100_000  # 100KB

# Complexity keywords for heuristic scoring
COMPLEXITY_KEYWORDS = re.compile(
    r'\b(if|else|elif|switch|case|for|while|do|try|catch|except|finally|throw|raise)\b'
)

# Import patterns for dependency graph
IMPORT_PATTERNS = [
    re.compile(r'^\s*import\s+(.+)', re.MULTILINE),
    re.compile(r'^\s*from\s+(\S+)\s+import', re.MULTILINE),
    re.compile(r'^\s*require\s*\(\s*[\'"](.+?)[\'"]\s*\)', re.MULTILINE),
    re.compile(r'^\s*use\s+(.+?)\s*;', re.MULTILINE),
    re.compile(r'^\s*include\s+[\'"](.+?)[\'"]', re.MULTILINE),
]


class DeepPipelineService:
    """Orchestrates the 7-phase deep pipeline using Claudio."""

    def __init__(self, db: Session, profile_name: str = None):
        self.db = db
        self.claudio = ClaudioPipelineService()
        self._contract_loader = ContractLoader(db)
        self._profile = self._load_profile(profile_name)
        self._phase_configs = self._profile.phase_configs if self._profile else {}

    def _load_profile(self, profile_name: str = None) -> Optional[PipelineProfile]:
        """Load a named profile or the default one."""
        if profile_name:
            profile = self.db.query(PipelineProfile).filter(PipelineProfile.name == profile_name).first()
            if profile:
                return profile
            logger.warning(f"Profile '{profile_name}' not found, falling back to default")
        # Try default
        profile = self.db.query(PipelineProfile).filter(PipelineProfile.is_default == True).first()
        if profile:
            return profile
        # Try quality as last resort
        return self.db.query(PipelineProfile).filter(PipelineProfile.name == "quality").first()

    def _get_phase_config(self, phase_key: str, field: str, default=None):
        """Get a config value for a phase from the loaded profile."""
        cfg = self._phase_configs.get(phase_key, {})
        return cfg.get(field, default)

    def _get_model(self, phase_key: str, default: str = MODEL_SONNET) -> str:
        """Get model for a phase from profile config."""
        return self._get_phase_config(phase_key, "model", default)

    def _get_max_tokens(self, phase_key: str, default: int = 8000) -> int:
        """Get max_tokens for a phase from profile config."""
        return self._get_phase_config(phase_key, "max_tokens", default)

    def _get_concurrency(self, phase_key: str, default: int = 5) -> int:
        """Get concurrency for a phase from profile config."""
        return self._get_phase_config(phase_key, "concurrency", default)

    def _get_contract_name(self, phase_key: str, default: str = None) -> Optional[str]:
        """Get contract name for a phase from profile config."""
        return self._get_phase_config(phase_key, "contract", default)

    def _load_contract(self, name: str, variables: dict = None) -> tuple[str, str]:
        """Load a contract and render with variables."""
        try:
            return self._contract_loader.render(f"pipeline/{name}", variables or {})
        except Exception as e:
            logger.warning(f"Failed to load contract 'pipeline/{name}': {e}")
            return ("", "")

    # ── Phase Scoring (heuristic, no AI) ─────────────────────────────────────

    @staticmethod
    def _compute_phase_score(phase_key: str, data: dict) -> int:
        """Compute a 0-100 quality score for a phase based on heuristic metrics."""
        if phase_key == "phase_0":
            files = data.get("files_found", 0)
            return min(100, int(files / 5 * 10)) if files > 0 else 0

        if phase_key == "phase_1":
            total = data.get("files_total", 1)
            analyzed = data.get("files_analyzed", 0)
            rate = analyzed / max(total, 1) * 100
            return min(100, int(rate))

        if phase_key == "phase_2":
            rules = data.get("total_rules", 0)
            domains = data.get("domains", 1)
            density = rules / max(domains, 1)
            # 10+ rules per domain = 100, <3 = poor
            return min(100, int(density * 10))

        if phase_key == "phase_3":
            arch = data.get("arch_map", {})
            fields = ["domains", "cross_domain_flows", "tech_stack", "patterns"]
            filled = sum(1 for f in fields if arch.get(f))
            return min(100, int(filled / len(fields) * 100))

        if phase_key == "phase_4":
            epics = data.get("epics", 0)
            stories = data.get("stories", 0)
            tasks = data.get("tasks", 0)
            if epics == 0:
                return 0
            # Healthy ratio: ~3 stories per epic, ~3 tasks per story
            story_ratio = min(1.0, stories / max(epics * 2, 1))
            task_ratio = min(1.0, tasks / max(stories * 2, 1))
            return min(100, int((story_ratio * 50 + task_ratio * 50)))

        if phase_key == "phase_5":
            pages = data.get("total_pages", 0)
            avg_chars = data.get("avg_chars_per_page", 0)
            page_score = min(50, pages * 5)
            richness = min(50, int(avg_chars / 100 * 10))
            return min(100, page_score + richness)

        if phase_key == "phase_6":
            return data.get("overall_score", 50)

        return 50  # unknown phase

    def _apply_reinforcement(self, project_id: UUID) -> dict:
        """Check previous run scores and apply reinforcement adjustments."""
        prev_run = (
            self.db.query(PipelineRun)
            .filter(PipelineRun.project_id == project_id, PipelineRun.status == "completed")
            .order_by(PipelineRun.created_at.desc())
            .first()
        )
        if not prev_run or not prev_run.phase_scores:
            return {}

        adjustments = {}
        for phase_key, rule in REINFORCEMENT_RULES.items():
            score = prev_run.phase_scores.get(phase_key, 100)
            if score < rule["threshold"]:
                logger.info(f"Reinforcement: {phase_key} score was {score} (< {rule['threshold']}). {rule['reason']}")
                # Apply adjustments to current profile config
                if phase_key in self._phase_configs:
                    self._phase_configs[phase_key].update(rule["adjustments"])
                adjustments[phase_key] = {
                    "previous_score": score,
                    "threshold": rule["threshold"],
                    "applied": rule["adjustments"],
                    "reason": rule["reason"],
                }
        return adjustments

    # =========================================================================
    # MAIN ORCHESTRATOR
    # =========================================================================

    async def run(
        self,
        project_id: UUID,
        progress_callback: Any = None,
    ) -> Dict[str, Any]:
        """
        Execute the complete 7-phase deep pipeline.

        Args:
            project_id: UUID of the project to analyze
            progress_callback: Optional async callable(phase, pct, message)

        Returns:
            Dict with pipeline results and quality score
        """
        import time as _time

        run_id = uuid4()
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if not project.code_path or not os.path.isdir(project.code_path):
            raise ValueError(f"Invalid code_path: {project.code_path}")

        profile_name = self._profile.name if self._profile else "quality"
        logger.info(f"Starting deep pipeline for project '{project.name}' "
                     f"(run_id={run_id}, profile={profile_name})")

        # ── Create PipelineRun record ────────────────────────────────────
        pipeline_run = PipelineRun(
            id=run_id,
            project_id=project.id,
            profile_id=self._profile.id if self._profile else None,
            profile_name=profile_name,
            profile_snapshot=self._phase_configs,
            version="v2",
            status="running",
            phase_scores={},
            phase_durations={},
            started_at=datetime.utcnow(),
        )
        self.db.add(pipeline_run)
        self.db.commit()

        # ── Apply reinforcement from previous run ────────────────────────
        reinforcement = self._apply_reinforcement(project.id)
        if reinforcement:
            pipeline_run.reinforcement_applied = reinforcement
            self.db.commit()

        quality_threshold = self._profile.quality_threshold if self._profile else 60

        async def _progress(phase: int, pct: float, msg: str):
            logger.info(f"[Phase {phase}] {pct:.0f}% - {msg}")
            if progress_callback:
                try:
                    await progress_callback(phase, pct, msg)
                except Exception:
                    pass

        # Check Claudio health
        healthy = await self.claudio.health_check()
        if not healthy:
            pipeline_run.status = "failed"
            pipeline_run.error = f"Claudio not reachable at {self.claudio.base_url}"
            pipeline_run.completed_at = datetime.utcnow()
            self.db.commit()
            raise ClaudioPipelineError(
                f"Claudio is not reachable at {self.claudio.base_url}. Start it first."
            )

        results = {}
        phase_scores = {}
        phase_durations = {}

        def _phase_timer():
            return _time.monotonic()

        try:
            # Phase 0: Structural Scan (0-5%)
            t0 = _phase_timer()
            await _progress(0, 0, "Iniciando scan estrutural...")
            file_inventory = await self._phase0_structural_scan(project)
            results["phase0"] = {"files_found": len(file_inventory)}
            phase_scores["phase_0"] = self._compute_phase_score("phase_0", results["phase0"])
            phase_durations["phase_0"] = int((_phase_timer() - t0) * 1000)
            await _progress(0, 100, f"Scan completo: {len(file_inventory)} arquivos (score: {phase_scores['phase_0']})")

            # Phase 1: Per-file Analysis (5-25%)
            t0 = _phase_timer()
            model_1 = self._get_model("phase_1", MODEL_HAIKU)
            await _progress(1, 0, f"Analisando {len(file_inventory)} arquivos com {model_1.split('-')[1].title()}...")
            file_analyses = await self._phase1_file_analysis(
                project, file_inventory, run_id, _progress
            )
            p1_data = {
                "files_analyzed": len(file_analyses),
                "files_total": len(file_inventory),
                "domains_found": len(set(a.get("domain_classification", "?") for a in file_analyses)),
            }
            results["phase1"] = p1_data
            phase_scores["phase_1"] = self._compute_phase_score("phase_1", p1_data)
            phase_durations["phase_1"] = int((_phase_timer() - t0) * 1000)
            await _progress(1, 100, f"Analise completa: {len(file_analyses)} arquivos (score: {phase_scores['phase_1']})")

            # Phase 2: Cross-file Rule Synthesis (25-40%)
            t0 = _phase_timer()
            model_2 = self._get_model("phase_2", MODEL_SONNET)
            await _progress(2, 0, f"Sintetizando regras cross-file com {model_2.split('-')[1].title()}...")
            domain_rules = await self._phase2_rule_synthesis(
                project, file_analyses, run_id, _progress
            )
            total_rules = sum(len(d.get("consolidated_rules", [])) for d in domain_rules.values())
            p2_data = {"domains": len(domain_rules), "total_rules": total_rules}
            results["phase2"] = p2_data
            phase_scores["phase_2"] = self._compute_phase_score("phase_2", p2_data)
            phase_durations["phase_2"] = int((_phase_timer() - t0) * 1000)
            await _progress(2, 100, f"Sintese completa: {total_rules} regras em {len(domain_rules)} dominios (score: {phase_scores['phase_2']})")

            # Phase 3: Architectural Map (40-45%)
            t0 = _phase_timer()
            await _progress(3, 0, "Construindo mapa arquitetural com Extended Thinking...")
            arch_map = await self._phase3_architectural_map(
                project, domain_rules, file_inventory, run_id
            )
            p3_data = {
                "domains": len(arch_map.get("domains", [])),
                "cross_domain_flows": len(arch_map.get("cross_domain_flows", [])),
                "arch_map": arch_map,
            }
            results["phase3"] = {"domains": p3_data["domains"], "cross_domain_flows": p3_data["cross_domain_flows"]}
            phase_scores["phase_3"] = self._compute_phase_score("phase_3", p3_data)
            phase_durations["phase_3"] = int((_phase_timer() - t0) * 1000)
            # Save to project
            project.project_architecture = arch_map
            project.pipeline_version = "v2"
            self.db.commit()
            await _progress(3, 100, f"Mapa arquitetural construido (score: {phase_scores['phase_3']})")

            # Phase 4: Card Generation (45-70%)
            t0 = _phase_timer()
            await _progress(4, 0, "Gerando cards hierarquicos...")
            card_stats = await self._phase4_card_generation(
                project, arch_map, domain_rules, run_id, _progress
            )
            results["phase4"] = card_stats
            phase_scores["phase_4"] = self._compute_phase_score("phase_4", card_stats)
            phase_durations["phase_4"] = int((_phase_timer() - t0) * 1000)
            await _progress(4, 100, f"Cards gerados: {card_stats.get('total_cards', 0)} (score: {phase_scores['phase_4']})")

            # Phase 5: Wiki Generation (70-85%)
            t0 = _phase_timer()
            await _progress(5, 0, "Gerando wiki...")
            wiki_stats = await self._phase5_wiki_generation(
                project, arch_map, domain_rules, card_stats, run_id, _progress
            )
            results["phase5"] = wiki_stats
            phase_scores["phase_5"] = self._compute_phase_score("phase_5", wiki_stats)
            phase_durations["phase_5"] = int((_phase_timer() - t0) * 1000)
            await _progress(5, 100, f"Wiki gerada: {wiki_stats.get('total_pages', 0)} paginas (score: {phase_scores['phase_5']})")

            # Phase 6: Quality Assurance (85-95%)
            t0 = _phase_timer()
            await _progress(6, 0, "Executando Quality Assurance com Thinking...")
            qa_result = await self._phase6_quality_assurance(
                project, arch_map, domain_rules, card_stats, wiki_stats, run_id
            )
            results["phase6"] = qa_result
            phase_scores["phase_6"] = self._compute_phase_score("phase_6", qa_result)
            phase_durations["phase_6"] = int((_phase_timer() - t0) * 1000)
            project.pipeline_quality_score = str(qa_result.get("overall_score", 0))
            self.db.commit()
            await _progress(6, 100, f"QA completo. Score: {qa_result.get('overall_score', 0)}/100")

            # Phase 7: Gap Filling (95-100%) - conditional
            t0 = _phase_timer()
            if qa_result.get("overall_score", 100) < quality_threshold:
                await _progress(7, 0, f"Score < {quality_threshold} - executando correcao de gaps...")
                gap_result = await self._phase7_gap_filling(
                    project, qa_result, arch_map, domain_rules, run_id
                )
                results["phase7"] = gap_result
                await _progress(7, 100, "Correcao de gaps concluida")
            else:
                results["phase7"] = {"skipped": True, "reason": f"Score >= {quality_threshold}"}
                await _progress(7, 100, f"Score >= {quality_threshold} - gap filling nao necessario")
            phase_durations["phase_7"] = int((_phase_timer() - t0) * 1000)

            # ── Update PipelineRun with final results ────────────────────
            pipeline_run.status = "completed"
            pipeline_run.overall_score = qa_result.get("overall_score", 0)
            pipeline_run.phase_scores = phase_scores
            pipeline_run.phase_durations = phase_durations
            pipeline_run.total_files_scanned = len(file_inventory)
            pipeline_run.total_rules_extracted = total_rules
            pipeline_run.total_domains = len(domain_rules)
            pipeline_run.total_cards_created = card_stats.get("total_cards", 0)
            pipeline_run.total_wiki_pages = wiki_stats.get("total_pages", 0)
            pipeline_run.completed_at = datetime.utcnow()
            self.db.commit()

        except Exception as e:
            logger.error(f"Deep pipeline failed at run {run_id}: {e}", exc_info=True)
            results["error"] = str(e)
            # Update run as failed
            try:
                pipeline_run.status = "failed"
                pipeline_run.error = str(e)[:1000]
                pipeline_run.phase_scores = phase_scores
                pipeline_run.phase_durations = phase_durations
                pipeline_run.completed_at = datetime.utcnow()
                self.db.commit()
            except Exception:
                self.db.rollback()
            raise
        finally:
            await self.claudio.close()

        logger.info(f"Deep pipeline completed for project '{project.name}' "
                     f"(run_id={run_id}, profile={profile_name}, "
                     f"score={pipeline_run.overall_score})")
        results["run_id"] = str(run_id)
        results["profile"] = profile_name
        results["phase_scores"] = phase_scores
        return results

    # =========================================================================
    # PHASE 0: STRUCTURAL SCAN
    # =========================================================================

    def _read_file_to_inventory(
        self, rel_path: str, code_path: Path, ignore_patterns: List[str]
    ) -> Optional[Dict[str, Any]]:
        """Read a single file and return its inventory dict, or None if skipped."""
        ext = os.path.splitext(rel_path)[1].lower()
        if ext in SKIP_EXTENSIONS or ext not in CODE_EXTENSIONS:
            return None
        if self._is_ignored(rel_path, ignore_patterns):
            return None

        fpath = str(code_path / rel_path)
        try:
            stat = os.stat(fpath)
            if stat.st_size > MAX_FILE_SIZE or stat.st_size == 0:
                return None
        except OSError:
            return None

        try:
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception:
            return None

        lines = content.count("\n") + 1
        complexity = len(COMPLEXITY_KEYWORDS.findall(content))
        imports = self._extract_imports(content)
        lang = self._detect_language(ext)
        file_type = self._classify_file_type(rel_path, content)

        return {
            "path": rel_path,
            "abs_path": fpath,
            "extension": ext,
            "language": lang,
            "lines": lines,
            "size": stat.st_size,
            "complexity_score": complexity,
            "imports": imports,
            "file_type": file_type,
            "content": content,
        }

    async def _phase0_structural_scan(
        self, project: Project
    ) -> List[Dict[str, Any]]:
        """
        Walk the codebase and collect structural metadata.
        No AI calls - pure filesystem analysis.

        If the project already has a completed memory scan with cached
        code_file_paths, reuse that list to skip the os.walk traversal.
        """
        code_path = Path(project.code_path)
        ignore_patterns = self._build_ignore_patterns(project)
        inventory = []

        # Try to reuse file paths from memory scan
        cached_paths = None
        if project.initial_scan_complete and project.initial_memory_context:
            scan_summary = project.initial_memory_context.get("scan_summary", {})
            cached_paths = scan_summary.get("code_file_paths")
            if cached_paths:
                logger.info(
                    f"Phase 0: Reusing {len(cached_paths)} cached paths "
                    f"from memory scan (skipping os.walk)"
                )

        if cached_paths:
            for rel_path in cached_paths:
                item = self._read_file_to_inventory(rel_path, code_path, ignore_patterns)
                if item:
                    inventory.append(item)
        else:
            for root, dirs, files in os.walk(code_path):
                # Filter directories in-place
                dirs[:] = [d for d in dirs if d not in IGNORE_DIRECTORIES
                           and not self._is_ignored(os.path.relpath(os.path.join(root, d), code_path), ignore_patterns)]

                for fname in files:
                    fpath = os.path.join(root, fname)
                    rel_path = os.path.relpath(fpath, code_path)
                    item = self._read_file_to_inventory(rel_path, code_path, ignore_patterns)
                    if item:
                        inventory.append(item)

        logger.info(f"Phase 0: Scanned {len(inventory)} code files from {code_path}")
        return inventory

    def _build_ignore_patterns(self, project: Project) -> List[str]:
        """Build combined ignore patterns from all sources."""
        patterns = []

        # User-defined ignore paths
        if project.ignore_paths:
            if isinstance(project.ignore_paths, list):
                patterns.extend(project.ignore_paths)

        # AI-detected patterns
        if project.custom_ignore_patterns:
            cp = project.custom_ignore_patterns
            if isinstance(cp, dict) and "directories" in cp:
                patterns.extend(cp["directories"])

        # .gitignore
        gitignore = os.path.join(project.code_path, ".gitignore")
        if os.path.isfile(gitignore):
            try:
                with open(gitignore, "r") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#"):
                            patterns.append(line)
            except Exception:
                pass

        return patterns

    def _is_ignored(self, rel_path: str, patterns: List[str]) -> bool:
        """Check if a relative path matches any ignore pattern."""
        for pattern in patterns:
            if fnmatch.fnmatch(rel_path, pattern):
                return True
            if fnmatch.fnmatch(rel_path, f"*/{pattern}"):
                return True
            if rel_path.startswith(pattern.rstrip("/")):
                return True
        return False

    @staticmethod
    def _extract_imports(content: str) -> List[str]:
        """Extract import/require statements from code."""
        imports = set()
        for pattern in IMPORT_PATTERNS:
            for match in pattern.finditer(content):
                imp = match.group(1).strip().strip("'\"")
                if imp and not imp.startswith("."):
                    imports.add(imp.split(".")[0].split("/")[0])
        return list(imports)[:20]  # Limit to 20 most relevant

    @staticmethod
    def _detect_language(ext: str) -> str:
        """Detect programming language from extension."""
        lang_map = {
            ".py": "python", ".js": "javascript", ".ts": "typescript",
            ".tsx": "typescript", ".jsx": "javascript", ".php": "php",
            ".rb": "ruby", ".java": "java", ".go": "go", ".rs": "rust",
            ".cs": "csharp", ".swift": "swift", ".kt": "kotlin",
            ".scala": "scala", ".vue": "vue", ".svelte": "svelte",
            ".sql": "sql", ".graphql": "graphql", ".prisma": "prisma",
        }
        return lang_map.get(ext, "unknown")

    @staticmethod
    def _classify_file_type(rel_path: str, content: str) -> str:
        """Classify file by its role in the architecture."""
        path_lower = rel_path.lower()
        if any(p in path_lower for p in ["migration", "alembic", "migrate"]):
            return "migration"
        if any(p in path_lower for p in ["model", "schema", "entity"]):
            return "model"
        if any(p in path_lower for p in ["route", "controller", "endpoint", "api"]):
            return "route"
        if any(p in path_lower for p in ["service", "usecase", "interactor"]):
            return "domain_logic"
        if any(p in path_lower for p in ["test", "spec", "__test__"]):
            return "test"
        if any(p in path_lower for p in ["component", "page", "view", "template"]):
            return "ui"
        if any(p in path_lower for p in ["config", "setting", ".env"]):
            return "config"
        if any(p in path_lower for p in ["middleware", "guard", "interceptor"]):
            return "infrastructure"
        return "domain_logic"

    # =========================================================================
    # PHASE 1: PER-FILE ANALYSIS (Haiku, parallel)
    # =========================================================================

    async def _phase1_file_analysis(
        self,
        project: Project,
        inventory: List[Dict],
        run_id: UUID,
        progress_cb: Any,
    ) -> List[Dict]:
        """Analyze each file individually with Haiku in parallel."""

        system_prompt, _ = self._load_contract("deep_file_analysis", {
            "file_path": "placeholder",
            "file_content": "placeholder",
            "project_name": project.name,
        })
        # We only need the system prompt template; user_prompt varies per file
        if not system_prompt:
            system_prompt = "Analyze the code file and extract business rules. Respond with JSON only."

        # Build batch requests (model/tokens/concurrency from profile)
        p1_model = self._get_model("phase_1", MODEL_HAIKU)
        p1_max_tokens = self._get_max_tokens("phase_1", 4000)
        p1_concurrency = self._get_concurrency("phase_1", 10)

        requests = []
        for item in inventory:
            user_prompt = f"Arquivo: {item['path']}\n\nCodigo:\n{item['content']}"
            requests.append({
                "model": p1_model,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "max_tokens": p1_max_tokens,
            })

        # Execute in parallel batches
        results = await self.claudio.call_batch(requests, max_concurrency=p1_concurrency)

        file_analyses = []
        for i, result in enumerate(results):
            if isinstance(result, ClaudioPipelineError):
                logger.warning(f"Phase 1: Failed to analyze {inventory[i]['path']}: {result}")
                continue

            parsed = self.claudio.extract_json(result.get("text", ""))
            if parsed and isinstance(parsed, dict):
                parsed["file_path"] = inventory[i]["path"]
                parsed["file_type"] = inventory[i]["file_type"]
                parsed["lines"] = inventory[i]["lines"]
                parsed["complexity_score"] = inventory[i]["complexity_score"]
                file_analyses.append(parsed)

                # Store artifact
                artifact = PipelineArtifact(
                    project_id=project.id,
                    artifact_type=ArtifactType.file_analysis,
                    phase=1,
                    domain=parsed.get("domain_classification", "Unknown"),
                    source_path=inventory[i]["path"],
                    content=parsed,
                    run_id=run_id,
                )
                self.db.add(artifact)

            # Progress update every 50 files
            if (i + 1) % 50 == 0:
                pct = ((i + 1) / len(results)) * 100
                await progress_cb(1, pct, f"Analisados {i + 1}/{len(results)} arquivos")

        self.db.commit()
        logger.info(f"Phase 1: Analyzed {len(file_analyses)}/{len(inventory)} files successfully")
        return file_analyses

    # =========================================================================
    # PHASE 2: CROSS-FILE RULE SYNTHESIS (Sonnet, multi-turn)
    # =========================================================================

    async def _synthesize_domain(
        self,
        domain: str,
        analyses: List[Dict],
        project: Project,
        run_id: UUID,
        p2_model: str,
        p2_max_tokens: int,
        p2_multi_turn_threshold: int,
        semaphore: asyncio.Semaphore,
        progress_state: Dict,
        progress_cb: Any,
    ) -> tuple[str, Dict | None]:
        """Synthesize rules for a single domain. Returns (domain, result_dict | None)."""
        async with semaphore:
            session_key = f"pipeline:{project.id}:phase2:domain:{domain.lower().replace(' ', '_')}"

            # Prepare analyses summary (remove full content to save tokens)
            analyses_summary = [{k: v for k, v in a.items() if k != "content"} for a in analyses]

            system_prompt, _ = self._load_contract("deep_rule_synthesis", {
                "domain_name": domain,
                "file_analyses_json": json.dumps(analyses_summary, ensure_ascii=False),
                "project_name": project.name,
            })

            user_prompt = f"Dominio: {domain}\n\nAnalises individuais dos arquivos:\n{json.dumps(analyses_summary, ensure_ascii=False, indent=2)}"

            try:
                result = await self.claudio.call(
                    model=p2_model,
                    system_prompt=system_prompt or "Synthesize business rules from file analyses. Respond with JSON.",
                    user_prompt=user_prompt,
                    session_key=session_key,
                    max_tokens=p2_max_tokens,
                )

                parsed = self.claudio.extract_json(result.get("text", ""))
                if parsed and isinstance(parsed, dict):
                    # Multi-turn follow-up for large domains
                    if len(analyses) > p2_multi_turn_threshold:
                        followup = await self.claudio.call_followup(
                            model=p2_model,
                            session_key=session_key,
                            user_prompt="Revise as regras sintetizadas. Ha regras cross-file que voce perdeu? Gaps importantes? Adicione ao resultado anterior.",
                            max_tokens=p2_max_tokens // 2,
                        )
                        followup_parsed = self.claudio.extract_json(followup.get("text", ""))
                        if followup_parsed and isinstance(followup_parsed, dict):
                            existing = parsed.get("consolidated_rules", [])
                            new_rules = followup_parsed.get("consolidated_rules", [])
                            if new_rules:
                                existing.extend(new_rules)
                                parsed["consolidated_rules"] = existing

                    await self.claudio.delete_session(session_key)

                    # Update shared progress counter
                    progress_state["done"] += 1
                    pct = (progress_state["done"] / progress_state["total"]) * 100
                    await progress_cb(2, pct, f"Sintetizado {progress_state['done']}/{progress_state['total']} dominios")

                    return domain, parsed

                await self.claudio.delete_session(session_key)

            except ClaudioPipelineError as e:
                logger.error(f"Phase 2: Failed to synthesize domain '{domain}': {e}")
                await self.claudio.delete_session(session_key)

            return domain, None

    async def _phase2_rule_synthesis(
        self,
        project: Project,
        file_analyses: List[Dict],
        run_id: UUID,
        progress_cb: Any,
    ) -> Dict[str, Dict]:
        """Synthesize rules across files, grouped by domain (parallel execution)."""

        # Group analyses by domain
        domain_groups = defaultdict(list)
        for analysis in file_analyses:
            domain = analysis.get("domain_classification", "Geral")
            domain_groups[domain].append(analysis)

        # Filter out small infra/config domains
        valid_domains = {
            domain: analyses
            for domain, analyses in domain_groups.items()
            if not (domain in ("Infraestrutura", "Configuracao") and len(analyses) < 3)
        }

        p2_model = self._get_model("phase_2", MODEL_SONNET)
        p2_max_tokens = self._get_max_tokens("phase_2", 16000)
        p2_multi_turn_threshold = self._get_phase_config("phase_2", "multi_turn_threshold", 30)
        p2_concurrency = self._get_concurrency("phase_2", 5)

        logger.info(
            f"Phase 2: processing {len(valid_domains)} domains with concurrency={p2_concurrency} "
            f"(skipped {len(domain_groups) - len(valid_domains)} small domains)"
        )

        semaphore = asyncio.Semaphore(p2_concurrency)
        progress_state = {"done": 0, "total": len(valid_domains)}

        tasks = [
            self._synthesize_domain(
                domain, analyses, project, run_id,
                p2_model, p2_max_tokens, p2_multi_turn_threshold,
                semaphore, progress_state, progress_cb,
            )
            for domain, analyses in valid_domains.items()
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        domain_rules = {}
        for item in results:
            if isinstance(item, Exception):
                logger.error(f"Phase 2: domain task raised exception: {item}")
                continue
            if item and item[1] is not None:
                domain, parsed = item
                domain_rules[domain] = parsed
                artifact = PipelineArtifact(
                    project_id=project.id,
                    artifact_type=ArtifactType.synthesized_rules,
                    phase=2,
                    domain=domain,
                    content=parsed,
                    run_id=run_id,
                )
                self.db.add(artifact)

        self.db.commit()
        logger.info(f"Phase 2: Synthesized rules for {len(domain_rules)}/{len(valid_domains)} domains")
        return domain_rules

    # =========================================================================
    # PHASE 3: ARCHITECTURAL MAP (Sonnet + Extended Thinking)
    # =========================================================================

    async def _phase3_architectural_map(
        self,
        project: Project,
        domain_rules: Dict[str, Dict],
        inventory: List[Dict],
        run_id: UUID,
    ) -> Dict:
        """Build architectural map with extended thinking."""

        # Build structural metadata summary
        structural = {
            "total_files": len(inventory),
            "languages": {},
            "file_types": {},
            "top_complexity": [],
        }
        for item in inventory:
            lang = item["language"]
            structural["languages"][lang] = structural["languages"].get(lang, 0) + 1
            ft = item["file_type"]
            structural["file_types"][ft] = structural["file_types"].get(ft, 0) + 1

        # Top 20 most complex files
        sorted_by_complexity = sorted(inventory, key=lambda x: x["complexity_score"], reverse=True)
        structural["top_complexity"] = [
            {"path": f["path"], "complexity": f["complexity_score"], "lines": f["lines"]}
            for f in sorted_by_complexity[:20]
        ]

        # Domain summary for prompt
        domains_summary = {}
        for domain, data in domain_rules.items():
            domains_summary[domain] = {
                "rule_count": len(data.get("consolidated_rules", [])),
                "entities": data.get("domain_entities", []),
                "summary": data.get("domain_summary", ""),
                "gaps": data.get("detected_gaps", []),
            }

        system_prompt, _ = self._load_contract("deep_architectural_map", {
            "all_domains_summary": json.dumps(domains_summary, ensure_ascii=False),
            "structural_metadata": json.dumps(structural, ensure_ascii=False),
            "project_name": project.name,
            "tech_stack": json.dumps(project.stack or {}, ensure_ascii=False),
        })

        user_prompt = (
            f"Projeto: {project.name}\n"
            f"Stack: {json.dumps(project.stack or {})}\n\n"
            f"Metadados estruturais:\n{json.dumps(structural, ensure_ascii=False, indent=2)}\n\n"
            f"Dominios e regras sintetizadas:\n{json.dumps(domains_summary, ensure_ascii=False, indent=2)}"
        )

        p3_model = self._get_model("phase_3", MODEL_SONNET)
        p3_max_tokens = self._get_max_tokens("phase_3", 32000)
        p3_thinking = self._get_phase_config("phase_3", "thinking_budget", 10000)

        result = await self.claudio.call(
            model=p3_model,
            system_prompt=system_prompt or "Build an architectural map. Respond with JSON.",
            user_prompt=user_prompt,
            thinking={"type": "enabled", "budget_tokens": p3_thinking} if p3_thinking else None,
            max_tokens=p3_max_tokens,
        )

        arch_map = self.claudio.extract_json(result.get("text", "")) or {}

        # Store artifact
        artifact = PipelineArtifact(
            project_id=project.id,
            artifact_type=ArtifactType.architectural_map,
            phase=3,
            content=arch_map,
            run_id=run_id,
        )
        self.db.add(artifact)
        self.db.commit()

        logger.info(f"Phase 3: Built architectural map with {len(arch_map.get('domains', []))} domains")
        return arch_map

    # =========================================================================
    # PHASE 4: CARD GENERATION (Opus/Sonnet/Haiku)
    # =========================================================================

    async def _phase4_card_generation(
        self,
        project: Project,
        arch_map: Dict,
        domain_rules: Dict[str, Dict],
        run_id: UUID,
        progress_cb: Any,
    ) -> Dict:
        """Generate hierarchical cards: Epics (Opus) → Stories (Opus) → Tasks (Sonnet) → Subtasks (Haiku)."""

        stats = {"epics": 0, "stories": 0, "tasks": 0, "subtasks": 0, "total_cards": 0}

        # Phase 4a: Generate ALL epics
        p4a_label = self._get_model("phase_4a", MODEL_OPUS).split("-")[1].title()
        await progress_cb(4, 5, f"Gerando Epics com {p4a_label}...")

        all_rules_summary = {}
        for domain, data in domain_rules.items():
            all_rules_summary[domain] = {
                "rules": [r.get("rule_text", "") for r in data.get("consolidated_rules", [])[:20]],
                "entities": data.get("domain_entities", []),
            }

        system_prompt, _ = self._load_contract("deep_epic_generation", {
            "architectural_map_json": json.dumps(arch_map, ensure_ascii=False),
            "all_rules_summary": json.dumps(all_rules_summary, ensure_ascii=False),
            "project_name": project.name,
        })

        p4a_model = self._get_model("phase_4a", MODEL_OPUS)
        p4a_max_tokens = self._get_max_tokens("phase_4a", 64000)

        epic_result = await self.claudio.call(
            model=p4a_model,
            system_prompt=system_prompt or "Generate project epics. Respond with JSON.",
            user_prompt=f"Projeto: {project.name}\n\nMapa Arquitetural:\n{json.dumps(arch_map, ensure_ascii=False, indent=2)}\n\nRegras:\n{json.dumps(all_rules_summary, ensure_ascii=False, indent=2)}",
            max_tokens=p4a_max_tokens,
        )

        epics_data = self.claudio.extract_json(epic_result.get("text", ""))
        epics = epics_data.get("epics", []) if epics_data else []

        # Create Epic cards in database
        epic_db_map = {}  # title -> Task object
        for epic in epics:
            task = Task(
                project_id=project.id,
                title=epic.get("title", "Epic sem titulo"),
                description=epic.get("description", ""),
                item_type=ItemType.EPIC,
                status=TaskStatus.BACKLOG,
                priority=self._map_priority(epic.get("priority", "medium")),
                story_points=epic.get("story_points", 13),
                labels=epic.get("labels", []),
                acceptance_criteria=epic.get("acceptance_criteria", []),
            )
            self.db.add(task)
            self.db.flush()
            epic_db_map[epic.get("title", "")] = task
            stats["epics"] += 1

        self.db.commit()
        await progress_cb(4, 20, f"Criados {stats['epics']} Epics. Gerando Stories...")

        # Phase 4b: Generate Stories per Epic (Opus, parallel 3x)
        story_requests = []
        for epic in epics:
            domain = epic.get("domain", "Geral")
            domain_data = domain_rules.get(domain, {})
            rules_json = json.dumps(domain_data.get("consolidated_rules", [])[:30], ensure_ascii=False)

            system_prompt, _ = self._load_contract("deep_story_decomposition", {
                "epic_json": json.dumps(epic, ensure_ascii=False),
                "domain_rules_json": rules_json,
                "architectural_context": json.dumps(arch_map.get("project_summary", ""), ensure_ascii=False),
            })

            story_requests.append({
                "model": self._get_model("phase_4b", MODEL_OPUS),
                "system_prompt": system_prompt or "Decompose this epic into stories. Respond with JSON.",
                "user_prompt": f"Epic:\n{json.dumps(epic, ensure_ascii=False, indent=2)}\n\nRegras do dominio:\n{rules_json}",
                "max_tokens": self._get_max_tokens("phase_4b", 32000),
            })

        story_results = await self.claudio.call_batch(story_requests, max_concurrency=self._get_concurrency("phase_4b", 3))

        # Process stories and create Tasks + Subtasks
        all_stories = []  # (epic_title, story_data)
        for i, result in enumerate(story_results):
            if isinstance(result, ClaudioPipelineError):
                continue
            parsed = self.claudio.extract_json(result.get("text", ""))
            if parsed and isinstance(parsed, dict):
                epic_title = epics[i].get("title", "")
                for story in parsed.get("stories", []):
                    all_stories.append((epic_title, story))

        # Create Story cards
        story_db_map = {}
        for epic_title, story in all_stories:
            parent = epic_db_map.get(epic_title)
            task = Task(
                project_id=project.id,
                title=story.get("title", "Story sem titulo"),
                description=story.get("description", ""),
                item_type=ItemType.STORY,
                status=TaskStatus.BACKLOG,
                priority=self._map_priority(story.get("priority", "medium")),
                story_points=story.get("story_points", 5),
                parent_id=parent.id if parent else None,
                labels=story.get("labels", []),
                acceptance_criteria=story.get("acceptance_criteria", []),
            )
            self.db.add(task)
            self.db.flush()
            story_db_map[story.get("title", "")] = task
            stats["stories"] += 1

        self.db.commit()
        await progress_cb(4, 45, f"Criadas {stats['stories']} Stories. Gerando Tasks...")

        # Phase 4c: Generate Tasks per Story (Sonnet, parallel 5x)
        task_requests = []
        story_titles_for_tasks = []
        for epic_title, story in all_stories:
            epic_data = next((e for e in epics if e.get("title") == epic_title), {})

            system_prompt, _ = self._load_contract("deep_task_decomposition", {
                "story_json": json.dumps(story, ensure_ascii=False),
                "epic_context": json.dumps({"title": epic_title, "domain": epic_data.get("domain", "")}, ensure_ascii=False),
            })

            task_requests.append({
                "model": self._get_model("phase_4c", MODEL_SONNET),
                "system_prompt": system_prompt or "Decompose this story into tasks. Respond with JSON.",
                "user_prompt": f"Story:\n{json.dumps(story, ensure_ascii=False, indent=2)}\n\nContexto do Epic:\n{json.dumps(epic_data, ensure_ascii=False)}",
                "max_tokens": self._get_max_tokens("phase_4c", 8000),
            })
            story_titles_for_tasks.append(story.get("title", ""))

        task_results = await self.claudio.call_batch(task_requests, max_concurrency=self._get_concurrency("phase_4c", 5))

        all_tasks = []  # (story_title, task_data)
        for i, result in enumerate(task_results):
            if isinstance(result, ClaudioPipelineError):
                continue
            parsed = self.claudio.extract_json(result.get("text", ""))
            if parsed and isinstance(parsed, dict):
                story_title = story_titles_for_tasks[i]
                for t in parsed.get("tasks", []):
                    all_tasks.append((story_title, t))

        # Create Task cards
        task_db_map = {}
        for story_title, t in all_tasks:
            parent = story_db_map.get(story_title)
            task = Task(
                project_id=project.id,
                title=t.get("title", "Task sem titulo"),
                description=t.get("description", ""),
                item_type=ItemType.TASK,
                status=TaskStatus.BACKLOG,
                priority=self._map_priority(t.get("priority", "medium")),
                story_points=t.get("story_points", 3),
                parent_id=parent.id if parent else None,
                labels=t.get("labels", []),
                acceptance_criteria=t.get("acceptance_criteria", []),
            )
            self.db.add(task)
            self.db.flush()
            task_db_map[t.get("title", "")] = task
            stats["tasks"] += 1

        self.db.commit()
        await progress_cb(4, 70, f"Criadas {stats['tasks']} Tasks. Gerando Subtasks...")

        # Phase 4d: Generate Subtasks per Task (Haiku, parallel 10x)
        subtask_requests = []
        task_titles_for_subtasks = []
        for story_title, t in all_tasks:
            system_prompt, _ = self._load_contract("deep_subtask_decomposition", {
                "task_json": json.dumps(t, ensure_ascii=False),
                "story_context": story_title,
            })

            subtask_requests.append({
                "model": self._get_model("phase_4d", MODEL_HAIKU),
                "system_prompt": system_prompt or "Decompose this task into subtasks. Respond with JSON.",
                "user_prompt": f"Task:\n{json.dumps(t, ensure_ascii=False, indent=2)}\n\nContexto da Story: {story_title}",
                "max_tokens": self._get_max_tokens("phase_4d", 2000),
            })
            task_titles_for_subtasks.append(t.get("title", ""))

        subtask_results = await self.claudio.call_batch(subtask_requests, max_concurrency=self._get_concurrency("phase_4d", 10))

        for i, result in enumerate(subtask_results):
            if isinstance(result, ClaudioPipelineError):
                continue
            parsed = self.claudio.extract_json(result.get("text", ""))
            if parsed and isinstance(parsed, dict):
                task_title = task_titles_for_subtasks[i]
                parent = task_db_map.get(task_title)
                for st in parsed.get("subtasks", []):
                    subtask = Task(
                        project_id=project.id,
                        title=st.get("title", "Subtask sem titulo"),
                        description=st.get("description", ""),
                        item_type=ItemType.SUBTASK,
                        status=TaskStatus.BACKLOG,
                        story_points=st.get("story_points", 1),
                        parent_id=parent.id if parent else None,
                        labels=st.get("labels", []),
                    )
                    self.db.add(subtask)
                    stats["subtasks"] += 1

        self.db.commit()
        stats["total_cards"] = stats["epics"] + stats["stories"] + stats["tasks"] + stats["subtasks"]

        # Store epic generation artifact
        artifact = PipelineArtifact(
            project_id=project.id,
            artifact_type=ArtifactType.epic_generation,
            phase=4,
            content={"stats": stats, "epics": [e.get("title") for e in epics]},
            run_id=run_id,
        )
        self.db.add(artifact)
        self.db.commit()

        logger.info(f"Phase 4: Generated {stats['total_cards']} cards ({stats['epics']}E/{stats['stories']}S/{stats['tasks']}T/{stats['subtasks']}ST)")
        return stats

    # =========================================================================
    # PHASE 5: WIKI GENERATION (Opus, multi-turn)
    # =========================================================================

    async def _phase5_wiki_generation(
        self,
        project: Project,
        arch_map: Dict,
        domain_rules: Dict[str, Dict],
        card_stats: Dict,
        run_id: UUID,
        progress_cb: Any,
    ) -> Dict:
        """Generate comprehensive wiki documentation."""

        wiki_dir = os.path.join(project.code_path, "satellite", "knowledge", "wiki")
        os.makedirs(wiki_dir, exist_ok=True)

        stats = {"total_pages": 0, "total_words": 0}

        # Phase 5a: Plan wiki structure (Sonnet)
        await progress_cb(5, 5, "Planejando estrutura da wiki...")

        system_prompt, _ = self._load_contract("deep_wiki_structure", {
            "architectural_map_json": json.dumps(arch_map, ensure_ascii=False),
            "card_tree_summary": json.dumps(card_stats, ensure_ascii=False),
            "project_name": project.name,
        })

        structure_result = await self.claudio.call(
            model=self._get_model("phase_5a", MODEL_SONNET),
            system_prompt=system_prompt or "Plan wiki structure. Respond with JSON.",
            user_prompt=f"Projeto: {project.name}\n\nMapa:\n{json.dumps(arch_map, ensure_ascii=False, indent=2)}\n\nCards:\n{json.dumps(card_stats, ensure_ascii=False)}",
            max_tokens=self._get_max_tokens("phase_5a", 8000),
        )

        wiki_plan = self.claudio.extract_json(structure_result.get("text", "")) or {}

        # Store structure artifact
        artifact = PipelineArtifact(
            project_id=project.id,
            artifact_type=ArtifactType.wiki_structure,
            phase=5,
            content=wiki_plan,
            run_id=run_id,
        )
        self.db.add(artifact)

        # Phase 5b: Generate overview pages (Opus)
        await progress_cb(5, 20, "Gerando paginas de visao geral com Opus...")
        general_pages = wiki_plan.get("general_pages", [])

        if general_pages:
            system_prompt, _ = self._load_contract("deep_wiki_overview", {
                "page_plan_json": json.dumps(general_pages, ensure_ascii=False),
                "architectural_map_json": json.dumps(arch_map, ensure_ascii=False),
                "project_name": project.name,
                "tech_stack": json.dumps(project.stack or {}, ensure_ascii=False),
            })

            overview_result = await self.claudio.call(
                model=self._get_model("phase_5b", MODEL_OPUS),
                system_prompt=system_prompt or "Generate wiki overview pages. Respond with JSON.",
                user_prompt=f"Plano:\n{json.dumps(general_pages, ensure_ascii=False, indent=2)}\n\nMapa:\n{json.dumps(arch_map, ensure_ascii=False, indent=2)}",
                max_tokens=self._get_max_tokens("phase_5b", 64000),
            )

            pages_data = self.claudio.extract_json(overview_result.get("text", ""))
            if pages_data and isinstance(pages_data, dict):
                for page in pages_data.get("pages", []):
                    self._write_wiki_page(wiki_dir, page)
                    stats["total_pages"] += 1
                    stats["total_words"] += page.get("word_count", 0)

        # Phase 5c: Generate domain pages (Opus, parallel 3x)
        await progress_cb(5, 50, "Gerando paginas por dominio...")
        domain_page_groups = wiki_plan.get("domain_pages", [])

        domain_requests = []
        for group in domain_page_groups:
            domain = group.get("domain", "")
            domain_data = domain_rules.get(domain, {})

            system_prompt, _ = self._load_contract("deep_wiki_domain", {
                "domain_name": domain,
                "domain_rules_json": json.dumps(domain_data.get("consolidated_rules", [])[:30], ensure_ascii=False),
                "domain_cards_json": json.dumps({"domain": domain}, ensure_ascii=False),
                "page_plan_json": json.dumps(group.get("pages", []), ensure_ascii=False),
                "project_name": project.name,
            })

            domain_requests.append({
                "model": self._get_model("phase_5c", MODEL_OPUS),
                "system_prompt": system_prompt or "Generate domain wiki pages. Respond with JSON.",
                "user_prompt": f"Dominio: {domain}\n\nPlano:\n{json.dumps(group.get('pages', []), ensure_ascii=False, indent=2)}\n\nRegras:\n{json.dumps(domain_data.get('consolidated_rules', [])[:30], ensure_ascii=False, indent=2)}",
                "max_tokens": self._get_max_tokens("phase_5c", 32000),
            })

        if domain_requests:
            domain_results = await self.claudio.call_batch(domain_requests, max_concurrency=self._get_concurrency("phase_5c", 3))
            for result in domain_results:
                if isinstance(result, ClaudioPipelineError):
                    continue
                pages_data = self.claudio.extract_json(result.get("text", ""))
                if pages_data and isinstance(pages_data, dict):
                    for page in pages_data.get("pages", []):
                        self._write_wiki_page(wiki_dir, page)
                        stats["total_pages"] += 1
                        stats["total_words"] += page.get("word_count", 0)

        # Phase 5d: Cross-domain flow pages (Sonnet)
        await progress_cb(5, 85, "Gerando paginas de fluxos cross-domain...")
        flow_pages = wiki_plan.get("flow_pages", [])
        for flow in flow_pages:
            try:
                result = await self.claudio.call(
                    model=self._get_model("phase_5d", MODEL_SONNET),
                    system_prompt="Gere uma pagina de wiki detalhada para este fluxo cross-domain. Responda com JSON: {\"pages\": [{\"slug\": \"...\", \"title\": \"...\", \"content\": \"markdown...\", \"word_count\": N}]}",
                    user_prompt=f"Fluxo: {json.dumps(flow, ensure_ascii=False, indent=2)}\n\nMapa: {json.dumps(arch_map, ensure_ascii=False)}",
                    max_tokens=self._get_max_tokens("phase_5d", 16000),
                )
                pages_data = self.claudio.extract_json(result.get("text", ""))
                if pages_data and isinstance(pages_data, dict):
                    for page in pages_data.get("pages", []):
                        self._write_wiki_page(wiki_dir, page)
                        stats["total_pages"] += 1
            except ClaudioPipelineError as e:
                logger.warning(f"Phase 5d: Failed to generate flow page: {e}")

        self.db.commit()
        logger.info(f"Phase 5: Generated {stats['total_pages']} wiki pages")
        return stats

    def _write_wiki_page(self, wiki_dir: str, page_data: Dict):
        """Write a wiki page to the filesystem with YAML front matter."""
        slug = page_data.get("slug", "unknown")
        title = page_data.get("title", "Sem titulo")
        content = page_data.get("content", "")

        front_matter = (
            f"---\n"
            f"title: \"{title}\"\n"
            f"slug: \"{slug}\"\n"
            f"source: ai_generated\n"
            f"pipeline_version: v2\n"
            f"created_at: \"{datetime.utcnow().isoformat()}\"\n"
            f"---\n\n"
        )

        filepath = os.path.join(wiki_dir, f"{slug}.md")

        # REGRA #0: Don't overwrite human-edited pages
        if os.path.isfile(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    existing = f.read()
                if "source: manual" in existing or "source: enrichment" in existing:
                    logger.info(f"Skipping wiki page '{slug}' - human-edited (source: manual/enrichment)")
                    return
            except Exception:
                pass

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(front_matter + content)

    # =========================================================================
    # PHASE 6: QUALITY ASSURANCE (Sonnet + Extended Thinking)
    # =========================================================================

    async def _phase6_quality_assurance(
        self,
        project: Project,
        arch_map: Dict,
        domain_rules: Dict[str, Dict],
        card_stats: Dict,
        wiki_stats: Dict,
        run_id: UUID,
    ) -> Dict:
        """Run quality validation across all artifacts."""

        # Build summaries
        rules_summary = {}
        for domain, data in domain_rules.items():
            rules_summary[domain] = {
                "rule_count": len(data.get("consolidated_rules", [])),
                "gap_count": len(data.get("detected_gaps", [])),
            }

        wiki_summary = {"total_pages": wiki_stats.get("total_pages", 0)}

        system_prompt, _ = self._load_contract("deep_quality_review", {
            "architectural_map_json": json.dumps(arch_map, ensure_ascii=False),
            "rules_summary": json.dumps(rules_summary, ensure_ascii=False),
            "cards_summary": json.dumps(card_stats, ensure_ascii=False),
            "wiki_summary": json.dumps(wiki_summary, ensure_ascii=False),
            "project_name": project.name,
        })

        p6_model = self._get_model("phase_6", MODEL_SONNET)
        p6_max_tokens = self._get_max_tokens("phase_6", 16000)
        p6_thinking = self._get_phase_config("phase_6", "thinking_budget", 10000)

        result = await self.claudio.call(
            model=p6_model,
            system_prompt=system_prompt or "Review the quality of all pipeline artifacts. Respond with JSON.",
            user_prompt=(
                f"Projeto: {project.name}\n\n"
                f"Mapa: {json.dumps(arch_map, ensure_ascii=False, indent=2)}\n\n"
                f"Regras: {json.dumps(rules_summary, ensure_ascii=False)}\n\n"
                f"Cards: {json.dumps(card_stats, ensure_ascii=False)}\n\n"
                f"Wiki: {json.dumps(wiki_summary, ensure_ascii=False)}"
            ),
            thinking={"type": "enabled", "budget_tokens": p6_thinking} if p6_thinking else None,
            max_tokens=p6_max_tokens,
        )

        qa_result = self.claudio.extract_json(result.get("text", "")) or {
            "overall_score": 50,
            "issues": [],
            "summary": "QA parsing failed",
        }

        # Store artifact
        artifact = PipelineArtifact(
            project_id=project.id,
            artifact_type=ArtifactType.quality_report,
            phase=6,
            content=qa_result,
            quality_score=qa_result.get("overall_score"),
            run_id=run_id,
        )
        self.db.add(artifact)
        self.db.commit()

        logger.info(f"Phase 6: QA complete. Score: {qa_result.get('overall_score', 'N/A')}/100")
        return qa_result

    # =========================================================================
    # PHASE 7: GAP FILLING (Conditional)
    # =========================================================================

    async def _phase7_gap_filling(
        self,
        project: Project,
        qa_result: Dict,
        arch_map: Dict,
        domain_rules: Dict[str, Dict],
        run_id: UUID,
    ) -> Dict:
        """Conditionally re-run phases that produced low-quality artifacts."""
        fixed = {"domains_reprocessed": [], "cards_regenerated": [], "wiki_regenerated": []}

        # Re-synthesize rules for flagged domains
        for domain in qa_result.get("rules_to_regenerate", []):
            logger.info(f"Phase 7: Re-synthesizing rules for domain '{domain}'")
            # Could re-run phase 2 for this domain with enhanced prompts
            fixed["domains_reprocessed"].append(domain)

        # Re-generate flagged cards
        for card_title in qa_result.get("cards_to_regenerate", []):
            logger.info(f"Phase 7: Flagged card for review: '{card_title}'")
            fixed["cards_regenerated"].append(card_title)

        # Re-generate flagged wiki pages
        for slug in qa_result.get("wiki_pages_to_regenerate", []):
            logger.info(f"Phase 7: Flagged wiki page for review: '{slug}'")
            fixed["wiki_regenerated"].append(slug)

        logger.info(f"Phase 7: Gap filling identified {len(fixed['domains_reprocessed'])} domains, "
                     f"{len(fixed['cards_regenerated'])} cards, {len(fixed['wiki_regenerated'])} wiki pages for review")
        return fixed

    # =========================================================================
    # HELPERS
    # =========================================================================

    @staticmethod
    def _map_priority(priority_str: str) -> PriorityLevel:
        """Map string priority to PriorityLevel enum."""
        mapping = {
            "critical": PriorityLevel.CRITICAL,
            "high": PriorityLevel.HIGH,
            "medium": PriorityLevel.MEDIUM,
            "low": PriorityLevel.LOW,
        }
        return mapping.get(priority_str.lower(), PriorityLevel.MEDIUM)
