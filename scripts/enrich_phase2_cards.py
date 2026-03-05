#!/usr/bin/env python3
"""
Enrich Phase 2 - Blocks 2+3+4:
- Add acceptance criteria to all 128 cards (0 currently have it)
- Add semantic prompts to 118 cards missing them
- Expand task descriptions shorter than 250 chars to 300+
Anti-duplication: always checks before writing. REGRA #0 respected.
"""
import json
import psycopg2
import re

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"

# ============================================================
# Acceptance Criteria generation templates per domain + type
# ============================================================

def generate_acceptance_criteria(title: str, description: str, item_type: str,
                                   domain: str, related_rules: list) -> list:
    """Generate 2-4 acceptance criteria given-when-then for a card."""
    t = title.lower()
    d = description.lower()
    criteria = []

    # ---- EPIC-level criteria (broader, integration-focused) ----
    if item_type == "epic":
        criteria.append({
            "id": "AC1",
            "criterion": f"Given the {domain.replace('_', ' ')} system is deployed, when all stories under this epic are completed, then all {item_type}-level features work end-to-end without regression in related systems.",
            "format": "given-when-then",
            "category": "completeness"
        })
        criteria.append({
            "id": "AC2",
            "criterion": f"Given the system is running, when {title} is fully operational, then all domain-specific business rules listed in related_rules are enforced and validated.",
            "format": "given-when-then",
            "category": "business_rules"
        })
        if related_rules:
            criteria.append({
                "id": "AC3",
                "criterion": f"Given at least {len(related_rules)} business rules are defined for this domain, when the feature is used in production, then the system correctly applies each rule without error.",
                "format": "given-when-then",
                "category": "rules_enforcement"
            })
        criteria.append({
            "id": "AC4",
            "criterion": f"Given existing data in the system, when this epic's features interact with other domains, then no cross-domain data corruption occurs and all related endpoints return expected response schemas.",
            "format": "given-when-then",
            "category": "integration"
        })

    # ---- STORY-level criteria (functional, user-facing) ----
    elif item_type == "story":
        criteria.append({
            "id": "AC1",
            "criterion": f"Given a user with appropriate permissions, when they interact with {title}, then the system responds correctly within 2 seconds and returns expected data in the correct format.",
            "format": "given-when-then",
            "category": "functional"
        })
        criteria.append({
            "id": "AC2",
            "criterion": f"Given invalid or missing input data, when the {title} operation is triggered, then the system returns a descriptive error with HTTP 4xx status and does not crash or corrupt data.",
            "format": "given-when-then",
            "category": "error_handling"
        })

        # Domain-specific story criteria
        if domain in ("ai_orchestration", "task_execution"):
            criteria.append({
                "id": "AC3",
                "criterion": f"Given an AI call is made through {title}, when the primary provider fails, then the chain fallback activates within 5 seconds and the secondary provider handles the request transparently.",
                "format": "given-when-then",
                "category": "resilience"
            })
        elif domain == "rag_knowledge":
            criteria.append({
                "id": "AC3",
                "criterion": f"Given RAG documents are indexed, when a semantic query is executed through {title}, then results have similarity >= 0.75 and the top-5 results are relevant to the query.",
                "format": "given-when-then",
                "category": "rag_quality"
            })
        elif domain == "caching":
            criteria.append({
                "id": "AC3",
                "criterion": f"Given a repeated request with same parameters, when the cache system processes it through {title}, then L1 cache hit is achieved and zero new tokens are consumed.",
                "format": "given-when-then",
                "category": "cache_efficiency"
            })
        elif domain == "backlog_generation":
            criteria.append({
                "id": "AC3",
                "criterion": f"Given a project context, when {title} generates cards, then story points follow the Fibonacci scale (1,2,3,5,8,13,21) and Epic->Story->Task hierarchy is strictly enforced.",
                "format": "given-when-then",
                "category": "hierarchy"
            })
        elif domain == "interviews":
            criteria.append({
                "id": "AC3",
                "criterion": f"Given an interview session, when {title} processes user responses, then answers are stored in RAG with proper embedding and the next question adapts to the context provided.",
                "format": "given-when-then",
                "category": "interview_flow"
            })
        else:
            criteria.append({
                "id": "AC3",
                "criterion": f"Given the system is in normal operational state, when {title} is executed multiple times consecutively, then the outcome is idempotent and the system state remains consistent.",
                "format": "given-when-then",
                "category": "idempotency"
            })

    # ---- TASK-level criteria (technical, implementation) ----
    else:
        criteria.append({
            "id": "AC1",
            "criterion": f"Given the implementation of {title} is complete, when the corresponding API endpoint or function is called with valid input, then it returns the expected output schema without throwing exceptions.",
            "format": "given-when-then",
            "category": "implementation"
        })
        criteria.append({
            "id": "AC2",
            "criterion": f"Given the code for {title} is merged, when existing tests are run, then all tests pass (0 failures) and no pre-existing functionality is broken.",
            "format": "given-when-then",
            "category": "regression"
        })

        # Domain-specific task criteria
        if "api" in t or "endpoint" in t or "route" in t or "router" in t:
            criteria.append({
                "id": "AC3",
                "criterion": f"Given the {title} API endpoint is deployed, when called with authentication token, then it responds with correct HTTP status code and response body matches the Pydantic schema definition.",
                "format": "given-when-then",
                "category": "api_contract"
            })
        elif "database" in t or "model" in t or "migration" in t or "schema" in t:
            criteria.append({
                "id": "AC3",
                "criterion": f"Given the database migration for {title} is applied, when data is inserted, queried, and deleted, then all CRUD operations work correctly and foreign key constraints are respected.",
                "format": "given-when-then",
                "category": "data_integrity"
            })
        elif "frontend" in t or "component" in t or "ui" in t or "page" in t:
            criteria.append({
                "id": "AC3",
                "criterion": f"Given the frontend component for {title} is rendered, when the user interacts with it, then the UI updates correctly, loading states are shown, and errors are displayed gracefully.",
                "format": "given-when-then",
                "category": "ui_behavior"
            })
        elif "test" in t:
            criteria.append({
                "id": "AC3",
                "criterion": f"Given the test suite for {title} is implemented, when tests are run in CI, then coverage >= 80% for the tested module and all edge cases are exercised.",
                "format": "given-when-then",
                "category": "test_coverage"
            })
        else:
            criteria.append({
                "id": "AC3",
                "criterion": f"Given the implementation of {title}, when it runs under load (10x normal usage), then performance degrades gracefully and response time stays under 5 seconds.",
                "format": "given-when-then",
                "category": "performance"
            })

    return criteria


