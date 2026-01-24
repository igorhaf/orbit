# PROMPT #102 - Hierarchical Draft Generation
## Auto-geração de Cards Filhos ao Aprovar Cards Pai

**Date:** 2026-01-24
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Major - Automação completa da hierarquia Epic → Story → Task → Subtask

---

## Objetivo

Implementar geração automática de cards filhos (drafts) quando um card pai é aprovado:

| Nível Pai | Ação ao Aprovar | Filhos Gerados |
|-----------|-----------------|----------------|
| **Epic** | Gera conteúdo completo | 15-20 Stories (draft) |
| **Story** | Gera conteúdo completo | 5-8 Tasks (draft) |
| **Task** | Gera conteúdo completo | 3-5 Subtasks (draft) |
| **Subtask** | Gera conteúdo completo | Nenhum (nível folha) |

**Key Requirements:**
1. Cards filhos criados com `labels=["suggested"]` e `workflow_state="draft"`
2. Cards filhos aparecem como itens "sugeridos" (visual cinza, borda tracejada)
3. Usuário pode aprovar ou rejeitar cada filho individualmente
4. Processo recursivo até o nível Subtask

---

## What Was Implemented

### 1. Funções de Geração de Drafts

**Arquivo:** `backend/app/services/context_generator.py`

#### `_generate_draft_stories(epic, project)` (Lines 1620-1730)
- Gera 15-20 User Stories para um Epic ativado
- Usa IA para decompor o Epic em funcionalidades
- Cria stories com título no formato User Story
- Fallback com 5 stories básicas se IA falhar

#### `_generate_draft_tasks(story, project)` (Lines 1775-1870)
- Gera 5-8 Tasks técnicas para uma Story ativada
- Inclui contexto do Epic pai
- Tasks focadas em: Backend, Frontend, Testes, Integração

#### `_generate_draft_subtasks(task, project)` (Lines 1905-1980)
- Gera 3-5 Subtasks atômicas para uma Task ativada
- Subtasks completáveis em 15-60 minutos
- Título como ação específica

### 2. Funções de Ativação por Tipo

#### `activate_suggested_story(story_id)` (Lines 2000-2070)
- Gera conteúdo completo da Story (description, generated_prompt, acceptance_criteria)
- Auto-chama `_generate_draft_tasks()` após ativação
- Retorna `children_generated` com contagem de tasks criadas

#### `activate_suggested_task(task_id)` (Lines 2120-2185)
- Gera conteúdo técnico da Task
- Auto-chama `_generate_draft_subtasks()` após ativação
- Retorna `children_generated` com contagem de subtasks criadas

#### `activate_suggested_subtask(subtask_id)` (Lines 2235-2295)
- Gera prompt de execução simples
- Não gera filhos (nível folha)
- `children_generated = 0`

### 3. Modificação do Endpoint

**Arquivo:** `backend/app/api/routes/tasks_old.py`

#### Endpoint Unificado: `POST /tasks/{task_id}/activate`
- Detecta `item_type` do item (Epic, Story, Task, Subtask)
- Chama função de ativação apropriada
- Response inclui `children_generated`

```python
class ActivateEpicResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    generated_prompt: Optional[str]
    acceptance_criteria: Optional[List[str]]
    story_points: Optional[int]
    priority: str
    activated: bool
    children_generated: Optional[int] = 0  # NOVO
```

### 4. Frontend Updates

**Arquivos:**
- `frontend/src/lib/api.ts` - Tipo de resposta atualizado
- `frontend/src/components/backlog/ItemDetailPanel.tsx` - Feedback de filhos gerados
- `frontend/src/components/backlog/TaskCard.tsx` - Feedback de filhos gerados

#### Feedback ao Usuário
Ao aprovar um item, o usuário vê:
```
Item ativado! 18 stories foram geradas como drafts.
```

---

## Files Modified

### Backend
1. **[context_generator.py](backend/app/services/context_generator.py)**
   - Lines added: ~700
   - Functions: `_generate_draft_stories`, `_generate_draft_tasks`, `_generate_draft_subtasks`, `activate_suggested_story`, `activate_suggested_task`, `activate_suggested_subtask`, `_generate_full_story_content`, `_generate_full_task_content`, `_parse_json_response`, `_generate_fallback_stories`, `_generate_fallback_tasks`
   - Modified: `activate_suggested_epic` (added call to `_generate_draft_stories`)

2. **[tasks_old.py](backend/app/api/routes/tasks_old.py)**
   - Modified: `ActivateEpicResponse` (added `children_generated`)
   - Modified: `activate_suggested_item` (detects item type, calls appropriate function)

### Frontend
3. **[api.ts](frontend/src/lib/api.ts)**
   - Modified: `activateSuggestedEpic` response type (added `children_generated`)

