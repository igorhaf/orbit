"""
FastAPI Main Application
Entry point for the Orbit Backend API
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from pydantic import ValidationError
import logging
import os

from app.config import settings
from app.database import init_db
from app.api.routes import (
    projects,
    ai_models,
    ai_executions,  # PROMPT #54 - AI Execution Logging
    cost_analytics,  # PROMPT #54.2 - Cost Analytics Dashboard
    cache_stats,  # PROMPT #54.3 - Cache Statistics and Monitoring
    ai_format,  # AI text formatting
    tasks,
    backlog_generation,  # JIRA Transformation - AI-powered backlog generation
    interviews,
    prompts,
    chat_sessions,
    commits,
    system_settings,
    orchestrators,
    project_analyses,
    specs,
    # PROMPT #164 - prompter removed, replaced by contracts architecture
    jobs,  # PROMPT #65 - Async Job System
    knowledge,  # PROMPT #84 - RAG Phase 2: Knowledge Search
    discovery_queue,  # PROMPT #77 - Project-Specific Specs Discovery Queue
    contracts,  # PROMPT #164 - Contracts Architecture (replaced prompter)
    git_commits,  # PROMPT #113 - Git Integration: Commits from project code_path
    console,  # PROMPT #168 - Real-time Console Logs
    ai_flow,  # PROMPT #122 - AI Flow Fallback Chains
    prompt_queue,  # PROMPT #215 - Prompt Orchestration Priority Queue
    continuous_rag,  # PROMPT #218 - Continuous RAG Evolution
)
from app.api import websocket
from app.api.exceptions import (
    integrity_error_handler,
    validation_error_handler,
    sqlalchemy_error_handler
)

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events
    """
    # Startup
    logger.info("Starting Orbit API...")
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Debug mode: {settings.debug}")

    # Initialize database
    try:
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")

    # Load custom orchestrators
    try:
        from app.database import get_db
        from app.services.orchestrator_manager import OrchestratorManager

        # Get a database session
        db_gen = get_db()
        db = next(db_gen)

        try:
            manager = OrchestratorManager(db)
            result = await manager.reload_all_custom_orchestrators()
            logger.info(
                f"Loaded {result['loaded']} custom orchestrators "
                f"({result['failed']} failed)"
            )
        finally:
            db.close()

    except Exception as e:
        logger.error(f"Failed to load custom orchestrators: {e}")

    # PROMPT #110 - RAG Evolution: Sync framework specs to RAG on startup
    try:
        from app.database import get_db
        from app.services.spec_rag_sync import SpecRAGSync

        # Get a database session
        db_gen = get_db()
        db = next(db_gen)

        try:
            sync_service = SpecRAGSync(db)
            results = sync_service.sync_all_framework_specs()
            logger.info(
                f"RAG Sync: {results['synced']} specs indexed, "
                f"{results['skipped']} already indexed, "
                f"{results['errors']} errors"
            )
        finally:
            db.close()

    except Exception as e:
        logger.warning(f"RAG sync skipped (non-fatal): {e}")

    # PROMPT #218 - Continuous RAG Evolution: Redis-based periodic scheduler
    rag_scheduler_task = None
    try:
        import asyncio
        import redis

        redis_host = settings.redis_host if hasattr(settings, 'redis_host') else os.environ.get('REDIS_HOST', 'redis')
        redis_port = int(settings.redis_port if hasattr(settings, 'redis_port') else os.environ.get('REDIS_PORT', '6379'))
        scan_interval = int(os.environ.get('RAG_SCAN_INTERVAL_SECONDS', '300'))

        redis_client = redis.Redis(host=redis_host, port=redis_port, db=0, decode_responses=True)

        async def _rag_scheduler_loop():
            """Redis-based scheduler: uses SETNX with TTL to ensure only one instance runs scans."""
            logger.info(f"🔄 Continuous RAG scheduler started (interval: {scan_interval}s)")
            while True:
                try:
                    await asyncio.sleep(scan_interval)

                    # Try to acquire lock - only one backend instance should schedule
                    lock_key = "orbit:rag:scheduler_lock"
                    acquired = redis_client.set(lock_key, "1", nx=True, ex=scan_interval - 10)
                    if not acquired:
                        continue  # Another instance is handling this cycle

                    # Get all projects with code_path
                    from app.database import get_db as get_db_gen
                    db_session = next(get_db_gen())
                    try:
                        from app.models.project import Project
                        from app.models.async_job import AsyncJob, JobStatus, JobType
                        from app.services.job_manager import JobManager

                        # PROMPT #222 - Only process projects whose initial scan completed
                        projects = db_session.query(Project).filter(
                            Project.code_path.isnot(None),
                            Project.code_path != "",
                            Project.initial_scan_complete == True,
                        ).all()

                        for project in projects:
                            # Check if scan already pending/running
                            existing = db_session.query(AsyncJob).filter(
                                AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
                                AsyncJob.project_id == project.id,
                                AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
                            ).first()

                            if existing:
                                continue

                            # Create background scan job
                            jm = JobManager(db_session)
                            job = jm.create_job(
                                job_type=JobType.RAG_CONTINUOUS_SCAN,
                                input_data={"project_id": str(project.id), "manual": False},
                                project_id=project.id,
                                notification_title=f"RAG Scan: {project.name or 'Project'}",
                                deep_link=f"/projects/{project.id}",
                            )
                            logger.info(f"📡 Scheduled RAG scan for project {project.name} (job {job.id})")

                            # Execute scan
                            try:
                                jm.start_job(job.id)
                                from app.services.continuous_rag_service import ContinuousRAGService
                                service = ContinuousRAGService(db_session)
                                result = await service.run_full_cycle(project.id)
                                # PROMPT #239: Living wiki enrichment after RAG cycle
                                try:
                                    from app.api.routes.projects import _enrich_context_from_rag
                                    await _enrich_context_from_rag(db_session, project.id)
                                except Exception as wiki_e:
                                    logger.warning(f"Wiki enrichment skipped: {wiki_e}")
                                jm.complete_job(job.id, result)
                            except Exception as e:
                                try:
                                    jm.fail_job(job.id, str(e))
                                except Exception:
                                    pass
                                logger.error(f"RAG scan failed for {project.name}: {e}")
                    finally:
                        db_session.close()

                except asyncio.CancelledError:
                    logger.info("RAG scheduler shutting down")
                    break
                except Exception as e:
                    logger.warning(f"RAG scheduler error (non-fatal): {e}")

        rag_scheduler_task = asyncio.create_task(_rag_scheduler_loop())
        logger.info("✅ Continuous RAG scheduler initialized")

    except Exception as e:
        logger.warning(f"Continuous RAG scheduler skipped (non-fatal): {e}")

    yield

    # Shutdown
    logger.info("Shutting down Orbit API...")

    # Cancel RAG scheduler
    if rag_scheduler_task and not rag_scheduler_task.done():
        rag_scheduler_task.cancel()
        try:
            import asyncio
            await asyncio.wait_for(rag_scheduler_task, timeout=5.0)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    description="Backend API for Orbit - Sistema de Orquestração de IA",
    version=settings.version,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register custom exception handlers
