"""
Shared helper functions for draft generation.

Contains utility functions used by DraftStoriesMixin, DraftTasksMixin,
and DraftGeneratorMixin for building context text, deduplication, etc.
Extracted from draft_generator.py during modularization.
"""

from typing import List
from uuid import UUID
from sqlalchemy.orm import Session
import logging
import re

from app.models.project import Project
from app.models.task import Task

logger = logging.getLogger(__name__)


def _build_existing_children_text(db: Session, parent_id: UUID) -> str:
    """Build text listing existing children of a card for dedup context."""
    children = db.query(Task).filter(Task.parent_id == parent_id).order_by(Task.order).all()
    if not children:
        return ""
    lines = []
    for c in children:
        status = c.workflow_state or "unknown"
        desc_preview = (c.description or "")[:150].replace("\n", " ")
        lines.append(f"- [{status.upper()}] {c.title}: {desc_preview}")
    return "\n".join(lines)


def _build_full_hierarchy_text(db: Session, task: Task) -> str:
    """Build full hierarchy text from project root down to the current card."""
    parts = []
    # Walk up to collect ancestors
    ancestors = []
    current = task
    while current.parent_id:
        parent = db.query(Task).filter(Task.id == current.parent_id).first()
        if not parent:
            break
        ancestors.append(parent)
        current = parent

    ancestors.reverse()
    indent = 0
    for a in ancestors:
        prefix = "  " * indent
        parts.append(f"{prefix}- [{a.item_type.value.upper()}] {a.title}")
        indent += 1

    # Current card
    prefix = "  " * indent
    parts.append(f"{prefix}- [{task.item_type.value.upper()}] {task.title} (ATUAL)")

    return "\n".join(parts)


def _build_wiki_context_text(db: Session, project: Project, search_terms: str, max_pages: int = 3) -> str:
    """Find relevant wiki pages and return their content as context."""
    try:
        from app.services.wiki_fs import list_pages
        all_pages = list_pages(db, project.id)
    except Exception as e:
        logger.warning(f"Could not list wiki pages: {e}")
        return ""

    if not all_pages:
        return ""

    # Score pages by keyword overlap with search terms
    search_lower = search_terms.lower()
    search_words = set(w for w in search_lower.split() if len(w) > 3)

    scored = []
    for page in all_pages:
        title_lower = (page.title or page.slug).lower()
        content_lower = (page.content or "")[:2000].lower()
        score = 0
        for word in search_words:
            if word in title_lower:
                score += 3
            if word in content_lower:
                score += 1
        if score > 0:
            scored.append((score, page))

    scored.sort(key=lambda x: -x[0])
    top_pages = scored[:max_pages]

    if not top_pages:
        return ""

    parts = []
    for _, page in top_pages:
        title = page.title or page.slug
        content = (page.content or "")[:1500]
        parts.append(f"### Wiki: {title}\n{content}")

    return "\n\n".join(parts)


def _normalize_title(title: str) -> str:
    """Normalize a title for comparison: lowercase, strip, remove punctuation."""
    import unicodedata
    t = title.lower().strip()
    # Remove accents
    t = unicodedata.normalize('NFD', t)
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    # Remove punctuation and extra spaces
    t = re.sub(r'[^\w\s]', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def _title_similarity(a: str, b: str) -> float:
    """
    Compute similarity between two titles using max(Jaccard, containment).

    Jaccard alone misses cases like "Adapter Anthropic (Claude)" vs
    "Implementar Adapter Anthropic" (Jaccard=0.50 but clearly the same thing).
    Containment catches when most words of one title appear in the other.
    """
    na = _normalize_title(a)
    nb = _normalize_title(b)
    if na == nb:
        return 1.0
    words_a = set(w for w in na.split() if len(w) > 2)
    words_b = set(w for w in nb.split() if len(w) > 2)
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    jaccard = len(intersection) / len(union)
    # Containment: what fraction of the SMALLER set is covered?
    containment = len(intersection) / min(len(words_a), len(words_b))
    return max(jaccard, containment)


def _is_title_duplicate(
    new_title: str,
    parent_id: UUID,
    db: Session,
    batch_titles: List[str],
    threshold: float = 0.60,
) -> bool:
    """
    Check if a title is duplicate using LOCAL checks (no RAG dependency).

    Checks against:
    1. Existing sibling titles in the DB (direct query, always up-to-date)
    2. Titles already created in the current generation batch

    Args:
        new_title: The candidate title to check
        parent_id: Parent card ID (to query siblings)
        db: Database session
        batch_titles: List of titles already generated in this batch
        threshold: Word-overlap similarity threshold (0.70 = 70% word overlap)

    Returns:
        True if duplicate found, False otherwise
    """
    # Get existing sibling titles from DB (always current, no RAG lag)
    siblings = db.query(Task.title).filter(Task.parent_id == parent_id).all()
    existing_titles = [s[0] for s in siblings if s[0]]

    # Combine DB siblings + current batch titles
    all_titles = existing_titles + batch_titles

    for existing in all_titles:
        sim = _title_similarity(new_title, existing)
        if sim >= threshold:
            logger.info(
                f"Local dedup: '{new_title[:50]}' similar to '{existing[:50]}' "
                f"(similarity={sim:.2f}, threshold={threshold})"
            )
            return True

    return False
