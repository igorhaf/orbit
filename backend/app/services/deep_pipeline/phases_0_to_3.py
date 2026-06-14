"""
Deep Pipeline - Phases 0 to 3 Mixin.

Phase 0: Structural scan (filesystem, no AI)
Phase 1: Per-file analysis (Haiku, parallel micro-batches)
Phase 2: Cross-file rule synthesis (Sonnet, multi-turn)
Phase 3: Architectural map (Sonnet + extended thinking)
"""

import asyncio
import json
import logging
import os
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.models.pipeline_artifact import PipelineArtifact, ArtifactType
from app.models.pipeline_run import PipelineRun
from app.models.project import Project
from app.services.claudius_pipeline import (
    ClaudiusPipelineError,
    ClaudiusQuotaExhaustedError,
    MODEL_HAIKU,
    MODEL_SONNET,
)

from .utils import (
    CODE_EXTENSIONS,
    COMPLEXITY_KEYWORDS,
    IGNORE_DIRECTORIES,
    MAX_FILE_SIZE,
    SKIP_EXTENSIONS,
)

logger = logging.getLogger(__name__)


class Phase0to3Mixin:
    """Mixin providing Phase 0 through Phase 3 of the deep pipeline."""

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

    # =========================================================================
    # PHASE 1: PER-FILE ANALYSIS (Haiku, parallel micro-batches)
    # =========================================================================

    async def _phase1_file_analysis(
        self,
        project: Project,
        inventory: List[Dict],
        run_id: UUID,
        progress_cb: Any,
        pipeline_run: PipelineRun = None,
    ) -> List[Dict]:
        """
        Analyze each file individually with Haiku in parallel micro-batches.

        Uses proportional batch sizing (total/25) with checkpoint/resume
        and brief pause between batches.
        """
        BATCH_DIVISOR = 25

        system_prompt, _ = self._load_contract("deep_file_analysis", {
            "file_path": "placeholder",
            "file_content": "placeholder",
            "project_name": project.name,
        })
        if not system_prompt:
            system_prompt = "Analyze the code file and extract business rules. Respond with JSON only."

        # Model/tokens/concurrency from profile
        p1_model = self._get_model("phase_1", MODEL_HAIKU)
        p1_max_tokens = self._get_max_tokens("phase_1", 2000)
        p1_concurrency = self._get_concurrency("phase_1", 10)
        p1_ollama = self._ollama_kwargs("phase_1")

        # Proportional batch size: always ~25 batches
        batch_size = max(5, len(inventory) // BATCH_DIVISOR)
        total_files = len(inventory)
        logger.info(f"Phase 1: {total_files} files -> batch_size={batch_size}")

        # ── Checkpoint resume: skip already-analyzed files ──
        checkpoint = (pipeline_run.checkpoint_state or {}) if pipeline_run else {}
        completed_files = set(checkpoint.get("completed_files", []))

        if completed_files:
            # Load existing artifacts from DB
            existing = self.db.query(PipelineArtifact).filter(
                PipelineArtifact.run_id == run_id,
                PipelineArtifact.phase == 1,
            ).all()
            file_analyses = [a.content for a in existing]
            logger.info(f"Phase 1: Resuming -- {len(completed_files)} already done, "
                        f"{total_files - len(completed_files)} remaining")
        else:
            file_analyses = []

        # Skip file types unlikely to contain business rules. Their domain
        # signal in the architectural map (Phase 3) is negligible vs the cost
        # of sending full content to Haiku. Marked as completed so checkpoint
        # resume doesn't reprocess them.
        SKIP_FILE_TYPES = {"test", "migration", "config"}
        for item in inventory:
            if item.get("file_type") in SKIP_FILE_TYPES:
                completed_files.add(item["path"])

        pending = [
            item for item in inventory
            if item["path"] not in completed_files
            and item.get("file_type") not in SKIP_FILE_TYPES
        ]

        if not pending:
            logger.info(f"Phase 1: All {total_files} files already analyzed (checkpoint)")
            return file_analyses

        skipped_by_type = sum(1 for it in inventory if it.get("file_type") in SKIP_FILE_TYPES)
        if skipped_by_type:
            logger.info(
                f"Phase 1: Skipping {skipped_by_type} files of types {SKIP_FILE_TYPES} "
                f"(no business-rule signal worth Haiku cost)"
            )

        # ── Telemetry counter (tracks across all batches) ──
        _global_done = [len(completed_files)]

        # ── Process in micro-batches ──
        for batch_start in range(0, len(pending), batch_size):
            batch = pending[batch_start:batch_start + batch_size]
            batch_num = (batch_start // batch_size) + 1
            total_batches = -(-len(pending) // batch_size)  # ceil division

            # Health check before each batch
            if not await self._provider_health_check(p1_model, p1_ollama):
                logger.error("Phase 1: Provider not responding -- saving checkpoint")
                if pipeline_run:
                    self._save_checkpoint(pipeline_run, 1, completed_files)
                raise ClaudiusPipelineError(
                    f"Provider offline after {len(completed_files)}/{total_files} files -- checkpoint saved, resume later"
                )

            # Build batch requests. Cap content at ~8KB per file: imports,
            # class/function signatures and the first few bodies fit easily;
            # tails of long files rarely add new business rules and inflate
            # cost linearly with size.
            MAX_PROMPT_CONTENT = 8000
            batch_requests = []
            for item in batch:
                content = item['content']
                if len(content) > MAX_PROMPT_CONTENT:
                    head = content[: int(MAX_PROMPT_CONTENT * 0.75)]
                    tail = content[-int(MAX_PROMPT_CONTENT * 0.25):]
                    content = f"{head}\n\n# ... [truncated {len(item['content']) - MAX_PROMPT_CONTENT} chars] ...\n\n{tail}"
                user_prompt = f"Arquivo: {item['path']}\n\nCodigo:\n{content}"
                batch_requests.append({
                    "model": p1_model,
                    "system_prompt": system_prompt,
                    "user_prompt": user_prompt,
                    "max_tokens": p1_max_tokens,
                    # Per-file analysis: prompt = path + (truncated) content, fully
                    # deterministic. Identical on re-run of an unchanged file →
                    # cache hit, no quota spent. Biggest single cache win.
                    "cacheable": True,
                    **p1_ollama,
                })

            # Telemetry callback for this batch
            async def _on_file_done(index: int, result: Any, total: int):
                _global_done[0] += 1
                done = _global_done[0]
                item_path = batch[index]["path"] if index < len(batch) else f"item-{index}"
                await self._emit_telemetry(
                    "phase_1", "file_analysis", item_path,
                    done, total_files, model_name=p1_model, result=result,
                )

            # Execute micro-batch with global timeout
            batch_timeout = batch_size * 180  # 3 min max per file
            try:
                results = await asyncio.wait_for(
                    self.claudius.call_batch(
                        batch_requests,
                        max_concurrency=p1_concurrency,
                        on_item_complete=_on_file_done,
                    ),
                    timeout=batch_timeout,
                )
            except asyncio.TimeoutError:
                logger.error(f"Phase 1: Batch {batch_num}/{total_batches} timed out -- saving checkpoint")
                if pipeline_run:
                    self._save_checkpoint(pipeline_run, 1, completed_files)
                raise ClaudiusPipelineError(
                    f"Batch {batch_num} timeout after {batch_timeout}s -- checkpoint saved"
                )

            # Process results and store artifacts
            for i, result in enumerate(results):
                file_path = batch[i]["path"]
                if isinstance(result, ClaudiusPipelineError):
                    logger.warning(f"Phase 1: Failed {file_path}: {result}")
                    completed_files.add(file_path)
                    continue

                parsed = self.claudius.extract_json(result.get("text", ""))
                if parsed and isinstance(parsed, dict):
                    parsed["file_path"] = file_path
                    parsed["file_type"] = batch[i]["file_type"]
                    parsed["lines"] = batch[i]["lines"]
                    parsed["complexity_score"] = batch[i]["complexity_score"]
                    file_analyses.append(parsed)

                    artifact = PipelineArtifact(
                        project_id=project.id,
                        artifact_type=ArtifactType.file_analysis,
                        phase=1,
                        domain=parsed.get("domain_classification", "Unknown"),
                        source_path=file_path,
                        content=parsed,
                        run_id=run_id,
                    )
                    self.db.add(artifact)

                completed_files.add(file_path)

            # Commit + checkpoint after each batch
            if pipeline_run:
                self._save_checkpoint(pipeline_run, 1, completed_files)
            self.db.commit()

            # Progress update
            done_total = len(completed_files)
            pct = (done_total / total_files) * 100
            await progress_cb(1, pct,
                f"Analisados {done_total}/{total_files} arquivos (batch {batch_num}/{total_batches})")

            # Pause between batches to avoid overloading the provider.
            # Claudius already retries on 429; 5s was over-conservative and added
            # ~2 min of pure idle on 256-file projects.
            if batch_start + batch_size < len(pending):
                await asyncio.sleep(1)

        # Clear checkpoint on successful completion
        if pipeline_run and pipeline_run.checkpoint_state:
            pipeline_run.checkpoint_state = None
            self.db.commit()

        logger.info(f"Phase 1: Analyzed {len(file_analyses)}/{total_files} files successfully")
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
        quota_state: Dict | None = None,
    ) -> tuple[str, Dict | None]:
        """Synthesize rules for a single domain. Returns (domain, result_dict | None)."""
        async with semaphore:
            # Abort early se outro coro ja detectou cota
            if quota_state and quota_state.get("hit"):
                raise quota_state.get("error") or ClaudiusQuotaExhaustedError(
                    "Phase 2: cota detectada em outro dominio, abortando"
                )
            session_key = f"pipeline:{project.id}:phase2:domain:{domain.lower().replace(' ', '_')}"

            # Prepare analyses summary (remove full content to save tokens)
            analyses_summary = [{k: v for k, v in a.items() if k != "content"} for a in analyses]

            system_prompt, _ = self._load_contract("deep_rule_synthesis", {
                "domain_name": domain,
                "file_analyses_json": json.dumps(analyses_summary, ensure_ascii=False),
                "project_name": project.name,
            })

            # Compact JSON (no indent) to save tokens
            analyses_compact = json.dumps(analyses_summary, ensure_ascii=False, separators=(",", ":"))
            user_prompt = f"Dominio: {domain}\n\nAnalises individuais dos arquivos:\n{analyses_compact}"

            p2_ollama = self._ollama_kwargs("phase_2")
            try:
                result = await self.claudius.call(
                    model=p2_model,
                    system_prompt=system_prompt or "Synthesize business rules from file analyses. Respond with JSON.",
                    user_prompt=user_prompt,
                    session_key=session_key,
                    max_tokens=p2_max_tokens,
                    **p2_ollama,
                )

                # PROMPT #237: Emit per-domain telemetry
                await self._emit_telemetry(
                    "phase_2", "domain_synthesis",
                    f"Dominio: {domain} ({len(analyses)} files)",
                    progress_state["done"] + 1, progress_state["total"],
                    model_name=p2_model, result=result,
                )

                parsed = self.claudius.extract_json(result.get("text", ""))
                if parsed and isinstance(parsed, dict):
                    # Multi-turn follow-up for large domains
                    if len(analyses) > p2_multi_turn_threshold:
                        followup = await self.claudius.call_followup(
                            model=p2_model,
                            session_key=session_key,
                            user_prompt="Revise as regras sintetizadas. Ha regras cross-file que voce perdeu? Gaps importantes? Adicione ao resultado anterior.",
                            max_tokens=p2_max_tokens // 2,
                            **p2_ollama,
                        )
                        followup_parsed = self.claudius.extract_json(followup.get("text", ""))
                        if followup_parsed and isinstance(followup_parsed, dict):
                            existing = parsed.get("consolidated_rules", [])
                            new_rules = followup_parsed.get("consolidated_rules", [])
                            if new_rules:
                                existing.extend(new_rules)
                                parsed["consolidated_rules"] = existing

                    await self.claudius.delete_session(session_key)

                    # Update shared progress counter
                    progress_state["done"] += 1
                    pct = (progress_state["done"] / progress_state["total"]) * 100
                    await progress_cb(2, pct, f"Sintetizado {progress_state['done']}/{progress_state['total']} dominios")

                    return domain, parsed

                await self.claudius.delete_session(session_key)

            except ClaudiusQuotaExhaustedError as e:
                # Cota da assinatura Claude esgotada -- sinalizar outros coros e abortar
                if quota_state is not None:
                    quota_state["hit"] = True
                    quota_state["error"] = e
                try:
                    await self.claudius.delete_session(session_key)
                except Exception:
                    pass
                raise
            except ClaudiusPipelineError as e:
                logger.error(f"Phase 2: Failed to synthesize domain '{domain}': {e}")
                try:
                    await self.claudius.delete_session(session_key)
                except Exception:
                    pass

            # Update progress even on failure so it reaches 100%
            progress_state["done"] += 1
            pct = (progress_state["done"] / progress_state["total"]) * 100
            await progress_cb(2, pct, f"Sintetizado {progress_state['done']}/{progress_state['total']} dominios")

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
        p2_max_tokens = self._get_max_tokens("phase_2", 8000)
        p2_multi_turn_threshold = self._get_phase_config("phase_2", "multi_turn_threshold", 30)
        p2_concurrency = self._get_concurrency("phase_2", 5)

        logger.info(
            f"Phase 2: processing {len(valid_domains)} domains with concurrency={p2_concurrency} "
            f"(skipped {len(domain_groups) - len(valid_domains)} small domains)"
        )

        semaphore = asyncio.Semaphore(p2_concurrency)
        progress_state = {"done": 0, "total": len(valid_domains)}
        # Shared flag: se qualquer coro detectar cota, abortar restantes imediatamente
        quota_state = {"hit": False, "error": None}

        tasks = [
            asyncio.create_task(
                self._synthesize_domain(
                    domain, analyses, project, run_id,
                    p2_model, p2_max_tokens, p2_multi_turn_threshold,
                    semaphore, progress_state, progress_cb,
                    quota_state,
                )
            )
            for domain, analyses in valid_domains.items()
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        domain_rules = {}
        for item in results:
            if isinstance(item, ClaudiusQuotaExhaustedError):
                quota_state["hit"] = True
                quota_state["error"] = item
                continue
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

        # Se cota esgotou, abortar pipeline em vez de prosseguir pra Fase 3 com dados parciais
        if quota_state["hit"]:
            raise quota_state["error"] or ClaudiusQuotaExhaustedError(
                f"Phase 2: cota Claude esgotada apos {len(domain_rules)}/{len(valid_domains)} dominios"
            )

        return domain_rules

    # =========================================================================
    # PHASE 3: ARCHITECTURAL MAP (Sonnet + Extended Thinking)
    # =========================================================================

    # Domain batch size for Phase 3. WHY this is the fix for the pipeline dying
    # at Phase 3 ("architectural_map vazio"):
    #   • Root cause was NOT a parse bug — it was OUTPUT VOLUME. A single call
    #     over all 62 Varanda domains had to generate a huge structured JSON;
    #     measured live, even 20 domains take ~291s to generate (~17.6K output
    #     tokens), right at the old 300s client timeout. The call timed out, its
    #     text came back empty/partial, extract_json() returned {}, and the
    #     `or {}` swallowed it silently.
    #   • Generation time tracks OUTPUT tokens, not domain count, and the model
    #     is unpredictable about verbosity (live: 5 domains → 14.4K tok/247s,
    #     8 domains → 10.6K tok/187s). So we keep batches modest AND raised the
    #     Sonnet client timeout to 600s (claudius_pipeline) for headroom.
    #   • 10 domains/batch keeps expected output ~12-15K tokens (~200-250s) with
    #     ~2.5x margin under the 600s timeout, while NOT collapsing domains
    #     (domain count is a tracked metric — must never be reduced to "fix" this).
    P3_DOMAIN_BATCH_SIZE = 10
    # Generous per-call timeout for Phase 3's large structured-JSON generation.
    P3_CALL_TIMEOUT_S = 600

    async def _phase3_architectural_map(
        self,
        project: Project,
        domain_rules: Dict[str, Dict],
        inventory: List[Dict],
        run_id: UUID,
    ) -> Dict:
        """Build architectural map with extended thinking.

        Domains are processed in batches and the partial maps are merged, so a
        large project (many domains) never overflows the model context window.
        """

        # Build structural metadata summary (shared across all batches)
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

        # Per-domain summary used to build each batch prompt
        domains_summary = {}
        for domain, data in domain_rules.items():
            domains_summary[domain] = {
                "rule_count": len(data.get("consolidated_rules", [])),
                "entities": data.get("domain_entities", []),
                "summary": data.get("domain_summary", ""),
                "gaps": data.get("detected_gaps", []),
            }

        domain_names = list(domains_summary.keys())
        batches = [
            domain_names[i:i + self.P3_DOMAIN_BATCH_SIZE]
            for i in range(0, len(domain_names), self.P3_DOMAIN_BATCH_SIZE)
        ]
        total_batches = len(batches) or 1

        p3_model = self._get_model("phase_3", MODEL_SONNET)
        p3_max_tokens = self._get_max_tokens("phase_3", 16000)
        # Phase 3 input is already a digest of Phase 2 (rules synth per domain).
        # 10K thinking was overkill — the heavy reasoning happened in Phase 2.
        # 4K keeps the structured-thought benefit at ~60% lower output cost.
        p3_thinking = self._get_phase_config("phase_3", "thinking_budget", 4000)

        _compact = lambda obj: json.dumps(obj, ensure_ascii=False, separators=(",", ":"))

        # Build one request per batch and run them in PARALLEL. WHY: the 33s CLI
        # overhead + ~200s generation per batch parallelizes linearly, so 7
        # sequential batches (~26min) collapse to ~one batch of wall-time when
        # run concurrently. Mirrors Phase 1 / Phase 5c which already use
        # call_batch. Concurrency is bounded by quota, not time.
        requests = []
        batch_domain_counts = []
        for batch_idx, batch_domains in enumerate(batches):
            batch_summary = {d: domains_summary[d] for d in batch_domains}
            batch_label = f"batch {batch_idx + 1}/{total_batches}"

            system_prompt, _ = self._load_contract("deep_architectural_map", {
                "all_domains_summary": json.dumps(batch_summary, ensure_ascii=False),
                "structural_metadata": json.dumps(structural, ensure_ascii=False),
                "project_name": project.name,
                "tech_stack": json.dumps(project.stack or {}, ensure_ascii=False),
            })
            user_prompt = (
                f"Projeto: {project.name}\n"
                f"Stack: {_compact(project.stack or {})}\n\n"
                f"Metadados estruturais:\n{_compact(structural)}\n\n"
                f"Dominios e regras sintetizadas ({batch_label}, {len(batch_domains)} dominios):\n"
                f"{_compact(batch_summary)}"
            )
            requests.append({
                "model": p3_model,
                "system_prompt": system_prompt or "Build an architectural map. Respond with JSON.",
                "user_prompt": user_prompt,
                "thinking": {"type": "enabled", "budget_tokens": p3_thinking} if p3_thinking else None,
                "max_tokens": p3_max_tokens,
                "timeout": self.P3_CALL_TIMEOUT_S,
                "cacheable": True,
                **self._ollama_kwargs("phase_3"),
            })
            batch_domain_counts.append(len(batch_domains))

        p3_done = [0]

        async def _on_p3_done(index: int, result: Any, total: int):
            p3_done[0] += 1
            await self._emit_telemetry(
                "phase_3", "architectural_map",
                f"Mapa arquitetural: batch {index + 1}/{total} "
                f"({batch_domain_counts[index]} dominios)",
                p3_done[0], total, model_name=p3_model, result=result,
            )

        # call_batch raises ClaudiusQuotaExhaustedError up if quota is hit.
        results = await self.claudius.call_batch(
            requests,
            max_concurrency=self._get_concurrency("phase_3", 5),
            on_item_complete=_on_p3_done,
        )

        partial_maps: List[Dict] = []
        failed_batches = 0
        for batch_idx, result in enumerate(results):
            batch_label = f"batch {batch_idx + 1}/{total_batches}"
            if isinstance(result, ClaudiusPipelineError):
                failed_batches += 1
                logger.error(f"[Phase 3] {batch_label} failed: {result}")
                continue

            raw_text = result.get("text", "") or ""
            stop_reason = result.get("stop_reason", "")
            part = self.claudius.extract_json(raw_text)

            if not part or not isinstance(part, dict) or len(part) == 0:
                # NOT silent: log exactly why this batch produced nothing so a
                # future failure is debuggable instead of a mystery "vazio".
                failed_batches += 1
                logger.error(
                    f"[Phase 3] {batch_label} produced no parseable JSON "
                    f"(stop_reason={stop_reason!r}, raw_len={len(raw_text)}). "
                    f"First 200 chars: {raw_text[:200]!r}"
                )
                continue

            partial_maps.append(part)
            logger.info(
                f"[Phase 3] {batch_label}: {len(part.get('domains', []))} domains mapped"
            )

        # Only abort if EVERY batch failed — a partial map is still useful and
        # lets the pipeline complete end-to-end instead of dying outright.
        if not partial_maps:
            raise ClaudiusPipelineError(
                f"Phase 3: architectural_map vazio -- todos os {total_batches} "
                f"batches falharam ao retornar JSON valido (ver logs por batch)"
            )

        arch_map = self._merge_architectural_maps(partial_maps)
        if failed_batches:
            logger.warning(
                f"[Phase 3] {failed_batches}/{total_batches} batches falharam; "
                f"mapa montado a partir de {len(partial_maps)} batches validos"
            )

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

        logger.info(
            f"Phase 3: Built architectural map with {len(arch_map.get('domains', []))} "
            f"domains across {len(partial_maps)}/{total_batches} batches"
        )
        return arch_map

    @staticmethod
    def _merge_architectural_maps(partials: List[Dict]) -> Dict:
        """Merge per-batch architectural maps into one.

        List fields are concatenated (domains, cross_domain_flows,
        missing_domains, tech_debt_indicators); architectural_patterns is
        de-duplicated; numeric recommendations are summed; project_summary uses
        the longest non-empty one (most informative). Single-batch input is
        returned essentially unchanged.
        """
        if len(partials) == 1:
            return partials[0]

        merged: Dict[str, Any] = {
            "domains": [],
            "cross_domain_flows": [],
            "missing_domains": [],
            "architectural_patterns": [],
            "tech_debt_indicators": [],
            "recommended_epic_total": 0,
            "recommended_wiki_pages": 0,
        }
        seen_patterns = set()
        summaries: List[str] = []

        for part in partials:
            for key in ("domains", "cross_domain_flows", "missing_domains", "tech_debt_indicators"):
                val = part.get(key)
                if isinstance(val, list):
                    merged[key].extend(val)
            for pat in part.get("architectural_patterns", []) or []:
                k = pat.strip().lower() if isinstance(pat, str) else str(pat)
                if k and k not in seen_patterns:
                    seen_patterns.add(k)
                    merged["architectural_patterns"].append(pat)
            for num_key in ("recommended_epic_total", "recommended_wiki_pages"):
                v = part.get(num_key)
                if isinstance(v, (int, float)):
                    merged[num_key] += int(v)
            ps = part.get("project_summary")
            if isinstance(ps, str) and ps.strip():
                summaries.append(ps.strip())

        merged["project_summary"] = max(summaries, key=len) if summaries else ""
        return merged
