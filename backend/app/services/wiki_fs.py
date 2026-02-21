"""
Wiki Filesystem Storage Layer

PROMPT #237 - Wiki pages stored as .md files with YAML front matter
in satellite/knowledge/wiki/ inside the project code_path.

Storage structure:
    satellite/knowledge/wiki/
        {slug}.md                    -> root page (no parent)
        {parent_slug}/
            {slug}.md                -> child page
            {slug}/
                {grandchild}.md      -> grandchild page

Hierarchy is derived from directory structure, not database.
IDs are deterministic UUIDs from project_id + slug (uuid5).
"""

import logging
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from uuid import UUID, uuid5, NAMESPACE_URL

import yaml

logger = logging.getLogger(__name__)

SATELLITE_DIR = "satellite"
WIKI_DIR_NAME = "wiki"


@dataclass
class WikiFileInfo:
    """In-memory representation of a wiki page read from disk."""
    slug: str
    title: str
    content: str
    source: str = "manual"
    order_index: int = 0
    created_at: str = ""
    updated_at: str = ""
    parent_slug: Optional[str] = None
    file_path: Optional[Path] = field(default=None, repr=False)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _wiki_dir(code_path: str) -> Path:
    """Return the wiki directory path for a project."""
    return Path(code_path) / SATELLITE_DIR / "knowledge" / WIKI_DIR_NAME


