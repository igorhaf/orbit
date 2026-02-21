# PROMPT #251 - Consolidate Interview Routes (Frente 3 de 6)
## Remocao de interview_handlers.py orfao e limpeza de imports

**Date:** February 19, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Refactor / Dead Code Removal
**Impact:** -1.865 linhas de codigo orfao removidas, imports limpos

---

## Objective

Consolidar as interview routes removendo codigo morto que foi substituido pelo `unified_open_handler.py` (PROMPT #78).

---

## Analise Pre-Delecao

### interview_handlers.py - Analise de Orfandade

O arquivo `interview_handlers.py` (1.865 linhas) continha 8 funcoes publicas:

| Funcao | Status | Substituida por |
|--------|--------|-----------------|
| `handle_orchestrator_interview` | MORTA | `unified_open_handler.handle_unified_open_interview` |
| `handle_meta_prompt_interview` | MORTA | `unified_open_handler.handle_unified_open_interview` |
| `handle_requirements_interview` | MORTA | `unified_open_handler.handle_unified_open_interview` |
| `handle_task_focused_interview` | MORTA | `unified_open_handler.handle_unified_open_interview` |
| `handle_subtask_focused_interview` | MORTA | `unified_open_handler.handle_unified_open_interview` |
| `handle_task_orchestrated_interview` | MORTA | `unified_open_handler.handle_unified_open_interview` |
| `handle_subtask_orchestrated_interview` | MORTA | `unified_open_handler.handle_unified_open_interview` |
| `handle_card_focused_interview` | MORTA | `unified_open_handler.handle_unified_open_interview` |

**Evidencia:** Grep confirmou que todas as 8 funcoes aparecem APENAS em:
- Suas definicoes em `interview_handlers.py`
- Imports em `endpoints.py` linhas 43-52

Nenhuma funcao e chamada em NENHUM lugar do codebase. Todas foram substituidas pelo handler unificado no PROMPT #78.

### Dispatch em endpoints.py

O ponto de despacho em `endpoints.py` (funcao `send_message_async`) rota DIRETAMENTE para `handle_unified_open_interview`:

```python
# PROMPT #78 - Unified Open-Ended Interview System
# ALL interview modes now use the unified open-ended handler
return await handle_unified_open_interview(
    interview=interview,
    project=project,
    message_count=message_count,
    db=db,
    parent_task=parent_task
)
```

---

## What Was Implemented

### 1. Arquivo deletado

- `backend/app/api/routes/interview_handlers.py` (1.865 linhas)
  - 8 funcoes publicas orfas (nunca chamadas)
  - Substituido pelo `unified_open_handler.py` (781 linhas) no PROMPT #78

### 2. Imports removidos de endpoints.py

Removido bloco de import morto (linhas 43-52):
```python
# REMOVIDO:
from app.api.routes.interview_handlers import (
    handle_requirements_interview,
    handle_task_focused_interview,
    handle_meta_prompt_interview,
    handle_orchestrator_interview,
    handle_subtask_focused_interview,
    handle_task_orchestrated_interview,
    handle_subtask_orchestrated_interview,
    handle_card_focused_interview
)
```

---

## Estrutura Final das Interview Routes

```
backend/app/api/routes/interviews/
  __init__.py                      (24 linhas)   - Package entry
  endpoints.py                     (2.240 linhas) - 19 HTTP endpoints
  unified_open_handler.py          (781 linhas)   - Handler unificado (PROMPT #78)
  context_builders.py              (378 linhas)   - Preparacao de contexto
  context_questions.py             (292 linhas)   - Perguntas de contexto Q1-Q3
  fixed_questions.py               (674 linhas)   - Perguntas fixas Q1-Q8
  card_focused_prompts.py          (594 linhas)   - Prompts por tipo de card
  card_focused_questions.py        (244 linhas)   - Perguntas por tipo de card
  option_parser.py                 (296 linhas)   - Parser de opcoes
  orchestrator_questions.py        (195 linhas)   - Perguntas do orchestrator
  task_type_prompts.py             (217 linhas)   - Prompts por tipo de task
  subtask_focused_questions.py     (233 linhas)   - Perguntas de subtask
  subtask_orchestrated_questions.py (117 linhas)  - Perguntas subtask orquestradas
  task_orchestrated_questions.py   (117 linhas)   - Perguntas task orquestradas
  response_cleaners.py             (132 linhas)   - Limpeza de respostas
```

**Total:** 6.534 linhas (antes: 8.399 com interview_handlers.py)

---

## Files Deleted

1. `backend/app/api/routes/interview_handlers.py` - 1.865 linhas

## Files Modified

1. `backend/app/api/routes/interviews/endpoints.py` - Removido bloco de import morto (11 linhas)

---

## Testing

```
Python syntax OK (endpoints.py)
Grep: zero call sites remanescentes para funcoes removidas
Grep: nenhum outro arquivo importa de interview_handlers
```

---

## Status: COMPLETE

**Key Achievements:**
- 1.865 linhas de codigo orfao removidas
- 11 linhas de imports mortos removidas de endpoints.py
- Zero quebra de funcionalidade (handler unificado ativo desde PROMPT #78)
- Interview routes consolidadas: 15 arquivos focados

**Proxima frente:** Frente 4 - Extrair business logic das rotas (projects.py, wiki.py)

---
