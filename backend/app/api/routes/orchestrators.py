from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.services.spec_generator import SpecGenerator
from app.services.task_decomposer import TaskDecomposer
from app.orchestrators.registry import OrchestratorRegistry
from app.schemas.orchestrator import (
    GenerateSpecRequest,
    DecomposeRequest,
    SpecResponse,
    TasksResponse
)
import logging
import os

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/orchestrators", tags=["orchestrators"])


@router.get("/available")
async def list_available_orchestrators():
    """
    Lista orquestradores disponíveis

    GET /api/v1/orchestrators/available
    """
    orchestrators = OrchestratorRegistry.list_available()

    return {
        "orchestrators": orchestrators,
        "total": len(orchestrators)
    }


@router.post("/generate-spec", response_model=SpecResponse)
async def generate_spec(
    request: GenerateSpecRequest,
    db: Session = Depends(get_db)
):
    """
    Gera spec técnica completa usando orquestrador especializado

    POST /api/v1/orchestrators/generate-spec

    Body:
    {
        "stack": "php_mysql",
        "interview_data": {
            "project_name": "Book Catalog",
            "entities": ["Book"],
            "features": ["CRUD"]
        }
    }

    Custo: ~$0.03
    """
    try:
        generator = SpecGenerator(db)

        spec = await generator.generate(
            stack_key=request.stack,
            interview_data=request.interview_data
        )

        return SpecResponse(
            success=True,
            spec=spec
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to generate spec: {str(e)}")
        raise HTTPException(status_code=500, detail="Falha ao gerar spec")


@router.post("/decompose", response_model=TasksResponse)
async def decompose_spec(
    request: DecomposeRequest,
    db: Session = Depends(get_db)
):
    """
    Decompõe spec em tasks atômicas (3-5k tokens cada)

    POST /api/v1/orchestrators/decompose

    Body:
    {
        "stack": "php_mysql",
        "spec": {...}
    }
    """
    try:
        decomposer = TaskDecomposer(db)

        tasks = decomposer.decompose(
            stack_key=request.stack,
            spec=request.spec
        )

        return TasksResponse(
            success=True,
            tasks=tasks,
            total=len(tasks)
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to decompose: {str(e)}")
        raise HTTPException(status_code=500, detail="Falha ao decompor spec")


@router.get("/{stack_key}/context")
async def get_stack_context(stack_key: str):
    """
    Retorna contexto de uma stack específica
    Útil para debug e documentação

    GET /api/v1/orchestrators/php_mysql/context
    """
    try:
        orchestrator = OrchestratorRegistry.get_orchestrator(stack_key)

        return {
            "stack": stack_key,
            "name": orchestrator.stack_name,
            "context": orchestrator.get_stack_context(),
            "conventions": orchestrator.get_conventions(),
            "patterns": list(orchestrator.get_patterns().keys())
        }

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# v2.5: /test-apis removed (was a side-by-side comparator across providers;
# claudius-only lockdown makes it obsolete).
