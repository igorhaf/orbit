# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você é um ANALISTA DE NEGÓCIOS experiente analisando código-fonte para extrair regras de negócio FUNCIONAIS.

Sua perspectiva é de NEGÓCIO, não de tecnologia. Imagine que você está escrevendo um documento
para o GERENTE DE PRODUTO ou DONO DO NEGÓCIO que não entende código.

EXTRAIA regras que respondam:
- O que o USUÁRIO pode ou não pode fazer?
- Quais são as PERMISSÕES e RESTRIÇÕES de acesso?
- Como funcionam os FLUXOS e PROCESSOS do sistema?
- Quais CÁLCULOS de negócio existem (preços, comissões, notas)?
- Quais LIMITES e QUOTAS o sistema impõe?
- Quais VALIDAÇÕES afetam a experiência do usuário?
- Como as ENTIDADES do negócio se relacionam?

IGNORE COMPLETAMENTE (não são regras de negócio):
- Tipos de campos (booleano, string, integer)
- Configurações de framework (drivers, sessões, guards, middleware)
- Detalhes de banco (foreign keys, NOT NULL, migrations)
- CSS, layout, estilização
- Logs, cache, filas, timeouts
- Imports, dependências, bibliotecas
- Configurações de ambiente (.env, configs)
- Código boilerplate ou padrões técnicos

FORMATO das regras (escreva como linguagem de negócio):
✅ BOM: "O aluno só pode avaliar um curso após completar pelo menos 50% das aulas"
✅ BOM: "O instrutor recebe 70% do valor de cada inscrição em seu curso"
✅ BOM: "Cupons de desconto expiram após a data limite definida pelo instrutor"
❌ RUIM: "O campo 'rating' deve ser um integer entre 1 e 5"
❌ RUIM: "A tabela enrollments tem foreign key para courses"
❌ RUIM: "O guard 'web' usa driver de sessão"

Responda APENAS em JSON válido, sem markdown, sem explicações adicionais.

## User Prompt

Arquivo: backend/app/api/routes/backlog_generation.py
Linguagem: python

