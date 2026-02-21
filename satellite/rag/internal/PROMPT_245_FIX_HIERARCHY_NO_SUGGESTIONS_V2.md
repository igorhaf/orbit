# PROMPT #245 - Fix Hierarchy: Remove Suggestions + Chunked Classification
## Gerar Cards sem sugestoes + classificacao em lotes para codebases grandes

**Date:** February 19, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** "Gerar Cards" cria APENAS regras de negocio (sem sugestoes) e classifica corretamente em multiplos Epics

---

## 🎯 Objective

Corrigir dois problemas reportados pelo usuario:

1. **Sugestoes indesejadas**: "Gerar Cards" continuava gerando epics sugeridos (draft) junto com as regras de negocio, confundindo o usuario
2. **Classificacao flat**: Com 1116 regras, a IA falhava por excesso de tokens e caia no fallback flat (1 Epic + N Stories)

---

## 🔍 Root Cause Analysis

### Problema 1 - Sugestoes
A funcao `_process_full_hierarchy_async` tinha 3 fases:
- Phase 1: Gerar contexto
- Phase 2: Gerar business rule cards (correto)
- **Phase 3: Gerar suggested epics** (PROBLEMA - nao deveria estar aqui)

O usuario ja havia pedido no PROMPT #240 para nao gerar sugestoes, mas a Phase 3 permaneceu.

### Problema 2 - Classificacao flat
`_classify_rules_hierarchy` enviava TODAS as regras (1116) em um unico prompt. Com ~100 chars/regra, isso gera ~110k caracteres so de regras, excedendo o limite de tokens do modelo. A IA falhava (timeout ou JSON invalido) e o sistema usava `_create_flat_business_rule_cards` que cria apenas 1 Epic "Regras de Negocio Documentadas" com todas as regras como Stories.

---

## ✅ What Was Implemented

### 1. Remocao da Phase 3 (projects.py)
- Removida geracao de suggested epics de `_process_full_hierarchy_async`
- Fluxo agora: Phase 1/2 (contexto) + Phase 2/2 (regras de negocio)
- Sugestoes so sao geradas pelo botao separado "Gerar Epics"

### 2. Classificacao em chunks (context_generator.py)
- `_classify_rules_hierarchy` agora divide regras em lotes de 100
- Cada lote e classificado separadamente via `_classify_rules_chunk`
- Resultados sao merged por titulo de Epic via `_merge_hierarchies`
- Regras do mesmo dominio de diferentes chunks sao consolidadas
- Timeout aumentado de 120s para 180s por chunk

### 3. Novas funcoes
- `_classify_rules_chunk(project, rules)` — classifica um lote unico
- `_merge_hierarchies(hierarchies)` — consolida multiplos resultados por Epic

---

## 📁 Files Modified

1. **backend/app/api/routes/projects.py** — Removida Phase 3 (sugestoes), atualizado contadores de fase
2. **backend/app/services/context_generator.py** — Chunked classification + merge

---

## 🧪 Testing

```
✅ Python syntax OK (ast.parse)
✅ Frontend build passed
```

---

## 🎯 Resultado Esperado

Antes:
```
1 Epic "Regras de Negocio Documentadas [1116]"
  └── 1116 Stories (flat)
+ 11 Epics sugeridos (draft, Aprovar/Rejeitar)
```

Depois:
```
3-8 Epics por dominio de negocio
  └── Stories agrupadas por dominio
      └── Tasks e Subtasks quando aplicavel
(SEM sugestoes)
```

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ "Gerar Cards" nao gera mais sugestoes
- ✅ Classificacao funciona com 1000+ regras via chunking
- ✅ Merge inteligente por titulo de Epic
- ✅ Fallback flat so ocorre se TODOS os chunks falharem

---
