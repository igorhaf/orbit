"""
Incremental Context Service

PROMPT #230 Phase 2 - Updates project description incrementally after each batch
of files is processed, instead of waiting for all files to complete.

Each batch enriches the description with newly discovered business rules,
organized by semantic layer (Schema, Routes, Logic, Presentation, Config).

Key principles:
- NEVER removes existing content (only adds)
- Description grows with each batch
- Evidences trace back to source files
- Works with local models (qwen3:8b) with limited context
"""

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.contracts.loader import ContractLoader
from app.models.project import Project
from app.services.ai_orchestrator import AIOrchestrator
from app.services.pipeline_validator import validate_context

logger = logging.getLogger(__name__)


class IncrementalContextService:
    """
    Updates project description incrementally after each batch processing cycle.

    Called from watchdog.batch_processing_cycle() after Step 1 (process_pending_files)
    when new rules are extracted (rules_extracted > 0).
    """

    def __init__(self, db: Session):
        self.db = db
        self.orchestrator = AIOrchestrator(db)
        self._contract_loader = ContractLoader()

    async def update_context_from_batch(
        self,
        project_id: UUID,
        batch_rules: int,
        batch_number: int = 1,
        rules_by_layer: Optional[Dict[str, int]] = None,
    ) -> Dict[str, Any]:
        """
        Update project description with rules discovered in the latest batch.

        Args:
            project_id: Project UUID
            batch_rules: Number of rules extracted in this batch
            batch_number: Sequential batch number (for tracking)
            rules_by_layer: Dict of {layer_name: rule_count} from process_pending_files

        Returns:
            Dict with update stats (description_before, description_after, rules_integrated)
        """
        if batch_rules == 0:
            return {"skipped": True, "reason": "No rules in batch"}

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return {"skipped": True, "reason": "Project not found"}

        project_name = project.name or str(project_id)[:8]
        # PROMPT #247 - Use context_human instead of description (description is manual-only)
        current_description = project.context_human or ""
        desc_len_before = len(current_description)

        # Fetch recent rules from RAG (this batch's rules are the most recent)
        recent_rules = self._fetch_recent_rules(project_id, limit=batch_rules + 10)

        if not recent_rules:
            logger.info(f"No rules found in RAG for batch context update of '{project_name}'")
            return {"skipped": True, "reason": "No rules in RAG"}

        # Format rules grouped by source file for the prompt
        batch_rules_text = self._format_rules_for_prompt(recent_rules)

        # Format rules_by_layer summary
        layer_summary = ""
        if rules_by_layer:
            parts = [f"- {layer}: {count} regras" for layer, count in sorted(rules_by_layer.items())]
            layer_summary = "\n".join(parts)

        # Render contract
        try:
            system_prompt, user_prompt = self._contract_loader.render(
                "pipeline/context_merge",
                {
                    "project_name": project_name,
                    "current_description": current_description[:6000] if current_description else "",
                    "batch_number": str(batch_number),
                    "batch_rules": batch_rules_text,
                    "rules_by_layer": layer_summary,
                }
            )
        except Exception as e:
            logger.error(f"Failed to render context_merge contract: {e}")
            return {"skipped": True, "reason": f"Contract render failed: {e}"}

        # Call AI to merge context
        try:
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=4096,
                project_id=str(project_id),
                metadata={
                    "type": "incremental_context_merge",
                    "batch_number": batch_number,
                    "rules_count": batch_rules,
                },
            )

            new_description = response.get("content", "") if isinstance(response, dict) else str(response)

            # Validate using pipeline_validator
            is_valid, issues = validate_context(current_description, new_description)
            if issues:
                for issue in issues:
                    logger.warning(f"Context validation issue for '{project_name}': {issue}")

            if not is_valid:
                logger.warning(
                    f"Context merge rejected for '{project_name}': {'; '.join(issues)}"
                )
                return {"skipped": True, "reason": f"Validation failed: {'; '.join(issues)}"}

            # PROMPT #247 - Description is always manual, never auto-generated
            # Context updates go to context_human, not description
            project.context_human = new_description
            self.db.commit()

            desc_len_after = len(new_description)
            logger.info(
                f"Context updated for '{project_name}' batch #{batch_number}: "
                f"{desc_len_before} -> {desc_len_after} chars (+{desc_len_after - desc_len_before})"
            )

            return {
                "updated": True,
                "project_name": project_name,
                "batch_number": batch_number,
                "description_before_len": desc_len_before,
                "description_after_len": desc_len_after,
                "rules_in_batch": batch_rules,
            }

        except Exception as e:
            logger.error(f"Context merge AI call failed for '{project_name}': {e}")
            return {"skipped": True, "reason": f"AI call failed: {e}"}

    def _fetch_recent_rules(self, project_id: UUID, limit: int = 60) -> List[Dict[str, str]]:
        """
        Fetch the most recent business rules from RAG for a project.
        Returns list of dicts with 'content' and 'source_file'.
        """
        result = self.db.execute(sql_text("""
            SELECT content, COALESCE(metadata->>'source_file', '') as source_file
            FROM rag_documents
            WHERE project_id = :pid
            AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
            ORDER BY created_at DESC
            LIMIT :lim
        """), {"pid": str(project_id), "lim": limit})

        return [{"content": row[0], "source_file": row[1]} for row in result.fetchall()]

    @staticmethod
    def _format_rules_for_prompt(rules: List[Dict[str, str]]) -> str:
        """
        Format rules grouped by source file for the AI prompt.
        Keeps output compact for local models with limited context.
        """
        # Group by source file
        by_file: Dict[str, List[str]] = {}
        for rule in rules:
            source = rule.get("source_file", "desconhecido") or "desconhecido"
            content = rule.get("content", "")
            if content and len(content) >= 10:
                if source not in by_file:
                    by_file[source] = []
                # Truncate individual rules to keep prompt compact
                by_file[source].append(content[:300])

        # Format as compact text
        parts = []
        for source_file, file_rules in by_file.items():
            parts.append(f"\n### {source_file}")
            for rule in file_rules:
                parts.append(f"- {rule}")

        return "\n".join(parts) if parts else "Nenhuma regra nova."
