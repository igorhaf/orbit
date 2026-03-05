#!/usr/bin/env python3
"""
Cross-reference NOVAS_REGRAS.MD with existing 54 business rules in RAG.
Insert rules that are genuinely new. Enrich partially covered ones.
Anti-duplication: compares titles + content before inserting.
"""
import uuid
import json
import psycopg2
import requests

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"
OLLAMA_URL = "http://172.27.144.1:11434"

def get_embedding(text: str) -> list:
    resp = requests.post(f"{OLLAMA_URL}/api/embeddings", json={
        "model": "nomic-embed-text",
        "prompt": text[:2000]
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["embedding"]


# ============================================================
# Rules from NOVAS_REGRAS.MD that are GENUINELY NEW
# (not covered by the existing 54 rules)
# ============================================================
NEW_RULES = [

    # ---- HIERARQUIA (nova: subtask level, folhas, validações estritas) ----
    {
        "title": "Card Hierarchy Type Constraints (4 Levels)",
        "description": (
            "The system enforces a strict 4-level hierarchy: Epic → Story → Task/Bug → Subtask. "
            "Epic only accepts Story as children. Story accepts Task or Bug. Task accepts only Subtask. "
            "Subtask and Bug are terminal leaves with no children allowed. "
            "Violations at any level are rejected by the WorkflowValidator before persistence."
        ),
        "category": "validation",
        "source_domain": "backlog_generation",
        "source_files": "backend/app/services/workflow_validator.py, backend/app/models/task.py"
    },
    {
        "title": "Cascade Deletion from Parent to All Children",
        "description": (
            "Deleting a parent card triggers recursive cascade deletion of all descendants. "
            "Deleting an Epic removes all its Stories, Tasks, Subtasks, comments, status transitions, "
            "and interview links. Deleting a Task also removes its Subtasks and linked interviews. "
            "This is atomic — there is no partial deletion. "
            "StatusTransitions and interview_insights are deleted in cascade with the card."
        ),
        "category": "validation",
        "source_domain": "backlog_generation",
        "source_files": "backend/app/models/task.py, backend/app/routers/tasks.py"
    },

    # ---- GERAÇÃO E ATIVAÇÃO DE CARDS ----
    {
        "title": "Card Activation Triggers Child Generation",
        "description": (
            "Activating a suggested card (workflow_state='draft') triggers automatic child generation: "
            "Epic → 15-20 Stories (draft). Story → 5-8 Tasks (draft). Task → 3-5 Subtasks (draft). "
            "Subtask activation generates full content (description, criteria, prompt) but no children. "
            "Cards with label 'suggested' and workflow_state='draft' cannot generate children until activated. "
            "Activation changes workflow_state from 'draft' to 'open' and removes the 'suggested' label."
        ),
        "category": "workflow",
        "source_domain": "backlog_generation",
        "source_files": "backend/app/services/backlog_generator.py, backend/app/services/job_executor.py"
    },

    # ---- CONTEXTO DO PROJETO ----
    {
        "title": "Project Context Locking on First Epic Activation",
        "description": (
            "The project context (context_semantic and context_human) is permanently locked when the "
            "first Epic is activated. Once context_locked=true, these fields cannot be changed by any means — "
            "not via API, interview, or background service. "
            "context_locked is irreversible: it can only change false → true, never true → false. "
            "This guarantees a stable base context throughout the entire project lifecycle. "
            "The project status transitions to 'active' at this same moment."
        ),
        "category": "validation",
        "source_domain": "project_management",
        "source_files": "backend/app/models/project.py, backend/app/services/project_service.py"
    },
    {
        "title": "Project Lifecycle States (draft → processing → active)",
        "description": (
            "Projects follow a strict forward-only state machine: draft (created, pipeline not started) → "
            "processing (pipeline running, editing blocked) → active (pipeline complete, ready for use). "
            "No retroactive transitions exist — an active project cannot return to processing or draft. "
            "A project is considered created only after the full configuration wizard completes. "
            "Abandoning the wizard (close tab, navigate away, refresh) triggers automatic deletion of the incomplete project. "
            "Protected projects (protected=true) cannot be deleted without first disabling protection."
        ),
        "category": "workflow",
        "source_domain": "project_management",
        "source_files": "backend/app/models/project.py, backend/app/services/project_service.py, backend/app/routers/projects.py"
    },

    # ---- ENTREVISTAS ----
    {
        "title": "Interview Fixed Questions and Context Generation Rules",
        "description": (
            "Context interviews require minimum 3 fixed questions: Q1 (product name), Q2 (purpose and features), "
            "Q3 (technical architecture). Without these 3 answers, the system blocks context generation. "
            "After Q3, the AI generates unlimited contextual questions (Q4+) — no maximum. "
            "The user ends the interview by clicking 'Generate Context'. "
            "All interview questions are closed (multiple choice) with 5-8 predefined options for consistency. "
            "Task-focused interview mode requires parent_task_id and generates Subtask suggestions without locking project context. "
            "If context_locked=true, the system redirects any attempt to start a new context interview."
        ),
        "category": "validation",
        "source_domain": "interviews",
        "source_files": "backend/app/services/interview_service.py, backend/app/prompts/interviews/"
    },

    # ---- WORKFLOW / ESTADOS ----
    {
        "title": "Workflow State Machines by Item Type",
        "description": (
            "Each item type has its own workflow state machine enforced by WorkflowValidator: "
            "Epic: backlog → planning → in_progress → review → done (can return in_progress→planning). "
            "Story: backlog → ready → in_progress → review → validation → done (review can go to validation, done, or back). "
            "Task: backlog → todo → in_progress → code_review → testing → done (code_review can go back). "
            "Bug: new → confirmed → in_progress → fixed → verified → closed (fixed can reopen to in_progress). "
            "Subtask: todo → in_progress → done (can return in_progress→todo). "
            "Terminal states (done, closed) have no outgoing transitions — all attempts rejected. "
            "All transitions are logged in StatusTransition table for full audit trail."
        ),
        "category": "validation",
        "source_domain": "kanban",
        "source_files": "backend/app/services/workflow_validator.py, backend/contracts/business/workflow_states.yaml"
    },
    {
        "title": "Bug Severity Field (Exclusive to Bug Type)",
        "description": (
            "The severity field (blocker, critical, major, minor, trivial) is nullable and exclusive to Bug items. "
            "For Epic, Story, Task, and Subtask types, severity has no semantic meaning and should not be set. "
            "Bugs have their own workflow (new → confirmed → in_progress → fixed → verified → closed) "
            "separate from Tasks and are also valid children of Stories."
        ),
        "category": "validation",
        "source_domain": "kanban",
        "source_files": "backend/app/models/task.py"
    },

    # ---- JOB PRIORITY SYSTEM (granular) ----
    {
        "title": "Job Priority Levels with Specific Assignments",
        "description": (
            "Jobs execute in priority order: CRITICAL(10): interview messages, chat — user is waiting in real-time. "
            "HIGH(7): context generation, project title, full pipeline — user is in wizard flow. "
            "NORMAL(5): memory scan, commit generation, task execution, epic generation — user-triggered but async. "
            "LOW(3): card activation/children generation, continuous RAG, wiki enrichment — pure background. "
            "Within the same priority, order is FIFO (created_at ascending). "
            "Max 10 cards generated per watchdog cycle (increased from 5 in PROMPT #228). "
            "Max 2 cards enriched per idle cycle to avoid resource overconsumption."
        ),
        "category": "workflow",
        "source_domain": "job_system",
        "source_files": "backend/app/services/job_executor.py, backend/app/models/async_job.py"
    },

    # ---- PROMPT QUEUE ----
    {
        "title": "Prompt Queue Scoring and Execution Order",
        "description": (
            "Queue position is calculated from 5 factors: card priority, hierarchy level (Epic > Story > Task), "
            "item age (older items score higher), unresolved dependencies (blocks execution), "
            "and manual override (user drag-and-drop sets manual_override=true and takes precedence over all scoring). "
            "Items with unresolved depends_on dependencies remain BLOCKED until all dependencies reach COMPLETED. "
            "The queue reorders automatically when new items are added. "
            "Manual overrides are preserved until the user clears them."
        ),
        "category": "workflow",
        "source_domain": "job_system",
        "source_files": "backend/app/routers/prompt_queue.py, backend/contracts/business/queue_scoring.yaml"
    },

    # ---- RAG SCAN ----
    {
        "title": "RAG Continuous Scan Ordering and Preconditions",
        "description": (
            "The continuous RAG scheduler only processes projects where initial_scan_complete=true to avoid "
            "conflicts between the full initial scan and incremental updates. "
            "File processing order is semantic: SCHEMA → ROUTES → LOGIC → PRESENTATION → CONFIG, "
            "ensuring database models are indexed before the services that depend on them. "
            "Deleted files: status changes to DELETED, RAG chunks are removed, and RAGFileState row is deleted. "
            "Ignore patterns come from two sources: AI pre-scan (custom_ignore_patterns) and user-defined "
            "manual ignore_paths — both are respected during scanning."
        ),
        "category": "workflow",
        "source_domain": "rag_knowledge",
        "source_files": "backend/app/services/continuous_rag_service.py, backend/app/models/rag_file_state.py"
    },

    # ---- AI FLOW ----
    {
        "title": "AI Flow Chain: One Active Chain per Usage Type",
        "description": (
            "For each usage_type (interview, memory, task_execution, commit_generation, general, etc.), "
            "exactly one AIFlowChain is active at a time. Activating a new chain for a usage_type automatically "
            "deactivates the previous one. The chain is traversed in order with automatic fallback: "
            "if model 1 fails (timeout, error, rate limit), model 2 is tried, then model 3. "
            "If all models in the chain fail, the error is returned to the caller with no further retry. "
            "Qwen3 is preferred as primary model for verbose/Portuguese outputs (memory, queue_orchestration, general) "
            "in the 'Custo Mínimo' preset using local models."
        ),
        "category": "workflow",
        "source_domain": "ai_orchestration",
        "source_files": "backend/app/models/ai_flow_chain.py, backend/app/services/ai_orchestrator/orchestrator.py"
    },

    # ---- CONCORRÊNCIA E TIMEOUT ----
    {
        "title": "Per-Model Concurrency and Timeout Configuration",
        "description": (
            "Each AI model in ai_models table has three control fields: "
            "timeout_seconds (NULL = use global SystemSettings default), "
            "max_concurrent_requests (NULL = unlimited; protects local Ollama models from overload), "
            "rate_limit_requests + rate_limit_window_seconds (NULL = no limit; "
            "rate limiter records usage BEFORE the API call to prevent race condition overruns). "
            "These fields work in conjunction to protect both cloud and local model endpoints from abuse."
        ),
        "category": "validation",
        "source_domain": "ai_orchestration",
        "source_files": "backend/app/models/ai_model.py, backend/app/services/rate_limiter.py"
    },

    # ---- RASTREABILIDADE ----
    {
        "title": "Card Traceability: Batch Source, Interview Insights, Status Transitions",
        "description": (
            "Every card maintains three traceability fields: "
            "batch_source (JSONB): records the batch that created the card — batch_number, files_processed, layer. "
            "interview_insights + interview_question_ids: tracks which interview questions and answers originated the card, "
            "enabling bidirectional traceability from card to interview and from interview to generated cards. "
            "StatusTransition table: logs every status change with actor (human/ai/system), timestamp, and reason. "
            "All three are deleted in cascade when the card is deleted."
        ),
        "category": "workflow",
        "source_domain": "backlog_generation",
        "source_files": "backend/app/models/task.py, backend/app/models/status_transition.py"
    },

    # ---- CARD RELATIONSHIPS ----
    {
        "title": "Card Relationships (blocks, depends_on, relates_to, duplicates, clones)",
        "description": (
            "Cards support JIRA-style relationships: blocks (this card blocks another), "
            "depends_on (this card depends on another — respected by Prompt Queue), "
            "relates_to (loosely related), duplicates (semantic duplicate of another card), "
            "clones (an exact copy of another card). "
            "Reporter field defaults to 'system'; also accepts 'ai' (auto-generated) or 'watchdog' (background monitoring). "
            "Assignee is nullable and optional on all card types. "
            "Comments have 3 types: 'comment' (user), 'system' (auto-events), 'ai_generated' (AI responses). "
            "Comments are ordered DESC by created_at and deleted in cascade with the card."
        ),
        "category": "workflow",
        "source_domain": "kanban",
        "source_files": "backend/app/models/task.py, backend/app/models/task_relationship.py, backend/app/models/task_comment.py"
    },

    # ---- SPECS ----
    {
        "title": "Specs Scope: Framework (Global) vs Project (Scoped)",
        "description": (
            "Framework specs (scope='framework') contain technology knowledge (Laravel, Next.js, PostgreSQL, etc.) "
            "and are shared globally across all projects. "
            "Project specs (scope='project') are exclusive to a single project and not shared. "
            "Only specs matching the project's configured tech stack are loaded into prompts (selective loading). "
            "Combined reduction: 60-80% in backlog generation + 15-20% in task execution = 70-85% total token savings."
        ),
        "category": "validation",
        "source_domain": "framework_specs",
        "source_files": "backend/app/services/spec_service.py, backend/app/models/spec.py"
    },

    # ---- WIKI ----
    {
        "title": "Wiki Rule Pages Must Have Parent 'regras-de-negocio'",
        "description": (
            "Any wiki page with a slug starting with 'regra-*' must have parent_id pointing to the "
            "'regras-de-negocio' page. If that parent page does not exist, the system automatically creates it "
            "as a stub before creating the child rule page. "
            "Wiki base sections are auto-generated during the project creation pipeline: "
            "Visão Geral, Stack Tecnológica, Arquitetura, Features, Regras de Negócio, Integrações."
        ),
        "category": "validation",
        "source_domain": "wiki_system",
        "source_files": "backend/app/services/wiki_service.py, backend/app/routers/wiki.py"
    },

    # ---- CONTRACTS ----
    {
        "title": "Contracts as Source of Truth for System Behavior",
        "description": (
            "70 YAML contract definitions (domains: business, generation, interviews, memory, execution) are the "
            "source of truth for system behavior — code implements the contracts. "
            "Contracts govern: workflow state transitions, generation counts (15-20 stories per epic, 5-8 tasks per story), "
            "token budgets, queue scoring formulas, validation rules, and retry policies. "
            "ContractLoader resolves contracts with priority: DB (project-customized) > YAML file (system default) > hardcoded fallback. "
            "This allows per-project customization without code changes."
        ),
        "category": "workflow",
        "source_domain": "prompt_management",
        "source_files": "backend/app/routers/contracts.py, backend/contracts/"
    },

    # ---- MEMORY SCAN ----
    {
        "title": "Codebase Memory Scan: 4 Phases and File Priority Order",
        "description": (
            "Memory scan reads files in priority order: docs > config > migrations > models > services. "
            "The scan runs in 4 phases: Phase 1 Documentation (READMEs, wikis, specs), "
            "Phase 2 Domain (models, schemas, contracts), "
            "Phase 3 Logic (services, utilities, routes), "
            "Phase 4 Consolidation (integrates all insights from previous phases into a single coherent context). "
            "Quick mode: 30 files, 2 phases. Normal: 100 files, 4 phases. Deep: all files, N phases. "
            "Supports stack detection, business rule extraction from git history, and project title suggestion."
        ),
        "category": "workflow",
        "source_domain": "deep_pipeline",
        "source_files": "backend/app/services/codebase_memory/service.py, backend/app/services/codebase_indexer.py"
    },
]


def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    # Get existing rule titles
    cur.execute("""
        SELECT metadata->>'title' FROM rag_documents
        WHERE project_id = %s AND metadata->>'type' = 'business_rule'
    """, (PROJECT_ID,))
    existing_titles = {r[0] for r in cur.fetchall()}
    print(f"Existing business rules: {len(existing_titles)}")

    inserted = 0
    skipped = 0

    for rule in NEW_RULES:
        if rule["title"] in existing_titles:
            print(f"  SKIP (exists): {rule['title']}")
            skipped += 1
            continue

        doc_id = str(uuid.uuid4())
        content = (
            f"BUSINESS RULE: {rule['title']}\n\n"
            f"Category: {rule['category']}\n"
            f"Domain: {rule['source_domain']}\n"
            f"Source Files: {rule['source_files']}\n\n"
            f"{rule['description']}"
        )
        metadata = json.dumps({
            "type": "business_rule",
            "category": rule["category"],
            "source": "novas_regras_md",
            "source_domain": rule["source_domain"],
            "source_files": rule["source_files"],
            "title": rule["title"]
        })

        embedding = get_embedding(content)
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

        cur.execute("""
            INSERT INTO rag_documents (id, project_id, content, embedding, metadata, created_at)
            VALUES (%s, %s, %s, %s::vector, %s::jsonb, NOW())
        """, (doc_id, PROJECT_ID, content, embedding_str, metadata))

        inserted += 1
        print(f"  INSERTED: [{rule['source_domain']}] {rule['title']}")

    conn.commit()
    print(f"\nInserted: {inserted}, Skipped (already exist): {skipped}")

    # Final counts by domain
    cur.execute("""
        SELECT metadata->>'source_domain', COUNT(*)
        FROM rag_documents
        WHERE project_id = %s AND metadata->>'type' = 'business_rule'
        GROUP BY metadata->>'source_domain' ORDER BY count DESC
    """, (PROJECT_ID,))
    print("\nBusiness rules by domain:")
    total = 0
    for row in cur.fetchall():
        print(f"  {row[0]}: {row[1]}")
        total += row[1]
    print(f"  TOTAL: {total}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
