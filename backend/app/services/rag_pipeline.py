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

    PHASE2_SYSTEM_PROMPT = (
        "Voce e um analista de negocios senior especializado em engenharia reversa "
        "de requisitos funcionais a partir de codebases existentes.\n\n"
        "Voce vai receber o contexto completo de um projeto de software indexado "
        "na base de conhecimento. Seu objetivo e extrair TODAS as regras de negocio.\n\n"
        "CATEGORIAS (enum obrigatorio — use EXATAMENTE um destes valores):\n"
        "  dominio | validacao | restricao | workflow | permissao | calculo | integracao | negocio\n\n"
        "PRIORIDADE (enum obrigatorio):\n"
        "  critical | high | medium | low\n\n"
        "IGNORE: configuracoes de framework, CSS, logs, infra, imports.\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "CONTRATO DE RESPOSTA — SCHEMA RIGIDO (qualquer desvio sera descartado)\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicacoes.\n\n"
        "{\n"
        '  "business_rules": [\n'
        "    {\n"
        '      "rule_text": "string OBRIGATORIA, minimo 15 caracteres, em portugues. '
        'Descreva a regra como para um gerente de produto que NAO conhece codigo.",\n'
        '      "rule_type": "string OBRIGATORIA, enum: dominio|validacao|restricao|workflow|permissao|calculo|integracao|negocio",\n'
        '      "source_file": "string OBRIGATORIA, caminho relativo do arquivo-fonte (ex: backend/app/models/user.py)",\n'
        '      "priority": "string OBRIGATORIA, enum: critical|high|medium|low",\n'
        '      "entity": "string OPCIONAL, entidade principal envolvida (ex: Usuario, Pedido, Pagamento)",\n'
        '      "evidence": "string OPCIONAL, trecho de codigo ou funcao que evidencia a regra"\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "REGRAS DO CONTRATO:\n"
        "- rule_text: MINIMO 15 caracteres, MAXIMO 2000 caracteres. SEJA DETALHADO — "
        "descreva a regra com contexto, condicoes, excecoes e impacto no negocio.\n"
        "- rule_type: EXATAMENTE um dos 8 valores do enum\n"
        "- source_file: caminho relativo real do projeto, NUNCA vazio\n"
        "- priority: EXATAMENTE um dos 4 valores do enum\n"
        "- entity: inclua SEMPRE que possivel a entidade envolvida\n"
        "- evidence: inclua trecho de codigo, nome de funcao ou classe que comprova a regra (ate 1000 chars)\n"
        "- Cada regra deve ser UNICA — sem duplicatas semanticas\n"
        "- Todas em PORTUGUES\n"
        "- NAO invente regras — apenas extraia o que EXISTE no codigo/docs\n"
        "- Extraia o MAXIMO possivel. Analise CADA modelo, servico, rota, validacao, schema.\n"
        "- PREFIRA regras DETALHADAS e RICAS a regras curtas e genericas."
    )

    # Claude Opus 4.6: 200K context window
    # rag_top_k=300 → ~300 docs × ~500 tokens = ~150K tokens RAG context
    # Sobram ~35K para prompts + 16K para resposta
    PHASE2_RAG_TOP_K = 300
    PHASE2_RAG_THRESHOLD = 0.1
    # PROMPT #253 - Thinking mode for deeper analysis
    THINKING_CONFIG = {"type": "enabled", "budget_tokens": 10000}

    PHASE2_PASSES = 3  # 1 initial + 2 reinforcement

    async def phase_2_extract_rules(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 2: Extract business rules via 3 AI passes with RAG injection.
        Pass 1: initial extraction. Pass 2-3: reinforcement to find missed rules.
        """
        self._set_phase_status(project_id, 2, "running")
        jm = JobManager(self.db)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        jm.update_progress(job_id, 5.0, "Fase 2/4: Preparando extracao de regras...")

        # Delete old business rules
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

        # Verify Phase 1 has indexed files
        code_file_count = self.db.execute(sql_text(
            "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
            "AND metadata->>'type' = 'code_file'"
        ), {"pid": str(project_id)}).scalar() or 0

        if code_file_count == 0:
            self._set_phase_status(project_id, 2, "failed")
            raise ValueError("Nenhum arquivo indexado encontrado. Execute Phase 1 primeiro.")

        logger.info(f"Phase 2: {code_file_count} code files indexed, {self.PHASE2_PASSES} passes")

        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)

        project_name = project.name or "Projeto"
        total_rules = 0

        for pass_num in range(1, self.PHASE2_PASSES + 1):
            pct_base = 5 + (85 * (pass_num - 1) // self.PHASE2_PASSES)
            pct_end = 5 + (85 * pass_num // self.PHASE2_PASSES)

            jm.update_progress(job_id, pct_base,
                f"Fase 2/4: Passada {pass_num}/{self.PHASE2_PASSES} — "
                f"{total_rules} regras ate agora...")

            if pass_num == 1:
                user_prompt = (
                    f"Extraia todas as regras de negocio possiveis a partir de todo o "
                    f"codigo-fonte e documentacao do projeto \"{project_name}\" "
                    f"que esta indexado na base de conhecimento.\n\n"
                    f"O projeto tem {code_file_count} arquivos indexados. "
                    f"Analise CADA modelo, servico, rota, validacao, schema, migration, "
                    f"configuracao e documentacao presente no contexto.\n\n"
                    f"Liste TODAS as regras encontradas em portugues, categorizadas por tipo "
                    f"(dominio, validacao, restricao, workflow, permissao, calculo, integracao, negocio).\n\n"
                    f"NAO pare ate ter extraido TODAS as regras possiveis do contexto fornecido."
                )
            else:
                # Get current rules to send as context for reinforcement
                current_rules = self.db.execute(sql_text(
                    "SELECT content FROM rag_documents WHERE project_id = :pid "
                    "AND metadata->>'type' = 'business_rule' LIMIT 200"
                ), {"pid": str(project_id)}).fetchall()
                rules_summary = "\n".join(f"- {r[0][:120]}" for r in current_rules)

                user_prompt = (
                    f"Voce ja extraiu {total_rules} regras de negocio do projeto "
                    f"\"{project_name}\". Aqui esta um resumo das regras ja encontradas:\n\n"
                    f"{rules_summary}\n\n"
                    f"Agora, faca uma NOVA varredura completa na base de conhecimento "
                    f"e encontre TODAS as regras de negocio que AINDA NAO foram extraidas.\n\n"
                    f"Foque em areas que podem ter sido ignoradas: validacoes sutis, "
                    f"restricoes implicitas, regras de permissao, calculos escondidos, "
                    f"workflows secundarios, integracao entre servicos, edge cases.\n\n"
                    f"Retorne APENAS regras NOVAS que NAO estao na lista acima."
                )

            try:
                response = await orchestrator.execute(
                    usage_type="rag_extraction",
                    messages=[{"role": "user", "content": user_prompt}],
                    system_prompt=self.PHASE2_SYSTEM_PROMPT,
                    max_tokens=32000,
                    project_id=project_id,
                    enable_rag=True,
                    rag_top_k=self.PHASE2_RAG_TOP_K,
                    rag_similarity_threshold=self.PHASE2_RAG_THRESHOLD,
                    metadata={"phase": "rag_pipeline_phase2", "pass": pass_num},
                    thinking=self.THINKING_CONFIG,
                )

                raw = response.get("content", "")
                rules = self._parse_rules_json(raw)
                pass_rules = self._store_rules(rules, project_id)
                self.db.commit()
                total_rules += pass_rules

                logger.info(f"Phase 2 pass {pass_num}/{self.PHASE2_PASSES}: +{pass_rules} rules (total: {total_rules})")

            except Exception as e:
                logger.error(f"Phase 2 pass {pass_num} failed: {e}")
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
            raise ValueError("Extracao falhou: 0 regras extraidas")

        self._set_phase_status(project_id, 2, "completed")
        jm.update_progress(
            job_id, 95.0,
            f"Fase 2/4: Concluida — {total_rules} regras em {self.PHASE2_PASSES} passadas"
        )
        return {
            "phase": "extract_rules",
            "rules_extracted": total_rules,
            "files_in_rag": code_file_count,
            "passes": self.PHASE2_PASSES,
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
    # PHASE 3: Generate cards from business rules via single AI prompt
    # Uses enable_rag=True to inject business rules from RAG.
    # =========================================================================

    PHASE3_SYSTEM_PROMPT = (
        "Voce e um Product Owner senior especializado em estruturar backlogs "
        "de projetos de software a partir de regras de negocio.\n\n"
        "Voce vai receber as regras de negocio de um projeto extraidas da base "
        "de conhecimento. Seu objetivo e criar uma hierarquia completa de cards.\n\n"
        "HIERARQUIA (enum obrigatorio):\n"
        "  epic > story > task > subtask\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "CONTRATO DE RESPOSTA — SCHEMA RIGIDO (qualquer desvio sera descartado)\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicacoes.\n\n"
        "{\n"
        '  "cards": [\n'
        "    {\n"
        '      "title": "string OBRIGATORIA, 5-255 caracteres, titulo claro e descritivo em portugues",\n'
        '      "description": "string OBRIGATORIA, minimo 50 caracteres (idealmente 200-2000). '
        'Descreva em DETALHES: o que a demanda resolve, por que e importante, contexto tecnico, '
        'dependencias e impacto no sistema.",\n'
        '      "item_type": "string OBRIGATORIA, enum: epic|story|task|subtask",\n'
        '      "parent_title": "string ou null. Titulo EXATO do card pai. null para epics de nivel raiz.",\n'
        '      "story_points": "integer OBRIGATORIO, Fibonacci: 1|2|3|5|8|13",\n'
        '      "priority": "string OBRIGATORIA, enum: critical|high|medium|low",\n'
        '      "labels": "array de strings, 1-10 labels descritivas (ex: [\"autenticacao\", \"backend\"])",\n'
        '      "acceptance_criteria": "array de strings, minimo 2 criterios por card, '
        'cada criterio com minimo 15 caracteres, descrevendo condicao verificavel de aceite"\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "REGRAS DO CONTRATO:\n"
        "- title: 5-255 caracteres, UNICO no projeto, sem prefixos numericos\n"
        "- description: MINIMO 50 caracteres, idealmente 200-2000 caracteres. "
        "QUANTO MAIS DETALHE, MELHOR. Inclua: contexto, motivacao, requisitos tecnicos, "
        "dependencias, e como se integra com o resto do sistema.\n"
        "- item_type: EXATAMENTE um dos 4 valores do enum\n"
        "- parent_title: DEVE corresponder ao title EXATO de outro card na lista. null para epics raiz.\n"
        "  story tem parent_title de um epic. task tem parent_title de uma story. subtask de uma task.\n"
        "- story_points: Fibonacci APENAS (1,2,3,5,8,13). Epics: 8-13. Stories: 3-8. Tasks: 1-5. Subtasks: 1-2.\n"
        "- priority: EXATAMENTE um dos 4 valores\n"
        "- labels: array de 1-10 strings, cada label 2-50 caracteres, lowercase, sem espacos (use hifens)\n"
        "- acceptance_criteria: MINIMO 2 criterios, MAXIMO 20. Cada criterio e uma string verificavel "
        "com minimo 15 caracteres. Criterios devem ser especificos e testáveis.\n"
        "- Todos os textos em PORTUGUES\n"
        "- Hierarquia COMPLETA: cada epic deve ter stories, cada story deve ter tasks\n"
        "- NAO crie cards orphaos (sem pai) exceto epics de nivel raiz\n"
        "- PREFIRA descricoes RICAS e DETALHADAS a descricoes curtas e genericas."
    )

    PHASE3_PASSES = 3  # 1 initial + 2 reinforcement

    async def phase_3_generate_cards(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 3: Generate cards via 3 AI passes with RAG injection.
        Pass 1: initial card generation. Pass 2-3: reinforcement for missed cards.
        """
        self._set_phase_status(project_id, 3, "running")
        jm = JobManager(self.db)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError("Project not found")

        jm.update_progress(job_id, 5.0, "Fase 3/4: Gerando cards a partir das regras...")

        # Verify business rules exist
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

        for pass_num in range(1, self.PHASE3_PASSES + 1):
            pct_base = 5 + (85 * (pass_num - 1) // self.PHASE3_PASSES)

            jm.update_progress(job_id, pct_base,
                f"Fase 3/4: Passada {pass_num}/{self.PHASE3_PASSES} — "
                f"{total_cards} cards ate agora...")

            if pass_num == 1:
                user_prompt = (
                    f"Pegue todas as regras de negocio presentes na base de conhecimento "
                    f"do projeto \"{project_name}\" e crie todos os cards "
                    f"usando a hierarquia: Epic > Story > Task > Subtask.\n\n"
                    f"O projeto tem {rule_count} regras de negocio indexadas. "
                    f"Use a estrutura do codigo como referencia de formatacao.\n\n"
                    f"Agrupe regras relacionadas em Epics, decomponha em Stories com "
                    f"criterios de aceitacao, depois em Tasks tecnicas e Subtasks atomicas.\n\n"
                    f"Gere o MAXIMO de cards possiveis para cobrir TODAS as regras."
                )
            else:
                # Get existing card titles for reinforcement context
                existing_cards = self.db.query(Task.title, Task.item_type).filter(
                    Task.project_id == project_id,
                    Task.reporter == "pipeline_phase3",
                ).all()
                cards_summary = "\n".join(
                    f"- [{c.item_type}] {c.title}" for c in existing_cards
                )

                user_prompt = (
                    f"Voce ja criou {total_cards} cards para o projeto \"{project_name}\". "
                    f"Aqui estao os cards ja criados:\n\n"
                    f"{cards_summary}\n\n"
                    f"Agora, faca uma NOVA analise das regras de negocio na base de conhecimento "
                    f"e crie cards para TUDO que ainda NAO foi coberto.\n\n"
                    f"Foque em: regras sem card correspondente, areas funcionais ignoradas, "
                    f"stories que faltam em epics existentes, tasks e subtasks faltantes.\n\n"
                    f"Retorne APENAS cards NOVOS que NAO existem na lista acima."
                )

            try:
                response = await orchestrator.execute(
                    usage_type="content_generation",
                    messages=[{"role": "user", "content": user_prompt}],
                    system_prompt=self.PHASE3_SYSTEM_PROMPT,
                    max_tokens=32000,
                    project_id=project_id,
                    enable_rag=True,
                    rag_top_k=self.PHASE2_RAG_TOP_K,
                    rag_similarity_threshold=self.PHASE2_RAG_THRESHOLD,
                    metadata={"phase": "rag_pipeline_phase3", "pass": pass_num},
                    thinking=self.THINKING_CONFIG,
                )

                raw = response.get("content", "")
                pass_cards = self._create_cards_from_json(raw, project_id)
                self.db.commit()
                total_cards += pass_cards

                logger.info(f"Phase 3 pass {pass_num}/{self.PHASE3_PASSES}: +{pass_cards} cards (total: {total_cards})")

            except Exception as e:
                logger.error(f"Phase 3 pass {pass_num} failed: {e}")
                continue

        if total_cards == 0:
            self._set_phase_status(project_id, 3, "failed")
            raise ValueError("Geracao falhou: 0 cards criados")

        self._set_phase_status(project_id, 3, "completed")
        jm.update_progress(job_id, 95.0,
            f"Fase 3/4: Concluida — {total_cards} cards em {self.PHASE3_PASSES} passadas")
        return {
            "phase": "generate_cards",
            "cards_created": total_cards,
            "rules_in_rag": rule_count,
            "passes": self.PHASE3_PASSES,
        }

    # =====================================================================
    # PHASE 3 VALIDATORS — strict contract enforcement for cards
    # =====================================================================

    VALID_ITEM_TYPES = frozenset({"epic", "story", "task", "subtask"})
    VALID_FIBONACCI = frozenset({1, 2, 3, 5, 8, 13})

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
                "labels": labels,
                "acceptance_criteria": acceptance_criteria or None,
            })

        if rejected:
            logger.info(f"Phase 3 validator: {len(valid_cards)} accepted, {rejected} rejected")

        if not valid_cards:
            return 0

        # ---- PASS 2: Create DB records ----
        title_to_id = {}
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
                labels=card["labels"],
                acceptance_criteria=card["acceptance_criteria"],
                order=created,
            )
            self.db.add(task)
            self.db.flush()
            title_to_id[task.title] = task.id
            created += 1

        # ---- PASS 3: Set parent_id based on parent_title ----
        for card in valid_cards:
            title = card["title"]
            parent_title = card.get("parent_title")
            if title and parent_title and parent_title in title_to_id and title in title_to_id:
                self.db.execute(sql_text(
                    "UPDATE tasks SET parent_id = :parent_id WHERE id = :task_id"
                ), {
                    "parent_id": str(title_to_id[parent_title]),
                    "task_id": str(title_to_id[title]),
                })

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
        Phase 4: Generate wiki + title + description via 3 AI passes.
        Pass 1: initial generation. Pass 2-3: reinforce and expand wiki pages.
        """
        self._set_phase_status(project_id, 4, "running")
        jm = JobManager(self.db)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        jm.update_progress(job_id, 5.0, "Fase 4/4: Gerando wiki, titulo e descricao...")

        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)

        project_name = project.name or "Projeto"
        total_pages = 0

        for pass_num in range(1, self.PHASE4_PASSES + 1):
            pct_base = 5 + (85 * (pass_num - 1) // self.PHASE4_PASSES)

            jm.update_progress(job_id, pct_base,
                f"Fase 4/4: Passada {pass_num}/{self.PHASE4_PASSES} — "
                f"{total_pages} paginas ate agora...")

            if pass_num == 1:
                user_prompt = (
                    f"Pegue todas as regras de negocio e todo o codigo-fonte presentes "
                    f"na base de conhecimento do projeto \"{project_name}\" "
                    f"e crie toda a estrutura de documentacao:\n\n"
                    f"1. Um titulo conciso para o projeto (max 60 caracteres)\n"
                    f"2. Uma descricao clara em 2-4 frases\n"
                    f"3. Todas as paginas wiki usando a estrutura do codigo como referencia\n\n"
                    f"Use o codigo-fonte REAL do projeto para criar paginas ricas e precisas. "
                    f"Documente padroes, convencoes, regras de negocio, APIs, componentes "
                    f"e estrutura de codigo encontrados.\n\n"
                    f"Gere o conteudo COMPLETO de cada pagina wiki em Markdown."
                )
            else:
                # Get existing wiki page slugs for reinforcement
                existing_pages = self.db.execute(sql_text(
                    "SELECT metadata->>'slug' as slug, metadata->>'title' as title "
                    "FROM rag_documents WHERE project_id = :pid "
                    "AND metadata->>'type' = 'wiki_page'"
                ), {"pid": str(project_id)}).fetchall()
                pages_summary = "\n".join(
                    f"- [{p[0]}] {p[1]}" for p in existing_pages if p[0]
                )

                user_prompt = (
                    f"Voce ja criou {total_pages} paginas wiki para o projeto "
                    f"\"{project_name}\". Paginas existentes:\n\n"
                    f"{pages_summary}\n\n"
                    f"Agora, faca uma NOVA analise da base de conhecimento e:\n"
                    f"1. Crie paginas wiki para areas que AINDA NAO foram documentadas\n"
                    f"2. Expanda paginas existentes com mais detalhes se necessario "
                    f"(use o MESMO slug para atualizar)\n\n"
                    f"Foque em: APIs nao documentadas, workflows complexos, "
                    f"configuracoes importantes, guias de desenvolvimento, "
                    f"padroes de teste, deploy e infraestrutura.\n\n"
                    f"NAO inclua titulo e descricao do projeto (ja foram gerados)."
                )

            try:
                response = await orchestrator.execute(
                    usage_type="content_generation",
                    messages=[{"role": "user", "content": user_prompt}],
                    system_prompt=self.PHASE4_SYSTEM_PROMPT,
                    max_tokens=32000,
                    project_id=project_id,
                    enable_rag=True,
                    rag_top_k=self.PHASE2_RAG_TOP_K,
                    rag_similarity_threshold=self.PHASE2_RAG_THRESHOLD,
                    metadata={"phase": "rag_pipeline_phase4", "pass": pass_num},
                    thinking=self.THINKING_CONFIG,
                )

                raw = response.get("content", "")
                result = self._save_wiki_and_metadata(raw, project_id, project)
                self.db.commit()
                total_pages += result["pages_created"]

                logger.info(
                    f"Phase 4 pass {pass_num}/{self.PHASE4_PASSES}: "
                    f"+{result['pages_created']} pages (total: {total_pages})"
                )

            except Exception as e:
                logger.error(f"Phase 4 pass {pass_num} failed: {e}")
                continue

        if total_pages == 0:
            self._set_phase_status(project_id, 4, "failed")
            raise ValueError("Geracao falhou: 0 paginas wiki criadas")

        self._set_phase_status(project_id, 4, "completed")
        jm.update_progress(job_id, 95.0,
            f"Fase 4/4: Concluida — {total_pages} paginas em {self.PHASE4_PASSES} passadas")
        return {
            "phase": "generate_wiki",
            "pages_created": total_pages,
            "passes": self.PHASE4_PASSES,
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