app.add_exception_handler(IntegrityError, integrity_error_handler)
app.add_exception_handler(ValidationError, validation_error_handler)
app.add_exception_handler(SQLAlchemyError, sqlalchemy_error_handler)


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Global exception handler for unhandled exceptions
    """
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "message": str(exc) if settings.debug else "An error occurred"
        }
    )


# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    """
    Health check endpoint
    Returns the status of the API
    """
    return {
        "status": "ok",
        "version": settings.version,
        "environment": settings.environment,
        "app_name": settings.app_name
    }


# Root endpoint
@app.get("/", tags=["Root"])
async def root():
    """
    Root endpoint
    Returns basic API information
    """
    return {
        "message": "Welcome to Orbit API",
        "version": settings.version,
        "docs": "/docs",
        "health": "/health"
    }


# API Routes
API_V1_PREFIX = "/api/v1"

# Projects
app.include_router(
    projects.router,
    prefix=f"{API_V1_PREFIX}/projects",
    tags=["Projects"]
)

# AI Models
app.include_router(
    ai_models.router,
    prefix=f"{API_V1_PREFIX}/ai-models",
    tags=["AI Models"]
)

# AI Flow Chains (PROMPT #122 - Visual Fallback Chain Configuration)
app.include_router(
    ai_flow.router,
    prefix=f"{API_V1_PREFIX}/ai-flow",
    tags=["AI Flow"]
)

# AI Executions (PROMPT #54 - AI Execution Logging)
app.include_router(
    ai_executions.router,
    prefix=f"{API_V1_PREFIX}/ai-executions",
    tags=["AI Executions"]
)

# Cost Analytics (PROMPT #54.2 - Cost Analytics Dashboard)
app.include_router(
    cost_analytics.router,
    prefix=f"{API_V1_PREFIX}/cost",
    tags=["Cost Analytics"]
)

# Cache Statistics (PROMPT #54.3 - Cache Activation and Monitoring)
app.include_router(
    cache_stats.router,
    prefix=f"{API_V1_PREFIX}",
    tags=["Cache"]
)

# AI Format (Text formatting)
app.include_router(
    ai_format.router,
    prefix=f"{API_V1_PREFIX}/ai",
    tags=["AI Format"]
)

# Tasks (Kanban)
app.include_router(
    tasks.router,
    prefix=f"{API_V1_PREFIX}/tasks",
    tags=["Tasks"]
)

# Backlog Generation (JIRA Transformation - AI-powered backlog generation)
app.include_router(
    backlog_generation.router,
    prefix=f"{API_V1_PREFIX}/backlog",
    tags=["Backlog Generation"]
)

# Interviews
app.include_router(
    interviews.router,
    prefix=f"{API_V1_PREFIX}/interviews",
    tags=["Interviews"]
)

# Prompts
app.include_router(
    prompts.router,
    prefix=f"{API_V1_PREFIX}/prompts",
    tags=["Prompts"]
)

# Chat Sessions
app.include_router(
    chat_sessions.router,
    prefix=f"{API_V1_PREFIX}/chat-sessions",
    tags=["Chat Sessions"]
)

# Commits
app.include_router(
    commits.router,
    prefix=f"{API_V1_PREFIX}/commits",
    tags=["Commits"]
)

# System Settings
app.include_router(
    system_settings.router,
    prefix=f"{API_V1_PREFIX}/settings",
    tags=["System Settings"]
)

# Orchestrators (Stack-specific orchestration)
app.include_router(
    orchestrators.router,
    prefix=f"{API_V1_PREFIX}",
    tags=["Orchestrators"]
)

# Project Analyses (Project Analyzer - Upload & Analyze Codebases)
app.include_router(
    project_analyses.router,
    prefix=f"{API_V1_PREFIX}/analyzers",
    tags=["Project Analyzers"]
)

# Specs (Dynamic Specifications System - PROMPT #47 Phase 2)
app.include_router(
    specs.router,
    prefix=f"{API_V1_PREFIX}/specs",
    tags=["Specs"]
)

# Contracts (YAML Prompts Management - PROMPT #104)
app.include_router(
    contracts.router,
    prefix=f"{API_V1_PREFIX}/contracts",
    tags=["Contracts"]
)

# PROMPT #164 - Prompter removed, replaced by Contracts Architecture
# All prompter functionality now available via /api/v1/contracts endpoints

# Jobs (Async Job Tracking - PROMPT #65)
app.include_router(
    jobs.router,
    prefix=f"{API_V1_PREFIX}/jobs",
    tags=["Jobs"]
)

# Knowledge Search (RAG Phase 2 - PROMPT #84)
app.include_router(
    knowledge.router,
    prefix=f"{API_V1_PREFIX}",
    tags=["Knowledge"]
)

# Discovery Queue (Project-Specific Specs - PROMPT #77)
app.include_router(
    discovery_queue.router,
    prefix=f"{API_V1_PREFIX}/discovery-queue",
    tags=["Discovery Queue"]
)

# Git Commits (Git Integration - PROMPT #113)
app.include_router(
    git_commits.router,
    prefix=f"{API_V1_PREFIX}",
    tags=["Git"]
)

# WebSocket (Real-time updates)
app.include_router(
    websocket.router,
    prefix=f"{API_V1_PREFIX}",
    tags=["WebSocket"]
)

# Console (Real-time Logs - PROMPT #168)
app.include_router(
    console.router,
    prefix=f"{API_V1_PREFIX}/console",
    tags=["Console"]
)

# Prompt Queue (PROMPT #215 - Orchestration Priority Queue)
app.include_router(
    prompt_queue.router,
    prefix=f"{API_V1_PREFIX}/projects",
    tags=["Prompt Queue"]
)

# Continuous RAG (PROMPT #218 - Continuous RAG Evolution)
app.include_router(
    continuous_rag.router,
    prefix=f"{API_V1_PREFIX}/projects",
    tags=["Continuous RAG"]
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
