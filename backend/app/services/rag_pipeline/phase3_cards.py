"""
RAG Pipeline Phase 3: Generate CARDS from business rules.

Two-pass approach:
  Pass 1 (Epics): Compact summary of ALL rules -> generate Epics only
  Pass 2 (Details): One batch per entity group -> Stories/Tasks
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, TYPE_CHECKING
from uuid import UUID

from sqlalchemy import text as sql_text

from app.models.project import Project
from app.services.job_manager import JobManager

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class Phase3Mixin:
    """Mixin providing phase_3_generate_cards and related helpers."""

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
        "CONTRATO JSON -- Responda APENAS com JSON puro. Sem markdown, sem ```json.\n\n"
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
        "[O que este modulo faz no sistema -- descricao funcional rica]\n\n"
        "## Regras de Negocio Principais\n"
        "- [Regra concreta extraida do codigo com evidencia]\n"
        "- [Regra concreta extraida do codigo com evidencia]\n"
        "- [Mais regras...]\n\n"
        "## Entidades e Relacionamentos\n"
        "- [Entidade A] -> [como se relaciona com Entidade B]\n\n"
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

    # =====================================================================
    # PHASE 3 VALIDATORS -- strict contract enforcement for cards
    # =====================================================================

    VALID_ITEM_TYPES = frozenset({"epic", "story", "task"})
    VALID_PRIORITIES = frozenset({"critical", "high", "medium", "low"})
    VALID_FIBONACCI = frozenset({1, 2, 3, 5, 8, 13})
    TYPE_ORDER = {"epic": 0, "story": 1, "task": 2}
    EXPECTED_PARENT_TYPE = {"story": "epic", "task": "story"}

    async def phase_3_generate_cards(self, project_id: UUID, job_id: UUID,
                                      pmin: float = 0.0, pmax: float = 100.0) -> Dict[str, Any]:
        """
        Phase 3: Generate CARDS via MULTI-BATCH processing.

        Pass 1 (0-20% local): Compact summary -> Epics only
        Pass 2 (20-95% local): One batch per entity group -> Stories/Tasks
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
                f"({entities_label}) -- {total_cards} cards"
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
                f'STORIES devem ser conceituais -- expandem aspectos funcionais do Epic.\n'
                f'A description de cada Story DEVE ser em Markdown (min 300 chars) com:\n'
                f'## Contexto\n## Funcionalidade\n## Regras Envolvidas\n## Cenarios de Uso\n\n'
                f'TASKS devem ser tecnicas -- referenciam arquivos, logica, validacoes concretas.\n\n'
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
            f"Fase 3/4: Concluida -- {total_cards} cards em {num_detail_batches + 1} lotes"
        )
        return {
            "phase": "generate_cards",
            "cards_created": total_cards,
            "rules_in_rag": rule_count,
            "epic_count": len(epic_titles),
            "detail_batches": num_detail_batches,
        }

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
                workflow_state="closed",
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
