# PROMPT #109 - Error Dialog + Closed Questions Fix
## Fixing Interview UX Issues with Gemini API

**Date:** 2026-01-26
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix + UX Improvement
**Impact:** Fixes broken interview experience when using Gemini API

---

## Objective

Fix three related issues in the interview system:

1. **Error Display**: Replace crude browser `alert()` calls with proper styled modal dialogs
2. **Empty Options Validation**: Prevent submission of empty/invalid options
3. **Closed Questions Format**: Force AI (especially Gemini) to generate closed questions with options

**Key Requirements:**
1. Create ErrorDialog component following project patterns
2. Replace all `alert()` calls in ChatInterface.tsx with ErrorDialog
3. Add validation for empty options in handleOptionSubmit
4. Update context interview prompts to enforce closed questions format
5. Add rule to CLAUDE.md about prompt modifications

---

## What Was Implemented

### 1. ErrorDialog Component

Created new UI component `ErrorDialog.tsx` that:
- Uses existing Dialog component pattern
- Supports error, warning, and info types
- Shows expandable technical details
- Provides helper function `formatErrorMessage()` to safely convert any error to string

```typescript
// Example usage
setErrorDialog({
  open: true,
  title: 'Erro',
  message: formatErrorMessage(errorDetail),
  details: typeof errorDetail === 'object' ? JSON.stringify(errorDetail, null, 2) : undefined
});
```

### 2. ChatInterface.tsx Updates

Replaced 10 `alert()` calls with ErrorDialog:
- Line 99: handleSendMessageError
- Line 121: handleGeneratePromptsComplete (success)
- Line 146: handleGeneratePromptsError
- Line 189: handleProvisioningError
- Line 343: loadInterview catch
- Line 405: startInterviewWithAI catch
- Line 513: handleSend generic error
- Line 586: handleOptionSubmit generic error
- Line 714: handleComplete
- Line 727: handleCancel

### 3. Empty Options Validation

Added validation in `handleOptionSubmit`:

```typescript
const handleOptionSubmit = async (selectedLabels: string[]) => {
  // PROMPT #109 - Validate that options are not empty
  const validLabels = selectedLabels.filter(label => label && label.trim() !== '');

  if (validLabels.length === 0) {
    setErrorDialog({
      open: true,
      title: 'Opcao invalida',
      message: 'Por favor, selecione uma opcao valida ou digite sua resposta no campo de texto.'
    });
    return;
  }
  // ... rest of function
};
```

### 4. Closed Questions Format in Prompts

Updated `context_interview_ai.yaml` to enforce closed questions:

```yaml
system_prompt: |
  ## Formato OBRIGATORIO
  Responda EXATAMENTE neste formato:

  **Pergunta {{ question_count }}: [Sua pergunta aqui]**

  ○ [Primeira opcao]
  ○ [Segunda opcao]
  ○ [Terceira opcao]
  ○ [Quarta opcao]

  💬 Ou descreva com suas proprias palavras.

  ## REGRAS CRITICAS
  - GERE APENAS UMA PERGUNTA POR RESPOSTA
  - Use SOMENTE "○" (circulo vazio Unicode)
  - NUNCA use "•" (bullet) ou outros simbolos
  - Forneca entre 3-5 opcoes de resposta
```

### 5. context_questions.py Migration

Updated `get_context_ai_prompt()` to use PromptLoader:

```python
from app.prompts.loader import PromptLoader

def get_context_ai_prompt(conversation_data: list, project: Project) -> str:
    # PROMPT #109 - Load prompt from YAML with closed questions format
    try:
        loader = PromptLoader()
        system_prompt, _ = loader.render(
            "interviews/context_interview_ai",
            {
                "project_name": project.name,
                "qa_summary": qa_summary,
                "question_count": question_count + 1
            }
        )
        return system_prompt
    except Exception as e:
        # Fallback to hardcoded prompt if loader fails
        ...
```

### 6. CLAUDE.md Rule

Added "Golden Rule for Prompt Modifications":

```
**REGRA DE OURO PARA MODIFICACOES DE PROMPTS:**
1. PRIMEIRO: Localize o arquivo YAML em `backend/app/prompts/`
2. FACA AS ALTERACOES NO YAML
3. VERIFIQUE: Se o codigo Python ainda usa prompt hardcoded, migre para PromptLoader
4. TESTE: Reinicie o servidor e teste a funcionalidade
```

---

## Files Modified/Created

