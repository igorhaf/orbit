"""
Wiki Database Storage Layer

Wiki pages are stored exclusively in the PostgreSQL database (table wiki_pages).
No filesystem operations are performed.

Public API:
    list_pages(db, project_id)      -> List[WikiFileInfo]
    read_page(db, project_id, slug) -> Optional[WikiFileInfo]
    write_page(...)                 -> dict
    delete_page(db, project_id, slug) -> bool
    page_exists(db, project_id, slug) -> bool
    ensure_unique_slug(db, project_id, slug) -> str
    build_tree(db, project_id)      -> List[dict]
    page_to_response(db, project_id, page) -> dict
    apply_semantic_links(db, project_id, add_links_fn) -> int
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID, uuid5, NAMESPACE_URL

from sqlalchemy.orm import Session

from app.models.wiki_page import WikiPage

logger = logging.getLogger(__name__)


@dataclass
class WikiFileInfo:
    """In-memory representation of a wiki page."""
    slug: str
    title: str
    content: str
    source: str = "manual"
    order_index: int = 0
    created_at: str = ""
    updated_at: str = ""
    parent_slug: Optional[str] = None
    page_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _deterministic_id(project_id, slug: str) -> str:
    """Generate a stable UUID5 string from project_id and slug."""
    pid = str(project_id) if not isinstance(project_id, str) else project_id
    return str(uuid5(NAMESPACE_URL, f"{pid}:{slug}"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _dt_to_iso(dt: Optional[datetime]) -> str:
    """Convert a datetime to ISO string, or empty string if None."""
    if dt is None:
        return ""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _row_to_info(row: WikiPage, parent_slug: Optional[str] = None) -> WikiFileInfo:
    """Convert a WikiPage DB row to a WikiFileInfo dataclass."""
    return WikiFileInfo(
        slug=row.slug,
        title=row.title,
        content=row.content or "",
        source=row.source or "manual",
        order_index=row.order_index or 0,
        created_at=_dt_to_iso(row.created_at),
        updated_at=_dt_to_iso(row.updated_at),
        parent_slug=parent_slug,
        page_id=str(row.id),
    )


def _resolve_parent_slug(db: Session, parent_id: Optional[UUID]) -> Optional[str]:
    """Look up the slug for a parent_id, or return None."""
    if parent_id is None:
        return None
    parent = db.query(WikiPage.slug).filter(WikiPage.id == parent_id).first()
    return parent.slug if parent else None


def _resolve_parent_id(db: Session, project_id: UUID, parent_slug: Optional[str]) -> Optional[UUID]:
    """Look up the id for a parent_slug within the same project, or return None."""
    if not parent_slug:
        return None
    parent = (
        db.query(WikiPage.id)
        .filter(WikiPage.project_id == project_id, WikiPage.slug == parent_slug)
        .first()
    )
    return parent.id if parent else None


def _page_to_response(
    project_id,
    slug: str,
    title: str,
    content: str,
    source: str,
    order_index: int,
    parent_slug: Optional[str],
    created_at: str,
    updated_at: str,
    page_id: Optional[str] = None,
) -> dict:
    """Convert page data to API response dict."""
    return {
        "id": page_id or _deterministic_id(project_id, slug),
        "project_id": str(project_id),
        "slug": slug,
        "title": title,
        "content": content,
        "parent_id": (
            _deterministic_id(project_id, parent_slug)
            if parent_slug
            else None
        ),
        "order_index": order_index,
        "source": source,
        "created_at": created_at or datetime.now(timezone.utc).isoformat(),
        "updated_at": updated_at or datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def page_exists(db: Session, project_id: UUID, slug: str) -> bool:
    """Check if a wiki page exists in the database."""
    return (
        db.query(WikiPage.id)
        .filter(WikiPage.project_id == project_id, WikiPage.slug == slug)
        .first()
    ) is not None


def ensure_unique_slug(db: Session, project_id: UUID, slug: str) -> str:
    """Ensure slug is unique within the project wiki."""
    base_slug = slug
    counter = 1
    while page_exists(db, project_id, slug):
        slug = f"{base_slug}-{counter}"
        counter += 1
    return slug


def read_page(db: Session, project_id: UUID, slug: str) -> Optional[WikiFileInfo]:
    """Read a single wiki page from database."""
    row = (
        db.query(WikiPage)
        .filter(WikiPage.project_id == project_id, WikiPage.slug == slug)
        .first()
    )
    if not row:
        return None

    parent_slug = _resolve_parent_slug(db, row.parent_id)
    return _row_to_info(row, parent_slug)


def write_page(
    db: Session,
    project_id: UUID,
    slug: str,
    title: str,
    content: str,
    source: str = "manual",
    order_index: int = 0,
    parent_slug: Optional[str] = None,
    respect_protected: bool = True,
) -> dict:
    """Write/update a wiki page in the database.

    REGRA #0: if existing page has source='manual' or 'enrichment',
    never overwrite with source='ai_generated' or other auto source.

    Returns:
        Dict matching WikiPageResponse format.
    """
    now = datetime.now(timezone.utc)
    parent_id = _resolve_parent_id(db, project_id, parent_slug)

    existing = (
        db.query(WikiPage)
        .filter(WikiPage.project_id == project_id, WikiPage.slug == slug)
        .first()
    )

    # REGRA #0 - Protected sources never overwritten by automated content
    protected_sources = {"manual", "enrichment"}
    if respect_protected and existing:
        existing_source = existing.source or ""
        if existing_source in protected_sources and source not in protected_sources:
            logger.debug(
                "Wiki page '%s' is protected (source=%s), skipping overwrite",
                slug, existing_source,
            )
            ex_parent_slug = _resolve_parent_slug(db, existing.parent_id)
            return _page_to_response(
                project_id=project_id,
                slug=slug,
                title=existing.title,
                content=existing.content or "",
                source=existing_source,
                order_index=existing.order_index or 0,
                parent_slug=ex_parent_slug,
                created_at=_dt_to_iso(existing.created_at),
                updated_at=_dt_to_iso(existing.updated_at),
                page_id=str(existing.id),
            )

    if existing:
        # Update existing page
        existing.title = title
        existing.content = content
        existing.source = source
        existing.order_index = order_index
        existing.parent_id = parent_id
        existing.updated_at = now
        db.flush()
        page_id = str(existing.id)
        created_at_iso = _dt_to_iso(existing.created_at)
    else:
        # Create new page
        new_page = WikiPage(
            project_id=project_id,
            slug=slug,
            title=title,
            content=content,
            source=source,
            order_index=order_index,
            parent_id=parent_id,
            created_at=now,
            updated_at=now,
        )
        db.add(new_page)
        db.flush()
        page_id = str(new_page.id)
        created_at_iso = _dt_to_iso(now)

    return _page_to_response(
        project_id=project_id,
        slug=slug,
        title=title,
        content=content,
        source=source,
        order_index=order_index,
        parent_slug=parent_slug,
        created_at=created_at_iso,
        updated_at=_dt_to_iso(now),
        page_id=page_id,
    )


def delete_page(db: Session, project_id: UUID, slug: str) -> bool:
    """Delete a wiki page from the database.

    Children are handled by the DB foreign key (SET NULL on parent_id).
    Returns True if deleted, False if not found.
    """
    row = (
        db.query(WikiPage)
        .filter(WikiPage.project_id == project_id, WikiPage.slug == slug)
        .first()
    )
    if not row:
        return False

    db.delete(row)
    db.flush()
    return True


def list_pages(db: Session, project_id: UUID) -> List[WikiFileInfo]:
    """List all wiki pages for a project from database."""
    rows = (
        db.query(WikiPage)
        .filter(WikiPage.project_id == project_id)
        .order_by(WikiPage.order_index, WikiPage.title)
        .all()
    )

    # Build a slug lookup for parent resolution (avoids N+1 queries)
    id_to_slug: Dict[str, str] = {}
    for row in rows:
        id_to_slug[str(row.id)] = row.slug

    pages = []
    for row in rows:
        parent_slug = None
        if row.parent_id:
            parent_slug = id_to_slug.get(str(row.parent_id))
        pages.append(_row_to_info(row, parent_slug))

    return pages


def build_tree(db: Session, project_id: UUID) -> List[dict]:
    """Build hierarchical tree structure from wiki pages.

    Returns list of tree items matching WikiPageTreeItem format.
    """
    pages = list_pages(db, project_id)
    if not pages:
        return []

    # Group by parent_slug
    children_map: Dict[Optional[str], List[WikiFileInfo]] = {}
    for page in pages:
        parent = page.parent_slug
        if parent not in children_map:
            children_map[parent] = []
        children_map[parent].append(page)

    # Sort children by order_index, then title
    for key in children_map:
        children_map[key].sort(key=lambda p: (p.order_index, p.title))

    def _build(parent_slug: Optional[str]) -> List[dict]:
        items = children_map.get(parent_slug, [])
        result = []
        for page in items:
            item = {
                "id": page.page_id or _deterministic_id(project_id, page.slug),
                "slug": page.slug,
                "title": page.title,
                "parent_id": (
                    _deterministic_id(project_id, page.parent_slug)
                    if page.parent_slug
                    else None
                ),
                "order_index": page.order_index,
                "source": page.source,
                "children": _build(page.slug),
            }
            result.append(item)
        return result

    return _build(None)


def page_to_response(db: Session, project_id, page: WikiFileInfo) -> dict:
    """Convert a WikiFileInfo to API response dict."""
    return _page_to_response(
        project_id=project_id,
        slug=page.slug,
        title=page.title,
        content=page.content,
        source=page.source,
        order_index=page.order_index,
        parent_slug=page.parent_slug,
        created_at=page.created_at,
        updated_at=page.updated_at,
        page_id=page.page_id,
    )


def apply_semantic_links(db: Session, project_id: UUID, add_links_fn) -> int:
    """Apply semantic hypertext linking to all wiki pages in database.

    Args:
        db: Database session
        project_id: Project UUID
        add_links_fn: Function(content, terms_map, exclude_slug, max_links, valid_slugs) -> str

    Returns:
        Number of pages modified.
    """
    pages = list_pages(db, project_id)
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
        new_content = add_links_fn(
            page.content,
            terms_map,
            exclude_slug=page.slug,
            max_links=10,
            valid_slugs=valid_slugs,
        )
        if new_content != page.content:
            # Write back with same source to preserve protection status
            write_page(
                db=db,
                project_id=project_id,
                slug=page.slug,
                title=page.title,
                content=new_content,
                source=page.source,
                order_index=page.order_index,
                parent_slug=page.parent_slug,
                respect_protected=False,  # Same source, safe to write
            )
            modified_count += 1

    if modified_count > 0:
        logger.info(
            "Semantic linking: %d/%d pages updated", modified_count, len(pages)
        )

    return modified_count
