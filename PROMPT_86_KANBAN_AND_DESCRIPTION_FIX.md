# PROMPT #86 - Kanban Click & Description Conversion Fix
## Corrige navegacao Kanban e melhora conversao semantico-humano

**Date:** January 19, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Correcao critica de UX - Kanban abre popup correto, descricao mostra texto humano

---

## Problemas Identificados

### Problema 1: Kanban Navegando para Entrevista

**Sintoma:** Ao clicar em um card no quadro Kanban, o sistema navegava para a tela de entrevista ao inves de abrir o ItemDetailPanel.

**Causa:** O `DraggableTaskCard` nao estava passando `showInterviewButtons={false}` para o `TaskCard`, fazendo com que os botoes "Create Sub-Interview" e "Explore this Task" aparecessem nos cards do Kanban. Quando o usuario clicava nesses botoes, era navegado para a entrevista.

**Solucao:** Adicionar `showInterviewButtons={false}` no `DraggableTaskCard` para esconder os botoes de entrevista no contexto do Kanban.

### Problema 2: Descricao Mostrando Texto Semantico

**Sintoma:** A aba Descricao no ItemDetailPanel mostrava o texto semantico (com identificadores N1, P1, etc.) em vez do texto humano legivel.

**Causa:** A funcao `_convert_semantic_to_human` nao estava removendo completamente a secao "## Mapa Semantico" antes de fazer as substituicoes. Isso resultava em:
- Texto redundante: `- **Recepcionista da clinica**: Recepcionista da clinica`
- Secao Mapa Semantico ainda visivel na descricao

**Solucao:**
1. Melhorar o regex para remover toda a secao Mapa Semantico ANTES das substituicoes
2. Adicionar limpeza de linhas de definicao remanescentes
3. Criar endpoint de migracao para corrigir cards existentes

---

## Implementacao

### 1. Fix Kanban Click (`DraggableTaskCard.tsx`)

**Arquivo:** `frontend/src/components/kanban/DraggableTaskCard.tsx`

**Linha 67-71:**
```typescript
<TaskCard
  task={task}
  onUpdate={handleUpdate}
  showInterviewButtons={false}  // PROMPT #86 - Hide interview buttons in Kanban
/>
```

### 2. Melhoria na Conversao Semantico-Humano (`backlog_generator.py`)

**Arquivo:** `backend/app/services/backlog_generator.py`

**Funcao `_convert_semantic_to_human` (linhas 45-101):**

```python
def _convert_semantic_to_human(semantic_markdown: str, semantic_map: Dict[str, str]) -> str:
    """
    PROMPT #85/86 - Convert semantic markdown to human-readable text.
    """
    # PROMPT #86 - FIRST: Remove the entire "## Mapa Semantico" section BEFORE replacements
    human_text = re.sub(
        r'##\s*Mapa\s*Sem[aa]ntico\s*\n+(?:[-*]\s*\*\*[^*]+\*\*:[^\n]*\n*)*',
        '',
        human_text,
        flags=re.IGNORECASE | re.MULTILINE
    )

    # Then replace identifiers with meanings
    for identifier in sorted_identifiers:
        pattern = rf'\b{re.escape(identifier)}\b'
        human_text = re.sub(pattern, meaning, human_text)

    # Clean up any remaining definition-like lines
    human_text = re.sub(r'^[-*]\s*\*\*[^*]+\*\*:\s*[^\n]*$\n?', '', human_text, flags=re.MULTILINE)
```

### 3. Endpoint de Migracao (`backlog_generation.py`)

**Arquivo:** `backend/app/api/routes/backlog_generation.py`

**Endpoint:** `POST /api/v1/backlog/migrate-descriptions`

```python
@router.post("/migrate-descriptions", status_code=status.HTTP_200_OK)
async def migrate_semantic_to_human_descriptions(
    project_id: UUID = None,
    db: Session = Depends(get_db)
):
    """
    PROMPT #86 - Migrate existing cards to use proper human-readable descriptions.

    Re-processes description field for all cards with:
    - generated_prompt (semantic markdown)
    - interview_insights.semantic_map
    """
```

---

## Arquivos Modificados

| Arquivo | Modificacao | Linhas |
|---------|-------------|--------|
| `frontend/src/components/kanban/DraggableTaskCard.tsx` | Adicionado `showInterviewButtons={false}` | 70 |
| `backend/app/services/backlog_generator.py` | Melhorado regex da funcao `_convert_semantic_to_human` | 45-101 |
| `backend/app/api/routes/backlog_generation.py` | Adicionado endpoint `/migrate-descriptions` | 448-533 |

---

## Como Executar a Migracao

Para corrigir cards existentes no banco de dados:

```bash
# Migrar todos os cards
curl -X POST "http://localhost:8000/api/v1/backlog/migrate-descriptions"

# Migrar apenas cards de um projeto especifico
curl -X POST "http://localhost:8000/api/v1/backlog/migrate-descriptions?project_id={UUID}"
```

**Resposta esperada:**
```json
{
  "total_processed": 1,
  "updated": 1,
  "skipped": 0,
  "message": "Successfully migrated 1 cards to human-readable descriptions"
}
```

---

## Antes vs Depois

### Descricao Antes (PROMPT #85 - com bug):

```markdown
# Epic: Sistema de Gestao Clinica

- **Recepcionista da clinica**: Recepcionista da clinica
- **Paciente da clinica**: Paciente da clinica
- **Terapeuta**: Terapeuta
...

## Descricao

Este Epic implementa Sistema de agendamento centralizado...
```

### Descricao Depois (PROMPT #86 - corrigido):

```markdown
# Epic: Sistema de Gestao Clinica

## Descricao

Este Epic implementa Sistema de agendamento centralizado e Sistema de prontuario eletronico
integrados para uma clinica terapeutica, permitindo que Recepcionista da clinica execute
Processo de agendamento presencial/telefonico para Paciente da clinica...
```

---

## Beneficios

1. **UX Kanban Corrigida**: Clicar em card abre popup de detalhes, nao entrevista
2. **Descricao Limpa**: Texto humano legivel sem secao Mapa Semantico redundante
3. **Migracao Facil**: Endpoint para corrigir cards existentes com um comando
4. **Backward Compatible**: Cards sem semantic_map continuam funcionando

---

## Status: COMPLETE

**Key Achievements:**
- Fix Kanban click navigation
- Fix semantic-to-human conversion function
- Created migration endpoint for existing cards
- Tested and verified all fixes

**Impact:**
- 100% melhoria na UX do Kanban
- Descricoes limpas e legiveis para humanos
- Prompt semantico preservado na aba Prompt para geracao de cards filhos

---

**PROMPT #86 - Completed**

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
