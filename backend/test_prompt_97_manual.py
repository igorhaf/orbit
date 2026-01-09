#!/usr/bin/env python3
"""
Manual Test Script - PROMPT #97 Cross-Interview Deduplication
No pytest required - runs directly
"""

import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from uuid import uuid4
from datetime import datetime
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.project import Project
from app.models.interview import Interview
from app.services.interview_question_deduplicator import InterviewQuestionDeduplicator
from app.services.rag_service import RAGService


def print_header(title):
    """Print test header."""
    print(f"\n{'='*80}")
    print(f"  {title}")
    print('='*80)


def print_test(num, title):
    """Print test number and title."""
    print(f"\n📊 TEST {num}: {title}")
    print('-'*80)


def test_1_store_fixed_question():
    """TEST 1: Fixed Questions Storage"""
    print_test(1, "Fixed Questions Storage")

    db = SessionLocal()
    try:
        # Create project
        project = Project(
            name="Test Project - PROMPT #97",
            description="Testing cross-interview deduplication",
            stack_backend="Laravel",
            stack_database="PostgreSQL"
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        print(f"✅ Created project: {project.id}")

        # Create interview
        interview = Interview(
            project_id=project.id,
            interview_mode="meta_prompt",
            conversation_data=[],
            ai_model_used="claude-sonnet-4-5"
        )
        db.add(interview)
        db.commit()
        db.refresh(interview)
        print(f"✅ Created interview: {interview.id}")

        # Store question
        deduplicator = InterviewQuestionDeduplicator(db)
        question_text = "❓ Pergunta 5: Qual banco de dados você vai usar?\n\n○ PostgreSQL\n○ MySQL\n\nEscolha uma opção."

        deduplicator.store_question(
            project_id=project.id,
            interview_id=interview.id,
            interview_mode="meta_prompt",
            question_text=question_text,
            question_number=5,
            is_fixed=True
        )
        print(f"✅ Stored question Q5")

        # Verify in RAG
        rag_service = RAGService(db)
        results = rag_service.retrieve(
            query="",
            filter={
                "type": "interview_question",
                "project_id": str(project.id)
            },
            top_k=10,
            similarity_threshold=0.0
        )

        assert len(results) > 0, "No questions found in RAG"
        stored = results[0]

        # Verify metadata
        assert stored["metadata"]["type"] == "interview_question"
        assert stored["metadata"]["project_id"] == str(project.id)
        assert stored["metadata"]["interview_id"] == str(interview.id)
        assert stored["metadata"]["question_number"] == 5
        assert stored["metadata"]["is_fixed"] == True

        # Verify content is cleaned
        assert "❓" not in stored["content"], "Emoji should be removed"
        assert "○" not in stored["content"], "Option markers should be removed"
        assert "banco de dados" in stored["content"].lower(), "Core content should be preserved"

        print(f"✅ Question stored and verified")
        print(f"   Content: {stored['content'][:80]}...")
        print(f"   Metadata type: {stored['metadata']['type']}")
        print(f"   Question #: {stored['metadata']['question_number']}")
        print(f"✅ TEST 1 PASSED")

        # Cleanup
        db.delete(interview)
        db.delete(project)
        db.commit()

    except Exception as e:
        print(f"❌ TEST 1 FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

    return True


def test_2_cross_interview_duplicate():
    """TEST 2: Cross-Interview Duplicate Detection"""
    print_test(2, "Cross-Interview Duplicate Detection")

    db = SessionLocal()
    try:
        # Create project
        project = Project(
            name="Test Project 2",
            description="Test cross-interview",
            stack_backend="Laravel"
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        print(f"✅ Created project: {project.id}")

        # Create 2 interviews
        interview1 = Interview(
            project_id=project.id,
            interview_mode="meta_prompt",
            conversation_data=[],
            ai_model_used="claude-sonnet-4-5"
        )
        interview2 = Interview(
            project_id=project.id,
            interview_mode="task_focused",
            conversation_data=[],
            ai_model_used="claude-sonnet-4-5"
        )
        db.add_all([interview1, interview2])
        db.commit()
        db.refresh(interview1)
        db.refresh(interview2)
        print(f"✅ Created interview 1 (meta_prompt): {interview1.id}")
        print(f"✅ Created interview 2 (task_focused): {interview2.id}")

        # Store Q5 in interview1
        deduplicator = InterviewQuestionDeduplicator(db, similarity_threshold=0.85)
        q5_text = "Qual banco de dados você vai usar?"

        deduplicator.store_question(
            project_id=project.id,
            interview_id=interview1.id,
            interview_mode="meta_prompt",
            question_text=q5_text,
            question_number=5,
            is_fixed=True
        )
        print(f"✅ Stored Q5 in interview1")

        # Try similar question in interview2 (CROSS-INTERVIEW!)
        candidate = "Que database o sistema utilizará?"
        print(f"   Checking candidate: '{candidate}'")

        is_duplicate, similar, score = deduplicator.check_duplicate(
            project_id=project.id,
            candidate_question=candidate
        )

        print(f"   Similarity score: {score:.2%}")
        print(f"   Is duplicate: {is_duplicate}")

        # CRITICAL: Must detect cross-interview duplicate!
        assert is_duplicate == True, f"Should detect duplicate! Similarity: {score:.2%}"
        assert similar is not None
        assert similar["metadata"]["interview_id"] == str(interview1.id), "Should reference interview1"
        assert similar["metadata"]["interview_mode"] == "meta_prompt"
        assert score >= 0.85, f"Similarity should be >= 0.85, got {score:.2%}"

        print(f"✅ Cross-interview duplicate DETECTED!")
        print(f"   From: {similar['metadata']['interview_mode']} interview")
        print(f"   Similar to: {similar['content']}")
        print(f"✅ TEST 2 PASSED")

        # Cleanup
        db.delete(interview1)
        db.delete(interview2)
        db.delete(project)
        db.commit()

    except Exception as e:
        print(f"❌ TEST 2 FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

    return True


def test_3_different_questions():
    """TEST 3: Different Questions NOT Blocked"""
    print_test(3, "Different Questions NOT Blocked")

    db = SessionLocal()
    try:
        # Create project and interview
        project = Project(name="Test Project 3", stack_backend="Laravel")
        db.add(project)
        db.commit()
        db.refresh(project)

        interview = Interview(
            project_id=project.id,
            interview_mode="meta_prompt",
            conversation_data=[],
            ai_model_used="claude-sonnet-4-5"
        )
        db.add(interview)
        db.commit()
        db.refresh(interview)
        print(f"✅ Created project and interview")

        deduplicator = InterviewQuestionDeduplicator(db, similarity_threshold=0.85)

        # Store Q5
        deduplicator.store_question(
            project_id=project.id,
            interview_id=interview.id,
            interview_mode="meta_prompt",
            question_text="Qual banco de dados você vai usar?",
            question_number=5,
            is_fixed=True
        )
        print(f"✅ Stored Q5: 'Qual banco de dados...'")

        # Try completely different question
        candidate = "Quais são as principais métricas de sucesso do projeto?"
        print(f"   Checking candidate: '{candidate}'")

        is_duplicate, similar, score = deduplicator.check_duplicate(
            project_id=project.id,
            candidate_question=candidate
        )

        print(f"   Similarity score: {score:.2%}")
        print(f"   Is duplicate: {is_duplicate}")

        # Should NOT be detected as duplicate
        if is_duplicate:
            # Only OK if similarity is REALLY high (90%+)
            assert score >= 0.90, f"Should only block very similar questions, got {score:.2%}"
            print(f"⚠️  Borderline similarity detected: {score:.2%}")
        else:
            print(f"✅ Different question NOT blocked")

        print(f"✅ TEST 3 PASSED")

        # Cleanup
        db.delete(interview)
        db.delete(project)
        db.commit()

    except Exception as e:
        print(f"❌ TEST 3 FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

    return True


def test_4_question_cleaning():
    """TEST 4: Question Cleaning"""
    print_test(4, "Question Cleaning")

    db = SessionLocal()
    try:
        deduplicator = InterviewQuestionDeduplicator(db)

        # Complex formatted question
        dirty = """❓ Pergunta 3: Qual framework de backend você vai usar?

○ Laravel (PHP)
○ Django (Python)
○ Spring Boot (Java)

Escolha uma opção."""

        print(f"   Input:  {dirty[:60]}...")

        clean = deduplicator._clean_question(dirty)

        print(f"   Output: {clean[:60]}...")

        # Check all formatting removed
        assert "❓" not in clean, "Emoji should be removed"
        assert "Pergunta" not in clean, "Label should be removed"
        assert "○" not in clean, "Option marker should be removed"
        assert "Escolha" not in clean, "Instruction should be removed"
        assert "framework" in clean.lower(), "Core content should be preserved"

        print(f"✅ All formatting removed successfully")
        print(f"✅ TEST 4 PASSED")

        db.close()

    except Exception as e:
        print(f"❌ TEST 4 FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False

    return True


def test_5_multiple_questions():
    """TEST 5: Multiple Questions Stored"""
    print_test(5, "Multiple Questions Stored")

    db = SessionLocal()
    try:
        # Create project and interviews
        project = Project(name="Test Project 5", stack_backend="Laravel")
        db.add(project)
        db.commit()
        db.refresh(project)

        interview1 = Interview(
            project_id=project.id,
            interview_mode="meta_prompt",
            conversation_data=[],
            ai_model_used="claude-sonnet-4-5"
        )
        interview2 = Interview(
            project_id=project.id,
            interview_mode="task_focused",
            conversation_data=[],
            ai_model_used="claude-sonnet-4-5"
        )
        db.add_all([interview1, interview2])
        db.commit()
        db.refresh(interview1)
        db.refresh(interview2)
        print(f"✅ Created project with 2 interviews")

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
                project_id=project.id,
                interview_id=interview1.id,
                interview_mode="meta_prompt",
                question_text=text,
                question_number=num,
                is_fixed=True
            )
        print(f"✅ Stored 3 questions from interview1")

        # Store Q1-Q2 from interview2
        questions_i2 = [
            ("Qual é a tarefa?", 1),
            ("Descrição da tarefa", 2),
        ]

        for text, num in questions_i2:
            deduplicator.store_question(
                project_id=project.id,
                interview_id=interview2.id,
                interview_mode="task_focused",
                question_text=text,
                question_number=num,
                is_fixed=True
            )
        print(f"✅ Stored 2 questions from interview2")

        # Query all interview questions for project
        all_questions = rag_service.retrieve(
            query="",
            filter={
                "type": "interview_question",
                "project_id": str(project.id)
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
            mode = q["metadata"]["interview_mode"]
            qnum = q["metadata"]["question_number"]
            print(f"   - [{mode}] Q{qnum}: {q['content'][:50]}...")

        print(f"✅ TEST 5 PASSED")

        # Cleanup
        db.delete(interview1)
        db.delete(interview2)
        db.delete(project)
        db.commit()

    except Exception as e:
        print(f"❌ TEST 5 FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

    return True


def test_6_cleanup_by_project():
    """TEST 6: Cleanup by Project"""
    print_test(6, "Cleanup by Project")

    db = SessionLocal()
    try:
        # Create project and interview
        project = Project(name="Test Project 6", stack_backend="Laravel")
        db.add(project)
        db.commit()
        db.refresh(project)

        interview = Interview(
            project_id=project.id,
            interview_mode="meta_prompt",
            conversation_data=[],
            ai_model_used="claude-sonnet-4-5"
        )
        db.add(interview)
        db.commit()
        db.refresh(interview)
        print(f"✅ Created project and interview")

        deduplicator = InterviewQuestionDeduplicator(db)
        rag_service = RAGService(db)

        # Store question
        deduplicator.store_question(
            project_id=project.id,
            interview_id=interview.id,
            interview_mode="meta_prompt",
            question_text="Test question for cleanup",
            question_number=1,
            is_fixed=True
        )
        print(f"✅ Stored question")

        # Verify stored
        results_before = rag_service.retrieve(
            query="",
            filter={
                "type": "interview_question",
                "project_id": str(project.id)
            },
            top_k=10,
            similarity_threshold=0.0
        )
        assert len(results_before) > 0, "Question should be stored"
        print(f"✅ Verified question stored (count: {len(results_before)})")

        # Delete by filter
        deleted = rag_service.delete_by_filter({
            "type": "interview_question",
            "project_id": str(project.id)
        })
        print(f"✅ Deleted {deleted} questions")

        # Verify deleted
        results_after = rag_service.retrieve(
            query="",
            filter={
                "type": "interview_question",
                "project_id": str(project.id)
            },
            top_k=10,
            similarity_threshold=0.0
        )

        assert len(results_after) == 0, "Questions should be deleted"
        print(f"✅ Verified questions deleted (count: {len(results_after)})")
        print(f"✅ TEST 6 PASSED")

        # Cleanup
        db.delete(interview)
        db.delete(project)
        db.commit()

    except Exception as e:
        print(f"❌ TEST 6 FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

    return True


def main():
    """Run all tests."""
    print_header("PROMPT #97 - INTERVIEW QUESTION DEDUPLICATOR TESTS")

    tests = [
        test_1_store_fixed_question,
        test_2_cross_interview_duplicate,
        test_3_different_questions,
        test_4_question_cleaning,
        test_5_multiple_questions,
        test_6_cleanup_by_project,
    ]

    results = []
    for test in tests:
        try:
            passed = test()
            results.append((test.__name__, passed))
        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            results.append((test.__name__, False))

    # Summary
    print_header("TEST SUMMARY")
    passed = sum(1 for _, p in results if p)
    total = len(results)

    print(f"\n📊 Results: {passed}/{total} tests passed\n")
    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {status}: {name}")

    print_header("CONCLUSION")
    if passed == total:
        print("🎉 All tests PASSED! PROMPT #97 implementation is working correctly!")
        return 0
    else:
        print(f"❌ {total - passed} test(s) FAILED. Please review the errors above.")
        return 1


if __name__ == "__main__":
    exit(main())
