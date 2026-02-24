"""
Tasks Orbit Integration Router
Orbit integration endpoints: card inference, suggest title, export prompt,
orbit status, check orbit result.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.task import Task

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# PROMPT #131 - Card Inference from Interview
class CardInferenceRequest(BaseModel):
    """Request to run card inference from interview data."""
    interview_id: str


class CardInferenceResponse(BaseModel):
    """Response from card inference."""
    success: bool
    message: str
    updated_fields: Optional[Dict[str, Any]] = None


@router.post("/{task_id}/card-inference", response_model=CardInferenceResponse)
async def run_card_inference(
    task_id: UUID,
    request: CardInferenceRequest,
    db: Session = Depends(get_db)
):
    """
    PROMPT #131 - Run card inference from interview data.

    Uses the interview conversation to infer and update card fields:
    - Description (enriched with interview insights)
    - Acceptance criteria
    - Story points estimate
    - Labels

    POST /api/v1/tasks/{task_id}/card-inference
    Body: { "interview_id": "uuid" }
    """
    from app.models.interview import Interview
    from app.services.ai_orchestrator import AIOrchestrator

    # Fetch task
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tarefa {task_id} não encontrada"
        )

    # Fetch interview
    interview = db.query(Interview).filter(Interview.id == request.interview_id).first()
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entrevista {request.interview_id} não encontrada"
        )

    # Build conversation text
    conversation_text = ""
    if interview.conversation_data:
        for msg in interview.conversation_data:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            conversation_text += f"{role}: {content}\n\n"

    if not conversation_text.strip():
        return CardInferenceResponse(
            success=False,
            message="Entrevista não possui dados de conversa",
            updated_fields=None
        )

    try:
        # Use AI to infer card updates
        orchestrator = AIOrchestrator(db)

        system_prompt = """Você é um Product Owner especialista em análise de requisitos.
Análise a conversa de entrevista abaixo e extraia informações para expandir o card.

Retorne um JSON com os seguintes campos (apenas os que puderem ser inferidos):
{
    "description_addendum": "Informações adicionais para a descrição baseadas na entrevista",
    "acceptance_criteria": ["AC1: Critério 1", "AC2: Critério 2"],
    "story_points": 3,
    "suggested_labels": ["label1", "label2"]
}

Se não houver informação suficiente para um campo, omita-o do JSON."""

        user_prompt = f"""Card atual:
Título: {task.title}
Tipo: {task.item_type.value if task.item_type else 'N/A'}
Descrição atual: {task.description or 'Nenhuma'}

Conversa da entrevista:
{conversation_text}

