"""
Wiki Enrichment - AI-powered enrichment and per-page wiki operations.

Split from wiki_service.py for maintainability.
Functions here handle background AI enrichment of business rule pages
and per-page AI operations (generate, expand, summarize, rephrase).
"""

import asyncio
import logging
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy import text as sql_text

from app.database import SessionLocal
from app.models.project import Project
from app.services import wiki_fs

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# PROMPT #269 - Rule enrichment background job
# ---------------------------------------------------------------------------

async def _trigger_rule_enrichment_job(
    db, project_id: UUID, rule_count: int, force: bool = False
) -> Optional[UUID]:
    """Create and submit a rule enrichment background job."""
    from app.models.async_job import JobType
    from app.services.job_manager import JobManager
    from app.services.job_executor import PriorityJobExecutor

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.WIKI_RULE_ENRICHMENT,
        input_data={
            "project_id": str(project_id),
            "rule_count": rule_count,
            "force": force,
        },
        project_id=project_id,
        notification_title=f"Expandindo {rule_count} regras wiki",
        deep_link=f"/projects/{project_id}/knowledge",
    )
    db.commit()

    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _enrich_rules_background,
        job.id,
        project_id,
        force,
    )
    logger.info(f"Wiki rule enrichment job {job.id} submitted for {rule_count} rules (force={force})")
    return job.id


