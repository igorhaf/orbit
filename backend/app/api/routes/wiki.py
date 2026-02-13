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

    # 3. Regras de Negocio - from RAG (complete) + initial_memory_context (fallback)
    # PROMPT #266 - Fetch ALL rules from RAG for a comprehensive wiki page
    from sqlalchemy import text as sql_text
    rag_result = db.execute(sql_text("""
        SELECT content FROM rag_documents
        WHERE project_id = :pid
        AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
        ORDER BY created_at DESC
        LIMIT 500
    """), {"pid": str(project_id)})
    rag_rules = [row[0] for row in rag_result.fetchall()]

    # Combine RAG rules + initial_memory_context rules (deduplicated)
    business_rules = imc.get("business_rules", [])
    all_rules = rag_rules if rag_rules else business_rules
    if not all_rules and business_rules:
        all_rules = business_rules

    if all_rules:
        rules_parts = [
            "## Regras de Negocio - Catalogo Completo\n",
            f"Total de regras extraidas do codebase: **{len(all_rules)}**\n",
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
        created_pages.append(_upsert_wiki_page(
            db, project_id, "regras-de-negocio", "Regras de Negocio",
            rules_content, 2, "ai_generated"
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

    # PROMPT #265 - Parse enriched project.description into separate wiki pages
    # If the description contains ## sections (from AI enrichment), each section
    # becomes its own wiki page (Arquitetura, Integracoes, etc.)
    if project.description and '## ' in project.description:
        sections = _parse_wiki_sections(project.description)
        for slug, (title, content) in sections.items():
            # Only add sections not already created above
            existing_slugs = [p.slug for p in created_pages if p]
            if slug not in existing_slugs:
                page = _upsert_wiki_page(
                    db, project_id, slug, title, content,
                    len(created_pages), "enrichment"
                )
                created_pages.append(page)

    db.commit()

    return {
        "detail": f"{len(created_pages)} wiki pages generated",
        "pages": [p.slug for p in created_pages if p],
    }


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

    logger.info(f"Wiki page created: {page.title} ({page.slug}) for project {project_id}")
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
) -> WikiPage:
    """Create or update a wiki page by slug."""
    existing = (
        db.query(WikiPage)
        .filter(and_(WikiPage.project_id == project_id, WikiPage.slug == slug))
        .first()
    )
    if existing:
        existing.title = title
        existing.content = content
        existing.order_index = order_index
        return existing

    page = WikiPage(
        project_id=project_id,
        slug=slug,
        title=title,
        content=content,
        order_index=order_index,
        source=source,
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


def _build_architecture_patterns_page(db, project_id: UUID) -> Optional[str]:
    """
    PROMPT #267 - Build wiki page from RAG architecture patterns.
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
            spec_label = spec_type.replace("_", " ").title()
            lines.append(f"\n### {spec_label}\n")

        # Extract meaningful content (first 600 chars)
        content_text = content[:600] if len(content) > 600 else content
        if category:
            lines.append(f"**{category}:**")
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
            lines.append(f"\n### {category.title()}\n")

        spec_label = spec_type.replace("_", " ").title()
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

        spec_label = spec_type.replace("_", " ").title()
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
    ]
    for i, row in enumerate(rows, 1):
        content = row[0]
        meta = row[1] if row[1] else {}
        short_hash = meta.get("short_hash", "")

        # First line of content is the commit message
        first_line = content.split("\n")[0] if content else "Sem mensagem"
        hash_text = f" `{short_hash}`" if short_hash else ""
        lines.append(f"{i}.{hash_text} {first_line}")

    return "\n".join(lines)


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