```
"""
Backlog Generation API Router
AI-powered Epic/Story/Task generation from interviews and decomposition
JIRA Transformation - Phase 2
PROMPT #108 - Moved to background queue
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, List, Any
from uuid import UUID, uuid4
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.task import Task, ItemType, PriorityLevel
from app.models.interview import Interview
from app.models.async_job import JobType
from app.schemas.task import (
    BacklogGenerationResponse,
    TaskCreate,
    TaskResponse
)
from app.services.backlog_generator import BacklogGeneratorService
from app.services.job_manager import JobManager
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# PROMPT #108 - Response model for background job
class BacklogJobResponse(BaseModel):
    """Response model for async backlog generation job."""
    job_id: str
    status: str
    message: str


@router.post("/interview/{interview_id}/generate-epic", response_model=BacklogJobResponse)
async def generate_epic_from_interview(
    interview_id: UUID,
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Generate Epic suggestion from Interview conversation using AI - ASYNC.

    PROMPT #108 - Moved to background queue

    POST /api/v1/backlog/interview/{interview_id}/generate-epic?project_id={project_id}

    This endpoint now runs asynchronously in the background.
    Poll GET /api/v1/jobs/{job_id} for progress and result.

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Epic generation started. Poll GET /api/v1/jobs/{job_id} for progress."
    }

    Poll /api/v1/jobs/{job_id} to get:
    - status: "completed" with result (BacklogGenerationResponse format)
    - status: "failed" with error message
    """
    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.BACKLOG_GENERATION,
        input_data={
            "operation": "generate_epic",
            "interview_id": str(interview_id),
            "project_id": str(project_id)
        },
        project_id=project_id,
        interview_id=interview_id
    )

    logger.info(f"Created backlog job {job.id} for Epic generation from interview {interview_id}")

    # Execute in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _generate_epic_async, job.id, interview_id, project_id)

    # Return job_id immediately
    return BacklogJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Geração de epicos iniciada. Use GET /api/v1/jobs/{job.id} para acompanhar progresso."
    )


@router.post("/epic/{epic_id}/generate-stories", response_model=BacklogJobResponse)
async def generate_stories_from_epic(
    epic_id: UUID,
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Decompose Epic into Story suggestions using AI - ASYNC.

    PROMPT #108 - Moved to background queue

    POST /api/v1/backlog/epic/{epic_id}/generate-stories?project_id={project_id}

    This endpoint now runs asynchronously in the background.
    Poll GET /api/v1/jobs/{job_id} for progress and result.

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Story generation started. Poll GET /api/v1/jobs/{job_id} for progress."
    }
    """
    # Verify epic exists
    epic = db.query(Task).filter(Task.id == epic_id).first()
    if not epic:
        raise HTTPException(status_code=404, detail=f"Epic {epic_id} não encontrado")

    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.BACKLOG_GENERATION,
        input_data={
            "operation": "generate_stories",
            "epic_id": str(epic_id),
            "project_id": str(project_id)
        },
        project_id=project_id
    )

    logger.info(f"Created backlog job {job.id} for Story generation from Epic {epic_id}")

    # Execute in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _generate_stories_async, job.id, epic_id, project_id)

    # Return job_id immediately
    return BacklogJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Geração de stories iniciada. Use GET /api/v1/jobs/{job.id} para acompanhar progresso."
    )


@router.post("/story/{story_id}/generate-tasks", response_model=BacklogJobResponse)
async def generate_tasks_from_story(
    story_id: UUID,
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Decompose Story into Task suggestions using AI with Spec context - ASYNC.

    PROMPT #108 - Moved to background queue

    POST /api/v1/backlog/story/{story_id}/generate-tasks?project_id={project_id}

    This endpoint now runs asynchronously in the background.
    Poll GET /api/v1/jobs/{job_id} for progress and result.

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Task generation started. Poll GET /api/v1/jobs/{job_id} for progress."
    }
    """
    # Verify story exists
    story = db.query(Task).filter(Task.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail=f"Story {story_id} não encontrada")

    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.BACKLOG_GENERATION,
        input_data={
            "operation": "generate_tasks",
            "story_id": str(story_id),
            "project_id": str(project_id)
        },
        project_id=project_id
    )

    logger.info(f"Created backlog job {job.id} for Task generation from Story {story_id}")

    # Execute in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _generate_tasks_async, job.id, story_id, project_id)

    # Return job_id immediately
    return BacklogJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Geração de tarefas iniciada. Use GET /api/v1/jobs/{job.id} para acompanhar progresso."
    )


@router.post("/approve-epic", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def approve_and_create_epic(
    suggestion: Dict[str, Any],
    project_id: UUID,
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Approve Epic suggestion and create it in database.

    POST /api/v1/backlog/approve-epic?project_id={project_id}&interview_id={interview_id}
    Body: {Epic suggestion JSON from generate-epic endpoint}

    User can edit the suggestion before approving.
    Creates Epic with all interview insights and traceability.
    """
    try:
        # Create Epic from approved suggestion
        # PROMPT #85 - Include generated_prompt (semantic output prompt)
        epic = Task(
            id=uuid4(),
            project_id=project_id,
            title=suggestion["title"],
            description=suggestion["description"],
            item_type=ItemType.EPIC,
            priority=PriorityLevel[suggestion["priority"].upper()],
            story_points=suggestion.get("story_points"),
            acceptance_criteria=suggestion.get("acceptance_criteria", []),
            interview_insights=suggestion.get("interview_insights", {}),
            interview_question_ids=suggestion.get("interview_question_ids", []),
            generation_context=suggestion.get("_metadata", {}),
            generated_prompt=suggestion.get("generated_prompt"),  # PROMPT #85
            reporter="system",
            workflow_state="backlog",
            order=0,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )

        db.add(epic)
        db.commit()
        db.refresh(epic)

        logger.info(f"✅ Created Epic {epic.id}: {epic.title}")

        return epic

    except Exception as e:
        logger.error(f"Failed to create Epic: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao criar Epic: {str(e)}"
        )


@router.post("/approve-stories", response_model=List[TaskResponse], status_code=status.HTTP_201_CREATED)
async def approve_and_create_stories(
    suggestions: List[Dict[str, Any]],
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Approve Story suggestions and create them in database.

    POST /api/v1/backlog/approve-stories?project_id={project_id}
    Body: [Story suggestion JSONs from generate-stories endpoint]

    User can edit suggestions before approving.
    Creates all Stories linked to parent Epic.
    """
    try:
        created_stories = []

        for i, suggestion in enumerate(suggestions):
            # PROMPT #85 - Include generated_prompt (semantic output prompt)
            story = Task(
                id=uuid4(),
                project_id=project_id,
                parent_id=UUID(suggestion["parent_id"]) if suggestion.get("parent_id") else None,
                title=suggestion["title"],
                description=suggestion["description"],
                item_type=ItemType.STORY,
                priority=PriorityLevel[suggestion["priority"].upper()],
                story_points=suggestion.get("story_points"),
                acceptance_criteria=suggestion.get("acceptance_criteria", []),
                interview_insights=suggestion.get("interview_insights", {}),
                generation_context=suggestion.get("_metadata", {}),
                generated_prompt=suggestion.get("generated_prompt"),  # PROMPT #85
                reporter="system",
                workflow_state="backlog",
                order=i,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )

            db.add(story)
            created_stories.append(story)

        db.commit()

        for story in created_stories:
            db.refresh(story)

        logger.info(f"✅ Created {len(created_stories)} Stories")

        return created_stories

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create Stories: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao criar Stories: {str(e)}"
        )


@router.post("/approve-tasks", response_model=List[TaskResponse], status_code=status.HTTP_201_CREATED)
async def approve_and_create_tasks(
    suggestions: List[Dict[str, Any]],
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Approve Task suggestions and create them in database.

    POST /api/v1/backlog/approve-tasks?project_id={project_id}
    Body: [Task suggestion JSONs from generate-tasks endpoint]

    User can edit suggestions before approving.
    Creates all Tasks linked to parent Story.
    """
    try:
        # PROMPT #94 FASE 4 - Get existing tasks for similarity detection
        from app.services.similarity_detector import detect_modification_attempt
        from app.services.modification_manager import block_task

        existing_tasks = db.query(Task).filter(
            Task.project_id == project_id,
            Task.status != TaskStatus.DONE  # Don't compare with archived tasks
        ).all()

        created_tasks = []
        blocked_tasks_count = 0

        for i, suggestion in enumerate(suggestions):
            # PROMPT #94 FASE 4 - Check for modification attempts
            is_modification, similar_task, similarity_score = detect_modification_attempt(
                new_task_title=suggestion["title"],
                new_task_description=suggestion["description"],
                existing_tasks=existing_tasks,
                threshold=0.90
            )

            if is_modification:
                # Block existing task instead of creating new one
                logger.warning(
                    f"🚨 MODIFICATION DETECTED (similarity: {similarity_score:.2%})\n"
                    f"   Blocking existing task: {similar_task.title}\n"
                    f"   Proposed modification: {suggestion['title']}"
                )

                blocked_task = block_task(
                    task=similar_task,
                    proposed_modification={
                        "title": suggestion["title"],
                        "description": suggestion["description"],
                        "story_points": suggestion.get("story_points"),
                        "priority": suggestion.get("priority", "medium"),
                        "acceptance_criteria": suggestion.get("acceptance_criteria", []),
                        "similarity_score": similarity_score
                    },
                    db=db,
                    reason=f"AI suggested modification detected (similarity: {similarity_score:.2%})"
                )

                created_tasks.append(blocked_task)  # Add blocked task to result
                blocked_tasks_count += 1
                continue

            # No modification detected - create new task normally
            # PROMPT #85 - Include generated_prompt (semantic output prompt)
            task = Task(
                id=uuid4(),
                project_id=project_id,
                parent_id=UUID(suggestion["parent_id"]) if suggestion.get("parent_id") else None,
                title=suggestion["title"],
                description=suggestion["description"],
                item_type=ItemType.TASK,
                priority=PriorityLevel[suggestion["priority"].upper()],
                story_points=suggestion.get("story_points"),
                acceptance_criteria=suggestion.get("acceptance_criteria", []),
                generation_context=suggestion.get("_metadata", {}),
                generated_prompt=suggestion.get("generated_prompt"),  # PROMPT #85
                reporter="system",
                workflow_state="backlog",
                order=i,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )

            db.add(task)
            created_tasks.append(task)

        db.commit()

        for task in created_tasks:
            db.refresh(task)

        # PROMPT #94 FASE 4 - Log blocked tasks
        new_tasks_count = len(created_tasks) - blocked_tasks_count
        if blocked_tasks_count > 0:
            logger.info(
                f"✅ Processed {len(created_tasks)} Tasks: "
                f"{new_tasks_count} created, {blocked_tasks_count} blocked for approval"
            )
        else:
            logger.info(f"✅ Created {len(created_tasks)} Tasks")

        return
```

