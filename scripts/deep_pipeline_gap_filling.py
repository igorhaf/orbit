#!/usr/bin/env python3
"""
Deep Pipeline Gap Filling:
1. Add missing business rules for pattern_discovery and task_execution domains
2. Enrich prompt_history document chunks with domain classification
3. Link Epic Pattern Discovery to its new rules
"""
import uuid
import json
import psycopg2
import requests
import re

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
# GAP 1: Missing rules for pattern_discovery and task_execution
# ============================================================
NEW_RULES = [
    # === PATTERN DISCOVERY ===
    {
        "title": "Staged Pattern Discovery Pipeline (4 Stages)",
        "description": "Pattern discovery follows 4 stages to minimize AI calls: Stage 1 (Static) extracts patterns from code without AI, Stage 2 (Clustering) groups files by symbol similarity, Stage 3 (Graph) analyzes code relationships via knowledge graph, Stage 4 (LLM Fallback) only sends ambiguous groups to AI. Goal: reduce AI calls by 50%+.",
        "category": "workflow",
        "source_domain": "pattern_discovery",
        "source_files": "backend/app/services/pattern_discovery.py"
    },
    {
        "title": "Pattern Significance Thresholds",
        "description": "Min occurrences: 3 files to consider a pattern. Max patterns: 20 per project. Confidence < 0.5 requires LLM review. Confidence >= 0.5 accepted from static methods. File size limit: < 1MB. Ranking formula: (occurrences * 10) + (confidence * 100) + (template_size / 50) + (50 if framework_worthy). All patterns are project-scoped (stored with project_id).",
        "category": "validation",
        "source_domain": "pattern_discovery",
        "source_files": "backend/app/services/pattern_discovery.py"
    },
    {
        "title": "Tech Stack Detection Scoring",
        "description": "Stack detection uses weighted scoring: required_files=30pts each (missing=fail), required_dirs=20pts each, optional_files=10pts (max 30), package_indicators=15-30pts boost. Score cap: 100. Confidence < 50% = no stack detected. Supports JSON (package.json), text (requirements.txt), XML (pom.xml) manifests. Ignores: node_modules, vendor, .git, __pycache__, dist, build.",
        "category": "calculation",
        "source_domain": "pattern_discovery",
        "source_files": "backend/app/services/stack_detector.py"
    },
    # === TASK EXECUTION ===
    {
        "title": "Task Execution Model Selection by Complexity",
        "description": "Executor selects AI model based on task complexity: low → Haiku ($0.80/$4.00 per 1M tokens), medium → Sonnet ($3.00/$15.00), high → Opus ($15.00/$60.00). Complexity determined by story_points and item_type. Surgical context built (~3-5k tokens vs 200k generic).",
        "category": "workflow",
        "source_domain": "task_execution",
        "source_files": "backend/app/services/executor.py"
    },
    {
        "title": "Task Execution Retry and Validation Pipeline",
        "description": "Execution pipeline: 1) Select model by complexity, 2) Build surgical context, 3) Execute via AIOrchestrator (cache check), 4) Validate output, 5) Retry on failure (max 3 attempts), 6) Calculate cost, 7) Log to Prompt table. After max attempts: status='review'. Validation pass: status='done'. Events broadcast: task_started, task_completed, task_failed, validation_failed.",
        "category": "workflow",
        "source_domain": "task_execution",
        "source_files": "backend/app/services/executor.py"
    },
    {
        "title": "Token Budget Calculation by Story Points and Item Type",
        "description": "Token budgets: SP1-3=2000, SP5=3000, SP8=4000, SP13=5000, SP21=6000 tokens. By item type: task=2500, bug=2000, story=4000, epic=6000. Uses MAX of (SP budget, type budget). Default: 2500. Overage triggers system comment with recommendations. Budgets loaded from contracts/execution/token_budgets.yaml.",
        "category": "calculation",
        "source_domain": "task_execution",
        "source_files": "backend/app/services/budget_manager.py"
    },
]