def _deterministic_id(project_id, slug: str) -> str:
    """Generate a stable UUID5 string from project_id and slug."""
    pid = str(project_id) if not isinstance(project_id, str) else project_id
    return str(uuid5(NAMESPACE_URL, f"{pid}:{slug}"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_front_matter(text: str) -> Tuple[dict, str]:
    """Parse YAML front matter from markdown text.

    Returns (metadata_dict, body_text).
    Returns ({}, full_text) if no valid front matter.
    """
    if not text.startswith("---"):
        return {}, text

    end = text.find("---", 3)
    if end < 0:
        return {}, text

    yaml_text = text[3:end].strip()
    body = text[end + 3:].strip()

    try:
        meta = yaml.safe_load(yaml_text)
        if not isinstance(meta, dict):
            return {}, text
        return meta, body
    except yaml.YAMLError:
        return {}, text


def _render_front_matter(info: WikiFileInfo) -> str:
    """Serialize WikiFileInfo to YAML front matter + markdown body."""
    meta = {
        "title": info.title,
        "slug": info.slug,
        "source": info.source,
        "order_index": info.order_index,
        "created_at": info.created_at,
        "updated_at": info.updated_at,
    }
    yaml_str = yaml.dump(
        meta, default_flow_style=False, allow_unicode=True, sort_keys=False
    )
    return f"---\n{yaml_str}---\n\n{info.content}"


def _find_page_path(wiki_dir: Path, slug: str) -> Optional[Path]:
    """Find a page file by slug within the wiki directory."""
    if not wiki_dir.exists():
        return None
    target = f"{slug}.md"
    for path in wiki_dir.rglob(target):
        if path.is_file():
            return path
    return None


def _parent_slug_from_path(wiki_dir: Path, file_path: Path) -> Optional[str]:
    """Derive parent slug from file's position in directory hierarchy."""
    relative = file_path.relative_to(wiki_dir)
    parts = relative.parts  # e.g. ("foo", "bar", "baz.md")
    if len(parts) <= 1:
        return None  # root page
    # Parent slug is the last directory name
    return parts[-2]


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
) -> dict:
    """Convert page data to API response dict."""
    return {
        "id": _deterministic_id(project_id, slug),
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
        "created_at": created_at,
        "updated_at": updated_at,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def page_exists(code_path: str, slug: str) -> bool:
    """Check if a wiki page exists on disk."""
    return _find_page_path(_wiki_dir(code_path), slug) is not None


def ensure_unique_slug(code_path: str, slug: str) -> str:
    """Ensure slug is unique within the project wiki."""
    base_slug = slug
    counter = 1
    while page_exists(code_path, slug):
        slug = f"{base_slug}-{counter}"
        counter += 1
    return slug


def read_page(code_path: str, slug: str) -> Optional[WikiFileInfo]:
    """Read a wiki page from disk by slug."""
    wiki = _wiki_dir(code_path)
    path = _find_page_path(wiki, slug)
    if not path:
        return None

    text = path.read_text(encoding="utf-8")
    meta, body = _parse_front_matter(text)

    return WikiFileInfo(
        slug=meta.get("slug", slug),
        title=meta.get("title", slug),
        content=body,
        source=meta.get("source", "manual"),
        order_index=meta.get("order_index", 0),
        created_at=meta.get("created_at", ""),
        updated_at=meta.get("updated_at", ""),
        parent_slug=_parent_slug_from_path(wiki, path),
        file_path=path,
    )


def write_page(
    code_path: str,
    project_id,
    slug: str,
    title: str,
    content: str,
    source: str = "manual",
    order_index: int = 0,
    parent_slug: Optional[str] = None,
    respect_protected: bool = True,
) -> dict:
    """Write a wiki page to disk as a .md file with YAML front matter.

    REGRA #0: if existing page has source='manual' or 'enrichment',
    never overwrite with source='ai_generated' or other auto source.

    Args:
        code_path: Project root directory
        project_id: Project UUID (for deterministic ID generation)
        slug: URL-friendly page identifier
        title: Page title
        content: Markdown body
        source: Origin ('manual', 'ai_generated', 'enrichment')
        order_index: Sort order among siblings
        parent_slug: Slug of parent page (determines directory placement)
        respect_protected: If True, enforces REGRA #0 protection

    Returns:
        Dict matching WikiPageResponse format.
    """
    wiki = _wiki_dir(code_path)
    wiki.mkdir(parents=True, exist_ok=True)
    now = _now_iso()

    # Check existing page for REGRA #0
    existing_path = _find_page_path(wiki, slug)
    existing_meta = None
    if existing_path:
        text = existing_path.read_text(encoding="utf-8")
        existing_meta, existing_body = _parse_front_matter(text)

    # REGRA #0 - Protected sources never overwritten by automated content
    protected_sources = {"manual", "enrichment"}
    if respect_protected and existing_meta:
        existing_source = existing_meta.get("source", "")
        if existing_source in protected_sources and source not in protected_sources:
            logger.debug(
                f"Wiki page '{slug}' is protected (source={existing_source}), "
                f"skipping content overwrite"
            )
            _, body = _parse_front_matter(
                existing_path.read_text(encoding="utf-8")
            )
            parent = _parent_slug_from_path(wiki, existing_path)
            return _page_to_response(
                project_id=project_id,
                slug=slug,
                title=existing_meta.get("title", title),
                content=body,
                source=existing_source,
                order_index=existing_meta.get("order_index", order_index),
                parent_slug=parent,
                created_at=existing_meta.get("created_at", now),
                updated_at=existing_meta.get("updated_at", now),
            )

    # Determine target path based on parent
    if parent_slug:
        parent_path = _find_page_path(wiki, parent_slug)
        if parent_path:
            child_dir = parent_path.parent / parent_slug
        else:
            # Parent doesn't exist as file yet; use flat directory
            child_dir = wiki / parent_slug
        child_dir.mkdir(parents=True, exist_ok=True)
        target = child_dir / f"{slug}.md"
    else:
        target = wiki / f"{slug}.md"

    # If file existed at a different location, remove old one
    if existing_path and existing_path.resolve() != target.resolve():
        existing_path.unlink(missing_ok=True)

    # Preserve created_at from existing page
    created_at = now
    if existing_meta:
        created_at = existing_meta.get("created_at", now)

    info = WikiFileInfo(
        slug=slug,
        title=title,
        content=content,
        source=source,
        order_index=order_index,
        created_at=created_at,
        updated_at=now,
    )

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(_render_front_matter(info), encoding="utf-8")

    return _page_to_response(
        project_id=project_id,
        slug=slug,
        title=title,
        content=content,
        source=source,
        order_index=order_index,
        parent_slug=parent_slug,
        created_at=created_at,
        updated_at=now,
    )


def delete_page(code_path: str, slug: str) -> bool:
    """Delete a wiki page and its children directory.

    Returns True if deleted, False if not found.
    """
    wiki = _wiki_dir(code_path)
    path = _find_page_path(wiki, slug)
    if not path:
        return False

    # Remove the file
    path.unlink()

    # Remove children directory if it exists
    children_dir = path.parent / slug
    if children_dir.exists() and children_dir.is_dir():
        shutil.rmtree(children_dir)

    # Clean up empty parent directories up to wiki root
    parent = path.parent
    while parent != wiki and parent.exists():
        try:
            if not any(parent.iterdir()):
                parent.rmdir()
                parent = parent.parent
            else:
                break
        except OSError:
            break

    return True


def list_pages(code_path: str) -> List[WikiFileInfo]:
    """List all wiki pages recursively."""
    wiki = _wiki_dir(code_path)
    if not wiki.exists():
        return []

    pages = []
    for path in sorted(wiki.rglob("*.md")):
        if not path.is_file() or path.name == ".gitkeep":
            continue
        try:
            text = path.read_text(encoding="utf-8")
            meta, body = _parse_front_matter(text)
            slug = meta.get("slug", path.stem)
            pages.append(WikiFileInfo(
                slug=slug,
                title=meta.get("title", slug),
                content=body,
                source=meta.get("source", "manual"),
                order_index=meta.get("order_index", 0),
                created_at=meta.get("created_at", ""),
                updated_at=meta.get("updated_at", ""),
                parent_slug=_parent_slug_from_path(wiki, path),
                file_path=path,
            ))
        except Exception as e:
            logger.warning(f"Error reading wiki page {path}: {e}")

    return pages


def build_tree(code_path: str, project_id) -> List[dict]:
    """Build hierarchical tree structure from wiki files.

    Returns list of tree items matching WikiPageTreeItem format.
    """
    pages = list_pages(code_path)
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
                "id": _deterministic_id(project_id, page.slug),
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


def page_to_response(code_path: str, project_id, page: WikiFileInfo) -> dict:
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
    )


def apply_semantic_links(code_path: str, project_id, add_links_fn) -> int:
    """Apply semantic hypertext linking to all wiki pages on disk.

    Args:
        code_path: Project root directory
        project_id: Project UUID
        add_links_fn: Function(content, terms_map, exclude_slug, max_links, valid_slugs) -> str

    Returns:
        Number of pages modified.
    """
    pages = list_pages(code_path)
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
                code_path=code_path,
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
            f"Semantic linking: {modified_count}/{len(pages)} pages updated"
        )

    return modified_count
