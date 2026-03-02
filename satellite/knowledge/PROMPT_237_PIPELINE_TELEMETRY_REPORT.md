# PROMPT #237 - Pipeline Telemetry: Monitoramento Microscópico em Tempo Real

## Status: COMPLETED

## Date: 2026-03-02

---

## Objective

Implementar monitoramento em tempo real e granular do pipeline Deep Analysis, com visibilidade microscópica de token I/O, custo ao vivo, ação corrente, e saúde por fase — **sem adicionar camada BFF** e **sem refresh de página**.

A diretoria considerava adicionar um BFF entre frontend e backend para resolver a falta de visibilidade. A análise arquitetural revelou que a infraestrutura existente (4 canais WebSocket, ConsoleLogger singleton, respostas com usage data) já era suficiente — o problema era que o Deep Pipeline descartava silenciosamente todos os dados de telemetria.

---

## What Was Implemented

### Camada 1 — Emissão de Eventos Granulares (Backend)

#### 1.1 ConsoleLogger — Nova categoria PIPELINE_ACTIVITY
- Adicionado `PIPELINE_ACTIVITY = "pipeline_activity"` ao enum `LogCategory`
- Novo método `log_pipeline_activity()` com parâmetros completos: project_id, trace_id, phase, action, item_name, item_index/total, model, tokens in/out, cost, cumulativos, phase_scores

#### 1.2 DeepPipelineService — Instrumentação de todas as 7 fases
- Importação de `get_console_logger` e `calculate_cost`
- Estado de telemetria no `__init__`: contadores de tokens, custo, phase_scores
- Método `_emit_telemetry()` centralizado: extrai tokens do resultado AI, calcula custo via pricing.py, acumula totais, emite via ConsoleLogger, atualiza Redis
- Instrumentação por fase:
  - **Phase 0**: emit após structural scan
  - **Phase 1**: emit por arquivo após `call_batch`
  - **Phase 2**: emit por domínio em `_synthesize_domain`
  - **Phase 3**: emit após architectural map
  - **Phase 4a**: emit por batch de epics
  - **Phase 4b**: emit por epic → stories
  - **Phase 4c**: emit por story → tasks
  - **Phase 4d**: emit por task → subtasks
  - **Phase 5a**: emit após wiki planning
  - **Phase 5b**: emit após wiki overview
  - **Phase 5c**: emit por domínio wiki pages
  - **Phase 6**: emit após QA review
- Acumuladores ao vivo: `_run_tokens_in`, `_run_tokens_out`, `_run_cost`
- PipelineRun atualizado com tokens/custo acumulados ao completar

#### 1.3 Custo inline via pricing.py
- Reutilização de `calculate_cost()` existente em `backend/app/utils/pricing.py`
- Chamado após cada resposta AI para popular `cost_usd`

#### 1.4 JobManager — Remoção de throttling para pipelines
- Pipeline jobs (`deep_pipeline`, `rag_pipeline`, `memory_scan`) sempre fazem broadcast WebSocket
- DB write throttling mantido para não sobrecarregar PostgreSQL

### Camada 2 — Redis Live State + REST Fallback

- Hash Redis `pipeline:live:{project_id}` atualizado a cada evento
- Campos: status, current_phase, current_action, current_item, items_done/total, tokens_in/out, cost_usd, model_active, elapsed_ms, tokens_per_second, phase_scores
- TTL de 1 hora (auto-limpa)
- Endpoint REST: `GET /{project_id}/rag/pipeline-live` como fallback para WebSocket

### Camada 3 — Frontend: Monitor em Tempo Real

#### 3.1 Hook `usePipelineTelemetry`
- Conecta ao `/ws/console` existente
- Filtra eventos por `project_id` + `category === "pipeline_activity"`
- Estado agregado: currentPhase, currentAction, tokens, cost, tokensPerSecond (janela deslizante 10s)
- Buffer circular de 100 atividades
- Fallback: poll REST a cada 3s quando WebSocket desconecta

#### 3.2 Componente `PipelineMonitor`
- Header: nome do pipeline, tempo decorrido, status badge animado
- Métricas: progresso %, tokens in/out, custo — atualizados a cada evento
- Ação atual: fase, sub-ação, modelo, item corrente (N/M)
- Sparkline SVG: throughput tokens/segundo (últimos 60 eventos)
- Saúde das fases: barras coloridas por fase (verde ≥80, amarelo ≥60, vermelho <60)
- Activity feed: últimos 5 eventos com timestamp e descrição
- Auto-hide quando idle

