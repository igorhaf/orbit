#!/usr/bin/env python3
"""
RAG Document Indexer - satellite/docs/

Indexes all MD files from a project's satellite/docs/ directory into the RAG
system (rag_documents table). This script is designed to be reusable across
any ORBIT project.

Three passes:
  1. Index full document content as chunks (type=prompt_doc)
     - Documents split into 500-char chunks with 50-char overlap
     - Enables semantic search across all documentation
     - Deduplication by filename (skips already-indexed files)

  2. Extract and store business rules (type=business_rule)
     - Pattern-based extraction from document content
     - Classifies rules by type (domain, workflow, constraint, validation)
     - Assigns priority (high, normal, low)
     - Sources tagged as "document" to distinguish from code-extracted rules

  3. Index key documents as high-priority knowledge (type=project_knowledge)
     - Full content of critical documents (business analyst report, plan, etc.)
     - Higher retrieval priority for project-level queries

Usage:
  # Index ORBIT's own docs:
  cd /home/igorhaf/orbit/backend
  poetry run python -m app.scripts.index_docs_rag

  # Index another project (pass project_id and docs_dir):
  poetry run python -m app.scripts.index_docs_rag \
    --project-id "uuid-here" \
    --docs-dir "/path/to/project/satellite/docs"

  # Dry run (count files without indexing):
  poetry run python -m app.scripts.index_docs_rag --dry-run

Requirements:
  - PostgreSQL running with rag_documents table
  - sentence-transformers installed (all-MiniLM-L6-v2)
  - Backend .env with DATABASE_URL configured

PROMPT #238 - RAG Document Indexer from satellite/docs/
"""

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path
from uuid import UUID

# Ensure backend is in path
backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(backend_dir))
os.chdir(backend_dir)

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.services.rag_service import RAGService

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ============================================================
# Default configuration
# ============================================================
DEFAULT_CHUNK_SIZE = 500
DEFAULT_CHUNK_OVERLAP = 50
DEFAULT_KEY_DOCS = [
    "ORBIT_BUSINESS_ANALYST_REPORT.md",
    "JIRA_TRANSFORMATION_ANALYSIS.md",
    "PLAN.md",
    "TECH_DEBT.md",
    "MODELS_SUMMARY.md",
    "PROMPTER_GUIDE.md",
]


