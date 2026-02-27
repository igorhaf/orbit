# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você é um ANALISTA DE NEGÓCIOS experiente analisando código-fonte para extrair regras de negócio FUNCIONAIS.

Sua perspectiva é de NEGÓCIO, não de tecnologia. Imagine que você está escrevendo um documento
para o GERENTE DE PRODUTO ou DONO DO NEGÓCIO que não entende código.

EXTRAIA regras que respondam:
- O que o USUÁRIO pode ou não pode fazer?
- Quais são as PERMISSÕES e RESTRIÇÕES de acesso?
- Como funcionam os FLUXOS e PROCESSOS do sistema?
- Quais CÁLCULOS de negócio existem (preços, comissões, notas)?
- Quais LIMITES e QUOTAS o sistema impõe?
- Quais VALIDAÇÕES afetam a experiência do usuário?
- Como as ENTIDADES do negócio se relacionam?

IGNORE COMPLETAMENTE (não são regras de negócio):
- Tipos de campos (booleano, string, integer)
- Configurações de framework (drivers, sessões, guards, middleware)
- Detalhes de banco (foreign keys, NOT NULL, migrations)
- CSS, layout, estilização
- Logs, cache, filas, timeouts
- Imports, dependências, bibliotecas
- Configurações de ambiente (.env, configs)
- Código boilerplate ou padrões técnicos

FORMATO das regras (escreva como linguagem de negócio):
✅ BOM: "O aluno só pode avaliar um curso após completar pelo menos 50% das aulas"
✅ BOM: "O instrutor recebe 70% do valor de cada inscrição em seu curso"
✅ BOM: "Cupons de desconto expiram após a data limite definida pelo instrutor"
❌ RUIM: "O campo 'rating' deve ser um integer entre 1 e 5"
❌ RUIM: "A tabela enrollments tem foreign key para courses"
❌ RUIM: "O guard 'web' usa driver de sessão"

Responda APENAS em JSON válido, sem markdown, sem explicações adicionais.

## User Prompt

Arquivo: backend/app/services/context_generator/business_rules.py
Linguagem: python

