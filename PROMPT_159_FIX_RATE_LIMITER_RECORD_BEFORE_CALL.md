# PROMPT #159 - Fix Rate Limiter: Record Slot Before API Call
## Rate limiter nunca engajava porque record_request() só era chamado após chamada bem-sucedida

**Date:** February 3, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Rate limiter agora funciona corretamente para todos os providers — slots são reservados antes da chamada de API, impedindo que erros de quota do provider criarem um loop infinito de tentativas não-throttleadas.

---

## Root Cause

`record_request()` estava na linha 674 do `ai_orchestrator.py`, **dentro do bloco `try`, após a chamada de API**:

```
try:
    result = await self._execute_google(...)   # ← se falha com exceção...
    ...
    record_request(...)                        # ← nunca executa
except:
    # erro logado, mas Redis ainda vazio
```

Quando o Gemini retornava `quota exceeded` (ou qualquer outro erro de provider), a exceção pulava para o `except` e `record_request()` **nunca era chamado**. Redis ficava vazio → próximo `check_rate_limit()` retornava `can_proceed=True` → mesma chamada era feita → mesmo erro → loop infinito sem throttle.

### Por que o Redis estava vazio

- `check_rate_limit()` conta entradas no sorted set Redis
- `record_request()` adiciona entradas ao sorted set
- Se `record_request` nunca executa → sorted set sempre vazio → count sempre 0 → sempre abaixo do limite

### Cenário exato

```
Request 1: Redis count=0 < 10 ✅ → chama Gemini → quota exceeded ❌ → record_request NÃO chamado
Request 2: Redis count=0 < 10 ✅ → chama Gemini → quota exceeded ❌ → record_request NÃO chamado
...
Request N: Redis count=0 < 10 ✅ → chama Gemini → quota exceeded ❌ → loop infinito
```

O usuário configurou 10 req/min, mas o rate limiter efetivamente não limitava nada.

---

## Fix Aplicado

Moveu `record_request()` para **imediatamente após** `check_rate_limit()`, antes da chamada de API:

```python
# PROMPT #152 - Rate Limiting Check
if self.rate_limiter and model_config.get('rate_limit_requests'):
    can_proceed, wait_time = self.rate_limiter.check_rate_limit(...)
    if not can_proceed:
        await asyncio.sleep(wait_time)

    # Record the request slot BEFORE the API call so that failed requests
    # (e.g. provider quota exceeded) are still counted against the limit.
    self.rate_limiter.record_request(
        model_config['db_model_id'],
        model_config['rate_limit_window_seconds']
    )
```

Semântica: a **intenção de chamar** o provider conta contra o limite, não o resultado da chamada. Isso alinha com o comportamento de um sliding-window rate limiter correto.

---

## Arquivo Modificado

| Arquivo | Mudança |
|---------|---------|
| `backend/app/services/ai_orchestrator.py` | Moveu `record_request()` de após chamada de API para antes dela (dentro do bloco `if self.rate_limiter`). Removeu chamada duplicada no bloco de sucesso. |

---

## Verificação

1. Redis confirmado conectado e ativo (`ping: True`)
2. Antes do fix: `rate_limit:*` keys = 0 (nunca registrava)
3. Após o fix: simulação com 10 requests → Redis registra 10 entradas → 11º request retorna `can_proceed=False, wait_time=60s`
4. Backend reloaded via bind mount (sem rebuild necessário)

---

## Status: COMPLETE
