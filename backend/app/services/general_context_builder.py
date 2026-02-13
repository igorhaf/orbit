"""
PROMPT #235 - Dynamic Context Builder for General Operations

Lightweight context assembler that trims and optimizes messages
before sending to LLM. Works based on complexity tier from
general_query_classifier to minimize tokens without losing quality.

Optimizations:
1. Message history trimming (keep last N based on tier)
2. System prompt compression (remove duplicates, cap length)
3. Code block optimization (truncate large blocks for simple/moderate)
4. Token budget estimation
"""

import re
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# PROMPT #256 - Tier-based limits loaded from contract
# ---------------------------------------------------------------------------


def _load_context_limits():
    """PROMPT #256 - Load context limits from contract YAML."""
    try:
        from app.contracts import get_contract_loader
        data = get_contract_loader().load_data("execution/context_limits")

        return (
            data.get("message_limits", {}),
            data.get("system_prompt_limits", {}),
            data.get("code_block_limits", {}),
            data.get("code_truncate_head", 15),
            data.get("code_truncate_tail", 10),
        )
    except Exception as e:
        logger.warning(f"Failed to load context_limits contract, using inline fallback: {e}")
        return (
            {"simple": 2, "moderate": 6, "complex": 12},
            {"simple": 500, "moderate": 2000, "complex": 0},
            {"simple": 500, "moderate": 2000, "complex": 0},
            15,
            10,
        )


# Load once at module level (cached by ContractLoader)
MESSAGE_LIMITS, SYSTEM_PROMPT_LIMITS, CODE_BLOCK_LIMITS, CODE_TRUNCATE_HEAD, CODE_TRUNCATE_TAIL = _load_context_limits()

CODE_BLOCK_PATTERN = re.compile(r"(```\w*\n)([\s\S]*?)(```)")
DUPLICATE_LINE_PATTERN = re.compile(r"^(.+)$(?=.*^\1$)", re.MULTILINE)
BLANK_LINES_PATTERN = re.compile(r"\n{3,}")


def build_context(
    messages: List[Dict],
    system_prompt: Optional[str] = None,
    classification: Optional[Dict] = None,
) -> Dict:
    """
    Build optimized context for LLM call based on complexity tier.

    Args:
        messages: Original message list
        system_prompt: Original system prompt
        classification: Output from general_query_classifier (or None for defaults)

    Returns:
        {
            "messages": [...],              # trimmed messages
            "system_prompt": str|None,      # compressed system prompt
            "estimated_input_tokens": int,
            "recommended_max_tokens": int,
            "trimmed_messages_count": int,
            "compression_stats": {...},
        }
    """
    tier = "moderate"  # safe default
    if classification:
        tier = classification.get("recommended_tier", "moderate")
        # Map tier names to our keys
        tier_map = {"fast": "simple", "balanced": "moderate", "strong": "complex"}
        tier = tier_map.get(tier, tier)

    stats = {
        "tier": tier,
        "original_messages": len(messages),
        "original_system_chars": len(system_prompt) if system_prompt else 0,
        "code_blocks_truncated": 0,
    }

    # -----------------------------------------------------------------------
    # 1. Trim message history
    # -----------------------------------------------------------------------
    max_messages = MESSAGE_LIMITS.get(tier, 6)
    trimmed_messages = _trim_messages(messages, max_messages)
    stats["trimmed_messages"] = len(trimmed_messages)

    # -----------------------------------------------------------------------
    # 2. Compress system prompt
    # -----------------------------------------------------------------------
    compressed_system = _compress_system_prompt(system_prompt, tier)
    stats["compressed_system_chars"] = len(compressed_system) if compressed_system else 0

    # -----------------------------------------------------------------------
    # 3. Optimize code blocks in messages
    # -----------------------------------------------------------------------
    code_limit = CODE_BLOCK_LIMITS.get(tier, 0)
    if code_limit > 0:
        optimized_messages = []
        for msg in trimmed_messages:
            content = msg.get("content", "")
            new_content, truncated = _optimize_code_blocks(content, code_limit)
            stats["code_blocks_truncated"] += truncated
            optimized_messages.append({**msg, "content": new_content})
        trimmed_messages = optimized_messages

    # -----------------------------------------------------------------------
    # 4. Estimate token budget
    # -----------------------------------------------------------------------
    total_chars = sum(len(m.get("content", "")) for m in trimmed_messages)
    total_chars += len(compressed_system) if compressed_system else 0
    estimated_input_tokens = total_chars // 4  # ~4 chars per token

    # Recommended max_tokens based on tier
    recommended_max = {"simple": 200, "moderate": 500, "complex": 1200}.get(tier, 500)
    if classification:
        recommended_max = classification.get("recommended_max_tokens", recommended_max)

    stats["estimated_input_tokens"] = estimated_input_tokens

    logger.info(
        f"Context builder: {tier} tier, "
        f"{stats['original_messages']}→{stats['trimmed_messages']} msgs, "
        f"sys {stats['original_system_chars']}→{stats['compressed_system_chars']} chars, "
        f"~{estimated_input_tokens} input tokens"
    )

    return {
        "messages": trimmed_messages,
        "system_prompt": compressed_system,
        "estimated_input_tokens": estimated_input_tokens,
        "recommended_max_tokens": recommended_max,
        "trimmed_messages_count": len(messages) - len(trimmed_messages),
        "compression_stats": stats,
    }


