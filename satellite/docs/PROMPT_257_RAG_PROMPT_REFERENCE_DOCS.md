# PROMPT #257 - RAG Pipeline Prompt Reference Documents

**Date:** 2026-02-21
**Status:** ✅ COMPLETED
**Priority:** MEDIUM
**Type:** Documentation
**Impact:** 4 documentos de referência criados na raiz do projeto, definindo contratos exatos para cada caso de uso do RAG pipeline

---

## 🎯 Objective

Adaptar o prompt base fornecido pelo usuário para os 4 casos de uso específicos do RAG pipeline, criando documentos .md separados na raiz do projeto com schema JSON rígido, regras de validação e exemplos para cada um.

---

## ✅ What Was Implemented

### 1. PROMPT_RAG_EXTRACAO_REGRAS.md (Phase 2)
- Extração de regras de negócio do código-fonte
- 6 campos: rule_text, rule_type (8 enum), source_file, priority (4 enum), entity, evidence
- Regras de validação alinhadas com `_parse_rules_json` do pipeline

### 2. PROMPT_RAG_GERACAO_CARDS.md (Phase 3)
- Geração de hierarquia de cards Epic > Story > Task > Subtask
- 10 campos incluindo story_points (Fibonacci estimado caso a caso) e complexity
- Regras de parentesco obrigatórias e quantidades por nível
- Exemplo completo com Epic → Story → Task

### 3. PROMPT_RAG_GERACAO_WIKI.md (Phase 3)
- Geração de páginas wiki técnicas em Markdown
- 4 campos: slug, title, content, order
- 7 páginas obrigatórias definidas
- Requisitos de conteúdo mínimo (1000 chars no prompt, 500 no validador)

### 4. PROMPT_RAG_TITULO_DESCRICAO.md (Phase 3)
- Geração de título e descrição do projeto
- REGRA #0 documentada: só preenche se campo vazio
- Exemplo de lógica de aplicação com código Python

---

## 📁 Files Created

1. **PROMPT_RAG_EXTRACAO_REGRAS.md** — Referência para Phase 2
2. **PROMPT_RAG_GERACAO_CARDS.md** — Referência para Phase 3 (cards)
3. **PROMPT_RAG_GERACAO_WIKI.md** — Referência para Phase 3 (wiki)
4. **PROMPT_RAG_TITULO_DESCRICAO.md** — Referência para Phase 3 (metadata)
5. **satellite/docs/PROMPT_257_RAG_PROMPT_REFERENCE_DOCS.md** — Este report

---

## 🧪 Testing Results

```bash
✅ 4 arquivos .md criados na raiz do projeto
✅ Schemas JSON alinhados com validadores em rag_pipeline.py
✅ Todos os enums conferem: rule_type (8), priority (4), item_type (4), complexity (3)
✅ Regras de validação documentam limites exatos do código
✅ Exemplos de saída JSON são válidos e seguem contratos
✅ REGRA #0 documentada no prompt de título/descrição
```

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ 4 prompts adaptados do template base para cada caso de uso
- ✅ Contratos JSON rígidos com todos os campos e validações
- ✅ Exemplos concretos de saída esperada
- ✅ Alinhamento total com os validadores em rag_pipeline.py