def chunk_text(text_content: str, chunk_size: int = DEFAULT_CHUNK_SIZE, overlap: int = DEFAULT_CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks for embedding."""
    if len(text_content) <= chunk_size:
        return [text_content]

    chunks = []
    start = 0
    while start < len(text_content):
        end = start + chunk_size
        chunk = text_content[start:end]
        if chunk.strip():
            chunks.append(chunk.strip())
        start = end - overlap
    return chunks


def extract_business_rules(content: str, filename: str) -> list[dict]:
    """
    Extract business rules from document content using pattern matching.

    Extraction strategies:
    1. Explicit rule/requirement patterns (REGRA, Rule, Must, Deve)
    2. Key sections (Objective, Requirements, Implementation, Insights)
    3. Table rows from business/analysis documents
    4. Feature descriptions from PROMPT implementation reports

    Returns list of dicts with: content, rule_type, priority, source_file
    """
    rules = []

    # Pattern 1: Explicit rules/requirements
    rule_patterns = [
        (r'(?:REGRA|Regra|Rule|RULE)\s*#?\d*\s*[-:]\s*(.+?)(?:\n\n|\n(?=[A-Z#])|\Z)', 'domain', 'high'),
        (r'(?:^|\n)\d+\.\s+(?:O sistema |The system |Must |Deve |DEVE )(.+?)(?:\n(?=\d+\.|\n)|\Z)', 'domain', 'normal'),
        (r'[-*]\s+\*\*([^*]+)\*\*:\s*(.+?)(?:\n(?=[-*]|\n)|\Z)', 'domain', 'normal'),
    ]

    for pattern, rule_type, priority in rule_patterns:
        matches = re.finditer(pattern, content, re.MULTILINE | re.DOTALL)
        for match in matches:
            rule_text = match.group(0).strip()
            if 30 < len(rule_text) < 2000:
                rules.append({
                    'content': rule_text,
                    'rule_type': rule_type,
                    'priority': priority,
                    'source_file': filename
                })

    # Pattern 2: Section-based extraction
    section_patterns = [
        (r'##\s*(?:Objective|Objetivo|Key Requirements|Requisitos)\s*\n(.*?)(?=\n##|\Z)', 'domain', 'high'),
        (r'##\s*(?:What Was Implemented|O que foi implementado)\s*\n(.*?)(?=\n##|\Z)', 'workflow', 'normal'),
        (r'##\s*(?:Key Insights|Insights)\s*\n(.*?)(?=\n##|\Z)', 'constraint', 'normal'),
        (r'##\s*(?:Success Metrics|Metricas)\s*\n(.*?)(?=\n##|\Z)', 'domain', 'normal'),
    ]

    for pattern, rule_type, priority in section_patterns:
        matches = re.finditer(pattern, content, re.MULTILINE | re.DOTALL)
        for match in matches:
            section_text = match.group(1).strip()
            if len(section_text) > 50:
                items = re.split(r'\n\s*[-*]\s+|\n\s*\d+\.\s+', section_text)
                for item in items:
                    item = item.strip()
                    if 30 < len(item) < 2000:
                        rules.append({
                            'content': item,
                            'rule_type': rule_type,
                            'priority': priority,
                            'source_file': filename
                        })

    # Pattern 3: Business/analysis document tables
    if 'BUSINESS_ANALYST' in filename or 'JIRA' in filename or filename == 'PLAN.md':
        table_rows = re.finditer(r'\|([^|]+)\|([^|]+)\|([^|]*)\|', content)
        for row in table_rows:
            cells = [c.strip() for c in row.groups()]
            if any(c.startswith('---') or c.startswith('===') for c in cells):
                continue
            if any(c in ('Nivel', 'Level', 'Descricao', 'Description') for c in cells):
                continue
            row_text = ' | '.join(c for c in cells if c)
            if len(row_text) > 20:
                rules.append({
                    'content': row_text,
                    'rule_type': 'domain',
                    'priority': 'normal',
                    'source_file': filename
                })

    # Pattern 4: PROMPT report features
    if filename.startswith('PROMPT_'):
        title_match = re.search(r'^#\s+PROMPT\s+#\d+\s*[-:]\s*(.+)$', content, re.MULTILINE)
        if title_match:
            rules.append({
                'content': f"Feature implementada: {title_match.group(1).strip()}",
                'rule_type': 'workflow',
                'priority': 'normal',
                'source_file': filename
            })

        impact_match = re.search(r'\*\*Impact:\*\*\s*(.+?)(?:\n\n|\Z)', content, re.DOTALL)
        if impact_match:
            impact = impact_match.group(1).strip()
            if len(impact) > 20:
                rules.append({
                    'content': f"Impacto: {impact}",
                    'rule_type': 'domain',
                    'priority': 'normal',
                    'source_file': filename
                })

    # Deduplicate
    seen = set()
    unique_rules = []
    for rule in rules:
        key = rule['content'][:100]
        if key not in seen:
            seen.add(key)
            unique_rules.append(rule)

    return unique_rules


def run_indexer(project_id: UUID, docs_dir: Path, dry_run: bool = False):
    """
    Main indexing function. Can be called programmatically or via CLI.

    Args:
        project_id: UUID of the project to index for
        docs_dir: Path to satellite/docs/ directory
        dry_run: If True, only count files without indexing
    """
    logger.info("=" * 60)
    logger.info("RAG Document Indexer - satellite/docs/")
    logger.info(f"Project: {project_id}")
    logger.info(f"Docs dir: {docs_dir}")
    logger.info("=" * 60)

    if not docs_dir.exists():
        logger.error(f"Docs directory not found: {docs_dir}")
        return {"error": "docs_dir not found"}

    md_files = sorted(docs_dir.glob("*.md"))
    md_files = [f for f in md_files if f.name != ".gitkeep"]
    logger.info(f"Found {len(md_files)} MD files to process")

    if dry_run:
        logger.info("DRY RUN - no changes will be made")
        total_rules = 0
        for md_file in md_files:
            content = md_file.read_text(encoding="utf-8")
            rules = extract_business_rules(content, md_file.name)
            total_rules += len(rules)
        logger.info(f"Would index: {len(md_files)} docs, ~{total_rules} business rules")
        return {"files": len(md_files), "estimated_rules": total_rules}

    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://orbit:orbit_password@localhost:5432/orbit")
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        rag = RAGService(db)
        logger.info("RAGService initialized")

        # Check existing entries
        existing = db.execute(text("""
            SELECT DISTINCT metadata->>'filename'
            FROM rag_documents
            WHERE project_id = :pid
            AND metadata->>'type' = 'prompt_doc'
        """), {"pid": str(project_id)}).fetchall()
        existing_filenames = {r[0] for r in existing if r[0]}
        logger.info(f"Already indexed: {len(existing_filenames)} files")

        # PASS 1: Document chunks
        logger.info("\n--- PASS 1: Indexing document chunks ---")
        docs_indexed = 0
        chunks_created = 0
        skipped = 0

        for md_file in md_files:
            if md_file.name in existing_filenames:
                skipped += 1
                continue

            try:
                content = md_file.read_text(encoding="utf-8")
                if not content.strip():
                    continue

                chunks = chunk_text(content)
                for i, chunk in enumerate(chunks):
                    rag.store(
                        content=chunk,
                        metadata={
                            "type": "prompt_doc",
                            "filename": md_file.name,
                            "chunk_index": i,
                            "total_chunks": len(chunks),
                            "source": "satellite_docs",
                            "content_type": "prompt_doc"
                        },
                        project_id=project_id
                    )
                    chunks_created += 1

                docs_indexed += 1
                if docs_indexed % 50 == 0:
                    logger.info(f"  Progress: {docs_indexed} docs, {chunks_created} chunks")

            except Exception as e:
                logger.warning(f"Error indexing {md_file.name}: {e}")

        logger.info(f"PASS 1: {docs_indexed} docs ({chunks_created} chunks), {skipped} skipped")

        # PASS 2: Business rules
        logger.info("\n--- PASS 2: Extracting business rules ---")
        rules_created = 0

        for md_file in md_files:
            try:
                content = md_file.read_text(encoding="utf-8")
                if not content.strip():
                    continue

                rules = extract_business_rules(content, md_file.name)
                for rule in rules:
                    rag.store_business_rule(
                        content=rule['content'],
                        project_id=project_id,
                        source="document",
                        source_file=f"satellite/docs/{rule['source_file']}",
                        rule_type=rule['rule_type'],
                        priority=rule['priority'],
                        fully_coded=False,
                    )
                    rules_created += 1

            except Exception as e:
                logger.warning(f"Error extracting from {md_file.name}: {e}")

        logger.info(f"PASS 2: {rules_created} business rules extracted")

        # PASS 3: Key documents
        logger.info("\n--- PASS 3: Key documents ---")
        key_indexed = 0
        for doc_name in DEFAULT_KEY_DOCS:
            doc_path = docs_dir / doc_name
            if not doc_path.exists():
                continue

            content = doc_path.read_text(encoding="utf-8")
            rag.store(
                content=content[:8000],
                metadata={
                    "type": "project_knowledge",
                    "filename": doc_name,
                    "source": "satellite_docs",
                    "priority": "high",
                    "content_type": "key_document"
                },
                project_id=project_id
            )
            key_indexed += 1

        logger.info(f"PASS 3: {key_indexed} key documents indexed")

        # Summary
        final_count = db.execute(text("""
            SELECT metadata->>'type' as doc_type, COUNT(*) as cnt
            FROM rag_documents WHERE project_id = :pid
            GROUP BY 1 ORDER BY cnt DESC
        """), {"pid": str(project_id)}).fetchall()

        logger.info("\n" + "=" * 60)
        logger.info("FINAL RAG COUNTS:")
        total = 0
        for row in final_count:
            logger.info(f"  {row[0] or 'unknown':20s} {row[1]:6d}")
            total += row[1]
        logger.info(f"  {'TOTAL':20s} {total:6d}")

        return {
            "docs_indexed": docs_indexed,
            "chunks_created": chunks_created,
            "rules_extracted": rules_created,
            "key_docs": key_indexed,
            "skipped": skipped,
            "total_rag": total
        }

    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Index satellite/docs/ into RAG")
    parser.add_argument("--project-id", type=str, help="Project UUID")
    parser.add_argument("--docs-dir", type=str, help="Path to satellite/docs/")
    parser.add_argument("--dry-run", action="store_true", help="Count files without indexing")
    args = parser.parse_args()

    # Defaults for ORBIT self-analysis
    project_id = UUID(args.project_id) if args.project_id else UUID("0c9afa06-cda9-489f-85d1-5d6c67407f32")
    docs_dir = Path(args.docs_dir) if args.docs_dir else Path("/home/igorhaf/orbit/satellite/docs")

    run_indexer(project_id, docs_dir, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
