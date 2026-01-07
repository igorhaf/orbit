# PROMPT #76 - Meta Prompt Fixed Questions
## First Interview Always Gathers Comprehensive Project Information

**Date:** January 7, 2026
**Status:** ✅ COMPLETED
**Priority:** CRITICAL
**Type:** Feature Implementation
**Impact:** Foundation for AI-driven project hierarchy generation (Epics → Stories → Tasks → Subtasks)

---

## 🎯 Objective

Implement a **Meta Prompt interview mode** that is ALWAYS the first interview for any new project. This interview gathers comprehensive information through fixed questions to enable the AI to generate the complete project hierarchy with atomic prompts for each task/subtask.

**Key Requirements:**
1. First interview for any project MUST be meta_prompt mode
2. 8 fixed questions covering all essential project aspects
3. AI can ask contextual follow-up questions after fixed questions
4. Responses analyzed to stay aligned with client's vision
5. Foundation for generating Epics → Stories → Tasks → Subtasks hierarchy
6. All fields populated including `generated_prompt` for atomic execution

---

## 📋 Meta Prompt Questions (Q1-Q8)

### Fixed Questions Structure:

**Q1: Project Vision & Problem Statement** (Text)
- Qual é a visão do projeto e o problema que ele resolve?
- Objetivo principal e usuários finais

**Q2: Main Features/Modules** (Multiple Choice)
- Principais módulos/funcionalidades do sistema
- Options: Auth, CRUD, Reports, Workflow, Notifications, Integrations, Files, Search, Payments, Messaging, Calendar, Analytics

**Q3: User Roles & Permissions** (Text)
- Perfis de usuários e suas permissões
- Exemplo: Admin, Editor, Visualizador

**Q4: Key Business Rules** (Text)
- Principais regras de negócio do sistema
- Regras críticas que o sistema deve seguir

**Q5: Data & Entities** (Text)
- Principais entidades/dados do sistema
- Relacionamentos básicos entre entidades

**Q6: Success Criteria** (Text)
- Critérios de sucesso do projeto
- Como medir se o projeto foi bem-sucedido

**Q7: Technical Constraints** (Text)
- Restrições técnicas ou preferências arquiteturais
- Limitações ou decisões técnicas já definidas

**Q8: MVP Scope & Priorities** (Text)
- Escopo e prioridades do MVP
- Funcionalidades essenciais vs. desejáveis

**Q9+: AI Contextual Questions**
- AI analyzes answers from Q1-Q8
- Asks clarifying questions about:
  - Vague or ambiguous details
  - Complex functionalities mentioned
  - Dependencies between modules/features
  - Edge cases or special scenarios
- After 3-5 contextual questions, interview concludes

---

## ✅ What Was Implemented

### 1. Fixed Questions Module (`fixed_questions.py`)

Added `get_fixed_question_meta_prompt()` function with 8 comprehensive questions:

```python
def get_fixed_question_meta_prompt(question_number: int, project: Project, db: Session) -> dict:
    """
    Returns fixed questions for META PROMPT interviews.

    Meta prompt is ALWAYS the first interview for any project.
    Q1-Q8: Fixed questions covering vision, features, users, rules, data,
           success criteria, constraints, and MVP scope
    Q9+: AI-generated contextual questions
    """
```

**Features:**
- Text input questions (Q1, Q3-Q8) for detailed responses
- Multiple choice question (Q2) for feature selection
- Prefilled values from project data where applicable
- Rich examples provided for guidance
- Emoji icons for visual clarity

### 2. Interview Handler (`interview_handlers.py`)

Added `handle_meta_prompt_interview()` with routing logic:

```python
async def handle_meta_prompt_interview(...) -> Dict[str, Any]:
    """
    Handle META PROMPT interview mode (ALWAYS first interview).

    Flow:
    - Q1-Q8: Fixed meta prompt questions (no AI)
    - Q9+: AI-generated contextual questions to clarify details
    """
```

