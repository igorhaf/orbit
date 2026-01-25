# PROMPT #102 - Hierarchical Draft Generation
## Auto-geração de cards filhos ao aprovar cards pai

**Date:** 2026-01-24
**Status:** PLANNING
**Type:** Feature Implementation
**Impact:** Major - Automação completa da hierarquia Epic → Story → Task → Subtask

---

## Objetivo

Quando um card é aprovado, automaticamente gerar seus cards filhos como drafts (sugeridos):
- **Epic aprovado** → Gera ~15-20 Stories como drafts
- **Story aprovada** → Gera ~5-8 Tasks como drafts
- **Task aprovada** → Gera ~3-5 Subtasks como drafts
- **Subtask aprovada** → Apenas gera conteúdo completo (nível folha)

---

## Arquitetura Atual

### Epic Activation (`context_generator.py:566-698`)
- `activate_suggested_epic(epic_id)` - Gera conteúdo completo
- **PARA após ativação** - NÃO gera filhos automaticamente

### Story Generation (`backlog_generator.py:342-630`)
- `decompose_epic_to_stories()` - Retorna 3-7 sugestões (NÃO cria no DB)
- Usuário deve manualmente chamar endpoint separado

### Task Model (`task.py`)
- `parent_id` - ForeignKey para pai
- `item_type` - EPIC → STORY → TASK → SUBTASK
- `labels=["suggested"]` + `workflow_state="draft"` = item sugerido

---

## Plano de Implementação

### Fase 1: Refatorar Ativação para Suportar Todos os Tipos

**Arquivo:** `/backend/app/services/context_generator.py`

#### 1.1 Criar função unificada de ativação

```python
async def activate_suggested_item(
    self,
    item_id: UUID,
    db: Session
) -> Dict:
    """
    Ativa qualquer item sugerido (Epic, Story, Task, Subtask)
    e auto-gera filhos como drafts.
    """
```

**Fluxo:**
1. Buscar item pelo ID
2. Verificar se é sugerido (labels contém "suggested" OU workflow_state="draft")
3. Baseado no `item_type`:
   - **EPIC**: Gera conteúdo + chama `_generate_draft_stories()`
   - **STORY**: Gera conteúdo + chama `_generate_draft_tasks()`
   - **TASK**: Gera conteúdo + chama `_generate_draft_subtasks()`
   - **SUBTASK**: Apenas gera conteúdo (nível folha)
4. Remover label "suggested", mudar workflow_state para "open"
5. Retornar item ativado + lista de filhos gerados

#### 1.2 Criar funções de geração de drafts

```python
async def _generate_draft_stories(
    self,
    epic: Task,
    project_context: str,
    db: Session
) -> List[Task]:
    """Gera 15-20 stories como drafts para o epic."""

async def _generate_draft_tasks(
    self,
    story: Task,
    project_context: str,
    db: Session
) -> List[Task]:
    """Gera 5-8 tasks como drafts para a story."""

async def _generate_draft_subtasks(
    self,
    task: Task,
    project_context: str,
    db: Session
) -> List[Task]:
    """Gera 3-5 subtasks como drafts para a task."""
```

### Fase 2: Implementar Geração de Stories (15-20)

**Arquivo:** `/backend/app/services/context_generator.py`

#### 2.1 Função `_generate_draft_stories()`

**Input:**
- Epic ativado com `generated_prompt` (markdown semântico)
- Contexto do projeto

**Output:**
- 15-20 Stories criadas no DB com:
  - `parent_id` = epic.id
  - `item_type` = ItemType.STORY
  - `labels` = ["suggested"]
  - `workflow_state` = "draft"
  - `title` = Título simples (formato User Story)
  - `description` = Descrição breve (1-2 parágrafos)
  - `generated_prompt` = None (será gerado ao aprovar)
  - `story_points` = Estimativa básica (1-8)

**Prompt para IA:**
```
Baseado no Epic aprovado, gere 15-20 User Stories que decomponham
completamente a funcionalidade. Cada story deve:
- Seguir formato: "Como [usuário], eu quero [funcionalidade]"
- Ser independente e entregável
- Ter descrição breve (1-2 parágrafos)
- Estimativa de story points (1-8, Fibonacci)

Retorne JSON array com: title, description, story_points, priority
```

### Fase 3: Implementar Geração de Tasks (5-8)

**Arquivo:** `/backend/app/services/context_generator.py`

#### 3.1 Função `_generate_draft_tasks()`

**Input:**
- Story ativada com `generated_prompt`
- Contexto do projeto + Epic pai

**Output:**
- 5-8 Tasks criadas no DB como drafts

**Prompt para IA:**
```
Baseado na User Story aprovada, gere 5-8 Tasks técnicas que
implementem a funcionalidade. Cada task deve:
- Ser uma unidade de trabalho técnico (1-4 horas)
- Ter título técnico descritivo
- Ter descrição breve do que fazer
- Estimativa de story points (1-3)

Retorne JSON array com: title, description, story_points
```

