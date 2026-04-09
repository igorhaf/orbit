# RAG System

Retrieval-Augmented Generation (RAG) provides semantic search over project knowledge to enrich AI responses with relevant context.

## Architecture

```
Codebase → File Indexer → Nomic Embed Text → pgvector (768-dim)
                                                    ↓
AI Request → RAG Search → Top-K results → Injected into AI prompt
```

## Document Types

| Type | Source | Description |
|------|--------|-------------|
| `code_file` | Codebase scan | Source code files |
| `business_rule` | Pipeline Phase 2 | Extracted business rules |
| `card` | Backlog | Epic/Story/Task content |
| `interview_answer` | Interviews | User responses |
| `project_context` | Project setup | Manual project description |
| `document` | Upload | PDF, TXT uploaded docs |
| `framework_spec` | Specs system | Framework specifications |

## Embedding Model

- **Nomic Embed Text** via Ollama
- 768-dimensional vectors
- Stored in PostgreSQL with pgvector extension
- Cosine similarity for search

## Search Flow

1. User query or AI context request
2. Query embedded with Nomic Embed Text
3. pgvector similarity search (top-K results)
4. Results filtered by project_id and relevance threshold
5. Injected into AI prompt as context

## Continuous RAG

The system continuously evolves its knowledge base:
- New code files indexed on scan
- Business rules updated on pipeline re-run
- Cards indexed when created/updated
- Interview answers indexed immediately
- Wiki pages indexed on creation

## RAG Pipeline (4 phases)

| Phase | Purpose |
|-------|---------|
| 1 - Index | Scan and index code files |
| 2 - Rules | Extract business rules from indexed files |
| 3 - Cards | Generate cards from business rules |
| 4 - Wiki | Generate wiki pages from all knowledge |

## API Endpoints

```
GET /api/v1/knowledge/search?q=...&project_id=...
GET /api/v1/knowledge/documents
GET /api/v1/knowledge/global-stats
GET /api/v1/knowledge/projects-stats
```

## Configuration

RAG is enabled by default when Redis and pgvector are available. Configure via:
- `.env`: `REDIS_HOST`, `REDIS_PORT`
- Database: `ai_models` table for embedding model
- Pipeline profiles: enable/disable RAG phases
