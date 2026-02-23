"""
ORBIT Full Pipeline via Claude Code - PROMPT #244 (v2)

Replicates the same procedures as the ORBIT RAG pipeline:
1. Scan all source files → rag_file_state
2. Insert extracted business rules → rag_documents (with embeddings)
3. Generate hierarchical cards → tasks (Epic > Story > Task > Subtask)

Business rules were extracted by Claude Code reading the entire codebase.
Uses sentence-transformers for embeddings (same as RAGService).

V2: 261 rules across 33 domains (original 12 + 21 new domains)
"""
import hashlib
import json
import logging
import os
import sys
from datetime import datetime
from uuid import uuid4

# Add backend to path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from dotenv import load_dotenv
load_dotenv(os.path.join(backend_dir, ".env"), override=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("claude_pipeline")

# Suppress noisy loggers
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("sentence_transformers").setLevel(logging.WARNING)

PROJECT_ID = "c5afeaed-0b4d-4ad1-835d-a4aa68a989fb"
CODE_PATH = "/home/igorhaf/orbit"

# ============================================================================
# IGNORE RULES (same as codebase_memory.py)
# ============================================================================
IGNORE_DIRS = {
    "node_modules", "vendor", ".venv", "venv", ".git", ".idea", ".vscode",
    "dist", "build", "__pycache__", "target", "bin", "obj", "coverage",
    "logs", "tmp", ".next", ".nuxt", ".output", ".cache", ".parcel-cache",
    "satellite", ".claude", "data", "storage",
}

IGNORE_PATTERNS = {
    "*.lock", "*.min.js", "*.min.css", "*.pyc", "*.class", "*.exe",
    "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.ico", "*.mp3",
    "*.mp4", "*.pdf", "*.zip", "*.tar", "*.gz", ".env", "*.key", "*.pem",
    ".DS_Store", "Thumbs.db", "*.map", "*.woff", "*.woff2", "*.ttf",
    "*.eot", "poetry.lock", "package-lock.json",
}

ALLOWED_EXTENSIONS = {
    ".py", ".tsx", ".ts", ".js", ".jsx", ".sql", ".yaml", ".yml",
    ".md", ".json", ".css", ".html", ".sh",
}

LAYER_MAP = {
    "models": "schema", "migrations": "schema", "schemas": "schema",
    "routes": "routes", "api": "routes", "controllers": "routes", "endpoints": "routes",
    "services": "logic", "utils": "logic", "helpers": "logic",
    "components": "presentation", "pages": "presentation", "app": "presentation",
    "config": "config", "scripts": "config",
}


def classify_layer(file_path: str) -> str:
    parts = file_path.split("/")
    for part in parts:
        if part in LAYER_MAP:
            return LAYER_MAP[part]
    ext = os.path.splitext(file_path)[1]
    if ext in (".tsx", ".jsx", ".css", ".html"):
        return "presentation"
    if ext in (".yaml", ".yml", ".json", ".sh"):
        return "config"
    return "unknown"


def should_ignore(path: str) -> bool:
    parts = path.split("/")
    for part in parts:
        if part in IGNORE_DIRS:
            return True
    name = os.path.basename(path)
    for pattern in IGNORE_PATTERNS:
        if pattern.startswith("*"):
            if name.endswith(pattern[1:]):
                return True
        elif name == pattern:
            return True
    return False


def scan_files(code_path: str):
    files = []
    for root, dirs, filenames in os.walk(code_path):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for fname in filenames:
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, code_path)
            if should_ignore(rel_path):
                continue
            ext = os.path.splitext(fname)[1]
            if ext not in ALLOWED_EXTENSIONS:
                continue
            try:
                stat = os.stat(full_path)
                with open(full_path, "rb") as f:
                    file_hash = hashlib.sha256(f.read()).hexdigest()
                files.append({
                    "file_path": rel_path,
                    "file_hash": file_hash,
                    "file_size": stat.st_size,
                    "last_modified": datetime.fromtimestamp(stat.st_mtime),
                    "file_layer": classify_layer(rel_path),
                })
            except (OSError, PermissionError):
                continue
    return files


