# PROMPT #180 - Include Acceptance Criteria in Generated Prompt
## Critérios de aceitação agora são estruturados no campo generated_prompt

**Date:** February 7, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / Enhancement
**Impact:** Aba "Prompt" do card agora exibe o prompt completo com critérios de aceitação estruturados

---

## 🎯 Objective

Os critérios de aceitação gerados pela IA eram armazenados apenas na coluna `acceptance_criteria` (JSON array) do banco, mas NÃO eram incluídos no campo `generated_prompt`. Isso fazia com que a aba "Prompt" do card mostrasse apenas a especificação sem os critérios.

**Key Requirements:**
1. Incluir critérios de aceitação como seção "## Critérios de Aceitação" no `generated_prompt`
2. Aplicar em todos os tipos de card: Epic, Story, Task, Subtask
3. Aplicar em todos os caminhos de geração: parser bem-sucedido, extração de raw response, fallback de contexto pai

---

## 🔍 Root Cause Analysis

O campo `generated_prompt` era populado apenas com `description_markdown`:

```python
# ANTES - description_markdown sem critérios
result["generated_prompt"] = description_markdown
```

Os critérios eram retornados como campo separado no dict e salvos na coluna `acceptance_criteria` da tabela, mas nunca incorporados ao texto do prompt. A aba "Prompt" no frontend exibe `generated_prompt`, então os critérios ficavam invisíveis nessa aba.

---

## ✅ What Was Implemented

### 1. Epic Generator (line ~2526)
Critérios de aceitação agora são adicionados ao `generated_prompt` após o `description_markdown`.

### 2. Story Generator - Parser Path (line ~3577)
```python
# DEPOIS - prompt completo com critérios
acceptance_criteria = result.get("acceptance_criteria", [])
prompt_with_criteria = description_markdown
if acceptance_criteria:
    prompt_with_criteria += "\n\n## Critérios de Aceitação\n\n"
    for ac in acceptance_criteria:
        prompt_with_criteria += f"- {ac}\n"
result["generated_prompt"] = prompt_with_criteria
```

### 3. Task Generator - Parser Path (line ~4080)
Mesma lógica do Story generator.

### 4. Subtask Generator - Parser Path (line ~4558)
Mesma lógica do Story generator.

### 5. `_extract_content_from_raw_response()` Function (line ~315, ~342)
Critérios incluídos no `generated_prompt` nos 3 caminhos de retorno:
- Path 1: description_markdown extraída via regex
- Path 2: texto stripped sem JSON
- Path 3: descrição construída do semantic_map (já incluía)

### 6. Fallback Paths (Story ~3629, Task ~4121, Subtask ~4596)
Fallbacks de contexto pai agora constroem `fallback_prompt` separado do `fallback_desc`, incluindo seção de critérios.

---

## 📁 Files Modified

### Modified:
1. **backend/app/services/context_generator.py** - 10 alterações
   - Epic generator: critérios no generated_prompt
   - Story/Task/Subtask: parser path, extracted path, fallback path
   - `_extract_content_from_raw_response()`: 2 pontos de retorno atualizados

---

## 🧪 Testing Results

```
✅ Python syntax validation (ast.parse) - OK
✅ Backend restart - clean, no errors
✅ Teste 1 (resposta completa): Critérios no generated_prompt ✅
✅ Teste 2 (resposta truncada): Critérios no generated_prompt ✅
✅ Teste 3 (description limpa): Sem critérios duplicados na description ✅
```

---

## 🎯 Success Metrics

✅ **Critérios na aba Prompt:** generated_prompt agora inclui "## Critérios de Aceitação" com lista
✅ **Todos os item types:** Epic, Story, Task, Subtask — todos corrigidos
✅ **Todos os caminhos:** Parser success, raw extraction, parent context fallback
✅ **Sem duplicação:** Description continua limpa, critérios só no generated_prompt

---

## 🎉 Status: COMPLETE

A aba "Prompt" do card agora mostra o prompt completo e estruturado incluindo os critérios de aceitação como seção markdown. Aplicado em todos os 4 tipos de card e em todos os caminhos de geração de conteúdo.

**Key Achievements:**
- ✅ 10 pontos de geração de `generated_prompt` atualizados
- ✅ Critérios estruturados como "## Critérios de Aceitação" com bullet points
- ✅ Epic, Story, Task, Subtask — todos consistentes

---
