#!/usr/bin/env python3
"""
PROMPT #240 - Massive Card Generator from ALL RAG Business Rules

Reads ALL business rules from RAG (6000+), groups them by source directory
into natural domains, and generates rigid 3-level hierarchy:
  Epic (domain) > Story (functional area) > Task (group of 3 rules)

Same rigid structure as generate_cards_from_rag.py but covers ALL rules
by using source_file metadata for automatic domain classification.

No AI calls needed - pure code-based classification and generation.

Usage:
  cd /home/igorhaf/orbit/backend
  poetry run python -m app.scripts.generate_all_cards_from_rag
"""

import json
import logging
import math
import os
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from uuid import UUID, uuid4

backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(backend_dir))
os.chdir(backend_dir)

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

PROJECT_ID = UUID("0c9afa06-cda9-489f-85d1-5d6c67407f32")
RULES_PER_TASK = 3
RULES_PER_STORY = 15  # Group into stories of ~15 rules max

# ── Domain mapping: directory prefix → Epic title ──────────────────────
DOMAIN_MAP = {
    # Backend
    "backend/app/services/context_generator": "Gerador de Contexto",
    "backend/app/services/ai_orchestrator": "Orquestrador de IA",
    "backend/app/services/codebase_memory": "Memoria de Codebase",
    "backend/app/services/continuous_rag": "RAG Continuo",
    "backend/app/services/rag": "Sistema RAG",
    "backend/app/services/wiki": "Wiki e Conhecimento",
    "backend/app/services/job": "Jobs e Filas",
    "backend/app/services/watchdog": "Watchdog e Monitoramento",
    "backend/app/services/pattern": "Descoberta de Padroes",
    "backend/app/services/task_executor": "Executor de Tarefas",
    "backend/app/services/spec": "Specs e Frameworks",
    "backend/app/services/orbit_folder": "Estrutura Satellite",
    "backend/app/services": "Servicos Backend",
    "backend/app/api/routes/projects": "API de Projetos",
    "backend/app/api/routes/tasks": "API de Tarefas",
    "backend/app/api/routes/interviews": "API de Entrevistas",
    "backend/app/api/routes/wiki": "API de Wiki",
    "backend/app/api/routes": "API REST",
    "backend/app/models": "Modelos de Dados",
    "backend/app/schemas": "Schemas e Validacao",
    "backend/app/prompts": "Prompts Externalizados",
    "backend/app/contracts": "Contratos IA",
    "backend/app/scripts": "Scripts de Automacao",
    "backend/app": "Backend Core",
    "backend/alembic": "Migracoes de Banco",
    "backend": "Backend Geral",
    # Frontend
    "frontend/src/app/projects": "Frontend Projetos",
    "frontend/src/app/ai": "Frontend IA",
    "frontend/src/app/backlog": "Frontend Backlog",
    "frontend/src/app/jobs": "Frontend Jobs",
    "frontend/src/app/wiki": "Frontend Wiki",
    "frontend/src/app/cost": "Frontend Custos",
    "frontend/src/app": "Frontend Paginas",
    "frontend/src/components/ui": "Componentes UI",
    "frontend/src/components/layout": "Layout e Navegacao",
    "frontend/src/components/interview": "Componentes Entrevista",
    "frontend/src/components": "Componentes Frontend",
    "frontend/src/lib": "Bibliotecas Frontend",
    "frontend": "Frontend Geral",
    # Satellite
    "satellite/docs/PROMPT": "Documentacao de Prompts",
    "satellite/docs/ORBIT": "Documentacao ORBIT",
    "satellite/docs": "Documentacao do Projeto",
    "satellite/knowledge": "Base de Conhecimento",
    "satellite/memory": "Memoria de Execucao IA",
    "satellite": "Satellite KB",
    # External projects
    "projects/suinda/app/Http/Controllers": "Suinda Controllers",
    "projects/suinda/app/Http/Requests": "Suinda Validacoes",
    "projects/suinda/app/Models": "Suinda Models",
    "projects/suinda/resources/views": "Suinda Views",
    "projects/suinda/routes": "Suinda Rotas",
    "projects/suinda/app": "Suinda App",
    "projects/suinda": "Suinda Geral",
    "projects": "Projetos Externos",
}


