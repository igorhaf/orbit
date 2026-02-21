"""
Wiki API Routes
PROMPT #261 - Multi-page Wiki System
PROMPT #237 - Refactored to use filesystem storage (satellite/wiki/)

CRUD endpoints for wiki pages within projects.
All pages stored as .md files with YAML front matter on disk.
"""

import logging
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from app.database import get_db
from app.models.project import Project
from app.schemas.wiki import (
    WikiPageCreate,
    WikiPageUpdate,
    WikiPageResponse,
    WikiPageTreeItem,
)
from app.services import wiki_fs
from app.services.wiki_service import (
    _slugify,
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
    _apply_semantic_links_to_project_fs,
    _parse_wiki_sections,
    _parse_wiki_subsections,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_project_or_404(db: Session, project_id: UUID) -> Project:
    """Fetch project and validate it exists with a code_path."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    if not project.code_path:
        raise HTTPException(status_code=400, detail="Projeto sem code_path definido")
    return project


@router.get("/{project_id}/wiki", response_model=List[WikiPageResponse])
async def list_wiki_pages(
    project_id: UUID,
    parent_id: Optional[UUID] = Query(None, description="Filter by parent page"),
    db: Session = Depends(get_db),
):
    """List all wiki pages for a project, optionally filtered by parent."""
    project = _get_project_or_404(db, project_id)
    pages = wiki_fs.list_pages(project.code_path)

    result = []
    for page in pages:
        resp = wiki_fs.page_to_response(project.code_path, project_id, page)
        # Filter by parent_id if requested
        if parent_id is not None:
            if resp["parent_id"] != str(parent_id):
                continue
        result.append(resp)

    # Sort by order_index, then title
    result.sort(key=lambda p: (p["order_index"], p["title"]))
    return result


@router.get("/{project_id}/wiki/tree", response_model=List[WikiPageTreeItem])
async def get_wiki_tree(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """Get the full wiki page tree for a project."""
    project = _get_project_or_404(db, project_id)
    tree = wiki_fs.build_tree(project.code_path, project_id)

    # PROMPT #275 - Auto-trigger enrichment for unenriched rule pages
    all_pages = wiki_fs.list_pages(project.code_path)
    unenriched_rules = [
        p for p in all_pages
        if p.slug.startswith("regra-") and p.source == "ai_generated"
    ]
    if unenriched_rules:
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

    return tree


@router.post("/{project_id}/wiki/generate-from-context")
async def generate_wiki_from_context(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """Generate wiki pages from project context data."""
    project = _get_project_or_404(db, project_id)
    code_path = project.code_path

    created_slugs = []

    # 1. Visao Geral - from project description
    if project.description:
        _upsert_wiki_page(
            code_path, project_id, "visao-geral", "Visao Geral",
            project.description, 0, "enrichment"
        )
        created_slugs.append("visao-geral")

    # 2. Stack Tecnologica
    imc = project.initial_memory_context or {}
    stack_info = imc.get("stack_info", {})
    scan_summary = imc.get("scan_summary", {})
    if stack_info or project.stack:
        stack_content = _build_stack_page(project, stack_info, scan_summary)
        _upsert_wiki_page(
            code_path, project_id, "stack-tecnologica", "Stack Tecnologica",
            stack_content, 1, "ai_generated"
        )
        created_slugs.append("stack-tecnologica")

    # 3. Regras de Negocio from RAG
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
        _upsert_wiki_page(
            code_path, project_id, "regras-catálogo-bruto",
            "Catálogo de Referência - Regras Brutas",
            rules_content, 12, "ai_generated",
            parent_slug="regras-de-negocio",
        )
        created_slugs.append("regras-catálogo-bruto")

    # 4. Features Principais
    features = imc.get("key_features", [])
    if features:
        features_content = _build_features_page(features)
        _upsert_wiki_page(
            code_path, project_id, "features-principais", "Features Principais",
            features_content, 3, "ai_generated"
        )
        created_slugs.append("features-principais")

    # 5. Contexto do Projeto
    if project.context_human:
        _upsert_wiki_page(
            code_path, project_id, "contexto-projeto", "Contexto do Projeto",
            project.context_human, 4, "enrichment"
        )
        created_slugs.append("contexto-projeto")

    # 6. Scan Summary
    scan_summary = imc.get("scan_summary", {})
    if not scan_summary:
        total_files = imc.get("total_files", 0)
        if total_files:
            scan_summary = {
                "total_files": total_files,
                "code_files": imc.get("code_files", 0),
                "languages": imc.get("languages", []),
            }
    if scan_summary:
        scan_content = _build_scan_page(scan_summary)
        _upsert_wiki_page(
            code_path, project_id, "resumo-codebase", "Resumo do Codebase",
            scan_content, 5, "ai_generated"
        )
        created_slugs.append("resumo-codebase")

    # 7-11. RAG-powered pages
    rag_builders = [
        ("padrões-arquitetura", "Padrões de Arquitetura", _build_architecture_patterns_page, 6),
        ("convencoes-código", "Convencoes de Código", _build_code_conventions_page, 7),
        ("componentes-interface", "Componentes e Interface", _build_ui_components_page, 8),
        ("estrutura-código", "Estrutura de Código", _build_code_structure_page, 9),
        ("histórico-desenvolvimento", "Histórico de Desenvolvimento", _build_git_history_page, 10),
    ]
    for slug, title, builder, order in rag_builders:
        content = builder(db, project_id)
        if content:
            _upsert_wiki_page(code_path, project_id, slug, title, content, order, "ai_generated")
            created_slugs.append(slug)

    # Parse enriched description into separate wiki pages
    if project.description and ('## ' in project.description or '### ' in project.description):
        sections = _parse_wiki_sections(project.description)
        if len(sections) <= 1:
            sections.update(_parse_wiki_subsections(project.description))
        for slug, (title, content) in sections.items():
            if slug not in created_slugs:
                _upsert_wiki_page(
                    code_path, project_id, slug, title, content,
                    len(created_slugs), "enrichment"
                )
                created_slugs.append(slug)

    # Business rule wiki pages (hierarchical)
    rule_pages = _build_business_rules_wiki_pages(db, code_path, project_id)

    # Apply semantic hypertext linking
    linked_count = _apply_semantic_links_to_project_fs(code_path, project_id)

    # Auto-trigger AI enrichment for individual rule pages
    rule_page_count = len([p for p in rule_pages if p and p.get("slug", "").startswith("regra-")])
    enrichment_job_id = None
    if rule_page_count > 0:
        try:
            enrichment_job_id = await _trigger_rule_enrichment_job(db, project_id, rule_page_count)
        except Exception as e:
            logger.warning(f"Failed to trigger rule enrichment: {e}")

    total_pages = len(created_slugs) + len(rule_pages)
    result = {
        "detail": f"{total_pages} páginas wiki geradas ({linked_count} páginas com links semânticos)",
        "pages": created_slugs + [p.get("slug", "") for p in rule_pages if p],
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
    """Re-apply semantic hypertext linking to all wiki pages."""
    project = _get_project_or_404(db, project_id)
    linked_count = _apply_semantic_links_to_project_fs(project.code_path, project_id)
    return {"detail": f"{linked_count} páginas atualizadas com links semânticos"}


@router.post("/{project_id}/wiki", response_model=WikiPageResponse, status_code=201)
async def create_wiki_page(
    project_id: UUID,
    data: WikiPageCreate,
    db: Session = Depends(get_db),
):
    """Create a new wiki page."""
    project = _get_project_or_404(db, project_id)
    code_path = project.code_path

    slug = wiki_fs.ensure_unique_slug(code_path, _slugify(data.slug or data.title))

    # Resolve parent_slug from parent_id if provided
    parent_slug = None
    if data.parent_id:
        all_pages = wiki_fs.list_pages(code_path)
        for page in all_pages:
            page_id = wiki_fs._deterministic_id(project_id, page.slug)
            if page_id == str(data.parent_id):
                parent_slug = page.slug
                break

    result = wiki_fs.write_page(
        code_path=code_path,
        project_id=project_id,
        slug=slug,
        title=data.title,
        content=data.content,
        source=data.source,
        order_index=data.order_index,
        parent_slug=parent_slug,
    )

    # Re-apply semantic links
    _apply_semantic_links_to_project_fs(code_path, project_id)

    logger.info(f"Wiki page created: {data.title} ({slug}) for project {project_id}")
    return result


@router.get("/{project_id}/wiki/{slug}", response_model=WikiPageResponse)
async def get_wiki_page(
    project_id: UUID,
    slug: str,
    db: Session = Depends(get_db),
):
    """Get a specific wiki page by slug."""
    project = _get_project_or_404(db, project_id)
    page = wiki_fs.read_page(project.code_path, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Página wiki não encontrada")
    return wiki_fs.page_to_response(project.code_path, project_id, page)


@router.put("/{project_id}/wiki/{slug}", response_model=WikiPageResponse)
async def update_wiki_page(
    project_id: UUID,
    slug: str,
    data: WikiPageUpdate,
    db: Session = Depends(get_db),
):
    """Update a wiki page."""
    project = _get_project_or_404(db, project_id)
    code_path = project.code_path

    existing = wiki_fs.read_page(code_path, slug)
    if not existing:
        raise HTTPException(status_code=404, detail="Página wiki não encontrada")

    # Merge updates with existing data
    title = data.title if data.title is not None else existing.title
    content = data.content if data.content is not None else existing.content
    order_index = data.order_index if data.order_index is not None else existing.order_index

    # When user edits content, mark as manual
    source = existing.source
    if data.content is not None:
        source = "manual"

    # Resolve parent_slug change if parent_id provided
    parent_slug = existing.parent_slug
    if data.parent_id is not None:
        all_pages = wiki_fs.list_pages(code_path)
        parent_slug = None
        for page in all_pages:
            page_id = wiki_fs._deterministic_id(project_id, page.slug)
            if page_id == str(data.parent_id):
                parent_slug = page.slug
                break

    result = wiki_fs.write_page(
        code_path=code_path,
        project_id=project_id,
        slug=slug,
        title=title,
        content=content,
        source=source,
        order_index=order_index,
        parent_slug=parent_slug,
        respect_protected=False,  # User is explicitly editing
    )

    # Re-apply semantic links on content/title change
    if data.content is not None or data.title is not None:
        _apply_semantic_links_to_project_fs(code_path, project_id)

    logger.info(f"Wiki page updated: {title} ({slug})")
    return result


@router.delete("/{project_id}/wiki/{slug}")
async def delete_wiki_page(
    project_id: UUID,
    slug: str,
    db: Session = Depends(get_db),
):
    """Delete a wiki page."""
    project = _get_project_or_404(db, project_id)

    if not wiki_fs.delete_page(project.code_path, slug):
        raise HTTPException(status_code=404, detail="Página wiki não encontrada")

    # Clean up orphan links
    _apply_semantic_links_to_project_fs(project.code_path, project_id)

    logger.info(f"Wiki page deleted: {slug}")
    return {"detail": "Página wiki excluida", "slug": slug}


@router.post("/{project_id}/wiki/enrich-rules")
async def enrich_business_rule_pages(
    project_id: UUID,
    force: bool = False,
    db: Session = Depends(get_db),
):
    """Trigger AI enrichment of individual business rule wiki pages."""
    project = _get_project_or_404(db, project_id)

    # Count rule pages from filesystem
    all_pages = wiki_fs.list_pages(project.code_path)
    if force:
        rule_pages = [p for p in all_pages if p.slug.startswith("regra-")]
    else:
        rule_pages = [
            p for p in all_pages
            if p.slug.startswith("regra-") and p.source == "ai_generated"
        ]

    rule_count = len(rule_pages)

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