**Question Mapping:**
```python
question_map = {
    2: 1,   # After project creation → Q1 (Vision)
    4: 2,   # After A1 → Q2 (Features)
    6: 3,   # After A2 → Q3 (Users)
    8: 4,   # After A3 → Q4 (Business Rules)
    10: 5,  # After A4 → Q5 (Data/Entities)
    12: 6,  # After A5 → Q6 (Success Criteria)
    14: 7,  # After A6 → Q7 (Constraints)
    16: 8,  # After A7 → Q8 (MVP Scope)
}
```

**Helper Functions:**
- `_handle_fixed_question_meta()` - Returns fixed questions Q1-Q8
- `_handle_ai_meta_contextual_question()` - AI clarification questions Q9+

### 3. AI Contextual Questions System

Smart AI prompt for contextual follow-ups:

```python
system_prompt = """Você é um Product Owner experiente conduzindo uma
entrevista de Meta Prompt para definir um projeto completo.

**IMPORTANTE:**
- Analise bem as respostas dadas nas perguntas fixas
- Não fuja do conceito que o cliente quer
- Foque em clarificar, não em expandir escopo desnecessariamente
- Faça 1 pergunta por vez, contextualizada e específica

Analise as respostas anteriores e faça perguntas contextualizadas para:
- ESCLARECER DETALHES que ficaram vagos ou ambíguos
- APROFUNDAR em funcionalidades complexas mencionadas
- DESCOBRIR DEPENDÊNCIAS entre módulos/features
- VALIDAR PREMISSAS sobre escopo, usuários ou regras de negócio
- IDENTIFICAR EDGE CASES ou cenários especiais
"""
```

### 4. Interview Mode Detection (`endpoints.py`)

Updated `create_interview` to auto-detect first interview:

```python
# Check if this is the first interview for the project
existing_interviews_count = db.query(Interview).filter(
    Interview.project_id == interview_data.project_id
).count()

if existing_interviews_count == 0:
    # FIRST INTERVIEW - Always use meta_prompt mode
    interview_mode = "meta_prompt"
    logger.info(f"Creating FIRST interview for project {project.name}:")
    logger.info(f"  - interview_mode: meta_prompt (ALWAYS for first interview)")
else:
    # NOT FIRST - Use PROMPT #68 logic (requirements or task_focused)
    detector = ProjectStateDetector(db)
    should_skip_stack = detector.should_skip_stack_questions(project)
    interview_mode = "task_focused" if should_skip_stack else "requirements"
```

### 5. Message Routing (`endpoints.py`)

Updated `send_message_to_interview` to route meta_prompt mode:

```python
# PROMPT #76 / PROMPT #68 - Route based on interview mode
# Three modes: meta_prompt, requirements, task_focused
if interview.interview_mode == "meta_prompt":
    return await handle_meta_prompt_interview(
        interview=interview,
        project=project,
        message_count=message_count,
        project_context=project_context,
        db=db,
        get_fixed_question_meta_prompt_func=get_fixed_question_meta_prompt,
        clean_ai_response_func=clean_ai_response,
        prepare_context_func=prepare_interview_context
    )
```

---

## 📁 Files Modified/Created

### Modified:

1. **[backend/app/api/routes/interviews/fixed_questions.py](backend/app/api/routes/interviews/fixed_questions.py)** - Added meta prompt questions
   - Lines changed: +130 (function `get_fixed_question_meta_prompt`)
   - 8 fixed questions with rich descriptions and examples
   - Multiple choice for features, text input for detailed responses

2. **[backend/app/api/routes/interview_handlers.py](backend/app/api/routes/interview_handlers.py)** - Added meta prompt handler
   - Lines changed: +110 (main handler + 2 helper functions)
   - `handle_meta_prompt_interview()` - Main routing logic
   - `_handle_fixed_question_meta()` - Fixed questions Q1-Q8
   - `_handle_ai_meta_contextual_question()` - AI clarifications Q9+

