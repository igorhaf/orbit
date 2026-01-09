"""
Pattern Discovery Schemas (PROMPT #62 - Week 1 Day 2-4)
Pydantic models for AI-powered pattern discovery from ANY codebase
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field


class DiscoveredPattern(BaseModel):
    """
    Represents a pattern discovered by AI from codebase analysis

    AI analyzes code samples and identifies repeating structures,
    extracting templates with placeholders for variable parts.
    """
    # Pattern identification
    category: str = Field(..., description="Pattern category (e.g., 'api', 'model', 'service', 'custom')")
    name: str = Field(..., description="Framework or project name (e.g., 'laravel', 'meu-projeto')")
    spec_type: str = Field(..., description="Specific type (e.g., 'rest_api', 'database_model')")

    # Pattern description
    title: str = Field(..., description="Human-readable title")
    description: str = Field(..., description="What this pattern represents")
    template_content: str = Field(..., description="Code template with {Placeholders}")
    language: str = Field(..., description="Programming language")

    # AI decision metadata
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="AI confidence (0.0 to 1.0)")
    reasoning: str = Field(..., description="Why AI identified this pattern")
    key_characteristics: List[str] = Field(default_factory=list, description="Key features of this pattern")
    is_framework_worthy: bool = Field(..., description="AI decision: framework vs project-only")

    # Discovery context
    occurrences: int = Field(default=0, description="Number of times pattern appears in codebase")
    sample_files: List[str] = Field(default_factory=list, description="Sample file paths analyzed")
    discovery_method: str = Field(default="ai_pattern_recognition", description="Method used to discover")

    class Config:
        json_schema_extra = {
            "example": {
                "category": "api",
                "name": "meu-projeto",
                "spec_type": "rest_endpoint",
                "title": "REST API Endpoint Pattern",
                "description": "Standard REST API endpoint with authentication and validation",
                "template_content": "<?php\n\nclass {ClassName}Controller {\n    public function {methodName}() {\n        // Implementation\n    }\n}\n",
                "language": "php",
                "confidence_score": 0.87,
                "reasoning": "Pattern appears in 12 controller files with consistent structure",
                "key_characteristics": ["uses authentication", "includes validation", "returns JSON"],
                "is_framework_worthy": False,
                "occurrences": 12,
                "sample_files": ["app/Http/Controllers/UserController.php", "app/Http/Controllers/ProductController.php"],
                "discovery_method": "ai_pattern_recognition"
            }
        }


class PatternDiscoveryRequest(BaseModel):
    """Request to discover patterns from a project codebase"""
    project_id: UUID = Field(..., description="Project UUID")
    project_path: Optional[str] = Field(None, description="Override path (uses project.code_path if None)")
    max_patterns: int = Field(default=20, ge=1, le=50, description="Maximum patterns to discover")
    min_occurrences: int = Field(default=3, ge=1, le=10, description="Minimum pattern occurrences required")
    confidence_threshold: float = Field(default=0.6, ge=0.0, le=1.0, description="Minimum AI confidence score")

    class Config:
        json_schema_extra = {
            "example": {
                "project_id": "123e4567-e89b-12d3-a456-426614174000",
                "max_patterns": 20,
                "min_occurrences": 3,
                "confidence_threshold": 0.7
            }
        }


class PatternDiscoveryResponse(BaseModel):
    """Response with discovered patterns from codebase analysis"""
    project_id: UUID = Field(..., description="Project UUID")
    discovered_at: datetime = Field(..., description="When patterns were discovered")
    patterns: List[DiscoveredPattern] = Field(..., description="List of discovered patterns")
    total_files_analyzed: int = Field(..., description="Number of files analyzed")
    ai_model_used: str = Field(..., description="AI model used for discovery")
    analysis_duration_ms: Optional[int] = Field(None, description="Time taken for analysis in milliseconds")

    class Config:
        json_schema_extra = {
            "example": {
                "project_id": "123e4567-e89b-12d3-a456-426614174000",
                "discovered_at": "2026-01-03T14:30:00Z",
                "patterns": [],
                "total_files_analyzed": 142,
                "ai_model_used": "anthropic/claude-sonnet-4",
                "analysis_duration_ms": 45230
            }
        }


class SavePatternRequest(BaseModel):
    """Request to save a discovered pattern as a spec"""
    project_id: UUID = Field(..., description="Project UUID")
    pattern: DiscoveredPattern = Field(..., description="Pattern to save")

    class Config:
        json_schema_extra = {
            "example": {
                "project_id": "123e4567-e89b-12d3-a456-426614174000",
                "pattern": {
                    "category": "api",
                    "name": "meu-projeto",
                    "spec_type": "rest_endpoint",
                    "title": "REST API Endpoint",
                    "description": "Standard REST endpoint pattern",
                    "template_content": "...",
                    "language": "php",
                    "confidence_score": 0.87,
                    "reasoning": "Pattern found in 12 files",
                    "key_characteristics": [],
                    "is_framework_worthy": False,
                    "occurrences": 12,
                    "sample_files": []
                }
            }
        }


class FileGroup(BaseModel):
    """Group of similar files for pattern analysis"""
    group_key: str = Field(..., description="Identifier for this group (e.g., '.php:controller')")
    file_paths: List[str] = Field(..., description="File paths in this group")
    file_count: int = Field(..., description="Number of files in group")
    extension: str = Field(..., description="File extension")
    estimated_category: str = Field(..., description="Estimated category based on file structure")
