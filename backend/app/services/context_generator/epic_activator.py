"""
Epic activation and content generation mixin.

Handles activation of suggested epics with full semantic content generation,
rejection of suggested items, and the detailed epic content AI pipeline.
Extracted from card_activator.py during modularization.
"""

from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4
from datetime import datetime
from sqlalchemy.orm import Session
import json
import logging
import re

from app.models.project import Project
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.services.rag_service import RAGService
from app.prompts.loader import get_prompt_loader  # PROMPT #234 YP-1
from .utils import (
    _robust_json_parse,
    _strip_emojis,
    _convert_semantic_to_human,
    _extract_content_from_raw_response,
    _strip_markdown_json,
)

logger = logging.getLogger(__name__)


class EpicActivatorMixin:
    """Mixin providing epic activation and rich content generation methods."""

    async def activate_suggested_epic(self, epic_id: UUID) -> Dict:
        """
        PROMPT #94 - Activate a suggested item by generating full content.

        Takes a suggested item (with labels=["suggested"] and workflow_state="draft")
        and generates full semantic content using the project context.

        Works with any item type (Epic, Story, Task).

        Flow:
        1. Validate item is a suggested item
        2. Fetch project context
        3. Generate full item content using AI (semantic markdown + human description)
        4. Update item with generated content
        5. Remove "suggested" label and change workflow_state to "open"
        6. Lock project context if this is the first activated item (for Epics)

        Args:
            epic_id: Item ID to activate (named epic_id for backwards compatibility)

        Returns:
            Dict with activated item data:
            {
                "id": str,
                "title": str,
                "description": str,
                "generated_prompt": str,
                "semantic_map": Dict,
                "acceptance_criteria": List[str],
                "story_points": int,
                "priority": str,
                "activated": True
            }

        Raises:
            ValueError: If item not found, not suggested, or project has no context
        """
        # 1. Fetch item
        epic = self.db.query(Task).filter(Task.id == epic_id).first()
        if not epic:
            raise ValueError(f"Item {epic_id} não encontrado")

        # Check if it's a suggested item
        is_suggested = (
            epic.labels and "suggested" in epic.labels
        ) or epic.workflow_state == "draft"

        if not is_suggested:
            raise ValueError(
                f"Item {epic_id} não é um item sugerido. "
                "Pode ja ter sido ativado."
            )

        # 2. Fetch project and context
        # PROMPT #234 SM-2: Use FOR UPDATE to prevent race condition on context_locked
        project = self.db.query(Project).with_for_update().filter(Project.id == epic.project_id).first()
        if not project:
            raise ValueError(f"Projeto {epic.project_id} não encontrado")

        # Allow activation even without context_semantic — AI will use
        # title, description, interview data, and RAG as available context.
        if not project.context_semantic:
            logger.warning(
                f"Projeto {project.id} sem context_semantic — "
                "ativacao prossegue com contexto disponivel (titulo, descricao, RAG)."
            )

        # 3. Generate full epic content using AI
        epic_content = await self._generate_full_epic_content(
            project=project,
            epic_title=epic.title,
            epic_description=epic.description
        )

        # 3.5. Validate and restructure AI response
        epic_content = self._validate_and_restructure_content(
            epic_content, epic.title, epic.description, project
        )

        # 4. Update epic with generated content
        # PROMPT #232 - REGRA #0: Human data is sacred - never overwrite human edits
        if epic.description_edited_by != 'human':
            epic.description = epic_content["description"]
            epic.description_edited_by = 'ai'
        else:
            logger.info(f"🛡️ Preserving human-edited description for epic '{epic.title}'")

        if epic.prompt_edited_by != 'human':
            epic.generated_prompt = epic_content["generated_prompt"]
            epic.prompt_edited_by = 'ai'
        else:
            logger.info(f"🛡️ Preserving human-edited prompt for epic '{epic.title}'")

        epic.acceptance_criteria = epic_content.get("acceptance_criteria", [])
        epic.story_points = epic_content.get("story_points")
        # PROMPT #127 - Track which AI model generated the content
        epic.created_by_ai_model = epic_content.get("ai_model_used")

        # PROMPT #95 - Store complete interview_insights for traceability
        # Includes semantic_map, key_requirements, business_goals, technical_constraints
        epic.interview_insights = epic.interview_insights or {}
        epic.interview_insights["semantic_map"] = epic_content.get("semantic_map", {})
        epic.interview_insights["activated_from_suggestion"] = True
        epic.interview_insights["activation_timestamp"] = datetime.utcnow().isoformat()

        # Merge additional interview_insights from AI response
        ai_insights = epic_content.get("interview_insights", {})
        if ai_insights:
            epic.interview_insights["key_requirements"] = ai_insights.get("key_requirements", [])
            epic.interview_insights["business_goals"] = ai_insights.get("business_goals", [])
            epic.interview_insights["technical_constraints"] = ai_insights.get("technical_constraints", [])

        # 5. Remove "suggested" label and change workflow_state
        if epic.labels and "suggested" in epic.labels:
            epic.labels = [l for l in epic.labels if l != "suggested"]
        epic.workflow_state = "open"
        epic.updated_at = datetime.utcnow()

        # 6. Lock project context (first item activated = context locked)
        # PROMPT #232 - IC-2 fix: lock context on ANY card activation, not just Epic
        if not project.context_locked:
            project.context_locked = True
            project.context_locked_at = datetime.utcnow()
            logger.info(f"🔒 Context locked for project {project.name} (first item activated)")

            # PROMPT #162 - Index project context in RAG for cross-project learning
            try:
                rag_service = RAGService(self.db)
                rag_service.store_project_context(
                    project_id=project.id,
                    context_semantic=project.context_semantic,
                    context_human=project.context_human or ""
                )
                logger.info(f"📚 Project context indexed in RAG: {project.name}")
            except Exception as e:
                logger.error(f"❌ Error indexing context in RAG: {str(e)}")

        # PROMPT #126 - Update project status to "active" when first epic is approved
        if epic.item_type == ItemType.EPIC and hasattr(project, 'status'):
            from app.models.project import ProjectStatus
            if project.status != ProjectStatus.active:
                project.status = ProjectStatus.active
                logger.info(f"✅ Project status changed to 'active': {project.name}")

        self.db.commit()
        self.db.refresh(epic)

        # PROMPT #95 - Enhanced logging
        logger.info(f"✅ Item activated: {epic.title} ({epic.item_type.value if epic.item_type else 'unknown'})")
        logger.info(f"   - Description: {len(epic.description or '')} chars")
        logger.info(f"   - Description preview: {(epic.description or '')[:300]}...")
        logger.info(f"   - Generated Prompt: {len(epic.generated_prompt or '')} chars")
        logger.info(f"   - Generated Prompt preview: {(epic.generated_prompt or '')[:300]}...")
        logger.info(f"   - Acceptance Criteria: {len(epic.acceptance_criteria or [])} items")
        logger.info(f"   - Story Points: {epic.story_points}")
        logger.info(f"   - Labels: {epic.labels}")
        logger.info(f"   - Workflow State: {epic.workflow_state}")
        logger.info(f"   - Interview Insights keys: {list(epic.interview_insights.keys()) if epic.interview_insights else []}")
        if epic.interview_insights:
            logger.info(f"   - Key Requirements: {len(epic.interview_insights.get('key_requirements', []))} items")
            logger.info(f"   - Business Goals: {len(epic.interview_insights.get('business_goals', []))} items")
            logger.info(f"   - Technical Constraints: {len(epic.interview_insights.get('technical_constraints', []))} items")

        # PROMPT #264 - Re-enable auto-generation of draft children after activation
        # (Previously disabled by PROMPT #127)
        children_count = 0
        try:
            if epic.item_type == ItemType.EPIC:
                children = await self._generate_draft_stories(epic, project, count=10)
                children_count = len(children)
            elif epic.item_type == ItemType.STORY:
                children = await self._generate_draft_tasks(epic, project, count=8)
                children_count = len(children)
            logger.info(f"✅ Auto-generated {children_count} draft children for {epic.title}")
        except Exception as e:
            logger.warning(f"⚠️ Auto-generation of children failed (non-blocking): {e}")

        # PROMPT #162 - Index activated card in RAG for semantic search
        try:
            rag_service = RAGService(self.db)
            rag_service.store_card(
                card_id=epic.id,
                title=epic.title,
                description=epic.description,
                generated_prompt=epic.generated_prompt,
                item_type=epic.item_type.value if epic.item_type else "epic",
                parent_id=epic.parent_id,
                labels=epic.labels,
                workflow_state=epic.workflow_state,
                project_id=epic.project_id
            )
            logger.info(f"📇 Epic indexed in RAG: {epic.title}")
        except Exception as e:
            logger.error(f"❌ Error indexing epic in RAG: {str(e)}")
            # Don't fail activation if RAG indexing fails

        return {
            "id": str(epic.id),
            "title": epic.title,
            "description": epic.description,
            "generated_prompt": epic.generated_prompt,
            "semantic_map": epic_content.get("semantic_map", {}),
            "acceptance_criteria": epic.acceptance_criteria,
            "story_points": epic.story_points,
            "priority": epic.priority.value if epic.priority else "medium",
            "activated": True,
            "children_generated": children_count
        }

    async def reject_suggested_epic(self, epic_id: UUID) -> bool:
        """
        PROMPT #94 - Reject (delete) a suggested item.

        Works with any item type (Epic, Story, Task).

        Args:
            epic_id: Item ID to reject (named epic_id for backwards compatibility)

        Returns:
            True if deleted successfully

        Raises:
            ValueError: If item not found or not a suggested item
        """
        # Fetch item
        epic = self.db.query(Task).filter(Task.id == epic_id).first()
        if not epic:
            raise ValueError(f"Item {epic_id} não encontrado")

        # Check if it's a suggested item
        is_suggested = (
            epic.labels and "suggested" in epic.labels
        ) or epic.workflow_state == "draft"

        if not is_suggested:
            raise ValueError(
                f"Item {epic_id} não é um item sugerido. "
                "Apenas itens sugeridos podem ser rejeitados."
            )

        item_title = epic.title

        # Delete the item
        self.db.delete(epic)
        self.db.commit()

        logger.info(f"❌ Suggested item rejected and deleted: {item_title}")

        return True

    async def _generate_full_epic_content(
        self,
        project: Project,
        epic_title: str,
        epic_description: str
    ) -> Dict:
        """
        Generate full epic content using AI and project context.

        Uses PROMPT #83 Semantic References Methodology to generate:
        - Semantic markdown (generated_prompt) for AI consumption
        - Human description for reading
        - Acceptance criteria
        - Story points estimation
        - Interview insights (key requirements, business goals, technical constraints)

        PROMPT #95 - Enhanced to match the rich structure from Epic Interview flow.

        Args:
            project: Project instance with context
            epic_title: Epic title (from suggested epic)
            epic_description: Epic minimal description (from suggested epic)

        Returns:
            Dict with full epic content
        """
        # PROMPT #234 YP-1 - Load system_prompt from YAML (was hardcoded)
        _loader = get_prompt_loader()
        _epic_template = _loader.load("context/activate_epic_full")
        system_prompt = _epic_template.system_prompt

        # PROMPT #162 - Fetch relevant interview answers from RAG
        interview_context = ""
        try:
            rag_service = RAGService(self.db)
            relevant_answers = rag_service.get_relevant_interview_answers(
                query=f"{epic_title} {epic_description or ''}",
                project_id=project.id,
                top_k=5,
                similarity_threshold=0.5
            )
            if relevant_answers:
                interview_context = "\n\n## RESPOSTAS RELEVANTES DA ENTREVISTA\n"
                interview_context += "*(O usuário mencionou isto durante a entrevista de contexto)*\n\n"
                for i, answer in enumerate(relevant_answers, 1):
                    content = answer.get("content", "")[:500]
                    interview_context += f"- {content}\n"
                logger.info(f"📝 Added {len(relevant_answers)} relevant interview answers to epic context")
        except Exception as e:
            logger.warning(f"Could not fetch interview answers: {e}")

        # PROMPT #252 - Fetch RELEVANT business rules using semantic search
        business_rules_context = ""
        try:
            rag_service = RAGService(self.db)
            search_query = f"{epic_title} {(epic_description or '')[:500]}"
            rules = rag_service.get_business_rules(
                project_id=project.id,
                query=search_query,
                top_k=50,
                similarity_threshold=0.3
            )
            if rules:
                business_rules_context = rag_service.format_business_rules_for_prompt(rules, max_chars=10000)
                logger.info(f"Injected {len(rules)} relevant business rules for epic: {epic_title[:40]}")
        except Exception as e:
            logger.warning(f"Could not fetch business rules for epic: {e}")

        user_prompt = f"""Gere a ESPECIFICAÇÃO TÉCNICA COMPLETA para este Epic/Módulo.

## CONTEXTO DO PROJETO
**Nome:** {project.name}
**Descrição:** {project.description or 'Não especificada'}

**Contexto Semântico do Projeto (REUTILIZE estes identificadores):**
{project.context_semantic or 'Não disponível'}{interview_context}

**Contexto Legível do Projeto:**
{project.context_human or 'Não disponível'}

{business_rules_context}
{f'''ATENÇÃO CRÍTICA: As regras de negócio acima foram extraídas DIRETAMENTE do código-fonte do projeto.
Você DEVE:
1. INCORPORAR estas regras no Mapa Semântico (como RN1, RN2, VAL1, etc.) com seus conteúdos REAIS
2. USAR as regras nos Critérios de Aceitação — cada regra relevante deve ter um AC correspondente
3. DETALHAR as regras na seção "Regras de Negócio Detalhadas" com condições, ações e exceções REAIS
4. RESPEITAR a hierarquia e estrutura das regras do código existente
NÃO invente regras genéricas — USE as regras REAIS listadas acima.''' if business_rules_context else ''}

## EPIC/MÓDULO A ESPECIFICAR
**Título:** {epic_title}
**Descrição Inicial:** {epic_description}

## REQUISITOS DA ESPECIFICAÇÃO

Você DEVE incluir detalhes sobre:

### 1. MODELO DE DADOS (obrigatório)
- Liste TODOS os campos/atributos necessários
- Especifique o TIPO DE DADO de cada campo (string, integer, boolean, date, decimal, text, json, etc)
- Indique se é obrigatório ou opcional
- Descreva validações específicas de cada campo

### 2. REGRAS DE NEGÓCIO (obrigatório)
- {f'INCORPORE as regras de negócio do projeto listadas acima' if business_rules_context else 'Liste TODAS as regras de negócio do módulo'}
- Especifique CONDIÇÕES de cada regra (quando se aplica)
- Especifique AÇÕES de cada regra (o que acontece)
- Especifique EXCEÇÕES (casos especiais)

### 3. ESTADOS E FLUXOS (obrigatório)
- Liste TODOS os estados possíveis
- Especifique TODAS as transições entre estados
- Indique as CONDIÇÕES para cada transição

### 4. INTERFACE DO USUÁRIO (obrigatório)
- Liste TODAS as telas necessárias
- Descreva os componentes principais de cada tela
- Indique os botões e ações disponíveis
- Descreva filtros e ordenações

### 5. ENDPOINTS DA API (obrigatório)
- Liste TODOS os endpoints REST necessários
- Especifique método HTTP e rota
- Descreva parâmetros de entrada e saída

### 6. INTEGRAÇÕES (se aplicável)
- Serviços externos necessários
- Eventos do sistema

## FORMATO DE SAÍDA

Use a estrutura EXATA especificada no system prompt:
- Mapa semântico com MÍNIMO 25 identificadores
- Seções: Entidades, Atributos, Enumerações, Regras, Validações, Estados, Telas, Endpoints
- Tabela de especificação de dados
- Fluxo principal detalhado

## EXEMPLO DE NÍVEL DE DETALHE ESPERADO

Para um módulo de "Cadastro de Imóveis", esperamos ver:
- ATTR1: título: string(100) - Título do anúncio, obrigatório
- ATTR2: descrição: text - Descrição detalhada, obrigatório, mínimo 50 caracteres
- ATTR3: preço: decimal(10,2) - Valor do imóvel em reais
- ATTR4: tipo: enum[casa,apartamento,terreno,comercial] - Tipo do imóvel
- ATTR5: quartos: integer - Número de quartos, 0-10
- ATTR6: banheiros: integer - Número de banheiros, 0-10
- ATTR7: area_m2: decimal(8,2) - Área em metros quadrados
- ATTR8: endereco_cep: string(8) - CEP, validação de formato
- RN1: Preço deve ser maior que zero
- RN2: Área deve ser maior que zero
- EST1: rascunho, EST2: pendente_aprovacao, EST3: publicado, EST4: vendido
- TELA1: Lista de Imóveis com filtros por tipo, preço, localização
- TELA2: Formulário de Cadastro com wizard de 3 etapas
- API1: GET /imoveis - listar com paginação e filtros
- API2: POST /imoveis - criar novo imóvel
- API3: PUT /imoveis/:id - atualizar imóvel

GERE ESTE NÍVEL DE DETALHE PARA O MÓDULO "{epic_title}".

Retorne como JSON seguindo o schema do system prompt."""

        # Call AI - PROMPT #96: Increased max_tokens to 8000 for detailed specs
        messages = [{"role": "user", "content": user_prompt}]

        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=16384,
            enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
            project_id=str(project.id)  # PROMPT #125 - Log to prompts table
        )

        # PROMPT #127 - Capture AI model used for tracking
        ai_model_used = response.get("model", "unknown")

        # Parse response - PROMPT #95: Enhanced JSON extraction
        response_text = response.get("content", "")
        original_response = response_text  # Keep original for debugging
        logger.info(f"📥 Raw AI response length: {len(response_text)} chars")

        # Step 0: Try parsing raw response before any transformation
        result = None
        parse_method = "none"
        last_error = None

        try:
            result = json.loads(response_text)
            parse_method = "raw_direct"
            logger.info("✅ JSON parsed from raw response directly")
        except json.JSONDecodeError as e:
            last_error = e
            logger.warning(f"Raw parse failed at position {e.pos}: {e.msg}")

        # Step 1: Strip markdown code blocks
        if result is None:
            response_text = _strip_markdown_json(response_text)

        # Step 2: Try multiple JSON extraction strategies

        # Strategy 1: Direct JSON parse after strip
        if result is None:
            try:
                result = json.loads(response_text)
                parse_method = "direct"
                logger.info("✅ JSON parsed directly after strip")
            except json.JSONDecodeError as e:
                last_error = e
                logger.warning(f"Direct parse failed at position {e.pos}/{len(response_text)}: {e.msg}")
                # Show context around error position
                start = max(0, e.pos - 50)
                end = min(len(response_text), e.pos + 50)
                logger.warning(f"Context around error: ...{response_text[start:end]}...")

        # Strategy 2: Extract JSON object with regex (greedy)
        if result is None:
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                try:
                    result = json.loads(json_match.group(0))
                    parse_method = "regex_greedy"
                    logger.info("✅ JSON extracted with greedy regex")
                except json.JSONDecodeError:
                    pass

        # Strategy 3: Find balanced braces (handles nested objects)
        if result is None:
            brace_start = response_text.find('{')
            if brace_start != -1:
                brace_count = 0
                brace_end = brace_start
                for i, char in enumerate(response_text[brace_start:], start=brace_start):
                    if char == '{':
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            brace_end = i + 1
                            break
                if brace_end > brace_start:
                    try:
                        result = json.loads(response_text[brace_start:brace_end])
                        parse_method = "balanced_braces"
                        logger.info("✅ JSON extracted with balanced braces")
                    except json.JSONDecodeError:
                        pass

        # Strategy 4: Try to fix common JSON issues
        if result is None:
            # Remove trailing commas before closing braces/brackets
            fixed_text = re.sub(r',\s*([}\]])', r'\1', response_text)
            # Try parsing fixed text
            json_match = re.search(r'\{[\s\S]*\}', fixed_text)
            if json_match:
                try:
                    result = json.loads(json_match.group(0))
                    parse_method = "fixed_trailing_commas"
                    logger.info("✅ JSON parsed after fixing trailing commas")
                except json.JSONDecodeError as e:
                    logger.debug(f"Trailing comma fix failed: {e}")

        # Strategy 5: Fix unescaped newlines in JSON strings
        if result is None:
            # This is a common issue where AI returns JSON with literal newlines in strings
            # instead of \n escape sequences
            try:
                json_match = re.search(r'\{[\s\S]*\}', response_text)
                if json_match:
                    json_str = json_match.group(0)

                    # Aggressive approach: escape all literal newlines that appear within strings
                    # by finding string boundaries and escaping newlines inside them
                    fixed_chars = []
                    in_string = False
                    escape_next = False

                    for char in json_str:
                        if escape_next:
                            fixed_chars.append(char)
                            escape_next = False
                            continue

                        if char == '\\':
                            fixed_chars.append(char)
                            escape_next = True
                            continue

                        if char == '"' and not escape_next:
                            in_string = not in_string
                            fixed_chars.append(char)
                            continue

                        if in_string and char == '\n':
                            fixed_chars.append('\\n')
                            continue

                        if in_string and char == '\r':
                            continue  # Skip carriage returns

                        if in_string and char == '\t':
                            fixed_chars.append('\\t')
                            continue

                        fixed_chars.append(char)

                    json_str_fixed = ''.join(fixed_chars)

                    try:
                        result = json.loads(json_str_fixed)
                        parse_method = "fixed_newlines_aggressive"
                        logger.info("✅ JSON parsed after aggressive newline fix")
                    except json.JSONDecodeError as e:
                        logger.warning(f"Aggressive newline fix failed at {e.pos}: {e.msg}")

            except Exception as e:
                logger.warning(f"Newline fix failed: {e}")

        # Strategy 6: Try to truncate at the last valid JSON point
        if result is None:
            try:
                json_match = re.search(r'\{[\s\S]*', response_text)
                if json_match:
                    json_str = json_match.group(0)

                    # Find the position of the error and try truncating before it
                    for truncate_at in range(len(json_str), max(len(json_str) - 500, 0), -10):
                        test_str = json_str[:truncate_at]
                        # Try to close any open structures
                        open_braces = test_str.count('{') - test_str.count('}')
                        open_brackets = test_str.count('[') - test_str.count(']')
                        open_quotes = test_str.count('"') % 2

                        if open_quotes == 1:
                            test_str += '"'
                        test_str += ']' * open_brackets
                        test_str += '}' * open_braces

                        try:
                            result = json.loads(test_str)
                            # Verify it has required fields
                            if isinstance(result, dict) and ('description_markdown' in result or 'semantic_map' in result):
                                parse_method = "truncated_recovery"
                                logger.info(f"✅ JSON recovered by truncating at position {truncate_at}")
                                break
                            else:
                                result = None
                        except (json.JSONDecodeError, ValueError):
                            continue
            except Exception as e:
                logger.warning(f"Truncation recovery failed: {e}")

        # Strategy 7: Last resort - try Python's ast.literal_eval for simple cases
        if result is None:
            try:
                import ast
                # This can handle some cases where json.loads fails
                result = ast.literal_eval(response_text)
                if isinstance(result, dict):
                    parse_method = "ast_literal_eval"
                    logger.info("✅ JSON parsed with ast.literal_eval")
                else:
                    result = None
            except (ValueError, SyntaxError):
                pass

        if result:
            logger.info(f"✅ AI response parsed successfully (method: {parse_method})")
            logger.info(f"   - title: {result.get('title', 'N/A')}")
            logger.info(f"   - semantic_map keys: {list(result.get('semantic_map', {}).keys())}")
            logger.info(f"   - description_markdown length: {len(result.get('description_markdown', ''))}")
            logger.info(f"   - acceptance_criteria count: {len(result.get('acceptance_criteria', []))}")
            logger.info(f"   - story_points: {result.get('story_points', 'N/A')}")
            logger.info(f"   - interview_insights keys: {list(result.get('interview_insights', {}).keys())}")

            # PROMPT #101 FIX (v2): Extract acceptance_criteria from multiple sources if empty
            # When JSON is truncated, acceptance_criteria field is lost
            if not result.get('acceptance_criteria'):
                extracted_criteria = []

                # Strategy 1: Extract from semantic_map (AC1, AC2, etc. keys)
                if result.get('semantic_map'):
                    semantic_map = result.get('semantic_map', {})
                    for key in sorted(semantic_map.keys()):
                        if key.startswith('AC') and len(key) > 2 and key[2:].replace('.', '').isdigit():
                            extracted_criteria.append(f"{key}: {semantic_map[key]}")
                    if extracted_criteria:
                        logger.info(f"   - Found {len(extracted_criteria)} AC keys in semantic_map")

                # Strategy 2: Extract from description_markdown
                if not extracted_criteria and result.get('description_markdown'):
                    desc = result.get('description_markdown', '')
                    # Look for "## Critérios de Aceitação" section
                    criteria_section = re.search(
                        r'##\s*(?:Critérios de Aceitação|Acceptance Criteria|Critérios)\s*\n((?:[\s\S](?!##))*)',
                        desc,
                        re.IGNORECASE
                    )
                    if criteria_section:
                        criteria_text = criteria_section.group(1)
                        # Extract lines that look like criteria (numbered, bulleted, or with AC prefix)
                        for line in criteria_text.split('\n'):
                            line = line.strip()
                            # Match patterns like: "1. **AC1**: ...", "- AC1: ...", "* [x] ...", etc.
                            if line and (
                                re.match(r'^\d+\.\s*\*?\*?AC\d+', line, re.IGNORECASE) or
                                re.match(r'^[-*]\s*\*?\*?AC\d+', line, re.IGNORECASE) or
                                re.match(r'^\d+\.\s*\[[ xX]?\]', line) or
                                re.match(r'^[-*]\s*\[[ xX]?\]', line)
                            ):
                                # Clean up the line
                                criterion = re.sub(r'^[\d\.\-\*\s\[\]xX]+', '', line).strip()
                                criterion = re.sub(r'^\*+', '', criterion).strip()
                                if criterion and len(criterion) > 5:
                                    extracted_criteria.append(criterion)
                        if extracted_criteria:
                            logger.info(f"   - Found {len(extracted_criteria)} criteria in description_markdown")

                # Apply extracted criteria
                if extracted_criteria:
                    result['acceptance_criteria'] = extracted_criteria[:15]  # Limit to 15 criteria
                    logger.info(f"   - acceptance_criteria RECOVERED: {len(result['acceptance_criteria'])} items")
        else:
            # All parsing strategies failed
            logger.error(f"❌ Failed to parse AI response as JSON after all strategies")
            logger.error(f"Response text (first 1500 chars): {response_text[:1500]}...")

            # Fallback: PROMPT #96 - Try to extract content from raw response
            logger.warning("🔄 JSON parsing failed - attempting to extract content from raw response...")

            # Try to extract useful content from the response even if JSON parsing failed
            # The AI might have returned text that contains useful information

            # Extract project context
            project_context = project.context_human or project.description or ""

            # PROMPT #96 - Better fallback: Make a simpler request to the AI
            # asking just for a text description without JSON
            logger.info("📤 Attempting simplified AI request for epic content...")

            # Extract key info from project context for better prompting
            context_preview = project_context[:3000] if project_context else "Não disponível"

            # PROMPT #234 YP-1 - Load from YAML
            _simple_loader = get_prompt_loader()
            _simple_sys, _ = _simple_loader.render("context/epic_specification_simple", {
                "context_preview": context_preview,
                "epic_title": epic_title,
                "project_name": project.name,
                "epic_description": epic_description or "",
            })
            simple_system_prompt = _simple_sys

            simple_prompt = f"""# Especificação Técnica: {epic_title}

**Projeto:** {project.name}

**Descrição do Módulo:** {epic_description}

Por favor, gere uma especificação técnica COMPLETA e DETALHADA para este módulo seguindo EXATAMENTE esta estrutura:

---

## 1. VISÃO GERAL
Escreva 2-3 parágrafos explicando:
- O propósito principal do módulo
- Como ele se integra com o restante do sistema
- O valor que ele entrega para o usuário

---

## 2. MODELO DE DADOS

### Entidade Principal: [Nome da Entidade]
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | uuid | Sim | Identificador único |
| ... | ... | ... | ... |

Liste MÍNIMO 10 campos com seus tipos de dados reais (string, text, integer, boolean, decimal, date, datetime, json, enum, etc.)

### Relacionamentos
- [Entidade] tem muitos [Outra Entidade]
- etc.

---

## 3. REGRAS DE NEGÓCIO

Liste MÍNIMO 8 regras de negócio específicas no formato:
- **RN1 - [Nome]**: [Descrição detalhada da regra, quando se aplica, o que acontece]
- **RN2 - [Nome]**: ...

---

## 4. ESTADOS E TRANSIÇÕES

### Estados Possíveis
| Estado | Descrição | Ações Permitidas |
|--------|-----------|------------------|
| ... | ... | ... |

### Fluxo de Transições
1. [Estado A] → [Estado B]: quando [condição]
2. ...

---

## 5. INTERFACE DO USUÁRIO

### Telas Principais
1. **[Nome da Tela]**
   - Propósito: ...
   - Componentes: ...
   - Ações disponíveis: ...

Liste MÍNIMO 4 telas com detalhes.

### Componentes Reutilizáveis
- [Componente 1]: [descrição]
- ...

---

## 6. API REST

### Endpoints
| Método | Rota | Descrição | Request Body | Response |
|--------|------|-----------|--------------|----------|
| GET | /api/... | ... | - | Lista de ... |
| POST | /api/... | ... | {{ campo1, campo2 }} | Objeto criado |
| ... | ... | ... | ... | ... |

Liste MÍNIMO 6 endpoints.

---

## 7. VALIDAÇÕES E ERROS

### Validações de Entrada
- [Campo]: [Validação] - Mensagem de erro
- ...

### Códigos de Erro
- 400: ...
- 404: ...
- ...

---

## 8. CRITÉRIOS DE ACEITAÇÃO

Liste MÍNIMO 8 critérios de aceitação específicos e mensuráveis:
1. [ ] ...
2. [ ] ...

---

## 9. CONSIDERAÇÕES TÉCNICAS

- Segurança: ...
- Performance: ...
- Escalabilidade: ...
- Integrações: ...

---

GERE A ESPECIFICAÇÃO COMPLETA AGORA, preenchendo TODOS os campos com dados REALISTAS baseados no contexto do projeto "{project.name}"."""

            try:
                simple_messages = [{"role": "user", "content": simple_prompt}]
                simple_response = await self.orchestrator.execute(
                    usage_type="prompt_generation",
                    messages=simple_messages,
                    system_prompt=simple_system_prompt,
                    max_tokens=8192,
                    enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
                    project_id=str(project.id)  # PROMPT #125 - Log to prompts table
                )

                raw_content = simple_response.get("content", "")
                logger.info(f"✅ Simplified request returned {len(raw_content)} chars")

                if len(raw_content) > 500:
                    # Use the raw content as the description
                    fallback_description = f"# Epic: {epic_title}\n\n{raw_content}"

                    # Try to extract acceptance criteria from the response
                    extracted_criteria = []
                    criteria_match = re.search(
                        r'(?:CRITÉRIOS DE ACEITAÇÃO|ACCEPTANCE CRITERIA)[:\s]*\n((?:[\-\*\d\.\[\]]+[^\n]+\n?)+)',
                        raw_content,
                        re.IGNORECASE
                    )
                    if criteria_match:
                        criteria_text = criteria_match.group(1)
                        # Extract each criterion
                        for line in criteria_text.split('\n'):
                            line = line.strip()
                            if line and (line.startswith('-') or line.startswith('*') or
                                        line.startswith('[') or re.match(r'^\d+\.', line)):
                                # Clean up the criterion text
                                criterion = re.sub(r'^[\-\*\[\]\d\.\s]+', '', line).strip()
                                if criterion and len(criterion) > 10:
                                    extracted_criteria.append(criterion)

                    logger.info(f"   - Extracted {len(extracted_criteria)} acceptance criteria from response")

                    # Try to extract key requirements from "Regras de Negócio" section
                    extracted_requirements = []
                    rules_match = re.search(
                        r'(?:REGRAS DE NEGÓCIO|BUSINESS RULES)[:\s]*\n((?:[\-\*]+\s*\*\*RN\d+[^\n]+\n?)+)',
                        raw_content,
                        re.IGNORECASE
                    )
                    if rules_match:
                        rules_text = rules_match.group(1)
                        for line in rules_text.split('\n'):
                            if '**RN' in line or '- RN' in line:
                                rule = re.sub(r'^[\-\*\s]+\*\*RN\d+[^:]*:\*\*\s*', '', line).strip()
                                if rule and len(rule) > 10:
                                    extracted_requirements.append(rule[:200])

                    result = {
                        "title": epic_title,
                        "semantic_map": {},
                        "description_markdown": fallback_description,
                        "acceptance_criteria": extracted_criteria[:10] if extracted_criteria else [
                            f"Módulo {epic_title} completamente implementado",
                            "Todos os endpoints funcionando corretamente",
                            "Interface de usuário responsiva e intuitiva",
                            "Testes automatizados com cobertura adequada",
                            "Documentação atualizada"
                        ],
                        "story_points": 13,
                        "interview_insights": {
                            "key_requirements": extracted_requirements[:5] if extracted_requirements else [
                                f"Implementar {epic_title} conforme especificação",
                                "Seguir padrões de código do projeto"
                            ],
                            "business_goals": [
                                f"Entregar funcionalidade completa de {epic_title}",
                                "Melhorar experiência do usuário"
                            ],
                            "technical_constraints": [
                                "Compatível com arquitetura existente",
                                "Performance adequada"
                            ]
                        }
                    }
                    logger.info("✅ Using simplified AI response as fallback content")
                else:
                    raise ValueError("Resposta muito curta")

            except Exception as fallback_error:
                logger.error(f"❌ Simplified request also failed: {fallback_error}")

                # Last resort: use project context to build something meaningful
                fallback_description = f"""# Epic: {epic_title}

## Visão Geral

{epic_description}

## Contexto do Projeto

Este módulo faz parte do projeto **{project.name}**.

{project_context[:2000] if project_context else 'Contexto não disponível.'}

## Próximos Passos

Para completar a especificação deste módulo, é necessário definir:
- Modelo de dados com campos e tipos
- Regras de negócio específicas
- Estados e transições
- Telas e componentes de interface
- Endpoints da API

NOTA: Esta e uma especificação preliminar. A geração automática de conteúdo detalhado falhou.
Por favor, edite manualmente para adicionar os detalhes técnicos necessários.
"""

                result = {
                    "title": epic_title,
                    "semantic_map": {},
                    "description_markdown": fallback_description,
                    "acceptance_criteria": [
                        "Módulo deve estar completamente implementado",
                        "Testes devem cobrir os principais fluxos",
                        "Documentação deve estar atualizada"
                    ],
                    "story_points": 13,
                    "interview_insights": {
                        "key_requirements": [
                            f"Implementar {epic_title} conforme especificação",
                            "Seguir padrões de código do projeto",
                            "Garantir integração com módulos existentes"
                        ],
                        "business_goals": [
                            f"Entregar funcionalidade de {epic_title}",
                            "Melhorar experiência do usuário",
                            "Atender requisitos do negócio"
                        ],
                        "technical_constraints": [
                            f"{epic_title} deve ser compatível com a arquitetura existente",
                            "Deve seguir os padrões de dados do projeto",
                            "Deve ter performance adequada"
                        ]
                    }
                }

        # Extract and process content
        semantic_map = result.get("semantic_map", {})
        description_markdown = result.get("description_markdown", "")

        # generated_prompt = semantic markdown (for AI/child cards)
        generated_prompt = description_markdown

        # PROMPT #180 - Include acceptance criteria in generated_prompt
        acceptance_criteria = result.get("acceptance_criteria", [])
        if acceptance_criteria:
            generated_prompt += "\n\n## Critérios de Aceitação\n\n"
            for ac in acceptance_criteria:
                generated_prompt += f"- {ac}\n"

        # description = human-readable (converted from semantic)
        description = _convert_semantic_to_human(description_markdown, semantic_map)

        # Remove Mapa Semântico section from human description
        description = re.sub(
            r'##\s*Mapa\s*Sem[aâ]ntico\s*\n+(?:[-*]\s*\*\*[^*]+\*\*:[^\n]*\n*)*',
            '',
            description,
            flags=re.IGNORECASE | re.MULTILINE
        )
        description = description.strip()

        # PROMPT #95 - Include interview_insights in return
        # PROMPT #127 - Include AI model used for tracking
        return {
            "title": result.get("title", epic_title),
            "description": description,
            "generated_prompt": generated_prompt,
            "semantic_map": semantic_map,
            "acceptance_criteria": acceptance_criteria,
            "story_points": result.get("story_points"),
            "interview_insights": result.get("interview_insights", {}),
            "ai_model_used": ai_model_used  # PROMPT #127
        }
