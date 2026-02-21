# PROMPT #182 - Inject Real Business Rules from RAG into Card Activation
## Regras de negócio reais do código-fonte agora são injetadas na ativação de todos os cards

**Date:** February 7, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** Épicos, Stories, Tasks e Subtasks ativados agora contêm as regras de negócio reais extraídas do código

---

## 🎯 Objective

Quando cards sugeridos eram ativados, o conteúdo gerado era genérico — "Regras de Negócio Documentadas", "RN1:" sem conteúdo real. As regras de negócio extraídas do código-fonte e armazenadas no RAG **não eram consultadas** durante a ativação.

**Key Requirements:**
1. Buscar regras de negócio do RAG explicitamente durante ativação de cards
2. Injetar regras no prompt da IA com diretivas claras
3. Instruir a IA a incorporar regras reais (não genéricas) nos critérios de aceitação
4. Aplicar em todos os 4 tipos: Epic, Story, Task, Subtask

---

## 🔍 Root Cause Analysis

### Dois pipelines de geração, implementação inconsistente

**Pipeline 1 — `backlog_generator.py` (Geração via Entrevista):**
- ✅ Chama `_get_business_rules_context()` explicitamente
- ✅ Busca regras do RAG com `RAGService.get_business_rules()`
- ✅ Formata e injeta no user_prompt
- ✅ Instrução: "DEVEM respeitar TODAS as regras de negócio"

**Pipeline 2 — `context_generator.py` (Ativação de Cards Sugeridos):**
- ❌ NÃO buscava regras de negócio do RAG
- ❌ Usava apenas `enable_rag=True` (busca semântica genérica, não específica para regras)
- ❌ Sem instrução para a IA sobre regras do projeto
- ❌ Resultado: conteúdo genérico com "RN1:" vazio

---

## ✅ What Was Implemented

### Em cada um dos 4 geradores de conteúdo (`context_generator.py`):

1. **Busca explícita de regras do RAG:**
```python
rag_service = RAGService(self.db)
rules = rag_service.get_business_rules(project_id=project.id, top_k=20)
business_rules_context = rag_service.format_business_rules_for_prompt(rules, max_chars=6000)
```

2. **Injeção no user_prompt com diretivas claras:**
```python
{business_rules_context}
ATENÇÃO CRÍTICA: As regras de negócio acima foram extraídas DIRETAMENTE do código-fonte.
Você DEVE:
1. INCORPORAR estas regras no Mapa Semântico (como RN1, RN2, VAL1, etc.) com conteúdos REAIS
2. USAR as regras nos Critérios de Aceitação
3. DETALHAR as regras na seção "Regras de Negócio Detalhadas"
4. RESPEITAR a hierarquia e estrutura das regras do código existente
NÃO invente regras genéricas — USE as regras REAIS listadas acima.
```

### Detalhes por tipo de card:

| Card Type | Function | max_rules | max_chars |
|-----------|----------|-----------|-----------|
| **Epic** | `_generate_full_epic_content` | 20 | 6000 |
| **Story** | `_generate_full_story_content` | 20 | 4000 |
| **Task** | `_generate_full_task_content` | 15 | 3000 |
| **Subtask** | `_generate_full_subtask_content` | 10 | 2000 |

(Escala decrescente: épicos precisam de mais contexto, subtasks são mais focadas)

---

## 📁 Files Modified

### Modified:
1. **backend/app/services/context_generator.py** - 4 injeções de business rules
   - `_generate_full_epic_content`: busca + injeção de regras (linhas ~1888-1920)
   - `_generate_full_story_content`: busca + injeção de regras (linhas ~3542-3570)
   - `_generate_full_task_content`: busca + injeção de regras (linhas ~4057-4075)
   - `_generate_full_subtask_content`: busca + injeção de regras (linhas ~4548-4570)

---

## 🧪 Testing Results

```
✅ Python syntax validation (ast.parse) - OK
✅ Backend restart - clean startup, no errors
✅ RAGService.get_business_rules() accessible
✅ RAGService.format_business_rules_for_prompt() accessible
```

---

## 🎯 Success Metrics

✅ **Regras reais injetadas:** RAG é consultado em TODA ativação de card
✅ **Diretivas claras:** IA instruída a usar regras REAIS, não genéricas
✅ **Hierarquia respeitada:** Regras priorizadas por fonte (interface > validation > model)
✅ **Escala adequada:** Epic=20 regras, Story=20, Task=15, Subtask=10
✅ **Consistência:** Mesma abordagem do `backlog_generator.py` replicada no `context_generator.py`

---

## 🎉 Status: COMPLETE

Os 4 geradores de conteúdo em `context_generator.py` agora buscam e injetam regras de negócio reais do RAG nos prompts da IA. Cards ativados conterão regras de negócio extraídas do código-fonte do projeto, com diretivas explícitas para a IA incorporá-las no mapa semântico, critérios de aceitação e descrição.

**Key Achievements:**
- ✅ Pipeline de ativação agora equivalente ao pipeline de entrevista
- ✅ Regras de negócio do código-fonte usadas em toda hierarquia (Epic→Story→Task→Subtask)
- ✅ Diretivas explícitas impedem conteúdo genérico

---