def classify_source(source_file: str) -> str:
    """Map source file path to domain Epic title using longest prefix match."""
    if not source_file:
        return "Regras Gerais"

    # Try longest prefix first for most specific match
    best_match = ""
    best_domain = "Regras Gerais"
    for prefix, domain in DOMAIN_MAP.items():
        if source_file.startswith(prefix) and len(prefix) > len(best_match):
            best_match = prefix
            best_domain = domain

    return best_domain


def make_story_title(rules: list, index: int, parent_domain: str) -> str:
    """Generate a meaningful story title from the first rule in the group."""
    if rules:
        first = rules[0][:60].strip()
        # Remove numbering prefixes if present
        first = re.sub(r'^\d+[\.\)]\s*', '', first)
        if len(first) > 50:
            first = first[:50] + "..."
        return first
    return f"Area Funcional {index + 1}"


def render_description(title: str, context: str, rules: list, level: str) -> str:
    """Render human-readable description."""
    ac_text = "\n".join(f"- {r[:200]}" for r in rules[:8]) if rules else "- A definir"
    return f"""# {title}

## Contexto

{context}

## Regras de Negocio Aplicaveis

{ac_text}

## Nivel

{level}
"""


def render_prompt(title: str, semantic_map: dict, rules: list, level: str) -> str:
    """Render semantic prompt with references."""
    sm_lines = "\n".join(f"- **{k}**: {v}" for k, v in semantic_map.items())
    rules_text = "\n".join(f"{i+1}. {r[:200]}" for i, r in enumerate(rules[:10]))
    return f"""# {level}: {title}

## Mapa Semantico

{sm_lines}

## Regras de Negocio

{rules_text}

## Instrucoes

Implementar {title} respeitando todas as regras de negocio listadas acima.
Cada criterio de aceitacao deve ser verificavel e testavel.
"""


def make_acceptance_criteria(rules: list) -> list:
    """Convert rules to acceptance criteria."""
    criteria = []
    for r in rules[:6]:
        t = r.strip() if isinstance(r, str) else str(r).strip()
        if len(t) > 20:
            criteria.append(t[:200])
    if not criteria:
        criteria.append("Funcionalidade implementada conforme especificacao")
    return criteria


def insert_card(session, card: dict):
    """Insert a single card into the tasks table."""
    # Map status to kanban column
    column_map = {"backlog": "Backlog", "todo": "To Do", "in_progress": "In Progress", "done": "Done"}
    kanban_column = column_map.get(card["status"], "Backlog")

    session.execute(text("""
        INSERT INTO tasks (
            id, project_id, parent_id, item_type, title,
            description, generated_prompt, acceptance_criteria,
            story_points, priority, status, "order", "column",
            labels, workflow_state, reporter,
            description_edited_by, prompt_edited_by,
            interview_insights, created_at, updated_at
        ) VALUES (
            :id, :project_id, :parent_id, :item_type, :title,
            :description, :generated_prompt, :acceptance_criteria,
            :story_points, :priority, :status, :order, :column,
            :labels, :workflow_state, :reporter,
            :description_edited_by, :prompt_edited_by,
            :interview_insights, :created_at, :updated_at
        )
    """), {
        "id": str(card["id"]),
        "project_id": str(card["project_id"]),
        "parent_id": str(card["parent_id"]) if card["parent_id"] else None,
        "item_type": card["item_type"],
        "title": card["title"][:200],
        "description": card["description"],
        "generated_prompt": card["generated_prompt"],
        "acceptance_criteria": json.dumps(card["acceptance_criteria"]),
        "story_points": card["story_points"],
        "priority": card["priority"],
        "status": card["status"],
        "order": card["order"],
        "column": kanban_column,
        "labels": json.dumps(card["labels"]),
        "workflow_state": card["workflow_state"],
        "reporter": card["reporter"],
        "description_edited_by": card["description_edited_by"],
        "prompt_edited_by": card["prompt_edited_by"],
        "interview_insights": json.dumps(card["interview_insights"]),
        "created_at": card["created_at"],
        "updated_at": card["updated_at"],
    })


