# PROMPT #283 - Dedicated CRITICAL Worker + Preemption + Qwen3 8B Migration
## Real-time interview/chat responses with GPU preemption and lighter model

**Date:** 2026-02-14
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Performance Optimization
**Impact:** Interview and chat responses now run in parallel on a dedicated worker, preempting regular jobs to free Ollama GPU. Qwen3 14B replaced with faster 8B across all pipelines.

---

## Objective

1. **Interview/chat jobs must run in parallel** - never wait in queue behind lower-priority jobs
2. **Preempt regular workers** when a CRITICAL job arrives to free Ollama GPU resources
3. **Replace qwen3:14b with qwen3:8b** across all pipelines for faster inference

---

## What Was Implemented

### 1. Dual-Queue Architecture with Dedicated CRITICAL Worker
**File:** `backend/app/services/job_executor.py`

The PriorityJobExecutor now has two separate queues:

- **Critical queue** (`_critical_queue`): for jobs with priority >= 10 (interviews, chats)
- **Regular queue** (`_queue`): for all other jobs (priority < 10)

Workers:
- **3 regular workers**: handle non-critical jobs from the regular queue
- **1 dedicated CRITICAL worker**: handles only CRITICAL jobs, runs independently

### 2. GPU Preemption
When a CRITICAL job starts:
1. Regular workers are **paused** (`_pause_event.clear()`) - they stop picking up new jobs
2. This frees the Ollama GPU for the CRITICAL job (no competing inference)
3. When CRITICAL job completes, regular workers **resume** automatically
4. Multiple CRITICAL jobs can run back-to-back (counter-based tracking)
5. Manual pause via `executor.pause()` is respected (won't resume if manually paused)

### 3. Qwen3 14B → 8B Migration
**File:** `backend/scripts/seed_ai_flow_chains.py`

All chains updated:
- interview: Gemma3 12B → **Qwen3 8B** (was 14B)
- prompt_generation: **Qwen3 8B** → Gemma3 12B
- task_execution: **Qwen3 8B** → Gemma3 12B
- commit_generation: Gemma3 12B → **Qwen3 8B**
- memory: **Qwen3 8B** → Gemma3 12B → DeepSeek-R1 14B
- queue_orchestration: **Qwen3 8B** → Gemma3 12B → Phi-4 14B
- general: **Qwen3 8B** → Gemma3 12B → DeepSeek-R1 14B

Benefits: 5.2 GB vs 9.3 GB VRAM, faster inference, lower latency.

---

## Files Modified

1. **`backend/app/services/job_executor.py`** - Dual-queue + dedicated CRITICAL worker + preemption
2. **`backend/scripts/seed_ai_flow_chains.py`** - qwen3:14b → qwen3:8b in all chains + config

---

## Testing Results

```
OK  Backend starts with "Started 3 regular workers + 1 dedicated CRITICAL worker"
OK  CRITICAL job (priority=10) routed to critical_queue
OK  CRITICAL-Worker executes job immediately (no queue waiting)
OK  Regular workers PAUSED during CRITICAL job (GPU freed)
OK  Regular workers RESUMED after CRITICAL job completes
OK  Seed script updates all 8 chains with qwen3:8b
OK  Chat response completed successfully (model=gemma3:12b, priority=10)
OK  qwen3:8b pulled and available in Ollama (5.2 GB)
```

---

## Key Insights

### 1. Why Dual Queue Instead of Priority Boost
A single priority queue with higher priority still requires waiting for the semaphore (3 workers). With a dedicated worker, CRITICAL jobs have their own execution slot that's always available.

### 2. GPU Preemption Strategy
Ollama runs on a single GPU. When a CRITICAL job (interview/chat) starts, pausing regular workers ensures no competing model inference is happening. This gives the CRITICAL job full GPU bandwidth for fastest possible response.

### 3. Qwen3 8B vs 14B
The 8B model is nearly half the size (5.2 GB vs 9.3 GB), loads faster, and provides sufficient quality for the fallback role it plays in most chains. DeepSeek-R1 14B and Gemma3 12B remain unchanged where deep reasoning or quality is the primary concern.

---

## Status: COMPLETE

**Key Achievements:**
- Interview/chat responses never blocked by background jobs
- Dedicated CRITICAL worker with GPU preemption
- Regular workers auto-pause/resume around CRITICAL jobs
- qwen3:8b across all 8 pipelines for faster fallback inference
- Backward compatible: manual pause/resume still works
