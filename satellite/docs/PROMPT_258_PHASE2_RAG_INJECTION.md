# PROMPT #258 - Phase 2 Rewrite: Chamada Única com RAG Injection

**Date:** 2026-02-22
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Refactor
**Impact:** Phase 2 agora usa Claudio Opus com RAG injection (chamada única), Phase 3 filtra por business_rule

---

## 🎯 Objective

Corrigir Phase 2 que usava batch approach com Claudio Sonnet (15 chamadas sequenciais, sem RAG) para usar Claudio Opus com RAG injection (chamada única, contexto injetado automaticamente).

Corrigir Phase 3 que não filtrava por tipo de documento, recebendo mix de code_files + business_rules.

---

## ✅ What Was Implemented

### 1. Banco: Modelo trocado de Sonnet para Opus
```sql
UPDATE ai_models SET name = 'Claudio Opus 4.6 (RAG Extraction)',
config = jsonb_set(config::jsonb, '{model_id}', '"claude-opus-4-6"')
WHERE usage_type = 'rag_extraction';
```

### 2. Phase 2 reescrita: chamada única com RAG
- Removido: batch splitting (PHASE2_BATCH_MAX_CHARS, loop de 15 batches)
- Adicionado: `enable_rag=True`, `rag_top_k=300`, `project_id=project_id`
- O RAG injeta automaticamente os code_files indexados na Phase 1
- Uma única chamada ao Claudio Opus analisa todo o contexto
- Validação e armazenamento inalterados

### 3. Phase 3: filtro `rag_filter={"type": "business_rule"}`
- Adicionado filtro para que Phase 3 receba APENAS regras de negócio do RAG
- Antes: recebia 300 docs misturados (code_files + business_rules + etc)
- Depois: recebe apenas business_rules, contexto focado para geração de cards

---

## 📁 Files Modified

1. **backend/app/services/rag_pipeline.py**
   - `phase_2_extract_rules`: reescrita completa (batch → RAG injection)
   - `phase_3_generate_cards`: adicionado `rag_filter={"type": "business_rule"}`
   - Removido `PHASE2_BATCH_MAX_CHARS`

---

## 🎉 Status: COMPLETE

- ✅ Modelo Opus configurado para rag_extraction
- ✅ Phase 2 usa chamada única com RAG injection
- ✅ Phase 3 filtra por business_rule no RAG
- ✅ Syntax check OK
