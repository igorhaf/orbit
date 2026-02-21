# PROMPT #250 - Modularize context_generator.py (Frente 2 de 6)
## Split de 6.000 linhas em 7 modulos focados

**Date:** February 19, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Refactor
**Impact:** context_generator.py (6.000 linhas) dividido em 7 modulos, zero mudancas em call sites

---

## Objective

Modularizar o maior arquivo do backend (`context_generator.py`, 6.000 linhas) em modulos focados usando o padrao Mixin, mantendo a interface publica identica.

---

## What Was Implemented

### Estrategia: Mixin Composition

O monolito foi convertido em um pacote Python (`context_generator/`) com 7 arquivos:

```
backend/app/services/context_generator/
  __init__.py          (18 linhas)  - Re-exporta ContextGeneratorService
  service.py           (60 linhas)  - Classe principal, herda 4 mixins
  utils.py             (489 linhas) - JSON parsing, text cleaning, semantic conversion
  context_interview.py (809 linhas) - Entrevista de contexto, locking, rich context
  business_rules.py    (407 linhas) - Classificacao de regras em Epic > Story
  card_activator.py    (2.827 linhas) - Ativacao e geracao de conteudo rico
  draft_generator.py   (1.511 linhas) - Geracao de drafts, batches, incrementais
```

### Composicao via Mixins

```python
class ContextGeneratorService(
    ContextInterviewMixin,      # 9 metodos
    BusinessRulesMixin,         # 6 metodos
    CardActivatorMixin,         # 11 metodos
    DraftGeneratorMixin,        # 18 metodos
):
    def __init__(self, db):
        # Inicializacao centralizada
```

### Verificacao de Paridade

- Original: 45 metodos de classe + 6 funcoes standalone
- Novo: 45 metodos (9+6+11+18+1) + 6 funcoes em utils.py
- Paridade: 100%
- Call sites alterados: 0 (todos importam `ContextGeneratorService`)

---

## Files Created

1. `backend/app/services/context_generator/__init__.py` - Package entry
2. `backend/app/services/context_generator/service.py` - Main class
3. `backend/app/services/context_generator/utils.py` - Utility functions
4. `backend/app/services/context_generator/context_interview.py` - Interview mixin
5. `backend/app/services/context_generator/business_rules.py` - Business rules mixin
6. `backend/app/services/context_generator/card_activator.py` - Card activator mixin
7. `backend/app/services/context_generator/draft_generator.py` - Draft generator mixin

## Files Deleted

1. `backend/app/services/context_generator.py` - Monolito original (6.000 linhas)

---

## Testing

```
Python syntax OK (__init__.py)
Python syntax OK (service.py)
Python syntax OK (utils.py)
Python syntax OK (context_interview.py)
Python syntax OK (business_rules.py)
Python syntax OK (card_activator.py)
Python syntax OK (draft_generator.py)
AST method count: 45/45 (100% paridade)
AST function count: 6/6 (100% paridade)
Zero call sites alterados
```

---

## Call Sites (nenhum alterado)

| Arquivo | Metodos usados |
|---------|---------------|
| `watchdog.py` | activate_suggested_epic/story/task/subtask |
| `interviews/endpoints.py` | generate_context_from_interview |
| `projects.py` (3 locais) | generate_cards_from_memory, lock_context, generate_rich_context_from_memory, generate_business_rule_cards |
| `tasks_routes.py` (3 locais) | reject_suggested_epic, activate_suggested_*, generate_children |

---

## Status: COMPLETE

**Key Achievements:**
- 1 arquivo de 6.000 linhas → 7 arquivos focados
- Maior arquivo agora: card_activator.py (2.827 linhas) - contem prompts longos
- Zero mudancas em 8 call sites existentes
- Import path identico: `from app.services.context_generator import ContextGeneratorService`

**Proxima frente:** Frente 3 - Consolidar interview routes

---
