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
    prompter,  # Prompter Architecture - Phase 1
    jobs,  # PROMPT #65 - Async Job System
    knowledge,  # PROMPT #84 - RAG Phase 2: Knowledge Search
    discovery_queue,  # PROMPT #77 - Project-Specific Specs Discovery Queue
    contracts  # PROMPT #104 - Contracts (YAML Prompts Management)
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

    yield

    # Shutdown
    logger.info("Shutting down Orbit API...")


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

# Prompter (Prompt Template & Orchestration System - Prompter Architecture Phase 1)
app.include_router(
    prompter.router
)

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

# WebSocket (Real-time updates)
app.include_router(
    websocket.router,
    prefix=f"{API_V1_PREFIX}",
    tags=["WebSocket"]
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
