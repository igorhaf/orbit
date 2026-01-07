"""
Spec Fetching and Formatting Module
PROMPT #70 - Refactor task_executor.py

This module handles:
- Selective spec fetching based on task keywords
- Spec formatting for AI execution context
- Token optimization through surgical spec selection

PROMPT #49 - Phase 4: Selective spec fetching for token reduction
"""

from typing import Dict, List, Any
from sqlalchemy.orm import Session
from app.models.task import Task
from app.models.project import Project
from app.services.spec_loader import get_spec_loader
import logging

logger = logging.getLogger(__name__)


class SpecFetcher:
    """
    Fetches and formats framework specifications for task execution.

    Features:
    - Selective spec fetching (only relevant specs, not all 47)
    - Keyword-based relevance detection
    - Token optimization (20-30% reduction vs fetching all specs)
    """

    # Backend specs mapping (Laravel example)
    BACKEND_KEYWORDS = {
        'controller': ['controller'],
        'model': ['model', 'eloquent'],
        'migration': ['migration', 'schema', 'table creation'],
        'routes_api': ['api route', 'api endpoint'],
        'routes_web': ['web route'],
        'request': ['request', 'validation', 'form request'],
        'resource': ['resource', 'api resource'],
        'middleware': ['middleware'],
        'policy': ['policy', 'authorization'],
        'job': ['job', 'queue'],
        'service': ['service'],
        'repository': ['repository'],
        'test': ['test']
    }

    # Frontend specs mapping (Next.js example)
    FRONTEND_KEYWORDS = {
        'page': ['page', 'route'],
        'layout': ['layout'],
        'api_route': ['api route', 'api handler'],
        'server_component': ['server component'],
        'client_component': ['client component', 'use client'],
        'hook': ['hook', 'use'],
        'context': ['context', 'provider'],
        'component': ['component']
    }

    # Database specs mapping
    DATABASE_KEYWORDS = {
        'table': ['table', 'schema', 'create table'],
        'query': ['query', 'select'],
        'function': ['function', 'procedure', 'trigger'],
        'view': ['view']
    }

    # CSS specs mapping
    CSS_KEYWORDS = {
        'component': ['style', 'styling', 'css'],
        'layout': ['layout', 'grid', 'flex'],
        'responsive': ['responsive', 'mobile']
    }

    def fetch_relevant_specs(
        self,
        task: Task,
        project: Project
    ) -> Dict[str, Any]:
        """
        Fetch only relevant specs for this specific task.

        PROMPT #49 - Phase 4: Selective spec fetching

        Unlike Phase 3 (which fetches all specs), this method is SELECTIVE:
        - Analyzes task title/description to determine needed specs
        - Only fetches specs directly relevant to this task
        - Example: Controller task → only controller spec (not all 22 Laravel specs)

        This achieves additional 20-30% token reduction during execution!

        Args:
            task: Task being executed
            project: Project with stack configuration

        Returns:
            Dictionary with relevant specs organized by category
        """
        specs = {
            'backend': [],
            'frontend': [],
            'database': [],
            'css': [],
            'ignore_patterns': set()
        }

        # Determine which spec types are needed based on task
        task_text = f"{task.title} {task.description}".lower()

        # PROMPT #54 - Token Optimization: Get SpecLoader once instead of 4 times
        spec_loader = get_spec_loader()

        # Fetch backend specs
        if project.stack_backend:
            needed_types = [
                spec_type for spec_type, keywords in self.BACKEND_KEYWORDS.items()
                if any(keyword in task_text for keyword in keywords)
            ]

            if needed_types:
                backend_specs = spec_loader.get_specs_by_types(
                    'backend',
                    project.stack_backend,
                    needed_types,
                    only_active=True
                )

                specs['backend'] = [
                    {
                        'type': s.spec_type,
                        'title': s.title,
                        'content': s.content,
                        'language': s.language
                    }
                    for s in backend_specs
                ]

                for s in backend_specs:
                    if s.ignore_patterns:
                        specs['ignore_patterns'].update(s.ignore_patterns)

        # Fetch frontend specs
        if project.stack_frontend:
            needed_types = [
                spec_type for spec_type, keywords in self.FRONTEND_KEYWORDS.items()
                if any(keyword in task_text for keyword in keywords)
            ]

            if needed_types:
                frontend_specs = spec_loader.get_specs_by_types(
                    'frontend',
                    project.stack_frontend,
                    needed_types,
                    only_active=True
                )

                specs['frontend'] = [
                    {
                        'type': s.spec_type,
                        'title': s.title,
                        'content': s.content,
                        'language': s.language
                    }
                    for s in frontend_specs
                ]

                for s in frontend_specs:
                    if s.ignore_patterns:
                        specs['ignore_patterns'].update(s.ignore_patterns)

        # Fetch database specs
        if project.stack_database:
            needed_types = [
                spec_type for spec_type, keywords in self.DATABASE_KEYWORDS.items()
                if any(keyword in task_text for keyword in keywords)
            ]

            if needed_types:
                db_specs = spec_loader.get_specs_by_types(
                    'database',
                    project.stack_database,
                    needed_types,
                    only_active=True
                )

                specs['database'] = [
                    {
                        'type': s.spec_type,
                        'title': s.title,
                        'content': s.content
                    }
                    for s in db_specs
                ]

                for s in db_specs:
                    if s.ignore_patterns:
                        specs['ignore_patterns'].update(s.ignore_patterns)

        # Fetch CSS specs
        if project.stack_css:
            needed_types = [
                spec_type for spec_type, keywords in self.CSS_KEYWORDS.items()
                if any(keyword in task_text for keyword in keywords)
            ]

            if needed_types:
                css_specs = spec_loader.get_specs_by_types(
                    'css',
                    project.stack_css,
                    needed_types,
                    only_active=True
                )

                specs['css'] = [
                    {
                        'type': s.spec_type,
                        'title': s.title,
                        'content': s.content
                    }
                    for s in css_specs
                ]

                for s in css_specs:
                    if s.ignore_patterns:
                        specs['ignore_patterns'].update(s.ignore_patterns)

        # Convert ignore patterns set to list
        specs['ignore_patterns'] = list(specs['ignore_patterns'])

        total_specs = len(specs['backend']) + len(specs['frontend']) + len(specs['database']) + len(specs['css'])
        logger.info(f"Fetched {total_specs} relevant specs for task: {task.title}")

        return specs

    def format_specs_for_execution(
        self,
        specs: Dict[str, Any],
        task: Task,
        project: Project
    ) -> str:
        """
        Format specs into concise context for AI during task execution.

        PROMPT #49 - Phase 4: Format specs for execution context

        This is more concise than Phase 3 because:
        - Only relevant specs are included (1-3 specs vs 47)
        - Instructions are execution-focused (write code, not plan tasks)
        - Context is surgical and specific to this task

        Args:
            specs: Dictionary with relevant specs
            task: Task being executed
            project: Project with stack configuration

        Returns:
            Formatted specs context string
        """
        if not any(specs[cat] for cat in ['backend', 'frontend', 'database', 'css']):
            return ""

        context = "\n" + "="*80 + "\n"
        context += "FRAMEWORK SPECIFICATIONS FOR THIS TASK\n"
        context += "="*80 + "\n\n"

        context += f"PROJECT: {project.name}\n"
        context += f"STACK: {project.stack_backend}, {project.stack_database}, "
        context += f"{project.stack_frontend}, {project.stack_css}\n"
        context += f"TASK: {task.title}\n\n"

        # Backend specs
        if specs['backend']:
            lang = specs['backend'][0].get('language', 'Backend').upper()
            context += f"{'-'*80}\n"
            context += f"{lang} SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in specs['backend']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # Frontend specs
        if specs['frontend']:
            context += f"{'-'*80}\n"
            context += f"FRONTEND SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in specs['frontend']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # Database specs
        if specs['database']:
            context += f"{'-'*80}\n"
            context += f"DATABASE SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in specs['database']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # CSS specs
        if specs['css']:
            context += f"{'-'*80}\n"
            context += f"CSS SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in specs['css']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # Ignore patterns
        if specs['ignore_patterns']:
            context += f"{'-'*80}\n"
            context += f"FILES/DIRECTORIES TO IGNORE\n"
            context += f"{'-'*80}\n"
            context += f"{', '.join(specs['ignore_patterns'])}\n\n"

        context += "="*80 + "\n"
        context += "END OF SPECIFICATIONS\n"
        context += "="*80 + "\n\n"

        context += """CRITICAL INSTRUCTIONS FOR CODE GENERATION:

1. **Follow the specifications above EXACTLY**
   - Use the exact structure, naming conventions, and patterns shown
   - Do not deviate from framework conventions
   - Maintain consistency with the spec patterns

2. **Focus on the business logic for THIS task**
   - Implement ONLY what the task description requires
   - Do not add extra features or "nice to haves"
   - Keep code focused and minimal

3. **Code quality requirements**
   - Write clean, readable, production-ready code
   - Follow the language/framework best practices shown in specs
   - Include proper error handling where appropriate
   - Add minimal comments only where logic isn't obvious

4. **Output format**
   - Provide complete, working code
   - Include all necessary imports/dependencies
   - Ensure code can be directly used without modifications

5. **Token efficiency**
   - No verbose explanations needed
   - No tutorial-style comments
   - Just clean, working code following the spec pattern

"""

        logger.info(f"Built specs execution context: {len(context)} characters")
        return context
