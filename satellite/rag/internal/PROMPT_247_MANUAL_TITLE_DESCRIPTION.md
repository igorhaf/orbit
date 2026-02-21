# PROMPT #247 - Manual Title & Description Only
## Remover auto-geração de título e descrição de projetos

**Date:** February 19, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Título e descrição de projetos são 100% manuais, nunca sobrescritos por IA

---

## 🎯 Objective

Remover TODA auto-geração de título e descrição de projetos. O usuário define esses campos manualmente e a IA nunca deve sobrescrevê-los.

**Motivação:** A IA estava auto-gerando título e descrição durante o scan de memória, wiki enrichment e context interview, substituindo o que o usuário digitou manualmente.

---

## ✅ What Was Implemented

### Pontos corrigidos em `projects.py`:

1. **Scan de memória (merge)** — Removida atribuição de `suggested_title` ao `project.name`
2. **Quick create scan** — Removida atribuição de `suggested_title` ao `project.name`
3. **Initial scan** — Removidas atribuições de título e descrição auto-gerados
4. **Wiki enrichment** — Removidas atribuições de `project.description` e `project.name` a partir do conteúdo wiki

### Pontos corrigidos em `context_generator.py`:

5. **Context interview completion (linha 650)** — Removido `project.description = context_human`
6. **Bulk context generation (linha 5302)** — Removido `project.description = context_human`
7. **Rich context save (linha 5998)** — Removido `project.description = context_human`

### Pontos corrigidos em `pipeline_context.py`:

8. **Batch processing (linha 137)** — Alterado para salvar em `project.context_human` em vez de `project.description`
9. **Leitura (linha 72)** — Alterado para ler de `project.context_human` em vez de `project.description`

---

## 📁 Files Modified

1. **backend/app/api/routes/projects.py** — Removida auto-geração de título e descrição em 4 pontos
2. **backend/app/services/context_generator.py** — Removido `project.description = ...` em 3 pontos
3. **backend/app/services/pipeline_context.py** — Redirecionado para `context_human` em vez de `description`

---

## 🧪 Testing

```
✅ Python syntax OK (projects.py)
✅ Python syntax OK (context_generator.py)
✅ Python syntax OK (pipeline_context.py)
```

---

## 🎯 Regra Estabelecida

- `project.name` — SEMPRE manual, digitado pelo usuário
- `project.description` — SEMPRE manual, digitado pelo usuário
- `project.context_human` — Gerado pela IA (context interview, pipeline)
- `project.context_semantic` — Gerado pela IA (para uso interno)

A IA NUNCA deve escrever em `project.name` ou `project.description`.

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ 8 pontos de auto-geração removidos em 3 arquivos
- ✅ Título e descrição 100% manuais
- ✅ Contexto IA vai para `context_human`/`context_semantic`
- ✅ Nenhuma perda de funcionalidade (dados IA preservados nos campos corretos)

---