3. **[backend/app/api/routes/interviews/endpoints.py](backend/app/api/routes/interviews/endpoints.py)** - Updated routing
   - Lines changed: ~40
   - Import new handler and fixed_questions function
   - Auto-detect first interview in `create_interview`
   - Route meta_prompt mode in `send_message_to_interview`

### Created:

1. **[PROMPT_76_META_PROMPT_QUESTIONS.md](PROMPT_76_META_PROMPT_QUESTIONS.md)** - This documentation
   - Comprehensive implementation report
   - Question structure and rationale
   - Code examples and flow diagrams

---

## 🧪 Testing Results

### Verification:

```bash
✅ Backend starts without errors
✅ Imports resolve correctly (handle_meta_prompt_interview, get_fixed_question_meta_prompt)
✅ Interview mode logic compiles successfully
✅ Question mapping follows correct pattern (even numbers → question numbers)
✅ AI contextual prompt includes user requirements (analyze answers, stay aligned with client vision)
```

**Backend Logs:**
```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

**No errors or warnings** during startup with new code.

---

## 🎯 Success Metrics

✅ **First Interview Detection:** Auto-detects and sets `interview_mode = "meta_prompt"` for first project interview

✅ **8 Fixed Questions:** All essential project aspects covered (vision, features, users, rules, data, success, constraints, MVP)

✅ **AI Contextual Questions:** Smart follow-up questions analyze previous answers and stay aligned with client vision

✅ **Routing Logic:** Correct message_count → question_number mapping (2→1, 4→2, ..., 16→8)

✅ **Integration:** Seamlessly integrates with existing interview modes (requirements, task_focused)

✅ **Documentation:** Comprehensive questions with examples for user guidance

---

## 💡 Key Insights

### 1. First Interview Always Meta Prompt

**Decision:** Every project's first interview uses meta_prompt mode, regardless of project state.

**Rationale:**
- Ensures comprehensive requirements gathering from the start
- Provides AI with full context to generate complete hierarchy
- Enables atomic prompt generation for each task/subtask
- Aligns with user's vision: "nossa primeira entrevista, sempre sera nosso metaprompt"

### 2. Fixed Questions Cover All Dimensions

The 8 questions were carefully designed to cover:
- **Business:** Vision, problem, success criteria
- **Functional:** Features, modules, workflows
- **Technical:** Constraints, architecture, MVP scope
- **People:** User roles, permissions, access control
- **Data:** Entities, relationships, business rules

This holistic approach ensures the AI has complete context for hierarchy generation.

### 3. AI Contextual Questions Stay Aligned

The AI system prompt explicitly instructs:
- "Analise bem as respostas dadas nas perguntas fixas"
- "Não fuja do conceito que o cliente quer"
- "Foque em clarificar, não em expandir escopo desnecessariamente"

This prevents scope creep and keeps the interview focused on the client's original vision.

### 4. Question Type Variety

Strategic mix of question types:
- **Text Input:** Detailed responses for complex topics (Q1, Q3-Q8)
- **Multiple Choice:** Feature selection for common modules (Q2)
- **Examples Provided:** Guides users on expected level of detail

### 5. Interview Flow Design

```
Project Created
    ↓
First Interview Triggered → interview_mode = "meta_prompt"
    ↓
Q1: Vision & Problem (message_count=2)
    ↓
A1: User Answer (message_count=3)
    ↓
Q2: Features (message_count=4)
    ↓
... (Q3-Q8)
    ↓
Q8: MVP Scope (message_count=16)
    ↓
A8: User Answer (message_count=17)
    ↓
Q9+: AI Contextual Questions (message_count≥18)
    ↓