```
"""
Business rules classification and card creation mixin.

Handles AI-based hierarchical classification of business rules
into Epic > Story > Task > Subtask structure and card creation.
PROMPT #240 - Rigid 4-level hierarchy matching generate_cards_from_rag.py.
Extracted from context_generator.py during modularization (PROMPT #249).
"""

from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4
from datetime import datetime
from sqlalchemy.orm import Session
import asyncio
import json
import logging
import math

from app.models.project import Project
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.services.rag_service import RAGService
from .utils import _robust_json_parse

logger = logging.getLogger(__name__)


# ============================================================
# PROMPT #249 - Per-card normalization helper
# ============================================================

def _normalize_card_inline(db, card_id, item_type, title, description="",
                           domain="", parent_title="", rules=None, insights=None):
    """Normalize a single card immediately after creation (non-critical)."""
    try:
        from scripts.normalize_cards import normalize_single_card
        normalize_single_card(
            db=db, card_id=card_id, item_type=item_type, title=title,
            description=description, domain=domain, parent_title=parent_title,
            rules=rules, interview_insights=insights or {},
        )
    except Exception as e:
        logger.debug(f"Per-card normalization skipped for {card_id}: {e}")


# ============================================================
# PROMPT #240 - Rigid card rendering functions (same as script)
# ============================================================

def _render_description(title: str, context: str, rules: list, level: str) -> str:
    """Render human-readable description from rules."""
    ac_text = "\n".join(f"- {r}" for r in rules[:8]) if rules else "- A definir"
    return f"""# {title}

## Contexto

{context}

## Regras de Negocio Aplicaveis

{ac_text}

## Nivel

{level}
"""


def _render_prompt(title: str, semantic_map: dict, rules: list, level: str) -> str:
    """Render semantic prompt with references."""
    sm_lines = "\n".join(f"- **{k}**: {v}" for k, v in semantic_map.items())
    rules_text = "\n".join(f"{i+1}. {r}" for i, r in enumerate(rules[:10]))
    return f"""# {level}: {title}

## Mapa Semantico

{sm_lines}

## Regras de Negocio

{rules_text}

## Instrucoes

Implementar {title} respeitando todas as regras de negocio listadas acima.
Cada criterio de aceitacao deve ser verificavel e testavel.
"""


def _make_acceptance_criteria(rules: list) -> list:
    """Convert rules to acceptance criteria format."""
    criteria = []
    for r in rules[:6]:
        text = r.strip() if isinstance(r, str) else str(r).strip()
        if len(text) > 20:
            criteria.append(text[:200])
    if not criteria:
        criteria.append("Funcionalidade implementada conforme especificacao")
    return criteria


class BusinessRulesMixin:
    """Mixin providing business rule classification and card creation methods."""

    async def generate_business_rule_cards(
        self,
        project_id: UUID
    ) -> List[Dict]:
        """
        PROMPT #120 - Generate cards for verified business rules.
        PROMPT #193 - Hierarchical structure.
        PROMPT #240 - Rigid 4-level hierarchy: Epic > Story > Task > Subtask.

        Uses AI to classify business rules into Epic > Story groups.
        Then code decomposes each Story into Tasks (groups of 3-4 rules)
        and Subtasks (1 per rule).

        All cards have: description, generated_prompt, acceptance_criteria,
        semantic_map, description_edited_by='ai', prompt_edited_by='ai'.

        Falls back to flat 4-level structure if AI classification fails.

        Args:
            project_id: Project ID

        Returns:
            List of created business rule card dictionaries
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            logger.error(f"Project {project_id} not found")
            return []

        # PROMPT #291 - Read business rules from RAG (comprehensive) instead of
        # initial_memory_context (which only has ~20 rules from initial scan).
        # RAG has ALL rules from continuous scans (typically 500-745+).
        from sqlalchemy import text as sql_text

        # PROMPT #241 - Build query with ignore_paths filter
        # PROMPT #242 - Include source_file for AI classification context
        ignore_paths = project.ignore_paths if project.ignore_paths and isinstance(project.ignore_paths, list) else []
        if ignore_paths:
            # Exclude rules whose source_file starts with any ignored path
            where_clauses = " ".join(
                f"AND NOT (metadata->>'source_file' LIKE :ip{i} || '%')"
                for i in range(len(ignore_paths))
            )
            query = f"""
                SELECT content, metadata->>'source_file' as source_file FROM rag_documents
                WHERE project_id = :pid
                AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')
                {where_clauses}
                ORDER BY created_at
            """
            params = {"pid": str(project_id)}
            for i, p in enumerate(ignore_paths):
                params[f"ip{i}"] = p
            rag_result = self.db.execute(sql_text(query), params)
            logger.info(f"📁 RAG query excludes {len(ignore_paths)} ignored paths: {ignore_paths}")
        else:
            rag_result = self.db.execute(sql_text("""
                SELECT content, metadata->>'source_file' as source_file FROM rag_documents
                WHERE project_id = :pid
                AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')
                ORDER BY created_at
            """), {"pid": str(project_id)})

        # PROMPT #242 - Format rules with source_file context for better AI classification
        rag_rules = []
        for row in rag_result:
            content = row[0]
            source = row[1] if len(row) > 1 and row[1] else None
            if source:
                rag_rules.append(f"[{source}] {content}")
            else:
                rag_rules.append(content)

        # Fallback to initial_memory_context if RAG has no rules
        if not rag_rules:
            if project.initial_memory_context:
                rag_rules = project.initial_memory_context.get("business_rules", [])
            if not rag_rules:
                logger.info(f"Project {project_id} has no business rules in RAG or memory context")
                return []

        business_rules = rag_rules

        # PROMPT #291 - Delete existing business_rule/from_rag cards before regenerating
        # This allows re-running with updated RAG data.
        existing_br_cards = self.db.query(Task).filter(
            Task.project_id == project_id,
            (Task.labels.contains(["business_rule"]) | Task.labels.contains(["from_rag"]))
        ).count()

        if existing_br_cards > 0:
            logger.info(
                f"Removing {existing_br_cards} existing business_rule/from_rag cards to regenerate from RAG ({len(business_rules)} rules)"
            )
            self.db.query(Task).filter(
                Task.project_id == project_id,
                (Task.labels.contains(["business_rule"]) | Task.labels.contains(["from_rag"]))
            ).delete(synchronize_session='fetch')
            self.db.flush()

        logger.info(f"Generating {len(business_rules)} business rule cards from RAG for project {project.name}")

        # PROMPT #193 - Try hierarchical classification via AI
        hierarchy = await self._classify_rules_hierarchy(project, business_rules)

        if hierarchy:
            # Create cards recursively from AI-classified hierarchy
            saved_cards = self._create_hierarchy_cards(project_id, hierarchy)
            self.db.commit()
            logger.info(f"Generated {len(saved_cards)} hierarchical business rule cards")
            return saved_cards

        # Fallback: flat structure (original PROMPT #120 behavior)
        logger.warning("Hierarchical classification failed, using flat structure")
        cards = self._create_flat_business_rule_cards(project_id, business_rules)
        return cards

    async def _classify_rules_hierarchy(
        self,
        project: Any,
        business_rules: List[str]
    ) -> Optional[List[Dict]]:
        """
        PROMPT #193 - Use AI to classify business rules into hierarchical structure.
        PROMPT #264 - Added retry logic (2 attempts) with timeout and detailed logging.
        PROMPT #245 - Chunked processing: splits large rule sets into batches of
                      ~100 rules each, classifies each batch, then merges by Epic title.
                      This prevents token overflow on large codebases (1000+ rules).

        Returns list of hierarchy nodes or None if classification fails.
        """
        import json
        import traceback

        CHUNK_SIZE = 100  # Rules per AI call

        # If small enough, classify in a single call
        if len(business_rules) <= CHUNK_SIZE:
            result = await self._classify_rules_chunk(project, business_rules)
            return result

        # Chunked processing for large rule sets
        logger.info(
            f"Large rule set ({len(business_rules)} rules), "
            f"splitting into chunks of {CHUNK_SIZE}"
        )

        all_hierarchies: List[List[Dict]] = []
        for i in range(0, len(business_rules), CHUNK_SIZE):
            chunk = business_rules[i:i + CHUNK_SIZE]
            chunk_num = (i // CHUNK_SIZE) + 1
            total_chunks = (len(business_rules) + CHUNK_SIZE - 1) // CHUNK_SIZE

            logger.info(f"Classifying chunk {chunk_num}/{total_chunks} ({len(chunk)} rules)")

            chunk_result = await self._classify_rules_chunk(project, chunk)
            if chunk_result:
                all_hierarchies.append(chunk_result)
            else:
                logger.warning(f"Chunk {chunk_num} classification failed, skipping")

        if not all_hierarchies:
            logger.warning("All chunks failed classification")
            return None

        # Merge hierarchies by Epic title (domain grouping)
        merged = self._merge_hierarchies(all_hierarchies)
        logger.info(f"Merged {len(all_hierarchies)} chunks into {len(merged)} domain groups")
        return merged

    def _merge_hierarchies(self, hierarchies: List[List[Dict]]) -> List[Dict]:
        """
        PROMPT #245 - Merge multiple hierarchy results by Epic title.
        Rules from different chunks that belong to the same domain
        are consolidated under the same Epic.
        """
        epic_map: Dict[str, Dict] = {}

        for hierarchy in hierarchies:
            for epic_node in hierarchy:
                title = epic_node.get("title", "").strip()
                # Normalize title for matching (lowercase, strip whitespace)
                key = title.lower()

                if key in epic_map:
                    # Merge children into existing epic
                    existing_children = epic_map[key].get("children", [])
                    new_children = epic_node.get("children", [])
                    existing_children.extend(new_children)
                    epic_map[key]["children"] = existing_children
                else:
                    epic_map[key] = {
                        "title": title,
                        "description": epic_node.get("description", ""),
                        "children": list(epic_node.get("children", []))
                    }

        return list(epic_map.values())

    async def _classify_rules_chunk(
        self,
        project: Any,
        business_rules: List[str]
    ) -> Optional[List[Dict]]:
        """
        PROMPT #245 - Classify a single chunk of business rules via AI.
        Extracted from original _classify_rules_hierarchy for reuse in chunking.
        """
        import json
        import traceback

        from app.contracts.loader import ContractLoader
        loader = ContractLoader()

        rules_text = "\n".join([f"{i}. {rule}" for i, rule in enumerate(business_rules, 1)])

        memory_ctx = project.initial_memory_context or {}
        key_features = memory_ctx.get("key_features", [])
        entities = memory_ctx.get("entities", [])

        features_text = "\n".join([f"- {f}" for f in key_features]) if key_features else ""
        entities_text = "\n".join([f"- {e}" for e in entities]) if entities else ""

        system_prompt, user_prompt = loader.render(
            "memory/business_rules_hierarchy",
            {
                "project_name": project.name,
                "rules_text": rules_text,
                "key_features": features_text,
                "entities": entities_text
            }
        )

        max_retries = 2
        for attempt in range(max_retries):
            try:
                response = await asyncio.wait_for(
                    self.orchestrator.execute(
                        usage_type="memory",
                        messages=[{"role": "user", "content": user_prompt}],
                        system_prompt=system_prompt,
                        max_tokens=6000,
                        project_id=str(project.id)
                    ),
                    timeout=180
                )

                content = response.get("content", "")

                json_start = content.find("{")
                json_end = content.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    parsed = json.loads(content[json_start:json_end])
                    hierarchy = parsed.get("hierarchy", [])
                    if hierarchy and isinstance(hierarchy, list):
                        logger.info(
                            f"AI classified {len(business_rules)} rules into "
                            f"{len(hierarchy)} domain groups (attempt {attempt + 1})"
                        )
                        return hierarchy

                logger.warning(f"AI response did not contain valid hierarchy (attempt {attempt + 1}/{max_retries})")

            except json.JSONDecodeError as e:
                logger.warning(f"JSON parse error in hierarchy classification (attempt {attempt + 1}/{max_retries}): {e}")
            except asyncio.TimeoutError:
                logger.warning(f"Hierarchy classification timed out after 180s (attempt {attempt + 1}/{max_retries})")
            except Exception as e:
                logger.error(f"Hierarchy classification failed (attempt {attempt + 1}/{max_retries}): {e}")
                logger.error(traceback.format_exc())

        logger.warning(f
```

