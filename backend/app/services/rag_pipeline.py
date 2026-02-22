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

    PHASE2_SYSTEM_PROMPT = (
        "Voce e um analista de negocios senior especializado em engenharia reversa "
        "de requisitos funcionais a partir de codebases existentes.\n\n"
        "Voce vai receber o contexto completo de um projeto de software indexado "
        "na base de conhecimento. Seu objetivo e extrair TODAS as regras de negocio "
        "possiveis a partir desse contexto.\n\n"
        "Regras de negocio sao qualquer logica que define COMO o sistema se comporta "
        "do ponto de vista do USUARIO ou do DOMINIO do negocio.\n\n"
        "CATEGORIAS DE REGRAS que voce deve procurar:\n"
        "- **dominio**: Entidades, relacionamentos, estados, ciclos de vida\n"
        "- **validacao**: Validacoes de entrada, formatos, campos obrigatorios\n"
        "- **restricao**: Limites numericos, tamanhos, quotas, thresholds\n"
        "- **workflow**: Fluxos de usuario, maquinas de estado, transicoes\n"
        "- **permissao**: Controle de acesso, roles, autorizacoes\n"
        "- **calculo**: Formulas, algoritmos, agregacoes, metricas\n"
        "- **integracao**: APIs externas, webhooks, eventos entre servicos\n"
        "- **negocio**: Politicas de negocio, regras de precificacao, SLAs\n\n"
        "IGNORE completamente:\n"
        "- Configuracoes de framework (middleware, rotas, DI)\n"
        "- CSS, estilos, layouts puros (sem logica)\n"
        "- Logs, prints, debug\n"
        "- Infraestrutura (Docker, CI/CD, deploy)\n"
        "- Imports e boilerplate\n\n"
        "FORMATO DE RESPOSTA: JSON puro, sem markdown, sem explicacoes.\n"
        "Cada regra deve ser escrita em PORTUGUES, como se voce explicasse "
        "para um gerente de produto que NAO conhece o codigo.\n\n"
        "IMPORTANTE: Extraia o MAXIMO de regras possivel. Analise CADA modelo, "
        "servico, rota, validacao, schema, configuracao e documentacao presente "
        "no contexto. Nao pare ate ter coberto TUDO.\n\n"
        "Responda APENAS com o JSON no formato:\n"
        '{"business_rules": [\n'
        '  {"rule_text": "Descricao clara da regra em portugues", '
        '"rule_type": "dominio|validacao|restricao|workflow|permissao|calculo|integracao|negocio", '
        '"source_file": "caminho/do/arquivo.ext", '
        '"priority": "high|normal|low"}\n'
        "]}"
    )

    # Claude Opus 4.6: 200K context window
    # rag_top_k=300 → ~300 docs × ~500 tokens = ~150K tokens RAG context
    # Sobram ~35K para prompts + 16K para resposta
    PHASE2_RAG_TOP_K = 300
    PHASE2_RAG_THRESHOLD = 0.1

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
                    max_tokens=16384,
                    project_id=project_id,
                    enable_rag=True,
                    rag_top_k=self.PHASE2_RAG_TOP_K,
                    rag_similarity_threshold=self.PHASE2_RAG_THRESHOLD,
                    metadata={"phase": "rag_pipeline_phase2", "pass": pass_num},
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

    def _parse_rules_json(self, raw: str) -> List[Any]:
        """Parse business rules JSON from AI response."""
        try:
            json_match = re.search(r'\{[\s\S]*\}', raw)
            if json_match:
                parsed = json.loads(json_match.group())
                return parsed.get("business_rules", [])
        except json.JSONDecodeError as e:
            logger.error(f"Phase 2 JSON parse error: {e}")
        return []

    def _store_rules(self, rules: List[Any], project_id: UUID) -> int:
        """Parse and store extracted rules in RAG. Returns count stored."""
        stored = 0
        for rule in rules:
            if isinstance(rule, str):
                rule_text, rule_type, source_file, priority = rule, "general", "", "normal"
            elif isinstance(rule, dict):
                rule_text = (
                    rule.get("rule_text") or rule.get("description")
                    or rule.get("rule") or rule.get("text") or ""
                )
                rule_type = rule.get("rule_type", "general")
                source_file = rule.get("source_file", "")
                priority = rule.get("priority", "normal")
            else:
                continue

            if not rule_text or len(rule_text.strip()) < 10:
                continue

            self.rag.store_business_rule(
                content=rule_text,
                project_id=project_id,
                source="pipeline_phase2",
                source_file=source_file,
                rule_type=rule_type,
                priority=priority,
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
        "de conhecimento. Seu objetivo e criar uma hierarquia completa de cards "
        "(demandas) no formato usado por ferramentas como JIRA.\n\n"
        "HIERARQUIA OBRIGATORIA:\n"
        "- **epic**: Modulos ou grandes areas funcionais do sistema\n"
        "- **story**: Historias de usuario dentro de cada epic\n"
        "- **task**: Tarefas tecnicas para implementar cada story\n"
        "- **subtask**: Sub-tarefas atomicas dentro de cada task\n\n"
        "REGRAS DE GERACAO:\n"
        "- Cada epic deve agrupar regras de negocio relacionadas\n"
        "- Cada story deve ter criterios de aceitacao claros\n"
        "- Cada task deve ser implementavel por um desenvolvedor\n"
        "- Cada subtask deve ser atomica (1-2 horas de trabalho)\n"
        "- Titulos concisos e descritivos em PORTUGUES\n"
        "- Descricoes claras explicando O QUE e POR QUE\n"
        "- story_points em Fibonacci: 1, 2, 3, 5, 8, 13\n"
        "- priority: critical, high, medium, low\n\n"
        "FORMATO DE RESPOSTA: JSON puro, sem markdown.\n"
        "Responda APENAS com o JSON:\n"
        '{"cards": [\n'
        '  {"title": "Titulo do Card", '
        '"description": "Descricao detalhada", '
        '"item_type": "epic|story|task|subtask", '
        '"parent_title": null ou "Titulo do Epic/Story pai", '
        '"story_points": 5, '
        '"priority": "high|medium|low|critical", '
        '"labels": ["area1", "area2"], '
        '"acceptance_criteria": ["Criterio 1", "Criterio 2"]}\n'
        "]}"
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
                    max_tokens=16384,
                    project_id=project_id,
                    enable_rag=True,
                    rag_top_k=self.PHASE2_RAG_TOP_K,
                    rag_similarity_threshold=self.PHASE2_RAG_THRESHOLD,
                    metadata={"phase": "rag_pipeline_phase3", "pass": pass_num},
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

    def _create_cards_from_json(self, raw: str, project_id: UUID) -> int:
        """Parse AI JSON response and create Task records in DB."""
        from app.models.task import Task

        try:
            json_match = re.search(r'\{[\s\S]*\}', raw)
            if not json_match:
                return 0
            parsed = json.loads(json_match.group())
            cards = parsed.get("cards", [])
        except (json.JSONDecodeError, Exception) as e:
            logger.error(f"Phase 3 JSON parse error: {e}")
            return 0

        # First pass: create all cards and map titles to IDs
        title_to_id = {}
        created = 0

        for card in cards:
            if not isinstance(card, dict):
                continue
            title = (card.get("title") or "").strip()
            if not title:
                continue

            item_type = card.get("item_type", "task")
            if item_type not in ("epic", "story", "task", "subtask"):
                item_type = "task"

            ac_list = card.get("acceptance_criteria", [])
            acceptance_criteria = []
            if isinstance(ac_list, list):
                for ac in ac_list:
                    if isinstance(ac, str):
                        acceptance_criteria.append({"text": ac, "completed": False})
                    elif isinstance(ac, dict):
                        acceptance_criteria.append(ac)

            task = Task(
                title=title[:255],
                description=card.get("description", ""),
                item_type=item_type,
                project_id=project_id,
                workflow_state="done",
                reporter="pipeline_phase3",
                story_points=card.get("story_points"),
                priority=card.get("priority", "medium"),
                labels=card.get("labels", []),
                acceptance_criteria=acceptance_criteria or None,
                order=created,
            )
            self.db.add(task)
            self.db.flush()
            title_to_id[title] = task.id
            created += 1

        # Second pass: set parent_id based on parent_title
        for card in cards:
            if not isinstance(card, dict):
                continue
            title = (card.get("title") or "").strip()
            parent_title = (card.get("parent_title") or "").strip()
            if title and parent_title and parent_title in title_to_id and title in title_to_id:
                self.db.execute(sql_text(
                    "UPDATE tasks SET parent_id = :parent_id WHERE id = :task_id"
                ), {"parent_id": str(title_to_id[parent_title]), "task_id": str(title_to_id[title])})

        return created

    # =========================================================================
    # PHASE 4: Generate wiki + title + description via single AI prompt
    # Uses enable_rag=True to inject all project context from RAG.
    # =========================================================================

    PHASE4_SYSTEM_PROMPT = (
        "Voce e um documentador tecnico senior especializado em criar "
        "wikis completas de projetos de software.\n\n"
        "Voce vai receber o contexto completo de um projeto (codigo, regras "
        "de negocio, estrutura) da base de conhecimento. Seu objetivo e gerar "
        "TUDO de uma vez:\n\n"
        "1. **Titulo do projeto** — conciso, max 60 caracteres\n"
        "2. **Descricao do projeto** — 2-4 frases claras\n"
        "3. **Paginas wiki** — documentacao completa do projeto\n\n"
        "PAGINAS WIKI OBRIGATORIAS:\n"
        "- **visao-geral**: Visao geral do projeto, proposito, arquitetura\n"
        "- **padroes-arquitetura**: Padroes arquiteturais usados (MVC, CQRS, etc.)\n"
        "- **convencoes-codigo**: Convencoes de codificacao, naming, estilo\n"
        "- **regras-negocio**: Catalogo completo de regras de negocio\n"
        "- **estrutura-codigo**: Organizacao de pastas, modulos, pacotes\n"
        "- **componentes-interface**: Componentes UI, design system, paginas\n"
        "- **integracao-api**: APIs, endpoints, webhooks, servicos externos\n\n"
        "Cada pagina deve ter conteudo RICO em Markdown com headers, listas, "
        "exemplos de codigo quando relevante.\n\n"
        "TUDO em PORTUGUES.\n\n"
        "FORMATO DE RESPOSTA: JSON puro, sem markdown externo.\n"
        '{"title": "Titulo do Projeto", '
        '"description": "Descricao clara do projeto...", '
        '"wiki_pages": [\n'
        '  {"slug": "visao-geral", "title": "Visao Geral", '
        '"content": "# Visao Geral\\n\\nConteudo em markdown...", '
        '"order": 1}\n'
        "]}"
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
                    max_tokens=16384,
                    project_id=project_id,
                    enable_rag=True,
                    rag_top_k=self.PHASE2_RAG_TOP_K,
                    rag_similarity_threshold=self.PHASE2_RAG_THRESHOLD,
                    metadata={"phase": "rag_pipeline_phase4", "pass": pass_num},
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

    def _save_wiki_and_metadata(self, raw: str, project_id: UUID, project: Project) -> Dict:
        """Parse AI JSON response and save wiki pages, title, description."""
        from app.services.wiki_service import _upsert_wiki_page

        result = {"pages_created": 0, "title_generated": False, "description_generated": False}

        try:
            json_match = re.search(r'\{[\s\S]*\}', raw)
            if not json_match:
                return result
            parsed = json.loads(json_match.group())
        except (json.JSONDecodeError, Exception) as e:
            logger.error(f"Phase 4 JSON parse error: {e}")
            return result

        # REGRA #0: Title — only if empty (human data is sacred)
        title = (parsed.get("title") or "").strip()
        if title and not (project.name and project.name.strip()):
            project.name = title[:100]
            result["title_generated"] = True
            logger.info(f"Phase 4: Generated title: {title}")

        # REGRA #0: Description — only if empty
        description = (parsed.get("description") or "").strip()
        if description and not (project.description and project.description.strip()):
            project.description = description[:2000]
            result["description_generated"] = True
            logger.info(f"Phase 4: Generated description")

        # Wiki pages
        code_path = project.code_path
        wiki_pages = parsed.get("wiki_pages", [])
        for page in wiki_pages:
            if not isinstance(page, dict):
                continue
            slug = (page.get("slug") or "").strip()
            page_title = (page.get("title") or "").strip()
            content = (page.get("content") or "").strip()
            order = page.get("order", 1)

            if not slug or not content:
                continue

            try:
                _upsert_wiki_page(
                    code_path, project_id, slug,
                    page_title or slug, content,
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
                logger.warning(f"Wiki page {slug} failed: {e}")

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

