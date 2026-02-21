# PROMPT #227 - Optimized AI Flow for 12GB VRAM
## Hardware-Aware Model Selection & Flow Configuration

**Date:** 2026-02-17
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Performance Optimization
**Impact:** All AI operations now run 100% on GPU with optimal throughput

---

## Objective

Analyze hardware (i9 + 32GB RAM + 12GB VRAM), select optimal Ollama models that fit entirely in GPU memory, configure optimized AI Flow chains per operation, fix diagram alignment issues, and create a reproducible seed script.

**Key Requirements:**
1. All models must fit in 12GB VRAM (100% GPU, no CPU offload)
2. Specialized models per operation type (code, reasoning, fast tasks)
3. Proper fallback chains for reliability
4. Fixed node positioning in AI Flow diagram
5. Reproducible seed script

---

## Hardware Analysis

| Component | Spec | Impact |
|-----------|------|--------|
| CPU | Intel i9 | Excellent for any CPU fallback |
| RAM | 32 GB | Plenty for OS + WSL + app |
| VRAM | 12 GB | Fits models up to ~11GB |
| Ollama | Windows native | Direct GPU access, no WSL overhead |
| ORBIT | WSL2 | Connects to Ollama via network gateway |

---

## Benchmark Results (Real Measurements)

| Model | Size | VRAM Usage | tok/s | GPU % | Verdict |
|-------|------|-----------|-------|-------|---------|
| qwen3:8b | 5.2 GB | 5.2 GB | **46.5** | 100% | FAST - ideal for simple tasks |
| qwen3:14b | 9.3 GB | 9.3 GB | **27.6** | 100% | QUALITY - ideal for reasoning |
| qwen2.5-coder:14b | 9.0 GB | 9.0 GB | **~25** | 100% | CODE - specialized for programming |
| nomic-embed-text | 0.3 GB | 0.3 GB | instant | 100% | EMBEDDINGS - for RAG |
| ~~qwen2.5:32b~~ | ~~20 GB~~ | ~~11.2 GB~~ | ~~2.6~~ | ~~52%~~ | **REMOVED** - too slow with CPU offload |

---

## What Was Implemented

### 1. Model Optimization
- **Removed** qwen2.5:32b (20GB, only 52% GPU = 2.6 tok/s - unusable)
- **Added** qwen3:8b (5.2GB, 100% GPU = 46.5 tok/s - fast tasks)
- **Added** nomic-embed-text (0.3GB - RAG embeddings)
- **Kept** qwen3:14b (9.3GB, 100% GPU = 27.6 tok/s - quality)
- **Kept** qwen2.5-coder:14b (9GB, 100% GPU = ~25 tok/s - code)

### 2. Optimized AI Flow Chains

| Operation | Primary Model | Fallback | Rationale |
|-----------|--------------|----------|-----------|
| **interview** | qwen3:8b (46 tok/s) | - | Fast conversational responses |
| **prompt_generation** | qwen3:14b (27 tok/s) | - | Quality reasoning needed |
| **task_execution** | qwen2.5-coder:14b | qwen3:14b | Code specialist + quality fallback |
| **commit_generation** | qwen3:8b (46 tok/s) | - | Simple, fast output |
| **pattern_discovery** | qwen3:14b | qwen3:8b | Deep analysis + fast fallback |
| **memory** | qwen3:14b | - | Deep code analysis |
| **queue_orchestration** | qwen3:8b (46 tok/s) | - | Fast routing decisions |
| **general** | qwen3:14b | qwen3:8b | Quality + fast fallback |

### 3. Node Positioning Fix
- **Root cause:** Old seed scripts stored hardcoded x/y positions that didn't match the frontend's layout algorithm
- **Fix:** Set `node_positions = None` in all chains, letting the frontend's `buildFlowFromChain()` function calculate positions dynamically using its linear pipeline algorithm
- **Result:** Perfect alignment: Start → Pre-process → Models → Post-process → Response, with Error below

### 4. Utility Nodes per Chain
All chains include:
- **RAG Context** (pre-process): 5 results, 0.7 similarity threshold
- **Timeout** (pre-process): 300s
- **Validator** (post-process): not_empty (or json for pattern_discovery/memory)
- **Retry** (post-process): 2 retries, 2s backoff, 2x multiplier

### 5. Seed Script
Created `backend/scripts/seed_optimized_flow.py` that:
- Removes old Ollama models from DB (qwen2.5:32b)
- Registers 4 optimized models
- Creates/updates 8 AI Flow chains
- Deactivates unused cloud models
- Sets node_positions to None for auto-layout

---

## Files Created/Modified

### Created:
1. **backend/scripts/seed_optimized_flow.py** - Complete seed script
   - 4 phases: clean, register, chain, deactivate
   - Idempotent (safe to re-run)
2. **rag/internal/PROMPT_227_OPTIMIZED_AI_FLOW.md** - This report

---

## Testing Results

```
Ollama Models:
  qwen3:8b          → 46.5 tok/s (100% GPU) VERIFIED
  qwen3:14b         → 27.6 tok/s (100% GPU) VERIFIED
  qwen2.5-coder:14b → ~25 tok/s (100% GPU)  VERIFIED
  nomic-embed-text  → instant               VERIFIED
  qwen2.5:32b       → DELETED from Ollama   VERIFIED

Database:
  Active AI Models: 4 (all Ollama)           VERIFIED
  AI Flow Chains: 8 (all operations)         VERIFIED
  Node Positions: None (auto-layout)         VERIFIED
  Cloud models: deactivated (kept in DB)     VERIFIED
```

---

## Success Metrics

- **GPU utilization**: 100% for all active models (was 52% for qwen2.5:32b)
- **Min throughput**: 25 tok/s (was 2.6 tok/s for qwen2.5:32b)
- **Max throughput**: 46.5 tok/s for fast tasks
- **All 8 operations**: Covered with specialized chains
- **Diagram alignment**: Fixed via dynamic positioning

---

## Key Insights

### 1. 12GB VRAM Sweet Spot
Models up to ~9.3GB fit 100% in GPU. The 14B Q4_K_M quantization is the perfect balance of quality vs speed for 12GB VRAM. The 32B model (20GB) was a terrible choice - only 52% GPU = 10x slower than 14B.

### 2. Windows Native Ollama = Best Performance
Running Ollama directly on Windows gives direct GPU access without WSL virtualization overhead. The WSL2 app connects via network gateway (172.27.144.1:11434).

### 3. Model Specialization Matters
- **Code tasks**: qwen2.5-coder:14b outperforms generic models on code generation
- **Fast tasks**: qwen3:8b at 46.5 tok/s is nearly 2x faster than 14B models
- **Quality tasks**: qwen3:14b provides best reasoning quality that fits in GPU

### 4. Dynamic Positioning is More Robust
Storing node_positions as None and letting the frontend calculate them dynamically is more robust than syncing hardcoded coordinates between backend seeds and frontend rendering code.

---

## Status: COMPLETE

**Key Achievements:**
- 100% GPU utilization for all models
- 10-18x speedup over previous qwen2.5:32b
- Specialized models per operation type
- Fixed AI Flow diagram alignment
- Reproducible seed script

**Impact:**
- Interviews respond ~46 tok/s (was ~3 tok/s)
- Code generation at ~25 tok/s with specialized model
- All operations fully local, zero API cost
