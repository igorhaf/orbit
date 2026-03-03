"""
Wiki Service - Business logic for wiki page generation, enrichment, and linking.

PROMPT #237 - Refactored to use filesystem storage (wiki_fs) instead of database.
All wiki pages are stored as .md files in satellite/wiki/.

Route handlers in wiki.py import from this module.
"""

import re
import logging
import hashlib
import asyncio
from typing import Dict, List, Optional, Tuple
from uuid import UUID
from collections import defaultdict

from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from app.database import SessionLocal
from app.models.project import Project
from app.services import wiki_fs

logger = logging.getLogger(__name__)


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


def _ensure_unique_slug(code_path: str, slug: str) -> str:
    """Ensure slug is unique within project wiki on disk."""
    return wiki_fs.ensure_unique_slug(code_path, slug)


def _upsert_wiki_page(
    code_path: str,
    project_id: UUID,
    slug: str,
    title: str,
    content: str,
    order_index: int,
    source: str,
    parent_slug: str = None,
) -> dict:
    """Create or update a wiki page on disk.

    PROMPT #237 - Filesystem-based replacement for the DB version.
    PROMPT #285 - Protected sources: pages with source='manual' or 'enrichment'
    are NEVER overwritten by automated re-scan.
    """
    return wiki_fs.write_page(
        code_path=code_path,
        project_id=project_id,
        slug=slug,
        title=title,
        content=content,
        source=source,
        order_index=order_index,
        parent_slug=parent_slug,
    )


def _build_stack_page(project, stack_info: dict, scan_summary: dict = None) -> str:
    """Build markdown content for stack page."""
    lines = ["## Stack Tecnologica\n"]

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
    lines.append(f"- **Arquivos de código:** {code_files}")

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
        "configuration_file": "Arquivo de Configuração",
        "naming_convention": "Convencao de Nomenclatura",
        "class_hierarchy": "Hierarquia de Classes",
        "import_pattern": "Padrão de Imports",
        "function_signature": "Assinatura de Funções",
        "decorator_pattern": "Padrão de Decorators",
        "ui_component": "Componente de Interface",
        "ui_blueprint": "Blueprint de Interface",
        "ui_component_documentation": "Documentação de Componente",
        "css_configuration": "Configuração CSS",
        "css_template": "Template CSS",
        "stylesheet": "Folha de Estilo",
        "documentation_blueprint": "Blueprint de Documentação",
        "markdown_documentation": "Documentação Markdown",
    }
    return SPEC_PT.get(spec_type, spec_type.replace("_", " ").title())


def _translate_category(category: str) -> str:
    """Translate category labels to Portuguese."""
    CAT_PT = {
        "model": "Modelos",
        "controller": "Controladores",
        "test": "Testes",
        "service": "Serviços",
        "general": "Geral",
        "architecture": "Arquitetura",
        "component": "Componentes",
        "api": "APIs",
        "documentation": "Documentação",
        "css": "Estilos CSS",
        "ui_component": "Componentes de Interface",
        "backup": "Backup",
        "hub_spoke": "Hub-Spoke",
        "paired_imports": "Imports Pareados",
    }
    return CAT_PT.get(category, category.title() if category else "Geral")


def _build_architecture_patterns_page(db, project_id: UUID) -> Optional[str]:
    """Build wiki page from RAG architecture patterns."""
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
        "## Padrões de Arquitetura\n",
        f"Total de padrões arquiteturais descobertos: **{len(rows)}**\n",
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
    """Build wiki page from RAG code convention patterns."""
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
        "## Convencoes de Código\n",
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
    """Build wiki page from RAG UI component/blueprint patterns."""
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
        f"Total de padrões de UI descobertos: **{len(rows)}**\n",
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
    """Build wiki page aggregating code files by language and directory."""
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

    lang_dirs: dict = defaultdict(lambda: defaultdict(list))
    for row in rows:
        lang = row[0] or "unknown"
        fpath = row[1] or "unknown"
        parts = fpath.rsplit("/", 1)
        directory = parts[0] if len(parts) > 1 else "/"
        filename = parts[-1]
        lang_dirs[lang][directory].append(filename)

    total_files = len(rows)
    total_langs = len(lang_dirs)

    lines = [
        "## Estrutura de Código\n",
        f"Total de arquivos indexados: **{total_files}** em **{total_langs}** linguagens\n",
    ]

    for lang, dirs in sorted(lang_dirs.items(), key=lambda x: -sum(len(v) for v in x[1].values())):
        file_count = sum(len(v) for v in dirs.values())
        lines.append(f"\n### {lang.upper()} ({file_count} arquivos)\n")

        for directory, files in sorted(dirs.items()):
            dir_display = directory.split("/projects/")[-1] if "/projects/" in directory else directory
            lines.append(f"**{dir_display}/** ({len(files)} arquivos)")
            for f in sorted(files)[:20]:
                lines.append(f"- {f}")
            if len(files) > 20:
                lines.append(f"- ... e mais {len(files) - 20} arquivos")
            lines.append("")

    return "\n".join(lines)


