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


def _slugify(text: str) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower().strip()
    text = re.sub(r'[àáâãäå]', 'a', text)
    text = re.sub(r'[èéêë]', 'e', text)
    text = re.sub(r'[ìíîï]', 'i', text)
    text = re.sub(r'[òóôõö]', 'o', text)
    text = re.sub(r'[ùúûü]', 'u', text)
    text = re.sub(r'[ç]', 'c', text)
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-')


def _ensure_unique_slug(db: Session, project_id: UUID, slug: str, exclude_id: Optional[UUID] = None) -> str:
    """Ensure slug is unique within project, appending suffix if needed."""
    base_slug = slug
    counter = 1
    while True:
        query = db.query(WikiPage).filter(
            and_(WikiPage.project_id == project_id, WikiPage.slug == slug)
        )
        if exclude_id:
            query = query.filter(WikiPage.id != exclude_id)
        if not query.first():
            return slug
        slug = f"{base_slug}-{counter}"
        counter += 1


@router.get("/{project_id}/wiki", response_model=List[WikiPageResponse])
async def list_wiki_pages(
    project_id: UUID,
    parent_id: Optional[UUID] = Query(None, description="Filter by parent page"),
    db: Session = Depends(get_db),
):
    """List all wiki pages for a project, optionally filtered by parent."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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
        raise HTTPException(status_code=404, detail="Project not found")

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
        raise HTTPException(status_code=404, detail="Project not found")

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
            "## Reference Catalog - Raw Rules\n",
            f"Total rules extracted from codebase: **{len(all_rules)}**\n",
            "These are the raw rules automatically extracted from source code.",
            "The main Business Rules page contains the enriched and organized version.\n",
        ]
        for i, rule in enumerate(all_rules, 1):
            if isinstance(rule, dict):
                title = rule.get("title", rule.get("rule", f"Rule {i}"))
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
            db, project_id, "regras-catalogo-bruto",
            "Reference Catalog - Raw Rules",
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
    # 7. Padroes de Arquitetura - from RAG discovered patterns (architecture)
    arch_content = _build_architecture_patterns_page(db, project_id)
    if arch_content:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "padroes-arquitetura", "Padroes de Arquitetura",
            arch_content, 6, "ai_generated"
        ))

    # 8. Convencoes de Codigo - from RAG discovered patterns (naming/class/import)
    conv_content = _build_code_conventions_page(db, project_id)
    if conv_content:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "convencoes-codigo", "Convencoes de Codigo",
            conv_content, 7, "ai_generated"
        ))

    # 9. Componentes e Interface - from RAG discovered patterns (UI)
    ui_content = _build_ui_components_page(db, project_id)
    if ui_content:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "componentes-interface", "Componentes e Interface",
            ui_content, 8, "ai_generated"
        ))

    # 10. Estrutura de Codigo - aggregated from RAG code files
    struct_content = _build_code_structure_page(db, project_id)
    if struct_content:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "estrutura-codigo", "Estrutura de Codigo",
            struct_content, 9, "ai_generated"
        ))

    # 11. Historico de Desenvolvimento - from RAG git commits
    git_content = _build_git_history_page(db, project_id)
    if git_content:
        created_pages.append(_upsert_wiki_page(
            db, project_id, "historico-desenvolvimento", "Historico de Desenvolvimento",
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
        "detail": f"{total_pages} wiki pages generated ({linked_count} pages with semantic links)",
        "pages": [p.slug for p in created_pages if p],
    }
    if enrichment_job_id:
        result["enrichment_job_id"] = str(enrichment_job_id)
        result["detail"] += f". Enrichment started for {rule_page_count} rules."
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
        raise HTTPException(status_code=404, detail="Project not found")

    linked_count = _apply_semantic_links_to_project(db, project_id)
    return {"detail": f"{linked_count} pages updated with semantic links"}


@router.post("/{project_id}/wiki", response_model=WikiPageResponse, status_code=201)
async def create_wiki_page(
    project_id: UUID,
    data: WikiPageCreate,
    db: Session = Depends(get_db),
):
    """Create a new wiki page."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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
        raise HTTPException(status_code=404, detail="Wiki page not found")
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
        raise HTTPException(status_code=404, detail="Wiki page not found")

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
        raise HTTPException(status_code=404, detail="Wiki page not found")

    db.delete(page)
    db.commit()

    # PROMPT #274 - Clean up orphan links pointing to deleted page
    _apply_semantic_links_to_project(db, project_id)

    logger.info(f"Wiki page deleted: {page.title} ({slug})")
    return {"detail": "Wiki page deleted", "slug": slug}


def _upsert_wiki_page(
    db: Session,
    project_id: UUID,
    slug: str,
    title: str,
    content: str,
    order_index: int,
    source: str,
    parent_id: UUID = None,
) -> WikiPage:
    """Create or update a wiki page by slug.

    PROMPT #285 - Protected sources: pages that were manually edited or enriched
    are NEVER overwritten by automated re-scan. This prevents data loss when:
    - User manually edits a wiki page (source='manual')
    - AI enrichment has already generated rich content (source='enrichment')

    Only pages with source='ai_generated' are safe to overwrite.
    """
    existing = (
        db.query(WikiPage)
        .filter(and_(WikiPage.project_id == project_id, WikiPage.slug == slug))
        .first()
    )
    if existing:
        # PROMPT #285 - Protected sources: never overwrite user-edited or enriched pages
        protected_sources = {"manual", "enrichment"}
        if existing.source in protected_sources:
            logger.debug(
                f"Wiki page '{slug}' is protected (source={existing.source}), "
                f"skipping content overwrite"
            )
            # Still update parent_id to fix hierarchy
            if parent_id is not None:
                existing.parent_id = parent_id
            return existing

        existing.title = title
        existing.order_index = order_index
        existing.content = content
        # Always fix parent_id if provided (prevents orphan pages)
        if parent_id is not None:
            existing.parent_id = parent_id
        return existing

    page = WikiPage(
        project_id=project_id,
        slug=slug,
        title=title,
        content=content,
        order_index=order_index,
        source=source,
        parent_id=parent_id,
    )
    db.add(page)
    return page