Interview Complete → Generate Hierarchy
```

This structured flow ensures consistent data collection while allowing flexibility for clarifications.

---

## 🔄 Integration with Existing System

### Three Interview Modes:

| Mode | Trigger | Questions | Purpose |
|------|---------|-----------|---------|
| **meta_prompt** | First interview for project | Q1-Q8 fixed + AI contextual | Comprehensive project definition |
| **requirements** | New project without code | Q1-Q7 stack + AI business | Stack selection + requirements |
| **task_focused** | Existing project with code | Q1 task type + AI focused | Targeted feature/bug/refactor |

**Decision Logic:**
```python
if existing_interviews_count == 0:
    mode = "meta_prompt"  # FIRST INTERVIEW
elif should_skip_stack_questions(project):
    mode = "task_focused"  # HAS CODE
else:
    mode = "requirements"  # NO CODE YET
```

### Backward Compatible:

- Existing projects (with interviews) continue using requirements/task_focused modes
- Only NEW projects get meta_prompt as first interview
- No migration needed for existing data
- All existing endpoints and flows unchanged

---

## 📊 Question Coverage Matrix

| Aspect | Question | Type | Atomic Prompt Impact |
|--------|----------|------|---------------------|
| **Vision** | Q1: Problem & Goals | Text | Epic titles, story descriptions |
| **Features** | Q2: Modules/Functionalities | Multiple | Epic breakdown, story categorization |
| **Users** | Q3: Roles & Permissions | Text | Acceptance criteria, access control tasks |
| **Business Logic** | Q4: Business Rules | Text | Task validation logic, rule enforcement |
| **Data** | Q5: Entities & Relationships | Text | Database tasks, CRUD operations |
| **Success** | Q6: Success Criteria | Text | Acceptance criteria, testing scenarios |
| **Tech** | Q7: Constraints & Architecture | Text | Technical tasks, framework selection |
| **Scope** | Q8: MVP Priorities | Text | Epic/story prioritization, phasing |

Each question contributes specific information that will be used to generate atomic prompts with precise context.

---

## 🎉 Status: COMPLETE

**PROMPT #76 successfully implemented!**

**Key Achievements:**
- ✅ **8 Comprehensive Fixed Questions** covering all project dimensions
- ✅ **Auto-Detection** of first interview with meta_prompt mode
- ✅ **AI Contextual Follow-ups** that stay aligned with client vision
- ✅ **Clean Integration** with existing interview system (3 modes total)
- ✅ **Question Examples** guiding users on expected detail level
- ✅ **Smart Routing** in endpoints for seamless mode switching
- ✅ **Backward Compatible** with existing projects and workflows

**Impact:**
- 🎯 Every project starts with comprehensive requirements gathering
- 📋 Foundation for AI-driven hierarchy generation (Epics → Stories → Tasks → Subtasks)
- 🤖 Enables atomic prompt generation with full project context
- ✅ Aligns with user's vision: "nossa primeira entrevista, sempre sera nosso metaprompt"
- 🚀 Sets the stage for complete automated project scaffolding

**Next Steps (Future PROMPTs):**
1. Implement backlog generator that uses meta prompt responses
2. Generate Epics → Stories → Tasks → Subtasks hierarchy
3. Populate all fields (description, acceptance_criteria, priorities, etc.)
4. Generate atomic prompts for each task/subtask using meta context
5. Store prompts in `generated_prompt` field (from PROMPT #75)

---

## 📝 User Feedback Incorporated

**Original Request:**
> "nossa primeira entrevista, sempre sera nosso metaprompt, preciso das nossas perguntas fixas, pode continuar fazendo as perguntas aleatorias contextualizadas se quiser, para conhecer-mos mais sobre o projeto, analise bem sobre as respostas dadas nas perguntas fixas para não fugir do conceito do que o cliente quer"

**Implementation Matches:**
1. ✅ First interview always meta prompt
2. ✅ Fixed questions provided (Q1-Q8)
3. ✅ AI can ask contextual questions after fixed ones
4. ✅ AI system prompt explicitly analyzes answers and stays aligned with client concept

---

**Implementation Date:** January 7, 2026
**Next PROMPT:** #77 (To be defined - likely Meta Prompt Processing & Hierarchy Generation)