def _build_git_history_page(db, project_id: UUID) -> Optional[str]:
    """Build wiki page from RAG git commits."""
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
        "## Histórico de Desenvolvimento\n",
        f"Total de commits analisados: **{len(rows)}**\n",
        "Histórico dos commits mais recentes do repositório.\n",
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
# PROMPT #269 - Individual Business Rule Wiki Pages (filesystem-based)
# =============================================================================

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
    """Classify a source file into a business domain."""
    if not source_file:
        return ("General", "general")

    path = source_file
    if "/projects/" in path:
        path = path.split("/projects/", 1)[-1]
        parts = path.split("/")
        if len(parts) > 1:
            parts = parts[1:]
        path = "/".join(parts)

    parts = path.replace("\\", "/").split("/")
    if len(parts) > 1:
        parts = parts[:-1]
    else:
        name = parts[0].rsplit(".", 1)[0] if "." in parts[0] else parts[0]
        if name:
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            return (name.replace("_", " ").replace("-", " ").title(), slug or "general")
        return ("General", "general")

    for part in parts:
        clean = part.strip()
        if clean.lower() not in _SKIP_DIRS and len(clean) > 1:
            slug = re.sub(r"[^a-z0-9]+", "-", clean.lower()).strip("-")
            name = clean.replace("_", " ").replace("-", " ").title()
            return (name, slug or "general")

    last = parts[-1].strip() if parts else ""
    if last and len(last) > 1:
        slug = re.sub(r"[^a-z0-9]+", "-", last.lower()).strip("-")
        name = last.replace("_", " ").replace("-", " ").title()
        return (name, slug or "general")

    return ("General", "general")