def _build_stack_page(project, stack_info: dict, scan_summary: dict = None) -> str:
    """Build markdown content for stack page."""
    lines = ["## Stack Tecnologica\n"]

    # From project model fields
    if project.stack:
        stack = project.stack
        if stack.get("backend"):
            lines.append(f"- **Backend:** {stack['backend']}")
        if stack.get("database"):
            lines.append(f"- **Banco de Dados:** {stack['database']}")
        if stack.get("frontend"):
            lines.append(f"- **Frontend:** {stack['frontend']}")
        if stack.get("css"):
            lines.append(f"- **CSS:** {stack['css']}")
        if stack.get("mobile"):
            lines.append(f"- **Mobile:** {stack['mobile']}")
        lines.append("")

    # Detected stack from scan
    if stack_info:
        detected = stack_info.get("detected_stack", "")
        description = stack_info.get("description", "")
        confidence = stack_info.get("confidence", 0)
        if detected:
            lines.append(f"### Stack Detectada\n")
            lines.append(f"- **Framework Principal:** {description or detected}")
            if confidence:
                lines.append(f"- **Confianca:** {confidence}%")
            lines.append("")

        # Top scores from scan
        all_scores = stack_info.get("all_scores", {})
        if all_scores:
            top = sorted(all_scores.items(), key=lambda x: x[1], reverse=True)
            relevant = [(k, v) for k, v in top if v > 0]
            if relevant:
                lines.append("### Frameworks Avaliados\n")
                for name, score in relevant:
                    lines.append(f"- **{name}:** score {score}")
                lines.append("")

        indicators = stack_info.get("indicators_found", [])
        if indicators:
            lines.append("### Indicadores Encontrados\n")
            for ind in indicators:
                lines.append(f"- {ind}")
            lines.append("")

        languages = stack_info.get("languages", [])
        frameworks = stack_info.get("frameworks", [])
        databases = stack_info.get("databases", [])

        if languages:
            lines.append("### Linguagens Detectadas\n")
            for lang in languages:
                if isinstance(lang, dict):
                    lines.append(f"- {lang.get('name', lang)} ({lang.get('percentage', '?')}%)")
                else:
                    lines.append(f"- {lang}")
            lines.append("")

        if frameworks:
            lines.append("### Frameworks Detectados\n")
            for fw in frameworks:
                lines.append(f"- {fw}")
            lines.append("")

        if databases:
            lines.append("### Bancos de Dados\n")
            for db_name in databases:
                lines.append(f"- {db_name}")
            lines.append("")

    # Languages from scan summary
    scan_summary = scan_summary or {}
    scan_languages = scan_summary.get("languages", {})
    if scan_languages and isinstance(scan_languages, dict):
        lines.append("### Linguagens no Codebase\n")
        sorted_langs = sorted(scan_languages.items(), key=lambda x: x[1], reverse=True)
        for lang_name, count in sorted_langs:
            lines.append(f"- **{lang_name}:** {count} arquivos")
        lines.append("")

    return "\n".join(lines)


def _build_rules_page(business_rules: list) -> str:
    """Build markdown content for business rules page."""
    lines = ["## Regras de Negocio\n"]
    lines.append("Regras extraidas automaticamente do codebase e entrevistas.\n")

    for i, rule in enumerate(business_rules, 1):
        if isinstance(rule, dict):
            title = rule.get("title", rule.get("rule", f"Regra {i}"))
            desc = rule.get("description", rule.get("detail", ""))
            category = rule.get("category", "geral")
            lines.append(f"### {i}. {title}\n")
            if category:
                lines.append(f"**Categoria:** {category}\n")
            if desc:
                lines.append(f"{desc}\n")
        else:
            lines.append(f"### {i}. {rule}\n")

    return "\n".join(lines)


def _build_features_page(features: list) -> str:
    """Build markdown content for features page."""
    lines = ["## Features Principais\n"]
    lines.append("Funcionalidades identificadas no projeto.\n")

    for i, feature in enumerate(features, 1):
        if isinstance(feature, dict):
            name = feature.get("name", feature.get("feature", f"Feature {i}"))
            desc = feature.get("description", "")
            lines.append(f"### {i}. {name}\n")
            if desc:
                lines.append(f"{desc}\n")
        else:
            lines.append(f"- {feature}")

    return "\n".join(lines)


def _build_scan_page(scan_summary: dict) -> str:
    """Build markdown content for scan summary page."""
    lines = ["## Resumo do Codebase\n"]

    total_files = scan_summary.get("total_files", 0)
    code_files = scan_summary.get("code_files", 0)
    languages = scan_summary.get("languages", [])

    lines.append(f"- **Total de arquivos:** {total_files}")
    lines.append(f"- **Arquivos de codigo:** {code_files}")

    if languages:
        lines.append(f"- **Linguagens:** {', '.join(str(l) for l in languages)}")

    lines.append("")
    return "\n".join(lines)


def _translate_spec_type(spec_type: str) -> str:
    """Translate spec_type labels to Portuguese."""
    SPEC_PT = {
        "layered_architecture": "Arquitetura em Camadas",
        "graph_hub_spoke": "Grafo Hub-Spoke",
        "rest_api": "API REST",
        "graph_paired_imports": "Imports Pareados",
        "configuration_file": "Arquivo de Configuracao",
        "naming_convention": "Convencao de Nomenclatura",
        "class_hierarchy": "Hierarquia de Classes",
        "import_pattern": "Padrao de Imports",
        "function_signature": "Assinatura de Funcoes",
        "decorator_pattern": "Padrao de Decorators",
        "ui_component": "Componente de Interface",
        "ui_blueprint": "Blueprint de Interface",
        "ui_component_documentation": "Documentacao de Componente",
        "css_configuration": "Configuracao CSS",
        "css_template": "Template CSS",
        "stylesheet": "Folha de Estilo",
        "documentation_blueprint": "Blueprint de Documentacao",
        "markdown_documentation": "Documentacao Markdown",
    }
    return SPEC_PT.get(spec_type, spec_type.replace("_", " ").title())