# Domain keywords for classifying prompt_history documents
DOMAIN_KEYWORDS = {
    "ai_orchestration": ["aiorchestrator", "orchestrat", "provider", "anthropic", "openai", "gemini", "multi-provider", "ai_model", "llm"],
    "rag_knowledge": ["rag", "knowledge", "embedding", "pgvector", "semantic search", "nomic", "vector", "retrieval"],
    "interviews": ["interview", "entrevista", "question", "pergunta", "discovery", "conversation"],
    "backlog_generation": ["backlog", "epic", "story", "task", "card", "hierarchy", "decomposition", "sprint", "semantic reference"],
    "deep_pipeline": ["deep pipeline", "pipeline", "phase", "structural scan", "file analysis"],
    "wiki_system": ["wiki", "wiki page", "generate wiki", "expand wiki"],
    "caching": ["cache", "redis", "l1", "l2", "l3", "cache hit"],
    "analytics": ["analytics", "token", "cost", "usage", "monitoring", "dashboard"],
    "prompt_management": ["prompt", "yaml", "jinja", "promptloader", "template"],
    "job_system": ["job", "background", "queue", "notification", "async"],
    "project_management": ["project", "satellite", "create project", "code_path"],
    "kanban": ["kanban", "board", "column", "drag", "status change"],
    "framework_specs": ["spec", "framework", "token reduction"],
    "ai_flow": ["ai flow", "ai studio", "pipeline profile", "run history"],
    "git_integration": ["git", "commit", "push", "branch"],
    "pattern_discovery": ["pattern", "tech stack", "detection", "discover"],
    "task_execution": ["executor", "execution", "execute task", "budget", "complexity"],
    "infrastructure": ["migration", "alembic", "database", "config", "deploy", "docker"],
}

def classify_domain(content: str) -> str:
    """Classify a document chunk into a domain based on keyword matching."""
    content_lower = content.lower()
    scores = {}
    for domain, keywords in DOMAIN_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in content_lower)
        if score > 0:
            scores[domain] = score
    if not scores:
        return ""
    return max(scores, key=scores.get)