async def _enrich_rules_background(
    job_id: UUID,
    project_id: UUID,
    force: bool = False,
):
    """
    Background task to enrich individual business rule wiki pages.
    PROMPT #237 - Reads/writes wiki pages from filesystem.
    """
    db = SessionLocal()
    try:
        from app.services.job_manager import JobManager
        from app.services.ai_orchestrator import AIOrchestrator
        from app.prompts.loader import PromptLoader
        from app.services.wiki_pages import _apply_semantic_links_to_project_fs

        job_manager = JobManager(db)
        job_manager.start_job(job_id)

        # Get project info
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            job_manager.complete_job(job_id, {"enriched": 0, "error": "No project/code_path"})
            return

        code_path = project.code_path
        project_name = project.name or ""
        project_context = (project.context_human or "")[:1000]

        # Get rule pages from filesystem
        all_pages = wiki_fs.list_pages(code_path)
        if force:
            rule_pages = [p for p in all_pages if p.slug.startswith("regra-")]
        else:
            rule_pages = [
                p for p in all_pages
                if p.slug.startswith("regra-") and p.source == "ai_generated"
            ]

        total = len(rule_pages)
        if total == 0:
            job_manager.complete_job(job_id, {"enriched": 0, "total": 0})
            return

        job_manager.update_progress(job_id, 5.0, f"Preparando {total} regras para expansao...")

        # Build parent/sibling context from filesystem
        parent_map: Dict[str, str] = {}  # slug -> parent_slug
        siblings_map: Dict[str, List[str]] = {}  # parent_slug -> list of child titles
        for page in all_pages:
            if page.parent_slug:
                parent_map[page.slug] = page.parent_slug
            ps = page.parent_slug
            if ps:
                if ps not in siblings_map:
                    siblings_map[ps] = []
                if page.slug.startswith("regra-"):
                    siblings_map[ps].append(page.title)

        loader = PromptLoader()
        orchestrator = AIOrchestrator(db)
        enriched_count = 0
        failed_count = 0

        for i, page in enumerate(rule_pages):
            if job_manager.is_cancelled(job_id):
                job_manager.update_progress(
                    job_id, (i / total) * 100,
                    f"Cancelled. {enriched_count} rules enriched out of {i}."
                )
                break

            progress = 5.0 + (i / total) * 90.0
            job_manager.update_progress(
                job_id, progress,
                f"Expandindo regra {i + 1}/{total}: {page.title[:60]}..."
            )

            try:
                domain_name = "Geral"
                source_file = ""
                rule_content = page.title

                if page.source == "ai_generated":
                    for line in page.content.split("\n"):
                        if line.startswith("**Dominio:**") or line.startswith("**Domain:**"):
                            domain_name = line.replace("**Dominio:**", "").replace("**Domain:**", "").strip()
                        elif line.startswith("**Arquivo Fonte:**") or line.startswith("**Source File:**"):
                            source_file = line.replace("**Arquivo Fonte:**", "").replace("**Source File:**", "").strip().strip("`")
                    for desc_marker in ("### Descrição", "### Description"):
                        if desc_marker in page.content:
                            parts = page.content.split(desc_marker, 1)
                            if len(parts) > 1:
                                desc_text = parts[1].split("---")[0].strip()
                                if desc_text:
                                    rule_content = desc_text
                            break
                else:
                    rule_hash = page.slug.replace("regra-", "")
                    rag_result = db.execute(sql_text("""
                        SELECT content, metadata->>'source_file' as source_file
                        FROM rag_documents
                        WHERE project_id = :pid
                        AND (metadata->>'content_type' = 'business_rule'
                             OR metadata->>'type' = 'business_rule')
                        AND md5(content)::varchar LIKE :hash_prefix
                        LIMIT 1
                    """), {"pid": str(project_id), "hash_prefix": f"{rule_hash}%"})
                    rag_row = rag_result.fetchone()
                    if rag_row:
                        rule_content = rag_row[0] or page.title
                        source_file = rag_row[1] or ""
                    else:
                        rule_content = page.content

                    # Get domain from parent page title
                    if page.parent_slug:
                        parent_page = wiki_fs.read_page(code_path, page.parent_slug)
                        if parent_page:
                            domain_name = (parent_page.title
                                .replace("Business Rules - ", "")
                                .replace("Regras de Negocio - ", ""))

                # Get related rules from siblings
                parent_slug = page.parent_slug or ""
                related = siblings_map.get(parent_slug, [])
                related_text = "\n".join(f"- {r}" for r in related[:8]) if related else ""

                template_vars = {
                    "rule_content": rule_content,
                    "domain_name": domain_name,
                    "source_file": source_file,
                    "project_name": project_name,
                    "related_rules": related_text,
                    "project_context": project_context,
                }
                sys_prompt, usr_prompt = loader.render(
                    "context/wiki_rule_enrichment", template_vars
                )

                response = await orchestrator.execute(
                    usage_type="general",
                    messages=[{"role": "user", "content": usr_prompt}],
                    system_prompt=sys_prompt,
                    max_tokens=2000,
                    project_id=str(project_id),
                    metadata={"type": "wiki_rule_enrichment", "rule_slug": page.slug,
                              "skip_context_build": True},
                )

                enriched_content = response.get("content", "")
                if enriched_content and len(enriched_content) > 100:
                    wiki_fs.write_page(
                        code_path=code_path,
                        project_id=project_id,
                        slug=page.slug,
                        title=page.title,
                        content=enriched_content,
                        source="enrichment",
                        order_index=page.order_index,
                        parent_slug=page.parent_slug,
                        respect_protected=False,
                    )
                    enriched_count += 1
                else:
                    failed_count += 1
                    logger.warning(f"Rule enrichment too short for {page.slug}")

            except Exception as e:
                failed_count += 1
                logger.error(f"Failed to enrich rule {page.slug}: {e}")

            await asyncio.sleep(0.1)

        # Re-apply semantic links after enrichment
        linked_count = _apply_semantic_links_to_project_fs(code_path, project_id)

        job_manager.complete_job(job_id, {
            "enriched": enriched_count,
            "failed": failed_count,
            "total": total,
            "semantic_links": linked_count,
        })
        logger.info(
            f"Wiki rule enrichment complete for project {project_id}: "
            f"{enriched_count}/{total} enriched, {failed_count} failed, "
            f"{linked_count} pages with semantic links"
        )

    except Exception as e:
        logger.error(f"Wiki rule enrichment job {job_id} failed: {e}")
        try:
            from app.services.job_manager import JobManager
            JobManager(db).fail_job(job_id, str(e))
        except Exception:
            pass
    finally:
        db.close()