def _translate_category(category: str) -> str:
    """Translate category labels to Portuguese."""
    CAT_PT = {
        "model": "Modelos",
        "controller": "Controladores",
        "test": "Testes",
        "service": "Servicos",
        "general": "Geral",
        "architecture": "Arquitetura",
        "component": "Componentes",
        "api": "APIs",
        "documentation": "Documentacao",
        "css": "Estilos CSS",
        "ui_component": "Componentes de Interface",
        "backup": "Backup",
        "hub_spoke": "Hub-Spoke",
        "paired_imports": "Imports Pareados",
    }
    return CAT_PT.get(category, category.title() if category else "Geral")


def _build_architecture_patterns_page(db, project_id: UUID) -> Optional[str]:
    """
    PROMPT #267/#268 - Build wiki page from RAG architecture patterns.
    Fetches layered_architecture, hub-spoke graphs, REST APIs, paired imports.
    """
    from sqlalchemy import text as sql_text
    result = db.execute(sql_text("""
        SELECT content, metadata FROM rag_documents
        WHERE project_id = :pid
        AND COALESCE(metadata->>'content_type', metadata->>'type') = 'discovered_pattern'
        AND metadata->>'spec_type' IN (
            'layered_architecture', 'graph_hub_spoke', 'rest_api',
            'graph_paired_imports', 'configuration_file'
        )
        ORDER BY metadata->>'spec_type', (metadata->>'occurrences')::int DESC NULLS LAST
        LIMIT 100
    """), {"pid": str(project_id)})
    rows = result.fetchall()
    if not rows:
        return None

    lines = [
        "## Padroes de Arquitetura\n",
        f"Total de padroes arquiteturais descobertos: **{len(rows)}**\n",
    ]
    current_spec = None
    for row in rows:
        content = row[0]
        meta = row[1] if row[1] else {}
        spec_type = meta.get("spec_type", "unknown")
        category = meta.get("category", "")

        if spec_type != current_spec:
            current_spec = spec_type
            lines.append(f"\n### {_translate_spec_type(spec_type)}\n")

        content_text = content[:600] if len(content) > 600 else content
        if category:
            lines.append(f"**{_translate_category(category)}:**")
        lines.append(f"{content_text}\n")

    return "\n".join(lines)


def _build_code_conventions_page(db, project_id: UUID) -> Optional[str]:
    """
    PROMPT #267 - Build wiki page from RAG code convention patterns.
    Fetches naming conventions, class hierarchies, import patterns, function signatures.
    """
    from sqlalchemy import text as sql_text
    result = db.execute(sql_text("""
        SELECT content, metadata FROM rag_documents
        WHERE project_id = :pid
        AND COALESCE(metadata->>'content_type', metadata->>'type') = 'discovered_pattern'
        AND metadata->>'spec_type' IN (
            'naming_convention', 'class_hierarchy', 'import_pattern',
            'function_signature', 'decorator_pattern'
        )
        ORDER BY metadata->>'category', metadata->>'spec_type',
                 (metadata->>'occurrences')::int DESC NULLS LAST
        LIMIT 200
    """), {"pid": str(project_id)})
    rows = result.fetchall()
    if not rows:
        return None

    lines = [
        "## Convencoes de Codigo\n",
        f"Total de convencoes descobertas: **{len(rows)}**\n",
    ]
    current_category = None
    for row in rows:
        content = row[0]
        meta = row[1] if row[1] else {}
        category = meta.get("category", "geral")
        spec_type = meta.get("spec_type", "")
        occurrences = meta.get("occurrences", "")

        if category != current_category:
            current_category = category
            lines.append(f"\n### {_translate_category(category)}\n")

        spec_label = _translate_spec_type(spec_type)
        occ_text = f" ({occurrences} ocorrencias)" if occurrences else ""
        lines.append(f"**{spec_label}{occ_text}:**")
        content_text = content[:500] if len(content) > 500 else content
        lines.append(f"{content_text}\n")

    return "\n".join(lines)


def _build_ui_components_page(db, project_id: UUID) -> Optional[str]:
    """
    PROMPT #267 - Build wiki page from RAG UI component/blueprint patterns.
    """
    from sqlalchemy import text as sql_text
    result = db.execute(sql_text("""
        SELECT content, metadata FROM rag_documents
        WHERE project_id = :pid
        AND COALESCE(metadata->>'content_type', metadata->>'type') = 'discovered_pattern'
        AND metadata->>'spec_type' IN (
            'ui_component', 'ui_blueprint', 'ui_component_documentation',
            'css_configuration', 'css_template', 'stylesheet',
            'documentation_blueprint', 'markdown_documentation'
        )
        ORDER BY metadata->>'spec_type', (metadata->>'occurrences')::int DESC NULLS LAST
        LIMIT 50
    """), {"pid": str(project_id)})
    rows = result.fetchall()
    if not rows:
        return None

    lines = [
        "## Componentes e Interface\n",
        f"Total de padroes de UI descobertos: **{len(rows)}**\n",
    ]
    for i, row in enumerate(rows, 1):
        content = row[0]
        meta = row[1] if row[1] else {}
        spec_type = meta.get("spec_type", "")
        name = meta.get("name", f"Componente {i}")

        spec_label = _translate_spec_type(spec_type)
        lines.append(f"### {i}. {name} ({spec_label})\n")
        content_text = content[:800] if len(content) > 800 else content
        lines.append(f"{content_text}\n")

    return "\n".join(lines)


