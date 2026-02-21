# PROMPT #230 - Pipeline Incremental por Lotes (Fase 2)
## Contexto (Descricao) Incremental por Lote

**Date:** 2026-02-18
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Descricao do projeto atualizada a cada lote de arquivos processados, nao apenas no final

---

## Objective

Atualizar a descricao do projeto a CADA lote de arquivos processados (nao apenas quando todos os arquivos terminam). Cada lote enriquece a descricao com novas regras de negocio, organizadas por camada semantica.

**Key Requirements:**
1. Novo servico `IncrementalContextService` com merge incremental via IA
2. Contrato `context_merge.yaml` com regras rigidas (nunca remover conteudo)
3. Integracao no `batch_processing_cycle` como Step 1.5 (apos processar arquivos, antes de wiki)
4. Executa a CADA lote com rules > 0 (sem guard `pending_remaining == 0`)
5. Funcionar com qwen3:8b (contexto limitado)

---

## What Was Implemented

### 1. Contrato pipeline/context_merge.yaml
- REGRA CRITICA: NUNCA remover conteudo existente, apenas adicionar
- Estrutura obrigatoria: Visao Geral, Stack, Arquitetura, Regras de Negocio (por camada), Features, Integracoes
- Evidencia obrigatoria em cada regra nova: "(descoberto em [arquivo])"
- Regras de negocio organizadas por camada semantica (Schema, Rotas, Logica, Apresentacao, Config)
- Prompt compacto (~1500 chars system + variavel user) para funcionar com modelos locais

### 2. Servico IncrementalContextService (pipeline_context.py)
- Metodo `update_context_from_batch(project_id, batch_rules, batch_number, rules_by_layer)`
- Busca regras recentes do RAG (`_fetch_recent_rules`)
- Formata regras agrupadas por arquivo fonte (`_format_rules_for_prompt`)
- Renderiza contrato via ContractLoader
- Chama IA via AIOrchestrator (usage_type="memory")
- Validacao anti-shrink: rejeita se nova descricao < 80% do tamanho atual
- Atualiza `project.description` no banco

### 3. Integracao no batch_processing_cycle (watchdog.py)
- Adicionado Step 1.5 entre Step 1 (process files) e Step 2 (wiki enrichment)
- Executa quando `rules_extracted > 0` (SEM guard `pending_remaining == 0`)
- Passa `rules_by_layer` do process_result para o servico
- Estima `batch_number` a partir dos contadores de processamento
- Resultado `context_updated` adicionado ao job completion data
- Non-blocking: falha no context update nao impede os steps seguintes

---

## Files Modified/Created

### Created:
1. **backend/app/contracts/pipeline/__init__.py** - Modulo do pacote pipeline
2. **backend/app/contracts/pipeline/context_merge.yaml** - Contrato de merge incremental
   - System prompt com regras rigidas e estrutura obrigatoria
   - User prompt com Jinja2 templates para variaveis dinamicas
3. **backend/app/services/pipeline_context.py** - Servico IncrementalContextService
   - ~170 linhas
   - Metodos: update_context_from_batch, _fetch_recent_rules, _format_rules_for_prompt

### Modified:
1. **backend/app/services/watchdog.py** - +25 linhas
   - Step 1.5 no batch_processing_cycle
   - `rules_by_layer` extraido do process_result
   - `context_updated` no job completion result
2. **CLAUDE.md** - Atualizado prompt counter para Fase 2

---

## Testing Results

### Verificacao:
```
OK  IncrementalContextService importa corretamente
OK  ContractLoader renderiza pipeline/context_merge.yaml
OK  System prompt: 1559 chars (compacto para qwen3:8b)
OK  User prompt renderiza com todas variaveis (current_description, rules_by_layer, batch_rules)
OK  watchdog.py syntax valida
OK  pipeline_context.py syntax valida
OK  orbit restart: todos servicos green (Backend PID 151312, Frontend PID 151508)
OK  Backend logs: sem erros apos restart, watchdog cycle executando normalmente
```

---

## Success Metrics

- **Context incremental**: Descricao atualizada a CADA lote (nao espera pending=0)
- **Anti-shrink protection**: Rejeita se descricao encolheria mais de 20%
- **Non-blocking**: Falha no context update nao impede wiki/cards
- **Compativel com modelos locais**: Prompt compacto (~1500 chars system)
- **Zero breaking changes**: Backward compatible, nova funcionalidade aditiva

---

## Key Insights

### 1. Batch Number Estimation
O batch_number e estimado a partir dos contadores do process_result (processed + pending_remaining),
ja que o sistema nao persiste um contador de batch.

### 2. Anti-Shrink Validation
Modelos locais (qwen3:8b) podem gerar descricoes mais curtas que a existente,
perdendo conteudo. A validacao de 80% previne isso sem ser excessivamente rigida.

### 3. Rules By Layer
O `rules_by_layer` ja e retornado pelo `process_pending_files` (implementado na Fase 1),
entao a Fase 2 reaproveita esse dado diretamente sem queries adicionais.

---

## Status: COMPLETE

Fase 2 implementada e verificada. Descricao do projeto cresce incrementalmente a cada lote.

**Key Achievements:**
- Servico IncrementalContextService funcionando
- Contrato context_merge.yaml com regras rigidas
- Integracao no batch_processing_cycle como Step 1.5
- Validacao anti-shrink para proteger conteudo existente

**Impact:**
- Descricao do projeto evolui continuamente durante o processamento
- Nao precisa esperar todos os arquivos serem processados para ter contexto util
- Base para Fases 3-5: wiki incremental, cards hierarquicos, validacao
