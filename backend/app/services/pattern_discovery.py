"""
Pattern Discovery Service (PROMPT #62 - Week 1 Day 2-4)
AI-powered pattern discovery from ANY codebase (framework or legacy code)

Key Innovation: Discovers patterns ORGANICALLY without framework assumptions
- Scans codebase structure
- Groups similar files
- Uses AI to identify repeating patterns
- AI automatically decides: framework-worthy vs project-specific

Updated: Project-Specific Specs via RAG Discovery
- Now saves discovered patterns to database (specs table)
- Patterns stored with project_id for project-specific lookup
"""

import json
import logging
import os
from pathlib import Path
from typing import List, Dict, Optional, Set
from datetime import datetime
from uuid import UUID, uuid4
from collections import defaultdict

from app.schemas.pattern_discovery import DiscoveredPattern, FileGroup
from app.services.ai_orchestrator import AIOrchestrator
from app.models.spec import Spec, SpecScope
from sqlalchemy.orm import Session
# PROMPT #103 - External prompts support
from app.prompts import get_prompt_service

logger = logging.getLogger(__name__)


class PatternDiscoveryService:
    """
    Discovers code patterns organically from ANY codebase

    Unlike traditional spec generators that assume Laravel/Next.js structure,
    this service learns from the code itself - perfect for legacy/custom projects.

    Process:
    1. Build file inventory (recursive scan)
    2. Group files by extension/structure
    3. Sample representative files
    4. AI analyzes samples to identify patterns
    5. Extract templates with placeholders
    6. AI decides: framework vs project scope
    7. Rank by significance
    """

    def __init__(self, db: Session):
        """
        Initialize Pattern Discovery Service

        Args:
            db: Database session
        """
        self.db = db
        self.ai_orchestrator = AIOrchestrator(db)
        # PROMPT #103 - Use PromptService for external prompts
        self.prompt_service = get_prompt_service(db)

        # Default ignore patterns (common noise files)
        self.default_ignore_patterns = [
            'node_modules', 'vendor', '.git', '__pycache__', '.next',
            'dist', 'build', '.env', 'package-lock.json', 'composer.lock',
            '*.min.js', '*.min.css', '*.map', '.DS_Store',
            'coverage', '.pytest_cache', '.vscode', '.idea'
        ]

    async def discover_patterns(
        self,
        project_path: Path,
        project_id: UUID,
        max_patterns: int = 20,
        min_occurrences: int = 3
    ) -> List[DiscoveredPattern]:
        """
        Main pattern discovery pipeline

        Args:
            project_path: Path to project code in container
            project_id: Project UUID
            max_patterns: Maximum patterns to discover
            min_occurrences: Minimum file count to consider a pattern

        Returns:
            List of discovered patterns ranked by significance
        """
        logger.info(f"🔍 Starting pattern discovery: {project_path}")
        logger.info(f"   Max patterns: {max_patterns}, Min occurrences: {min_occurrences}")

        # Step 1: Build file inventory
        file_inventory = self._build_file_inventory(project_path)
        logger.info(f"📊 Found {len(file_inventory)} files")

        # Step 2: Group files by extension/structure
        file_groups = self._group_files(file_inventory)
        logger.info(f"📂 Created {len(file_groups)} file groups")

        # Step 3: AI-powered pattern discovery
        discovered_patterns = []

        for group_key, file_group in file_groups.items():
            if len(file_group.file_paths) < min_occurrences:
                logger.debug(f"⏭️  Skipping {group_key}: only {len(file_group.file_paths)} files")
                continue

            logger.info(f"🤖 Analyzing group: {group_key} ({len(file_group.file_paths)} files)")

            # Sample representative files
            sampled_files = self._sample_files(project_path, file_group.file_paths, max_samples=5)

            # Ask AI to identify pattern
            pattern = await self._ai_discover_pattern(
                group_key,
                sampled_files,
                file_group,
                project_id
            )

            if pattern:
                pattern.occurrences = len(file_group.file_paths)
                pattern.sample_files = [str(f) for f in file_group.file_paths[:5]]
                discovered_patterns.append(pattern)
                logger.info(f"   ✅ Pattern found: {pattern.title} (confidence: {pattern.confidence_score:.2f})")
            else:
                logger.debug(f"   ❌ No pattern identified for {group_key}")

        # Step 4: Rank patterns by significance
        ranked = self._rank_patterns(discovered_patterns)

        logger.info(f"🎯 Discovered {len(ranked)} patterns total")

        # PROMPT #86 - RAG Phase 4: Index discovered patterns in RAG
        final_patterns = ranked[:max_patterns]
        await self._index_patterns_in_rag(final_patterns, project_id)

        # Project-Specific Specs: Save patterns to database
        saved_specs = await self._save_patterns_to_database(final_patterns, project_id)
        logger.info(f"💾 Saved {len(saved_specs)} patterns to database (specs table)")

        return final_patterns

    def _build_file_inventory(self, project_path: Path) -> List[Path]:
        """
        Build inventory of all code files in project

        Args:
            project_path: Root path to scan

        Returns:
            List of file paths
        """
        files = []

        try:
            for root, dirs, filenames in os.walk(project_path):
                # Filter out ignored directories
                dirs[:] = [d for d in dirs if not self._should_ignore(d)]

                for filename in filenames:
                    if self._should_ignore(filename):
                        continue

                    file_path = Path(root) / filename

                    # Only include code files (has extension, reasonable size)
                    if file_path.suffix and file_path.stat().st_size < 1_000_000:  # < 1MB
                        files.append(file_path.relative_to(project_path))

        except Exception as e:
            logger.error(f"Error scanning directory: {e}")
            return []

        return files

    def _should_ignore(self, name: str) -> bool:
        """Check if file/dir should be ignored"""
        for pattern in self.default_ignore_patterns:
            if '*' in pattern:
                # Wildcard matching (simple)
                pattern_without_star = pattern.replace('*', '')
                if name.endswith(pattern_without_star) or name.startswith(pattern_without_star):
                    return True
            elif name == pattern or name.startswith(pattern):
                return True
        return False

    def _group_files(self, files: List[Path]) -> Dict[str, FileGroup]:
        """
        Group files by extension and structural similarity

        Strategy:
        - Group by extension first (.php, .ts, .py, etc.)
        - Then by directory structure hints (controllers/, models/, etc.)

        Args:
            files: List of file paths

        Returns:
            Dictionary of group_key -> FileGroup
        """
        groups: Dict[str, List[Path]] = defaultdict(list)

        for file_path in files:
            extension = file_path.suffix.lower()

            if not extension:
                continue

            # Try to detect category from path structure
            parts = file_path.parts
            category_hint = "general"

            # Common patterns in path
            path_lower = str(file_path).lower()
            if any(x in path_lower for x in ['controller', 'controllers']):
                category_hint = "controller"
            elif any(x in path_lower for x in ['model', 'models']):
                category_hint = "model"
            elif any(x in path_lower for x in ['service', 'services']):
                category_hint = "service"
            elif any(x in path_lower for x in ['component', 'components']):
                category_hint = "component"
            elif any(x in path_lower for x in ['api', 'route', 'routes']):
                category_hint = "api"
            elif any(x in path_lower for x in ['test', 'tests', 'spec']):
                category_hint = "test"

            group_key = f"{extension}:{category_hint}"
            groups[group_key].append(file_path)

        # Convert to FileGroup objects
        file_groups = {}
        for group_key, file_paths in groups.items():
            extension, category = group_key.split(':', 1)
            file_groups[group_key] = FileGroup(
                group_key=group_key,
                file_paths=[str(p) for p in file_paths],
                file_count=len(file_paths),
                extension=extension,
                estimated_category=category
            )

        return file_groups

    def _sample_files(
        self,
        project_path: Path,
        file_paths: List[str],
        max_samples: int = 5
    ) -> List[Dict[str, str]]:
        """
        Sample representative files for AI analysis

        Strategy: Take evenly distributed samples

        Args:
            project_path: Project root path
            file_paths: List of file paths to sample from
            max_samples: Maximum files to sample

        Returns:
            List of dicts with 'path' and 'content'
        """
        if len(file_paths) <= max_samples:
            indices = range(len(file_paths))
        else:
            # Evenly distributed samples
            step = len(file_paths) // max_samples
            indices = [i * step for i in range(max_samples)]

        samples = []
        for i in indices:
            file_path = project_path / file_paths[i]
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read(5000)  # First 5000 chars
                    samples.append({
                        'path': file_paths[i],
                        'content': content
                    })
            except Exception as e:
                logger.warning(f"Could not read {file_path}: {e}")
                continue

        return samples

    async def _ai_discover_pattern(
        self,
        group_key: str,
        sampled_files: List[Dict[str, str]],
        file_group: FileGroup,
        project_id: UUID
    ) -> Optional[DiscoveredPattern]:
        """
        Use AI to discover pattern from code samples

        This is THE KEY METHOD - AI analyzes samples and:
        1. Identifies if a meaningful pattern exists
        2. Extracts template with {Placeholders}
        3. Suggests category/name/spec_type
        4. Decides: framework-worthy vs project-only
        5. Rates confidence

        Args:
            group_key: Group identifier
            sampled_files: Sample files with content
            file_group: File group metadata
            project_id: Project UUID

        Returns:
            DiscoveredPattern if pattern found, None otherwise
        """
        if not sampled_files:
            return None

        # Build discovery prompt
        prompt = self._build_discovery_prompt(group_key, sampled_files, file_group)

        try:
            # Call AI
            response = await self.ai_orchestrator.execute(
                usage_type="pattern_discovery",
                messages=[{"role": "user", "content": prompt}],
                project_id=project_id,
                metadata={"group_key": group_key, "file_count": file_group.file_count}
            )

            # Parse AI response
            pattern_data = self._parse_ai_response(response["content"])

            if not pattern_data or not pattern_data.get("pattern_found"):
                return None

            # Build DiscoveredPattern
            return DiscoveredPattern(
                category=pattern_data.get("category", "custom"),
                name=pattern_data.get("name", group_key),
                spec_type=pattern_data.get("spec_type", file_group.estimated_category),
                title=pattern_data.get("title", f"{group_key} Pattern"),
                description=pattern_data.get("description", ""),
                template_content=pattern_data.get("template", ""),
                language=pattern_data.get("language", file_group.extension.lstrip('.')),
                confidence_score=float(pattern_data.get("confidence", 0.5)),
                reasoning=pattern_data.get("reasoning", ""),
                key_characteristics=pattern_data.get("key_characteristics", []),
                is_framework_worthy=pattern_data.get("is_framework_worthy", False)
            )

        except Exception as e:
            logger.error(f"AI pattern discovery failed for {group_key}: {e}")
            return None

    def _build_discovery_prompt(
        self,
        group_key: str,
        sampled_files: List[Dict[str, str]],
        file_group: FileGroup
    ) -> str:
        """
        Build AI prompt for pattern discovery

        This prompt is CRITICAL - it enables learning from ANY code
        """
        files_text = "\n\n".join([
            f"File {i+1}: {f['path']}\n```\n{f['content']}\n```"
            for i, f in enumerate(sampled_files[:5])
        ])

        prompt = f"""You are analyzing a codebase to discover repeating code patterns.

I'm showing you {len(sampled_files)} sample files from a group of {file_group.file_count} similar files.

Group Info:
- Extension: {file_group.extension}
- Estimated Category: {file_group.estimated_category}
- Total Files: {file_group.file_count}

Sample Files:
{files_text}

Your Task:
1. Determine if there's a **meaningful repeating pattern** across these files
2. If yes, extract a **template** with {{Placeholders}} for variable parts
3. Suggest a **category** and **name** for this pattern
4. **CRITICAL DECISION**: Is this pattern framework-worthy or project-specific?
   - Framework-worthy: Generic, reusable across different projects (e.g., REST API endpoint pattern)
   - Project-specific: Tied to this specific codebase's unique structure
5. Rate your **confidence** (0.0 to 1.0)

Respond with JSON ONLY (no markdown blocks):
{{
  "pattern_found": true/false,
  "category": "suggested category (e.g., 'api', 'model', 'service', 'custom')",
  "name": "suggested name (e.g., 'api_endpoint', 'data_model', 'project-name')",
  "spec_type": "specific type (e.g., 'rest_api', 'database_model')",
  "title": "Human-readable title",
  "description": "What this pattern represents (2-3 sentences)",
  "template": "Code template with {{Placeholders}} for variable parts",
  "language": "programming language",
  "confidence": 0.0-1.0,
  "reasoning": "Why you identified this pattern (or why not)",
  "key_characteristics": ["list", "of", "key", "features"],
  "is_framework_worthy": true/false
}}

If no meaningful pattern exists (files are too different), set pattern_found: false.

IMPORTANT: Return ONLY valid JSON, no markdown code blocks."""

        return prompt

    def _parse_ai_response(self, content: str) -> Optional[Dict]:
        """Parse AI response (handles markdown-wrapped JSON)"""
        try:
            # Remove markdown code blocks if present
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            # Parse JSON
            data = json.loads(content.strip())
            return data

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            logger.error(f"Content: {content[:500]}")
            return None

    def _rank_patterns(self, patterns: List[DiscoveredPattern]) -> List[DiscoveredPattern]:
        """
        Rank patterns by significance

        Scoring factors:
        - Occurrences (more = more significant)
        - Confidence score (AI certainty)
        - Template complexity (more code = more valuable)
        - Framework-worthiness (reusable patterns ranked higher)

        Args:
            patterns: List of discovered patterns

        Returns:
            Sorted list (most significant first)
        """
        def score(p: DiscoveredPattern) -> float:
            return (
                p.occurrences * 10 +                    # File count weight
                p.confidence_score * 100 +              # AI confidence weight
                len(p.template_content) / 50 +          # Template size weight
                (50 if p.is_framework_worthy else 0)    # Framework bonus
            )

        return sorted(patterns, key=score, reverse=True)

    async def _index_patterns_in_rag(
        self,
        patterns: List[DiscoveredPattern],
        project_id: UUID
    ) -> None:
        """
        Index discovered patterns in RAG for hybrid spec loading

        PROMPT #86 - RAG Phase 4: Specs Híbridas

        Stores discovered patterns in RAG to enable:
        - Hybrid spec loading (static + discovered patterns)
        - Cross-project pattern learning
        - Pattern reuse across similar projects

        Args:
            patterns: List of discovered patterns to index
            project_id: Project UUID
        """
        if not patterns:
            logger.debug("No patterns to index in RAG")
            return

        try:
            from app.services.rag_service import RAGService

            rag_service = RAGService(self.db)
            indexed_count = 0

            for pattern in patterns:
                # Build comprehensive content for semantic search
                content_parts = [
                    f"Pattern: {pattern.title}",
                    f"Category: {pattern.category}/{pattern.spec_type}",
                    f"Language: {pattern.language}",
                    f"Description: {pattern.description}",
                    "",
                    "Key Characteristics:",
                    "\n".join([f"- {char}" for char in pattern.key_characteristics]),
                    "",
                    "Template:",
                    pattern.template_content[:500] + ("..." if len(pattern.template_content) > 500 else ""),
                    "",
                    f"AI Reasoning: {pattern.reasoning}"
                ]

                content = "\n".join(content_parts)

                # Determine scope: project-specific or global (framework-worthy)
                # Framework-worthy patterns stored globally (project_id=None)
                # Project-specific patterns stored with project_id
                storage_project_id = None if pattern.is_framework_worthy else project_id

                # Store in RAG
                rag_service.store(
                    content=content,
                    metadata={
                        "type": "discovered_pattern",
                        "category": pattern.category,
                        "name": pattern.name,
                        "spec_type": pattern.spec_type,
                        "language": pattern.language,
                        "confidence_score": pattern.confidence_score,
                        "is_framework_worthy": pattern.is_framework_worthy,
                        "occurrences": pattern.occurrences,
                        "sample_files": pattern.sample_files[:3],  # First 3 samples
                        "discovered_at": datetime.utcnow().isoformat(),
                        "source_project_id": str(project_id),  # Always track source
                        "discovery_method": pattern.discovery_method
                    },
                    project_id=storage_project_id
                )

                indexed_count += 1

                scope = "global (framework-worthy)" if pattern.is_framework_worthy else f"project {project_id}"
                logger.debug(f"   Indexed pattern '{pattern.title}' ({scope})")

            logger.info(f"✅ RAG: Indexed {indexed_count} discovered patterns ({sum(1 for p in patterns if p.is_framework_worthy)} global, {sum(1 for p in patterns if not p.is_framework_worthy)} project-specific)")

        except Exception as e:
            # Don't fail pattern discovery if RAG indexing fails
            logger.warning(f"⚠️  RAG indexing failed for discovered patterns: {e}")

    async def _save_patterns_to_database(
        self,
        patterns: List[DiscoveredPattern],
        project_id: UUID
    ) -> List[Spec]:
        """
        Save discovered patterns to the specs table in database.

        Project-Specific Specs: Patterns are now stored in database
        for use during task execution instead of generic JSON files.

        Args:
            patterns: List of discovered patterns to save
            project_id: Project UUID

        Returns:
            List of saved Spec objects
        """
        if not patterns:
            logger.debug("No patterns to save to database")
            return []

        saved_specs = []

        try:
            for pattern in patterns:
                # Check if spec with same category/name/type already exists for this project
                existing = self.db.query(Spec).filter(
                    Spec.project_id == project_id,
                    Spec.category == pattern.category,
                    Spec.name == pattern.name,
                    Spec.spec_type == pattern.spec_type
                ).first()

                if existing:
                    # Update existing spec
                    existing.title = pattern.title
                    existing.description = pattern.description
                    existing.content = pattern.template_content
                    existing.language = pattern.language
                    existing.is_active = True
                    existing.discovery_metadata = {
                        "confidence_score": pattern.confidence_score,
                        "occurrences": pattern.occurrences,
                        "sample_files": pattern.sample_files[:5],
                        "key_characteristics": pattern.key_characteristics,
                        "reasoning": pattern.reasoning,
                        "is_framework_worthy": pattern.is_framework_worthy,
                        "discovered_at": datetime.utcnow().isoformat(),
                        "discovery_method": getattr(pattern, 'discovery_method', 'ai_pattern_recognition')
                    }
                    existing.updated_at = datetime.utcnow()
                    saved_specs.append(existing)
                    logger.debug(f"   Updated existing spec: {pattern.title}")
                else:
                    # Create new spec
                    spec = Spec(
                        id=uuid4(),
                        project_id=project_id,
                        scope=SpecScope.PROJECT,
                        category=pattern.category,
                        name=pattern.name,
                        spec_type=pattern.spec_type,
                        title=pattern.title,
                        description=pattern.description,
                        content=pattern.template_content,
                        language=pattern.language,
                        is_active=True,
                        usage_count=0,
                        discovery_metadata={
                            "confidence_score": pattern.confidence_score,
                            "occurrences": pattern.occurrences,
                            "sample_files": pattern.sample_files[:5],
                            "key_characteristics": pattern.key_characteristics,
                            "reasoning": pattern.reasoning,
                            "is_framework_worthy": pattern.is_framework_worthy,
                            "discovered_at": datetime.utcnow().isoformat(),
                            "discovery_method": getattr(pattern, 'discovery_method', 'ai_pattern_recognition')
                        },
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    self.db.add(spec)
                    saved_specs.append(spec)
                    logger.debug(f"   Created new spec: {pattern.title}")

            # Commit all changes
            self.db.commit()

            logger.info(f"✅ Database: Saved {len(saved_specs)} specs for project {project_id}")

        except Exception as e:
            logger.error(f"❌ Failed to save patterns to database: {e}")
            self.db.rollback()
            # Don't fail pattern discovery if database save fails
            # Patterns are still in RAG

        return saved_specs