def _build_code_structure_page(db, project_id: UUID) -> Optional[str]:
    """
    PROMPT #267 - Build wiki page aggregating code files by language and directory.
    """
    from sqlalchemy import text as sql_text
    result = db.execute(sql_text("""
        SELECT
            metadata->>'language' as lang,
            metadata->>'file_path' as fpath
        FROM rag_documents
        WHERE project_id = :pid
        AND COALESCE(metadata->>'content_type', metadata->>'type') = 'code_file'
        ORDER BY metadata->>'language', metadata->>'file_path'
    """), {"pid": str(project_id)})
    rows = result.fetchall()
    if not rows:
        return None

    # Group by language, then by directory
    from collections import defaultdict
    lang_dirs: dict = defaultdict(lambda: defaultdict(list))
    for row in rows:
        lang = row[0] or "unknown"
        fpath = row[1] or "unknown"
        # Extract directory from path
        parts = fpath.rsplit("/", 1)
        directory = parts[0] if len(parts) > 1 else "/"
        filename = parts[-1]
        lang_dirs[lang][directory].append(filename)

    total_files = len(rows)
    total_langs = len(lang_dirs)

    lines = [
        "## Estrutura de Codigo\n",
        f"Total de arquivos indexados: **{total_files}** em **{total_langs}** linguagens\n",
    ]

    for lang, dirs in sorted(lang_dirs.items(), key=lambda x: -sum(len(v) for v in x[1].values())):
        file_count = sum(len(v) for v in dirs.values())
        lines.append(f"\n### {lang.upper()} ({file_count} arquivos)\n")

        for directory, files in sorted(dirs.items()):
            # Show directory with file count
            dir_display = directory.split("/projects/")[-1] if "/projects/" in directory else directory
            lines.append(f"**{dir_display}/** ({len(files)} arquivos)")
            # List files (max 20 per directory to avoid huge pages)
            for f in sorted(files)[:20]:
                lines.append(f"- {f}")
            if len(files) > 20:
                lines.append(f"- ... e mais {len(files) - 20} arquivos")
            lines.append("")

    return "\n".join(lines)


def _build_git_history_page(db, project_id: UUID) -> Optional[str]:
    """
    PROMPT #267 - Build wiki page from RAG git commits.
    """
    from sqlalchemy import text as sql_text
    result = db.execute(sql_text("""
        SELECT content, metadata FROM rag_documents
        WHERE project_id = :pid
        AND COALESCE(metadata->>'content_type', metadata->>'type') = 'git_commit'
        ORDER BY metadata->>'synced_at' DESC
        LIMIT 50
    """), {"pid": str(project_id)})
    rows = result.fetchall()
    if not rows:
        return None

    lines = [
        "## Historico de Desenvolvimento\n",
        f"Total de commits analisados: **{len(rows)}**\n",
        "Historico dos commits mais recentes do repositorio.\n",
    ]
    for i, row in enumerate(rows, 1):
        content = row[0]
        meta = row[1] if row[1] else {}
        short_hash = meta.get("short_hash", "")

        first_line = content.split("\n")[0] if content else "Sem mensagem"
        hash_text = f" `{short_hash}`" if short_hash else ""
        lines.append(f"{i}.{hash_text} {first_line}")

    return "\n".join(lines)


# =============================================================================
# PROMPT #269 - Individual Business Rule Wiki Pages
# =============================================================================

# PROMPT #287 - Generic domain classification
# Directories to skip when extracting domain (framework/boilerplate dirs)
_SKIP_DIRS = {
    "app", "src", "lib", "backend", "frontend", "server", "client",
    "api", "core", "common", "utils", "helpers", "shared", "base",
    "internal", "pkg", "cmd", "main", "bin", "build", "dist",
    "public", "static", "assets", "vendor", "node_modules",
    "tests", "test", "spec", "__tests__", "__pycache__",
    "migrations", "alembic", "database", "db", "sql",
    "config", "configuration", "settings", "env",
    "docs", "documentation", "scripts", "tools",
    ".", "..", "",
}


def _classify_domain(source_file: str) -> Tuple[str, str]:
    """
    PROMPT #287 - Classify a source file into a business domain.
    Generic approach: extracts the most meaningful directory from the path.
    Works with any project structure, not just specific hardcoded paths.
    Returns (domain_name, domain_slug).
    """
    if not source_file:
        return ("General", "general")

    # Normalize: remove project root prefix if present
    path = source_file
    if "/projects/" in path:
        path = path.split("/projects/", 1)[-1]
        # Skip the project folder name itself
        parts = path.split("/")
        if len(parts) > 1:
            parts = parts[1:]  # skip project folder
        path = "/".join(parts)

    # Split into directory parts (exclude filename)
    parts = path.replace("\\", "/").split("/")
    if len(parts) > 1:
        parts = parts[:-1]  # remove filename
    else:
        # Single file with no directory → use filename without extension
        name = parts[0].rsplit(".", 1)[0] if "." in parts[0] else parts[0]
        if name:
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            return (name.replace("_", " ").replace("-", " ").title(), slug or "general")
        return ("General", "general")

    # Walk directory parts and find the first meaningful (non-boilerplate) dir
    for part in parts:
        clean = part.strip()
        if clean.lower() not in _SKIP_DIRS and len(clean) > 1:
            slug = re.sub(r"[^a-z0-9]+", "-", clean.lower()).strip("-")
            name = clean.replace("_", " ").replace("-", " ").title()
            return (name, slug or "general")

    # Fallback: use last directory part
    last = parts[-1].strip() if parts else ""
    if last and len(last) > 1:
        slug = re.sub(r"[^a-z0-9]+", "-", last.lower()).strip("-")
        name = last.replace("_", " ").replace("-", " ").title()
        return (name, slug or "general")

    return ("General", "general")


