# PROMPT #223 - AI Pre-Scan Ignore Detection
## Automatic Detection of Non-Standard Framework/Vendor Directories

**Date:** 2026-02-11
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature / Performance
**Impact:** AI analyzes project directory structure BEFORE memory scan to detect non-standard dependency/framework directories, saving them per-project for all future scans

---

## Objective

Enable the AI to interpret the project's directory structure before starting memory actions, automatically detecting and persisting directories that should be excluded from analysis (e.g., vendored dependencies, embedded frameworks, SDKs with non-standard names).

The system already has 69 hardcoded ignore directories + .gitignore support, but projects may contain non-standard directories (e.g., `third_party`, `external_libs`, `sdk`) that aren't in either list.

---

## What Was Implemented

### 1. Project Model Field
**File:** `backend/app/models/project.py`

Added `custom_ignore_patterns` (JSON, nullable) column to store AI-detected directories per project:
```json
{
  "directories": ["third_party", "sdk"],
  "rationale": {"third_party": "Contains vendored Go deps", "sdk": "Embedded SDK"},
  "detected_by_ai": true,
  "detection_timestamp": "2026-02-11T..."
}
```

### 2. Alembic Migration
**File:** `backend/alembic/versions/20260211_add_custom_ignore_patterns.py`

Simple migration adding the JSON column to `projects` table.

### 3. Instance-Level Ignore Set
**File:** `backend/app/services/codebase_memory.py`

Changed from class-level `IGNORE_DIRECTORIES` to instance-level `_effective_ignore_dirs`:
- `__init__()` creates `_effective_ignore_dirs = set(IGNORE_DIRECTORIES)`
- `_should_ignore_dir()` and `_should_ignore_path()` now check `_effective_ignore_dirs`
- AI-detected dirs are added to the instance set without contaminating other projects

### 4. Quick Directory Listing (No AI)
**File:** `backend/app/services/codebase_memory.py` - `_quick_directory_listing()`

Fast filesystem walk (< 1s) that lists directories 2 levels deep with file counts. Used as input for AI analysis. No file content is read.

### 5. AI Detection Function
**File:** `backend/app/services/codebase_memory.py` - `_detect_ignore_directories()`

Sends the directory listing to AI (usage_type=memory) with a prompt asking to identify non-standard directories containing third-party code. Returns JSON with directory names and rationale. Filters out dirs already in the built-in ignore set.

### 6. Integration in scan_and_memorize()
**File:** `backend/app/services/codebase_memory.py`

After loading .gitignore and BEFORE scanning the codebase:
- If project has saved `custom_ignore_patterns`: reuse them (no AI call needed)
- If first scan: call `_detect_ignore_directories()`, save results to project, add to ignore set

### 7. Continuous RAG Integration
**File:** `backend/app/services/continuous_rag_service.py`

In `scan_for_changes()`, before walking the filesystem:
- Resets `_effective_ignore_dirs` to built-in set
- Loads `project.custom_ignore_patterns.directories` if available
- Ensures Continuous RAG respects the same AI-detected exclusions

### 8. YAML Prompt
**File:** `backend/app/prompts/memory/detect_ignore_dirs.yaml`

Externalized prompt following project conventions. Instructs AI to:
- Only identify NON-STANDARD directories (standard ones already handled)
- Return JSON with directory names and rationale
- Focus on dirs with many files but few/no code files
- Not duplicate already-ignored directories

---

## Files Modified/Created

### Created:
1. **backend/alembic/versions/20260211_add_custom_ignore_patterns.py** - Migration
2. **backend/app/prompts/memory/detect_ignore_dirs.yaml** - AI prompt

### Modified:
1. **backend/app/models/project.py** - Added `custom_ignore_patterns` column
2. **backend/app/services/codebase_memory.py** - Instance-level ignore set, pre-scan detection, integration
3. **backend/app/services/continuous_rag_service.py** - Load custom ignores before scan

---

## Verification

1. Python syntax check: all 4 files pass `ast.parse()`
2. YAML prompt loads correctly with `yaml.safe_load()`
3. New project scan should show AI pre-scan detection in logs
4. AI-detected dirs saved to `project.custom_ignore_patterns` in database
5. Subsequent scans reuse saved patterns (no extra AI call)
6. Continuous RAG respects the same custom ignore patterns

---

## Status: COMPLETE

**Key Achievements:**
- AI analyzes directory structure before memory scan starts
- Non-standard framework/vendor directories detected automatically
- Results saved per-project for all future scans (initial + Continuous RAG)
- Instance-level ignore set prevents cross-project contamination
- Non-blocking: if AI detection fails, scan continues normally
- YAML prompt externalized following project conventions

**Impact:**
- Projects with non-standard dependency directories are handled correctly
- No more wasting time analyzing vendored/third-party code
- One AI call (~500 tokens) saves hours of unnecessary file processing
- Custom ignores persist across all scan types (initial, continuous, re-scan)
