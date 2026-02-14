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
            "## Catalogo de Referencia - Regras Brutas\n",
            f"Total de regras extraidas do codebase: **{len(all_rules)}**\n",
            "Estas sao as regras brutas extraidas automaticamente do codigo-fonte.",
            "A pagina principal de Regras de Negocio contem a versao enriquecida e organizada.\n",
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
            db, project_id, "regras-catalogo-bruto",
            "Catalogo de Referencia - Regras Brutas",
            rules_content, 12, "ai_generated"
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
        "detail": f"{total_pages} wiki pages generated",
        "pages": [p.slug for p in created_pages if p],
    }
    if enrichment_job_id:
        result["enrichment_job_id"] = str(enrichment_job_id)
        result["detail"] += f". Enrichment started for {rule_page_count} rules."
    return result


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

# Domain classification map: path fragments → (domain_name, domain_slug)
_DOMAIN_MAP = [
    ("Aluno/",        "Aluno",         "aluno"),
    ("aluno/",        "Aluno",         "aluno"),
    ("Aulas/",        "Aulas",         "aulas"),
    ("aulas/",        "Aulas",         "aulas"),
    ("Auth/",         "Autenticacao",  "autenticacao"),
    ("auth/",         "Autenticacao",  "autenticacao"),
    ("Categorias/",   "Categorias",    "categorias"),
    ("categorias/",   "Categorias",    "categorias"),
    ("Cursos/",       "Cursos",        "cursos"),
    ("cursos/",       "Cursos",        "cursos"),
    ("Instrutor/",    "Instrutor",     "instrutor"),
    ("instrutor/",    "Instrutor",     "instrutor"),
    ("Instrutores",   "Instrutor",     "instrutor"),
    ("instrutores/",  "Instrutor",     "instrutor"),
    ("Trilhas/",      "Trilhas",       "trilhas"),
    ("trilhas/",      "Trilhas",       "trilhas"),
    ("Planos",        "Planos",        "planos"),
    ("planos/",       "Planos",        "planos"),
    ("avaliacoes/",   "Avaliacoes",    "avaliacoes"),
    ("Avaliacoes/",   "Avaliacoes",    "avaliacoes"),
    ("Review",        "Avaliacoes",    "avaliacoes"),
    ("certificado",   "Certificados",  "certificados"),
    ("Certificado",   "Certificados",  "certificados"),
    ("Certificate",   "Certificados",  "certificados"),
    ("mensagens/",    "Mensagens",     "mensagens"),
    ("notificacoes/", "Notificacoes",  "notificacoes"),
    ("Notification",  "Notificacoes",  "notificacoes"),
    ("checkout",      "Pagamentos",    "pagamentos"),
    ("Enrollment",    "Inscricoes",    "inscricoes"),
    ("inscricao",     "Inscricoes",    "inscricoes"),
    ("inscricoes",    "Inscricoes",    "inscricoes"),
    ("ajuda/",        "Ajuda",         "ajuda"),
    ("Models/",       "Modelos",       "modelos"),
    ("Observers/",    "Modelos",       "modelos"),
    ("Policies/",     "Modelos",       "modelos"),
    ("Requests/",     "Validacao",     "validacao"),
    ("config/",       "Configuracao",  "configuracao"),
    ("bootstrap/",    "Configuracao",  "configuracao"),
    ("docker-",       "Configuracao",  "configuracao"),
    ("composer.",     "Configuracao",  "configuracao"),
    ("package.",      "Configuracao",  "configuracao"),
    ("routes/",       "Rotas",         "rotas"),
]


