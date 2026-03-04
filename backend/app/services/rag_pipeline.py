"""
RAG Pipeline Service - 4-Phase Sequential Pipeline with Redis State

PROMPT #252 - Progressive pipeline triggered by manual buttons:
  Phase 1: Index files in RAG (embedding only, no AI)
  Phase 2: Extract business rules via AI (usage_type=task_execution)
  Phase 3: Generate cards from business rules (closed status)
  Phase 4: Generate wiki + project title + description (1 AI call)

State stored in Redis: rag:pipeline:{project_id}
"""

import fnmatch
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Set
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from app.models.async_job import AsyncJob, JobType, JobStatus
from app.models.project import Project
from app.models.rag_file_state import RAGFileState, FileProcessingStatus, FileSemanticLayer
from app.contracts.loader import ContractLoader
from app.services.job_manager import JobManager
from app.services.rag_service import RAGService
from app.services.continuous_rag_service import ContinuousRAGService

logger = logging.getLogger(__name__)

PIPELINE_KEY_PREFIX = "rag:pipeline"


def _get_redis():
    """Get Redis client (best-effort, returns None if unavailable)."""
    try:
        import redis as _redis
        host = os.getenv("REDIS_HOST", "localhost")
        port = int(os.getenv("REDIS_PORT", 6379))
        client = _redis.Redis(host=host, port=port, db=0, decode_responses=True,
                              socket_connect_timeout=3, socket_timeout=3)
        client.ping()
        return client
    except Exception:
        logger.warning("Redis not available for pipeline state. Using DB-only tracking.")
        return None