### Fase 4: Implementar Geração de Subtasks (3-5)

**Arquivo:** `/backend/app/services/context_generator.py`

#### 4.1 Função `_generate_draft_subtasks()`

**Input:**
- Task ativada com `generated_prompt`
- Contexto do projeto + Story pai + Epic avô

**Output:**
- 3-5 Subtasks criadas no DB como drafts

**Prompt para IA:**
```
Baseado na Task aprovada, gere 3-5 Subtasks atômicas que
completem o trabalho. Cada subtask deve:
- Ser uma ação específica e atômica
- Completável em 15-60 minutos
- Ter título de ação (verbo no infinitivo)
- Descrição opcional

Retorne JSON array com: title, description
```

### Fase 5: Atualizar Endpoint de Ativação

**Arquivo:** `/backend/app/api/routes/tasks_old.py`

#### 5.1 Modificar endpoint `/tasks/{task_id}/activate`

**Mudanças:**
- Chamar `activate_suggested_item()` (nova função unificada)
- Funciona para qualquer item_type (não só Epic)
- Retornar item ativado + contagem de filhos gerados

**Response atualizado:**
```python
class ActivateItemResponse(BaseModel):
    id: str
    title: str
    item_type: str
    description: Optional[str]
    generated_prompt: Optional[str]
    acceptance_criteria: Optional[List[str]]
    story_points: Optional[int]
    priority: str
    activated: bool
    children_generated: int  # NOVO: quantidade de filhos gerados
```

### Fase 6: Frontend (Mudanças Mínimas)

**Arquivos:**
- `/frontend/src/components/backlog/ItemDetailPanel.tsx`
- `/frontend/src/components/backlog/TaskCard.tsx`

**Mudanças:**
1. Mostrar toast/notificação: "Epic ativado! 18 stories geradas como draft."
2. Expandir automaticamente o item para mostrar filhos gerados
3. Já existe styling para itens sugeridos (opacity-60, border-dashed)

---

## Arquivos a Modificar

| Arquivo | Ação | Linhas |
|---------|------|--------|
| `backend/app/services/context_generator.py` | Modificar | 566-700 |
| `backend/app/services/context_generator.py` | Adicionar | +300 linhas |
| `backend/app/api/routes/tasks_old.py` | Modificar | 1699-1764 |
| `frontend/src/components/backlog/ItemDetailPanel.tsx` | Modificar | 147-160 |
| `frontend/src/lib/api.ts` | Modificar | 289-307 |

---

## Contagem de Filhos por Nível

| Nível Pai | Filhos Gerados | Tipo Filho |
|-----------|----------------|------------|
| Epic | 15-20 | Story |
| Story | 5-8 | Task |
| Task | 3-5 | Subtask |
| Subtask | 0 | (nível folha) |

**Exemplo de árvore completa:**
- 1 Epic aprovado
  - 18 Stories geradas (draft)
    - Story 1 aprovada → 6 Tasks geradas (draft)
      - Task 1 aprovada → 4 Subtasks geradas (draft)

---

## Estratégia de Testes

1. **Teste Epic → Stories:**
   - Criar projeto com contexto
   - Aprovar epic sugerido
   - Verificar 15-20 stories criadas como draft
   - Verificar parent_id correto

2. **Teste Story → Tasks:**
   - Aprovar story draft
   - Verificar 5-8 tasks criadas como draft
   - Verificar herança de contexto

3. **Teste Task → Subtasks:**
   - Aprovar task draft
   - Verificar 3-5 subtasks criadas como draft

4. **Teste Subtask (folha):**
   - Aprovar subtask draft
   - Verificar conteúdo completo gerado
   - Verificar NENHUM filho gerado

---

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Muitas chamadas de IA | Gerar todos os filhos em UMA chamada (batch) |
| Timeout na geração | Usar background job se necessário |
| Contexto muito grande | Resumir contexto para níveis mais profundos |
| UI lenta com muitos itens | Lazy loading + paginação |

---

## Ordem de Implementação

1. ✅ Criar função `_generate_draft_stories()` e testar
2. ✅ Modificar `activate_suggested_epic()` para chamar geração
3. ✅ Criar função `_generate_draft_tasks()` e testar
4. ✅ Criar função `activate_suggested_story()`
5. ✅ Criar função `_generate_draft_subtasks()` e testar
6. ✅ Criar função `activate_suggested_task()`
7. ✅ Criar função `activate_suggested_subtask()`
8. ✅ Unificar em `activate_suggested_item()` com dispatcher
9. ✅ Atualizar endpoint e response
10. ✅ Atualizar frontend com feedback visual
11. ✅ Testes end-to-end

---

## Resumo

Esta implementação transforma o ORBIT em um sistema de planejamento hierárquico automatizado:

**Antes:** Usuário precisa manualmente gerar e aprovar cada nível
**Depois:** Aprovar um item automaticamente popula o próximo nível com drafts

**Benefício:** Redução drástica do tempo de planejamento, visão completa da hierarquia desde o início.