# ---------------------------------------------------------------------------
# PROMPT #247 - Per-page wiki AI operations (generate/expand/summarize/rephrase)
# ---------------------------------------------------------------------------

async def _process_wiki_page_ai_async(
    job_id: UUID,
    action: str,
    project_id: str,
    slug: str,
    page_title: str,
    current_content: Optional[str],
    max_tokens: int = 2000,
):
    """
    Background task for per-page wiki AI operations.
    Follows the same pattern as _process_description_async in project_service.py.

    :param action: "generate", "expand", "summarize", "rephrase"
    :param project_id: project UUID string
    :param slug: wiki page slug
    :param page_title: title of the wiki page
    :param current_content: existing page content (required for expand/summarize/rephrase)
    :param max_tokens: max tokens for AI response
    """
    from app.services.job_manager import JobManager

    db = SessionLocal()
    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"Wiki page AI {action} started (job {job_id}, slug={slug})")

        job_manager.update_progress(job_id, 10.0, f"Preparando prompt ({action})...")

        from app.prompts.loader import PromptLoader
        from app.services.ai_orchestrator import AIOrchestrator

        loader = PromptLoader()

        # Load project context
        pid = UUID(project_id) if isinstance(project_id, str) else project_id
        project = db.query(Project).filter(Project.id == pid).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Build variables
        variables = {
            "page_title": page_title,
            "project_name": project.name or "Projeto",
        }
        if project.description:
            variables["project_description"] = project.description[:500]
        if current_content:
            variables["current_content"] = current_content

        # List existing pages for context (generate action)
        if action == "generate" and project.code_path:
            try:
                pages = wiki_fs.list_pages(project.code_path)
                other_titles = [p.title for p in pages if p.slug != slug]
                if other_titles:
                    variables["existing_pages"] = "\n".join(f"- {t}" for t in other_titles[:20])
            except Exception:
                pass

        # Select prompt template
        prompt_map = {
            "generate": "wiki/generate_page_content",
            "expand": "wiki/expand_page_content",
            "summarize": "wiki/summarize_page_content",
            "rephrase": "wiki/rephrase_page_content",
        }
        prompt_name = prompt_map.get(action, "wiki/generate_page_content")

        system_prompt, user_prompt = loader.render(prompt_name, variables)

        job_manager.update_progress(job_id, 30.0, "Aguardando resposta da IA...")

        orchestrator = AIOrchestrator(db)
        response = await orchestrator.execute(
            usage_type="general",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            metadata={"skip_context_build": True},
            disable_tools=True,
        )

        content = (response.get("content") or "").strip()

        # Save actual AI model name from orchestrator response
        actual_model = response.get("db_model_name")
        if actual_model:
            from app.models.async_job import AsyncJob
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                job.ai_model_name = actual_model
                db.commit()

        job_manager.update_progress(job_id, 80.0, "Salvando conteudo...")

        # Save to wiki page via filesystem
        if content and project.code_path:
            try:
                wiki_fs.write_page(
                    code_path=project.code_path,
                    project_id=pid,
                    slug=slug,
                    title=page_title,
                    content=content,
                    source="ai_generated",
                    respect_protected=False,  # User explicitly requested AI operation
                )
                logger.info(f"Wiki page '{slug}' updated with AI {action}")
            except Exception as save_err:
                logger.warning(f"Could not save wiki page: {save_err}")
        elif not content:
            logger.warning(f"AI returned empty content for wiki page '{slug}' — NOT saving")

        result_data = {"content": content, "action": action, "slug": slug}
        job_manager.complete_job(job_id, result_data)
        logger.info(f"Wiki page AI {action} completed (job {job_id})")

    except Exception as e:
        logger.error(f"Wiki page AI {action} failed (job {job_id}): {e}", exc_info=True)
        try:
            from app.services.job_manager import JobManager as JM
            JM(db).fail_job(job_id, str(e))
        except Exception:
            pass
    finally:
        db.close()
