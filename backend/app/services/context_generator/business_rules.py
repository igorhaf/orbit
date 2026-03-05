"""
Business rules classification and card creation mixin.

Handles AI-based hierarchical classification of business rules
into Epic > Story > Task structure and card creation.
PROMPT #240 - Rigid 3-level hierarchy matching generate_cards_from_rag.py.
Extracted from context_generator.py during modularization (PROMPT #249).
"""

from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4
from datetime import datetime
from sqlalchemy.orm import Session
import asyncio
import json
import logging
import math

from app.models.project import Project
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.services.rag_service import RAGService
from .utils import _robust_json_parse

logger = logging.getLogger(__name__)


# ============================================================
# PROMPT #249 - Per-card normalization helper
# ============================================================

def _normalize_card_inline(db, card_id, item_type, title, description="",
                           domain="", parent_title="", rules=None, insights=None):
    """Normalize a single card immediately after creation (non-critical)."""
    try:
        from scripts.normalize_cards import normalize_single_card
        normalize_single_card(
            db=db, card_id=card_id, item_type=item_type, title=title,
            description=description, domain=domain, parent_title=parent_title,
            rules=rules, interview_insights=insights or {},
        )
    except Exception as e:
        logger.debug(f"Per-card normalization skipped for {card_id}: {e}")


# ============================================================
# PROMPT #240 - Rigid card rendering functions (same as script)
# ============================================================

def _render_description(title: str, context: str, rules: list, level: str) -> str:
    """Render human-readable description from rules."""
    ac_text = "\n".join(f"- {r}" for r in rules[:8]) if rules else "- A definir"
    return f"""# {title}

## Contexto

{context}

## Regras de Negocio Aplicaveis

{ac_text}

## Nivel

{level}
"""


def _render_prompt(title: str, semantic_map: dict, rules: list, level: str) -> str:
    """Render semantic prompt with references."""
    sm_lines = "\n".join(f"- **{k}**: {v}" for k, v in semantic_map.items())
    rules_text = "\n".join(f"{i+1}. {r}" for i, r in enumerate(rules[:10]))
    return f"""# {level}: {title}

## Mapa Semantico

{sm_lines}

## Regras de Negocio

{rules_text}

## Instrucoes

Implementar {title} respeitando todas as regras de negocio listadas acima.
Cada criterio de aceitacao deve ser verificavel e testavel.
"""


def _make_acceptance_criteria(rules: list) -> list:
    """Convert rules to acceptance criteria format."""
    criteria = []
    for r in rules[:6]:
        text = r.strip() if isinstance(r, str) else str(r).strip()
        if len(text) > 20:
            criteria.append(text[:200])
    if not criteria:
        criteria.append("Funcionalidade implementada conforme especificacao")
    return criteria