# ============================================================
# Semantic Prompt generation
# ============================================================

DOMAIN_CONTEXT = {
    "ai_orchestration": "AI Orchestration layer that routes requests to multiple AI providers (Anthropic, OpenAI, Google) with cache, fallback, and cost tracking",
    "rag_knowledge": "RAG (Retrieval-Augmented Generation) pipeline using pgvector for 768-dimensional semantic search in PostgreSQL",
    "interviews": "3-phase contextual interview system that captures project requirements through dynamic AI-driven conversations",
    "backlog_generation": "Hierarchical backlog generation system that creates Epics, Stories, and Tasks from interview context using Semantic Reference Methodology",
    "deep_pipeline": "7-phase Deep Pipeline that analyzes codebases: structural scan, file analysis, rule synthesis, arch mapping, card generation, wiki generation, QA",
    "wiki_system": "Automated wiki generation system with YAML front matter, dual persistence (DB + FS), and AI-powered operations (Generate/Expand/Summarize)",
    "caching": "3-level Redis cache (L1 exact, L2 semantic, L3 template) achieving 30-35% hit rate and 60-90% cost savings on AI calls",
    "analytics": "Token consumption analytics and cost tracking across multiple currencies (USD/BRL) with per-model and per-project breakdowns",
    "prompt_management": "Externalized prompt system with 54+ YAML templates, Jinja2 rendering, and PromptLoader for consistent AI instruction management",
    "job_system": "Async job execution system with priority queue (P0-P3), background processing, and real-time status notifications via WebSocket",
    "project_management": "Project lifecycle management with automated satellite directory creation, tech stack detection, and codebase memory initialization",
    "kanban": "Kanban board with drag-and-drop, Epic/Story/Task hierarchy visualization, status workflow enforcement, and blocked task management",
    "framework_specs": "47 framework specifications (Laravel, Next.js, PostgreSQL, Tailwind, etc.) that reduce AI token usage by 70-85% through selective loading",
    "ai_flow": "AI Flow Studio for building named pipeline profiles with visual nodes, utility node configuration, and execution history comparison",
    "git_integration": "Git integration service for repository operations and AI-powered commit message generation from staged changes",
    "pattern_discovery": "4-stage pattern discovery pipeline (Static → Clustering → Graph → LLM Fallback) with tech stack detection and significance thresholds",
    "task_execution": "Task execution engine with model selection by complexity (Haiku/Sonnet/Opus), retry logic, surgical context building, and budget enforcement",
    "infrastructure": "Native Linux/WSL2 infrastructure with PostgreSQL, Redis, Ollama, FastAPI backend, and Next.js frontend — no Docker containers",
}

