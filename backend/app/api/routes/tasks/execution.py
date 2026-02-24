"""
Tasks Execution Router
Task execution endpoints: execute single task, execute all tasks, get result.
Includes background task functions for async execution.
"""

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from uuid import UUID
from pydantic import BaseModel

from app.database import get_db
from app.models.task import Task
from app.models.task_result import TaskResult
from app.schemas.task import (
    TaskExecuteRequest,
    TaskResultResponse,
)
from app.services.task_executor import TaskExecutor

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# Task Execution Endpoints
# PROMPT #108 - Moved to background queue


class ExecuteJobResponse(BaseModel):
    """Response model for async task execution job."""
    job_id: str
    status: str
    message: str


@router.post("/{task_id}/execute", response_model=ExecuteJobResponse)
async def execute_task(
    task_id: UUID,
    request: TaskExecuteRequest = Body(default=TaskExecuteRequest()),
    db: Session = Depends(get_db)
):
    """
    Executa uma task específica com validação automática - ASYNC.

    PROMPT #108 - Moved to background queue

    POST /api/v1/tasks/{task_id}/execute

    This endpoint now runs asynchronously in the background.
    Poll GET /api/v1/jobs/{job_id} for progress and result.

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Task execution started. Poll GET /api/v1/jobs/{job_id} for progress."
    }

    Poll /api/v1/jobs/{job_id} to get:
    - status: "running" with progress_percent and progress_message
    - status: "completed" with result (TaskResultResponse format)
    - status: "failed" with error message
    """
    from app.models.async_job import JobType
    from app.services.job_manager import JobManager

    # Buscar task para obter project_id
    task = db.query(Task).filter(Task.id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.TASK_EXECUTION,
        input_data={
            "task_id": str(task_id),
            "project_id": str(task.project_id),
            "max_attempts": request.max_attempts,
            "task_title": task.title
        },
        project_id=task.project_id
    )

    logger.info(f"Created task execution job {job.id} for task {task_id}")

    # Execute in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _execute_task_async, job.id, task_id, task.project_id, request.max_attempts)

    # Return job_id immediately
    return ExecuteJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Execução de tarefa iniciada. Use GET /api/v1/jobs/{job.id} para acompanhar progresso."
    )


@router.post("/projects/{project_id}/execute-all", response_model=ExecuteJobResponse)
async def execute_all_tasks(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Executa todas as tasks de um projeto - ASYNC.

    PROMPT #108 - Moved to background queue

    POST /api/v1/tasks/projects/{project_id}/execute-all

    This endpoint now runs asynchronously in the background.
    Poll GET /api/v1/jobs/{job_id} for progress and result.

    Respeita dependências entre tasks (executa em ordem topológica).
    Tasks sem dependências são executadas primeiro.

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Batch execution started. Poll GET /api/v1/jobs/{job_id} for progress."
    }

    Poll /api/v1/jobs/{job_id} to get:
    - status: "running" with progress (e.g., "Task 3/10 executing...")
    - status: "completed" with result (BatchExecuteResponse format)
    - status: "failed" with error message
    """
    from app.models.async_job import JobType
    from app.services.job_manager import JobManager

    # Buscar todas tasks do projeto
    tasks = db.query(Task).filter(Task.project_id == project_id).all()

    if not tasks:
        raise HTTPException(status_code=404, detail="Nenhuma tarefa encontrada para o projeto")

    task_ids = [str(t.id) for t in tasks]

    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.BATCH_EXECUTION,
        input_data={
            "project_id": str(project_id),
            "task_ids": task_ids,
            "total_tasks": len(task_ids)
        },
        project_id=project_id
    )

    logger.info(f"Created batch execution job {job.id} for project {project_id} with {len(task_ids)} tasks")

    # Execute in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _execute_batch_async, job.id, task_ids, project_id)

    # Return job_id immediately
    return ExecuteJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Execução em lote iniciada para {len(task_ids)} tarefas. Use GET /api/v1/jobs/{job.id} para acompanhar progresso."
    )


@router.get("/{task_id}/result", response_model=TaskResultResponse)
async def get_task_result(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Busca resultado de uma task executada

    GET /api/v1/tasks/{task_id}/result

    Retorna:
    - Código gerado
    - Métricas de execução
    - Status de validação

    Retorna 404 se a task ainda não foi executada.
    """

    result = db.query(TaskResult).filter(TaskResult.task_id == task_id).first()

    if not result:
        raise HTTPException(status_code=404, detail="Resultado não encontrado. A tarefa pode não ter sido executada ainda.")

    return result


