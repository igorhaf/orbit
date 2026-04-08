# PROMPT #246 — Comprehensive Selenium E2E Testing

## Objective

Create a comprehensive end-to-end functional test suite using Selenium that covers ALL implemented features of the ORBIT platform. Uses the Meada project as test case with ONLY local Ollama models (zero online API calls).

## What Was Implemented

### Test Suite Structure (9 test files, 116 tests)

```
scripts/selenium_tests/
├── conftest.py                    # Session fixtures, Ollama chain setup/teardown
├── helpers.py                     # Shared utilities (wait, screenshot, API helpers)
├── test_00_prerequisites.py       # Infrastructure verification (10 tests)
├── test_01_ai_models.py           # AI models & AI Flow pages (7 tests)
├── test_02_project_overview.py    # Project overview, AI operations, fragments (15 tests)
├── test_03_backlog_cards.py       # Backlog CRUD, AI card generation (14 tests)
├── test_04_card_interview.py      # Card-focused interview flow (11 tests)
├── test_05_kanban_workflow.py     # Kanban board & status transitions (10 tests)
├── test_06_knowledge_wiki.py      # Wiki CRUD & RAG UI (11 tests)
├── test_07_pipeline_jobs.py       # Jobs system & console (9 tests)
├── test_08_navigation.py          # All pages & tabs (30 tests)
├── screenshots/                   # Auto-generated screenshots
└── reports/                       # HTML report + test output log
```

### Test Coverage Summary

| Module | Tests | Coverage |
|--------|-------|----------|
| **Prerequisites** | 10 | Backend, Frontend, Ollama, Redis, PostgreSQL, Meada project, AI chains |
| **AI Models** | 7 | AI Models page, AI Flow page, Ollama models visible |
| **Project Overview** | 15 | Description expand/summarize/rephrase, title generation, pinned fragments |
| **Backlog Cards** | 14 | Manual epic/story/task creation, AI story/task generation, card editing |
| **Card Interview** | 11 | Interview creation, Q1-Q3 fixed, Q4-Q5 AI contextual, card inference |
| **Kanban** | 10 | Board loading, API endpoint, status transitions (backlog→todo→in_progress→done) |
| **Wiki/RAG** | 11 | Wiki CRUD (create/read/update/delete/tree), RAG tab, Chat tab |
| **Jobs/Pipeline** | 9 | Jobs list, active jobs, stats, executor status, job detail, console |
| **Navigation** | 30 | 10 project tabs, 6 navbar pages, 6 admin pages, JS error checks |
| **TOTAL** | **116** | **115 passed, 1 skipped** |

### Bugs Found and Fixed

#### 1. Card Interview `motivation_type` Truncation (500 Error)
- **File:** `backend/app/api/routes/interviews/unified_open_handler.py`
- **Issue:** `motivation_type` column is `varchar(50)`, but code was setting it to `user_answers[0]` which was the INITIAL user message (not the Q1 answer). The initial message could be >50 chars, causing `StringDataRightTruncation`.
- **Root cause:** Wrong index — Q1 answer is `user_answers[1]` (2nd user message), not `user_answers[0]` (initial message)
- **Fix:** Changed to `user_answers[1].lower()[:50]` with fallback to `user_answers[0].lower()[:50]`

#### 2. FRAGMENT_MAP Truncation (from previous session)
- **File:** `backend/app/services/project_service.py`
- **Issue:** When Ollama response was truncated, `---FRAGMENT_MAP---` appeared without `---END_FRAGMENT_MAP---`, leaving map text in saved description
- **Fix:** Handle truncated case by using end of string as map_end

#### 3. Task `item_type` Ignored (from previous session)
- **File:** `backend/app/api/routes/tasks/crud.py`
- **Issue:** Creating tasks via API ignored `item_type`, `parent_id`, `priority`, etc.
- **Fix:** Added all missing fields to `Task()` constructor

### Ollama Configuration

All 10 AI Flow chains reconfigured to use local Ollama models:
- `interview` → qwen3:8b
- `prompt_generation` → qwen3:14b
- `task_execution` → qwen2.5-coder:14b
- `commit_generation` → qwen3:8b
- `content_generation` → qwen3:14b
- `rag_extraction` → qwen3:14b
- `memory` → qwen3:8b
- `general` → qwen3:8b
- `pattern_discovery` → qwen2.5-coder:14b
- `queue_orchestration` → qwen3:8b

### Known Issues (Not Fixed — Pre-existing)
- `/discovery-queue` page has client-side `TypeError` runtime error (skipped in tests)
- `/api/v1/settings/allow_protected_project_deletion` returns 422 (filtered in noise patterns)

## Files Modified/Created

### Created (Test Files)
- `scripts/selenium_tests/conftest.py`
- `scripts/selenium_tests/helpers.py`
- `scripts/selenium_tests/test_00_prerequisites.py`
- `scripts/selenium_tests/test_01_ai_models.py`
- `scripts/selenium_tests/test_02_project_overview.py`
- `scripts/selenium_tests/test_03_backlog_cards.py`
- `scripts/selenium_tests/test_04_card_interview.py`
- `scripts/selenium_tests/test_05_kanban_workflow.py`
- `scripts/selenium_tests/test_06_knowledge_wiki.py`
- `scripts/selenium_tests/test_07_pipeline_jobs.py`
- `scripts/selenium_tests/test_08_navigation.py`

### Modified (Bug Fixes)
- `backend/app/api/routes/interviews/unified_open_handler.py` — Fixed motivation_type extraction
- `backend/app/services/project_service.py` — Fixed FRAGMENT_MAP truncation handling
- `backend/app/api/routes/tasks/crud.py` — Fixed missing fields in task creation

## Testing Results

```
Full suite: 115 passed, 1 skipped in 395.71s (0:06:35)
Zero online API calls — all AI via local Ollama
```

## How to Run

```bash
# Full suite
python -m pytest scripts/selenium_tests/ -v --tb=short \
  --html=scripts/selenium_tests/reports/report.html \
  --self-contained-html

# Single test file
python -m pytest scripts/selenium_tests/test_04_card_interview.py -v --tb=long

# View report
open scripts/selenium_tests/reports/report.html
```

## Status

**COMPLETED** — 115/116 tests passing (1 skipped due to pre-existing discovery-queue page error)
