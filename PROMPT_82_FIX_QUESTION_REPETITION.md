# PROMPT #82 - Fix Interview Question Repetition
## Eliminar Repetição de Perguntas Após 3ª Pergunta

**Date:** January 19, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Critical - Interviews now generate unique questions without repetition

---

## 🎯 Objective

Fix the issue where interview questions started repeating after the 3rd question. The AI was generating the same question over and over (e.g., "Pergunta 2" repeated as Q3, Q4, Q5...).

**Key Requirements:**
1. Interviews must use ONE SINGLE SESSION with ALL historical context
2. Each question must be unique - no repetitions
3. Cost increase must be minimal (interviews are short)

---

## 🔍 Root Cause Analysis

### Problem Discovery

The user correctly identified that the system should use **ONE SINGLE SESSION** with ALL historical context for each new question:

> "você está usando a mesma sessão para usar o mesmo contexto? ou está usando contextos diferentes para cada pergunta da entrevista?"

### Three Root Causes Found

#### Cause 1: Context Summarization (Initial Hypothesis)
**File:** `context_builders.py`

The `prepare_interview_context()` function was summarizing old messages after 10 messages:
- Only first 100 characters kept from older messages
- AI lost full question context → couldn't remember previous questions

**Status:** Was NOT the actual cause, but was fixed for future-proofing.

#### Cause 2: Weak RAG Deduplication (Secondary Issue)
**File:** `unified_open_handler.py`

The RAG retrieval for question deduplication had several issues:
- Empty query (`query=""`) - returned documents by raw distance, not semantic relevance
- Zero threshold (`similarity_threshold=0.0`) - no filtering
- Context truncated to 80 chars - lost full question context
- Positioned at END of system_prompt - low prominence

**Status:** Fixed with improvements, but was NOT the actual cause.

#### Cause 3: SEMANTIC CACHE (Actual Root Cause!)
**File:** `ai_orchestrator.py`