def _build_business_rules_wiki_pages(
    db: "Session", project_id: UUID
) -> List[WikiPage]:
    """
    PROMPT #269 - Build hierarchical wiki pages for business rules.

    Creates:
    1. Index page listing all domains with rule counts
    2. Per-domain page with bullet list of rules (linking to individual pages)
    3. Per-rule individual page with rich content

    Uses parent_id for hierarchy:
      regras-de-negocio (existing) -> domain pages -> individual rule pages
    """
    from sqlalchemy import text as sql_text
    from collections import defaultdict
    import hashlib

    result = db.execute(sql_text("""
        SELECT id, content, metadata->>'source_file' as source_file
        FROM rag_documents
        WHERE project_id = :pid
        AND (metadata->>'content_type' = 'business_rule'
             OR metadata->>'type' = 'business_rule')
        ORDER BY metadata->>'source_file', created_at
    """), {"pid": str(project_id)})
    rows = result.fetchall()
    if not rows:
        return []

    # Group rules by domain, deduplicating by content hash
    domains: Dict[str, list] = defaultdict(list)
    seen_hashes: set = set()
    for row in rows:
        doc_id = str(row[0])
        content = row[1] or ""
        source_file = row[2] or ""
        if not content.strip():
            continue
        # Generate short stable slug from content hash - skip duplicates
        rule_hash = hashlib.md5(content.encode()).hexdigest()[:8]
        if rule_hash in seen_hashes:
            continue
        seen_hashes.add(rule_hash)
        domain_name, domain_slug = _classify_domain(source_file)
        domains[domain_name].append({
            "id": doc_id,
            "content": content,
            "source_file": source_file,
            "domain_slug": domain_slug,
            "rule_hash": rule_hash,
        })

    created_pages: List[WikiPage] = []

    # PROMPT #277 - Find or CREATE parent page (regras-de-negocio)
    # If it doesn't exist, create a stub so all rule pages have a parent
    # and don't appear as root items in the sidebar
    parent_page = (
        db.query(WikiPage)
        .filter(
            WikiPage.project_id == project_id,
            WikiPage.slug == "regras-de-negocio",
        )
        .first()
    )
    if not parent_page:
        parent_page = _upsert_wiki_page(
            db, project_id, "regras-de-negocio",
            "Business Rules",
            "## Business Rules\n\nMain page for the project's business rules.\n",
            2, "ai_generated"
        )
        db.flush()
    parent_id = parent_page.id

    # --- Index page (PROMPT #287 - Enhanced) ---
    total_rules = sum(len(rules) for rules in domains.values())
    total_domains = len(domains)

    # Build source files set for stats
    all_source_files = set()
    for rules in domains.values():
        for rule in rules:
            if rule["source_file"]:
                all_source_files.add(rule["source_file"])

    index_lines = [
        "## Business Rules - Index by Domain\n",
        f"Total rules extracted: **{total_rules}** across **{total_domains}** domains "
        f"from **{len(all_source_files)}** source files.\n",
        "Click a domain to see all rules in that area.\n",
        "---\n",
        "### Summary\n",
        "| Domain | Rules | Source Files |",
        "|--------|-------|--------------|",
    ]
    for domain_name in sorted(domains.keys()):
        rules = domains[domain_name]
        domain_slug = rules[0]["domain_slug"]
        domain_files = set(r["source_file"] for r in rules if r["source_file"])
        index_lines.append(
            f"| [{domain_name}](wiki:regras-{domain_slug}) | {len(rules)} | {len(domain_files)} |"
        )
    index_lines.append("")
    index_lines.append("---\n")

    # Add domain list with brief description
    index_lines.append("### Domains\n")
    for domain_name in sorted(domains.keys()):
        rules = domains[domain_name]
        domain_slug = rules[0]["domain_slug"]
        # Show first 3 rule titles as preview
        previews = []
        for rule in rules[:3]:
            title = rule["content"].split(".")[0].strip()
            if len(title) > 80:
                title = title[:77] + "..."
            if title and len(title) >= 5:
                previews.append(title)
        preview_text = ""
        if previews:
            preview_text = " — " + "; ".join(previews)
            if len(rules) > 3:
                preview_text += f"; ... (+{len(rules) - 3} more)"
        index_lines.append(
            f"- **[{domain_name}](wiki:regras-{domain_slug})** ({len(rules)} rules){preview_text}"
        )

    index_page = _upsert_wiki_page(
        db, project_id, "regras-indice",
        "Business Rules - Index",
        "\n".join(index_lines),
        20, "ai_generated",
        parent_id=parent_id,
    )
    created_pages.append(index_page)

    # --- Per-domain pages + individual rule pages ---
    domain_order = 21
    for domain_name in sorted(domains.keys()):
        rules = domains[domain_name]
        domain_slug = rules[0]["domain_slug"]
        page_slug = f"regras-{domain_slug}"

        # Domain page with bullet list
        domain_lines = [
            f"## Business Rules - {domain_name}\n",
            f"Total rules in this domain: **{len(rules)}**\n",
        ]

        # Group by source file within domain
        by_file: Dict[str, list] = defaultdict(list)
        for rule in rules:
            by_file[rule["source_file"]].append(rule)

        for source_file in sorted(by_file.keys()):
            file_rules = by_file[source_file]
            file_display = source_file.split("/projects/")[-1] if "/projects/" in source_file else source_file
            domain_lines.append(f"\n### {file_display}\n")
            for rule in file_rules:
                # Title: first sentence, max 120 chars
                title = rule["content"].split(".")[0].strip()
                if len(title) > 120:
                    title = title[:117] + "..."
                if not title or len(title) < 5:
                    title = rule["content"][:120]
                rule_slug = f"regra-{rule['rule_hash']}"
                domain_lines.append(f"- [{title}](wiki:{rule_slug})")

        domain_page = _upsert_wiki_page(
            db, project_id, page_slug,
            f"Business Rules - {domain_name}",
            "\n".join(domain_lines),
            domain_order, "ai_generated",
            parent_id=index_page.id if index_page else None,
        )
        created_pages.append(domain_page)

        # Individual rule pages
        rule_order = domain_order * 100
        for rule in rules:
            rule_slug = f"regra-{rule['rule_hash']}"
            title = rule["content"].split(".")[0].strip()
            if len(title) > 120:
                title = title[:117] + "..."
            if not title or len(title) < 5:
                title = rule["content"][:120]

            source_display = rule["source_file"]
            if "/projects/" in source_display:
                source_display = source_display.split("/projects/")[-1]

            rule_content = (
                f"## {title}\n\n"
                f"**Domain:** {domain_name}  \n"
                f"**Source File:** `{source_display}`\n\n"
                f"---\n\n"
                f"### Description\n\n"
                f"{rule['content']}\n\n"
                f"---\n\n"
                f"### Context\n\n"
                f"Business rule automatically extracted from file "
                f"`{source_display}`, part of the **{domain_name}** module.\n\n"
                f"This rule was identified during source code analysis "
                f"and represents a behavior or constraint implemented in the system.\n"
            )

            rule_page = _upsert_wiki_page(
                db, project_id, rule_slug,
                title, rule_content,
                rule_order, "ai_generated",
                parent_id=domain_page.id if domain_page else None,
            )
            created_pages.append(rule_page)
            rule_order += 1

        domain_order += 1

    return created_pages