def _classify_domain(source_file: str) -> Tuple[str, str]:
    """
    PROMPT #269 - Classify a source file into a business domain.
    Returns (domain_name, domain_slug).
    """
    if not source_file:
        return ("Geral", "geral")
    for fragment, name, slug in _DOMAIN_MAP:
        if fragment in source_file:
            return (name, slug)
    return ("Geral", "geral")


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

    # Find parent page (regras-de-negocio) if it exists
    parent_page = (
        db.query(WikiPage)
        .filter(
            WikiPage.project_id == project_id,
            WikiPage.slug == "regras-de-negocio",
        )
        .first()
    )
    parent_id = parent_page.id if parent_page else None

    # --- Index page ---
    index_lines = [
        "## Regras de Negocio - Indice por Dominio\n",
        f"Total de regras extraidas: **{len(rows)}** em **{len(domains)}** dominios\n",
        "Clique em um dominio para ver todas as regras daquela area.\n",
    ]
    for domain_name in sorted(domains.keys()):
        rules = domains[domain_name]
        domain_slug = rules[0]["domain_slug"]
        index_lines.append(
            f"- **[{domain_name}](wiki:regras-{domain_slug})** ({len(rules)} regras)"
        )

    index_page = _upsert_wiki_page(
        db, project_id, "regras-indice",
        "Regras de Negocio - Indice",
        "\n".join(index_lines),
        20, "ai_generated"
    )
    if parent_id and index_page:
        index_page.parent_id = parent_id
    created_pages.append(index_page)

    # --- Per-domain pages + individual rule pages ---
    domain_order = 21
    for domain_name in sorted(domains.keys()):
        rules = domains[domain_name]
        domain_slug = rules[0]["domain_slug"]
        page_slug = f"regras-{domain_slug}"

        # Domain page with bullet list
        domain_lines = [
            f"## Regras de Negocio - {domain_name}\n",
            f"Total de regras neste dominio: **{len(rules)}**\n",
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
            f"Regras de Negocio - {domain_name}",
            "\n".join(domain_lines),
            domain_order, "ai_generated"
        )
        if index_page and domain_page:
            domain_page.parent_id = index_page.id
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
                f"**Dominio:** {domain_name}  \n"
                f"**Arquivo Fonte:** `{source_display}`\n\n"
                f"---\n\n"
                f"### Descricao\n\n"
                f"{rule['content']}\n\n"
                f"---\n\n"
                f"### Contexto\n\n"
                f"Regra de negocio extraida automaticamente do arquivo "
                f"`{source_display}`, parte do modulo **{domain_name}** do projeto.\n\n"
                f"Esta regra foi identificada durante a analise do codigo-fonte "
                f"e representa um comportamento ou restricao implementada no sistema.\n"
            )

            rule_page = _upsert_wiki_page(
                db, project_id, rule_slug,
                title, rule_content,
                rule_order, "ai_generated"
            )
            if domain_page and rule_page:
                rule_page.parent_id = domain_page.id
            created_pages.append(rule_page)
            rule_order += 1

        domain_order += 1

    return created_pages


