---
title: "Analytics e Monitoramento"
slug: "analytics-monitoramento"
source: "generated"
order_index: 11
created_at: "2026-03-05T04:46:25.399715"
updated_at: "2026-03-05T04:46:25.399715"
---

# Analytics e Monitoramento

## Tokens & Performance (/analytics/tokens)

### Métricas Principais
- Total de tokens consumidos (input + output)
- Número de chamadas de IA
- Cache hit rate (L1/L2/L3)
- Custo total em USD

### Gráficos
- Uso de tokens por período (hora, dia, semana, mês)
- Breakdown por modelo (Claude, GPT, Gemini)
- Hit rate do cache por nível

### Métricas RAG
- Hit rate de busca
- Similaridade média
- Tempo de retrieval
- Tabela comparativa de RAG por projeto

## Custos (/analytics/costs)

### Cálculo de Custo
```
cost_usd = (input_tokens * input_price + output_tokens * output_price) per model
```

### Multi-Currency
- Tracking primário em USD
- Conversão para BRL via AwesomeAPI (USD-BRL)
- Exchange rate cacheado por 1 hora
- Ambos valores exibidos

### Projeções
- Custo diário médio
- Projeção mensal
- Breakdown por provider e usage_type

## Logging
Toda chamada AI loga em `ai_usage_log`:
- model_id, provider, usage_type
- input_tokens, output_tokens, total_tokens
- cost_usd, latency_ms
- cache_hit, cache_type
- project_id

