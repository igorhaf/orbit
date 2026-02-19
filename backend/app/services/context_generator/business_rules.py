"""
Business rules classification and card creation mixin.

Handles AI-based hierarchical classification of business rules
into Epic > Story structure and card creation.
Extracted from context_generator.py during modularization (PROMPT #249).
"""

from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4
from datetime import datetime
from sqlalchemy.orm import Session
import json
import logging

from app.models.project import Project
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.services.rag_service import RAGService
from .utils import _robust_json_parse

logger = logging.getLogger(__name__)


class BusinessRulesMixin:
    """Mixin providing business rule classification and card creation methods."""

    async def generate_business_rule_cards(
        self,
        project_id: UUID
    ) -> List[Dict]:
        """
        PROMPT #120 - Generate closed cards for verified business rules.
        PROMPT #193 - Hierarchical structure.
        PROMPT #246 - Simplified to 2 levels: Epic (domain) > Story (rule).
        PROMPT #285 - Duplicate protection: skips if business_rule cards already exist.

        Uses AI to classify business rules into a 2-level hierarchy:
        - Level 0 = Epic (business domain: Aluno, Professor, Provas, etc.)
        - Level 1 = Story (each business rule as direct child of its domain Epic)

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

        # PROMPT #291 - Read business rules from RAG (comprehensive) instead of
        # initial_memory_context (which only has ~20 rules from initial scan).
        # RAG has ALL rules from continuous scans (typically 500-745+).
        from sqlalchemy import text as sql_text
        rag_result = self.db.execute(sql_text("""
            SELECT content FROM rag_documents
            WHERE project_id = :pid
            AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')
            ORDER BY created_at
        """), {"pid": str(project_id)})
        rag_rules = [row[0] for row in rag_result]

        # Fallback to initial_memory_context if RAG has no rules
        if not rag_rules:
            if project.initial_memory_context:
                rag_rules = project.initial_memory_context.get("business_rules", [])
            if not rag_rules:
                logger.info(f"Project {project_id} has no business rules in RAG or memory context")
                return []

        business_rules = rag_rules

        # PROMPT #291 - Delete existing business_rule cards before regenerating
        # This allows re-running with updated RAG data (745 rules vs old 20).
        existing_br_cards = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.labels.contains(["business_rule"])
        ).count()

        if existing_br_cards > 0:
            logger.info(
                f"Removing {existing_br_cards} existing business_rule cards to regenerate from RAG ({len(business_rules)} rules)"
            )
            self.db.query(Task).filter(
                Task.project_id == project_id,
                Task.labels.contains(["business_rule"])
            ).delete(synchronize_session='fetch')
            self.db.flush()

        logger.info(f"Generating {len(business_rules)} business rule cards from RAG for project {project.name}")

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
        parent_id: Optional[UUID] = None,
        depth: int = 0,
        order_start: int = 0
    ) -> List[Dict]:
        """
        PROMPT #193 - Recursively create cards from AI-classified hierarchy.
        PROMPT #246 - Simplified to 2 levels only: Epic (domain) > Story (rule).

        Maps depth to item_type:
        - 0 = Epic (business domain)
        - 1 = Story (business rule)
        """
        DEPTH_TO_TYPE = {
            0: ItemType.EPIC,
            1: ItemType.STORY,
        }

        saved_cards = []

        for i, node in enumerate(nodes):
            item_type = DEPTH_TO_TYPE.get(depth, ItemType.STORY)
            title = node.get("title", "Sem título")[:200]
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

            # Only recurse into children at depth 0 (Epic → Stories)
            # Max depth 1 = Story (no deeper nesting)
            children = node.get("children", [])
            if children and depth < 1:
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
            description=f"Regras de negocio verificadas no código-fonte. Total: {len(business_rules)}",
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
            # PROMPT #239 - Use clean title without RN prefix
            rule_title = rule.split(":")[0].strip() if ":" in rule else rule[:80]
            # Remove any existing RN prefix from source data
            if rule_title.startswith("RN") and len(rule_title) > 2 and rule_title[2:].lstrip("0123456789").startswith(":"):
                rule_title = rule_title.split(":", 1)[1].strip() if ":" in rule_title else rule_title
            if len(rule_title) > 100:
                rule_title = rule_title[:97] + "..."

            story = Task(
                id=uuid4(),
                project_id=project_id,
                parent_id=parent_epic.id,
                title=rule_title,
                description=rule,
                generated_prompt=rule,
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
