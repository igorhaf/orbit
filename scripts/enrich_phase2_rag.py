#!/usr/bin/env python3
"""
Enrich Phase 2 - Block 5: Update RAG metadata for card documents.
- Add acceptance_criteria_count and has_semantic_prompt to RAG card metadata
- Update content of RAG card docs to include AC summary for semantic search
- Re-embed only if content changed substantially (> 20% longer)
Anti-duplication: updates existing docs, never creates duplicate card docs.
"""
import json
import uuid
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


def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    # Fetch all cards with enriched generation_context
    cur.execute("""
        SELECT id, item_type, title, description, story_points, generation_context
        FROM tasks
        WHERE project_id = %s
        ORDER BY item_type, title
    """, (PROJECT_ID,))
    cards = cur.fetchall()
    print(f"Cards to process: {len(cards)}")

    updated = 0
    re_embedded = 0
    not_found = 0

    for card_id, item_type, title, description, story_points, gen_ctx_raw in cards:
        ctx = gen_ctx_raw if isinstance(gen_ctx_raw, dict) else (
            json.loads(gen_ctx_raw) if gen_ctx_raw else {}
        )

        ac_list = ctx.get("acceptance_criteria", [])
        has_prompt = "semantic_prompt" in ctx
        domain = ctx.get("domain", "")

        # Find existing RAG doc for this card
        cur.execute("""
            SELECT id, content, metadata
            FROM rag_documents
            WHERE project_id = %s
              AND metadata->>'type' = 'card'
              AND metadata->>'card_id' = %s
        """, (PROJECT_ID, str(card_id)))
        rag_row = cur.fetchone()

        if not rag_row:
            not_found += 1
            continue

        rag_id, old_content, old_metadata_raw = rag_row
        old_metadata = old_metadata_raw if isinstance(old_metadata_raw, dict) else json.loads(old_metadata_raw)

        # Build enriched content with AC summary
        ac_summary = ""
        if ac_list:
            ac_lines = "\n".join(f"- {ac['id']}: {ac['criterion'][:120]}..." for ac in ac_list[:3])
            ac_summary = f"\n\nAcceptance Criteria:\n{ac_lines}"

        new_content = f"{old_content}{ac_summary}"

        # Update metadata
        new_metadata = dict(old_metadata)
        new_metadata["acceptance_criteria_count"] = len(ac_list)
        new_metadata["has_semantic_prompt"] = has_prompt
        if domain:
            new_metadata["domain"] = domain

        # Check if re-embed is needed (content grew > 20%)
        content_changed = len(new_content) > len(old_content) * 1.10

        if content_changed:
            embedding = get_embedding(new_content)
            embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
            cur.execute("""
                UPDATE rag_documents
                SET content = %s, embedding = %s::vector, metadata = %s::jsonb
                WHERE id = %s
            """, (new_content, embedding_str, json.dumps(new_metadata), rag_id))
            re_embedded += 1
        else:
            cur.execute("""
                UPDATE rag_documents
                SET metadata = %s::jsonb
                WHERE id = %s
            """, (json.dumps(new_metadata), rag_id))

        updated += 1

    conn.commit()
    print(f"\nResults:")
    print(f"  RAG card docs updated: {updated}")
    print(f"  Re-embedded (content change > 10%): {re_embedded}")
    print(f"  RAG docs not found for card: {not_found}")

    # Verify final state
    cur.execute("""
        SELECT
            COUNT(*) FILTER (WHERE (metadata->>'acceptance_criteria_count')::int > 0) as with_ac,
            COUNT(*) FILTER (WHERE (metadata->>'has_semantic_prompt')::bool) as with_prompt,
            COUNT(*) as total
        FROM rag_documents
        WHERE project_id = %s AND metadata->>'type' = 'card'
    """, (PROJECT_ID,))
    row = cur.fetchone()
    print(f"\n  RAG cards with ac_count > 0: {row[0]}")
    print(f"  RAG cards with has_semantic_prompt: {row[1]}")
    print(f"  Total RAG card docs: {row[2]}")

    cur.execute("SELECT COUNT(*) FROM rag_documents WHERE project_id = %s", (PROJECT_ID,))
    print(f"\n  Total RAG documents: {cur.fetchone()[0]}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
