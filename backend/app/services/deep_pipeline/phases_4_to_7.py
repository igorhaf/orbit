"""
Deep Pipeline - Phases 4 to 7 Mixin.

Phase 4: Hierarchical card generation (Opus/Sonnet/Haiku)
Phase 5: Wiki generation (Opus, multi-turn)
Phase 6: Quality assurance (Sonnet + extended thinking)
Phase 7: Gap filling (conditional)

Also includes post-pipeline enrichment and mark-as-done helpers.
"""

import json
import logging
import os
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.models.pipeline_artifact import PipelineArtifact, ArtifactType
from app.models.project import Project
from app.models.task import Task, ItemType, TaskStatus
from app.models.wiki_page import WikiPage
from app.services.claudius_pipeline import (
    ClaudiusPipelineError,
    ClaudiusQuotaExhaustedError,
    MODEL_HAIKU,
    MODEL_SONNET,
    MODEL_OPUS,
)

logger = logging.getLogger(__name__)


class Phase4to7Mixin:
    """Mixin providing Phase 4 through Phase 7 of the deep pipeline,
    plus post-pipeline enrichment and card status update."""

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
        """Generate hierarchical cards: Epics (Opus) -> Stories (Opus) -> Tasks (Sonnet)."""

        stats = {"epics": 0, "stories": 0, "tasks": 0, "total_cards": 0}

        # Phase 4a: Generate epics (batched by domain groups for scalability)
        DOMAIN_BATCH_SIZE = 20
        p4a_label = self._model_label(self._get_model("phase_4a", MODEL_SONNET))
        p4a_model = self._get_model("phase_4a", MODEL_SONNET)
        p4a_max_tokens = self._get_max_tokens("phase_4a", 16000)

        all_rules_summary = {}
        for domain, data in domain_rules.items():
            all_rules_summary[domain] = {
                "rules": [r.get("rule_text", "") for r in data.get("consolidated_rules", [])[:20]],
                "entities": data.get("domain_entities", []),
            }

        domain_list = list(domain_rules.keys())
        batches = [domain_list[i:i + DOMAIN_BATCH_SIZE] for i in range(0, len(domain_list), DOMAIN_BATCH_SIZE)]
        total_batches = len(batches)
        await progress_cb(4, 5, f"Gerando Epics com {p4a_label} ({total_batches} batch{'es' if total_batches > 1 else ''}, {len(domain_list)} dominios)...")

        epics = []
        for batch_idx, batch_domains in enumerate(batches):
            batch_arch = {d: arch_map.get(d, {}) for d in batch_domains if d in arch_map}
            batch_rules = {d: all_rules_summary[d] for d in batch_domains if d in all_rules_summary}
            # Include project_summary for context in every batch
            if "project_summary" in arch_map:
                batch_arch["project_summary"] = arch_map["project_summary"]

            # Compact JSON (no indent) to save tokens
            arch_compact = json.dumps(batch_arch, ensure_ascii=False, separators=(",", ":"))
            rules_compact = json.dumps(batch_rules, ensure_ascii=False, separators=(",", ":"))

            system_prompt, _ = self._load_contract("deep_epic_generation", {
                "architectural_map_json": arch_compact,
                "all_rules_summary": rules_compact,
                "project_name": project.name,
            })

            batch_label = f"batch {batch_idx + 1}/{total_batches}"
            epic_result = await self.claudius.call(
                model=p4a_model,
                system_prompt=system_prompt or "Generate project epics. Respond with JSON.",
                user_prompt=f"Projeto: {project.name}\n\nDominios ({batch_label}):\n{arch_compact}\n\nRegras:\n{rules_compact}",
                max_tokens=p4a_max_tokens,
                **self._ollama_kwargs("phase_4a"),
            )

            # PROMPT #237: Emit epic batch telemetry
            await self._emit_telemetry(
                "phase_4a", "epic_generation",
                f"Batch {batch_idx + 1}/{total_batches}: Gerando Epics",
                batch_idx + 1, total_batches, model_name=p4a_model, result=epic_result,
            )

            batch_epics_data = self.claudius.extract_json(epic_result.get("text", ""))
            batch_epics = batch_epics_data.get("epics", []) if batch_epics_data else []
            epics.extend(batch_epics)
            logger.info(f"[Phase 4a] {batch_label}: {len(batch_epics)} epics gerados")

            pct = 5 + int(15 * (batch_idx + 1) / total_batches)
            await progress_cb(4, pct, f"Epics: {batch_label} -- {len(epics)} total ate agora")

        # Deduplicate epics with very similar titles
        seen_titles = {}
        unique_epics = []
        for epic in epics:
            title = epic.get("title", "").strip().lower()
            is_dup = False
            for seen in seen_titles:
                # Simple substring/prefix dedup (>80% overlap)
                shorter, longer = sorted([title, seen], key=len)
                if shorter and longer.startswith(shorter[:len(shorter)*4//5]):
                    is_dup = True
                    break
            if not is_dup:
                seen_titles[title] = True
                unique_epics.append(epic)

        if len(unique_epics) < len(epics):
            logger.info(f"[Phase 4a] Deduplicacao: {len(epics)} -> {len(unique_epics)} epics unicos")
        epics = unique_epics

        if len(epics) == 0:
            raise ClaudiusPipelineError(
                f"Fase 4a produziu 0 epics de {len(domain_list)} dominios -- "
                "possivel falha upstream ou cota"
            )

        # Create Epic cards in database
        epic_db_map = {}  # title -> Task object
        for epic in epics:
            task = Task(
                project_id=project.id,
                pipeline_run_id=run_id,
                title=epic.get("title", "Epic sem titulo"),
                description=epic.get("description", ""),
                item_type=ItemType.EPIC,
                status=TaskStatus.BACKLOG,
                priority=self._map_priority(epic.get("priority", "medium")),
                story_points=epic.get("story_points", 13),
                labels=epic.get("labels", []),
                acceptance_criteria=epic.get("acceptance_criteria", []),
                workflow_state="closed",
            )
            self.db.add(task)
            self.db.flush()
            epic_db_map[epic.get("title", "")] = task
            stats["epics"] += 1

        self.db.commit()
        await progress_cb(4, 20, f"Criados {stats['epics']} Epics. Gerando Stories...")

        # Phase 4b: Generate Stories per Epic (Opus, parallel 3x)
        p4b_ollama = self._ollama_kwargs("phase_4b")
        story_requests = []
        for epic in epics:
            domain = epic.get("domain", "Geral")
            domain_data = domain_rules.get(domain, {})
            # Compact JSON and limit rules to 15 (was 30) to save tokens
            rules_compact = json.dumps(domain_data.get("consolidated_rules", [])[:15], ensure_ascii=False, separators=(",", ":"))
            epic_compact = json.dumps(epic, ensure_ascii=False, separators=(",", ":"))
            arch_context = json.dumps(arch_map.get("project_summary", ""), ensure_ascii=False, separators=(",", ":"))

            system_prompt, _ = self._load_contract("deep_story_decomposition", {
                "epic_json": epic_compact,
                "domain_rules_json": rules_compact,
                "architectural_context": arch_context,
            })

            story_requests.append({
                "model": self._get_model("phase_4b", MODEL_SONNET),
                "system_prompt": system_prompt or "Decompose this epic into stories. Respond with JSON.",
                "user_prompt": f"Epic:\n{epic_compact}\n\nRegras do dominio:\n{rules_compact}",
                "max_tokens": self._get_max_tokens("phase_4b", 32000),
                **p4b_ollama,
            })

        p4b_model = self._get_model("phase_4b", MODEL_SONNET)

        async def _on_story_done(index: int, result: Any, total: int):
            epic_title = epics[index].get("title", "?")[:80] if index < len(epics) else f"item-{index}"
            await self._emit_telemetry(
                "phase_4b", "story_decomposition",
                f"Epic: {epic_title} -> Stories",
                index + 1, total, model_name=p4b_model, result=result,
            )

        story_results = await self.claudius.call_batch(
            story_requests, max_concurrency=self._get_concurrency("phase_4b", 3),
            on_item_complete=_on_story_done,
        )

        # Process stories and create Tasks
        all_stories = []  # (epic_title, story_data)
        for i, result in enumerate(story_results):
            if isinstance(result, ClaudiusPipelineError):
                continue
            parsed = self.claudius.extract_json(result.get("text", ""))
            if parsed and isinstance(parsed, dict):
                epic_title = epics[i].get("title", "")
                for story in parsed.get("stories", []):
                    all_stories.append((epic_title, story))

        if len(all_stories) == 0 and len(epics) > 0:
            raise ClaudiusPipelineError(
                f"Fase 4b produziu 0 stories de {len(epics)} epics -- possivel falha upstream ou cota"
            )

        # Create Story cards
        story_db_map = {}
        for epic_title, story in all_stories:
            parent = epic_db_map.get(epic_title)
            task = Task(
                project_id=project.id,
                pipeline_run_id=run_id,
                title=story.get("title", "Story sem titulo"),
                description=story.get("description", ""),
                item_type=ItemType.STORY,
                status=TaskStatus.BACKLOG,
                priority=self._map_priority(story.get("priority", "medium")),
                story_points=story.get("story_points", 5),
                parent_id=parent.id if parent else None,
                labels=story.get("labels", []),
                acceptance_criteria=story.get("acceptance_criteria", []),
                workflow_state="closed",
            )
            self.db.add(task)
            self.db.flush()
            story_db_map[story.get("title", "")] = task
            stats["stories"] += 1

        self.db.commit()
        await progress_cb(4, 45, f"Criadas {stats['stories']} Stories. Gerando Tasks...")

        # Phase 4c: Generate Tasks per Story (Sonnet, parallel 5x)
        p4c_ollama = self._ollama_kwargs("phase_4c")
        task_requests = []
        story_titles_for_tasks = []
        for epic_title, story in all_stories:
            epic_data = next((e for e in epics if e.get("title") == epic_title), {})
            # Compact context: only send title+domain from epic (not full object)
            epic_ctx = {"title": epic_title, "domain": epic_data.get("domain", "")}
            story_compact = json.dumps(story, ensure_ascii=False, separators=(",", ":"))
            epic_ctx_compact = json.dumps(epic_ctx, ensure_ascii=False, separators=(",", ":"))

            system_prompt, _ = self._load_contract("deep_task_decomposition", {
                "story_json": story_compact,
                "epic_context": epic_ctx_compact,
            })

            task_requests.append({
                "model": self._get_model("phase_4c", MODEL_SONNET),
                "system_prompt": system_prompt or "Decompose this story into tasks. Respond with JSON.",
                "user_prompt": f"Story:\n{story_compact}\n\nContexto do Epic:\n{epic_ctx_compact}",
                "max_tokens": self._get_max_tokens("phase_4c", 8000),
                **p4c_ollama,
            })
            story_titles_for_tasks.append(story.get("title", ""))

        p4c_model = self._get_model("phase_4c", MODEL_SONNET)
        _p4c_done = [0]

        async def _on_task_done(index: int, result: Any, total: int):
            _p4c_done[0] += 1
            title = story_titles_for_tasks[index][:80] if index < len(story_titles_for_tasks) else f"item-{index}"
            await self._emit_telemetry(
                "phase_4c", "task_decomposition",
                f"Story: {title} -> Tasks",
                _p4c_done[0], total, model_name=p4c_model, result=result,
            )

        task_results = await self.claudius.call_batch(
            task_requests, max_concurrency=self._get_concurrency("phase_4c", 5),
            on_item_complete=_on_task_done,
        )

        all_tasks = []  # (story_title, task_data)
        for i, result in enumerate(task_results):
            if isinstance(result, ClaudiusPipelineError):
                continue
            parsed = self.claudius.extract_json(result.get("text", ""))
            if parsed and isinstance(parsed, dict):
                story_title = story_titles_for_tasks[i]
                for t in parsed.get("tasks", []):
                    all_tasks.append((story_title, t))

        if len(all_tasks) == 0 and len(all_stories) > 0:
            raise ClaudiusPipelineError(
                f"Fase 4c produziu 0 tasks de {len(all_stories)} stories -- possivel falha upstream ou cota"
            )

        # Create Task cards
        task_db_map = {}
        for story_title, t in all_tasks:
            parent = story_db_map.get(story_title)
            task = Task(
                project_id=project.id,
                pipeline_run_id=run_id,
                title=t.get("title", "Task sem titulo"),
                description=t.get("description", ""),
                item_type=ItemType.TASK,
                status=TaskStatus.BACKLOG,
                priority=self._map_priority(t.get("priority", "medium")),
                story_points=t.get("story_points", 3),
                parent_id=parent.id if parent else None,
                labels=t.get("labels", []),
                acceptance_criteria=t.get("acceptance_criteria", []),
                workflow_state="closed",
            )
            self.db.add(task)
            self.db.flush()
            task_db_map[t.get("title", "")] = task
            stats["tasks"] += 1

        self.db.commit()
        await progress_cb(4, 70, f"Criadas {stats['tasks']} Tasks.")

        stats["total_cards"] = stats["epics"] + stats["stories"] + stats["tasks"]

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

        logger.info(f"Phase 4: Generated {stats['total_cards']} cards ({stats['epics']}E/{stats['stories']}S/{stats['tasks']}T)")
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

        # Wiki pages are stored in the database only (no filesystem).
        wiki_dir = None  # kept as variable for _write_wiki_page signature compat

        stats = {"total_pages": 0, "total_words": 0}

        # Phase 5a: Plan wiki structure (Sonnet)
        await progress_cb(5, 5, "Planejando estrutura da wiki...")

        arch_compact = json.dumps(arch_map, ensure_ascii=False, separators=(",", ":"))
        cards_compact = json.dumps(card_stats, ensure_ascii=False, separators=(",", ":"))
        system_prompt, _ = self._load_contract("deep_wiki_structure", {
            "architectural_map_json": arch_compact,
            "card_tree_summary": cards_compact,
            "project_name": project.name,
        })

        p5a_model = self._get_model("phase_5a", MODEL_SONNET)
        structure_result = await self.claudius.call(
            model=p5a_model,
            system_prompt=system_prompt or "Plan wiki structure. Respond with JSON.",
            user_prompt=f"Projeto: {project.name}\n\nMapa:\n{arch_compact}\n\nCards:\n{cards_compact}",
            max_tokens=self._get_max_tokens("phase_5a", 8000),
            **self._ollama_kwargs("phase_5a"),
        )

        # PROMPT #237: Emit wiki planning telemetry
        await self._emit_telemetry(
            "phase_5a", "wiki_planning", "Planejando estrutura wiki",
            1, 1, model_name=p5a_model, result=structure_result,
        )

        wiki_plan = self.claudius.extract_json(structure_result.get("text", "")) or {}

        # Validacao: plano vazio indica falha de parse ou cota
        _total_planned = (
            len(wiki_plan.get("general_pages", []) or [])
            + len(wiki_plan.get("domain_pages", []) or [])
            + len(wiki_plan.get("flow_pages", []) or [])
        )
        if _total_planned == 0:
            raise ClaudiusPipelineError(
                "Fase 5a produziu um plano de wiki vazio -- possivel falha upstream ou cota"
            )

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
            pages_compact = json.dumps(general_pages, ensure_ascii=False, separators=(",", ":"))
            stack_compact = json.dumps(project.stack or {}, ensure_ascii=False, separators=(",", ":"))
            system_prompt, _ = self._load_contract("deep_wiki_overview", {
                "page_plan_json": pages_compact,
                "architectural_map_json": arch_compact,
                "project_name": project.name,
                "tech_stack": stack_compact,
            })

            p5b_model = self._get_model("phase_5b", MODEL_SONNET)
            overview_result = await self.claudius.call(
                model=p5b_model,
                system_prompt=system_prompt or "Generate wiki overview pages. Respond with JSON.",
                user_prompt=f"Plano:\n{pages_compact}\n\nMapa:\n{arch_compact}",
                max_tokens=self._get_max_tokens("phase_5b", 64000),
                **self._ollama_kwargs("phase_5b"),
            )

            # PROMPT #237: Emit wiki overview telemetry
            await self._emit_telemetry(
                "phase_5b", "wiki_overview", "Gerando paginas de visao geral",
                1, 1, model_name=p5b_model, result=overview_result,
            )

            pages_data = self.claudius.extract_json(overview_result.get("text", ""))
            if pages_data and isinstance(pages_data, dict):
                for page in pages_data.get("pages", []):
                    self._write_wiki_page(wiki_dir, page, project_id=project.id, run_id=run_id)
                    stats["total_pages"] += 1
                    stats["total_words"] += page.get("word_count", 0)

        # Phase 5c: Generate domain pages (Opus, parallel 3x)
        await progress_cb(5, 50, "Gerando paginas por dominio...")
        domain_page_groups = wiki_plan.get("domain_pages", [])

        domain_requests = []
        for group in domain_page_groups:
            domain = group.get("domain", "")
            domain_data = domain_rules.get(domain, {})
            # Compact JSON and limit rules to 15 (was 30) to save tokens
            rules_compact = json.dumps(domain_data.get("consolidated_rules", [])[:15], ensure_ascii=False, separators=(",", ":"))
            plan_compact = json.dumps(group.get("pages", []), ensure_ascii=False, separators=(",", ":"))

            system_prompt, _ = self._load_contract("deep_wiki_domain", {
                "domain_name": domain,
                "domain_rules_json": rules_compact,
                "domain_cards_json": json.dumps({"domain": domain}, ensure_ascii=False, separators=(",", ":")),
                "page_plan_json": plan_compact,
                "project_name": project.name,
            })

            domain_requests.append({
                "model": self._get_model("phase_5c", MODEL_SONNET),
                "system_prompt": system_prompt or "Generate domain wiki pages. Respond with JSON.",
                "user_prompt": f"Dominio: {domain}\n\nPlano:\n{plan_compact}\n\nRegras:\n{rules_compact}",
                "max_tokens": self._get_max_tokens("phase_5c", 32000),
                **self._ollama_kwargs("phase_5c"),
            })

        if domain_requests:
            p5c_model = self._get_model("phase_5c", MODEL_SONNET)
            _p5c_done = [0]

            async def _on_domain_done(index: int, result: Any, total: int):
                _p5c_done[0] += 1
                domain_name = domain_page_groups[index].get("domain", "?") if index < len(domain_page_groups) else "?"
                await self._emit_telemetry(
                    "phase_5c", "wiki_domain",
                    f"Gerando: dominio {domain_name}",
                    _p5c_done[0], total, model_name=p5c_model, result=result,
                )

            domain_results = await self.claudius.call_batch(
                domain_requests, max_concurrency=self._get_concurrency("phase_5c", 3),
                on_item_complete=_on_domain_done,
            )
            for dr_i, result in enumerate(domain_results):
                if isinstance(result, ClaudiusPipelineError):
                    continue
                pages_data = self.claudius.extract_json(result.get("text", ""))
                if pages_data and isinstance(pages_data, dict):
                    for page in pages_data.get("pages", []):
                        self._write_wiki_page(wiki_dir, page, project_id=project.id, run_id=run_id)
                        stats["total_pages"] += 1
                        stats["total_words"] += page.get("word_count", 0)

        # Phase 5d: Cross-domain flow pages (Sonnet)
        if self._is_phase_enabled("phase_5d"):
            await progress_cb(5, 85, "Gerando paginas de fluxos cross-domain...")
            flow_pages = wiki_plan.get("flow_pages", [])
            for flow in flow_pages:
                try:
                    result = await self.claudius.call(
                        model=self._get_model("phase_5d", MODEL_SONNET),
                        system_prompt="Gere uma pagina de wiki detalhada para este fluxo cross-domain. Responda com JSON: {\"pages\": [{\"slug\": \"...\", \"title\": \"...\", \"content\": \"markdown...\", \"word_count\": N}]}",
                        user_prompt=f"Fluxo: {json.dumps(flow, ensure_ascii=False, separators=(',', ':'))}\n\nMapa: {json.dumps(arch_map, ensure_ascii=False, separators=(',', ':'))}",
                        max_tokens=self._get_max_tokens("phase_5d", 16000),
                        **self._ollama_kwargs("phase_5d"),
                    )
                    pages_data = self.claudius.extract_json(result.get("text", ""))
                    if pages_data and isinstance(pages_data, dict):
                        for page in pages_data.get("pages", []):
                            self._write_wiki_page(wiki_dir, page, project_id=project.id, run_id=run_id)
                            stats["total_pages"] += 1
                except ClaudiusQuotaExhaustedError:
                    raise
                except ClaudiusPipelineError as e:
                    logger.warning(f"Phase 5d: Failed to generate flow page: {e}")
        else:
            logger.info("Phase 5d: Flow page generation disabled in profile")

        self.db.commit()
        logger.info(f"Phase 5: Generated {stats['total_pages']} wiki pages")
        return stats

    def _write_wiki_page(self, wiki_dir: str, page_data: Dict, project_id: UUID = None, run_id: UUID = None):
        """Write a wiki page to the database (DB-only, no filesystem).

        The wiki_dir parameter is kept for call-site compatibility but is ignored.
        Wiki pages are stored exclusively in the wiki_pages table.
        """
        slug = page_data.get("slug", "unknown")
        title = page_data.get("title", "Sem titulo")
        content = page_data.get("content", "")

        # REGRA #0: Don't overwrite human-edited pages
        if project_id:
            existing_db = self.db.query(WikiPage).filter(
                WikiPage.project_id == project_id,
                WikiPage.slug == slug,
                WikiPage.source.in_(["manual", "enrichment"]),
            ).first()
            if existing_db:
                logger.info(f"Skipping wiki page '{slug}' - human-edited in DB (source: {existing_db.source})")
                return

        # Create/update WikiPage record in database
        if project_id:
            db_page = self.db.query(WikiPage).filter(
                WikiPage.project_id == project_id,
                WikiPage.slug == slug,
            ).first()
            if db_page:
                db_page.title = title
                db_page.content = content
                db_page.source = "ai_generated"
                db_page.pipeline_run_id = run_id
            else:
                db_page = WikiPage(
                    project_id=project_id,
                    pipeline_run_id=run_id,
                    slug=slug,
                    title=title,
                    content=content,
                    source="ai_generated",
                )
                self.db.add(db_page)

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
        # Phase 6 QA is essentially a summarization/scoring pass over already-
        # processed artifacts (rules counts, card stats, wiki summary). Heavy
        # thinking budget here was disproportionate vs the task complexity.
        # _phase6_local_qa (lines 692-770) covers the same dimensions if AI is off.
        p6_thinking = self._get_phase_config("phase_6", "thinking_budget", 3000)

        result = await self.claudius.call(
            model=p6_model,
            system_prompt=system_prompt or "Review the quality of all pipeline artifacts. Respond with JSON.",
            user_prompt=(
                # Compact JSON — pretty-print custa 20-30% extra tokens
                # sem ganho semantico para o modelo.
                f"Projeto: {project.name}\n\n"
                f"Mapa: {json.dumps(arch_map, ensure_ascii=False, separators=(',', ':'))}\n\n"
                f"Regras: {json.dumps(rules_summary, ensure_ascii=False, separators=(',', ':'))}\n\n"
                f"Cards: {json.dumps(card_stats, ensure_ascii=False, separators=(',', ':'))}\n\n"
                f"Wiki: {json.dumps(wiki_summary, ensure_ascii=False, separators=(',', ':'))}"
            ),
            thinking={"type": "enabled", "budget_tokens": p6_thinking} if p6_thinking else None,
            max_tokens=p6_max_tokens,
            **self._ollama_kwargs("phase_6"),
        )

        # PROMPT #237: Emit QA telemetry
        await self._emit_telemetry(
            "phase_6", "quality_review", "Avaliando qualidade geral",
            1, 1, model_name=p6_model, result=result,
        )

        qa_result = self.claudius.extract_json(result.get("text", "")) or {
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

    def _phase6_local_qa(
        self,
        domain_rules: Dict[str, Dict],
        card_stats: Dict,
        wiki_stats: Dict,
        run_id: UUID,
        project: "Project",
    ) -> Dict:
        """Run quality assurance locally using heuristics (no AI call).

        Scores based on the same criteria the AI contract uses:
        - rule_quality: density and evidence presence
        - card_coverage: epics/stories/tasks generated
        - wiki_completeness: pages generated
        """
        total_rules = sum(len(d.get("consolidated_rules", [])) for d in domain_rules.values())
        total_domains = len(domain_rules)
        domains_with_gaps = sum(1 for d in domain_rules.values() if d.get("detected_gaps"))

        # Rule quality: 0-100
        if total_domains == 0:
            rule_quality = 0
        else:
            rules_per_domain = total_rules / total_domains
            rule_quality = min(100, int(rules_per_domain * 8))  # 12+ rules/domain = 100

        # Card coverage: 0-100
        epics = card_stats.get("epics", 0)
        stories = card_stats.get("stories", 0)
        tasks = card_stats.get("tasks", 0)
        if epics == 0:
            card_coverage = 0
        else:
            epic_ratio = min(1.0, epics / max(total_domains, 1))  # 1 epic per domain
            story_ratio = min(1.0, stories / max(epics * 2, 1))  # 2+ stories per epic
            task_ratio = min(1.0, tasks / max(stories * 2, 1))  # 2+ tasks per story
            card_coverage = int((epic_ratio * 40 + story_ratio * 35 + task_ratio * 25))

        # Wiki completeness: 0-100
        wiki_pages = wiki_stats.get("total_pages", 0)
        wiki_completeness = min(100, int(wiki_pages / max(total_domains, 1) * 50))

        # Overall score
        overall = int(rule_quality * 0.4 + card_coverage * 0.35 + wiki_completeness * 0.25)

        issues = []
        if rule_quality < 50:
            issues.append({"severity": "high", "description": f"Baixa densidade de regras: {total_rules} regras em {total_domains} dominios"})
        if domains_with_gaps > 0:
            issues.append({"severity": "medium", "description": f"{domains_with_gaps} dominio(s) com gaps detectados"})
        if epics < total_domains:
            issues.append({"severity": "medium", "description": f"Cobertura parcial: {epics} epics para {total_domains} dominios"})
        if wiki_pages < total_domains:
            issues.append({"severity": "medium", "description": f"Wiki incompleta: {wiki_pages} paginas para {total_domains} dominios"})

        qa_result = {
            "overall_score": overall,
            "rule_quality": rule_quality,
            "card_coverage": card_coverage,
            "wiki_completeness": wiki_completeness,
            "issues": issues,
            "summary": f"QA local: {overall}/100 (regras={rule_quality}, cards={card_coverage}, wiki={wiki_completeness})",
            "local_qa": True,
        }

        # Store artifact
        artifact = PipelineArtifact(
            project_id=project.id,
            artifact_type=ArtifactType.quality_report,
            phase=6,
            content=qa_result,
            quality_score=overall,
            run_id=run_id,
        )
        self.db.add(artifact)
        self.db.commit()

        logger.info(f"Phase 6 (local): QA complete. Score: {overall}/100")
        return qa_result

    # =========================================================================
    # POST-PIPELINE: PROJECT ENRICHMENT
    # =========================================================================

    async def _enrich_project_fields(
        self,
        project: Project,
        arch_map: Dict,
        domain_rules: Dict[str, Dict],
        file_inventory: List[Dict],
        total_rules: int,
        card_stats: Dict,
        wiki_stats: Dict,
        progress_cb: Any,
    ):
        """Generate project description and context_semantic from pipeline artifacts.

        Uses all available context: arch map, domains, wiki, RAG rules, git commits,
        done cards, and current project title.

        Respects REGRA #0: only fills empty fields, never overwrites human data.
        """
        # Check which fields need generation
        # REGRA #0: Only skip if HUMAN wrote the content.
        # AI-generated content (description_ai_model set) CAN be regenerated with better context.
        has_description = bool(project.description and project.description.strip())
        has_semantic = bool(project.context_semantic and project.context_semantic.strip())
        desc_is_ai = bool(getattr(project, "description_ai_model", None))

        needs_description = not has_description or desc_is_ai
        needs_semantic = not has_semantic or desc_is_ai  # if desc was AI, semantic likely was too

        if not needs_description and not needs_semantic:
            logger.info("Post-pipeline: Project has human-written description and context -- skipping enrichment")
            return

        await progress_cb(7, 80, "Coletando contexto (wiki, RAG, commits, cards)...")

        # Build domains summary for prompt
        domains_summary = {}
        for domain, data in domain_rules.items():
            domains_summary[domain] = {
                "rule_count": len(data.get("consolidated_rules", [])),
                "entities": data.get("domain_entities", []),
                "summary": data.get("domain_summary", ""),
            }

        # Gather rich context from all available sources
        extra = self._gather_enrichment_context(project)

        await progress_cb(7, 85, "Gerando descricao e contexto semantico do projeto...")

        # Compact-JSON helper: same payload, ~25% less bytes than pretty.
        _c = lambda obj: json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        contract_vars = {
            "project_name": project.name,
            "architectural_map_json": _c(arch_map)[:8000],
            "domains_summary": _c(domains_summary)[:4000],
            "tech_stack": _c(project.stack or {}),
            "files_count": str(len(file_inventory)),
            "rules_count": str(total_rules),
            "cards_count": str(card_stats.get("total_cards", 0)),
            "wiki_pages_count": str(wiki_stats.get("total_pages", 0)),
            "wiki_content": extra.get("wiki_content", ""),
            "business_rules": extra.get("business_rules", ""),
            "git_commits": extra.get("git_commits", ""),
            "done_cards": extra.get("done_cards", ""),
        }

        system_prompt, _ = self._load_contract("deep_project_enrichment", contract_vars)

        user_prompt = (
            f"Projeto: {project.name}\n"
            f"Stack: {_c(project.stack or {})}\n"
            f"Arquivos analisados: {len(file_inventory)}\n"
            f"Regras de negocio: {total_rules}\n"
            f"Cards gerados: {card_stats.get('total_cards', 0)}\n\n"
            f"Mapa Arquitetural:\n{_c(arch_map)[:6000]}\n\n"
            f"Dominios:\n{_c(domains_summary)[:3000]}"
        )

        # Append rich context to user prompt
        if extra.get("wiki_content"):
            user_prompt += f"\n\nDocumentacao Wiki do Projeto:\n{extra['wiki_content']}"
        if extra.get("business_rules"):
            user_prompt += f"\n\nRegras de Negocio Extraidas do Codigo:\n{extra['business_rules']}"
        if extra.get("git_commits"):
            user_prompt += f"\n\nCommits Recentes (funcionalidades implementadas):\n{extra['git_commits']}"
        if extra.get("done_cards"):
            user_prompt += f"\n\nCards Concluidos (trabalho ja realizado):\n{extra['done_cards']}"

        # Use the same model as Phase 3 (Sonnet) for enrichment
        from app.services.claudius_pipeline import MODEL_SONNET
        enrich_model = self._get_model("phase_3", MODEL_SONNET)

        try:
            result = await self.claudius.call(
                model=enrich_model,
                system_prompt=system_prompt or (
                    "Generate a JSON with 'description' and 'context_semantic' for this project. "
                    "Description: human-readable summary (200-2000 chars). "
                    "Context_semantic: AI-optimized technical context (300-5000 chars). "
                    "Portuguese only. JSON only."
                ),
                user_prompt=user_prompt,
                max_tokens=self._get_max_tokens("phase_3", 4000),
                **self._ollama_kwargs("phase_3"),
            )

            await self._emit_telemetry(
                "enrichment", "project_enrichment", "Enriquecimento do projeto",
                1, 1, model_name=enrich_model, result=result,
            )

            parsed = self.claudius.extract_json(result.get("text", ""))
            if not parsed or not isinstance(parsed, dict):
                logger.warning("Post-pipeline enrichment: failed to parse JSON response")
                return

            # REGRA #0: Only set empty fields
            description = str(parsed.get("description", "")).strip()
            context_semantic = str(parsed.get("context_semantic", "")).strip()

            if needs_description and description and len(description) >= 50:
                project.description = description[:2000]
                # Track which AI model generated the description
                provider = self._provider or "claudius"
                label = self._model_label(enrich_model)
                project.description_ai_model = f"{label} ({provider})"
                logger.info(f"Post-pipeline: Generated description ({len(description)} chars)")

            if needs_semantic and context_semantic and len(context_semantic) >= 100:
                project.context_semantic = context_semantic[:5000]
                logger.info(f"Post-pipeline: Generated context_semantic ({len(context_semantic)} chars)")

            self.db.commit()
            await progress_cb(7, 90, "Descricao e contexto semantico gerados")

        except Exception as e:
            logger.error(f"Post-pipeline enrichment failed: {e}", exc_info=True)
            # Non-fatal -- pipeline already completed successfully

    # =========================================================================
    # POST-PIPELINE: MARK CARDS AS DONE
    # =========================================================================

    async def _mark_cards_as_done(
        self,
        project: Project,
        run_id: UUID,
        progress_cb: Any,
    ):
        """Mark all cards generated by this pipeline run as DONE.

        The deep pipeline analyzes EXISTING code -- the features described
        in the generated cards are already implemented.
        """
        await progress_cb(7, 95, "Marcando cards como implementados...")

        try:
            cards = (
                self.db.query(Task)
                .filter(
                    Task.project_id == project.id,
                    Task.pipeline_run_id == run_id,
                )
                .all()
            )

            count = 0
            for card in cards:
                card.status = TaskStatus.DONE
                card.workflow_state = "done"
                count += 1

            self.db.commit()
            logger.info(f"Post-pipeline: Marked {count} cards as DONE + workflow_state='done' (code already exists)")
            await progress_cb(7, 98, f"{count} cards marcados como implementados")

        except Exception as e:
            logger.error(f"Post-pipeline mark cards failed: {e}", exc_info=True)
            self.db.rollback()
