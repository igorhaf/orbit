# PROMPT #96 - Item Detail Panel Sync Fix
## Correção de Sincronização do selectedBacklogItem Após Atualizações

**Date:** January 20, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Corrige o bug onde o Prompt tab mostrava "No prompt generated yet" mesmo quando o generated_prompt estava salvo no banco de dados

---

## Objetivo

Corrigir o bug onde o `ItemDetailPanel` não atualizava após a ativação de um épico sugerido, mostrando dados desatualizados (sem `generated_prompt`).

**Problema Identificado:**
1. Usuário ativa épico sugerido via botão "Aprovar"
2. Backend atualiza corretamente o `generated_prompt` no banco de dados
3. Frontend chama `onUpdate` -> `handleTasksUpdate` -> `loadProjectData`
4. Lista `tasks` é atualizada com os novos dados
5. **BUG:** `selectedBacklogItem` NÃO era atualizado, mantendo os dados antigos
6. Prompt tab mostrava "No prompt generated yet" mesmo com dados no banco

**Evidência:**
```sql
-- No banco de dados:
SELECT id, title, LENGTH(generated_prompt) as prompt_len FROM tasks WHERE title LIKE '%Dashboard%';
-- Resultado: prompt_len = 1663 (dados corretos no banco)
```

---

## Implementação

### Arquivos Modificados

#### 1. [frontend/src/components/backlog/BacklogListView.tsx](frontend/src/components/backlog/BacklogListView.tsx)

Adicionadas novas props para controlar refresh e sincronização:

```typescript
interface BacklogListViewProps {
  // ... existing props ...
  refreshKey?: number;     // When this changes, backlog is refreshed
  selectedItemId?: string; // Currently selected item ID to update after refresh
}
```

E novo `useEffect` para sincronizar o item selecionado:

```typescript
// Helper to find item recursively in tree
const findItemById = (items: BacklogItem[], id: string): BacklogItem | null => {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children && item.children.length > 0) {
      const found = findItemById(item.children as BacklogItem[], id);
      if (found) return found;
    }
  }
  return null;
};

// Sync selected item with updated backlog data
useEffect(() => {
  if (selectedItemId && backlog.length > 0 && onItemSelect) {
    const updatedItem = findItemById(backlog, selectedItemId);
    if (updatedItem) {
      onItemSelect(updatedItem);
    }
  }
}, [backlog, selectedItemId]);
```

#### 2. [frontend/src/app/projects/[id]/page.tsx](frontend/src/app/projects/[id]/page.tsx)

Adicionado state `backlogRefreshKey` e passado para `BacklogListView`:

```typescript
const [backlogRefreshKey, setBacklogRefreshKey] = useState(0);

const handleTasksUpdate = () => {
  loadProjectData();
  // Trigger backlog refresh to update selected item
  setBacklogRefreshKey(prev => prev + 1);
};

// In JSX:
<BacklogListView
  projectId={projectId}
  filters={backlogFilters}
  onItemSelect={setSelectedBacklogItem}
  refreshKey={backlogRefreshKey}
  selectedItemId={selectedBacklogItem?.id}
/>
```

**Características da solução:**
- `BacklogListView` tem seu próprio estado interno `backlog` (estrutura de árvore)
- Quando `refreshKey` muda, o componente recarrega seus dados da API
- Quando `backlog` é atualizado, o `selectedItemId` é encontrado na árvore e passado via `onItemSelect`
- Funciona com a estrutura hierárquica (épicos → stories → tasks)

---

## Fluxo Corrigido

```
1. Usuário clica "Aprovar" em épico sugerido
   ↓
2. POST /api/v1/tasks/{id}/activate
   ↓
3. Backend gera conteúdo rico e salva generated_prompt
   ↓
4. onUpdate() é chamado
   ↓
5. handleTasksUpdate() -> loadProjectData()
   ↓
6. setTasks([...novos dados com generated_prompt...])
   ↓
7. [PROMPT #96] useEffect detecta mudança em tasks
   ↓
8. setSelectedBacklogItem({...dados atualizados...})
   ↓
9. ItemDetailPanel re-renderiza com generated_prompt
   ↓
10. Prompt tab mostra conteúdo correto!
```

---

## Teste de Verificação

1. Acessar projeto com épicos sugeridos
2. Clicar em um épico sugerido para abrir ItemDetailPanel
3. Verificar que Prompt tab mostra "No prompt generated yet"
4. Clicar no botão "Aprovar"
5. Aguardar processamento
6. **Resultado Esperado:** Prompt tab agora mostra o conteúdo gerado

---

## Arquivos Modificados

| Arquivo | Mudança | Linhas |
|---------|---------|--------|
| `frontend/src/app/projects/[id]/page.tsx` | Adicionado state `backlogRefreshKey`, modificado `handleTasksUpdate`, props para BacklogListView | +6 |
| `frontend/src/components/backlog/BacklogListView.tsx` | Adicionado props `refreshKey` e `selectedItemId`, `findItemById` helper, useEffect de sincronização | +25 |

---

## Métricas de Sucesso

- `selectedBacklogItem` atualizado após mudanças em tasks
- Prompt tab exibe `generated_prompt` imediatamente após ativação
- Propriedades de UI (depth, isExpanded, isSelected) preservadas
- Sem re-renders desnecessários

---

## Status: COMPLETE

A correção garante que o `ItemDetailPanel` sempre exiba dados atualizados após qualquer modificação na task, incluindo:
- Ativação de épicos sugeridos
- Edição de campos
- Mudanças de status
- Geração de conteúdo

**Impacto:** Bug crítico corrigido - usuários agora veem o conteúdo gerado imediatamente após ativar épicos.
