---
title: "Sistema de Jobs Assíncronos"
slug: "sistema-jobs"
source: "generated"
order_index: 13
created_at: "2026-03-05T04:46:25.530322"
updated_at: "2026-03-05T04:46:25.530322"
---

# Sistema de Jobs Assíncronos

## PriorityJobExecutor

### Níveis de Prioridade
| Nível | Label | Comportamento |
|-------|-------|---------------|
| P0 | Critical | Execução imediata |
| P1 | High | Próximo slot disponível |
| P2 | Medium | Fila padrão |
| P3 | Low | Processamento idle |

### Job Types
- `deep_pipeline`: Análise completa de codebase
- `backlog_generation`: Geração de Epic/Story/Task
- `wiki_generation`: Geração de páginas wiki
- `code_indexing`: Indexação de código no RAG
- `rag_scan`: Scan contínuo de arquivos

## Lifecycle

```
queued → running → completed
                 → failed
                 → cancelled
```

## Frontend: NotificationBell
- Poll `/api/v1/jobs/active` a cada 5 segundos
- Badge com count de jobs ativos
- Dropdown com lista de jobs
- Click para ver progresso detalhado

