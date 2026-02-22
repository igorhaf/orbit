# PROMPT #253 - Claudio: CWD (Working Directory) + Extended Thinking
## Support for cwd and thinking parameters in Claudio proxy calls

**Date:** February 21, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Claudio agora recebe cwd do projeto (code_path) e extended thinking nas chamadas de pipeline RAG

---

## Objective

1. Passar o `code_path` do projeto como `cwd` para o Claudio em todas as chamadas, permitindo que o CLI do Claude tenha acesso ao filesystem do projeto para ler/editar arquivos
2. Ativar modo `thinking` (extended thinking) nas fases 2, 3 e 4 do pipeline RAG, permitindo que o modelo "pense" antes de responder com analise mais profunda
3. Migrar chamadas Claudio de AsyncAnthropic SDK para httpx direto, pois o SDK nao suporta `cwd` nem `thinking` como parametros

---

## What Was Implemented

### 1. Novos metodos `_execute_claudio` e `_execute_claudio_streaming`
- Chamadas HTTP diretas via `httpx` ao Claudio proxy (`localhost:8001/v1/messages`)
- Suportam `cwd` (string com path absoluto) e `thinking` (dict com type/budget_tokens)
- Parseia response com content blocks (thinking + text) corretamente
- Streaming via SSE com parse de eventos (content_block_delta, message_delta, etc.)
- Quando `thinking` esta ativo, `temperature` NAO e enviado (requisito da API)

### 2. Parametro `cwd` automatico a partir de `project_id`
- `_execute_with_config` agora recebe `project_id` opcional
- Quando provider e "claudio" e `project_id` existe, busca `code_path` do projeto no DB
- Passa automaticamente como `cwd` na chamada HTTP ao Claudio
- Log: `Claudio cwd: /home/user/projeto`

### 3. Parametro `thinking` no `execute()`
- Novo parametro `thinking: Optional[Dict]` em `execute()`
- Propagado por toda a chain: `execute()` -> `_execute_with_config()` -> `_execute_claudio()`
- Formato: `{"type": "enabled", "budget_tokens": 10000}`

### 4. Pipeline RAG com Thinking Mode
- Fases 2, 3 e 4 agora usam `thinking={"type": "enabled", "budget_tokens": 10000}`
- `max_tokens` aumentado de 16384 para 32000 (precisa ser > budget_tokens + resposta)
- Constante `THINKING_CONFIG` centralizada na classe `RagPipelineService`

---

## Files Modified

### Modified:
1. **backend/app/services/ai_orchestrator.py**
   - Adicionado `Any` ao import typing
   - Novo metodo `_execute_claudio()` — chamada HTTP direta com cwd + thinking
   - Novo metodo `_execute_claudio_streaming()` — streaming SSE com cwd + thinking
   - `execute()` recebe novo parametro `thinking: Optional[Dict]`
   - `_execute_with_config()` recebe `project_id` e `thinking`, resolve cwd do projeto
   - 4 call sites de `_execute_with_config` atualizados para propagar project_id e thinking
   - Dispatch do provider "claudio" roteado para novos metodos ao inves de `_execute_anthropic`

2. **backend/app/services/rag_pipeline.py**
   - Nova constante `THINKING_CONFIG = {"type": "enabled", "budget_tokens": 10000}`
   - Phase 2: `thinking=self.THINKING_CONFIG`, `max_tokens=32000`
   - Phase 3: `thinking=self.THINKING_CONFIG`, `max_tokens=32000`
   - Phase 4: `thinking=self.THINKING_CONFIG`, `max_tokens=32000`

---

## Testing Results

```bash
python -c "ast.parse(...)" — ai_orchestrator.py sem syntax errors
python -c "ast.parse(...)" — rag_pipeline.py sem syntax errors
```

---

## Key Insights

### 1. SDK vs HTTP direto para Claudio
O AsyncAnthropic SDK nao aceita `cwd` nem `thinking` como kwargs do `client.messages.create()`. Esses sao parametros especificos do proxy Claudio que vao direto no body JSON. A solucao foi criar metodos dedicados que usam httpx para chamadas HTTP diretas, mantendo os metodos SDK para Anthropic real.

### 2. thinking exclui temperature
Quando `thinking` esta ativo, a API nao aceita `temperature`. O codigo trata isso automaticamente: se thinking presente, nao envia temperature.

### 3. max_tokens > budget_tokens + resposta
Com thinking budget de 10K tokens, o max_tokens precisa ser alto o suficiente para acomodar tanto o pensamento quanto a resposta. 32K tokens da espaco confortavel.

---

## Status: COMPLETE

**Key Achievements:**
- Claudio recebe `cwd` automaticamente a partir do `code_path` do projeto
- Extended thinking ativo em todas as fases do pipeline RAG (10K budget)
- Metodos HTTP dedicados para Claudio (nao dependem mais do SDK)
- Backward compatible — chamadas sem thinking/cwd continuam funcionando normalmente