#### 3.3 Integração na página do projeto
- `PipelineMonitor` renderizado no topo da página quando pipeline ativo

#### 3.4 Integração na Jobs page
- `PipelineMonitor` inline ao expandir job de tipo pipeline

---

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `backend/app/services/console_logger.py` | Modified | `PIPELINE_ACTIVITY` enum + `log_pipeline_activity()` |
| `backend/app/services/deep_pipeline.py` | Modified | Telemetria em todas as 7 fases + Redis live state |
| `backend/app/services/job_manager.py` | Modified | Bypass throttling para pipeline jobs |
| `backend/app/api/routes/continuous_rag.py` | Modified | Endpoint `GET /pipeline-live` |

## Files Created

| File | Description |
|------|-------------|
| `frontend/src/hooks/usePipelineTelemetry.ts` | Hook React para telemetria via WebSocket |
| `frontend/src/components/pipeline/PipelineMonitor.tsx` | Componente de monitor em tempo real |

## Additional Files Modified (Route Swap)

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/app/page.tsx` | Modified | Agora mostra Projects (era Dashboard) |
| `frontend/src/app/projects/page.tsx` | Modified | Redirect para `/` |
| `frontend/src/app/dashboard/page.tsx` | Created | Dashboard movido para `/dashboard` |
| `frontend/src/components/layout/Navbar.tsx` | Modified | Projetos→`/`, Painel→`/dashboard` |

---

## Architecture Decision: Why No BFF

| Fator | Análise |
|-------|---------|
| **4 WebSocket channels** | Já existem e funcionam (`/ws/console`, `/ws/notifications`, `/ws/projects/{id}`, `/ws/ai-flow`) |
| **ConsoleLogger singleton** | Schema perfeito com `trace_id`, `phase_name`, `input_tokens`, `output_tokens`, `cost_usd` |
| **Single process** | ORBIT roda em único processo uvicorn — delivery in-memory via `asyncio.create_task` |
| **Token data exists** | Claudio/Ollama já retornam usage data, apenas era descartado |
| **Conclusão** | BFF desnecessário — o problema era instrumentação, não arquitetura |

---

## Health Score Methodology

Score composto ponderado por fase:

| Fase | Peso | Métrica |
|------|------|---------|
| Phase 0 (Scan) | 5% | Scan success |
| Phase 1 (File Analysis) | 15% | Parse success rate |
| Phase 2 (Domain Synthesis) | 20% | Rule density |
| Phase 3 (Arch Map) | 10% | Field completeness |
| Phase 4 (Cards) | 25% | Hierarchy ratio |
| Phase 5 (Wiki) | 15% | Page completeness |
| Phase 6 (QA) | 10% | QA score |

Cores: ≥80 verde, ≥60 amarelo, <60 vermelho. Fases não executadas em cinza.

---

## Testing Results

- TypeScript compilation: `tsc --noEmit` — zero erros nos arquivos novos
- Todos os erros reportados são pré-existentes em arquivos não relacionados
- Verificado que `usePipelineTelemetry.ts` e `PipelineMonitor.tsx` compilam sem erros

---

## What Did NOT Change

- Sem BFF — tudo via WebSocket existente (`/ws/console`)
- Sem Redis pub/sub — single process, in-memory delivery
- Sem nova dependência — libs já instaladas
- Sem quebra do ConsoleLogger/Jobs/Notifications — nova categoria é aditiva
- Sem mudança nos providers — Claudio/Ollama continuam bypassing AIOrchestrator

---

## Verification Checklist

1. Iniciar Deep Pipeline → PipelineMonitor aparece no topo da página do projeto
2. Ação atual muda a cada chamada AI (nome do arquivo, domínio, epic)
3. Tokens in/out incrementam em tempo real
4. Custo acumula ao vivo
5. Sparkline mostra atividade de tok/s
6. Barras de saúde colorem conforme fases completam
7. Feed de atividade mostra últimos 5 eventos
8. WebSocket disconnect → fallback para polling REST
9. Pipeline completa → estado final com scores consolidados
