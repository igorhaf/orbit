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
        usage_type="prompt_generation",
        messages=[{"role": "user", "content": usr_prompt}],
        system_prompt=sys_prompt,
        max_tokens=500,  # Qwen3 thinking tokens consume budget; need 300+ for thinking + actual response
        project_id=body.project_id,
        metadata={"type": "suggest_title", "skip_context_build": True},
    )

    suggested = response.get("content", "").strip().strip('"').strip("'")
    if not suggested:
        suggested = body.user_input.strip()

    return SuggestTitleResponse(suggested_title=suggested)


# ============================================================================
# Generate description for a card (any status, not just suggested)
# ============================================================================

@router.post("/{task_id}/generate-description")
async def generate_card_description(
    task_id: UUID,
    db: Session = Depends(get_db),
):
    """
    Generate AI description for a card regardless of status.
    Unlike /activate, this works on any card (not just draft/suggested).
    Runs as a background job.
    Respects REGRA #0: won't overwrite human-edited description.
    """
    from app.services.job_manager import JobManager
    from app.models.async_job import JobType

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail=f"Card {task_id} não encontrado")

    # REGRA #0: check if description was human-edited
    if task.description_edited_by == "human":
        raise HTTPException(
            status_code=409,
            detail="Descrição foi editada manualmente. Remova a edição antes de regenerar."
        )

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.DESCRIPTION_GENERATION,
        input_data={
            "action": "generate_card_description",
            "task_id": str(task_id),
            "task_title": task.title or "",
            "item_type": task.item_type.value if task.item_type else "task",
        },
        project_id=task.project_id,
        task_id=task_id,
        notification_title=f"Descrição IA — '{(task.title or '')[:40]}'",
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_card_description_async,
        job.id,
        str(task_id),
    )

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Geração de descrição enfileirada",
    }


async def _process_card_description_async(job_id: UUID, task_id_str: str):
    """Background task: generate description for a card using AI."""
    import json
    import time
    from uuid import UUID as UUIDType
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.models.project import Project
    from app.models.task import Task
    from app.services.ai_orchestrator import AIOrchestrator

    db = SessionLocal()
    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        task_id = UUIDType(task_id_str)

        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            job_manager.fail_job(job_id, f"Card {task_id} não encontrado")
            return

        project = db.query(Project).filter(Project.id == task.project_id).first()
        if not project:
            job_manager.fail_job(job_id, "Projeto não encontrado")
            return

        job_manager.update_progress(job_id, 10.0, "Carregando contexto...")

        # Gather parent context
        parent = None
        if task.parent_id:
            parent = db.query(Task).filter(Task.id == task.parent_id).first()

        # Build prompt
        item_type = task.item_type.value if task.item_type else "task"
        context_parts = [
            f"Projeto: {project.name}",
        ]
        if project.description:
            context_parts.append(f"Descrição do projeto: {project.description[:300]}")
        if parent:
            context_parts.append(f"Item pai: {parent.title}")
            if parent.description:
                context_parts.append(f"Descrição do pai: {parent.description[:500]}")

        context = "\n".join(context_parts)

        system_prompt = (
            "Você é um Product Owner sênior. Gere uma descrição técnica detalhada "
            f"para um card de backlog do tipo '{item_type}'. "
            "A descrição deve ser clara, acionável e incluir:\n"
            "1. O que precisa ser feito (objetivo)\n"
            "2. Contexto relevante\n"
            "3. Requisitos técnicos principais\n"
            "Escreva em português. Mínimo 200 caracteres. Máximo 2000 caracteres.\n"
            "Responda APENAS com o texto da descrição (sem JSON, sem markdown extra)."
        )

        user_prompt = (
            f"Gere uma descrição detalhada para este {item_type}:\n\n"
            f"Título: {task.title}\n\n"
            f"Contexto:\n{context}"
        )

        job_manager.update_progress(job_id, 30.0, "Chamando IA...")

        start_time = time.time()
        orchestrator = AIOrchestrator(db)
        response = await orchestrator.execute(
            usage_type="prompt_generation",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=system_prompt,
            max_tokens=2000,
            project_id=str(task.project_id),
            metadata={"type": "card_description", "skip_context_build": True},
        )

        elapsed_ms = int((time.time() - start_time) * 1000)
        description = response.get("content", "").strip()
        ai_model = response.get("model_name", "unknown")

        if not description or len(description) < 50:
            job_manager.fail_job(job_id, "IA gerou descrição muito curta ou vazia")
            return

        job_manager.update_progress(job_id, 80.0, "Salvando descrição...")

        # REGRA #0: double-check before saving
        db.refresh(task)
        if task.description_edited_by == "human":
            job_manager.fail_job(job_id, "Descrição foi editada manualmente durante a geração")
            return

        task.description = description
        task.description_edited_by = "ai"
        task.created_by_ai_model = ai_model
        db.commit()

        logger.info(
            f"Generated description for card {task_id} "
            f"({len(description)} chars, model={ai_model}, {elapsed_ms}ms)"
        )

        job_manager.complete_job(job_id, {
            "description": description,
            "ai_model": ai_model,
            "chars": len(description),
        })

    except Exception as e:
        logger.error(f"Card description job {job_id} failed: {e}", exc_info=True)
        try:
            job_manager.fail_job(job_id, str(e)[:500])
        except Exception:
            pass
    finally:
        db.close()


