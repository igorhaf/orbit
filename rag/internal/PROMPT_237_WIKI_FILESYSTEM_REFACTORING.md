# PROMPT #237 - Wiki Filesystem Refactoring
## Migrate wiki storage from PostgreSQL to satellite/wiki/ .md files

**Date:** 2026-02-21
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Refactor
**Impact:** Wiki pages now stored as .md files with YAML front matter in satellite/wiki/ - enables git-trackable wiki, eliminates DB dependency for wiki CRUD

---

## Objective

Migrate the ORBIT wiki system from PostgreSQL database storage (`wiki_pages` table) to 100% filesystem-based storage using `.md` files with YAML front matter inside each project's `{code_path}/satellite/wiki/` directory.

**Key Requirements:**
1. Wiki pages stored as `.md` files with YAML front matter (title, slug, source, order_index, timestamps)
2. Subfolder hierarchy represents parent-child relationships (`foo.md` + `foo/` directory for children)
3. Database completely dispensed for wiki CRUD operations
4. All existing features preserved: auto-generation, enrichment, semantic links
5. REGRA #0 enforced: manual/enrichment pages never overwritten by auto-generated content
6. Zero frontend changes - same API response format with deterministic UUIDs
7. WikiPage model kept in codebase to prevent Alembic from dropping the table

---

## Pattern Analysis

### File Format
```markdown
---
title: "Visao Geral"
slug: visao-geral
source: ai_generated
order_index: 0
created_at: "2026-02-20T12:00:00Z"
updated_at: "2026-02-20T12:00:00Z"
---

Markdown content here...
```

### Hierarchy via Filesystem
```
satellite/wiki/
  visao-geral.md                    (root page, order=0)
  regras-de-negocio.md              (root page with children)
  regras-de-negocio/                (children directory)
    indice-de-regras.md
    dominio-auth.md
```

### UUID Stability
Deterministic UUIDs via `uuid5(NAMESPACE_URL, f"{project_id}:{slug}")` - same slug always produces same ID for frontend compatibility.

---

## What Was Implemented

### 1. Core Filesystem Layer (wiki_fs.py)
New module providing all wiki filesystem operations:
- `WikiFileInfo` dataclass with all page metadata
- `_deterministic_id()` for stable UUID generation
- `_parse_front_matter()` / `_render_front_matter()` for YAML handling
- `_find_page_path()` recursive slug lookup via rglob
- `read_page()`, `write_page()`, `delete_page()`, `list_pages()`, `build_tree()`
- `page_exists()`, `ensure_unique_slug()`, `apply_semantic_links()`
- `page_to_response()` converts WikiFileInfo to API-compatible dict
- REGRA #0 protection in `write_page()`: refuses to overwrite manual/enrichment with ai_generated

### 2. Satellite Directory Update (orbit_folder.py)
Added `"wiki"` to the satellite subdirectories created by `ensure_satellite_dirs()`.

### 3. Complete Route Rewrite (wiki.py)
All 8+ endpoints rewritten:
- `GET /list` - `wiki_fs.list_pages()` + `page_to_response()`
- `GET /tree` - `wiki_fs.build_tree()` with deterministic IDs
- `GET /{slug}` - `wiki_fs.read_page()` + `page_to_response()`
- `POST /create` - `wiki_fs.write_page()` with parent_id UUID-to-slug resolution
- `PUT /{slug}` - `wiki_fs.write_page()` marking source="manual" on edit
- `DELETE /{slug}` - `wiki_fs.delete_page()`
- `POST /generate` - calls `_upsert_wiki_page(code_path, ...)` instead of DB
- `POST /enrich` - counts rule pages from filesystem
- `POST /relink` - applies semantic links via `wiki_fs.apply_semantic_links()`

### 4. Wiki Service Refactor (wiki_service.py)
- `_upsert_wiki_page` signature: `(db, project_id, ...)` -> `(code_path, project_id, ...)`
- `parent_id` parameter -> `parent_slug`
- `_build_business_rules_wiki_pages` signature: `(db, project_id)` -> `(db, code_path, project_id)`
- `_enrich_rules_background` reads/writes via wiki_fs
- `_apply_semantic_links_to_project` renamed to `_apply_semantic_links_to_project_fs`
- All WikiPage model imports removed

### 5. External Callers Updated
- **project_service.py**: Wiki enrichment section uses code_path-based calls
- **watchdog.py**: Wiki enrichment job uses filesystem operations, removed db.commit() after wiki ops
- **pipeline_wiki.py**: All DB queries replaced with wiki_fs operations

---

## Files Modified/Created

### Created:
1. **backend/app/services/wiki_fs.py** - Core filesystem layer
   - ~280 lines
   - Features: read/write/delete/list/tree/exists/unique_slug/semantic_links/page_to_response

### Modified:
1. **backend/app/services/orbit_folder.py** - Added "wiki" to satellite subdirs
2. **backend/app/api/routes/wiki.py** - Complete rewrite of all endpoints to use wiki_fs
3. **backend/app/services/wiki_service.py** - Refactored all DB operations to filesystem
4. **backend/app/services/project_service.py** - Updated wiki enrichment calls
5. **backend/app/services/watchdog.py** - Updated wiki enrichment job
6. **backend/app/services/pipeline_wiki.py** - Rewritten to use wiki_fs

---

## Testing Results

### Verification:

```bash
Backend import: poetry run python -c "import app.main" -> OK
Frontend build: npm run build -> OK (all pages compiled successfully)
Wiki pages route: /projects/[id]/wiki -> compiled
Wiki slug route: /projects/[id]/wiki/[slug] -> compiled
```

---

## Success Metrics

- **Zero frontend changes**: API response format unchanged, deterministic UUIDs ensure stability
- **REGRA #0 enforced**: write_page() refuses to overwrite manual/enrichment pages
- **Full feature parity**: generate, enrich, semantic links, tree hierarchy all preserved
- **Git-trackable wiki**: .md files in satellite/wiki/ can be version-controlled with project code
- **Clean separation**: DB used only for Project lookup and RAG queries, not wiki CRUD

---

## Key Insights

### 1. Deterministic UUIDs are essential
Frontend needs stable IDs for parent_id references and component keys. Using uuid5(NAMESPACE_URL, f"{project_id}:{slug}") ensures the same page always gets the same UUID without any database.

### 2. WikiPage model kept for Alembic safety
Removing the SQLAlchemy model would cause Alembic to generate a DROP TABLE migration. Keeping it prevents accidental data loss during migration transitions.

### 3. Hierarchy through filesystem is natural
Using directories to represent parent-child relationships is intuitive and makes the wiki browsable in any file explorer or IDE. `_parent_slug_from_path()` derives hierarchy from directory structure.

### 4. DB still needed for supporting operations
RAG queries (rag_documents table), Project lookups, and job management still require database access. Only wiki page CRUD moved to filesystem.

---

## Status: COMPLETE

**Key Achievements:**
- Wiki storage fully migrated from PostgreSQL to filesystem (.md files)
- All 8+ API endpoints rewritten for filesystem operations
- 7 files created/modified across backend
- REGRA #0 (Human Data Supremacy) enforced at filesystem layer
- Zero frontend changes required
- Backend imports and frontend build verified

**Impact:**
- Wiki pages are now git-trackable alongside project source code
- Eliminates database dependency for wiki CRUD
- Enables offline wiki editing through any text editor
- Preserves all existing features: auto-generation, enrichment, semantic links, hierarchy

---
