# PROMPT #275 - Re-enrichment de Regras Wiki e Botao Manual
## Suporte a re-enriquecimento completo de paginas wiki de regras de negocio

**Date:** 2026-02-13
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** Todas as paginas de regras wiki podem ser (re)enriquecidas com conteudo rico e dissertativo

---

## Objective

O usuario identificou que nem todas as paginas de regras de negocio na wiki tinham conteudo rico e detalhado (com secoes Descricao, Justificativa, Comportamento, Impacto, Exemplos). Algumas paginas permaneciam com o conteudo basico de template (apenas a regra bruta extraida do codigo).

**Root Cause:** O pipeline de enrichment so processava paginas com `source='ai_generated'`. Apos a primeira execucao, todas as paginas passavam para `source='enrichment'`, e qualquer re-execucao nao encontrava paginas para processar. Paginas que falharam durante o enrichment (rate limiting, erros de API) ficavam como `ai_generated` mas so seriam reprocessadas se o endpoint fosse chamado novamente - e nao havia botao no frontend para isso.

**Key Requirements:**
1. Permitir re-enrichment de TODAS as paginas de regras (incluindo ja enriquecidas)
2. Parametro `force` para controlar se enriquece apenas novas ou todas
3. Para re-enrichment, buscar conteudo original da regra no RAG (via hash do slug)
4. Botao "Enriquecer Regras" no frontend da wiki
5. API methods no frontend para enrichRules e relink

---

## What Was Implemented

### 1. Backend: Suporte a force re-enrichment

**Endpoint `/enrich-rules` atualizado:**
- Novo parametro `force: bool = False`
- Com `force=True`: conta e processa TODAS as paginas `regra-*` (independente do source)
- Sem `force`: comportamento original (apenas `source='ai_generated'`)
- Mensagem de erro informativa quando nao ha paginas (diferencia "todas ja enriquecidas" de "nenhuma encontrada")

**Funcao `_trigger_rule_enrichment_job` atualizada:**
- Repassa parametro `force` para o job de background
- Armazena `force` no `input_data` do job

**Funcao `_enrich_rules_background` atualizada:**
- Aceita parametro `force: bool = False`
- Query dinamica: sem filtro de source quando `force=True`
- Para paginas ja enriquecidas (`source != 'ai_generated'`):
  - Busca conteudo original da regra no RAG via MD5 hash match
  - Extrai domain do titulo da pagina pai
  - Fallback: usa conteudo existente como contexto se RAG nao encontrar
- Para paginas nao enriquecidas: comportamento original (parse de markers do template)

### 2. Frontend: Botao "Enriquecer Regras"

**WikiPanel.tsx:**
- Novo estado `enrichingRules` para controle de loading
- Funcao `handleEnrichRules(force)` que chama `wikiApi.enrichRules()`
- Botao "Enriquecer Regras" / "Enriquecendo..." no header de acoes

**wiki/page.tsx (pagina standalone):**
- Mesmo botao e handler adicionados

**api.ts:**
- `wikiApi.enrichRules(projectId, force)` - POST para `/enrich-rules?force=true`
- `wikiApi.relink(projectId)` - POST para `/relink`

---

## Files Modified

### Modified:
1. **backend/app/api/routes/wiki.py**
   - Endpoint `enrich_business_rule_pages()` com parametro `force`
   - `_trigger_rule_enrichment_job()` com parametro `force`
   - `_enrich_rules_background()` com logica de re-enrichment via RAG lookup

2. **frontend/src/lib/api.ts**
   - `wikiApi.enrichRules()` e `wikiApi.relink()` adicionados

3. **frontend/src/components/wiki/WikiPanel.tsx**
   - Estado `enrichingRules`, handler `handleEnrichRules`, botao no header

4. **frontend/src/app/projects/[id]/wiki/page.tsx**
   - Estado `enrichingRules`, handler `handleEnrichRules`, botao no header

---

## Technical Details

### Fluxo de Re-enrichment

```
Usuario clica "Enriquecer Regras"
  -> POST /wiki/enrich-rules?force=true
  -> Conta TODAS as paginas regra-* (sem filtro de source)
  -> Cria background job com force=true
  -> _enrich_rules_background(job_id, project_id, force=True)
    -> Para cada pagina:
      -> Se source == "ai_generated":
        -> Parse markers do template (Dominio, Arquivo Fonte, Descricao)
      -> Se source != "ai_generated" (ja enriched):
        -> Busca original no RAG: md5(content) LIKE hash_prefix%
        -> Extrai domain do parent page title
        -> Fallback: usa conteudo existente
      -> Chama AI com wiki_rule_enrichment prompt
      -> Substitui conteudo + source = "enrichment"
    -> Re-aplica semantic links (PROMPT #274)
```

### RAG Lookup para Re-enrichment

O slug de cada pagina de regra contem o hash MD5 do conteudo original:
- Slug: `regra-{md5[:8]}` (ex: `regra-a1b2c3d4`)
- Query: `md5(content)::varchar LIKE 'a1b2c3d4%'`

Isso permite recuperar o conteudo original da regra mesmo apos o enrichment ter substituido completamente o conteudo da pagina.

---

## Status: COMPLETE

**Key Achievements:**
- Re-enrichment completo de todas as regras wiki com um clique
- Parametro force para controlar escopo (novas vs todas)
- Recuperacao inteligente do conteudo original via RAG hash match
- Botao acessivel no frontend para trigger manual
- Compativel com pipeline existente e semantic linking

**Impact:**
- Todas as paginas de regras terao conteudo rico e detalhado
- Paginas que falharam no primeiro enrichment podem ser reprocessadas
- Melhorias no prompt de enrichment sao imediatamente aplicaveis a todas as paginas
