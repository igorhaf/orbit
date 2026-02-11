# PROMPT #220 - AI Flow Chains & Sampling Parameters
## Configuring top_p/top_k for All Models + Optimal Chains for All Operations

**Date:** 2026-02-11
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Configuration & Optimization
**Impact:** All 7 Ollama models configured with proper sampling parameters; 8 AI Flow chains created for optimal fallback across all operations

---

## Objective

1. Add `top_p` and `top_k` sampling parameters to all Ollama models in the database
2. Create AI Flow fallback chains for all 8 usage types, choosing the best models per operation based on PROMPT #219 benchmark results

---

## What Was Implemented

### 1. Sampling Parameters per Model

All 7 Ollama models updated with model-specific optimal parameters:

| Model | temperature | top_p | top_k | max_tokens | context_length |
|---|---|---|---|---|---|
| **Gemma3 12B** | 0.7 | 0.9 | 40 | 8192 | 128,000 |
| **Qwen3 14B** | 0.7 | 0.8 | 20 | 32768 | 131,072 |
| **DeepSeek-R1 14B** | 0.6 | 0.9 | 50 | 8192 | 65,536 |
| **Phi-4 14B** | 0.7 | 0.9 | 40 | 16384 | 16,384 |
| **Codestral 22B** | 0.2 | 0.9 | 40 | 8192 | 32,768 |
| **DS-Coder-V2 16B** | 0.3 | 0.9 | 40 | 8192 | 131,072 |
| **Qwen2.5 32B** | 0.7 | 0.8 | 20 | 8192 | 131,072 |

### 2. AI Flow Chains (8 operations)

| Operation | Chain (fallback order) | Rationale |
|---|---|---|
| **interview** | Gemma3 12B -> Qwen3 14B | Quality + Portuguese (9 rules, 5 entities) |
| **prompt_generation** | Qwen3 14B -> Gemma3 12B | Verbose output (1279 tokens, creative) |
| **task_execution** | Qwen3 14B -> Gemma3 12B | Speed (31.9 tok/s, fastest) |
| **commit_generation** | Gemma3 12B -> Qwen3 14B | Concise output (737 tokens) |
| **pattern_discovery** | DeepSeek-R1 14B -> Gemma3 12B | Chain-of-thought reasoning |
| **memory** | Gemma3 12B -> Qwen3 14B -> DeepSeek-R1 | Best rule extraction (benchmark winner) |
| **queue_orchestration** | Qwen3 14B -> Gemma3 12B -> Phi-4 | Batch speed + reliable fallback |
| **general** | Gemma3 12B -> Qwen3 14B -> DeepSeek-R1 | Best overall balance |

### 3. Model Selection Rationale

**Gemma3 12B** (primary for quality operations):
- Best quality: 9 rules, 9 valid, 5 entities
- Fast: 25.0 tok/s, 29.5s total
- Concise: 737 output tokens (efficient)
- Best for: interview, commit_generation, memory, general

**Qwen3 14B** (primary for speed operations):
- Fastest generation: 31.9 tok/s
- Most verbose: 1279 output tokens (detailed)
- Best for: prompt_generation, task_execution, queue_orchestration

**DeepSeek-R1 14B** (primary for reasoning operations):
- Chain-of-thought reasoning built-in
- Good quality: 8 rules, 5 entities
- Best for: pattern_discovery (needs deep analysis)

---

## Files Created

1. **backend/scripts/seed_ai_flow_chains.py** — Seed script
   - Updates all Ollama models with top_p/top_k configs
   - Creates 8 AI Flow chains with optimal model ordering
   - Node positions for visual diagram rendering
   - Reusable for fresh installations

---

## Verification

```
AI MODELS (7 active Ollama models):
  Gemma3 12B      | top_p=0.9  top_k=40  temp=0.7
  Qwen3 14B       | top_p=0.8  top_k=20  temp=0.7
  DeepSeek-R1 14B | top_p=0.9  top_k=50  temp=0.6
  Phi-4 14B       | top_p=0.9  top_k=40  temp=0.7
  Codestral 22B   | top_p=0.9  top_k=40  temp=0.2
  DS-Coder-V2 16B | top_p=0.9  top_k=40  temp=0.3
  Qwen2.5 32B     | top_p=0.8  top_k=20  temp=0.7

AI FLOW CHAINS (8 chains):
  interview          | gemma3:12b -> qwen3:14b
  prompt_generation  | qwen3:14b -> gemma3:12b
  task_execution     | qwen3:14b -> gemma3:12b
  commit_generation  | gemma3:12b -> qwen3:14b
  pattern_discovery  | deepseek-r1:14b -> gemma3:12b
  memory             | gemma3:12b -> qwen3:14b -> deepseek-r1:14b
  queue_orchestration| qwen3:14b -> gemma3:12b -> phi4:14b
  general            | gemma3:12b -> qwen3:14b -> deepseek-r1:14b
```

---

## Status: COMPLETE

**Key Achievements:**
- 7 Ollama models configured with proper top_p/top_k sampling parameters
- 8 AI Flow chains created covering all usage types
- Each chain optimized for the specific operation requirements
- All chains use local Ollama models (free, no API costs)
- Fallback ordering based on PROMPT #219 benchmark data
- Visual node positions set for AI Flow diagram rendering

**Impact:**
- All AI operations now have automatic fallback chains
- Operations use the best model for each task type
- Zero API costs (100% local Ollama models)
- If primary model fails, automatic fallback to next best
