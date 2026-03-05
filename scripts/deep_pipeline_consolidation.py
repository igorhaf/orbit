#!/usr/bin/env python3
"""
Deep Pipeline Consolidation: Cross-reference enrichment
Links cards <-> business rules <-> wiki pages via metadata.
No new documents created - only enriches existing entities.
"""
import json
import psycopg2

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"

# Domain-to-wiki mapping
DOMAIN_WIKI = {
    "ai_orchestration": "orquestracao-ia",
    "rag_knowledge": "rag-pipeline",
    "interviews": "sistema-entrevistas",
    "backlog_generation": "geracao-backlog",
    "deep_pipeline": "deep-pipeline",
    "wiki_system": "wiki-automatica",
    "caching": "cache-multinivel",
    "analytics": "analytics-monitoramento",
    "prompt_management": "prompts-externalizados",
    "job_system": "sistema-jobs",
    "project_management": "gestao-projetos",
    "kanban": "kanban-board",
    "framework_specs": "framework-specs",
    "ai_flow": "ai-flow-studio",
    "git_integration": "integracao-git",
    "pattern_discovery": "pattern-discovery",
    "infrastructure": "infraestrutura",
}

# Epic title -> domain mapping
EPIC_DOMAIN = {
    "Orquestração Multi-Provider de IA": "ai_orchestration",
    "Cache Redis Multi-Nível (L1/L2/L3)": "caching",
    "RAG Pipeline com pgvector": "rag_knowledge",
    "Sistema de Entrevistas Contextuais": "interviews",
    "Deep Pipeline de Análise de Codebase": "deep_pipeline",
    "Sistema de Wiki Automática": "wiki_system",
    "Geração Hierárquica de Backlog": "backlog_generation",
    "Sistema de Prompts Externalizados": "prompt_management",
    "Frontend Next.js 14 App Router": "infrastructure",
    "Framework Specs e Token Reduction": "framework_specs",
    "Sistema de Jobs Assíncronos": "job_system",
    "Integração Git e Commit Generation": "git_integration",
    "Pattern Discovery e Tech Stack Detection": "pattern_discovery",
    "Gestão de Projetos Core": "project_management",
}

