"""
Tests for RAG Service
PROMPT #83 - Phase 1: RAG Foundation
"""

import pytest
from uuid import uuid4
from sqlalchemy.orm import Session

from app.services.rag_service import RAGService


@pytest.fixture
def rag_service(db_session: Session):
    """Fixture that provides RAG service instance"""
    return RAGService(db_session)


@pytest.fixture
def sample_project_id():
    """Fixture that provides a sample project UUID"""
    return uuid4()


def test_rag_store_and_retrieve(rag_service: RAGService, sample_project_id):
    """Test storing and retrieving documents"""
    # Store a document
    content = "User authentication implemented with JWT and refresh tokens"
    metadata = {
        "type": "interview_answer",
        "question_number": 12,
        "interview_id": str(uuid4())
    }

    doc_id = rag_service.store(
        content=content,
        metadata=metadata,
        project_id=sample_project_id
    )

    assert doc_id is not None

    # Retrieve similar documents
    results = rag_service.retrieve(
        query="How was authentication implemented?",
        filter={"project_id": sample_project_id},
        top_k=5,
        similarity_threshold=0.5
    )

    assert len(results) > 0
    assert results[0]["content"] == content
    assert results[0]["metadata"]["type"] == "interview_answer"
    assert results[0]["similarity"] > 0.5


def test_rag_search_with_similarity_threshold(rag_service: RAGService, sample_project_id):
    """Test search with similarity threshold filtering"""
    # Store documents
    rag_service.store(
        content="Laravel controller for user management",
        metadata={"type": "code_pattern"},
        project_id=sample_project_id
    )

    rag_service.store(
        content="Next.js page component with server-side rendering",
        metadata={"type": "code_pattern"},
        project_id=sample_project_id
    )

    # Search with high threshold (only very similar results)
    results = rag_service.search(
        query="Laravel user controller",
        project_id=sample_project_id,
        similarity_threshold=0.7
    )

    # Should return Laravel result but not Next.js
    assert any("Laravel" in r["content"] for r in results)


def test_rag_global_vs_project_specific(rag_service: RAGService):
    """Test global knowledge vs project-specific knowledge"""
    project_a = uuid4()
    project_b = uuid4()

    # Store global knowledge (no project_id)
    rag_service.store(
        content="Best practice: Use prepared statements to prevent SQL injection",
        metadata={"type": "best_practice", "category": "security"},
        project_id=None  # Global
    )

    # Store project-specific knowledge
    rag_service.store(
        content="This project uses JWT with 24-hour expiration",
        metadata={"type": "project_decision"},
        project_id=project_a
    )

    rag_service.store(
        content="This project uses session-based auth with Redis",
        metadata={"type": "project_decision"},
        project_id=project_b
    )

    # Search in project A
    results_a = rag_service.search(
        query="authentication method",
        project_id=project_a,
        similarity_threshold=0.6
    )

    # Should find project A's auth (JWT), not project B's (session)
    assert any("JWT" in r["content"] for r in results_a)
    assert not any("session" in r["content"] for r in results_a)


def test_rag_delete(rag_service: RAGService, sample_project_id):
    """Test deleting documents"""
    # Store document
    doc_id = rag_service.store(
        content="Test document to be deleted",
        metadata={"type": "test"},
        project_id=sample_project_id
    )

    # Delete document
    deleted = rag_service.delete(doc_id)
    assert deleted is True

    # Verify it's gone
    results = rag_service.search(
        query="Test document",
        project_id=sample_project_id
    )

    assert not any(doc_id == r["id"] for r in results)


def test_rag_delete_by_project(rag_service: RAGService):
    """Test deleting all documents for a project"""
    project_id = uuid4()

    # Store multiple documents
    for i in range(3):
        rag_service.store(
            content=f"Document {i} for project",
            metadata={"type": "test", "index": i},
            project_id=project_id
        )

    # Delete all documents for project
    count = rag_service.delete_by_project(project_id)
    assert count == 3

    # Verify they're gone
    results = rag_service.search(
        query="Document",
        project_id=project_id
    )

    assert len(results) == 0


def test_rag_stats(rag_service: RAGService, sample_project_id):
    """Test getting RAG statistics"""
    # Store some documents
    rag_service.store(
        content="First document with some content",
        metadata={"type": "test"},
        project_id=sample_project_id
    )

    rag_service.store(
        content="Second document with different content",
        metadata={"type": "another_test"},
        project_id=sample_project_id
    )

    # Get stats for project
    stats = rag_service.get_stats(project_id=sample_project_id)

    assert stats["document_count"] == 2
    assert stats["avg_content_length"] > 0
    assert len(stats["metadata_types"]) > 0


def test_rag_metadata_filter(rag_service: RAGService, sample_project_id):
    """Test filtering by metadata type"""
    # Store documents with different types
    rag_service.store(
        content="Interview answer about authentication",
        metadata={"type": "interview_answer"},
        project_id=sample_project_id
    )

    rag_service.store(
        content="Code pattern for Laravel controller",
        metadata={"type": "code_pattern"},
        project_id=sample_project_id
    )

    # Search with type filter
    results = rag_service.retrieve(
        query="authentication",
        filter={
            "project_id": sample_project_id,
            "type": "interview_answer"
        },
        top_k=5
    )

    # Should only return interview answers
    assert all(r["metadata"]["type"] == "interview_answer" for r in results)


def test_rag_top_k_limit(rag_service: RAGService, sample_project_id):
    """Test top_k parameter limits results"""
    # Store multiple similar documents
    for i in range(10):
        rag_service.store(
            content=f"Document {i} about Laravel authentication with JWT",
            metadata={"type": "test", "index": i},
            project_id=sample_project_id
        )

    # Search with top_k=3
    results = rag_service.search(
        query="Laravel authentication",
        project_id=sample_project_id,
        top_k=3,
        similarity_threshold=0.5
    )

    # Should return exactly 3 results
    assert len(results) <= 3