def main():
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://orbit:orbit_password@localhost:5432/orbit")
    engine = create_engine(DATABASE_URL)
    Session = sessionmaker(bind=engine)
    session = Session()

    now = datetime.utcnow()

    # ── Step 1: Read ALL business rules from RAG ──
    logger.info("Reading ALL business rules from RAG...")
    result = session.execute(text("""
        SELECT content, metadata->>'source_file' as source_file
        FROM rag_documents
        WHERE project_id = :pid
        AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')
        ORDER BY metadata->>'source_file', created_at
    """), {"pid": str(PROJECT_ID)})

    all_rules = [(row[0], row[1] or "") for row in result]
    logger.info(f"Found {len(all_rules)} business rules (before filtering)")

    # PROMPT #241 - Filter out rules from ignored paths
    ignore_paths_row = session.execute(text(
        "SELECT ignore_paths FROM projects WHERE id = :pid"
    ), {"pid": str(PROJECT_ID)}).first()
    ignore_paths = ignore_paths_row[0] if ignore_paths_row and ignore_paths_row[0] else []
    if ignore_paths:
        before = len(all_rules)
        all_rules = [(c, s) for c, s in all_rules if not any(s.startswith(p) for p in ignore_paths)]
        logger.info(f"📁 Filtered {before - len(all_rules)} rules from ignored paths {ignore_paths} → {len(all_rules)} remaining")

    # ── Step 2: Group rules by domain (Epic) ──
    domain_rules = defaultdict(list)
    for content, source in all_rules:
        domain = classify_source(source)
        domain_rules[domain].append(content)

    logger.info(f"Classified into {len(domain_rules)} domains:")
    for domain, rules in sorted(domain_rules.items(), key=lambda x: -len(x[1])):
        logger.info(f"  {domain}: {len(rules)} rules")

    # ── Step 3: Delete existing cards ──
    deleted = session.execute(text("""
        DELETE FROM tasks WHERE project_id = :pid
    """), {"pid": str(PROJECT_ID)})
    logger.info(f"Deleted {deleted.rowcount} existing cards")
    session.commit()

    # ── Step 4: Generate 3-level hierarchy ──
    counters = {"epic": 0, "story": 0, "task": 0}
    total_cards = 0
    batch_size = 500  # Commit every N cards

    # Sort domains by rule count (largest first)
    sorted_domains = sorted(domain_rules.items(), key=lambda x: -len(x[1]))

    # Determine story points by domain size
    def epic_sp(n_rules):
        if n_rules > 200: return 21
        if n_rules > 100: return 13
        if n_rules > 50: return 8
        if n_rules > 20: return 5
        return 3

    for epic_idx, (domain, rules) in enumerate(sorted_domains):
        epic_id = uuid4()
        epic_sm = {"N1": domain, "P1": f"Dominio: {domain}"}

        # ── EPIC ──
        insert_card(session, {
            "id": epic_id,
            "project_id": PROJECT_ID,
            "parent_id": None,
            "item_type": "epic",
            "title": domain,
            "description": render_description(domain, f"Dominio de negocio com {len(rules)} regras extraidas do codebase.", rules[:6], "Epic"),
            "generated_prompt": render_prompt(domain, epic_sm, rules[:10], "EPIC"),
            "acceptance_criteria": make_acceptance_criteria(rules[:6]),
            "story_points": epic_sp(len(rules)),
            "priority": "high" if len(rules) > 50 else "medium",
            "status": "backlog",
            "order": epic_idx,
            "labels": ["from_rag"],
            "workflow_state": "open",
            "reporter": "system",
            "description_edited_by": "ai",
            "prompt_edited_by": "ai",
            "interview_insights": {"semantic_map": epic_sm, "source": "rag_business_rules"},
            "created_at": now,
            "updated_at": now,
        })
        counters["epic"] += 1
        total_cards += 1

        # ── STORIES (batches of RULES_PER_STORY) ──
        num_stories = max(1, math.ceil(len(rules) / RULES_PER_STORY))
        for story_idx in range(num_stories):
            s_start = story_idx * RULES_PER_STORY
            story_rules = rules[s_start:s_start + RULES_PER_STORY]
            story_title = make_story_title(story_rules, story_idx, domain)
            story_sm = {**epic_sm, f"S{story_idx+1}": story_title}
            story_id = uuid4()

            insert_card(session, {
                "id": story_id,
                "project_id": PROJECT_ID,
                "parent_id": epic_id,
                "item_type": "story",
                "title": story_title,
                "description": render_description(story_title, f"Area funcional dentro de {domain}", story_rules, "Story"),
                "generated_prompt": render_prompt(story_title, story_sm, story_rules, "STORY"),
                "acceptance_criteria": make_acceptance_criteria(story_rules),
                "story_points": 5 if len(story_rules) > 8 else 3,
                "priority": "high" if len(story_rules) > 10 else "medium",
                "status": "backlog",
                "order": story_idx,
                "labels": ["from_rag"],
                "workflow_state": "open",
                "reporter": "system",
                "description_edited_by": "ai",
                "prompt_edited_by": "ai",
                "interview_insights": {"semantic_map": story_sm, "derived_from": str(epic_id), "source": "rag_business_rules"},
                "created_at": now,
                "updated_at": now,
            })
            counters["story"] += 1
            total_cards += 1

            # ── TASKS (groups of RULES_PER_TASK) ──
            num_tasks = max(1, math.ceil(len(story_rules) / RULES_PER_TASK))
            for task_idx in range(num_tasks):
                t_start = task_idx * RULES_PER_TASK
                task_rules = story_rules[t_start:t_start + RULES_PER_TASK]
                task_title_base = task_rules[0] if task_rules else f"Task {task_idx+1}"
                task_title = (task_title_base[:80] + "...") if len(task_title_base) > 80 else task_title_base
                task_sm = {**story_sm, f"T{task_idx+1}": task_title[:60]}
                task_id = uuid4()

                insert_card(session, {
                    "id": task_id,
                    "project_id": PROJECT_ID,
                    "parent_id": story_id,
                    "item_type": "task",
                    "title": task_title,
                    "description": render_description(task_title, f"Tarefa dentro de: {story_title}", task_rules, "Task"),
                    "generated_prompt": render_prompt(task_title, task_sm, task_rules, "TASK"),
                    "acceptance_criteria": make_acceptance_criteria(task_rules),
                    "story_points": 3,
                    "priority": "medium",
                    "status": "backlog",
                    "order": task_idx,
                    "labels": ["from_rag"],
                    "workflow_state": "open",
                    "reporter": "system",
                    "description_edited_by": "ai",
                    "prompt_edited_by": "ai",
                    "interview_insights": {"semantic_map": task_sm, "derived_from": str(story_id), "source": "rag_business_rules"},
                    "created_at": now,
                    "updated_at": now,
                })
                counters["task"] += 1
                total_cards += 1

            # Commit in batches
            if total_cards % batch_size < RULES_PER_TASK + 2:
                session.commit()
                logger.info(f"  Committed batch... {total_cards} cards so far")

        logger.info(f"EPIC {epic_idx}: {domain} ({len(rules)} rules) -> {num_stories} stories")

    # Final commit
    session.commit()

    # ── Step 5: Verify ──
    logger.info("=" * 60)
    logger.info(f"GENERATION COMPLETE")
    logger.info(f"=" * 60)
    logger.info(f"Epics:    {counters['epic']}")
    logger.info(f"Stories:  {counters['story']}")
    logger.info(f"Tasks:    {counters['task']}")
    logger.info(f"TOTAL:    {total_cards}")
    logger.info(f"Rules covered: {len(all_rules)}")

    # DB verification
    result = session.execute(text("""
        SELECT item_type, COUNT(*),
               COUNT(CASE WHEN workflow_state = 'open' THEN 1 END) as open_count,
               COUNT(CASE WHEN description_edited_by = 'ai' THEN 1 END) as ai_count,
               COUNT(CASE WHEN generated_prompt IS NOT NULL AND generated_prompt != '' THEN 1 END) as prompt_count
        FROM tasks WHERE project_id = :pid
        GROUP BY item_type ORDER BY item_type
    """), {"pid": str(PROJECT_ID)})

    logger.info("\nDB Verification:")
    logger.info(f"{'type':>10} {'count':>6} {'open':>6} {'ai_ed':>6} {'prompt':>6}")
    for row in result:
        logger.info(f"{row[0]:>10} {row[1]:>6} {row[2]:>6} {row[3]:>6} {row[4]:>6}")

    session.close()
    logger.info("\nDone!")


if __name__ == "__main__":
    main()