async def _trigger_rule_enrichment_job(
    db: Session, project_id: UUID, rule_count: int
) -> Optional[UUID]:
    """
    PROMPT #270 - Helper to create and submit a rule enrichment background job.
    Returns the job_id or None if failed.
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
        },
        project_id=project_id,
        notification_title=f"Enriquecimento de {rule_count} regras wiki",
        deep_link=f"/projects/{project_id}/knowledge",
    )
    db.commit()

    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _enrich_rules_background,
        job.id,
        project_id,
    )
    logger.info(f"Wiki rule enrichment job {job.id} submitted for {rule_count} rules")
    return job.id


@router.post("/{project_id}/wiki/enrich-rules")
async def enrich_business_rule_pages(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    PROMPT #270 - Trigger AI enrichment of individual business rule wiki pages.
    Creates a background job that enriches each rule page with rich dissertative content.
    Returns job_id for polling progress.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Count rule pages that need enrichment (source=ai_generated, slug starts with regra-)
    from sqlalchemy import text as sql_text
    count_result = db.execute(sql_text("""
        SELECT COUNT(*) FROM wiki_pages
        WHERE project_id = :pid
        AND slug LIKE 'regra-%%'
        AND source = 'ai_generated'
    """), {"pid": str(project_id)})
    rule_count = count_result.scalar() or 0

    if rule_count == 0:
        raise HTTPException(
            status_code=400,
            detail="No business rule pages found. Run generate-from-context first."
        )

    job_id = await _trigger_rule_enrichment_job(db, project_id, rule_count)

    return {
        "detail": f"Enrichment started for {rule_count} rule pages",
        "job_id": str(job_id),
        "rule_count": rule_count,
    }


async def _enrich_rules_background(
    job_id: UUID,
    project_id: UUID,
):
    """
    PROMPT #270 - Background task to enrich individual business rule wiki pages.
    Makes one AI call per rule page with rich prompt context.
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

        # Get all rule pages that need enrichment
        rule_pages = (
            db.query(WikiPage)
            .filter(
                WikiPage.project_id == project_id,
                WikiPage.slug.like("regra-%"),
                WikiPage.source == "ai_generated",
            )
            .all()
        )

        total = len(rule_pages)
        if total == 0:
            job_manager.complete_job(job_id, {"enriched": 0, "total": 0})
            return

        job_manager.update_progress(job_id, 5.0, f"Preparando {total} regras para enriquecimento...")

        # Build a map of domain pages to get related rules per domain
        domain_rules_map: dict = {}
        for page in rule_pages:
            # Find parent domain page
            if page.parent_id:
                parent_slug = db.execute(sql_text(
                    "SELECT slug FROM wiki_pages WHERE id = :pid"
                ), {"pid": str(page.parent_id)}).scalar()
                if parent_slug and parent_slug not in domain_rules_map:
                    # Get sibling rules (same domain, max 10 for context)
                    siblings = (
                        db.query(WikiPage)
                        .filter(
                            WikiPage.parent_id == page.parent_id,
                            WikiPage.slug.like("regra-%"),
                            WikiPage.id != page.id,
                        )
                        .limit(10)
                        .all()
                    )
                    domain_rules_map[parent_slug] = [
                        s.title for s in siblings
                    ]

        loader = PromptLoader()
        orchestrator = AIOrchestrator(db)
        enriched_count = 0
        failed_count = 0

        for i, page in enumerate(rule_pages):
            # Check cancellation
            if job_manager.is_cancelled(job_id):
                job_manager.update_progress(
                    job_id, (i / total) * 100,
                    f"Cancelado. {enriched_count} regras enriquecidas de {i}."
                )
                break

            progress = 5.0 + (i / total) * 90.0
            job_manager.update_progress(
                job_id, progress,
                f"Enriquecendo regra {i + 1}/{total}: {page.title[:60]}..."
            )

            try:
                # Extract domain and source from current content
                domain_name = "Geral"
                source_file = ""
                for line in page.content.split("\n"):
                    if line.startswith("**Dominio:**"):
                        domain_name = line.replace("**Dominio:**", "").strip()
                    elif line.startswith("**Arquivo Fonte:**"):
                        source_file = line.replace("**Arquivo Fonte:**", "").strip().strip("`")

                # Get original rule content (from Descricao section)
                rule_content = page.title
                desc_marker = "### Descricao"
                if desc_marker in page.content:
                    parts = page.content.split(desc_marker, 1)
                    if len(parts) > 1:
                        desc_text = parts[1].split("---")[0].strip()
                        if desc_text:
                            rule_content = desc_text

                # Get related rules from same domain
                parent_slug = ""
                if page.parent_id:
                    parent_slug = db.execute(sql_text(
                        "SELECT slug FROM wiki_pages WHERE id = :pid"
                    ), {"pid": str(page.parent_id)}).scalar() or ""
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

                # Call AI
                response = await orchestrator.execute(
                    usage_type="memory",
                    messages=[{"role": "user", "content": usr_prompt}],
                    system_prompt=sys_prompt,
                    max_tokens=2000,
                    project_id=str(project_id),
                    metadata={"type": "wiki_rule_enrichment", "rule_slug": page.slug},
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

            # Small delay to avoid rate limiting
            await asyncio.sleep(0.5)

        job_manager.complete_job(job_id, {
            "enriched": enriched_count,
            "failed": failed_count,
            "total": total,
        })
        logger.info(
            f"Wiki rule enrichment complete for project {project_id}: "
            f"{enriched_count}/{total} enriched, {failed_count} failed"
        )

    except Exception as e:
        logger.error(f"Wiki rule enrichment job {job_id} failed: {e}")
        try:
            JobManager(db).fail_job(job_id, str(e))
        except Exception:
            pass
    finally:
        db.close()


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
