# PROMPT #275 - Auto-enrichment de Regras Wiki
## Enriquecimento automatico de paginas wiki de regras de negocio

**Date:** 2026-02-13
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** Todas as paginas de regras wiki sao automaticamente enriquecidas com conteudo rico e dissertativo

---

## Objective

O usuario identificou que nem todas as paginas de regras de negocio na wiki tinham conteudo rico e detalhado (com secoes Descricao, Justificativa, Comportamento, Impacto, Exemplos). Algumas paginas permaneciam com o conteudo basico de template (apenas a regra bruta extraida do codigo).

**Root Cause:** O pipeline de enrichment so processava paginas com `source='ai_generated'`. Apos a primeira execucao, todas as paginas passavam para `source='enrichment'`, e qualquer re-execucao nao encontrava paginas para processar. Paginas que falharam durante o enrichment (rate limiting, erros de API) ficavam como `ai_generated` e nao eram automaticamente reprocessadas.

**Key Requirements:**
1. Enriquecimento automatico: detectar paginas nao enriquecidas e processar automaticamente
2. Permitir re-enrichment de TODAS as paginas via parametro `force`
3. Para re-enrichment, buscar conteudo original da regra no RAG (via hash do slug)
4. Nao disparar jobs duplicados (verificar se ja existe job em andamento)
5. API methods no frontend para enrichRules e relink (uso programatico)

---

## What Was Implemented

### 1. Auto-enrichment no `get_wiki_tree()`

Quando o endpoint `/wiki/tree` e chamado (ao acessar a wiki), ele verifica automaticamente se existem paginas de regras com `source='ai_generated'` (nao enriquecidas). Se existirem E nao houver job de enrichment ja em andamento (PENDING/RUNNING), dispara automaticamente o job de enrichment em background.

Isso garante que:
- Paginas que falharam no primeiro enrichment sao reprocessadas
- Novas paginas criadas por scan/RAG sao enriquecidas sem intervencao
- Nao ha duplicacao de jobs

### 2. Backend: Suporte a force re-enrichment

**Endpoint `/enrich-rules` atualizado:**
- Novo parametro `force: bool = False`
- Com `force=True`: conta e processa TODAS as paginas `regra-*` (independente do source)
- Sem `force`: comportamento original (apenas `source='ai_generated'`)
- Mensagem de erro informativa quando nao ha paginas

**Funcao `_enrich_rules_background` atualizada:**
- Aceita parametro `force: bool = False`
- Query dinamica: sem filtro de source quando `force=True`
- Para paginas ja enriquecidas (`source != 'ai_generated'`):
  - Busca conteudo original da regra no RAG via MD5 hash match
  - Extrai domain do titulo da pagina pai
  - Fallback: usa conteudo existente como contexto se RAG nao encontrar
- Para paginas nao enriquecidas: comportamento original (parse de markers do template)

### 3. Frontend: API methods

**api.ts:**
- `wikiApi.enrichRules(projectId, force)` - POST para `/enrich-rules`
- `wikiApi.relink(projectId)` - POST para `/relink`

---

## Files Modified

### Modified:
1. **backend/app/api/routes/wiki.py**
   - Auto-enrichment no `get_wiki_tree()` com verificacao de job existente
   - Endpoint `enrich_business_rule_pages()` com parametro `force`
   - `_trigger_rule_enrichment_job()` com parametro `force`
   - `_enrich_rules_background()` com logica de re-enrichment via RAG lookup

2. **frontend/src/lib/api.ts**
   - `wikiApi.enrichRules()` e `wikiApi.relink()` adicionados

---

## Technical Details

### Fluxo Automatico

```
Usuario acessa wiki -> GET /wiki/tree
  -> Verifica paginas regra-* com source='ai_generated'
  -> Se existem E nao ha job PENDING/RUNNING:
    -> _trigger_rule_enrichment_job() automatico
    -> _enrich_rules_background() em background
      -> Para cada pagina nao enriquecida:
        -> Parse markers do template
        -> Chama AI com wiki_rule_enrichment prompt
        -> Substitui conteudo + source = "enrichment"
      -> Re-aplica semantic links (PROMPT #274)
```

### RAG Lookup para Re-enrichment (force=true)

O slug de cada pagina de regra contem o hash MD5 do conteudo original:
- Slug: `regra-{md5[:8]}` (ex: `regra-a1b2c3d4`)
- Query: `md5(content)::varchar LIKE 'a1b2c3d4%'`

Isso permite recuperar o conteudo original da regra mesmo apos o enrichment ter substituido completamente o conteudo da pagina.

### Protecao contra Jobs Duplicados

```python
existing_job = db.query(AsyncJob).filter(
    AsyncJob.project_id == project_id,
    AsyncJob.job_type == JobType.WIKI_RULE_ENRICHMENT,
    AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
).first()
if not existing_job:
    await _trigger_rule_enrichment_job(...)
```

---

## Status: COMPLETE

**Key Achievements:**
- Enrichment totalmente automatico ao acessar a wiki
- Re-enrichment via force para melhorar conteudo existente
- Recuperacao inteligente do conteudo original via RAG hash match
- Protecao contra jobs duplicados
- Compativel com pipeline existente e semantic linking

**Impact:**
- Todas as paginas de regras terao conteudo rico e detalhado automaticamente
- Paginas que falharam no primeiro enrichment sao reprocessadas sem intervencao
- Melhorias no prompt de enrichment sao aplicaveis via re-enrichment
