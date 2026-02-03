# PROMPT #152 - Rate Limiting por Modelo de IA
## Controle de Taxa de Requisições por Modelo

**Date:** February 2, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Evita erros de quota da API, permite uso de free tiers de forma sustentavel

---

## Objetivo

Implementar rate limiting configuravel por modelo de IA para evitar problemas de quota da API. Cada modelo pode ter sua propria configuracao de "X requisicoes a cada Y segundos/minutos", e os jobs aguardam automaticamente ate que o rate limit permita a execucao.

**Problema Resolvido:**
- Google Gemini (free tier) tem limite de ~20 requisicoes por dia
- Quando excede, retorna erro de quota
- Sistema usava fallback com poucas opcoes
- Nao havia forma de controlar o rate de chamadas por modelo

---

## O Que Foi Implementado

### 1. RateLimiterService

**Arquivo:** `backend/app/services/rate_limiter.py`

Servico usando Redis Sorted Set para sliding window rate limiting:
- `check_rate_limit(model_id, max_requests, window_seconds)` -> `(can_proceed, wait_time)`
- `record_request(model_id, window_seconds)` -> registra timestamp
- `get_usage(model_id, max_requests, window_seconds)` -> stats de uso atual
- `clear_limit(model_id)` -> reset manual do rate limit

**Algoritmo:**
- Usa Redis Sorted Set com timestamp como score
- Sliding window preciso (nao bucket)
- TTL automatico para auto-limpeza
- Fail-open: se Redis falha, permite a requisicao

### 2. Novos Campos no Modelo AIModel

**Arquivo:** `backend/app/models/ai_model.py`

```python
rate_limit_requests = Column(Integer, nullable=True)  # Max requests per window
rate_limit_window_seconds = Column(Integer, nullable=True)  # Window in seconds
```

### 3. Schemas Atualizados

**Arquivo:** `backend/app/schemas/ai_model.py`

Adicionado a AIModelBase, AIModelCreate e AIModelUpdate:
```python
rate_limit_requests: Optional[int] = None
rate_limit_window_seconds: Optional[int] = None
```

### 4. Integracao no AIOrchestrator

**Arquivo:** `backend/app/services/ai_orchestrator.py`

- Inicializa rate limiter junto com cache no `__init__`
- `choose_model()` retorna campos de rate limit
- `execute()` verifica rate limit antes de chamar API
- Se excedido, aguarda automaticamente com `asyncio.sleep()`
- Apos execucao bem-sucedida, registra a requisicao

### 5. Migration Alembic

**Arquivo:** `backend/alembic/versions/g1h2i3j4k5l6_add_rate_limit_to_ai_models.py`

Adiciona colunas `rate_limit_requests` e `rate_limit_window_seconds` a tabela `ai_models`.

### 6. Frontend - Pagina AI Models

**Arquivo:** `frontend/src/app/ai-models/page.tsx`

- Secao "Rate Limiting" nos dialogs de Create e Edit
- Campos: Max Requests e Time Window (seconds)
- Exibicao do rate limit no card de cada modelo
- Helper text explicativo

### 7. Frontend Types

**Arquivo:** `frontend/src/lib/types.ts`

Adicionado a AIModel, AIModelCreate e AIModelUpdate:
```typescript
rate_limit_requests?: number | null;
rate_limit_window_seconds?: number | null;
```

---

## Arquivos Criados

| Arquivo | Descricao |
|---------|-----------|
| `backend/app/services/rate_limiter.py` | Servico de rate limiting com Redis |
| `backend/alembic/versions/g1h2i3j4k5l6_add_rate_limit_to_ai_models.py` | Migration |

---

## Arquivos Modificados

| Arquivo | Mudanca |
|---------|---------|
| `backend/app/models/ai_model.py` | Campos rate_limit_* |
| `backend/app/schemas/ai_model.py` | Schemas rate_limit_* |
| `backend/app/services/ai_orchestrator.py` | Integracao rate limiter |
| `frontend/src/app/ai-models/page.tsx` | UI rate limiting |
| `frontend/src/lib/types.ts` | Types rate_limit_* |

---

## Fluxo de Execucao

```
1. Job criado (interview_question, backlog_generation, etc.)
   |
2. AIOrchestrator.execute() chamado
   |
3. choose_model() seleciona modelo + rate limit config
   |
4. RateLimiter.check_rate_limit()
   |-- count < max -> Continua imediatamente
   |-- count >= max -> asyncio.sleep(wait_time)
   |
5. Executa chamada a API
   |
6. RateLimiter.record_request()
   |
7. Retorna resposta
```

---

## Como Usar

1. Acesse `/ai-models`
2. Clique no icone de configuracao de um modelo
3. Na secao "Rate Limiting":
   - **Max Requests:** Numero maximo de requisicoes na janela (ex: 3)
   - **Time Window:** Tamanho da janela em segundos (ex: 60)
4. Salve

**Exemplo:** `3 requests / 60 seconds` = maximo 3 requisicoes por minuto

**Nota:** Deixe vazio para sem rate limiting (comportamento atual).

---

## Verificacao

1. Editar modelo Gemini: `rate_limit_requests=3, rate_limit_window_seconds=60`
2. Criar 5 entrevistas rapidamente
3. Verificar logs: `"Rate limit reached for Gemini, waiting 45.2s..."`
4. Todas completam eventualmente sem erro de quota

---

## Beneficios

| Beneficio | Impacto |
|-----------|---------|
| Evita erros de quota | Free tiers funcionam sem interrupacao |
| Configuravel por modelo | Cada API tem seu proprio limite |
| Transparente para usuario | Jobs esperam automaticamente |
| Sem perda de requisicoes | Todas executam eventualmente |
| Fail-open | Se Redis falha, sistema continua funcionando |

---

## Status: COMPLETE

**Entregue:**
- Rate limiter service com Redis
- Campos de configuracao no modelo e schema
- Integracao completa no AIOrchestrator
- UI para configurar rate limits
- Migration aplicada

**Impacto:**
- Usuarios podem usar free tiers de APIs de IA
- Sistema aguarda automaticamente quando rate limit e excedido
- Configuracao flexivel por modelo
- Logs informativos sobre wait time