async def _trigger_rule_enrichment_job(
    db: Session, project_id: UUID, rule_count: int, force: bool = False
) -> Optional[UUID]:
    """
    PROMPT #270/#275 - Helper to create and submit a rule enrichment background job.
    Returns the job_id or None if failed.
    With force=True, re-enriches ALL rule pages including already-enriched ones.
    """
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
        notification_title=f"Enriching {rule_count} wiki rules",
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
        raise HTTPException(status_code=404, detail="Project not found")

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
            "All rule pages already enriched. Use force=true to re-enrich."
            if not force
            else "No business rule pages found. Run generate-from-context first."
        )
        raise HTTPException(status_code=400, detail=detail)

    job_id = await _trigger_rule_enrichment_job(db, project_id, rule_count, force=force)

    return {
        "detail": f"Enrichment started for {rule_count} rule pages" + (" (force re-enrich)" if force else ""),
        "job_id": str(job_id),
        "rule_count": rule_count,
    }


async def _enrich_rules_background(
    job_id: UUID,
    project_id: UUID,
    force: bool = False,
):
    """
    PROMPT #270/#275 - Background task to enrich individual business rule wiki pages.
    Makes one AI call per rule page with rich prompt context.
    With force=True, re-enriches ALL rule pages including already-enriched ones.
    """
    import asyncio
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.services.ai_orchestrator import AIOrchestrator
    from app.prompts.loader import PromptLoader
    from sqlalchemy import text as sql_text

    db = SessionLocal()
    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)

        # Get project info
        project = db.query(Project).filter(Project.id == project_id).first()
        project_name = project.name if project else ""
        project_context = (project.context_human or "")[:1000] if project else ""

        # PROMPT #275 - Get rule pages: all if force, only unenriched otherwise
        query = db.query(WikiPage).filter(
            WikiPage.project_id == project_id,
            WikiPage.slug.like("regra-%"),
        )
        if not force:
            query = query.filter(WikiPage.source == "ai_generated")
        rule_pages = query.all()

        total = len(rule_pages)
        if total == 0:
            job_manager.complete_job(job_id, {"enriched": 0, "total": 0})
            return

        job_manager.update_progress(job_id, 5.0, f"Preparing {total} rules for enrichment...")

        # PROMPT #288 - Batch-load all parent pages in ONE query (fixes N+1)
        parent_ids = set(p.parent_id for p in rule_pages if p.parent_id)
        parent_map: dict = {}  # id -> (slug, title)
        if parent_ids:
            parent_rows = (
                db.query(WikiPage.id, WikiPage.slug, WikiPage.title)
                .filter(WikiPage.id.in_(parent_ids))
                .all()
            )
            parent_map = {row[0]: (row[1], row[2]) for row in parent_rows}

        # Build domain_rules_map from parent info (batch siblings per parent)
        domain_rules_map: dict = {}
        for parent_id, (parent_slug, parent_title) in parent_map.items():
            if parent_slug not in domain_rules_map:
                siblings = (
                    db.query(WikiPage.title)
                    .filter(
                        WikiPage.parent_id == parent_id,
                        WikiPage.slug.like("regra-%"),
                    )
                    .limit(10)
                    .all()
                )
                domain_rules_map[parent_slug] = [s[0] for s in siblings]

        loader = PromptLoader()
        orchestrator = AIOrchestrator(db)
        enriched_count = 0
        failed_count = 0

        for i, page in enumerate(rule_pages):
            # Check cancellation
            if job_manager.is_cancelled(job_id):
                job_manager.update_progress(
                    job_id, (i / total) * 100,
                    f"Cancelled. {enriched_count} rules enriched out of {i}."
                )
                break

            progress = 5.0 + (i / total) * 90.0
            job_manager.update_progress(
                job_id, progress,
                f"Enriching rule {i + 1}/{total}: {page.title[:60]}..."
            )

            try:
                # PROMPT #275 - Extract domain, source, and rule content
                # For unenriched pages: parse from template markers
                # For already-enriched pages: look up original from RAG or use parent domain
                domain_name = "Geral"
                source_file = ""
                rule_content = page.title

                if page.source == "ai_generated":
                    # Original template format - parse markers
                    for line in page.content.split("\n"):
                        if line.startswith("**Dominio:**") or line.startswith("**Domain:**"):
                            domain_name = line.replace("**Dominio:**", "").replace("**Domain:**", "").strip()
                        elif line.startswith("**Arquivo Fonte:**") or line.startswith("**Source File:**"):
                            source_file = line.replace("**Arquivo Fonte:**", "").replace("**Source File:**", "").strip().strip("`")
                    for desc_marker in ("### Description", "### Descricao"):
                        if desc_marker in page.content:
                            parts = page.content.split(desc_marker, 1)
                            if len(parts) > 1:
                                desc_text = parts[1].split("---")[0].strip()
                                if desc_text:
                                    rule_content = desc_text
                            break
                else:
                    # Already enriched - try to get original from RAG using slug hash
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
                        # Fallback: use existing enriched content as context
                        rule_content = page.content

                    # PROMPT #288 - Use pre-loaded parent_map instead of per-rule query
                    if page.parent_id and page.parent_id in parent_map:
                        _, parent_title = parent_map[page.parent_id]
                        if parent_title:
                            domain_name = (parent_title
                                .replace("Business Rules - ", "")
                                .replace("Regras de Negocio - ", ""))

                # PROMPT #288 - Use pre-loaded parent_map for related rules lookup
                parent_slug = ""
                if page.parent_id and page.parent_id in parent_map:
                    parent_slug = parent_map[page.parent_id][0]
                related = domain_rules_map.get(parent_slug, [])
                related_text = "\n".join(f"- {r}" for r in related[:8]) if related else ""

                # Render prompt
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

                # Call AI - PROMPT #288: reduced from 2000 to 1000 tokens
                response = await orchestrator.execute(
                    usage_type="memory",
                    messages=[{"role": "user", "content": usr_prompt}],
                    system_prompt=sys_prompt,
                    max_tokens=1000,  # PROMPT #288 - Reduced for performance
                    project_id=str(project_id),
                    metadata={"type": "wiki_rule_enrichment", "rule_slug": page.slug,
                              "skip_context_build": True},
                )

                enriched_content = response.get("content", "")
                if enriched_content and len(enriched_content) > 100:
                    page.content = enriched_content
                    page.source = "enrichment"
                    db.commit()
                    enriched_count += 1
                else:
                    failed_count += 1
                    logger.warning(f"Rule enrichment too short for {page.slug}")

            except Exception as e:
                failed_count += 1
                logger.error(f"Failed to enrich rule {page.slug}: {e}")

            # PROMPT #288 - Reduced from 0.5s to 0.1s (rate limiter handles throttling)
            await asyncio.sleep(0.1)

        # PROMPT #274 - Re-apply semantic links after enrichment
        linked_count = _apply_semantic_links_to_project(db, project_id)

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
            JobManager(db).fail_job(job_id, str(e))
        except Exception:
            pass
    finally:
        db.close()


