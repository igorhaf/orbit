---
title: "Cache Redis Multi-Nível"
slug: "cache-multinivel"
source: "generated"
order_index: 5
created_at: "2026-03-05T04:46:24.961353"
updated_at: "2026-03-05T04:46:24.961353"
---

# Cache Redis Multi-Nível

## Três Níveis de Cache

### L1 - Exact Match
- **Hash:** SHA256(model_id + messages + system_prompt + temperature)
- **TTL:** 7 dias
- **Hit Rate Esperado:** ~20%
- **Backend:** Redis (ou in-memory fallback)

### L2 - Semantic Match
- **Método:** Embedding similarity > 0.95
- **TTL:** 1 dia
- **Hit Rate Esperado:** ~10%
- **Backend:** Redis + pgvector (requer Redis)

### L3 - Template Cache
- **Condição:** Apenas temperature = 0 (determinístico)
- **TTL:** 30 dias
- **Hit Rate Esperado:** ~5%
- **Backend:** Redis (requer Redis)

### Total Esperado: 30-35% hit rate → 60-90% economia em custos!

## Fluxo de Lookup

```
Query → L1 (exact hash) → HIT? Return
                         ↓ MISS
         L2 (semantic >0.95) → HIT? Return
                              ↓ MISS
         L3 (template, temp=0) → HIT? Return
                                ↓ MISS
         Execute API Call → Store in Cache → Return
```

## Cache Key Normalization
- Temperature arredondada para 2 decimais
- Messages ordenadas por hash para consistência
- Model ID incluído para evitar cross-model matches

## Fallback
- Redis indisponível → L1 in-memory (LRU, max 1000 entries)
- L2/L3 desabilitados sem Redis
- Health check a cada 60s para reconexão

