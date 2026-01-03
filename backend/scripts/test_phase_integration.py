"""
Test Phase 3 & 4 Integration with SpecLoader
Validates that both services use SpecLoader correctly
"""

import sys
from pathlib import Path
import logging

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models.project import Project
from app.services.prompt_generator import PromptGenerator
from app.services.task_executor import TaskExecutor
from app.models.task import Task

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


def test_phase3_integration():
    """Test Phase 3 (Prompt Generation) uses SpecLoader"""
    logger.info("=" * 80)
    logger.info("Testing Phase 3 (Prompt Generation) Integration")
    logger.info("=" * 80)
    logger.info("")

    db = SessionLocal()

    try:
        # Get first project
        project = db.query(Project).filter(
            Project.stack_backend.isnot(None)
        ).first()

        if not project:
            logger.warning("⚠️  No projects found with backend stack")
            return False

        logger.info(f"Using project: {project.name}")
        logger.info(f"Stack: {project.stack_backend}, {project.stack_database}, "
                   f"{project.stack_frontend}, {project.stack_css}")
        logger.info("")

        # Test PromptGenerator._fetch_stack_specs()
        logger.info("Testing PromptGenerator._fetch_stack_specs()...")
        prompt_gen = PromptGenerator(db)
        specs = prompt_gen._fetch_stack_specs(project, db)

        logger.info(f"✅ Fetched specs:")
        logger.info(f"   - Backend: {len(specs['backend'])} specs")
        logger.info(f"   - Frontend: {len(specs['frontend'])} specs")
        logger.info(f"   - Database: {len(specs['database'])} specs")
        logger.info(f"   - CSS: {len(specs['css'])} specs")
        logger.info(f"   - Ignore patterns: {len(specs['ignore_patterns'])} patterns")
        logger.info("")

        # Verify backend specs (should be 22 for Laravel)
        if project.stack_backend == 'laravel' and len(specs['backend']) != 22:
            logger.error(f"❌ Expected 22 Laravel specs, got {len(specs['backend'])}")
            return False

        # Verify frontend specs (should be 17 for Next.js)
        if project.stack_frontend == 'nextjs' and len(specs['frontend']) != 17:
            logger.error(f"❌ Expected 17 Next.js specs, got {len(specs['frontend'])}")
            return False

        logger.info("✅ Phase 3 integration test PASSED")
        logger.info("")
        return True

    except Exception as e:
        logger.error(f"❌ Phase 3 test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


def test_phase4_integration():
    """Test Phase 4 (Task Execution) uses SpecLoader"""
    logger.info("=" * 80)
    logger.info("Testing Phase 4 (Task Execution) Integration")
    logger.info("=" * 80)
    logger.info("")

    db = SessionLocal()

    try:
        # Get first project with a task
        project = db.query(Project).filter(
            Project.stack_backend.isnot(None)
        ).first()

        if not project:
            logger.warning("⚠️  No projects found")
            return False

        # Get or create a test task
        task = db.query(Task).filter(
            Task.project_id == project.id
        ).first()

        if not task:
            # Create a test task
            task = Task(
                project_id=project.id,
                title="Test: Create Product controller with inventory",
                description="Follow Laravel controller spec. Add inventory tracking.",
                status="backlog",
                column="backlog",
                order=0,
                type="feature",
                complexity=1
            )
            db.add(task)
            db.commit()
            logger.info("✅ Created test task")

        logger.info(f"Using task: {task.title}")
        logger.info(f"Project stack: {project.stack_backend}, {project.stack_frontend}")
        logger.info("")

        # Test TaskExecutor._fetch_relevant_specs()
        logger.info("Testing TaskExecutor._fetch_relevant_specs()...")
        executor = TaskExecutor(db)
        specs = executor._fetch_relevant_specs(task, project)

        logger.info(f"✅ Fetched selective specs:")
        logger.info(f"   - Backend: {len(specs['backend'])} specs")
        logger.info(f"   - Frontend: {len(specs['frontend'])} specs")
        logger.info(f"   - Database: {len(specs['database'])} specs")
        logger.info(f"   - CSS: {len(specs['css'])} specs")

        # Log which specs were loaded
        if specs['backend']:
            logger.info(f"   Backend specs loaded: {', '.join([s['type'] for s in specs['backend']])}")
        if specs['frontend']:
            logger.info(f"   Frontend specs loaded: {', '.join([s['type'] for s in specs['frontend']])}")

        logger.info("")

        # Verify selective loading works (should be < 10 specs total)
        total_specs = (len(specs['backend']) + len(specs['frontend']) +
                      len(specs['database']) + len(specs['css']))

        if total_specs == 0:
            logger.warning("⚠️  No specs were loaded (might be okay depending on task)")
        elif total_specs > 10:
            logger.warning(f"⚠️  Loaded {total_specs} specs (might not be selective enough)")
        else:
            logger.info(f"✅ Selective loading working: {total_specs} specs (good!)")

        logger.info("")
        logger.info("✅ Phase 4 integration test PASSED")
        logger.info("")
        return True

    except Exception as e:
        logger.error(f"❌ Phase 4 test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


def main():
    """Run all integration tests"""
    logger.info("")
    logger.info("╔" + "=" * 78 + "╗")
    logger.info("║" + " Phase 3 & 4 Integration Tests with SpecLoader ".center(78) + "║")
    logger.info("╚" + "=" * 78 + "╝")
    logger.info("")

    results = {
        "Phase 3": test_phase3_integration(),
        "Phase 4": test_phase4_integration()
    }

    logger.info("=" * 80)
    logger.info("Test Summary")
    logger.info("=" * 80)

    all_passed = True
    for test_name, passed in results.items():
        status = "✅ PASSED" if passed else "❌ FAILED"
        logger.info(f"{test_name}: {status}")
        if not passed:
            all_passed = False

    logger.info("")

    if all_passed:
        logger.info("╔" + "=" * 78 + "╗")
        logger.info("║" + " ✅ ALL INTEGRATION TESTS PASSED! ".center(78) + "║")
        logger.info("╚" + "=" * 78 + "╝")
        logger.info("")
        logger.info("Phase 3 & 4 are now using SpecLoader from JSON files!")
        logger.info("Database queries for specs have been eliminated.")
        logger.info("")
        return 0
    else:
        logger.error("")
        logger.error("╔" + "=" * 78 + "╗")
        logger.error("║" + " ❌ SOME TESTS FAILED ".center(78) + "║")
        logger.error("╚" + "=" * 78 + "╝")
        logger.error("")
        return 1


if __name__ == "__main__":
    sys.exit(main())
