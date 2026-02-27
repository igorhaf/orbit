# PROMPT #246 - Claudio Local Proxy Provider Integration
## Replace ALL AI Operations with Claudio (Anthropic-compatible Local Proxy)

**Date:** February 21, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** All AI operations now route through Claudio local proxy at localhost:8001 — zero API key needed, zero cost

---

## Objective

Integrate "Claudio", a local proxy running at `http://localhost:8001` that exposes the Anthropic Messages API (`POST /v1/messages`) without requiring API keys (authentication via CLI signing). Replace ALL existing AI providers (Anthropic, OpenAI, Google, Ollama, Cohere) with Claudio for every operation.

**Key Requirements:**
1. Add Claudio as a new provider in the AIOrchestrator
2. Reuse Anthropic SDK (`AsyncAnthropic`) with custom `base_url`
3. Replace all active models with Claudio models for all 8 usage_types
4. No API key required — uses dummy key `"not-needed"`

---

## What Was Implemented

### 1. AIOrchestrator Provider Support

Added "claudio" provider in 5 dispatch locations:

- **`_initialize_clients()`** — Creates `AsyncAnthropic(api_key="not-needed", base_url=CLAUDIO_BASE_URL)`
- **`_execute_anthropic()`** — Added `client_key` parameter to select between anthropic/claudio client
- **`_execute_anthropic_streaming()`** — Same `client_key` parameter for streaming
- **Streaming dispatch** — Routes `claudio` to Anthropic streaming with `client_key="claudio"`
- **Non-streaming fallback** — Routes `claudio` to Anthropic non-streaming with `client_key="claudio"`
- **Chain execution dispatch** — Both streaming and fallback paths
- **Retry node dispatch** — Non-chain retry path

### 2. Pricing ($0 for Claudio)

Added 3 Claudio model IDs with zero cost:
- `claude-sonnet-4-6`: (0.00, 0.00)
- `claude-opus-4-6`: (0.00, 0.00)
- `claude-haiku-4-5`: (0.00, 0.00)

### 3. Database Models

Deactivated all 20 existing models. Inserted 8 Claudio models:

| Model | model_id | Usage Type |
|-------|----------|------------|
| Claudio Sonnet 4.6 | claude-sonnet-4-6 | task_execution |
| Claudio Sonnet 4.6 (Prompt) | claude-sonnet-4-6 | prompt_generation |
| Claudio Haiku 4.5 (Interview) | claude-haiku-4-5 | interview |
| Claudio Haiku 4.5 (Commit) | claude-haiku-4-5 | commit_generation |
| Claudio Sonnet 4.6 (Discovery) | claude-sonnet-4-6 | pattern_discovery |
| Claudio Sonnet 4.6 (Memory) | claude-sonnet-4-6 | memory |
| Claudio Sonnet 4.6 (Queue) | claude-sonnet-4-6 | queue_orchestration |
| Claudio Sonnet 4.6 (General) | claude-sonnet-4-6 | general |

### 4. Frontend AI Models Page

Added "Claudio (Local Proxy)" as first option in provider dropdowns (create + edit dialogs). API key field marked as optional for Claudio.

### 5. Environment Configuration

Added `CLAUDIO_BASE_URL=http://localhost:8001` to `.env`.

---

## Files Modified

### Modified:
1. **backend/app/services/ai_orchestrator.py** — Added claudio provider init, client_key param in execute methods, 5 dispatch locations
2. **backend/app/utils/pricing.py** — Added 3 Claudio model pricing entries ($0)
3. **backend/.env** — Added CLAUDIO_BASE_URL
4. **frontend/src/app/ai-models/page.tsx** — Added Claudio option in provider dropdowns

---

## Testing Results

```
Claudio health check: {"status": "ok"}
Claudio API test: Anthropic-compatible response format verified
Frontend build: OK (no errors)
Backend syntax: OK (ast.parse passed)
Database: 8 Claudio models active, 20 old models deactivated
AI flow chains: 8 chains deactivated (direct model routing)
```

---

## Status: COMPLETE

**Key Achievements:**
- Claudio fully integrated as 6th provider in ORBIT
- Zero code duplication — reuses Anthropic execution methods via `client_key` parameter
- All 8 usage_types covered with Claudio models
- $0 cost tracking (local proxy)
- Frontend supports Claudio in model management UI
- Configurable via `CLAUDIO_BASE_URL` env var

**Available Models:**
- `claude-sonnet-4-6` — Primary (task execution, prompt generation, discovery, memory, queue, general)
- `claude-opus-4-6` — High capability (available for manual configuration)
- `claude-haiku-4-5` — Fast/cheap (interviews, commits)
