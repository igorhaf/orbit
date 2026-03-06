"""
RAG Pipeline Phase 2: Extract business rules via AI.

Multi-pass batch processing over all code files.
Each pass re-scans all files for missed rules.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, TYPE_CHECKING
from uuid import UUID

from sqlalchemy import text as sql_text

from app.models.project import Project
from app.models.rag_file_state import RAGFileState, FileProcessingStatus
from app.services.job_manager import JobManager

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class Phase2Mixin:
    """Mixin providing phase_2_extract_rules and related helpers."""

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
        "- Extraia o MAXIMO de regras -- validacoes, restricoes, workflows, permissoes, calculos\n"
        "- NAO invente regras -- apenas o que EXISTE no codigo\n"
        "- Descricoes SEMPRE em PORTUGUES\n"
        "- Se nenhuma regra: {\"business_rules\": []}\n"
        "- source_file = caminho relativo do arquivo"
    )

    # Number of extraction passes (each pass re-scans all files for missed rules)
    PHASE2_NUM_PASSES = 3

    # =====================================================================
    # PHASE 2 VALIDATORS -- strict contract enforcement for business rules
    # =====================================================================

    VALID_RULE_TYPES = frozenset({
        "dominio", "validacao", "restricao", "workflow",
        "permissao", "calculo", "integracao", "negocio",
    })
    VALID_PRIORITIES = frozenset({"critical", "high", "medium", "low"})

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
                    f"\n\nREGRAS JA ENCONTRADAS ({len(found_rule_summaries)} total) -- "
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
                    f"lote {batch_num}/{total_batches} -- {total_rules} regras"
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
                f"Phase 2: Pass {pass_num}/{num_passes} complete -- "
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
            f"Fase 2/4: Concluida -- {total_rules} regras em {num_passes} passes"
        )
        return {
            "phase": "extract_rules",
            "rules_extracted": total_rules,
            "code_files": code_count,
            "batches": total_batches,
            "passes": num_passes,
        }

    # =====================================================================
    # ROBUST JSON EXTRACTOR -- handles markdown fences, trailing commas,
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
            # Pattern: ..."field":"value"] ,{ -> ..."field":"value"} ,{
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
                fully_coded=True,
            )
            stored += 1
        return stored
