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

    # PROMPT #259 - Thinking disabled to save credits
    THINKING_CONFIG = None

    # RAG config - keep small to avoid payload too large errors
    PHASE2_RAG_TOP_K = 20
    PHASE2_RAG_THRESHOLD = 0.3

    PHASE2_SYSTEM_PROMPT = (
        "IMPORTANTE: Voce NAO tem acesso a ferramentas. NAO tente executar comandos, "
        "ler arquivos ou explorar diretorios. Todo o codigo necessario ja esta incluido "
        "na mensagem do usuario como CONTEXTO. Analise APENAS o texto fornecido.\n\n"
        "Voce e um analista de negocios. Extraia regras de negocio do codigo fornecido.\n\n"
        "CATEGORIAS (use EXATAMENTE um destes):\n"
        "  dominio | validacao | restricao | workflow | permissao | calculo | integracao | negocio\n\n"
        "PRIORIDADE (use EXATAMENTE um destes):\n"
        "  critical | high | medium | low\n\n"
        "IGNORE: config boilerplate, CSS, logs, Docker, imports.\n\n"
        "Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicacoes, sem texto antes ou depois.\n\n"
        '{"business_rules": [{"rule_text": "descricao em portugues min 15 chars", '
        '"rule_type": "dominio", "source_file": "caminho/arquivo.py", '
        '"priority": "medium", "entity": "Entidade", "evidence": "trecho de codigo"}]}\n\n'
        "REGRAS:\n"
        "- Extraia o MAXIMO de regras do codigo no contexto\n"
        "- NAO invente regras — apenas o que EXISTE no codigo fornecido\n"
        "- Descricoes em PORTUGUES\n"
        "- Se nenhuma regra: {\"business_rules\": []}\n"
        "- source_file = caminho relativo do arquivo"
    )

    async def phase_2_extract_rules(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 2: Extract business rules via SINGLE compact prompt + RAG injection.

        Instead of loading all code_file documents inline (hundreds of KB),
        uses enable_rag=True with rag_filter={"type": "code_file"} so the
        orchestrator injects relevant code via RAG automatically.
        Result: ~80% token reduction, single LLM call instead of 5+.
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

        # Lightweight count check (no full content load)
        code_count = self.db.execute(sql_text(
            "SELECT COUNT(*) FROM rag_documents "
            "WHERE project_id = :pid AND metadata->>'type' = 'code_file'"
        ), {"pid": str(project_id)}).scalar() or 0

        if code_count == 0:
            self._set_phase_status(project_id, 2, "failed")
            raise ValueError("Nenhum arquivo indexado. Execute Phase 1 primeiro.")

        # Compact summary by file extension (~500 bytes instead of ~375KB)
        ext_rows = self.db.execute(sql_text(
            "SELECT metadata->>'file_extension' as ext, COUNT(*) as cnt "
            "FROM rag_documents "
            "WHERE project_id = :pid AND metadata->>'type' = 'code_file' "
            "GROUP BY metadata->>'file_extension' ORDER BY cnt DESC"
        ), {"pid": str(project_id)}).fetchall()

        ext_summary = "\n".join([f"- {r.ext or 'other'}: {r.cnt} arquivos" for r in ext_rows])

        logger.info(f"Phase 2: {code_count} code files — using RAG injection (single call)")
        jm.update_progress(job_id, 10.0, "Fase 2/4: Extraindo regras via RAG...")

        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)
        project_name = project.name or "Projeto"

        user_prompt = (
            f'Projeto: "{project_name}"\n'
            f'Total de arquivos de codigo: {code_count}\n\n'
            f'Distribuicao por extensao:\n{ext_summary}\n\n'
            f'O codigo-fonte completo esta no contexto fornecido acima '
            f'(RELEVANT CONTEXT FROM KNOWLEDGE BASE).\n\n'
            f'Analise TODO o codigo do contexto e extraia TODAS as regras de negocio.\n'
            f'Retorne APENAS o JSON com business_rules. '
            f'NAO use ferramentas, NAO explore arquivos.'
        )

        response = await orchestrator.execute(
            usage_type="rag_extraction",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=self.PHASE2_SYSTEM_PROMPT,
            project_id=project_id,
            enable_rag=True,
            rag_filter={"type": "code_file"},
            rag_top_k=300,
            rag_similarity_threshold=0.0,
            metadata={"phase": "rag_pipeline_phase2", "skip_context_build": True},
            disable_cwd=True,
            disable_tools=True,
        )

        raw = response.get("content", "")
        rules = self._parse_rules_json(raw)
        total_rules = self._store_rules(rules, project_id)
        self.db.commit()

        logger.info(f"Phase 2: Single RAG call → {total_rules} rules extracted")

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
            job_id, 95.0,
            f"Fase 2/4: Concluida — {total_rules} regras extraidas (RAG injection)"
        )
        return {
            "phase": "extract_rules",
            "rules_extracted": total_rules,
            "code_files": code_count,
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
    # PHASE 3: Generate CARDS ONLY from business rules
    # =========================================================================

    PHASE3_CARDS_PROMPT = (
        "IMPORTANTE: Voce NAO tem acesso a ferramentas. NAO tente executar comandos "
        "ou explorar arquivos. As regras de negocio ja estao na mensagem do usuario.\n\n"
        "Voce e um Product Owner senior e Arquiteto de Software. A partir das regras "
        "fornecidas, gere uma hierarquia FLAT de cards (array unico, NAO aninhado) "
        "com TODOS os campos preenchidos de forma rica e completa.\n\n"
        "CONTRATO — JSON RIGIDO. Responda APENAS com JSON puro, sem markdown.\n\n"
        "FORMATO OBRIGATORIO (array FLAT de cards, NAO aninhado):\n"
        '{"cards":['
        '{"title":"Modulo X","item_type":"epic","parent_title":null,'
        '"description":"Descricao detalhada do modulo com contexto tecnico, '
        'justificativa de negocio e escopo funcional...min 300 chars...",'
        '"generated_prompt":"Prompt semantico atomico para IA executar este card. '
        'Inclui contexto completo, requisitos tecnicos, criterios de aceite, '
        'dependencias e restricoes. Deve ser auto-suficiente para que uma IA '
        'consiga implementar sem informacao adicional...min 500 chars...",'
        '"story_points":13,"priority":"high","complexity":"high",'
        '"labels":["modulo-x","backend"],'
        '"acceptance_criteria":[{"text":"Criterio detalhado 1","completed":false},'
        '{"text":"Criterio detalhado 2","completed":false}],'
        '"components":["componente-afetado-1","componente-afetado-2"],'
        '"type":"module","entity":"Entidade",'
        '"depends_on_titles":[]},'
        '{"title":"Feature Y","item_type":"story","parent_title":"Modulo X",'
        '"description":"...min 300 chars...","generated_prompt":"...min 500 chars...",'
        '"story_points":5,"priority":"medium","complexity":"medium",'
        '"labels":["feature-y"],'
        '"acceptance_criteria":[{"text":"criterio 1","completed":false}],'
        '"components":["componente"],"type":"service","entity":"Entidade",'
        '"depends_on_titles":[]},'
        '{"title":"Implementar Z","item_type":"task","parent_title":"Feature Y",'
        '"description":"...min 300 chars...","generated_prompt":"...min 500 chars...",'
        '"story_points":3,"priority":"medium","complexity":"low",'
        '"labels":["impl-z"],'
        '"acceptance_criteria":[{"text":"criterio 1","completed":false}],'
        '"components":["componente"],"type":"implementation","entity":"Entidade",'
        '"depends_on_titles":["Feature Y"]}'
        ']}\n\n'
        "CAMPOS OBRIGATORIOS POR CARD:\n"
        "- title: titulo claro e descritivo (5-255 chars)\n"
        "- item_type: epic|story|task|subtask\n"
        "- parent_title: null para epic, titulo EXATO do pai para demais\n"
        "- description: descricao RICA e DETALHADA (min 300 chars). Inclua: contexto, "
        "justificativa, escopo funcional, impacto tecnico, e como se relaciona ao sistema.\n"
        "- generated_prompt: prompt SEMANTICO ATOMICO (min 500 chars) para IA executar. "
        "Deve ser AUTO-SUFICIENTE: inclua contexto do projeto, requisitos tecnicos, "
        "stack/frameworks relevantes, criterios de aceite, arquivos/entidades envolvidos, "
        "restricoes e dependencias. Uma IA deve conseguir implementar lendo APENAS este campo.\n"
        "- story_points: Fibonacci (1,2,3,5,8,13)\n"
        "- priority: critical|high|medium|low\n"
        "- complexity: low|medium|high\n"
        "- labels: array de tags relevantes (ex: ['backend','api','auth'])\n"
        "- acceptance_criteria: array de objetos {text, completed:false}. "
        "Criterios CLAROS e VERIFICAVEIS (min 3 por card, min 20 chars cada)\n"
        "- components: array de componentes/modulos afetados (ex: ['auth-service','user-model'])\n"
        "- type: tipo tecnico (module|service|controller|model|migration|config|test|"
        "implementation|integration|documentation)\n"
        "- entity: entidade principal (ex: 'User','Project','Task')\n"
        "- depends_on_titles: array de titulos de cards dos quais este depende ([] se nenhum)\n\n"
        "REGRAS CRITICAS:\n"
        "- cards e um ARRAY FLAT. Cada card tem parent_title ligando ao pai.\n"
        "- NAO use epics[] aninhado. NAO use stories[] dentro de epic.\n"
        "- Ordem: epics primeiro, depois stories, tasks, subtasks\n"
        "- acceptance_criteria DEVE ser array de OBJETOS {text, completed}\n"
        "- generated_prompt e OBRIGATORIO para TODOS os cards, especialmente tasks/subtasks\n"
        "- Retorne APENAS o JSON com cards. SEM wiki, SEM project metadata.\n"
        "- Todos os textos em PORTUGUES"
    )

    async def phase_3_generate_cards(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 3: Generate CARDS from business rules via RAG injection.

        Uses enable_rag=True to inject business rules from RAG automatically.
        Sends a compact prompt (~5KB) instead of all rules inline (~120KB).
        """
        self._set_phase_status(project_id, 3, "running")
        jm = JobManager(self.db)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        jm.update_progress(job_id, 5.0, "Fase 3/4: Verificando regras de negocio...")

        # Count rules (lightweight check that Phase 2 ran)
        rule_count = self.db.execute(sql_text(
            "SELECT COUNT(*) FROM rag_documents "
            "WHERE project_id = :pid AND metadata->>'type' = 'business_rule'"
        ), {"pid": str(project_id)}).scalar() or 0

        if rule_count == 0:
            self._set_phase_status(project_id, 3, "failed")
            raise ValueError("Nenhuma regra de negocio encontrada. Execute Phase 2 primeiro.")

        # Build compact summary by rule_type (~500 bytes instead of 70KB)
        type_counts = self.db.execute(sql_text(
            "SELECT metadata->>'rule_type' as rtype, COUNT(*) as cnt "
            "FROM rag_documents WHERE project_id = :pid AND metadata->>'type' = 'business_rule' "
            "GROUP BY metadata->>'rule_type' ORDER BY cnt DESC"
        ), {"pid": str(project_id)}).fetchall()

        summary_lines = [f"- {r.rtype}: {r.cnt} regras" for r in type_counts]
        summary = "\n".join(summary_lines)

        logger.info(f"Phase 3: {rule_count} rules via RAG injection (not inline)")

        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)

        project_name = project.name or "Projeto"

        user_prompt = (
            f'Projeto: "{project_name}"\n'
            f'Total de regras de negocio: {rule_count}\n\n'
            f'Distribuicao por tipo:\n{summary}\n\n'
            f'As regras detalhadas estao no contexto fornecido acima '
            f'(RELEVANT CONTEXT FROM KNOWLEDGE BASE).\n\n'
            f'Analise TODAS as regras do contexto e gere os cards hierarquicos '
            f'(epics -> stories -> tasks) cobrindo TODOS os modulos do sistema.\n'
            f'Retorne: {{"cards": [...]}}'
        )

        jm.update_progress(job_id, 15.0, f"Fase 3/4: Gerando cards via RAG ({rule_count} regras)...")

        total_cards = 0

        response = await orchestrator.execute(
            usage_type="content_generation",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=self.PHASE3_CARDS_PROMPT,
            project_id=project_id,
            enable_rag=True,
            rag_filter={"type": "business_rule"},
            rag_top_k=300,
            rag_similarity_threshold=0.0,
            metadata={"phase": "rag_pipeline_phase3", "skip_context_build": True},
            disable_cwd=True,
            disable_tools=True,
        )

        raw = response.get("content", "")
        logger.info(f"Phase 3 ({len(raw)} chars): {raw[:300]}...")

        if len(raw) >= 50:
            try:
                total_cards = self._create_cards_from_json(raw, project_id)
                self.db.commit()
                logger.info(f"Phase 3: {total_cards} cards created")
            except Exception as card_err:
                logger.error(f"Phase 3: _create_cards_from_json failed: {card_err}")
                import traceback
                logger.error(traceback.format_exc())
        else:
            logger.error(f"Phase 3: empty response ({len(raw)} chars)")

        if total_cards == 0:
            self._set_phase_status(project_id, 3, "failed")
            raise ValueError("Geracao falhou: 0 cards criados")

        self._set_phase_status(project_id, 3, "completed")
        jm.update_progress(
            job_id, 95.0,
            f"Fase 3/4: Concluida — {total_cards} cards"
        )
        return {
            "phase": "generate_cards",
            "cards_created": total_cards,
            "rules_in_rag": rule_count,
        }

    # =====================================================================
    # PHASE 3 VALIDATORS — strict contract enforcement for cards
    # =====================================================================

    VALID_ITEM_TYPES = frozenset({"epic", "story", "task", "subtask"})
    VALID_FIBONACCI = frozenset({1, 2, 3, 5, 8, 13})
    TYPE_ORDER = {"epic": 0, "story": 1, "task": 2, "subtask": 3}
    EXPECTED_PARENT_TYPE = {"story": "epic", "task": "story", "subtask": "task"}

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
                        if k not in ("stories", "tasks", "subtasks", "children")}
                card["item_type"] = card.get("item_type", item_type)
                card["parent_title"] = parent_title
                flat.append(card)
                title = str(card.get("title", "")).strip()
                # Recurse into nested children
                for child_key, child_type in [
                    ("stories", "story"), ("tasks", "task"),
                    ("subtasks", "subtask"), ("children", None),
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

    async def phase_4_generate_wiki(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 4: Generate wiki pages + project title + project description.

        Uses enable_rag=True with combined filter (business_rule + code_file)
        to inject context via RAG instead of loading all rules inline.
        Result: compact prompt (~1KB) instead of ~70KB inline rules.
        """
        self._set_phase_status(project_id, 4, "running")
        jm = JobManager(self.db)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        jm.update_progress(job_id, 10.0, "Fase 4/4: Preparando geracao de wiki via RAG...")

        # Lightweight count check (no full content load)
        rule_count = self.db.execute(sql_text(
            "SELECT COUNT(*) FROM rag_documents "
            "WHERE project_id = :pid AND metadata->>'type' = 'business_rule'"
        ), {"pid": str(project_id)}).scalar() or 0

        if rule_count == 0:
            self._set_phase_status(project_id, 4, "failed")
            raise ValueError("Nenhuma regra de negocio encontrada. Execute Phase 2 primeiro.")

        # Compact summary by rule_type (~500 bytes instead of ~70KB)
        type_rows = self.db.execute(sql_text(
            "SELECT metadata->>'rule_type' as rtype, COUNT(*) as cnt "
            "FROM rag_documents "
            "WHERE project_id = :pid AND metadata->>'type' = 'business_rule' "
            "GROUP BY metadata->>'rule_type' ORDER BY cnt DESC"
        ), {"pid": str(project_id)}).fetchall()

        type_summary = "\n".join([f"- {r.rtype or 'other'}: {r.cnt} regras" for r in type_rows])

        logger.info(f"Phase 4: {rule_count} rules — using RAG injection (single call)")

        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)

        project_name = project.name or "Projeto"

        user_prompt = (
            f'Projeto: "{project_name}"\n'
            f'Total de regras de negocio: {rule_count}\n\n'
            f'Distribuicao por tipo:\n{type_summary}\n\n'
            f'As regras de negocio e o codigo do projeto estao no contexto fornecido acima '
            f'(RELEVANT CONTEXT FROM KNOWLEDGE BASE).\n\n'
            f'A partir de TODAS as regras e codigo no contexto, gere:\n'
            f'1. Titulo do projeto (se "{project_name}" for generico)\n'
            f'2. Descricao detalhada do projeto\n'
            f'3. Paginas wiki tecnicas obrigatorias\n\n'
            f'Retorne o JSON conforme o contrato no system prompt.'
        )

        jm.update_progress(job_id, 30.0, "Fase 4/4: Gerando wiki e metadados via RAG...")

        total_pages = 0
        title_generated = False
        desc_generated = False

        response = await orchestrator.execute(
            usage_type="content_generation",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=self.PHASE4_SYSTEM_PROMPT,
            project_id=project_id,
            enable_rag=True,
            rag_filter={"type__in": ["business_rule", "code_file"]},
            rag_top_k=200,
            rag_similarity_threshold=0.0,
            metadata={"phase": "rag_pipeline_phase4", "skip_context_build": True},
            disable_cwd=True,
            disable_tools=True,
        )

        raw = response.get("content", "")
        logger.info(f"Phase 4 ({len(raw)} chars): {raw[:300]}...")

        if len(raw) >= 50:
            try:
                wiki_result = self._save_wiki_and_metadata(raw, project_id, project)
                self.db.commit()

                total_pages = wiki_result["pages_created"]
                title_generated = wiki_result.get("title_generated", False)
                desc_generated = wiki_result.get("description_generated", False)

                logger.info(
                    f"Phase 4: {total_pages} wiki pages, "
                    f"title={'yes' if title_generated else 'no'}, "
                    f"desc={'yes' if desc_generated else 'no'}"
                )
            except Exception as wiki_err:
                logger.error(f"Phase 4: _save_wiki_and_metadata failed: {wiki_err}")
                import traceback
                logger.error(traceback.format_exc())
        else:
            logger.error(f"Phase 4: empty response ({len(raw)} chars)")

        if total_pages == 0:
            self._set_phase_status(project_id, 4, "failed")
            raise ValueError("Geracao falhou: 0 paginas wiki criadas")

        self._set_phase_status(project_id, 4, "completed")
        jm.update_progress(job_id, 100.0, f"Fase 4/4: Concluida — {total_pages} wiki pages")
        return {
            "phase": "generate_wiki",
            "pages_created": total_pages,
            "title_generated": title_generated,
            "description_generated": desc_generated,
            "rules_used": rule_count,
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