# ---------------------------------------------------------------------------
# PROMPT #274 - Hypertext Linking Semantico (estilo Wikipedia)
# ---------------------------------------------------------------------------

def _add_semantic_links_to_content(
    content: str,
    terms_map: Dict[str, str],
    exclude_slug: str,
    max_links: int = 10,
    valid_slugs: Optional[set] = None,
) -> str:
    """
    Scan markdown content and add wiki:slug links for mentions of other page titles.
    Like Wikipedia: first occurrence of each term becomes a link, rest stay as plain text.

    Idempotent: detects existing wiki links and skips terms already linked.
    Cleans up orphan links whose target page no longer exists.

    Args:
        content: Markdown content to process
        terms_map: {title_lower: slug} mapping of all wiki pages
        exclude_slug: Slug of current page (avoid self-links)
        max_links: Maximum number of links to add per page
        valid_slugs: Set of all valid slugs (for orphan link cleanup)
    """
    if not content or not terms_map:
        return content

    # Step 1: Remove orphan wiki links (target page deleted or renamed)
    if valid_slugs is not None:
        def _clean_orphan(m: re.Match) -> str:
            slug = m.group(2)
            if slug in valid_slugs:
                return m.group(0)  # keep valid link
            return m.group(1)  # revert to plain text

        content = re.sub(
            r'\[([^\]]+)\]\(wiki:([a-z0-9_-]+)\)',
            _clean_orphan,
            content,
        )

    # Step 2: Collect slugs already linked in the content (avoid duplicates)
    existing_link_slugs: set = set()
    for m in re.finditer(r'\]\(wiki:([a-z0-9_-]+)\)', content):
        existing_link_slugs.add(m.group(1))

    # Sort terms by length (longest first) to avoid partial matches
    sorted_terms = sorted(terms_map.keys(), key=len, reverse=True)

    lines = content.split("\n")
    result_lines = []
    links_added = 0
    linked_slugs: set = set(existing_link_slugs)  # start with already-linked
    in_code_block = False

    for line in lines:
        # Toggle code block state
        if line.strip().startswith("```"):
            in_code_block = not in_code_block
            result_lines.append(line)
            continue

        # Skip code blocks and headings
        if in_code_block or line.strip().startswith("#"):
            result_lines.append(line)
            continue

        if links_added >= max_links:
            result_lines.append(line)
            continue

        for term in sorted_terms:
            if links_added >= max_links:
                break

            slug = terms_map[term]

            # Skip self-links and terms whose slug is already linked
            if slug == exclude_slug or slug in linked_slugs:
                continue

            # Match term NOT inside existing markdown links or inline code.
            # Use a two-step approach: first strip existing link spans,
            # then search for the term in the remaining text.
            # Simple approach: search and verify match is not inside [...](...) span
            pattern = re.compile(
                r'\b(' + re.escape(term) + r')\b',
                re.IGNORECASE,
            )

            # Find all matches and check each is not inside an existing link
            for match in pattern.finditer(line):
                start, end = match.start(), match.end()
                # Check if this match falls inside a markdown link [text](url)
                # by looking for enclosing [ before and ]( after
                before = line[:start]
                after = line[end:]

                # Inside link text: [...HERE...](...) - preceded by [ with no ] between
                in_link_text = (
                    '[' in before
                    and '](' not in before[before.rfind('['):]
                )
                # Inside link url: [...](...HERE...)
                in_link_url = (
                    '](' in before
                    and ')' not in before[before.rfind('](') + 2:]
                )
                # Inside inline code: `HERE`
                backtick_count = before.count('`')
                in_inline_code = backtick_count % 2 == 1

                if in_link_text or in_link_url or in_inline_code:
                    continue  # skip this match, try next

                # Valid match found - replace it
                matched_text = match.group(1)
                replacement = f"[{matched_text}](wiki:{slug})"
                line = line[:start] + replacement + line[end:]
                links_added += 1
                linked_slugs.add(slug)
                break  # only first valid occurrence per term

        result_lines.append(line)

    return "\n".join(result_lines)


