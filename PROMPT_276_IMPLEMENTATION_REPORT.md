# PROMPT #276 - Fix Console Duplicate Log + Card Generation Quality
## Correcao de log duplicado no console e melhoria de qualidade na geracao de cards

**Date:** 2026-02-14
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix + Quality Improvement
**Impact:** Console sem duplicacao de logs; cards gerados com conteudo em portugues, conciso e sem alucinacoes

---

## Objective

Dois problemas identificados no console de streaming e na geracao de cards:

**Bug 1 - Log duplicado no console:** Cada resposta de IA aparecia DUAS vezes no console ao mesmo timestamp. O streaming completion event (`log_ai_streaming_chunk` com `is_complete=True`) e o log generico (`log_ai_response`) eram chamados para a mesma resposta.

**Bug 2 - Qualidade dos cards gerados:** Output do qwen3:14b mostrou:
- Titulo em ingles ("If course is not found, return a 404 error")
- Semantic map inflado (10 N's, 10 RN's, 8 ATTR's para uma subtask simples)
- Regras de negocio inventadas/alucinadas (RN4: "titulo padrao e Suinda", RN5: "id padrao 99")
- description_markdown excessivamente longa (20 pontos para um simples 404)

---

## What Was Implemented

### 1. Fix: Console Log Duplicado

**Arquivo:** `backend/app/services/ai_orchestrator.py`

O `execute()` tinha 2 caminhos que logavam a resposta:
- **Streaming path (linha 1462):** `log_ai_streaming_chunk(is_complete=True, accumulated_text=...)` - log ao final do streaming
- **General path (linha 1511):** `log_ai_response(...)` - log generico que executava SEMPRE apos o try/except

**Fix:** Adicionada flag `_streamed_ok = True` antes do try streaming. Se streaming falha (except), seta `_streamed_ok = False`. O log generico so executa se `not _streamed_ok` (fallback path).

### 2. Fix: Qualidade dos Cards - Todos os 4 Prompts YAML

**Arquivos modificados:**
- `backend/app/prompts/backlog/epic_from_interview.yaml`
- `backend/app/prompts/backlog/stories_from_epic.yaml`
- `backend/app/prompts/backlog/tasks_from_story.yaml`
- `backend/app/prompts/backlog/subtasks_from_task.yaml`

**Mudancas aplicadas em TODOS os 4 prompts:**

1. **Portugues forcado:** Texto reescrito para enfatizar "titulos, descricoes, criterios, TUDO em portugues. NUNCA escreva em ingles."

2. **Limites de semantic_map por nivel:**
   - Epic: max 15 identificadores
   - Story: max 12 identificadores
   - Task: max 10 identificadores
   - Subtask: max 8 identificadores

3. **Proibicao de alucinacao de regras:** "NUNCA invente regras de negocio. Use APENAS as regras fornecidas no contexto. Se nenhuma regra foi fornecida, NAO crie identificadores RN ou C."

4. **Limites de description_markdown:**
   - Epic: max 15 paragrafos
   - Story: max 10 paragrafos
   - Task: max 8 paragrafos
   - Subtask: max 5 paragrafos

5. **Limites de acceptance_criteria:**
   - Epic: max 6
   - Story: max 5
   - Task: max 5
   - Subtask: max 3-4

---

## Files Modified

1. **backend/app/services/ai_orchestrator.py**
   - Flag `_streamed_ok` para evitar log duplicado
   - Console log condicional: so loga se streaming falhou

2. **backend/app/prompts/backlog/epic_from_interview.yaml**
   - Secao LIMITES OBRIGATORIOS adicionada

3. **backend/app/prompts/backlog/stories_from_epic.yaml**
   - Secao LIMITES OBRIGATORIOS adicionada

4. **backend/app/prompts/backlog/tasks_from_story.yaml**
   - Secao LIMITES OBRIGATORIOS adicionada

5. **backend/app/prompts/backlog/subtasks_from_task.yaml**
   - Secao LIMITES OBRIGATORIOS adicionada

---

## Status: COMPLETE

**Key Achievements:**
- Console sem duplicacao de logs de IA
- Cards gerados serao mais concisos e em portugues
- Semantic maps com tamanho controlado por nivel hierarquico
- Sem invencao de regras de negocio - apenas regras reais do contexto
- Descriptions e acceptance criteria com limites claros

**Impact:**
- Console mais limpo e legivel
- Cards de melhor qualidade em todos os niveis da hierarquia
- Menos tokens consumidos por geracao (conteudo mais conciso)
- Menos alucinacoes de modelos menores (qwen3, gemma3)