The semantic cache (PROMPT #74) was finding 98% similarity between requests and returning cached responses:

```
✓ Semantic cache hit (similarity: 0.982)
✓ Cache HIT (semantic) - saved ~$0.0038
✅ Cache HIT (semantic) - Saved API call!
```

When user answered Q2, the request was 98% similar to when they answered Q1, so the cache returned the same response (Q2) instead of generating Q3.

**Status:** ✅ FIXED by disabling cache for interviews.

---

## ✅ What Was Implemented

### Fix 1: Disable Cache for Interviews
**File:** `unified_open_handler.py`

```python
# PROMPT #82 - Disable cache for interviews to avoid question repetition
# Each interview question MUST be unique, cache returns same response causing repetition
orchestrator = AIOrchestrator(db, enable_cache=False)
```

**Reasoning:** Each interview question must be unique. Semantic cache works well for similar prompts that should return similar responses, but in interviews, we need DIFFERENT responses each time.

### Fix 2: Full Context (No Summarization)
**File:** `unified_open_handler.py`

```python
# PROMPT #82 - INTERVIEWS: Always send FULL context (no summarization)
messages = [
    {"role": msg["role"], "content": msg["content"]}
    for msg in interview.conversation_data
]
```

Removed the call to `prepare_interview_context()` which was summarizing older messages.

### Fix 3: Improved RAG Deduplication
**File:** `unified_open_handler.py`

- Semantic query with project context (not empty)
- Reduced `top_k` from 30 to 10
- XML tags `<previous_questions>` for structure
- Full questions shown (not truncated to 80 chars)
- Positioned at BEGINNING of system_prompt (high prominence)

### Fix 4: Documentation in context_builders.py

Added warning comment to `prepare_interview_context()`:
```python
"""
⚠️ IMPORTANT (PROMPT #82):
This function is ONLY used for TASK EXECUTION CHAT, NOT for interviews!
- Interviews always send FULL context (no summarization) to avoid question repetition
- This optimization is only applied to long task execution conversations
"""
```

---

## 📁 Files Modified

### Modified:
1. **[unified_open_handler.py](backend/app/api/routes/interviews/unified_open_handler.py)**
   - Disabled cache for interviews (`enable_cache=False`)
   - Full context (no summarization)
   - Improved RAG deduplication
   - Lines changed: ~30

2. **[context_builders.py](backend/app/api/routes/interviews/context_builders.py)**
   - Added warning comment about interview vs task execution usage
   - Lines changed: ~10

### Test Files:
1. **[test_quick.py](test_quick.py)** - Quick 3-question test
2. **[test_interview_no_repetition.py](test_interview_no_repetition.py)** - Full 8-question test

---

## 🧪 Testing Results

### Test 1: Quick Test (3 Questions)
```
✅ Projeto: 1cdbdf4c-5fdd-4ecc-8d08-5351e3887ef7
✅ Entrevista: 73c5cbef-2f13-43af-a709-89dc626649f7

📋 Pergunta 1: Qual é o principal...
📋 Pergunta 2: Que tipo de produtos serão vendidos...
📋 Pergunta 3: Quem serão os principais usuários...

✅ Teste concluído! Nenhuma repetição.
```

### Test 2: Full Test (9 Questions)
```
================================================================================
PROMPT #82 - Test Interview No Repetition
================================================================================

📋 Pergunta 1: Qual é o principal objetivo deste e-commerce?
📋 Pergunta 2: Que tipos de produtos serão vendidos na plataforma?
📋 Pergunta 3: Quais métodos de pagamento você pretende oferecer?
📋 Pergunta 4: Como você deseja que o controle de estoque funcione?
📋 Pergunta 5: Como você deseja que funcione o sistema de cupons de desconto?
📋 Pergunta 6: Como você deseja que funcione o cadastro e autenticação?
📋 Pergunta 7: Quais recursos de gestão de pedidos o painel deve ter?
📋 Pergunta 8: Como você deseja organizar o catálogo de produtos?
📋 Pergunta 9: Quais notificações por email devem ser enviadas?

📊 Total de perguntas: 9

✅ TESTE PASSOU! Nenhuma repetição detectada em 9 perguntas!
   - Contexto completo funcionando ✅
   - RAG deduplication funcionando ✅
================================================================================
```

---

## 🎯 Success Metrics

✅ **Zero Repetitions:** All 9 questions were unique
✅ **Context Quality:** AI maintains full conversation context
✅ **RAG Working:** Previous questions retrieved and shown to AI
✅ **Cache Disabled:** No more semantic cache hits for interviews
✅ **Cost Acceptable:** Full context for ~40 messages is minimal cost

---

## 💡 Key Insights

### 1. Cache Can Be Counter-Productive for Dynamic Content
The semantic cache (PROMPT #74) is excellent for similar requests that should return similar responses. However, for interviews where each response MUST be unique, the cache becomes harmful.

**Lesson:** Always consider whether caching is appropriate for the use case. Disable for dynamic, unique-response scenarios.

### 2. Debugging Strategy
The investigation went through multiple hypotheses:
1. Context summarization (wrong)
2. RAG deduplication (partially helpful)
3. **Semantic cache (actual root cause)**

Adding detailed debug logs was crucial to identify the real cause. The log `✅ Cache HIT (semantic)` immediately revealed the problem.

### 3. Dual-Layer Protection
The final solution uses two layers of protection:
1. **Cache disabled:** Ensures each request goes to AI
2. **RAG deduplication:** Shows previous questions to AI as additional context

This provides redundancy - if one layer fails, the other still helps.

---

## 🎉 Status: COMPLETE

The interview question repetition issue has been fully resolved. Tests confirm that interviews can now generate 9+ unique, contextualized questions without any repetition.

**Key Achievements:**
- ✅ Root cause identified (semantic cache)
- ✅ Cache disabled for interviews
- ✅ Full context sent (no summarization)
- ✅ RAG deduplication improved
- ✅ Tests pass with 9 unique questions

**Impact:**
- Users can now complete full interviews without seeing repeated questions
- Each question builds logically on previous context
- Cost increase is minimal (interviews are short, ~40 messages max)

---

## Compatibility Note

This fix only affects interviews. Other features continue to use the semantic cache:
- Task execution chat
- Prompt generation
- Commit generation
- General AI calls

The cache is only disabled when `AIOrchestrator` is instantiated with `enable_cache=False`.
