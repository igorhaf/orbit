# PROMPT #254 - Split api.ts into Domain Modules (Frente 6 de 6)
## Divisao de api.ts monolitico em modulos por dominio

**Date:** February 19, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Refactor
**Impact:** api.ts monolitico (1.743 linhas) dividido em 13 modulos focados por dominio

---

## Objective

Dividir o arquivo monolitico `frontend/src/lib/api.ts` (1.743 linhas, 19 API objects, ~200 metodos) em modulos por dominio dentro de `frontend/src/lib/api/`, mantendo todos os imports existentes funcionando via barrel re-export.

---

## What Was Implemented

### Modulos Criados em `frontend/src/lib/api/`

| Arquivo | Linhas | Exports |
|---------|--------|---------|
| `base.ts` | 94 | `API_URL`, `request` |
| `projects.ts` | 99 | `projectsApi` |
| `tasks.ts` | 272 | `tasksApi` |
| `backlog.ts` | 142 | `backlogGenerationApi`, `backlogApi` |
| `interviews.ts` | 122 | `interviewsApi` |
| `prompts.ts` | 37 | `promptsApi` |
| `ai.ts` | 115 | `aiModelsApi`, `aiFlowApi`, `aiExecutionsApi` |
| `jobs.ts` | 206 | `JobStatus`, `JobResponse`, `jobsApi` |
| `knowledge.ts` | 311 | `knowledgeApi`, `ragApi` |
| `wiki.ts` | 47 | `wikiApi` |
| `commits.ts` | 70 | `commitsApi` |
| `misc.ts` | 244 | `settingsApi`, `analyzersApi`, `chatSessionsApi`, `promptQueueApi`, `projectChatsApi` |
| `index.ts` | 19 | Barrel re-export de tudo |
| **Total** | **1.778** | **21 named exports** |

### Arquivo Deletado

- `frontend/src/lib/api.ts` (1.743 linhas)

### Como Funciona

1. Todos os 44 arquivos consumidores importam de `@/lib/api`
2. Com `api.ts` deletado, TypeScript/Next.js resolve para `api/index.ts`
3. O barrel `index.ts` re-exporta todos os symbols dos modulos
4. **Zero mudancas necessarias em qualquer arquivo consumidor**

---

## Files Created

1. `frontend/src/lib/api/base.ts` - 94 linhas
2. `frontend/src/lib/api/projects.ts` - 99 linhas
3. `frontend/src/lib/api/tasks.ts` - 272 linhas
4. `frontend/src/lib/api/backlog.ts` - 142 linhas
5. `frontend/src/lib/api/interviews.ts` - 122 linhas
6. `frontend/src/lib/api/prompts.ts` - 37 linhas
7. `frontend/src/lib/api/ai.ts` - 115 linhas
8. `frontend/src/lib/api/jobs.ts` - 206 linhas
9. `frontend/src/lib/api/knowledge.ts` - 311 linhas
10. `frontend/src/lib/api/wiki.ts` - 47 linhas
11. `frontend/src/lib/api/commits.ts` - 70 linhas
12. `frontend/src/lib/api/misc.ts` - 244 linhas
13. `frontend/src/lib/api/index.ts` - 19 linhas

## Files Deleted

1. `frontend/src/lib/api.ts` - 1.743 linhas

---

## Testing

```
Next.js build: OK (zero errors)
All 44 consumer files continue funcionando sem mudancas
Todos os 21 exports presentes nos novos modulos
Todos os ~200 metodos contabilizados
```

---

## Status: COMPLETE

**Key Achievements:**
- 1 arquivo monolitico (1.743 linhas) dividido em 13 modulos focados
- Maior modulo: knowledge.ts (311 linhas)
- Menor modulo: prompts.ts (37 linhas)
- Zero mudanca em arquivos consumidores
- Next.js build passa sem erros

---
