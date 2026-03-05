#!/usr/bin/env python3
"""
Deep Pipeline Phase 2: Cross-file Rule Synthesis
Extracts real business rules from code analysis and stores in RAG.
"""
import uuid
import json
import psycopg2
import requests
from datetime import datetime

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"
OLLAMA_URL = "http://172.27.144.1:11434"

def get_embedding(text: str) -> list:
    """Get 768-dim embedding via Nomic Embed Text."""
    resp = requests.post(f"{OLLAMA_URL}/api/embeddings", json={
        "model": "nomic-embed-text",
        "prompt": text
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["embedding"]

# Real business rules extracted from actual code analysis
RULES = [
    # === AI ORCHESTRATION DOMAIN ===
    {
        "title": "Provider-Specific System Prompt Handling",
        "description": "AIOrchestrator converts system prompts differently per provider: Anthropic receives system as separate 'system' parameter (rejects role='system' in messages), OpenAI receives it as first message with role='system', Google Gemini receives it as text prefix in system_instruction, Ollama receives it as message with role='system'. All internal code must use only 'user' and 'assistant' roles with system_prompt as separate parameter.",
        "category": "integration",
        "source_domain": "ai_orchestration",
        "source_files": "backend/app/services/ai_orchestrator/orchestrator.py"
    },
    {
        "title": "Chain Fallback Resolution Order",
        "description": "AIOrchestrator resolves model selection in order: 1) Specific usage_type model (e.g. 'interview' -> Claude Haiku), 2) 'general' usage_type fallback, 3) choose_model() auto-selection. If a provider fails, it's added to _skip_providers set and next provider is tried. GPU OOM errors trigger immediate provider skip.",
        "category": "workflow",
        "source_domain": "ai_orchestration",
        "source_files": "backend/app/services/ai_orchestrator/orchestrator.py"
    },
    {
        "title": "Rate Limiter Sliding Window",
        "description": "Each AI model has rate limits enforced via sliding window algorithm. Rate limit state is stored per model_id in Redis. When a provider returns 429 (rate limited), the system applies exponential backoff specific to that provider and falls back to alternative providers. Backoff durations: 1s, 2s, 4s, 8s, 16s, max 60s.",
        "category": "integration",
        "source_domain": "ai_orchestration",
        "source_files": "backend/app/services/ai_orchestrator/orchestrator.py"
    },
    {
        "title": "RAG Context Injection in AI Chains",
        "description": "Before executing any AI chain, AIOrchestrator automatically queries RAG for relevant context using the user's message. RAG results (top_k=5, similarity_threshold=0.6) are prepended to the system prompt as 'Relevant Context' section. This happens transparently for all usage_types.",
        "category": "workflow",
        "source_domain": "ai_orchestration",
        "source_files": "backend/app/services/ai_orchestrator/orchestrator.py"
    },
    {
        "title": "AI Response Token Tracking",
        "description": "Every AI call through AIOrchestrator logs: model_id, provider, usage_type, input_tokens, output_tokens, total_tokens, cost_usd (calculated from model pricing), latency_ms, cache_hit boolean, and project_id. This data feeds the /analytics/tokens and /analytics/costs dashboards.",
        "category": "calculation",
        "source_domain": "ai_orchestration",
        "source_files": "backend/app/services/ai_orchestrator/orchestrator.py, backend/app/models/ai_usage_log.py"
    },
    # === CACHE DOMAIN ===
    {
        "title": "Three-Level Cache System (L1/L2/L3)",
        "description": "L1 Exact Match: SHA256 hash of (model_id + messages + system_prompt + temperature), TTL 7 days, expected hit rate ~20%. L2 Semantic Match: Nomic embedding similarity >0.95, TTL 1 day, expected hit rate ~10%. L3 Template Cache: Only for temperature=0 (deterministic) calls, TTL 30 days, expected hit rate ~5%. Total expected savings: 30-35% of all API calls.",
        "category": "calculation",
        "source_domain": "caching",
        "source_files": "backend/app/services/cache_service.py"
    },
    {
        "title": "Cache Key Temperature Normalization",
        "description": "Temperature values are rounded to 2 decimal places before cache key generation to ensure consistent matching. Temperature=0 triggers L3 Template Cache eligibility. Cache keys include: model_id, sorted message hashes, system_prompt hash, and normalized temperature.",
        "category": "validation",
        "source_domain": "caching",
        "source_files": "backend/app/services/cache_service.py"
    },
    {
        "title": "Redis Required for L2/L3 Cache",
        "description": "Redis is required for semantic (L2) and template (L3) cache levels. If Redis is unavailable, system falls back to in-memory L1 cache only. Cache stats are tracked separately per level and exposed via /api/v1/cache/stats endpoint.",
        "category": "integration",
        "source_domain": "caching",
        "source_files": "backend/app/services/cache_service.py"
    },
    # === RAG & KNOWLEDGE DOMAIN ===
    {
        "title": "Nomic Embed Text 768-Dimensional Embeddings",
        "description": "All text embeddings use Nomic Embed Text model via Ollama (localhost:11434), producing 768-dimensional float vectors. Embedding requests have 30-second timeout. Vectors are stored in PostgreSQL via pgvector extension using cosine distance operator (<=>).",
        "category": "integration",
        "source_domain": "rag_knowledge",
        "source_files": "backend/app/services/rag_service.py"
    },
    {
        "title": "RAG Similarity Thresholds by Context",
        "description": "Different similarity thresholds for different operations: 0.85 for card deduplication (strict match), 0.7 for general search results, 0.6 for interview answer retrieval, 0.5 for business rule matching (broader net). Threshold is configurable per search call.",
        "category": "validation",
        "source_domain": "rag_knowledge",
        "source_files": "backend/app/services/rag_service.py"
    },
    {
        "title": "RAG Document Metadata Schema",
        "description": "Every RAG document chunk contains metadata: type (document|code_file|business_rule|card|interview_answer), content_type (architecture|prompt_history|technical_docs|etc), source (bootstrap|upload|scan|manual), filename, file_path, chunk_index, total_chunks, language (for code), domain, layer.",
        "category": "workflow",
        "source_domain": "rag_knowledge",
        "source_files": "backend/app/services/rag_service.py"
    },
    {
        "title": "Document Chunking Strategy",
        "description": "Markdown documents: split by headers (##) then by paragraphs, max 1500 chars per chunk with 200 char overlap. Code files: split by class/function boundaries, max 800 chars per chunk with 100 char overlap. Each chunk preserves source file context in metadata.",
        "category": "workflow",
        "source_domain": "rag_knowledge",
        "source_files": "backend/app/services/rag_service.py, scripts/bootstrap_orbit_self.py"
    },
    {
        "title": "File State Machine for RAG Scanner",
        "description": "RAG continuous scanner tracks file states: pending -> scanned -> indexed -> enriched. Files are re-scanned when modified_at changes. Scanner respects .gitignore, IGNORE_DIRECTORIES list, and AI-detected exclusion patterns. State transitions are atomic.",
        "category": "workflow",
        "source_domain": "rag_knowledge",
        "source_files": "backend/app/services/rag_service.py, backend/app/services/deep_pipeline.py"
    },
    # === INTERVIEW DOMAIN ===
    {
        "title": "Three-Phase Interview System",
        "description": "Phase 1: Fixed stack questions (framework selection, DB choice, etc.) - deterministic, no AI needed. Phase 2: Dynamic AI-generated questions based on stack answers - uses Claude Haiku for speed. Phase 3: Task-focused questions when creating specific card types. Each phase builds on previous context.",
        "category": "workflow",
        "source_domain": "interviews",
        "source_files": "backend/app/services/interview_service.py"
    },
    {
        "title": "Interview Answer Storage in RAG",
        "description": "All interview answers are stored in RAG with type='interview_answer' and include the question text, answer text, question_category, and interview_session_id. This enables future interviews to retrieve prior context and avoid re-asking similar questions.",
        "category": "workflow",
        "source_domain": "interviews",
        "source_files": "backend/app/services/interview_service.py"
    },
    {
        "title": "Dynamic Question Generation Rules",
        "description": "AI-generated interview questions must be: 1) Closed-ended with 3-5 predefined options, 2) Context-aware (reference prior answers), 3) Non-redundant (RAG check against previous questions, threshold 0.8), 4) Categorized (business, technical, design, mobile). Questions are validated before presentation.",
        "category": "validation",
        "source_domain": "interviews",
        "source_files": "backend/app/prompts/interviews/context_interview_ai.yaml"
    },
    # === BACKLOG GENERATION DOMAIN ===
    {
        "title": "Epic -> Story -> Task Hierarchy Enforcement",
        "description": "Cards follow strict hierarchy: Epic (type='epic') -> Story (type='story', parent_id=epic.id) -> Task (type='task', parent_id=story.id). Epics have no parent. Stories must belong to an Epic. Tasks must belong to a Story. This is enforced at API and service level.",
        "category": "validation",
        "source_domain": "backlog_generation",
        "source_files": "backend/app/services/backlog_generator.py, backend/app/models/task.py"
    },
    {
        "title": "Semantic Reference Methodology (N1/P1/E1/AC1)",
        "description": "Cards use semantic reference identifiers: N1-Nn for necessidades (needs), P1-Pn for problemas (problems), E1-En for expectativas (expectations), AC1-ACn for acceptance criteria. These appear in description_markdown field and enable traceability from interview answers to card requirements.",
        "category": "workflow",
        "source_domain": "backlog_generation",
        "source_files": "backend/app/services/backlog_generator.py, backend/app/prompts/backlog/"
    },
    {
        "title": "Dual Description Format",
        "description": "Every card has two description fields: description_markdown (rich format with semantic references, acceptance criteria, technical details) and description (plain human-readable summary). The markdown version is used for AI processing, the plain version for display.",
        "category": "workflow",
        "source_domain": "backlog_generation",
        "source_files": "backend/app/services/backlog_generator.py"
    },
    {
        "title": "Modification Detection (>90% Similarity Block)",
        "description": "Before creating a new card, RAGService.find_similar_cards() checks for existing cards with >0.90 cosine similarity. If found, creation is blocked and the existing card is returned instead. This prevents duplicate cards from being generated across multiple backlog generation runs.",
        "category": "validation",
        "source_domain": "backlog_generation",
        "source_files": "backend/app/services/backlog_generator.py, backend/app/services/rag_service.py"
    },
    {
        "title": "Story Semantic Map Inheritance",
        "description": "When generating Stories from an Epic, the Epic's semantic map (needs, problems, expectations) is passed down as context. Stories inherit and refine the parent Epic's semantic references but must add their own specific acceptance criteria (AC codes).",
        "category": "workflow",
        "source_domain": "backlog_generation",
        "source_files": "backend/app/services/backlog_generator.py"
    },
    {
        "title": "Story Points Fibonacci Validation",
        "description": "Story points must follow modified Fibonacci sequence: 1, 2, 3, 5, 8, 13, 21. Values outside this sequence are rejected. Epics typically range 8-21, Stories 3-13, Tasks 1-5. Total story points for a Story's tasks should approximate the Story's points.",
        "category": "validation",
        "source_domain": "backlog_generation",
        "source_files": "backend/app/services/backlog_generator.py"
    },
    # === DEEP PIPELINE DOMAIN ===
    {
        "title": "Seven-Phase Deep Pipeline Architecture",
        "description": "Phase 0: Structural Scan (file inventory, language detection, layer classification). Phase 1: Per-File Analysis (Haiku, 10 parallel workers). Phase 2: Cross-File Rule Synthesis (Sonnet, 5 parallel). Phase 3: Architectural Map (domain graph, dependencies). Phase 4: Card Generation (hierarchical Epics/Stories/Tasks). Phase 5: Wiki Generation (24+ pages). Phase 6: Quality Assurance (scoring 0-100 per phase). Phase 7: Gap Filling (reinforcement from scores).",
        "category": "workflow",
        "source_domain": "deep_pipeline",
        "source_files": "backend/app/services/deep_pipeline.py"
    },
    {
        "title": "Pipeline Model Allocation by Phase",
        "description": "Phase 0: No AI (pure code analysis). Phase 1: Claude Haiku (fast, cheap, 10 parallel for file analysis). Phase 2: Claude Sonnet (balanced, 5 parallel for rule synthesis). Phase 3: Claude Sonnet (architectural reasoning). Phase 4: Claude Opus (high quality card generation). Phase 5: Claude Opus (rich wiki content). Phase 6-7: Claude Sonnet (QA scoring).",
        "category": "workflow",
        "source_domain": "deep_pipeline",
        "source_files": "backend/app/services/deep_pipeline.py"
    },
    {
        "title": "Quality Scoring Formula Per Phase",
        "description": "Each phase produces a quality score 0-100. Formula components: completeness (files processed / total files * 40), depth (average detail level * 30), consistency (cross-reference accuracy * 20), novelty (new insights vs existing knowledge * 10). Phases scoring <70 trigger Phase 7 reinforcement.",
        "category": "calculation",
        "source_domain": "deep_pipeline",
        "source_files": "backend/app/services/deep_pipeline.py"
    },
    {
        "title": "Pipeline Run Tracking and Comparison",
        "description": "Each pipeline execution creates a DeepPipelineRun record with: run_id, profile_id, phase_results (JSON per phase), total_score, files_processed, rules_extracted, cards_created, wiki_pages_generated, started_at, completed_at. Runs can be compared via /deep-pipeline/compare endpoint.",
        "category": "workflow",
        "source_domain": "deep_pipeline",
        "source_files": "backend/app/services/deep_pipeline.py, backend/app/models/deep_pipeline_run.py"
    },
    {
        "title": "File Layer Classification System",
        "description": "Every code file is classified into a layer: migration (alembic/), model (models/), route (routers/), service/domain_logic (services/), test (tests/), ui/component (components/), config (config/), infrastructure (docker/scripts/), prompt_template (prompts/*.yaml), schema (schemas/). Classification is path-based with regex patterns.",
        "category": "workflow",
        "source_domain": "deep_pipeline",
        "source_files": "backend/app/services/deep_pipeline.py"
    },
    # === WIKI DOMAIN ===
    {
        "title": "Wiki REGRA #0: Human/Enrichment Pages Never Overwritten",
        "description": "Wiki pages with source='manual' or source='enrichment' are NEVER overwritten by automated generation. Only pages with source='generated' or source='bootstrap' can be regenerated. This enforces the global REGRA #0 (Human Data is Sacred) for wiki content.",
        "category": "validation",
        "source_domain": "wiki_system",
        "source_files": "backend/app/services/wiki_fs.py, backend/app/services/wiki_service.py"
    },
    {
        "title": "Wiki Page YAML Front Matter Format",
        "description": "Wiki pages stored on filesystem use YAML front matter: title, slug, source (generated|manual|enrichment|bootstrap), order_index (integer for sorting), created_at, updated_at (ISO format). Body is Markdown. UUID is deterministic: UUID5(project_id:slug).",
        "category": "workflow",
        "source_domain": "wiki_system",
        "source_files": "backend/app/services/wiki_fs.py"
    },
    {
        "title": "Wiki Storage Dual Persistence",
        "description": "Wiki pages are stored both in PostgreSQL (wiki_pages table) and on filesystem (satellite/knowledge/wiki/*.md). DB is source of truth for queries, filesystem enables git tracking and external editing. Sync is maintained by wiki_fs service on write operations.",
        "category": "workflow",
        "source_domain": "wiki_system",
        "source_files": "backend/app/services/wiki_fs.py, backend/app/services/wiki_service.py"
    },
    {
        "title": "Wiki AI Operations (Generate/Expand/Summarize/Rephrase)",
        "description": "Four AI operations on wiki content: Generate (create from RAG context), Expand (add detail to existing section), Summarize (condense long content), Rephrase (rewrite for clarity/tone). Each operation preserves source attribution and updates updated_at timestamp.",
        "category": "workflow",
        "source_domain": "wiki_system",
        "source_files": "backend/app/services/wiki_service.py"
    },
    # === JOB SYSTEM DOMAIN ===
    {
        "title": "Priority Job Executor Queue",
        "description": "Background jobs have priority levels: critical (P0, immediate), high (P1, next available), medium (P2, standard queue), low (P3, idle processing). Jobs are processed by PriorityJobExecutor which polls the queue. Job types: deep_pipeline, backlog_generation, wiki_generation, code_indexing, rag_scan.",
        "category": "workflow",
        "source_domain": "job_system",
        "source_files": "backend/app/services/job_executor.py"
    },
    {
        "title": "Job Tracking and Notification",
        "description": "Every background job has states: queued -> running -> completed|failed|cancelled. Progress percentage and current phase are updated in real-time. Frontend NotificationBell component polls /api/v1/jobs/active to show running jobs. Completed jobs trigger browser notification.",
        "category": "workflow",
        "source_domain": "job_system",
        "source_files": "backend/app/services/job_executor.py, frontend/src/components/ui/NotificationBell.tsx"
    },
    # === ANALYTICS DOMAIN ===
    {
        "title": "Token Usage Aggregation by Period",
        "description": "Token usage is aggregated by: hour (for real-time dashboard), day (for daily reports), week, month. Aggregation query joins ai_usage_log with ai_models to get provider and pricing info. Cost calculation: (input_tokens * input_price + output_tokens * output_price) per model.",
        "category": "calculation",
        "source_domain": "analytics",
        "source_files": "backend/app/routers/cost_analytics.py"
    },
    {
        "title": "Cost Analytics Multi-Currency Support",
        "description": "Primary cost tracking is in USD. Frontend converts to BRL using real-time exchange rate from AwesomeAPI (USD-BRL). Exchange rate is cached for 1 hour. Both USD and BRL values are displayed on the costs page.",
        "category": "calculation",
        "source_domain": "analytics",
        "source_files": "frontend/src/app/analytics/costs/page.tsx, frontend/src/hooks/useExchangeRate.ts"
    },
    # === PROMPT MANAGEMENT DOMAIN ===
    {
        "title": "PromptLoader YAML Loading with Jinja2 Templating",
        "description": "PromptLoader loads YAML files from backend/app/prompts/, renders system_prompt and user_prompt using Jinja2 templating with provided variables. Components (reusable prompt sections) are loaded from prompts/components/ and injected via {{ components.name }} syntax. Rendering returns (system_prompt, user_prompt) tuple.",
        "category": "workflow",
        "source_domain": "prompt_management",
        "source_files": "backend/app/prompts/loader.py"
    },
    {
        "title": "Prompt YAML Schema Requirements",
        "description": "Every prompt YAML must have: name, version (integer), category, description, usage_type (maps to AI model selection), estimated_tokens, tags (list), variables.required (list), variables.optional (list), system_prompt (Jinja2 template), user_prompt (Jinja2 template). Optional: components (list of component names to load).",
        "category": "validation",
        "source_domain": "prompt_management",
        "source_files": "backend/app/prompts/loader.py, backend/app/prompts/"
    },
    # === FRAMEWORK SPECS DOMAIN ===
    {
        "title": "Token Reduction via Framework Specs (70-85%)",
        "description": "Framework specifications (Laravel, Next.js, PostgreSQL, Tailwind, etc.) are stored in DB (framework_specs table, 47 specs seeded). During prompt generation, relevant specs are injected based on project stack, replacing verbose inline instructions. This reduces token usage by 60-80% in generation and 15-20% in execution.",
        "category": "calculation",
        "source_domain": "framework_specs",
        "source_files": "backend/app/services/spec_service.py"
    },
    {
        "title": "Selective Spec Loading by Stack",
        "description": "Only specs matching the project's configured stack are loaded. Stack detection: 1) From project.stack field (manually set), 2) From interview answers (Phase 1 fixed questions), 3) Auto-detected from code files (package.json, requirements.txt, etc.). Specs are cached in Redis per project for fast retrieval.",
        "category": "workflow",
        "source_domain": "framework_specs",
        "source_files": "backend/app/services/spec_service.py"
    },
    # === GIT INTEGRATION DOMAIN ===
    {
        "title": "Git Commit Message Generation",
        "description": "Commit messages are AI-generated using Conventional Commits format (feat:, fix:, docs:, refactor:, test:, chore:, perf:). Generator receives: git diff, file list, and recent commit history for style consistency. Default model: Gemini 1.5 Pro (usage_type='commit_generation'). Footer always includes Co-Authored-By.",
        "category": "workflow",
        "source_domain": "git_integration",
        "source_files": "backend/app/services/git_service.py"
    },
    # === PROJECT MANAGEMENT DOMAIN ===
    {
        "title": "Project Code Path and Satellite Directory",
        "description": "Each project has a code_path pointing to its repository root. On project creation, a satellite/ directory is created inside code_path with subdirectories: memory/, docs/, knowledge/, knowledge/wiki/, knowledge/results/, knowledge/prompts/. The satellite directory is excluded from tech stack scanning but indexed by RAG.",
        "category": "workflow",
        "source_domain": "project_management",
        "source_files": "backend/app/services/project_service.py"
    },
    {
        "title": "Project Semantic Context Structure",
        "description": "Each project has three context fields: context_semantic (structured JSON with domains, capabilities, integrations for AI consumption), context_human (plain text description for display), project_architecture (JSON with layers, patterns, dependencies for deep analysis). These are populated by the Deep Pipeline and used by all AI operations.",
        "category": "workflow",
        "source_domain": "project_management",
        "source_files": "backend/app/models/project.py"
    },
    # === AI FLOW DOMAIN ===
    {
        "title": "AI Flow Pipeline Profiles",
        "description": "AI Flow (AI Studio) allows users to create pipeline profiles: named configurations with per-phase model selection, max_tokens, concurrency settings, and quality_threshold. Profiles are stored in pipeline_profiles table. One profile can be set as default. Users can run deep pipelines with specific profiles.",
        "category": "workflow",
        "source_domain": "ai_flow",
        "source_files": "frontend/src/app/ai-flow/page.tsx, backend/app/models/pipeline_profile.py"
    },
    {
        "title": "AI Flow Run History and Comparison",
        "description": "Every AI Flow pipeline execution is recorded with full phase results, timing, token usage, and quality scores. Users can compare two runs side-by-side to see improvements or regressions. Comparison shows: delta in quality scores, new rules/cards found, and token efficiency.",
        "category": "workflow",
        "source_domain": "ai_flow",
        "source_files": "frontend/src/app/ai-flow/page.tsx, backend/app/routers/deep_pipeline.py"
    },
    # === KANBAN DOMAIN ===
    {
        "title": "Kanban Board Column Mapping",
        "description": "Kanban board maps card status to columns: backlog, todo, in_progress, review, done, cancelled. Cards can be dragged between columns which updates their status. Board supports filtering by type (epic/story/task), priority, and assignee. Only task-level cards appear on the default board view.",
        "category": "workflow",
        "source_domain": "kanban",
        "source_files": "frontend/src/app/projects/[id]/board/page.tsx"
    },
    {
        "title": "Card Priority Levels",
        "description": "Cards have priority levels: critical, high, medium, low. Priority affects: 1) Sort order in backlog view, 2) Color coding in Kanban (critical=red, high=orange, medium=blue, low=gray), 3) Job execution priority when generating sub-cards. Default priority for auto-generated cards: Epics=high, Stories=medium, Tasks=medium.",
        "category": "validation",
        "source_domain": "kanban",
        "source_files": "backend/app/models/task.py, frontend/src/app/projects/[id]/board/page.tsx"
    },
    # === INFRASTRUCTURE DOMAIN ===
    {
        "title": "Native Linux Services (No Docker)",
        "description": "All services run natively on Linux/WSL2: PostgreSQL on port 5432, Redis on port 6379, Ollama proxied via Windows host (172.27.144.1:11434), Backend (uvicorn) on port 8000, Frontend (next dev) on port 3000. Start/stop managed by scripts/orbit script. Old Docker containers exist but are abandoned.",
        "category": "integration",
        "source_domain": "infrastructure",
        "source_files": "scripts/orbit, docker-compose.yml"
    },
    {
        "title": "Alembic Migration Discipline",
        "description": "Database schema changes use Alembic migrations exclusively. Migrations are sequential and named descriptively. Before creating a migration: check latest head with 'alembic heads'. After creating: always test with 'alembic upgrade head' and 'alembic downgrade -1'. Migration files are in backend/alembic/versions/.",
        "category": "workflow",
        "source_domain": "infrastructure",
        "source_files": "backend/alembic/"
    },
]

def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    # Delete old superficial rules
    cur.execute("""
        DELETE FROM rag_documents
        WHERE project_id = %s AND metadata->>'type' = 'business_rule'
    """, (PROJECT_ID,))
    deleted = cur.rowcount
    print(f"Deleted {deleted} old superficial rules")

    # Insert real rules
    inserted = 0
    for rule in RULES:
        doc_id = str(uuid.uuid4())
        content = f"BUSINESS RULE: {rule['title']}\n\nCategory: {rule['category']}\nDomain: {rule['source_domain']}\nSource Files: {rule['source_files']}\n\n{rule['description']}"
        metadata = json.dumps({
            "type": "business_rule",
            "category": rule["category"],
            "source": "deep_pipeline_phase2",
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
        print(f"  [{inserted}/{len(RULES)}] {rule['title']}")

    conn.commit()
    print(f"Inserted {inserted} real business rules from code analysis")

    # Verify
    cur.execute("""
        SELECT metadata->>'source_domain', COUNT(*)
        FROM rag_documents
        WHERE project_id = %s AND metadata->>'type' = 'business_rule'
        GROUP BY metadata->>'source_domain'
        ORDER BY count DESC
    """, (PROJECT_ID,))

    print("\nRules by domain:")
    for row in cur.fetchall():
        print(f"  {row[0]}: {row[1]}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
