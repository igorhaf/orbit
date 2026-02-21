# PROMPT #235 - Satellite Knowledge Base
## Auto-create project KB + save AI execution logs to satellite/

**Date:** 2026-02-20
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** 5 files modified — projects now get a `satellite/` knowledge base folder on creation, and all significant AI executions are persisted as markdown files

---

## Objective

When creating a project, automatically:
1. Create a `satellite/` knowledge base folder inside `code_path` (even if the folder itself doesn't exist yet)
2. Save all significant AI execution logs as markdown files in `satellite/prompts/`

The folder name `satellite` was chosen as a metaphor for the ORBIT system — a satellite orbiting the project, collecting data and memory.

---

## What Was Implemented

### 1. `orbit_folder.py` — Renamed folder + new module-level helper

- Added `SATELLITE_DIR = "satellite"` constant
- Added `ensure_satellite_dirs(code_path: Path) -> Path` module-level function:
  - Creates `code_path` if it doesn't exist (`parents=True`)
  - Creates full KB structure: `prompts/`, `results/`, `knowledge/`, `docs/`, `rag/internal/`, `rag/docs/`
  - Adds `.gitkeep` to every leaf folder
  - Idempotent — safe to call multiple times
- Renamed all path references from `"orbit"` to `SATELLITE_DIR` throughout the class
- Updated `ensure_orbit_structure()` to delegate to `ensure_satellite_dirs()`
- Updated result file hint from `orbit/results/` to `satellite/results/`

### 2. `project_service.py` — KB initialization function

Added `initialize_project_knowledge_base(code_path, project_name) -> str`:
- Calls `ensure_satellite_dirs()` to create the full KB structure
- Creates `satellite/README.md` if not present (REGRA #0 — never overwrites)
- README documents the folder structure for the developer
- Returns the `satellite/` path as string

### 3. `projects.py` — Relaxed validation + auto-init

In `create_and_process_project` endpoint:
- **Before**: rejected if `code_path` didn't exist
- **After**: rejects only if `code_path` exists but is a file (not a directory)
- If `code_path` doesn't exist, `initialize_project_knowledge_base()` creates it with full KB structure before the project is saved to DB
- The subsequent background scan proceeds normally on the newly created folder

### 4. `ai_orchestrator.py` — Auto-save execution logs

Added:
- `_SAVE_USAGE_TYPES` constant: `{prompt_generation, task_execution, commit_generation, memory, pattern_discovery}` — `interview` and `general` excluded (too verbose / too broad)
- `_save_prompt_to_satellite(db, prompt_log)` module-level function:
  - Checks project has `code_path` and `satellite/prompts/` exists
  - Filename format: `{YYYY-MM-DD}_{usage_type}_{prompt_id[:8]}.md`
  - Content: model, status, token counts, cost, system prompt, user prompt, response
  - REGRA #0: never overwrites existing files
  - Wrapped in try/except — never fails the main execution
- Called after successful `db.commit()` in both the chain path and direct execution path

### 5. `codebase_memory.py` — Exclude satellite/ from tech stack analysis

Added `"satellite"` to `IGNORE_DIRECTORIES` alongside existing `"orbit"` entry, so the tech stack analyzer doesn't try to parse KB markdown files as source code.

---

## Folder Structure Created

```
{code_path}/
└── satellite/
    ├── prompts/     .gitkeep  ← exported card prompts + AI execution logs
    ├── results/     .gitkeep  ← Claude Code task results
    ├── knowledge/   .gitkeep  ← context files uploaded by user
    ├── docs/        .gitkeep  ← public documentation
    ├── rag/
    │   ├── internal/.gitkeep  ← implementation reports
    │   └── docs/   .gitkeep   ← general documentation
    └── README.md              ← auto-generated project description
```

---

## Files Modified

1. **backend/app/services/orbit_folder.py** — ensure_satellite_dirs(), SATELLITE_DIR, path rename
2. **backend/app/services/project_service.py** — initialize_project_knowledge_base()
3. **backend/app/api/routes/projects.py** — relaxed validation + KB init call
4. **backend/app/services/ai_orchestrator.py** — _SAVE_USAGE_TYPES, _save_prompt_to_satellite()
5. **backend/app/services/codebase_memory.py** — satellite in IGNORE_DIRECTORIES

---

## Testing Results

```
Backend imports: OK
app.main import: OK
ensure_satellite_dirs(existing_path): creates 7 subdirs correctly
ensure_satellite_dirs(non_existent_path): creates path + 7 subdirs correctly
```

---

## Compatibility

| Scenario | Result |
|----------|--------|
| `code_path` exists and is directory | Subfolders created (exist_ok=True) |
| `code_path` does not exist | Created with full KB structure |
| `code_path` is a file | Error 400 |
| AI execution without `project_id` | No file saved (DB only) |
| AI execution with `interview` type | No file saved (too verbose) |
| `satellite/prompts/` doesn't exist yet | Skips silently |
| File already exists | Not overwritten (REGRA #0) |

---

## Status: COMPLETE

**Key Achievements:**
- Projects now automatically get a satellite/ knowledge base on creation
- Paths that don't exist yet are created automatically
- All significant AI executions are persisted as readable markdown logs
- Full backward compatibility — existing projects with orbit/ folder unaffected
- All errors in file-write operations are non-critical (wrapped in try/except)