class RagPipelineService:
    """Orchestrates the 4-phase RAG pipeline with Redis state tracking."""

    def __init__(self, db: Session):
        self.db = db
        self.redis = _get_redis()
        self.rag = RAGService(db)
        self.continuous_rag = ContinuousRAGService(db)
        self._contract_loader = ContractLoader(db)

    def _load_contract_prompt(self, contract_name: str, fallback: str = "") -> str:
        """PROMPT #258 - Load system_prompt from ContractLoader with fallback."""
        try:
            system_prompt, _ = self._contract_loader.render(contract_name)
            return system_prompt
        except Exception as e:
            logger.warning(f"Failed to load contract '{contract_name}', using fallback: {e}")
            return fallback

    @staticmethod
    def _map_progress(local_pct: float, pmin: float, pmax: float) -> float:
        """Map a local 0-100 percentage to a global [pmin, pmax] range."""
        return pmin + (pmax - pmin) * local_pct / 100.0

    # =========================================================================
    # IGNORE PATTERNS — project-relative path filtering (PROMPT #253)
    #
    # Loads ignore patterns from:
    #   1. Built-in IGNORE_DIRECTORIES (from CodebaseMemoryService)
    #   2. Project.custom_ignore_patterns (AI-detected)
    #   3. Project.ignore_paths (user-editable)
    #   4. .gitignore from project root
    # Applied in ALL phases when loading files from DB.
    # =========================================================================

    def _load_ignore_patterns(self, project: Project) -> Dict[str, Set[str]]:
        """Load all ignore patterns for a project.

        Returns dict with 'dirs' (directory names/paths) and 'files' (file globs).
        """
        from app.services.codebase_memory import CodebaseMemoryService

        dirs: Set[str] = set(CodebaseMemoryService.IGNORE_DIRECTORIES)
        files: Set[str] = set(CodebaseMemoryService.IGNORE_FILE_PATTERNS)

        # AI-detected custom patterns (PROMPT #223)
        if project.custom_ignore_patterns:
            custom_dirs = project.custom_ignore_patterns.get("directories", [])
            if custom_dirs:
                dirs.update(custom_dirs)

        # User-editable ignore paths (PROMPT #241)
        if project.ignore_paths and isinstance(project.ignore_paths, list):
            dirs.update(project.ignore_paths)

        # .gitignore patterns
        if project.code_path:
            gitignore_path = Path(project.code_path) / ".gitignore"
            if gitignore_path.exists():
                try:
                    content = gitignore_path.read_text(encoding="utf-8", errors="ignore")
                    for line in content.splitlines():
                        line = line.strip()
                        if not line or line.startswith("#") or line.startswith("!"):
                            continue
                        if line.endswith("/"):
                            line = line[:-1]
                        dirs.add(line)
                except Exception:
                    pass

        return {"dirs": dirs, "files": files}

    @staticmethod
    def _is_path_ignored(source_file: str, ignore_patterns: Dict[str, Set[str]]) -> bool:
        """Check if a source_file path (relative) should be ignored.

        Mirrors the logic in CodebaseMemoryService._should_ignore_path but
        operates on string paths from DB metadata (no filesystem access needed).
        """
        if not source_file:
            return False

        dirs = ignore_patterns.get("dirs", set())
        files = ignore_patterns.get("files", set())
        parts = Path(source_file).parts
        name = Path(source_file).name

        # Check if any directory component is in ignore list
        for part in parts[:-1]:  # exclude filename
            if part in dirs:
                return True

        # Check relative path against blocklist entries with '/'
        for ignored in dirs:
            if "/" in ignored:
                if source_file == ignored or source_file.startswith(ignored + "/"):
                    return True

        # Check file patterns
        for pattern in files:
            if fnmatch.fnmatch(name, pattern):
                return True

        # Check .gitignore-style patterns against name and full path
        for pattern in dirs:
            if fnmatch.fnmatch(name, pattern):
                return True
            if fnmatch.fnmatch(source_file, pattern):
                return True
            if fnmatch.fnmatch(source_file, f"*/{pattern}"):
                return True

        return False

    def _pipeline_key(self, project_id: UUID) -> str:
        return f"{PIPELINE_KEY_PREFIX}:{project_id}"

    def _set_phase_status(self, project_id: UUID, phase: int, status: str):
        """Update phase status in Redis."""
        if self.redis:
            try:
                self.redis.hset(self._pipeline_key(project_id), f"phase_{phase}_status", status)
            except Exception:
                pass

    def get_pipeline_state(self, project_id: UUID) -> Dict[str, str]:
        """Get current pipeline state from Redis."""
        if self.redis:
            try:
                state = self.redis.hgetall(self._pipeline_key(project_id))
                if state:
                    return state
            except Exception:
                pass
        # Fallback: derive state from database
        return self._derive_state_from_db(project_id)

    def _derive_state_from_db(self, project_id: UUID) -> Dict[str, str]:
        """Derive pipeline state from database when Redis unavailable."""
        state = {
            "phase_1_status": "pending",
            "phase_2_status": "pending",
            "phase_3_status": "pending",
            "phase_4_status": "pending",
        }

        # Phase 1: Check if code_file docs exist in RAG
        code_files = self.db.execute(sql_text(
            "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
            "AND (metadata->>'type' = 'code_file')"
        ), {"pid": str(project_id)}).scalar() or 0

        if code_files > 0:
            state["phase_1_status"] = "completed"

        # Phase 2: Check if business_rule docs exist
        rules = self.db.execute(sql_text(
            "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
            "AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')"
        ), {"pid": str(project_id)}).scalar() or 0

        if rules > 0:
            state["phase_2_status"] = "completed"

        # Phase 3: Check if cards exist
        from app.models.task import Task
        card_count = self.db.query(Task).filter(Task.project_id == project_id).count()
        if card_count > 0:
            state["phase_3_status"] = "completed"

        # Phase 4: Check if wiki exists
        from app.services import wiki_fs
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if project and project.code_path:
            pages = wiki_fs.list_pages(project.code_path)
            if pages and len(pages) > 0:
                state["phase_4_status"] = "completed"

        # Check for running jobs (raw SQL to avoid .astext ORM issue)
        for phase_num, job_input_phase in [(1, "index_files"), (2, "extract_rules"),
                                            (3, "generate_cards"), (4, "generate_wiki")]:
            running = self.db.execute(sql_text(
                "SELECT 1 FROM async_jobs WHERE project_id = :pid "
                "AND status IN ('pending', 'running') "
                "AND input_data->>'phase' = :phase LIMIT 1"
            ), {"pid": str(project_id), "phase": job_input_phase}).first()
            if running:
                state[f"phase_{phase_num}_status"] = "running"

        return state

    # =========================================================================
    # PHASE 1: Index files (embedding only, no AI)
    # =========================================================================
    async def phase_1_index_files(self, project_id: UUID, job_id: UUID,
                                   pmin: float = 0.0, pmax: float = 100.0) -> Dict[str, Any]:
        """
        Phase 1: Scan filesystem and embed all files via Nomic (no AI calls).
        Files go from PENDING → INDEXED status.
        pmin/pmax: progress range for this phase (default 0-100 for standalone).
        """
        self._set_phase_status(project_id, 1, "running")
        jm = JobManager(self.db)
        _p = lambda local: self._map_progress(local, pmin, pmax)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        # Step 1: Scan for changes (detect new/modified/deleted files)
        jm.update_progress(job_id, _p(5), "Fase 1/4: Detectando arquivos...")
        scan_result = await self.continuous_rag.scan_for_changes(project_id)
        logger.info(f"Phase 1 scan: {scan_result}")

        # Step 2: Process deleted files
        await self.continuous_rag.process_deleted_files(project_id)

        # Step 3: Embed each PENDING file (no AI)
        pending_files = self.db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status == FileProcessingStatus.PENDING,
        ).all()

        # Apply project-relative ignore patterns (PROMPT #253)
        ignore_patterns = self._load_ignore_patterns(project)
        files_before = len(pending_files)
        pending_files = [
            f for f in pending_files
            if not self._is_path_ignored(f.file_path, ignore_patterns)
        ]
        if files_before != len(pending_files):
            logger.info(
                f"Phase 1: Filtered {files_before - len(pending_files)} ignored files "
                f"({len(pending_files)} remaining of {files_before})"
            )

        total = len(pending_files)
        indexed = 0
        errors = 0

        for i, file_state in enumerate(pending_files):
            try:
                file_path = os.path.join(project.code_path, file_state.file_path)
                if not os.path.isfile(file_path):
                    continue

                # Read file content
                try:
                    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                except Exception:
                    continue

                if not content or len(content.strip()) < 10:
                    file_state.status = FileProcessingStatus.INDEXED
                    indexed += 1
                    continue

                # Truncate large files for embedding
                max_chars = 8000
                if len(content) > max_chars:
                    content = content[:max_chars]

                # Store in RAG as code_file (embedding only)
                doc_id = self.rag.store(
                    content=content,
                    metadata={
                        "type": "code_file",
                        "source": "continuous_scan",
                        "source_file": file_state.file_path,
                        "language": self._detect_language(file_state.file_path),
                        "layer": file_state.file_layer.value if file_state.file_layer else "unknown",
                    },
                    project_id=project_id,
                )

                file_state.status = FileProcessingStatus.INDEXED
                file_state.rag_document_ids = [str(doc_id)]
                indexed += 1

                # Progress update
                local_pct = 10 + (80 * (i + 1) / max(total, 1))
                if (i + 1) % 20 == 0 or i == total - 1:
                    jm.update_progress(job_id, _p(local_pct),
                                       f"Fase 1/4: Indexando arquivos... ({i + 1}/{total})")
                    self.db.commit()

            except Exception as e:
                logger.error(f"Phase 1 error indexing {file_state.file_path}: {e}")
                file_state.status = FileProcessingStatus.FAILED
                file_state.error_message = str(e)[:500]
                errors += 1

        self.db.commit()
        self._set_phase_status(project_id, 1, "completed")

        result = {
            "phase": "index_files",
            "total_files": total,
            "indexed": indexed,
            "errors": errors,
            "scan": scan_result,
        }
        jm.update_progress(job_id, _p(95), f"Fase 1/4: Concluida — {indexed} arquivos indexados")
        return result

    # =========================================================================
    # PHASE 2: Extract business rules via single AI prompt + RAG injection
    # Uses enable_rag=True with high top_k to fill Claude's 200K context.
    # Single call — no batches, no file iteration.
    # =========================================================================

    # =====================================================================
    # STRICT JSON CONTRACTS — PROMPT #254
    # Each phase has a rigid schema. The AI MUST comply or entries are
    # discarded by the validator.  No fuzzy fallbacks, no guessing.
    # =====================================================================

    # PROMPT #259 - Thinking disabled to save credits
    THINKING_CONFIG = None

    # Batch config for Phase 2 (process ALL files, not RAG-selected subset)
    PHASE2_BATCH_SIZE = 15
    PHASE2_MAX_CONTEXT_CHARS = 50000

    PHASE2_SYSTEM_PROMPT = (
        "IMPORTANTE: Voce NAO tem acesso a ferramentas. Analise APENAS o codigo fornecido.\n\n"
        "Voce e um analista de negocios e arquiteto de software senior.\n"
        "Extraia regras de negocio DETALHADAS e RICAS do codigo fornecido.\n\n"
        "PARA CADA REGRA, identifique:\n"
        "1. A ENTIDADE PRINCIPAL (nome do modelo/classe/tabela)\n"
        "2. O DOMINIO DE NEGOCIO (modulo funcional: ex. Autenticacao, Pagamentos, Gestao de Projetos)\n"
        "3. O CONTEXTO FUNCIONAL (o que esta regra significa do ponto de vista do USUARIO)\n"
        "4. ENTIDADES RELACIONADAS\n"
        "5. A EVIDENCIA (trecho de codigo que comprova, max 200 chars)\n\n"
        "CATEGORIAS (use EXATAMENTE um destes):\n"
        "  dominio | validacao | restricao | workflow | permissao | calculo | integracao | negocio\n\n"
        "PRIORIDADE (use EXATAMENTE um destes):\n"
        "  critical | high | medium | low\n\n"
        "IGNORE: config boilerplate, CSS puro, logs, Docker, imports sem logica.\n\n"
        "Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicacoes.\n\n"
        '{"business_rules": [{\n'
        '  "rule_text": "descricao funcional RICA em portugues (min 30 chars)",\n'
        '  "rule_type": "dominio",\n'
        '  "source_file": "caminho/arquivo.py",\n'
        '  "priority": "medium",\n'
        '  "entity": "NomeDaEntidade",\n'
        '  "domain": "Nome do Modulo de Negocio",\n'
        '  "evidence": "trecho de codigo (max 200 chars)",\n'
        '  "related_entities": ["EntidadeA", "EntidadeB"]\n'
        '}]}\n\n'
        "QUALIDADE OBRIGATORIA:\n"
        "- rule_text: MINIMO 30 chars, descricao funcional em portugues\n"
        "- entity: nome da classe/modelo/tabela principal (NUNCA vazio)\n"
        "- domain: modulo de negocio (ex: Autenticacao, Gestao de Projetos, API Proxy)\n"
        "- evidence: trecho REAL do codigo\n"
        "- Extraia o MAXIMO de regras — validacoes, restricoes, workflows, permissoes, calculos\n"
        "- NAO invente regras — apenas o que EXISTE no codigo\n"
        "- Descricoes SEMPRE em PORTUGUES\n"
        "- Se nenhuma regra: {\"business_rules\": []}\n"
        "- source_file = caminho relativo do arquivo"
    )

    # Number of extraction passes (each pass re-scans all files for missed rules)
    PHASE2_NUM_PASSES = 3

    async def phase_2_extract_rules(self, project_id: UUID, job_id: UUID,
                                     pmin: float = 0.0, pmax: float = 100.0) -> Dict[str, Any]:
        """
        Phase 2: Extract business rules via MULTI-PASS BATCH processing.

        Runs PHASE2_NUM_PASSES passes over ALL code files. Each pass:
        - Pass 1: Extract all rules (clean slate)
        - Pass 2+: Re-extract with list of already-found rules so LLM
                    focuses on MISSED rules (avoids duplicates)
        """
        self._set_phase_status(project_id, 2, "running")
        jm = JobManager(self.db)
        _p = lambda local: self._map_progress(local, pmin, pmax)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        jm.update_progress(job_id, _p(5), "Fase 2/4: Preparando extracao de regras...")

        # Delete old business rules from RAG
        try:
            deleted = self.db.execute(sql_text(
                "DELETE FROM rag_documents WHERE project_id = :pid "
                "AND metadata->>'type' = 'business_rule'"
            ), {"pid": str(project_id)}).rowcount
            self.db.commit()
            if deleted:
                logger.info(f"Phase 2: Cleaned {deleted} old business rules")
        except Exception:
            pass

        # Load ALL code_file documents from DB
        rows = self.db.execute(sql_text(
            "SELECT content, metadata FROM rag_documents "
            "WHERE project_id = :pid AND metadata->>'type' = 'code_file' "
            "ORDER BY metadata->>'source_file'"
        ), {"pid": str(project_id)}).fetchall()

        # Apply project-relative ignore patterns (PROMPT #253)
        ignore_patterns = self._load_ignore_patterns(project)
        rows_before = len(rows)
        rows = [
            r for r in rows
            if not self._is_path_ignored(
                (r[1] if isinstance(r[1], dict) else {}).get("source_file", ""),
                ignore_patterns,
            )
        ]
        if rows_before != len(rows):
            logger.info(
                f"Phase 2: Filtered {rows_before - len(rows)} ignored files "
                f"({len(rows)} remaining of {rows_before})"
            )

        code_count = len(rows)
        if code_count == 0:
            self._set_phase_status(project_id, 2, "failed")
            raise ValueError("Nenhum arquivo indexado. Execute Phase 1 primeiro.")

        logger.info(f"Phase 2: {code_count} code files loaded from DB")

        # Build batches respecting size limits
        batches: List[List[str]] = []
        current_batch: List[str] = []
        current_chars = 0

        for row in rows:
            content = row[0] or ""
            meta = row[1] if isinstance(row[1], dict) else {}
            source = meta.get("source_file", "unknown")
            entry = f"=== {source} ===\n{content}\n"
            entry_len = len(entry)

            if current_batch and (
                len(current_batch) >= self.PHASE2_BATCH_SIZE
                or current_chars + entry_len > self.PHASE2_MAX_CONTEXT_CHARS
            ):
                batches.append(current_batch)
                current_batch = []
                current_chars = 0

            current_batch.append(entry)
            current_chars += entry_len

        if current_batch:
            batches.append(current_batch)

        total_batches = len(batches)
        num_passes = self.PHASE2_NUM_PASSES
        total_steps = total_batches * num_passes

        logger.info(
            f"Phase 2: {code_count} files, {total_batches} batches, "
            f"{num_passes} passes ({total_steps} total steps)"
        )

        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)
        project_name = project.name or "Projeto"

        total_rules = 0
        # Track found rule texts across passes to build "already found" context
        found_rule_summaries: List[str] = []

        for pass_num in range(1, num_passes + 1):
            pass_rules = 0

            # Build "already found" context for passes 2+
            already_found_context = ""
            if pass_num > 1 and found_rule_summaries:
                # Truncate to fit in context (~10KB max for already-found list)
                summary_lines = found_rule_summaries[:500]
                already_found_context = (
                    f"\n\nREGRAS JA ENCONTRADAS ({len(found_rule_summaries)} total) — "
                    f"NAO repita estas, busque regras NOVAS:\n"
                    + "\n".join(f"- {s}" for s in summary_lines)
                )
                if len(found_rule_summaries) > 500:
                    already_found_context += f"\n... e mais {len(found_rule_summaries) - 500} regras"

            for batch_idx, batch in enumerate(batches):
                batch_num = batch_idx + 1
                step = (pass_num - 1) * total_batches + batch_num
                local_progress = 5.0 + (90.0 * step / total_steps)
                jm.update_progress(
                    job_id, _p(local_progress),
                    f"Fase 2/4: Passe {pass_num}/{num_passes}, "
                    f"lote {batch_num}/{total_batches} — {total_rules} regras"
                )

                code_context = "\n".join(batch)

                if pass_num == 1:
                    user_prompt = (
                        f'CODIGO-FONTE do projeto "{project_name}" '
                        f'(lote {batch_num} de {total_batches}):\n\n'
                        f'{code_context}\n\n'
                        f'---\n'
                        f'INSTRUCOES DE EXTRACAO PROFUNDA:\n'
                        f'1. Identifique TODOS os modulos/dominios de negocio presentes nestes arquivos\n'
                        f'2. Para CADA regra, identifique a ENTIDADE principal e o DOMINIO de negocio\n'
                        f'3. Descreva cada regra do ponto de vista FUNCIONAL (o que o usuario experimenta)\n'
                        f'4. Inclua RELACIONAMENTOS entre entidades\n'
                        f'5. Extraia regras implicitas (validacoes em if/else, restricoes em queries, etc)\n\n'
                        f'Retorne APENAS o JSON com business_rules.\n'
                        f'NAO use ferramentas, NAO explore arquivos.'
                    )
                else:
                    user_prompt = (
                        f'CODIGO-FONTE do projeto "{project_name}" '
                        f'(passe {pass_num}, lote {batch_num} de {total_batches}):\n\n'
                        f'{code_context}\n\n'
                        f'{already_found_context}\n\n'
                        f'---\n'
                        f'PASSE {pass_num} DE EXTRACAO PROFUNDA.\n'
                        f'Ja encontramos {len(found_rule_summaries)} regras nos passes anteriores.\n'
                        f'Analise o codigo acima buscando regras que AINDA NAO FORAM extraidas:\n'
                        f'- Validacoes implicitas (if/else que controlam fluxo)\n'
                        f'- Regras de permissao e acesso\n'
                        f'- Restricoes de dados (tamanhos, formatos, limites)\n'
                        f'- Fluxos de workflow (estados, transicoes)\n'
                        f'- Calculos e formulas de negocio\n'
                        f'- Integracoes e dependencias entre modulos\n'
                        f'Retorne APENAS regras NOVAS que NAO estejam na lista acima.\n'
                        f'Se nenhuma regra nova: {{"business_rules": []}}'
                    )

                try:
                    response = await orchestrator.execute(
                        usage_type="rag_extraction",
                        messages=[{"role": "user", "content": user_prompt}],
                        system_prompt=self._load_contract_prompt("pipeline/rag_rules_extraction", self.PHASE2_SYSTEM_PROMPT),
                        max_tokens=16384,
                        project_id=project_id,
                        metadata={
                            "phase": "rag_pipeline_phase2",
                            "project_id": str(project_id),
                            "pass": pass_num,
                            "batch": batch_num,
                            "total_batches": total_batches,
                        },
                        disable_cwd=True,
                        disable_tools=True,
                    )

                    raw = response.get("content", "")
                    rules = self._parse_rules_json(raw)
                    batch_stored = self._store_rules(rules, project_id)
                    self.db.commit()
                    total_rules += batch_stored
                    pass_rules += batch_stored

                    # Track found rules for next pass
                    for rule in rules:
                        rt = rule.get("rule_text", "")
                        if rt and len(rt) >= 15:
                            found_rule_summaries.append(rt[:120])

                    logger.info(
                        f"Phase 2: Pass {pass_num} Batch {batch_num}/{total_batches} -> "
                        f"{batch_stored} rules (pass: {pass_rules}, total: {total_rules})"
                    )

                except Exception as e:
                    logger.warning(f"Phase 2: Pass {pass_num} Batch {batch_num} failed: {e}")
                    continue

            logger.info(
                f"Phase 2: Pass {pass_num}/{num_passes} complete — "
                f"{pass_rules} new rules (total: {total_rules})"
            )

            # If a pass finds very few new rules, skip remaining passes
            if pass_num > 1 and pass_rules < 5:
                logger.info(f"Phase 2: Pass {pass_num} found only {pass_rules} new rules, stopping early")
                break

        # Update rag_file_state
        try:
            self.db.query(RAGFileState).filter(
                RAGFileState.project_id == project_id,
                RAGFileState.status == FileProcessingStatus.INDEXED,
            ).update({"status": FileProcessingStatus.COMPLETED}, synchronize_session="fetch")
            self.db.commit()
        except Exception:
            pass

        if total_rules == 0:
            self._set_phase_status(project_id, 2, "failed")
            raise ValueError("Extracao falhou: 0 regras extraidas")

        self._set_phase_status(project_id, 2, "completed")
        jm.update_progress(
            job_id, _p(95),
            f"Fase 2/4: Concluida — {total_rules} regras em {num_passes} passes"
        )
        return {
            "phase": "extract_rules",
            "rules_extracted": total_rules,
            "code_files": code_count,
            "batches": total_batches,
            "passes": num_passes,
        }

    # =====================================================================
    # ROBUST JSON EXTRACTOR — handles markdown fences, trailing commas,
    # concatenated objects, and other common AI output issues.
    # =====================================================================

    @staticmethod
    def _extract_json(raw: str) -> dict:
        """
        Extract a single JSON object from AI response text.
        Handles: markdown fences, trailing commas, BOM, leading text.
        Returns empty dict on failure.
        """
        if not raw or not raw.strip():
            return {}

        text = raw.strip()

        # Strip OUTER markdown code fences only.
        # Use rfind for the closing ``` to handle content that itself
        # contains ``` (e.g., wiki pages with code blocks).
        if text.startswith('```'):
            first_nl = text.find('\n')
            last_fence = text.rfind('```')
            if first_nl > 0 and last_fence > first_nl:
                text = text[first_nl + 1:last_fence].strip()

        # Find the outermost JSON object
        start = text.find('{')
        if start == -1:
            return {}

        # Walk forward counting braces to find the matching close
        depth = 0
        end = start
        in_string = False
        escape_next = False
        for i in range(start, len(text)):
            ch = text[i]
            if escape_next:
                escape_next = False
                continue
            if ch == '\\' and in_string:
                escape_next = True
                continue
            if ch == '"' and not escape_next:
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = i
                    break

        json_str = text[start:end + 1]

        # Fix trailing commas before } or ] (common AI mistake)
        json_str = re.sub(r',\s*([}\]])', r'\1', json_str)

        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e1:
            logger.warning(f"JSON parse error, attempting repairs: {e1}")

            # Fix: LLM sometimes generates ) instead of } at end of objects.
            # Generic repair: any ) that sits where } should be.
            # Step 1: replace ) followed by , { ] or } (object boundary)
            repaired = re.sub(r'\)\s*,\s*\{', '},\n{', json_str)
            repaired = re.sub(r'\)\s*\]', '}]', repaired)
            repaired = re.sub(r'\)\s*\}', '}}', repaired)
            # Step 2: fix ] used as } (array-close sitting where object-close should)
            # Pattern: ..."field":"value"] ,{ → ..."field":"value"} ,{
            repaired = re.sub(r'(":\s*"[^"]*")\]\s*,\s*\{', r'\1},\n{', repaired)
            repaired = re.sub(r'(":\s*"[^"]*")\]\s*\]\s*\}', r'\1}]}', repaired)
            repaired = re.sub(r'(":\s*\d+)\]\s*,\s*\{', r'\1},\n{', repaired)
            repaired = re.sub(r'(":\s*\d+)\]\s*\]\s*\}', r'\1}]}', repaired)

            try:
                return json.loads(repaired)
            except json.JSONDecodeError as e2:
                logger.error(f"JSON parse error after repair: {e2}")
                # Last resort: try the whole text
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return {}

    # =====================================================================
    # PHASE 2 VALIDATORS — strict contract enforcement for business rules
    # =====================================================================

    VALID_RULE_TYPES = frozenset({
        "dominio", "validacao", "restricao", "workflow",
        "permissao", "calculo", "integracao", "negocio",
    })
    VALID_PRIORITIES = frozenset({"critical", "high", "medium", "low"})

    def _parse_rules_json(self, raw: str) -> List[Dict]:
        """Parse and VALIDATE business rules from AI response.
        Returns only rules that pass all contract checks."""
        parsed = self._extract_json(raw)
        raw_rules = parsed.get("business_rules", [])
        if not isinstance(raw_rules, list):
            logger.warning("Phase 2: 'business_rules' is not a list")
            return []

        valid = []
        rejected = 0
        for i, rule in enumerate(raw_rules):
            if not isinstance(rule, dict):
                rejected += 1
                continue

            rule_text = str(rule.get("rule_text") or "").strip()
            rule_type = str(rule.get("rule_type") or "").strip().lower()
            source_file = str(rule.get("source_file") or "").strip()
            priority = str(rule.get("priority") or "").strip().lower()

            # ---- STRICT VALIDATION ----
            if len(rule_text) < 20:
                rejected += 1
                continue
            if rule_type not in self.VALID_RULE_TYPES:
                rejected += 1
                continue
            if not source_file or len(source_file) < 3:
                rejected += 1
                continue
            if priority not in self.VALID_PRIORITIES:
                # Auto-fix common mistake: "normal" -> "medium"
                if priority == "normal":
                    priority = "medium"
                else:
                    rejected += 1
                    continue

            # Sanitize lengths
            rule_text = rule_text[:2000]
            source_file = source_file[:500]

            # Extract entity and domain (critical for Phase 3 grouping)
            entity = str(rule.get("entity") or "").strip()[:200]
            domain = str(rule.get("domain") or "").strip()[:200]

            # If domain is empty, try to derive from entity or source_file path
            if not domain and entity:
                domain = entity
            if not domain and source_file:
                # Use first directory component as domain hint
                parts = source_file.replace("\\", "/").split("/")
                if len(parts) > 1:
                    domain = parts[-2].replace("_", " ").replace("-", " ").title()

            valid.append({
                "rule_text": rule_text,
                "rule_type": rule_type,
                "source_file": source_file,
                "priority": priority,
                "entity": entity if entity else "Geral",
                "domain": domain if domain else "Geral",
                "evidence": str(rule.get("evidence") or "").strip()[:1000],
            })

        if rejected:
            logger.info(f"Phase 2 validator: {len(valid)} accepted, {rejected} rejected")
        return valid

    def _store_rules(self, rules: List[Dict], project_id: UUID) -> int:
        """Store validated rules in RAG. Only accepts dicts from _parse_rules_json."""
        stored = 0
        for rule in rules:
            self.rag.store_business_rule(
                content=rule["rule_text"],
                project_id=project_id,
                source="pipeline_phase2",
                source_file=rule["source_file"],
                rule_type=rule["rule_type"],
                priority=rule["priority"],
                entity=rule.get("entity"),
                evidence=rule.get("evidence"),
                domain=rule.get("domain"),
            )
            stored += 1
        return stored

    # =========================================================================
    # PHASE 3: Generate CARDS from business rules (MULTI-BATCH)
    #
    # Two-pass approach:
    #   Pass 1 (Epics): Compact summary of ALL rules → generate Epics only
    #   Pass 2 (Details): One batch per entity group → Stories/Tasks
    # =========================================================================

    PHASE3_BATCH_MAX_RULES = 80
    PHASE3_BATCH_MAX_CHARS = 60000

    # System prompt shared by all Phase 3 batches
    PHASE3_COMMON_PROMPT = (
        "IMPORTANTE: Voce NAO tem acesso a ferramentas. NAO tente executar comandos "
        "ou explorar arquivos. As regras de negocio ja estao na mensagem do usuario.\n\n"
        "METODOLOGIA DE REFERENCIAS SEMANTICAS:\n"
        "O campo 'generated_prompt' de CADA card DEVE usar identificadores semanticos.\n"
        "Categorias: N(Entidades), P(Processos), E(Endpoints), D(Dados), "
        "S(Servicos), C(Restricoes), AC(Aceite), F(Arquivos), M(Modelos).\n"
        "generated_prompt COMECA com 'Mapa Semantico:' seguido dos identificadores.\n\n"
        "DIFERENCA CRITICA:\n"
        "- 'description' = texto HUMANO legivel, sem identificadores.\n"
        "- 'generated_prompt' = instrucao SEMANTICA com Mapa Semantico.\n"
        "- NUNCA copie um para o outro. Devem ser COMPLETAMENTE DIFERENTES.\n\n"
        "CONTRATO JSON — Responda APENAS com JSON puro. Sem markdown, sem ```json.\n\n"
        "CAMPOS OBRIGATORIOS POR CARD:\n"
        "- title (5-255 chars), item_type (epic|story|task)\n"
        "- parent_title (null p/ epic, titulo EXATO do pai p/ demais)\n"
        "- description (min 200 chars, humano legivel)\n"
        "- generated_prompt (min 300 chars, semantico com Mapa)\n"
        "- story_points (Fibonacci: 1,2,3,5,8,13)\n"
        "- priority (critical|high|medium|low), complexity (low|medium|high)\n"
        "- labels (array de tags), acceptance_criteria (array de {text,completed:false})\n"
        "- components (array), type, entity, depends_on_titles (array)\n\n"
        "REGRAS CRITICAS:\n"
        "- cards e ARRAY FLAT. parent_title liga ao pai.\n"
        "- Ordem: epics primeiro, stories, tasks\n"
        "- Todos os textos em PORTUGUES. NUNCA gere textos em ingles.\n"
        "- Retorne APENAS: {\"cards\": [...]}"
    )

    # Pass 1: Epic generation from actual rules per domain
    PHASE3_EPIC_PROMPT = (
        PHASE3_COMMON_PROMPT + "\n\n"
        "TAREFA ESPECIFICA: Gere APENAS EPICS (item_type='epic', parent_title=null).\n"
        "Cada Epic representa um MODULO ou COMPONENTE REAL do sistema analisado.\n"
        "CADA dominio listado nas regras DEVE ter pelo menos 1 Epic dedicado.\n\n"
        "EPIC = MODULO DO SISTEMA. Exemplos:\n"
        "- Plataforma de ensino: 'Gestao de Alunos', 'Gestao de Professores', 'Matriculas'\n"
        "- E-commerce: 'Catalogo de Produtos', 'Carrinho de Compras', 'Pagamentos'\n"
        "- API Proxy: 'Gerenciamento de Sessoes', 'Streaming SSE', 'Roteamento de Modelos'\n\n"
        "PROIBIDO gerar Epics genericos como:\n"
        "- 'Configuracao do Sistema', 'Melhoria de Performance', 'Infraestrutura Geral'\n"
        "- 'Testes', 'Documentacao', 'DevOps'\n"
        "Cada Epic DEVE estar ligado a REGRAS DE NEGOCIO CONCRETAS.\n\n"
        "FORMATO OBRIGATORIO DA DESCRIPTION (Markdown, min 500 chars):\n"
        "## Objetivo\n"
        "[O que este modulo faz no sistema — descricao funcional rica]\n\n"
        "## Regras de Negocio Principais\n"
        "- [Regra concreta extraida do codigo com evidencia]\n"
        "- [Regra concreta extraida do codigo com evidencia]\n"
        "- [Mais regras...]\n\n"
        "## Entidades e Relacionamentos\n"
        "- [Entidade A] → [como se relaciona com Entidade B]\n\n"
        "## Componentes Tecnicos\n"
        "- Arquivos-chave: [lista de arquivos reais do projeto]\n"
        "- Servicos/Classes: [servicos envolvidos]\n\n"
        "QUALIDADE OBRIGATORIA:\n"
        "- description: Markdown RICO, MINIMO 500 chars com as secoes acima\n"
        "- generated_prompt: MINIMO 500 chars, comeca com 'Mapa Semantico:'\n"
        "- acceptance_criteria: MINIMO 3 criterios por Epic\n"
        "- story_points: Fibonacci (5, 8, 13, 21)\n"
        "- labels: array com pelo menos 2 tags relevantes\n\n"
        "NAO gere Epics vazios ou com campos minimos. Cada Epic deve ser RICO e COMPLETO."
    )

    # Pass 2: Detail generation (stories/tasks) for specific entity
    PHASE3_DETAIL_PROMPT = (
        PHASE3_COMMON_PROMPT + "\n\n"
        "TAREFA ESPECIFICA: Gere Stories e Tasks para o(s) Epic(s) indicado(s).\n"
        "HIERARQUIA OBRIGATORIA:\n"
        "  Cada Epic -> 2-5 Stories\n"
        "  Cada Story -> 2-5 Tasks\n\n"
        "STORIES = camada CONCEITUAL que expande o Epic:\n"
        "- Cada Story foca num ASPECTO FUNCIONAL do modulo\n"
        "- Description em Markdown (min 300 chars) com secoes:\n"
        "  ## Contexto | ## Funcionalidade | ## Regras Envolvidas | ## Cenarios de Uso\n"
        "- Baseada em regras de negocio REAIS do dominio\n\n"
        "TASKS = camada TECNICA que implementa a Story:\n"
        "- Description tecnica (min 200 chars) com: arquivos, logica, validacoes\n"
        "- Referencia arquivos e servicos REAIS do projeto\n\n"
        "Use parent_title EXATO do Epic/Story pai."
    )

    async def phase_3_generate_cards(self, project_id: UUID, job_id: UUID,
                                      pmin: float = 0.0, pmax: float = 100.0) -> Dict[str, Any]:
        """
        Phase 3: Generate CARDS via MULTI-BATCH processing.

        Pass 1 (0-20% local): Compact summary → Epics only
        Pass 2 (20-95% local): One batch per entity group → Stories/Tasks
        """
        self._set_phase_status(project_id, 3, "running")
        jm = JobManager(self.db)
        _p = lambda local: self._map_progress(local, pmin, pmax)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        jm.update_progress(job_id, _p(2), "Fase 3/4: Carregando regras de negocio...")

        # Load ALL business rules from DB, grouped by entity
        rule_rows = self.db.execute(sql_text(
            "SELECT content, metadata FROM rag_documents "
            "WHERE project_id = :pid AND metadata->>'type' = 'business_rule' "
            "ORDER BY metadata->>'entity', metadata->>'rule_type'"
        ), {"pid": str(project_id)}).fetchall()

        # Apply project-relative ignore patterns (PROMPT #253)
        ignore_patterns = self._load_ignore_patterns(project)
        rules_before = len(rule_rows)
        rule_rows = [
            r for r in rule_rows
            if not self._is_path_ignored(
                (r[1] if isinstance(r[1], dict) else {}).get("source_file", ""),
                ignore_patterns,
            )
        ]
        if rules_before != len(rule_rows):
            logger.info(
                f"Phase 3: Filtered {rules_before - len(rule_rows)} rules from ignored paths "
                f"({len(rule_rows)} remaining of {rules_before})"
            )

        rule_count = len(rule_rows)
        if rule_count == 0:
            self._set_phase_status(project_id, 3, "failed")
            raise ValueError("Nenhuma regra de negocio encontrada. Execute Phase 2 primeiro.")

        # Group rules by domain (falls back to entity for backward compat)
        entity_rules: Dict[str, List[str]] = {}
        entity_summary: Dict[str, int] = {}
        for row in rule_rows:
            content = row[0] or ""
            meta = row[1] if isinstance(row[1], dict) else {}
            entity = meta.get("domain") or meta.get("entity") or "Geral"
            entity = entity.strip() if entity else "Geral"
            rule_type = meta.get("rule_type", "outro")
            source = meta.get("source_file", "?")
            line = f"  [{rule_type}|{source}] {content}"
            entity_rules.setdefault(entity, []).append(line)
            entity_summary[entity] = entity_summary.get(entity, 0) + 1

        logger.info(
            f"Phase 3: {rule_count} rules, {len(entity_rules)} entities"
        )

        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)
        project_name = project.name or "Projeto"
        total_cards = 0

        # ==========================================
        # PASS 1: Generate EPICS from ACTUAL RULES per domain
        # ==========================================
        jm.update_progress(job_id, _p(5), "Fase 3/4: Gerando epics...")

        # Build RICH domain context with actual rule content
        domain_blocks = []
        for domain_name in sorted(entity_rules.keys()):
            rules_list = entity_rules[domain_name]
            # Include up to 15 representative rules per domain (full text)
            sample = rules_list[:15]
            block = (
                f"\n=== DOMINIO: {domain_name} ({len(rules_list)} regras) ===\n"
                + "\n".join(sample)
            )
            domain_blocks.append(block)

        all_domains_text = "\n".join(domain_blocks)
        # Cap context to avoid exceeding model limits
        MAX_EPIC_CONTEXT = 100000
        if len(all_domains_text) > MAX_EPIC_CONTEXT:
            all_domains_text = all_domains_text[:MAX_EPIC_CONTEXT] + "\n\n... (truncado por limite de contexto)"

        epic_user_prompt = (
            f'Projeto: "{project_name}"\n'
            f'Total de regras de negocio: {rule_count}\n'
            f'Total de dominios: {len(entity_summary)}\n\n'
            f'REGRAS DE NEGOCIO POR DOMINIO:\n{all_domains_text}\n\n'
            f'---\n'
            f'INSTRUCOES:\n'
            f'Gere EPICS onde cada Epic representa um MODULO/COMPONENTE REAL do sistema.\n'
            f'Cada dominio listado acima DEVE ter pelo menos 1 Epic dedicado.\n\n'
            f'A DESCRIPTION de cada Epic DEVE ser em Markdown rico (min 500 chars) com:\n'
            f'## Objetivo\n'
            f'[Descricao funcional do que este modulo faz]\n\n'
            f'## Regras de Negocio Principais\n'
            f'- [Regra concreta extraida do codigo]\n'
            f'- [Regra concreta extraida do codigo]\n\n'
            f'## Entidades e Relacionamentos\n'
            f'- [Entidade e como se relaciona]\n\n'
            f'## Componentes Tecnicos\n'
            f'- Arquivos: [arquivos-chave]\n'
            f'- Servicos: [servicos envolvidos]\n\n'
            f'NAO gere epics genericos (ex: "Configuracao do Sistema").\n'
            f'Cada Epic DEVE estar ligado a regras CONCRETAS fornecidas acima.\n'
            f'Retorne: {{"cards": [...]}}'
        )

        epic_titles = []
        try:
            resp = await orchestrator.execute(
                usage_type="content_generation",
                messages=[{"role": "user", "content": epic_user_prompt}],
                system_prompt=self._load_contract_prompt("pipeline/cards_epic_generation", self.PHASE3_EPIC_PROMPT),
                max_tokens=16384,
                project_id=project_id,
                metadata={"phase": "rag_pipeline_phase3", "batch": "epics",
                          "skip_context_build": True},
                disable_cwd=True,
                disable_tools=True,
            )
            raw = resp.get("content", "")
            if len(raw) >= 50:
                cards_created = self._create_cards_from_json(raw, project_id)
                self.db.commit()
                total_cards += cards_created
                # Collect epic titles for reference in detail batches
                from app.models.task import Task
                epics = self.db.query(Task.title).filter(
                    Task.project_id == project_id,
                    Task.item_type == "epic",
                    Task.reporter == "pipeline_phase3",
                ).all()
                epic_titles = [e.title for e in epics]
                logger.info(f"Phase 3 Pass 1: {cards_created} epics created: {epic_titles}")
        except Exception as e:
            logger.error(f"Phase 3 Pass 1 (epics) failed: {e}")

        if not epic_titles:
            self._set_phase_status(project_id, 3, "failed")
            raise ValueError("Geracao falhou: 0 epics criados no Pass 1")

        jm.update_progress(
            job_id, _p(20),
            f"Fase 3/4: {len(epic_titles)} epics criados, gerando detalhes..."
        )

        # ==========================================
        # PASS 2: Generate Stories/Tasks per entity batch
        # ==========================================

        # Build domain batches (same logic as Phase 4)
        domain_batches: List[Dict[str, Any]] = []
        pending_entities: List[str] = []
        pending_lines: List[str] = []
        pending_chars = 0

        for entity in sorted(entity_rules.keys()):
            lines = entity_rules[entity]
            entity_text = f"\n=== {entity} ({len(lines)} regras) ===\n" + "\n".join(lines)
            entity_chars = len(entity_text)

            if entity_chars > self.PHASE3_BATCH_MAX_CHARS // 2 or \
               len(lines) > self.PHASE3_BATCH_MAX_RULES:
                if pending_lines:
                    domain_batches.append({
                        "entities": pending_entities,
                        "text": "\n".join(pending_lines),
                        "rule_count": sum(len(entity_rules[e]) for e in pending_entities),
                    })
                    pending_entities, pending_lines, pending_chars = [], [], 0
                domain_batches.append({
                    "entities": [entity],
                    "text": entity_text,
                    "rule_count": len(lines),
                })
            else:
                if pending_chars + entity_chars > self.PHASE3_BATCH_MAX_CHARS or \
                   len(pending_entities) >= 8:
                    domain_batches.append({
                        "entities": pending_entities,
                        "text": "\n".join(pending_lines),
                        "rule_count": sum(len(entity_rules[e]) for e in pending_entities),
                    })
                    pending_entities, pending_lines, pending_chars = [], [], 0
                pending_entities.append(entity)
                pending_lines.append(entity_text)
                pending_chars += entity_chars

        if pending_lines:
            domain_batches.append({
                "entities": pending_entities,
                "text": "\n".join(pending_lines),
                "rule_count": sum(len(entity_rules[e]) for e in pending_entities),
            })

        num_detail_batches = len(domain_batches)
        logger.info(f"Phase 3 Pass 2: {num_detail_batches} detail batches")

        # Get full epic data (title + description) for rich context
        from app.models.task import Task as TaskModel
        epics_data = self.db.query(TaskModel.title, TaskModel.description).filter(
            TaskModel.project_id == project_id,
            TaskModel.item_type == "epic",
            TaskModel.reporter == "pipeline_phase3",
        ).all()
        epic_context_lines = []
        for e in epics_data:
            desc_preview = (e.description or "")[:400].replace("\n", " ")
            epic_context_lines.append(f"EPIC: {e.title}\n  Descricao: {desc_preview}")
        epic_context_text = "\n\n".join(epic_context_lines)

        for batch_idx, batch in enumerate(domain_batches):
            batch_num = batch_idx + 1
            local_progress = 20.0 + (75.0 * batch_num / num_detail_batches)
            entities_label = ", ".join(batch["entities"][:3])
            if len(batch["entities"]) > 3:
                entities_label += f" +{len(batch['entities']) - 3}"

            jm.update_progress(
                job_id, _p(local_progress),
                f"Fase 3/4: Lote {batch_num}/{num_detail_batches} "
                f"({entities_label}) — {total_cards} cards"
            )

            detail_user_prompt = (
                f'Projeto: "{project_name}"\n'
                f'Dominio: {", ".join(batch["entities"])}\n'
                f'Regras neste dominio: {batch["rule_count"]}\n\n'
                f'EPICS JA CRIADOS (use parent_title EXATO):\n{epic_context_text}\n\n'
                f'REGRAS DE NEGOCIO DESTE DOMINIO:\n{batch["text"]}\n\n'
                f'---\n'
                f'Gere Stories e Tasks para os Epics acima '
                f'que se relacionam com este dominio.\n\n'
                f'STORIES devem ser conceituais — expandem aspectos funcionais do Epic.\n'
                f'A description de cada Story DEVE ser em Markdown (min 300 chars) com:\n'
                f'## Contexto\n## Funcionalidade\n## Regras Envolvidas\n## Cenarios de Uso\n\n'
                f'TASKS devem ser tecnicas — referenciam arquivos, logica, validacoes concretas.\n\n'
                f'Use parent_title EXATO de um dos Epics listados.\n'
                f'Se nenhum Epic existente se encaixa, crie um novo Epic tambem.\n'
                f'Retorne: {{"cards": [...]}}'
            )

            try:
                resp = await orchestrator.execute(
                    usage_type="content_generation",
                    messages=[{"role": "user", "content": detail_user_prompt}],
                    system_prompt=self._load_contract_prompt("pipeline/cards_detail_generation", self.PHASE3_DETAIL_PROMPT),
                    max_tokens=16384,
                    project_id=project_id,
                    metadata={
                        "phase": "rag_pipeline_phase3",
                        "batch": batch_num,
                        "entities": batch["entities"][:5],
                        "skip_context_build": True,
                    },
                    disable_cwd=True,
                    disable_tools=True,
                )
                raw = resp.get("content", "")
                if len(raw) >= 50:
                    batch_cards = self._create_cards_from_json(raw, project_id)
                    self.db.commit()
                    total_cards += batch_cards
                    logger.info(
                        f"Phase 3 batch {batch_num}/{num_detail_batches} "
                        f"({entities_label}): {batch_cards} cards (total: {total_cards})"
                    )
            except Exception as e:
                logger.warning(f"Phase 3 batch {batch_num} failed: {e}")
                continue

        if total_cards == 0:
            self._set_phase_status(project_id, 3, "failed")
            raise ValueError("Geracao falhou: 0 cards criados")

        self._set_phase_status(project_id, 3, "completed")
        jm.update_progress(
            job_id, _p(95),
            f"Fase 3/4: Concluida — {total_cards} cards em {num_detail_batches + 1} lotes"
        )
        return {
            "phase": "generate_cards",
            "cards_created": total_cards,
            "rules_in_rag": rule_count,
            "epic_count": len(epic_titles),
            "detail_batches": num_detail_batches,
        }

    # =====================================================================
    # PHASE 3 VALIDATORS — strict contract enforcement for cards
    # =====================================================================

    VALID_ITEM_TYPES = frozenset({"epic", "story", "task"})
    VALID_FIBONACCI = frozenset({1, 2, 3, 5, 8, 13})
    TYPE_ORDER = {"epic": 0, "story": 1, "task": 2}
    EXPECTED_PARENT_TYPE = {"story": "epic", "task": "story"}

    @staticmethod
    def _flatten_nested_to_cards(parsed: dict) -> list:
        """
        Fallback: convert nested epics[]/stories[]/tasks[] format
        to flat cards[] array with parent_title links.
        Handles any combination of nested keys.
        """
        flat = []

        def _extract_children(items, parent_title, item_type):
            if not isinstance(items, list):
                return
            for item in items:
                if not isinstance(item, dict):
                    continue
                card = {k: v for k, v in item.items()
                        if k not in ("stories", "tasks", "children")}
                card["item_type"] = card.get("item_type", item_type)
                card["parent_title"] = parent_title
                flat.append(card)
                title = str(card.get("title", "")).strip()
                # Recurse into nested children
                for child_key, child_type in [
                    ("stories", "story"), ("tasks", "task"),
                    ("children", None),
                ]:
                    if child_key in item:
                        _extract_children(
                            item[child_key],
                            title,
                            child_type or card["item_type"],
                        )

        # Try various nested keys
        for root_key, root_type in [
            ("epics", "epic"), ("modules", "epic"),
            ("stories", "story"), ("tasks", "task"),
        ]:
            if root_key in parsed and isinstance(parsed[root_key], list):
                _extract_children(parsed[root_key], None, root_type)

        return flat

    def _create_cards_from_json(self, raw: str, project_id: UUID) -> int:
        """Parse, VALIDATE and create Task records from AI JSON response.
        Rejects any card that violates the contract.
        Falls back to nested-to-flat conversion if 'cards' key is missing."""
        from app.models.task import Task

        parsed = self._extract_json(raw)
        raw_cards = parsed.get("cards", [])
        if not isinstance(raw_cards, list) or len(raw_cards) == 0:
            # Fallback: try to flatten nested format (epics[]/stories[]/tasks[])
            raw_cards = self._flatten_nested_to_cards(parsed)
            if raw_cards:
                logger.info(
                    f"Phase 3: Converted nested format to {len(raw_cards)} flat cards"
                )

        # ---- PASS 1: Validate and collect valid cards ----
        valid_cards = []
        rejected = 0

        for card in raw_cards:
            if not isinstance(card, dict):
                rejected += 1
                continue

            title = str(card.get("title") or "").strip()
            description = str(card.get("description") or "").strip()
            item_type = str(card.get("item_type") or "").strip().lower()
            parent_title = (card.get("parent_title") or None)
            if parent_title is not None:
                parent_title = str(parent_title).strip() or None
            story_points = card.get("story_points")
            priority = str(card.get("priority") or "").strip().lower()
            complexity = str(card.get("complexity") or "").strip().lower()
            labels = card.get("labels", [])
            ac_list = card.get("acceptance_criteria", [])

            # ---- STRICT VALIDATION ----
            if len(title) < 5 or len(title) > 255:
                rejected += 1
                continue
            if len(description) < 50:
                rejected += 1
                continue
            if item_type not in self.VALID_ITEM_TYPES:
                rejected += 1
                continue
            if priority not in self.VALID_PRIORITIES:
                priority = "medium"  # safe default
            # complexity: validate enum, smart default by item_type
            if complexity not in ("low", "medium", "high"):
                complexity = {"epic": "high", "story": "medium", "task": "medium"}.get(item_type, "medium")
            # story_points: coerce to int, validate Fibonacci
            try:
                story_points = int(story_points) if story_points is not None else 3
            except (ValueError, TypeError):
                story_points = 3
            if story_points not in self.VALID_FIBONACCI:
                # Snap to nearest Fibonacci
                story_points = min(self.VALID_FIBONACCI, key=lambda x: abs(x - story_points))
            # labels: validate array of strings
            if not isinstance(labels, list):
                labels = []
            labels = [
                str(l).strip().lower().replace(" ", "-")[:50]
                for l in labels
                if isinstance(l, str) and len(str(l).strip()) >= 2
            ][:10]
            # acceptance_criteria: validate array of strings
            if not isinstance(ac_list, list):
                ac_list = []
            acceptance_criteria = []
            for ac in ac_list[:20]:
                if isinstance(ac, str) and len(ac.strip()) >= 10:
                    acceptance_criteria.append({"text": ac.strip()[:2000], "completed": False})
                elif isinstance(ac, dict) and ac.get("text") and len(str(ac["text"]).strip()) >= 10:
                    acceptance_criteria.append({
                        "text": str(ac["text"]).strip()[:2000],
                        "completed": bool(ac.get("completed", False)),
                    })

            # ---- Extract new fields ----
            generated_prompt = str(card.get("generated_prompt") or "").strip()
            components = card.get("components", [])
            if not isinstance(components, list):
                components = []
            components = [str(c).strip()[:100] for c in components if isinstance(c, str) and len(str(c).strip()) >= 2][:20]
            card_type = str(card.get("type") or "").strip().lower()[:100] or None
            entity = str(card.get("entity") or "").strip()[:100] or None
            depends_on_titles = card.get("depends_on_titles", [])
            if not isinstance(depends_on_titles, list):
                depends_on_titles = []
            depends_on_titles = [str(d).strip() for d in depends_on_titles if isinstance(d, str) and len(str(d).strip()) >= 2]

            valid_cards.append({
                "title": title[:255],
                "description": description[:10000],
                "item_type": item_type,
                "parent_title": parent_title,
                "story_points": story_points,
                "priority": priority,
                "complexity": complexity,
                "labels": labels,
                "acceptance_criteria": acceptance_criteria or None,
                "generated_prompt": generated_prompt[:20000] if generated_prompt else None,
                "components": components,
                "type": card_type,
                "entity": entity,
                "depends_on_titles": depends_on_titles,
            })

        if rejected:
            logger.info(f"Phase 3 validator: {len(valid_cards)} accepted, {rejected} rejected")

        if not valid_cards:
            return 0

        # ---- Sort by hierarchy level: epics first, then stories, tasks ----
        valid_cards.sort(key=lambda c: self.TYPE_ORDER.get(c["item_type"], 99))

        # ---- PASS 2: Create DB records ----
        # Pre-populate title_to_id with cards from previous passes (cross-pass linking)
        existing = self.db.query(Task.title, Task.id, Task.item_type).filter(
            Task.project_id == project_id,
            Task.reporter == "pipeline_phase3",
        ).all()
        title_to_id = {t.title: t.id for t in existing}
        title_to_type = {t.title: t.item_type for t in existing}
        created = 0

        # DB column complexity is integer: low=1, medium=2, high=3
        COMPLEXITY_MAP = {"low": 1, "medium": 2, "high": 3}

        for card in valid_cards:
            task = Task(
                title=card["title"],
                description=card["description"],
                item_type=card["item_type"],
                project_id=project_id,
                workflow_state="open",
                reporter="pipeline_phase3",
                story_points=card["story_points"],
                priority=card["priority"],
                complexity=COMPLEXITY_MAP.get(card["complexity"], 2),
                labels=card["labels"],
                acceptance_criteria=card["acceptance_criteria"],
                generated_prompt=card.get("generated_prompt"),
                components=card.get("components", []),
                type=card.get("type"),
                entity=card.get("entity"),
                description_edited_by="ai",
                prompt_edited_by="ai" if card.get("generated_prompt") else None,
                created_by_ai_model="pipeline_phase3_sonnet",
                order=created,
            )
            self.db.add(task)
            self.db.flush()
            title_to_id[task.title] = task.id
            title_to_type[task.title] = task.item_type
            created += 1

        # ---- PASS 3: Set parent_id with hierarchy validation ----
        linked = 0
        orphans = 0
        for card in valid_cards:
            title = card["title"]
            parent_title = card.get("parent_title")
            item_type = card["item_type"]

            if not parent_title or item_type == "epic":
                continue  # epics are root, no parent needed

            if title not in title_to_id:
                continue

            if parent_title not in title_to_id:
                orphans += 1
                logger.warning(f"Phase 3 orphan: '{title}' ({item_type}) -> parent '{parent_title}' not found")
                continue

            # Validate parent type compatibility
            expected_parent = self.EXPECTED_PARENT_TYPE.get(item_type)
            actual_parent_type = title_to_type.get(parent_title)
            if expected_parent and actual_parent_type and actual_parent_type != expected_parent:
                logger.warning(
                    f"Phase 3 hierarchy mismatch: '{title}' ({item_type}) -> '{parent_title}' "
                    f"is {actual_parent_type}, expected {expected_parent}. Linking anyway."
                )

            self.db.execute(sql_text(
                "UPDATE tasks SET parent_id = :parent_id WHERE id = :task_id"
            ), {
                "parent_id": str(title_to_id[parent_title]),
                "task_id": str(title_to_id[title]),
            })
            linked += 1

        if orphans:
            logger.warning(f"Phase 3: {orphans} orphan cards (parent_title not found in DB)")

        # ---- PASS 4: Resolve depends_on_titles to task IDs ----
        deps_resolved = 0
        for card in valid_cards:
            dep_titles = card.get("depends_on_titles", [])
            if not dep_titles:
                continue
            title = card["title"]
            if title not in title_to_id:
                continue
            dep_ids = []
            for dt in dep_titles:
                if dt in title_to_id:
                    dep_ids.append(str(title_to_id[dt]))
            if dep_ids:
                self.db.execute(sql_text(
                    "UPDATE tasks SET depends_on = :deps WHERE id = :task_id"
                ), {"deps": json.dumps(dep_ids), "task_id": str(title_to_id[title])})
                deps_resolved += 1

        logger.info(f"Phase 3: {created} created, {linked} linked to parents, {deps_resolved} with dependencies")

        return created

    # =========================================================================
    # PHASE 4: Generate wiki + title + description via single AI prompt
    # Uses enable_rag=True to inject all project context from RAG.
    # =========================================================================

    # Phase 4 system prompt for OVERVIEW batch (title + description + general pages)
    PHASE4_OVERVIEW_PROMPT = (
        "Voce e um documentador tecnico senior. Voce vai receber regras de negocio "
        "REAIS de um projeto com exemplos concretos. Gere titulo, descricao e paginas wiki GERAIS.\n\n"
        "PAGINAS GERAIS A GERAR (visao macro do projeto):\n"
        "  visao-geral | padroes-arquitetura | convencoes-codigo | estrutura-codigo\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "CONTRATO JSON RIGIDO — Responda APENAS com JSON puro, sem markdown.\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "{\n"
        '  "title": "string, 5-120 chars, titulo claro do projeto",\n'
        '  "description": "string, 50-2000 chars, descricao detalhada",\n'
        '  "wiki_pages": [{"slug":"kebab-case","title":"Titulo","content":"Markdown RICO min 500 chars","order":1}]\n'
        "}\n\n"
        "REGRAS:\n"
        "- slug: kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$), UNICO\n"
        "- content: MINIMO 500 caracteres Markdown RICO (##, ###, listas, tabelas, codigo)\n"
        "  Idealmente 2000-8000 chars por pagina. QUANTO MAIS DETALHADO, MELHOR.\n"
        "- CITE nomes REAIS de entidades, classes, arquivos e servicos das regras fornecidas\n"
        "- NAO use termos genericos ('o sistema', 'a aplicacao') — use nomes REAIS do projeto\n"
        "- Cada pagina deve referenciar pelo menos 3 regras de negocio concretas\n"
        "- Todos os textos em PORTUGUES. NUNCA gere textos em ingles.\n"
        "- Conteudo FACTUAL baseado nas regras fornecidas\n"
        "- NAO invente features que nao existem nas regras"
    )

    # Phase 4 system prompt for DOMAIN batches (one call per entity/domain)
    PHASE4_DOMAIN_PROMPT = (
        "IMPORTANTE: Voce NAO tem acesso a ferramentas. Analise APENAS as regras fornecidas.\n\n"
        "Voce e um documentador tecnico senior. Voce vai receber regras de negocio "
        "de um DOMINIO ESPECIFICO de um projeto. Gere paginas wiki DETALHADAS "
        "cobrindo COMPLETAMENTE esse dominio.\n\n"
        "TIPOS DE PAGINAS A GERAR (adapte ao dominio):\n"
        "- Pagina principal do dominio (visao geral, entidades, relacionamentos)\n"
        "- Regras de negocio do dominio (listagem completa com evidencias de codigo)\n"
        "- Fluxos e workflows do dominio (se houver regras de workflow)\n"
        "- Endpoints/API do dominio (se houver regras de integracao)\n"
        "- Validacoes e restricoes (se houver regras de validacao)\n"
        "- Modelo de dados (entidades, campos, relacionamentos)\n"
        "- Gere QUANTAS paginas forem necessarias para cobrir o dominio COMPLETAMENTE\n\n"
        "QUALIDADE OBRIGATORIA POR PAGINA:\n"
        "- CITE nomes REAIS de entidades, classes, arquivos e servicos das regras fornecidas\n"
        "- NAO use termos genericos ('o sistema', 'a aplicacao') — use nomes REAIS do projeto\n"
        "- Quando houver 'Evidencia:', inclua o trecho de codigo como bloco ```python ou ```typescript\n"
        "- Referencie PELO MENOS 3 regras de negocio concretas por pagina\n"
        "- Explique o PROPOSITO funcional de cada regra (ponto de vista do usuario)\n"
        "- Inclua diagramas de relacionamento em texto quando pertinente\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "CONTRATO JSON RIGIDO — Responda APENAS com JSON puro, sem markdown.\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        '{"wiki_pages": [{"slug":"kebab-case","title":"Titulo","content":"Markdown RICO min 500 chars","order":1}]}\n\n'
        "REGRAS:\n"
        "- slug: kebab-case, UNICO, prefixe com dominio (ex: auth-visao-geral, task-regras)\n"
        "- content: MINIMO 500 caracteres Markdown RICO (##, ###, listas, tabelas, codigo)\n"
        "  Idealmente 2000-8000 chars por pagina. SEJA EXTENSO E DETALHADO.\n"
        "  CADA pagina DEVE citar nomes REAIS de entidades, arquivos, endpoints e servicos.\n"
        "  Inclua trechos de codigo como evidencia quando disponivel nas regras.\n"
        "- Todos os textos em PORTUGUES. NUNCA gere textos em ingles.\n"
        "- Conteudo 100% FACTUAL — apenas o que esta nas regras fornecidas\n"
        "- Gere TODAS as paginas necessarias para cobertura TOTAL do dominio"
    )

    # Batch config for Phase 4
    PHASE4_BATCH_MAX_RULES = 80
    PHASE4_BATCH_MAX_CHARS = 60000

    async def phase_4_generate_wiki(self, project_id: UUID, job_id: UUID,
                                     pmin: float = 0.0, pmax: float = 100.0) -> Dict[str, Any]:
        """
        Phase 4: Generate wiki pages + project title + project description.

        Multi-batch approach for UNLIMITED coverage:
        - Batch 0: Overview (title, description, general architecture pages)
        - Batch 1..N: One batch per entity/domain group of rules
        Each batch generates its own wiki pages. No artificial page limit.
        """
        self._set_phase_status(project_id, 4, "running")
        jm = JobManager(self.db)
        _p = lambda local: self._map_progress(local, pmin, pmax)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        jm.update_progress(job_id, _p(5), "Fase 4/4: Carregando regras de negocio...")

        # Load ALL business rules from DB, grouped by entity
        rule_rows = self.db.execute(sql_text(
            "SELECT content, metadata FROM rag_documents "
            "WHERE project_id = :pid AND metadata->>'type' = 'business_rule' "
            "ORDER BY metadata->>'entity', metadata->>'rule_type'"
        ), {"pid": str(project_id)}).fetchall()

        # Apply project-relative ignore patterns (PROMPT #253)
        ignore_patterns = self._load_ignore_patterns(project)
        rules_before = len(rule_rows)
        rule_rows = [
            r for r in rule_rows
            if not self._is_path_ignored(
                (r[1] if isinstance(r[1], dict) else {}).get("source_file", ""),
                ignore_patterns,
            )
        ]
        if rules_before != len(rule_rows):
            logger.info(
                f"Phase 4: Filtered {rules_before - len(rule_rows)} rules from ignored paths "
                f"({len(rule_rows)} remaining of {rules_before})"
            )

        rule_count = len(rule_rows)
        if rule_count == 0:
            self._set_phase_status(project_id, 4, "failed")
            raise ValueError("Nenhuma regra de negocio encontrada. Execute Phase 2 primeiro.")

        # Group rules by entity → domain batches
        entity_rules: Dict[str, List[str]] = {}
        summary_by_type: Dict[str, int] = {}
        for row in rule_rows:
            content = row[0] or ""
            meta = row[1] if isinstance(row[1], dict) else {}
            entity = meta.get("domain") or meta.get("entity") or "Geral"
            rule_type = meta.get("rule_type", "outro")
            source = meta.get("source_file", "?")
            evidence = meta.get("evidence", "")
            line = f"[{rule_type}|{source}] {content}"
            if evidence:
                line += f"\n  Evidencia: {evidence[:200]}"
            entity_rules.setdefault(entity, []).append(line)
            summary_by_type[rule_type] = summary_by_type.get(rule_type, 0) + 1

        # Merge small entities into combined batches to avoid too many tiny calls
        domain_batches: List[Dict[str, Any]] = []
        pending_entities: List[str] = []
        pending_lines: List[str] = []
        pending_chars = 0

        for entity in sorted(entity_rules.keys()):
            lines = entity_rules[entity]
            entity_text = f"\n=== Entidade: {entity} ({len(lines)} regras) ===\n" + "\n".join(lines)
            entity_chars = len(entity_text)

            # If single entity is big enough for its own batch
            if entity_chars > self.PHASE4_BATCH_MAX_CHARS // 2 or len(lines) > self.PHASE4_BATCH_MAX_RULES:
                # Flush pending first
                if pending_lines:
                    domain_batches.append({
                        "entities": pending_entities,
                        "text": "\n".join(pending_lines),
                        "rule_count": sum(len(entity_rules[e]) for e in pending_entities),
                    })
                    pending_entities, pending_lines, pending_chars = [], [], 0
                # Add as own batch
                domain_batches.append({
                    "entities": [entity],
                    "text": entity_text,
                    "rule_count": len(lines),
                })
            else:
                # Accumulate into pending batch
                if pending_chars + entity_chars > self.PHASE4_BATCH_MAX_CHARS or \
                   len(pending_entities) >= 10:
                    domain_batches.append({
                        "entities": pending_entities,
                        "text": "\n".join(pending_lines),
                        "rule_count": sum(len(entity_rules[e]) for e in pending_entities),
                    })
                    pending_entities, pending_lines, pending_chars = [], [], 0
                pending_entities.append(entity)
                pending_lines.append(entity_text)
                pending_chars += entity_chars

        if pending_lines:
            domain_batches.append({
                "entities": pending_entities,
                "text": "\n".join(pending_lines),
                "rule_count": sum(len(entity_rules[e]) for e in pending_entities),
            })

        total_batches = len(domain_batches) + 1  # +1 for overview batch
        logger.info(
            f"Phase 4: {rule_count} rules, {len(entity_rules)} entities, "
            f"{total_batches} batches (1 overview + {len(domain_batches)} domain)"
        )

        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)
        project_name = project.name or "Projeto"

        total_pages = 0
        title_generated = False
        desc_generated = False
        page_order = 1

        # ---- BATCH 0: Overview (title + description + general pages) ----
        jm.update_progress(job_id, _p(10), "Fase 4/4: Gerando visao geral do projeto...")

        type_summary = "\n".join([f"- {t}: {c} regras" for t, c in sorted(summary_by_type.items())])

        # Build rich entity summary with sample rules (3-5 per domain)
        entity_summary_lines = []
        for e in sorted(entity_rules.keys()):
            rules = entity_rules[e]
            entity_summary_lines.append(f"\n=== {e} ({len(rules)} regras) ===")
            for sample_rule in rules[:5]:
                entity_summary_lines.append(f"  - {sample_rule[:300]}")
        entity_summary = "\n".join(entity_summary_lines)

        # Truncate if too large
        MAX_OVERVIEW_CONTEXT = 80000
        if len(entity_summary) > MAX_OVERVIEW_CONTEXT:
            entity_summary = entity_summary[:MAX_OVERVIEW_CONTEXT] + "\n... (truncado)"

        overview_prompt = (
            f'Projeto: "{project_name}"\n'
            f'Total de regras de negocio: {rule_count}\n\n'
            f'DISTRIBUICAO POR TIPO:\n{type_summary}\n\n'
            f'REGRAS DE NEGOCIO POR DOMINIO (com exemplos):\n{entity_summary}\n\n'
            f'---\n'
            f'INSTRUCOES:\n'
            f'1. Analise as regras REAIS acima para entender o projeto\n'
            f'2. Gere um titulo e descricao que reflitam o que o projeto REALMENTE faz\n'
            f'3. Gere paginas wiki GERAIS do projeto:\n'
            f'   - visao-geral (overview completo do sistema, citando modulos REAIS)\n'
            f'   - padroes-arquitetura (arquitetura, design patterns encontrados nas regras)\n'
            f'   - convencoes-codigo (convencoes e boas praticas identificadas no codigo)\n'
            f'   - estrutura-codigo (organizacao de pastas e modulos baseada nos arquivos reais)\n'
            f'4. CITE nomes REAIS de entidades, arquivos e servicos das regras acima\n'
            f'5. NAO use termos genericos — use nomes do projeto\n'
            f'Retorne JSON conforme contrato.'
        )

        try:
            resp = await orchestrator.execute(
                usage_type="content_generation",
                messages=[{"role": "user", "content": overview_prompt}],
                system_prompt=self._load_contract_prompt("pipeline/wiki_overview_generation", self.PHASE4_OVERVIEW_PROMPT),
                max_tokens=16384,
                project_id=project_id,
                metadata={"phase": "rag_pipeline_phase4", "batch": "overview"},
                disable_cwd=True,
                disable_tools=True,
            )
            raw = resp.get("content", "")
            if len(raw) >= 50:
                wiki_result = self._save_wiki_and_metadata(raw, project_id, project)
                self.db.commit()
                batch_pages = wiki_result["pages_created"]
                total_pages += batch_pages
                page_order += batch_pages
                title_generated = wiki_result.get("title_generated", False)
                desc_generated = wiki_result.get("description_generated", False)
                logger.info(f"Phase 4 overview: {batch_pages} pages")
        except Exception as e:
            logger.warning(f"Phase 4 overview batch failed: {e}")

        # ---- BATCHES 1..N: Domain-specific pages ----
        for batch_idx, batch in enumerate(domain_batches):
            batch_num = batch_idx + 1
            local_progress = 15.0 + (80.0 * batch_num / len(domain_batches))
            entities_label = ", ".join(batch["entities"][:3])
            if len(batch["entities"]) > 3:
                entities_label += f" +{len(batch['entities']) - 3}"
            jm.update_progress(
                job_id, _p(local_progress),
                f"Fase 4/4: Wiki dominio {batch_num}/{len(domain_batches)} "
                f"({entities_label}) — {total_pages} paginas ate agora"
            )

            domain_prompt = (
                f'Projeto: "{project_name}"\n'
                f'Dominio: {", ".join(batch["entities"])}\n'
                f'Regras neste dominio: {batch["rule_count"]}\n\n'
                f'REGRAS DE NEGOCIO DESTE DOMINIO (com evidencias de codigo):\n'
                f'{batch["text"]}\n\n'
                f'---\n'
                f'INSTRUCOES DE DOCUMENTACAO:\n'
                f'1. Analise TODAS as regras acima — cada regra deve aparecer na wiki\n'
                f'2. Gere paginas wiki DETALHADAS cobrindo COMPLETAMENTE este dominio\n'
                f'3. Gere QUANTAS paginas forem necessarias. Nao se limite.\n'
                f'4. Cada pagina deve ter conteudo RICO e EXTENSO (2000-8000 chars)\n'
                f'5. CITE nomes REAIS de entidades, classes, arquivos e servicos das regras\n'
                f'6. Quando a regra incluir "Evidencia:", cite o trecho de codigo na wiki\n'
                f'7. Explique cada regra do ponto de vista FUNCIONAL (experiencia do usuario)\n'
                f'8. Inclua secoes: ## Visao Geral, ## Regras de Negocio, ## Modelo de Dados,\n'
                f'   ## Fluxos e Workflows, ## Endpoints/API (quando aplicavel)\n'
                f'Use order sequencial comecando em {page_order}.\n'
                f'Retorne JSON: {{"wiki_pages": [...]}}.'
            )

            try:
                resp = await orchestrator.execute(
                    usage_type="content_generation",
                    messages=[{"role": "user", "content": domain_prompt}],
                    system_prompt=self._load_contract_prompt("pipeline/wiki_domain_generation", self.PHASE4_DOMAIN_PROMPT),
                    max_tokens=16384,
                    project_id=project_id,
                    metadata={
                        "phase": "rag_pipeline_phase4",
                        "batch": batch_num,
                        "entities": batch["entities"][:5],
                    },
                    disable_cwd=True,
                    disable_tools=True,
                )
                raw = resp.get("content", "")
                if len(raw) >= 50:
                    wiki_result = self._save_wiki_and_metadata(raw, project_id, project)
                    self.db.commit()
                    batch_pages = wiki_result["pages_created"]
                    total_pages += batch_pages
                    page_order += batch_pages
                    logger.info(
                        f"Phase 4 domain {batch_num}/{len(domain_batches)} "
                        f"({entities_label}): {batch_pages} pages (total: {total_pages})"
                    )
            except Exception as e:
                logger.warning(f"Phase 4 domain batch {batch_num} failed: {e}")
                continue

        if total_pages == 0:
            self._set_phase_status(project_id, 4, "failed")
            raise ValueError("Geracao falhou: 0 paginas wiki criadas")

        self._set_phase_status(project_id, 4, "completed")
        jm.update_progress(
            job_id, _p(95),
            f"Fase 4/4: Concluida — {total_pages} wiki pages em {total_batches} lotes"
        )
        return {
            "phase": "generate_wiki",
            "pages_created": total_pages,
            "title_generated": title_generated,
            "description_generated": desc_generated,
            "rules_used": rule_count,
            "batches": total_batches,
        }

    # =====================================================================
    # PHASE 4 VALIDATORS — strict contract enforcement for wiki/title/desc
    # =====================================================================

    SLUG_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')

    def _save_wiki_and_metadata(self, raw: str, project_id: UUID, project: Project) -> Dict:
        """Parse, VALIDATE and save wiki pages, title, description.
        Rejects any page that violates the contract."""
        from app.services.wiki_service import _upsert_wiki_page

        result = {"pages_created": 0, "title_generated": False, "description_generated": False}

        parsed = self._extract_json(raw)
        if not parsed:
            logger.warning("Phase 4: no valid JSON found in response")
            return result

        # ---- PROJECT TITLE — strict validation + REGRA #0 ----
        title = str(parsed.get("title") or "").strip()
        if title and 5 <= len(title) <= 120:
            # Remove line breaks (contract violation)
            title = title.replace("\n", " ").replace("\r", "")
            # REGRA #0: Only set if empty (human data is sacred)
            if not (project.name and project.name.strip()):
                project.name = title
                result["title_generated"] = True
                logger.info(f"Phase 4: Generated title: {title}")
        elif title:
            logger.warning(f"Phase 4: title rejected (len={len(title)}, must be 5-120)")

        # ---- PROJECT DESCRIPTION — strict validation + REGRA #0 ----
        description = str(parsed.get("description") or "").strip()
        if description and 50 <= len(description) <= 2000:
            # REGRA #0: Only set if empty
            if not (project.description and project.description.strip()):
                project.description = description
                result["description_generated"] = True
                logger.info(f"Phase 4: Generated description ({len(description)} chars)")
        elif description and len(description) >= 20:
            # Relax slightly: accept 20+ chars but truncate to 2000
            if not (project.description and project.description.strip()):
                project.description = description[:2000]
                result["description_generated"] = True
        elif description:
            logger.warning(f"Phase 4: description rejected (len={len(description)}, must be 50-2000)")

        # ---- WIKI PAGES — strict validation ----
        code_path = project.code_path
        wiki_pages = parsed.get("wiki_pages", [])
        if not isinstance(wiki_pages, list):
            logger.warning("Phase 4: 'wiki_pages' is not a list")
            return result

        seen_slugs = set()
        rejected = 0

        for page in wiki_pages:
            if not isinstance(page, dict):
                rejected += 1
                continue

            slug = str(page.get("slug") or "").strip().lower()
            page_title = str(page.get("title") or "").strip()
            content = str(page.get("content") or "").strip()
            order = page.get("order", 1)

            # ---- STRICT VALIDATION ----
            # slug: kebab-case, 3-80 chars
            if not slug or len(slug) < 3 or len(slug) > 80:
                rejected += 1
                continue
            if not self.SLUG_RE.match(slug):
                # Try to auto-fix: replace spaces/underscores with hyphens
                slug = re.sub(r'[^a-z0-9]+', '-', slug).strip('-')
                if not self.SLUG_RE.match(slug) or len(slug) < 3:
                    rejected += 1
                    continue
            # Unique slug
            if slug in seen_slugs:
                rejected += 1
                continue
            seen_slugs.add(slug)

            # title: 3-100 chars
            if len(page_title) < 3:
                page_title = slug.replace("-", " ").title()
            page_title = page_title[:200]

            # content: min 500 chars of actual Markdown
            if len(content) < 500:
                rejected += 1
                logger.warning(f"Phase 4: wiki '{slug}' rejected (content too short: {len(content)} chars)")
                continue

            # order: coerce to int
            try:
                order = int(order)
            except (ValueError, TypeError):
                order = 1

            try:
                _upsert_wiki_page(
                    code_path, project_id, slug,
                    page_title, content,
                    order, "ai_generated"
                )
                # Index wiki page in RAG
                self.rag.store(
                    content=content,
                    metadata={"type": "wiki_page", "slug": slug, "title": page_title},
                    project_id=project_id,
                )
                result["pages_created"] += 1
            except Exception as e:
                logger.warning(f"Wiki page '{slug}' save failed: {e}")

        if rejected:
            logger.info(f"Phase 4 validator: {result['pages_created']} pages accepted, {rejected} rejected")

        return result

    # =========================================================================
    # FULL PIPELINE: Run all 4 phases sequentially (25% each)
    # =========================================================================

    async def run_full_pipeline(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Run all 4 phases sequentially under a SINGLE job.
        Progress is split evenly: 0-25% (Phase 1), 25-50% (Phase 2),
        50-75% (Phase 3), 75-100% (Phase 4).
        """
        jm = JobManager(self.db)
        results = {}

        # Phase 1: Index files (0-25%)
        jm.update_progress(job_id, 0.0, "Fase 1/4: Iniciando indexacao de arquivos...")
        try:
            r1 = await self.phase_1_index_files(project_id, job_id, pmin=0.0, pmax=25.0)
            results["phase_1"] = r1
            jm.update_progress(job_id, 25.0, "Fase 1/4: Concluida")
        except Exception as e:
            logger.error(f"Full pipeline: Phase 1 failed: {e}")
            raise ValueError(f"Fase 1 falhou: {e}")

        # Phase 2: Extract rules (25-50%)
        jm.update_progress(job_id, 25.0, "Fase 2/4: Iniciando extracao de regras...")
        try:
            r2 = await self.phase_2_extract_rules(project_id, job_id, pmin=25.0, pmax=50.0)
            results["phase_2"] = r2
            jm.update_progress(job_id, 50.0, "Fase 2/4: Concluida")
        except Exception as e:
            logger.error(f"Full pipeline: Phase 2 failed: {e}")
            raise ValueError(f"Fase 2 falhou: {e}")

        # Phase 3: Generate cards (50-75%)
        jm.update_progress(job_id, 50.0, "Fase 3/4: Iniciando geracao de cards...")
        try:
            r3 = await self.phase_3_generate_cards(project_id, job_id, pmin=50.0, pmax=75.0)
            results["phase_3"] = r3
            jm.update_progress(job_id, 75.0, "Fase 3/4: Concluida")
        except Exception as e:
            logger.error(f"Full pipeline: Phase 3 failed: {e}")
            raise ValueError(f"Fase 3 falhou: {e}")

        # Phase 4: Generate wiki (75-100%)
        jm.update_progress(job_id, 75.0, "Fase 4/4: Iniciando geracao de wiki...")
        try:
            r4 = await self.phase_4_generate_wiki(project_id, job_id, pmin=75.0, pmax=100.0)
            results["phase_4"] = r4
            jm.update_progress(job_id, 100.0, "Pipeline completo!")
        except Exception as e:
            logger.error(f"Full pipeline: Phase 4 failed: {e}")
            raise ValueError(f"Fase 4 falhou: {e}")

        return {
            "phase": "full_pipeline",
            "phases_completed": 4,
            **results,
        }

    # =========================================================================
    # File helpers
    # =========================================================================
    @staticmethod
    def _detect_language(file_path: str) -> str:
        """Detect programming language from file extension."""
        ext = Path(file_path).suffix.lower()
        LANG_MAP = {
            ".py": "python", ".js": "javascript", ".ts": "typescript",
            ".tsx": "typescript", ".jsx": "javascript", ".java": "java",
            ".rb": "ruby", ".go": "go", ".rs": "rust", ".php": "php",
            ".c": "c", ".cpp": "cpp", ".h": "c", ".cs": "csharp",
            ".swift": "swift", ".kt": "kotlin", ".scala": "scala",
            ".html": "html", ".css": "css", ".scss": "scss",
            ".sql": "sql", ".sh": "shell", ".yaml": "yaml", ".yml": "yaml",
            ".json": "json", ".md": "markdown", ".xml": "xml",
        }
        return LANG_MAP.get(ext, "unknown")

    # =========================================================================
    # Git commit helpers (used by Phase 4)
    # =========================================================================
    NOISE_COMMIT_PATTERNS = [
        "merge branch", "merge pull request", "initial commit",
        "wip", "fix typo", "update readme", "bump version",
        "auto-commit", "generated", "revert",
    ]

    def _extract_git_commits(self, code_path: str, max_commits: int = 200) -> List[Dict[str, str]]:
        """Extract recent git commits from repository."""
        git_dir = Path(code_path) / ".git"
        if not git_dir.exists():
            return []
        try:
            result = subprocess.run(
                ["git", "log", f"--pretty=format:%H|||%s|||%b|||%an|||%ad",
                 "--date=short", f"-{max_commits}"],
                cwd=code_path, capture_output=True, text=True, timeout=30
            )
            if result.returncode != 0:
                return []
            commits = []
            for line in result.stdout.strip().split("\n"):
                if not line.strip():
                    continue
                parts = line.split("|||")
                if len(parts) >= 2:
                    subject = parts[1].strip()
                    if any(p in subject.lower() for p in self.NOISE_COMMIT_PATTERNS):
                        continue
                    if len(subject) < 5:
                        continue
                    commits.append({
                        "hash": parts[0].strip()[:12],
                        "subject": subject,
                        "body": parts[2].strip() if len(parts) > 2 else "",
                        "author": parts[3].strip() if len(parts) > 3 else "",
                        "date": parts[4].strip() if len(parts) > 4 else "",
                    })
            return commits
        except Exception:
            return []

