"""
PROMPT #235 - General Query Classifier

Zero-latency heuristic classifier for ANY usage_type.
Acts as universal fallback when no specialized classifier exists
(interview_query_classifier.py handles interviews,
 commit_diff_analyzer.py handles commits).

Classifies query complexity, estimates tokens, detects task type,
and recommends model tier — all without AI calls.
"""

import re
import logging
from typing import Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Task-type keyword sets
# ---------------------------------------------------------------------------

GENERATION_KEYWORDS: Set[str] = {
    "create", "generate", "build", "write", "implement", "design", "compose",
    "draft", "produce", "construct", "develop", "make", "add", "new",
    "crie", "gere", "construa", "escreva", "implemente", "desenvolva",
    "adicione", "novo", "nova", "criar", "gerar",
}

ANALYSIS_KEYWORDS: Set[str] = {
    "analyze", "review", "evaluate", "assess", "examine", "inspect",
    "investigate", "diagnose", "audit", "compare", "benchmark",
    "analise", "avalie", "examine", "revise", "investigue", "compare",
    "diagnostique", "inspecione",
}

FACTUAL_KEYWORDS: Set[str] = {
    "what", "which", "who", "where", "when", "list", "name", "define",
    "describe", "show", "tell", "explain",
    "qual", "quais", "quem", "onde", "quando", "liste", "nomeie",
    "defina", "descreva", "mostre", "explique",
}

TRANSFORMATION_KEYWORDS: Set[str] = {
    "convert", "transform", "translate", "format", "refactor", "migrate",
    "rename", "restructure", "normalize", "extract", "parse", "map",
    "converta", "transforme", "traduza", "formate", "refatore", "migre",
    "renomeie", "reestruture", "normalize", "extraia",
}

# ---------------------------------------------------------------------------
# Complexity signal patterns
# ---------------------------------------------------------------------------

CODE_BLOCK_PATTERN = re.compile(r"```[\s\S]*?```")
INLINE_CODE_PATTERN = re.compile(r"`[^`]+`")
URL_PATTERN = re.compile(r"https?://\S+")
LIST_PATTERN = re.compile(r"^\s*[-*\d]+[.)]\s", re.MULTILINE)

REASONING_PATTERNS = [
    re.compile(r"\b(?:why|por\s?que|como|how\s+would|explain|compare|trade.?off|pros?\s+(?:and|e)\s+cons?)\b", re.IGNORECASE),
    re.compile(r"\b(?:what\s+(?:are|is)\s+the\s+(?:best|ideal|recommended|optimal))\b", re.IGNORECASE),
    re.compile(r"\b(?:qual\s+(?:a\s+melhor|o\s+melhor|seria))\b", re.IGNORECASE),
    re.compile(r"\b(?:descreva|detalhe|explique|justifique|analise)\b", re.IGNORECASE),
    re.compile(r"\b(?:describe|detail|justify|analyze|evaluate|assess)\b", re.IGNORECASE),
]

MULTI_STEP_PATTERNS = [
    re.compile(r"\b(?:step\s+by\s+step|passo\s+a\s+passo)\b", re.IGNORECASE),
    re.compile(r"\b(?:first|then|next|finally|depois|primeiro|segundo|terceiro)\b", re.IGNORECASE),
    re.compile(r"\b(?:multiple|several|various|diversos|varios|multiplos)\b", re.IGNORECASE),
]

# Token estimates per complexity level
TOKEN_ESTIMATES = {
    "simple": 150,
    "moderate": 400,
    "complex": 800,
}

# Tier mapping
TIER_MAP = {
    "simple": "fast",
    "moderate": "balanced",
    "complex": "strong",
}

# Max tokens per tier
MAX_TOKENS_MAP = {
    "simple": 200,
    "moderate": 500,
    "complex": 1200,
}


