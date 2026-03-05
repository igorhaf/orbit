#!/usr/bin/env python3
"""
Deep Pipeline Phase 3: Architectural Map
Builds comprehensive architectural map and stores in project.
"""
import json
import psycopg2

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"

ARCHITECTURE = {
    "project": "ORBIT",
    "version": "2.1",
    "type": "ai_orchestration_platform",
    "stack": {
        "backend": {
            "framework": "FastAPI 0.104+",
            "language": "Python 3.11+",
            "orm": "SQLAlchemy 2.0 (async)",
            "database": "PostgreSQL 15 + pgvector",
            "cache": "Redis 7",
            "migrations": "Alembic",
            "embedding": "Nomic Embed Text (768d) via Ollama",
            "task_queue": "PriorityJobExecutor (in-process)"
        },
        "frontend": {
            "framework": "Next.js 14 (App Router)",
            "language": "TypeScript 5",
            "ui": "React 18 + Tailwind CSS 3",
            "state": "React hooks + fetch API",
            "charts": "Recharts"
        },
        "ai_providers": [
            {"name": "Anthropic", "models": ["Claude Sonnet 4.5", "Claude Opus 4.5", "Claude Haiku 4"], "roles": ["user", "assistant"], "system_prompt": "separate parameter"},
            {"name": "OpenAI", "models": ["GPT-4o", "GPT-4 Turbo", "GPT-3.5 Turbo"], "roles": ["system", "user", "assistant"], "system_prompt": "message with role=system"},
            {"name": "Google", "models": ["Gemini 1.5 Pro", "Gemini 2.0 Flash", "Gemini 1.5 Flash"], "roles": ["user", "model"], "system_prompt": "system_instruction text"},
            {"name": "Ollama", "models": ["Nomic Embed Text", "Local LLMs"], "roles": ["system", "user", "assistant"], "system_prompt": "message with role=system"}
        ],
        "infrastructure": {
            "os": "Linux/WSL2",
            "services": "Native (no Docker)",
            "proxy": "Ollama via Windows host 172.27.144.1:11434"
        }
    },
    "domains": {
        "ai_orchestration": {
            "description": "Central hub for all AI model calls across 4 providers",
            "key_files": [
                "backend/app/services/ai_orchestrator/orchestrator.py",
                "backend/app/services/ai_orchestrator/__init__.py"
            ],
            "depends_on": ["caching", "rag_knowledge", "analytics"],
            "depended_by": ["interviews", "backlog_generation", "deep_pipeline", "wiki_system", "git_integration"],
            "patterns": ["Strategy (provider adapters)", "Chain of Responsibility (fallback)", "Observer (usage logging)"],
            "file_count": 12,
            "lines_of_code": 8500
        },
        "rag_knowledge": {
            "description": "RAG pipeline with pgvector for semantic search and document management",
            "key_files": [
                "backend/app/services/rag_service.py",
                "backend/app/routers/knowledge.py",
                "backend/app/routers/rag.py"
            ],
            "depends_on": ["infrastructure"],
            "depended_by": ["ai_orchestration", "deep_pipeline", "interviews", "wiki_system"],
            "patterns": ["Repository (document CRUD)", "Pipeline (scan -> index -> enrich)", "Strategy (embedding providers)"],
            "file_count": 18,
            "lines_of_code": 6200
        },
        "interviews": {
            "description": "Three-phase interview system for project discovery",
            "key_files": [
                "backend/app/services/interview_service.py",
                "backend/app/routers/interviews.py",
                "frontend/src/app/projects/[id]/interview/page.tsx"
            ],
            "depends_on": ["ai_orchestration", "rag_knowledge"],
            "depended_by": ["backlog_generation"],
            "patterns": ["State Machine (phase transitions)", "Template Method (question types)", "Observer (answer storage)"],
            "file_count": 22,
            "lines_of_code": 4800
        },
        "backlog_generation": {
            "description": "Hierarchical card generation from interviews and context",
            "key_files": [
                "backend/app/services/backlog_generator.py",
                "backend/app/routers/backlog.py",
                "backend/app/prompts/backlog/"
            ],
            "depends_on": ["ai_orchestration", "interviews", "rag_knowledge"],
            "depended_by": ["kanban"],
            "patterns": ["Composite (Epic->Story->Task hierarchy)", "Factory (card generation)", "Decorator (semantic references)"],
            "file_count": 25,
            "lines_of_code": 7200
        },
        "deep_pipeline": {
            "description": "7-phase codebase analysis engine for deep project understanding",
            "key_files": [
                "backend/app/services/deep_pipeline.py",
                "backend/app/routers/deep_pipeline.py",
                "backend/app/models/deep_pipeline_run.py"
            ],
            "depends_on": ["ai_orchestration", "rag_knowledge", "backlog_generation", "wiki_system"],
            "depended_by": ["ai_flow"],
            "patterns": ["Pipeline (7 sequential phases)", "Strategy (model per phase)", "Memento (run snapshots)"],
            "file_count": 8,
            "lines_of_code": 4200
        },
        "wiki_system": {
            "description": "Automatic wiki generation with AI operations and dual persistence",
            "key_files": [
                "backend/app/services/wiki_service.py",
                "backend/app/services/wiki_fs.py",
                "backend/app/routers/wiki.py",
                "frontend/src/app/projects/[id]/wiki/page.tsx"
            ],
            "depends_on": ["ai_orchestration", "rag_knowledge"],
            "depended_by": ["deep_pipeline"],
            "patterns": ["Dual Write (DB + filesystem)", "Template Method (AI operations)", "Guard (REGRA #0 protection)"],
            "file_count": 15,
            "lines_of_code": 5100
        },
        "caching": {
            "description": "Three-level cache system (L1 exact, L2 semantic, L3 template)",
            "key_files": [
                "backend/app/services/cache_service.py"
            ],
            "depends_on": ["infrastructure"],
            "depended_by": ["ai_orchestration"],
            "patterns": ["Chain of Responsibility (L1->L2->L3)", "Proxy (transparent caching)", "Flyweight (shared embeddings)"],
            "file_count": 4,
            "lines_of_code": 2200
        },
        "analytics": {
            "description": "Token usage tracking, cost analytics, and RAG metrics",
            "key_files": [
                "backend/app/routers/cost_analytics.py",
                "frontend/src/app/analytics/tokens/page.tsx",
                "frontend/src/app/analytics/costs/page.tsx"
            ],
            "depends_on": ["ai_orchestration"],
            "depended_by": [],
            "patterns": ["Aggregation (time-series rollups)", "Observer (usage logging)", "Adapter (multi-currency)"],
            "file_count": 12,
            "lines_of_code": 3800
        },
        "prompt_management": {
            "description": "Externalized YAML prompts with Jinja2 templating and PromptLoader",
            "key_files": [
                "backend/app/prompts/loader.py",
                "backend/app/prompts/"
            ],
            "depends_on": [],
            "depended_by": ["ai_orchestration", "interviews", "backlog_generation", "wiki_system"],
            "patterns": ["Template Method (Jinja2 rendering)", "Composite (components)", "Registry (prompt catalog)"],
            "file_count": 78,
            "lines_of_code": 5500
        },
        "job_system": {
            "description": "Background job execution with priority queuing and notifications",
            "key_files": [
                "backend/app/services/job_executor.py",
                "backend/app/routers/jobs.py",
                "frontend/src/components/ui/NotificationBell.tsx"
            ],
            "depends_on": ["infrastructure"],
            "depended_by": ["deep_pipeline"],
            "patterns": ["Priority Queue", "Observer (notifications)", "State Machine (job lifecycle)"],
            "file_count": 8,
            "lines_of_code": 2800
        },
        "project_management": {
            "description": "Core project CRUD, settings, and satellite directory management",
            "key_files": [
                "backend/app/services/project_service.py",
                "backend/app/routers/projects.py",
                "backend/app/models/project.py",
                "frontend/src/app/page.tsx"
            ],
            "depends_on": ["infrastructure"],
            "depended_by": ["interviews", "backlog_generation", "deep_pipeline", "wiki_system", "analytics"],
            "patterns": ["Repository (project CRUD)", "Factory (project initialization)", "Observer (satellite setup)"],
            "file_count": 20,
            "lines_of_code": 4500
        },
        "kanban": {
            "description": "Kanban board with drag-and-drop status management",
            "key_files": [
                "frontend/src/app/projects/[id]/board/page.tsx",
                "frontend/src/app/projects/[id]/page.tsx"
            ],
            "depends_on": ["project_management", "backlog_generation"],
            "depended_by": [],
            "patterns": ["Observer (status changes)", "Command (drag operations)", "Filter (view controls)"],
            "file_count": 10,
            "lines_of_code": 3200
        },
        "framework_specs": {
            "description": "Framework specification database for 70-85% token reduction",
            "key_files": [
                "backend/app/services/spec_service.py",
                "backend/app/models/framework_spec.py"
            ],
            "depends_on": [],
            "depended_by": ["backlog_generation", "ai_orchestration"],
            "patterns": ["Repository (spec CRUD)", "Strategy (selective loading)", "Cache-Aside (Redis)"],
            "file_count": 6,
            "lines_of_code": 1800
        },
        "ai_flow": {
            "description": "AI Studio interface for pipeline execution, profiles, and run comparison",
            "key_files": [
                "frontend/src/app/ai-flow/page.tsx",
                "backend/app/routers/deep_pipeline.py",
                "backend/app/models/pipeline_profile.py"
            ],
            "depends_on": ["deep_pipeline", "project_management"],
            "depended_by": [],
            "patterns": ["Facade (unified pipeline control)", "Memento (run snapshots)", "Strategy (profile selection)"],
            "file_count": 8,
            "lines_of_code": 3500
        },
        "git_integration": {
            "description": "Git operations and AI-generated commit messages",
            "key_files": [
                "backend/app/services/git_service.py",
                "backend/app/routers/git.py"
            ],
            "depends_on": ["ai_orchestration"],
            "depended_by": [],
            "patterns": ["Adapter (git CLI wrapper)", "Template Method (commit format)"],
            "file_count": 5,
            "lines_of_code": 1500
        },
        "pattern_discovery": {
            "description": "Automated pattern detection in codebase and tech stack identification",
            "key_files": [
                "backend/app/services/pattern_discovery.py",
                "backend/app/services/tech_stack_detector.py"
            ],
            "depends_on": ["rag_knowledge"],
            "depended_by": ["deep_pipeline", "project_management"],
            "patterns": ["Strategy (detection algorithms)", "Chain of Responsibility (pattern matchers)"],
            "file_count": 6,
            "lines_of_code": 2400
        },
        "infrastructure": {
            "description": "Database, Redis, Ollama, migrations, and deployment configuration",
            "key_files": [
                "backend/app/core/config.py",
                "backend/app/core/database.py",
                "backend/alembic/",
                "scripts/orbit"
            ],
            "depends_on": [],
            "depended_by": ["all domains"],
            "patterns": ["Singleton (DB connection)", "Factory (session creation)", "Migration (Alembic)"],
            "file_count": 95,
            "lines_of_code": 8900
        }
    },
    "cross_domain_flows": [
        {
            "name": "Project Bootstrap Flow",
            "steps": ["project_management (create)", "pattern_discovery (detect stack)", "rag_knowledge (index files)", "deep_pipeline (7 phases)", "backlog_generation (cards)", "wiki_system (pages)"],
            "trigger": "POST /api/v1/projects/create-and-process"
        },
        {
            "name": "Interview to Backlog Flow",
            "steps": ["interviews (Phase 1-3)", "rag_knowledge (store answers)", "backlog_generation (Epic->Story->Task)", "kanban (display cards)"],
            "trigger": "User starts interview session"
        },
        {
            "name": "AI Execution Flow",
            "steps": ["prompt_management (load YAML)", "caching (check L1->L2->L3)", "ai_orchestration (select provider)", "analytics (log usage)"],
            "trigger": "Any AI call via AIOrchestrator"
        },
        {
            "name": "Deep Pipeline Flow",
            "steps": ["deep_pipeline (Phase 0-7)", "rag_knowledge (index)", "backlog_generation (cards)", "wiki_system (pages)", "analytics (log)"],
            "trigger": "POST /api/v1/projects/{id}/rag/deep-pipeline"
        },
        {
            "name": "Continuous RAG Evolution",
            "steps": ["rag_knowledge (scan)", "pattern_discovery (extract rules)", "backlog_generation (generate cards)", "wiki_system (generate wiki)"],
            "trigger": "POST /api/v1/projects/{id}/rag/scan"
        }
    ],
    "layer_architecture": {
        "presentation": {
            "technology": "Next.js 14 App Router + Tailwind CSS",
            "pattern": "Server Components + Client Components ('use client')",
            "key_directories": ["frontend/src/app/", "frontend/src/components/"]
        },
        "api": {
            "technology": "FastAPI APIRouter",
            "pattern": "REST with Pydantic schemas",
            "key_directories": ["backend/app/routers/", "backend/app/schemas/"]
        },
        "service": {
            "technology": "Python async services",
            "pattern": "Service layer with dependency injection via Depends(get_db)",
            "key_directories": ["backend/app/services/"]
        },
        "data": {
            "technology": "SQLAlchemy 2.0 + Alembic + pgvector",
            "pattern": "ORM models with async sessions",
            "key_directories": ["backend/app/models/", "backend/alembic/versions/"]
        },
        "ai": {
            "technology": "AIOrchestrator + PromptLoader + CacheService",
            "pattern": "Centralized orchestration with provider abstraction",
            "key_directories": ["backend/app/services/ai_orchestrator/", "backend/app/prompts/"]
        }
    },
    "metrics": {
        "total_files": 1284,
        "code_files": 714,
        "python_files": 354,
        "typescript_files": 180,
        "yaml_prompts": 76,
        "alembic_migrations": 91,
        "total_domains": 17,
        "total_business_rules": 48,
        "rag_documents": 10278,
        "estimated_lines_of_code": 75000
    }
}

