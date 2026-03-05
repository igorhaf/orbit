# PROMPT #235 - General Operation Flow Refactor Plan

## Objective

Design an optimized generic orchestration flow acting as:
- **Universal fallback** for any usage_type without a specialized classifier
- **Safe execution pipeline** with built-in validation and escalation
- **Low-latency baseline** optimized for minimal overhead

Priority: minimal latency > maximum stability > acceptable quality baseline

---

## Current State Analysis

The `execute()` method in `ai_orchestrator.py` handles all AI calls. When a call comes in:

1. Chain lookup: specific usage_type chain → general chain → choose_model()
2. Utility pre-process: rate_limiter → cost_guard → cache → rag_context → prompt_transformer → router
3. Model execution with retry/fallback
4. Utility post-process: validator → cache_store

**Problems for "general" usage_type:**
- No query classification → always uses same model regardless of complexity
- No context trimming → messages sent as-is (potentially wasteful tokens)
- Validator is minimal (just JSON parse) → no quality checks for text responses
- Fallback is error-based only → waits for failure before trying next model
- No specialized classifiers exist: `interview_query_classifier.py` (interviews), `commit_diff_analyzer.py` (commits) — nothing for generic calls

---

## Implementation Plan

### Phase 1: General Query Classifier (`general_query_classifier.py`)

**File:** `backend/app/services/general_query_classifier.py` (NEW, ~180 lines)

Zero-latency heuristic classifier for ANY usage_type (universal fallback when no specialized classifier exists).

Detects:
- **Input characteristics**: message count, total char length, presence of code blocks, language (PT/EN)
- **Task type signals**: generation (create/generate/build), analysis (analyze/review/evaluate), factual (what/list/name), transformation (convert/format/translate)
- **Complexity scoring**: keyword density + message length + code presence + conversation depth

Output:
```python
{
    "complexity": "simple"|"moderate"|"complex",
    "estimated_tokens": int,      # 150/400/800
    "recommended_tier": "fast"|"balanced"|"strong",
    "task_type": "generation"|"analysis"|"factual"|"transformation"|"conversational",
    "has_code": bool,
    "input_token_estimate": int,  # estimated input size for budget
}
```

Follows exact pattern from `interview_query_classifier.py` and `commit_diff_analyzer.py`.

### Phase 2: Dynamic Context Builder (`general_context_builder.py`)

**File:** `backend/app/services/general_context_builder.py` (NEW, ~200 lines)

Lightweight context assembler that trims and optimizes messages before sending to LLM:

1. **Message history trimming**: Keep last N messages based on complexity tier
   - simple: last 2 messages (1 user + 1 assistant)
   - moderate: last 6 messages
   - complex: last 12 messages (full context)

2. **System prompt compression**:
   - Detect and remove duplicate instructions
   - Trim trailing whitespace/empty lines
   - Cap system prompt at tier-appropriate length (simple: 500 chars, moderate: 2000, complex: unlimited)

3. **Code block optimization**:
   - If input has code blocks > 3000 chars, extract first/last 20 lines + "... (N lines omitted)"
   - Preserve full code only for "complex" tier

4. **Token budget estimation**: Return estimated total tokens (input + expected output) so orchestrator can set appropriate max_tokens

Output:
```python
{
    "messages": [...],           # trimmed messages
    "system_prompt": str|None,   # compressed system prompt
    "estimated_input_tokens": int,
    "recommended_max_tokens": int,
    "trimmed_messages_count": int,
    "compression_stats": {...},
}
```

### Phase 3: Fast Response Validator (`general_response_validator.py`)

**File:** `backend/app/services/general_response_validator.py` (NEW, ~160 lines)

Zero-AI-call post-process validator that checks response quality:

1. **Emptiness check**: Response content is not empty/whitespace-only
2. **Truncation detection**: Response doesn't end mid-sentence or mid-code-block (unclosed ``` blocks)
3. **Error pattern detection**: Response doesn't contain common LLM error strings ("I cannot", "As an AI", API error patterns, rate limit messages leaked into content)
4. **Proportionality check**: Response length is proportional to query complexity (simple query → flag if response > 2000 chars, complex → flag if response < 50 chars)
5. **Language consistency**: Input language (PT/EN) matches output language (simple heuristic: check common words)

Output:
```python
{
    "is_valid": bool,
    "confidence": float,       # 0.0-1.0
    "issues": [...],           # list of detected issues
    "should_escalate": bool,   # True if response quality too low
    "escalation_reason": str|None,
}
```

### Phase 4: Escalation Router (wire into existing `_pre_router`)

**File:** `backend/app/services/utility_node_executor.py` (MODIFY)
**File:** `backend/app/services/general_response_validator.py` (ADD escalation logic)

Enhance existing router and validator to support quality-based escalation:

1. **Pre-process (router)**: Use `general_query_classifier` when no specialized classifier is in metadata. Set `_router_start_index` based on complexity (simple→0, moderate→0, complex→skip first model).

2. **Post-process (validator)**: After response, run `general_response_validator`. If `should_escalate=True`, set `retry_needed=True` with `escalation_reason` so the orchestrator retries with next model in chain.

This reuses the existing chain fallback mechanism — no new retry loop needed. The validator just flags bad responses the same way transient errors are flagged today.

### Phase 5: Wire Everything into AIOrchestrator

**File:** `backend/app/services/ai_orchestrator.py` (MODIFY, ~30 lines)

Connect the new services into the execute() flow:

1. **Before utility pre-process**: If `metadata` has no `query_classification` AND usage_type has no specialized classifier, run `general_query_classifier` on the messages and inject result into metadata.

2. **Context building**: If general classifier ran, also run `general_context_builder` to trim messages/system_prompt before chain execution.

3. **Post-process enhancement**: After model response, if no validator utility node exists in chain, run `general_response_validator` as default safety net. If validation fails with `should_escalate`, continue to next model in chain.

This is surgical — only adds ~30 lines to execute() with 3 conditional blocks.

---

## Files Summary

| File | Action | Lines (est.) | Description |
|------|--------|-------------|-------------|
| `backend/app/services/general_query_classifier.py` | CREATE | ~180 | Universal zero-latency query classifier |
| `backend/app/services/general_context_builder.py` | CREATE | ~200 | Dynamic context trimmer/compressor |
| `backend/app/services/general_response_validator.py` | CREATE | ~160 | Fast response quality validator |
| `backend/app/services/utility_node_executor.py` | MODIFY | ~20 | Wire general classifier into router |
| `backend/app/services/ai_orchestrator.py` | MODIFY | ~30 | Wire classifier + context builder + validator |
| `PROMPT_235_IMPLEMENTATION_REPORT.md` | CREATE | — | Implementation report |

## What We Are NOT Doing

- NOT adding new utility node types to the AI Flow diagram (these are internal pipeline services)
- NOT changing the execute() API contract (same input/output)
- NOT modifying existing specialized classifiers (interview, commit)
- NOT adding database migrations (all stateless services)
- NOT replacing PromptContextCompressor or PromptStructureNormalizer (those are for card hierarchy, this is for generic calls)
