# PROMPT #158 - Fix Context Interview Fallback (Gemini Quota + Non-deterministic Model Picker)
## Entrevista de contexto voltava perguntas genéricas porque o modelo interview estava inativo e o fallback caía no Gemini com quota esgotado

**Date:** February 3, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Entrevista de contexto agora usa Claude Haiku 3.5 corretamente — sem mais perguntas genéricas de fallback.

---

## Root Cause (duas causas encadeadas)

### 1. Claude Haiku 3.5 (Interview) estava `is_active = false`

O usuário mudou o modelo para Haiku na UI mas acabou desativando-o.
`choose_model("interview")` não encontrou modelo ativo com `usage_type=interview`
→ caiu no fallback `usage_type=general`.

### 2. Fallback general era não-determinístico

A query de fallback usava `.first()` sem `ORDER BY`:

```python
# ANTES — não-determinístico
fallback_model = self.db.query(AIModel).filter(
    AIModel.usage_type == AIModelUsageType.GENERAL,
    AIModel.is_active == True
).first()  # ← pode retornar Anthropic OU Google, aleatoriamente
```

Dois modelos general ativos existiam:
| Model | Provider | updated_at |
|-------|----------|------------|
| Claude Haiku 3.5 (Prompt) | anthropic | 2026-02-03 16:16 |
| Gemini 2.5 pro (General) | google | 2026-02-03 13:24 |

Quando o fallback sorteava Gemini, a chamada falhava com:
> `Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20`

Essa exceção era capturada no `except` de `unified_open_handler.py:388`
→ retornava a pergunta genérica hardcoded ("Qual aspecto você quer detalhar?").

### Cadeia completa:

```
interview sem modelo ativo
  → fallback para general
    → .first() sorteou Gemini
      → Gemini quota esgotado (free tier: 20 req/min)
        → Exception
          → unified_open_handler.py:388 catch
            → pergunta genérica hardcoded
```

---

## Fixes Aplicados

### Fix 1: Ativação do modelo interview no banco

```sql
UPDATE ai_models SET is_active = true
WHERE name = 'Claude Haiku 3.5 (Interview)';
-- usage_type=interview, provider=anthropic, model_id=claude-3-5-haiku-20241022
```

### Fix 2: ORDER BY no fallback general (`ai_orchestrator.py`)

```python
# DEPOIS — determinístico, sempre pega o mais recentemente editado
fallback_model = self.db.query(AIModel).filter(
    AIModel.usage_type == AIModelUsageType.GENERAL,
    AIModel.is_active == True
).order_by(AIModel.updated_at.desc()).first()
```

Isso alinha o comportamento com a query primária (`choose_model` linha 262)
que já usava `.order_by(AIModel.updated_at.desc())`.

---

## Arquivo Modificado

| Arquivo | Mudança |
|---------|---------|
| `backend/app/services/ai_orchestrator.py` | Added `.order_by(AIModel.updated_at.desc())` no fallback general query (linha ~302) |

---

## Verificação

1. `ai_executions` confirmou: todos os erros recentes eram `google/gemini-2.5-flash` com quota exceeded
2. `ai_models` confirmou: `Claude Haiku 3.5 (Interview)` estava `is_active=false`
3. Após ativar + ORDER BY: fallback general agora pega Anthropic (mais recente)
4. Backend reloaded via bind mount — código ativo sem rebuild

---

## Status: COMPLETE
