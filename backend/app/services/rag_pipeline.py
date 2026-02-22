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

    async def phase_2_extract_rules(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 2: Extract business rules via single AI prompt with RAG injection.
        Uses enable_rag=True with high top_k to leverage Claude's 200K context.
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

        logger.info(f"Phase 2: {code_file_count} code files indexed, using RAG injection")

        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)

        jm.update_progress(job_id, 10.0,
            f"Fase 2/4: Extraindo regras de negocio de {code_file_count} arquivos via IA...")

        user_prompt = (
            f"Extraia todas as regras de negocio possiveis a partir de todo o "
            f"codigo-fonte e documentacao do projeto \"{project.name or 'Projeto'}\" "
            f"que esta indexado na base de conhecimento.\n\n"
            f"O projeto tem {code_file_count} arquivos indexados. "
            f"Analise CADA modelo, servico, rota, validacao, schema, migration, "
            f"configuracao e documentacao presente no contexto.\n\n"
            f"Liste TODAS as regras encontradas em portugues, categorizadas por tipo "
            f"(dominio, validacao, restricao, workflow, permissao, calculo, integracao, negocio).\n\n"
            f"NAO pare ate ter extraido TODAS as regras possiveis do contexto fornecido."
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
                metadata={"phase": "rag_pipeline_phase2"},
            )

            jm.update_progress(job_id, 70.0, "Fase 2/4: Processando regras extraidas...")

            raw = response.get("content", "")
            rules = self._parse_rules_json(raw)
            total_rules = self._store_rules(rules, project_id)
            self.db.commit()

            logger.info(f"Phase 2: {total_rules} business rules extracted and stored")

        except Exception as e:
            self._set_phase_status(project_id, 2, "failed")
            raise ValueError(f"Extracao falhou: {e}")

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
            f"Fase 2/4: Concluida — {total_rules} regras extraidas"
        )
        return {
            "phase": "extract_rules",
            "rules_extracted": total_rules,
            "files_in_rag": code_file_count,
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
    # PHASE 3: Generate cards from business rules (closed status)
    # =========================================================================
    async def phase_3_generate_cards(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 3: Generate cards from business rules in RAG.
        Cards come CLOSED (workflow_state=done) since rules are already validated.
        """
        self._set_phase_status(project_id, 3, "running")
        jm = JobManager(self.db)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError("Project not found")

        jm.update_progress(job_id, 5.0, "Fase 3/4: Gerando cards a partir das regras...")

        # Use existing card generation logic with content_generation flow (Opus 4.6)
        from app.services.context_generator import ContextGeneratorService
        context_service = ContextGeneratorService(self.db)
        context_service._usage_type_override = "content_generation"

        result = await context_service.generate_cards_from_memory(
            project_id=project_id,
            job_manager=jm,
            job_id=job_id,
        )

        # Mark all generated cards as done (closed)
        from app.models.task import Task
        updated = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.reporter == "watchdog",
            Task.workflow_state.in_(["draft", "open", "backlog"]),
        ).update({"workflow_state": "done"}, synchronize_session="fetch")
        self.db.commit()

        self._set_phase_status(project_id, 3, "completed")

        cards_result = {
            "phase": "generate_cards",
            "business_rule_cards": len(result.get("business_rule_cards", [])),
            "suggested_epics": len(result.get("suggested_epics", [])),
            "cards_closed": updated,
        }
        jm.update_progress(job_id, 95.0, f"Fase 3/4: Concluída — {updated} cards gerados")
        return cards_result

    # =========================================================================
    # PHASE 4: Generate wiki + title + description (1 AI call)
    # =========================================================================
    async def phase_4_generate_wiki(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Phase 4: Generate wiki + project title + description.
        Uses 1 AI call for everything. Wiki pages also indexed in RAG.
        """
        self._set_phase_status(project_id, 4, "running")
        jm = JobManager(self.db)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        jm.update_progress(job_id, 5.0, "Fase 4/4: Preparando geração de wiki...")

        # Step 1: Generate wiki pages using existing wiki service
        jm.update_progress(job_id, 10.0, "Fase 4/4: Gerando páginas wiki...")
        from app.services.wiki_service import (
            _upsert_wiki_page,
            _build_architecture_patterns_page,
            _build_code_conventions_page,
            _build_ui_components_page,
            _build_code_structure_page,
            _build_git_history_page,
            _build_business_rules_wiki_pages,
            _apply_semantic_links_to_project_fs,
        )

        code_path = project.code_path
        pages_created = 0

        # DB-only wiki pages
        rag_page_builders = [
            ("padroes-arquitetura", "Padrões de Arquitetura", _build_architecture_patterns_page, 6),
            ("convencoes-codigo", "Convenções de Código", _build_code_conventions_page, 7),
            ("componentes-interface", "Componentes e Interface", _build_ui_components_page, 8),
            ("estrutura-codigo", "Estrutura de Código", _build_code_structure_page, 9),
            ("historico-desenvolvimento", "Histórico de Desenvolvimento", _build_git_history_page, 10),
        ]

        for slug, title, builder, order in rag_page_builders:
            try:
                content = builder(self.db, project_id)
                if content:
                    _upsert_wiki_page(code_path, project_id, slug, title, content, order, "ai_generated")
                    # Index wiki page in RAG
                    self.rag.store(
                        content=content,
                        metadata={"type": "wiki_page", "slug": slug, "title": title},
                        project_id=project_id,
                    )
                    pages_created += 1
            except Exception as e:
                logger.warning(f"Wiki page {slug} failed: {e}")

        jm.update_progress(job_id, 30.0, "Fase 4/4: Gerando páginas de regras de negócio...")

        # Business rule wiki pages
        try:
            rule_pages = _build_business_rules_wiki_pages(self.db, code_path, project_id)
            pages_created += len(rule_pages) if rule_pages else 0
            # Index rule pages in RAG
            for rp in (rule_pages or []):
                if rp.get("content"):
                    self.rag.store(
                        content=rp["content"],
                        metadata={"type": "wiki_page", "slug": rp.get("slug", ""), "title": rp.get("title", "")},
                        project_id=project_id,
                    )
        except Exception as e:
            logger.warning(f"Business rules wiki failed: {e}")

        jm.update_progress(job_id, 50.0, "Fase 4/4: Aplicando links semânticos...")

        # Semantic linking
        try:
            _apply_semantic_links_to_project_fs(code_path, project_id)
        except Exception as e:
            logger.warning(f"Semantic links failed: {e}")

        jm.update_progress(job_id, 60.0, "Fase 4/4: Gerando visão geral, título e descrição...")

        # Step 2: Generate title + description via AI (1 prompt)
        title_desc_generated = False
        try:
            title_desc_generated = await self._generate_title_and_description(project_id, project)
        except Exception as e:
            logger.warning(f"Title/description generation failed: {e}")

        # Step 3: AI enrichment (Visão Geral page)
        jm.update_progress(job_id, 75.0, "Fase 4/4: Gerando Visão Geral via IA...")
        try:
            from app.services.project_service import _enrich_context_from_rag
            await _enrich_context_from_rag(self.db, project_id)
        except Exception as e:
            logger.warning(f"AI enrichment failed: {e}")

        self.db.commit()
        self._set_phase_status(project_id, 4, "completed")

        result = {
            "phase": "generate_wiki",
            "pages_created": pages_created,
            "title_description_generated": title_desc_generated,
        }
        jm.update_progress(job_id, 95.0, f"Fase 4/4: Concluída — {pages_created} páginas wiki geradas")
        return result

    # =========================================================================
    # Helper methods
    # =========================================================================

    async def _generate_title_and_description(self, project_id: UUID, project: Project) -> bool:
        """Generate project title and description from RAG (REGRA #0: only if empty)."""
        # Skip if already set by human
        has_title = bool(project.name and project.name.strip())
        has_description = bool(project.description and project.description.strip())

        if has_title and has_description:
            logger.info(f"Title/description already set for {project_id}, skipping (REGRA #0)")
            return False

        # Get business rules from RAG
        rules_result = self.db.execute(sql_text(
            "SELECT content FROM rag_documents WHERE project_id = :pid "
            "AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule') "
            "ORDER BY created_at DESC LIMIT 50"
        ), {"pid": str(project_id)})
        rules = [row[0][:200] for row in rules_result.fetchall()]

        if not rules:
            logger.info(f"No rules in RAG for {project_id}, cannot generate title/description")
            return False

        # Get stack info
        stack_info = ""
        if project.initial_memory_context and isinstance(project.initial_memory_context, dict):
            si = project.initial_memory_context.get("stack_info", {})
            if si and isinstance(si, dict):
                parts = []
                if si.get("languages"):
                    langs = si["languages"]
                    parts.append(f"Linguagens: {', '.join(langs) if isinstance(langs, list) else langs}")
                if si.get("frameworks"):
                    fws = si["frameworks"]
                    parts.append(f"Frameworks: {', '.join(fws) if isinstance(fws, list) else fws}")
                stack_info = "; ".join(parts)

        # AI call
        from app.services.ai_orchestrator import AIOrchestrator
        orchestrator = AIOrchestrator(self.db)

        system_prompt = (
            "Analise as regras de negócio e informações do projeto e gere:\n"
            "1. Um título conciso (máx 60 caracteres)\n"
            "2. Uma descrição clara em 2-4 frases\n\n"
            "Retorne APENAS JSON:\n"
            '{"title": "Título do Projeto", "description": "Descrição clara..."}'
        )

        rules_text = "\n".join(f"- {r}" for r in rules[:30])
        user_prompt = f"## Regras de Negócio:\n{rules_text}"
        if stack_info:
            user_prompt += f"\n\n## Stack: {stack_info}"

        # Include recent git commits for additional context
        try:
            commits = self._extract_git_commits(project.code_path, max_commits=50)
            if commits:
                commit_lines = [f"- [{c['date']}] {c['subject']}" for c in commits[:30]]
                user_prompt += f"\n\n## Commits Recentes:\n" + "\n".join(commit_lines)
        except Exception:
            pass

        try:
            response = await orchestrator.execute(
                usage_type="content_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=500,
                project_id=str(project_id),
                metadata={"type": "project_info_generation", "skip_context_build": True},
            )

            raw = response.get("content", "")
            import re
            json_match = re.search(r'\{[\s\S]*\}', raw)
            if json_match:
                parsed = json.loads(json_match.group())
                title = parsed.get("title", "").strip()
                description = parsed.get("description", "").strip()

                updated = False
                if title and not has_title:
                    project.name = title[:100]
                    updated = True
                    logger.info(f"Generated title for {project_id}: {title}")

                if description and not has_description:
                    project.description = description[:2000]
                    updated = True
                    logger.info(f"Generated description for {project_id}")

                if updated:
                    self.db.commit()
                return updated

        except Exception as e:
            logger.warning(f"Title/description AI call failed: {e}")

        return False

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

