"""
Wiki API Routes
PROMPT #261 - Multi-page Wiki System

CRUD endpoints for wiki pages within projects.
"""

import re
import logging
from typing import Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.database import get_db
from app.models.wiki_page import WikiPage
from app.models.project import Project
from app.schemas.wiki import (
    WikiPageCreate,
    WikiPageUpdate,
    WikiPageResponse,
    WikiPageTreeItem,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Business logic extracted to wiki_service.py (PROMPT #252 - Frente 4)
from app.services.wiki_service import (
    _slugify,
    _ensure_unique_slug,
    _upsert_wiki_page,
    _build_stack_page,
    _build_rules_page,
    _build_features_page,
    _build_scan_page,
    _build_architecture_patterns_page,
    _build_code_conventions_page,
    _build_ui_components_page,
    _build_code_structure_page,
    _build_git_history_page,
    _build_business_rules_wiki_pages,
    _trigger_rule_enrichment_job,
    _apply_semantic_links_to_project,
    _parse_wiki_sections,
    _parse_wiki_subsections,
)

@router.get("/{project_id}/wiki", response_model=List[WikiPageResponse])
async def list_wiki_pages(
    project_id: UUID,
    parent_id: Optional[UUID] = Query(None, description="Filter by parent page"),
    db: Session = Depends(get_db),
):
    """List all wiki pages for a project, optionally filtered by parent."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    query = db.query(WikiPage).filter(WikiPage.project_id == project_id)

    if parent_id is not None:
        query = query.filter(WikiPage.parent_id == parent_id)

    pages = query.order_by(WikiPage.order_index, WikiPage.title).all()
    return pages


@router.get("/{project_id}/wiki/tree", response_model=List[WikiPageTreeItem])
async def get_wiki_tree(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """Get the full wiki page tree for a project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    all_pages = (
        db.query(WikiPage)
        .filter(WikiPage.project_id == project_id)
        .order_by(WikiPage.order_index, WikiPage.title)
        .all()
    )

    # Build tree structure
    pages_by_id = {str(p.id): p for p in all_pages}
    root_pages = []
    children_map: dict = {}

    for page in all_pages:
        parent_key = str(page.parent_id) if page.parent_id else None
        if parent_key not in children_map:
            children_map[parent_key] = []
        children_map[parent_key].append(page)

    def build_tree(parent_id_str: Optional[str]) -> List[WikiPageTreeItem]:
        items = children_map.get(parent_id_str, [])
        result = []
        for page in items:
            item = WikiPageTreeItem(
                id=page.id,
                slug=page.slug,
                title=page.title,
                parent_id=page.parent_id,
                order_index=page.order_index,
                source=page.source,
                children=build_tree(str(page.id)),
            )
            result.append(item)
        return result

    # PROMPT #275 - Auto-trigger enrichment for unenriched rule pages
    unenriched_rules = [
        p for p in all_pages
        if p.slug.startswith("regra-") and p.source == "ai_generated"
    ]
    if unenriched_rules:
        # Check if there's already an enrichment job running/pending for this project
        from app.models.async_job import AsyncJob, JobType, JobStatus
        existing_job = (
            db.query(AsyncJob)
            .filter(
                AsyncJob.project_id == project_id,
                AsyncJob.job_type == JobType.WIKI_RULE_ENRICHMENT,
                AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
            )
            .first()
        )
        if not existing_job:
            try:
                await _trigger_rule_enrichment_job(db, project_id, len(unenriched_rules))
                logger.info(
                    f"Auto-triggered enrichment for {len(unenriched_rules)} "
                    f"unenriched rule pages in project {project_id}"
                )
            except Exception as e:
                logger.warning(f"Auto-enrichment trigger failed: {e}")

    return build_tree(None)


@router.post("/{project_id}/wiki/generate-from-context")
async def generate_wiki_from_context(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    Generate wiki pages from project context data.
    Creates structured pages from project description, scan results,
    business rules, and interview answers.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    created_pages = []

    # 1. Visao Geral - from project description
    if project.description:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "visao-geral", "Visao Geral",
            project.description, 0, "enrichment"
        ))

    # 2. Stack Tecnologica - from initial_memory_context
    imc = project.initial_memory_context or {}
    stack_info = imc.get("stack_info", {})
    scan_summary = imc.get("scan_summary", {})
    if stack_info or project.stack:
        stack_content = _build_stack_page(project, stack_info, scan_summary)
        created_pages.append(_upsert_wiki_page(
            db, project_id, "stack-tecnologica", "Stack Tecnologica",
            stack_content, 1, "ai_generated"
        ))

    # 3. Regras de Negocio - PROMPT #268
    # The main "regras-de-negocio" page comes from AI enrichment (parsed from description).
    # Here we create a raw reference catalog as supplementary page.
    from sqlalchemy import text as sql_text
    rag_result = db.execute(sql_text("""
        SELECT content FROM rag_documents
        WHERE project_id = :pid
        AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
        ORDER BY created_at DESC
        LIMIT 500
    """), {"pid": str(project_id)})
    rag_rules = [row[0] for row in rag_result.fetchall()]

    business_rules = imc.get("business_rules", [])
    all_rules = rag_rules if rag_rules else business_rules
    if not all_rules and business_rules:
        all_rules = business_rules

    if all_rules:
        rules_parts = [
            "## Catálogo de Referência - Regras Brutas\n",
            f"Total de regras extraidas do codebase: **{len(all_rules)}**\n",
            "Estas são as regras brutas extraidas automaticamente do código-fonte.",
            "A página principal de [Regras de Negocio](wiki:regras-de-negocio) contém a versão expandida e organizada.\n",
        ]
        for i, rule in enumerate(all_rules, 1):
            if isinstance(rule, dict):
                title = rule.get("title", rule.get("rule", f"Regra {i}"))
                desc = rule.get("description", "")
                rules_parts.append(f"### {i}. {title}\n")
                if desc:
                    rules_parts.append(f"{desc}\n")
            else:
                rule_text = rule[:500] if len(rule) > 500 else rule
                rules_parts.append(f"{i}. {rule_text}")
        rules_content = "\n".join(rules_parts)
        # PROMPT #277 - Set parent_id to regras-de-negocio to avoid appearing as root in sidebar
        regras_parent = next((p for p in created_pages if p and p.slug == "regras-de-negocio"), None)
        created_pages.append(_upsert_wiki_page(
            db, project_id, "regras-catálogo-bruto",
            "Catálogo de Referência - Regras Brutas",
            rules_content, 12, "ai_generated",
            parent_id=regras_parent.id if regras_parent else None,
        ))

    # 4. Features Principais - from initial_memory_context
    features = imc.get("key_features", [])
    if features:
        features_content = _build_features_page(features)
        created_pages.append(_upsert_wiki_page(
            db, project_id, "features-principais", "Features Principais",
            features_content, 3, "ai_generated"
        ))

    # 5. Contexto do Projeto - from context_human
    if project.context_human:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "contexto-projeto", "Contexto do Projeto",
            project.context_human, 4, "enrichment"
        ))

    # 6. Scan Summary - from initial_memory_context
    scan_summary = imc.get("scan_summary", {})
    if not scan_summary:
        # Try to extract from top-level imc fields
        total_files = imc.get("total_files", 0)
        if total_files:
            scan_summary = {
                "total_files": total_files,
                "code_files": imc.get("code_files", 0),
                "languages": imc.get("languages", []),
            }
    if scan_summary:
        scan_content = _build_scan_page(scan_summary)
        created_pages.append(_upsert_wiki_page(
            db, project_id, "resumo-codebase", "Resumo do Codebase",
            scan_content, 5, "ai_generated"
        ))

    # PROMPT #267 - Generate wiki pages from ALL RAG data types
    # 7. Padrões de Arquitetura - from RAG discovered patterns (architecture)
    arch_content = _build_architecture_patterns_page(db, project_id)
    if arch_content:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "padrões-arquitetura", "Padrões de Arquitetura",
            arch_content, 6, "ai_generated"
        ))

    # 8. Convencoes de Código - from RAG discovered patterns (naming/class/import)
    conv_content = _build_code_conventions_page(db, project_id)
    if conv_content:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "convencoes-código", "Convencoes de Código",
            conv_content, 7, "ai_generated"
        ))

    # 9. Componentes e Interface - from RAG discovered patterns (UI)
    ui_content = _build_ui_components_page(db, project_id)
    if ui_content:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "componentes-interface", "Componentes e Interface",
            ui_content, 8, "ai_generated"
        ))

    # 10. Estrutura de Código - aggregated from RAG code files
    struct_content = _build_code_structure_page(db, project_id)
    if struct_content:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "estrutura-código", "Estrutura de Código",
            struct_content, 9, "ai_generated"
        ))

    # 11. Histórico de Desenvolvimento - from RAG git commits
    git_content = _build_git_history_page(db, project_id)
    if git_content:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "histórico-desenvolvimento", "Histórico de Desenvolvimento",
            git_content, 10, "ai_generated"
        ))

    # PROMPT #265/#268 - Parse enriched project.description into separate wiki pages.
    # The AI enrichment generates markdown with ## or ### sections.
    # Each section becomes its own wiki page (Regras, Features, Arquitetura, etc.)
    if project.description and ('## ' in project.description or '### ' in project.description):
        sections = _parse_wiki_sections(project.description)
        # Also parse ### headers if ## parsing yielded few results
        if len(sections) <= 1:
            sections.update(_parse_wiki_subsections(project.description))
        for slug, (title, content) in sections.items():
            existing_slugs = [p.slug for p in created_pages if p]
            if slug not in existing_slugs:
                page = _upsert_wiki_page(
                    db, project_id, slug, title, content,
                    len(created_pages), "enrichment"
                )
                created_pages.append(page)

    # PROMPT #269 - Individual business rule wiki pages (hierarchical)
    rule_pages = _build_business_rules_wiki_pages(db, project_id)
    created_pages.extend(rule_pages)

    db.commit()

    # PROMPT #274 - Apply semantic hypertext linking (Wikipedia-style)
    linked_count = _apply_semantic_links_to_project(db, project_id)

    # PROMPT #270 - Auto-trigger AI enrichment for individual rule pages
    rule_page_count = len([p for p in rule_pages if p and p.slug.startswith("regra-")])
    enrichment_job_id = None
    if rule_page_count > 0:
        try:
            enrichment_job_id = await _trigger_rule_enrichment_job(db, project_id, rule_page_count)
        except Exception as e:
            logger.warning(f"Failed to trigger rule enrichment: {e}")

    total_pages = len([p for p in created_pages if p])
    result = {
        "detail": f"{total_pages} páginas wiki geradas ({linked_count} páginas com links semânticos)",
        "pages": [p.slug for p in created_pages if p],
    }
    if enrichment_job_id:
        result["enrichment_job_id"] = str(enrichment_job_id)
        result["detail"] += f". Expansao iniciada para {rule_page_count} regras."
    return result


