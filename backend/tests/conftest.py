"""
Pytest configuration and fixtures for backend tests
"""

import sys
import os
from pathlib import Path

# Add app directory to Python path
app_dir = Path(__file__).parent.parent
sys.path.insert(0, str(app_dir))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from app.database import Base
from app.config import settings


@pytest.fixture(scope="session")
def db_engine():
    """Create a test database engine."""
    # Use test database
    test_db_url = settings.database_url.replace("orbit_db", "orbit_test_db")

    engine = create_engine(
        test_db_url,
        connect_args={"check_same_thread": False} if "sqlite" in test_db_url else {}
    )

    # Create all tables
    Base.metadata.create_all(bind=engine)

    yield engine

    # Note: Skip drop_all() due to circular foreign key dependencies
    # This is OK for tests as they use a separate test database


@pytest.fixture(scope="session")
def session_factory(db_engine):
    """Create a session factory."""
    return sessionmaker(autocommit=False, autoflush=False, bind=db_engine)


@pytest.fixture
def db(session_factory) -> Session:
    """Provide a database session for tests."""
    session = session_factory()

    try:
        yield session
    finally:
        session.rollback()
        session.close()
