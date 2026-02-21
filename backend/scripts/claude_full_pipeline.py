"""
ORBIT Full Pipeline via Claude Code - PROMPT #244

Replicates the same procedures as the ORBIT RAG pipeline:
1. Scan all source files → rag_file_state
2. Insert extracted business rules → rag_documents (with embeddings)
3. Generate hierarchical cards → tasks (Epic > Story > Task > Subtask)

Business rules were extracted by Claude Code reading the entire codebase.
Uses sentence-transformers for embeddings (same as RAGService).
"""
import asyncio
import hashlib
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4, uuid5, UUID

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

# File semantic layer classification
LAYER_MAP = {
    "models": "schema", "migrations": "schema", "schemas": "schema",
    "routes": "routes", "api": "routes", "controllers": "routes", "endpoints": "routes",
    "services": "logic", "utils": "logic", "helpers": "logic",
    "components": "presentation", "pages": "presentation", "app": "presentation",
    "config": "config", "scripts": "config", "provisioning": "config",
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
    """Scan all source files, compute hashes. Same as ContinuousRAGService.scan_for_changes()"""
    files = []
    for root, dirs, filenames in os.walk(code_path):
        # Filter ignored dirs in-place
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
# BUSINESS RULES (extracted by Claude Code reading the entire codebase)
# ============================================================================
BUSINESS_RULES = [
    # ========== DOMAIN: AI Orchestration ==========
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

    # ========== DOMAIN: RAG Pipeline ==========
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

    # ========== DOMAIN: Project Lifecycle ==========
    {"rule_text": "code_path is REQUIRED and IMMUTABLE after project creation; projects must reference existing code folders", "rule_type": "constraint", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "Project lifecycle: draft (context created) → processing (pipeline running) → active (first epic approved)", "rule_type": "workflow", "source_file": "backend/app/models/project.py", "domain": "Project Lifecycle"},
    {"rule_text": "Project context locked after first Epic approval; prevents context changes once hierarchy generation starts", "rule_type": "constraint", "source_file": "backend/app/models/project.py", "domain": "Project Lifecycle"},
    {"rule_text": "Project deletion has full cascade cleanup: cancel jobs, delete RAG docs, delete analyses, but PRESERVE code_path and satellite/ on disk", "rule_type": "workflow", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "Protected projects: if project.protected=true, deletion requires system setting allow_protected_project_deletion=true", "rule_type": "constraint", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "Concurrent scan guard: only one scan can be running per project at a time; reject if another is pending/running", "rule_type": "constraint", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "Epic generation blocked if RAG indexing in progress (checks for PENDING/RUNNING scan jobs)", "rule_type": "constraint", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "Wizard completion cleanup: Project only exists permanently if wizard is COMPLETELY finished; abandoned projects auto-deleted", "rule_type": "workflow", "source_file": "backend/app/api/routes/projects.py", "domain": "Project Lifecycle"},
    {"rule_text": "initial_scan_complete flag blocks Continuous RAG scheduler until initial memory scan finishes", "rule_type": "constraint", "source_file": "backend/app/models/project.py", "domain": "Project Lifecycle"},

    # ========== DOMAIN: Card Hierarchy ==========
    {"rule_text": "Business rule cards use rigid 4-level hierarchy: Epic > Story > Task > Subtask; each level has specific story points (13/8/3/1)", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Card Hierarchy"},
    {"rule_text": "All generated cards have: description (human-readable), generated_prompt (semantic), acceptance_criteria, semantic_map, description_edited_by=ai, prompt_edited_by=ai", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Card Hierarchy"},
    {"rule_text": "Existing business_rule/from_rag cards deleted before regenerating to allow re-running with updated RAG", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Card Hierarchy"},
    {"rule_text": "Tasks group rules in sets of 3 (RULES_PER_TASK); Subtasks = 1 rule each", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Card Hierarchy"},
    {"rule_text": "Hierarchy validation: Epic can contain Story, Story can contain Task/Bug, Task can contain Subtask; Subtask and Bug are terminal (no children)", "rule_type": "validation", "source_file": "backend/app/api/routes/tasks_routes.py", "domain": "Card Hierarchy"},
    {"rule_text": "Task status-to-column mapping: backlog/todo/in_progress/review/done maps to Kanban columns", "rule_type": "domain", "source_file": "backend/app/api/routes/tasks_routes.py", "domain": "Card Hierarchy"},
    {"rule_text": "When task status changes to DONE, index it in RAG with metadata for knowledge retention", "rule_type": "workflow", "source_file": "backend/app/api/routes/tasks_routes.py", "domain": "Card Hierarchy"},
    {"rule_text": "All business rule cards labeled with ['from_rag'] and workflow_state='open'", "rule_type": "domain", "source_file": "backend/app/services/context_generator/business_rules.py", "domain": "Card Hierarchy"},

    # ========== DOMAIN: Card Activation ==========
    {"rule_text": "REGRA #0: Never overwrite human-edited description/prompt; check description_edited_by and prompt_edited_by fields before AI update", "rule_type": "constraint", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation"},
    {"rule_text": "Project context must exist (context_semantic populated) before card activation", "rule_type": "validation", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation"},
    {"rule_text": "Auto-generation of draft children after activation: Epic→Stories(10), Story→Tasks(8), Task→Subtasks(5)", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation"},
    {"rule_text": "Acceptance criteria minimum thresholds: Epic=50 chars, Story=50, Task=30, Subtask=20; generated from fallback templates if too short", "rule_type": "validation", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation"},
    {"rule_text": "Suggested epics labeled with ['suggested'] and workflow_state='draft'; exclude existing features from memory scan", "rule_type": "domain", "source_file": "backend/app/services/context_generator/draft_generator.py", "domain": "Card Activation"},
    {"rule_text": "Similar cards auto-skipped if similarity_threshold >= 0.85 via RAG duplicate detection", "rule_type": "constraint", "source_file": "backend/app/services/context_generator/draft_generator.py", "domain": "Card Activation"},
    {"rule_text": "Activated card indexed in RAG for semantic search enabling future duplicate detection", "rule_type": "workflow", "source_file": "backend/app/services/context_generator/card_activator.py", "domain": "Card Activation"},

    # ========== DOMAIN: Interview System ==========
    {"rule_text": "Dual-mode interview routing: Context Interview (Q1-Q3 fixed) vs Epic Interview (AI-driven) based on project state", "rule_type": "workflow", "source_file": "backend/app/api/routes/interviews/endpoints.py", "domain": "Interview System"},
    {"rule_text": "Context Interview is UNLIMITED: user decides when to stop via 'Gerar Contexto' button; first 3 questions Q1-Q3 are always fixed", "rule_type": "domain", "source_file": "backend/app/api/routes/interviews/endpoints.py", "domain": "Interview System"},
    {"rule_text": "Context locked after first Epic approval: prevents context changes once hierarchy generation starts", "rule_type": "constraint", "source_file": "backend/app/api/routes/interviews/endpoints.py", "domain": "Interview System"},
    {"rule_text": "Closed questions preferred: system generates questions with multiple-choice options not open-ended", "rule_type": "domain", "source_file": "backend/app/api/routes/interviews/endpoints.py", "domain": "Interview System"},
    {"rule_text": "Meta Prompt: FIRST interview always collects 8 fixed questions (Q1-Q8) plus AI contextual questions (Q9+)", "rule_type": "domain", "source_file": "backend/app/api/routes/interviews/fixed_questions.py", "domain": "Interview System"},
    {"rule_text": "Interview modes: requirements (global gathering), task_focused (specific task), context (3 fixed questions), card_focused (card creation)", "rule_type": "domain", "source_file": "backend/app/models/interview.py", "domain": "Interview System"},

    # ========== DOMAIN: Data Protection ==========
    {"rule_text": "REGRA #0 - Human data supremacy: AI-generated data NEVER overwrites data inserted or edited by a human operator", "rule_type": "constraint", "source_file": "backend/app/models/task.py", "domain": "Data Protection"},
    {"rule_text": "description_edited_by and prompt_edited_by fields track if human manually edited; AI activation MUST NOT overwrite fields marked as 'human'", "rule_type": "constraint", "source_file": "backend/app/models/task.py", "domain": "Data Protection"},
    {"rule_text": "Satellite folder structure is SACRED and PROTECTED: satellite/, satellite/memory/, satellite/docs/, satellite/knowledge/ and subdirectories can NEVER be deleted by automated processes", "rule_type": "constraint", "source_file": "backend/app/services/orbit_folder.py", "domain": "Data Protection"},
    {"rule_text": "safe_rmtree() enforces 3 blocks: never delete code_path itself, never delete protected satellite paths, never delete parent of satellite/", "rule_type": "constraint", "source_file": "backend/app/services/orbit_folder.py", "domain": "Data Protection"},
    {"rule_text": "Python Path-joining vulnerability: Path('a') / '/b' resolves to '/b' (absolute path replaces); must validate paths are relative", "rule_type": "constraint", "source_file": "backend/app/services/orbit_folder.py", "domain": "Data Protection"},
    {"rule_text": "Wiki REGRA #0: Protected sources (manual, enrichment) NEVER overwritten by automated content (ai_generated)", "rule_type": "constraint", "source_file": "backend/app/services/wiki_fs.py", "domain": "Data Protection"},
    {"rule_text": "Directory traversal protection: remove leading slashes and '..' from folder browsing to prevent path traversal attacks", "rule_type": "validation", "source_file": "backend/app/api/routes/projects.py", "domain": "Data Protection"},
    {"rule_text": "Filename sanitized to prevent path traversal: use Path.name only, no leading dots allowed", "rule_type": "validation", "source_file": "backend/app/services/orbit_folder.py", "domain": "Data Protection"},

    # ========== DOMAIN: Job Queue ==========
    {"rule_text": "Job Priority Hierarchy: CRITICAL(10) for interviews/chat, HIGH(7) for context/pipeline, NORMAL(5) for scans/generation, LOW(3) for children/activation", "rule_type": "domain", "source_file": "backend/app/models/async_job.py", "domain": "Job Queue"},
    {"rule_text": "Async job workflow: Client creates job → returns job_id immediately → BackgroundTask executes → Client polls /jobs/{id} for status", "rule_type": "workflow", "source_file": "backend/app/models/async_job.py", "domain": "Job Queue"},
    {"rule_text": "WebSocket connection for real-time job updates: handles job_started, job_progress, job_completed, job_failed, job_cancelled events", "rule_type": "domain", "source_file": "frontend/src/app/jobs/page.tsx", "domain": "Job Queue"},
    {"rule_text": "WebSocket ping every 30s to keep connection alive; auto-reconnect with exponential backoff on disconnect", "rule_type": "workflow", "source_file": "frontend/src/app/jobs/page.tsx", "domain": "Job Queue"},
    {"rule_text": "Sub-job hierarchy: Jobs can have parent_job_id creating tree structure for tracking phases", "rule_type": "domain", "source_file": "backend/app/models/async_job.py", "domain": "Job Queue"},
    {"rule_text": "Job cleanup options: delete all completed, older than 1 day, 7 days, or 30 days with confirmation dialog", "rule_type": "workflow", "source_file": "frontend/src/app/jobs/page.tsx", "domain": "Job Queue"},

    # ========== DOMAIN: Wiki & Knowledge ==========
    {"rule_text": "Wiki pages stored as .md files with YAML front matter in satellite/knowledge/wiki/ directory", "rule_type": "domain", "source_file": "backend/app/services/wiki_fs.py", "domain": "Wiki & Knowledge"},
    {"rule_text": "Wiki ID generation deterministic using uuid5 from project_id + slug (not random)", "rule_type": "domain", "source_file": "backend/app/services/wiki_fs.py", "domain": "Wiki & Knowledge"},
    {"rule_text": "Wiki slug must be unique within project; ensure_unique_slug appends -N counter for duplicates", "rule_type": "validation", "source_file": "backend/app/services/wiki_fs.py", "domain": "Wiki & Knowledge"},
    {"rule_text": "Wiki page hierarchy derived from directory structure: root = slug.md, child = parent_slug/slug.md", "rule_type": "domain", "source_file": "backend/app/services/wiki_fs.py", "domain": "Wiki & Knowledge"},
    {"rule_text": "Empty parent directories cleaned up to wiki root but NEVER above satellite/knowledge/wiki safety boundary", "rule_type": "constraint", "source_file": "backend/app/services/wiki_fs.py", "domain": "Wiki & Knowledge"},
    {"rule_text": "All prompts must be externalized to YAML files in backend/app/prompts/; PromptLoader renders with Jinja2", "rule_type": "constraint", "source_file": "backend/app/prompts/loader.py", "domain": "Wiki & Knowledge"},

    # ========== DOMAIN: Frontend Architecture ==========
    {"rule_text": "All pages use Layout + Breadcrumbs pattern from @/components/layout; content wrapped in space-y-6 div", "rule_type": "domain", "source_file": "frontend/src/components/layout/Layout.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Sidebar collapsible between expanded (180px) and collapsed (56px); state persisted to localStorage", "rule_type": "domain", "source_file": "frontend/src/components/layout/Layout.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Project details page has 10 tabs: Overview, Backlog, Kanban, Queue, Wiki, Chat, Specs, Commits, RAG, Analytics", "rule_type": "domain", "source_file": "frontend/src/app/projects/[id]/page.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Inline editing: titles and descriptions support double-click to edit with rich markdown toolbar and auto-save", "rule_type": "domain", "source_file": "frontend/src/app/projects/[id]/page.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Enrichment polling: every 5 seconds check enrichment status; when complete do final project data refresh", "rule_type": "workflow", "source_file": "frontend/src/app/projects/[id]/page.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Context interview wizard: 3-step flow (Interview → Review → Complete) with unlimited questions, fixed Q1-Q3 minimum", "rule_type": "workflow", "source_file": "frontend/src/app/projects/[id]/setup-context/page.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "AI Flow page: n8n-style node-based flow diagram using @xyflow/react with drag-drop model assignment", "rule_type": "domain", "source_file": "frontend/src/app/ai-flow/page.tsx", "domain": "Frontend Architecture"},
    {"rule_text": "Dashboard auto-refreshes cache stats every 30 seconds; cost analytics filtered by dateRange, provider, usage_type", "rule_type": "workflow", "source_file": "frontend/src/app/page.tsx", "domain": "Frontend Architecture"},

    # ========== DOMAIN: Cost & Analytics ==========
    {"rule_text": "Cost calculation: sums input_tokens * input_price + output_tokens * output_price per model execution", "rule_type": "domain", "source_file": "backend/app/api/routes/cost_analytics.py", "domain": "Cost & Analytics"},
    {"rule_text": "RAG hit tracking: records rag_enabled, rag_hit, rag_results_count, rag_top_similarity, rag_retrieval_time_ms per execution", "rule_type": "domain", "source_file": "backend/app/api/routes/cost_analytics.py", "domain": "Cost & Analytics"},
    {"rule_text": "RAG hit rate calculation: (total_rag_hits / total_rag_enabled) * 100 as percentage", "rule_type": "domain", "source_file": "backend/app/api/routes/cost_analytics.py", "domain": "Cost & Analytics"},
    {"rule_text": "Every AI call logged in ai_executions with: model, provider, tokens (in/out), cost, duration, chain position, RAG metrics", "rule_type": "domain", "source_file": "backend/app/models/ai_execution.py", "domain": "Cost & Analytics"},
    {"rule_text": "Prompt versioning: each version increments number; parent_id links versions in tree for history", "rule_type": "domain", "source_file": "backend/app/api/routes/prompts.py", "domain": "Cost & Analytics"},

    # ========== DOMAIN: Data Model ==========
    {"rule_text": "Project cascade deletes: interviews, prompts, tasks, commits, analyses, prompt_templates, specs, chats all deleted when project deleted", "rule_type": "constraint", "source_file": "backend/app/models/project.py", "domain": "Data Model"},
    {"rule_text": "Task self-referential hierarchy: parent_id FK with CASCADE delete; deleting parent deletes all children", "rule_type": "constraint", "source_file": "backend/app/models/task.py", "domain": "Data Model"},
    {"rule_text": "Task relationship types: blocks, blocked_by, depends_on, relates_to, duplicates, clones with UNIQUE constraint preventing duplicates", "rule_type": "domain", "source_file": "backend/app/models/task_relationship.py", "domain": "Data Model"},
    {"rule_text": "Status transition audit: all task status changes logged with from_status, to_status, timestamp, reason", "rule_type": "workflow", "source_file": "backend/app/models/status_transition.py", "domain": "Data Model"},
    {"rule_text": "Prompt queue ordering: hierarchy first (epics before stories), then dependencies, then priority, then age, then manual overrides", "rule_type": "domain", "source_file": "backend/app/models/prompt_queue.py", "domain": "Data Model"},
    {"rule_text": "rag_file_state UNIQUE constraint on (project_id, file_path): one tracking row per file per project", "rule_type": "constraint", "source_file": "backend/app/models/rag_file_state.py", "domain": "Data Model"},
    {"rule_text": "Task blocked system: >90% semantic similarity triggers BLOCKED status with pending_modification; user must approve/reject", "rule_type": "workflow", "source_file": "backend/app/api/routes/tasks_routes.py", "domain": "Data Model"},
    {"rule_text": "Conventional commits: types are feat, fix, docs, style, refactor, test, chore, perf", "rule_type": "domain", "source_file": "backend/app/models/commit.py", "domain": "Data Model"},
]


# ============================================================================
# HIERARCHY DEFINITION
# ============================================================================
HIERARCHY = {
    "AI Orchestration": {
        "title": "AI Orchestration & Multi-Provider Engine",
        "stories": {
            "Chain Fallback System": [
                "AI Flow Chain fallback: models in chain are tried sequentially; if one fails, automatically try next model in chain order",
                "Each usage_type has ONE chain (UNIQUE constraint); chain is upserted not duplicated",
                "Retry intelligent skipping: Don't retry on permanent errors (401, 404); only retry on transient errors (timeout, rate_limit, server_error)",
            ],
            "3-Level Cache Hierarchy": [
                "AIOrchestrator uses 3-level cache hierarchy: L1 exact match (7-day TTL), L2 semantic match >95% similarity (1-day TTL), L3 template cache for deterministic prompts (30-day TTL)",
                "Redis cache enabled automatically when AIOrchestrator is instantiated; falls back to in-memory cache if Redis unavailable",
            ],
            "Multi-Provider Compatibility": [
                "ORBIT orchestrates 3 providers simultaneously: Anthropic (Claude), OpenAI (GPT), Google (Gemini) with role compatibility handling",
                "API keys are stored in the database (ai_models table), NEVER in .env files; users configure via web interface at /ai-models",
                "Chain optimization strategies: reliability (0.6/0.1/0.2/0.1), cost (0.2/0.5/0.1/0.2), quality (0.2/0.1/0.5/0.2), balanced (0.3/0.25/0.25/0.2) weights for success/cost/quality/latency",
            ],
            "Timeout & Concurrency": [
                "Model timeout uses 3-layer hierarchy: Timeout Node > AI Model timeout_seconds > SystemSettings default",
                "Adaptive timeout calculation: uses max(static_timeout, adaptive_timeout) based on provider speed profiles: Ollama=15, Anthropic=80, OpenAI=60, Google=70 tokens/second",
                "Concurrency limit per model via asyncio.Semaphore; module-level semaphore pool shared across AIOrchestrator instances",
            ],
            "Satellite Memory Logging": [
                "Only usage_types in _SAVE_USAGE_TYPES (prompt_generation, task_execution, commit_generation, memory, pattern_discovery) are saved to satellite/memory/",
                "Satellite prompt logs are NEVER overwritten - if file exists, skip writing (REGRA #0 applied to logs)",
                "Model health status colors: Green >= 95% success rate, Yellow >= 80%, Red < 80%",
            ],
        },
    },
    "RAG Pipeline": {
        "title": "RAG Pipeline & Knowledge Base Engine",
        "stories": {
            "Continuous File Scanning": [
                "Continuous RAG scans all source files respecting .gitignore patterns, custom ignore patterns, and global blocklist",
                "File hash computed as SHA-256 to detect modifications; only changed files are reprocessed",
                "File semantic layer priority for processing: SCHEMA > ROUTES > LOGIC > PRESENTATION > CONFIG > UNKNOWN",
            ],
            "Business Rule Extraction": [
                "Business rules stored in rag_documents with metadata: type=business_rule, source=continuous_scan, source_file, rule_type, priority",
                "Low-value files (tests, config, migrations, fixtures) are skipped before AI extraction to save tokens",
                "Deleted files marked as DELETED status; corresponding RAG documents deleted by source_file filter",
            ],
            "Embedding & Search": [
                "RAG documents stored with 384-dimensional embeddings using all-MiniLM-L6-v2 model for semantic search",
                "Knowledge search requires minimum 3 characters query; similarity threshold 0.0-1.0; max 20 results",
                "Document chunking: Splits documents into 500-char chunks with 50-char overlap, breaks at paragraph/sentence boundaries",
            ],
            "Document Management": [
                "Document upload allowed file types: .md, .txt, .rst, .yaml, .yml, .json; UTF-8 encoding required",
                "Orbit knowledge upload saves to satellite/docs/ on disk AND chunks+indexes in RAG simultaneously",
                "Scan depth profiles: quick (30 files), normal (100 files), deep (ALL files), local (50 files for Ollama)",
            ],
            "Codebase Analysis": [
                "Analysis extensions: .py, .php, .js, .ts, .tsx, .jsx, .java, .rb, .go, .cs, .swift, .kt, .vue, .svelte plus template formats",
            ],
        },
    },
    "Project Lifecycle": {
        "title": "Project Lifecycle & Context Management",
        "stories": {
            "Project Creation Flow": [
                "code_path is REQUIRED and IMMUTABLE after project creation; projects must reference existing code folders",
                "Project lifecycle: draft (context created) → processing (pipeline running) → active (first epic approved)",
                "Wizard completion cleanup: Project only exists permanently if wizard is COMPLETELY finished; abandoned projects auto-deleted",
            ],
            "Context Locking": [
                "Project context locked after first Epic approval; prevents context changes once hierarchy generation starts",
                "initial_scan_complete flag blocks Continuous RAG scheduler until initial memory scan finishes",
                "Concurrent scan guard: only one scan can be running per project at a time; reject if another is pending/running",
            ],
            "Project Deletion Safety": [
                "Project deletion has full cascade cleanup: cancel jobs, delete RAG docs, delete analyses, but PRESERVE code_path and satellite/ on disk",
                "Protected projects: if project.protected=true, deletion requires system setting allow_protected_project_deletion=true",
                "Epic generation blocked if RAG indexing in progress (checks for PENDING/RUNNING scan jobs)",
            ],
        },
    },
    "Card Hierarchy": {
        "title": "Hierarchical Card Generation System",
        "stories": {
            "4-Level Rigid Hierarchy": [
                "Business rule cards use rigid 4-level hierarchy: Epic > Story > Task > Subtask; each level has specific story points (13/8/3/1)",
                "Hierarchy validation: Epic can contain Story, Story can contain Task/Bug, Task can contain Subtask; Subtask and Bug are terminal (no children)",
                "Tasks group rules in sets of 3 (RULES_PER_TASK); Subtasks = 1 rule each",
            ],
            "Card Content Generation": [
                "All generated cards have: description (human-readable), generated_prompt (semantic), acceptance_criteria, semantic_map, description_edited_by=ai, prompt_edited_by=ai",
                "All business rule cards labeled with ['from_rag'] and workflow_state='open'",
                "Existing business_rule/from_rag cards deleted before regenerating to allow re-running with updated RAG",
            ],
            "Kanban Integration": [
                "Task status-to-column mapping: backlog/todo/in_progress/review/done maps to Kanban columns",
                "When task status changes to DONE, index it in RAG with metadata for knowledge retention",
            ],
        },
    },
    "Card Activation": {
        "title": "Card Activation & Draft Generation",
        "stories": {
            "Human Data Supremacy": [
                "REGRA #0: Never overwrite human-edited description/prompt; check description_edited_by and prompt_edited_by fields before AI update",
                "Project context must exist (context_semantic populated) before card activation",
            ],
            "Auto-Generation Pipeline": [
                "Auto-generation of draft children after activation: Epic→Stories(10), Story→Tasks(8), Task→Subtasks(5)",
                "Suggested epics labeled with ['suggested'] and workflow_state='draft'; exclude existing features from memory scan",
                "Similar cards auto-skipped if similarity_threshold >= 0.85 via RAG duplicate detection",
            ],
            "Content Validation": [
                "Acceptance criteria minimum thresholds: Epic=50 chars, Story=50, Task=30, Subtask=20; generated from fallback templates if too short",
                "Activated card indexed in RAG for semantic search enabling future duplicate detection",
            ],
        },
    },
    "Interview System": {
        "title": "AI Interview & Context Discovery System",
        "stories": {
            "Dual-Mode Routing": [
                "Dual-mode interview routing: Context Interview (Q1-Q3 fixed) vs Epic Interview (AI-driven) based on project state",
                "Interview modes: requirements (global gathering), task_focused (specific task), context (3 fixed questions), card_focused (card creation)",
            ],
            "Context Interview Flow": [
                "Context Interview is UNLIMITED: user decides when to stop via 'Gerar Contexto' button; first 3 questions Q1-Q3 are always fixed",
                "Context locked after first Epic approval: prevents context changes once hierarchy generation starts",
                "Meta Prompt: FIRST interview always collects 8 fixed questions (Q1-Q8) plus AI contextual questions (Q9+)",
            ],
            "Question Generation": [
                "Closed questions preferred: system generates questions with multiple-choice options not open-ended",
            ],
        },
    },
    "Data Protection": {
        "title": "Data Protection & Security Layer",
        "stories": {
            "Human Data Sovereignty": [
                "REGRA #0 - Human data supremacy: AI-generated data NEVER overwrites data inserted or edited by a human operator",
                "description_edited_by and prompt_edited_by fields track if human manually edited; AI activation MUST NOT overwrite fields marked as 'human'",
                "Wiki REGRA #0: Protected sources (manual, enrichment) NEVER overwritten by automated content (ai_generated)",
            ],
            "Satellite Folder Protection": [
                "Satellite folder structure is SACRED and PROTECTED: satellite/, satellite/memory/, satellite/docs/, satellite/knowledge/ and subdirectories can NEVER be deleted by automated processes",
                "safe_rmtree() enforces 3 blocks: never delete code_path itself, never delete protected satellite paths, never delete parent of satellite/",
                "Python Path-joining vulnerability: Path('a') / '/b' resolves to '/b' (absolute path replaces); must validate paths are relative",
            ],
            "Input Validation": [
                "Directory traversal protection: remove leading slashes and '..' from folder browsing to prevent path traversal attacks",
                "Filename sanitized to prevent path traversal: use Path.name only, no leading dots allowed",
            ],
        },
    },
    "Job Queue": {
        "title": "Async Job Queue & Real-Time Notifications",
        "stories": {
            "Priority System": [
                "Job Priority Hierarchy: CRITICAL(10) for interviews/chat, HIGH(7) for context/pipeline, NORMAL(5) for scans/generation, LOW(3) for children/activation",
                "Async job workflow: Client creates job → returns job_id immediately → BackgroundTask executes → Client polls /jobs/{id} for status",
                "Sub-job hierarchy: Jobs can have parent_job_id creating tree structure for tracking phases",
            ],
            "WebSocket Real-Time": [
                "WebSocket connection for real-time job updates: handles job_started, job_progress, job_completed, job_failed, job_cancelled events",
                "WebSocket ping every 30s to keep connection alive; auto-reconnect with exponential backoff on disconnect",
            ],
            "Cleanup & Maintenance": [
                "Job cleanup options: delete all completed, older than 1 day, 7 days, or 30 days with confirmation dialog",
            ],
        },
    },
    "Wiki & Knowledge": {
        "title": "Wiki System & Knowledge Management",
        "stories": {
            "Wiki File Management": [
                "Wiki pages stored as .md files with YAML front matter in satellite/knowledge/wiki/ directory",
                "Wiki ID generation deterministic using uuid5 from project_id + slug (not random)",
                "Wiki slug must be unique within project; ensure_unique_slug appends -N counter for duplicates",
            ],
            "Wiki Hierarchy": [
                "Wiki page hierarchy derived from directory structure: root = slug.md, child = parent_slug/slug.md",
                "Empty parent directories cleaned up to wiki root but NEVER above satellite/knowledge/wiki safety boundary",
            ],
            "Prompt Externalization": [
                "All prompts must be externalized to YAML files in backend/app/prompts/; PromptLoader renders with Jinja2",
            ],
        },
    },
    "Frontend Architecture": {
        "title": "Frontend Architecture & UI Patterns",
        "stories": {
            "Layout & Navigation": [
                "All pages use Layout + Breadcrumbs pattern from @/components/layout; content wrapped in space-y-6 div",
                "Sidebar collapsible between expanded (180px) and collapsed (56px); state persisted to localStorage",
                "Project details page has 10 tabs: Overview, Backlog, Kanban, Queue, Wiki, Chat, Specs, Commits, RAG, Analytics",
            ],
            "Inline Editing": [
                "Inline editing: titles and descriptions support double-click to edit with rich markdown toolbar and auto-save",
                "Context interview wizard: 3-step flow (Interview → Review → Complete) with unlimited questions, fixed Q1-Q3 minimum",
            ],
            "Real-Time Features": [
                "Enrichment polling: every 5 seconds check enrichment status; when complete do final project data refresh",
                "Dashboard auto-refreshes cache stats every 30 seconds; cost analytics filtered by dateRange, provider, usage_type",
                "AI Flow page: n8n-style node-based flow diagram using @xyflow/react with drag-drop model assignment",
            ],
        },
    },
    "Cost & Analytics": {
        "title": "Cost Analytics & Execution Monitoring",
        "stories": {
            "Cost Tracking": [
                "Cost calculation: sums input_tokens * input_price + output_tokens * output_price per model execution",
                "Every AI call logged in ai_executions with: model, provider, tokens (in/out), cost, duration, chain position, RAG metrics",
                "Prompt versioning: each version increments number; parent_id links versions in tree for history",
            ],
            "RAG Performance": [
                "RAG hit tracking: records rag_enabled, rag_hit, rag_results_count, rag_top_similarity, rag_retrieval_time_ms per execution",
                "RAG hit rate calculation: (total_rag_hits / total_rag_enabled) * 100 as percentage",
            ],
        },
    },
    "Data Model": {
        "title": "Data Model & Relationship Integrity",
        "stories": {
            "Cascade Rules": [
                "Project cascade deletes: interviews, prompts, tasks, commits, analyses, prompt_templates, specs, chats all deleted when project deleted",
                "Task self-referential hierarchy: parent_id FK with CASCADE delete; deleting parent deletes all children",
                "rag_file_state UNIQUE constraint on (project_id, file_path): one tracking row per file per project",
            ],
            "Task Relationships": [
                "Task relationship types: blocks, blocked_by, depends_on, relates_to, duplicates, clones with UNIQUE constraint preventing duplicates",
                "Task blocked system: >90% semantic similarity triggers BLOCKED status with pending_modification; user must approve/reject",
                "Conventional commits: types are feat, fix, docs, style, refactor, test, chore, perf",
            ],
            "Audit Trail": [
                "Status transition audit: all task status changes logged with from_status, to_status, timestamp, reason",
                "Prompt queue ordering: hierarchy first (epics before stories), then dependencies, then priority, then age, then manual overrides",
            ],
        },
    },
}


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

        # Insert into rag_file_state
        inserted = 0
        for f in files:
            file_id = str(uuid4())
            db.execute(text("""
                INSERT INTO rag_file_state (id, project_id, file_path, file_hash, file_size, last_modified, status, rules_extracted, rag_document_ids, file_layer, created_at, updated_at)
                VALUES (:id, :pid, :fp, :fh, :fs, :lm, 'completed', 0, '[]', :fl, :now, :now)
                ON CONFLICT (project_id, file_path) DO NOTHING
            """), {
                "id": file_id, "pid": PROJECT_ID, "fp": f["file_path"],
                "fh": f["file_hash"], "fs": f["file_size"], "lm": f["last_modified"],
                "fl": f["file_layer"], "now": now,
            })
            inserted += 1

        db.commit()
        logger.info(f"Phase 1 complete: {inserted} files tracked in rag_file_state")

        # Update project
        db.execute(text("UPDATE projects SET initial_scan_complete = true WHERE id = :pid"), {"pid": PROJECT_ID})
        db.commit()

        # =================================================================
        # PHASE 2: Insert business rules → rag_documents
        # =================================================================
        logger.info("=" * 60)
        logger.info("PHASE 2: Inserting business rules into RAG...")
        logger.info("=" * 60)

        # Load embedding model (same as RAGService)
        from sentence_transformers import SentenceTransformer
        logger.info("Loading embedding model: all-MiniLM-L6-v2")
        model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Embedding model loaded")

        rule_doc_ids = {}  # source_file -> [doc_ids]
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

            # Track doc IDs per source file
            sf = rule["source_file"]
            if sf not in rule_doc_ids:
                rule_doc_ids[sf] = []
            rule_doc_ids[sf].append(doc_id)
            total_rules += 1

        db.commit()
        logger.info(f"Phase 2 complete: {total_rules} business rules inserted into rag_documents")

        # Update rag_file_state with rule counts
        for sf, doc_ids in rule_doc_ids.items():
            db.execute(text("""
                UPDATE rag_file_state SET rules_extracted = :cnt, rag_document_ids = :dids                WHERE project_id = :pid AND file_path = :fp
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

            # Build semantic map for epic
            epic_semantic_map = {
                "N1": epic_title,
                "P1": domain_key,
            }
            story_idx = 1
            for story_name in domain_data["stories"]:
                epic_semantic_map[f"S{story_idx}"] = story_name
                story_idx += 1

            # Epic description
            epic_rules = []
            for story_rules in domain_data["stories"].values():
                epic_rules.extend(story_rules)
            epic_desc = f"# {epic_title}\n\nDomain: {domain_key}\n\nThis epic covers {len(domain_data['stories'])} stories with {len(epic_rules)} business rules related to {domain_key.lower()} in the ORBIT system."

            epic_prompt = f"## Semantic Map\n\n" + "\n".join(f"- **{k}**: {v}" for k, v in epic_semantic_map.items())
            epic_prompt += f"\n\n## Description\n\n{epic_desc}"

            ac_epic = [f"Implement all {len(domain_data['stories'])} stories in the {domain_key} domain",
                        f"All {len(epic_rules)} business rules validated and tested",
                        "Integration tests passing for all related API endpoints"]

            # Insert epic
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
                "labels": json.dumps(["from_rag"]),
                "insights": json.dumps({"semantic_map": epic_semantic_map, "source": "rag_business_rules"}),
                "now": now,
            })
            card_counts["epic"] += 1
            total_cards += 1

            # Also index epic in RAG
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

                story_semantic_map = {
                    "N1": epic_title,
                    "P1": domain_key,
                    f"S{story_order}": story_name,
                }

                story_desc = f"# {story_name}\n\nPart of: {epic_title}\n\nThis story covers {len(story_rules)} business rules:\n\n"
                for i, r in enumerate(story_rules, 1):
                    story_desc += f"{i}. {r}\n"

                story_prompt = f"## Semantic Map\n\n" + "\n".join(f"- **{k}**: {v}" for k, v in story_semantic_map.items())
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
                    "labels": json.dumps(["from_rag"]),
                    "insights": json.dumps({"semantic_map": story_semantic_map, "source": "rag_business_rules", "derived_from": str(epic_id)}),
                    "now": now, "ord": story_order,
                })
                card_counts["story"] += 1
                total_cards += 1

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
                        "labels": json.dumps(["from_rag"]),
                        "insights": json.dumps({"source": "rag_business_rules", "derived_from": str(story_id)}),
                        "now": now, "ord": task_order,
                    })
                    card_counts["task"] += 1
                    total_cards += 1

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
                            "labels": json.dumps(["from_rag"]),
                            "now": now, "ord": sub_idx + 1,
                        })
                        card_counts["subtask"] += 1
                        total_cards += 1

            db.commit()
            logger.info(f"  Epic: {epic_title} - {len(domain_data['stories'])} stories")

        db.commit()

        # =================================================================
        # Summary
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

        logger.info(f"Files tracked: {file_count}")
        logger.info(f"RAG Documents: {rag_count} total ({rule_count} business rules + {rag_count - rule_count} card docs)")
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
