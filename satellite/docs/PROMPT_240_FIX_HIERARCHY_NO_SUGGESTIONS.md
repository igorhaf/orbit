# PROMPT #240 - Fix Hierarchy: Only Business Rule Cards, No AI Suggestions
## Gerar Cards cria apenas regras existentes, não sugestões de IA

**Date:** February 19, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** "Gerar Cards" agora cria apenas cards de regras de negocio existentes (closed), sem gerar sugestões de IA

---

## 🎯 Objective

O botão "Gerar Cards" estava criando cards sugeridos pela IA (suggested, draft) ao invés de criar apenas os cards das regras de negocio ja existentes no codigo. O usuário reportou que tasks como "Implementar FormularioConfiguracaoRelatorio em TELA2", "Criar modelo de dados e migrations", "Implementar endpoints da API REST" estavam aparecendo como drafts sugeridos — esses são inventados pela IA, não extraidos do codigo.

**Problema:**
1. Phase 1 gerava suggested epics (IA inventa novas features) + business rule cards (correto)
2. Phases 2-5 ativavam os suggested epics e geravam Stories → Tasks → Subtasks sugeridos pela IA
3. Fallback generico criava tasks com titulos fixos ("Criar modelo de dados e migrations", etc.)
4. Resultado: milhares de cards AI-suggested em draft, misturados com regras reais

**Solução:**
1. "Gerar Cards" agora cria APENAS business rule cards (closed, hierarchical, from existing code)
2. Suggested epics são criados como draft para review manual (Aprovar/Rejeitar)
3. Nenhum child card sugerido é gerado automaticamente (sem Phases 2-5)

---

## 🔍 Root Cause Analysis

### Fluxo anterior (5 fases):
```
Phase 1 → generate_cards_from_memory()
  → generate_business_rule_cards()  [CORRETO - regras existentes, closed]
  → _generate_suggested_epics()     [PROBLEMA - IA inventa novas features]
Phase 2 → activate_suggested_epic() [PROBLEMA - enriquece + gera Stories sugeridas]
Phase 3 → activate_story + _generate_draft_tasks() [PROBLEMA - gera Tasks sugeridas]
Phase 4 → activate_task + _generate_draft_subtasks() [PROBLEMA - gera Subtasks sugeridas]
Phase 5 → activate_subtask [PROBLEMA - ativa Subtasks sugeridas]
```

### Fluxo corrigido (3 fases):
```
Phase 1 → Gera contexto rico (se ausente)
Phase 2 → generate_business_rule_cards() [regras existentes em hierarquia Epic>Story>Task>Subtask]
Phase 3 → _generate_suggested_epics()    [apenas epics draft para review, SEM children]
```

---

## ✅ What Was Implemented

### 1. projects.py — _process_full_hierarchy_async
- Removidas Phases 2-5 (ativação de suggested + geração de children AI)
- Phase 1: Gera contexto rico se ausente
- Phase 2: Gera business rule cards hierarquicos (via _classify_rules_hierarchy)
- Phase 3: Gera suggested epics como draft (para Aprovar/Rejeitar manual)
- Cards de regras: workflow_state="closed", status=DONE, labels=["business_rule"]
- Suggested epics: workflow_state="draft", labels=["suggested"] — sem children gerados

---

## 📁 Files Modified

1. **backend/app/api/routes/projects.py** — Reescrito _process_full_hierarchy_async
   - Removido: 5 fases com ativação de sugestões e geração de children AI
   - Adicionado: 3 fases focadas em regras existentes + epics sugeridos (sem children)

---

## 🎯 Success Metrics

✅ **Business rule cards:** Criados com hierarquia correta (Epic>Story>Task>Subtask), closed
✅ **Sem cards AI-suggested:** Nenhuma Story/Task/Subtask sugerida é criada automaticamente
✅ **Suggested epics:** Criados apenas como draft para review manual
✅ **Fallback generico eliminado:** Tasks como "Criar modelo de dados" não aparecem mais

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ "Gerar Cards" cria apenas regras de negocio existentes (closed, from_code)
- ✅ Hierarquia completa (Epic>Story>Task>Subtask) via _classify_rules_hierarchy
- ✅ Suggested epics gerados como draft para review (Aprovar/Rejeitar)
- ✅ Nenhum child sugerido pela IA gerado automaticamente
- ✅ Eliminados cards genéricos de fallback no fluxo principal

---