# PROMPT #248 - Generate semantic prompt for a card
class SemanticPromptRequest(BaseModel):
    force: bool = False  # Override REGRA #0 protection


class SemanticPromptResponse(BaseModel):
    success: bool
    prompt: Optional[str] = None
    ai_model: Optional[str] = None
    message: Optional[str] = None
    sources: Optional[Dict[str, Any]] = None


@router.post("/{task_id}/generate-semantic-prompt")
async def generate_semantic_prompt(
    task_id: UUID,
    request: SemanticPromptRequest = SemanticPromptRequest(),
    db: Session = Depends(get_db)
):
    """
    PROMPT #248 - Generate semantic prompt for a card using all available context.

    Gathers context from: card hierarchy, project context_semantic, wiki pages,
    business rules (RAG), and tech stack. Calls AI to compose an actionable
    implementation prompt.

    Now runs as a background job (visible in Jobs page) and creates a Prompt record
    (visible in Prompts page).

    POST /api/v1/tasks/{task_id}/generate-semantic-prompt
    Body: { "force": false }
    Returns: { "job_id": "...", "status": "pending", "message": "..." }
    """
    from app.services.job_manager import JobManager
    from app.models.async_job import JobType

    # 1. Fetch card for validation
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail=f"Card {task_id} nao encontrado")

    # REGRA #0: Don't overwrite human-edited prompt unless forced
    if task.prompt_edited_by == "human" and not request.force:
        return SemanticPromptResponse(
            success=False,
            message="Este prompt foi editado manualmente. Use force=true para sobrescrever.",
        )

    # 2. Create async job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.SEMANTIC_PROMPT,
        input_data={
            "action": "generate_semantic_prompt",
            "task_id": str(task_id),
            "task_title": task.title or "",
            "force": request.force,
        },
        project_id=task.project_id,
        task_id=task_id,
        notification_title=f"Prompt semântico — '{(task.title or '')[:40]}'",
    )

    # 3. Submit to priority executor
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_semantic_prompt_async,
        job.id,
        str(task_id),
        request.force,
    )

    # 4. Return job_id immediately
    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Geração de prompt semântico enfileirada",
    }