# ============================================================================
# BUSINESS RULES - 261 rules across 33 domains
# Extracted by Claude Code reading the entire ORBIT codebase
# ============================================================================
BUSINESS_RULES = [
    # ========== DOMAIN: AI Orchestration (14 rules) ==========
    {"rule_text": "AIOrchestrator uses 3-level cache hierarchy: L1 exact match (7-day TTL), L2 semantic match >95% similarity (1-day TTL), L3 template cache for deterministic prompts (30-day TTL)", "rule_type": "domain", "source_file": "backend/app/services/ai_orchestrator.py", "domain": "AI Orchestration"},
    {"rule_text": "AI Flow Chain fallback: models in chain are tried sequentially; if one fails, automatically try next model in chain order", "rule_type": "workflow", "source_file": "backend/app/services/ai_orchestrator.py", "domain": "AI Orchestration"},
    {"rule_text": "Only usage_types in _SAVE_USAGE_TYPES (prompt_generation, task_execution, commit_generation, memory, pattern_discovery) are saved to satellite/memory/", "rule_type": "validation", "source_file": "backend/app/services/ai_orchestrator.py", "domain": "AI Orchestration"},
    {"rule_text": "Satellite prompt logs are NEVER overwritten - if file exists, skip writing (REGRA #0 applied to logs)", "rule_type": "constraint", "source_file": "backend/app/services/ai_orchestrator.py", "domain": "AI Orchestration"},
    {"rule_text": "Model timeout uses 3-layer hierarchy: Timeout Node > AI Model timeout_seconds > SystemSettings default", "rule_type": "validation", "source_file": "backend/app/services/ai_orchestrator.py", "domain": "AI Orchestration"},
    {"rule_text": "Adaptive timeout calculation: uses max(static_timeout, adaptive_timeout) based on provider speed profiles: Ollama=15, Anthropic=80, OpenAI=60, Google=70 tokens/second", "rule_type": "domain", "source_file": "backend/app/services/ai_orchestrator.py", "domain": "AI Orchestration"},
    {"rule_text": "Concurrency limit per model via asyncio.Semaphore; module-level semaphore pool shared across AIOrchestrator instances", "rule_type": "constraint", "source_file": "backend/app/services/ai_orchestrator.py", "domain": "AI Orchestration"},
    {"rule_text": "ORBIT orchestrates 3 providers simultaneously: Anthropic (Claude), OpenAI (GPT), Google (Gemini) with role compatibility handling", "rule_type": "domain", "source_file": "backend/app/services/ai_orchestrator.py", "domain": "AI Orchestration"},
    {"rule_text": "API keys are stored in the database (ai_models table), NEVER in .env files; users configure via web interface at /ai-models", "rule_type": "constraint", "source_file": "backend/app/models/ai_model.py", "domain": "AI Orchestration"},
    {"rule_text": "Each usage_type has ONE chain (UNIQUE constraint); chain is upserted not duplicated", "rule_type": "constraint", "source_file": "backend/app/api/routes/ai_flow.py", "domain": "AI Orchestration"},
    {"rule_text": "Chain optimization strategies: reliability (0.6/0.1/0.2/0.1), cost (0.2/0.5/0.1/0.2), quality (0.2/0.1/0.5/0.2), balanced (0.3/0.25/0.25/0.2) weights for success/cost/quality/latency", "rule_type": "domain", "source_file": "backend/app/api/routes/ai_flow.py", "domain": "AI Orchestration"},
    {"rule_text": "Retry intelligent skipping: Don't retry on permanent errors (401, 404); only retry on transient errors (timeout, rate_limit, server_error)", "rule_type": "workflow", "source_file": "backend/app/api/routes/ai_flow.py", "domain": "AI Orchestration"},
    {"rule_text": "Model health status colors: Green >= 95% success rate, Yellow >= 80%, Red < 80%", "rule_type": "domain", "source_file": "backend/app/api/routes/ai_flow.py", "domain": "AI Orchestration"},
    {"rule_text": "Redis cache enabled automatically when AIOrchestrator is instantiated; falls back to in-memory cache if Redis unavailable", "rule_type": "workflow", "source_file": "backend/app/services/ai_orchestrator.py", "domain": "AI Orchestration"},

    # ========== DOMAIN: RAG Pipeline (13 rules) ==========
    {"rule_text": "Continuous RAG scans all source files respecting .gitignore patterns, custom ignore patterns, and global blocklist", "rule_type": "workflow", "source_file": "backend/app/services/continuous_rag_service.py", "domain": "RAG Pipeline"},
    {"rule_text": "File semantic layer priority for processing: SCHEMA > ROUTES > LOGIC > PRESENTATION > CONFIG > UNKNOWN", "rule_type": "domain", "source_file": "backend/app/services/continuous_rag_service.py", "domain": "RAG Pipeline"},
    {"rule_text": "File hash computed as SHA-256 to detect modifications; only changed files are reprocessed", "rule_type": "validation", "source_file": "backend/app/services/continuous_rag_service.py", "domain": "RAG Pipeline"},
    {"rule_text": "Low-value files (tests, config, migrations, fixtures) are skipped before AI extraction to save tokens", "rule_type": "constraint", "source_file": "backend/app/services/continuous_rag_service.py", "domain": "RAG Pipeline"},
    {"rule_text": "RAG documents stored with 384-dimensional embeddings using all-MiniLM-L6-v2 model for semantic search", "rule_type": "domain", "source_file": "backend/app/services/rag_service.py", "domain": "RAG Pipeline"},
    {"rule_text": "Business rules stored in rag_documents with metadata: type=business_rule, source=continuous_scan, source_file, rule_type, priority", "rule_type": "domain", "source_file": "backend/app/services/continuous_rag_service.py", "domain": "RAG Pipeline"},
    {"rule_text": "Deleted files marked as DELETED status; corresponding RAG documents deleted by source_file filter", "rule_type": "workflow", "source_file": "backend/app/services/continuous_rag_service.py", "domain": "RAG Pipeline"},
    {"rule_text": "Document upload allowed file types: .md, .txt, .rst, .yaml, .yml, .json; UTF-8 encoding required", "rule_type": "validation", "source_file": "backend/app/api/routes/knowledge.py", "domain": "RAG Pipeline"},
    {"rule_text": "Document chunking: Splits documents into 500-char chunks with 50-char overlap, breaks at paragraph/sentence boundaries", "rule_type": "domain", "source_file": "backend/app/api/routes/knowledge.py", "domain": "RAG Pipeline"},
    {"rule_text": "Knowledge search requires minimum 3 characters query; similarity threshold 0.0-1.0; max 20 results", "rule_type": "validation", "source_file": "backend/app/api/routes/knowledge.py", "domain": "RAG Pipeline"},
    {"rule_text": "Orbit knowledge upload saves to satellite/docs/ on disk AND chunks+indexes in RAG simultaneously", "rule_type": "workflow", "source_file": "backend/app/api/routes/knowledge.py", "domain": "RAG Pipeline"},
    {"rule_text": "Scan depth profiles: quick (30 files), normal (100 files), deep (ALL files), local (50 files for Ollama)", "rule_type": "domain", "source_file": "backend/app/services/codebase_memory.py", "domain": "RAG Pipeline"},
    {"rule_text": "Analysis extensions: .py, .php, .js, .ts, .tsx, .jsx, .java, .rb, .go, .cs, .swift, .kt, .vue, .svelte plus template formats", "rule_type": "constraint", "source_file": "backend/app/services/codebase_memory.py", "domain": "RAG Pipeline"},

    # ========== DOMAIN: Project Lifecycle (9 rules) ==========
    {"rule_text": "code_path is REQUIRED and IMMUTABLE after project creation; projects must reference existing code folders", "rule_type": "constraint", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "Project lifecycle: draft (context created) → processing (pipeline running) → active (first epic approved)", "rule_type": "workflow", "source_file": "backend/app/models/project.py", "domain": "Project Lifecycle"},
    {"rule_text": "Project context locked after first Epic approval; prevents context changes once hierarchy generation starts", "rule_type": "constraint", "source_file": "backend/app/models/project.py", "domain": "Project Lifecycle"},
    {"rule_text": "Project deletion has full cascade cleanup: cancel jobs, delete RAG docs, delete analyses, but PRESERVE code_path and satellite/ on disk", "rule_type": "workflow", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "Protected projects: if project.protected=true, deletion requires system setting allow_protected_project_deletion=true", "rule_type": "constraint", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "Concurrent scan guard: only one scan can be running per project at a time; reject if another is pending/running", "rule_type": "constraint", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "Epic generation blocked if RAG indexing in progress (checks for PENDING/RUNNING scan jobs)", "rule_type": "constraint", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "Wizard completion cleanup: Project only exists permanently if wizard is COMPLETELY finished; abandoned projects auto-deleted", "rule_type": "workflow", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "initial_scan_complete flag blocks Continuous RAG scheduler until initial memory scan finishes", "rule_type": "constraint", "source_file": "backend/app/models/project.py", "domain": "Project Lifecycle"},

    # ========== DOMAIN: Card Hierarchy (8 rules) ==========
    {"rule_text": "Business rule cards use rigid 4-level hierarchy: Epic > Story > Task > Subtask; each level has specific story points (13/8/3/1)", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Card Hierarchy"},
    {"rule_text": "All generated cards have: description (human-readable), generated_prompt (semantic), acceptance_criteria, semantic_map, description_edited_by=ai, prompt_edited_by=ai", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Card Hierarchy"},
    {"rule_text": "Existing business_rule/from_rag cards deleted before regenerating to allow re-running with updated RAG", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Card Hierarchy"},
    {"rule_text": "Tasks group rules in sets of 3 (RULES_PER_TASK); Subtasks = 1 rule each", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Card Hierarchy"},
    {"rule_text": "Hierarchy validation: Epic can contain Story, Story can contain Task/Bug, Task can contain Subtask; Subtask and Bug are terminal (no children)", "rule_type": "validation", "source_file": "backend/app/api/routes/tasks_routes.py", "domain": "Card Hierarchy"},
    {"rule_text": "Task status-to-column mapping: backlog/todo/in_progress/review/done maps to Kanban columns", "rule_type": "domain", "source_file": "backend/app/api/routes/tasks_routes.py", "domain": "Card Hierarchy"},
    {"rule_text": "When task status changes to DONE, index it in RAG with metadata for knowledge retention", "rule_type": "workflow", "source_file": "backend/app/api/routes/tasks_routes.py", "domain": "Card Hierarchy"},
    {"rule_text": "All business rule cards labeled with ['from_rag'] and workflow_state='open'", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Card Hierarchy"},

    # ========== DOMAIN: Card Activation (7 rules) ==========
    {"rule_text": "REGRA #0: Never overwrite human-edited description/prompt; check description_edited_by and prompt_edited_by fields before AI update", "rule_type": "constraint", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation"},
    {"rule_text": "Project context must exist (context_semantic populated) before card activation", "rule_type": "validation", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation"},
    {"rule_text": "Auto-generation of draft children after activation: Epic→Stories(10), Story→Tasks(8), Task→Subtasks(5)", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation"},
    {"rule_text": "Acceptance criteria minimum thresholds: Epic=50 chars, Story=50, Task=30, Subtask=20; generated from fallback templates if too short", "rule_type": "validation", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation"},
    {"rule_text": "Suggested epics labeled with ['suggested'] and workflow_state='draft'; exclude existing features from memory scan", "rule_type": "domain", "source_file": "backend/app/services/context_generator/draft_generator.py", "domain": "Card Activation"},
    {"rule_text": "Similar cards auto-skipped if similarity_threshold >= 0.85 via RAG duplicate detection", "rule_type": "constraint", "source_file": "backend/app/services/context_generator/draft_generator.py", "domain": "Card Activation"},
    {"rule_text": "Activated card indexed in RAG for semantic search enabling future duplicate detection", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation"},

    # ========== DOMAIN: Interview System (6 rules) ==========
    {"rule_text": "Dual-mode interview routing: Context Interview (Q1-Q3 fixed) vs Epic Interview (AI-driven) based on project state", "rule_type": "workflow", "source_file": "backend/app/api/routes/interviews/endpoints.py", "domain": "Interview System"},
    {"rule_text": "Context Interview is UNLIMITED: user decides when to stop via 'Gerar Contexto' button; first 3 questions Q1-Q3 are always fixed", "rule_type": "domain", "source_file": "backend/app/api/routes/interviews/endpoints.py", "domain": "Interview System"},
    {"rule_text": "Context locked after first Epic approval: prevents context changes once hierarchy generation starts", "rule_type": "constraint", "source_file": "backend/app/api/routes/interviews/endpoints.py", "domain": "Interview System"},
    {"rule_text": "Closed questions preferred: system generates questions with multiple-choice options not open-ended", "rule_type": "domain", "source_file": "backend/app/api/routes/interviews/endpoints.py", "domain": "Interview System"},
    {"rule_text": "Meta Prompt: FIRST interview always collects 8 fixed questions (Q1-Q8) plus AI contextual questions (Q9+)", "rule_type": "domain", "source_file": "backend/app/api/routes/interviews/fixed_questions.py", "domain": "Interview System"},
    {"rule_text": "Interview modes: requirements (global gathering), task_focused (specific task), context (3 fixed questions), card_focused (card creation)", "rule_type": "domain", "source_file": "backend/app/models/interview.py", "domain": "Interview System"},

    # ========== DOMAIN: Data Protection (8 rules) ==========
    {"rule_text": "REGRA #0 - Human data supremacy: AI-generated data NEVER overwrites data inserted or edited by a human operator", "rule_type": "constraint", "source_file": "backend/app/models/task.py", "domain": "Data Protection"},
    {"rule_text": "description_edited_by and prompt_edited_by fields track if human manually edited; AI activation MUST NOT overwrite fields marked as 'human'", "rule_type": "constraint", "source_file": "backend/app/models/task.py", "domain": "Data Protection"},
    {"rule_text": "Satellite folder structure is SACRED and PROTECTED: satellite/, satellite/memory/, satellite/docs/, satellite/knowledge/ and subdirectories can NEVER be deleted by automated processes", "rule_type": "constraint", "source_file": "backend/app/services/orbit_folder.py", "domain": "Data Protection"},
    {"rule_text": "safe_rmtree() enforces 3 blocks: never delete code_path itself, never delete protected satellite paths, never delete parent of satellite/", "rule_type": "constraint", "source_file": "backend/app/services/orbit_folder.py", "domain": "Data Protection"},
    {"rule_text": "Python Path-joining vulnerability: Path('a') / '/b' resolves to '/b' (absolute path replaces); must validate paths are relative", "rule_type": "constraint", "source_file": "backend/app/services/orbit_folder.py", "domain": "Data Protection"},
    {"rule_text": "Wiki REGRA #0: Protected sources (manual, enrichment) NEVER overwritten by automated content (ai_generated)", "rule_type": "constraint", "source_file": "backend/app/services/wiki_fs.py", "domain": "Data Protection"},
    {"rule_text": "Directory traversal protection: remove leading slashes and '..' from folder browsing to prevent path traversal attacks", "rule_type": "validation", "source_file": "backend/app/api/routes/projects.py", "domain": "Data Protection"},
    {"rule_text": "Filename sanitized to prevent path traversal: use Path.name only, no leading dots allowed", "rule_type": "validation", "source_file": "backend/app/services/orbit_folder.py", "domain": "Data Protection"},

    # ========== DOMAIN: Job Queue (6 rules) ==========
    {"rule_text": "Job Priority Hierarchy: CRITICAL(10) for interviews/chat, HIGH(7) for context/pipeline, NORMAL(5) for scans/generation, LOW(3) for children/activation", "rule_type": "domain", "source_file": "backend/app/models/async_job.py", "domain": "Job Queue"},
    {"rule_text": "Async job workflow: Client creates job → returns job_id immediately → BackgroundTask executes → Client polls /jobs/{id} for status", "rule_type": "workflow", "source_file": "backend/app/models/async_job.py", "domain": "Job Queue"},
    {"rule_text": "WebSocket connection for real-time job updates: handles job_started, job_progress, job_completed, job_failed, job_cancelled events", "rule_type": "domain", "source_file": "frontend/src/app/jobs/page.tsx", "domain": "Job Queue"},
    {"rule_text": "WebSocket ping every 30s to keep connection alive; auto-reconnect with exponential backoff on disconnect", "rule_type": "workflow", "source_file": "frontend/src/app/jobs/page.tsx", "domain": "Job Queue"},
    {"rule_text": "Sub-job hierarchy: Jobs can have parent_job_id creating tree structure for tracking phases", "rule_type": "domain", "source_file": "backend/app/models/async_job.py", "domain": "Job Queue"},
    {"rule_text": "Job cleanup options: delete all completed, older than 1 day, 7 days, or 30 days with confirmation dialog", "rule_type": "workflow", "source_file": "frontend/src/app/jobs/page.tsx", "domain": "Job Queue"},

    # ========== DOMAIN: Wiki & Knowledge (6 rules) ==========
    {"rule_text": "Wiki pages stored as .md files with YAML front matter in satellite/knowledge/wiki/ directory", "rule_type": "domain", "source_file": "backend/app/services/wiki_fs.py", "domain": "Wiki & Knowledge"},
    {"rule_text": "Wiki ID generation deterministic using uuid5 from project_id + slug (not random)", "rule_type": "domain", "source_file": "backend/app/services/wiki_fs.py", "domain": "Wiki & Knowledge"},
    {"rule_text": "Wiki slug must be unique within project; ensure_unique_slug appends -N counter for duplicates", "rule_type": "validation", "source_file": "backend/app/services/wiki_fs.py", "domain": "Wiki & Knowledge"},
    {"rule_text": "Wiki page hierarchy derived from directory structure: root = slug.md, child = parent_slug/slug.md", "rule_type": "domain", "source_file": "backend/app/services/wiki_fs.py", "domain": "Wiki & Knowledge"},
    {"rule_text": "Empty parent directories cleaned up to wiki root but NEVER above satellite/knowledge/wiki safety boundary", "rule_type": "constraint", "source_file": "backend/app/services/wiki_fs.py", "domain": "Wiki & Knowledge"},
    {"rule_text": "All prompts must be externalized to YAML files in backend/app/prompts/; PromptLoader renders with Jinja2", "rule_type": "constraint", "source_file": "backend/app/prompts/loader.py", "domain": "Wiki & Knowledge"},

    # ========== DOMAIN: Frontend Architecture (8 rules) ==========
    {"rule_text": "All pages use Layout + Breadcrumbs pattern from @/components/layout; content wrapped in space-y-6 div", "rule_type": "domain", "source_file": "frontend/src/components/layout/Layout.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Sidebar collapsible between expanded (180px) and collapsed (56px); state persisted to localStorage", "rule_type": "domain", "source_file": "frontend/src/components/layout/Layout.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Project details page has 10 tabs: Overview, Backlog, Kanban, Queue, Wiki, Chat, Specs, Commits, RAG, Analytics", "rule_type": "domain", "source_file": "frontend/src/app/projects/[id]/page.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Inline editing: titles and descriptions support double-click to edit with rich markdown toolbar and auto-save", "rule_type": "domain", "source_file": "frontend/src/app/projects/[id]/page.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Enrichment polling: every 5 seconds check enrichment status; when complete do final project data refresh", "rule_type": "workflow", "source_file": "frontend/src/app/projects/[id]/page.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Context interview wizard: 3-step flow (Interview → Review → Complete) with unlimited questions, fixed Q1-Q3 minimum", "rule_type": "workflow", "source_file": "frontend/src/app/projects/[id]/setup-context/page.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "AI Flow page: n8n-style node-based flow diagram using @xyflow/react with drag-drop model assignment", "rule_type": "domain", "source_file": "frontend/src/app/ai-flow/page.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Dashboard auto-refreshes cache stats every 30 seconds; cost analytics filtered by dateRange, provider, usage_type", "rule_type": "workflow", "source_file": "frontend/src/app/page.tsx", "domain": "Frontend Architecture"},

    # ========== DOMAIN: Cost & Analytics (5 rules) ==========
    {"rule_text": "Cost calculation: sums input_tokens * input_price + output_tokens * output_price per model execution", "rule_type": "domain", "source_file": "backend/app/api/routes/cost_analytics.py", "domain": "Cost & Analytics"},
    {"rule_text": "RAG hit tracking: records rag_enabled, rag_hit, rag_results_count, rag_top_similarity, rag_retrieval_time_ms per execution", "rule_type": "domain", "source_file": "backend/app/api/routes/cost_analytics.py", "domain": "Cost & Analytics"},
    {"rule_text": "RAG hit rate calculation: (total_rag_hits / total_rag_enabled) * 100 as percentage", "rule_type": "domain", "source_file": "backend/app/api/routes/cost_analytics.py", "domain": "Cost & Analytics"},
    {"rule_text": "Every AI call logged in ai_executions with: model, provider, tokens (in/out), cost, duration, chain position, RAG metrics", "rule_type": "domain", "source_file": "backend/app/models/ai_execution.py", "domain": "Cost & Analytics"},
    {"rule_text": "Prompt versioning: each version increments number; parent_id links versions in tree for history", "rule_type": "domain", "source_file": "backend/app/api/routes/prompts.py", "domain": "Cost & Analytics"},

    # ========== DOMAIN: Data Model (8 rules) ==========
    {"rule_text": "Project cascade deletes: interviews, prompts, tasks, commits, analyses, prompt_templates, specs, chats all deleted when project deleted", "rule_type": "constraint", "source_file": "backend/app/models/project.py", "domain": "Data Model"},
    {"rule_text": "Task self-referential hierarchy: parent_id FK with CASCADE delete; deleting parent deletes all children", "rule_type": "constraint", "source_file": "backend/app/models/task.py", "domain": "Data Model"},
    {"rule_text": "Task relationship types: blocks, blocked_by, depends_on, relates_to, duplicates, clones with UNIQUE constraint preventing duplicates", "rule_type": "domain", "source_file": "backend/app/models/task_relationship.py", "domain": "Data Model"},
    {"rule_text": "Status transition audit: all task status changes logged with from_status, to_status, timestamp, reason", "rule_type": "workflow", "source_file": "backend/app/models/status_transition.py", "domain": "Data Model"},
    {"rule_text": "Prompt queue ordering: hierarchy first (epics before stories), then dependencies, then priority, then age, then manual overrides", "rule_type": "domain", "source_file": "backend/app/models/prompt_queue.py", "domain": "Data Model"},
    {"rule_text": "rag_file_state UNIQUE constraint on (project_id, file_path): one tracking row per file per project", "rule_type": "constraint", "source_file": "backend/app/models/rag_file_state.py", "domain": "Data Model"},
    {"rule_text": "Task blocked system: >90% semantic similarity triggers BLOCKED status with pending_modification; user must approve/reject", "rule_type": "workflow", "source_file": "backend/app/api/routes/tasks_routes.py", "domain": "Data Model"},
    {"rule_text": "Conventional commits: types are feat, fix, docs, style, refactor, test, chore, perf", "rule_type": "domain", "source_file": "backend/app/models/commit.py", "domain": "Data Model"},

    # =====================================================================
    # NEW DOMAINS (21 domains, 163 rules)
    # =====================================================================

    # ========== DOMAIN: Rate Limiting & Provider Backoff (5 rules) ==========
    {"rule_text": "Sliding window rate limiting uses Redis sorted sets with timestamps as scores; each request adds a member and counts entries within the window", "rule_type": "domain", "source_file": "backend/app/services/rate_limiter.py", "domain": "Rate Limiting & Provider Backoff"},
    {"rule_text": "Fail-open on Redis failure: if Redis is unreachable, the request is ALLOWED (not blocked), preventing system-wide outage from cache failure", "rule_type": "constraint", "source_file": "backend/app/services/rate_limiter.py", "domain": "Rate Limiting & Provider Backoff"},
    {"rule_text": "Provider backoff period support: when a provider returns retry-after headers, all requests to that provider are blocked for the specified duration", "rule_type": "workflow", "source_file": "backend/app/services/rate_limiter.py", "domain": "Rate Limiting & Provider Backoff"},
    {"rule_text": "TTL on rate limit keys is set to 2x the window duration for automatic cleanup", "rule_type": "domain", "source_file": "backend/app/services/rate_limiter.py", "domain": "Rate Limiting & Provider Backoff"},
    {"rule_text": "Rate limiter node in utility pipeline caps requests by model's configured ceiling (from ai_models table)", "rule_type": "constraint", "source_file": "backend/app/services/utility_node_executor.py", "domain": "Rate Limiting & Provider Backoff"},

    # ========== DOMAIN: Error Classification & Retry (3 rules) ==========
    {"rule_text": "Three error categories: permanent (never retry: 401/403/404), transient (retry: 429/500-504), oom (skip ALL models of the same provider)", "rule_type": "domain", "source_file": "backend/app/services/error_classifier.py", "domain": "Error Classification & Retry"},
    {"rule_text": "Default classification for unknown errors is 'transient' (safer to retry than to give up)", "rule_type": "constraint", "source_file": "backend/app/services/error_classifier.py", "domain": "Error Classification & Retry"},
    {"rule_text": "OOM errors trigger provider-level skip: all models from the failing provider are bypassed in the fallback chain", "rule_type": "workflow", "source_file": "backend/app/services/error_classifier.py", "domain": "Error Classification & Retry"},

    # ========== DOMAIN: Workflow State Machine (4 rules) ==========
    {"rule_text": "Per-item-type workflow state sets: Epic has 5 states, Story has 6, Task has 6, Bug has 6, Subtask has 3; loaded from YAML contracts with inline fallback", "rule_type": "domain", "source_file": "backend/app/services/workflow_validator.py", "domain": "Workflow State Machine"},
    {"rule_text": "'done' is a terminal state with NO outgoing transitions allowed", "rule_type": "constraint", "source_file": "backend/app/services/workflow_validator.py", "domain": "Workflow State Machine"},
    {"rule_text": "Default workflow_state is 'backlog' if null/undefined", "rule_type": "validation", "source_file": "backend/app/services/workflow_validator.py", "domain": "Workflow State Machine"},
    {"rule_text": "Every status transition is audited in the StatusTransition table with from_state, to_state, timestamp, and actor", "rule_type": "workflow", "source_file": "backend/app/services/workflow_validator.py", "domain": "Workflow State Machine"},

    # ========== DOMAIN: Pipeline Validation & Anti-Hallucination (8 rules) ==========
    {"rule_text": "Wiki pages require minimum 3 of 6 mandatory sections (visao geral, regras de negocio, fluxos, entidades, restricoes, cenarios)", "rule_type": "validation", "source_file": "backend/app/services/pipeline_validator.py", "domain": "Pipeline Validation & Anti-Hallucination"},
    {"rule_text": "Context updates must not shrink below 80% of original length (anti-shrink validation)", "rule_type": "constraint", "source_file": "backend/app/services/pipeline_validator.py", "domain": "Pipeline Validation & Anti-Hallucination"},
    {"rule_text": "Evidence markers required in context updates: must contain at least one of 'descoberto em', 'origem:', 'fonte:'", "rule_type": "validation", "source_file": "backend/app/contracts/pipeline/validation_rules.yaml", "domain": "Pipeline Validation & Anti-Hallucination"},
    {"rule_text": "Epics must use 100% functional language; more than 2 technical terms (migration, endpoint, api, controller, model, database, sql, query, middleware, router, http) triggers blocking validation", "rule_type": "constraint", "source_file": "backend/app/services/pipeline_validator.py", "domain": "Pipeline Validation & Anti-Hallucination"},
    {"rule_text": "Stories should follow 'Como X, quero Y, para Z' user story format", "rule_type": "validation", "source_file": "backend/app/services/pipeline_validator.py", "domain": "Pipeline Validation & Anti-Hallucination"},
    {"rule_text": "Card titles minimum 10 characters, descriptions minimum 20 characters", "rule_type": "validation", "source_file": "backend/app/services/pipeline_validator.py", "domain": "Pipeline Validation & Anti-Hallucination"},
    {"rule_text": "Wiki page create mode requires >= 100 words; merge mode requires >= 100 words", "rule_type": "validation", "source_file": "backend/app/contracts/pipeline/validation_rules.yaml", "domain": "Pipeline Validation & Anti-Hallucination"},
    {"rule_text": "Stories response must be valid JSON containing a 'stories' array with each story having 'title' and 'description' fields", "rule_type": "validation", "source_file": "backend/app/contracts/pipeline/validation_rules.yaml", "domain": "Pipeline Validation & Anti-Hallucination"},

    # ========== DOMAIN: Similarity Detection & Deduplication (6 rules) ==========
    {"rule_text": "90% similarity threshold for detecting task modification attempts; similar new task blocks the existing task instead of creating a duplicate", "rule_type": "constraint", "source_file": "backend/app/services/similarity_detector.py", "domain": "Similarity Detection & Deduplication"},
    {"rule_text": "Already-blocked tasks are skipped during similarity checking", "rule_type": "workflow", "source_file": "backend/app/services/similarity_detector.py", "domain": "Similarity Detection & Deduplication"},
    {"rule_text": "Similar tasks search uses 70% threshold with limit of 5 results", "rule_type": "domain", "source_file": "backend/app/services/similarity_detector.py", "domain": "Similarity Detection & Deduplication"},
    {"rule_text": "Tiered similarity thresholds: exact_match_cache=0.95, modification_detection=0.90, card_deduplication=0.85, rag_relevance=0.85, backlog_deduplication=0.60, memory_search=0.50", "rule_type": "domain", "source_file": "backend/app/contracts/execution/similarity_thresholds.yaml", "domain": "Similarity Detection & Deduplication"},
    {"rule_text": "85% similarity threshold for interview question deduplication (stricter than task's 90%); questions scoped by project_id", "rule_type": "constraint", "source_file": "backend/app/services/interview_question_deduplicator.py", "domain": "Similarity Detection & Deduplication"},
    {"rule_text": "Question cleaning for deduplication removes emojis, formatting markers, options, and instructions before comparison", "rule_type": "workflow", "source_file": "backend/app/services/interview_question_deduplicator.py", "domain": "Similarity Detection & Deduplication"},

    # ========== DOMAIN: Modification Approval Workflow (4 rules) ==========
    {"rule_text": "Blocked task stores proposed_modification as JSON with all new field values and similarity_score", "rule_type": "domain", "source_file": "backend/app/services/modification_manager.py", "domain": "Modification Approval Workflow"},
    {"rule_text": "Approving a modification creates a new task with the proposed changes AND archives the old task as DONE", "rule_type": "workflow", "source_file": "backend/app/services/modification_manager.py", "domain": "Modification Approval Workflow"},
    {"rule_text": "Rejecting a modification restores the task to its previous status from status_history", "rule_type": "workflow", "source_file": "backend/app/services/modification_manager.py", "domain": "Modification Approval Workflow"},
    {"rule_text": "Status history is tracked as an array of transition records [{from, to, at, by}] for rollback support", "rule_type": "domain", "source_file": "backend/app/models/task.py", "domain": "Modification Approval Workflow"},

    # ========== DOMAIN: Token Budget Management (4 rules) ==========
    {"rule_text": "Story point budgets: 1-2sp=2000, 3sp=2500, 5sp=3000, 8sp=4000, 13sp=5000, 21sp=6000 tokens", "rule_type": "domain", "source_file": "backend/app/contracts/execution/token_budgets.yaml", "domain": "Token Budget Management"},
    {"rule_text": "Item type budgets: subtask=1500, task=2500, bug=2000, story=4000, epic=6000 tokens", "rule_type": "domain", "source_file": "backend/app/contracts/execution/token_budgets.yaml", "domain": "Token Budget Management"},
    {"rule_text": "Actual budget is max(story_point_budget, type_budget, default_budget=2500)", "rule_type": "domain", "source_file": "backend/app/services/task_execution/budget_manager.py", "domain": "Token Budget Management"},
    {"rule_text": "System comment is auto-created when actual token usage exceeds budget", "rule_type": "workflow", "source_file": "backend/app/services/task_execution/budget_manager.py", "domain": "Token Budget Management"},

    # ========== DOMAIN: Prompt Structure & Compression (6 rules) ==========
    {"rule_text": "Every prompt_generation call must follow 4-section structure: [SYSTEM] role/methodology, [TASK] what to generate, [CONTEXT] parent+RAG+rules deduped, [OUTPUT SCHEMA] expected JSON format", "rule_type": "domain", "source_file": "backend/app/services/prompt_structure_normalizer.py", "domain": "Prompt Structure & Compression"},
    {"rule_text": "Parent context summarization varies by hierarchy level: Epic=none, Story=1500 chars, Task=1000+Epic title only, Subtask=500 chars", "rule_type": "domain", "source_file": "backend/app/services/prompt_context_compressor.py", "domain": "Prompt Structure & Compression"},
    {"rule_text": "Semantic map deduplication via delta computation: only identifiers NOT present in parent/grandparent are included in child prompts", "rule_type": "workflow", "source_file": "backend/app/services/prompt_context_compressor.py", "domain": "Prompt Structure & Compression"},
    {"rule_text": "Business rules injection varies by level: Epic=full 15 rules, Story=filtered top-5 relevant, Task/Subtask=reference only", "rule_type": "domain", "source_file": "backend/app/services/prompt_context_compressor.py", "domain": "Prompt Structure & Compression"},
    {"rule_text": "Token budget enforcement truncates in priority order: conversation first, then parent context, semantic map last (never truncated)", "rule_type": "constraint", "source_file": "backend/app/services/prompt_context_compressor.py", "domain": "Prompt Structure & Compression"},
    {"rule_text": "Token estimation uses chars/3 for Portuguese text", "rule_type": "domain", "source_file": "backend/app/services/prompt_context_compressor.py", "domain": "Prompt Structure & Compression"},

    # ========== DOMAIN: AI Response Validation (5 rules) ==========
    {"rule_text": "Confidence scoring starts at 1.0, decremented per issue; valid if >= 0.5, escalation triggered if < 0.4", "rule_type": "domain", "source_file": "backend/app/services/general_response_validator.py", "domain": "AI Response Validation"},
    {"rule_text": "Truncation detection: checks for unclosed JSON brackets, unclosed code blocks (unmatched triple-backticks)", "rule_type": "validation", "source_file": "backend/app/services/general_response_validator.py", "domain": "AI Response Validation"},
    {"rule_text": "Language consistency check: detects mixing of Portuguese and English in same response", "rule_type": "validation", "source_file": "backend/app/services/general_response_validator.py", "domain": "AI Response Validation"},
    {"rule_text": "Error pattern detection: identifies rate limit errors, server errors, API key issues embedded in AI response text", "rule_type": "validation", "source_file": "backend/app/services/general_response_validator.py", "domain": "AI Response Validation"},
    {"rule_text": "Refusal pattern detection: identifies when AI refuses to answer instead of generating content", "rule_type": "validation", "source_file": "backend/app/services/general_response_validator.py", "domain": "AI Response Validation"},

    # ========== DOMAIN: Utility Node Pipeline (7 rules) ==========
    {"rule_text": "Pre-process order is strictly: rate_limiter -> cost_guard -> cache -> rag_context -> prompt_transformer -> router", "rule_type": "domain", "source_file": "backend/app/services/utility_node_executor.py", "domain": "Utility Node Pipeline"},
    {"rule_text": "Post-process order is strictly: validator -> cache", "rule_type": "domain", "source_file": "backend/app/services/utility_node_executor.py", "domain": "Utility Node Pipeline"},
    {"rule_text": "Cost guard enforces daily AND monthly budget limits; blocks execution when either is exceeded", "rule_type": "constraint", "source_file": "backend/app/services/utility_node_executor.py", "domain": "Utility Node Pipeline"},
    {"rule_text": "Router uses complexity-based tier mapping: fast (simple queries), balanced (moderate), strong (complex tasks)", "rule_type": "domain", "source_file": "backend/app/services/utility_node_executor.py", "domain": "Utility Node Pipeline"},
    {"rule_text": "JSON auto-repair handles trailing commas, single quotes, and unquoted keys in AI responses", "rule_type": "workflow", "source_file": "backend/app/services/utility_node_executor.py", "domain": "Utility Node Pipeline"},
    {"rule_text": "Interview response structural scoring 0.0-1.0 based on presence of expected elements", "rule_type": "validation", "source_file": "backend/app/services/utility_node_executor.py", "domain": "Utility Node Pipeline"},
    {"rule_text": "Temperature override clamped to 0.0-2.0 range", "rule_type": "validation", "source_file": "backend/app/services/utility_node_executor.py", "domain": "Utility Node Pipeline"},

    # ========== DOMAIN: Query Classification (4 rules) ==========
    {"rule_text": "Zero-latency heuristic classification using weighted scoring: no AI call required for query complexity assessment", "rule_type": "domain", "source_file": "backend/app/services/general_query_classifier.py", "domain": "Query Classification"},
    {"rule_text": "Complexity score components: message length (0-30), conversation depth (0-15), code presence (0-15), reasoning patterns (0-20), multi-step (0-10), task type (0-10), system prompt (0-5)", "rule_type": "domain", "source_file": "backend/app/services/general_query_classifier.py", "domain": "Query Classification"},
    {"rule_text": "Tier thresholds: simple < 25, moderate 25-50, complex >= 50", "rule_type": "domain", "source_file": "backend/app/services/general_query_classifier.py", "domain": "Query Classification"},
    {"rule_text": "Token estimates by tier: simple=150, moderate=400, complex=800", "rule_type": "domain", "source_file": "backend/app/services/general_query_classifier.py", "domain": "Query Classification"},

    # ========== DOMAIN: File Upload & Archive Security (7 rules) ==========
    {"rule_text": "Allowed upload extensions whitelist: .zip, .tar, .tar.gz, .tgz", "rule_type": "validation", "source_file": "backend/app/services/file_processor.py", "domain": "File Upload & Archive Security"},
    {"rule_text": "MIME type validation via magic bytes: only specific MIME types accepted (application/zip, application/x-tar, application/gzip)", "rule_type": "validation", "source_file": "backend/app/services/file_processor.py", "domain": "File Upload & Archive Security"},
    {"rule_text": "Path traversal prevention: normalized paths checked for '..' and absolute paths; rejects archives containing traversal attempts", "rule_type": "constraint", "source_file": "backend/app/services/file_processor.py", "domain": "File Upload & Archive Security"},
    {"rule_text": "Zip bomb protection: total extracted size checked against max_extraction_size (500MB); exceeding limit deletes extraction directory", "rule_type": "constraint", "source_file": "backend/app/services/file_processor.py", "domain": "File Upload & Archive Security"},
    {"rule_text": "Filename sanitization: only alphanumeric, dash, underscore, dot allowed; truncated to 255 characters", "rule_type": "validation", "source_file": "backend/app/services/file_processor.py", "domain": "File Upload & Archive Security"},
    {"rule_text": "Empty file upload rejected (file_size == 0)", "rule_type": "validation", "source_file": "backend/app/services/file_processor.py", "domain": "File Upload & Archive Security"},
    {"rule_text": "File tree building skips files > 10MB and has max directory depth of 10", "rule_type": "constraint", "source_file": "backend/app/services/file_processor.py", "domain": "File Upload & Archive Security"},

    # ========== DOMAIN: Codebase Scanning & Indexing (8 rules) ==========
    {"rule_text": "Three scan depths: quick (30 files, 2 phases), normal (100 files, 4 phases), deep (ALL files, N phases)", "rule_type": "domain", "source_file": "backend/app/services/codebase_memory.py", "domain": "Codebase Scanning & Indexing"},
    {"rule_text": "IGNORE_DIRECTORIES set contains 60+ directories to always skip (node_modules, vendor, .venv, dist, build, .git, coverage, satellite, etc.)", "rule_type": "constraint", "source_file": "backend/app/services/codebase_memory.py", "domain": "Codebase Scanning & Indexing"},
    {"rule_text": "Analysis limited to specific extensions: .py, .php, .js, .ts, .tsx, .jsx, .java, .rb, .go, .cs, .swift, .kt, .vue, .svelte, plus view/template files", "rule_type": "constraint", "source_file": "backend/app/services/codebase_memory.py", "domain": "Codebase Scanning & Indexing"},
    {"rule_text": "File size limit: only files < 1MB are included in pattern discovery inventory", "rule_type": "constraint", "source_file": "backend/app/services/pattern_discovery.py", "domain": "Codebase Scanning & Indexing"},
    {"rule_text": "Pattern discovery requires minimum 3 file occurrences to consider a group for pattern extraction", "rule_type": "constraint", "source_file": "backend/app/services/pattern_discovery.py", "domain": "Codebase Scanning & Indexing"},
    {"rule_text": "Global blocklist from system_settings table (key='global_blocklist') extends default ignore directories and file patterns", "rule_type": "domain", "source_file": "backend/app/services/codebase_indexer.py", "domain": "Codebase Scanning & Indexing"},
    {"rule_text": "Code search similarity threshold is 0.7: only relevant results returned", "rule_type": "domain", "source_file": "backend/app/services/codebase_indexer.py", "domain": "Codebase Scanning & Indexing"},
    {"rule_text": "RAG content per file includes first 500 chars of content plus extracted structures (classes, functions, imports, exports: max 10 each)", "rule_type": "domain", "source_file": "backend/app/services/codebase_indexer.py", "domain": "Codebase Scanning & Indexing"},

    # ========== DOMAIN: Knowledge Graph & Static Analysis (8 rules) ==========
    {"rule_text": "God object detection: files with >500 lines OR >20 methods flagged as anti-pattern", "rule_type": "validation", "source_file": "backend/app/services/knowledge_graph_builder.py", "domain": "Knowledge Graph & Static Analysis"},
    {"rule_text": "Massive file threshold is 800 lines", "rule_type": "domain", "source_file": "backend/app/services/knowledge_graph_builder.py", "domain": "Knowledge Graph & Static Analysis"},
    {"rule_text": "Hub nodes: top 10 most-connected files identified for architectural analysis", "rule_type": "domain", "source_file": "backend/app/services/knowledge_graph_builder.py", "domain": "Knowledge Graph & Static Analysis"},
    {"rule_text": "Layer detection by keywords: route/service/model/repository detected from path/class names", "rule_type": "domain", "source_file": "backend/app/services/knowledge_graph_builder.py", "domain": "Knowledge Graph & Static Analysis"},
    {"rule_text": "Anti-pattern severity levels: info, warning, critical", "rule_type": "domain", "source_file": "backend/app/services/knowledge_graph_builder.py", "domain": "Knowledge Graph & Static Analysis"},
    {"rule_text": "High confidence threshold for patterns is 0.75; patterns below this go to AI for interpretation", "rule_type": "domain", "source_file": "backend/app/services/static_pattern_extractor.py", "domain": "Knowledge Graph & Static Analysis"},
    {"rule_text": "MIN_SHARED_RATIO 0.6: at least 60% of files in a group must share a trait to form a pattern", "rule_type": "constraint", "source_file": "backend/app/services/static_pattern_extractor.py", "domain": "Knowledge Graph & Static Analysis"},
    {"rule_text": "Max 8000 characters read per file for static analysis", "rule_type": "constraint", "source_file": "backend/app/services/static_pattern_extractor.py", "domain": "Knowledge Graph & Static Analysis"},

    # ========== DOMAIN: Staged Pattern Discovery Pipeline (5 rules) ==========
    {"rule_text": "4-stage pipeline: Stage 1 Static extraction (no AI), Stage 2 Statistical clustering (no AI), Stage 3 Knowledge graph (no AI), Stage 4 LLM interpretation ONLY for ambiguous/uncovered groups", "rule_type": "domain", "source_file": "backend/app/services/pattern_discovery.py", "domain": "Staged Pattern Discovery"},
    {"rule_text": "Patterns with confidence < 0.5 are sent to AI even if classified by static analysis", "rule_type": "workflow", "source_file": "backend/app/services/pattern_discovery.py", "domain": "Staged Pattern Discovery"},
    {"rule_text": "Pattern ranking formula: occurrences * 10 + confidence * 100 + template_length / 50 + (50 if framework_worthy)", "rule_type": "domain", "source_file": "backend/app/services/pattern_discovery.py", "domain": "Staged Pattern Discovery"},
    {"rule_text": "Maximum 5 sampled files per group for AI analysis; first 5000 chars per file", "rule_type": "constraint", "source_file": "backend/app/services/pattern_discovery.py", "domain": "Staged Pattern Discovery"},
    {"rule_text": "All discovered patterns stored as project-scoped Specs (SpecScope.PROJECT) in the specs table", "rule_type": "domain", "source_file": "backend/app/services/pattern_discovery.py", "domain": "Staged Pattern Discovery"},

    # ========== DOMAIN: Backlog Generation & Decomposition (9 rules) ==========
    {"rule_text": "Epic decomposition generates 3-7 Stories per Epic (not the 15-20 from draft generation)", "rule_type": "domain", "source_file": "backend/app/services/backlog_generator.py", "domain": "Backlog Generation & Decomposition"},
    {"rule_text": "Story decomposition generates 3-10 Tasks per Story", "rule_type": "domain", "source_file": "backend/app/services/backlog_generator.py", "domain": "Backlog Generation & Decomposition"},
    {"rule_text": "Stories estimated in 1-8 story points (Fibonacci)", "rule_type": "domain", "source_file": "backend/app/services/backlog_generator.py", "domain": "Backlog Generation & Decomposition"},
    {"rule_text": "Tasks estimated in 1-3 story points (Fibonacci)", "rule_type": "domain", "source_file": "backend/app/services/backlog_generator.py", "domain": "Backlog Generation & Decomposition"},
    {"rule_text": "Semantic identifiers sorted by length (longest first) during replacement to prevent partial substitution (e.g., AC10 replaced before AC1)", "rule_type": "workflow", "source_file": "backend/app/services/backlog_generator.py", "domain": "Backlog Generation & Decomposition"},
    {"rule_text": "Semantic map deduplication: Mapa Semantico section removed from description BEFORE identifier replacement to prevent redundant output", "rule_type": "workflow", "source_file": "backend/app/services/backlog_generator.py", "domain": "Backlog Generation & Decomposition"},
    {"rule_text": "Task generation from interview detects modification attempts (>90% similarity) and blocks existing task instead of creating duplicate", "rule_type": "constraint", "source_file": "backend/app/services/backlog_generator.py", "domain": "Backlog Generation & Decomposition"},
    {"rule_text": "RAG retrieval of similar completed stories/tasks uses 0.6 similarity threshold with top_k=5 for learning from past work", "rule_type": "domain", "source_file": "backend/app/services/backlog_generator.py", "domain": "Backlog Generation & Decomposition"},
    {"rule_text": "Business rules from RAG are HIGH PRIORITY context that MUST influence all card generation (max 15 rules injected)", "rule_type": "constraint", "source_file": "backend/app/services/backlog_generator.py", "domain": "Backlog Generation & Decomposition"},

    # ========== DOMAIN: Task Hierarchy Rules (5 rules) ==========
    {"rule_text": "Valid parent-child relationships: Epic contains Story, Story contains Task/Bug, Task contains Subtask, Subtask/Bug cannot contain anything", "rule_type": "validation", "source_file": "backend/app/services/task_hierarchy.py", "domain": "Task Hierarchy Rules"},
    {"rule_text": "Cycle prevention: before creating parent-child link, all ancestors of source are checked; if target is an ancestor, operation is rejected", "rule_type": "constraint", "source_file": "backend/app/services/task_hierarchy.py", "domain": "Task Hierarchy Rules"},
    {"rule_text": "Infinite loop protection in ancestor/descendant traversal via visited set", "rule_type": "constraint", "source_file": "backend/app/services/task_hierarchy.py", "domain": "Task Hierarchy Rules"},
    {"rule_text": "Parent delete cascades to children (ondelete=CASCADE on parent_id FK)", "rule_type": "constraint", "source_file": "backend/app/models/task.py", "domain": "Task Hierarchy Rules"},
    {"rule_text": "Severity field only applicable to Bug item type (nullable for other types)", "rule_type": "validation", "source_file": "backend/app/models/task.py", "domain": "Task Hierarchy Rules"},

    # ========== DOMAIN: Card Activation & Lifecycle (10 rules) ==========
    {"rule_text": "Suggested card identified by labels containing 'suggested' OR workflow_state == 'draft'; both must be true for activation", "rule_type": "validation", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation & Lifecycle"},
    {"rule_text": "REGRA #0 enforced: if description_edited_by == 'human', AI activation MUST NOT overwrite description; same for prompt_edited_by", "rule_type": "constraint", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation & Lifecycle"},
    {"rule_text": "Project context is REQUIRED for activation: context_semantic must exist; no fallback auto-generation", "rule_type": "validation", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation & Lifecycle"},
    {"rule_text": "FOR UPDATE lock on project row during activation to prevent race condition on context_locked flag", "rule_type": "constraint", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation & Lifecycle"},
    {"rule_text": "Context locked on ANY card activation (not just Epic), and once locked it cannot be unlocked", "rule_type": "constraint", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation & Lifecycle"},
    {"rule_text": "Project status promoted to 'active' when first Epic is activated", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation & Lifecycle"},
    {"rule_text": "Default children counts from contract: Epic generates 15 Stories (range 15-20), Story generates 8 Tasks (range 5-8), Task generates 5 Subtasks (range 3-5)", "rule_type": "domain", "source_file": "backend/app/contracts/business/generation_counts.yaml", "domain": "Card Activation & Lifecycle"},
    {"rule_text": "Subtask is leaf node: generates content only, no children", "rule_type": "constraint", "source_file": "backend/app/contracts/business/generation_counts.yaml", "domain": "Card Activation & Lifecycle"},
    {"rule_text": "Suggested cards cannot have children: workflow_state must be 'open' or later to generate children", "rule_type": "constraint", "source_file": "backend/app/contracts/business/card_hierarchy.yaml", "domain": "Card Activation & Lifecycle"},
    {"rule_text": "Existing features from memory scan are EXCLUDED from suggested epics (only NEW functionality suggested)", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/draft_generator.py", "domain": "Card Activation & Lifecycle"},

    # ========== DOMAIN: Business Rule Card Generation (9 rules) ==========
    {"rule_text": "Business rules classified by AI into Epic(domain) > Story(area) groups; code decomposes Stories into Tasks (groups of 3) and Subtasks (1 per rule)", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Business Rule Card Generation"},
    {"rule_text": "Hierarchical classification uses chunked processing: splits >100 rules into batches of 100, classifies each, merges by Epic title (case-insensitive)", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Business Rule Card Generation"},
    {"rule_text": "Classification timeout is 180 seconds per chunk; 2 retry attempts before falling back to flat structure", "rule_type": "constraint", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Business Rule Card Generation"},
    {"rule_text": "Default story points by depth: Epic=13, Story=5, Task=3, Subtask=1", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Business Rule Card Generation"},
    {"rule_text": "Default priority by depth: Epic=HIGH, Story=HIGH, Task=MEDIUM, Subtask=MEDIUM", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Business Rule Card Generation"},
    {"rule_text": "All business rule cards labeled 'from_rag' and have description_edited_by='ai', prompt_edited_by='ai'", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Business Rule Card Generation"},
    {"rule_text": "Existing business_rule/from_rag cards are DELETED before regeneration to allow re-running with updated RAG data", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Business Rule Card Generation"},
    {"rule_text": "Flat fallback structure groups rules as 10 per Story, 3 per Task, 1 per Subtask under a single 'Regras de Negocio Documentadas' Epic", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Business Rule Card Generation"},
    {"rule_text": "Acceptance criteria limited to max 6 rules, each truncated to 200 characters", "rule_type": "constraint", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Business Rule Card Generation"},

    # ========== DOMAIN: Project Protection & Configuration (6 rules) ==========
    {"rule_text": "Protected projects (protected=True) cannot be deleted unless system setting 'allow_protected_project_deletion' is 'true'", "rule_type": "constraint", "source_file": "backend/app/models/project.py", "domain": "Project Protection & Configuration"},
    {"rule_text": "Three project statuses: draft (pipeline not started/failed), processing (background pipeline running), active (pipeline complete)", "rule_type": "domain", "source_file": "backend/app/models/project.py", "domain": "Project Protection & Configuration"},
    {"rule_text": "AI-detected ignore patterns stored per project in custom_ignore_patterns JSON field", "rule_type": "domain", "source_file": "backend/app/models/project.py", "domain": "Project Protection & Configuration"},
    {"rule_text": "User-editable ignore_paths (JSON array) per project for excluding paths from scanning", "rule_type": "domain", "source_file": "backend/app/models/project.py", "domain": "Project Protection & Configuration"},
    {"rule_text": "MAX_SPECS_PER_PROJECT = 50", "rule_type": "constraint", "source_file": "backend/app/services/project_service.py", "domain": "Project Protection & Configuration"},
    {"rule_text": "RAG rules limited to 80 per extraction batch to avoid Ollama timeout", "rule_type": "constraint", "source_file": "backend/app/services/project_service.py", "domain": "Project Protection & Configuration"},

    # ========== DOMAIN: Symbol Extraction & Code Analysis (3 rules) ==========
    {"rule_text": "Regex-based code symbol extraction supporting 9 languages (Python, JS/TS, PHP, Java, Go, Ruby, C#, Kotlin, Swift) WITHOUT AST parsing or AI", "rule_type": "domain", "source_file": "backend/app/services/symbol_extractor.py", "domain": "Symbol Extraction & Code Analysis"},
    {"rule_text": "Extracts 4 symbol types: classes/structs/interfaces, function signatures, import statements, and constants (ALL_CAPS names)", "rule_type": "domain", "source_file": "backend/app/services/symbol_extractor.py", "domain": "Symbol Extraction & Code Analysis"},
    {"rule_text": "Purpose is to replace raw code chunks with compact symbol maps that are 5-10x smaller but preserve architectural understanding", "rule_type": "domain", "source_file": "backend/app/services/symbol_extractor.py", "domain": "Symbol Extraction & Code Analysis"},

    # ========== DOMAIN: Watchdog Operational Rules (10 rules) ==========
    {"rule_text": "Cycle cooldowns: ACTIVE=60s, IDLE=300s, ERROR=120s, BATCH_COOLDOWN=2s between file processing", "rule_type": "domain", "source_file": "backend/app/services/watchdog.py", "domain": "Watchdog Operational Rules"},
    {"rule_text": "Resilient DB session with 3 retries and 5-second delay between retries", "rule_type": "workflow", "source_file": "backend/app/services/watchdog.py", "domain": "Watchdog Operational Rules"},
    {"rule_text": "Bootstrap cleanup: zombie RUNNING jobs cleaned on restart; stale PENDING jobs (>5 min old) cleaned on startup", "rule_type": "workflow", "source_file": "backend/app/services/watchdog.py", "domain": "Watchdog Operational Rules"},
    {"rule_text": "Orphaned pending DB jobs (no matching executor task) are re-submitted on startup", "rule_type": "workflow", "source_file": "backend/app/services/watchdog.py", "domain": "Watchdog Operational Rules"},
    {"rule_text": "Failed file processing retried up to 3 times per file per batch", "rule_type": "constraint", "source_file": "backend/app/services/watchdog.py", "domain": "Watchdog Operational Rules"},
    {"rule_text": "Stale batch jobs: 4-hour cutoff for running batch jobs", "rule_type": "constraint", "source_file": "backend/app/services/watchdog.py", "domain": "Watchdog Operational Rules"},
    {"rule_text": "Project existence check before job submission: prevents submitting jobs for deleted projects", "rule_type": "validation", "source_file": "backend/app/services/watchdog.py", "domain": "Watchdog Operational Rules"},
    {"rule_text": "Max cards per cycle loaded from contract YAML (default 10)", "rule_type": "constraint", "source_file": "backend/app/contracts/business/generation_counts.yaml", "domain": "Watchdog Operational Rules"},
    {"rule_text": "Max 2 enrichments per cycle when idle", "rule_type": "constraint", "source_file": "backend/app/contracts/business/generation_counts.yaml", "domain": "Watchdog Operational Rules"},
    {"rule_text": "Shutdown detection via 2-second sleep chunks: breaks long sleeps into checkable intervals", "rule_type": "domain", "source_file": "backend/app/services/watchdog.py", "domain": "Watchdog Operational Rules"},

    # ========== DOMAIN: Pipeline Card Generation (5 rules) ==========
    {"rule_text": "Max 5 stories per domain per batch during incremental card generation", "rule_type": "constraint", "source_file": "backend/app/services/pipeline_cards.py", "domain": "Pipeline Card Generation"},
    {"rule_text": "90% similarity threshold for duplicate card detection during pipeline processing", "rule_type": "constraint", "source_file": "backend/app/services/pipeline_cards.py", "domain": "Pipeline Card Generation"},
    {"rule_text": "Max 15 new rules per batch after similarity filtering", "rule_type": "constraint", "source_file": "backend/app/services/pipeline_cards.py", "domain": "Pipeline Card Generation"},
    {"rule_text": "Domain classification is stack-agnostic: no framework assumptions in domain grouping", "rule_type": "domain", "source_file": "backend/app/services/pipeline_cards.py", "domain": "Pipeline Card Generation"},
    {"rule_text": "Story titles minimum 10 characters", "rule_type": "validation", "source_file": "backend/app/services/pipeline_cards.py", "domain": "Pipeline Card Generation"},

    # ========== DOMAIN: Pipeline Wiki Generation (3 rules) ==========
    {"rule_text": "Max 3 domains processed per batch for wiki page generation", "rule_type": "constraint", "source_file": "backend/app/services/pipeline_wiki.py", "domain": "Pipeline Wiki Generation"},
    {"rule_text": "If first AI generation fails validation, retry once with corrective prompt; if second attempt fails, use fallback template with 6 skeleton sections", "rule_type": "workflow", "source_file": "backend/app/services/pipeline_wiki.py", "domain": "Pipeline Wiki Generation"},
    {"rule_text": "Wiki fallback page has 6 mandatory skeleton sections: Visao Geral, Regras de Negocio, Fluxos e Processos, Entidades Envolvidas, Restricoes e Validacoes, Cenarios de Uso", "rule_type": "domain", "source_file": "backend/app/services/pipeline_wiki.py", "domain": "Pipeline Wiki Generation"},

    # ========== DOMAIN: Batch Execution & Dependencies (3 rules) ==========
    {"rule_text": "Topological sort resolves task dependencies; max iterations capped at 2x task count to prevent infinite loops", "rule_type": "constraint", "source_file": "backend/app/services/task_execution/batch_executor.py", "domain": "Batch Execution & Dependencies"},
    {"rule_text": "Circular dependencies resolved by appending remaining tasks with warning (does not fail the batch)", "rule_type": "workflow", "source_file": "backend/app/services/task_execution/batch_executor.py", "domain": "Batch Execution & Dependencies"},
    {"rule_text": "Individual task failures do not stop the entire batch", "rule_type": "constraint", "source_file": "backend/app/services/task_execution/batch_executor.py", "domain": "Batch Execution & Dependencies"},

    # ========== DOMAIN: Interview Model Rules (5 rules) ==========
    {"rule_text": "Two interview modes: 'requirements' (default) and 'task_focused'", "rule_type": "domain", "source_file": "backend/app/models/interview.py", "domain": "Interview Model Rules"},
    {"rule_text": "Task type selection for task-focused interviews: bug, feature, refactor, enhancement", "rule_type": "domain", "source_file": "backend/app/models/interview.py", "domain": "Interview Model Rules"},
    {"rule_text": "Three interview statuses: ACTIVE, COMPLETED, CANCELLED", "rule_type": "domain", "source_file": "backend/app/models/interview.py", "domain": "Interview Model Rules"},
    {"rule_text": "Interviews cascade-delete with project (ondelete=CASCADE on project_id FK)", "rule_type": "constraint", "source_file": "backend/app/models/interview.py", "domain": "Interview Model Rules"},
    {"rule_text": "Interviews cascade-delete with parent task (ondelete=CASCADE on parent_task_id FK)", "rule_type": "constraint", "source_file": "backend/app/models/interview.py", "domain": "Interview Model Rules"},

    # ========== DOMAIN: Pricing & Cost Calculation (3 rules) ==========
    {"rule_text": "Default pricing for unknown models is $1.00/$5.00 per million tokens (input/output)", "rule_type": "domain", "source_file": "backend/app/utils/pricing.py", "domain": "Pricing & Cost Calculation"},
    {"rule_text": "Partial name match fallback for model name variants (e.g., 'claude-3-5-sonnet' matches 'claude-3-5-sonnet-20241022')", "rule_type": "workflow", "source_file": "backend/app/utils/pricing.py", "domain": "Pricing & Cost Calculation"},
    {"rule_text": "Four providers supported in pricing: Anthropic, OpenAI, Google Gemini, and Cohere", "rule_type": "domain", "source_file": "backend/app/utils/pricing.py", "domain": "Pricing & Cost Calculation"},

    # ========== DOMAIN: Configuration & System Limits (6 rules) ==========
    {"rule_text": "MAX_UPLOAD_SIZE_MB = 100; MAX_EXTRACTION_SIZE_MB = 500", "rule_type": "constraint", "source_file": "backend/app/config.py", "domain": "Configuration & System Limits"},
    {"rule_text": "USE_EXTERNAL_PROMPTS feature flag defaults to False", "rule_type": "domain", "source_file": "backend/app/config.py", "domain": "Configuration & System Limits"},
    {"rule_text": "CORS origins parsed from comma-separated string in ALLOWED_ORIGINS env var", "rule_type": "domain", "source_file": "backend/app/config.py", "domain": "Configuration & System Limits"},
    {"rule_text": "MAX_PARALLEL_EXTRACTIONS from OLLAMA_NUM_PARALLEL env var (default 2)", "rule_type": "constraint", "source_file": "backend/app/services/continuous_rag_service.py", "domain": "Configuration & System Limits"},
    {"rule_text": "Orchestrator class names must end with 'Orchestrator' suffix", "rule_type": "validation", "source_file": "backend/app/services/orchestrator_manager.py", "domain": "Configuration & System Limits"},
    {"rule_text": "Missing orchestrator files are auto-recreated from stored code in database", "rule_type": "workflow", "source_file": "backend/app/services/orchestrator_manager.py", "domain": "Configuration & System Limits"},
]


# ============================================================================
# HIERARCHY DEFINITION - 33 domains
# ============================================================================
HIERARCHY = {}

# Build hierarchy dynamically from rules
for rule in BUSINESS_RULES:
    domain = rule["domain"]
    if domain not in HIERARCHY:
        HIERARCHY[domain] = {"title": domain, "stories": {}}

    # Group rules into stories by source_file prefix
    source = rule["source_file"]
    # Create a story name from the source file
    story_name = os.path.basename(source).replace(".py", "").replace(".tsx", "").replace(".yaml", "").replace("_", " ").title()

    if story_name not in HIERARCHY[domain]["stories"]:
        HIERARCHY[domain]["stories"][story_name] = []
    HIERARCHY[domain]["stories"][story_name].append(rule["rule_text"])


def main():
    from sqlalchemy import text
    from app.database import SessionLocal

    db = SessionLocal()
    now = datetime.utcnow()

    try:
        # =================================================================
        # PHASE 1: Scan files → rag_file_state
        # =================================================================
        logger.info("=" * 60)
        logger.info("PHASE 1: Scanning source files...")
        logger.info("=" * 60)

        files = scan_files(CODE_PATH)
        logger.info(f"Found {len(files)} source files")

        inserted = 0
        for f in files:
            file_id = str(uuid4())
            db.execute(text("""
                INSERT INTO rag_file_state (id, project_id, file_path, file_hash, file_size, last_modified, status, rules_extracted, rag_document_ids, file_layer, created_at, updated_at)
                VALUES (:id, :pid, :fp, :fh, :fs, :lm, 'completed', 0, '[]', :fl, :now, :now)
                ON CONFLICT (project_id, file_path) DO UPDATE SET file_hash = :fh, file_size = :fs, last_modified = :lm, updated_at = :now
            """), {
                "id": file_id, "pid": PROJECT_ID, "fp": f["file_path"],
                "fh": f["file_hash"], "fs": f["file_size"], "lm": f["last_modified"],
                "fl": f["file_layer"], "now": now,
            })
            inserted += 1

        db.commit()
        logger.info(f"Phase 1 complete: {inserted} files tracked in rag_file_state")

        db.execute(text("UPDATE projects SET initial_scan_complete = true WHERE id = :pid"), {"pid": PROJECT_ID})
        db.commit()

        # =================================================================
        # PHASE 2: Insert business rules → rag_documents
        # =================================================================
        logger.info("=" * 60)
        logger.info("PHASE 2: Inserting business rules into RAG...")
        logger.info("=" * 60)

        from sentence_transformers import SentenceTransformer
        logger.info("Loading embedding model: all-MiniLM-L6-v2")
        model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Embedding model loaded")

        rule_doc_ids = {}
        total_rules = 0

        for rule in BUSINESS_RULES:
            doc_id = str(uuid4())
            content = rule["rule_text"]
            embedding = model.encode(content).tolist()
            embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

            metadata = json.dumps({
                "type": "business_rule",
                "content_type": "business_rule",
                "source": "continuous_scan",
                "source_file": rule["source_file"],
                "rule_type": rule["rule_type"],
                "priority": "high" if rule["rule_type"] in ("constraint", "validation") else "normal",
                "domain": rule["domain"],
            })

            db.execute(text("""
                INSERT INTO rag_documents (id, project_id, content, embedding, metadata, created_at, updated_at)
                VALUES (:id, :pid, :content, :emb, :meta, :now, :now)
            """), {
                "id": doc_id, "pid": PROJECT_ID, "content": content,
                "emb": embedding_str, "meta": metadata, "now": now,
            })

            sf = rule["source_file"]
            if sf not in rule_doc_ids:
                rule_doc_ids[sf] = []
            rule_doc_ids[sf].append(doc_id)
            total_rules += 1

        db.commit()
        logger.info(f"Phase 2 complete: {total_rules} business rules inserted into rag_documents")

        for sf, doc_ids in rule_doc_ids.items():
            db.execute(text("""
                UPDATE rag_file_state SET rules_extracted = :cnt, rag_document_ids = :dids
                WHERE project_id = :pid AND file_path = :fp
            """), {
                "cnt": len(doc_ids), "pid": PROJECT_ID, "fp": sf,
                "dids": json.dumps(doc_ids),
            })
        db.commit()

        # =================================================================
        # PHASE 3: Generate hierarchical cards → tasks
        # =================================================================
        logger.info("=" * 60)
        logger.info("PHASE 3: Generating hierarchical cards...")
        logger.info("=" * 60)

        total_cards = 0
        card_counts = {"epic": 0, "story": 0, "task": 0, "subtask": 0}

        for domain_key, domain_data in HIERARCHY.items():
            epic_id = uuid4()
            epic_title = domain_data["title"]

            epic_semantic_map = {"N1": epic_title, "P1": domain_key}
            story_idx = 1
            for story_name in domain_data["stories"]:
                epic_semantic_map[f"S{story_idx}"] = story_name
                story_idx += 1

            epic_rules = []
            for story_rules in domain_data["stories"].values():
                epic_rules.extend(story_rules)
            epic_desc = f"# {epic_title}\n\nDomain: {domain_key}\n\nThis epic covers {len(domain_data['stories'])} stories with {len(epic_rules)} business rules related to {domain_key.lower()} in the ORBIT system."

            epic_prompt = "## Semantic Map\n\n" + "\n".join(f"- **{k}**: {v}" for k, v in epic_semantic_map.items())
            epic_prompt += f"\n\n## Description\n\n{epic_desc}"

            ac_epic = [f"Implement all {len(domain_data['stories'])} stories in the {domain_key} domain",
                        f"All {len(epic_rules)} business rules validated and tested",
                        "Integration tests passing for all related API endpoints"]

            db.execute(text("""
                INSERT INTO tasks (id, project_id, parent_id, item_type, title, description, generated_prompt,
                    acceptance_criteria, story_points, priority, status, labels, workflow_state, reporter,
                    description_edited_by, prompt_edited_by, interview_insights, created_at, updated_at,
                    "column", "order", complexity)
                VALUES (:id, :pid, NULL, 'epic', :title, :desc, :prompt,
                    :ac, 13, 'high', 'backlog', :labels, 'open', 'system',
                    'ai', 'ai', :insights, :now, :now,
                    'backlog', 0, 1)
            """), {
                "id": str(epic_id), "pid": PROJECT_ID, "title": epic_title,
                "desc": epic_desc, "prompt": epic_prompt,
                "ac": json.dumps(ac_epic),
                "labels": json.dumps(["from_rag", "claude_generated"]),
                "insights": json.dumps({"semantic_map": epic_semantic_map, "source": "rag_business_rules"}),
                "now": now,
            })
            card_counts["epic"] += 1
            total_cards += 1

            # Normalize epic immediately
            try:
                from scripts.normalize_cards import normalize_single_card
                normalize_single_card(db, str(epic_id), "epic", epic_title,
                                      domain=domain_key, rules=epic_rules[:10])
            except Exception as e:
                logger.debug(f"Per-card normalization skipped: {e}")

            # Index epic in RAG
            epic_rag_content = f"{epic_title}\n\n{epic_desc}\n\n{epic_prompt}"
            epic_emb = model.encode(epic_rag_content).tolist()
            epic_emb_str = "[" + ",".join(str(x) for x in epic_emb) + "]"
            db.execute(text("""
                INSERT INTO rag_documents (id, project_id, content, embedding, metadata, created_at, updated_at)
                VALUES (:id, :pid, :content, :emb, :meta, :now, :now)
            """), {
                "id": str(uuid4()), "pid": PROJECT_ID, "content": epic_rag_content,
                "emb": epic_emb_str,
                "meta": json.dumps({"type": "card", "item_type": "epic", "card_id": str(epic_id), "parent_id": None, "labels": ["from_rag"], "workflow_state": "open"}),
                "now": now,
            })

            # Stories
            story_order = 0
            for story_name, story_rules in domain_data["stories"].items():
                story_id = uuid4()
                story_order += 1

                story_semantic_map = {"N1": epic_title, "P1": domain_key, f"S{story_order}": story_name}

                story_desc = f"# {story_name}\n\nPart of: {epic_title}\n\nThis story covers {len(story_rules)} business rules:\n\n"
                for i, r in enumerate(story_rules, 1):
                    story_desc += f"{i}. {r}\n"

                story_prompt = "## Semantic Map\n\n" + "\n".join(f"- **{k}**: {v}" for k, v in story_semantic_map.items())
                story_prompt += f"\n\n## Description\n\n{story_desc}"

                ac_story = [f"Validate: {r[:100]}" for r in story_rules[:6]]

                db.execute(text("""
                    INSERT INTO tasks (id, project_id, parent_id, item_type, title, description, generated_prompt,
                        acceptance_criteria, story_points, priority, status, labels, workflow_state, reporter,
                        description_edited_by, prompt_edited_by, interview_insights, created_at, updated_at,
                        "order", "column", complexity)
                    VALUES (:id, :pid, :parent, 'story', :title, :desc, :prompt,
                        :ac, 8, 'high', 'backlog', :labels, 'open', 'system',
                        'ai', 'ai', :insights, :now, :now, :ord, 'backlog', 1)
                """), {
                    "id": str(story_id), "pid": PROJECT_ID, "parent": str(epic_id),
                    "title": story_name, "desc": story_desc, "prompt": story_prompt,
                    "ac": json.dumps(ac_story),
                    "labels": json.dumps(["from_rag", "claude_generated"]),
                    "insights": json.dumps({"semantic_map": story_semantic_map, "source": "rag_business_rules", "derived_from": str(epic_id)}),
                    "now": now, "ord": story_order,
                })
                card_counts["story"] += 1
                total_cards += 1

                # Normalize story immediately
                try:
                    from scripts.normalize_cards import normalize_single_card
                    normalize_single_card(db, str(story_id), "story", story_name,
                                          parent_title=epic_title, rules=story_rules)
                except Exception as e:
                    logger.debug(f"Per-card normalization skipped: {e}")

                # Tasks (group rules in sets of 3)
                task_order = 0
                for chunk_start in range(0, len(story_rules), 3):
                    chunk = story_rules[chunk_start:chunk_start + 3]
                    task_id = uuid4()
                    task_order += 1

                    task_title = chunk[0][:120] if len(chunk) == 1 else f"{story_name} - Rules {chunk_start + 1}-{chunk_start + len(chunk)}"
                    task_desc = f"# {task_title}\n\nPart of: {story_name}\n\n"
                    for i, r in enumerate(chunk, 1):
                        task_desc += f"- {r}\n"

                    ac_task = [f"Implement: {r[:80]}" for r in chunk]

                    db.execute(text("""
                        INSERT INTO tasks (id, project_id, parent_id, item_type, title, description,
                            acceptance_criteria, story_points, priority, status, labels, workflow_state, reporter,
                            description_edited_by, prompt_edited_by, interview_insights, created_at, updated_at,
                            "order", "column", complexity)
                        VALUES (:id, :pid, :parent, 'task', :title, :desc,
                            :ac, 3, 'medium', 'backlog', :labels, 'open', 'system',
                            'ai', 'ai', :insights, :now, :now, :ord, 'backlog', 1)
                    """), {
                        "id": str(task_id), "pid": PROJECT_ID, "parent": str(story_id),
                        "title": task_title, "desc": task_desc,
                        "ac": json.dumps(ac_task),
                        "labels": json.dumps(["from_rag", "claude_generated"]),
                        "insights": json.dumps({"source": "rag_business_rules", "derived_from": str(story_id)}),
                        "now": now, "ord": task_order,
                    })
                    card_counts["task"] += 1
                    total_cards += 1

                    # Normalize task immediately
                    try:
                        from scripts.normalize_cards import normalize_single_card
                        normalize_single_card(db, str(task_id), "task", task_title,
                                              parent_title=story_name, rules=chunk)
                    except Exception as e:
                        logger.debug(f"Per-card normalization skipped: {e}")

                    # Subtasks (1 per rule)
                    for sub_idx, rule_text in enumerate(chunk):
                        subtask_id = uuid4()
                        sub_title = rule_text[:200]
                        sub_desc = rule_text

                        db.execute(text("""
                            INSERT INTO tasks (id, project_id, parent_id, item_type, title, description,
                                acceptance_criteria, story_points, priority, status, labels, workflow_state, reporter,
                                description_edited_by, prompt_edited_by, created_at, updated_at,
                                "order", "column", complexity)
                            VALUES (:id, :pid, :parent, 'subtask', :title, :desc,
                                :ac, 1, 'medium', 'backlog', :labels, 'open', 'system',
                                'ai', 'ai', :now, :now, :ord, 'backlog', 1)
                        """), {
                            "id": str(subtask_id), "pid": PROJECT_ID, "parent": str(task_id),
                            "title": sub_title, "desc": sub_desc,
                            "ac": json.dumps([f"Validate: {rule_text[:100]}"]),
                            "labels": json.dumps(["from_rag", "claude_generated"]),
                            "now": now, "ord": sub_idx + 1,
                        })
                        card_counts["subtask"] += 1
                        total_cards += 1

                        # Normalize subtask immediately
                        try:
                            from scripts.normalize_cards import normalize_single_card
                            normalize_single_card(db, str(subtask_id), "subtask", sub_title,
                                                  description=rule_text, parent_title=task_title)
                        except Exception as e:
                            logger.debug(f"Per-card normalization skipped: {e}")

            db.commit()
            logger.info(f"  Epic: {epic_title} - {len(domain_data['stories'])} stories, {len(epic_rules)} rules")

        db.commit()

        # =================================================================
        # Summary (per-card normalization already applied above)
        # =================================================================
        logger.info("=" * 60)
        logger.info("PIPELINE COMPLETE!")
        logger.info("=" * 60)

        rag_count = db.execute(text(
            "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid"
        ), {"pid": PROJECT_ID}).scalar()

        rule_count = db.execute(text(
            "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
            "AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')"
        ), {"pid": PROJECT_ID}).scalar()

        file_count = db.execute(text(
            "SELECT COUNT(*) FROM rag_file_state WHERE project_id = :pid"
        ), {"pid": PROJECT_ID}).scalar()

        domain_count = len(HIERARCHY)

        logger.info(f"Files tracked: {file_count}")
        logger.info(f"RAG Documents: {rag_count} total ({rule_count} business rules + {rag_count - rule_count} card docs)")
        logger.info(f"Domains: {domain_count}")
        logger.info(f"Cards: {total_cards} total")
        for item_type, count in sorted(card_counts.items()):
            logger.info(f"  {item_type}: {count}")

    except Exception as e:
        logger.error(f"Pipeline failed: {e}", exc_info=True)
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
