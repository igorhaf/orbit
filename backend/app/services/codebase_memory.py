"""
Codebase Memory Service

PROMPT #118 - Initial codebase scan and memory extraction

This service performs the first scan of a project's codebase when the code folder
is selected during project creation. It:
1. Detects the technology stack
2. Scans and indexes files for RAG
3. Uses AI to extract business rules and patterns
4. Suggests a project title based on the analysis
5. Prepares relevant data for the context interview

Business Rule: All code analyzed must have its business rules stored,
including this very feature of project creation.

Usage:
    from app.services.codebase_memory import CodebaseMemoryService

    memory = CodebaseMemoryService(db)
    result = await memory.scan_and_memorize(code_path)

    # Returns:
    # {
    #     "suggested_title": "E-commerce Platform",
    #     "stack_info": {...},
    #     "business_rules": [...],
    #     "key_features": [...],
    #     "interview_context": "..."
    # }
"""

import os
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.services.stack_detector import StackDetector
from app.services.codebase_indexer import CodebaseIndexer
from app.services.rag_service import RAGService
from app.services.ai_orchestrator import AIOrchestrator

logger = logging.getLogger(__name__)


class CodebaseMemoryService:
    """
    Service for initial codebase scan and memory extraction.

    Scans a codebase to:
    - Detect technology stack
    - Index code files for RAG
    - Extract business rules using AI
    - Suggest project title
    - Prepare context for AI interviews
    """

    # File extensions to analyze for business rules
    ANALYSIS_EXTENSIONS = {
        ".py", ".php", ".js", ".ts", ".tsx", ".jsx",
        ".java", ".rb", ".go", ".cs", ".swift", ".kt",
        ".vue", ".svelte"
    }

    # Config/docs files to extract from
    CONFIG_FILES = {
        "README.md", "readme.md", "README.txt",
        "CONTRIBUTING.md", "ARCHITECTURE.md",
        "package.json", "composer.json", "Cargo.toml",
        "pyproject.toml", "setup.py", "pom.xml",
        ".env.example", "docker-compose.yml"
    }

    # Maximum files to send to AI for analysis
    MAX_FILES_FOR_AI = 20

    # Maximum content size per file (chars)
    MAX_CONTENT_PER_FILE = 3000

    def __init__(self, db: Session):
        """
        Initialize the codebase memory service.

        Args:
            db: SQLAlchemy database session
        """
        self.db = db
        self.stack_detector = StackDetector()
        self.rag = RAGService(db)
        self.orchestrator = AIOrchestrator(db)

    async def scan_and_memorize(
        self,
        code_path: str,
        project_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """
        Perform initial codebase scan and memorization.

        This is the main entry point called when a user selects a code folder
        during project creation.

        Args:
            code_path: Absolute path to the codebase folder
            project_id: Optional project ID (if project already created)

        Returns:
            Dict containing:
            - suggested_title: AI-suggested project name
            - stack_info: Detected technology stack
            - business_rules: List of extracted business rules
            - key_features: Main features identified
            - interview_context: Prepared context for AI interview
            - files_indexed: Number of files indexed in RAG
            - scan_summary: Overview of what was scanned

        Raises:
            ValueError: If code_path doesn't exist or is not a directory
        """
        path = Path(code_path)

        if not path.exists():
            raise ValueError(f"Code path does not exist: {code_path}")

        if not path.is_dir():
            raise ValueError(f"Code path is not a directory: {code_path}")

        logger.info(f"🧠 Starting codebase memory scan for: {code_path}")

        result = {
            "code_path": code_path,
            "suggested_title": "",
            "stack_info": {},
            "business_rules": [],
            "key_features": [],
            "interview_context": "",
            "files_indexed": 0,
            "scan_summary": {}
        }

        # Step 1: Detect technology stack
        logger.info("📊 Step 1: Detecting technology stack...")
        stack_info = self.stack_detector.detect(path)
        result["stack_info"] = stack_info
        logger.info(f"   Detected stack: {stack_info.get('detected_stack', 'unknown')}")

        # Step 2: Scan and collect file information
        logger.info("📂 Step 2: Scanning codebase structure...")
        scan_data = await self._scan_codebase(path)
        result["scan_summary"] = {
            "total_files": scan_data["total_files"],
            "code_files": scan_data["code_files"],
            "languages": scan_data["languages"],
            "config_files_found": scan_data["config_files"]
        }
        logger.info(f"   Found {scan_data['total_files']} files, {scan_data['code_files']} code files")

        # Step 3: Index files in RAG (if project_id provided)
        if project_id:
            logger.info("💾 Step 3: Indexing files in RAG...")
            try:
                indexer = CodebaseIndexer(self.db)
                # Create a temporary project reference for indexing
                indexing_result = await self._index_for_memory(indexer, project_id, path)
                result["files_indexed"] = indexing_result.get("files_indexed", 0)
                logger.info(f"   Indexed {result['files_indexed']} files")
            except Exception as e:
                logger.warning(f"   RAG indexing skipped: {e}")
                result["files_indexed"] = 0
        else:
            logger.info("   Skipping RAG indexing (no project_id yet)")

        # Step 4: Extract representative code samples for AI analysis
        logger.info("🔍 Step 4: Extracting code samples for analysis...")
        code_samples = self._extract_code_samples(path, scan_data)
        logger.info(f"   Extracted {len(code_samples)} code samples")

        # Step 5: Use AI to analyze and extract insights
        logger.info("🤖 Step 5: AI analysis for business rules and insights...")
        ai_analysis = await self._ai_analyze_codebase(
            code_samples=code_samples,
            stack_info=stack_info,
            scan_summary=result["scan_summary"]
        )

        result["suggested_title"] = ai_analysis.get("suggested_title", "")
        result["business_rules"] = ai_analysis.get("business_rules", [])
        result["key_features"] = ai_analysis.get("key_features", [])
        result["interview_context"] = ai_analysis.get("interview_context", "")

        # Step 6: Store business rules in RAG for future reference
        if project_id and result["business_rules"]:
            logger.info("💾 Step 6: Storing business rules in RAG...")
            await self._store_business_rules(project_id, result["business_rules"])
            logger.info(f"   Stored {len(result['business_rules'])} business rules")

        logger.info("✅ Codebase memory scan complete!")
        return result

    async def _scan_codebase(self, root_path: Path) -> Dict[str, Any]:
        """
        Scan codebase to collect file statistics and structure.

        Args:
            root_path: Root path of the codebase

        Returns:
            Dict with scan statistics
        """
        stats = {
            "total_files": 0,
            "code_files": 0,
            "languages": {},
            "config_files": [],
            "directory_structure": [],
            "key_files": []
        }

        ignore_dirs = {
            "node_modules", ".git", ".venv", "venv", "vendor",
            "__pycache__", ".next", "dist", "build", ".idea",
            ".vscode", "coverage", ".pytest_cache"
        }

        for root, dirs, files in os.walk(root_path):
            # Skip ignored directories
            dirs[:] = [d for d in dirs if d not in ignore_dirs]

            rel_root = Path(root).relative_to(root_path)

            # Track directory structure (first 2 levels)
            if len(rel_root.parts) <= 2:
                stats["directory_structure"].append(str(rel_root))

            for filename in files:
                stats["total_files"] += 1
                file_path = Path(root) / filename

                # Check if it's a config file
                if filename in self.CONFIG_FILES:
                    stats["config_files"].append(str(file_path.relative_to(root_path)))

                # Check if it's a code file
                ext = file_path.suffix.lower()
                if ext in self.ANALYSIS_EXTENSIONS:
                    stats["code_files"] += 1

                    # Count by language
                    lang = self._extension_to_language(ext)
                    stats["languages"][lang] = stats["languages"].get(lang, 0) + 1

                    # Identify key files (models, controllers, main files)
                    if self._is_key_file(filename, file_path):
                        rel_path = str(file_path.relative_to(root_path))
                        stats["key_files"].append(rel_path)

        return stats

    def _extension_to_language(self, ext: str) -> str:
        """Map file extension to language name."""
        mapping = {
            ".py": "Python",
            ".php": "PHP",
            ".js": "JavaScript",
            ".ts": "TypeScript",
            ".tsx": "TypeScript (React)",
            ".jsx": "JavaScript (React)",
            ".java": "Java",
            ".rb": "Ruby",
            ".go": "Go",
            ".cs": "C#",
            ".swift": "Swift",
            ".kt": "Kotlin",
            ".vue": "Vue",
            ".svelte": "Svelte"
        }
        return mapping.get(ext, ext)

    def _is_key_file(self, filename: str, file_path: Path) -> bool:
        """
        Determine if a file is a key file worth analyzing.

        Key files are typically:
        - Models (User.php, user.py, UserModel.ts)
        - Controllers/Routes
        - Main entry points
        - Configuration
        """
        lower_name = filename.lower()
        path_parts = [p.lower() for p in file_path.parts]

        # Check for model files
        if "model" in lower_name or "models" in path_parts:
            return True

        # Check for controller files
        if "controller" in lower_name or "controllers" in path_parts:
            return True

        # Check for route files
        if "route" in lower_name or "routes" in path_parts:
            return True

        # Check for service files
        if "service" in lower_name or "services" in path_parts:
            return True

        # Check for main entry files
        entry_files = {"main.py", "app.py", "index.js", "index.ts", "server.js", "server.ts"}
        if lower_name in entry_files:
            return True

        return False

    def _extract_code_samples(
        self,
        root_path: Path,
        scan_data: Dict
    ) -> List[Dict[str, str]]:
        """
        Extract representative code samples for AI analysis.

        Prioritizes:
        1. README and documentation
        2. Configuration files
        3. Key files (models, controllers)
        4. Entry points

        Args:
            root_path: Root path of codebase
            scan_data: Scan statistics from _scan_codebase

        Returns:
            List of {filename, content, type} dicts
        """
        samples = []

        # Priority 1: README and docs
        for config_file in scan_data.get("config_files", []):
            if len(samples) >= self.MAX_FILES_FOR_AI:
                break

            if "readme" in config_file.lower():
                full_path = root_path / config_file
                if full_path.exists():
                    try:
                        content = full_path.read_text(encoding="utf-8", errors="ignore")
                        samples.append({
                            "filename": config_file,
                            "content": content[:self.MAX_CONTENT_PER_FILE],
                            "type": "documentation"
                        })
                    except Exception as e:
                        logger.warning(f"Failed to read {config_file}: {e}")

        # Priority 2: Package/config files
        for config_file in scan_data.get("config_files", []):
            if len(samples) >= self.MAX_FILES_FOR_AI:
                break

            if config_file.endswith((".json", ".toml", ".yml", ".yaml")):
                full_path = root_path / config_file
                if full_path.exists():
                    try:
                        content = full_path.read_text(encoding="utf-8", errors="ignore")
                        samples.append({
                            "filename": config_file,
                            "content": content[:self.MAX_CONTENT_PER_FILE],
                            "type": "configuration"
                        })
                    except Exception as e:
                        logger.warning(f"Failed to read {config_file}: {e}")

        # Priority 3: Key files (models, controllers, services)
        for key_file in scan_data.get("key_files", [])[:10]:  # Limit to 10 key files
            if len(samples) >= self.MAX_FILES_FOR_AI:
                break

            full_path = root_path / key_file
            if full_path.exists():
                try:
                    content = full_path.read_text(encoding="utf-8", errors="ignore")
                    samples.append({
                        "filename": key_file,
                        "content": content[:self.MAX_CONTENT_PER_FILE],
                        "type": "code"
                    })
                except Exception as e:
                    logger.warning(f"Failed to read {key_file}: {e}")

        return samples

    async def _ai_analyze_codebase(
        self,
        code_samples: List[Dict[str, str]],
        stack_info: Dict,
        scan_summary: Dict
    ) -> Dict[str, Any]:
        """
        Use AI to analyze codebase and extract insights.

        Args:
            code_samples: List of code sample dicts
            stack_info: Stack detection results
            scan_summary: Scan statistics

        Returns:
            Dict with AI analysis results
        """
        # Build context for AI
        context_parts = []

        # Stack info
        if stack_info.get("detected_stack"):
            context_parts.append(
                f"Detected Technology Stack: {stack_info['detected_stack']} "
                f"({stack_info.get('description', '')})"
            )
            context_parts.append(f"Confidence: {stack_info.get('confidence', 0)}%")

        # Scan summary
        context_parts.append(f"\nCodebase Statistics:")
        context_parts.append(f"- Total files: {scan_summary.get('total_files', 0)}")
        context_parts.append(f"- Code files: {scan_summary.get('code_files', 0)}")

        languages = scan_summary.get("languages", {})
        if languages:
            lang_str = ", ".join([f"{k}: {v}" for k, v in languages.items()])
            context_parts.append(f"- Languages: {lang_str}")

        # Code samples
        context_parts.append("\n\n--- CODE SAMPLES ---\n")
        for sample in code_samples:
            context_parts.append(f"\n### File: {sample['filename']} ({sample['type']})")
            context_parts.append("```")
            context_parts.append(sample["content"])
            context_parts.append("```\n")

        full_context = "\n".join(context_parts)

        # Build system prompt
        system_prompt = """You are an expert software architect analyzing a codebase.
Your task is to extract key insights that will help establish project context.

Based on the code samples and statistics provided, you must:

1. **Suggest a Project Title**: A clear, professional name based on what the code does
2. **Extract Business Rules**: Specific rules embedded in the code (e.g., "Users must verify email before posting", "Orders over $100 get free shipping")
3. **Identify Key Features**: Main features/modules the application provides
4. **Prepare Interview Context**: A summary that helps an AI interviewer ask relevant questions

IMPORTANT: Focus on BUSINESS LOGIC, not technical implementation details.
Business rules should be actionable statements about what the system does/enforces.

Respond in JSON format:
{
    "suggested_title": "Project Name",
    "business_rules": [
        "Rule 1: Description of business rule found in code",
        "Rule 2: Another business rule"
    ],
    "key_features": [
        "Feature 1: What it does",
        "Feature 2: What it does"
    ],
    "interview_context": "A paragraph summarizing the project purpose and key areas to explore..."
}"""

        try:
            # Use "memory" usage_type if configured, otherwise fall back to "general"
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": full_context}],
                system_prompt=system_prompt,
                max_tokens=2000
            )

            # Parse JSON response
            import json
            content = response.get("content", "{}")

            # Try to extract JSON from response (might have markdown)
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            result = json.loads(content.strip())

            return {
                "suggested_title": result.get("suggested_title", ""),
                "business_rules": result.get("business_rules", []),
                "key_features": result.get("key_features", []),
                "interview_context": result.get("interview_context", "")
            }

        except Exception as e:
            logger.error(f"AI analysis failed: {e}")
            # Return fallback based on stack detection
            return {
                "suggested_title": self._generate_fallback_title(stack_info),
                "business_rules": [],
                "key_features": [],
                "interview_context": f"This appears to be a {stack_info.get('detected_stack', 'software')} project."
            }

    def _generate_fallback_title(self, stack_info: Dict) -> str:
        """Generate fallback title based on stack detection."""
        stack = stack_info.get("detected_stack", "")

        if stack:
            return f"{stack.replace('_', ' ').title()} Project"

        return "Software Project"

    async def _index_for_memory(
        self,
        indexer: CodebaseIndexer,
        project_id: UUID,
        root_path: Path
    ) -> Dict:
        """
        Index codebase files for memory/RAG.

        Args:
            indexer: CodebaseIndexer instance
            project_id: Project UUID
            root_path: Root path of codebase

        Returns:
            Indexing statistics
        """
        stats = {
            "files_indexed": 0,
            "errors": []
        }

        ignore_dirs = indexer.IGNORE_DIRS

        for root, dirs, files in os.walk(root_path):
            dirs[:] = [d for d in dirs if d not in ignore_dirs]

            for filename in files:
                file_path = Path(root) / filename

                # Detect language
                language = indexer._detect_language(file_path)
                if not language:
                    continue

                try:
                    await indexer._index_file(project_id, file_path, language)
                    stats["files_indexed"] += 1
                except Exception as e:
                    stats["errors"].append(f"{file_path}: {e}")

        return stats

    async def _store_business_rules(
        self,
        project_id: UUID,
        business_rules: List[str]
    ):
        """
        Store extracted business rules in RAG for future reference.

        Args:
            project_id: Project UUID
            business_rules: List of business rule strings
        """
        for i, rule in enumerate(business_rules):
            self.rag.store(
                content=rule,
                metadata={
                    "type": "business_rule",
                    "project_id": str(project_id),
                    "rule_index": i,
                    "source": "codebase_memory_scan"
                },
                project_id=project_id
            )

    async def get_interview_suggestions(
        self,
        project_id: UUID
    ) -> List[str]:
        """
        Get suggested interview questions based on memorized business rules.

        Args:
            project_id: Project UUID

        Returns:
            List of suggested questions for the context interview
        """
        # Retrieve business rules from RAG
        results = self.rag.retrieve(
            query="business rules and requirements",
            filter={
                "project_id": str(project_id),
                "type": "business_rule"
            },
            top_k=10,
            similarity_threshold=0.5
        )

        suggestions = []
        for result in results:
            rule = result.get("content", "")
            if rule:
                # Generate question from rule
                suggestions.append(
                    f"Can you tell me more about this requirement: '{rule}'?"
                )

        return suggestions
