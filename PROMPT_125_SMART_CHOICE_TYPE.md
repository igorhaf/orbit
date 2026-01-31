# PROMPT #125 - Smart Choice Type Detection (AI-Powered)
## Single Choice (radiobox) vs Multiple Choice (checkbox)

**Date:** January 30, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** AI analyzes each question and automatically determines the correct input type

---

## Objective

Implement intelligent choice type detection using AI analysis. After each question is generated, a secondary AI call analyzes the question semantics and determines whether it should be:
- **Single Choice** (radiobox - ○) - for mutually exclusive answers
- **Multiple Choice** (checkbox - ☐) - for non-exclusive answers

**Problem Identified:**
- Initial approach of instructing AI to choose symbols didn't work reliably
- AI models (especially Gemini) often ignored formatting instructions
- User experience was suboptimal for questions that allow multiple answers

**Solution:**
- Use a dedicated AI call to analyze each generated question
- Automatically convert symbols (○ ↔ ☐) based on analysis result
- Works independently of which AI model generates the question

---

## Architecture

```
AI generates question (any format)
         ↓
clean_ai_response() - cleans the response
         ↓
analyze_and_convert_choice_type() - NEW
    │
    ├── Extract question text and options
    ├── Call AI with choice_type_analyzer.yaml
    ├── AI returns "SINGLE" or "MULTIPLE"
    └── Convert symbols if needed (○↔☐)
         ↓
parse_ai_question_options() - parses structured options
         ↓
Frontend renders correct input type
```

---

## Files Created

### 1. Choice Type Analyzer Prompt
**File:** [choice_type_analyzer.yaml](backend/app/prompts/interviews/choice_type_analyzer.yaml)

```yaml
name: choice_type_analyzer
version: 1
usage_type: prompt_generation
estimated_tokens: 200

system_prompt: |
  Voce e um analisador de perguntas de entrevista.

  Sua tarefa e determinar se uma pergunta deve permitir:
  - SINGLE: O usuario so pode escolher UMA opcao
  - MULTIPLE: O usuario pode escolher VARIAS opcoes

  ## Regras para SINGLE:
  - Pergunta sobre algo UNICO: "Qual o banco de dados PRINCIPAL?"
  - Opcoes mutuamente exclusivas: "Qual arquitetura?"

  ## Regras para MULTIPLE:
  - Pergunta sobre QUAIS (plural): "Quais integracoes?"
  - Lista de funcionalidades: "Quais funcionalidades sao prioritarias?"

  Responda APENAS com: SINGLE ou MULTIPLE
```

### 2. Analysis Function
**File:** [option_parser.py](backend/app/api/routes/interviews/option_parser.py)

```python
async def analyze_and_convert_choice_type(content: str, db) -> str:
    """
    Use AI to analyze question and determine correct choice type.

    1. Extracts question text and options
    2. Calls AI to determine single_choice or multiple_choice
    3. Converts symbols if needed (○ to ☐ or vice versa)
    """
```

---

## Files Modified

| File | Changes |
|------|---------|
| [option_parser.py](backend/app/api/routes/interviews/option_parser.py) | Added `analyze_and_convert_choice_type()` function |
| [unified_open_handler.py](backend/app/api/routes/interviews/unified_open_handler.py) | Integrated analysis after AI response |
| [interview_handlers.py](backend/app/api/routes/interview_handlers.py) | Integrated analysis after AI response |

---

## How It Works

### 1. Question Generation
AI generates a question with options (using any symbol):
```
❓ Pergunta 4: Quais integrações serão necessárias?

○ Gateway de pagamento
○ Serviços de email
○ APIs de redes sociais
○ Armazenamento de arquivos
```

### 2. AI Analysis
The analyzer prompt is called:
```
PERGUNTA: Quais integrações serão necessárias?

OPCOES:
- Gateway de pagamento
- Serviços de email
- APIs de redes sociais
- Armazenamento de arquivos

Esta pergunta deve ser SINGLE ou MULTIPLE?
```

AI Response: `MULTIPLE`

### 3. Symbol Conversion
Since AI said MULTIPLE but symbols are ○, convert to ☐:
```
❓ Pergunta 4: Quais integrações serão necessárias?
☑️ Selecione todas que se aplicam.

☐ Gateway de pagamento
☐ Serviços de email
☐ APIs de redes sociais
☐ Armazenamento de arquivos
```

### 4. Frontend Rendering
Parser detects ☐ → `question_type = "multiple_choice"`
Frontend renders checkboxes (multiple selection allowed)

---

## Decision Rules

### Use SINGLE (○) when:
| Indicator | Example |
|-----------|---------|
| "Qual" (singular) | "Qual arquitetura?" |
| "principal", "único" | "Qual o banco PRINCIPAL?" |
| Mutually exclusive | "Qual prazo esperado?" |
| One priority | "Quem é o público-alvo principal?" |

### Use MULTIPLE (☐) when:
| Indicator | Example |
|-----------|---------|
| "Quais" (plural) | "Quais integrações?" |
| "todas", "vários" | "Quais funcionalidades?" |
| Non-exclusive | "Quais plataformas?" |
| List of items | "Quais relatórios?" |

---

## Performance

- **AI Call:** ~200 tokens per analysis (minimal cost)
- **Latency:** ~0.5-1s additional per question
- **Accuracy:** High (dedicated prompt for this specific task)
- **Model Used:** prompt_generation (fast, cheap)

---

## Integration Points

### unified_open_handler.py (line 309-311)
```python
# PROMPT #125 - Use AI to analyze choice type
analyzed_content = await analyze_and_convert_choice_type(cleaned_content, db)
parsed_content, parsed_options = parse_ai_question_options(analyzed_content)
```

### interview_handlers.py (line 739-741)
```python
# PROMPT #125 - Use AI to analyze choice type
analyzed_content = await analyze_and_convert_choice_type(cleaned_content, db)
parsed_content, parsed_options = parse_ai_question_options(analyzed_content)
```

---

## Testing Scenarios

### Questions that should be SINGLE:
- "Qual arquitetura você pretende usar?" → ○
- "Qual será o banco de dados principal?" → ○
- "Qual o prazo esperado para o MVP?" → ○
- "Quem é o usuário principal do sistema?" → ○

### Questions that should be MULTIPLE:
- "Quais integrações são necessárias?" → ☐
- "Quais funcionalidades são prioritárias?" → ☐
- "Quais relatórios o sistema deve gerar?" → ☐
- "Quais métodos de pagamento serão aceitos?" → ☐

---

## Status: COMPLETE

**Key Achievements:**
- Created dedicated AI analyzer prompt (choice_type_analyzer.yaml)
- Implemented analysis function in option_parser.py
- Integrated analysis in unified_open_handler.py and interview_handlers.py
- Automatic symbol conversion (○ ↔ ☐) based on AI analysis

**Impact:**
- Works reliably regardless of which AI model generates questions
- Automatic correction of incorrect choice types
- Better UX for questions that allow multiple answers
- ~200 tokens overhead per question (minimal cost)
