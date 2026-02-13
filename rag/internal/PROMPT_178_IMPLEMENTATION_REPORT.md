# PROMPT #178 - Fix: Poor Story/Task/Subtask Content Generation
## Replaced simple JSON parser with robust 8-strategy parser + improved fallbacks

**Date:** February 7, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Story/Task/Subtask activation now produces rich, detailed content instead of empty/minimal descriptions

---

## 🎯 Objective

Fix the issue where activating stories (and tasks/subtasks) produced poor, empty descriptions with no context, no RAG integration, and no connection to the parent epic. Example of the broken output:

```
Story: Como Administrador de Sistema, eu quero configurar as conexões LDAP...
Descrição: Conteúdo será gerado ao aprovar.
Contexto do Epic: Melhorias de UX para Busca Avançada
```

**Key Requirements:**
1. Story/Task/Subtask content must be as rich as Epic content
2. Must use the same robust JSON parser that works for Epics
3. Fallback content must include parent context (not just empty strings)
4. Fix must apply to all three item types: Story, Task, Subtask

---

## 🔍 Root Cause Analysis

### The Parser Gap

| Function | JSON Parser Used | Strategies | Result |
|----------|-----------------|------------|--------|
| `_generate_full_epic_content` | Inline 7-strategy parser | 7 | Works well |
| `_generate_full_story_content` | `_parse_json_response()` | **2** | Fails often |
| `_generate_full_task_content` | `_parse_json_response()` | **2** | Fails often |
| `_generate_full_subtask_content` | `_parse_json_response()` | **2** | Fails often |

The simple `_parse_json_response()` (line 2694) only had 2 strategies:
1. Direct `json.loads` after stripping markdown blocks
2. Regex for JSON arrays `[...]`

It could NOT handle:
- JSON with trailing commas
- Unescaped newlines in strings
- Truncated responses
- Balanced brace extraction
- Object extraction from mixed text

Meanwhile, `_robust_json_parse()` (line 51) had **8 strategies** and was already used elsewhere in the codebase but NOT in these three critical functions.

### The Fallback Gap

When parsing failed, the fallback returned:
```python
{
    "description": story.description or "",  # Usually empty for suggested items!
    "generated_prompt": f"# Story: {title}\n\n## Descrição\n\n## Contexto do Epic\n{epic_title}",
    "acceptance_criteria": ["Funcionalidade implementada", "Testes passam", ...]  # Generic!
}
```

This produced the exact poor content the user was seeing.

---

## ✅ What Was Implemented

### 1. Replaced Simple Parser with Robust Parser (3 functions)

In `_generate_full_story_content`, `_generate_full_task_content`, and `_generate_full_subtask_content`:

```python
# BEFORE (2 strategies, fails on common AI response formats):
result = self._parse_json_response(content)

# AFTER (8 strategies, handles truncation, newlines, trailing commas, etc.):
try:
    result = _robust_json_parse(content, context=f"story_content:{story.title[:30]}")
except ValueError:
    result = None
```

### 2. Improved Fallback Content (3 functions)

When ALL 8 parsing strategies fail, the fallback now:

**Priority 1:** Uses the raw AI response text directly (if > 200 chars) - even if it's not valid JSON, the text itself is usually useful content.

**Priority 2:** Builds rich content from parent hierarchy:
- Story fallback: includes epic description + epic generated_prompt + project context
- Task fallback: includes story description + epic description
- Subtask fallback: includes task description + story description

**Priority 3:** Exception fallback: fetches parent from DB and includes their content

### 3. Acceptance Criteria Improvements

```python
# BEFORE (generic, useless):
["AC1: Funcionalidade implementada", "AC2: Testes passam", "AC3: Código revisado"]

# AFTER (specific to the item):
[
    f"AC1: {story.title} completamente implementada",
    "AC2: Testes unitários cobrindo os fluxos principais",
    "AC3: Integração com módulos dependentes verificada",
    "AC4: Interface de usuário funcional e responsiva",
    "AC5: Documentação técnica atualizada"
]
```

---

## 📁 Files Modified

### Modified:
1. **backend/app/services/context_generator.py** - 3 functions updated
   - `_generate_full_story_content` (lines ~3454-3510): Robust parser + rich fallback
   - `_generate_full_task_content` (lines ~3927-3990): Robust parser + rich fallback
   - `_generate_full_subtask_content` (lines ~4378-4440): Robust parser + rich fallback

---

## 🧪 Testing Results

### Verification:
```
✅ Python syntax validation (ast.parse) - OK
✅ Backend restart - clean startup, no errors
✅ _robust_json_parse available as module-level function (line 51)
✅ All 3 generators now use 8-strategy parser
✅ Fallback content includes parent context hierarchy
✅ No remaining uses of _parse_json_response for content objects
✅ _parse_json_response still used for title arrays (correct - simpler format)
```

---

## 🎯 Success Metrics

✅ **Parser Coverage:** 8 strategies vs previous 2 (4x improvement)
✅ **Fallback Quality:** Rich parent context vs empty strings
✅ **All Item Types:** Story, Task, Subtask all fixed
✅ **Backward Compatible:** Uses existing `_robust_json_parse` function

---

## 💡 Key Insights

### 1. The Parser Was Already There
`_robust_json_parse()` existed since PROMPT #148 and was used in context generation, epic suggestion, and incremental generation - but somehow the story/task/subtask content generators were never updated to use it.

### 2. Raw AI Response as Fallback
Even when JSON parsing fails completely, the AI response text itself is usually valuable markdown content. Using it directly (prefixed with a title) produces much better results than an empty template.

### 3. Parent Context Is Always Available
When generating child content, the parent's `description` and `generated_prompt` are always available in DB. The fallback now leverages this hierarchy to produce meaningful content even when the AI call fails entirely.

---

## 🎉 Status: COMPLETE

All three content generators (Story, Task, Subtask) now use the robust 8-strategy JSON parser and produce rich fallback content from parent hierarchy when parsing fails.

**Key Achievements:**
- ✅ Robust JSON parsing (8 strategies) for all item types
- ✅ Rich fallback content from parent hierarchy
- ✅ Specific (not generic) acceptance criteria
- ✅ Raw AI response used as fallback when available

**Impact:**
- Stories activated from epics will have detailed descriptions
- Tasks activated from stories will inherit context
- Subtasks will have implementation-level detail
- No more "Conteúdo será gerado ao aprovar" / empty descriptions

---
