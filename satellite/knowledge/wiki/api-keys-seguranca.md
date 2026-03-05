---
title: "API Keys e Segurança"
slug: "api-keys-seguranca"
source: "generated"
order_index: 21
created_at: "2026-03-05T04:46:26.101288"
updated_at: "2026-03-05T04:46:26.101288"
---

# API Keys e Segurança

## Regra Fundamental

**API Keys são armazenadas NO BANCO DE DADOS (tabela `ai_models`), NUNCA no .env**

## Como Funciona

1. Usuário configura API keys via interface web (`/ai-models`)
2. Keys armazenadas na tabela `ai_models` do PostgreSQL
3. AIOrchestrator busca keys do banco quando precisa
4. Arquivo `.env` contém APENAS: DATABASE_URL, SECRET_KEY, REDIS_HOST, etc.

## Tabela ai_models

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Identificador |
| name | string | Nome (ex: "Claude Sonnet 4.5") |
| provider | string | anthropic, openai, google, ollama |
| model_id | string | ID do modelo na API |
| api_key | string | Chave da API |
| usage_types | array | ["interview", "general", etc.] |
| is_active | boolean | Se está ativo |

## .env (Apenas Configurações Gerais)

```bash
DATABASE_URL=postgresql://orbit:orbit_password@localhost:5432/orbit
SECRET_KEY=your-secret-key
REDIS_HOST=redis
REDIS_PORT=6379
OLLAMA_BASE_URL=http://172.27.144.1:11434
```

## População do Banco
Usar placeholder: `'configure-via-web-interface'`
Nunca: `os.getenv('ANTHROPIC_API_KEY')` ❌

