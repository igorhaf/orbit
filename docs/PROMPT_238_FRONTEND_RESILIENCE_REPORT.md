# PROMPT #238 - Resiliência Frontend + Telemetria Real-Time

## Status: COMPLETED

## Date: 2026-03-02

---

## Objective

1. **Resiliência**: Corrigir a perda de comunicação entre frontend e backend quando alterações no código frontend são feitas durante um pipeline em execução. O frontend reconecta automaticamente e recupera o estado completo do Redis.
2. **Telemetria real-time**: Corrigir o problema de telemetria estática — os contadores, percentagens e atividades agora evoluem em tempo real durante a execução do pipeline, item a item.

---

## Root Cause

### Problema 1: Frontend perde conexão (3 bugs no `usePipelineTelemetry.ts`)

| Bug | Impacto |
|-----|---------|
| URLs hardcoded `ws://localhost:8000` | Não usa `NEXT_PUBLIC_API_URL`, quebra em Docker/staging |
| Sem fetch Redis no mount | PipelineMonitor vazio até próximo evento após hot-reload |
| Sem catch-up no reconnect WS | Após reconexão WebSocket, fica vazio também |
| Sem `started_at` no Redis | Frontend não calcula tempo decorrido real |

### Problema 2: Telemetria estática (bug no `call_batch`)

| Bug | Impacto |
|-----|---------|
| `call_batch` usa `asyncio.gather` bloqueante | Retorna TODOS os resultados de uma vez, sem emitir eventos intermediários |
| Telemetria emitida no loop pós-batch | Só atualiza após batch inteiro completar (ex: 528 arquivos de uma vez) |
| Frontend mostra 0% → 100% sem transição | Contadores "pulam" em vez de evoluir gradualmente |

---

## What Was Implemented

### Frontend (`usePipelineTelemetry.ts`)

1. **URLs via env var** — Usa `process.env.NEXT_PUBLIC_API_URL` (mesmo padrão do NotificationContext)
2. **Fetch Redis no mount** — `pollLiveState()` chamado imediatamente antes de `connect()` no useEffect
3. **Fetch Redis no reconnect** — `pollLiveState()` chamado no `ws.onopen` para catch-up
4. **Reordenação** — `pollLiveState` declarado antes de `connect` para evitar TS2448
5. **elapsedMs calculado** — `pollLiveState` inicializa `startTimeRef` do Redis `started_at`

### Frontend (`PipelineMonitor.tsx`)

6. **Hooks reordenados** — `useMemo` movido antes do `return null` condicional (fix React hooks violation)

### Backend (`claudio_pipeline.py` + `ollama_pipeline.py`)

7. **`on_item_complete` callback** — Novo parâmetro em `call_batch()` que dispara após cada item individual completar, dentro do `asyncio.gather`

### Backend (`deep_pipeline.py`)

8. **`started_at` no Redis** — `self._run_started_at = int(time.time() * 1000)` gravado no hash Redis
9. **5 callbacks real-time** — Telemetria emitida item a item (não mais pós-batch):
   - `_on_file_done` (Phase 1: file analysis)
   - `_on_story_done` (Phase 4b: story decomposition)
   - `_on_task_done` (Phase 4c: task decomposition)
   - `_on_subtask_done` (Phase 4d: subtask decomposition)
   - `_on_domain_done` (Phase 5c: wiki domains)

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/hooks/usePipelineTelemetry.ts` | URLs env var, mount fetch, reconnect fetch, reordenação, elapsedMs |
| `frontend/src/components/pipeline/PipelineMonitor.tsx` | Hooks reordenados antes do early return |
| `backend/app/services/claudio_pipeline.py` | `on_item_complete` callback no `call_batch` |
| `backend/app/services/ollama_pipeline.py` | `on_item_complete` callback no `call_batch` |
| `backend/app/services/deep_pipeline.py` | `started_at` no Redis + 5 callbacks real-time para todas as fases com `call_batch` |

---

## How Real-Time Telemetry Works

```
call_batch(requests, on_item_complete=callback)
  → asyncio.gather spawns N concurrent tasks
  → Each task completes independently
  → on_item_complete fires IMMEDIATELY for each completed item
    → _emit_telemetry() → Redis hash update + WebSocket broadcast
    → Frontend receives pipeline_activity event
    → PipelineMonitor updates counters/progress in real-time
```

Before: `0%` ————— (long wait) ————— `100%`
After:  `0%` → `1%` → `2%` → ... → `100%` (item by item)

---

## Recovery Flow (After Fix)

```
Hot-reload/restart → useEffect fires
  → pollLiveState() busca GET /pipeline-live (Redis snapshot)
  → PipelineMonitor mostra estado atual instantaneamente
  → connect() estabelece WebSocket para streaming
  → Eventos futuros atualizam em tempo real, item a item
```