class BusinessRulesMixin:
    """Mixin providing business rule classification and card creation methods."""

    async def generate_business_rule_cards(
        self,
        project_id: UUID
    ) -> List[Dict]:
        """
        PROMPT #120 - Generate cards for verified business rules.
        PROMPT #193 - Hierarchical structure.
        PROMPT #240 - Rigid 3-level hierarchy: Epic > Story > Task.

        Uses AI to classify business rules into Epic > Story groups.
        Then code decomposes each Story into Tasks (groups of 3-4 rules).

        All cards have: description, generated_prompt, acceptance_criteria,
        semantic_map, description_edited_by='ai', prompt_edited_by='ai'.

        Falls back to flat 4-level structure if AI classification fails.

        Args:
            project_id: Project ID

        Returns:
            List of created business rule card dictionaries
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            logger.error(f"Project {project_id} not found")
            return []

        # PROMPT #291 - Read business rules from RAG (comprehensive) instead of
        # initial_memory_context (which only has ~20 rules from initial scan).
        # RAG has ALL rules from continuous scans (typically 500-745+).
        from sqlalchemy import text as sql_text

        # PROMPT #241 - Build query with ignore_paths filter
        # PROMPT #242 - Include source_file for AI classification context
        ignore_paths = project.ignore_paths if project.ignore_paths and isinstance(project.ignore_paths, list) else []
        if ignore_paths:
            # Exclude rules whose source_file starts with any ignored path
            where_clauses = " ".join(
                f"AND NOT (metadata->>'source_file' LIKE :ip{i} || '%')"
                for i in range(len(ignore_paths))
            )
            query = f"""
                SELECT content, metadata->>'source_file' as source_file,
                       COALESCE((metadata->>'fully_coded')::boolean, true) as fully_coded
                FROM rag_documents
                WHERE project_id = :pid
                AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')
                {where_clauses}
                ORDER BY created_at
            """
            params = {"pid": str(project_id)}
            for i, p in enumerate(ignore_paths):
                params[f"ip{i}"] = p
            rag_result = self.db.execute(sql_text(query), params)
            logger.info(f"📁 RAG query excludes {len(ignore_paths)} ignored paths: {ignore_paths}")
        else:
            rag_result = self.db.execute(sql_text("""
                SELECT content, metadata->>'source_file' as source_file,
                       COALESCE((metadata->>'fully_coded')::boolean, true) as fully_coded
                FROM rag_documents
                WHERE project_id = :pid
                AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')
                ORDER BY created_at
            """), {"pid": str(project_id)})

        # PROMPT #242 - Format rules with source_file context for better AI classification
        rag_rules = []
        rag_rules_fully_coded = []  # Track fully_coded flag per rule
        for row in rag_result:
            content = row[0]
            source = row[1] if len(row) > 1 and row[1] else None
            fully_coded = row[2] if len(row) > 2 else True
            if source:
                rag_rules.append(f"[{source}] {content}")
            else:
                rag_rules.append(content)
            rag_rules_fully_coded.append(bool(fully_coded))

        # Fallback to initial_memory_context if RAG has no rules
        if not rag_rules:
            if project.initial_memory_context:
                rag_rules = project.initial_memory_context.get("business_rules", [])
            if not rag_rules:
                logger.info(f"Project {project_id} has no business rules in RAG or memory context")
                return []

        business_rules = rag_rules
        # Determine if all rules come from code (fully_coded) or some from docs
        all_rules_fully_coded = all(rag_rules_fully_coded) if rag_rules_fully_coded else True

        # PROMPT #291 - Delete existing business_rule/from_rag cards before regenerating
        # This allows re-running with updated RAG data.
        existing_br_cards = self.db.query(Task).filter(
            Task.project_id == project_id,
            (Task.labels.contains(["business_rule"]) | Task.labels.contains(["from_rag"]))
        ).count()

        if existing_br_cards > 0:
            logger.info(
                f"Removing {existing_br_cards} existing business_rule/from_rag cards to regenerate from RAG ({len(business_rules)} rules)"
            )
            self.db.query(Task).filter(
                Task.project_id == project_id,
                (Task.labels.contains(["business_rule"]) | Task.labels.contains(["from_rag"]))
            ).delete(synchronize_session='fetch')
            self.db.flush()

        logger.info(f"Generating {len(business_rules)} business rule cards from RAG for project {project.name}")

        # PROMPT #193 - Try hierarchical classification via AI
        hierarchy = await self._classify_rules_hierarchy(project, business_rules)

        if hierarchy:
            # Create cards recursively from AI-classified hierarchy
            saved_cards = self._create_hierarchy_cards(project_id, hierarchy, all_rules_fully_coded)
            self.db.commit()
            logger.info(f"Generated {len(saved_cards)} hierarchical business rule cards")
            return saved_cards

        # Fallback: flat structure (original PROMPT #120 behavior)
        logger.warning("Hierarchical classification failed, using flat structure")
        cards = self._create_flat_business_rule_cards(project_id, business_rules, all_rules_fully_coded)
        return cards

    async def _classify_rules_hierarchy(
        self,
        project: Any,
        business_rules: List[str]
    ) -> Optional[List[Dict]]:
        """
        PROMPT #193 - Use AI to classify business rules into hierarchical structure.
        PROMPT #264 - Added retry logic (2 attempts) with timeout and detailed logging.
        PROMPT #245 - Chunked processing: splits large rule sets into batches of
                      ~100 rules each, classifies each batch, then merges by Epic title.
                      This prevents token overflow on large codebases (1000+ rules).

        Returns list of hierarchy nodes or None if classification fails.
        """
        import json
        import traceback

        CHUNK_SIZE = 100  # Rules per AI call

        # If small enough, classify in a single call
        if len(business_rules) <= CHUNK_SIZE:
            result = await self._classify_rules_chunk(project, business_rules)
            return result

        # Chunked processing for large rule sets
        logger.info(
            f"Large rule set ({len(business_rules)} rules), "
            f"splitting into chunks of {CHUNK_SIZE}"
        )

        all_hierarchies: List[List[Dict]] = []
        for i in range(0, len(business_rules), CHUNK_SIZE):
            chunk = business_rules[i:i + CHUNK_SIZE]
            chunk_num = (i // CHUNK_SIZE) + 1
            total_chunks = (len(business_rules) + CHUNK_SIZE - 1) // CHUNK_SIZE

            logger.info(f"Classifying chunk {chunk_num}/{total_chunks} ({len(chunk)} rules)")

            chunk_result = await self._classify_rules_chunk(project, chunk)
            if chunk_result:
                all_hierarchies.append(chunk_result)
            else:
                logger.warning(f"Chunk {chunk_num} classification failed, skipping")

        if not all_hierarchies:
            logger.warning("All chunks failed classification")
            return None

        # Merge hierarchies by Epic title (domain grouping)
        merged = self._merge_hierarchies(all_hierarchies)
        logger.info(f"Merged {len(all_hierarchies)} chunks into {len(merged)} domain groups")
        return merged

    def _merge_hierarchies(self, hierarchies: List[List[Dict]]) -> List[Dict]:
        """
        PROMPT #245 - Merge multiple hierarchy results by Epic title.
        Rules from different chunks that belong to the same domain
        are consolidated under the same Epic.
        """
        epic_map: Dict[str, Dict] = {}

        for hierarchy in hierarchies:
            for epic_node in hierarchy:
                title = epic_node.get("title", "").strip()
                # Normalize title for matching (lowercase, strip whitespace)
                key = title.lower()

                if key in epic_map:
                    # Merge children into existing epic
                    existing_children = epic_map[key].get("children", [])
                    new_children = epic_node.get("children", [])
                    existing_children.extend(new_children)
                    epic_map[key]["children"] = existing_children
                else:
                    epic_map[key] = {
                        "title": title,
                        "description": epic_node.get("description", ""),
                        "children": list(epic_node.get("children", []))
                    }

        return list(epic_map.values())

    async def _classify_rules_chunk(
        self,
        project: Any,
        business_rules: List[str]
    ) -> Optional[List[Dict]]:
        """
        PROMPT #245 - Classify a single chunk of business rules via AI.
        Extracted from original _classify_rules_hierarchy for reuse in chunking.
        """
        import json
        import traceback

        from app.contracts.loader import ContractLoader
        loader = ContractLoader()

        rules_text = "\n".join([f"{i}. {rule}" for i, rule in enumerate(business_rules, 1)])

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
                    timeout=180
                )

                content = response.get("content", "")

                json_start = content.find("{")
                json_end = content.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    parsed = json.loads(content[json_start:json_end])
                    hierarchy = parsed.get("hierarchy", [])
                    if hierarchy and isinstance(hierarchy, list):
                        logger.info(
                            f"AI classified {len(business_rules)} rules into "
                            f"{len(hierarchy)} domain groups (attempt {attempt + 1})"
                        )
                        return hierarchy

                logger.warning(f"AI response did not contain valid hierarchy (attempt {attempt + 1}/{max_retries})")

            except json.JSONDecodeError as e:
                logger.warning(f"JSON parse error in hierarchy classification (attempt {attempt + 1}/{max_retries}): {e}")
            except asyncio.TimeoutError:
                logger.warning(f"Hierarchy classification timed out after 180s (attempt {attempt + 1}/{max_retries})")
            except Exception as e:
                logger.error(f"Hierarchy classification failed (attempt {attempt + 1}/{max_retries}): {e}")
                logger.error(traceback.format_exc())

        logger.warning(f"Chunk classification failed after {max_retries} attempts")
        return None

    def _create_hierarchy_cards(
        self,
        project_id: UUID,
        nodes: List[Dict],
        all_rules_fully_coded: bool = True,
    ) -> List[Dict]:
        """
        PROMPT #240 - Create rigid 3-level card hierarchy from AI-classified nodes.

        AI provides Epic(domain) > Story(area, rules[]).
        Code decomposes Stories into Tasks (groups of 3-4 rules).

        Every card has: description, generated_prompt, acceptance_criteria,
        semantic_map, description_edited_by='ai', prompt_edited_by='ai'.
        """
        LEVEL_NAMES = ["Epic", "Story", "Task"]
        DEPTH_TO_TYPE = {
            0: ItemType.EPIC,
            1: ItemType.STORY,
            2: ItemType.TASK,
        }
        DEPTH_STORY_POINTS = {0: 13, 1: 5, 2: 3}
        DEPTH_PRIORITY = {
            0: PriorityLevel.HIGH,
            1: PriorityLevel.HIGH,
            2: PriorityLevel.MEDIUM,
        }
        RULES_PER_TASK = 3  # Group N rules into Tasks

        now = datetime.utcnow()
        saved_cards = []
        wf_state = "closed" if all_rules_fully_coded else "open"

        for epic_idx, epic_node in enumerate(nodes):
            epic_title = (epic_node.get("title") or "Sem titulo")[:200]
            epic_desc = epic_node.get("description", "")
            epic_children = epic_node.get("children", [])

            # Collect all rules across stories for the epic
            all_epic_rules = []
            for child in epic_children:
                child_rules = child.get("rules", [])
                if child_rules:
                    all_epic_rules.extend(child_rules)
                # Also use story description as rule if no rules field
                child_desc = child.get("description", "")
                if not child_rules and child_desc:
                    all_epic_rules.append(child_desc)

            epic_sm = {
                "N1": epic_title,
                "P1": f"Dominio: {epic_title}",
            }

            # --- CREATE EPIC ---
            epic_id = uuid4()
            epic_card = Task(
                id=epic_id,
                project_id=project_id,
                parent_id=None,
                item_type=ItemType.EPIC,
                title=epic_title,
                description=_render_description(epic_title, epic_desc, all_epic_rules[:6], "Epic"),
                generated_prompt=_render_prompt(epic_title, epic_sm, all_epic_rules[:10], "EPIC"),
                acceptance_criteria=_make_acceptance_criteria(all_epic_rules[:6]),
                story_points=DEPTH_STORY_POINTS[0],
                priority=DEPTH_PRIORITY[0],
                status=TaskStatus.BACKLOG,
                order=epic_idx,
                labels=["from_rag"],
                workflow_state=wf_state,
                reporter="system",
                description_edited_by="ai",
                prompt_edited_by="ai",
                interview_insights={
                    "semantic_map": epic_sm,
                    "source": "rag_business_rules",
                    "fully_coded": all_rules_fully_coded,
                },
                created_at=now,
                updated_at=now,
            )
            self.db.add(epic_card)
            self.db.flush()
            _normalize_card_inline(self.db, str(epic_id), "epic", epic_title,
                                   domain=epic_title, rules=all_epic_rules[:10])
            saved_cards.append({
                "id": str(epic_id), "title": epic_title,
                "item_type": "epic", "workflow_state": wf_state, "depth": 0,
            })
            logger.info(f"EPIC {epic_idx}: {epic_title}")

            # --- CREATE STORIES (from AI children) ---
            for story_idx, story_node in enumerate(epic_children):
                story_title = (story_node.get("title") or f"Story {story_idx+1}")[:200]
                story_desc = story_node.get("description", "")
                story_rules = story_node.get("rules", [])
                if not story_rules and story_desc:
                    story_rules = [story_desc]

                story_sm = {**epic_sm, f"S{story_idx+1}": story_title}
                story_id = uuid4()

                story_card = Task(
                    id=story_id,
                    project_id=project_id,
                    parent_id=epic_id,
                    item_type=ItemType.STORY,
                    title=story_title,
                    description=_render_description(story_title, story_desc or epic_desc, story_rules, "Story"),
                    generated_prompt=_render_prompt(story_title, story_sm, story_rules, "STORY"),
                    acceptance_criteria=_make_acceptance_criteria(story_rules),
                    story_points=DEPTH_STORY_POINTS[1],
                    priority=DEPTH_PRIORITY[1],
                    status=TaskStatus.BACKLOG,
                    order=story_idx,
                    labels=["from_rag"],
                    workflow_state=wf_state,
                    reporter="system",
                    description_edited_by="ai",
                    prompt_edited_by="ai",
                    interview_insights={
                        "semantic_map": story_sm,
                        "derived_from": str(epic_id),
                        "source": "rag_business_rules",
                        "fully_coded": all_rules_fully_coded,
                    },
                    created_at=now,
                    updated_at=now,
                )
                self.db.add(story_card)
                self.db.flush()
                _normalize_card_inline(self.db, str(story_id), "story", story_title,
                                       domain=epic_title, parent_title=epic_title,
                                       rules=story_rules)
                saved_cards.append({
                    "id": str(story_id), "title": story_title,
                    "item_type": "story", "workflow_state": wf_state, "depth": 1,
                })

                # --- CREATE TASKS (group rules into tasks of RULES_PER_TASK) ---
                if not story_rules:
                    continue

                num_tasks = max(1, math.ceil(len(story_rules) / RULES_PER_TASK))
                for task_idx in range(num_tasks):
                    start = task_idx * RULES_PER_TASK
                    task_rules = story_rules[start:start + RULES_PER_TASK]
                    task_title_base = task_rules[0] if task_rules else f"Task {task_idx+1}"
                    # Use first rule as title, truncated
                    task_title = (task_title_base[:80] + "...") if len(task_title_base) > 80 else task_title_base

                    task_sm = {**story_sm, f"T{task_idx+1}": task_title}
                    task_id = uuid4()

                    task_card = Task(
                        id=task_id,
                        project_id=project_id,
                        parent_id=story_id,
                        item_type=ItemType.TASK,
                        title=task_title,
                        description=_render_description(task_title, story_desc or story_title, task_rules, "Task"),
                        generated_prompt=_render_prompt(task_title, task_sm, task_rules, "TASK"),
                        acceptance_criteria=_make_acceptance_criteria(task_rules),
                        story_points=DEPTH_STORY_POINTS[2],
                        priority=DEPTH_PRIORITY[2],
                        status=TaskStatus.BACKLOG,
                        order=task_idx,
                        labels=["from_rag"],
                        workflow_state=wf_state,
                        reporter="system",
                        description_edited_by="ai",
                        prompt_edited_by="ai",
                        interview_insights={
                            "semantic_map": task_sm,
                            "derived_from": str(story_id),
                            "source": "rag_business_rules",
                            "fully_coded": all_rules_fully_coded,
                        },
                        created_at=now,
                        updated_at=now,
                    )
                    self.db.add(task_card)
                    self.db.flush()
                    _normalize_card_inline(self.db, str(task_id), "task", task_title,
                                           parent_title=story_title, rules=task_rules)
                    saved_cards.append({
                        "id": str(task_id), "title": task_title,
                        "item_type": "task", "workflow_state": wf_state, "depth": 2,
                    })

                logger.info(f"  STORY {story_idx}: {story_title} ({len(story_rules)} rules)")

        return saved_cards

    def _create_flat_business_rule_cards(
        self,
        project_id: UUID,
        business_rules: List[str],
        all_rules_fully_coded: bool = True,
    ) -> List[Dict]:
        """
        PROMPT #240 - Flat fallback with 3-level rigid structure.
        Creates 1 Epic > N Stories (batches of ~10 rules) > Tasks.
        """
        now = datetime.utcnow()
        RULES_PER_STORY = 10
        RULES_PER_TASK = 3
        wf_state = "closed" if all_rules_fully_coded else "open"

        epic_sm = {"N1": "Regras de Negocio", "P1": "Documentacao de regras"}

        # --- EPIC ---
        epic_id = uuid4()
        epic_card = Task(
            id=epic_id,
            project_id=project_id,
            title="Regras de Negocio Documentadas",
            description=_render_description(
                "Regras de Negocio Documentadas",
                f"Regras de negocio extraidas do projeto. Total: {len(business_rules)}",
                business_rules[:6], "Epic"
            ),
            generated_prompt=_render_prompt(
                "Regras de Negocio Documentadas", epic_sm, business_rules[:10], "EPIC"
            ),
            acceptance_criteria=_make_acceptance_criteria(business_rules[:6]),
            item_type=ItemType.EPIC,
            status=TaskStatus.BACKLOG,
            story_points=13,
            priority=PriorityLevel.HIGH,
            order=0,
            labels=["from_rag"],
            workflow_state=wf_state,
            reporter="system",
            description_edited_by="ai",
            prompt_edited_by="ai",
            interview_insights={"semantic_map": epic_sm, "source": "rag_business_rules", "fully_coded": all_rules_fully_coded},
            created_at=now,
            updated_at=now,
        )
        self.db.add(epic_card)
        self.db.flush()
        _normalize_card_inline(self.db, str(epic_id), "epic", epic_card.title,
                               domain="Regras de Negocio", rules=business_rules[:10])
        saved_cards = [{"id": str(epic_id), "title": epic_card.title, "item_type": "epic", "workflow_state": wf_state, "depth": 0}]

        # --- STORIES (batches of RULES_PER_STORY) ---
        num_stories = max(1, math.ceil(len(business_rules) / RULES_PER_STORY))
        for story_idx in range(num_stories):
            start = story_idx * RULES_PER_STORY
            story_rules = business_rules[start:start + RULES_PER_STORY]
            story_title = f"Regras {start+1}-{start+len(story_rules)}"
            story_sm = {**epic_sm, f"S{story_idx+1}": story_title}
            story_id = uuid4()

            story_card = Task(
                id=story_id, project_id=project_id, parent_id=epic_id,
                item_type=ItemType.STORY, title=story_title,
                description=_render_description(story_title, "Grupo de regras de negocio", story_rules, "Story"),
                generated_prompt=_render_prompt(story_title, story_sm, story_rules, "STORY"),
                acceptance_criteria=_make_acceptance_criteria(story_rules),
                story_points=5, priority=PriorityLevel.HIGH,
                status=TaskStatus.BACKLOG, order=story_idx,
                labels=["from_rag"], workflow_state=wf_state, reporter="system",
                description_edited_by="ai", prompt_edited_by="ai",
                interview_insights={"semantic_map": story_sm, "derived_from": str(epic_id), "source": "rag_business_rules", "fully_coded": all_rules_fully_coded},
                created_at=now, updated_at=now,
            )
            self.db.add(story_card)
            self.db.flush()
            _normalize_card_inline(self.db, str(story_id), "story", story_title,
                                   parent_title=epic_card.title, rules=story_rules)
            saved_cards.append({"id": str(story_id), "title": story_title, "item_type": "story", "workflow_state": wf_state, "depth": 1})

            # --- TASKS (group rules) ---
            num_tasks = max(1, math.ceil(len(story_rules) / RULES_PER_TASK))
            for task_idx in range(num_tasks):
                t_start = task_idx * RULES_PER_TASK
                task_rules = story_rules[t_start:t_start + RULES_PER_TASK]
                task_title = (task_rules[0][:80] + "...") if len(task_rules[0]) > 80 else task_rules[0]
                task_sm = {**story_sm, f"T{task_idx+1}": task_title}
                task_id = uuid4()

                task_card = Task(
                    id=task_id, project_id=project_id, parent_id=story_id,
                    item_type=ItemType.TASK, title=task_title,
                    description=_render_description(task_title, story_title, task_rules, "Task"),
                    generated_prompt=_render_prompt(task_title, task_sm, task_rules, "TASK"),
                    acceptance_criteria=_make_acceptance_criteria(task_rules),
                    story_points=3, priority=PriorityLevel.MEDIUM,
                    status=TaskStatus.BACKLOG, order=task_idx,
                    labels=["from_rag"], workflow_state=wf_state, reporter="system",
                    description_edited_by="ai", prompt_edited_by="ai",
                    interview_insights={"semantic_map": task_sm, "derived_from": str(story_id), "source": "rag_business_rules", "fully_coded": all_rules_fully_coded},
                    created_at=now, updated_at=now,
                )
                self.db.add(task_card)
                self.db.flush()
                _normalize_card_inline(self.db, str(task_id), "task", task_title,
                                       parent_title=story_title, rules=task_rules)
                saved_cards.append({"id": str(task_id), "title": task_title, "item_type": "task", "workflow_state": wf_state, "depth": 2})

        self.db.commit()
        logger.info(f"Generated {len(saved_cards)} flat 3-level business rule cards (fallback)")
        return saved_cards