async def _process_semantic_prompt_async(
    job_id: UUID,
    task_id_str: str,
    force: bool,
):
    """Background task: generate semantic prompt and save to card + Prompt record."""
    import json
    import httpx
    import os
    import asyncio
    import time
    from uuid import UUID as UUIDType
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.models.project import Project
    from app.models.wiki_page import WikiPage
    from app.models.task import Task
    from app.models.prompt import Prompt
    from app.contracts.loader import ContractLoader

    db = SessionLocal()
    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)

        task_id = UUIDType(task_id_str)

        # 1. Fetch card
        job_manager.update_progress(job_id, 5.0, "Carregando card...")
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            job_manager.fail_job(job_id, f"Card {task_id} não encontrado")
            return

        # 2. Fetch project
        job_manager.update_progress(job_id, 10.0, "Carregando projeto...")
        project = db.query(Project).filter(Project.id == task.project_id).first()
        if not project:
            job_manager.fail_job(job_id, "Projeto não encontrado")
            return

        # 3. Fetch parent hierarchy
        parent = None
        if task.parent_id:
            parent = db.query(Task).filter(Task.id == task.parent_id).first()

        # 4. Fetch wiki pages for context
        sources = {
            "wiki_pages": [],
            "rules_count": 0,
            "parent_context": parent is not None,
            "project_context": bool(project.context_semantic),
        }

        job_manager.update_progress(job_id, 20.0, "Buscando wiki e regras de negócio...")
        wiki_context = ""
        try:
            # Get domain from card's generation_context to prioritize relevant wiki pages
            card_domain = ""
            if task.generation_context and isinstance(task.generation_context, dict):
                card_domain = task.generation_context.get("domain", "")

            all_wiki = (
                db.query(WikiPage)
                .filter(WikiPage.project_id == project.id)
                .order_by(WikiPage.order_index)
                .all()
            )
            if all_wiki:
                # Prioritize pages whose slug/title contains card domain or card title keywords
                keywords = set((card_domain + " " + task.title).lower().split())
                def _relevance(wp):
                    text = (wp.slug or "") + " " + (wp.title or "").lower()
                    return sum(1 for kw in keywords if len(kw) > 3 and kw in text)

                sorted_wiki = sorted(all_wiki, key=_relevance, reverse=True)
                wiki_parts = []
                char_budget = 3000
                for wp in sorted_wiki:
                    snippet = (wp.content or '')[:600]
                    if len("\n\n".join(wiki_parts)) + len(snippet) > char_budget:
                        break
                    wiki_parts.append(f"### {wp.title}\n{snippet}")
                    sources["wiki_pages"].append(wp.title)
                wiki_context = "\n\n".join(wiki_parts)
        except Exception as e:
            logger.warning(f"Failed to fetch wiki pages: {e}")

        # 5. Fetch business rules from RAG
        rules_text = ""
        try:
            from app.services.rag_service import RAGService
            rag = RAGService(db)
            rules = rag.get_business_rules(
                project_id=project.id,
                query=task.title,
                top_k=10,
            )
            if rules:
                rules_text = rag.format_business_rules_for_prompt(rules, max_chars=3000)
                sources["rules_count"] = len(rules)
        except Exception as e:
            logger.warning(f"Failed to fetch business rules: {e}")

        # 6. Build context and render contract
        job_manager.update_progress(job_id, 30.0, "Montando prompt...")
        contract_loader = ContractLoader(db)
        variables = {
            "card_title": task.title or "",
            "card_type": task.item_type.value if task.item_type else "task",
            "card_description": task.description or "Sem descricao",
            "labels": ", ".join(task.labels) if task.labels else "",
            "acceptance_criteria": "\n".join(
                f"- {ac}" for ac in (task.acceptance_criteria or [])
            ) if task.acceptance_criteria else "",
            "parent_title": parent.title if parent else "",
            "parent_prompt": (parent.generated_prompt or "")[:2000] if parent else "",
            "project_context": "\n\n".join(filter(None, [
                project.context_human or "",
                (project.context_semantic or "")[:2000],
            ]))[:3000],
            "tech_stack": json.dumps(project.stack or {}, ensure_ascii=False),
            "business_rules": rules_text,
            "wiki_context": wiki_context[:4000],
        }

        try:
            system_prompt, user_prompt = contract_loader.render(
                "pipeline/card_semantic_prompt", variables
            )
        except Exception as e:
            logger.warning(f"Failed to load contract: {e}", exc_info=True)
            system_prompt = (
                "Voce e um engenheiro de software senior. Gere um prompt semantico tecnico "
                "e completo para implementar o item descrito. Minimo 500 chars, maximo 5000. "
                "Portugues. Sem emojis. Responda APENAS com o texto do prompt."
            )
            user_prompt = "\n".join(f"{k}: {v}" for k, v in variables.items() if v)

        # 7. Call AI via Ollama
        job_manager.update_progress(job_id, 40.0, "Chamando IA (Ollama)...")
        prompt_text = None
        ai_model = "unknown"

        ollama_host = os.getenv("OLLAMA_HOST", "http://host.docker.internal:11434")
        ollama_model = os.getenv("OLLAMA_SEMANTIC_MODEL", "qwen3:14b")

        async def _call_ollama() -> str:
            async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0)) as client:
                resp = await client.post(
                    f"{ollama_host}/api/chat",
                    json={
                        "model": ollama_model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                        "stream": False,
                        "options": {"num_predict": 4000},
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("message", {}).get("content", "").strip()

        start_time = time.time()

        # Retry once on failure (handles cold-start / model loading delays)
        last_error = None
        for attempt in range(2):
            try:
                prompt_text = await _call_ollama()
                ai_model = ollama_model
                break
            except Exception as e:
                last_error = e
                err_msg = str(e) or type(e).__name__
                logger.error(f"Ollama call failed (attempt {attempt + 1}/2): {err_msg}", exc_info=True)
                if attempt == 0:
                    job_manager.update_progress(job_id, 50.0, "Retry: modelo carregando...")
                    await asyncio.sleep(3)

        elapsed_ms = int((time.time() - start_time) * 1000)

        if prompt_text is None:
            err_detail = str(last_error) or type(last_error).__name__ if last_error else "Erro desconhecido"
            job_manager.fail_job(job_id, f"Erro na geração: {err_detail[:200]}")
            return

        if not prompt_text or len(prompt_text) < 100:
            job_manager.fail_job(job_id, "IA gerou resposta muito curta ou vazia")
            return

        # 8. Save to card (REGRA #0 compliant)
        job_manager.update_progress(job_id, 80.0, "Salvando prompt no card...")
        task.generated_prompt = prompt_text
        task.prompt_edited_by = "ai"
        task.created_by_ai_model = ai_model

        # 8b. Extract acceptance criteria from prompt and save to card
        # Only fill if no human-edited criteria exist (REGRA #0)
        if not task.acceptance_criteria or len(task.acceptance_criteria) == 0:
            extracted_acs = []
            in_ac_section = False
            for line in prompt_text.split("\n"):
                stripped = line.strip()
                # Detect start of acceptance criteria section
                if stripped.upper().startswith("CRITERIOS DE ACEITACAO") or stripped.upper().startswith("CRITÉRIOS DE ACEITAÇÃO"):
                    in_ac_section = True
                    continue
                # Detect end (next section header — all caps line without numbering)
                if in_ac_section and stripped and not stripped[0].isdigit() and not stripped.startswith("Given") and not stripped.startswith("-") and stripped == stripped.upper() and len(stripped) > 3:
                    break
                # Extract numbered criteria
                if in_ac_section and stripped:
                    import re
                    ac_match = re.match(r'^\d+[\.\)]\s*(.+)', stripped)
                    if ac_match:
                        extracted_acs.append(ac_match.group(1).strip())
                    elif stripped.startswith("- "):
                        extracted_acs.append(stripped[2:].strip())
                    elif stripped.startswith("Given ") or stripped.startswith("Given:"):
                        extracted_acs.append(stripped)
            if extracted_acs:
                task.acceptance_criteria = extracted_acs
                logger.info(f"Extracted {len(extracted_acs)} acceptance criteria for card {task_id}")

        # 9. Create Prompt record (visible in /prompts page)
        job_manager.update_progress(job_id, 90.0, "Registrando no log de prompts...")
        prompt_record = Prompt(
            project_id=task.project_id,
            content=prompt_text,
            type="semantic_prompt",
            is_reusable=False,
            ai_model_used=ai_model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            response=prompt_text,
            input_tokens=0,
            output_tokens=0,
            total_cost_usd=0.0,
            execution_time_ms=elapsed_ms,
            execution_metadata={
                "task_id": task_id_str,
                "task_title": task.title,
                "sources": sources,
            },
            status="success",
        )
        db.add(prompt_record)
        db.commit()

        logger.info(
            f"Generated semantic prompt for card {task_id} "
            f"({len(prompt_text)} chars, model={ai_model}, {elapsed_ms}ms)"
        )

        # 10. Complete job with result
        result = {
            "success": True,
            "prompt": prompt_text,
            "ai_model": ai_model,
            "sources": sources,
            "prompt_id": str(prompt_record.id),
        }
        job_manager.complete_job(job_id, result)

    except Exception as e:
        logger.error(f"Semantic prompt job {job_id} failed: {e}", exc_info=True)
        try:
            job_manager.fail_job(job_id, str(e)[:500])
        except Exception:
            pass
    finally:
        db.close()


# ============================================================================
# Expand / Summarize / Rephrase card description
# ============================================================================

@router.post("/{task_id}/expand-description")
async def expand_card_description(task_id: UUID, db: Session = Depends(get_db)):
    """Expand/detail a card description using AI."""
    return await _card_description_action(task_id, "expand", db)


@router.post("/{task_id}/summarize-description")
async def summarize_card_description(task_id: UUID, db: Session = Depends(get_db)):
    """Summarize/condense a card description using AI."""
    return await _card_description_action(task_id, "summarize", db)


@router.post("/{task_id}/rephrase-description")
async def rephrase_card_description(task_id: UUID, db: Session = Depends(get_db)):
    """Rephrase a card description using AI (different wording, same meaning)."""
    return await _card_description_action(task_id, "rephrase", db)


async def _card_description_action(task_id: UUID, action: str, db: Session):
    """Shared handler for expand/summarize/rephrase card description."""
    from app.services.job_manager import JobManager
    from app.models.async_job import JobType

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail=f"Card {task_id} não encontrado")

    if not task.description:
        raise HTTPException(status_code=400, detail="Card sem descrição para processar")

    action_labels = {
        "expand": "Detalhando",
        "summarize": "Resumindo",
        "rephrase": "Reformulando",
    }

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.DESCRIPTION_GENERATION,
        input_data={
            "action": f"card_{action}",
            "task_id": str(task_id),
            "task_title": task.title or "",
            "current_description": task.description,
        },
        project_id=task.project_id,
        task_id=task_id,
        notification_title=f"{action_labels[action]} descrição — '{(task.title or '')[:40]}'",
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_card_description_action_async,
        job.id, str(task_id), action,
    )

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"{action_labels[action]} descrição enfileirada.",
    }