Extraia informações relevantes para expandir este card."""

        response = await orchestrator.execute(
            usage_type="general",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=system_prompt,
            max_tokens=1500
        )

        # Parse response
        import json
        import re

        response_text = response.get("content", "")

        # Try to extract JSON from response
        json_match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
        if json_match:
            inferred_data = json.loads(json_match.group())
        else:
            logger.warning(f"Could not parse JSON from inference response: {response_text[:200]}")
            return CardInferenceResponse(
                success=False,
                message="Não foi possível interpretar a resposta da IA",
                updated_fields=None
            )

        # Apply updates
        updated_fields = {}

        # Enrich description
        if inferred_data.get("description_addendum"):
            current_desc = task.description or ""
            addendum = inferred_data["description_addendum"]
            if addendum not in current_desc:
                task.description = f"{current_desc}\n\n### Insights da Entrevista\n{addendum}".strip()
                updated_fields["description"] = "enriched"

        # Add acceptance criteria
        if inferred_data.get("acceptance_criteria"):
            current_ac = task.acceptance_criteria or []
            new_ac = inferred_data["acceptance_criteria"]
            for ac in new_ac:
                if ac not in current_ac:
                    current_ac.append(ac)
            task.acceptance_criteria = current_ac
            updated_fields["acceptance_criteria"] = len(new_ac)

        # Update story points if not set
        if inferred_data.get("story_points") and not task.story_points:
            task.story_points = inferred_data["story_points"]
            updated_fields["story_points"] = inferred_data["story_points"]

        # Add labels
        if inferred_data.get("suggested_labels"):
            current_labels = task.labels or []
            new_labels = inferred_data["suggested_labels"]
            for label in new_labels:
                if label not in current_labels:
                    current_labels.append(label)
            task.labels = current_labels
            updated_fields["labels"] = new_labels

        if updated_fields:
            task.updated_at = datetime.utcnow()
            db.commit()
            logger.info(f"✅ Card inference completed for task {task_id}: {updated_fields}")
            return CardInferenceResponse(
                success=True,
                message=f"Card atualizado com {len(updated_fields)} campos",
                updated_fields=updated_fields
            )
        else:
            return CardInferenceResponse(
                success=True,
                message="Nenhuma informação nova para adicionar",
                updated_fields={}
            )

    except Exception as e:
        logger.error(f"❌ Card inference failed for task {task_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha na inferencia de card: {str(e)}"
        )


# =============================================================================
# PROMPT #253 - AI Title Suggestion
# =============================================================================

class SuggestTitleRequest(BaseModel):
    """Request model for AI title suggestion."""
    user_input: str
    item_type: str = "story"
    project_id: str
    parent_id: Optional[str] = None


class SuggestTitleResponse(BaseModel):
    """Response model for AI title suggestion."""
    suggested_title: str


@router.post("/suggest-title", response_model=SuggestTitleResponse)
async def suggest_title(
    body: SuggestTitleRequest,
    db: Session = Depends(get_db),
):
    """
    PROMPT #253 - Generate a better title for a backlog card using AI.
    Takes the user's rough input and returns a polished, professional title.
    """
    from app.models.project import Project
    from app.services.ai_orchestrator import AIOrchestrator
    from app.prompts.loader import PromptLoader

    if not body.user_input or not body.user_input.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="user_input is required"
        )

    # Gather context
    project = db.query(Project).filter(Project.id == body.project_id).first()
    project_name = project.name if project else ""
    project_description = (project.description or "")[:200] if project else ""

    parent_title = ""
    if body.parent_id:
        parent = db.query(Task).filter(Task.id == body.parent_id).first()
        if parent:
            parent_title = parent.title or ""

    # Get sibling titles for context
    sibling_titles = ""
    if body.parent_id:
        siblings = db.query(Task.title).filter(
            Task.parent_id == body.parent_id,
        ).limit(10).all()
        sibling_titles = ", ".join(s[0] for s in siblings if s[0])
    elif project:
        siblings = db.query(Task.title).filter(
            Task.project_id == project.id,
            Task.item_type == body.item_type,
            Task.parent_id.is_(None),
        ).limit(10).all()
        sibling_titles = ", ".join(s[0] for s in siblings if s[0])

    # Load prompt and call AI
    loader = PromptLoader()
    try:
        sys_prompt, usr_prompt = loader.render(
            "backlog/suggest_title",
            {
                "item_type": body.item_type,
                "user_input": body.user_input.strip(),
                "project_name": project_name,
                "project_description": project_description,
                "parent_title": parent_title,
                "sibling_titles": sibling_titles,
            },
        )
    except Exception as e:
        logger.error(f"Failed to load suggest_title prompt: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao carregar template de prompt"
        )

    orchestrator = AIOrchestrator(db)
    response = await orchestrator.execute(
        usage_type="general",
        messages=[{"role": "user", "content": usr_prompt}],
        system_prompt=sys_prompt,
        max_tokens=100,
        project_id=body.project_id,
        metadata={"type": "suggest_title"},
    )

    suggested = response.get("content", "").strip().strip('"').strip("'")
    if not suggested:
        suggested = body.user_input.strip()

    return SuggestTitleResponse(suggested_title=suggested)


# ============================================================================
# PROMPT #241 - ORBIT FOLDER: Prompt Export
# ============================================================================

class PromptExportResponse(BaseModel):
    """Response for prompt export to satellite/knowledge/prompts/."""
    task_id: str
    filename: str
    file_path: str
    orbit_path: str
    message: str


class OrbitStatusResponse(BaseModel):
    """Current state of the satellite/ folder for a project."""
    project_id: str
    exists: bool
    orbit_path: Optional[str] = None
    memory: int = 0
    docs: int = 0
    results: int = 0
    prompts: int = 0


@router.post("/{task_id}/export-prompt", response_model=PromptExportResponse)
async def export_prompt_to_orbit(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    PROMPT #241 - Export a card's generated_prompt to satellite/knowledge/prompts/ as .md file.

    Creates the satellite/ folder structure if it doesn't exist.
    Writes {ITEM_TYPE}_{shortid}_{title_slug}.md to satellite/knowledge/prompts/.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa nao encontrada")

    try:
        from app.services.orbit_folder import OrbitFolderService
        service = OrbitFolderService(db)
        result = service.export_prompt(task)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(
            f"Failed to export prompt for task {task_id}: {e}", exc_info=True
        )
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao exportar prompt: {str(e)}"
        )

    return PromptExportResponse(
        task_id=str(task_id),
        filename=result["filename"],
        file_path=result["file_path"],
        orbit_path=result["orbit_path"],
        message=f"Prompt exportado para satellite/knowledge/prompts/{result['filename']}"
    )


@router.get("/project/{project_id}/orbit-status", response_model=OrbitStatusResponse)
async def get_orbit_status(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    PROMPT #241 - Get the current state of the satellite/ folder for a project.

    Returns counts of files in memory/, docs/, knowledge/results/, knowledge/prompts/.
    """
    from app.models.project import Project
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    from app.services.orbit_folder import OrbitFolderService
    service = OrbitFolderService(db)
    status = service.get_orbit_status(project)

    return OrbitStatusResponse(
        project_id=str(project_id),
        **status
    )


class CheckResultResponse(BaseModel):
    """Response for orbit result check."""
    task_id: str
    found: bool
    title: Optional[str] = None
    status: Optional[str] = None
    filename: Optional[str] = None
    message: str


@router.post("/{task_id}/check-result", response_model=CheckResultResponse)
async def check_orbit_result(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    PROMPT #242 - Check if a result file exists for this card in orbit/results/.

    Scans orbit/results/ for a matching _RESULT.md file, processes it
    (saves to TaskResult, updates card status to REVIEW), and returns status.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa nao encontrada")

    try:
        from app.services.orbit_folder import OrbitFolderService
        service = OrbitFolderService(db)
        result = service.check_result_for_task(task)
    except Exception as e:
        logger.error(f"Failed to check result for task {task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao verificar resultado: {str(e)}")

    if result:
        return CheckResultResponse(
            task_id=str(task_id),
            found=True,
            title=result.get("title"),
            status=result.get("status"),
            filename=result.get("filename"),
            message=f"Resultado encontrado e processado: {result.get('filename')}"
        )

    return CheckResultResponse(
        task_id=str(task_id),
        found=False,
        message="Nenhum resultado encontrado em orbit/results/"
    )
