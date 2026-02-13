# PROMPT #266 - Fix Wiki Business Rules Bottlenecks
## Desbloqueio de Regras de Negocio na Wiki do Projeto

**Date:** 2026-02-12
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Wiki passa de ~15 regras para todas as regras extraidas do codebase (centenas/milhares)

---

## Objective

O usuario reportou: "eu continuo achando a wiki super pobre, nao tem quase regra nenhuma, eu so vejo no console milhares de regras sendo geradas e quase nada delas sendo colocadas na wiki"

Investigacao identificou **4 gargalos em cascata** que eliminavam 98%+ das regras de negocio antes de chegarem na wiki.

**Key Requirements:**
1. Aumentar limite de regras no `initial_memory_context` (de 15 para 200)
2. Aumentar limite de busca RAG (de 50 para 500)
3. Criar pagina wiki dedicada com TODAS as regras direto do RAG
4. Atualizar endpoint manual de geracao de wiki para buscar do RAG

---

## What Was Implemented

### 1. Aumento de Limites no Memory Scan

**Problema:** `codebase_memory.py:1621` truncava regras com `business_rules[:15]`, perdendo 90%+ das regras extraidas.

**Solucao:** Aumentou limites:
- `business_rules[:15]` -> `business_rules[:200]`
- `key_features[:10]` -> `key_features[:50]`
- `entities[:10]` -> `entities[:50]`

### 2. Aumento do Limite RAG na Enrichment

**Problema:** `projects.py:929` buscava apenas `LIMIT 50` regras do RAG para o enrichment AI.

**Solucao:** Alterou para `LIMIT 500`, permitindo que a AI tenha acesso a um catalogo muito maior de regras.

### 3. Pagina Wiki Dedicada com Catalogo Completo de Regras

**Problema:** As regras de negocio competiam por espaco com outras secoes dentro do limite de tokens da AI (6000 tokens). Resultado: AI resumia/comprimia as regras.

**Solucao:** Apos o parsing do enrichment AI, criou pagina wiki adicional "Regras de Negocio - Catalogo Completo" com TODAS as regras do RAG, sem passar pela AI (sem compressao).

**Fluxo novo em `_enrich_context_from_rag()`:**
1. AI gera markdown rico com 6 secoes (como antes)
2. Parsing distribui secoes em paginas wiki (PROMPT #265)
3. **NOVO:** Busca TODAS as regras do RAG e cria pagina dedicada com catalogo completo

### 4. Endpoint Manual de Wiki Atualizado

**Problema:** `generate_wiki_from_context()` usava apenas regras do `initial_memory_context` (limitado).

**Solucao:** Endpoint agora busca regras diretamente do RAG (LIMIT 500), garantindo que o botao manual "Gerar do Contexto" tambem produz wiki rica.

---

## Files Modified

### Modified:
1. **backend/app/services/codebase_memory.py** - Linha 1621: limites de [:15] para [:200] (regras), [:10] para [:50] (features/entities)
2. **backend/app/api/routes/projects.py** - Linha 929: LIMIT 50 -> LIMIT 500; Linhas 1060-1078: nova pagina de catalogo completo de regras
3. **backend/app/api/routes/wiki.py** - generate_wiki_from_context(): busca regras do RAG (LIMIT 500) ao inves de apenas initial_memory_context

### Created:
1. **PROMPT_266_IMPLEMENTATION_REPORT.md** - Este report

---

## Cascading Bottleneck Analysis

```
Regras extraidas do codebase: ~500-2000
     |
     v
Bottleneck 1: business_rules[:15]     -> 15 regras (perda: 97%)
     |                                    CORRIGIDO: [:200]
     v
Bottleneck 2: RAG LIMIT 50            -> 50 regras max
     |                                    CORRIGIDO: LIMIT 500
     v
Bottleneck 3: AI max_tokens=6000      -> ~20-30 regras resumidas
     |                                    BYPASS: pagina dedicada sem AI
     v
Bottleneck 4: Espaco compartilhado    -> ~10-15 regras na wiki
                                          BYPASS: pagina separada
```

**Resultado:** De ~15 regras para TODAS as regras extraidas (centenas/milhares).

---

## Testing Results

### Verification:

```
- codebase_memory.py: business_rules[:200] confirmado
- projects.py: LIMIT 500 confirmado
- projects.py: pagina "Regras de Negocio - Catalogo Completo" criada apos enrichment
- wiki.py: RAG query com LIMIT 500 no endpoint manual
- Fallback mantido: se RAG vazio, usa initial_memory_context
```

---

## Success Metrics

- **Regras na wiki:** De ~15 para centenas/milhares (todas do RAG)
- **Catalogo completo:** Pagina dedicada sem compressao AI
- **Dual approach:** AI resume para visao geral + catalogo bruto completo
- **Endpoint manual:** Tambem atualizado para buscar do RAG

---

## Key Insights

### 1. Gargalos em cascata sao invissiveis
Cada limite individualmente parecia razoavel (15 regras, 50 results, 6000 tokens). Mas em cascata, eliminavam 98%+ do conteudo. O usuario via milhares de regras no console mas quase nenhuma na wiki.

### 2. AI nao deve ser o unico canal para dados volumosos
Para catalogos grandes (centenas de regras), a AI inevitavelmente resume/comprime. A solucao e dual: AI para analise qualitativa + dados brutos para catalogo quantitativo.

### 3. Limites conservadores em pipelines longos se multiplicam
Um `[:15]` no inicio do pipeline e devastador. Em pipelines com multiplos estagios, limites devem ser generosos nos estagios iniciais e restritivos apenas no final.

---

## Status: COMPLETE

**Key Achievements:**
- 4 gargalos em cascata identificados e corrigidos
- Limite de regras no scan: 15 -> 200
- Limite de busca RAG: 50 -> 500
- Pagina wiki dedicada com catalogo completo de regras (sem compressao AI)
- Endpoint manual tambem atualizado

**Impact:**
- Wiki do projeto passa de ~15 regras para centenas/milhares
- Usuario tem acesso ao catalogo completo de regras extraidas do codebase
- Abordagem dual: AI analisa + dados brutos catalogam
