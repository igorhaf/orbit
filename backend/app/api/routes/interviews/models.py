"""
Shared request models for interview endpoints.

PROMPT #261 - Refactor endpoints.py into sub-modules
"""

from pydantic import BaseModel
from app.models.interview import InterviewStatus


class MessageRequest(BaseModel):
    """Request model for adding a message to an interview."""
    message: dict


class StatusUpdateRequest(BaseModel):
    """Request model for updating interview status."""
    status: InterviewStatus
