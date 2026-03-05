#!/usr/bin/env python3
"""
Enrich Phase 2 - Block 6: Final validation.
Checks all enrichment goals were met.
"""
import psycopg2
import os

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"
WIKI_DIR = "satellite/knowledge/wiki"

EXPECTED_WIKI_PAGES = 34  # 24 original + 10 new
EXPECTED_CARDS = 128
EXPECTED_RAG_MIN = 15627
MIN_TASK_DESC_LEN = 300

def check(label, condition, actual, expected=None):
    status = "PASS" if condition else "FAIL"
    exp_str = f" (expected: {expected})" if expected is not None else ""
    print(f"  [{status}] {label}: {actual}{exp_str}")
    return condition

def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    passes = 0
    failures = 0

    print("=" * 60)
    print("ENRICH PHASE 2 — FINAL VALIDATION")
    print("=" * 60)

    # ---- Wiki pages ----
    print("\n[Wiki Pages]")

    cur.execute("SELECT COUNT(*) FROM wiki_pages WHERE project_id = %s", (PROJECT_ID,))
    wiki_count = cur.fetchone()[0]
    ok = check("Wiki pages in DB", wiki_count >= EXPECTED_WIKI_PAGES, wiki_count, EXPECTED_WIKI_PAGES)
    passes += ok; failures += not ok

    fs_count = len([f for f in os.listdir(WIKI_DIR) if f.endswith(".md")]) if os.path.exists(WIKI_DIR) else 0
    ok = check("Wiki files in FS", fs_count >= EXPECTED_WIKI_PAGES, fs_count, EXPECTED_WIKI_PAGES)
    passes += ok; failures += not ok

    cur.execute("SELECT COUNT(*) FROM rag_documents WHERE project_id = %s AND metadata->>'type' = 'wiki_page'", (PROJECT_ID,))
    wiki_rag = cur.fetchone()[0]
    ok = check("Wiki RAG docs", wiki_rag >= EXPECTED_WIKI_PAGES, wiki_rag, EXPECTED_WIKI_PAGES)
    passes += ok; failures += not ok

    # Verify new slugs exist
    new_slugs = ["utility-nodes", "error-classification", "rate-limiting", "pipeline-profiles",
                 "modification-manager", "continuous-rag", "knowledge-graph",
                 "contracts-system", "budget-manager", "console-logger"]
    cur.execute("SELECT slug FROM wiki_pages WHERE project_id = %s", (PROJECT_ID,))
    existing = {r[0] for r in cur.fetchall()}
    missing = [s for s in new_slugs if s not in existing]
    ok = check("All 10 new slugs present", len(missing) == 0, f"missing: {missing}" if missing else "all present")
    passes += ok; failures += not ok

    # ---- Cards ----
    print("\n[Cards — Acceptance Criteria]")

    cur.execute("""
        SELECT COUNT(*) FROM tasks
        WHERE project_id = %s AND generation_context::text LIKE '%%acceptance_criteria%%'
    """, (PROJECT_ID,))
    ac_count = cur.fetchone()[0]
    ok = check("Cards with acceptance criteria", ac_count == EXPECTED_CARDS, ac_count, EXPECTED_CARDS)
    passes += ok; failures += not ok

    print("\n[Cards — Semantic Prompts]")
    cur.execute("""
        SELECT COUNT(*) FROM tasks
        WHERE project_id = %s AND generation_context::text LIKE '%%semantic_prompt%%'
    """, (PROJECT_ID,))
    sp_count = cur.fetchone()[0]
    ok = check("Cards with semantic prompts", sp_count == EXPECTED_CARDS, sp_count, EXPECTED_CARDS)
    passes += ok; failures += not ok

    print("\n[Card Descriptions]")
    cur.execute("""
        SELECT item_type, AVG(LENGTH(description))::int, MIN(LENGTH(description))
        FROM tasks WHERE project_id = %s
        GROUP BY item_type ORDER BY item_type
    """, (PROJECT_ID,))
    for row in cur.fetchall():
        itype, avg_len, min_len = row
        ok = check(f"  {itype} avg desc >= {MIN_TASK_DESC_LEN}", avg_len >= MIN_TASK_DESC_LEN,
                   f"avg={avg_len}, min={min_len}")
        passes += ok; failures += not ok

    # ---- RAG ----
    print("\n[RAG Coverage]")

    cur.execute("SELECT COUNT(*) FROM rag_documents WHERE project_id = %s", (PROJECT_ID,))
    total_rag = cur.fetchone()[0]
    ok = check("Total RAG docs", total_rag >= EXPECTED_RAG_MIN, total_rag, f">= {EXPECTED_RAG_MIN}")
    passes += ok; failures += not ok

    cur.execute("""
        SELECT COUNT(*) FILTER (WHERE (metadata->>'acceptance_criteria_count')::int > 0),
               COUNT(*) FILTER (WHERE (metadata->>'has_semantic_prompt')::bool),
               COUNT(*)
        FROM rag_documents WHERE project_id = %s AND metadata->>'type' = 'card'
    """, (PROJECT_ID,))
    row = cur.fetchone()
    ok = check("RAG cards with AC metadata", row[0] == EXPECTED_CARDS, row[0], EXPECTED_CARDS)
    passes += ok; failures += not ok
    ok = check("RAG cards with prompt metadata", row[1] == EXPECTED_CARDS, row[1], EXPECTED_CARDS)
    passes += ok; failures += not ok

    # ---- Business Rules ----
    print("\n[Business Rules]")
    cur.execute("SELECT COUNT(*) FROM rag_documents WHERE project_id = %s AND metadata->>'type' = 'business_rule'", (PROJECT_ID,))
    rules = cur.fetchone()[0]
    ok = check("Business rules total", rules >= 54, rules, ">= 54")
    passes += ok; failures += not ok

    # ---- Epics with rule links ----
    print("\n[Epic-Rule Links]")
    cur.execute("""
        SELECT COUNT(*) FROM tasks
        WHERE project_id = %s AND item_type = 'epic'
          AND generation_context::text LIKE '%%related_rules%%'
    """, (PROJECT_ID,))
    epic_links = cur.fetchone()[0]
    ok = check("Epics with rule links (14/14)", epic_links == 14, epic_links, 14)
    passes += ok; failures += not ok

    # ---- Summary ----
    print("\n" + "=" * 60)
    total = passes + failures
    print(f"RESULT: {passes}/{total} PASS {'✅' if failures == 0 else '❌'}")
    print("=" * 60)

    # RAG breakdown
    cur.execute("""
        SELECT metadata->>'type', COUNT(*) FROM rag_documents
        WHERE project_id = %s GROUP BY metadata->>'type' ORDER BY count DESC
    """, (PROJECT_ID,))
    print("\nRAG documents by type:")
    for row in cur.fetchall():
        print(f"  {row[0]}: {row[1]}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