def _build_business_rules_wiki_pages(
    db: "Session", code_path: str, project_id: UUID
) -> List[dict]:
    """
    PROMPT #269/#237 - Build hierarchical wiki pages for business rules on disk.

    Creates:
    1. Index page listing all domains with rule counts
    2. Per-domain page with bullet list of rules
    3. Per-rule individual page with rich content
    """
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

    created_pages: List[dict] = []

    # Ensure parent page exists
    parent_slug = "regras-de-negocio"
    if not wiki_fs.page_exists(code_path, parent_slug):
        created_pages.append(_upsert_wiki_page(
            code_path, project_id, parent_slug,
            "Regras de Negocio",
            "## Regras de Negócio\n\nPágina principal das regras de negócio do projeto.\n",
            2, "ai_generated"
        ))

    # --- Index page ---
    total_rules = sum(len(rules) for rules in domains.values())
    total_domains = len(domains)

    all_source_files = set()
    for rules in domains.values():
        for rule in rules:
            if rule["source_file"]:
                all_source_files.add(rule["source_file"])

    index_lines = [
        "## Regras de Negocio - Índice por Dominio\n",
        f"Total de regras extraidas: **{total_rules}** em **{total_domains}** dominios "
        f"a partir de **{len(all_source_files)}** arquivos fonte.\n",
        "Clique em um dominio para ver todas as regras daquela área.\n",
        "---\n",
        "### Resumo\n",
        "| Dominio | Regras | Arquivos Fonte |",
        "|---------|--------|----------------|",
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

    index_lines.append("### Dominios\n")
    for domain_name in sorted(domains.keys()):
        rules = domains[domain_name]
        domain_slug = rules[0]["domain_slug"]
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
                preview_text += f"; ... (+{len(rules) - 3} mais)"
        index_lines.append(
            f"- **[{domain_name}](wiki:regras-{domain_slug})** ({len(rules)} regras){preview_text}"
        )

    index_page = _upsert_wiki_page(
        code_path, project_id, "regras-índice",
        "Regras de Negocio - Índice",
        "\n".join(index_lines),
        20, "ai_generated",
        parent_slug=parent_slug,
    )
    created_pages.append(index_page)

    # --- Per-domain pages + individual rule pages ---
    domain_order = 21
    for domain_name in sorted(domains.keys()):
        rules = domains[domain_name]
        domain_slug = rules[0]["domain_slug"]
        page_slug = f"regras-{domain_slug}"

        domain_lines = [
            f"## Regras de Negocio - {domain_name}\n",
            f"Total de regras neste dominio: **{len(rules)}**\n",
        ]

        by_file: Dict[str, list] = defaultdict(list)
        for rule in rules:
            by_file[rule["source_file"]].append(rule)

        for source_file in sorted(by_file.keys()):
            file_rules = by_file[source_file]
            file_display = source_file.split("/projects/")[-1] if "/projects/" in source_file else source_file
            domain_lines.append(f"\n### {file_display}\n")
            for rule in file_rules:
                title = rule["content"].split(".")[0].strip()
                if len(title) > 120:
                    title = title[:117] + "..."
                if not title or len(title) < 5:
                    title = rule["content"][:120]
                rule_slug = f"regra-{rule['rule_hash']}"
                domain_lines.append(f"- [{title}](wiki:{rule_slug})")

        domain_page = _upsert_wiki_page(
            code_path, project_id, page_slug,
            f"Regras de Negocio - {domain_name}",
            "\n".join(domain_lines),
            domain_order, "ai_generated",
            parent_slug="regras-índice",
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
                f"**Dominio:** {domain_name}  \n"
                f"**Arquivo Fonte:** `{source_display}`\n\n"
                f"---\n\n"
                f"### Descrição\n\n"
                f"{rule['content']}\n\n"
                f"---\n\n"
                f"### Contexto\n\n"
                f"Regra de negocio extraida automaticamente do arquivo "
                f"`{source_display}`, parte do módulo **{domain_name}**.\n\n"
                f"Esta regra foi identificada durante a análise do código-fonte "
                f"e representa um comportamento ou restrição implementada no sistema.\n"
            )

            rule_page = _upsert_wiki_page(
                code_path, project_id, rule_slug,
                title, rule_content,
                rule_order, "ai_generated",
                parent_slug=page_slug,
            )
            created_pages.append(rule_page)
            rule_order += 1

        domain_order += 1

    return created_pages


async def _trigger_rule_enrichment_job(
    db: Session, project_id: UUID, rule_count: int, force: bool = False
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
# PROMPT #274 - Hypertext Linking Semântico (estilo Wikipedia)
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
    Idempotent: detects existing wiki links and skips terms already linked.
    """
    if not content or not terms_map:
        return content

    # Step 1: Remove orphan wiki links
    if valid_slugs is not None:
        def _clean_orphan(m: re.Match) -> str:
            slug = m.group(2)
            if slug in valid_slugs:
                return m.group(0)
            return m.group(1)

        content = re.sub(
            r'\[([^\]]+)\]\(wiki:([a-z0-9_-]+)\)',
            _clean_orphan,
            content,
        )

    # Step 2: Collect slugs already linked
    existing_link_slugs: set = set()
    for m in re.finditer(r'\]\(wiki:([a-z0-9_-]+)\)', content):
        existing_link_slugs.add(m.group(1))

    sorted_terms = sorted(terms_map.keys(), key=len, reverse=True)

    lines = content.split("\n")
    result_lines = []
    links_added = 0
    linked_slugs: set = set(existing_link_slugs)
    in_code_block = False

    for line in lines:
        if line.strip().startswith("```"):
            in_code_block = not in_code_block
            result_lines.append(line)
            continue

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
            if slug == exclude_slug or slug in linked_slugs:
                continue

            pattern = re.compile(
                r'\b(' + re.escape(term) + r')\b',
                re.IGNORECASE,
            )

            for match in pattern.finditer(line):
                start, end = match.start(), match.end()
                before = line[:start]
                in_link_text = (
                    '[' in before
                    and '](' not in before[before.rfind('['):]
                )
                in_link_url = (
                    '](' in before
                    and ')' not in before[before.rfind('](') + 2:]
                )
                backtick_count = before.count('`')
                in_inline_code = backtick_count % 2 == 1

                if in_link_text or in_link_url or in_inline_code:
                    continue

                matched_text = match.group(1)
                replacement = f"[{matched_text}](wiki:{slug})"
                line = line[:start] + replacement + line[end:]
                links_added += 1
                linked_slugs.add(slug)
                break

        result_lines.append(line)

    return "\n".join(result_lines)


def _apply_semantic_links_to_project_fs(code_path: str, project_id) -> int:
    """Apply semantic hypertext linking to all wiki pages on disk."""
    return wiki_fs.apply_semantic_links(
        code_path, project_id, _add_semantic_links_to_content
    )


def _parse_wiki_sections(markdown: str) -> Dict[str, Tuple[str, str]]:
    """Parse AI-generated markdown into wiki page sections."""
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
    parts = re.split(r'^## (.+)$', markdown, flags=re.MULTILINE)

    for i in range(1, len(parts), 2):
        header = parts[i].strip()
        content = parts[i + 1].strip() if i + 1 < len(parts) else ""
        header_normalized = _normalize(header)

        matched = False
        for key, (slug, title) in SECTION_MAP.items():
            if key in header_normalized:
                full_content = f"## {header}\n\n{content}"
                sections[slug] = (title, full_content)
                matched = True
                break

        if not matched:
            slug = _slugify(header)
            if slug:
                sections[slug] = (header, f"## {header}\n\n{content}")

    return sections


def _parse_wiki_subsections(markdown: str) -> Dict[str, Tuple[str, str]]:
    """Parse ### headers into wiki pages when ## parsing yields few results."""
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


# ---------------------------------------------------------------------------
# PROMPT #247 — Per-page wiki AI operations (generate/expand/summarize/rephrase)
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
