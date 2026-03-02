# PROMPT #238 - Resiliência Frontend: Reconexão Automática ao Pipeline

## Status: COMPLETED

## Date: 2026-03-02

---

## Objective

Corrigir a perda de comunicação entre frontend e backend quando alterações no código frontend são feitas durante um pipeline em execução. O desenvolvedor não precisa mais reiniciar toda a stack — o frontend reconecta automaticamente e recupera o estado completo do pipeline do Redis.

---

## Root Cause (3 bugs no `usePipelineTelemetry.ts`)

| Bug | Impacto |
|-----|---------|
| URLs hardcoded `ws://localhost:8000` | Não usa `NEXT_PUBLIC_API_URL`, quebra em Docker/staging |
| Sem fetch Redis no mount | PipelineMonitor vazio até próximo evento após hot-reload |
| Sem catch-up no reconnect WS | Após reconexão WebSocket, fica vazio também |
| Sem `started_at` no Redis | Frontend não calcula tempo decorrido real |

---

## What Was Implemented

### Frontend (`usePipelineTelemetry.ts`)

1. **URLs via env var** — Usa `process.env.NEXT_PUBLIC_API_URL` (mesmo padrão do NotificationContext)
2. **Fetch Redis no mount** — `pollLiveState()` chamado imediatamente antes de `connect()` no useEffect
3. **Fetch Redis no reconnect** — `pollLiveState()` chamado no `ws.onopen` para catch-up
4. **Reordenação** — `pollLiveState` declarado antes de `connect` para evitar TS2448
5. **elapsedMs calculado** — `pollLiveState` inicializa `startTimeRef` do Redis `started_at`

### Backend (`deep_pipeline.py`)

1. **`started_at` no Redis** — `self._run_started_at = int(time.time() * 1000)` gravado no hash Redis

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/hooks/usePipelineTelemetry.ts` | URLs env var, mount fetch, reconnect fetch, reordenação, elapsedMs |
| `backend/app/services/deep_pipeline.py` | `_run_started_at` init + `started_at` no Redis hash |

---

## Testing Results

- TypeScript: zero erros nos arquivos alterados (`tsc --noEmit`)
- Frontend reiniciado com sucesso (`npm run dev` → Ready in 1840ms)

---

## Recovery Flow (After Fix)

```
Hot-reload/restart → useEffect fires
  → pollLiveState() busca GET /pipeline-live (Redis snapshot)
  → PipelineMonitor mostra estado atual instantaneamente
  → connect() estabelece WebSocket para streaming
  → Eventos futuros atualizam em tempo real
```
