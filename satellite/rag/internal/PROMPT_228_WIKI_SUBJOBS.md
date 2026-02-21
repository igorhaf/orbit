# PROMPT #228 - Wiki Enrichment as Sub-Jobs
## Break monolithic wiki generation into individual queued sub-jobs

**Date:** February 17, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature / Refactor
**Impact:** Wiki pages are now generated as individual sub-jobs visible in the jobs page, matching the file reading pattern

---

## 🎯 Objective

Refactor wiki page generation from a single monolithic AI call into individual sub-jobs in the priority queue, following the same pattern used for file reading during RAG scanning.

**Key Requirements:**
1. Each wiki page generation should be a separate sub-job
2. Sub-jobs should be visible in the jobs page with progress tracking
3. Parent job groups all wiki sub-jobs together
4. Follow existing sub-job pattern from ContinuousRAGService

---

## 🔍 Pattern Analysis

### Existing Pattern: File Reading Sub-Jobs
```
Parent Job: "rag_continuous_scan" (batch processing)
├── Child Job: "Arquivo 1/15: docker-compose.yml" [completed]
├── Child Job: "Arquivo 2/15: app/Models/User.php" [running]
├── Child Job: "Arquivo 3/15: routes/web.php" [pending]
└── ... (progress: 1/15 fases concluidas)
```

Uses `JobManager.create_child_job()` → `complete_child_job()` → `update_parent_progress()`.

### New Pattern: Wiki Sub-Jobs (DB-first, AI-last)
```
Parent Job: "wiki_generation" (Gerando wiki - 276 regras) [Qwen3 14B (Quality)]
├── Child Job: "Página 1/8: Padrões de Arquitetura" [completed]     (DB only — instant)
├── Child Job: "Página 2/8: Convencoes de Código" [completed]       (DB only — instant)
├── Child Job: "Página 3/8: Componentes e Interface" [completed]    (DB only — instant)
├── Child Job: "Página 4/8: Estrutura de Código" [completed]        (DB only — instant)
├── Child Job: "Página 5/8: Histórico de Desenvolvimento" [completed] (DB only — instant)
├── Child Job: "Página 6/8: Regras de Negócio (hierarquia)" [completed] (DB only)
├── Child Job: "Página 7/8: Links semânticos" [completed]           (DB only — instant)
└── Child Job: "Página 8/8: Visão Geral (IA)" [running]            (AI call — slow) [Qwen3 14B]
```

---

## ✅ What Was Implemented

### 1. New Job Type: WIKI_GENERATION
Added `JobType.WIKI_GENERATION = "wiki_generation"` with NORMAL priority.

### 2. New Function: `wiki_enrichment_job()`
Async function that runs as a queued job, creating child sub-jobs for each wiki page.

**Optimized order: DB-first, AI-last** — instant DB pages complete immediately while the slow AI call runs last:

- **Sub-jobs 1-5 (DB queries):** RAG data pages — architecture, conventions, UI components, code structure, git history. No AI calls, just DB queries. Complete in <1s each.
- **Sub-job 6 (DB):** Business rules hierarchy — creates index, domain, and individual rule pages
- **Sub-job 7 (DB):** Semantic linking across all wiki pages
- **Sub-job 8 (AI):** Calls `_enrich_context_from_rag()` — generates Visão Geral via Ollama (slow, runs LAST)
- **Post-job:** Triggers separate rule enrichment job for AI enrichment of individual rules

**AI model display:** Parent job and AI sub-job (8/8) show the model name (e.g., "Qwen3 14B (Quality)") resolved from `AIOrchestrator.choose_model("general")`.

### 3. New Function: `submit_wiki_enrichment()`
Submission function that:
- Checks for duplicate wiki jobs (won't submit if one is already running)
- Creates parent job with notification and deep link to wiki page
- Submits to PriorityJobExecutor at NORMAL priority

### 4. Updated `batch_processing_cycle` and `watchdog_cycle`
Both now call `submit_wiki_enrichment()` instead of `_enrich_context_from_rag()` directly. The wiki enrichment runs as a separate tracked job instead of blocking the batch cycle.

---

## 📁 Files Modified/Created

### Modified:
1. **[backend/app/models/async_job.py](backend/app/models/async_job.py)** - New job type
   - Added `WIKI_GENERATION = "wiki_generation"` to JobType enum
   - Added NORMAL priority mapping

2. **[backend/app/services/watchdog.py](backend/app/services/watchdog.py)** - Wiki sub-jobs
   - Added `wiki_enrichment_job()` async function (~150 lines)
   - Added `submit_wiki_enrichment()` function
   - Updated `batch_processing_cycle` step 2: uses `submit_wiki_enrichment()`
   - Updated `watchdog_cycle` step 4: uses `submit_wiki_enrichment()`

---

## 🧪 Testing Results

```bash
✅ All imports compile correctly
✅ JobType.WIKI_GENERATION registered in enum
✅ PostgreSQL enum updated with ALTER TYPE
✅ Backend starts and runs without errors
✅ Watchdog resumes batch processing normally
✅ Frontend jobs page auto-discovers new job type in dropdown
```

---

## 🎯 Success Metrics

✅ **Sub-job pattern:** Wiki pages created as individual child jobs with phase labels
✅ **Progress tracking:** Parent job auto-calculates progress from children completion
✅ **No blocking:** Wiki enrichment no longer blocks the batch processing cycle
✅ **Visible in UI:** Each wiki page generation visible as separate row in jobs page
✅ **Shutdown-aware:** Checks `_is_shutting_down()` between each sub-job

---

## 💡 Key Insights

### 1. DB-First, AI-Last Order
Only sub-job 8 (Visão Geral) requires an AI call. Sub-jobs 1-7 are pure database queries that format RAG data into wiki pages. By running DB pages first, users see immediate progress (7/8 complete in seconds) while the slow AI call runs last. Previously AI was sub-job 1, blocking all instant pages behind it.

### 2. Existing Sub-Job Infrastructure is Reusable
The `JobManager.create_child_job()` / `complete_child_job()` / `update_parent_progress()` pattern works perfectly for wiki pages, just like it does for file reading.

### 3. Non-Blocking Wiki Generation
Previously, wiki enrichment blocked the batch cycle for 5+ minutes (or timed out). Now it's a separate job that runs concurrently. The batch cycle can proceed to the next batch immediately.

---

## 🎉 Status: COMPLETE

Wiki enrichment is now decomposed into 8 individual sub-jobs matching the file reading pattern.

**Key Achievements:**
- ✅ New `WIKI_GENERATION` job type with sub-job hierarchy
- ✅ Each wiki page is a separate, trackable sub-job
- ✅ Progress visible in jobs page (Página 1/8, 2/8, etc.)
- ✅ Non-blocking: runs as separate job from batch processing
- ✅ Shutdown-aware between each sub-job
- ✅ DB-first order: instant pages (1-7) complete before slow AI page (8)
- ✅ AI model name shown on parent job and AI sub-job (e.g., "Qwen3 14B (Quality)")

**Impact:**
- Wiki generation is now visible and trackable in the jobs page
- No more monolithic AI calls that timeout
- Each page failure is isolated (doesn't block other pages)
- User can see exactly which wiki pages were created and which failed
- 7 of 8 sub-jobs complete instantly — user sees immediate progress
- Model column shows which AI model is being used

---
