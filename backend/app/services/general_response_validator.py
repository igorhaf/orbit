"""
PROMPT #235 - General Response Validator

Zero-AI-call post-process validator that checks response quality.
Used as default safety net when no specialized validator utility
node exists in the chain.

Checks:
1. Emptiness / truncation
2. Error pattern detection (leaked API errors, refusal strings)
3. Proportionality (response length vs query complexity)
4. Language consistency (PT/EN)
5. Code block integrity (unclosed blocks)
"""

import re
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# PROMPT #256 - Response validation rules loaded from contract
# ---------------------------------------------------------------------------


def _load_response_rules():
    """PROMPT #256 - Load response validation rules from contract YAML."""
    try:
        from app.contracts import get_contract_loader
        data = get_contract_loader().load_data("validation/response_rules")

        error_patterns = [
            re.compile(p, re.IGNORECASE) for p in data.get("error_patterns", [])
        ]
        refusal_patterns = [
            re.compile(p, re.IGNORECASE) for p in data.get("refusal_patterns", [])
        ]
        pt_markers = set(data.get("pt_markers", []))
        en_markers = set(data.get("en_markers", []))
        min_chars = data.get("min_response_chars", {})
        max_chars = data.get("max_response_chars", {})

        return error_patterns, refusal_patterns, pt_markers, en_markers, min_chars, max_chars
    except Exception as e:
        logger.warning(f"Failed to load response_rules contract, using inline fallback: {e}")
        return _fallback_response_rules()


def _fallback_response_rules():
    error_patterns = [
        re.compile(r"rate\s+limit\s+(?:exceeded|reached|error)", re.IGNORECASE),
        re.compile(r"(?:internal\s+)?server\s+error", re.IGNORECASE),
        re.compile(r"API\s+(?:key|token)\s+(?:invalid|expired|missing)", re.IGNORECASE),
        re.compile(r"quota\s+(?:exceeded|exhausted)", re.IGNORECASE),
        re.compile(r"(?:connection|timeout)\s+(?:error|refused|timed\s+out)", re.IGNORECASE),
        re.compile(r"HTTPError|HTTPException|status_code\s*[:=]\s*[45]\d\d", re.IGNORECASE),
    ]
    refusal_patterns = [
        re.compile(r"^I(?:'m| am) (?:sorry|unable|not able)", re.IGNORECASE),
        re.compile(r"^(?:Desculpe|Não posso|Não consigo|Infelizmente)", re.IGNORECASE),
        re.compile(r"I (?:cannot|can't|am unable to) (?:help|assist|provide|generate|create)", re.IGNORECASE),
    ]
    pt_markers = {
        "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
        "para", "por", "com", "sem", "sobre", "entre", "depois", "antes",
        "que", "uma", "um", "seu", "sua", "seus", "suas", "este", "esta",
        "esse", "essa", "isso", "isto", "aquilo",
    }
    en_markers = {
        "the", "is", "are", "was", "were", "have", "has", "had", "will",
        "would", "could", "should", "can", "may", "might", "this", "that",
        "these", "those", "with", "from", "into", "upon", "about",
        "between", "through", "during", "before", "after",
    }
    min_chars = {"simple": 10, "moderate": 30, "complex": 50}
    max_chars = {"simple": 2000, "moderate": 8000, "complex": 0}
    return error_patterns, refusal_patterns, pt_markers, en_markers, min_chars, max_chars


# Load once at module level (cached by ContractLoader)
ERROR_PATTERNS, REFUSAL_PATTERNS, PT_MARKERS, EN_MARKERS, MIN_RESPONSE_CHARS, MAX_RESPONSE_CHARS = _load_response_rules()


