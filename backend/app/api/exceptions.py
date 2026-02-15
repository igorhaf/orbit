"""
Custom exception handlers for the API.
Handles database and validation errors gracefully.
"""

from fastapi import Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from pydantic import ValidationError
import logging

logger = logging.getLogger(__name__)


async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    """
    Handle SQLAlchemy integrity errors (unique constraints, foreign keys, etc).
    """
    logger.error(f"Database integrity error: {exc}")

    error_msg = str(exc.orig) if hasattr(exc, 'orig') else str(exc)

    # Extract user-friendly messages for common errors
    if "duplicate key" in error_msg.lower():
        detail = "Um registro com este valor ja existe"
    elif "foreign key" in error_msg.lower():
        detail = "Registro referenciado nao existe"
    elif "not null" in error_msg.lower():
        detail = "Campo obrigatorio esta faltando"
    else:
        detail = "Violacao de restricao do banco de dados"

    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "detail": detail,
            "error_type": "integrity_error",
            "technical_details": error_msg if logger.level == logging.DEBUG else None
        }
    )


async def validation_error_handler(request: Request, exc: ValidationError) -> JSONResponse:
    """
    Handle Pydantic validation errors.
    """
    logger.warning(f"Validation error: {exc}")

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Erro de validacao",
            "error_type": "validation_error",
            "errors": exc.errors()
        }
    )


async def sqlalchemy_error_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    """
    Handle generic SQLAlchemy errors.
    """
    logger.error(f"Database error: {exc}")

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "Ocorreu um erro interno no banco de dados",
            "error_type": "database_error"
        }
    )