Extraia as regras de negócio FUNCIONAIS deste arquivo.
Escreva cada regra como se explicasse para um GERENTE DE PRODUTO.
Responda em JSON com este formato exato:

{
  "business_rules": [
    {
      "rule_text": "Descrição funcional da regra em linguagem de negócio",
      "rule_type": "domain|validation|constraint|workflow|permission|calculation",
      "confidence": "high|medium|low",
      "source_context": "trecho relevante do código (max 100 chars)"
    }
  ],
  "entities_found": ["Entidade1", "Entidade2"],
  "file_purpose": "Breve descrição do propósito do arquivo (1 frase)",
  "file_layer": "schema|routes|logic|presentation|config"
}

Se não houver regras de negócio FUNCIONAIS, retorne: {"business_rules": [], "entities_found": [], "file_purpose": "..."}
Arquivos de configuração, estilização e infraestrutura geralmente NÃO contêm regras de negócio.

## Response

```json
{
  "business_rules": [
    {
      "rule_text": "A geração de Épicos, Stories e Tarefas por IA é processada em segundo plano (assíncrona), e o usuário deve acompanhar o progresso consultando um job separado — o sistema retorna imediatamente um identificador de job, sem bloquear o usuário.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "executor.submit(job.priority, ...) / return BacklogJobResponse(job_id=..., status='pending')"
    },
    {
      "rule_text": "Um Épico só pode ser gerado pela IA a partir de uma Entrevista existente — não é possível gerar um Épico sem vínculo com uma Entrevista.",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "generate_epic_from_interview(interview_id: UUID, project_id: UUID, ...)"
    },
    {
      "rule_text": "Stories só podem ser geradas a partir de um Épico existente e previamente cadastrado no sistema — o sistema valida a existência do Épico antes de iniciar a geração.",
      "rule_type": "validation",
      "confidence": "high",
      "source_context": "epic = db.query(Task).filter(Task.id == epic_id).first() / if not epic: raise HTTPException(404)"
    },
    {
      "rule_text": "Tarefas só podem ser geradas a partir de uma Story existente e previamente cadastrada no sistema — o sistema valida a existência da Story antes de iniciar a geração.",
      "rule_type": "validation",
      "confidence": "high",
      "source_context": "story = db.query(Task).filter(Task.id == story_id).first() / if not story: raise HTTPException(404)"
    },
    {
      "rule_text": "O usuário pode revisar e editar as sugestões geradas pela IA (Épicos, Stories e Tarefas) antes de aprová-las — nada é salvo no sistema sem aprovação explícita do usuário.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "User can edit the suggestion before approving. / User can edit suggestions before approving."
    },
    {
      "rule_text": "Ao aprovar um Épico, todas as informações geradas pela IA são preservadas junto ao item, incluindo insights da entrevista, critérios de aceitação e rastreabilidade até as perguntas da entrevista de origem.",
      "rule_type": "domain",
      "confidence": "high",
      "source_content": "interview_insights=..., interview_question_ids=..., acceptance_criteria=..., generation_context=..."
    },
    {
      "rule_text": "Ao aprovar Stories em lote, todas são vinculadas ao Épico pai correspondente — Stories órfãs (sem Épico pai) são permitidas, mas o vínculo é preservado quando informado.",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "parent_id=UUID(suggestion['parent_id']) if suggestion.get('parent_id') else None"
    },
    {
      "rule_text": "Ao aprovar Tarefas, o sistema detecta automaticamente se alguma sugestão da IA representa uma tentativa de modificação de uma Tarefa já existente — se a similaridade entre a nova sugestão e uma Tarefa existente for igual ou superior a 90%, a nova Tarefa NÃO é criada.",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "detect_modification_attempt(..., threshold=0.90) / if is_modification: block_task(...)"
    },
    {
      "rule_text": "Quando uma Tarefa sugerida pela IA é identificada como modificação de uma Tarefa existente (similaridade ≥ 90%), a Tarefa original é bloqueada para aprovação manual — o sistema registra a sugestão de modificação proposta para análise, em vez de aplicá-la automaticamente.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "blocked_task = block_task(task=similar_task, proposed_modification={...}, reason=...)"
    },
    {
      "rule_text": "Tarefas concluídas (status DONE) são excluídas da verificação de similaridade — o sistema não compara novas sugestões com Tarefas já arquivadas/finalizadas.",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "Task.status != TaskStatus.DONE  # Don't compare with archived tasks"
    },
    {
      "rule_text": "Todo item gerado pela IA (Épico, Story ou Tarefa) inicia seu ciclo de vida no estado 'backlog', com prioridade, critérios de aceitação e contexto de geração registrados.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "workflow_state='backlog', priority=PriorityLevel[...], acceptance_criteria=..."
    },
    {
      "rule_text": "Ao aprovar um conjunto de Stories ou Tarefas, todos os itens são criados em lote de forma atômica — se qualquer item falhar, nenhum é salvo (operação é revertida por completo).",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "db.rollback() / except Exception as e: db.rollback() ... raise HTTPException(500)"
    },
    {
      "rule_text": "A hierarquia de trabalho no sistema segue a estrutura: Entrevista → Épico → Stories → Tarefas, onde cada nível é gerado e aprovado separadamente antes de decompor o próximo.",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "generate_epic_from_interview / generate_stories_from_epic / generate_tasks_from_story"
    },
    {
      "rule_text": "A ordem dos itens aprovados em lote (Stories e Tarefas) é preservada conforme a sequência em que foram enviados pelo usuário para aprovação.",
      "rule_type": "domain",
      "confidence": "medium",
      "source_context": "for i, suggestion in enumerate(suggestions): ... order=i"
    }
  ],
  "entities_found": ["Entrevista", "Épico", "Story", "Tarefa", "Projeto", "Job", "Sugestão de Backlog"],
  "file_purpose": "Gerencia o fluxo de geração e aprovação de backlog (Épicos, Stories e Tarefas) assistida por IA a partir de entrevistas, com detecção de modificações duplicadas e processamento assíncrono.",
  "file_layer": "routes"
}
```