@router.post("/{project_id}/wiki/relink")
async def relink_wiki_pages(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    PROMPT #274 - Re-apply semantic hypertext linking to all wiki pages.
    Useful after editing pages or adding new ones.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    linked_count = _apply_semantic_links_to_project(db, project_id)
    return {"detail": f"{linked_count} páginas atualizadas com links semânticos"}


@router.post("/{project_id}/wiki", response_model=WikiPageResponse, status_code=201)
async def create_wiki_page(
    project_id: UUID,
    data: WikiPageCreate,
    db: Session = Depends(get_db),
):
    """Create a new wiki page."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    slug = _ensure_unique_slug(db, project_id, _slugify(data.slug or data.title))

    page = WikiPage(
        project_id=project_id,
        slug=slug,
        title=data.title,
        content=data.content,
        parent_id=data.parent_id,
        order_index=data.order_index,
        source=data.source,
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    # PROMPT #274 - Re-apply semantic links (new page title may appear in other pages)
    _apply_semantic_links_to_project(db, project_id)

    logger.info(f"Wiki page created: {page.title} ({page.slug}) for project {project_id}")
    db.refresh(page)
    return page


@router.get("/{project_id}/wiki/{slug}", response_model=WikiPageResponse)
async def get_wiki_page(
    project_id: UUID,
    slug: str,
    db: Session = Depends(get_db),
):
    """Get a specific wiki page by slug."""
    page = (
        db.query(WikiPage)
        .filter(and_(WikiPage.project_id == project_id, WikiPage.slug == slug))
        .first()
    )
    if not page:
        raise HTTPException(status_code=404, detail="Página wiki não encontrada")
    return page


@router.put("/{project_id}/wiki/{slug}", response_model=WikiPageResponse)
async def update_wiki_page(
    project_id: UUID,
    slug: str,
    data: WikiPageUpdate,
    db: Session = Depends(get_db),
):
    """Update a wiki page."""
    page = (
        db.query(WikiPage)
        .filter(and_(WikiPage.project_id == project_id, WikiPage.slug == slug))
        .first()
    )
    if not page:
        raise HTTPException(status_code=404, detail="Página wiki não encontrada")

    if data.title is not None:
        page.title = data.title
    if data.content is not None:
        page.content = data.content
    if data.parent_id is not None:
        page.parent_id = data.parent_id
    if data.order_index is not None:
        page.order_index = data.order_index

    db.commit()

    # PROMPT #274 - Re-apply semantic links (edited content or title change)
    if data.content is not None or data.title is not None:
        _apply_semantic_links_to_project(db, project_id)

    db.refresh(page)

    logger.info(f"Wiki page updated: {page.title} ({page.slug})")
    return page


@router.delete("/{project_id}/wiki/{slug}")
async def delete_wiki_page(
    project_id: UUID,
    slug: str,
    db: Session = Depends(get_db),
):
    """Delete a wiki page."""
    page = (
        db.query(WikiPage)
        .filter(and_(WikiPage.project_id == project_id, WikiPage.slug == slug))
        .first()
    )
    if not page:
        raise HTTPException(status_code=404, detail="Página wiki não encontrada")

    db.delete(page)
    db.commit()

    # PROMPT #274 - Clean up orphan links pointing to deleted page
    _apply_semantic_links_to_project(db, project_id)

    logger.info(f"Wiki page deleted: {page.title} ({slug})")
    return {"detail": "Página wiki excluida", "slug": slug}


@router.post("/{project_id}/wiki/enrich-rules")
async def enrich_business_rule_pages(
    project_id: UUID,
    force: bool = False,
    db: Session = Depends(get_db),
):
    """
    PROMPT #270/#275 - Trigger AI enrichment of individual business rule wiki pages.
    Creates a background job that enriches each rule page with rich dissertative content.
    Returns job_id for polling progress.

    With force=True, re-enriches ALL rule pages including already-enriched ones.
    Without force, only enriches pages with source='ai_generated' (not yet enriched).
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    from sqlalchemy import text as sql_text

    if force:
        # PROMPT #275 - Count ALL rule pages (including already enriched)
        count_result = db.execute(sql_text("""
            SELECT COUNT(*) FROM wiki_pages
            WHERE project_id = :pid
            AND slug LIKE 'regra-%%'
        """), {"pid": str(project_id)})
    else:
        # Original: only count unenriched pages
        count_result = db.execute(sql_text("""
            SELECT COUNT(*) FROM wiki_pages
            WHERE project_id = :pid
            AND slug LIKE 'regra-%%'
            AND source = 'ai_generated'
        """), {"pid": str(project_id)})

    rule_count = count_result.scalar() or 0

    if rule_count == 0:
        detail = (
            "Todas as páginas de regras ja foram expandidas. Use force=true para re-expandir."
            if not force
            else "Nenhuma página de regra de negocio encontrada. Execute generate-from-context primeiro."
        )
        raise HTTPException(status_code=400, detail=detail)

    job_id = await _trigger_rule_enrichment_job(db, project_id, rule_count, force=force)

    return {
        "detail": f"Expansao iniciada para {rule_count} páginas de regras" + (" (re-expansao forcada)" if force else ""),
        "job_id": str(job_id),
        "rule_count": rule_count,
    }

