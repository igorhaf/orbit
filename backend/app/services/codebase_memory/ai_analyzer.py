"""
AI Analyzer Mixin for CodebaseMemoryService

Contains methods that call the AI orchestrator for codebase analysis:
- Multi-phase analysis (_analyze_phase, _consolidate_phases, _ai_analyze_codebase_phased)
- Chain prompting for local models (_chain_prompting_analysis, _chain_analyze_single_file, _chain_consolidate_insights)
- Legacy single-pass analysis (_ai_analyze_codebase)

PROMPT #163 - Multi-phase analysis with configurable depth
PROMPT #167 - Chain Prompting for local models
PROMPT #230 - Symbol extraction for compression
PROMPT #284 - Structured JSON extraction from files
"""

import json
import logging
import asyncio
from pathlib import Path
from typing import Dict, List, Optional, Any
from uuid import UUID

from app.services.symbol_extractor import extract_symbols, format_symbol_map

logger = logging.getLogger(__name__)


class AIAnalyzerMixin:
    """Mixin providing AI-driven codebase analysis methods."""

    async def _analyze_phase(
        self,
        phase_name: str,
        samples: List[Dict],
        stack_info: Dict,
        project_id: Optional[UUID],
        previous_context: Optional[Dict] = None
    ) -> Dict:
        """
        Execute one phase of analysis using externalized YAML prompt.

        PROMPT #163 - Each phase saves a prompt to the prompts table.
        PROMPT #230 - Symbol extraction, confidence scoring, reranking.
        """
        if not samples:
            logger.info(f"⏭️ Skipping phase '{phase_name}' - no samples")
            return {
                "partial_title": "",
                "business_rules_found": [],
                "features_found": [],
                "entities_found": [],
                "insights": f"No files found for {phase_name} phase"
            }

        # PROMPT #230 - Rerank samples for this specific phase
        samples = self._rerank_samples_for_phase(samples, phase_name)

        logger.info(f"🔄 Starting phase: {phase_name} ({len(samples)} files)")

        try:
            from app.contracts.loader import ContractLoader
            loader = ContractLoader()

            # PROMPT #230 - Use symbol extraction for code samples
            code_content = self._format_samples_for_prompt(samples, use_symbols=True)
            previous_analysis = json.dumps(previous_context, ensure_ascii=False) if previous_context else None

            system_prompt, user_prompt = loader.render(
                "memory/codebase_analysis",
                {
                    "folder_name": self.current_folder_name,
                    "phase_name": phase_name,
                    "code_content": code_content,
                    "previous_analysis": previous_analysis,
                    "stack_detected": stack_info.get("detected_stack", "")
                }
            )

            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "phase": phase_name,
                    "files_count": len(samples),
                    "scan_type": "memory_scan_phase",
                    "scan_depth": self.current_scan_depth
                }
            )

            result = self._parse_phase_response(response.get("content", "{}"))

            # PROMPT #230 - Score confidence and decide if fallback needed
            confidence = self._score_phase_confidence(result)
            logger.info(f"📊 Phase '{phase_name}' confidence: {confidence}/100")

            if confidence >= 30:
                logger.info(f"✅ Completed phase: {phase_name} - found {len(result.get('business_rules_found', []))} rules (confidence: {confidence})")
                return result

            # PROMPT #230 - Low confidence: retry with fallback
            logger.warning(f"⚠️ Phase '{phase_name}' low confidence ({confidence}), retrying with fallback model...")
            smaller_samples = samples[:max(5, len(samples) // 2)]
            code_content = self._format_samples_for_prompt(smaller_samples, use_symbols=True)
            system_prompt, user_prompt = loader.render(
                "memory/codebase_analysis",
                {
                    "folder_name": self.current_folder_name,
                    "phase_name": phase_name,
                    "code_content": code_content,
                    "previous_analysis": previous_analysis,
                    "stack_detected": stack_info.get("detected_stack", "")
                }
            )
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "phase": f"{phase_name}_fallback",
                    "files_count": len(smaller_samples),
                    "scan_type": "memory_scan_phase_fallback",
                    "scan_depth": self.current_scan_depth,
                    "confidence_original": confidence
                }
            )
            fallback_result = self._parse_phase_response(response.get("content", "{}"))
            fallback_confidence = self._score_phase_confidence(fallback_result)

            if fallback_confidence > confidence:
                logger.info(f"✅ Fallback improved confidence: {confidence} -> {fallback_confidence}")
                return fallback_result

            logger.info(f"✅ Completed phase: {phase_name} - found {len(result.get('business_rules_found', []))} rules")
            return result

        except Exception as e:
            logger.error(f"❌ Phase '{phase_name}' failed: {e}")
            return {
                "partial_title": "",
                "business_rules_found": [],
                "features_found": [],
                "entities_found": [],
                "insights": f"Phase {phase_name} failed: {str(e)}"
            }

    async def _consolidate_phases(
        self,
        all_phases: Dict,
        stack_info: Dict,
        project_id: Optional[UUID],
        total_files: int
    ) -> Dict:
        """
        Consolidate all phase results into final analysis.
        PROMPT #163 - Uses externalized YAML prompt for consolidation.
        """
        logger.info("🔄 Starting consolidation phase...")

        try:
            from app.contracts.loader import ContractLoader
            loader = ContractLoader()

            all_phases_text = json.dumps(all_phases, ensure_ascii=False, indent=2)

            system_prompt, user_prompt = loader.render(
                "memory/consolidation",
                {
                    "all_phases": all_phases_text,
                    "folder_name": self.current_folder_name,
                    "stack_info": json.dumps(stack_info),
                    "total_files_analyzed": total_files
                }
            )

            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "phase": "consolidation",
                    "scan_type": "memory_scan_consolidation",
                    "scan_depth": self.current_scan_depth,
                    "total_phases": len(all_phases)
                }
            )

            content = response.get("content", "{}")

            from app.services.utility_node_executor import UtilityNodeExecutor
            parsed = UtilityNodeExecutor._try_parse_json(content.strip(), auto_repair=True)
            if parsed and isinstance(parsed, dict):
                logger.info(f"✅ Consolidation complete - Title: {parsed.get('suggested_title', 'N/A')}")
                return parsed

            logger.warning("Consolidation returned invalid JSON, using merge fallback")
            return self._merge_phase_results(all_phases, stack_info)

        except Exception as e:
            logger.error(f"❌ Consolidation failed: {e}")
            return self._merge_phase_results(all_phases, stack_info)

    async def _ai_analyze_codebase_phased(
        self,
        code_samples: List[Dict[str, str]],
        stack_info: Dict,
        scan_summary: Dict,
        root_path: Path,
        project_id: Optional[UUID] = None,
        scan_depth: str = "normal"
    ) -> Dict[str, Any]:
        """
        Perform multi-phase AI analysis of codebase.
        PROMPT #163 - Main method for phased analysis.
        """
        config = self.SCAN_DEPTH_CONFIG.get(scan_depth, self.SCAN_DEPTH_CONFIG["normal"])
        phases_completed = 0
        all_phases = {}

        if scan_depth == "quick":
            doc_samples = [s for s in code_samples if s["type"] in ["documentation", "configuration"]]
            all_phases["documentation"] = await self._analyze_phase(
                "documentation", doc_samples, stack_info, project_id
            )
            phases_completed += 1

            code_only = [s for s in code_samples if s["type"] == "code"][:15]
            all_phases["quick_scan"] = await self._analyze_phase(
                "quick_scan", code_only, stack_info, project_id,
                previous_context=all_phases.get("documentation")
            )
            phases_completed += 1

        elif scan_depth == "normal":
            doc_samples = [s for s in code_samples if s["type"] in ["documentation", "configuration"]]
            domain_samples = [s for s in code_samples if self._is_domain_file(s["filename"])][:25]

            # PROMPT #247 - Sequential execution to avoid blocking Claudius
            logger.info("🔗 Running documentation then domain phases sequentially...")
            doc_result = await self._analyze_phase("documentation", doc_samples, stack_info, project_id)
            await asyncio.sleep(1.0)
            domain_result = await self._analyze_phase("domain", domain_samples, stack_info, project_id)
            all_phases["documentation"] = doc_result
            all_phases["domain"] = domain_result
            phases_completed += 2

            logic_samples = [s for s in code_samples if self._is_logic_file(s["filename"])][:25]
            all_phases["logic"] = await self._analyze_phase(
                "logic", logic_samples, stack_info, project_id,
                previous_context=all_phases.get("domain")
            )
            phases_completed += 1

        elif scan_depth == "local":
            logger.info("🔗 Using Chain Prompting strategy for local model")

            all_phases = await self._chain_prompting_analysis(
                code_samples, stack_info, project_id
            )
            phases_completed = len(all_phases)

            if "final" in all_phases:
                consolidated = all_phases["final"]
                consolidated["phases_completed"] = phases_completed
                return consolidated

        else:  # deep mode
            doc_samples = [s for s in code_samples if s["type"] in ["documentation", "configuration"]]
            all_phases["documentation"] = await self._analyze_phase(
                "documentation", doc_samples, stack_info, project_id
            )
            phases_completed += 1

            code_only = [s for s in code_samples if s["type"] == "code"]
            files_per_phase = config.get("files_per_phase", 15)

            previous_ctx = all_phases.get("documentation")
            phase_num = 2

            for i in range(0, len(code_only), files_per_phase):
                batch = code_only[i:i + files_per_phase]

                domain_count = sum(1 for s in batch if self._is_domain_file(s["filename"]))
                logic_count = sum(1 for s in batch if self._is_logic_file(s["filename"]))

                if domain_count > logic_count:
                    batch_type = "domain"
                elif logic_count > 0:
                    batch_type = "logic"
                else:
                    batch_type = "code"

                phase_name = f"batch_{phase_num}_{batch_type}"
                all_phases[phase_name] = await self._analyze_phase(
                    batch_type, batch, stack_info, project_id,
                    previous_context=previous_ctx
                )
                previous_ctx = all_phases[phase_name]
                phases_completed += 1
                phase_num += 1

        # Final phase: Consolidation
        consolidated = await self._consolidate_phases(
            all_phases, stack_info, project_id, len(code_samples)
        )
        phases_completed += 1

        consolidated["phases_completed"] = phases_completed

        return consolidated

    # =========================================================================
    # PROMPT #167 - Chain Prompting for Local Models
    # =========================================================================

    async def _chain_prompting_analysis(
        self,
        code_samples: List[Dict[str, str]],
        stack_info: Dict,
        project_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """
        PROMPT #167 - Chain Prompting strategy for local models (Ollama/Qwen).
        """
        all_phases = {}
        file_insights = []

        # PROMPT #236 - Proportional file limit
        available_count = len(code_samples)
        max_files = max(5, min(25, available_count * 50 // 100))

        logger.info(f"🔗 Chain Prompting: Analyzing {max_files}/{available_count} files individually")

        from app.services.console_logger import get_console_logger
        console = get_console_logger()
        total_files = min(len(code_samples), max_files)

        for i, sample in enumerate(code_samples[:max_files]):
            filename = sample.get("filename", f"file_{i}")
            content = sample.get("content", "")[:2000]

            progress = 50 + (i / total_files) * 30
            logger.info(f"   Analyzing file {i+1}/{total_files}: {filename}")

            asyncio.create_task(console.log_memory_scan(
                phase=f"file_{i+1}/{total_files}",
                message=f"Analyzing: {filename} ({i+1}/{total_files})",
                files_processed=i+1,
                project_id=str(project_id) if project_id else None
            ))

            try:
                insight = await self._chain_analyze_single_file(
                    filename, content, project_id, i+1
                )
                if insight:
                    file_insights.append(insight)
                    all_phases[f"file_{i+1}"] = insight
            except Exception as e:
                logger.warning(f"   ⚠️ Failed to analyze {filename}: {e}")
                continue

        if file_insights:
            logger.info(f"🔗 Chain Prompting: Consolidating {len(file_insights)} file insights")
            final_result = await self._chain_consolidate_insights(
                file_insights, stack_info, project_id
            )
            all_phases["final"] = final_result
        else:
            logger.warning("⚠️ Chain Prompting: No insights collected, using fallback")
            all_phases["final"] = {
                "suggested_title": self._generate_fallback_title(stack_info, self.current_folder_name),
                "business_rules": [],
                "key_features": [],
                "entities": [],
                "interview_context": f"Este projeto usa {stack_info.get('detected_stack', 'tecnologia desconhecida')}."
            }

        return all_phases

    async def _chain_analyze_single_file(
        self,
        filename: str,
        content: str,
        project_id: Optional[UUID],
        file_num: int
    ) -> Optional[Dict]:
        """
        PROMPT #167 - Analyze a single file with a tiny prompt.
        PROMPT #230 - Uses symbol extraction instead of raw code.
        """
        try:
            symbols = extract_symbols(filename, content)
            symbol_text = format_symbol_map(symbols)
        except Exception:
            symbol_text = content[:1500]

        system_prompt = "Você é um analista de código. Responda APENAS em JSON válido, sem markdown. IDIOMA: português brasileiro."

        user_prompt = f"""Arquivo: {filename}

{symbol_text}

Análise este arquivo e responda em JSON:
{{
  "purpose": "O que este arquivo faz (1 frase)",
  "business_rules": ["regra1", "regra2"],
  "features": ["funcionalidade1"],
  "entities": ["entidade1"],
  "system_hint": ""
}}

REGRAS:
- business_rules: validacoes, restricoes, calculos, permissoes, fluxos de negocio encontrados. Liste TODAS que encontrar. Se nenhuma, lista vazia.
- features: funcionalidades que o arquivo implementa (ex: "autenticação JWT", "upload de arquivos")
- entities: modelos/tabelas/dados principais (ex: "Usuário", "Pedido", "Produto")
- system_hint: se encontrar <title>XXX</title> ou dominio .gov.br/.com.br, escreva aqui
- TUDO em português brasileiro"""

        try:
            response = await asyncio.wait_for(
                self.orchestrator.execute(
                    usage_type="memory",
                    messages=[{"role": "user", "content": user_prompt}],
                    system_prompt=system_prompt,
                    max_tokens=400,
                    project_id=project_id,
                    metadata={
                        "phase": f"chain_file_{file_num}",
                        "scan_type": "chain_prompting",
                        "filename": filename
                    }
                ),
                timeout=300.0
            )

            text = response.get("content", "").strip()
            if not text:
                return None

            from app.services.utility_node_executor import UtilityNodeExecutor
            parsed = UtilityNodeExecutor._try_parse_json(text, auto_repair=True)

            if parsed and isinstance(parsed, dict):
                return {
                    "filename": filename,
                    "analysis": parsed.get("purpose", text),
                    "business_rules": parsed.get("business_rules", []),
                    "features": parsed.get("features", []),
                    "entities": parsed.get("entities", []),
                    "system_hint": parsed.get("system_hint", "")
                }

            return {
                "filename": filename,
                "analysis": text,
                "business_rules": [],
                "features": [],
                "entities": [],
                "system_hint": ""
            }

        except asyncio.TimeoutError:
            logger.warning(f"Timeout analyzing {filename} (>5min), skipping...")
            return None
        except Exception as e:
            logger.warning(f"Chain analyze failed for {filename}: {e}")
            return None

    async def _chain_consolidate_insights(
        self,
        file_insights: List[Dict],
        stack_info: Dict,
        project_id: Optional[UUID]
    ) -> Dict:
        """
        PROMPT #167 - Consolidate file insights into final result.
        PROMPT #284 - Aggregates structured rules/features from each file.
        """
        # Aggregate rules, features, entities from all file insights
        all_rules = []
        all_features = []
        all_entities = []
        system_hints = []
        summaries = []

        for insight in file_insights:
            for rule in insight.get("business_rules", []):
                if rule and isinstance(rule, str) and rule.lower() not in ("nenhuma", "nenhum", "none", "n/a", ""):
                    all_rules.append(rule)
            for feat in insight.get("features", []):
                if feat and isinstance(feat, str) and feat.lower() not in ("nenhuma", "nenhum", "none", "n/a", ""):
                    all_features.append(feat)
            for ent in insight.get("entities", []):
                if ent and isinstance(ent, str) and ent.lower() not in ("nenhuma", "nenhum", "none", "n/a", ""):
                    all_entities.append(ent)
            hint = insight.get("system_hint", "")
            if hint and hint.lower() not in ("", "nenhum", "nenhuma", "none"):
                system_hints.append(hint)
            summaries.append(f"- {insight['filename']}: {insight.get('analysis', '')}")

        # Deduplicate (case-insensitive)
        unique_rules = self._deduplicate_list(all_rules)
        unique_features = self._deduplicate_list(all_features)
        unique_entities = self._deduplicate_list(all_entities)

        logger.info(
            f"Chain aggregation: {len(unique_rules)} rules, "
            f"{len(unique_features)} features, {len(unique_entities)} entities "
            f"from {len(file_insights)} files"
        )

        stack_name = stack_info.get("detected_stack", "desconhecida")

        rules_text = "\n".join([f"  - {r}" for r in unique_rules[:30]]) if unique_rules else "  Nenhuma regra encontrada"
        features_text = "\n".join([f"  - {f}" for f in unique_features[:20]]) if unique_features else "  Nenhuma feature encontrada"
        entities_text = ", ".join(unique_entities[:15]) if unique_entities else "Nenhuma"
        hints_text = "\n".join([f"  - {h}" for h in system_hints]) if system_hints else ""
        summaries_text = "\n".join(summaries[:15])

        system_prompt = "Você é um arquiteto de software. Responda APENAS em JSON válido, sem markdown. IDIOMA OBRIGATÓRIO: Todo o conteúdo DEVE ser em português brasileiro."

        user_prompt = f"""Pasta do projeto: {self.current_folder_name}
Stack: {stack_name}

REGRAS DE NEGOCIO EXTRAIDAS DOS ARQUIVOS:
{rules_text}

FUNCIONALIDADES ENCONTRADAS:
{features_text}

ENTIDADES: {entities_text}

RESUMO DOS ARQUIVOS:
{summaries_text}
{f"DICAS DE SISTEMA: {chr(10).join(system_hints)}" if hints_text else ""}

Com base nessas informações REAIS extraidas do código, gere o JSON final:
{{
  "suggested_title": "Título descritivo do sistema (5-8 palavras)",
  "business_rules": ["lista COMPLETA de regras de negocio - inclua TODAS as regras acima + adicione se encontrar mais"],
  "key_features": ["lista COMPLETA de funcionalidades - inclua TODAS acima + adicione se encontrar mais"],
  "entities": ["lista de entidades/modelos principais"],
  "interview_context": "Paragrafo de 100-200 palavras descrevendo o proposito, stack, funcionalidades e regras principais do sistema"
}}

INSTRUÇÕES:
1. MANTENHA todas as regras e features ja extraidas - NÃO descarte nenhuma
2. Se possível, adicione mais regras inferidas dos resumos dos arquivos
3. interview_context deve ser um texto RICO e DETALHADO, não apenas 1 frase
4. Título deve refletir o dominio do negocio, NÃO a tecnologia
5. TUDO em português brasileiro"""

        try:
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=2000,
                project_id=project_id,
                metadata={
                    "phase": "chain_consolidation",
                    "scan_type": "chain_prompting",
                    "files_analyzed": len(file_insights),
                    "rules_pre_aggregated": len(unique_rules),
                    "features_pre_aggregated": len(unique_features)
                }
            )

            content = response.get("content", "{}")

            from app.services.utility_node_executor import UtilityNodeExecutor
            result = UtilityNodeExecutor._try_parse_json(content.strip(), auto_repair=True)
            if not result or not isinstance(result, dict):
                result = {}

            # Ensure we don't lose pre-aggregated data if AI returned less
            ai_rules = result.get("business_rules", [])
            ai_features = result.get("key_features", [])
            ai_entities = result.get("entities", [])

            if len(ai_rules) < len(unique_rules):
                result["business_rules"] = self._merge_lists(ai_rules, unique_rules)
            if len(ai_features) < len(unique_features):
                result["key_features"] = self._merge_lists(ai_features, unique_features)
            if len(ai_entities) < len(unique_entities):
                result["entities"] = self._merge_lists(ai_entities, unique_entities)

            title = result.get("suggested_title", "")
            result["suggested_title"] = self._validate_title(title, self.current_folder_name, stack_info)

            logger.info(
                f"Chain Prompting complete - Title: {result.get('suggested_title')}, "
                f"Rules: {len(result.get('business_rules', []))}, "
                f"Features: {len(result.get('key_features', []))}"
            )
            return result

        except Exception as e:
            logger.error(f"Chain consolidation failed: {e}")
            return {
                "suggested_title": self._generate_fallback_title(stack_info, self.current_folder_name),
                "business_rules": unique_rules[:20],
                "key_features": unique_features[:15],
                "entities": unique_entities[:10],
                "interview_context": f"Sistema {stack_name} com {len(file_insights)} arquivos analisados. "
                    f"Regras identificadas: {', '.join(unique_rules[:5])}. "
                    f"Funcionalidades: {', '.join(unique_features[:5])}."
            }

    # =========================================================================
    # Legacy method (kept for backwards compatibility)
    # =========================================================================

    async def _ai_analyze_codebase(
        self,
        code_samples: List[Dict[str, str]],
        stack_info: Dict,
        scan_summary: Dict,
        root_path: Optional[Path] = None
    ) -> Dict[str, Any]:
        """
        Use AI to analyze codebase and extract insights.
        Legacy single-pass method.
        """
        context_parts = []

        if stack_info.get("detected_stack"):
            context_parts.append(
                f"Detected Technology Stack: {stack_info['detected_stack']} "
                f"({stack_info.get('description', '')})"
            )
            context_parts.append(f"Confidence: {stack_info.get('confidence', 0)}%")

        context_parts.append(f"\nCodebase Statistics:")
        context_parts.append(f"- Total files: {scan_summary.get('total_files', 0)}")
        context_parts.append(f"- Code files: {scan_summary.get('code_files', 0)}")

        languages = scan_summary.get("languages", {})
        if languages:
            lang_str = ", ".join([f"{k}: {v}" for k, v in languages.items()])
            context_parts.append(f"- Languages: {lang_str}")

        context_parts.append("\n\n--- CODE SAMPLES ---\n")
        for sample in code_samples:
            context_parts.append(f"\n### File: {sample['filename']} ({sample['type']})")
            context_parts.append("```")
            context_parts.append(sample["content"])
            context_parts.append("```\n")

        full_context = "\n".join(context_parts)

        folder_name = root_path.name if root_path else (
            Path(code_samples[0]["filename"]).parts[0] if code_samples else "Projeto"
        )

        # Load prompt from YAML if available, otherwise use inline
        from app.contracts.loader import ContractLoader
        loader = ContractLoader()

        try:
            system_prompt, user_prompt = loader.render(
                "memory/codebase_analysis_legacy",
                {
                    "folder_name": folder_name,
                    "full_context": full_context
                }
            )
        except Exception:
            # Fallback to inline prompt for legacy compatibility
            system_prompt = f"""Você é um arquiteto de software especialista analisando uma base de código.
Sua tarefa é EXTRAIR PROFUNDAMENTE as regras de negócio e entender o propósito do sistema.
O nome da pasta é "{folder_name}" - use isso como pista do domínio.

FORMATO DE RESPOSTA (JSON):
{{
    "suggested_title": "Nome Descritivo do Sistema",
    "business_rules": ["Regra 1", "Regra 2"],
    "key_features": ["Feature 1", "Feature 2"],
    "interview_context": "Parágrafo detalhado..."
}}"""
            user_prompt = full_context

        try:
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt
            )

            content = response.get("content", "{}")
            from app.services.utility_node_executor import UtilityNodeExecutor
            result = UtilityNodeExecutor._try_parse_json(content.strip(), auto_repair=True)
            if not result or not isinstance(result, dict):
                result = {}

            return {
                "suggested_title": result.get("suggested_title", ""),
                "business_rules": result.get("business_rules", []),
                "key_features": result.get("key_features", []),
                "interview_context": result.get("interview_context", "")
            }

        except Exception as e:
            logger.error(f"AI analysis failed: {e}")
            return {
                "suggested_title": self._generate_fallback_title(stack_info, folder_name),
                "business_rules": [],
                "key_features": [],
                "interview_context": f"Este projeto parece ser um sistema {stack_info.get('detected_stack', 'de software')}. A análise automática não conseguiu extrair detalhes específicos do código."
            }

    # =========================================================================
    # Helper methods
    # =========================================================================

    @staticmethod
    def _deduplicate_list(items: List[str]) -> List[str]:
        """Case-insensitive deduplication preserving order."""
        seen = set()
        unique = []
        for item in items:
            key = item.lower().strip()
            if key not in seen:
                seen.add(key)
                unique.append(item)
        return unique

    @staticmethod
    def _merge_lists(primary: List[str], secondary: List[str]) -> List[str]:
        """Merge two lists with case-insensitive deduplication."""
        merged = list(primary)
        existing = {r.lower().strip() for r in merged}
        for item in secondary:
            if item.lower().strip() not in existing:
                merged.append(item)
                existing.add(item.lower().strip())
        return merged
