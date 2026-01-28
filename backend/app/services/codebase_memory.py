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

    # PROMPT #118 FIX - Maximum files to send to AI for analysis (increased)
    MAX_FILES_FOR_AI = 30

    # PROMPT #118 FIX - Maximum content size per file (chars) - increased for better analysis
    MAX_CONTENT_PER_FILE = 5000

    # PROMPT #118 FIX - Directories that contain business logic
    BUSINESS_LOGIC_DIRS = {
        "models", "model", "entities", "entity",
        "controllers", "controller", "handlers", "handler",
        "services", "service", "usecases", "use_cases",
        "repositories", "repository", "repos",
        "validators", "validation", "rules",
        "migrations", "database/migrations",
        "middleware", "middlewares",
        "requests", "forms", "dtos",
        "policies", "guards", "permissions",
        "observers", "listeners", "events",
        "jobs", "commands", "actions"
    }

    # PROMPT #118 FIX - Files that typically contain business logic
    BUSINESS_LOGIC_PATTERNS = {
        # Models and entities
        "model", "entity", "domain",
        # Controllers and handlers
        "controller", "handler", "endpoint",
        # Services and use cases
        "service", "usecase", "interactor",
        # Validation and rules
        "validator", "rule", "policy", "guard",
        # Data and repositories
        "repository", "repo", "dao",
        # Migrations (database schema = business rules)
        "migration", "schema",
        # Middleware (business rules enforcement)
        "middleware", "filter",
        # Request validation (business rules)
        "request", "form", "dto",
        # Events and jobs
        "event", "listener", "job", "command"
    }

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
            scan_summary=result["scan_summary"],
            root_path=path  # PROMPT #118 FIX - Pass root path for folder name
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

        PROMPT #118 FIX - Expanded to capture more business logic files:
        - Models, Entities, Domains
        - Controllers, Handlers, Endpoints
        - Services, UseCases, Interactors
        - Validators, Rules, Policies
        - Migrations (database schema = business rules!)
        - Middleware (business rules enforcement)
        - Requests/Forms/DTOs (validation rules)
        - Events, Listeners, Jobs
        """
        lower_name = filename.lower()
        path_parts = [p.lower() for p in file_path.parts]

        # Check if file is in a business logic directory
        for part in path_parts:
            if part in self.BUSINESS_LOGIC_DIRS:
                return True

        # Check if filename contains business logic patterns
        for pattern in self.BUSINESS_LOGIC_PATTERNS:
            if pattern in lower_name:
                return True

        # Check for route files (often contain business rules)
        if "route" in lower_name or "routes" in path_parts:
            return True

        # Check for main entry files
        entry_files = {"main.py", "app.py", "index.js", "index.ts", "server.js", "server.ts"}
        if lower_name in entry_files:
            return True

        # Laravel specific - check for common business files
        laravel_patterns = {
            "kernel.php", "routes.php", "web.php", "api.php",
            "appserviceprovider.php", "authserviceprovider.php"
        }
        if lower_name in laravel_patterns:
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
        # PROMPT #118 FIX - Increased limit and prioritize business logic files
        key_files = scan_data.get("key_files", [])

        # PROMPT #118 FIX - Sort key files to prioritize migrations, models, then controllers
        def sort_priority(f):
            f_lower = f.lower()
            if "migration" in f_lower:
                return 0  # Highest priority - database schema = business rules
            if "model" in f_lower or "entity" in f_lower:
                return 1  # Models define domain
            if "service" in f_lower or "usecase" in f_lower:
                return 2  # Services contain logic
            if "controller" in f_lower or "handler" in f_lower:
                return 3  # Controllers have validation
            if "request" in f_lower or "validator" in f_lower:
                return 4  # Validation rules
            return 5

        key_files_sorted = sorted(key_files, key=sort_priority)

        for key_file in key_files_sorted[:20]:  # PROMPT #118 FIX - Increased from 10 to 20
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
        scan_summary: Dict,
        root_path: Optional[Path] = None  # PROMPT #118 FIX - Added for folder name
    ) -> Dict[str, Any]:
        """
        Use AI to analyze codebase and extract insights.

        Args:
            code_samples: List of code sample dicts
            stack_info: Stack detection results
            scan_summary: Scan statistics
            root_path: Root path of the codebase (for folder name)

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

        # PROMPT #118 FIX - Build comprehensive system prompt for deep analysis
        # Get folder name for better title suggestion
        folder_name = root_path.name if root_path else (
            Path(code_samples[0]["filename"]).parts[0] if code_samples else "Projeto"
        )

        system_prompt = f"""Você é um arquiteto de software especialista analisando uma base de código.
Sua tarefa é EXTRAIR PROFUNDAMENTE as regras de negócio e entender o propósito do sistema.

## O QUE VOCÊ DEVE FAZER:

1. **Sugerir um Título de Projeto**:
   - Baseie-se no DOMÍNIO e PROPÓSITO do sistema, NÃO na tecnologia
   - O nome da pasta é "{folder_name}" - use isso como pista do domínio
   - Exemplos BONS: "Sistema de Gestão Financeira", "Controle de Contas a Pagar/Receber", "Plataforma de Vendas"
   - Exemplos RUINS: "Laravel Project", "PHP Application", "Sistema Web"

2. **Extrair Regras de Negócio** (MÍNIMO 5-10 regras):
   Analise CADA arquivo de código e extraia regras como:
   - Validações de dados (ex: "CPF deve ser válido", "Valor mínimo de R$ 10")
   - Restrições de acesso (ex: "Apenas admin pode excluir", "Usuário só vê seus próprios dados")
   - Cálculos e fórmulas (ex: "Desconto de 10% para pagamento à vista", "Juros de 2% ao mês")
   - Estados e transições (ex: "Pedido pode ser cancelado apenas se não foi enviado")
   - Relacionamentos obrigatórios (ex: "Toda venda deve ter um cliente")
   - Limites e constraints (ex: "Máximo de 5 parcelas", "Prazo máximo de 30 dias")

3. **Identificar Funcionalidades Principais** (MÍNIMO 5-8 features):
   - Liste os módulos/funcionalidades que o sistema oferece
   - Seja específico: "Cadastro de clientes com histórico de compras" ao invés de "CRUD de clientes"

4. **Preparar Contexto para Entrevista**:
   - Escreva um PARÁGRAFO DETALHADO (mínimo 200 palavras) explicando:
     - O que o sistema faz
     - Para quem ele foi feito (público-alvo)
     - Quais problemas ele resolve
     - Quais são as principais entidades/conceitos do domínio
     - Pontos que precisam de mais esclarecimento

## COMO IDENTIFICAR REGRAS DE NEGÓCIO NO CÓDIGO:

### Em Migrations/Schema:
- Campos required/nullable = obrigatoriedade
- Foreign keys = relacionamentos
- Unique constraints = unicidade
- Default values = valores padrão do negócio

### Em Models/Entities:
- Relacionamentos = regras de associação
- Scopes/Queries = filtros de negócio
- Mutators/Accessors = transformações de dados
- Casts/Formatters = tipos de dados do domínio

### Em Controllers/Services:
- Validações = regras de entrada
- Condicionais (if/else) = regras de fluxo
- Cálculos = fórmulas de negócio
- Status/Estados = ciclo de vida de entidades

### Em Validators/Requests:
- Required fields = campos obrigatórios
- Rules = validações específicas do domínio
- Messages = regras traduzidas para usuário

### Em Middleware/Policies:
- Verificações de permissão = regras de acesso
- Verificações de estado = pré-condições

## FORMATO DE RESPOSTA (JSON):
{{
    "suggested_title": "Nome Descritivo do Sistema (baseado no domínio, não na tecnologia)",
    "business_rules": [
        "Regra 1: Descrição clara da regra de negócio encontrada no código",
        "Regra 2: Outra regra de negócio...",
        "... (mínimo 5-10 regras)"
    ],
    "key_features": [
        "Funcionalidade 1: Descrição do que faz",
        "Funcionalidade 2: Descrição do que faz",
        "... (mínimo 5-8 funcionalidades)"
    ],
    "interview_context": "Parágrafo detalhado (mínimo 200 palavras) explicando o sistema, seu propósito, público-alvo, problemas que resolve, entidades principais e pontos que precisam de esclarecimento para a entrevista de contexto..."
}}

IMPORTANTE: Seja PROFUNDO e DETALHADO. Uma análise superficial não serve. Extraia TODO o conhecimento possível do código."""

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
            # PROMPT #118 FIX - Return fallback based on folder name and stack detection
            return {
                "suggested_title": self._generate_fallback_title(stack_info, folder_name),
                "business_rules": [],
                "key_features": [],
                "interview_context": f"Este projeto parece ser um sistema {stack_info.get('detected_stack', 'de software')}. A análise automática não conseguiu extrair detalhes específicos do código. Recomenda-se explorar manualmente as funcionalidades durante a entrevista de contexto."
            }

    def _generate_fallback_title(self, stack_info: Dict, folder_name: str = "") -> str:
        """
        Generate fallback title based on folder name and stack detection.

        PROMPT #118 FIX - Prioritize folder name over stack name.
        """
        # PROMPT #118 FIX - Use folder name as primary source
        if folder_name and folder_name not in {"src", "app", "project", "code", "backend", "frontend"}:
            # Clean up folder name: my-project -> My Project
            clean_name = folder_name.replace("-", " ").replace("_", " ").title()
            return f"Sistema {clean_name}"

        stack = stack_info.get("detected_stack", "")
        if stack:
            return f"Sistema {stack.replace('_', ' ').title()}"

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
