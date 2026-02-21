# PROMPT #122 - Cohere AI Integration
## Integração com Modelos Cohere (Command R+, Command R, Command Light)

**Date:** January 30, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** ORBIT agora suporta 5 providers de IA: Anthropic, OpenAI, Google, Ollama e Cohere

---

## Objective

Adicionar suporte completo aos modelos de IA da Cohere ao sistema ORBIT, permitindo que usuários utilizem Command R+, Command R e Command Light para diferentes tipos de tarefas.

**Key Requirements:**
1. Adicionar cliente Cohere ao AIOrchestrator
2. Implementar método de execução para API Cohere Chat
3. Adicionar pricing dos modelos Cohere
4. Criar seed script para popular modelos no banco

---

## What Was Implemented

### 1. AIOrchestrator - Cliente Cohere

Adicionado suporte ao provider Cohere em `_initialize_clients`:

```python
elif provider_key == "cohere":
    # PROMPT #122 - Cohere AI integration
    import httpx
    self.clients["cohere"] = {
        "api_key": model.api_key,
        "http_client": httpx.AsyncClient(
            timeout=60.0,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
        )
    }
```

### 2. Método `_execute_cohere`

Implementado método para executar chamadas à API Cohere Chat:

- Converte mensagens do formato ORBIT para formato Cohere (USER/CHATBOT)
- Suporta system prompt via campo `preamble`
- Retorna token usage para cost tracking
- Tratamento de erros consistente com outros providers

**Endpoint:** `https://api.cohere.ai/v1/chat`

### 3. Pricing

Adicionados preços dos modelos Cohere em `pricing.py`:

| Modelo | Input ($/1M tokens) | Output ($/1M tokens) |
|--------|---------------------|----------------------|
| command-r-plus | $2.50 | $10.00 |
| command-r | $0.50 | $1.50 |
| command-light | $0.30 | $0.60 |
| command (legacy) | $1.00 | $2.00 |

### 4. Seed Script

Criado script `seed_cohere_models.py` que adiciona 4 modelos:

1. **Cohere Command R+ (Most Powerful)** - para prompt_generation
2. **Cohere Command R (Balanced)** - para general
3. **Cohere Command R (Interview)** - para interview
4. **Cohere Command Light (Fast)** - para commit_generation

---

## Files Modified

### Backend:

1. **[backend/app/services/ai_orchestrator.py](backend/app/services/ai_orchestrator.py)**
   - Added Cohere client initialization in `_initialize_clients`
   - Added `_execute_cohere` method (~85 lines)
   - Added cohere case in `execute` method
   - Added cohere default model in `_get_default_model`

2. **[backend/app/utils/pricing.py](backend/app/utils/pricing.py)**
   - Added Cohere model pricing (6 model variants)

### Created:

1. **[backend/scripts/seed_cohere_models.py](backend/scripts/seed_cohere_models.py)**
   - Seed script for 4 Cohere models
   - ~130 lines

---

## Testing Results

### Seed Script Execution:

```bash
$ docker compose exec backend python scripts/seed_cohere_models.py

INFO:__main__: Starting Cohere models seed...
INFO:__main__: Created: Cohere Command R+ (Most Powerful) (prompt_generation)
INFO:__main__: Created: Cohere Command R (Balanced) (general)
INFO:__main__: Created: Cohere Command R (Interview) (interview)
INFO:__main__: Created: Cohere Command Light (Fast) (commit_generation)
INFO:__main__:
INFO:__main__:==================================================
INFO:__main__: Summary:
INFO:__main__:   Created: 4 models
INFO:__main__:   Skipped: 0 models
INFO:__main__:   Total in DB: 16 models
INFO:__main__:   Active: 3 models
INFO:__main__:   Cohere: 4 models
INFO:__main__:==================================================
INFO:__main__:
INFO:__main__: Cohere models seed completed successfully!
```

---

## Cohere API Format

### Request Format:

```json
{
  "model": "command-r-plus",
  "message": "Current user message",
  "chat_history": [
    {"role": "USER", "message": "..."},
    {"role": "CHATBOT", "message": "..."}
  ],
  "preamble": "System prompt goes here",
  "temperature": 0.7,
  "max_tokens": 4096
}
```

### Response Format:

```json
{
  "text": "Model response",
  "meta": {
    "tokens": {
      "input_tokens": 150,
      "output_tokens": 300
    }
  }
}
```

---

## How to Use Cohere

### 1. Configure API Key

1. Go to `/ai-models` in the web interface
2. Find the Cohere model you want to use
3. Click Edit
4. Add your Cohere API key (from https://dashboard.cohere.ai/api-keys)
5. Toggle `is_active` to ON
6. Save

### 2. Set as Default for Usage Type

To use Cohere for a specific usage type:
1. Ensure the Cohere model is active
2. Deactivate other models with the same usage_type
3. Or edit the usage_type of the Cohere model to match your needs

---

## Provider Comparison

| Provider | Models | Best For | Pricing |
|----------|--------|----------|---------|
| **Anthropic** | Claude 4.5 Opus/Sonnet/Haiku | Complex reasoning, code | $$$ |
| **OpenAI** | GPT-4o, GPT-4 Turbo | General tasks | $$$ |
| **Google** | Gemini 1.5 Pro/Flash | Fast, multimodal | $$ |
| **Cohere** | Command R+/R/Light | RAG, enterprise | $$ |
| **Ollama** | Qwen, Llama, etc | Local, privacy | Free |

---

## Success Metrics

| Metric | Result |
|--------|--------|
| Client initialization | Working |
| Execute method | Implemented |
| Pricing added | 6 models |
| Seed script | 4 models created |
| Documentation | Complete |

---

## Status: COMPLETE

**Achievements:**
- Cohere provider fully integrated in AIOrchestrator
- Support for Command R+, Command R, and Command Light
- Pricing configured for cost analytics
- 4 models seeded (inactive by default)
- Compatible with existing ORBIT patterns

**Impact:**
- ORBIT now supports 5 AI providers
- Users can use Cohere's RAG-optimized models
- More flexibility in model selection
- Cost tracking works for all Cohere models

---

**PROMPT #122 - Completed**

*ORBIT agora suporta modelos Cohere (Command R+, Command R, Command Light).*
