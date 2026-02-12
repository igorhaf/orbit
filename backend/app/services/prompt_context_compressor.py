"""
Prompt Context Compressor - PROMPT #232

Pre-processing service that deduplicates and compresses context before
prompt assembly for card hierarchy generation (Epic → Story → Task → Subtask).

Eliminates token explosion caused by:
- Full parent generated_prompt re-injection (NO TRUNCATION pattern)
- Business rules re-fetched at every hierarchy level
- Semantic map duplication across parent/child levels
- Uncompressed interview conversations (20-50 turns)

Estimated savings: 40-60% token reduction on a full hierarchy chain.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@dataclass
class CompressedContext:
    """Result of context compression, ready for prompt assembly."""
    parent_context: str = ""
    semantic_map_text: str = ""
    business_rules: str = ""
    conversation_summary: str = ""
    estimated_tokens: int = 0
    compression_stats: Dict = field(default_factory=dict)


class PromptContextCompressor:
    """
    Stateless pre-processing service that deduplicates and compresses
    context before prompt assembly. No database migrations required.
    """

    def __init__(self, db: Session):
        self.db = db

    def compress_hierarchy_context(
        self,
        item_type: str,
        item_title: str,
        project,
        parent_card=None,
        grandparent_card=None,
        conversation: Optional[List[Dict]] = None,
        max_context_tokens: int = 8000,
    ) -> CompressedContext:
        """
        Main entry point. Returns a CompressedContext with all sections
        deduped and sized to fit within max_context_tokens.
        """
        ctx = CompressedContext()
        stats = {"item_type": item_type, "before_tokens": 0, "after_tokens": 0}

        # 1. Parent context (summarized, not full)
        ctx.parent_context = self._summarize_parent_context(
            item_type, parent_card, grandparent_card
        )

        # 2. Semantic map (deduped across hierarchy)
        ctx.semantic_map_text = self._deduplicate_semantic_maps(
            item_type, parent_card, grandparent_card
        )

        # 3. Business rules (level-appropriate)
        ctx.business_rules = self._get_business_rules_for_level(
            item_type, project.id, item_title
        )

        # 4. Conversation (compressed, Epic only)
        if conversation and item_type == "epic":
            ctx.conversation_summary = self._compress_conversation(
                conversation, max_turns=10, relevance_query=item_title
            )

        # 5. Enforce token budget
        sections = {
            "conversation_summary": ctx.conversation_summary,
            "business_rules": ctx.business_rules,
            "parent_context": ctx.parent_context,
            "semantic_map_text": ctx.semantic_map_text,
        }
        before_tokens = sum(self._estimate_tokens(v) for v in sections.values())
        stats["before_tokens"] = before_tokens

        if before_tokens > max_context_tokens:
            sections = self._enforce_token_budget(sections, max_context_tokens)
            ctx.conversation_summary = sections["conversation_summary"]
            ctx.business_rules = sections["business_rules"]
            ctx.parent_context = sections["parent_context"]
            ctx.semantic_map_text = sections["semantic_map_text"]

        after_tokens = sum(
            self._estimate_tokens(getattr(ctx, k))
            for k in ["parent_context", "semantic_map_text", "business_rules", "conversation_summary"]
        )
        stats["after_tokens"] = after_tokens
        stats["reduction_pct"] = round((1 - after_tokens / max(before_tokens, 1)) * 100, 1)

        ctx.estimated_tokens = after_tokens
        ctx.compression_stats = stats

        logger.info(
            f"📊 Compressed [{item_type}]: {before_tokens} → {after_tokens} tokens "
            f"({stats['reduction_pct']}% reduction, budget {max_context_tokens})"
        )

        return ctx

    # ------------------------------------------------------------------
    # Parent context summarization
    # ------------------------------------------------------------------

    def _summarize_parent_context(
        self,
        item_type: str,
        parent_card,
        grandparent_card,
        max_chars: int = 3000,
    ) -> str:
        """
        Instead of injecting FULL generated_prompt (NO TRUNCATION pattern),
        include only key fields: title + acceptance_criteria + truncated prompt.
        """
        if item_type == "epic" or parent_card is None:
            return ""

        parts = []

        if item_type == "story":
            # Parent is Epic: title + AC + first 1500 chars of generated_prompt
            parts.append(self._card_summary(parent_card, max_prompt_chars=1500, label="Epic Pai"))

        elif item_type == "task":
            # Parent is Story: title + AC + 1000 chars
            parts.append(self._card_summary(parent_card, max_prompt_chars=1000, label="Story Pai"))
            # Grandparent is Epic: title + AC only (no prompt text)
            if grandparent_card:
                parts.append(self._card_summary(grandparent_card, max_prompt_chars=0, label="Epic Avo"))

        elif item_type == "subtask":
            # Parent is Task: title + AC only
            parts.append(self._card_summary(parent_card, max_prompt_chars=500, label="Task Pai"))
            # No grandparent context for subtasks (too deep)

        result = "\n\n".join(parts)
        return result[:max_chars]

    @staticmethod
    def _card_summary(card, max_prompt_chars: int = 1500, label: str = "Pai") -> str:
        """Build a compact summary of a card for context injection."""
        lines = [f"## {label}: {card.title}"]

        # Acceptance criteria (compact)
        ac = card.acceptance_criteria or []
        if ac:
            ac_text = "; ".join(
                (item.get("text", str(item)) if isinstance(item, dict) else str(item))
                for item in ac[:5]
            )
            lines.append(f"**AC:** {ac_text}")

        # Truncated generated_prompt
        if max_prompt_chars > 0 and card.generated_prompt:
            prompt_text = card.generated_prompt[:max_prompt_chars]
            if len(card.generated_prompt) > max_prompt_chars:
                prompt_text += "..."
            lines.append(f"**Spec:**\n{prompt_text}")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Semantic map deduplication
    # ------------------------------------------------------------------

    def _deduplicate_semantic_maps(
        self,
        item_type: str,
        parent_card,
        grandparent_card,
    ) -> str:
        """
        Story level: full parent (Epic) semantic map.
        Task level: only Story's NEW identifiers (delta from Epic).
        Subtask level: only Task's NEW identifiers.
        """
        if item_type == "epic" or parent_card is None:
            return ""

        parent_map = self._extract_semantic_map(parent_card)

        if item_type == "story":
            # First child level: include full parent map
            if parent_map:
                return (
                    "## MAPA SEMANTICO DO EPIC (REUTILIZE E ESTENDA):\n"
                    + json.dumps(parent_map, indent=2, ensure_ascii=False)
                )
            return ""

        # Task or Subtask: compute delta
        grandparent_map = self._extract_semantic_map(grandparent_card) if grandparent_card else {}

        if parent_map and grandparent_map:
            delta_keys = set(parent_map.keys()) - set(grandparent_map.keys())
            delta_map = {k: parent_map[k] for k in delta_keys}
            inherited_keys = sorted(set(parent_map.keys()) & set(grandparent_map.keys()))

            parts = []
            if inherited_keys:
                parts.append(
                    f"**Identificadores herdados do Epic (ja definidos):** {', '.join(inherited_keys)}"
                )
            if delta_map:
                parts.append(
                    "## NOVOS IDENTIFICADORES DA STORY:\n"
                    + json.dumps(delta_map, indent=2, ensure_ascii=False)
                )
            return "\n\n".join(parts)

        elif parent_map:
            return (
                "## MAPA SEMANTICO:\n"
                + json.dumps(parent_map, indent=2, ensure_ascii=False)
            )

        return ""

    @staticmethod
    def _extract_semantic_map(card) -> Dict:
        """Extract semantic map from a card's interview_insights."""
        if card is None:
            return {}
        insights = card.interview_insights or {}
        return insights.get("semantic_map", {})

    # ------------------------------------------------------------------
    # Business rules (level-appropriate)
    # ------------------------------------------------------------------

    def _get_business_rules_for_level(
        self,
        item_type: str,
        project_id: UUID,
        item_title: str,
        max_rules: int = 15,
    ) -> str:
        """
        Epic: full rules. Story: filtered top-5. Task/Subtask: reference only.
        """
        if item_type in ("task", "subtask"):
            return "[Regras de negocio foram fornecidas no nivel do Epic. Consulte o contexto pai.]"

        try:
            from app.services.rag_service import RAGService
            rag_service = RAGService(self.db)

            if item_type == "epic":
                rules = rag_service.get_business_rules(project_id=project_id, top_k=max_rules)
                if rules:
                    return rag_service.format_business_rules_for_prompt(rules, max_chars=4000)
                return ""

            elif item_type == "story":
                # Filtered: get more rules then score by relevance to title
                rules = rag_service.get_business_rules(project_id=project_id, top_k=20)
                if not rules:
                    return ""

                title_words = set(item_title.lower().split())
                scored = []
                for rule in rules:
                    content = rule.get("content", "").lower()
                    content_words = set(content.split())
                    overlap = len(title_words & content_words)
                    scored.append((overlap, rule))

                scored.sort(key=lambda x: x[0], reverse=True)
                top_rules = [r for _, r in scored[:5]]
                return rag_service.format_business_rules_for_prompt(top_rules, max_chars=2000)

        except Exception as e:
            logger.warning(f"Failed to get business rules for {item_type}: {e}")
            return ""

        return ""

    # ------------------------------------------------------------------
    # Conversation compression
    # ------------------------------------------------------------------

    def _compress_conversation(
        self,
        conversation: List[Dict],
        max_turns: int = 10,
        relevance_query: Optional[str] = None,
    ) -> str:
        """
        Keep only top-N most relevant turns from interview conversation.
        Score by keyword overlap, message length, and recency.
        """
        if not conversation:
            return ""

        total_turns = len(conversation)
        if total_turns <= max_turns * 2:
            # Conversation is short enough, format as-is
            return self._format_conversation_turns(conversation)

        # Score each message pair (user question + assistant answer)
        query_words = set((relevance_query or "").lower().split())
        scored_pairs = []

        for i in range(0, total_turns - 1, 2):
            user_msg = conversation[i] if i < total_turns else {}
            asst_msg = conversation[i + 1] if i + 1 < total_turns else {}

            user_text = user_msg.get("content", "")
            asst_text = asst_msg.get("content", "")
            combined = (user_text + " " + asst_text).lower()
            combined_words = set(combined.split())

            # Keyword overlap with query (0.4 weight)
            keyword_score = 0.0
            if query_words:
                keyword_score = len(query_words & combined_words) / max(len(query_words), 1)

            # Message length (longer = more informative, 0.3 weight)
            length_score = min(len(combined) / 1000.0, 1.0)

            # Position recency (later = more refined, 0.3 weight)
            position_score = (i / max(total_turns - 1, 1))

            total_score = keyword_score * 0.4 + length_score * 0.3 + position_score * 0.3
            scored_pairs.append((total_score, i, user_msg, asst_msg))

        # Sort by score and keep top-N
        scored_pairs.sort(key=lambda x: x[0], reverse=True)
        top_pairs = scored_pairs[:max_turns]
        # Re-sort by original position for coherent reading
        top_pairs.sort(key=lambda x: x[1])

        # Format
        turns = []
        for _, _, user_msg, asst_msg in top_pairs:
            if user_msg:
                turns.append(user_msg)
            if asst_msg:
                turns.append(asst_msg)

        header = f"Entrevista com {total_turns // 2} turnos. Top {len(top_pairs)} turnos relevantes:\n\n"
        return header + self._format_conversation_turns(turns)

    @staticmethod
    def _format_conversation_turns(turns: List[Dict]) -> str:
        """Format conversation turns into readable text."""
        lines = []
        for msg in turns:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            prefix = "Entrevistador" if role == "assistant" else "Usuario"
            lines.append(f"**{prefix}:** {content}")
        return "\n\n".join(lines)

    # ------------------------------------------------------------------
    # Token budget enforcement
    # ------------------------------------------------------------------

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        """Rough token estimate: chars / 3.5 (Portuguese text averages ~3.5 chars/token)."""
        if not text:
            return 0
        return max(1, len(text) // 3)

    @staticmethod
    def _enforce_token_budget(sections: Dict[str, str], max_tokens: int) -> Dict[str, str]:
        """
        Truncate sections in priority order (lowest priority first):
        1. conversation_summary (lowest)
        2. business_rules
        3. parent_context
        4. semantic_map_text (highest - never truncated)
        """
        priority_order = ["conversation_summary", "business_rules", "parent_context", "semantic_map_text"]

        def total():
            return sum(max(1, len(v) // 3) if v else 0 for v in sections.values())

        for key in priority_order:
            if total() <= max_tokens:
                break
            current = sections.get(key, "")
            if not current:
                continue
            # Calculate how many chars we can afford
            excess_tokens = total() - max_tokens
            excess_chars = excess_tokens * 3
            new_len = max(0, len(current) - excess_chars)
            if new_len == 0:
                sections[key] = ""
            else:
                sections[key] = current[:new_len] + "..."

        return sections
