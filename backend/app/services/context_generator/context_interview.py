"""
Context Interview mixin for ContextGeneratorService.

Handles context generation from interviews, context locking,
and rich context generation from memory.
Extracted from context_generator.py during modularization (PROMPT #249).
"""

from typing import Dict, List, Optional, Any
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
import asyncio
import json
import logging
import re

from app.models.project import Project
from app.models.interview import Interview, InterviewStatus
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.services.rag_service import RAGService
from .utils import (
    _robust_json_parse,
    _strip_emojis,
    _dict_to_markdown_context,
    _convert_semantic_to_human,
)

logger = logging.getLogger(__name__)


class ContextInterviewMixin:
    """Mixin providing context interview and context management methods."""

    async def generate_context_from_interview(
        self,
        interview_id: UUID,
        project_id: UUID
    ) -> Dict:
        """
        Generate project context from Context Interview conversation.

        PROMPT #89 - Context Interview Processing

        Flow:
        1. Validate interview (must be context mode, have enough messages)
        2. AI analyzes conversation and generates structured context
        3. Extract semantic map and create human-readable version
        4. Save to Project model
        5. Mark interview as completed

        Args:
            interview_id: Context Interview ID
            project_id: Project ID

        Returns:
            {
                "context_semantic": str,
                "context_human": str,
                "semantic_map": Dict[str, str],
                "interview_insights": {
                    "project_vision": str,
                    "problem_statement": str,
                    "key_features": [str, ...],
                    "target_users": [str, ...],
                    "success_criteria": [str, ...]
                }
            }

        Raises:
            ValueError: If interview not found, wrong mode, or insufficient data
        """
        # 1. Validate interview
        interview = self.db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            raise ValueError(f"Entrevista {interview_id} não encontrada")

        # Accept both "context" and "meta_prompt" modes for compatibility
        if interview.interview_mode not in ["context", "meta_prompt"]:
            raise ValueError(
                f"Entrevista {interview_id} não é uma entrevista de contexto "
                f"(modo: {interview.interview_mode}). Apenas modo 'context' suportado."
            )

        # PROMPT #122 - Allow generating context from memory scan even without conversation
        # If project has initial_memory_context from codebase scan, we can generate context
        # with minimal conversation (just the AI greeting is enough)
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Projeto {project_id} não encontrado")

        has_memory_context = bool(project.initial_memory_context)
        message_count = len(interview.conversation_data or [])

        if has_memory_context:
            # With memory context, we only need 1 message (AI greeting) minimum
            if message_count < 1:
                raise ValueError(
                    f"Interview {interview_id} has no messages. "
                    "At least the initial AI message is required."
                )
            logger.info(f"📝 Generating context from memory scan + {message_count} messages")
        else:
            # Without memory context, require 6 messages (3 Q&A pairs)
            if message_count < 6:
                raise ValueError(
                    f"Interview {interview_id} has insufficient data. "
                    f"Need at least 6 messages (3 Q&A pairs), got {message_count}."
                )

        # Check if context is already locked
        if project.context_locked:
            raise ValueError(
                f"Project {project_id} context is already locked. "
                "Cannot regenerate context after first epic is created."
            )

        # 3. Build conversation summary for AI
        # PROMPT #122 - When conversation is minimal, use memory context as the main source
        if has_memory_context and message_count <= 2:
            # Use memory context as the primary source
            conversation_summary = self._build_memory_context_summary(project.initial_memory_context)
            logger.info("📋 Using memory context as primary source (minimal conversation)")
        else:
            # Use conversation as the primary source
            conversation_summary = self._build_conversation_summary(interview.conversation_data)

        # 4. Generate context using AI
        context_result = await self._generate_context_with_ai(
            project=project,
            conversation_summary=conversation_summary
        )

        # 4.5. PROMPT #175 - Validate context content before saving
        context_result = self._validate_context_content(context_result, project.name)

        # PROMPT #233 - PD-1 fix: Save context to project (was missing - context was generated but never persisted)
        project.context_semantic = context_result["context_semantic"]
        project.context_human = context_result["context_human"]

        # PROMPT #247 - All project fields are manual, no auto-generation

        # 6. Mark interview as completed
        interview.status = InterviewStatus.COMPLETED

        self.db.commit()

        logger.info(f"✅ Context generated for project {project.name}")
        logger.info(f"   - Semantic: {len(context_result['context_semantic'])} chars")
        logger.info(f"   - Human: {len(context_result['context_human'])} chars")

        # 7. PROMPT #92 - Generate suggested epics from context
        try:
            suggested_epics = await self.generate_suggested_epics(
                project_id=project_id,
                context_human=context_result["context_human"],
                interview_insights=context_result.get("interview_insights", {})
            )
            context_result["suggested_epics"] = suggested_epics
            logger.info(f"   - Suggested Epics: {len(suggested_epics)}")
        except Exception as e:
            logger.error(f"Failed to generate suggested epics: {e}")
            context_result["suggested_epics"] = []

        # 8. PROMPT #120 - Generate closed cards for verified business rules
        try:
            business_rule_cards = await self.generate_business_rule_cards(
                project_id=project_id
            )
            context_result["business_rule_cards"] = business_rule_cards
            logger.info(f"   - Business Rule Cards: {len(business_rule_cards)}")
        except Exception as e:
            logger.error(f"Failed to generate business rule cards: {e}")
            context_result["business_rule_cards"] = []

        return context_result

    def _build_conversation_summary(self, conversation_data: List[Dict]) -> str:
        """
        Build a structured summary of the conversation for AI processing.

        Args:
            conversation_data: List of conversation messages

        Returns:
            Formatted conversation summary
        """
        summary_parts = []

        for i, msg in enumerate(conversation_data):
            role = msg.get("role", "unknown")
            content = msg.get("content", "")

            if role == "assistant":
                # AI question
                summary_parts.append(f"**Pergunta:** {content}")
            elif role == "user":
                # User answer
                summary_parts.append(f"**Resposta:** {content}")
                summary_parts.append("")  # Empty line between Q&A pairs

        return "\n".join(summary_parts)

    def _build_memory_context_summary(self, memory_context: Dict) -> str:
        """
        PROMPT #122 - Build a structured summary from memory scan context.

        When user skips the interview (clicks "Gerar Contexto" immediately),
        we use the codebase scan results as the primary context source.

        Args:
            memory_context: Dict with stack_info, key_features, business_rules, etc.

        Returns:
            Formatted context summary for AI processing
        """
        summary_parts = []

        # Stack info
        stack_info = memory_context.get("stack_info", {})
        if stack_info.get("detected_stack"):
            summary_parts.append(f"**Stack Tecnológica:** {stack_info['detected_stack']}")
            if stack_info.get("description"):
                summary_parts.append(f"   {stack_info['description']}")
            summary_parts.append("")

        # Scan summary
        scan_summary = memory_context.get("scan_summary", {})
        if scan_summary:
            langs = scan_summary.get("languages", {})
            if langs:
                lang_str = ", ".join([f"{k}: {v}" for k, v in langs.items()])
                summary_parts.append(f"**Linguagens Detectadas:** {lang_str}")
            summary_parts.append(f"**Arquivos Analisados:** {scan_summary.get('code_files', 0)} arquivos de código")
            summary_parts.append("")

        # Key features
        key_features = memory_context.get("key_features", [])
        if key_features:
            summary_parts.append("**Funcionalidades Principais Detectadas:**")
            for feature in key_features:
                summary_parts.append(f"- {feature}")
            summary_parts.append("")

        # Business rules
        business_rules = memory_context.get("business_rules", [])
        if business_rules:
            summary_parts.append("**Regras de Negócio Extraídas do Código:**")
            for i, rule in enumerate(business_rules, 1):
                summary_parts.append(f"{i}. {rule}")
            summary_parts.append("")

        # Interview context (the AI-generated summary from memory scan)
        interview_context = memory_context.get("interview_context", "")
        if interview_context:
            summary_parts.append("**Análise do Codebase:**")
            summary_parts.append(interview_context)
            summary_parts.append("")

        return "\n".join(summary_parts)

    async def _generate_context_with_ai(
        self,
        project: Project,
        conversation_summary: str
    ) -> Dict:
        """
        Use AI to generate structured context from conversation.

        Args:
            project: Project instance
            conversation_summary: Formatted conversation summary

        Returns:
            Dict with context_semantic, context_human, semantic_map, and insights
        """
        # PROMPT #236 - Externalized to YAML
        from app.prompts.loader import get_prompt_loader
        _loader = get_prompt_loader()

        # PROMPT #120 - Include business rules from memory scan in context
        # PROMPT #170 - Also retrieve business rules from RAG (may be more complete)
        business_rules_section = ""
        business_rules = []

        # First, try to get from initial_memory_context
        if project.initial_memory_context:
            memory_ctx = project.initial_memory_context
            business_rules = memory_ctx.get("business_rules", [])

        # Then, retrieve from RAG (may have additional rules from later analysis)
        try:
            from app.services.rag_service import RAGService
            rag_service = RAGService(self.db)

            rag_rules = rag_service.get_business_rules(
                project_id=project.id,
                top_k=20
            )

            if rag_rules:
                # Add RAG rules that aren't duplicates
                existing_rules_lower = set(r.lower() for r in business_rules)
                for rag_rule in rag_rules:
                    content = rag_rule.get("content", "")
                    if content.lower() not in existing_rules_lower:
                        business_rules.append(content)
                        existing_rules_lower.add(content.lower())

                logger.info(f"📋 Context: Retrieved {len(rag_rules)} business rules from RAG")
        except Exception as e:
            logger.warning(f"⚠️  Failed to retrieve business rules from RAG: {e}")

        if business_rules:
            business_rules_section = "\n\n## REGRAS DE NEGÓCIO VERIFICADAS NO CÓDIGO\n"
            business_rules_section += "(Estas regras foram extraídas automaticamente do código-fonte existente)\n\n"
            for i, rule in enumerate(business_rules, 1):
                business_rules_section += f"{i}. {rule}\n"

        system_prompt, user_prompt = _loader.render(
            "context/context_generation",
            {
                "project_name": project.name,
                "conversation_summary": conversation_summary,
                "business_rules_section": business_rules_section,
            }
        )

        # Call AI
        messages = [{"role": "user", "content": user_prompt}]

        # PROMPT #144 - Increased max_tokens to avoid truncation
        # PROMPT #233 - SP-1 fix: add timeout to prevent hanging forever (like generate_rich_context_from_memory does)
        response = await asyncio.wait_for(
            self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=messages,
                system_prompt=system_prompt,
                max_tokens=8000,
                enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
                project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            ),
            timeout=180.0  # 3 minute timeout
        )

        # Parse response - PROMPT #148: Use robust JSON parser
        response_text = response.get("content", "")
        logger.info(f"[generate_context] Raw response length: {len(response_text)} chars")

        # Use robust JSON parser with multiple recovery strategies
        result = _robust_json_parse(response_text, context="generate_context")

        # Validate required fields
        if "context_semantic" not in result:
            raise ValueError("Resposta da IA sem o campo 'context_semantic'")

        semantic_map = result.get("semantic_map", {})

        # PROMPT #186 - Handle context_semantic returned as dict instead of string
        raw_semantic = result["context_semantic"]
        if isinstance(raw_semantic, dict):
            logger.warning("[generate_context] context_semantic is a dict, converting to markdown string")
            context_semantic = _dict_to_markdown_context(raw_semantic, project.name)
        elif isinstance(raw_semantic, str):
            context_semantic = raw_semantic
        else:
            context_semantic = str(raw_semantic)

        context_semantic = _strip_emojis(context_semantic)

        # Convert semantic to human-readable
        context_human = _strip_emojis(_convert_semantic_to_human(context_semantic, semantic_map))

        # Remove the Mapa Semântico section from human text
        context_human = re.sub(
            r'##\s*Mapa\s*Sem[aâ]ntico\s*\n+(?:[-*]\s*\*\*[^*]+\*\*:[^\n]*\n*)*',
            '',
            context_human,
            flags=re.IGNORECASE | re.MULTILINE
        )
        context_human = context_human.strip()

        return {
            "context_semantic": context_semantic,
            "context_human": context_human,
            "semantic_map": semantic_map,
            "interview_insights": result.get("interview_insights", {})
        }
    async def lock_context(self, project_id: UUID) -> bool:
        """
        Lock the project context, making it immutable.

        PROMPT #89 - Context is locked automatically when first epic is generated.

        Args:
            project_id: Project ID

        Returns:
            True if locked successfully

        Raises:
            ValueError: If project not found or context already locked
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Projeto {project_id} não encontrado")

        if project.context_locked:
            logger.warning(f"Project {project_id} context is already locked")
            return True

        # PROMPT #247 - context_semantic is manual, no fallback auto-generation
        if not project.context_semantic:
            raise ValueError(
                f"Não é possível travar contexto do projeto {project_id}: nenhum contexto gerado ainda"
            )

        project.context_locked = True
        project.context_locked_at = datetime.utcnow()
        self.db.commit()

        logger.info(f"🔒 Context locked for project {project.name}")

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

        return True

    def is_context_ready(self, project_id: UUID) -> bool:
        """
        Check if project context is ready (generated and optionally locked).

        Args:
            project_id: Project ID

        Returns:
            True if context_semantic is not empty
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return False

        return bool(project.context_semantic or project.description)

    def is_context_locked(self, project_id: UUID) -> bool:
        """
        Check if project context is locked.

        Args:
            project_id: Project ID

        Returns:
            True if context is locked
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return False

        return project.context_locked
    async def _generate_auto_context_from_memory(self, project: Project) -> Dict:
        """
        PROMPT #153 - Auto-generate project context from memory scan data.

        Creates a basic context (semantic and human) from the memory scan results
        without requiring an interview. This context is used for card generation.

        Args:
            project: Project instance with initial_memory_context

        Returns:
            Dict with context_semantic and context_human
        """
        memory_ctx = project.initial_memory_context
        if not memory_ctx:
            raise ValueError("Nenhum contexto de memória disponível")

        # Build a summary from memory scan
        stack_info = memory_ctx.get("stack_info", {})
        key_features = memory_ctx.get("key_features", [])
        business_rules = memory_ctx.get("business_rules", [])
        interview_context = memory_ctx.get("interview_context", "")
        suggested_title = _strip_emojis(memory_ctx.get("suggested_title", project.name))

        # Generate semantic context
        semantic_parts = [
            f"# Contexto do Projeto: {suggested_title}",
            "",
            "## Stack Tecnológica",
        ]

        if stack_info.get("detected_stack"):
            semantic_parts.append(f"- **Stack**: {stack_info['detected_stack']}")
        if stack_info.get("languages"):
            langs = ", ".join(stack_info.get("languages", []))
            semantic_parts.append(f"- **Linguagens**: {langs}")

        if key_features:
            semantic_parts.extend(["", "## Funcionalidades Principais"])
            for i, feature in enumerate(key_features, 1):
                semantic_parts.append(f"- F{i}: {feature}")

        if business_rules:
            semantic_parts.extend(["", "## Regras de Negócio Identificadas"])
            for i, rule in enumerate(business_rules, 1):
                semantic_parts.append(f"- RN{i}: {rule}")

        if interview_context:
            semantic_parts.extend(["", "## Análise do Codebase", interview_context])

        context_semantic = _strip_emojis("\n".join(semantic_parts))

        # PROMPT #185 - Generate human-readable context with ALL sections (not just title)
        human_parts = [
            f"# {suggested_title}",
            "",
        ]

        if interview_context:
            human_parts.append(_strip_emojis(interview_context))
            human_parts.append("")

        if stack_info.get("detected_stack"):
            human_parts.extend(["## Stack Tecnológica", ""])
            human_parts.append(f"- Stack: {stack_info['detected_stack']}")
            if stack_info.get("languages"):
                langs = ", ".join(stack_info.get("languages", []))
                human_parts.append(f"- Linguagens: {langs}")
            human_parts.append("")

        if key_features:
            human_parts.extend(["## Funcionalidades Principais", ""])
            for feature in key_features:
                human_parts.append(f"- {feature}")
            human_parts.append("")

        if business_rules:
            human_parts.extend(["## Regras de Negocio", ""])
            for i, rule in enumerate(business_rules, 1):
                human_parts.append(f"{i}. {rule}")
            human_parts.append("")

        context_human = _strip_emojis("\n".join(human_parts))

        # PROMPT #247 - All project fields are manual, no auto-generation
        self.db.commit()

        return {
            "context_semantic": context_semantic,
            "context_human": context_human
        }
    async def generate_rich_context_from_memory(
        self,
        project_id: UUID,
        progress_callback=None,
        ai_timeout: int = 120
    ) -> Dict:
        """
        PROMPT #121 - Generate rich project context from memory scan data using AI.

        Makes 3 focused AI calls (architecture, business domain, features) then
        consolidates into context_semantic + context_human via a 4th AI call.

        PROMPT #240 - Each AI call has a timeout (default 120s) to prevent hanging.

        Args:
            project_id: Project UUID
            progress_callback: Optional async function(percent, message) for progress updates

        Returns:
            Dict with context_semantic, context_human, description
        """
        from app.prompts.loader import PromptLoader

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Projeto {project_id} não encontrado")

        memory_ctx = project.initial_memory_context
        if not memory_ctx:
            raise ValueError(f"Nenhum contexto de memória para o projeto {project_id}")

        loader = PromptLoader()

        stack_info = memory_ctx.get("stack_info", {})
        key_features = memory_ctx.get("key_features", [])
        business_rules = memory_ctx.get("business_rules", [])
        interview_context = memory_ctx.get("interview_context", "")
        scan_summary = memory_ctx.get("scan_summary", interview_context)

        # Format stack_info as text
        stack_text_parts = []
        if stack_info.get("detected_stack"):
            stack_text_parts.append(f"Stack: {stack_info['detected_stack']}")
        if stack_info.get("languages"):
            stack_text_parts.append(f"Linguagens: {', '.join(stack_info['languages'])}")
        if stack_info.get("frameworks"):
            stack_text_parts.append(f"Frameworks: {', '.join(stack_info['frameworks'])}")
        if stack_info.get("databases"):
            stack_text_parts.append(f"Bancos de Dados: {', '.join(stack_info['databases'])}")
        stack_text = "\n".join(stack_text_parts) if stack_text_parts else "Não detectada"

        async def report_progress(percent, message):
            if progress_callback:
                await progress_callback(percent, message)

        # --- Step 1: Architecture Analysis (40-55%) ---
        await report_progress(40, "Analyzing architecture...")
        architecture_analysis = ""
        try:
            sys_prompt, usr_prompt = loader.render(
                "context/rich_context_architecture",
                {
                    "project_name": project.name,
                    "stack_info": stack_text,
                    "scan_summary": scan_summary or "Resumo não disponível"
                }
            )
            response = await asyncio.wait_for(
                self.orchestrator.execute(
                    usage_type="memory",
                    messages=[{"role": "user", "content": usr_prompt}],
                    system_prompt=sys_prompt,
                    max_tokens=4000,
                    enable_rag=True,
                    project_id=str(project.id)
                ),
                timeout=ai_timeout
            )
            architecture_analysis = response.get("content", "")
            logger.info(f"Architecture analysis complete for {project.name}")
        except asyncio.TimeoutError:
            logger.warning(f"Architecture analysis timed out after {ai_timeout}s for {project.name}")
            architecture_analysis = "Análise arquitetural indisponivel: timeout"
        except Exception as e:
            logger.error(f"Architecture analysis failed: {e}")
            architecture_analysis = f"Análise arquitetural indisponivel: {str(e)}"

        # --- Step 2: Business Domain Analysis (55-70%) ---
        await report_progress(55, "Analyzing business domain...")
        business_domain_analysis = ""
        if business_rules:
            try:
                sys_prompt, usr_prompt = loader.render(
                    "context/rich_context_business_domain",
                    {
                        "project_name": project.name,
                        "business_rules": business_rules,
                        "key_features": key_features
                    }
                )
                response = await asyncio.wait_for(
                    self.orchestrator.execute(
                        usage_type="memory",
                        messages=[{"role": "user", "content": usr_prompt}],
                        system_prompt=sys_prompt,
                        max_tokens=4000,
                        enable_rag=True,
                        project_id=str(project.id)
                    ),
                    timeout=ai_timeout
                )
                business_domain_analysis = response.get("content", "")
                logger.info(f"Business domain analysis complete for {project.name}")
            except asyncio.TimeoutError:
                logger.warning(f"Business domain analysis timed out after {ai_timeout}s for {project.name}")
                business_domain_analysis = "Análise de dominio indisponivel: timeout"
            except Exception as e:
                logger.error(f"Business domain analysis failed: {e}")
                business_domain_analysis = f"Análise de dominio indisponivel: {str(e)}"
        else:
            business_domain_analysis = "Nenhuma regra de negocio detectada no codebase."

        # --- Step 3: Feature Landscape (70-85%) ---
        await report_progress(70, "Mapeando funcionalidades...")
        feature_landscape = ""
        if key_features:
            try:
                sys_prompt, usr_prompt = loader.render(
                    "context/rich_context_features",
                    {
                        "project_name": project.name,
                        "key_features": key_features,
                        "business_rules": business_rules,
                        "interview_context": interview_context
                    }
                )
                response = await asyncio.wait_for(
                    self.orchestrator.execute(
                        usage_type="memory",
                        messages=[{"role": "user", "content": usr_prompt}],
                        system_prompt=sys_prompt,
                        max_tokens=4000,
                        enable_rag=True,
                        project_id=str(project.id)
                    ),
                    timeout=ai_timeout
                )
                feature_landscape = response.get("content", "")
                logger.info(f"Feature landscape complete for {project.name}")
            except asyncio.TimeoutError:
                logger.warning(f"Feature landscape timed out after {ai_timeout}s for {project.name}")
                feature_landscape = "Mapa de funcionalidades indisponivel: timeout"
            except Exception as e:
                logger.error(f"Feature landscape failed: {e}")
                feature_landscape = f"Mapa de funcionalidades indisponivel: {str(e)}"
        else:
            feature_landscape = "Nenhuma funcionalidade detectada no codebase."

        # --- Step 4: Consolidation (85-95%) ---
        await report_progress(85, "Consolidating context...")
        try:
            sys_prompt, usr_prompt = loader.render(
                "context/rich_context_consolidation",
                {
                    "project_name": project.name,
                    "architecture_analysis": architecture_analysis,
                    "business_domain_analysis": business_domain_analysis,
                    "feature_landscape": feature_landscape
                }
            )
            response = await asyncio.wait_for(
                self.orchestrator.execute(
                    usage_type="memory",
                    messages=[{"role": "user", "content": usr_prompt}],
                    system_prompt=sys_prompt,
                    max_tokens=8000,
                    enable_rag=True,
                    project_id=str(project.id)
                ),
                timeout=ai_timeout * 2  # Consolidation gets double timeout (larger output)
            )

            content = response.get("content", "")

            # Parse JSON response
            # PROMPT #192 - Robust JSON parsing for AI responses with unescaped newlines
            import json
            context_semantic = ""
            context_human = ""
            try:
                # Try to extract JSON from the response
                json_start = content.find("{")
                json_end = content.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    json_str = content[json_start:json_end]
                    try:
                        parsed = json.loads(json_str)
                    except json.JSONDecodeError:
                        # AI often returns JSON with unescaped newlines inside string values
                        # Fix by escaping newlines within JSON string values
                        import re
                        # Extract values using regex for each known key
                        sem_match = re.search(r'"context_semantic"\s*:\s*"(.*?)"(?:\s*,\s*"context_human")', json_str, re.DOTALL)
                        hum_match = re.search(r'"context_human"\s*:\s*"(.*?)"(?:\s*[,}])\s*$', json_str, re.DOTALL)
                        if sem_match and hum_match:
                            context_semantic = sem_match.group(1).replace('\\n', '\n')
                            context_human = hum_match.group(1).replace('\\n', '\n')
                            parsed = None  # Skip the parsed.get below
                        else:
                            # Last resort: try to fix newlines by replacing them in string values
                            fixed = re.sub(r'(?<=": ")(.*?)(?="[,}])', lambda m: m.group(0).replace('\n', '\\n'), json_str, flags=re.DOTALL)
                            parsed = json.loads(fixed)
                    if parsed is not None:
                        context_semantic = parsed.get("context_semantic", "")
                        context_human = parsed.get("context_human", "")
            except (json.JSONDecodeError, Exception) as e:
                logger.warning(f"Could not parse consolidation JSON: {e}, using raw content")
                context_semantic = content
                context_human = content

            if not context_semantic:
                context_semantic = content
            if not context_human:
                context_human = content

        except asyncio.TimeoutError:
            logger.warning(f"Consolidation timed out after {ai_timeout * 2}s for {project.name}, using direct combination")
            context_semantic = f"# {project.name}\n\n{architecture_analysis}\n\n{business_domain_analysis}\n\n{feature_landscape}"
            context_human = context_semantic
        except Exception as e:
            logger.error(f"Consolidation failed: {e}")
            # Fallback: combine the 3 analyses directly
            context_semantic = f"# {project.name}\n\n{architecture_analysis}\n\n{business_domain_analysis}\n\n{feature_landscape}"
            context_human = context_semantic

        # PROMPT #247 - All project fields are manual, no auto-generation
        self.db.commit()

        # --- Store in RAG ---
        try:
            rag_service = RAGService(self.db)
            rag_service.store_project_context(
                project_id=project.id,
                context_semantic=context_semantic,
                context_human=context_human
            )
            logger.info(f"Rich context stored in RAG for {project.name}")
        except Exception as e:
            logger.error(f"Failed to store rich context in RAG: {e}")

        await report_progress(95, "Contexto gerado com sucesso")

        logger.info(f"Rich context generation complete for {project.name}")

        return {
            "context_semantic": context_semantic,
            "context_human": context_human,
            "description": context_human
        }
