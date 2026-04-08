# PROMPT #259 - Fix Opus Empty Response in RAG Pipeline
## Disable Agent Mode Tools for Pure Text Generation

**Date:** February 22, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Unblocks Phase 3 and Phase 4 of RAG pipeline — Opus now returns text instead of using tools

---

## 🎯 Objective

Phase 3 (generate cards from business rules) was failing with "Erro desconhecido" and empty AI response despite 659 business rules being sent to Opus. The goal was to diagnose and fix why Opus returned empty text content.

**Key Requirements:**
1. Diagnose why Opus returns empty response with only 9 output tokens after 8.5 minutes
2. Fix the root cause — Opus entering agent mode with Claude CLI
3. Ensure all RAG pipeline phases (2, 3, 4) generate pure text without tool use

---

## 🔍 Root Cause Analysis

### Evidence from Database

```sql
-- Phase 3 Opus: EMPTY response
response_len=0, output_tokens=9, execution_time=512,652ms (~8.5 min)

-- Phase 2 Sonnet: WORKING response
response_len=9590-18978, output_tokens=5190-13966
```

### Root Cause

**Claude CLI with `--permission-mode bypassPermissions` enables agent mode.** When Opus runs in agent mode:
- It uses tools (Read, Bash, Glob, etc.) instead of generating text
- Only 9 output tokens were generated (tool call overhead)
- 8.5 minutes of execution = tool use, not text generation
- The system prompt saying "no tools" is insufficient — Opus ignores it

**Sonnet worked** because it's more obedient to the "no tools" system prompt instruction, but this was fragile.

### Solution

Claude CLI supports `--tools ""` flag that **disables ALL tools**, forcing pure text generation mode. This is the correct way to prevent agent mode.

---

## ✅ What Was Implemented

### 1. Claudio Proxy — Tool Disabling (`poc_chat/backend/main.py`)

Added `--tools ""` CLI flag when `request.tools` is an empty list:

```python
# Tools: when tools=[] (empty list), disable ALL tools for pure text generation
if request.tools is not None and len(request.tools) == 0:
    cmd.extend(["--tools", ""])
```

Also added **result event text extraction** as defense-in-depth — if Opus somehow enters agent mode, the proxy now extracts text from the `result` event (where Claude CLI puts final agent output):

- Non-streaming: extracts `event.result` text when `full_text` is empty
- Streaming: emits result text as `content_block_delta` when no text was streamed

### 2. AI Orchestrator — `disable_tools` Parameter (`ai_orchestrator.py`)

Added `disable_tools: bool = False` parameter threaded through the entire call chain:

- `execute()` — main entry point
- `_execute_with_config()` — provider dispatch
- `_execute_claudio()` — non-streaming Claudio calls
- `_execute_claudio_streaming()` — streaming Claudio calls
- All 5 internal call sites that invoke `_execute_with_config()`

When `disable_tools=True`, adds `"tools": []` to the HTTP body sent to the proxy.

### 3. RAG Pipeline — Enable Tool Disabling (`rag_pipeline.py`)

Added `disable_tools=True` to all three pipeline phases that use LLM for text generation:

- **Phase 2** (line 398): Extract business rules from code
- **Phase 3** (line 713): Generate hierarchical cards from rules
- **Phase 4** (line 1110): Generate wiki content from cards

---

## 📁 Files Modified

### Modified:
1. **poc_chat/backend/main.py** — Added `--tools ""` CLI flag + result event text extraction
   - Lines changed: ~50
   - Features: tool disabling, result event fallback (streaming + non-streaming)

2. **backend/app/services/ai_orchestrator.py** — Added `disable_tools` parameter chain
   - Lines changed: ~30
   - Features: parameter in execute(), _execute_with_config(), _execute_claudio(), _execute_claudio_streaming(), 5 call sites

3. **backend/app/services/rag_pipeline.py** — Added `disable_tools=True` to Phase 2, 3, 4
   - Lines changed: 3
   - Features: prevents agent mode in all RAG pipeline LLM calls

---

## 🧪 Testing Results

### Verification:

```bash
✅ Opus with tools=[] returns 141 output tokens with proper JSON content
✅ Opus WITHOUT tools restriction returns only 9 output tokens (agent mode - BROKEN)
✅ disable_tools parameter threaded through entire orchestrator call chain
✅ All 3 RAG pipeline phases have disable_tools=True
✅ Proxy correctly converts tools=[] to --tools "" CLI flag
✅ Result event text extraction works as fallback defense
```

### Before vs After:

| Metric | Before (broken) | After (fixed) |
|--------|-----------------|---------------|
| Output tokens | 9 | 141+ |
| Response text | Empty | Valid JSON |
| Execution time | 512s (tools) | ~30s (text gen) |
| Agent mode | Active (tools) | Disabled |

---

## 🎯 Success Metrics

✅ **Phase 3 unblocked:** Opus now generates text instead of using tools
✅ **Defense-in-depth:** Result event extraction as fallback for any agent mode leaks
✅ **All phases protected:** Phase 2, 3, and 4 all use `disable_tools=True`
✅ **Backward compatible:** `disable_tools=False` by default, no impact on other callers

---

## 💡 Key Insights

### 1. Claude CLI Agent Mode is the Default for Opus
With `--permission-mode bypassPermissions`, Opus aggressively uses tools. Even a system prompt saying "no tools" is ignored. The only reliable way to force pure text generation is `--tools ""`.

### 2. 9 Output Tokens = Tool Call Overhead
When Opus enters agent mode, the 9 output tokens represent the tool call JSON, not user-visible text. The actual "thinking" happens through tool interactions that don't produce text content.

### 3. Defense-in-Depth Strategy
Two layers of protection: (1) `--tools ""` prevents agent mode entirely, (2) result event extraction captures text from agent mode responses if it somehow occurs.

---

## 🎉 Status: COMPLETE

Phase 3 "Erro desconhecido" with empty Opus response has been fixed. The root cause was Claude CLI's agent mode being active during pure text generation calls. The fix adds `--tools ""` to disable all tools, forcing Opus to generate text directly.

**Key Achievements:**
- ✅ Diagnosed 9-token/8.5-min execution as agent mode tool use
- ✅ Discovered `--tools ""` CLI flag for pure text generation
- ✅ Implemented `disable_tools` parameter through entire call chain
- ✅ Added result event text extraction as fallback defense
- ✅ Protected all 3 RAG pipeline phases

**Impact:**
- Phase 3 (generate cards) now works with Opus
- Phase 4 (generate wiki) now works with Opus
- Phase 2 (extract rules) additionally protected
- No impact on other AI calls (parameter defaults to False)

---
