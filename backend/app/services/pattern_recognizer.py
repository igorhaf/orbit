"""
PatternRecognizer Service
Uses AI to extract code patterns and templates from project
"""

import logging
import json
from pathlib import Path
from typing import Dict, List, Any, Optional
from anthropic import Anthropic

from app.config import settings

logger = logging.getLogger(__name__)


class PatternRecognizer:
    """
    Recognizes code patterns and generates reusable templates
    """

    def __init__(self):
        self.anthropic_client = Anthropic(api_key=settings.anthropic_api_key)

    async def recognize(
        self,
        extraction_path: Path,
        detected_stack: Optional[str] = None
    ) -> Dict[str, str]:
        """
        Extract code patterns from project

        Strategy:
        1. Sample representative files by type (controllers, models, etc.)
        2. Send to Claude Haiku to extract patterns
        3. Return templates with {Placeholders}

        Args:
            extraction_path: Path to extracted project
            detected_stack: Detected stack (for targeted extraction)

        Returns:
            {
                "controller": "<?php\\nnamespace App\\Controllers;\\n...",
                "model": "<?php\\nnamespace App\\Models;\\n...",
                "service": "...",
                ...
            }
        """

        logger.info(f"Recognizing patterns from {extraction_path}")

        # Get pattern types based on stack
        pattern_types = self._get_pattern_types(detected_stack)

        patterns = {}

        for pattern_type, file_patterns in pattern_types.items():
            # Sample files for this pattern type
            sampled = self._sample_pattern_files(
                extraction_path,
                file_patterns,
                max_files=5
            )

            if not sampled:
                logger.debug(f"No files found for pattern: {pattern_type}")
                continue

            # Extract pattern using AI
            template = await self._extract_pattern_template(
                pattern_type,
                sampled,
                detected_stack
            )

            if template:
                patterns[pattern_type] = template

        logger.info(f"Recognized {len(patterns)} patterns")
        return patterns

    def _get_pattern_types(self, detected_stack: Optional[str]) -> Dict[str, List[str]]:
        """
        Get pattern types to extract based on stack
        """

        stack_patterns = {
            "laravel": {
                "controller": ["app/Http/Controllers/*.php"],
                "model": ["app/Models/*.php"],
                "migration": ["database/migrations/*.php"],
                "service": ["app/Services/*.php"],
                "repository": ["app/Repositories/*.php"]
            },
            "nextjs": {
                "page": ["app/**/*.tsx", "pages/**/*.tsx"],
                "component": ["components/**/*.tsx"],
                "api_route": ["app/api/**/*.ts", "pages/api/**/*.ts"],
                "layout": ["app/**/layout.tsx"]
            },
            "django": {
                "view": ["*/views.py"],
                "model": ["*/models.py"],
                "serializer": ["*/serializers.py"],
                "url_config": ["*/urls.py"]
            },
            "express": {
                "route": ["routes/**/*.js", "routes/**/*.ts"],
                "controller": ["controllers/**/*.js", "controllers/**/*.ts"],
                "model": ["models/**/*.js", "models/**/*.ts"],
                "middleware": ["middleware/**/*.js"]
            },
            "fastapi": {
                "router": ["app/routers/**/*.py", "routers/**/*.py"],
                "model": ["app/models/**/*.py", "models/**/*.py"],
                "schema": ["app/schemas/**/*.py", "schemas/**/*.py"],
                "service": ["app/services/**/*.py", "services/**/*.py"]
            }
        }

        return stack_patterns.get(detected_stack, {
            "main_file": ["**/*.py", "**/*.js", "**/*.ts", "**/*.php"]
        })

    def _sample_pattern_files(
        self,
        root_path: Path,
        file_patterns: List[str],
        max_files: int = 5
    ) -> List[Dict[str, str]]:
        """
        Sample files matching specific patterns
        """

        sampled = []

        for pattern in file_patterns:
            for file_path in root_path.glob(pattern):
                if file_path.is_file():
                    try:
                        # Skip very large files
                        size = file_path.stat().st_size
                        if size > 50 * 1024:
                            continue

                        content = file_path.read_text(encoding="utf-8", errors="ignore")

                        sampled.append({
                            "path": str(file_path.relative_to(root_path)),
                            "content": content[:8000]  # Limit to 8000 chars
                        })

                        if len(sampled) >= max_files:
                            return sampled

                    except Exception as e:
                        logger.debug(f"Skipping file {file_path}: {e}")
                        continue

        return sampled

    async def _extract_pattern_template(
        self,
        pattern_type: str,
        sampled_files: List[Dict[str, str]],
        detected_stack: Optional[str]
    ) -> Optional[str]:
        """
        Extract a template pattern using AI
        """

        if not sampled_files:
            return None

        # Build prompt
        prompt = self._build_pattern_prompt(pattern_type, sampled_files, detected_stack)

        try:
            response = self.anthropic_client.messages.create(
                model="claude-3-5-haiku-20241022",
                max_tokens=3000,
                temperature=0,
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )

            template = response.content[0].text.strip()

            # Extract code block if wrapped in ```
            if "```" in template:
                start = template.find("```")
                end = template.rfind("```")
                if start != -1 and end != -1 and end > start:
                    # Remove language identifier if present
                    code_block = template[start + 3:end].strip()
                    if code_block.startswith(("php", "typescript", "python", "javascript")):
                        code_block = "\n".join(code_block.split("\n")[1:])
                    template = code_block.strip()

            return template

        except Exception as e:
            logger.error(f"Failed to extract pattern for {pattern_type}: {e}")
            return None

    def _build_pattern_prompt(
        self,
        pattern_type: str,
        sampled_files: List[Dict[str, str]],
        detected_stack: Optional[str]
    ) -> str:
        """
        Build prompt for pattern extraction
        """

        files_text = "\n\n".join([
            f"Example {i+1}: {f['path']}\n```\n{f['content']}\n```"
            for i, f in enumerate(sampled_files[:5])
        ])

        stack_context = f"Stack: {detected_stack}\n" if detected_stack else ""

        prompt = f"""Analyze the following {pattern_type} files from a {detected_stack or 'software'} project and create a reusable code template.

{stack_context}

{files_text}

Your task:
1. Identify the common structure across these examples
2. Create a generic template by replacing specific values with {{Placeholders}}
3. Use descriptive placeholder names like {{EntityName}}, {{FieldName}}, {{table_name}}, etc.
4. Preserve the overall structure, imports, and code style

Placeholder naming conventions:
- {{EntityName}} - PascalCase for class names
- {{entity_name}} - snake_case for variables
- {{entityName}} - camelCase for methods
- {{TABLE_NAME}} - UPPER_SNAKE_CASE for constants
- {{description}} - descriptive text

Return ONLY the template code, no explanations. If the code has a language-specific syntax, include it exactly."""

        return prompt