Extraia as regras de negócio FUNCIONAIS deste arquivo.
Escreva cada regra como se explicasse para um GERENTE DE PRODUTO.
Responda em JSON com este formato exato:

{
  "business_rules": [
    {
      "rule_text": "Descrição funcional da regra em linguagem de negócio",
      "rule_type": "domain|validation|constraint|workflow|permission|calculation",
      "confidence": "high|medium|low",
      "source_context": "trecho relevante do código (max 100 chars)"
    }
  ],
  "entities_found": ["Entidade1", "Entidade2"],
  "file_purpose": "Breve descrição do propósito do arquivo (1 frase)",
  "file_layer": "schema|routes|logic|presentation|config"
}

Se não houver regras de negócio FUNCIONAIS, retorne: {"business_rules": [], "entities_found": [], "file_purpose": "..."}
Arquivos de configuração, estilização e infraestrutura geralmente NÃO contêm regras de negócio.

## Response

```json
{
  "business_rules": [
    {
      "rule_text": "Regras de negócio do projeto são obrigatoriamente organizadas em uma hierarquia rígida de 4 níveis: Epic > Story > Task > Subtask. Não é permitido criar cards fora dessa estrutura.",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "Rigid 4-level hierarchy: Epic > Story > Task > Subtask"
    },
    {
      "rule_text": "Ao regenerar os cards de regras de negócio, todos os cards existentes marcados como 'business_rule' ou 'from_rag' são excluídos automaticamente antes da nova geração, garantindo que o conteúdo reflita sempre os dados mais recentes do RAG.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "Delete existing business_rule/from_rag cards before regenerating"
    },
    {
      "rule_text": "Regras de negócio provenientes de arquivos ou pastas configuradas como 'ignoradas' pelo projeto são excluídas da geração de cards, permitindo que o dono do projeto delimite o escopo da análise.",
      "rule_type": "permission",
      "confidence": "high",
      "source_context": "Exclude rules whose source_file starts with any ignored path"
    },
    {
      "rule_text": "A fonte primária de regras de negócio é o banco RAG completo (que pode conter 500 a 745+ regras de varreduras contínuas). Somente se o RAG estiver vazio o sistema utiliza o contexto de memória inicial (limitado a ~20 regras).",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "RAG has ALL rules from continuous scans (typically 500-745+)"
    },
    {
      "rule_text": "Projetos sem nenhuma regra de negócio cadastrada (nem no RAG nem na memória inicial) não geram cards, encerrando o processo sem erro.",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "Project has no business rules in RAG or memory context → return []"
    },
    {
      "rule_text": "Quando o conjunto de regras de negócio supera 100 itens, o sistema processa em lotes de até 100 regras por vez para evitar sobrecarga. Os resultados de cada lote são posteriormente consolidados por domínio (título do Epic).",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "CHUNK_SIZE = 100 — splits large rule sets into batches of ~100 rules"
    },
    {
      "rule_text": "Regras de negócio de lotes diferentes que pertencem ao mesmo domínio (mesmo título de Epic) são automaticamente unificadas sob o mesmo Epic, evitando duplicação de agrupamentos temáticos.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "Merge hierarchies by Epic title (domain grouping)"
    },
    {
      "rule_text": "A classificação hierárquica por IA tem no máximo 2 tentativas com timeout de 180 segundos cada. Se ambas falharem, o sistema utiliza uma estrutura plana como alternativa, garantindo que os cards sejam sempre criados.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "max_retries = 2 / timeout=180 / fallback flat structure"
    },
    {
      "rule_text": "Cada card exibe no máximo 8 regras de negócio na sua descrição, 10 regras no prompt de implementação e 6 regras convertidas em critérios de aceitação.",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "rules[:8] in description / rules[:10] in prompt / rules[:6] in acceptance_criteria"
    },
    {
      "rule_text": "Apenas regras com mais de 20 caracteres são convertidas em critérios de aceitação. Regras muito curtas são descartadas. Se nenhuma regra válida existir, o critério padrão 'Funcionalidade implementada conforme especificação' é aplicado automaticamente.",
      "rule_type": "validation",
      "confidence": "high",
      "source_context": "if len(text) > 20: criteria.append(...) / default fallback criteria"
    },
    {
      "rule_text": "Todo card gerado por IA tem seus campos 'descrição' e 'prompt' marcados como editados pela IA (description_edited_by='ai', prompt_edited_by='ai'), sinalizando a origem automatizada do conteúdo.",
      "rule_type": "workflow",
      "confidence": "medium",
      "source_context": "description_edited_by='ai', prompt_edited_by='ai'"
    },
    {
      "rule_text": "O contexto de origem de cada regra (arquivo-fonte) é incluído na classificação enviada à IA, permitindo agrupamentos mais precisos por módulo ou funcionalidade do sistema analisado.",
      "rule_type": "domain",
      "confidence": "medium",
      "source_context": "rag_rules.append(f'[{source}] {content}') — source_file context for AI"
    }
  ],
  "entities_found": [
    "Projeto",
    "Card",
    "Epic",
    "Story",
    "Task",
    "Subtask",
    "Regra de Negócio",
    "Critério de Aceitação",
    "RAG Document",
    "Memória Inicial do Projeto"
  ],
  "file_purpose": "Serviço responsável por classificar regras de negócio extraídas do código-fonte em uma hierarquia de cards (Epic > Story > Task > Subtask) usando IA, com fallback para estrutura plana em caso de falha.",
  "file_layer": "logic"
}
```
