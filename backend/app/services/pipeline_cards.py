"""
Hierarchical Card Service

PROMPT #230 Phase 4 - Creates hierarchical cards (Epic -> Story) from each batch
of processed files. Stack-agnostic domain classification replaces the hardcoded
Laravel-specific _classify_rule_domain.

Key principles:
- NEVER recreate existing cards (similarity check)
- Epics per business domain (100% functional language)
- Stories as user stories under Epics ("Como X, quero Y, para Z")
- Labels include batch number for traceability
- Stack-agnostic domain classification
"""

import json
import logging
import re
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.contracts.loader import ContractLoader
from app.models.task import Task, ItemType, TaskStatus, PriorityLevel
from app.services.ai_orchestrator import AIOrchestrator
from app.services.pipeline_validator import validate_card, validate_stories_response

logger = logging.getLogger(__name__)

# Boilerplate dirs to skip when classifying domain
_SKIP_DIRS = {
    "app", "src", "lib", "backend", "frontend", "server", "client",
    "core", "main", "base", "common", "shared", "internal", "pkg",
    "cmd", "api", "http", "web", "resources", "public", "static",
    "assets", "dist", "build", "out", "bin", "vendor", "node_modules",
}


class HierarchicalCardService:
    """
    Creates hierarchical cards from business rules discovered in each batch.

    Called from watchdog.batch_processing_cycle() after wiki update
    when new rules are extracted (rules_extracted > 0).
    """

    def __init__(self, db: Session):
        self.db = db
        self.orchestrator = AIOrchestrator(db)
        self._contract_loader = ContractLoader()

    async def extend_cards_from_batch(
        self,
        project_id: UUID,
        batch_rules: int,
        batch_number: int = 1,
        rules_by_layer: Optional[Dict[str, int]] = None,
    ) -> Dict[str, Any]:
        """
        Create hierarchical cards from rules discovered in the latest batch.

        Args:
            project_id: Project UUID
            batch_rules: Number of rules extracted in this batch
            batch_number: Sequential batch number
            rules_by_layer: Dict of {layer_name: rule_count}

        Returns:
            Dict with stats (epics_created, stories_created, domains)
        """
        if batch_rules == 0:
            return {"checked": 0, "created": 0, "epics_created": 0}

        # Fetch project info
        from app.models.project import Project
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return {"checked": 0, "created": 0, "epics_created": 0}

        project_name = project.name or str(project_id)[:8]
        project_context = (project.context_human or "")[:500]

        # Fetch recent rules from RAG
        recent_rules = self._fetch_recent_rules(project_id, limit=50)
        if not recent_rules:
            return {"checked": len(recent_rules), "created": 0, "epics_created": 0}

        # Get existing card texts for similarity check
        existing_texts = self._get_existing_card_texts(project_id)

        # Filter duplicates
        new_rules = self._filter_duplicates(recent_rules, existing_texts, max_rules=15)
        if not new_rules:
            return {"checked": len(recent_rules), "created": 0, "epics_created": 0}

        # Group by domain (stack-agnostic)
        domains = self._group_rules_by_domain(new_rules)

        # Process each domain
        epics_created = 0
        stories_created = 0
        batch_label = f"batch-{batch_number}"

        for domain_name, domain_slug, domain_rules in domains:
            try:
                # Find or create Epic for this domain
                epic = self._find_existing_domain_epic(project_id, domain_name)

                if not epic:
                    epic = await self._create_domain_epic(
                        project_id, project_name, project_context,
                        domain_name, domain_rules, batch_label,
                    )
                    epics_created += 1

                # Create stories under this epic via AI
                stories = await self._create_stories_for_domain(
                    project_id, project_name, project_context,
                    domain_name, epic, domain_rules, batch_label,
                    existing_texts,
                )
                stories_created += stories

            except Exception as e:
                logger.warning(f"Card creation for domain '{domain_name}' failed: {e}")

        if epics_created > 0 or stories_created > 0:
            self.db.commit()

        logger.info(
            f"Cards batch #{batch_number} for '{project_name}': "
            f"{epics_created} epics, {stories_created} stories"
        )

        return {
            "checked": len(recent_rules),
            "created": stories_created + epics_created,
            "epics_created": epics_created,
            "stories_created": stories_created,
            "domains": len(domains),
        }

    def _find_existing_domain_epic(self, project_id: UUID, domain_name: str) -> Optional[Task]:
        """Find an existing Epic for a business domain by label and title."""
        epics = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.item_type == ItemType.EPIC,
            Task.labels.contains(["domain-epic"]),
        ).all()

        domain_lower = domain_name.lower()
        for epic in epics:
            if epic.title and domain_lower in epic.title.lower():
                return epic
        return None

    async def _create_domain_epic(
        self,
        project_id: UUID,
        project_name: str,
        project_context: str,
        domain_name: str,
        domain_rules: List[Dict[str, str]],
        batch_label: str,
    ) -> Task:
        """Create a new Epic for a business domain using AI."""
        rules_text = "\n".join([f"- {r['content'][:200]}" for r in domain_rules])
        rule_count = len(domain_rules)

        epic_title = f"Gestao de {domain_name}"
        epic_description = rules_text
        epic_acceptance = []

        try:
            from app.prompts.loader import PromptLoader
            loader = PromptLoader()
            sys_prompt, usr_prompt = loader.render("backlog/epic_from_rules", {
                "domain_name": domain_name,
                "rules_text": rules_text,
                "rule_count": str(rule_count),
                "project_name": project_name,
                "project_context": project_context,
            })

            response = await self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": usr_prompt}],
                system_prompt=sys_prompt,
                max_tokens=4000,
                project_id=str(project_id),
                metadata={"type": "epic_from_rules", "domain": domain_name},
            )

            ai_text = response.get("content", "") if isinstance(response, dict) else str(response)

            # Parse JSON
            clean = ai_text.strip()
            if clean.startswith("```"):
                clean = clean.split("\n", 1)[1] if "\n" in clean else clean[3:]
                if clean.endswith("```"):
                    clean = clean[:-3]
                clean = clean.strip()

            parsed = json.loads(clean)
            epic_title = parsed.get("title", epic_title)
            epic_description = parsed.get("description_markdown", rules_text)
            raw_criteria = parsed.get("acceptance_criteria", [])
            epic_acceptance = [
                {"text": c, "completed": False} if isinstance(c, str) else c
                for c in raw_criteria
            ]
        except Exception as e:
            logger.warning(f"AI Epic generation failed for '{domain_name}': {e}")

        # Validate Epic content
        is_valid, issues = validate_card(
            title=epic_title,
            description=epic_description,
            item_type="epic",
            acceptance_criteria=epic_acceptance,
        )
        if issues:
            for issue in issues:
                logger.warning(f"Epic validation for '{domain_name}': {issue}")

        new_epic = Task(
            project_id=project_id,
            title=epic_title,
            description=epic_description,
            item_type=ItemType.EPIC,
            status=TaskStatus.BACKLOG,
            priority=PriorityLevel.MEDIUM,
            labels=["suggested", "auto-discovered", "domain-epic", batch_label],
            workflow_state="draft",
            reporter="watchdog",
            acceptance_criteria=epic_acceptance,
            batch_source={"batch_label": batch_label, "domain": domain_name, "type": "epic"},
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self.db.add(new_epic)
        self.db.flush()
        logger.info(f"Created domain Epic '{epic_title}' for project {project_id}")
        return new_epic

    async def _create_stories_for_domain(
        self,
        project_id: UUID,
        project_name: str,
        project_context: str,
        domain_name: str,
        epic: Task,
        domain_rules: List[Dict[str, str]],
        batch_label: str,
        existing_texts: List[str],
    ) -> int:
        """Create Stories under an Epic using AI for better formatting."""
        rules_text = "\n".join([
            f"- {r['content'][:200]} (origem: {r.get('source_file', 'desconhecido')})"
            for r in domain_rules
        ])

        # Try AI generation for formatted stories
        stories_data = []
        try:
            sys_prompt, usr_prompt = self._contract_loader.render(
                "pipeline/card_hierarchy",
                {
                    "domain_name": domain_name,
                    "epic_title": epic.title or "",
                    "project_name": project_name,
                    "project_context": project_context,
                    "rules_text": rules_text,
                    "rule_count": str(len(domain_rules)),
                }
            )

            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": usr_prompt}],
                system_prompt=sys_prompt,
                max_tokens=3000,
                project_id=str(project_id),
                metadata={"type": "stories_from_rules", "domain": domain_name},
            )

            ai_text = response.get("content", "") if isinstance(response, dict) else str(response)

            # Validate AI response structure
            is_valid, resp_issues, parsed = validate_stories_response(ai_text)
            if resp_issues:
                for issue in resp_issues:
                    logger.warning(f"Stories response validation for '{domain_name}': {issue}")
            if is_valid and parsed:
                stories_data = parsed.get("stories", [])

        except Exception as e:
            logger.warning(f"AI Story generation failed for '{domain_name}': {e}")

        # Fallback: create simple stories from rules if AI failed
        if not stories_data:
            stories_data = self._fallback_stories(domain_rules)

        # Create Story cards, checking for duplicates
        created = 0
        for story in stories_data[:5]:  # Max 5 stories per domain per batch
            title = story.get("title", "")
            if not title or len(title) < 10:
                continue

            # Check similarity against existing cards
            story_text = f"{title}\n{story.get('description', '')}"
            if self._is_duplicate(story_text, existing_texts):
                continue

            description = story.get("description", "")
            source_file = story.get("source_file", "")

            acceptance = [
                {"text": c, "completed": False} if isinstance(c, str) else c
                for c in story.get("acceptance_criteria", [])
            ]

            # Validate story content
            story_valid, story_issues = validate_card(
                title=title, description=description,
                item_type="story", acceptance_criteria=acceptance,
            )
            if story_issues:
                for issue in story_issues:
                    logger.debug(f"Story validation for '{title[:50]}': {issue}")

            new_story = Task(
                project_id=project_id,
                title=title[:255],
                description=description,
                item_type=ItemType.STORY,
                status=TaskStatus.BACKLOG,
                priority=PriorityLevel.LOW,
                parent_id=epic.id,
                labels=["suggested", "auto-discovered", batch_label],
                batch_source={"batch_label": batch_label, "domain": domain_name, "source_file": source_file},
                workflow_state="draft",
                reporter="watchdog",
                acceptance_criteria=acceptance,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            self.db.add(new_story)
            existing_texts.append(story_text)
            created += 1

        return created

    @staticmethod
    def _fallback_stories(domain_rules: List[Dict[str, str]]) -> List[Dict]:
        """Create simple story data from rules when AI fails."""
        stories = []
        for rule in domain_rules[:5]:
            content = rule.get("content", "")
            source = rule.get("source_file", "desconhecido")
            title = content.split(".")[0].strip()[:100]
            if len(title) < 10:
                title = content[:100]

            stories.append({
                "title": title,
                "description": f"## Regra de Negocio\n\n{content}\n\n## Origem\n\n`{source}`",
                "acceptance_criteria": [],
                "source_file": source,
            })
        return stories

    def _fetch_recent_rules(self, project_id: UUID, limit: int = 50) -> List[Dict[str, str]]:
        """Fetch the most recent business rules from RAG."""
        result = self.db.execute(sql_text("""
            SELECT content, COALESCE(metadata->>'source_file', '') as source_file
            FROM rag_documents
            WHERE project_id = :pid
            AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
            AND created_at > NOW() - INTERVAL '7 days'
            ORDER BY created_at DESC
            LIMIT :lim
        """), {"pid": str(project_id), "lim": limit})
        return [{"content": row[0], "source_file": row[1]} for row in result.fetchall()]

    def _get_existing_card_texts(self, project_id: UUID) -> List[str]:
        """Get existing card title+description texts for duplicate detection."""
        tasks = self.db.query(Task).filter(Task.project_id == project_id).all()
        return [f"{t.title or ''}\n{t.description or ''}" for t in tasks]

    def _filter_duplicates(
        self,
        rules: List[Dict[str, str]],
        existing_texts: List[str],
        max_rules: int = 15,
    ) -> List[Dict[str, str]]:
        """Filter out rules that are duplicates of existing cards."""
        try:
            from app.services.similarity_detector import calculate_semantic_similarity
        except ImportError:
            logger.warning("SimilarityDetector not available, skipping duplicate filter")
            return rules[:max_rules]

        new_rules = []
        accepted_texts = []

        for rule in rules:
            content = rule.get("content", "")
            if not content or len(content) < 30:
                continue
            if len(new_rules) >= max_rules:
                break

            is_dup = False
            for existing in existing_texts + accepted_texts:
                if not existing.strip():
                    continue
                try:
                    if calculate_semantic_similarity(content, existing) >= 0.90:
                        is_dup = True
                        break
                except Exception:
                    continue

            if not is_dup:
                new_rules.append(rule)
                accepted_texts.append(content)

        return new_rules

    @staticmethod
    def _is_duplicate(text: str, existing_texts: List[str], threshold: float = 0.90) -> bool:
        """Check if text is a duplicate of any existing text."""
        try:
            from app.services.similarity_detector import calculate_semantic_similarity
        except ImportError:
            return False

        for existing in existing_texts:
            if not existing.strip():
                continue
            try:
                if calculate_semantic_similarity(text, existing) >= threshold:
                    return True
            except Exception:
                continue
        return False

    def _group_rules_by_domain(
        self, rules: List[Dict[str, str]]
    ) -> List[Tuple[str, str, List[Dict[str, str]]]]:
        """Group rules by business domain (stack-agnostic)."""
        domains: Dict[str, List[Dict[str, str]]] = defaultdict(list)
        domain_slugs: Dict[str, str] = {}

        for rule in rules:
            source_file = rule.get("source_file", "")
            domain_name, domain_slug = self._classify_domain(source_file)
            domains[domain_name].append(rule)
            domain_slugs[domain_name] = domain_slug

        return [
            (name, domain_slugs[name], domain_rules)
            for name, domain_rules in domains.items()
            if domain_rules
        ]

    @staticmethod
    def _classify_domain(source_file: str) -> Tuple[str, str]:
        """Stack-agnostic domain classification from file path."""
        if not source_file:
            return ("Geral", "geral")

        path = source_file.replace("\\", "/")
        if "/projects/" in path:
            path = path.split("/projects/", 1)[-1]
            parts = path.split("/")
            if len(parts) > 1:
                parts = parts[1:]
            path = "/".join(parts)

        parts = path.split("/")
        if len(parts) > 1:
            parts = parts[:-1]
        else:
            name = parts[0].rsplit(".", 1)[0] if "." in parts[0] else parts[0]
            if name:
                slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
                return (name.replace("_", " ").replace("-", " ").title(), slug or "geral")
            return ("Geral", "geral")

        for part in parts:
            clean = part.strip()
            if clean.lower() not in _SKIP_DIRS and len(clean) > 1:
                slug = re.sub(r"[^a-z0-9]+", "-", clean.lower()).strip("-")
                name = clean.replace("_", " ").replace("-", " ").title()
                return (name, slug or "geral")

        last = parts[-1].strip() if parts else ""
        if last:
            slug = re.sub(r"[^a-z0-9]+", "-", last.lower()).strip("-")
            return (last.replace("_", " ").replace("-", " ").title(), slug or "geral")

        return ("Geral", "geral")