def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    arch_json = json.dumps(ARCHITECTURE, ensure_ascii=False)

    # Store in project
    cur.execute("""
        UPDATE projects
        SET context_semantic = %s::jsonb,
            context_human = %s,
            updated_at = NOW()
        WHERE id = %s
    """, (
        arch_json,
        f"""ORBIT 2.1 - AI Orchestration Platform

Stack: FastAPI + Next.js 14 + PostgreSQL/pgvector + Redis + Tailwind CSS
AI Providers: Anthropic (Claude), OpenAI (GPT), Google (Gemini), Ollama (local)

17 domains: ai_orchestration, rag_knowledge, interviews, backlog_generation, deep_pipeline, wiki_system, caching, analytics, prompt_management, job_system, project_management, kanban, framework_specs, ai_flow, git_integration, pattern_discovery, infrastructure

Key flows:
- Project Bootstrap: create -> detect stack -> index -> deep pipeline -> cards -> wiki
- Interview to Backlog: 3-phase interview -> RAG storage -> Epic/Story/Task generation
- AI Execution: YAML prompt -> 3-level cache -> provider selection -> usage logging
- Deep Pipeline: 7 phases (scan -> file analysis -> rules -> arch map -> cards -> wiki -> QA)

Key rules:
- REGRA #0: Human data never overwritten by AI
- API keys in database, never in .env
- All prompts externalized to YAML
- 3-level cache (L1 exact 7d, L2 semantic 1d, L3 template 30d)
- Multi-provider compatibility (user/assistant roles only)
- 70-85% token reduction via framework specs

Metrics: 1,284 files, 714 code files, 48 business rules, 76 YAML prompts, 91 migrations""",
        PROJECT_ID
    ))

    conn.commit()
    print("Architectural map stored in project context_semantic and context_human")

    # Verify
    cur.execute("SELECT length(context_semantic::text), length(context_human) FROM projects WHERE id = %s", (PROJECT_ID,))
    row = cur.fetchone()
    print(f"  context_semantic: {row[0]:,} chars")
    print(f"  context_human: {row[1]:,} chars")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