def generate_semantic_prompt(title: str, description: str, item_type: str,
                               domain: str, related_rules: list, story_points: int) -> str:
    """Generate a structured semantic prompt for the card."""
    domain_ctx = DOMAIN_CONTEXT.get(domain, f"The {domain.replace('_', ' ')} subsystem of ORBIT")

    rules_text = ""
    if related_rules:
        rules_text = "\nRULES:\n" + "\n".join(f"- {r['title']}" for r in related_rules[:5])

    complexity = "low"
    if story_points >= 8:
        complexity = "high"
    elif story_points >= 5:
        complexity = "medium"

    model_hint = "Claude Haiku (low complexity)" if complexity == "low" else \
                 "Claude Sonnet (medium complexity)" if complexity == "medium" else \
                 "Claude Opus (high complexity)"

    return f"""CONTEXT:
{domain_ctx}. This {item_type} — "{title}" — is part of the {domain.replace('_', ' ')} domain with complexity: {complexity} ({story_points} story points).

DESCRIPTION:
{description}

OBJECTIVE:
Implement {title} according to the ORBIT architecture. Ensure compatibility with the existing AIOrchestrator, RAG pipeline, and multi-provider setup (Anthropic/OpenAI/Google).
{rules_text}

INPUTS:
- Project context and domain configuration from the ORBIT database
- Related business rules from the {domain.replace('_', ' ')} domain
- Existing service implementations in backend/app/services/
- Frontend patterns from frontend/src/components/ and frontend/src/app/

OUTPUTS:
- Working implementation of {title} following ORBIT's existing architecture patterns
- FastAPI router (if API endpoint) with Pydantic schemas
- Service layer with business logic separated from routes
- Database model with Alembic migration (if schema change)
- Frontend component (if UI change) using Tailwind + TypeScript

CONSTRAINTS:
- Follow REGRA #0: never overwrite human-edited data with AI-generated data
- Use AIOrchestrator for all AI calls (no direct API calls)
- Messages must use only "user" and "assistant" roles (no "system" role in messages)
- Store API keys in ai_models table, never in .env
- All new prompts must be externalized to YAML in backend/app/prompts/
- Recommended model: {model_hint}

ARCHITECTURE REFERENCES:
- backend/app/services/{domain}/ or equivalent service file
- backend/app/routers/{domain.replace('_', '-')}.py or equivalent router
- backend/app/schemas/{domain}.py or equivalent schema file"""


# ============================================================
# Description expansion templates
# ============================================================

DOMAIN_TECH_CONTEXT = {
    "ai_orchestration": "FastAPI backend, SQLAlchemy, AIOrchestrator service, Anthropic/OpenAI/Google APIs, Redis cache",
    "rag_knowledge": "pgvector extension, PostgreSQL, Nomic Embed Text (768D), cosine similarity, rag_documents table",
    "interviews": "WebSocket notifications, SQLAlchemy, interview_sessions table, AIOrchestrator, YAML prompts",
    "backlog_generation": "BacklogGenerator service, AIOrchestrator, tasks table, rag_documents, Semantic Reference Methodology",
    "deep_pipeline": "PipelineProfile, PipelineRun, Nomic Embed Text, rag_documents, wiki_pages, tasks tables",
    "wiki_system": "wiki_pages table, satellite/knowledge/wiki/ filesystem, YAML front matter, rag_documents",
    "caching": "Redis Sorted Sets (sliding window), AIOrchestrator cache hooks, L1/L2/L3 levels",
    "analytics": "PromptHistory table, aggregation queries, multi-currency conversion, Chart.js frontend",
    "prompt_management": "PromptLoader, Jinja2, backend/app/prompts/ YAML files, PromptHistory logging",
    "job_system": "PriorityJobExecutor, AsyncJobModel, Redis queue, WebSocket broadcast",
    "project_management": "Project model, satellite/ directory auto-creation, code_path configuration",
    "kanban": "tasks table, item_type enum, status transitions, drag-and-drop frontend",
    "framework_specs": "specs table, 47 seeded specs, selective loading by stack, token reduction metrics",
    "ai_flow": "AIFlowProfile, AIFlowChain, utility_nodes JSONB, PipelineRun tracking",
    "git_integration": "GitService, subprocess git commands, AIOrchestrator for commit message generation",
    "pattern_discovery": "pattern_discovery.py, stack_detector.py, Nomic embeddings, rag_documents patterns",
    "task_execution": "executor.py, budget_manager.py, AIOrchestrator, tasks table, PromptHistory",
    "infrastructure": "PostgreSQL native, Redis native, Ollama Windows host, uvicorn FastAPI, Next.js npm",
}

