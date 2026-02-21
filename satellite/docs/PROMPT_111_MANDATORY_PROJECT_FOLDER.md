# PROMPT #111 - Mandatory Project Folder
## Making code_path Required and Immutable

**Date:** January 26, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** All project creation flows now require an existing code folder path

---

## Objective

Make the `code_path` field **REQUIRED** and **IMMUTABLE** for projects. ORBIT focuses on analyzing existing code, not provisioning new projects.

**Key Requirements:**
1. `code_path` is mandatory when creating a project
2. `code_path` cannot be edited after creation
3. Path must exist and be a directory (validated on backend)
4. Remove automatic folder provisioning
5. Update frontend wizard to collect code_path

---

## What Was Implemented

### 1. Backend - Schema Changes

**File:** `backend/app/schemas/project.py`
- Made `code_path` **REQUIRED** in `ProjectCreate` with validation
- **REMOVED** `code_path` from `ProjectUpdate` (immutable)

```python
class ProjectCreate(ProjectBase):
    code_path: str = Field(..., min_length=1, max_length=500,
        description="Path to project code folder (required, immutable after creation)")

class ProjectUpdate(BaseModel):
    # code_path REMOVED - immutable after creation
```

### 2. Backend - Route Validation

**File:** `backend/app/api/routes/projects.py`
- Added path existence validation
- Added directory check
- Removed automatic folder provisioning

```python
@router.post("/")
async def create_project(project: ProjectCreate, db: Session = Depends(get_db)):
    code_path = Path(project.code_path)
    if not code_path.exists():
        raise HTTPException(400, f"Code path does not exist: {project.code_path}")
    if not code_path.is_dir():
        raise HTTPException(400, f"Code path is not a directory: {project.code_path}")
    # ... create project with code_path
```

### 3. Backend - Model Update

**File:** `backend/app/models/project.py`
- Changed `code_path` from `nullable=True` to `nullable=False`

### 4. Database Migration

**File:** `backend/alembic/versions/20260126120000_make_code_path_required.py`
- Fills existing NULL values with placeholder
- Alters column to NOT NULL

### 5. Frontend - TypeScript Types

**File:** `frontend/src/lib/types.ts`
- Added `code_path: string` to `Project` interface
- Added `code_path: string` to `ProjectCreate` interface
- Added comment noting `code_path` is NOT in `ProjectUpdate` (immutable)

### 6. Frontend - Project Creation Wizard

**File:** `frontend/src/app/projects/new/page.tsx`
- Added `codePath` state variable
- Added required input field for Code Folder Path
- Updated validation to require code_path
- Updated button disabled state

### 7. Frontend - Projects Page Edit Dialog

**File:** `frontend/src/app/projects/page.tsx`
- Removed `code_path` from `formData` state
- Removed `code_path` input from Edit Dialog
- Added read-only display of `code_path` in Edit Dialog
- Added `code_path` display in project cards

---

## Files Modified/Created

### Created:
1. **backend/alembic/versions/20260126120000_make_code_path_required.py** - Migration for NOT NULL

### Modified:
1. **backend/app/schemas/project.py** - code_path required in Create, removed from Update
2. **backend/app/api/routes/projects.py** - Path validation, removed provisioning
3. **backend/app/models/project.py** - nullable=False
4. **frontend/src/lib/types.ts** - Added code_path to interfaces
5. **frontend/src/app/projects/new/page.tsx** - Added code_path input
6. **frontend/src/app/projects/page.tsx** - Read-only code_path in Edit Dialog

---

## Testing Results

### API Tests:

```bash
# Without code_path - 422 Error
curl -X POST http://localhost:8000/api/v1/projects/ -d '{"name": "Test"}'
{"detail":[{"type":"missing","loc":["body","code_path"],"msg":"Field required"}]}

# With non-existent path - 400 Error
curl -X POST http://localhost:8000/api/v1/projects/ -d '{"name": "Test", "code_path": "/nao/existe"}'
{"detail":"Code path does not exist: /nao/existe"}

# With valid path - 201 Created
curl -X POST http://localhost:8000/api/v1/projects/ -d '{"name": "Test", "code_path": "/app"}'
{"name":"Test","code_path":"/app",...}

# Update with code_path - IGNORED (immutable)
curl -X PATCH http://localhost:8000/api/v1/projects/{id} -d '{"name": "New Name", "code_path": "/other"}'
# code_path remains original value
```

---

