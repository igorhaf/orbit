# PROMPT #125 - Smart Choice Type Detection
## Single Choice (radiobox) vs Multiple Choice (checkbox)

**Date:** January 30, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** AI now intelligently chooses between radiobox and checkbox for each question

---

## Objective

Implement intelligent choice type detection in AI-generated interview questions. The AI should analyze each question and determine whether the user should:
- **Select ONE option** (radiobox - ○) - for mutually exclusive answers
- **Select MULTIPLE options** (checkbox - ☐) - for non-exclusive answers

**Problem Identified:**
- All interview prompts used only single choice (○)
- Many questions naturally allow multiple answers
- User experience was suboptimal for questions like "Which integrations do you need?"

**Key Requirements:**
1. AI analyzes question semantics before choosing symbol
2. Clear rules for when to use each type
3. Examples for both types in prompts
4. Frontend already supports both types (no changes needed)

---

## Logic Implemented

### Use ○ (SINGLE CHOICE - radiobox) when:
| Scenario | Example Question |
|----------|------------------|
| Only ONE option can be true | "Qual arquitetura será usada?" |
| Options are mutually exclusive | "Qual será o banco de dados principal?" |
| Asking about priority/focus | "Qual o nível de prioridade?" |
| Selecting one time period | "Qual o prazo esperado?" |
| Main/primary selection | "Quem é o público-alvo principal?" |

### Use ☐ (MULTIPLE CHOICE - checkbox) when:
| Scenario | Example Question |
|----------|------------------|
| User can choose several | "Quais integrações serão necessárias?" |
| Non-exclusive options | "Quais funcionalidades são prioritárias?" |
| List of features | "Quais tipos de relatórios?" |
| Multiple platforms | "Quais plataformas serão suportadas?" |
| Various methods | "Quais métodos de pagamento?" |

---

## Format Examples

### Single Choice (radiobox):
```
❓ Pergunta 4: Qual será o banco de dados principal do sistema?

○ PostgreSQL
○ MySQL
○ MongoDB
○ SQL Server

💬 Ou descreva com suas próprias palavras.
```

### Multiple Choice (checkbox):
```
❓ Pergunta 5: Quais integrações externas serão necessárias?
☑️ Selecione todas que se aplicam.

☐ Gateway de pagamento (Stripe, PagSeguro)
☐ Serviços de email (SendGrid, AWS SES)
☐ APIs de redes sociais (Facebook, Google)
☐ Serviços de armazenamento (S3, Google Cloud)
☐ Sistemas ERP/CRM existentes

💬 Ou descreva com suas próprias palavras.
```

---

## Files Modified

| File | Version | Changes |
|------|---------|---------|
| [context_interview_ai.yaml](backend/app/prompts/interviews/context_interview_ai.yaml) | 3 → 4 | Added complete single/multiple choice logic with rules and examples |
| [unified_open.yaml](backend/app/prompts/interviews/unified_open.yaml) | 1 → 2 | Added choice_type_rules section with examples for both types |
| [first_question.yaml](backend/app/prompts/interviews/first_question.yaml) | 1 → 2 | Added choice type analysis and examples |
| [meta_prompt_contextual.yaml](backend/app/prompts/interviews/meta_prompt_contextual.yaml) | 1 → 2 | Version bump (already had this logic) |

---

## Technical Details

### Backend Parser (already implemented)
The [option_parser.py](backend/app/api/routes/interviews/option_parser.py) already detects:
- `○` symbol → `question_type = "single_choice"`, `option_type = "single"`
- `☐` symbol → `question_type = "multiple_choice"`, `option_type = "multiple"`

### Frontend Rendering (already implemented)
The [MessageBubble.tsx](frontend/src/components/interview/MessageBubble.tsx) already renders:
- `type === 'single'` → Radio buttons (one selection)
- `type === 'multiple'` → Checkboxes (multiple selections)

No frontend or parser changes were needed - only prompt updates.

---

## How It Works

```
AI receives question request
         ↓
AI analyzes: "Is this question about something exclusive?"
         ↓
    ┌────┴────┐
    Yes       No
    ↓         ↓
Use ○      Use ☐
(radio)    (checkbox)
         ↓
Response includes appropriate symbol
         ↓
Backend parser detects symbol type
         ↓
Frontend renders correct input type
         ↓
User sees radiobox or checkbox
```

---

## Testing Scenarios

### Questions that should use Single Choice (○):
- "Qual arquitetura você pretende usar?"
- "Qual será o banco de dados principal?"
- "Qual o prazo esperado para o MVP?"
- "Quem é o usuário principal do sistema?"
- "Qual a linguagem de programação principal?"

### Questions that should use Multiple Choice (☐):
- "Quais integrações são necessárias?"
- "Quais funcionalidades são prioritárias?"
- "Quais relatórios o sistema deve gerar?"
- "Quais métodos de pagamento serão aceitos?"
- "Quais perfis de usuário terão acesso?"

---

## Key Instructions Added to Prompts

```yaml
## TIPO DE RESPOSTA - ANALISE ANTES DE ESCOLHER

Antes de formular a pergunta, analise se as opcoes sao
MUTUAMENTE EXCLUSIVAS ou se o usuario pode SELECIONAR VARIAS:

### Use ○ (SELECAO UNICA - radiobox) quando:
- Apenas UMA opcao pode ser verdadeira
- As opcoes sao mutuamente exclusivas

### Use ☐ (SELECAO MULTIPLA - checkbox) quando:
- O usuario pode escolher VARIAS opcoes
- As opcoes nao sao mutuamente exclusivas
```

---

## Status: COMPLETE

**Key Achievements:**
- Updated 4 interview prompt YAML files with smart choice logic
- AI now analyzes each question to determine appropriate input type
- Clear rules and examples for single vs multiple choice
- No frontend or backend code changes needed

**Impact:**
- Better UX for questions that allow multiple answers
- More accurate data collection during interviews
- Reduced user frustration when wanting to select multiple options
