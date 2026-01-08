"""
Test Script for Code Indexing (PROMPT #89)

Tests the codebase indexer with sample Laravel project.
"""

import asyncio
import sys
from pathlib import Path
from uuid import uuid4

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from app.database import SessionLocal
from app.models.project import Project
from app.services.codebase_indexer import CodebaseIndexer


async def test_code_indexing():
    """Test code indexing with sample Laravel project."""

    print("=" * 80)
    print("PROMPT #89 - Code Indexing Test")
    print("=" * 80)
    print()

    db = SessionLocal()

    try:
        # Create test project
        print("1. Creating test project...")
        test_project = Project(
            id=uuid4(),
            name="Test Laravel Project",
            project_folder="/app/projects/final-test-laravel",  # Docker-mapped path
            stack_backend="Laravel",
            stack_frontend="Blade",
            stack_database="MySQL"
        )
        db.add(test_project)
        db.commit()
        db.refresh(test_project)
        print(f"✅ Test project created: {test_project.id}")
        print()

        # Index project
        print("2. Indexing project codebase...")
        indexer = CodebaseIndexer(db)
        result = await indexer.index_project(test_project.id, force=True)

        print("✅ Indexing complete!")
        print()
        print(f"   Files scanned: {result['files_scanned']}")
        print(f"   Files indexed: {result['files_indexed']}")
        print(f"   Files skipped: {result['files_skipped']}")
        print(f"   Total lines: {result['total_lines']}")
        print()
        print("   Languages:")
        for lang, count in result['languages'].items():
            print(f"     - {lang}: {count} files")
        print()

        if result['errors']:
            print(f"   ⚠️  Errors: {len(result['errors'])}")
            for error in result['errors'][:5]:  # Show first 5
                print(f"     - {error}")
            print()

        # Test search
        print("3. Testing semantic search...")
        search_queries = [
            ("User authentication", "php"),
            ("Product model", "php"),
            ("Order controller", "php")
        ]

        for query, language in search_queries:
            print(f"\n   Query: '{query}' (language: {language})")
            results = await indexer.search_code(
                project_id=test_project.id,
                query=query,
                language=language,
                top_k=3
            )

            if results:
                print(f"   ✅ Found {len(results)} results")
                for i, r in enumerate(results, 1):
                    metadata = r.get("metadata", {})
                    file_path = metadata.get("file_path", "unknown")
                    similarity = r.get("similarity", 0.0)
                    classes = metadata.get("classes", [])
                    functions = metadata.get("functions", [])

                    print(f"     {i}. {file_path} (similarity: {similarity:.2f})")
                    if classes:
                        print(f"        Classes: {', '.join(classes[:3])}")
                    if functions:
                        print(f"        Functions: {', '.join(functions[:3])}")
            else:
                print("   ❌ No results found")

        print()

        # Get stats
        print("4. Getting indexing statistics...")
        stats = await indexer.get_indexing_stats(test_project.id)
        print(f"✅ Stats retrieved:")
        print(f"   Total documents: {stats['total_documents']}")
        print(f"   Avg content length: {stats['avg_content_length']:.0f} chars")
        print()

        # Cleanup
        print("5. Cleaning up test data...")
        # Delete RAG documents
        indexer.rag.delete_by_project(test_project.id)
        # Delete test project
        db.delete(test_project)
        db.commit()
        print("✅ Test data cleaned up")
        print()

        print("=" * 80)
        print("✅ ALL TESTS PASSED!")
        print("=" * 80)

    except Exception as e:
        print()
        print("=" * 80)
        print(f"❌ TEST FAILED: {e}")
        print("=" * 80)
        import traceback
        traceback.print_exc()

        # Cleanup on error
        try:
            if test_project.id:
                db.delete(test_project)
                db.commit()
        except:
            pass

    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(test_code_indexing())
