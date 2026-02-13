# PROMPT #236 - Memory Scan File Limit Fix
## Fix: Only 5 of 30 Files Scanned + Reading Backup Directories

**Date:** February 12, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Projects with 30+ files now scan proportionally instead of only 5 files

---

## Objective

Fix two bugs in the Memory Scan feature:
1. Only 5 files analyzed regardless of project size (30 files -> only 5 scanned)
2. `.claude-backups/` directory not excluded, causing irrelevant backup files to be analyzed

**Key Requirements:**
1. Proportional file scanning based on project size
2. Exclude backup directories from scanning
3. Improve Ollama auto-detection logging

---

## Root Cause Analysis

### Bug 1: Only 5 Files Scanned
Three stacked limits caused the problem:

1. **Ollama auto-detection** (line 650-655): Silently overrides `scan_depth="normal"` to `"local"` when Ollama detected
2. **Local mode max_files=15**: Only extracts 15 files from project
3. **Chain prompting hardcoded to 5**: `max_files = 5` regardless of available files

Result: 30-file project -> 15 extracted -> only 5 analyzed

### Bug 2: `.claude-backups` Not Excluded
The `IGNORE_DIRECTORIES` set (lines 115-184) was missing `.claude-backups` and similar backup directories. Files like `Controllers/Auth/AuthController.php` inside `.claude-backups/` matched `BUSINESS_LOGIC_PATTERNS` and scored high enough to be selected for analysis.

---

## What Was Fixed

### 1. Added Backup Directories to IGNORE_DIRECTORIES
Added 4 new entries: `.claude-backups`, `backups`, `backup`, `.backups`, `_backups`

### 2. Chain Prompting: Proportional File Limit
Replaced hardcoded `max_files = 5` with proportional formula:
```python
max_files = max(5, min(25, available_count * 50 // 100))
```
- Analyzes ~50% of available files
- Minimum: 5 files (small projects still get coverage)
- Maximum: 25 files (cap for very large projects)

| Project files | Before | After |
|---|---|---|
| 10 | 5 | 5 |
| 15 | 5 | 7 |
| 20 | 5 | 10 |
| **30** | **5** | **15** |
| 50 | 5 | 25 |

### 3. Local Mode max_files Increased
Changed from 15 to 50 so `_extract_code_samples()` returns enough files for chain prompting to pick a proportional subset.

### 4. Ollama Override Logging Improved
Now logs the original scan_depth, the model name, and explains the change.

---

## Files Modified

### Modified:
1. **backend/app/services/codebase_memory.py**
   - `IGNORE_DIRECTORIES`: Added `.claude-backups`, `backups`, `backup`, `.backups`, `_backups`
   - `SCAN_DEPTH_CONFIG["local"]["max_files"]`: 15 -> 50
   - `_chain_prompting_analysis()`: `max_files = 5` -> proportional formula
   - Ollama auto-detection: improved logging with original_depth tracking

---

## Testing Results

```bash
1. .claude-backups + backups: present in IGNORE_DIRECTORIES
2. Chain prompting proportional formula: present
3. Local mode max_files: 50
4. Ollama override logging: improved
5. Backend restart: clean (no errors)
```

---

## Status: COMPLETE

**Key Achievements:**
- 30-file projects now scan 15 files instead of 5 (3x improvement)
- `.claude-backups/` and backup directories fully excluded
- Proportional scaling adapts to any project size
- No breaking changes to scan API or frontend

---