def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    # =========================================================
    # STEP 1: Add domain labels to Epic cards
    # =========================================================
    print("Step 1: Adding domain labels to Epics...")
    epic_domains = {}
    for epic_title, domain in EPIC_DOMAIN.items():
        wiki_slug = DOMAIN_WIKI.get(domain, "")
        labels = json.dumps({
            "domain": domain,
            "wiki_page": wiki_slug,
        })
        cur.execute("""
            UPDATE tasks SET labels = %s::jsonb
            WHERE project_id = %s AND item_type = 'epic' AND title = %s
            RETURNING id
        """, (labels, PROJECT_ID, epic_title))
        row = cur.fetchone()
        if row:
            epic_domains[row[0]] = domain
            print(f"  Epic '{epic_title}' -> domain={domain}, wiki={wiki_slug}")

    # =========================================================
    # STEP 2: Propagate domain to Stories and Tasks via parent
    # =========================================================
    print("\nStep 2: Propagating domain to Stories...")
    story_domains = {}
    for epic_id, domain in epic_domains.items():
        wiki_slug = DOMAIN_WIKI.get(domain, "")
        labels = json.dumps({"domain": domain, "wiki_page": wiki_slug})
        cur.execute("""
            UPDATE tasks SET labels = %s::jsonb
            WHERE project_id = %s AND parent_id = %s AND item_type = 'story'
            RETURNING id
        """, (labels, PROJECT_ID, epic_id))
        for row in cur.fetchall():
            story_domains[row[0]] = domain

    print(f"  Updated {len(story_domains)} stories")

    print("\nStep 3: Propagating domain to Tasks...")
    task_count = 0
    for story_id, domain in story_domains.items():
        wiki_slug = DOMAIN_WIKI.get(domain, "")
        labels = json.dumps({"domain": domain, "wiki_page": wiki_slug})
        cur.execute("""
            UPDATE tasks SET labels = %s::jsonb
            WHERE project_id = %s AND parent_id = %s AND item_type = 'task'
        """, (labels, PROJECT_ID, story_id))
        task_count += cur.rowcount

    print(f"  Updated {task_count} tasks")

    # =========================================================
    # STEP 4: Find related business rules for each Epic
    # =========================================================
    print("\nStep 4: Linking Epics to related business rules...")
    for epic_id, domain in epic_domains.items():
        # Find rules in same domain
        cur.execute("""
            SELECT id, metadata->>'title'
            FROM rag_documents
            WHERE project_id = %s
              AND metadata->>'type' = 'business_rule'
              AND metadata->>'source_domain' = %s
        """, (PROJECT_ID, domain))
        rules = cur.fetchall()

        if rules:
            rule_refs = [{"id": str(r[0]), "title": r[1]} for r in rules]
            cur.execute("""
                UPDATE tasks SET generation_context = %s::json
                WHERE id = %s
            """, (json.dumps({"related_rules": rule_refs, "rules_count": len(rule_refs)}), epic_id))

            cur.execute("SELECT title FROM tasks WHERE id = %s", (epic_id,))
            epic_title = cur.fetchone()[0]
            print(f"  Epic '{epic_title}' linked to {len(rules)} rules")

    # =========================================================
    # STEP 5: Enrich RAG card documents with domain metadata
    # =========================================================
    print("\nStep 5: Enriching RAG card documents with domain...")
    enriched = 0
    for epic_id, domain in epic_domains.items():
        wiki_slug = DOMAIN_WIKI.get(domain, "")
        # Update Epic RAG doc
        cur.execute("""
            UPDATE rag_documents SET metadata = metadata || %s::jsonb
            WHERE project_id = %s
              AND metadata->>'type' = 'card'
              AND metadata->>'card_id' = %s
        """, (json.dumps({"domain": domain, "wiki_page": wiki_slug}), PROJECT_ID, str(epic_id)))
        enriched += cur.rowcount

    # Update Story RAG docs
    for story_id, domain in story_domains.items():
        wiki_slug = DOMAIN_WIKI.get(domain, "")
        cur.execute("""
            UPDATE rag_documents SET metadata = metadata || %s::jsonb
            WHERE project_id = %s
              AND metadata->>'type' = 'card'
              AND metadata->>'card_id' = %s
        """, (json.dumps({"domain": domain, "wiki_page": wiki_slug}), PROJECT_ID, str(story_id)))
        enriched += cur.rowcount

    print(f"  Enriched {enriched} RAG card documents")

    # =========================================================
    # STEP 6: Enrich wiki RAG docs with related card count
    # =========================================================
    print("\nStep 6: Enriching wiki RAG docs with card counts...")
    for domain, wiki_slug in DOMAIN_WIKI.items():
        # Count cards in this domain
        cur.execute("""
            SELECT COUNT(*) FROM tasks
            WHERE project_id = %s AND labels->>'domain' = %s
        """, (PROJECT_ID, domain))
        card_count = cur.fetchone()[0]

        # Count rules in this domain
        cur.execute("""
            SELECT COUNT(*) FROM rag_documents
            WHERE project_id = %s AND metadata->>'type' = 'business_rule'
              AND metadata->>'source_domain' = %s
        """, (PROJECT_ID, domain))
        rule_count = cur.fetchone()[0]

        if card_count > 0 or rule_count > 0:
            cur.execute("""
                UPDATE rag_documents SET metadata = metadata || %s::jsonb
                WHERE project_id = %s AND metadata->>'type' = 'wiki_page'
                  AND metadata->>'slug' = %s
            """, (json.dumps({
                "domain": domain,
                "related_cards": card_count,
                "related_rules": rule_count
            }), PROJECT_ID, wiki_slug))
            print(f"  Wiki '{wiki_slug}': {card_count} cards, {rule_count} rules")

    conn.commit()

    # =========================================================
    # STEP 7: Verify cross-reference integrity
    # =========================================================
    print("\n" + "="*60)
    print("Verification:")

    cur.execute("SELECT COUNT(*) FROM tasks WHERE project_id = %s AND labels IS NOT NULL AND labels::text LIKE '%%domain%%'", (PROJECT_ID,))
    print(f"  Cards with domain labels: {cur.fetchone()[0]}")

    cur.execute("SELECT COUNT(*) FROM tasks WHERE project_id = %s AND generation_context IS NOT NULL AND generation_context::text LIKE '%%related_rules%%'", (PROJECT_ID,))
    print(f"  Epics with rule links: {cur.fetchone()[0]}")

    cur.execute("SELECT COUNT(*) FROM rag_documents WHERE project_id = %s AND metadata->>'type' = 'card' AND metadata ? 'domain'", (PROJECT_ID,))
    print(f"  RAG cards with domain: {cur.fetchone()[0]}")

    cur.execute("SELECT COUNT(*) FROM rag_documents WHERE project_id = %s AND metadata->>'type' = 'wiki_page' AND metadata ? 'domain'", (PROJECT_ID,))
    print(f"  Wiki RAG docs with domain: {cur.fetchone()[0]}")

    print("\nConsolidation complete!")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