def validate_response(
    response_content: str,
    classification: Optional[Dict] = None,
    input_messages: Optional[List[Dict]] = None,
) -> Dict:
    """
    Validate AI response quality without using AI.

    Args:
        response_content: The AI response text
        classification: Output from general_query_classifier (optional)
        input_messages: Original input messages (for language check)

    Returns:
        {
            "is_valid": bool,
            "confidence": float,        # 0.0-1.0
            "issues": [...],
            "should_escalate": bool,
            "escalation_reason": str|None,
        }
    """
    issues = []
    confidence = 1.0

    complexity = "moderate"
    if classification:
        complexity = classification.get("complexity", "moderate")

    # -----------------------------------------------------------------------
    # 1. Emptiness check
    # -----------------------------------------------------------------------
    if not response_content or not response_content.strip():
        issues.append("empty_response")
        confidence = 0.0
        return _build_result(False, confidence, issues, True, "Empty response")

    content = response_content.strip()
    content_len = len(content)

    # -----------------------------------------------------------------------
    # 2. Error pattern detection
    # -----------------------------------------------------------------------
    for pattern in ERROR_PATTERNS:
        if pattern.search(content):
            issues.append("error_pattern_detected")
            confidence -= 0.4
            break

    # Refusal detection
    for pattern in REFUSAL_PATTERNS:
        if pattern.search(content[:200]):  # check only beginning
            issues.append("refusal_detected")
            confidence -= 0.3
            break

    # -----------------------------------------------------------------------
    # 3. Code block integrity
    # -----------------------------------------------------------------------
    open_blocks = content.count("```")
    if open_blocks % 2 != 0:
        issues.append("unclosed_code_block")
        confidence -= 0.15

    # -----------------------------------------------------------------------
    # 4. Truncation detection
    # -----------------------------------------------------------------------
    if _is_truncated(content):
        issues.append("possibly_truncated")
        confidence -= 0.2

    # -----------------------------------------------------------------------
    # 5. Proportionality check
    # -----------------------------------------------------------------------
    min_chars = MIN_RESPONSE_CHARS.get(complexity, 30)
    max_chars = MAX_RESPONSE_CHARS.get(complexity, 0)

    if content_len < min_chars:
        issues.append("response_too_short")
        confidence -= 0.25

    if max_chars > 0 and content_len > max_chars:
        # Over-verbose for simple query — not critical but noteworthy
        issues.append("response_disproportionately_long")
        confidence -= 0.05

    # -----------------------------------------------------------------------
    # 6. Language consistency
    # -----------------------------------------------------------------------
    if input_messages:
        input_lang = _detect_language(
            " ".join(m.get("content", "") for m in input_messages if m.get("role") == "user")
        )
        output_lang = _detect_language(content)
        if input_lang and output_lang and input_lang != output_lang:
            issues.append("language_mismatch")
            confidence -= 0.1

    # -----------------------------------------------------------------------
    # Build result
    # -----------------------------------------------------------------------
    confidence = max(0.0, min(1.0, confidence))
    is_valid = confidence >= 0.5
    should_escalate = confidence < 0.4
    escalation_reason = None

    if should_escalate:
        escalation_reason = f"Low confidence ({confidence:.2f}): {', '.join(issues)}"

    result = _build_result(is_valid, confidence, issues, should_escalate, escalation_reason)

    if issues:
        logger.info(
            f"Response validator: confidence={confidence:.2f}, "
            f"issues={issues}, escalate={should_escalate}"
        )

    return result


def _build_result(
    is_valid: bool,
    confidence: float,
    issues: List[str],
    should_escalate: bool,
    escalation_reason: Optional[str],
) -> Dict:
    return {
        "is_valid": is_valid,
        "confidence": confidence,
        "issues": issues,
        "should_escalate": should_escalate,
        "escalation_reason": escalation_reason,
    }


def _is_truncated(content: str) -> bool:
    """Heuristic: does the response end abruptly?"""
    stripped = content.rstrip()
    if not stripped:
        return False

    # Ends mid-word (no punctuation or newline at end)
    last_char = stripped[-1]
    if last_char.isalpha() and len(stripped) > 200:
        # Check if last line is suspiciously short (mid-sentence)
        last_line = stripped.split("\n")[-1].strip()
        if len(last_line) < 20 and not last_line.endswith((".", "!", "?", ":", ";", "```", ")")):
            return True

    # Unclosed JSON
    if stripped.count("{") > stripped.count("}"):
        return True
    if stripped.count("[") > stripped.count("]"):
        return True

    return False


def _detect_language(text: str) -> Optional[str]:
    """Simple language detection: PT vs EN."""
    if not text or len(text) < 20:
        return None

    words = set(text.lower().split()[:100])  # sample first 100 words

    pt_score = len(words & PT_MARKERS)
    en_score = len(words & EN_MARKERS)

    if pt_score > en_score and pt_score >= 3:
        return "pt"
    if en_score > pt_score and en_score >= 3:
        return "en"

    return None
