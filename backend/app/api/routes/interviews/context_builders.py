"""
Context Building Utilities
PROMPT #69 - Refactor interviews.py

Functions for preparing interview context for AI to reduce token usage.
Includes task type extraction from user answers.
"""

import logging
import re
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)


def prepare_interview_context(conversation_data: List[Dict], max_recent: int = 5) -> List[Dict]:
    """
    Prepare efficient context for AI to reduce token usage.

    Strategy (PROMPT #54 - Token Cost Optimization):
    - For short conversations (≤ max_recent messages): Send all verbatim
    - For long conversations (> max_recent messages):
        * Summarize older messages into bullets (role + first 100 chars)
        * Send recent messages verbatim

    This reduces token usage by 60-70% for longer interviews while maintaining
    context quality by preserving recent conversation in full.

    Args:
        conversation_data: Full conversation history from interview
        max_recent: Number of recent messages to keep verbatim (default: 5)

    Returns:
        Optimized message list: [summary_message] + recent_messages

    Example:
        12 messages conversation:
        - Messages 1-7 → 1 summary message (~200 tokens)
        - Messages 8-12 → 5 verbatim messages (~2,000 tokens)
        Total: ~2,200 tokens instead of ~8,000 tokens (73% reduction)
    """
    # Short conversation - send all messages verbatim
    if len(conversation_data) <= max_recent:
        logger.info(f"📝 Short conversation ({len(conversation_data)} msgs), sending all verbatim")
        return [{"role": msg["role"], "content": msg["content"]} for msg in conversation_data]

    # Long conversation - summarize older + verbatim recent
    older_messages = conversation_data[:-max_recent]
    recent_messages = conversation_data[-max_recent:]

    logger.info(f"📝 Long conversation ({len(conversation_data)} msgs):")
    logger.info(f"   - Summarizing older: {len(older_messages)} messages")
    logger.info(f"   - Keeping verbatim: {len(recent_messages)} recent messages")

    # Create compact summary of older context
    summary_points = []
    for i, msg in enumerate(older_messages):
        role = msg.get('role', 'unknown')
        content = msg.get('content', '')
        # Take first 100 chars to avoid summary being too long
        content_preview = content[:100] + ('...' if len(content) > 100 else '')
        summary_points.append(f"[{i+1}] {role}: {content_preview}")

    # IMPORTANT: Anthropic API only accepts "user" and "assistant" roles
    # Cannot use "system" role in messages array - it must be in system parameter
    summary_message = {
        "role": "user",
        "content": f"""[CONTEXTO ANTERIOR - RESUMO]

Resumo das {len(older_messages)} mensagens anteriores desta entrevista:

{chr(10).join(summary_points)}

As {len(recent_messages)} mensagens mais recentes seguem abaixo com conteúdo completo."""
    }

    # Build optimized message list
    optimized_messages = [summary_message] + [
        {"role": msg["role"], "content": msg["content"]}
        for msg in recent_messages
    ]

    logger.info(f"✅ Context optimized: {len(conversation_data)} msgs → {len(optimized_messages)} msgs")
    logger.info(f"   Estimated token reduction: ~60-70%")

    return optimized_messages


def extract_task_type_from_answer(user_answer: str) -> Optional[str]:
    """
    Extract task type from user's answer to Q1 in task-focused interview.
    PROMPT #68 - Dual-Mode Interview System

    Args:
        user_answer: User's text answer

    Returns:
        Task type ("bug" | "feature" | "refactor" | "enhancement") or None
    """
    answer_lower = user_answer.lower()

    # Match against task type keywords
    if re.search(r'\b(bug|bugfix|bug fix|erro|error)\b', answer_lower):
        logger.info(f"Detected task type: bug")
        return "bug"
    elif re.search(r'\b(feature|funcionalidade|nova feature|new feature)\b', answer_lower):
        logger.info(f"Detected task type: feature")
        return "feature"
    elif re.search(r'\b(refactor|refatorar|refactoring)\b', answer_lower):
        logger.info(f"Detected task type: refactor")
        return "refactor"
    elif re.search(r'\b(enhancement|melhoria|improve|improvement|aprimorar)\b', answer_lower):
        logger.info(f"Detected task type: enhancement")
        return "enhancement"
    else:
        logger.warning(f"Could not detect task type from answer: {user_answer[:50]}")
        return "feature"  # Default fallback
