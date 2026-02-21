# PROMPT #230 - Pipeline Incremental por Lotes (Fase 3)
## Wiki Padronizada com Contratos Rigidos

**Date:** 2026-02-18
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Wiki atualizada a cada lote (nao espera fim), paginas com formato padronizado e merge incremental

---

## Objective

Atualizar wiki a cada lote de arquivos processados (nao esperar fim). Paginas com formato padronizado (6 secoes obrigatorias), merge incremental para ai_generated, protecao de manual/enrichment.

**Key Requirements:**
1. Novo servico `IncrementalWikiService` com create/merge por dominio
2. Contrato `wiki_page.yaml` com 6 secoes obrigatorias
3. Integracao no `batch_processing_cycle` como Step 2 (a cada lote com rules > 0)
4. MERGE quando pagina `ai_generated` existe (adicionar regras, nao substituir)
5. Proteger `source='manual'` e `source='enrichment'` (nunca sobrescrever)
6. Full wiki enrichment (heavy job) mantido apenas quando pending_remaining == 0

---

## What Was Implemented

### 1. Contrato pipeline/wiki_page.yaml
- 6 secoes obrigatorias: Visao Geral, Regras de Negocio, Fluxos, Entidades, Restricoes, Cenarios
- Modo CREATE: pagina completa do zero
- Modo MERGE: integrar novas regras sem remover existentes
- Evidencia obrigatoria: "(origem: [arquivo])"
- Minimo 300 palavras por pagina
- Prompt compacto (~1168 chars system) para modelos locais

### 2. Servico IncrementalWikiService (pipeline_wiki.py)
- Metodo `update_wiki_from_batch(project_id, batch_rules, batch_number, rules_by_layer)`
- `_process_domain()`: decide CREATE vs MERGE baseado na existencia e source da pagina
- `_create_domain_page()`: cria pagina nova com 6 secoes via IA
- `_merge_domain_page()`: integra novas regras em pagina existente via IA
- `_ensure_rules_parent_page()`: cria pagina pai "Regras de Negocio" se nao existe
- `_classify_domain()`: classificacao stack-agnostic de dominio (reutiliza logica do wiki.py)
- `_format_domain_rules()`: formata regras agrupadas por arquivo fonte
- Anti-shrink: rejeita merge que encolheria a pagina em mais de 20%
- Protecao: nunca sobrescreve source='manual' ou source='enrichment'

### 3. Integracao no batch_processing_cycle (watchdog.py)
- Step 2 agora e "Incremental wiki update" (a cada lote com rules > 0)
- Full wiki enrichment (submit_wiki_enrichment) mantido como step separado quando pending=0
- Batch number movido para fora dos blocos try (disponivel para todos os steps)
- Job completion inclui: wiki_updated, wiki_pages_created, wiki_pages_merged, wiki_enriched

---

## Files Modified/Created

### Created:
1. **backend/app/contracts/pipeline/wiki_page.yaml** - Contrato wiki page create/merge
2. **backend/app/services/pipeline_wiki.py** - IncrementalWikiService (~300 linhas)
3. **rag/internal/PROMPT_230_PHASE3_INCREMENTAL_WIKI.md** - Este report

### Modified:
1. **backend/app/services/watchdog.py** - +30 linhas
   - Step 2 reescrito para wiki incremental + full enrichment separado
   - batch_num movido para escopo de funcao
   - Job completion com wiki stats
2. **CLAUDE.md** - Atualizado prompt counter para Fase 3

---

## Testing Results

### Verificacao:
```
OK  IncrementalWikiService importa corretamente
OK  ContractLoader renderiza pipeline/wiki_page.yaml (create e merge)
OK  System prompt: 1168 chars (compacto para qwen3:8b)
OK  watchdog.py syntax valida
OK  pipeline_wiki.py syntax valida
OK  orbit restart: todos servicos green
OK  Backend logs: sem erros apos restart
```

---

## Success Metrics

- **Wiki incremental**: Paginas criadas/atualizadas a CADA lote (nao espera pending=0)
- **6 secoes obrigatorias**: Formato padronizado em todas as paginas de dominio
- **Merge seguro**: ai_generated recebe merge, manual/enrichment protegidos
- **Anti-shrink**: Rejeita se pagina encolheria mais de 20%
- **Full enrichment preservado**: Heavy job com sub-jobs continua rodando quando tudo termina
- **Zero breaking changes**: Backward compatible

---

## Key Insights

### 1. Dois Niveis de Wiki Update
- **Incremental** (cada lote): cria/merge paginas de dominio rapidamente via IA
- **Full enrichment** (fim): gera todas as paginas detalhadas (arquitetura, convencoes, etc.)
Ambos coexistem sem conflito.

### 2. Domain Classification Reutilizada
A classificacao de dominio do wiki.py (_classify_domain) foi replicada no pipeline_wiki.py
para manter independencia dos servicos. Ambas usam a mesma logica stack-agnostic.

### 3. Protected Sources
O sistema de protecao existente (source='manual'/'enrichment') e respeitado tanto
pelo IncrementalWikiService quanto pelo _upsert_wiki_page existente.

---

## Status: COMPLETE

Fase 3 implementada e verificada. Wiki evolui incrementalmente a cada lote.

**Key Achievements:**
- IncrementalWikiService com create/merge por dominio
- Contrato wiki_page.yaml com 6 secoes obrigatorias
- Integracao no batch_processing_cycle como Step 2
- Protecao de paginas manual/enrichment mantida

**Impact:**
- Wiki pages aparecem apos o primeiro lote (nao espera todos os arquivos)
- Lotes seguintes fazem MERGE (adicionam regras sem substituir)
- Full enrichment roda no final para paginas detalhadas
- Base para Fases 4-5: cards hierarquicos e validacao
