# PROMPT #157 - PROMPT Doc + Git Commit RAG Sync
## Ingest project documentation and git history into RAG as searchable context

**Date:** February 3, 2026
**Status:** ✅ COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** 154 PROMPT docs e histórico de commits de cada projeto agora entram no RAG, tornando-se contexto recuperável pela IA durante geração de cards e execução de tasks.

---

## Problema

Toda a documentação de decisões arquiteturais, bug-fixes e features do projeto (PROMPT_*.md) e o histórico de commits de cada repositório ficavam fora do RAG. A IA não conseguia recuperar esse contexto ao gerar épicos, stories ou executar tasks — mesmo que essa informação já existisse no projeto.

---

## Solução

Dois novos serviços de sincronização:

### 1. PromptDocRAGSync — documentação global

- Lê todos os `PROMPT_*.md` da raiz do projeto
- Divide em chunks de 600 caracteres (overlap 60) para melhor recall semântico
- Armazena com `project_id=NULL` (conhecimento global)
- Deduplicação por `filename` no metadata — nunca reindexa o mesmo arquivo
- Cada chunk tem metadata: `content_type=prompt_doc`, `prompt_number`, `filename`, `chunk_index`

### 2. GitCommitRAGSync — commits por projeto

- Lê os últimos N commits do `code_path` de cada projeto via `git log`
- Armazena subject + body de cada commit com `project_id` do projeto
- Deduplicação por `commit_hash` no metadata
- Cada documento tem metadata: `content_type=git_commit`, `commit_hash`, `short_hash`

---

## Arquivos Modificados / Criados

| Arquivo | Mudança |
|---------|---------|
| `backend/app/services/prompt_doc_rag_sync.py` | **Novo** — `PromptDocRAGSync` + `GitCommitRAGSync` + helper `_chunk_document` |
| `backend/app/api/routes/knowledge.py` | Adicionados 2 endpoints: `POST /knowledge/sync-prompt-docs` e `POST /projects/{id}/knowledge/sync-git-commits` |

---

## Endpoints

### `POST /api/v1/knowledge/sync-prompt-docs`

Sem parâmetros. Escaneia a raiz do projeto, indexa PROMPT docs novos.

**Response:**
```json
{
  "status": "ok",
  "total": 154,
  "synced": 154,
  "skipped": 0,
  "errors": []
}
```

### `POST /api/v1/projects/{project_id}/knowledge/sync-git-commits?max_commits=100`

Indexa commits do repositório do projeto.

**Response:**
```json
{
  "status": "ok",
  "project_id": "uuid",
  "total_read": 47,
  "synced": 47,
  "skipped": 0,
  "errors": []
}
```

---

## Como funciona na prática

```
PROMPT_*.md (154 arquivos)
       │
       ▼  PromptDocRAGSync.sync_all()
  chunks (600 chars) ──► rag_documents (project_id=NULL, content_type=prompt_doc)
       │
       ▼  semantic search
  AIOrchestrator recupera contexto relevante quando gera cards

project/code_path (git repo)
       │
       ▼  GitCommitRAGSync.sync(max_commits=100)
  commits ──► rag_documents (project_id=X, content_type=git_commit)
       │
       ▼  semantic search
  AIOrchestrator recupera histórico relevante do projeto
```

---

## Deduplicação

Ambos os serviços verificam o que já está no RAG **antes** de inserir:

- **PromptDocRAGSync:** query `metadata->>'filename'` — se o arquivo já foi indexado, pula
- **GitCommitRAGSync:** query `metadata->>'commit_hash'` — se o commit já existe, pula

Isso torna os endpoints seguros para chamada repetida (idempotentes).

---

## Status: COMPLETE