# ============================================================================
# PROMPT #108 - BACKGROUND TASK FUNCTIONS
# ============================================================================

async def _execute_task_async(
    job_id: UUID,
    task_id: UUID,
    project_id: UUID,
    max_attempts: int = 3
):
    """
    Background task to execute a single task.

    PROMPT #108 - Background queue for prompt executions
    """
    from app.database import SessionLocal
    from app.services.job_manager import JobManager

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Starting task execution job {job_id} for task {task_id}")

        job_manager.update_progress(job_id, 10.0, "Carregando contexto da tarefa...")

        executor = TaskExecutor(db)
        result = await executor.execute_task(
            task_id=str(task_id),
            project_id=str(project_id),
            max_attempts=max_attempts
        )

        job_manager.update_progress(job_id, 90.0, "Execução concluida!")

        logger.info(f"✅ Task execution job {job_id} completed for task {task_id}")

        # Complete job with result (TaskResultResponse format as dict)
        job_manager.complete_job(job_id, result.dict() if hasattr(result, 'dict') else result)

    except Exception as e:
        logger.error(f"❌ Task execution job {job_id} failed: {e}")
        job_manager = JobManager(db)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


async def _execute_batch_async(
    job_id: UUID,
    task_ids: list,
    project_id: UUID
):
    """
    Background task to execute all tasks in a project.

    PROMPT #108 - Background queue for prompt executions
    """
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.models.async_job import JobType  # PROMPT #298

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        total = len(task_ids)
        logger.info(f"🚀 Starting batch execution job {job_id} for {total} tasks")

        job_manager.update_progress(job_id, 5.0, f"Iniciando execucao em lote de {total} tarefas...")

        executor = TaskExecutor(db)

        # PROMPT #298 - Create child jobs upfront for each task
        child_job_ids = {}
        for i, tid in enumerate(task_ids, 1):
            # Fetch task title for a meaningful phase_label
            task_obj = db.query(Task).filter(Task.id == tid).first()
            task_title = task_obj.title[:60] if task_obj else str(tid)
            child = job_manager.create_child_job(
                parent_job_id=job_id,
                job_type=JobType.TASK_EXECUTION,
                input_data={"task_id": str(tid)},
                phase_label=f"Task {i}/{total}: {task_title}",
                task_id=tid,
            )
            child_job_ids[str(tid)] = child.id

        # Execute with progress updates
        results = []
        for i, task_id in enumerate(task_ids):
            progress = 10 + (80 * i / total)
            job_manager.update_progress(job_id, progress, f"Executando tarefa {i+1}/{total}...")

            # Check if job was cancelled
            if job_manager.is_cancelled(job_id):
                logger.info(f"⚠️ Batch execution job {job_id} was cancelled at task {i+1}/{total}")
                break

            # PROMPT #298 - Start child job
            _child_id = child_job_ids.get(str(task_id))
            if _child_id:
                job_manager.start_job(_child_id)

            try:
                result = await executor.execute_task(
                    task_id=task_id,
                    project_id=str(project_id),
                    max_attempts=3
                )
                results.append(result)
                # PROMPT #298 - Complete child job
                if _child_id:
                    job_manager.complete_child_job(_child_id, {
                        "validation_passed": getattr(result, 'validation_passed', None),
                    })
            except Exception as task_error:
                logger.error(f"Task {task_id} failed: {task_error}")
                # PROMPT #298 - Fail child job
                if _child_id:
                    job_manager.fail_child_job(_child_id, str(task_error))
                # Continue with other tasks even if one fails

        job_manager.update_progress(job_id, 95.0, "Finalizando resultados do lote...")

        succeeded = sum(1 for r in results if hasattr(r, 'validation_passed') and r.validation_passed)
        failed = len(results) - succeeded

        logger.info(f"✅ Batch execution job {job_id} completed: {succeeded}/{total} succeeded")

        # Complete job with result (BatchExecuteResponse format)
        job_manager.complete_job(job_id, {
            "total": total,
            "succeeded": succeeded,
            "failed": failed,
            "results": [r.dict() if hasattr(r, 'dict') else r for r in results]
        })

    except Exception as e:
        logger.error(f"❌ Batch execution job {job_id} failed: {e}")
        job_manager = JobManager(db)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()
