"""
Embed deep_pipeline artifacts into the RAG vector store (rag_documents).

WHY THIS EXISTS
---------------
The deep_pipeline writes its output (file_analysis, synthesized_rules,
architectural_map) into `pipeline_artifacts` as plain JSONB — with ZERO
embeddings. So the project "memory" exists as structured data but is NOT
retrievable by semantic similarity: it is not actually RAG, just a dump.

This script backfills the vector store: it reads the relevant artifacts and
calls RAGService.store(), which embeds via Nomic (Ollama) and inserts into
`rag_documents`. Run it once per project after a deep_pipeline run completes
(or after repairing the RAG schema).

REQUIREMENTS
------------
- pgvector installed + rag_documents table present (vector(768)).
- Ollama reachable at OLLAMA_HOST (the embeddings come from there). If Ollama
  is down, every store() raises RuntimeError — the script reports and stops.

USAGE
-----
    PYTHONPATH=/app python backend/scripts/embed_pipeline_artifacts.py <project_id> [--dry-run]

It is idempotent-ish: it tags every doc with metadata.source='pipeline_artifact'
and the artifact id, and SKIPS artifacts already embedded for that project.
"""
import sys
import json
import logging

from sqlalchemy import text

from app.database import SessionLocal
from app.services.rag_service import RAGService

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("embed_pipeline_artifacts")

# Which artifact types are worth embedding (most useful for retrieval).
EMBEDDABLE_TYPES = {"synthesized_rules", "file_analysis", "architectural_map"}


def _artifact_to_text(artifact_type: str, content: dict) -> str:
    """Render an artifact's JSONB into a compact, embeddable text blob."""
    if not isinstance(content, dict):
        return json.dumps(content, ensure_ascii=False)
    if artifact_type == "synthesized_rules":
        parts = [f"Domínio: {content.get('domain', '?')}"]
        if content.get("domain_summary"):
            parts.append(content["domain_summary"])
        for r in content.get("consolidated_rules", []) or []:
            t = r.get("rule_text") if isinstance(r, dict) else str(r)
            if t:
                parts.append(f"- {t}")
        return "\n".join(parts)
    if artifact_type == "file_analysis":
        return (
            f"Arquivo: {content.get('path', '?')}\n"
            f"{content.get('summary', '') or json.dumps(content, ensure_ascii=False)}"
        )
    # architectural_map and others: dump compactly
    return json.dumps(content, ensure_ascii=False)[:8000]


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv
    if not args:
        print("usage: embed_pipeline_artifacts.py <project_id> [--dry-run]")
        return 2
    project_id = args[0]

    db = SessionLocal()
    try:
        # Guard: table must exist.
        if db.execute(text("SELECT to_regclass('public.rag_documents')")).scalar() is None:
            logger.error("rag_documents não existe — rode as migrations de pgvector/RAG primeiro.")
            return 1

        # artifact_type is a PG enum (artifacttype); cast to text to compare.
        rows = db.execute(
            text(
                "SELECT id, artifact_type::text, content FROM pipeline_artifacts "
                "WHERE project_id = :pid AND artifact_type::text = ANY(:types)"
            ),
            {"pid": project_id, "types": list(EMBEDDABLE_TYPES)},
        ).fetchall()
        logger.info("Encontrados %d artifacts embeddáveis para o projeto %s", len(rows), project_id)

        # Which artifact ids are already embedded (idempotency).
        already = {
            r[0]
            for r in db.execute(
                text(
                    "SELECT metadata->>'artifact_id' FROM rag_documents "
                    "WHERE project_id = :pid AND metadata->>'source' = 'pipeline_artifact'"
                ),
                {"pid": project_id},
            ).fetchall()
            if r[0]
        }

        rag = RAGService(db)
        stored, skipped, failed = 0, 0, 0
        for art_id, art_type, content in rows:
            if str(art_id) in already:
                skipped += 1
                continue
            c = content if isinstance(content, dict) else json.loads(content)
            blob = _artifact_to_text(art_type, c)
            if not blob.strip():
                skipped += 1
                continue
            meta = {
                "source": "pipeline_artifact",
                "type": art_type,
                "artifact_id": str(art_id),
                "domain": c.get("domain") if isinstance(c, dict) else None,
            }
            if dry_run:
                logger.info("[dry-run] embedaria %s (%s, %d chars)", art_id, art_type, len(blob))
                stored += 1
                continue
            try:
                rag.store(content=blob, metadata=meta, project_id=project_id)
                stored += 1
            except Exception as e:
                failed += 1
                logger.error("Falha ao embedar artifact %s (%s): %s", art_id, art_type, e)
                # If Ollama is down, the first failure repeats — stop early.
                if failed >= 3:
                    logger.error("3 falhas seguidas — abortando (Ollama provavelmente indisponível).")
                    break

        logger.info(
            "Concluído: %d embeddados, %d pulados (já existiam/vazios), %d falharam.",
            stored, skipped, failed,
        )
        return 0 if failed == 0 else 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