def _apply_semantic_links_to_project(db: Session, project_id: UUID) -> int:
    """
    Apply semantic hypertext linking to all wiki pages of a project.
    Scans each page's content for mentions of other page titles and adds wiki links.

    Returns number of pages modified.
    """
    pages = (
        db.query(WikiPage)
        .filter(WikiPage.project_id == project_id)
        .all()
    )

    if not pages:
        return 0

    # Build terms map from page titles (skip very short titles)
    terms_map: Dict[str, str] = {}
    valid_slugs: set = set()
    for page in pages:
        valid_slugs.add(page.slug)
        title = page.title.strip()
        if len(title) >= 4:
            terms_map[title.lower()] = page.slug

    if not terms_map:
        return 0

    modified_count = 0
    for page in pages:
        new_content = _add_semantic_links_to_content(
            page.content,
            terms_map,
            exclude_slug=page.slug,
            max_links=10,
            valid_slugs=valid_slugs,
        )
        if new_content != page.content:
            page.content = new_content
            modified_count += 1

    if modified_count > 0:
        db.commit()
        logger.info(
            f"Semantic linking: {modified_count}/{len(pages)} pages "
            f"updated for project {project_id}"
        )

    return modified_count


def _parse_wiki_sections(markdown: str) -> Dict[str, Tuple[str, str]]:
    """
    PROMPT #265 - Parse AI-generated markdown into wiki page sections.

    Splits a markdown document by ## headers and maps each section to a wiki page slug.
    Returns ordered dict of {slug: (title, content)}.
    """
    SECTION_MAP = {
        "visao geral": ("visao-geral", "Visao Geral"),
        "stack tecnologica": ("stack-tecnologica", "Stack Tecnologica"),
        "arquitetura": ("arquitetura", "Arquitetura"),
        "regras de negocio": ("regras-de-negocio", "Regras de Negocio"),
        "features principais": ("features-principais", "Features Principais"),
        "features": ("features-principais", "Features Principais"),
        "integracoes": ("integracoes", "Integracoes"),
        "resumo do codebase": ("resumo-codebase", "Resumo do Codebase"),
    }

    def _normalize(text: str) -> str:
        """Remove accents and special chars for matching."""
        replacements = {
            'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
            'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
            'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
            'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
            'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
            'ç': 'c', 'ñ': 'n',
        }
        result = text.lower().strip().rstrip(':')
        for char, replacement in replacements.items():
            result = result.replace(char, replacement)
        return result

    sections: Dict[str, Tuple[str, str]] = {}

    # Split by ## headers, keeping the header text
    parts = re.split(r'^## (.+)$', markdown, flags=re.MULTILINE)

    # parts[0] = content before first ##
    # parts[1] = first header, parts[2] = first content, etc.

    for i in range(1, len(parts), 2):
        header = parts[i].strip()
        content = parts[i + 1].strip() if i + 1 < len(parts) else ""
        header_normalized = _normalize(header)

        # Try to match against known sections
        matched = False
        for key, (slug, title) in SECTION_MAP.items():
            if key in header_normalized:
                full_content = f"## {header}\n\n{content}"
                sections[slug] = (title, full_content)
                matched = True
                break

        if not matched:
            # Unknown section - create page with slugified header
            slug = _slugify(header)
            if slug:
                sections[slug] = (header, f"## {header}\n\n{content}")

    return sections


def _parse_wiki_subsections(markdown: str) -> Dict[str, Tuple[str, str]]:
    """
    PROMPT #268 - Parse ### headers into wiki pages when ## parsing yields few results.
    Some AI models generate with ### instead of ## for subsections.
    """
    SECTION_MAP = {
        "visao geral": ("visao-geral", "Visao Geral"),
        "stack tecnologica": ("stack-tecnologica", "Stack Tecnologica"),
        "arquitetura": ("arquitetura", "Arquitetura"),
        "regras de negocio": ("regras-de-negocio", "Regras de Negocio"),
        "features principais": ("features-principais", "Features Principais"),
        "features": ("features-principais", "Features Principais"),
        "integracoes": ("integracoes", "Integracoes"),
    }

    def _normalize(text: str) -> str:
        replacements = {
            'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a',
            'é': 'e', 'è': 'e', 'ê': 'e',
            'í': 'i', 'ì': 'i', 'î': 'i',
            'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o',
            'ú': 'u', 'ù': 'u', 'û': 'u',
            'ç': 'c', 'ñ': 'n',
        }
        result = text.lower().strip().rstrip(':')
        for char, replacement in replacements.items():
            result = result.replace(char, replacement)
        return result

    sections: Dict[str, Tuple[str, str]] = {}
    parts = re.split(r'^### (.+)$', markdown, flags=re.MULTILINE)

    for i in range(1, len(parts), 2):
        header = parts[i].strip()
        content = parts[i + 1].strip() if i + 1 < len(parts) else ""
        header_normalized = _normalize(header)

        for key, (slug, title) in SECTION_MAP.items():
            if key in header_normalized:
                full_content = f"## {header}\n\n{content}"
                sections[slug] = (title, full_content)
                break

    return sections
