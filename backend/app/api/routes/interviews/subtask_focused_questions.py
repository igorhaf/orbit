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

TAREFA PAI (CONTEXTO):
- Título: {parent_task.title}
- Descrição: {parent_task.description or "Não especificada"}
- Tipo: {parent_task.task_type or "task"}

Você está criando SUBTASKS ATÔMICAS para decompor esta tarefa pai.
"""

    return f"""{project_context}{parent_task_context}

**MODO: SUBTASK FOCUSED - Geração de Subtasks Atômicas 🔬**

**OBJETIVO CRÍTICO:** Gerar subtasks ATÔMICAS - cada subtask = 1 ação executável = 1 prompt super rápido

**O QUE É UMA SUBTASK ATÔMICA:**
✅ **BOM (Atômico):**
- "Criar tabela users no banco de dados"
- "Adicionar coluna email (string) na tabela users"
- "Criar endpoint POST /api/users"
- "Adicionar validação de email no request"
- "Criar teste unitário para UserController::store"

❌ **RUIM (Não atômico):**
- "Implementar CRUD de usuários" (muito amplo, precisa ser decomposto)
- "Fazer autenticação e autorização" (2 ações, deveria ser 2 subtasks)
- "Criar banco e endpoints" (2 ações, deveria ser 2 subtasks)

**REGRAS CRÍTICAS:**
1. **1 Subtask = 1 Ação = 1 Prompt Executável**
   - Se você pensar "e também precisa...", PARE! É outra subtask!
   - Cada subtask deve ser executável em minutos, não horas

2. **IA Decide Quantas Perguntas (Sem Limite Fixo)**
   - Use bom senso: 3-10 perguntas geralmente é suficiente
   - Pare quando tiver contexto suficiente para gerar subtasks atômicas
   - Se usuário responde de forma completa, menos perguntas são necessárias

3. **Foque em Decomposição Máxima**
   - Pergunte sobre PARTES ESPECÍFICAS da tarefa
   - Identifique dependências entre subtasks
   - Quebre complexidade em ações simples

4. **Critérios de Atomicidade:**
   - ✅ Pode ser descrita em 1 frase curta (< 10 palavras)?
   - ✅ Executa em < 30 minutos?
   - ✅ Tem 1 arquivo/componente como foco principal?
   - ✅ Não usa "e" ou "também" na descrição?
   - Se NÃO para qualquer um, decomponha mais!

**FORMATO DE PERGUNTA:**
❓ Pergunta {question_num}: [Sua pergunta focada em DECOMPOSIÇÃO ATÔMICA]

Para ESCOLHA ÚNICA:
○ Opção 1
○ Opção 2
○ Opção 3

Para MÚLTIPLA ESCOLHA:
☐ Opção 1
☐ Opção 2
☐ Opção 3
☑️ [Selecione todas que se aplicam]

**ÁREAS DE FOCO (use como guia, não pergunte tudo):**
1. **Escopo Específico**: Qual parte EXATA da tarefa? (banco/API/UI/lógica/validação)
2. **Granularidade**: Detalhar mais? (ex: "criar endpoint" → GET/POST/PUT/DELETE separados)
3. **Dependências**: O que deve ser feito ANTES? (ex: migração antes de model)
4. **Sequência**: Qual ordem faz sentido? (banco → backend → frontend)
5. **Edge Cases**: Validações? Erros? Casos especiais? (cada um = 1 subtask)
6. **Testes**: Testes unitários/integração? (cada tipo = 1 subtask)

**EXEMPLO DE DECOMPOSIÇÃO ATÔMICA:**

Tarefa Pai: "Implementar cadastro de usuários"

Subtasks Atômicas Geradas (8 subtasks):
1. Criar migration da tabela users (id, name, email, password, timestamps)
2. Criar model User com fillable e hidden fields
3. Criar UserRequest com validação de email e senha
4. Criar endpoint POST /api/users no routes/api.php
5. Implementar UserController::store com hash de senha
6. Criar teste unitário para validação de email duplicado
7. Criar teste de integração para POST /api/users
8. Adicionar mensagem de sucesso no frontend após cadastro

**Sua missão:** Fazer perguntas inteligentes para gerar subtasks com este nível de atomicidade!

Continue com a próxima pergunta focada em DECOMPOSIÇÃO ATÔMICA!
"""
