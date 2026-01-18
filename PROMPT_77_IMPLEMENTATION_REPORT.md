# PROMPT #77 - Project-Specific Specs via RAG Discovery
## Replacing Generic Framework Specs with Project-Specific Patterns

**Date:** 2026-01-18
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation / Architecture Change
**Impact:** Major architectural change - specs are now project-specific, discovered via RAG

---

## Objective

Transform the specs system from generic framework-based JSON files to project-specific patterns discovered via internal RAG:

**Before:**
- 63 JSON files in `/backend/specs/` organized by technology (Laravel, Next.js, PostgreSQL, etc.)
- Generic specs applied based on project's stack configuration
- Static, manually maintained

**After:**
- Project-specific specs discovered via AI/RAG analysis
- Stored in database with `project_id` as key
- Dynamic, automatically discovered from project codebase
- Discovery queue for projects without specs

---

## What Was Implemented

### 1. Discovery Queue System

Created a queue system for projects awaiting pattern discovery:

- **Model:** `DiscoveryQueue` with status tracking (pending, processing, completed, dismissed, failed)
- **Migration:** Creates `discovery_queue` table with indexes
- **API Routes:** Full CRUD + process/dismiss actions
- **Frontend Page:** `/discovery-queue` with statistics and queue management

### 2. ProjectSpecFetcher Service

New service replacing JSON-based `SpecFetcher`:

- Queries specs from database by `project_id`
- Adds projects to discovery queue when no specs found
- Supports keyword filtering and RAG-based semantic search
- Falls back gracefully when RAG not available

### 3. PatternDiscoveryService Updates

Enhanced to save discovered patterns directly to database:

- New `_save_patterns_to_database()` method
- Creates/updates Spec records with discovery_metadata
- Stores confidence scores, occurrences, sample files, key characteristics

### 4. Removed JSON-Based Specs System

Deleted legacy components:
- `/backend/specs/` directory (63 JSON files)
- `spec_loader.py` service
- `spec_writer.py` service
- `spec_fetcher.py` (old version)
- `task_executor_old.py`
- `test_spec_loader.py`

### 5. Updated Existing Services

Modified to use database-based specs:
- `executor.py` - Now uses `ProjectSpecFetcher`
- `prompt_generator.py` - Queries specs from database by project_id
- `backlog_generator.py` - Removed spec_loader import
- `specs.py` routes - Removed JSON file operations

---

## Files Created

1. **[backend/alembic/versions/20260118000001_create_discovery_queue_table.py](backend/alembic/versions/20260118000001_create_discovery_queue_table.py)**
   - Migration for discovery_queue table
   - Indexes: project_id, status, created_at

2. **[backend/app/models/discovery_queue.py](backend/app/models/discovery_queue.py)**
   - DiscoveryQueue model
   - DiscoveryQueueStatus enum
   - Relationships to Project and Task

3. **[backend/app/services/task_execution/project_spec_fetcher.py](backend/app/services/task_execution/project_spec_fetcher.py)**
   - ProjectSpecFetcher service
   - Database-based spec fetching
   - Discovery queue integration

4. **[backend/app/api/routes/discovery_queue.py](backend/app/api/routes/discovery_queue.py)**
   - Full CRUD API for discovery queue
   - Process and dismiss actions
   - Bulk delete completed items

5. **[frontend/src/app/discovery-queue/page.tsx](frontend/src/app/discovery-queue/page.tsx)**
   - Discovery queue management UI
   - Statistics dashboard
   - Process/dismiss/delete actions

---

## Files Modified

1. **[backend/app/services/pattern_discovery.py](backend/app/services/pattern_discovery.py)**
   - Added `_save_patterns_to_database()` method
   - Modified `discover_patterns()` to save to database

2. **[backend/app/services/task_execution/executor.py](backend/app/services/task_execution/executor.py)**
   - Changed from SpecFetcher to ProjectSpecFetcher
   - Updated imports and initialization

3. **[backend/app/services/prompt_generator.py](backend/app/services/prompt_generator.py)**
   - Removed spec_loader import
   - Modified `_fetch_stack_specs()` to query database

4. **[backend/app/services/backlog_generator.py](backend/app/services/backlog_generator.py)**
   - Removed spec_loader import

