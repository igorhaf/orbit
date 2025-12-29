"""
OrchestratorGenerator Service
Generates Python orchestrator classes from project analysis
"""

import logging
import ast
from pathlib import Path
from typing import Dict, Any, Optional
from jinja2 import Template

from app.config import settings

logger = logging.getLogger(__name__)


# Jinja2 template for orchestrator class
ORCHESTRATOR_TEMPLATE = """
from typing import Dict, Any, List
from app.orchestrators.base import StackOrchestrator


class {{ class_name }}(StackOrchestrator):
    \"\"\"
    Auto-generated orchestrator for {{ stack_description }}

    Generated from project analysis on {{ generated_date }}
    \"\"\"

    def __init__(self):
        super().__init__()
        self.stack_name = "{{ stack_key }}"
        self.description = "{{ stack_description }}"

    def get_stack_context(self) -> str:
        \"\"\"
        Returns context about this stack for AI task generation
        \"\"\"

        context = f\"\"\"
# Stack: {{ stack_name }}

## Technology Stack
{{ technology_stack }}

## Architecture Pattern
{{ architecture_pattern }}

## Coding Conventions

### Naming Conventions
{{ naming_conventions }}

### Code Style
{{ code_style }}

## Best Practices
{{ best_practices }}
\"\"\"

        return context.strip()

    def get_patterns(self) -> Dict[str, str]:
        \"\"\"
        Returns code templates with {Placeholders}
        \"\"\"

        return {{ patterns }}

    def get_conventions(self) -> Dict[str, Any]:
        \"\"\"
        Returns naming and code conventions
        \"\"\"

        return {{ conventions }}

    def validate_output(self, code: str, task: Dict) -> List[str]:
        \"\"\"
        Validates generated code against stack conventions
        \"\"\"

        issues = []

        # Basic syntax check
        if not code or len(code.strip()) == 0:
            issues.append("Generated code is empty")
            return issues

        # Stack-specific validation
        {{ validation_logic }}

        return issues
"""


