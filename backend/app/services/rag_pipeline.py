"""
RAG Pipeline Service - 4-Phase Sequential Pipeline with Redis State

PROMPT #252 - Progressive pipeline triggered by manual buttons:
  Phase 1: Index files in RAG (embedding only, no AI)
  Phase 2: Extract business rules via AI (usage_type=task_execution)
  Phase 3: Generate cards from business rules (closed status)
  Phase 4: Generate wiki + project title + description (1 AI call)

State stored in Redis: rag:pipeline:{project_id}
"""

import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from app.models.async_job import AsyncJob, JobType, JobStatus
from app.models.project import Project
from app.models.rag_file_state import RAGFileState, FileProcessingStatus, FileSemanticLayer
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
    async def phase_1_index_files(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 1: Scan filesystem and embed all files via Nomic (no AI calls).
        Files go from PENDING → INDEXED status.
        """
        self._set_phase_status(project_id, 1, "running")
        jm = JobManager(self.db)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        # Step 1: Scan for changes (detect new/modified/deleted files)
        jm.update_progress(job_id, 5.0, "Fase 1/4: Detectando arquivos...")
        scan_result = await self.continuous_rag.scan_for_changes(project_id)
        logger.info(f"Phase 1 scan: {scan_result}")

        # Step 2: Process deleted files
        await self.continuous_rag.process_deleted_files(project_id)

        # Step 3: Embed each PENDING file (no AI)
        pending_files = self.db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status == FileProcessingStatus.PENDING,
        ).all()

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
                pct = 10 + (80 * (i + 1) / max(total, 1))
                if (i + 1) % 20 == 0 or i == total - 1:
                    jm.update_progress(job_id, pct,
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
        jm.update_progress(job_id, 95.0, f"Fase 1/4: Concluída — {indexed} arquivos indexados")
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

    # PROMPT #253 - Thinking mode for deeper analysis
    THINKING_CONFIG = {"type": "enabled", "budget_tokens": 10000}

    # RAG config reused by Phase 3 and Phase 4
    PHASE2_RAG_TOP_K = 300
    PHASE2_RAG_THRESHOLD = 0.1

    # Phase 2: max chars of code per batch sent to the LLM
    PHASE2_BATCH_MAX_CHARS = 60000  # ~15K tokens per batch

    PHASE2_SYSTEM_PROMPT = (
        "Voce e um analista de negocios senior especializado em engenharia reversa "
        "de requisitos funcionais a partir de codebases existentes.\n\n"
        "Voce vai receber trechos de codigo-fonte de um projeto. Analise CADA arquivo "
        "e extraia TODAS as regras de negocio que encontrar.\n\n"
        "CATEGORIAS de regras (use EXATAMENTE um destes valores):\n"
        "  dominio | validacao | restricao | workflow | permissao | calculo | integracao | negocio\n\n"
        "PRIORIDADE (use EXATAMENTE um destes valores):\n"
        "  critical | high | medium | low\n\n"
        "IGNORE completamente:\n"
        "  - Configuracoes puras de framework (settings, config boilerplate)\n"
        "  - CSS, estilos, layouts puramente visuais\n"
        "  - Logs de debug, print statements\n"
        "  - Infraestrutura Docker, CI/CD\n"
        "  - Imports e boilerplate de linguagem\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "CONTRATO DE RESPOSTA — JSON RIGIDO\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicacoes.\n\n"
        "{\n"
        '  "business_rules": [\n'
        "    {\n"
        '      "rule_text": "descricao detalhada da regra em portugues (min 15 chars, ideal 100-500)",\n'
        '      "rule_type": "dominio|validacao|restricao|workflow|permissao|calculo|integracao|negocio",\n'
        '      "source_file": "caminho relativo do arquivo (ex: backend/app/models/user.py)",\n'
        '      "priority": "critical|high|medium|low",\n'
        '      "entity": "entidade principal (ex: Usuario, Pedido, Projeto)",\n'
        '      "evidence": "trecho de codigo ou funcao que comprova a regra"\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "REGRAS:\n"
        "- Extraia o MAXIMO de regras possivel de cada arquivo\n"
        "- NAO invente regras — apenas o que EXISTE no codigo\n"
        "- Todas as descricoes em PORTUGUES\n"
        "- Se nenhuma regra for encontrada, retorne {\"business_rules\": []}\n"
        "- Seja DETALHADO nas descricoes (rule_text)\n"
        "- source_file DEVE ser o caminho relativo do arquivo analisado"
    )

    async def phase_2_extract_rules(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 2: Extract business rules from code files already indexed in RAG.

        Reads code_file documents from RAG DB (indexed in Phase 1), splits into
        batches that fit in LLM context, and extracts business rules from each batch.
        """
        self._set_phase_status(project_id, 2, "running")
        jm = JobManager(self.db)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        jm.update_progress(job_id, 5.0, "Fase 2/4: Preparando extracao de regras...")

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

        # Load all code files from RAG DB (indexed in Phase 1)
        code_docs = self.db.execute(sql_text(
            "SELECT content, metadata FROM rag_documents "
            "WHERE project_id = :pid AND metadata->>'type' = 'code_file' "
            "ORDER BY LENGTH(content) DESC"
        ), {"pid": str(project_id)}).fetchall()

        if not code_docs:
            self._set_phase_status(project_id, 2, "failed")
            raise ValueError("Nenhum arquivo indexado. Execute Phase 1 primeiro.")

        logger.info(f"Phase 2: {len(code_docs)} code files loaded from RAG DB")

        # Split into batches
        batches = []
        current_batch = []
        current_chars = 0

        for doc in code_docs:
            content = doc[0] or ""
            if not content.strip():
                continue
            doc_chars = len(content)
            if current_chars + doc_chars > self.PHASE2_BATCH_MAX_CHARS and current_batch:
                batches.append(current_batch)
                current_batch = []
                current_chars = 0
            current_batch.append(content)
            current_chars += doc_chars

        if current_batch:
            batches.append(current_batch)

        logger.info(f"Phase 2: {len(batches)} batches created from {len(code_docs)} files")

        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)

        project_name = project.name or "Projeto"
        total_rules = 0

        for batch_idx, batch in enumerate(batches):
            pct = 10 + (80 * batch_idx // max(len(batches), 1))
            jm.update_progress(
                job_id, pct,
                f"Fase 2/4: Batch {batch_idx + 1}/{len(batches)} — "
                f"{total_rules} regras ate agora..."
            )

            # Join batch files into context
            code_context = "\n\n---\n\n".join(batch)

            user_prompt = (
                f"Analise os seguintes arquivos do projeto \"{project_name}\" "
                f"e extraia TODAS as regras de negocio:\n\n"
                f"{code_context}"
            )

            try:
                # NOTE: project_id omitted intentionally to prevent Claudio
                # from entering agent mode (cwd). We want pure LLM response.
                response = await orchestrator.execute(
                    usage_type="rag_extraction",
                    messages=[{"role": "user", "content": user_prompt}],
                    system_prompt=self.PHASE2_SYSTEM_PROMPT,
                    max_tokens=16000,
                    metadata={
                        "phase": "rag_pipeline_phase2",
                        "batch": batch_idx + 1,
                        "total_batches": len(batches),
                        "project_id": str(project_id),
                    },
                )

                raw = response.get("content", "")
                rules = self._parse_rules_json(raw)
                batch_rules = self._store_rules(rules, project_id)
                self.db.commit()
                total_rules += batch_rules

                logger.info(
                    f"Phase 2 batch {batch_idx + 1}/{len(batches)}: "
                    f"+{batch_rules} rules (total: {total_rules})"
                )

            except Exception as e:
                logger.error(f"Phase 2 batch {batch_idx + 1} failed: {e}")
                continue

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
            raise ValueError(
                f"Extracao falhou: 0 regras extraidas de {len(batches)} batches"
            )

        self._set_phase_status(project_id, 2, "completed")
        jm.update_progress(
            job_id, 95.0,
            f"Fase 2/4: Concluida — {total_rules} regras em {len(batches)} batches"
        )
        return {
            "phase": "extract_rules",
            "rules_extracted": total_rules,
            "batches": len(batches),
            "code_files": len(code_docs),
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

        # Strip markdown code fences (```json ... ``` or ``` ... ```)
        fence_match = re.search(r'```(?:json)?\s*\n?([\s\S]*?)```', text)
        if fence_match:
            text = fence_match.group(1).strip()

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
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error after cleanup: {e}")
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
            if len(rule_text) < 15:
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

            valid.append({
                "rule_text": rule_text,
                "rule_type": rule_type,
                "source_file": source_file,
                "priority": priority,
                "entity": str(rule.get("entity") or "").strip()[:200],
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
            )
            stored += 1
        return stored

    # =========================================================================
    # PHASE 3: Unified generation — cards + wiki + project metadata
    # Single JSON schema per call. Phase 4 becomes a no-op (wiki done here).
    # =========================================================================

    PHASE3_UNIFIED_PROMPT = (
        "Voce e um Product Owner e documentador tecnico senior.\n\n"
        "A partir das regras de negocio do projeto na base de conhecimento, "
        "voce vai gerar TUDO de uma vez:\n"
        "  1. Metadados do projeto (titulo e descricao)\n"
        "  2. Hierarquia completa de cards (Epic > Story > Task > Subtask)\n"
        "  3. Paginas wiki tecnicas\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "CONTRATO DE RESPOSTA — JSON UNIFICADO RIGIDO\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicacoes.\n\n"
        "{\n"
        '  "project": {\n'
        '    "title": "string 5-120 chars, titulo conciso do projeto",\n'
        '    "description": "string 50-2000 chars, proposito, stack, arquitetura"\n'
        "  },\n"
        '  "cards": [\n'
        "    {\n"
        '      "title": "string 5-255 chars, unico, sem prefixos numericos",\n'
        '      "description": "string min 200 chars — contexto, motivacao, requisitos tecnicos, dependencias",\n'
        '      "item_type": "epic|story|task|subtask",\n'
        '      "parent_title": "titulo EXATO do card pai, ou null para epics raiz",\n'
        '      "story_points": "integer Fibonacci: 1|2|3|5|8|13 — estime pela complexidade real",\n'
        '      "priority": "critical|high|medium|low",\n'
        '      "complexity": "low|medium|high — low=Haiku (CRUD, config), medium=Sonnet (logica, API), high=Opus (arquitetura, seguranca)",\n'
        '      "labels": ["array", "de", "strings", "lowercase", "kebab-case"],\n'
        '      "acceptance_criteria": ["criterio verificavel 1", "criterio verificavel 2"],\n'
        '      "entity": "entidade principal (ex: Usuario, Projeto, Task)"\n'
        "    }\n"
        "  ],\n"
        '  "wiki_pages": [\n'
        "    {\n"
        '      "slug": "kebab-case unico, 3-80 chars (ex: autenticacao-usuarios)",\n'
        '      "title": "string 3-200 chars, titulo descritivo",\n'
        '      "content": "string Markdown min 1000 chars — headers ##/###, listas, tabelas, exemplos de codigo",\n'
        '      "order": "integer unico sequencial 1, 2, 3..."\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "═══════════════════════ REGRAS DOS CARDS ═══════════════════════\n"
        "HIERARQUIA OBRIGATORIA:\n"
        "  Epic (parent_title=null) → modulo macro do sistema\n"
        "    Story (parent=Epic) → funcionalidade do modulo\n"
        "      Task (parent=Story) → trabalho tecnico\n"
        "        Subtask (parent=Task) → trabalho atomico\n"
        "  NUNCA pule niveis. NUNCA crie task filha de epic.\n\n"
        "ORDEM NO JSON: Epics primeiro → Stories → Tasks → Subtasks.\n\n"
        "STORY_POINTS: estime caso a caso pela dificuldade tecnica real.\n"
        "  Nao use valores fixos por tipo — avalie o conteudo de cada card.\n\n"
        "QUANTITY: cada Epic deve ter 3-8 Stories, cada Story 2-5 Tasks.\n"
        "  Cubra TODAS as regras de negocio com cards correspondentes.\n\n"
        "DESCRIPTION: minimo 200 chars. QUANTO MAIS DETALHE, MELHOR.\n\n"
        "ACCEPTANCE_CRITERIA: minimo 2, maximo 20, cada um min 15 chars.\n\n"
        "═══════════════════════ REGRAS DA WIKI ═══════════════════════\n"
        "Paginas OBRIGATORIAS (inclua mesmo que a base seja limitada):\n"
        "  visao-geral | arquitetura | regras-negocio | api-endpoints\n"
        "  modelos-dados | autenticacao | guia-desenvolvimento\n\n"
        "CONTENT: min 1000 chars por pagina. Use headers ##/###, listas, "
        "tabelas, blocos de codigo ```. Conteudo factual do projeto — nao invente.\n\n"
        "Todos os textos em PORTUGUES."
    )

    PHASE3_PASSES = 3  # pass 1: full generation; passes 2-3: reinforce gaps

    async def phase_3_generate_cards(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 3 (Unified): Generate project metadata + cards + wiki in a single
        JSON schema per pass. Uses RAG injection to get business rules as context.
        Phase 4 is now a no-op — wiki is produced here.
        """
        self._set_phase_status(project_id, 3, "running")
        jm = JobManager(self.db)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        jm.update_progress(job_id, 5.0, "Fase 3/4: Gerando cards, wiki e metadados...")

        rule_count = self.db.execute(sql_text(
            "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
            "AND metadata->>'type' = 'business_rule'"
        ), {"pid": str(project_id)}).scalar() or 0

        if rule_count == 0:
            self._set_phase_status(project_id, 3, "failed")
            raise ValueError("Nenhuma regra de negocio encontrada. Execute Phase 2 primeiro.")

        from app.services.ai_orchestrator import AIOrchestrator
        from app.models.task import Task
        orchestrator = AIOrchestrator(self.db)

        project_name = project.name or "Projeto"
        total_cards = 0
        total_pages = 0

        for pass_num in range(1, self.PHASE3_PASSES + 1):
            pct_base = 5 + (85 * (pass_num - 1) // self.PHASE3_PASSES)
            jm.update_progress(
                job_id, pct_base,
                f"Fase 3/4: Passada {pass_num}/{self.PHASE3_PASSES} — "
                f"{total_cards} cards, {total_pages} paginas wiki ate agora..."
            )

            if pass_num == 1:
                user_prompt = (
                    f"Analise todas as {rule_count} regras de negocio do projeto "
                    f"\"{project_name}\" na base de conhecimento e gere:\n\n"
                    f"1. METADADOS: titulo conciso e descricao detalhada do projeto\n"
                    f"2. CARDS: hierarquia completa Epic > Story > Task > Subtask "
                    f"cobrindo TODAS as regras. Estime story_points caso a caso.\n"
                    f"3. WIKI: paginas tecnicas detalhadas com conteudo Markdown rico\n\n"
                    f"Gere o MAXIMO possivel em cada categoria."
                )
            else:
                existing_cards = self.db.query(Task.title, Task.item_type).filter(
                    Task.project_id == project_id,
                    Task.reporter == "pipeline_phase3",
                ).all()
                existing_pages = self.db.execute(sql_text(
                    "SELECT metadata->>'slug' as slug FROM rag_documents "
                    "WHERE project_id = :pid AND metadata->>'type' = 'wiki_page'"
                ), {"pid": str(project_id)}).fetchall()

                cards_summary = "\n".join(
                    f"  [{c.item_type}] {c.title}" for c in existing_cards
                )
                pages_summary = ", ".join(p[0] for p in existing_pages if p[0])

                user_prompt = (
                    f"Passada de REFORCO para o projeto \"{project_name}\".\n\n"
                    f"Cards ja criados ({total_cards}):\n{cards_summary}\n\n"
                    f"Wiki pages ja criadas: {pages_summary or 'nenhuma'}\n\n"
                    f"Analise as regras de negocio e gere:\n"
                    f"- CARDS novos que NAO existem na lista acima (areas nao cobertas, "
                    f"stories faltando em epics, tasks e subtasks ausentes)\n"
                    f"- WIKI PAGES novas ou use o mesmo slug para expandir existentes\n"
                    f"- Pode omitir 'project' nesta passada (ja foi gerado)\n\n"
                    f"Retorne APENAS itens NOVOS ou atualizados."
                )

            try:
                response = await orchestrator.execute(
                    usage_type="content_generation",
                    messages=[{"role": "user", "content": user_prompt}],
                    system_prompt=self.PHASE3_UNIFIED_PROMPT,
                    max_tokens=32000,
                    project_id=project_id,
                    enable_rag=True,
                    rag_top_k=self.PHASE2_RAG_TOP_K,
                    rag_similarity_threshold=self.PHASE2_RAG_THRESHOLD,
                    metadata={"phase": "rag_pipeline_phase3", "pass": pass_num},
                    thinking=self.THINKING_CONFIG,
                )

                raw = response.get("content", "")
                result = self._process_unified_json(raw, project_id, project)
                self.db.commit()

                total_cards += result["cards_created"]
                total_pages += result["pages_created"]

                logger.info(
                    f"Phase 3 pass {pass_num}/{self.PHASE3_PASSES}: "
                    f"+{result['cards_created']} cards, +{result['pages_created']} wiki pages "
                    f"(totals: {total_cards} cards, {total_pages} pages)"
                )

            except Exception as e:
                logger.error(f"Phase 3 pass {pass_num} failed: {e}")
                continue

        if total_cards == 0 and total_pages == 0:
            self._set_phase_status(project_id, 3, "failed")
            raise ValueError("Geracao falhou: 0 cards e 0 paginas wiki criadas")

        self._set_phase_status(project_id, 3, "completed")
        jm.update_progress(
            job_id, 95.0,
            f"Fase 3/4: Concluida — {total_cards} cards e {total_pages} paginas wiki"
        )
        return {
            "phase": "generate_cards",
            "cards_created": total_cards,
            "wiki_pages_created": total_pages,
            "rules_in_rag": rule_count,
            "passes": self.PHASE3_PASSES,
        }

    # =====================================================================
    # UNIFIED JSON PROCESSOR — handles project + cards + wiki_pages
    # Called by phase_3_generate_cards for each pass.
    # =====================================================================

    def _process_unified_json(self, raw: str, project_id: UUID, project: Project) -> Dict:
        """
        Process the unified JSON response from Phase 3 unified prompt.
        Handles:
          1. project.title / project.description  (REGRA #0: only if empty)
          2. cards[]                               (delegates to _create_cards_from_json)
          3. wiki_pages[]                          (delegates to _save_wiki_and_metadata)
        Returns: {cards_created, pages_created, title_generated, description_generated}
        """
        result = {
            "cards_created": 0,
            "pages_created": 0,
            "title_generated": False,
            "description_generated": False,
        }

        parsed = self._extract_json(raw)
        if not parsed:
            logger.warning("Phase 3 unified: no valid JSON found in response")
            return result

        # ---- 1. PROJECT METADATA (REGRA #0: only set if empty) ----
        project_meta = parsed.get("project") or {}
        if isinstance(project_meta, dict):
            ai_title = str(project_meta.get("title") or "").strip()
            ai_desc = str(project_meta.get("description") or "").strip()

            if ai_title and 5 <= len(ai_title) <= 120:
                if not (project.name and project.name.strip()):
                    project.name = ai_title.replace("\n", " ").replace("\r", "")
                    result["title_generated"] = True
                    logger.info(f"Phase 3 unified: Generated title: {ai_title}")

            if ai_desc and len(ai_desc) >= 20:
                if not (project.description and project.description.strip()):
                    project.description = ai_desc[:2000]
                    result["description_generated"] = True
                    logger.info(f"Phase 3 unified: Generated description ({len(ai_desc)} chars)")

        # ---- 2. CARDS — pass raw string (method reads 'cards' key) ----
        # _create_cards_from_json parses JSON and reads parsed["cards"]
        # The unified JSON already has a "cards" key at root level.
        result["cards_created"] = self._create_cards_from_json(raw, project_id)

        # ---- 3. WIKI PAGES — build a Phase4-compatible dict for reuse ----
        # _save_wiki_and_metadata expects "title", "description", "wiki_pages"
        # We flatten project metadata to top-level for that method.
        wiki_payload = {
            "wiki_pages": parsed.get("wiki_pages", []),
            # Don't pass title/description — already handled above (REGRA #0 applied)
        }
        wiki_raw = json.dumps(wiki_payload, ensure_ascii=False)
        wiki_result = self._save_wiki_and_metadata(wiki_raw, project_id, project)
        result["pages_created"] = wiki_result["pages_created"]

        return result

    # =====================================================================
    # PHASE 3 VALIDATORS — strict contract enforcement for cards
    # =====================================================================

    VALID_ITEM_TYPES = frozenset({"epic", "story", "task", "subtask"})
    VALID_FIBONACCI = frozenset({1, 2, 3, 5, 8, 13})
    TYPE_ORDER = {"epic": 0, "story": 1, "task": 2, "subtask": 3}
    EXPECTED_PARENT_TYPE = {"story": "epic", "task": "story", "subtask": "task"}

    def _create_cards_from_json(self, raw: str, project_id: UUID) -> int:
        """Parse, VALIDATE and create Task records from AI JSON response.
        Rejects any card that violates the contract."""
        from app.models.task import Task

        parsed = self._extract_json(raw)
        raw_cards = parsed.get("cards", [])
        if not isinstance(raw_cards, list):
            logger.warning("Phase 3: 'cards' is not a list")
            return 0

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
                complexity = {"epic": "high", "story": "medium", "task": "medium", "subtask": "low"}.get(item_type, "medium")
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
            })

        if rejected:
            logger.info(f"Phase 3 validator: {len(valid_cards)} accepted, {rejected} rejected")

        if not valid_cards:
            return 0

        # ---- Sort by hierarchy level: epics first, then stories, tasks, subtasks ----
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

        for card in valid_cards:
            task = Task(
                title=card["title"],
                description=card["description"],
                item_type=card["item_type"],
                project_id=project_id,
                workflow_state="done",
                reporter="pipeline_phase3",
                story_points=card["story_points"],
                priority=card["priority"],
                complexity=card["complexity"],
                labels=card["labels"],
                acceptance_criteria=card["acceptance_criteria"],
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
        logger.info(f"Phase 3: {created} created, {linked} linked to parents")

        return created

    # =========================================================================
    # PHASE 4: Generate wiki + title + description via single AI prompt
    # Uses enable_rag=True to inject all project context from RAG.
    # =========================================================================

    PHASE4_SYSTEM_PROMPT = (
        "Voce e um documentador tecnico senior especializado em criar "
        "wikis completas de projetos de software.\n\n"
        "Voce vai receber o contexto completo de um projeto da base de conhecimento. "
        "Gere titulo, descricao e todas as paginas wiki.\n\n"
        "PAGINAS WIKI OBRIGATORIAS (slugs exatos):\n"
        "  visao-geral | padroes-arquitetura | convencoes-codigo | regras-negocio\n"
        "  estrutura-codigo | componentes-interface | integracao-api\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "CONTRATO DE RESPOSTA — SCHEMA RIGIDO (qualquer desvio sera descartado)\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicacoes.\n\n"
        "{\n"
        '  "title": "string OBRIGATORIA, 5-120 caracteres, titulo claro do projeto",\n'
        '  "description": "string OBRIGATORIA, 50-2000 caracteres, descricao detalhada do projeto",\n'
        '  "wiki_pages": [\n'
        "    {\n"
        '      "slug": "string OBRIGATORIA, formato kebab-case (a-z, 0-9, hifens), 3-80 caracteres",\n'
        '      "title": "string OBRIGATORIA, 3-200 caracteres, titulo da pagina em portugues",\n'
        '      "content": "string OBRIGATORIA, conteudo em Markdown, MINIMO 500 caracteres. '
        'SEJA EXTENSO — cada pagina deve ter conteudo RICO e DETALHADO com headers (#, ##, ###), '
        'listas, tabelas, exemplos de codigo, explicacoes profundas. '
        'Paginas com menos de 500 caracteres serao DESCARTADAS.",\n'
        '      "order": "integer OBRIGATORIO, posicao da pagina (1, 2, 3...), unico por pagina"\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "REGRAS DO CONTRATO:\n"
        "- title (projeto): 5-120 caracteres, sem quebras de linha\n"
        "- description (projeto): 50-2000 caracteres. Descreva o projeto em DETALHES: "
        "proposito, stack tecnologica, arquitetura geral, publico alvo.\n"
        "- slug: kebab-case APENAS (regex: ^[a-z0-9]+(-[a-z0-9]+)*$), UNICO\n"
        "- title (pagina): 3-200 caracteres, descritivo\n"
        "- content: MINIMO 500 caracteres de Markdown RICO. Paginas com menos sao DESCARTADAS.\n"
        "  Cada pagina deve ter: multiplos headers (##, ###), paragrafos detalhados, "
        "listas completas, exemplos de codigo com ``` quando aplicavel, tabelas quando util.\n"
        "  QUANTO MAIS CONTEUDO, MELHOR. Idealmente 1000-5000 caracteres por pagina.\n"
        "- order: inteiro sequencial unico (1, 2, 3...)\n"
        "- Todos os textos em PORTUGUES\n"
        "- Cada pagina wiki DEVE ter conteudo factual baseado no codigo real do projeto\n"
        "- NAO invente features que nao existem no codigo\n"
        "- PREFIRA paginas EXTENSAS e DETALHADAS a paginas curtas e superficiais."
    )

    PHASE4_PASSES = 3  # 1 initial + 2 reinforcement

    async def phase_4_generate_wiki(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 4: NO-OP — wiki + title + description are now generated in Phase 3 (unified).
        This phase is kept for backward compatibility but does nothing.
        """
        self._set_phase_status(project_id, 4, "running")
        jm = JobManager(self.db)
        jm.update_progress(job_id, 50.0, "Fase 4/4: Wiki ja gerada na Fase 3 (no-op)...")
        self._set_phase_status(project_id, 4, "completed")
        jm.update_progress(job_id, 100.0, "Fase 4/4: Concluida (wiki gerada na Fase 3)")
        return {
            "phase": "generate_wiki",
            "pages_created": 0,
            "passes": 0,
            "note": "Wiki now generated in Phase 3 unified pass.",
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

