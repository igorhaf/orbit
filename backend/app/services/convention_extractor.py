"""
ConventionExtractor Service
Uses AI to extract naming conventions and code style from project samples
"""

import logging
import json
from pathlib import Path
from typing import Dict, List, Any, Optional
from anthropic import Anthropic

from app.config import settings

logger = logging.getLogger(__name__)


class ConventionExtractor:
    """
    Extracts coding conventions from project using AI analysis
    """

    def __init__(self):
        self.anthropic_client = Anthropic(api_key=settings.anthropic_api_key)

    async def extract(
        self,
        extraction_path: Path,
        detected_stack: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Extract conventions from project

        Strategy:
        1. Sample ~10 representative files
        2. Send to Claude Haiku with focused prompt
        3. Parse and return conventions

        Args:
            extraction_path: Path to extracted project
            detected_stack: Detected stack (for targeted file selection)

        Returns:
            {
                "naming": {
                    "classes": "PascalCase",
                    "methods": "camelCase",
                    "variables": "camelCase",
                    "files": "kebab-case",
                    "database": {"tables": "snake_case_plural", "columns": "snake_case"}
                },
                "architecture": {
                    "pattern": "MVC",
                    "uses_repositories": true,
                    "uses_services": true
                },
                "code_style": {
                    "indentation": "4 spaces",
                    "quotes": "double",
                    "semicolons": true
                }
            }
        """

        logger.info(f"Extracting conventions from {extraction_path}")

        # Sample files
        sampled_files = self._sample_files(extraction_path, detected_stack)

        if not sampled_files:
            logger.warning("No files to sample for convention extraction")
            return self._get_default_conventions(detected_stack)

        # Build prompt
        prompt = self._build_extraction_prompt(sampled_files, detected_stack)

        # Call AI
        try:
            response = self.anthropic_client.messages.create(
                model="claude-3-5-haiku-20241022",  # Cheap and fast
                max_tokens=2000,
                temperature=0,
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )

            # Parse response
            result_text = response.content[0].text
            conventions = self._parse_conventions_response(result_text)

            logger.info(f"Extracted conventions: {conventions}")
            return conventions

        except Exception as e:
            logger.error(f"Failed to extract conventions with AI: {e}")
            return self._get_default_conventions(detected_stack)

    def _sample_files(
        self,
        root_path: Path,
        detected_stack: Optional[str],
        max_files: int = 10
    ) -> List[Dict[str, str]]:
        """
        Sample representative files from project

        Strategy:
        - Prioritize controllers, models, services
        - Include a mix of file types
        - Limit file size to avoid huge tokens
        """

        priority_patterns = {
            "laravel": [
                "app/Http/Controllers/*.php",
                "app/Models/*.php",
                "app/Services/*.php",
                "routes/*.php"
            ],
            "nextjs": [
                "app/**/*.tsx",
                "app/**/*.ts",
                "pages/**/*.tsx",
                "pages/**/*.ts",
                "components/**/*.tsx",
                "lib/**/*.ts"
            ],
            "django": [
                "*/views.py",
                "*/models.py",
                "*/serializers.py",
                "*/urls.py"
            ],
            "express": [
                "src/**/*.js",
                "src/**/*.ts",
                "routes/**/*.js",
                "controllers/**/*.js"
            ],
            "fastapi": [
                "app/**/*.py",
                "routers/**/*.py",
                "models/**/*.py",
                "services/**/*.py"
            ]
        }

        patterns = priority_patterns.get(detected_stack, ["**/*.py", "**/*.js", "**/*.ts", "**/*.php"])

        sampled = []

        for pattern in patterns:
            for file_path in root_path.glob(pattern):
                if file_path.is_file():
                    # Skip very large files (>50KB)
                    try:
                        size = file_path.stat().st_size
                        if size > 50 * 1024:
                            continue

                        content = file_path.read_text(encoding="utf-8", errors="ignore")

                        sampled.append({
                            "path": str(file_path.relative_to(root_path)),
                            "content": content[:5000]  # Limit to 5000 chars
                        })

                        if len(sampled) >= max_files:
                            return sampled

                    except Exception as e:
                        logger.debug(f"Skipping file {file_path}: {e}")
                        continue

        return sampled

    def _build_extraction_prompt(
        self,
        sampled_files: List[Dict[str, str]],
        detected_stack: Optional[str]
    ) -> str:
        """
        Build prompt for AI convention extraction
        """

        files_text = "\n\n".join([
            f"File: {f['path']}\n```\n{f['content']}\n```"
            for f in sampled_files[:10]
        ])

        stack_context = f"Detected stack: {detected_stack}\n" if detected_stack else ""

        prompt = f"""Analyze the following code samples from a {detected_stack or 'software'} project and extract the coding conventions used.

{stack_context}

{files_text}

Please analyze the code and return a JSON object with the following structure:

{{
  "naming": {{
    "classes": "PascalCase|snake_case|...",
    "methods": "camelCase|snake_case|...",
    "variables": "camelCase|snake_case|...",
    "constants": "UPPER_SNAKE_CASE|...",
    "files": "kebab-case|snake_case|PascalCase|...",
    "database": {{"tables": "snake_case|...", "columns": "snake_case|..."}}
  }},
  "architecture": {{
    "pattern": "MVC|Repository|Service Layer|...",
    "uses_repositories": true|false,
    "uses_services": true|false,
    "layered_architecture": true|false
  }},
  "code_style": {{
    "indentation": "2 spaces|4 spaces|tabs",
    "quotes": "single|double",
    "semicolons": true|false,
    "trailing_commas": true|false
  }}
}}

Return ONLY the JSON object, no explanations."""

        return prompt

    def _parse_conventions_response(self, response_text: str) -> Dict[str, Any]:
        """
        Parse AI response to extract conventions
        """

        try:
            # Try to find JSON in response
            start_idx = response_text.find("{")
            end_idx = response_text.rfind("}") + 1

            if start_idx == -1 or end_idx == 0:
                raise ValueError("No JSON found in response")

            json_str = response_text[start_idx:end_idx]
            conventions = json.loads(json_str)

            return conventions

        except Exception as e:
            logger.error(f"Failed to parse AI response: {e}")
            logger.debug(f"Response was: {response_text}")
            return {
                "naming": {},
                "architecture": {},
                "code_style": {}
            }

    def _get_default_conventions(self, detected_stack: Optional[str]) -> Dict[str, Any]:
        """
        Return default conventions based on stack
        """

        defaults = {
            "laravel": {
                "naming": {
                    "classes": "PascalCase",
                    "methods": "camelCase",
                    "variables": "camelCase",
                    "files": "PascalCase",
                    "database": {"tables": "snake_case_plural", "columns": "snake_case"}
                },
                "architecture": {
                    "pattern": "MVC",
                    "uses_repositories": False,
                    "uses_services": False
                },
                "code_style": {
                    "indentation": "4 spaces",
                    "quotes": "single",
                    "semicolons": True
                }
            },
            "nextjs": {
                "naming": {
                    "classes": "PascalCase",
                    "methods": "camelCase",
                    "variables": "camelCase",
                    "files": "kebab-case",
                    "components": "PascalCase"
                },
                "architecture": {
                    "pattern": "Component-based",
                    "uses_hooks": True,
                    "uses_context": True
                },
                "code_style": {
                    "indentation": "2 spaces",
                    "quotes": "double",
                    "semicolons": True
                }
            },
            "django": {
                "naming": {
                    "classes": "PascalCase",
                    "methods": "snake_case",
                    "variables": "snake_case",
                    "files": "snake_case",
                    "database": {"tables": "app_modelname", "columns": "snake_case"}
                },
                "architecture": {
                    "pattern": "MVT",
                    "uses_class_based_views": True
                },
                "code_style": {
                    "indentation": "4 spaces",
                    "quotes": "double",
                    "max_line_length": 79
                }
            }
        }

        return defaults.get(detected_stack, {
            "naming": {
                "classes": "PascalCase",
                "methods": "camelCase",
                "variables": "camelCase"
            },
            "architecture": {},
            "code_style": {}
        })
