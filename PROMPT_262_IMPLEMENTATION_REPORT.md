# PROMPT #262 - Correcao de Notificacoes Fantasma e Mensagens de Progresso
## Investigacao de jobs duplicados + reconciliacao WebSocket

**Date:** February 13, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Bug Fix
**Impact:** Notificacoes fantasma de jobs que ja falharam/completaram sao removidas automaticamente; mensagens de progresso em portugues com contagens reais

---

## Objective

O usuario viu 2 notificacoes simultaneas de jobs:
- "Processing batch of 30 files..." (10%, agora)
- "Processing batch of 15 files..." (10%, 9 minutos atras)

Investigar se eram jobs duplicados rodando ao mesmo tempo.

---

## Diagnostico

**Resultado: NAO havia duplicacao no backend.** Analise do banco mostrou zero overlaps entre jobs. A deduplicacao via `submit_batch_processing_cycle()` funciona corretamente.

**Causa raiz:** Notificacoes "fantasma" no frontend. Quando o backend reinicia:
1. WebSocket desconecta
2. Jobs que estavam RUNNING sao marcados como FAILED pelo bootstrap cleanup
3. Frontend nunca recebe o evento `job_failed` (WebSocket estava desconectado)
4. Jobs ficam presos como "ativos" na UI indefinidamente

---

## What Was Implemented

### 1. Reconciliacao de jobs ao reconectar WebSocket
- Extraido `reconcileActiveJobs()` como `useCallback` reutilizavel
- Chamado no `ws.onopen` ao reconectar WebSocket
- Compara jobs ativos do frontend com `GET /api/v1/jobs/active` do backend
- Remove do frontend jobs que nao existem mais no backend (fantasmas)
- Adiciona ao frontend jobs novos do backend que faltam

### 2. Cleanup periodico de jobs fantasma
- `setInterval` a cada 60s chama `reconcileActiveJobs()`
- Cobre o caso em que WebSocket nao reconecta

### 3. Mensagens de progresso em portugues com counts reais
- `watchdog_cycle`: Todas as 7 mensagens de progresso traduzidas
- `batch_processing_cycle`: Mensagem inicial mostra "max" em vez de count fixo
- Apos processamento, atualiza com count real: "Processados X arquivos, Y restantes, Z regras extraidas"

### 4. Fix wiki enrichment
- `_build_stack_page()` agora recebe `scan_summary` corretamente em `_enrich_context_from_rag`
- Adicionado `exc_info=True` nos logs de falha de wiki enrichment para traceback completo

---

## Files Modified

1. **frontend/src/contexts/NotificationContext.tsx** - reconcileActiveJobs, cleanup interval, ws.onopen reconciliation
2. **backend/app/services/watchdog.py** - Mensagens de progresso em portugues, counts reais, exc_info logging
3. **backend/app/api/routes/projects.py** - Fix _build_stack_page call com scan_summary

---

## Testing Results

```
Database query: 0 overlapping jobs found (deduplication works)
generate-from-context: 200 OK, 5 pages generated (wiki working)
Backend restart: zombie jobs cleaned, new cycle starts correctly
```

---

## Status: COMPLETE

**Key Achievements:**
- Investigacao profunda confirmou que NAO ha duplicacao de jobs no backend
- Reconciliacao automatica remove notificacoes fantasma ao reconectar WebSocket
- Cleanup periodico (60s) previne acumulo de jobs stale na UI
- Mensagens de progresso agora em portugues com contagens reais
- Wiki enrichment corrigido para funcionar com novo sistema de wiki pages
