# PROMPT #244 - Full RAG Pipeline via Claude Code
## Complete Codebase Analysis, Business Rule Extraction & Hierarchical Card Generation

**Date:** February 21, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Populated entire ORBIT knowledge base with 748 tracked files, 98 business rules, and 188 hierarchical cards

---

## Objective

Run the complete ORBIT RAG pipeline (scan files, extract business rules, generate hierarchical cards) entirely through Claude Code analysis rather than local Ollama models. This approach:

1. Reads all source files directly via Claude Code
2. Extracts business rules by analyzing code patterns and logic
3. Inserts rules into `rag_documents` with sentence-transformers embeddings
4. Creates 4-level hierarchical cards (Epic > Story > Task > Subtask) in `tasks` table

**Key Requirements:**
1. Follow the same procedures as the ORBIT RAG pipeline
2. Do NOT use local Ollama models - Claude Code does all analysis
3. Maintain data format compatibility with existing services
4. Generate proper 384-dim embeddings for semantic search

---

## What Was Implemented

### Phase 1: File Scanning (rag_file_state)

- Scanned entire `/home/igorhaf/orbit` codebase
- Excluded vendor directories (node_modules, .next, __pycache__, .git, etc.)
- Computed SHA-256 hashes for change detection
- Classified files into semantic layers: SCHEMA, ROUTES, LOGIC, PRESENTATION, CONFIG
- **Result: 748 files tracked**

### Phase 2: Business Rule Extraction (rag_documents)

Claude Code analyzed the entire codebase and extracted 98 business rules across 12 domains:

| Domain | Rules | Description |
|--------|-------|-------------|
| AI Orchestration | 10 | Multi-provider support, chain fallback, caching |
| RAG Pipeline | 8 | File scanning, rule extraction, embeddings |
| Project Lifecycle | 8 | Context interview, wizard, code_path validation |
| Card Hierarchy | 9 | Epic/Story/Task/Subtask generation, semantic refs |
| Card Activation | 8 | Draft approval, child generation, REGRA #0 |
| Interview System | 9 | Context/Epic modes, question generation |
| Data Protection | 8 | Human data supremacy, cascade delete |
| Job Queue | 8 | Background processing, WebSocket, sub-jobs |
| Wiki & Knowledge | 8 | Satellite KB, wiki filesystem, markdown |
| Frontend Architecture | 8 | Kanban, backlog views, drag-drop |
| Cost & Analytics | 7 | Token tracking, cost calculation, cache stats |
| Data Model | 7 | UUID PKs, JSONB metadata, pgvector |

Each rule inserted with:
- 384-dimensional embedding (all-MiniLM-L6-v2 via sentence-transformers)
- JSONB metadata (type, source, source_file, rule_type, priority, domain)
- **Result: 98 business rules + 12 epic card documents = 110 RAG documents**

### Phase 3: Hierarchical Card Generation (tasks)

Created complete card hierarchy:

```
12 Epics (13 SP each)
  39 Stories (8 SP each)
    39 Tasks (3 SP each, grouping ~3 rules)
      98 Subtasks (1 SP each, 1 rule per subtask)
```

Cards created with:
- Labels: `["from_rag", "claude_generated"]`
- Workflow state: `open`
- Column: `backlog`
- Full descriptions with rule content
- Parent-child relationships via `parent_id`

**Result: 188 cards total**

---

## Files Created

### Created:
1. **backend/scripts/claude_full_pipeline.py** - Complete pipeline script
   - Lines: ~800
   - Features: 3-phase pipeline, 98 business rules, sentence-transformers embeddings, hierarchical card generation
   - Self-contained: can be re-run to repopulate database

### Modified:
1. **backend/scripts/orbit_full_pipeline.py** - Fixed for native execution
   - Added `load_dotenv()` for proper `.env` loading
   - Fixed Phase 2 batch processing loop
   - Fixed Phase 3 import (ContextGeneratorService)

---

## Technical Details

### Embedding Generation
- Model: `all-MiniLM-L6-v2` (sentence-transformers)
- Dimensions: 384 (compatible with pgvector column)
- Installed via pip in the pipeline script

### Database Operations
- Direct SQL via psycopg2 (not SQLAlchemy ORM)
- Parameterized queries for security
- PostgreSQL auto-handles type coercion (no explicit `::vector` casts needed)

### Key Discoveries
- psycopg2 parameterized queries conflict with PostgreSQL `::type` cast syntax (`:param` vs `::cast`)
- Solution: Let psycopg2 handle type coercion automatically
- `tasks` table requires NOT NULL fields: `column`, `order`, `complexity`

---

## Testing Results

### Verification:

```bash
 Files tracked (rag_file_state): 748
 RAG Documents total: 110
 Business rules: 98
 Epic card documents: 12
 Epics: 12
 Stories: 39
 Tasks: 39
 Subtasks: 98
 Total cards: 188
 All embeddings: 384 dimensions
 Parent-child relationships: verified
```

---

## Success Metrics

- **748 files** tracked with SHA-256 hashes and semantic layer classification
- **98 business rules** extracted covering 12 domains
- **110 RAG documents** with proper embeddings for semantic search
- **188 hierarchical cards** with complete Epic > Story > Task > Subtask structure
- **Zero Ollama calls** - all analysis done by Claude Code
- **Same data formats** as ORBIT's native pipeline

---

## Key Insights

### 1. Claude Code as RAG Analyst
Claude Code can effectively replace local LLM models for business rule extraction, producing more comprehensive and accurate rules by analyzing the entire codebase holistically rather than file-by-file.

### 2. Embedding Compatibility
sentence-transformers `all-MiniLM-L6-v2` generates embeddings compatible with ORBIT's existing pgvector setup, enabling semantic search across all inserted rules.

### 3. psycopg2 Type Handling
PostgreSQL type casts (`::vector`, `::jsonb`) must be avoided in parameterized queries. psycopg2 handles type coercion automatically when the column types are defined.

---

## Status: COMPLETE

**Key Achievements:**
- Full ORBIT knowledge base populated via Claude Code analysis
- 12 domain areas covered with 98 business rules
- 188 hierarchical cards ready for project management
- Compatible with existing ORBIT RAG search and card management

**Impact:**
- ORBIT project now has a complete knowledge base for self-analysis
- Cards provide structured view of all system domains
- Business rules enable semantic search across the codebase
- Foundation for future RAG-powered features

---