5. **[backend/app/api/routes/specs.py](backend/app/api/routes/specs.py)**
   - Removed JSON file operations
   - All CRUD now database-only
   - Added project_id filter parameter

6. **[backend/app/api/routes/projects.py](backend/app/api/routes/projects.py)**
   - Added `POST /{project_id}/discover-specs` endpoint
   - Added `GET /{project_id}/specs` endpoint
   - Added `PATCH /{project_id}/specs/{spec_id}/toggle` endpoint

7. **[backend/app/main.py](backend/app/main.py)**
   - Added discovery_queue router registration

8. **[backend/app/models/__init__.py](backend/app/models/__init__.py)**
   - Added DiscoveryQueue, DiscoveryQueueStatus exports

9. **[backend/app/api/routes/__init__.py](backend/app/api/routes/__init__.py)**
   - Added discovery_queue import

---

## Files Deleted

1. `backend/specs/**/*.json` - 63 JSON spec files
2. `backend/app/services/spec_loader.py` - JSON spec loader
3. `backend/app/services/spec_writer.py` - JSON spec writer
4. `backend/app/services/task_execution/spec_fetcher.py` - Old spec fetcher
5. `backend/app/services/task_executor_old.py` - Old executor
6. `backend/scripts/test_spec_loader.py` - Test script

---

## Architecture Changes

### Before (JSON-based):
```
User selects stack (Laravel, Next.js, etc.)
    ↓
SpecLoader reads JSON files from /backend/specs/
    ↓
Generic specs applied to all projects with same stack
```

### After (Database-based with RAG):
```
User clicks "Discover Patterns" on project
    ↓
PatternDiscoveryService analyzes codebase via RAG
    ↓
Patterns saved to database with project_id
    ↓
Task execution queries project-specific specs

OR

Task execution runs without specs
    ↓
Project added to discovery_queue
    ↓
User reviews queue and triggers discovery
```

---

## API Endpoints

### Discovery Queue
- `GET /api/v1/discovery-queue/` - List queue items
- `GET /api/v1/discovery-queue/{id}` - Get single item
- `POST /api/v1/discovery-queue/{id}/process` - Trigger discovery
- `POST /api/v1/discovery-queue/{id}/dismiss` - Dismiss item
- `DELETE /api/v1/discovery-queue/{id}` - Delete item
- `DELETE /api/v1/discovery-queue/?status=completed` - Clear completed

### Project Specs (new endpoints on projects router)
- `POST /api/v1/projects/{project_id}/discover-specs` - Trigger discovery
- `GET /api/v1/projects/{project_id}/specs` - List project specs
- `PATCH /api/v1/projects/{project_id}/specs/{spec_id}/toggle` - Toggle active

---

## Testing

### Manual Testing:
```bash
# Check backend starts without errors
cd backend && python -c "from app.main import app; print('OK')"

# Check discovery queue API
curl http://localhost:8000/api/v1/discovery-queue/

# Check specs API (database-only)
curl http://localhost:8000/api/v1/specs/
```

### Verification:
- JSON files deleted
- spec_loader.py deleted
- No references to spec_loader in active code
- Discovery queue page accessible at /discovery-queue
- Specs page still functional (database-only)

---

## Key Insights

### 1. Infrastructure Already Existed
90% of the infrastructure was already in place:
- PatternDiscoveryService for AI-powered pattern discovery
- Spec model with project_id, scope, discovery_metadata fields
- RAGService for semantic search

### 2. Clean Architecture Transition
The transition from JSON to database was clean because:
- Spec model already supported project_id
- Discovery metadata field already existed
- Pattern discovery service just needed a save method

### 3. Fallback Strategy
Discovery queue provides graceful degradation:
- Projects without specs can still execute tasks
- Missing specs are queued for later discovery
- No blocking of user workflow

---

## Status: COMPLETE

**Key Achievements:**
- Removed 63 JSON spec files
- Implemented project-specific specs via RAG
- Created discovery queue system
- Updated all services to use database
- Created frontend management page

**Impact:**
- Specs are now unique per project
- Patterns are discovered from actual codebase
- More relevant context for AI during task execution
- Clean separation between projects

---
