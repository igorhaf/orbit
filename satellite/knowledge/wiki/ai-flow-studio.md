---
title: "AI Flow (AI Studio)"
slug: "ai-flow-studio"
source: "generated"
order_index: 17
created_at: "2026-03-05T04:46:25.781481"
updated_at: "2026-03-05T04:46:25.781481"
---

# AI Flow (AI Studio)

## Interface

Página `/ai-flow` — interface unificada para execução e monitoramento do Deep Pipeline.

## Pipeline Profiles

Configurações nomeadas para execução:
- **Nome e descrição**
- **Per-phase model selection** (qual AI model para cada fase)
- **Max tokens por fase**
- **Concurrency** (workers paralelos)
- **Quality threshold** (mínimo para passar QA)

### CRUD
- Criar / Editar / Deletar profiles
- Set default profile
- Armazenados na tabela `pipeline_profiles`

## Execution Panel
1. Selecionar projeto
2. Selecionar profile (ou default)
3. Start pipeline
4. Progresso real-time: fase atual, percentual, arquivo sendo processado
5. Botão de stop

## Run History
- Lista de execuções com: data, profile, score total, duração, métricas
- Cada run armazena phase_results (JSON detalhado)
- Métricas: files_processed, rules_extracted, cards_created, wiki_pages_generated

## Comparison
- Selecionar 2 runs para comparar side-by-side
- Delta de quality scores
- Novos findings (regras, cards)
- Eficiência de tokens (tokens_used / quality_score)

