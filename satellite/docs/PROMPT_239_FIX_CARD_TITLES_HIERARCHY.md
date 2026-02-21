# PROMPT #239 - Fix Card Titles (RN Prefix + Semantic Identifiers) + Hierarchy Exclusions
## Titulos Legiveis e Hierarquia Correta

**Date:** February 19, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Cards gerados com titulos legiveis por humanos, sem prefixos tecnicos (RN, N1, etc.)

---

## 🎯 Objective

Dois problemas nos cards gerados:
1. Stories de regras de negocio tinham prefixo "RN1065: ..." nos titulos
2. Stories/Tasks/Subtasks usavam identificadores semanticos nos titulos ("Como N1, eu quero...")
3. Epic "Regras de Negocio Documentadas" (com 1070 stories) bloqueava geracao de hierarquia

---

## 🔍 Root Cause Analysis

### Problema 1: Prefixo RN
- **Arquivo:** `context_generator.py` L1359
- **Causa:** `title=f"RN{i}: {rule_title}"` — prefixo RN hardcoded
- **Fix:** Titulo limpo sem prefixo

### Problema 2: Identificadores semanticos nos titulos
- **Arquivos:** `stories_from_epic.yaml`, `tasks_from_story.yaml`, `subtasks_from_task.yaml`
- **Causa:** Template de exemplo usava `"Como [N1], eu quero..."` no titulo + regra "NUNCA substitua identificadores" aplicada globalmente (inclusive ao titulo)
- **Fix:** Titulo deve ser 100% legivel por humanos; identificadores restritos a description_markdown

### Problema 3: Epic business_rule bloqueando hierarquia
- **Arquivo:** `projects.py` endpoint generate-hierarchy
- **Causa:** Validacao "projeto ja possui N epics" contava o epic "Regras de Negocio Documentadas"
- **Fix:** Excluir cards com label `business_rule` de todas as queries de hierarquia

---

## ✅ What Was Implemented

### 1. context_generator.py
- Removido prefixo `RN{i}:` dos titulos de stories de regras de negocio
- Titulos agora usam o texto limpo da regra

### 2. stories_from_epic.yaml
- Exemplo de titulo: `"Como [N1], eu quero..."` → `"Como Administrador, eu quero gerenciar usuarios do sistema"`
- Regra explicita: "TITULOS devem ser 100% legiveis por humanos - SEM identificadores"
- "NUNCA substitua identificadores" agora aplica-se apenas a description_markdown

### 3. tasks_from_story.yaml
- Mesma correcao aplicada: titulos legiveis, identificadores apenas em descricoes

### 4. subtasks_from_task.yaml
- Mesma correcao aplicada

### 5. projects.py
- Phases 3/4/5: filtro `~Task.labels.contains(["business_rule"])`
- Validacao de epics existentes: exclui business_rule epics

### 6. continuous_rag.py
- `has_epics` no enrichment-status exclui business_rule epics

---

## 📁 Files Modified

1. **backend/app/services/context_generator.py** — Removido prefixo RN
2. **backend/app/prompts/backlog/stories_from_epic.yaml** — Titulos legiveis
3. **backend/app/prompts/backlog/tasks_from_story.yaml** — Titulos legiveis
4. **backend/app/prompts/backlog/subtasks_from_task.yaml** — Titulos legiveis
5. **backend/app/api/routes/projects.py** — Exclusao de business_rule cards
6. **backend/app/api/routes/continuous_rag.py** — has_epics exclui business_rule

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ Titulos de cards 100% legiveis por humanos
- ✅ Sem prefixo "RN" em regras de negocio
- ✅ Sem identificadores semanticos (N1, P1, E10) nos titulos
- ✅ Hierarquia exclui cards de business_rule do fluxo

---
