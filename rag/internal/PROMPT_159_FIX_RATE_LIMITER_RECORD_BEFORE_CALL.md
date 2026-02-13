# PROMPT #159 - Fix Rate Limiter: Record Slot Before API Call + Provider Backoff
## Rate limiter não funcionava: slots não eram registrados + provider retry-after era ignorado

**Date:** February 3, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix + Feature
**Impact:** Rate limiter agora funciona corretamente — slots são registrados antes da chamada e o "retry in Xs" do provider é respeitado automaticamente.

---

## Problema 1: record_request() nunca executava

`record_request()` estava **dentro do bloco `try`, após a chamada de API**:

```python
try:
    result = await self._execute_google(...)   # ← se falha com exceção...
    ...
    record_request(...)                        # ← nunca executa
except:
    # erro logado, mas Redis ainda vazio
```

Quando o Gemini retornava `quota exceeded`, `record_request()` nunca era chamado → Redis vazio → rate limiter sempre permitia chamadas → loop infinito.

### Fix 1: Mover record_request() para antes da chamada

```python
if self.rate_limiter and model_config.get('rate_limit_requests'):
    can_proceed, wait_time = self.rate_limiter.check_rate_limit(...)
    if not can_proceed:
        await asyncio.sleep(wait_time)

    # Record BEFORE the API call
    self.rate_limiter.record_request(...)
```

---

## Problema 2: Provider retry-after era ignorado

Mesmo com slots disponíveis localmente, o Google podia retornar:
```
quota exceeded ... Please retry in 29.438272654s
```

O rate limiter ignorava esse "retry in Xs" e continuava permitindo chamadas.

### Fix 2: Provider Backoff

Adicionado ao `rate_limiter.py`:
- `set_provider_backoff(model_id, seconds)` — bloqueia modelo por X segundos no Redis
- `get_provider_backoff(model_id)` — retorna segundos restantes de bloqueio
- `check_rate_limit()` verifica backoff ANTES de contar slots locais

Adicionado ao `ai_orchestrator.py` (`_execute_google`):
- Extrai "retry in Xs" do erro via regex
- Chama `set_provider_backoff()` automaticamente

Fluxo novo:
```
1. check_rate_limit() verifica backoff do provider
2. Se backoff ativo → retorna (False, remaining_seconds)
3. Se não → verifica slots locais normalmente
4. Se chamada falha com "retry in Xs" → seta backoff para próximas chamadas
```

---

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `backend/app/services/ai_orchestrator.py` | Moveu `record_request()` para antes da chamada. Adicionou `_current_model_id` para extrair retry-after. Extrai "retry in Xs" do erro Gemini e seta provider backoff. |
| `backend/app/services/rate_limiter.py` | Adicionou `set_provider_backoff()`, `get_provider_backoff()`. `check_rate_limit()` verifica backoff primeiro. |

---

## Configuração Ajustada

- Gemini rate limit reduzido de 10 → 8 req/min
- Margem de segurança contra Google free tier (20 req/min)

---

## Verificação

1. Redis key `rate_limit:{model_id}` agora é populada
2. Redis key `rate_limit:backoff:{model_id}` é setada quando provider retorna "retry in Xs"
3. Próximas chamadas respeitam o backoff automaticamente

---

## Status: COMPLETE

Commits:
- `6d5055a` — fix: record rate-limit slot before API call, not after
- `879c726` — feat: respect provider retry-after in rate limiter (provider backoff)
