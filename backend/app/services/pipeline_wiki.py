"""
Incremental Wiki Service

PROMPT #230 Phase 3 - Updates wiki pages incrementally after each batch
of files is processed, instead of waiting for all files to complete.

Each batch creates or merges domain-specific wiki pages with new rules.

Key principles:
- MERGE when ai_generated page exists (add rules, don't replace)
- CREATE when page doesn't exist (all 6 mandatory sections)
- NEVER overwrite source='manual' or source='enrichment'
- Works with local models (qwen3:8b) with limited context
"""

import hashlib
import logging
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.contracts.loader import ContractLoader
from app.models.wiki_page import WikiPage
from app.services.ai_orchestrator import AIOrchestrator
from app.services.pipeline_validator import validate_wiki_page

logger = logging.getLogger(__name__)

# Boilerplate dirs to skip when classifying domain (from wiki.py)
_SKIP_DIRS = {
    "app", "src", "lib", "backend", "frontend", "server", "client",
    "core", "main", "base", "common", "shared", "internal", "pkg",
    "cmd", "api", "http", "web", "resources", "public", "static",
    "assets", "dist", "build", "out", "bin", "vendor", "node_modules",
}


class IncrementalWikiService:
    """
    Updates wiki pages incrementally after each batch processing cycle.

    Called from watchdog.batch_processing_cycle() after Step 1.5 (context update)
    when new rules are extracted (rules_extracted > 0).
    """

    def __init__(self, db: Session):
        self.db = db
        self.orchestrator = AIOrchestrator(db)
        self._contract_loader = ContractLoader()

    async def update_wiki_from_batch(
        self,
        project_id: UUID,
        batch_rules: int,
        batch_number: int = 1,
        rules_by_layer: Optional[Dict[str, int]] = None,
    ) -> Dict[str, Any]:
        """
        Create or merge wiki pages with rules discovered in the latest batch.

        Args:
            project_id: Project UUID
            batch_rules: Number of rules extracted in this batch
            batch_number: Sequential batch number
            rules_by_layer: Dict of {layer_name: rule_count}

        Returns:
            Dict with stats (pages_created, pages_merged, domains_processed)
        """
        if batch_rules == 0:
            return {"skipped": True, "reason": "No rules in batch"}

        # Fetch project name
        from app.models.project import Project
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return {"skipped": True, "reason": "Project not found"}

        project_name = project.name or str(project_id)[:8]

        # Fetch recent rules from RAG
        recent_rules = self._fetch_recent_rules(project_id, limit=batch_rules + 10)
        if not recent_rules:
            return {"skipped": True, "reason": "No rules in RAG"}

        # Group rules by domain
        domains = self._group_rules_by_domain(recent_rules)
        if not domains:
            return {"skipped": True, "reason": "No domains classified"}

        # Ensure parent page exists
        self._ensure_rules_parent_page(project_id)

        # PROMPT #232 - Limit domains per batch to avoid >30min jobs (stale job cleanup)
        # Each domain needs 1-2 AI calls (~2-5 min each). 3 domains = ~15 min max.
        MAX_DOMAINS_PER_BATCH = 3
        if len(domains) > MAX_DOMAINS_PER_BATCH:
            logger.info(f"Wiki: {len(domains)} domains found, processing first {MAX_DOMAINS_PER_BATCH} this batch")
            domains = domains[:MAX_DOMAINS_PER_BATCH]

        pages_created = 0
        pages_merged = 0
        errors = 0

        for domain_name, domain_slug, domain_rules in domains:
            try:
                result = await self._process_domain(
                    project_id=project_id,
                    project_name=project_name,
                    domain_name=domain_name,
                    domain_slug=domain_slug,
                    domain_rules=domain_rules,
                )
                # PROMPT #232 - Log each domain result for diagnostics
                logger.info(f"Wiki domain '{domain_name}' ({len(domain_rules)} rules): {result}")
                if result.get("created"):
                    pages_created += 1
                elif result.get("merged"):
                    pages_merged += 1
                elif result.get("error"):
                    errors += 1
            except Exception as e:
                logger.warning(f"Wiki domain '{domain_name}' failed: {e}")
                errors += 1

        if pages_created > 0 or pages_merged > 0:
            self.db.commit()

        logger.info(
            f"Wiki batch #{batch_number} for '{project_name}': "
            f"{pages_created} created, {pages_merged} merged, {errors} errors"
        )

        # PROMPT #232 - Only report "updated" when pages were actually created/merged
        return {
            "updated": pages_created > 0 or pages_merged > 0,
            "pages_created": pages_created,
            "pages_merged": pages_merged,
            "domains_processed": len(domains),
            "errors": errors,
        }

    async def _process_domain(
        self,
        project_id: UUID,
        project_name: str,
        domain_name: str,
        domain_slug: str,
        domain_rules: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        """
        Process a single domain: create or merge its wiki page.
        """
        slug = f"regras-{domain_slug}"

        # Check if page already exists
        existing = self.db.query(WikiPage).filter(
            WikiPage.project_id == project_id,
            WikiPage.slug == slug,
        ).first()

        # Protect manual and enrichment pages
        if existing and existing.source in {"manual", "enrichment"}:
            logger.debug(f"Wiki page '{slug}' is protected (source={existing.source}), skipping")
            return {"protected": True}

        # Format rules for prompt
        rules_text = self._format_domain_rules(domain_rules)

        if existing and existing.source == "ai_generated":
            # MERGE mode: integrate new rules into existing content
            return await self._merge_domain_page(
                project_id=project_id,
                project_name=project_name,
                domain_name=domain_name,
                existing_page=existing,
                rules_text=rules_text,
            )
        else:
            # CREATE mode: new domain page
            return await self._create_domain_page(
                project_id=project_id,
                project_name=project_name,
                domain_name=domain_name,
                domain_slug=domain_slug,
                rules_text=rules_text,
            )

    async def _create_domain_page(
        self,
        project_id: UUID,
        project_name: str,
        domain_name: str,
        domain_slug: str,
        rules_text: str,
    ) -> Dict[str, Any]:
        """Create a new wiki page for a domain with retry and fallback."""
        try:
            system_prompt, user_prompt = self._contract_loader.render(
                "pipeline/wiki_page",
                {
                    "domain_name": domain_name,
                    "project_name": project_name,
                    "new_rules": rules_text,
                    "mode": "create",
                }
            )
        except Exception as e:
            logger.error(f"Failed to render wiki_page contract for create: {e}")
            return {"error": str(e)}

        content = None
        try:
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=3000,
                project_id=str(project_id),
                metadata={
                    "type": "wiki_page_create",
                    "domain": domain_name,
                },
            )

            content = response.get("content", "") if isinstance(response, dict) else str(response)

            # Validate wiki page content
            is_valid, issues = validate_wiki_page(content, mode="create")
            if issues:
                for issue in issues:
                    logger.warning(f"Wiki create validation for '{domain_name}': {issue}")

            # PROMPT #232 - Retry once with feedback if validation fails
            if not is_valid:
                logger.info(f"Wiki create retry for '{domain_name}' (issues: {'; '.join(issues)})")
                retry_prompt = (
                    f"{user_prompt}\n\n"
                    f"ATENCAO: Sua resposta anterior foi rejeitada pelos seguintes motivos:\n"
                    f"{chr(10).join(f'- {i}' for i in issues)}\n"
                    f"Corrija estes problemas. Inclua TODAS as 6 secoes obrigatorias."
                )
                response = await self.orchestrator.execute(
                    usage_type="memory",
                    messages=[{"role": "user", "content": retry_prompt}],
                    system_prompt=system_prompt,
                    max_tokens=3000,
                    project_id=str(project_id),
                    metadata={"type": "wiki_page_create_retry", "domain": domain_name},
                )
                content = response.get("content", "") if isinstance(response, dict) else str(response)
                is_valid, issues = validate_wiki_page(content, mode="create")

            if not is_valid:
                logger.warning(f"Wiki create rejected after retry for '{domain_name}': {'; '.join(issues)}")
                # PROMPT #232 - Fallback: generate minimal page from raw rules
                content = self._build_fallback_page(domain_name, rules_text)
                logger.info(f"Wiki fallback page generated for '{domain_name}' ({len(content)} chars)")

        except Exception as e:
            logger.error(f"AI wiki page creation failed for '{domain_name}': {e}")
            # Fallback on AI failure too
            content = self._build_fallback_page(domain_name, rules_text)
            logger.info(f"Wiki fallback page generated after error for '{domain_name}'")

        # Find parent page for hierarchy
        parent = self.db.query(WikiPage).filter(
            WikiPage.project_id == project_id,
            WikiPage.slug == "regras-de-negocio",
        ).first()

        slug = f"regras-{domain_slug}"
        page = WikiPage(
            project_id=project_id,
            slug=slug,
            title=f"Regras: {domain_name}",
            content=content,
            parent_id=parent.id if parent else None,
            order_index=30,
            source="ai_generated",
            batch_source={
                "domain": domain_name,
                "rules_added": len(rules_text.split("\n")),
                "action": "create",
            },
        )
        self.db.add(page)
        self.db.flush()

        logger.info(f"Created wiki page '{slug}' for domain '{domain_name}' ({len(content)} chars)")
        return {"created": True, "slug": slug, "chars": len(content)}

    async def _merge_domain_page(
        self,
        project_id: UUID,
        project_name: str,
        domain_name: str,
        existing_page: WikiPage,
        rules_text: str,
    ) -> Dict[str, Any]:
        """Merge new rules into an existing ai_generated wiki page."""
        existing_content = existing_page.content or ""

        try:
            system_prompt, user_prompt = self._contract_loader.render(
                "pipeline/wiki_page",
                {
                    "domain_name": domain_name,
                    "project_name": project_name,
                    "existing_content": existing_content[:4000],
                    "new_rules": rules_text,
                    "mode": "merge",
                }
            )
        except Exception as e:
            logger.error(f"Failed to render wiki_page contract for merge: {e}")
            return {"error": str(e)}

        try:
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=3000,
                project_id=str(project_id),
                metadata={
                    "type": "wiki_page_merge",
                    "domain": domain_name,
                    "slug": existing_page.slug,
                },
            )

            new_content = response.get("content", "") if isinstance(response, dict) else str(response)

            # Validate wiki page merge
            is_valid, issues = validate_wiki_page(
                new_content, mode="merge", existing_content=existing_content
            )
            if issues:
                for issue in issues:
                    logger.warning(f"Wiki merge validation for '{domain_name}': {issue}")
            if not is_valid:
                logger.warning(f"Wiki merge rejected for '{domain_name}': {'; '.join(issues)}")
                return {"error": f"Validation failed: {'; '.join(issues)}"}

            existing_page.content = new_content
            # Keep source as ai_generated (not changing to enrichment)

            logger.info(
                f"Merged wiki page '{existing_page.slug}': "
                f"{len(existing_content)} -> {len(new_content)} chars"
            )
            return {"merged": True, "slug": existing_page.slug, "chars": len(new_content)}

        except Exception as e:
            logger.error(f"AI wiki merge failed for '{domain_name}': {e}")
            return {"error": str(e)}

    def _ensure_rules_parent_page(self, project_id: UUID):
        """Ensure the parent 'Regras de Negocio' page exists."""
        existing = self.db.query(WikiPage).filter(
            WikiPage.project_id == project_id,
            WikiPage.slug == "regras-de-negocio",
        ).first()

        if not existing:
            page = WikiPage(
                project_id=project_id,
                slug="regras-de-negocio",
                title="Regras de Negocio",
                content="# Regras de Negocio\n\nPaginas de regras de negocio organizadas por dominio.\n",
                order_index=2,
                source="ai_generated",
            )
            self.db.add(page)
            self.db.flush()
            logger.info(f"Created parent wiki page 'regras-de-negocio' for project {project_id}")

    def _fetch_recent_rules(self, project_id: UUID, limit: int = 60) -> List[Dict[str, str]]:
        """Fetch the most recent business rules from RAG."""
        result = self.db.execute(sql_text("""
            SELECT content, COALESCE(metadata->>'source_file', '') as source_file
            FROM rag_documents
            WHERE project_id = :pid
            AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
            ORDER BY created_at DESC
            LIMIT :lim
        """), {"pid": str(project_id), "lim": limit})

        return [{"content": row[0], "source_file": row[1]} for row in result.fetchall()]

    def _group_rules_by_domain(
        self, rules: List[Dict[str, str]]
    ) -> List[Tuple[str, str, List[Dict[str, str]]]]:
        """
        Group rules by business domain using stack-agnostic classification.
        Returns list of (domain_name, domain_slug, rules).
        """
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
            if domain_rules  # skip empty
        ]

    @staticmethod
    def _classify_domain(source_file: str) -> Tuple[str, str]:
        """
        Stack-agnostic domain classification from file path.
        Extracts the most meaningful directory name.
        """
        if not source_file:
            return ("Geral", "geral")

        path = source_file.replace("\\", "/")

        # Remove project root prefix
        if "/projects/" in path:
            path = path.split("/projects/", 1)[-1]
            parts = path.split("/")
            if len(parts) > 1:
                parts = parts[1:]
            path = "/".join(parts)

        parts = path.split("/")
        if len(parts) > 1:
            parts = parts[:-1]  # remove filename
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

        # Fallback
        last = parts[-1].strip() if parts else ""
        if last:
            slug = re.sub(r"[^a-z0-9]+", "-", last.lower()).strip("-")
            return (last.replace("_", " ").replace("-", " ").title(), slug or "geral")

        return ("Geral", "geral")

    @staticmethod
    def _build_fallback_page(domain_name: str, rules_text: str) -> str:
        """
        PROMPT #232 - Build a minimal wiki page from raw rules without AI.
        Used when AI generation fails or validation rejects after retry.
        Ensures data is not lost even if AI can't produce quality content.
        """
        lines = [
            f"## Visao Geral do Dominio",
            f"Pagina de regras do dominio {domain_name}, gerada automaticamente.",
            "",
            f"## Regras de Negocio",
        ]
        # Extract bullet points from rules_text
        for line in rules_text.split("\n"):
            line = line.strip()
            if line.startswith("- ") and len(line) > 10:
                lines.append(line)
            elif line.startswith("**") and line.endswith(":**"):
                # Source file header → add as origin reference
                lines.append(f"\n{line}")
        lines.extend([
            "",
            "## Fluxos e Processos",
            "Informacao pendente de analise.",
            "",
            "## Entidades Envolvidas",
            "Informacao pendente de analise.",
            "",
            "## Restricoes e Validacoes",
            "Informacao pendente de analise.",
            "",
            "## Cenarios de Uso",
            "Informacao pendente de analise.",
        ])
        return "\n".join(lines)

    @staticmethod
    def _format_domain_rules(rules: List[Dict[str, str]]) -> str:
        """Format rules for AI prompt, grouped by source file."""
        by_file: Dict[str, List[str]] = defaultdict(list)
        for rule in rules:
            source = rule.get("source_file", "desconhecido") or "desconhecido"
            content = rule.get("content", "")
            if content and len(content) >= 10:
                by_file[source].append(content[:300])

        parts = []
        for source_file, file_rules in by_file.items():
            parts.append(f"\n**{source_file}:**")
            for rule in file_rules:
                parts.append(f"- {rule}")

        return "\n".join(parts) if parts else "Nenhuma regra nova."
