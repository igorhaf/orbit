"""
Subtask-Focused Interview Questions - PROMPT #94 FASE 2
Sistema de entrevistas para geração de subtasks atômicas

Este modo não possui perguntas fixas - vai direto para IA contextual.
A IA decide quantas perguntas fazer (sem limite fixo, apenas bom senso).

Output: Subtasks atômicas (prompts super rápidos, 1 ação = 1 subtask)

Exemplo de subtask atômica:
- "Criar tabela users no banco"
- "Adicionar coluna email na tabela users"
- "Criar endpoint POST /users"
- "Adicionar validação de email"
"""

from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from app.models.project import Project
from app.models.task import Task


def get_subtask_focused_fixed_question(
    question_number: int,
    project: Project,
    db: Session,
    previous_answers: Dict[str, Any],
    parent_task: Optional[Task] = None
) -> Optional[Dict[str, Any]]:
    """
    Get fixed question for subtask_focused interview.

    PROMPT #94 - Subtask-focused mode has NO fixed questions!
    Goes directly to AI contextual questions.

    Args:
        question_number: Current question number (always 1 for first call)
        project: Project instance
        db: Database session
        previous_answers: Dict of previous answers
        parent_task: Parent task for context (if creating subtasks for existing task)

    Returns:
        None - No fixed questions, go directly to AI
    """
    # No fixed questions in subtask_focused mode
    # AI starts immediately at Q1
    return None


def count_fixed_questions_subtask_focused(
    project: Project,
    previous_answers: Dict[str, Any]
) -> int:
    """
    Count total fixed questions for subtask_focused interview.

    PROMPT #94 - Subtask-focused has 0 fixed questions.

    Args:
        project: Project instance
        previous_answers: Dict of previous answers

    Returns:
        0 - No fixed questions
    """
    return 0


def is_fixed_question_complete_subtask_focused(
    conversation_data: list,
    project: Project
) -> bool:
    """
    Check if fixed questions phase is complete.

    PROMPT #94 - Since there are no fixed questions, always returns True.
    AI phase starts immediately at Q1.

    Args:
        conversation_data: List of conversation messages
        project: Project instance

    Returns:
        True - Always complete (no fixed questions)
    """
    # No fixed questions, so always "complete"
    # AI contextual questions start at Q1
    return True


def build_subtask_focused_prompt(
    project: Project,
    parent_task: Optional[Task],
    message_count: int,
    previous_answers: Dict[str, Any]
) -> str:
    """
    Build AI prompt for subtask_focused interviews.

    PROMPT #94 FASE 2 - Subtask-focused interview system:
    - IA decide quantas perguntas fazer (sem limite fixo)
    - Foco em gerar subtasks ATÔMICAS (1 ação = 1 prompt super rápido)
    - Contexto: Task pai + especificação atômica

    Args:
        project: Project instance
        parent_task: Parent task (if creating subtasks for existing task)
        message_count: Current message count
        previous_answers: Dict of previous answers

    Returns:
        System prompt string for AI
    """
    question_num = (message_count // 2) + 1

    # Build project context
    project_context = f"""
INFORMAÇÕES DO PROJETO:
- Nome: {project.name}
- Descrição: {project.description}
"""

    # Add stack context if available
    stack_info = []
    if project.stack_backend:
        stack_info.append(f"- Backend: {project.stack_backend}")
    if project.stack_database:
        stack_info.append(f"- Database: {project.stack_database}")
    if project.stack_frontend:
        stack_info.append(f"- Frontend: {project.stack_frontend}")
    if project.stack_css:
        stack_info.append(f"- CSS: {project.stack_css}")
    if project.stack_mobile:
        stack_info.append(f"- Mobile: {project.stack_mobile}")

    if stack_info:
        project_context += "\n" + "\n".join(stack_info) + "\n"

    # Add parent task context if available
    parent_task_context = ""
    if parent_task:
        parent_task_context = f"""

PARENT TASK (CONTEXT):
- Title: {parent_task.title}
- Description: {parent_task.description or "Not specified"}
- Type: {parent_task.task_type or "task"}

You are creating ATOMIC SUBTASKS to decompose this parent task.
"""

    return f"""{project_context}{parent_task_context}

**MODE: SUBTASK FOCUSED - Atomic Subtask Generation 🔬**

**CRITICAL OBJECTIVE:** Generate ATOMIC subtasks - each subtask = 1 executable action = 1 super fast prompt

**WHAT IS AN ATOMIC SUBTASK:**
✅ **GOOD (Atomic):**
- "Create users table in database"
- "Add email (string) column to users table"
- "Create POST /api/users endpoint"
- "Add email validation to request"
- "Create unit test for UserController::store"

❌ **BAD (Not atomic):**
- "Implement user CRUD" (too broad, needs decomposition)
- "Do authentication and authorization" (2 actions, should be 2 subtasks)
- "Create database and endpoints" (2 actions, should be 2 subtasks)

**CRITICAL RULES:**
1. **1 Subtask = 1 Action = 1 Executable Prompt**
   - If you think "and also needs...", STOP! That's another subtask!
   - Each subtask should be executable in minutes, not hours

2. **AI Decides How Many Questions (No Fixed Limit)**
   - Use common sense: 3-10 questions is usually enough
   - Stop when you have enough context to generate atomic subtasks
   - If user answers completely, fewer questions are needed

3. **Focus on Maximum Decomposition**
   - Ask about SPECIFIC PARTS of the task
   - Identify dependencies between subtasks
   - Break complexity into simple actions

4. **Atomicity Criteria:**
   - ✅ Can be described in 1 short sentence (< 10 words)?
   - ✅ Executes in < 30 minutes?
   - ✅ Has 1 file/component as main focus?
   - ✅ Doesn't use "and" or "also" in description?
   - If NO to any, decompose more!

**QUESTION FORMAT:**
❓ Pergunta {question_num}: [Your question focused on ATOMIC DECOMPOSITION in Portuguese]

For SINGLE CHOICE:
○ Option 1
○ Option 2
○ Option 3

For MULTIPLE CHOICE:
☐ Option 1
☐ Option 2
☐ Option 3
☑️ [Select all that apply]

**FOCUS AREAS (use as guide, don't ask everything):**
1. **Specific Scope**: What EXACT part of the task? (database/API/UI/logic/validation)
2. **Granularity**: More detail? (e.g.: "create endpoint" → separate GET/POST/PUT/DELETE)
3. **Dependencies**: What must be done BEFORE? (e.g.: migration before model)
4. **Sequence**: What order makes sense? (database → backend → frontend)
5. **Edge Cases**: Validations? Errors? Special cases? (each one = 1 subtask)
6. **Tests**: Unit/integration tests? (each type = 1 subtask)

**ATOMIC DECOMPOSITION EXAMPLE:**

Parent Task: "Implement user registration"

Generated Atomic Subtasks (8 subtasks):
1. Create users table migration (id, name, email, password, timestamps)
2. Create User model with fillable and hidden fields
3. Create UserRequest with email and password validation
4. Create POST /api/users endpoint in routes/api.php
5. Implement UserController::store with password hash
6. Create unit test for duplicate email validation
7. Create integration test for POST /api/users
8. Add success message on frontend after registration

**Your mission:** Ask smart questions to generate subtasks with this level of atomicity!

**OUTPUT LANGUAGE: Portuguese (Brazilian).** Continue with the next question focused on ATOMIC DECOMPOSITION!
"""