4. **[ItemDetailPanel.tsx](frontend/src/components/backlog/ItemDetailPanel.tsx)**
   - Modified: `handleApprove` (shows feedback about children generated)

5. **[TaskCard.tsx](frontend/src/components/backlog/TaskCard.tsx)**
   - Modified: `handleActivateEpic` (shows feedback about children generated)

---

## Architecture

### Flow Diagram

```
User clicks "Aprovar" on suggested Epic
    ↓
POST /api/v1/tasks/{epic_id}/activate
    ↓
Backend detects item_type == EPIC
    ↓
activate_suggested_epic()
    ├── Generate full epic content (AI)
    ├── Update epic: remove "suggested", workflow_state="open"
    └── _generate_draft_stories()
        ├── AI generates 15-20 story suggestions
        └── Create stories in DB with labels=["suggested"]
    ↓
Return { activated: true, children_generated: 18 }
    ↓
Frontend shows: "Item ativado! 18 stories foram geradas como drafts."
    ↓
User sees 18 grayed-out story cards under the epic
    ↓
User clicks "Aprovar" on a story
    ↓
Same flow: Story activated, 6 tasks generated as drafts
    ↓
... continues until subtasks (leaf level)
```

### Hierarchy Example

```
📁 Epic: Sistema de Autenticação (ATIVADO)
├── 📄 Story 1: Login com email (draft) - Aguardando aprovação
├── 📄 Story 2: Login com Google (draft)
├── 📄 Story 3: Registro de usuário (draft)
├── 📄 Story 4: Recuperação de senha (draft)
├── 📄 Story 5: Logout (draft)
├── ... (15-20 stories total)

[User approves Story 1]

📁 Epic: Sistema de Autenticação (ATIVADO)
├── 📁 Story 1: Login com email (ATIVADO)
│   ├── 📄 Task 1: Criar modelo User (draft)
│   ├── 📄 Task 2: Implementar API login (draft)
│   ├── 📄 Task 3: Criar formulário frontend (draft)
│   ├── ... (5-8 tasks total)
├── 📄 Story 2: Login com Google (draft)
...
```

---

## Key Decisions

### 1. Quantidade de Filhos
- **Epics → 15-20 Stories**: Cobertura completa do módulo
- **Stories → 5-8 Tasks**: Granularidade técnica adequada
- **Tasks → 3-5 Subtasks**: Ações atômicas executáveis

### 2. Conteúdo de Drafts
- Drafts têm apenas título e descrição simples
- Conteúdo completo (acceptance_criteria, generated_prompt) é gerado na aprovação
- Reduz custo de IA (não gera conteúdo que pode ser rejeitado)

### 3. Fallback Strategy
- Se IA falhar, sistema cria 5 itens genéricos
- Garante que o fluxo não quebra
- Usuário pode editar/rejeitar fallbacks

---

## Testing Strategy

### Test 1: Epic → Stories
```bash
# 1. Criar projeto com contexto
# 2. Aprovar epic sugerido
# 3. Verificar 15-20 stories criadas com:
#    - labels=["suggested"]
#    - workflow_state="draft"
#    - parent_id=epic.id
#    - item_type="story"
```

### Test 2: Story → Tasks
```bash
# 1. Aprovar uma story draft
# 2. Verificar 5-8 tasks criadas
# 3. Verificar parent_id=story.id
```

### Test 3: Task → Subtasks
```bash
# 1. Aprovar uma task draft
# 2. Verificar 3-5 subtasks criadas
# 3. Verificar parent_id=task.id
```

### Test 4: Subtask (Leaf)
```bash
# 1. Aprovar uma subtask draft
# 2. Verificar conteúdo gerado
# 3. Verificar children_generated=0
```

---

## Success Metrics

- **Automação**: Usuário não precisa manualmente gerar cada nível
- **Visibilidade**: Toda hierarquia visível desde a aprovação do Epic
- **Flexibilidade**: Usuário pode rejeitar qualquer draft
- **Performance**: Geração em background, não bloqueia UI

---

## Status: COMPLETE

### Key Achievements:
- Geração automática de 15-20 stories ao aprovar Epic
- Geração automática de 5-8 tasks ao aprovar Story
- Geração automática de 3-5 subtasks ao aprovar Task
- Endpoint unificado para todos os tipos de item
- Feedback visual ao usuário sobre filhos gerados
- Fallback strategy para falhas de IA

### Impact:
- **Antes**: Usuário precisava manualmente gerar e aprovar cada nível
- **Depois**: Aprovar um item automaticamente popula o próximo nível com drafts
- **Benefício**: Redução drástica do tempo de planejamento, visão completa da hierarquia desde o início

---

**PROMPT #102 Completed**
