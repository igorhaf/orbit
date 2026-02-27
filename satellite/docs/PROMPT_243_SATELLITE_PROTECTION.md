# PROMPT #243 - Satellite Folder Protection (Sacred Knowledge Base)

**Date:** 2026-02-21
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Security / Data Protection
**Impact:** The satellite/ knowledge base folder is now permanently protected from deletion. No automated process can remove it, its structural directories, or its .gitkeep files. A critical Path-joining vulnerability that could have deleted entire codebases was also fixed.

---

## Objective

Ensure that the `satellite/` folder at the root of any project's `code_path`, once created, can NEVER be deleted — neither the folder itself nor its contents. This applies to ALL projects, including the ORBIT project itself.

**Key Requirements:**
1. Project deletion must NEVER delete the satellite folder or the code_path
2. No automated cleanup can remove satellite/ structural directories
3. Wiki cleanup must not traverse above its root into satellite/ ancestors
4. .gitkeep structural files must be protected
5. Fix critical Path-joining vulnerability in project deletion

---

## Critical Vulnerability Fixed

### Path-joining Bug in Project Deletion

The project delete endpoint had this code:
```python
projects_dir = Path("/projects")
project_path = projects_dir / project.project_folder
if project_path.exists():
    shutil.rmtree(project_path)  # DANGER!
```

In Python, `Path("/projects") / "/home/igorhaf/orbit"` resolves to `/home/igorhaf/orbit` because joining with an absolute path replaces the entire path. This means `shutil.rmtree` would have deleted the **entire codebase** including satellite/.

**Fix:** Removed all disk deletion from project deletion. ORBIT does not own the user's code_path — it only manages database records.

---

## What Was Implemented

### 1. Project Deletion — No Disk Deletion (projects.py)

Replaced `shutil.rmtree` block with a log message confirming files are preserved. ORBIT's project deletion now only removes database records (CASCADE handles all related tables). The user's code_path and satellite/ folder are never touched.

### 2. Satellite Protection Guards (orbit_folder.py)

Added three protection mechanisms:

- **`SATELLITE_PROTECTED_DIRS`**: Frozen set of all 7 structural paths that can never be deleted (satellite/, satellite/memory, satellite/docs, satellite/knowledge, satellite/knowledge/wiki, satellite/knowledge/results, satellite/knowledge/prompts)

- **`is_satellite_protected(path, code_path)`**: Checks if a given path is a protected satellite directory. Returns True for any of the 7 structural paths.

- **`safe_rmtree(path, code_path)`**: Safe wrapper around `shutil.rmtree` with 3 blocking rules:
  1. Never delete code_path itself
  2. Never delete satellite/ or its protected subdirectories
  3. Never delete a parent of satellite/ (which would destroy it)

### 3. Knowledge File Protection (.gitkeep)

Updated `delete_knowledge_file()` to refuse deletion of `.gitkeep` structural files. Individual user-uploaded files in satellite/docs/ can still be managed by the user.

### 4. Wiki Cleanup Safety (wiki_fs.py)

Added explicit guard in the empty-directory cleanup loop to stop if it ever reaches a satellite structural directory name (satellite, knowledge, wiki). This is a defense-in-depth measure on top of the existing `parent != wiki` check.

---

## Files Modified

### Modified:
1. **backend/app/api/routes/projects.py** - Removed shutil.rmtree from project deletion, replaced with preservation log
2. **backend/app/services/orbit_folder.py** - Added SATELLITE_PROTECTED_DIRS, is_satellite_protected(), safe_rmtree(), .gitkeep protection in delete_knowledge_file()
3. **backend/app/services/wiki_fs.py** - Added satellite structural directory guard in cleanup loop

---

## Testing Results

```
Backend syntax check: All 3 files parse correctly
Frontend build: SUCCESS (no regressions)

Protection logic verification:
  ✅ is_satellite_protected(satellite) = True
  ✅ is_satellite_protected(satellite/memory) = True
  ✅ is_satellite_protected(satellite/docs) = True
  ✅ is_satellite_protected(satellite/knowledge) = True
  ✅ is_satellite_protected(satellite/knowledge/wiki) = True
  ✅ is_satellite_protected(satellite/knowledge/results) = True
  ✅ is_satellite_protected(satellite/knowledge/prompts) = True
  ✅ is_satellite_protected(satellite/docs/my_file.pdf) = False (user files manageable)
  ✅ is_satellite_protected(satellite/knowledge/wiki/page.md) = False (wiki pages manageable)
  ✅ is_satellite_protected(src/main.py) = False (non-satellite paths unaffected)

Vulnerability verification:
  ⚠️ Path("/projects") / "/home/igorhaf/orbit" = /home/igorhaf/orbit
  → This would have deleted the entire codebase! Now fixed.
```

---

## Key Insights

### 1. Python Path Joining Vulnerability
`Path("a") / "/b"` resolves to `/b` (absolute path replaces). Any code that joins user-provided paths must validate they are relative, not absolute. The old code blindly joined `project_folder` which could be an absolute path.

### 2. ORBIT Doesn't Own code_path
The `code_path` points to the user's existing codebase. ORBIT should never delete it. Only database records are ORBIT-managed; files on disk belong to the user.

### 3. Defense in Depth
Protection is applied at 3 levels:
- **Level 1**: Project deletion doesn't touch the filesystem at all
- **Level 2**: `is_satellite_protected()` guard function available for any future code
- **Level 3**: `safe_rmtree()` wrapper refuses to delete protected paths
- **Level 4**: Wiki cleanup has explicit structural directory guard

---

## Status: COMPLETE

**Key Achievements:**
- Satellite folder is permanently protected from all automated deletion
- Critical Path-joining vulnerability that could delete entire codebases is fixed
- .gitkeep structural files are protected
- Wiki cleanup has defense-in-depth guard
- All 7 satellite structural directories are in a protected frozen set
- Protection functions available for any future code that needs safe deletion