class OrchestratorGenerator:
    """
    Generates Python orchestrator code from analysis results
    """

    def __init__(self):
        self.output_dir = Path(settings.generated_orchestrators_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    async def generate(
        self,
        analysis_data: Dict[str, Any],
        orchestrator_key: str
    ) -> Dict[str, Any]:
        """
        Generate orchestrator code from analysis

        Args:
            analysis_data: {
                "detected_stack": "laravel",
                "conventions": {...},
                "patterns": {...},
                ...
            }
            orchestrator_key: Unique key like "custom_laravel_v1"

        Returns:
            {
                "orchestrator_code": "...",
                "file_path": "...",
                "class_name": "CustomLaravelV1Orchestrator",
                "validation_passed": true
            }
        """

        logger.info(f"Generating orchestrator: {orchestrator_key}")

        # Extract data
        detected_stack = analysis_data.get("detected_stack", "unknown")
        conventions = analysis_data.get("conventions", {})
        patterns = analysis_data.get("patterns", {})
        confidence = analysis_data.get("confidence_score", 0)

        # Generate class name
        class_name = self._generate_class_name(orchestrator_key)

        # Build template variables
        template_vars = self._build_template_vars(
            class_name=class_name,
            stack_key=orchestrator_key,
            detected_stack=detected_stack,
            conventions=conventions,
            patterns=patterns,
            confidence=confidence
        )

        # Render template
        template = Template(ORCHESTRATOR_TEMPLATE)
        orchestrator_code = template.render(**template_vars)

        # Validate syntax
        validation_passed, error = self._validate_syntax(orchestrator_code)

        if not validation_passed:
            logger.error(f"Generated code has syntax errors: {error}")
            raise ValueError(f"Generated orchestrator has syntax errors: {error}")

        # Save to file
        file_path = self.output_dir / f"{orchestrator_key}.py"
        file_path.write_text(orchestrator_code, encoding="utf-8")

        logger.info(f"Generated orchestrator saved to {file_path}")

        return {
            "orchestrator_code": orchestrator_code,
            "file_path": str(file_path),
            "class_name": class_name,
            "validation_passed": validation_passed
        }

    def _generate_class_name(self, orchestrator_key: str) -> str:
        """
        Generate PascalCase class name from key

        Examples:
            "custom_laravel_v1" -> "CustomLaravelV1Orchestrator"
            "my-nextjs-app" -> "MyNextjsAppOrchestrator"
        """

        # Replace non-alphanumeric with spaces
        normalized = "".join(c if c.isalnum() else " " for c in orchestrator_key)

        # Convert to PascalCase
        parts = normalized.split()
        class_name = "".join(word.capitalize() for word in parts)

        # Add suffix if not present
        if not class_name.endswith("Orchestrator"):
            class_name += "Orchestrator"

        return class_name

    def _build_template_vars(
        self,
        class_name: str,
        stack_key: str,
        detected_stack: str,
        conventions: Dict,
        patterns: Dict,
        confidence: int
    ) -> Dict[str, Any]:
        """
        Build variables for Jinja2 template
        """

        from datetime import datetime

        # Build stack description
        stack_descriptions = {
            "laravel": "Laravel (PHP MVC Framework)",
            "nextjs": "Next.js (React Framework)",
            "django": "Django (Python Web Framework)",
            "rails": "Ruby on Rails",
            "express": "Express.js (Node.js Framework)",
            "fastapi": "FastAPI (Python Framework)",
        }

        stack_description = stack_descriptions.get(
            detected_stack,
            f"{detected_stack.title()} Application"
        )

        # Build technology stack section
        technology_stack = self._build_technology_stack(detected_stack)

        # Build architecture pattern
        architecture_pattern = conventions.get("architecture", {}).get("pattern", "Unknown")

        # Build naming conventions text
        naming_conventions = self._build_naming_conventions_text(
            conventions.get("naming", {})
        )

        # Build code style text
        code_style = self._build_code_style_text(
            conventions.get("code_style", {})
        )

        # Build best practices
        best_practices = self._build_best_practices(detected_stack)

        # Build validation logic
        validation_logic = self._build_validation_logic(detected_stack)

        return {
            "class_name": class_name,
            "stack_key": stack_key,
            "stack_name": detected_stack,
            "stack_description": stack_description,
            "generated_date": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
            "technology_stack": technology_stack,
            "architecture_pattern": architecture_pattern,
            "naming_conventions": naming_conventions,
            "code_style": code_style,
            "best_practices": best_practices,
            "patterns": repr(patterns),  # Python dict repr
            "conventions": repr(conventions),
            "validation_logic": validation_logic
        }

    def _build_technology_stack(self, detected_stack: str) -> str:
        """Build technology stack description"""

        descriptions = {
            "laravel": "- Backend: PHP (Laravel Framework)\n- Database: MySQL/PostgreSQL\n- ORM: Eloquent",
            "nextjs": "- Frontend: React/Next.js\n- Backend: Next.js API Routes\n- Styling: CSS Modules/Tailwind CSS",
            "django": "- Backend: Python (Django Framework)\n- Database: PostgreSQL/MySQL\n- ORM: Django ORM",
            "express": "- Backend: Node.js (Express.js)\n- Database: MongoDB/PostgreSQL\n- ORM/ODM: Mongoose/Sequelize",
            "fastapi": "- Backend: Python (FastAPI)\n- Database: PostgreSQL\n- ORM: SQLAlchemy",
        }

        return descriptions.get(detected_stack, f"- Stack: {detected_stack}")

    def _build_naming_conventions_text(self, naming: Dict) -> str:
        """Build naming conventions text"""

        lines = []
        for key, value in naming.items():
            if isinstance(value, dict):
                lines.append(f"- {key.title()}:")
                for sub_key, sub_value in value.items():
                    lines.append(f"  - {sub_key}: {sub_value}")
            else:
                lines.append(f"- {key.title()}: {value}")

        return "\n".join(lines) if lines else "- Standard conventions"

    def _build_code_style_text(self, code_style: Dict) -> str:
        """Build code style text"""

        lines = []
        for key, value in code_style.items():
            lines.append(f"- {key.replace('_', ' ').title()}: {value}")

        return "\n".join(lines) if lines else "- Standard style"

    def _build_best_practices(self, detected_stack: str) -> str:
        """Build best practices section"""

        practices = {
            "laravel": """- Follow PSR-12 coding standards
- Use Eloquent ORM for database operations
- Implement Repository pattern for complex queries
- Use Form Requests for validation
- Follow RESTful API conventions""",
            "nextjs": """- Use TypeScript for type safety
- Implement proper error boundaries
- Use React Hooks correctly
- Follow component composition patterns
- Optimize for performance (lazy loading, code splitting)""",
            "django": """- Follow PEP 8 style guide
- Use class-based views when appropriate
- Implement proper model relationships
- Use Django's built-in authentication
- Write comprehensive tests""",
        }

        return practices.get(detected_stack, "- Follow framework best practices\n- Write clean, maintainable code")

    def _build_validation_logic(self, detected_stack: str) -> str:
        """Build stack-specific validation logic"""

        validations = {
            "laravel": """# Check for PHP syntax
        if not code.strip().startswith("<?php"):
            if "class " in code or "function " in code:
                issues.append("PHP code should start with <?php tag")

        # Check namespace
        if "class " in code and "namespace " not in code:
            issues.append("Classes should have namespace declaration")""",

            "nextjs": """# Check for TypeScript/JSX
        if not any(keyword in code for keyword in ["export", "import", "function", "const"]):
            issues.append("Generated code should have proper exports")""",

            "django": """# Check for Python syntax
        if "class " in code and "def " not in code:
            issues.append("Django classes should have methods defined")""",
        }

        return validations.get(detected_stack, "# No specific validation for this stack\n        pass")

    def _validate_syntax(self, code: str) -> tuple[bool, Optional[str]]:
        """
        Validate Python syntax of generated orchestrator

        Returns:
            (is_valid, error_message)
        """

        try:
            ast.parse(code)
            return (True, None)
        except SyntaxError as e:
            return (False, str(e))
