"""
Project-Specific Spec Fetching and Formatting Module
Project Specs via RAG Discovery

This module replaces the JSON-based SpecFetcher with database-based fetching.
Specs are now discovered per-project via AI pattern discovery and stored in the database.

Features:
- Fetches project-specific specs from database (not generic JSON files)
- Uses keyword matching from discovery_metadata
- Falls back to RAG semantic search when needed
- Adds projects to discovery_queue when no specs found
"""

from typing import Dict, List, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from uuid import UUID, uuid4
import logging

from app.models.task import Task
from app.models.project import Project
from app.models.spec import Spec, SpecScope
from app.models.discovery_queue import DiscoveryQueue, DiscoveryQueueStatus

logger = logging.getLogger(__name__)


class ProjectSpecFetcher:
    """
    Fetches and formats project-specific specs for task execution.

    Unlike the old SpecFetcher that loaded generic JSON specs,
    this version fetches discovered project-specific patterns from the database.

    Features:
    - Database-based spec loading (project_id scoped)
    - Keyword matching using discovery_metadata.key_characteristics
    - RAG semantic search fallback
    - Discovery queue integration (adds projects without specs to queue)
    """

    def __init__(self, db: Session):
        """
        Initialize ProjectSpecFetcher.

        Args:
            db: Database session
        """
        self.db = db
        self._rag_service = None  # Lazy load to avoid circular imports

    @property
    def rag_service(self):
        """Lazy load RAG service to avoid circular imports"""
        if self._rag_service is None:
            from app.services.rag_service import RAGService
            self._rag_service = RAGService(self.db)
        return self._rag_service

    def fetch_relevant_specs(
        self,
        task: Task,
        project: Project
    ) -> Dict[str, Any]:
        """
        Fetch only relevant specs for this specific task.

        Process:
        1. Query specs from database for this project
        2. If no specs found, add to discovery_queue and return empty
        3. Filter by keyword matching (from discovery_metadata)
        4. If no keyword matches, use RAG semantic search
        5. Format and return relevant specs

        Args:
            task: Task being executed
            project: Project with stack configuration

        Returns:
            Dictionary with relevant specs organized by category
        """
        specs = {
            'patterns': [],
            'ignore_patterns': set()
        }

        # Step 1: Query all active specs for this project
        project_specs = self.db.query(Spec).filter(
            Spec.project_id == project.id,
            Spec.scope == SpecScope.PROJECT,
            Spec.is_active == True
        ).all()

        # Step 2: If no specs, add to discovery queue
        if not project_specs:
            logger.info(f"No specs found for project {project.name}, adding to discovery queue")
            self._add_to_discovery_queue(project, task, "task_execution_without_specs")
            return specs

        # Step 3: Filter by keyword matching
        task_context = f"{task.title} {task.description or ''}".lower()
        relevant_specs = self._filter_by_keywords(project_specs, task_context)

        # Step 4: If no keyword matches, try RAG semantic search
        if not relevant_specs:
            logger.info(f"No keyword matches, using RAG semantic search")
            relevant_specs = self._filter_by_rag(project_specs, task_context, project.id)

        # Step 5: If still no matches, use all specs (better than nothing)
        if not relevant_specs:
            logger.info(f"No matches found, using all {len(project_specs)} project specs")
            relevant_specs = project_specs

        # Format specs
        for spec in relevant_specs:
            specs['patterns'].append({
                'id': str(spec.id),
                'category': spec.category,
                'name': spec.name,
                'type': spec.spec_type,
                'title': spec.title,
                'description': spec.description,
                'content': spec.content,
                'language': spec.language,
                'confidence': spec.discovery_metadata.get('confidence_score', 0) if spec.discovery_metadata else 0
            })

            # Collect ignore patterns
            if spec.ignore_patterns:
                specs['ignore_patterns'].update(spec.ignore_patterns)

        # Convert set to list
        specs['ignore_patterns'] = list(specs['ignore_patterns'])

        logger.info(f"Fetched {len(specs['patterns'])} relevant specs for task: {task.title}")

        return specs

    def _filter_by_keywords(
        self,
        specs: List[Spec],
        task_context: str
    ) -> List[Spec]:
        """
        Filter specs by keyword matching from discovery_metadata.

        Args:
            specs: List of Spec objects to filter
            task_context: Lowercased task title + description

        Returns:
            List of relevant Spec objects
        """
        relevant = []

        for spec in specs:
            # Check key_characteristics from discovery_metadata
            if spec.discovery_metadata:
                keywords = spec.discovery_metadata.get('key_characteristics', [])
                if any(kw.lower() in task_context for kw in keywords):
                    relevant.append(spec)
                    continue

            # Also check spec_type and category in task context
            if spec.spec_type and spec.spec_type.lower() in task_context:
                relevant.append(spec)
            elif spec.category and spec.category.lower() in task_context:
                relevant.append(spec)

        return relevant

    def _filter_by_rag(
        self,
        specs: List[Spec],
        task_context: str,
        project_id: UUID
    ) -> List[Spec]:
        """
        Filter specs using RAG semantic search.

        Args:
            specs: List of Spec objects to filter from
            task_context: Task title + description for search
            project_id: Project UUID for RAG scoping

        Returns:
            List of relevant Spec objects
        """
        try:
            # Search in RAG
            rag_results = self.rag_service.search(
                query=task_context,
                project_id=project_id,
                top_k=5,
                similarity_threshold=0.5
            )

            if not rag_results:
                return []

            # Filter to only spec-type results
            relevant_spec_ids = set()
            for result in rag_results:
                metadata = result.get('metadata', {})
                # Check if this is a project_spec type
                if metadata.get('type') == 'project_spec':
                    spec_id = metadata.get('spec_id')
                    if spec_id:
                        relevant_spec_ids.add(spec_id)

            # Match with our specs
            if not relevant_spec_ids:
                return []

            spec_map = {str(s.id): s for s in specs}
            return [spec_map[sid] for sid in relevant_spec_ids if sid in spec_map]

        except Exception as e:
            logger.warning(f"RAG search failed: {e}")
            return []

    def _add_to_discovery_queue(
        self,
        project: Project,
        task: Optional[Task],
        reason: str
    ) -> None:
        """
        Add project to discovery queue if not already present.

        Args:
            project: Project to add
            task: Task that triggered this (optional)
            reason: Reason for adding to queue
        """
        try:
            # Check if already in queue with pending status
            existing = self.db.query(DiscoveryQueue).filter(
                DiscoveryQueue.project_id == project.id,
                DiscoveryQueue.status == DiscoveryQueueStatus.PENDING
            ).first()

            if existing:
                logger.debug(f"Project {project.name} already in discovery queue")
                return

            # Add to queue
            queue_item = DiscoveryQueue(
                id=uuid4(),
                project_id=project.id,
                task_id=task.id if task else None,
                reason=reason,
                status=DiscoveryQueueStatus.PENDING,
                created_at=datetime.utcnow()
            )
            self.db.add(queue_item)
            self.db.commit()

            logger.info(f"Added project {project.name} to discovery queue: {reason}")

        except Exception as e:
            logger.error(f"Failed to add to discovery queue: {e}")
            self.db.rollback()

    def format_specs_for_execution(
        self,
        specs: Dict[str, Any],
        task: Task,
        project: Project
    ) -> str:
        """
        Format specs into concise context for AI during task execution.

        Args:
            specs: Dictionary with patterns and ignore_patterns
            task: Task being executed
            project: Project with stack configuration

        Returns:
            Formatted specs context string
        """
        if not specs.get('patterns'):
            return ""

        context = "\n" + "=" * 80 + "\n"
        context += "PROJECT-SPECIFIC PATTERNS FOR THIS TASK\n"
        context += "=" * 80 + "\n\n"

        context += f"PROJECT: {project.name}\n"
        context += f"TASK: {task.title}\n\n"

        # Group patterns by category
        patterns_by_category: Dict[str, List] = {}
        for pattern in specs['patterns']:
            category = pattern.get('category', 'general')
            if category not in patterns_by_category:
                patterns_by_category[category] = []
            patterns_by_category[category].append(pattern)

        # Output each category
        for category, patterns in patterns_by_category.items():
            context += f"{'-' * 80}\n"
            context += f"{category.upper()} PATTERNS\n"
            context += f"{'-' * 80}\n\n"

            for pattern in patterns:
                confidence = pattern.get('confidence', 0)
                confidence_str = f" (confidence: {confidence:.0%})" if confidence else ""
                context += f"### {pattern['title']} ({pattern['type']}){confidence_str}\n"
                if pattern.get('description'):
                    context += f"{pattern['description']}\n\n"
                context += f"```{pattern.get('language', '')}\n"
                context += f"{pattern['content']}\n"
                context += "```\n\n"

        # Ignore patterns
        if specs.get('ignore_patterns'):
            context += f"{'-' * 80}\n"
            context += "FILES/DIRECTORIES TO IGNORE\n"
            context += f"{'-' * 80}\n"
            context += f"{', '.join(specs['ignore_patterns'])}\n\n"

        context += "=" * 80 + "\n"
        context += "END OF PROJECT PATTERNS\n"
        context += "=" * 80 + "\n\n"

        context += """CRITICAL INSTRUCTIONS FOR CODE GENERATION:

1. **Follow the project patterns above EXACTLY**
   - Use the exact structure, naming conventions, and patterns shown
   - These are REAL patterns discovered from THIS project's codebase
   - Maintain consistency with existing code

2. **Focus on the business logic for THIS task**
   - Implement ONLY what the task description requires
   - Do not add extra features or "nice to haves"
   - Keep code focused and minimal

3. **Code quality requirements**
   - Write clean, readable, production-ready code
   - Follow the project's established best practices shown in patterns
   - Include proper error handling where appropriate
   - Add minimal comments only where logic isn't obvious

4. **Output format**
   - Provide complete, working code
   - Include all necessary imports/dependencies
   - Ensure code can be directly used without modifications

5. **Token efficiency**
   - No verbose explanations needed
   - No tutorial-style comments
   - Just clean, working code following the project patterns

"""

        logger.info(f"Built specs execution context: {len(context)} characters")
        return context