def classify_general_query(
    messages: List[Dict],
    system_prompt: Optional[str] = None,
) -> Dict:
    """
    Classify a general query by complexity without using AI.

    Args:
        messages: List of message dicts with "role" and "content"
        system_prompt: Optional system prompt (adds to complexity)

    Returns:
        {
            "complexity": "simple"|"moderate"|"complex",
            "estimated_tokens": int,
            "recommended_tier": "fast"|"balanced"|"strong",
            "recommended_max_tokens": int,
            "task_type": str,
            "has_code": bool,
            "input_token_estimate": int,
            "needs_reasoning": bool,
            "message_count": int,
        }
    """
    # Extract text from messages
    all_text = ""
    user_text = ""
    message_count = len(messages)

    for msg in messages:
        content = msg.get("content", "")
        all_text += content + "\n"
        if msg.get("role") == "user":
            user_text += content + "\n"

    # Last user message is primary for classification
    last_user_msg = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            last_user_msg = msg.get("content", "")
            break

    total_chars = len(all_text)
    last_msg_chars = len(last_user_msg)
    words = last_user_msg.lower().split()
    word_set = set(words)

    # -----------------------------------------------------------------------
    # 1. Detect task type
    # -----------------------------------------------------------------------
    task_type = _detect_task_type(word_set, last_user_msg)

    # -----------------------------------------------------------------------
    # 2. Detect code presence
    # -----------------------------------------------------------------------
    code_blocks = CODE_BLOCK_PATTERN.findall(all_text)
    inline_codes = INLINE_CODE_PATTERN.findall(all_text)
    has_code = len(code_blocks) > 0 or len(inline_codes) > 3

    # -----------------------------------------------------------------------
    # 3. Complexity scoring
    # -----------------------------------------------------------------------
    score = 0.0

    # Message length contribution (0-30 points)
    if total_chars < 200:
        score += 5
    elif total_chars < 800:
        score += 15
    elif total_chars < 3000:
        score += 25
    else:
        score += 30

    # Conversation depth (0-15 points)
    if message_count <= 2:
        score += 0
    elif message_count <= 6:
        score += 8
    else:
        score += 15

    # Code presence (0-15 points)
    if code_blocks:
        total_code_chars = sum(len(b) for b in code_blocks)
        if total_code_chars > 3000:
            score += 15
        elif total_code_chars > 500:
            score += 10
        else:
            score += 5

    # Reasoning patterns (0-20 points)
    needs_reasoning = False
    reasoning_hits = sum(1 for p in REASONING_PATTERNS if p.search(last_user_msg))
    if reasoning_hits > 0:
        needs_reasoning = True
        score += min(reasoning_hits * 7, 20)

    # Multi-step indicators (0-10 points)
    multi_step_hits = sum(1 for p in MULTI_STEP_PATTERNS if p.search(last_user_msg))
    score += min(multi_step_hits * 5, 10)

    # Task type contribution (0-10 points)
    if task_type == "generation":
        score += 10
    elif task_type == "analysis":
        score += 8
    elif task_type == "transformation":
        score += 5
    elif task_type == "factual":
        score += 2

    # System prompt length (0-5 points) - longer system = more complex task
    if system_prompt:
        sp_len = len(system_prompt)
        if sp_len > 2000:
            score += 5
        elif sp_len > 500:
            score += 3

    # -----------------------------------------------------------------------
    # 4. Map score to complexity
    # -----------------------------------------------------------------------
    if score < 25:
        complexity = "simple"
    elif score < 50:
        complexity = "moderate"
    else:
        complexity = "complex"

    # Estimate input tokens (~4 chars per token)
    input_token_estimate = (total_chars + len(system_prompt or "")) // 4

    result = {
        "complexity": complexity,
        "estimated_tokens": TOKEN_ESTIMATES[complexity],
        "recommended_tier": TIER_MAP[complexity],
        "recommended_max_tokens": MAX_TOKENS_MAP[complexity],
        "task_type": task_type,
        "has_code": has_code,
        "input_token_estimate": input_token_estimate,
        "needs_reasoning": needs_reasoning,
        "message_count": message_count,
    }

    logger.info(
        f"General classifier: {complexity} (score={score:.0f}, "
        f"type={task_type}, msgs={message_count}, "
        f"tier={TIER_MAP[complexity]})"
    )

    return result


def _detect_task_type(word_set: Set[str], text: str) -> str:
    """Detect the primary task type from keywords."""
    scores = {
        "generation": len(word_set & GENERATION_KEYWORDS),
        "analysis": len(word_set & ANALYSIS_KEYWORDS),
        "factual": len(word_set & FACTUAL_KEYWORDS),
        "transformation": len(word_set & TRANSFORMATION_KEYWORDS),
    }

    best_type = max(scores, key=scores.get)
    if scores[best_type] == 0:
        return "conversational"

    return best_type