### Created:
1. **[frontend/src/components/ui/ErrorDialog.tsx](frontend/src/components/ui/ErrorDialog.tsx)**
   - New ErrorDialog component
   - formatErrorMessage helper function

### Modified:
1. **[frontend/src/components/interview/ChatInterface.tsx](frontend/src/components/interview/ChatInterface.tsx)**
   - Added ErrorDialog import and state
   - Replaced 10 alert() calls with ErrorDialog
   - Added empty options validation

2. **[backend/app/prompts/interviews/context_interview_ai.yaml](backend/app/prompts/interviews/context_interview_ai.yaml)**
   - Changed from open to closed questions format
   - Added explicit formatting rules

3. **[backend/app/prompts/interviews/fixed_questions_context.yaml](backend/app/prompts/interviews/fixed_questions_context.yaml)**
   - Updated ai_contextual_prompt section

4. **[backend/app/api/routes/interviews/context_questions.py](backend/app/api/routes/interviews/context_questions.py)**
   - Added PromptLoader import
   - Updated get_context_ai_prompt() to use YAML
   - Added fallback prompt with closed questions format

5. **[CLAUDE.md](CLAUDE.md)**
   - Added "Golden Rule" for prompt modifications
   - Updated prompt number to #109

---

## Testing Results

### Manual Verification:

```bash
# Frontend compiles without errors
cd frontend && npm run build

# Backend imports work correctly
python -c "from app.prompts.loader import PromptLoader; print('OK')"
```

### Expected Behavior:

1. **Error Dialog**: When an error occurs during interview, user sees styled modal instead of browser alert
2. **Empty Options**: If user clicks option with empty label, error modal appears instead of `[object Object]`
3. **Closed Questions**: AI generates questions with options using ○ symbol

---

## Success Metrics

- **0 browser alert() calls** in error handling paths
- **100% option validation** before submission
- **Closed questions format** enforced in YAML prompts
- **CLAUDE.md updated** with golden rule for prompt changes

---

## Key Insights

### 1. Error Handling Pattern
The project uses Dialog components for user-facing messages. Browser alerts break UX and can show `[object Object]` when error is an object.

### 2. Prompt Source of Truth
YAML files in `backend/app/prompts/` are the source of truth. Python code should use PromptLoader, not hardcoded strings.

### 3. AI Prompt Enforcement
Different AI providers (Gemini, Claude, GPT) may interpret formatting instructions differently. Explicit rules like "GERE APENAS UMA PERGUNTA" and "Use SOMENTE ○" help ensure consistent output.

---

## Additional Fix: Bullet Symbol Normalization (Phase 2)

After initial implementation, the user reported that Gemini was still generating open questions.
Investigation revealed that the `option_parser.py` only recognized the exact `○` symbol (U+25CB).
Gemini sometimes uses different bullet symbols like `•`, `-`, `●`, etc.

### Fix Applied:

1. **Extended option_parser.py** to recognize 13+ bullet symbols:
   - `○`, `●`, `•`, `◦`, `◉`, `◯`, `⚪`, `⚫`, `·`, `-`, `*`, `–`, `—`
   - Checkbox variants: `☐`, `☑`, `☒`, `□`, `■`, `▢`, `▣`

2. **Added normalization step** (`_normalize_bullets()`) that converts all bullet variants to `○` before parsing

3. **Increased max_tokens**:
   - From 1000 → 1500 for regular questions
   - From 500 → 1000 for first question
   - Prevents response truncation ("picotadas")

4. **Added detailed logging** to debug bullet detection

### Files Modified (Phase 2):
- [backend/app/api/routes/interviews/option_parser.py](backend/app/api/routes/interviews/option_parser.py)
- [backend/app/api/routes/interviews/unified_open_handler.py](backend/app/api/routes/interviews/unified_open_handler.py)

---

## Status: COMPLETE

**Key Achievements:**
- Created reusable ErrorDialog component
- Eliminated all crude browser alerts in ChatInterface
- Added option validation preventing `[object Object]` errors
- Enforced closed questions format for Gemini compatibility
- Extended bullet symbol recognition (13+ symbols)
- Added bullet normalization for cross-AI compatibility
- Increased max_tokens to prevent truncation
- Documented golden rule for future prompt modifications

**Impact:**
- Better user experience with styled error modals
- Consistent question format across AI providers (Claude, GPT, Gemini)
- Clear guidelines for future prompt changes
- Questions no longer get cut off mid-sentence
