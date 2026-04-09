# Analytics

Real-time tracking of AI usage, costs, and performance.

## Tokens Page (`/analytics/tokens`)

- **Total tokens**: Input + output across all providers
- **Execution count**: Total AI API calls
- **Average latency**: Mean execution time per call
- **Cache hit rate**: Percentage of cached responses
- **By provider**: Token consumption breakdown
- **By usage type**: Token consumption by operation type
- **Cache levels**: L1/L2/L3 individual hit rates
- **RAG metrics**: Hit rate, similarity scores, retrieval time

## Costs Page (`/analytics/costs`)

- **Total cost**: In BRL (auto-converted from USD)
- **Cost per execution**: Average cost per AI call
- **Cache savings**: Money saved by cached responses
- **Monthly projection**: Based on current consumption
- **By provider**: Cost breakdown per AI provider
- **By usage type**: Cost breakdown per operation type
- **Daily trend**: 30-day cost chart
- **Recent executions**: Last 5 executions with cost detail

## Data Sources

| Metric | Source |
|--------|--------|
| Token usage | `ai_executions` table |
| Costs | Calculated from tokens × model pricing |
| Cache stats | Redis cache statistics |
| RAG metrics | `ai_executions` with `rag_enabled=true` |
| Exchange rate | AwesomeAPI (USD/BRL, cached 30 min) |

## Pipeline Metrics

The pipeline monitor shows per-run:
- Tokens in/out per phase
- Cost per phase
- Phase quality scores (0-100)
- Phase durations
- Overall pipeline score
