"""
SystemSettings Model
Represents system-wide configuration settings
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class SystemSettings(Base):
    """
    SystemSettings model - Represents system-wide configuration

    Attributes:
        id: Unique identifier
        key: Unique setting key
        value: JSON value for the setting
        description: Description of the setting
        updated_at: Timestamp of last update
    """

    __tablename__ = "system_settings"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Basic fields
    key = Column(String(100), nullable=False, unique=True, index=True)
    value = Column(JSON, nullable=True)
    description = Column(Text, nullable=True)

    # Timestamp
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    def __repr__(self) -> str:
        return f"<SystemSettings(key='{self.key}')>"
