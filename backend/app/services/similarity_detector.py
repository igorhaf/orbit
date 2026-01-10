"""
Semantic Similarity Detector

PROMPT #94 FASE 4 - Sistema de Bloqueio por Modificação

This service detects when AI is suggesting a modification to an existing task
instead of creating a new task, using semantic similarity via RAG embeddings.

When similarity >= 90%, it indicates the AI is trying to modify/improve an
existing task, and the system should:
1. Block the existing task (status = BLOCKED)
2. Store the proposed modification in pending_modification field
3. Require user approval/rejection via UI

Features:
- Calculate semantic similarity between task descriptions
- Detect modification attempts (>90% similarity threshold)
- Return best matching task for blocking

Usage:
    from app.services.similarity_detector import detect_modification_attempt

    is_modification, existing_task, score = detect_modification_attempt(
        new_task_title="Create user authentication",
        new_task_description="Add JWT authentication with refresh tokens",
        existing_tasks=project_tasks,
        threshold=0.90
    )

    if is_modification:
        # Block existing_task and save proposed modification
        existing_task.status = TaskStatus.BLOCKED
        existing_task.blocked_reason = "Modification suggested by AI"
        existing_task.pending_modification = {
            "title": new_task_title,
            "description": new_task_description,
            "similarity_score": score
        }
"""

import logging
from typing import List, Optional, Tuple

import numpy as np

from app.models.task import Task
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


def calculate_semantic_similarity(text1: str, text2: str) -> float:
    """
    Calculate semantic similarity between two texts using RAG embeddings.

    Uses sentence-transformers (all-MiniLM-L6-v2) via RAGService singleton.
    Returns cosine similarity score between 0.0 and 1.0.

    Args:
        text1: First text to compare
        text2: Second text to compare

    Returns:
        float: Similarity score (0.0 = completely different, 1.0 = identical)

    Example:
        >>> similarity = calculate_semantic_similarity(
        ...     "Create user authentication",
        ...     "Add user login feature"
        ... )
        >>> print(f"Similarity: {similarity:.2%}")
        Similarity: 78.5%
    """
    # Ensure embedder is loaded (singleton pattern)
    RAGService._ensure_embedder_loaded()
    embedder = RAGService._embedder

    # Generate embeddings for both texts
    emb1 = embedder.encode(text1, convert_to_numpy=True)
    emb2 = embedder.encode(text2, convert_to_numpy=True)

    # Calculate cosine similarity
    # Formula: cos(θ) = (A · B) / (||A|| × ||B||)
    # Result: 1.0 = same direction (identical), 0.0 = orthogonal (unrelated)
    similarity = np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2))

    return float(similarity)


def detect_modification_attempt(
    new_task_title: str,
    new_task_description: Optional[str],
    existing_tasks: List[Task],
    threshold: float = 0.90
) -> Tuple[bool, Optional[Task], float]:
    """
    Detect if new task is actually a modification of an existing task.

    Compares new task against all existing tasks in the project using
    semantic similarity. If similarity >= threshold (default 90%), it means
    the AI is suggesting a modification rather than a new task.

    Args:
        new_task_title: Title of the new task being created
        new_task_description: Description of the new task (optional)
        existing_tasks: List of existing tasks in the project
        threshold: Similarity threshold for modification detection (default: 0.90)

    Returns:
        Tuple of (is_modification, existing_task, similarity_score):
            - is_modification: True if similarity >= threshold
            - existing_task: The most similar existing task (or None)
            - similarity_score: Highest similarity found (0.0-1.0)

    Example:
        >>> is_mod, task, score = detect_modification_attempt(
        ...     "Add JWT authentication",
        ...     "Implement JWT tokens with refresh mechanism",
        ...     project.tasks,
        ...     threshold=0.90
        ... )
        >>> if is_mod:
        ...     print(f"Modification detected! Similar to: {task.title}")
        ...     print(f"Similarity: {score:.2%}")

    PROMPT #94 FASE 4 - Blocking System Logic:

    1. AI suggests new task during interview
    2. Before creating, check similarity against existing tasks
    3. If similarity >= 90%:
       - Block the existing task (status = BLOCKED)
       - Save proposed modification in pending_modification field
       - Do NOT create the new task yet
       - User must approve/reject via UI
    4. If similarity < 90%:
       - Create new task normally (no blocking)
    """
    if not existing_tasks:
        logger.debug("No existing tasks to compare - creating new task")
        return (False, None, 0.0)

    # Combine title + description for better accuracy
    # Using both provides more context than title alone
    new_text = f"{new_task_title}\n{new_task_description or ''}"

    best_match: Optional[Task] = None
    best_similarity = 0.0

    logger.debug(
        f"Checking similarity for new task '{new_task_title}' "
        f"against {len(existing_tasks)} existing tasks"
    )

    # Compare against all existing tasks
    for task in existing_tasks:
        # Skip tasks that are already blocked (no need to check again)
        if task.status.value == "blocked":
            continue

        # Combine title + description for existing task
        existing_text = f"{task.title}\n{task.description or ''}"

        # Calculate semantic similarity
        similarity = calculate_semantic_similarity(new_text, existing_text)

        logger.debug(
            f"  - Similarity with '{task.title[:50]}...': {similarity:.2%}"
        )

        # Track best match
        if similarity > best_similarity:
            best_similarity = similarity
            best_match = task

    # Determine if this is a modification attempt
    is_modification = best_similarity >= threshold

    if is_modification:
        logger.warning(
            f"🚨 MODIFICATION DETECTED (similarity: {best_similarity:.2%} >= {threshold:.2%})\n"
            f"   New task: '{new_task_title}'\n"
            f"   Existing task: '{best_match.title}'\n"
            f"   Action: Block existing task and await user approval"
        )
    else:
        logger.info(
            f"✅ New task detected (best similarity: {best_similarity:.2%} < {threshold:.2%})\n"
            f"   Creating new task: '{new_task_title}'"
        )

    return (is_modification, best_match if is_modification else None, best_similarity)


def get_similar_tasks(
    task: Task,
    all_tasks: List[Task],
    threshold: float = 0.70,
    limit: int = 5
) -> List[Tuple[Task, float]]:
    """
    Find similar tasks to a given task (useful for UI suggestions).

    Args:
        task: The task to find similar tasks for
        all_tasks: List of all tasks to search in
        threshold: Minimum similarity score (default: 0.70)
        limit: Maximum number of similar tasks to return

    Returns:
        List of (task, similarity_score) tuples, sorted by similarity

    Example:
        >>> similar = get_similar_tasks(
        ...     task=current_task,
        ...     all_tasks=project.tasks,
        ...     threshold=0.70,
        ...     limit=5
        ... )
        >>> for similar_task, score in similar:
        ...     print(f"{similar_task.title} - {score:.2%}")
    """
    task_text = f"{task.title}\n{task.description or ''}"

    similar_tasks: List[Tuple[Task, float]] = []

    for other_task in all_tasks:
        # Skip self
        if other_task.id == task.id:
            continue

        other_text = f"{other_task.title}\n{other_task.description or ''}"
        similarity = calculate_semantic_similarity(task_text, other_text)

        if similarity >= threshold:
            similar_tasks.append((other_task, similarity))

    # Sort by similarity (highest first)
    similar_tasks.sort(key=lambda x: x[1], reverse=True)

    # Limit results
    return similar_tasks[:limit]
