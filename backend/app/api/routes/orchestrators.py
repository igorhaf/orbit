from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.services.spec_generator import SpecGenerator
from app.services.task_decomposer import TaskDecomposer
from app.services.api_tester import APITester
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
        raise HTTPException(status_code=500, detail="Failed to generate spec")


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
        raise HTTPException(status_code=500, detail="Failed to decompose spec")


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


@router.post("/test-apis")
async def test_all_apis():
    """
    Testa spec generation com todas as APIs disponíveis

    POST /api/v1/orchestrators/test-apis

    Retorna comparação de custo, velocidade e qualidade
    """
    try:
        # Pegar API keys do ambiente
        anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        openai_key = os.getenv("OPENAI_API_KEY")
        google_key = os.getenv("GOOGLE_AI_API_KEY")

        if not all([anthropic_key, openai_key, google_key]):
            raise HTTPException(
                status_code=500,
                detail="API keys não configuradas no .env"
            )

        # Criar tester e executar
        tester = APITester(anthropic_key, openai_key, google_key)
        results = await tester.test_all()

        return results

    except Exception as e:
        logger.error(f"Failed to test APIs: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to test APIs: {str(e)}"
        )
