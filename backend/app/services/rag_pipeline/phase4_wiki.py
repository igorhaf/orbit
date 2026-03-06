"""
RAG Pipeline Phase 4: Generate wiki + title + description.

Multi-batch approach:
  Batch 0: Overview (title, description, general architecture pages)
  Batch 1..N: One batch per entity/domain group of rules
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, TYPE_CHECKING
from uuid import UUID

from sqlalchemy import text as sql_text

from app.models.project import Project
from app.services.job_manager import JobManager

from .utils import SLUG_RE

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class Phase4Mixin:
    """Mixin providing phase_4_generate_wiki and related helpers."""

    # Phase 4 system prompt for OVERVIEW batch (title + description + general pages)
    PHASE4_OVERVIEW_PROMPT = (
        "Voce e um documentador tecnico senior. Voce vai receber regras de negocio "
        "REAIS de um projeto com exemplos concretos. Gere titulo, descricao e paginas wiki GERAIS.\n\n"
        "PAGINAS GERAIS A GERAR (visao macro do projeto):\n"
        "  visao-geral | padroes-arquitetura | convencoes-codigo | estrutura-codigo\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "CONTRATO JSON RIGIDO -- Responda APENAS com JSON puro, sem markdown.\n"
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
        "- NAO use termos genericos ('o sistema', 'a aplicacao') -- use nomes REAIS do projeto\n"
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
        "- NAO use termos genericos ('o sistema', 'a aplicacao') -- use nomes REAIS do projeto\n"
        "- Quando houver 'Evidencia:', inclua o trecho de codigo como bloco ```python ou ```typescript\n"
        "- Referencie PELO MENOS 3 regras de negocio concretas por pagina\n"
        "- Explique o PROPOSITO funcional de cada regra (ponto de vista do usuario)\n"
        "- Inclua diagramas de relacionamento em texto quando pertinente\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "CONTRATO JSON RIGIDO -- Responda APENAS com JSON puro, sem markdown.\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        '{"wiki_pages": [{"slug":"kebab-case","title":"Titulo","content":"Markdown RICO min 500 chars","order":1}]}\n\n'
        "REGRAS:\n"
        "- slug: kebab-case, UNICO, prefixe com dominio (ex: auth-visao-geral, task-regras)\n"
        "- content: MINIMO 500 caracteres Markdown RICO (##, ###, listas, tabelas, codigo)\n"
        "  Idealmente 2000-8000 chars por pagina. SEJA EXTENSO E DETALHADO.\n"
        "  CADA pagina DEVE citar nomes REAIS de entidades, arquivos, endpoints e servicos.\n"
        "  Inclua trechos de codigo como evidencia quando disponivel nas regras.\n"
        "- Todos os textos em PORTUGUES. NUNCA gere textos em ingles.\n"
        "- Conteudo 100% FACTUAL -- apenas o que esta nas regras fornecidas\n"
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

        # Group rules by entity -> domain batches
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
            f'5. NAO use termos genericos -- use nomes do projeto\n'
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
                f"({entities_label}) -- {total_pages} paginas ate agora"
            )

            domain_prompt = (
                f'Projeto: "{project_name}"\n'
                f'Dominio: {", ".join(batch["entities"])}\n'
                f'Regras neste dominio: {batch["rule_count"]}\n\n'
                f'REGRAS DE NEGOCIO DESTE DOMINIO (com evidencias de codigo):\n'
                f'{batch["text"]}\n\n'
                f'---\n'
                f'INSTRUCOES DE DOCUMENTACAO:\n'
                f'1. Analise TODAS as regras acima -- cada regra deve aparecer na wiki\n'
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
            f"Fase 4/4: Concluida -- {total_pages} wiki pages em {total_batches} lotes"
        )
        return {
            "phase": "generate_wiki",
            "pages_created": total_pages,
            "title_generated": title_generated,
            "description_generated": desc_generated,
            "rules_used": rule_count,
            "batches": total_batches,
        }

    def _save_wiki_and_metadata(self, raw: str, project_id: UUID, project: Project) -> Dict:
        """Parse, VALIDATE and save wiki pages, title, description.
        Rejects any page that violates the contract."""
        from app.services.wiki_service import _upsert_wiki_page

        result = {"pages_created": 0, "title_generated": False, "description_generated": False}

        parsed = self._extract_json(raw)
        if not parsed:
            logger.warning("Phase 4: no valid JSON found in response")
            return result

        # ---- PROJECT TITLE -- strict validation + REGRA #0 ----
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

        # ---- PROJECT DESCRIPTION -- strict validation + REGRA #0 ----
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

        # ---- WIKI PAGES -- strict validation ----
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
            if not SLUG_RE.match(slug):
                # Try to auto-fix: replace spaces/underscores with hyphens
                slug = re.sub(r'[^a-z0-9]+', '-', slug).strip('-')
                if not SLUG_RE.match(slug) or len(slug) < 3:
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