def _trim_messages(messages: List[Dict], max_messages: int) -> List[Dict]:
    """Keep last N messages, always preserving the first user message."""
    if len(messages) <= max_messages:
        return list(messages)

    # Always keep first user message for context anchor
    first_user = None
    for msg in messages:
        if msg.get("role") == "user":
            first_user = msg
            break

    # Take last (max_messages - 1) messages + first user
    tail = messages[-(max_messages - 1):]

    if first_user and first_user not in tail:
        return [first_user] + tail
    return tail


def _compress_system_prompt(
    system_prompt: Optional[str], tier: str
) -> Optional[str]:
    """Compress system prompt based on tier limits."""
    if not system_prompt:
        return system_prompt

    result = system_prompt

    # Remove excessive blank lines
    result = BLANK_LINES_PATTERN.sub("\n\n", result)

    # Strip trailing whitespace per line
    result = "\n".join(line.rstrip() for line in result.split("\n"))

    # Cap at tier limit
    limit = SYSTEM_PROMPT_LIMITS.get(tier, 0)
    if limit > 0 and len(result) > limit:
        # Truncate keeping complete sentences
        truncated = result[:limit]
        # Find last sentence boundary
        for sep in ["\n\n", ".\n", ". ", "\n"]:
            last_sep = truncated.rfind(sep)
            if last_sep > limit * 0.7:
                truncated = truncated[:last_sep + len(sep)]
                break
        result = truncated.rstrip()

    return result


def _optimize_code_blocks(content: str, max_chars: int) -> Tuple[str, int]:
    """Truncate large code blocks, keeping head + tail lines."""
    truncated_count = 0

    def _truncate_block(match):
        nonlocal truncated_count
        prefix = match.group(1)   # ```lang\n
        code = match.group(2)
        suffix = match.group(3)   # ```

        if len(code) <= max_chars:
            return match.group(0)

        lines = code.split("\n")
        if len(lines) <= CODE_TRUNCATE_HEAD + CODE_TRUNCATE_TAIL + 1:
            return match.group(0)

        head = lines[:CODE_TRUNCATE_HEAD]
        tail = lines[-CODE_TRUNCATE_TAIL:]
        omitted = len(lines) - CODE_TRUNCATE_HEAD - CODE_TRUNCATE_TAIL
        truncated_count += 1

        new_code = (
            "\n".join(head)
            + f"\n\n... ({omitted} lines omitted) ...\n\n"
            + "\n".join(tail)
        )
        return prefix + new_code + suffix

    new_content = CODE_BLOCK_PATTERN.sub(_truncate_block, content)
    return new_content, truncated_count
