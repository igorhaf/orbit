# PROMPT #249 - Remove Dead Code (Frente 1 de 6)
## Limpeza de codigo morto e renomeacao de arquivo mal nomeado

**Date:** February 19, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Refactor / Tech Debt Cleanup
**Impact:** -4.340 linhas de codigo morto removidas, arquivo ativo renomeado para clareza

---

## Objective

Remover todos os arquivos `*_old` e `*.old.tsx` que sao codigo morto confirmado, e renomear o arquivo `tasks_old.py` (que apesar do nome e o arquivo ATIVO) para `tasks_routes.py`.

Esta e a Frente 1 do plano de refatoracao de 6 frentes identificado na analise arquitetural do ORBIT.

---

## Analise Pre-Delecao

Antes de deletar qualquer arquivo, foi feito grep completo no codebase para verificar imports:

| Arquivo | Imports encontrados | Veredicto |
|---------|-------------------|-----------|
| `interviews_old.py` | Nenhum (apenas refs em rag/docs) | MORTO - deletar |
| `ChatInterface.old.tsx` | Apenas `chat/index.ts` (tambem morto) | MORTO - deletar |
| `chat/index.ts` | Nenhum import do pacote chat/ | MORTO - deletar |
| `TaskDetailModal.old.tsx` | Nenhum | MORTO - deletar |
| `TaskCard.old.tsx` (kanban) | Nenhum | MORTO - deletar |
| `tasks_old.py` | `tasks/__init__.py` importa dele | ATIVO - renomear |

---

## What Was Implemented

### 1. Arquivos deletados (codigo morto)

- `backend/app/api/routes/interviews_old.py` (2.436 linhas) - Backup do PROMPT #69
- `frontend/src/components/interview/ChatInterface.old.tsx` (1.103 linhas) - Backup do PROMPT #72
- `frontend/src/components/interview/chat/index.ts` (19 linhas) - Wrapper morto
- `frontend/src/components/interview/chat/` (diretorio vazio removido)
- `frontend/src/components/kanban/TaskDetailModal.old.tsx` (633 linhas)
- `frontend/src/components/kanban/TaskCard.old.tsx` (149 linhas)

**Total removido:** 4.340 linhas

### 2. Arquivo renomeado (ativo mas mal nomeado)

- `tasks_old.py` → `tasks_routes.py` (2.684 linhas - arquivo ativo)
- Atualizado `tasks/__init__.py`: `from ..tasks_routes import router`
- Atualizado `tasks.py` (wrapper): docstring corrigida
- Limpeza de `__pycache__` para evitar conflitos

---

## Files Modified/Deleted

### Deleted:
1. `backend/app/api/routes/interviews_old.py` - 2.436 linhas
2. `frontend/src/components/interview/ChatInterface.old.tsx` - 1.103 linhas
3. `frontend/src/components/interview/chat/index.ts` - 19 linhas
4. `frontend/src/components/kanban/TaskDetailModal.old.tsx` - 633 linhas
5. `frontend/src/components/kanban/TaskCard.old.tsx` - 149 linhas

### Modified:
1. `backend/app/api/routes/tasks_routes.py` - Renomeado de tasks_old.py
2. `backend/app/api/routes/tasks/__init__.py` - Import atualizado
3. `backend/app/api/routes/tasks.py` - Docstring atualizada

---

## Testing

```
Python syntax OK (tasks_routes.py, tasks.py, tasks/__init__.py, main.py)
Frontend build passed (npx next build)
```

---

## Status: COMPLETE

**Key Achievements:**
- 4.340 linhas de codigo morto removidas
- Arquivo `tasks_old.py` renomeado para `tasks_routes.py` (elimina confusao)
- Zero quebra de funcionalidade (build OK em ambos)
- Diretorio `chat/` vazio removido

**Proxima frente:** Frente 2 - Modularizar context_generator.py (6K linhas)

---