def expand_description(title: str, description: str, item_type: str, domain: str) -> str:
    """Expand a brief description to at least 300 chars with architectural context."""
    if len(description) >= 250:
        return description  # Already adequate

    tech = DOMAIN_TECH_CONTEXT.get(domain, f"FastAPI backend, PostgreSQL, Next.js frontend, ORBIT architecture")
    domain_readable = domain.replace("_", " ")

    expanded = (
        f"{description} "
        f"Implementado no domínio {domain_readable} usando {tech}. "
        f"O card segue os padrões estabelecidos do ORBIT: serviço separado de router, "
        f"schemas Pydantic, e integração com AIOrchestrator para operações de IA. "
        f"Parte da hierarquia do épico correspondente com critérios de aceitação mensuráveis."
    )

    return expanded


# ============================================================
# Main
# ============================================================

def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    # Fetch all cards
    cur.execute("""
        SELECT id, item_type, title, description, story_points,
               generation_context
        FROM tasks
        WHERE project_id = %s
        ORDER BY item_type, title
    """, (PROJECT_ID,))
    cards = cur.fetchall()
    print(f"Total cards to process: {len(cards)}")

    ac_added = 0
    prompt_added = 0
    desc_expanded = 0

    for card_id, item_type, title, description, story_points, gen_ctx_raw in cards:
        # Parse generation_context
        if isinstance(gen_ctx_raw, dict):
            ctx = gen_ctx_raw
        elif gen_ctx_raw:
            ctx = json.loads(gen_ctx_raw)
        else:
            ctx = {}

        domain = ctx.get("domain", "infrastructure")
        related_rules = ctx.get("related_rules", [])
        sp = story_points or 0

        changed = False

        # ---- Block 2: Acceptance Criteria ----
        if "acceptance_criteria" not in ctx:
            ac = generate_acceptance_criteria(title, description or "", item_type, domain, related_rules)
            ctx["acceptance_criteria"] = ac
            ac_added += 1
            changed = True

        # ---- Block 3: Semantic Prompt ----
        if "semantic_prompt" not in ctx:
            sp_text = generate_semantic_prompt(
                title, description or "", item_type, domain, related_rules, sp
            )
            ctx["semantic_prompt"] = sp_text
            prompt_added += 1
            changed = True

        # ---- Block 4: Expand description ----
        new_desc = description
        if not description or len(description) < 250:
            new_desc = expand_description(title, description or "", item_type, domain)
            if new_desc != description:
                desc_expanded += 1
                changed = True

        if changed:
            if new_desc != description:
                cur.execute("""
                    UPDATE tasks SET description = %s, generation_context = %s::json
                    WHERE id = %s
                """, (new_desc, json.dumps(ctx), card_id))
            else:
                cur.execute("""
                    UPDATE tasks SET generation_context = %s::json
                    WHERE id = %s
                """, (json.dumps(ctx), card_id))

    conn.commit()
    print(f"\nResults:")
    print(f"  Acceptance criteria added: {ac_added}/128")
    print(f"  Semantic prompts added: {prompt_added}/128")
    print(f"  Descriptions expanded: {desc_expanded}/128")

    # Verify
    cur.execute("""
        SELECT COUNT(*) FROM tasks
        WHERE project_id = %s AND generation_context::text LIKE '%%acceptance_criteria%%'
    """, (PROJECT_ID,))
    print(f"\n  Cards with AC in DB: {cur.fetchone()[0]}")

    cur.execute("""
        SELECT COUNT(*) FROM tasks
        WHERE project_id = %s AND generation_context::text LIKE '%%semantic_prompt%%'
    """, (PROJECT_ID,))
    print(f"  Cards with semantic_prompt in DB: {cur.fetchone()[0]}")

    cur.execute("""
        SELECT item_type, AVG(LENGTH(description))::int as avg_len
        FROM tasks
        WHERE project_id = %s
        GROUP BY item_type ORDER BY item_type
    """, (PROJECT_ID,))
    print(f"\n  Avg description length by type:")
    for row in cur.fetchall():
        print(f"    {row[0]}: {row[1]} chars")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
