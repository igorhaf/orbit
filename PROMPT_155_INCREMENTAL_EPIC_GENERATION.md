# PROMPT #155 - Incremental Epic Generation
## Geração Incremental de Épicos com WebSocket Updates

**Date:** February 3, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Épicos são gerados em lotes menores, evitando truncamento JSON e mostrando progresso em tempo real

---

## Problema

Quando o sistema gerava épicos sugeridos após o memory scan, fazia uma **única chamada de IA** solicitando 15-20 épicos de uma vez:

1. **Truncamento de JSON:** Resposta única com muitos épicos podia truncar antes de completar
2. **Sem feedback visual:** Usuário esperava 20-30s sem ver progresso
3. **Tudo ou nada:** Se truncar, perdia todos os épicos
4. **Bloqueio percebido:** Usuário achava que sistema travou

---

## Solução Implementada

### Geração em Lotes (Batch) com WebSocket

Em vez de uma chamada gerando 20 épicos, agora fazemos **4 chamadas gerando 5 épicos cada**:

```
Memory scan completa
       ↓
Batch 1: Gera 5 épicos → Salva no DB → WebSocket broadcast (25%)
       ↓
Batch 2: Gera 5 épicos → Salva no DB → WebSocket broadcast (50%)
       ↓
Batch 3: Gera 5 épicos → Salva no DB → WebSocket broadcast (75%)
       ↓
Batch 4: Gera 5 épicos → Salva no DB → WebSocket broadcast (100%)
       ↓
Job completa com total de épicos criados
```

---

## Arquivos Modificados

### Backend

| Arquivo | Mudança |
|---------|---------|
| `backend/app/services/context_generator.py` | Adicionados métodos `generate_epics_incrementally()`, `_generate_epic_batch()`, `_save_epic_batch()`, `_broadcast_epic_batch()` |
| `backend/app/api/routes/projects.py` | Modificado `_process_cards_from_memory_async()` para passar `job_manager` e `job_id` |

### Frontend

| Arquivo | Mudança |
|---------|---------|
| `frontend/src/contexts/NotificationContext.tsx` | Handler para evento `epics_batch_created` que dispara `CustomEvent` |
| `frontend/src/app/projects/[id]/page.tsx` | Listener para `epicsBatchCreated` que atualiza `tasks` incrementalmente |
| `frontend/src/app/projects/new/page.tsx` | Listener para `epicsBatchCreated` que atualiza `suggestedEpics` incrementalmente |

---

## Detalhes Técnicos

### 1. Método `generate_epics_incrementally()`

```python
async def generate_epics_incrementally(
    self,
    project: Project,
    job_manager,
    job_id: UUID,
    max_batches: int = 4,
    epics_per_batch: int = 5
) -> Dict[str, Any]:
```

**Funcionalidades:**
- Loop de `max_batches` iterações (padrão: 4)
- Cada batch gera `epics_per_batch` épicos (padrão: 5)
- Mantém set de títulos já gerados para evitar duplicatas
- Atualiza progresso via `job_manager.update_progress()`
- Salva épicos no DB imediatamente após cada batch
- Broadcast via WebSocket para frontend

### 2. Método `_generate_epic_batch()`

- Prompt específico pedindo **exatamente N épicos**
- Lista de épicos já gerados para não repetir
- Lista de features existentes para não sugerir o que já existe
- `max_tokens=2000` (menor que antes, pois são apenas 5 épicos)
- Retorna `{"epics": [...], "has_more": true/false}`

### 3. Evento WebSocket `epics_batch_created`

```json
{
  "event": "epics_batch_created",
  "data": {
    "project_id": "uuid",
    "batch_number": 2,
    "total_batches": 4,
    "epics_count": 5,
    "epics": [...]
  }
}
```

### 4. Frontend Event Listener

```typescript
window.addEventListener('epicsBatchCreated', (event: CustomEvent) => {
  const { projectId, epics, batchNumber, totalBatches } = event.detail;
  // Atualiza estado local com novos épicos
});
```

---

## Configurações Padrão

| Parâmetro | Valor | Justificativa |
|-----------|-------|---------------|
| `max_batches` | 4 | Máximo de 20 épicos total |
| `epics_per_batch` | 5 | JSON pequeno, não trunca |
| `max_tokens` | 2000 | Suficiente para 5 épicos |

---

## Benefícios

| Benefício | Impacto |
|-----------|---------|
| **Sem truncamento** | Cada batch tem apenas 5 épicos |
| **Feedback em tempo real** | Usuário vê épicos aparecendo progressivamente |
| **Recuperação parcial** | Se falhar no batch 3, ainda tem 10 épicos |
| **UX fluida** | Não parece travado - mostra progresso |
| **Escalável** | Pode ajustar batches/épicos conforme necessário |

---

## Fluxo de Dados

```
┌──────────────────────────────────────────────────────────────────────┐
│                         BACKEND                                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  generate_cards_from_memory(project_id, job_manager, job_id)         │
│         │                                                             │
│         ▼                                                             │
│  generate_epics_incrementally()                                       │
│         │                                                             │
│         ├──► _generate_epic_batch(batch=1) ──► AI returns 5 epics    │
│         │         │                                                   │
│         │         ▼                                                   │
│         │    _save_epic_batch() ──► DB INSERT                        │
│         │         │                                                   │
│         │         ▼                                                   │
│         │    _broadcast_epic_batch() ──► WebSocket broadcast          │
│         │                                                             │
│         ├──► _generate_epic_batch(batch=2) ──► ...                   │
│         │                                                             │
│         └──► ... (até max_batches)                                   │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌──────────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  NotificationContext (handleWebSocketEvent)                           │
│         │                                                             │
│         ▼ event: 'epics_batch_created'                               │
│                                                                       │
│  window.dispatchEvent(CustomEvent('epicsBatchCreated', detail))      │
│         │                                                             │
│         ├──► projects/[id]/page.tsx ──► setTasks([...prev, ...new])  │
│         │                                                             │
│         └──► projects/new/page.tsx ──► setSuggestedEpics([...])      │
│                                                                       │
│  UI atualiza em tempo real mostrando épicos aparecendo               │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Verificação

1. Criar novo projeto com pasta de código
2. Verificar logs do backend: "Gerando épicos (lote 1/4)..."
3. Verificar console do browser: "📦 Received epic batch 1/4: 5 epics"
4. Verificar Backlog: épicos aparecem incrementalmente (5 de cada vez)
5. Verificar notificação final: "✅ X regras + Y épicos gerados"

---

## Compatibilidade

- **Backward compatible:** Se `job_manager` e `job_id` não forem passados, usa geração legacy (single-call)
- **WebSocket opcional:** Se broadcast falhar, épicos ainda são salvos no DB
- **Fallback graceful:** Se IA retornar menos que 5 épicos ou indicar `has_more: false`, para de gerar

---

## Status: COMPLETE

**Entregue:**
- Geração incremental de épicos em lotes de 5
- WebSocket broadcast após cada batch
- UI atualiza em tempo real
- Progress tracking no sistema de jobs

**Impacto:**
- Zero truncamento de JSON (batches pequenos)
- UX muito melhor (feedback visual contínuo)
- Recuperação parcial se algo falhar
