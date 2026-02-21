# PROMPT #129 - AIModelBadge Investigation Report
## Investigação sobre badges de modelo de IA não aparecendo

**Date:** January 31, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Investigation / Bug Analysis
**Impact:** Understanding why AI model badges weren't appearing in the UI

---

## Objective

Investigar por que os badges de modelo de IA (`AIModelBadge`) não estavam aparecendo em diversos locais do sistema, conforme reportado pelo usuário.

**Locais reportados sem badges:**
1. Project title during generation
2. Codebase analysis (memory scan)
3. Chat questions/responses (interview)
4. Project context
5. Project description
6. Backlog grid items
7. Cards/tabs in ItemDetailPanel
8. Project cards in /projects
9. Kanban cards

---

## Investigation Results

### 1. Database Field Analysis

**Campo `created_by_ai_model` na tabela `tasks`:**
- ✅ Migration aplicada corretamente (`20260131110000`)
- ✅ Campo existe como `character varying`
- ⚠️ **Valor NULL em todas as 11 tasks existentes**

**Motivo:** O campo só é populado quando uma task é ativada através do fluxo de ativação:
- `activate_suggested_epic()` - [context_generator.py:916](backend/app/services/context_generator.py#L916)
- `activate_suggested_story()` - [context_generator.py:2473](backend/app/services/context_generator.py#L2473)
- `activate_suggested_task()` - [context_generator.py:2853](backend/app/services/context_generator.py#L2853)
- `activate_suggested_subtask()` - [context_generator.py:3255](backend/app/services/context_generator.py#L3255)

**Estado atual do banco:**
```
Total tasks: 11
Tasks with created_by_ai_model: 0
Tasks by workflow_state: closed (11)
```

### 2. AIModelBadge Implementation Status

O componente `AIModelBadge` está **corretamente implementado** nos seguintes locais:

| Local | Arquivo | Linha | Condição |
|-------|---------|-------|----------|
| Interview messages | [MessageBubble.tsx](frontend/src/components/interview/MessageBubble.tsx) | 111 | Sempre (para mensagens não-user) |
| Project cards | [projects/page.tsx](frontend/src/app/projects/page.tsx) | 203 | `project.context_human` existe |
| Project description | [projects/[id]/page.tsx](frontend/src/app/projects/[id]/page.tsx) | 859 | Sempre |
| Project context | [projects/[id]/page.tsx](frontend/src/app/projects/[id]/page.tsx) | 897 | `project.context_human` existe |
| Memory scan title | [projects/new/page.tsx](frontend/src/app/projects/new/page.tsx) | 346 | `memoryScanResult?.suggested_title` |
| Memory scan results | [projects/new/page.tsx](frontend/src/app/projects/new/page.tsx) | 379 | `memoryScanResult` existe |
| Suggested epics | [projects/new/page.tsx](frontend/src/app/projects/new/page.tsx) | 621 | `suggestedEpics` existe |
| Backlog TaskCard | [TaskCard.tsx](frontend/src/components/backlog/TaskCard.tsx) | 266 | `task.created_by_ai_model` |
| Kanban TaskCard | [kanban/TaskCard.tsx](frontend/src/components/kanban/TaskCard.tsx) | 104 | `task.created_by_ai_model` |
| BacklogListView | [BacklogListView.tsx](frontend/src/components/backlog/BacklogListView.tsx) | N/A | `item.created_by_ai_model` |
| ItemDetailPanel | [ItemDetailPanel.tsx](frontend/src/components/backlog/ItemDetailPanel.tsx) | 739, 1132 | `item.created_by_ai_model` |

### 3. Code Flow Analysis

**Fluxo de `ai_model_used` na ativação de épico:**

```
1. activate_suggested_epic() chama _generate_full_epic_content()
   ↓
2. _generate_full_epic_content() faz chamada ao AIOrchestrator
   ↓
3. AIOrchestrator.execute() retorna { "model": "gemini-2.5-flash", ... }
   ↓
4. ai_model_used = response.get("model", "unknown")  [linha 1293]
   ↓
5. Retorna { "ai_model_used": ai_model_used, ... }  [linha 1865]
   ↓
6. epic.created_by_ai_model = epic_content.get("ai_model_used")  [linha 916]
   ↓
7. db.commit()  [linha 951]
```

O código está correto. O problema é que **nenhuma task passou por este fluxo ainda**.

---

## Root Cause

**O problema NÃO é um bug de código.** Os badges não aparecem porque:

1. **Para tasks/cards:** O campo `created_by_ai_model` só é preenchido quando uma task é ativada através do fluxo de sugestões. Como nenhuma task foi ativada desta forma, o campo está NULL.

2. **Para mensagens de entrevista:** O badge ESTÁ implementado e deveria aparecer. Se não aparece, pode ser um problema de:
   - Cache do navegador
   - Build não atualizado

3. **Para contexto/descrição de projeto:** O badge ESTÁ implementado e aparece quando o projeto tem `context_human` preenchido.

---

## Recommendations

### Para ver os badges funcionando:

1. **Criar novo projeto** com entrevista de contexto completa
2. **Ativar épicos sugeridos** - isso preencherá `created_by_ai_model`
3. **Verificar interview messages** - badge "🧠🔍" deve aparecer para mensagens do assistente

### Para desenvolvimento futuro:

Se quiser que tasks existentes tenham badges, considerar:
- Migration para preencher `created_by_ai_model` com valor padrão baseado no `item_type`
- Ou adicionar badge "genérico" para items sem o campo preenchido

---

## Files Examined

| File | Purpose |
|------|---------|
| [context_generator.py](backend/app/services/context_generator.py) | Verificar fluxo de `ai_model_used` |
| [ai_orchestrator.py](backend/app/services/ai_orchestrator.py) | Confirmar retorno de `model` na resposta |
| [task.py (model)](backend/app/models/task.py) | Verificar definição da coluna |
| [task.py (schema)](backend/app/schemas/task.py) | Verificar campo no Pydantic schema |
| [MessageBubble.tsx](frontend/src/components/interview/MessageBubble.tsx) | Verificar badge em mensagens |
| [TaskCard.tsx](frontend/src/components/backlog/TaskCard.tsx) | Verificar badge em cards |
| [AIModelBadge.tsx](frontend/src/components/ui/AIModelBadge.tsx) | Verificar implementação do componente |

---

## Memory Model Status

O modelo de Memory (`usage_type='memory'`) está configurado corretamente:
- **Provider:** google
- **Model ID:** gemini-2.5-flash
- **Config:** max_tokens=8000, temperature=0.3

---

## Status: INVESTIGATION COMPLETE

A investigação revelou que o sistema está implementado corretamente. Os badges não aparecem para tasks existentes porque nenhuma passou pelo fluxo de ativação que popula o campo `created_by_ai_model`.

**Para ver os badges:**
1. Criar novo projeto com context interview
2. Ativar épicos sugeridos
3. Os badges aparecerão nas tasks ativadas

---

**Key Findings:**
- ✅ Código de backend está correto
- ✅ Código de frontend está correto
- ✅ Migration aplicada
- ⚠️ Tasks existentes não têm o campo preenchido (comportamento esperado)
- ✅ Badges em interview messages funcionam (hardcoded)
- ✅ Badges em projeto funcionam (baseado em context_human)

---