async def _process_card_description_action_async(
    job_id: UUID, task_id_str: str, action: str
):
    """Background task: expand/summarize/rephrase a card description."""
    import time
    from uuid import UUID as UUIDType
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.models.project import Project
    from app.services.ai_orchestrator import AIOrchestrator

    action_prompts = {
        "expand": {
            "system": (
                "Você é um Product Owner sênior. Expanda e detalhe a descrição do card "
                "abaixo, adicionando mais informações técnicas, requisitos e contexto. "
                "Mantenha o conteúdo original e adicione detalhes relevantes. "
                "Escreva em português. Responda APENAS com o texto da descrição."
            ),
            "instruction": "Expanda e detalhe esta descrição, adicionando mais informações:",
            "max_tokens": 3000,
        },
        "summarize": {
            "system": (
                "Você é um Product Owner sênior. Resuma e condense a descrição do card "
                "abaixo, mantendo apenas os pontos essenciais e removendo redundâncias. "
                "Escreva em português. Responda APENAS com o texto da descrição."
            ),
            "instruction": "Resuma esta descrição, mantendo apenas o essencial:",
            "max_tokens": 1000,
        },
        "rephrase": {
            "system": (
                "Você é um Product Owner sênior. Reformule a descrição do card abaixo "
                "usando palavras diferentes mas mantendo o mesmo significado e tamanho. "
                "Escreva em português. Responda APENAS com o texto da descrição."
            ),
            "instruction": "Reformule esta descrição com outras palavras:",
            "max_tokens": 2000,
        },
    }

    db = SessionLocal()
    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        task_id = UUIDType(task_id_str)

        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            job_manager.fail_job(job_id, f"Card {task_id} não encontrado")
            return

        project = db.query(Project).filter(Project.id == task.project_id).first()
        cfg = action_prompts[action]

        user_prompt = (
            f"Título: {task.title}\n"
            f"Projeto: {project.name if project else 'N/A'}\n\n"
            f"{cfg['instruction']}\n\n"
            f"{task.description}"
        )

        job_manager.update_progress(job_id, 30.0, "Chamando IA...")

        start_time = time.time()
        orchestrator = AIOrchestrator(db)
        response = await orchestrator.execute(
            usage_type="prompt_generation",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=cfg["system"],
            max_tokens=cfg["max_tokens"],
            project_id=str(task.project_id),
            metadata={"type": f"card_{action}", "skip_context_build": True},
        )

        elapsed_ms = int((time.time() - start_time) * 1000)
        description = response.get("content", "").strip()
        ai_model = response.get("model_name", "unknown")

        if not description or len(description) < 20:
            job_manager.fail_job(job_id, "IA gerou descrição muito curta ou vazia")
            return

        job_manager.update_progress(job_id, 80.0, "Salvando descrição...")

        db.refresh(task)
        task.description = description
        task.description_edited_by = "ai"
        task.created_by_ai_model = ai_model
        db.commit()

        logger.info(
            f"{action.capitalize()} description for card {task_id} "
            f"({len(description)} chars, model={ai_model}, {elapsed_ms}ms)"
        )

        job_manager.complete_job(job_id, {
            "description": description,
            "ai_model": ai_model,
            "chars": len(description),
            "action": action,
        })

    except Exception as e:
        logger.error(f"Card {action} job {job_id} failed: {e}", exc_info=True)
        try:
            job_manager.fail_job(job_id, str(e)[:500])
        except Exception:
            pass
    finally:
        db.close()