## Success Metrics

| Metric | Result |
|--------|--------|
| API rejects missing code_path | 422 Validation Error |
| API rejects non-existent path | 400 Bad Request |
| API rejects non-directory path | 400 Bad Request |
| API creates with valid path | 201 Created |
| API update ignores code_path | code_path unchanged |
| Frontend wizard requires path | Button disabled until filled |
| Edit Dialog shows read-only | No editable input |

---

## Impact

| Before | After |
|--------|-------|
| `code_path` optional | `code_path` **REQUIRED** |
| `code_path` editable | `code_path` **IMMUTABLE** |
| Automatic folder provisioning | Folder must exist |
| Wizard asks only for name | Wizard asks name + folder |
| Project can exist without code | Project = existing code folder |

---

## Key Insights

### 1. Philosophy Change
ORBIT now assumes all projects are tied to existing codebases. This aligns with the tool's purpose of **analyzing** code rather than **provisioning** infrastructure.

### 2. Immutability Pattern
Using `code_path` immutability ensures:
- Consistency in pattern discovery
- Stable reference for code indexing
- Predictable behavior for RAG integration

### 3. Validation at Creation
Path validation happens at project creation time, failing fast if the path is invalid. This prevents orphaned projects.

---

## Status: COMPLETE

**Key Achievements:**
- `code_path` is now mandatory and immutable
- Backend validates path existence and directory type
- Frontend wizard collects code_path
- Edit dialog shows code_path as read-only
- Migration updates existing database records

**Commit:** `15ff343` - feat: make code_path required and immutable for projects

---

## Enhancement: Folder Picker Component

**Date:** January 26, 2026
**Commit:** `92146b3` - feat: add FolderPicker component for code path selection

### Objective

Add a visual folder browser to the project creation wizard, similar to VS Code's project opening experience. Users can now click a browse button to navigate and select folders from the mounted `/projects` directory.

### What Was Added

#### 1. Backend - Browse Folders Endpoint

**File:** `backend/app/api/routes/projects.py`
- New endpoint `GET /browse-folders?path=<relative_path>`
- Lists directories within `/projects` mount point
- Detects project folders (has `.git`, `package.json`, etc.)
- Sanitizes paths to prevent directory traversal attacks
- Returns: current_path, relative_path, parent_path, folders[], can_select

```python
@router.get("/browse-folders")
async def browse_folders(path: str = Query("", description="Relative path within /projects")):
    """Browse folders within the mounted /projects directory."""
    # Returns list of directories with is_project detection
```

#### 2. Frontend - API Function

**File:** `frontend/src/lib/api.ts`
- Added `browseFolders(path: string)` function to projectsApi

#### 3. Frontend - FolderPicker Component

**File:** `frontend/src/components/ui/FolderPicker.tsx` (NEW - 273 lines)
- Full directory navigation with breadcrumbs
- Single-click to select folder
- Double-click to navigate into folder
- Up/Root navigation buttons
- Project detection (shows "Project" badge for folders with .git, package.json, etc.)
- Selected folder preview before confirmation
- Dialog-based UI following project patterns

#### 4. Frontend - Wizard Integration

**File:** `frontend/src/app/projects/new/page.tsx`
- Import FolderPicker component
- Added `showFolderPicker` state
- Browse button next to code path input
- FolderPicker integration with onSelect callback

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/components/ui/FolderPicker.tsx` | **Created** | 273 lines - Full folder picker component |
| `frontend/src/components/ui/index.ts` | Modified | Export FolderPicker |
| `frontend/src/lib/api.ts` | Modified | Added browseFolders function |
| `frontend/src/app/projects/new/page.tsx` | Modified | Integrated FolderPicker |
| `backend/app/api/routes/projects.py` | Modified | Added /browse-folders endpoint |

### User Experience

1. User clicks folder icon button next to "Code Folder Path" input
2. Dialog opens showing `/projects` directory contents
3. User navigates by double-clicking folders or using Up/Root buttons
4. Single-click selects a folder (highlighted in blue)
5. "Select Folder" button confirms selection
6. Path is automatically filled in the input field

### Success Metrics

| Feature | Status |
|---------|--------|
| Backend endpoint returns folder list | Working |
| Project detection (git, package.json) | Working |
| Navigation (Up, Root, double-click) | Working |
| Single-click folder selection | Working |
| Path injection into wizard | Working |
| Dialog follows UI patterns | Consistent |

---
