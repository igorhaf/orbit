# PROMPT #105 - Docker Services Consolidation
## Remove Redundant postgres-rag Service

**Date:** January 25, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Infrastructure Optimization
**Impact:** Reduced complexity, removed redundant service

---

## Objective

Analyze docker-compose.yml for services with overlapping purposes and consolidate to keep only the best performing options.

**Key Requirements:**
1. Identify duplicate services
2. Keep services with better capabilities
3. Remove redundant services

---

## Analysis Results

### Services Analyzed (7 total):

| Service | Purpose | Image |
|---------|---------|-------|
| postgres | Main DB + Vectors | pgvector/pgvector:pg16 |
| backend | FastAPI | custom |
| frontend | Next.js | custom |
| redis | Cache | redis:7-alpine |
| ollama | Local LLM | ollama/ollama:latest |
| qdrant | Vector DB | qdrant/qdrant:latest |
| postgres-rag | RAG DB (redundant) | postgres:16 |

### Duplications Found:

#### postgres-rag vs postgres

| Aspect | postgres (KEEP) | postgres-rag (REMOVE) |
|--------|-----------------|----------------------|
| Image | pgvector/pgvector:pg16 | postgres:16 |
| pgvector | Yes | No |
| RAG capability | Complete | Limited |
| Port | 5432 | 5433 |

**Decision:** Remove `postgres-rag` because:
1. Main `postgres` already has pgvector extension
2. pgvector is specifically designed for vector embeddings/RAG
3. `postgres-rag` is plain PostgreSQL without pgvector
4. Having two PostgreSQL instances is wasteful

#### Qdrant vs pgvector

| Aspect | Qdrant | pgvector |
|--------|--------|----------|
| Type | Dedicated Vector DB | PostgreSQL Extension |
| Vector Performance | Excellent | Good |
| SQL+Vector Queries | No | Yes |
| Scaling | Horizontal | Vertical |

**Decision:** Keep BOTH - they serve complementary purposes:
- Qdrant: Pure semantic search, high performance
- pgvector: Hybrid SQL+vector queries

---

## What Was Implemented

### 1. Removed postgres-rag service
- Deleted service definition from docker-compose.yml
- Deleted `data/postgres-rag/` folder

### 2. Updated README.md
- Removed postgres-rag from services table
- Updated data persistence section
- Updated commands (removed postgres-rag references)
- Removed postgres-rag credentials section

### 3. Updated .gitignore
- Removed `data/postgres-rag/*` line

### 4. Updated data/.gitkeep
- Removed postgres-rag from folder structure

---

## Files Modified

1. **docker-compose.yml** - Removed postgres-rag service (~22 lines)
2. **README.md** - Updated documentation
3. **.gitignore** - Removed postgres-rag line
4. **data/.gitkeep** - Updated structure description
5. **data/postgres-rag/** - Deleted folder

---

## Result

### Before (7 services):
- postgres, backend, frontend, redis, ollama, qdrant, postgres-rag

### After (6 services):
- postgres, backend, frontend, redis, ollama, qdrant

### Services Summary:

| Service | Port | Status |
|---------|------|--------|
| postgres | 5432 | KEPT (has pgvector) |
| backend | 8000 | KEPT |
| frontend | 3000 | KEPT |
| redis | 6379 | KEPT |
| ollama | 11434 | KEPT |
| qdrant | 6333, 6334 | KEPT |
| postgres-rag | 5433 | REMOVED (redundant) |

---

## Verification

```bash
# Validate docker-compose
docker compose config --quiet

# Test remaining services
docker compose up -d postgres qdrant ollama
curl http://localhost:6333/collections
curl http://localhost:11434/api/tags
docker compose exec postgres psql -U orbit -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

---

## Status: COMPLETE

Successfully removed redundant `postgres-rag` service. The main PostgreSQL with pgvector provides complete RAG support.
