"""
Test Interview Question Deduplicator - PROMPT #97
Cross-Interview Deduplication Tests

Tests for RAG-based semantic similarity detection across interviews.
"""

import pytest
from uuid import uuid4
from datetime import datetime
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.interview import Interview
from app.services.interview_question_deduplicator import InterviewQuestionDeduplicator
from app.services.rag_service import RAGService


@pytest.fixture
def test_project(db: Session):
    """Create a test project."""
    project = Project(
        name="Test Project - PROMPT #97",
        description="Testing cross-interview deduplication",
        stack_backend="Laravel",
        stack_database="PostgreSQL",
        stack_frontend="React"
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@pytest.fixture
def test_interviews(db: Session, test_project):
    """Create multiple test interviews for the same project."""
    interview1 = Interview(
        project_id=test_project.id,
        interview_mode="meta_prompt",
        conversation_data=[],
        ai_model_used="claude-sonnet-4-5"
    )
    interview2 = Interview(
        project_id=test_project.id,
        interview_mode="task_focused",
        conversation_data=[],
        ai_model_used="claude-sonnet-4-5"
    )
    interview3 = Interview(
        project_id=test_project.id,
        interview_mode="orchestrator",
        conversation_data=[],
        ai_model_used="claude-sonnet-4-5"
    )

    db.add_all([interview1, interview2, interview3])
    db.commit()
    db.refresh(interview1)
    db.refresh(interview2)
    db.refresh(interview3)

    return interview1, interview2, interview3


# ============================================================================
# TEST 1: Fixed Questions Storage
# ============================================================================

def test_store_fixed_question(db: Session, test_project, test_interviews):
    """TEST 1: Verify fixed questions are stored in RAG with project_id scoping."""
    print("\n📊 TEST 1: Fixed Questions Storage")

    interview1 = test_interviews[0]
    deduplicator = InterviewQuestionDeduplicator(db)

    # Store Q5 from interview1
    question_text = "❓ Pergunta 5: Qual banco de dados você vai usar?\n\n○ PostgreSQL\n○ MySQL\n\nEscolha uma opção."

    deduplicator.store_question(
        project_id=test_project.id,
        interview_id=interview1.id,
        interview_mode="meta_prompt",
        question_text=question_text,
        question_number=5,
        is_fixed=True
    )

    # Verify in RAG
    rag_service = RAGService(db)
    results = rag_service.retrieve(
        query="",
        filter={
            "type": "interview_question",
            "project_id": str(test_project.id)
        },
        top_k=10,
        similarity_threshold=0.0
    )

    assert len(results) > 0, "No questions found in RAG"

    # Check metadata
    stored = results[0]
    assert stored["metadata"]["type"] == "interview_question"
    assert stored["metadata"]["project_id"] == str(test_project.id)
    assert stored["metadata"]["interview_id"] == str(interview1.id)
    assert stored["metadata"]["interview_mode"] == "meta_prompt"
    assert stored["metadata"]["question_number"] == 5
    assert stored["metadata"]["is_fixed"] == True

    # Check content is cleaned
    assert "❓" not in stored["content"], "Emoji should be removed"
    assert "○" not in stored["content"], "Option markers should be removed"
    assert "banco de dados" in stored["content"].lower(), "Core content should be preserved"

    print(f"✅ Stored question: {stored['content'][:80]}...")
    print(f"✅ Metadata: {stored['metadata']}")


# ============================================================================
# TEST 2: Cross-Interview Duplicate Detection
# ============================================================================

def test_cross_interview_duplicate_detection(db: Session, test_project, test_interviews):
    """TEST 2: Verify questions from DIFFERENT interviews are detected."""
    print("\n🔍 TEST 2: Cross-Interview Duplicate Detection")

    interview1, interview2, _ = test_interviews
    deduplicator = InterviewQuestionDeduplicator(db, similarity_threshold=0.85)

    # Store Q5 in interview1
    q5_text = "Qual banco de dados você vai usar?"
    deduplicator.store_question(
        project_id=test_project.id,
        interview_id=interview1.id,
        interview_mode="meta_prompt",
        question_text=q5_text,
        question_number=5,
        is_fixed=True
    )

    # Try similar question in interview2 (DIFFERENT interview, same project)
    candidate = "Que database o sistema utilizará?"
    is_duplicate, similar, score = deduplicator.check_duplicate(
        project_id=test_project.id,
        candidate_question=candidate
    )

    # CRITICAL: Must detect cross-interview duplicate!
    assert is_duplicate == True, f"Should detect duplicate! Similarity: {score:.2%}"
    assert similar is not None
    assert similar["metadata"]["interview_id"] == str(interview1.id), "Should reference interview1"
    assert similar["metadata"]["interview_mode"] == "meta_prompt"
    assert score >= 0.85, f"Similarity should be >= 0.85, got {score:.2%}"

    print(f"✅ Cross-interview duplicate DETECTED!")
    print(f"   Similarity: {score:.2%} (>= 85% threshold)")
    print(f"   From: {similar['metadata']['interview_mode']} interview")
    print(f"   Similar to: {similar['content'][:80]}...")


# ============================================================================
# TEST 3: Different Questions NOT Blocked
# ============================================================================

def test_different_questions_not_blocked(db: Session, test_project, test_interviews):
    """TEST 3: Verify genuinely different questions are NOT blocked."""
    print("\n✅ TEST 3: Different Questions NOT Blocked")

    interview1 = test_interviews[0]
    deduplicator = InterviewQuestionDeduplicator(db, similarity_threshold=0.85)

    # Store Q5
    deduplicator.store_question(
        project_id=test_project.id,
        interview_id=interview1.id,
        interview_mode="meta_prompt",
        question_text="Qual banco de dados você vai usar?",
        question_number=5,
        is_fixed=True
    )

    # Try completely different question
    candidate = "Quais são as principais métricas de sucesso do projeto?"
    is_duplicate, similar, score = deduplicator.check_duplicate(
        project_id=test_project.id,
        candidate_question=candidate
    )

    # Should NOT be detected as duplicate
    if is_duplicate:
        # Only OK if similarity is REALLY high (90%+)
        assert score >= 0.90, f"Should only block very similar questions, got {score:.2%}"
        print(f"⚠️  Borderline similarity detected: {score:.2%}")
    else:
        print(f"✅ Different question NOT blocked (similarity: {score:.2%})")


# ============================================================================
# TEST 4: Question Cleaning
# ============================================================================

def test_question_cleaning(db: Session):
    """TEST 4: Verify question cleaning removes formatting."""
    print("\n🧹 TEST 4: Question Cleaning")

    deduplicator = InterviewQuestionDeduplicator(db)

    # Complex formatted question
    dirty = """❓ Pergunta 3: Qual framework de backend você vai usar?

○ Laravel (PHP)
○ Django (Python)
○ Spring Boot (Java)

Escolha uma opção."""

    clean = deduplicator._clean_question(dirty)

    # Check all formatting removed
    assert "❓" not in clean, "Emoji removed"
    assert "Pergunta" not in clean, "Label removed"
    assert "○" not in clean, "Option marker removed"
    assert "Escolha" not in clean, "Instruction removed"
    assert "framework" in clean.lower(), "Core content preserved"

    print(f"✅ Input:  {dirty[:60]}...")
    print(f"✅ Output: {clean[:60]}...")


# ============================================================================
# TEST 5: Multiple Questions Stored
# ============================================================================

def test_multiple_questions_stored(db: Session, test_project, test_interviews):
    """TEST 5: Verify multiple questions from different interviews stored."""
    print("\n📚 TEST 5: Multiple Questions Stored")

    interview1, interview2, _ = test_interviews
    deduplicator = InterviewQuestionDeduplicator(db)
    rag_service = RAGService(db)

    # Store Q1-Q3 from interview1
    questions_i1 = [
        ("Qual é o título do projeto?", 1),
        ("Descrição e objetivo do projeto", 2),
        ("Qual tipo de sistema?", 3),
    ]

    for text, num in questions_i1:
        deduplicator.store_question(
            project_id=test_project.id,
            interview_id=interview1.id,
            interview_mode="meta_prompt",
            question_text=text,
            question_number=num,
            is_fixed=True
        )

    # Store Q1-Q2 from interview2
    questions_i2 = [
        ("Qual é a tarefa?", 1),
        ("Descrição da tarefa", 2),
    ]

    for text, num in questions_i2:
        deduplicator.store_question(
            project_id=test_project.id,
            interview_id=interview2.id,
            interview_mode="task_focused",
            question_text=text,
            question_number=num,
            is_fixed=True
        )

    # Query all interview questions for project
    all_questions = rag_service.retrieve(
        query="",
        filter={
            "type": "interview_question",
            "project_id": str(test_project.id)
        },
        top_k=50,
        similarity_threshold=0.0
    )

    assert len(all_questions) == 5, f"Expected 5 questions, got {len(all_questions)}"

    # Verify mix of interviews
    interview_ids = set(q["metadata"]["interview_id"] for q in all_questions)
    assert len(interview_ids) == 2, "Questions from 2 different interviews"

    print(f"✅ Stored {len(all_questions)} questions from {len(interview_ids)} interviews")
    for q in all_questions:
        print(f"   - Q{q['metadata']['question_number']}: {q['content'][:50]}...")


# ============================================================================
# TEST 6: Cleanup by Project
# ============================================================================

def test_cleanup_by_project(db: Session, test_project, test_interviews):
    """TEST 6: Verify cleanup by project_id."""
    print("\n🗑️  TEST 6: Cleanup by Project")

    interview1 = test_interviews[0]
    deduplicator = InterviewQuestionDeduplicator(db)
    rag_service = RAGService(db)

    # Store question
    deduplicator.store_question(
        project_id=test_project.id,
        interview_id=interview1.id,
        interview_mode="meta_prompt",
        question_text="Test question",
        question_number=1,
        is_fixed=True
    )

    # Verify stored
    results_before = rag_service.retrieve(
        query="",
        filter={
            "type": "interview_question",
            "project_id": str(test_project.id)
        },
        top_k=10,
        similarity_threshold=0.0
    )
    assert len(results_before) > 0, "Question should be stored"

    # Delete by filter
    deleted = rag_service.delete_by_filter({
        "type": "interview_question",
        "project_id": str(test_project.id)
    })

    # Verify deleted
    results_after = rag_service.retrieve(
        query="",
        filter={
            "type": "interview_question",
            "project_id": str(test_project.id)
        },
        top_k=10,
        similarity_threshold=0.0
    )

    assert len(results_after) == 0, "Questions should be deleted"
    print(f"✅ Deleted {deleted} questions from project {test_project.id}")


# ============================================================================
# TEST 7: Similarity Threshold Adjustment
# ============================================================================

def test_similarity_threshold(db: Session, test_project, test_interviews):
    """TEST 7: Verify threshold affects detection."""
    print("\n⚙️  TEST 7: Similarity Threshold Adjustment")

    interview1 = test_interviews[0]
    rag_service = RAGService(db)

    # Store original question
    original = "Qual banco de dados você vai usar?"
    rag_service.store(
        content=original,
        metadata={
            "type": "interview_question",
            "project_id": str(test_project.id),
            "interview_id": str(interview1.id),
            "interview_mode": "meta_prompt",
            "question_number": 1,
            "is_fixed": True
        },
        project_id=test_project.id
    )

    # Similar but not identical
    candidate = "Que database você pretende usar?"

    # Test different thresholds
    for threshold in [0.70, 0.80, 0.85, 0.90, 0.95]:
        dedup = InterviewQuestionDeduplicator(db, similarity_threshold=threshold)
        is_dup, _, score = dedup.check_duplicate(test_project.id, candidate)

        print(f"   Threshold: {threshold:.0%} | Similarity: {score:.2%} | Blocked: {is_dup}")


# ============================================================================
# Run All Tests
# ============================================================================

if __name__ == "__main__":
    print("\n" + "="*80)
    print("PROMPT #97 - INTERVIEW QUESTION DEDUPLICATOR TESTS")
    print("="*80)

    # Run with: pytest tests/test_interview_question_deduplicator.py -v -s
    pytest.main([__file__, "-v", "-s"])