def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    # ============================================================
    # STEP 1: Add missing business rules
    # ============================================================
    print("Step 1: Adding missing business rules...")

    # Check which rules already exist to avoid duplicates
    cur.execute("""
        SELECT metadata->>'title' FROM rag_documents
        WHERE project_id = %s AND metadata->>'type' = 'business_rule'
    """, (PROJECT_ID,))
    existing_titles = {r[0] for r in cur.fetchall()}

    inserted = 0
    for rule in NEW_RULES:
        if rule["title"] in existing_titles:
            print(f"  SKIP (exists): {rule['title']}")
            continue

        doc_id = str(uuid.uuid4())
        content = f"BUSINESS RULE: {rule['title']}\n\nCategory: {rule['category']}\nDomain: {rule['source_domain']}\nSource Files: {rule['source_files']}\n\n{rule['description']}"
        metadata = json.dumps({
            "type": "business_rule",
            "category": rule["category"],
            "source": "deep_pipeline_gap_filling",
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
        print(f"  ADDED: {rule['title']}")

    conn.commit()
    print(f"  Total new rules: {inserted}")

    # ============================================================
    # STEP 2: Link Pattern Discovery Epic to its new rules
    # ============================================================
    print("\nStep 2: Linking Pattern Discovery Epic to rules...")

    cur.execute("""
        SELECT id FROM tasks
        WHERE project_id = %s AND item_type = 'epic'
          AND title LIKE '%%Pattern Discovery%%'
    """, (PROJECT_ID,))
    epic_row = cur.fetchone()

    if epic_row:
        epic_id = epic_row[0]
        cur.execute("""
            SELECT id, metadata->>'title'
            FROM rag_documents
            WHERE project_id = %s AND metadata->>'type' = 'business_rule'
              AND metadata->>'source_domain' = 'pattern_discovery'
        """, (PROJECT_ID,))
        rules = cur.fetchall()

        if rules:
            # Get existing generation_context
            cur.execute("SELECT generation_context FROM tasks WHERE id = %s", (epic_id,))
            existing_ctx = cur.fetchone()[0]
            ctx = existing_ctx if isinstance(existing_ctx, dict) else (json.loads(existing_ctx) if existing_ctx else {})
            ctx["related_rules"] = [{"id": str(r[0]), "title": r[1]} for r in rules]
            ctx["rules_count"] = len(rules)

            cur.execute("""
                UPDATE tasks SET generation_context = %s::json WHERE id = %s
            """, (json.dumps(ctx), epic_id))
            print(f"  Linked {len(rules)} rules to Pattern Discovery Epic")

    # Also link task_execution rules to AI Orchestration Epic (closest parent)
    cur.execute("""
        SELECT id FROM tasks
        WHERE project_id = %s AND item_type = 'epic'
          AND title LIKE '%%Orquestração Multi-Provider%%'
    """, (PROJECT_ID,))
    orch_row = cur.fetchone()
    if orch_row:
        orch_id = orch_row[0]
        cur.execute("""
            SELECT id, metadata->>'title'
            FROM rag_documents
            WHERE project_id = %s AND metadata->>'type' = 'business_rule'
              AND metadata->>'source_domain' IN ('ai_orchestration', 'task_execution')
        """, (PROJECT_ID,))
        all_rules = cur.fetchall()

        cur.execute("SELECT generation_context FROM tasks WHERE id = %s", (orch_id,))
        existing_ctx = cur.fetchone()[0]
        ctx = existing_ctx if isinstance(existing_ctx, dict) else (json.loads(existing_ctx) if existing_ctx else {})
        ctx["related_rules"] = [{"id": str(r[0]), "title": r[1]} for r in all_rules]
        ctx["rules_count"] = len(all_rules)

        cur.execute("UPDATE tasks SET generation_context = %s::json WHERE id = %s",
                     (json.dumps(ctx), orch_id))
        print(f"  Linked {len(all_rules)} rules (ai_orchestration + task_execution) to Orchestration Epic")

    conn.commit()

    # ============================================================
    # STEP 3: Enrich prompt_history documents with domain
    # ============================================================
    print("\nStep 3: Enriching prompt_history documents with domain classification...")

    # Process in batches to avoid memory issues
    cur.execute("""
        SELECT id, content, metadata
        FROM rag_documents
        WHERE project_id = %s
          AND metadata->>'type' = 'document'
          AND metadata->>'content_type' = 'prompt_history'
          AND NOT metadata ? 'domain'
        LIMIT 6000
    """, (PROJECT_ID,))

    docs = cur.fetchall()
    classified = 0
    domain_counts = {}

    for doc_id, content, metadata_raw in docs:
        domain = classify_domain(content)
        if domain:
            metadata = metadata_raw if isinstance(metadata_raw, dict) else json.loads(metadata_raw)
            metadata["domain"] = domain
            cur.execute("""
                UPDATE rag_documents SET metadata = %s::jsonb WHERE id = %s
            """, (json.dumps(metadata), doc_id))
            classified += 1
            domain_counts[domain] = domain_counts.get(domain, 0) + 1

    conn.commit()
    print(f"  Classified {classified}/{len(docs)} prompt_history documents")
    print("  By domain:")
    for d, c in sorted(domain_counts.items(), key=lambda x: -x[1]):
        print(f"    {d}: {c}")

    unclassified = len(docs) - classified
    if unclassified > 0:
        print(f"  Unclassified: {unclassified} (no keyword match - left as generic)")

    # ============================================================
    # STEP 4: Verify final state
    # ============================================================
    print("\n" + "="*60)
    print("Final Verification:")

    cur.execute("""
        SELECT metadata->>'source_domain', COUNT(*)
        FROM rag_documents
        WHERE project_id = %s AND metadata->>'type' = 'business_rule'
        GROUP BY metadata->>'source_domain' ORDER BY count DESC
    """, (PROJECT_ID,))
    print("\n  Business rules by domain:")
    total_rules = 0
    for row in cur.fetchall():
        print(f"    {row[0]}: {row[1]}")
        total_rules += row[1]
    print(f"    TOTAL: {total_rules}")

    cur.execute("""
        SELECT COUNT(*) FROM tasks
        WHERE project_id = %s AND item_type = 'epic'
          AND generation_context IS NOT NULL AND generation_context::text LIKE '%%related_rules%%'
    """, (PROJECT_ID,))
    print(f"\n  Epics with rule links: {cur.fetchone()[0]}/14")

    cur.execute("""
        SELECT COUNT(*) FILTER (WHERE metadata ? 'domain') as with_domain,
               COUNT(*) as total
        FROM rag_documents
        WHERE project_id = %s AND metadata->>'type' = 'document'
          AND metadata->>'content_type' = 'prompt_history'
    """, (PROJECT_ID,))
    row = cur.fetchone()
    print(f"\n  Prompt history with domain: {row[0]}/{row[1]}")

    cur.execute("SELECT COUNT(*) FROM rag_documents WHERE project_id = %s", (PROJECT_ID,))
    print(f"\n  Total RAG documents: {cur.fetchone()[0]}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
