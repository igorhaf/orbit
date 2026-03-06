"""
Wiki Service - Business logic for wiki page generation, enrichment, and linking.

PROMPT #237 - Refactored to use filesystem storage (wiki_fs) instead of database.
All wiki pages are stored as .md files in satellite/wiki/.

Route handlers in wiki.py import from this module.

This file holds CRUD / slug utilities and re-exports every public symbol from
the sub-modules (wiki_pages, wiki_enrichment) so that existing import
statements remain unchanged.
"""

import re
import logging
from uuid import UUID

from app.services import wiki_fs

logger = logging.getLogger(__name__)


# ============================================================================
# CRUD / Slug helpers (owned by this module)
# ============================================================================

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


# ============================================================================
# Re-exports from wiki_pages (page builders, parsing, semantic links)
# ============================================================================

from app.services.wiki_pages import (  # noqa: E402, F401
    _build_stack_page,
    _build_rules_page,
    _build_features_page,
    _build_scan_page,
    _translate_spec_type,
    _translate_category,
    _build_architecture_patterns_page,
    _build_code_conventions_page,
    _build_ui_components_page,
    _build_code_structure_page,
    _build_git_history_page,
    _SKIP_DIRS,
    _classify_domain,
    _build_business_rules_wiki_pages,
    _add_semantic_links_to_content,
    _apply_semantic_links_to_project_fs,
    _parse_wiki_sections,
    _parse_wiki_subsections,
)

# ============================================================================
# Re-exports from wiki_enrichment (AI enrichment, per-page AI ops)
# ============================================================================

from app.services.wiki_enrichment import (  # noqa: E402, F401
    _trigger_rule_enrichment_job,
    _enrich_rules_background,
    _process_wiki_page_ai_async,
)
