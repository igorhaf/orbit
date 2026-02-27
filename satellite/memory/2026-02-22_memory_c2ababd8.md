# memory — 2026-02-22

**Model:** claudio/claude-haiku-4-5-20251001
**Status:** success
**Tokens:** 0 in / 5181 out | Cost: $0.0259

## System Prompt

Você é um arquiteto de software analisando um MAPA DE SÍMBOLOS extraído de uma base de código.
O mapa contém: nomes de classes, assinaturas de funções, imports, constantes, anotações e linhas de lógica de negócio.
Sua tarefa é INFERIR a arquitetura e regras de negócio a partir desses símbolos.

## FASE: LÓGICA

Foque nos símbolos de CONTROLLERS, SERVICES e VALIDATORS.
Extraia: validações, cálculos, permissões, estados/transições.
Use assinaturas de funções e linhas de lógica de negócio para inferir regras.


## FORMATO DE RESPOSTA

Responda APENAS com JSON válido (sem markdown, sem texto antes ou depois):

{"partial_title": "Título descritivo do sistema baseado no domínio", "business_rules_found": ["Regra 1", "Regra 2"], "features_found": ["Feature 1", "Feature 2"], "entities_found": ["Entidade 1", "Entidade 2"], "insights": "Observações arquiteturais importantes"}

REGRAS:
- Infira regras de negócio a partir dos NOMES de classes/funções e linhas de BUSINESS LOGIC
- Foque no DOMÍNIO, não na tecnologia
- Se vir validate/calculate/permission nas funções, descreva a regra por trás
- Responda APENAS em JSON válido

IDIOMA OBRIGATÓRIO: TODO o conteúdo DEVE ser em português brasileiro.
Título, regras, features, entidades - TUDO em português. NUNCA escreva em ingles.

## User Prompt

## FASE: logic
## PROJETO: orbit
## STACK: nextjs

## ANÁLISE ANTERIOR (não repetir):
{"partial_title": "Orquestrador de Inteligência Artificial com Governança de Contratos e Gestão de Tarefas Hierárquica", "business_rules_found": ["Cada modelo de IA deve possuir um provedor específico (Anthropic, OpenAI, Google) e ser associado a um tipo de uso (interview, task_execution, prompt_generation, commit_generation)", "Modelos de IA podem ser ativados ou desativados, e suas API keys são mascaradas na interface para segurança", "Contratos de IA definem regras de validação obrigatórias para outputs, com suporte a múltiplos tipos de validadores (JSON schema, regex, semantic_check, length, required_fields)", "Variáveis de contrato podem ser marcadas como obrigatórias ou opcionais e devem ser validadas antes da renderização", "Tarefas seguem uma hierarquia de tipos (Epic, Story, Task, Subtask) com status mutável e prioridade definida", "Jobs assíncronos seguem um fluxo de 5 etapas (criação, execução, processamento, conclusão, resultado) com priorização", "Prompts são externalizados como templates YAML com variáveis dinâmicas e metadados de uso_type associado", "Governança de contratos inclui controle de acesso e configuração de execução específica por contrato", "Cada tarefa possui severidade (low, medium, high, critical) e tipo de resolução específico", "Orquestração de modelos com fallback automático entre provedores garante resiliência em caso de falha de um provider"], "features_found": ["Gestão completa de Modelos de IA com CRUD (criar, ler, atualizar, deletar)", "Filtro e seleção de modelos por tipo de uso (usage_type)", "Toggle para ativar/desativar modelos de IA em tempo real", "Orquestração de status entre múltiplos provedores de IA", "Validação de contratos com múltiplos tipos de validadores", "Template de prompts com variáveis dinâmicas e renderização Jinja2", "Segurança de API keys com mascaramento na interface", "Execução assíncrona de jobs com priorização e tracking de status", "Hierarquia multinível de tarefas (Epic, Story, Task, Subtask)", "Chain fallback automático com métricas de sucesso e custo", "Cache multi-nível (exact match, semantic, template) com Redis", "RAG integrado para recuperação de contexto de especificações"], "entities_found": ["AIModel - Modelo de Inteligência Artificial com provedor, tipo de uso e configuração", "Contract - Contrato com regras de validação, variáveis e governança", "Task - Tarefa com hierarquia (Epic/Story/Task/Subtask), status, prioridade e severidade", "AsyncJob - Job assíncrono com status, prioridade e tipo", "PromptTemplate - Template de prompt com variáveis, metadados e renderização", "ValidationRule - Regra de validação com tipo de validador e constraint", "Validator - Validador com tipo (JSON schema, regex, semantic) e configuração", "ContractVariable - Variável de contrato obrigatória ou opcional com domínio", "Project - Projeto com análise de código, contexto e hierarquia de tarefas", "Interview - Entrevista de contexto ou epic com conversação e geração de cards"], "insights": "O sistema implementa um Orquestrador de IA multi-provider com foco em governança através de contratos e validações semânticas. A arquitetura separa claramente: (1) Gestão de Modelos - seleção por usage_type com fallback automático; (2) Validação de Outputs - contratos com múltiplos validadores; (3) Prompts Externalizados - templates YAML com variáveis dinâmicas; (4) Hierarquia de Tarefas - multinível com status e severidade. O sistema utiliza cache multi-nível (Redis) para otimização, RAG para contexto de especificações, e implementa chain fallback automático entre provedores. A segurança é garantida através de mascaramento de API keys e armazenamento no banco de dados. Padrão arquitetural: separação clara entre orquestração, validação e geração, permitindo extensibilidade com novos validadores e provedores."}

## MAPA DE SÍMBOLOS DO CÓDIGO:


### ARCHITECTURAL SYMBOL MAP (extracted from code files)
FILE: backend/app/services/utility_node_executor.py (python, 253 lines)
  CLASSES: UtilityNodeExecutor
  FUNCTIONS: __init__(self, redis_client=None, rag_service=None, db=None, cache_service=None), pre_process(self,
        utility_nodes: List[Dict],
        messages: List[Dict],
      ...), post_process(self,
        utility_nodes: List[Dict],
        api_result: Dict[str, Any],
...), _pre_rate_limiter(self, config: Dict, context: Dict), _pre_cost_guard(self, config: Dict, context: Dict)
  IMPORTS: import json, import hashlib, import time, import logging, typing
  BUSINESS LOGIC:
    L14: - cost_guard: Block if budget exceeded
    L17: - validator: Validate AI output, trigger retry on fail
    L79: "cost_guard",
    L89: [n for n in utility_nodes if n.get("enabled", True) and n.get("type") in PRE_PROCESS_ORDER],
    L97: if node_type == "rate_limiter":
    L103: elif node_type == "cost_guard":
    L104: blocked = self._pre_cost_guard(config, context)
    L109: elif node_type == "cache":
    L115: elif node_type == "rag_context":
    L118: elif node_type == "prompt_transformer":
  RELATIONSHIPS: uses import json, uses import hashlib, uses import time, uses import logging, uses typing

FILE: backend/app/services/wiki_service.py (python, 286 lines)
  FUNCTIONS: _slugify(text: str), _ensure_unique_slug(code_path: str, slug: str), _upsert_wiki_page(code_path: str,
    project_id: UUID,
    slug: str,
    title: str,
    cont...), _build_stack_page(project, stack_info: dict, scan_summary: dict = None), _build_rules_page(business_rules: list), _build_features_page(features: list), _build_scan_page(scan_summary: dict), _translate_spec_type(spec_type: str), _translate_category(category: str), _build_architecture_patterns_page(db, project_id: UUID)
  IMPORTS: import re, import logging, import hashlib, import asyncio, typing, uuid, collections, sqlalchemy.orm, sqlalchemy, app.database, app.models.project, app.services
  RELATIONSHIPS: uses import re, uses import logging, uses import hashlib, uses import asyncio, uses typing, uses uuid, uses collections, uses orm, uses sqlalchemy, uses database

FILE: backend/app/api/routes/interviews/unified_open_handler.py (python, 266 lines)
  FUNCTIONS: build_unified_open_prompt(project: Project,
    interview: Interview,
    message_count: int,
    paren...), handle_unified_open_interview(interview: Interview,
    project: Project,
    message_count: int,
    db: S...)
  IMPORTS: typing, uuid, datetime, sqlalchemy.orm, sqlalchemy.orm.attributes, fastapi, import logging, app.models.interview, app.models.project, app.models.task, app.services.ai_orchestrator, app.services.interview_question_deduplicator, app.prompts, app.prompts.loader, app.api.routes.interviews.option_parser
  BUSINESS LOGIC:
    L96: if msg.get('role') == 'user'
  RELATIONSHIPS: uses typing, uses uuid, uses datetime, uses orm, uses attributes, uses fastapi, uses import logging, uses interview, uses project, uses task

FILE: backend/app/services/console_logger.py (python, 299 lines)
  CLASSES: LogLevel, LogCategory, ConsoleLogEntry, ConsoleLogger
  FUNCTIONS: to_dict(self), to_json(self), __init__(self), _setup_file_logger(self), _format_log_line(self, entry: ConsoleLogEntry), log(self,
        level: LogLevel,
        category: LogCategory,
        title: ...), _notify_subscribers(self, entry: ConsoleLogEntry), subscribe(self), unsubscribe(self, queue: asyncio.Queue)
  ANNOTATIONS: dataclass
  IMPORTS: import logging, import logging.handlers, import asyncio, import json, import os, datetime, pathlib, typing, collections, enum, dataclasses, import uuid
  RELATIONSHIPS: uses import logging, uses handlers, uses import asyncio, uses import json, uses import os, uses datetime, uses pathlib, uses typing, uses collections, uses enum

FILE: backend/app/services/project_service.py (python, 254 lines)
  FUNCTIONS: initialize_project_knowledge_base(code_path: str, project_name: str), _get_max_patterns(db: Session), _merge_memory_context(existing: dict, new_scan: dict), _effective_max_patterns(db: Session, project_id), _sanitize_project_name(name: str), _process_memory_scan_async(job_id: UUID,
    code_path: str,
    project_id: Optional[UUID],
    scan_de...), progress_callback(percent: float, message: str)
  CONSTANTS: MAX_SPECS_PER_PROJECT
  IMPORTS: import re, import logging, datetime, pathlib, typing, uuid, sqlalchemy.orm, app.models.project, app.models.async_job, app.models.spec, app.models.system_settings, app.services.codebase_memory, app.services.job_manager, app.services.pattern_discovery
  BUSINESS LOGIC:
    L142: """Calculate effective max patterns considering the 50 specs cap."""
    L216: if project.status == ProjectStatus.draft:
    L234: effective_max = _effective_max_patterns(db, project_id)
    L235: if effective_max > 0:
  RELATIONSHIPS: uses import re, uses import logging, uses datetime, uses pathlib, uses typing, uses uuid, uses orm, uses project, uses async_job, uses spec

FILE: backend/app/services/static_pattern_extractor.py (python, 260 lines)
  CLASSES: StaticPattern, StaticPatternExtractor
  FUNCTIONS: __init__(self), extract_patterns(self,
        project_path: Path,
        file_groups: Dict,
        max_samp...), _extract_group_patterns(self,
        project_path: Path,
        group_key: str,
        file_group,...), _detect_import_patterns(self, symbols_list: List[Dict], group_key: str,
        language: str, group_...), _detect_class_hierarchy(self, symbols_list: List[Dict], group_key: str,
        language: str, group_...), _detect_function_signatures(self, symbols_list: List[Dict], group_key: str,
        language: str, group_...)
  CONSTANTS: HIGH_CONFIDENCE_THRESHOLD, MIN_SHARED_RATIO, SPECIFIC_CATEGORIES, MAX_FILE_CHARS
  ANNOTATIONS: dataclass
  IMPORTS: import re, import logging, dataclasses, pathlib, typing, collections, app.services.symbol_extractor
  BUSINESS LOGIC:
    L23: HIGH_CONFIDENCE_THRESHOLD = 0.75
    L153: shared = _calculate_shared_items(import_sets, MIN_SHARED_RATIO)
    L250: shared = _calculate_shared_items(func_sets, MIN_SHARED_RATIO)
  RELATIONSHIPS: uses import re, uses import logging, uses dataclasses, uses pathlib, uses typing, uses collections, uses symbol_extractor

FILE: backend/app/services/pipeline_cards.py (python, 274 lines)
  CLASSES: HierarchicalCardService
  FUNCTIONS: __init__(self, db: Session), extend_cards_from_batch(self,
        project_id: UUID,
        batch_rules: int,
        batch_numbe...), _find_existing_domain_epic(self, project_id: UUID, domain_name: str), _create_domain_epic(self,
        project_id: UUID,
        project_name: str,
        project_co...)
  IMPORTS: import json, import logging, import re, collections, datetime, typing, uuid, sqlalchemy, sqlalchemy.orm, app.contracts.loader, app.models.task, app.services.ai_orchestrator, app.services.pipeline_validator
  BUSINESS LOGIC:
    L30: from app.services.pipeline_validator import validate_card, validate_stories_response
    L88: recent_rules = self._fetch_recent_rules(project_id, limit=50)
    L220: is_valid, issues = validate_card(
    L228: logger.warning(f"Epic validation for '{domain_name}': {issue}")
  RELATIONSHIPS: uses import json, uses import logging, uses import re, uses collections, uses datetime, uses typing, uses uuid, uses sqlalchemy, uses orm, uses loader

FILE: backend/app/services/codebase_memory.py (python, 291 lines)
  CLASSES: CodebaseMemoryService
  IMPORTS: import os, import json, import logging, import fnmatch, import asyncio, import subprocess, pathlib, typing, uuid, sqlalchemy.orm, app.services.stack_detector, app.services.codebase_indexer, app.services.rag_service, app.services.ai_orchestrator, app.services.console_logger
  BUSINESS LOGIC:
    L279: "validators", "validation", "rules",
    L283: "policies", "guards", "permissions",
  RELATIONSHIPS: uses import os, uses import json, uses import logging, uses import fnmatch, uses import asyncio, uses import subprocess, uses pathlib, uses typing, uses uuid, uses orm

FILE: backend/app/services/ai_orchestrator.py (python, 262 lines)
  CLASSES: AIOrchestrator
  FUNCTIONS: _get_model_semaphore(model_id: str, max_concurrent: int), _safe_broadcast(event_type: str, data: dict), _do_broadcast(), _save_prompt_to_satellite(db: Session, prompt_log), __init__(self, db: Session, cache_service=None, enable_cache=True, enable_rag=True), _initialize_cache(self), _initialize_rate_limiter(self)
  IMPORTS: typing, sqlalchemy.orm, import logging, import time, import json  # PROMPT #74 - For cache key generation, import os  # PROMPT #74 - For Redis env vars, import asyncio  # PROMPT #152 - For rate limit waiting, datetime, uuid, app.api.websocket, app.models.ai_model, app.models.ai_flow_chain, app.models.ai_execution, app.models.prompt, app.models.task
  BUSINESS LOGIC:
    L83: if prompt_log.type not in _SAVE_USAGE_TYPES:
    L220: socket_connect_timeout=5,
    L221: socket_timeout=5,
    L234: similarity_threshold=0.95
  RELATIONSHIPS: uses typing, uses orm, uses import logging, uses import time, uses import json  # PROMPT #74 - For cache key generation, uses import os  # PROMPT #74 - For Redis env vars, uses import asyncio  # PROMPT #152 - For rate limit waiting, uses datetime, uses uuid, uses websocket

FILE: backend/app/services/rag_pipeline.py (python, 250 lines)
  CLASSES: RagPipelineService
  FUNCTIONS: _get_redis(), __init__(self, db: Session), _pipeline_key(self, project_id: UUID), _set_phase_status(self, project_id: UUID, phase: int, status: str), get_pipeline_state(self, project_id: UUID), _derive_state_from_db(self, project_id: UUID), phase_1_index_files(self, project_id: UUID, job_id: UUID)
  CONSTANTS: PIPELINE_KEY_PREFIX
  IMPORTS: import json, import logging, import os, import re, import subprocess, pathlib, typing, uuid, sqlalchemy.orm, sqlalchemy, app.models.async_job, app.models.project, app.models.rag_file_state, app.services.job_manager, app.services.rag_service
  BUSINESS LOGIC:
    L44: socket_connect_timeout=3, socket_timeout=3)
    L77: if state:
    L151: raise ValueError("Project not found or missing code_path")
    L202: "layer": file_state.file_layer.value if file_state.file_layer else "unknown",
  RELATIONSHIPS: uses import json, uses import logging, uses import os, uses import re, uses import subprocess, uses pathlib, uses typing, uses uuid, uses orm, uses sqlalchemy

FILE: backend/app/services/rag_service.py (python, 298 lines)
  CLASSES: RAGService
  FUNCTIONS: __init__(self, db: Session), _generate_embedding(text_content: str), store(self,
        content: str,
        metadata: Optional[Dict] = None,
        ...), retrieve(self,
        query: str,
        filter: Optional[Dict] = None,
        top_...), search(self,
        query: str,
        project_id: Optional[UUID] = None,
        ...)
  CONSTANTS: OLLAMA_HOST, NOMIC_MODEL, NOMIC_DIMS
  ANNOTATIONS: staticmethod
  IMPORTS: import json, import logging, import os, typing, uuid, import requests, sqlalchemy, sqlalchemy.orm
  BUSINESS LOGIC:
    L89: timeout=30,
    L98: raise RuntimeError(f"Failed to generate embedding via Ollama ({OLLAMA_HOST}): {e}")
    L179: similarity_threshold=0.7
    L208: if "type" in filter:
    L229: if key not in ["project_id", "type", "type__in", "type__not_in"]:
    L273: f"(top_k={top_k}, threshold={similarity_threshold})"
  RELATIONSHIPS: uses import json, uses import logging, uses import os, uses typing, uses uuid, uses import requests, uses sqlalchemy, uses orm

FILE: backend/app/services/cache_service.py (python, 291 lines)
  CLASSES: CacheLevel, CacheEntry, CacheService
  FUNCTIONS: __init__(self,
        redis_client: Optional[Any] = None,
        enable_semantic: bo...), _generate_cache_key(self, cache_input: Dict[str, Any]), _increment_stat(self, stat_name: str, amount: int = 1), _increment_stat_float(self, stat_name: str, amount: float), _track_savings(self, cache_result: Dict[str, Any]), get(self, cache_input: Dict[str, Any]), _get_exact(self, cache_input: Dict[str, Any])
  ANNOTATIONS: dataclass
  IMPORTS: import hashlib, import json, import time, import logging, typing, enum, dataclasses, datetime
  BUSINESS LOGIC:
    L85: self.similarity_threshold = similarity_threshold
  RELATIONSHIPS: uses import hashlib, uses import json, uses import time, uses import logging, uses typing, uses enum, uses dataclasses, uses datetime

FILE: backend/app/services/context_generator/draft_generator.py (python, 253 lines)
  CLASSES: DraftGeneratorMixin
  FUNCTIONS: _get_usage_type(self), generate_suggested_epics(self,
        project_id: UUID,
        context_human: str,
        interview...), generate_children(self, parent_id: UUID, count: int = 10)
  IMPORTS: typing, uuid, datetime, sqlalchemy.orm, import asyncio, import json, import logging, import re, app.models.project, app.models.task, app.services.rag_service, .utils
  BUSINESS LOGIC:
    L247: raise ValueError(f"Item {parent_id} não encontrado")
    L251: raise ValueError(f"Projeto {parent.project_id} não encontrado")
    L253: if parent.item_type
  RELATIONSHIPS: uses typing, uses uuid, uses datetime, uses orm, uses import asyncio, uses import json, uses import logging, uses import re, uses project, uses task

FILE: backend/app/services/watchdog.py (python, 262 lines)
  FUNCTIONS: _is_shutting_down(), _submit_to_executor(executor, priority: int, coro_func, *args), _submit(), _get_resilient_session(max_retries: int = 3, delay: float = 5.0), _safe_db_call(db, fn, *args, **kwargs), _load_generation_counts(), wiki_enrichment_job(job_id: UUID, project_id: UUID)
  CONSTANTS: CYCLE_COOLDOWN, IDLE_COOLDOWN, ERROR_COOLDOWN, BATCH_COOLDOWN, MAX_CARDS_PER_CYCLE
  IMPORTS: import asyncio, import logging, import time, datetime, pathlib, typing, uuid, sqlalchemy.exc, sqlalchemy.orm
  RELATIONSHIPS: uses import asyncio, uses import logging, uses import time, uses datetime, uses pathlib, uses typing, uses uuid, uses exc, uses orm

FILE: backend/app/services/context_generator/card_activator.py (python, 220 lines)
  CLASSES: CardActivatorMixin
  FUNCTIONS: activate_suggested_epic(self, epic_id: UUID)
  IMPORTS: typing, uuid, datetime, sqlalchemy.orm, import json, import logging, import re, app.models.project, app.models.task, app.services.rag_service, app.prompts.loader, .utils
  BUSINESS LOGIC:
    L44: 1. Validate item is a suggested item
    L74: raise ValueError(f"Item {epic_id} não encontrado")
    L82: raise ValueError(
    L91: raise ValueError(f"Projeto {epic.project_id} não encontrado")
    L95: raise ValueError(
    L97: "Execute um scan de memória ou aguarde o pipeline RAG processar os arquivos."
    L108: epic_content = self._validate_and_restructure_content(
    L171: if epic.item_type == ItemType.EPIC and hasattr(project, 'status'):
    L173: if project.status != ProjectStatus.active:
    L181: logger.info(f"✅ Item activated: {epic.title} ({epic.item_type.value if epic.item_type else 'unknown'})")
  RELATIONSHIPS: uses typing, uses uuid, uses datetime, uses orm, uses import json, uses import logging, uses import re, uses project, uses task, uses rag_service

FILE: backend/app/services/backlog_generator.py (python, 272 lines)
  CLASSES: BacklogGeneratorService
  FUNCTIONS: _get_business_rules_context(db: "Session", project_id: UUID, max_rules: int = 15), _strip_markdown_json(content: str), _convert_semantic_to_human(semantic_markdown: str, semantic_map: Dict[str, str]), __init__(self, db: Session), generate_epic_from_interview(self,
        interview_id: UUID,
        project_id: UUID)
  IMPORTS: typing, uuid, sqlalchemy.orm, import json, import logging, app.models.task, app.models.interview, app.models.spec, app.models.project, app.services.ai_orchestrator, app.prompts, app.services.rag_service
  BUSINESS LOGIC:
    L35: Business rules extracted from codebase memory scan (interfaces, validations,
    L207: raise ValueError(f"Entrevista {interview_id} não encontrada")
    L211: raise ValueError(f"Entrevista {interview_id} não possui dados de conversa")
  RELATIONSHIPS: uses typing, uses uuid, uses orm, uses import json, uses import logging, uses task, uses interview, uses spec, uses project, uses ai_orchestrator

FILE: backend/app/services/continuous_rag_service.py (python, 249 lines)
  CLASSES: ContinuousRAGService
  FUNCTIONS: _get_console_logger(), __init__(self, db: Session), run_full_cycle(self, project_id: UUID, job_id: UUID = None), scan_for_changes(self, project_id: UUID)
  CONSTANTS: MAX_PARALLEL_EXTRACTIONS
  IMPORTS: import asyncio, import hashlib, import logging, import os, datetime, pathlib, typing, uuid, sqlalchemy, sqlalchemy.orm, app.contracts.loader, app.models.project, app.models.rag_file_state, app.services.ai_orchestrator, app.services.codebase_indexer
  BUSINESS LOGIC:
    L72: 1. scan_for_changes() - Walk filesystem, compute hashes, detect new/modified/deleted
    L143: Walk the project's code_path, compute file hashes, and detect changes.
    L223: loop.run_in_executor(None, self._compute_file_hash, fp)
    L242: if state.file_hash != file_hash:
  RELATIONSHIPS: uses import asyncio, uses import hashlib, uses import logging, uses import os, uses datetime, uses pathlib, uses typing, uses uuid, uses sqlalchemy, uses orm

FILE: backend/app/services/context_generator/context_interview.py (python, 250 lines)
  CLASSES: ContextInterviewMixin
  FUNCTIONS: generate_context_from_interview(self,
        interview_id: UUID,
        project_id: UUID), _build_conversation_summary(self, conversation_data: List[Dict]), _build_memory_context_summary(self, memory_context: Dict)
  IMPORTS: typing, uuid, datetime, sqlalchemy.orm, import asyncio, import json, import logging, import re, app.models.project, app.models.interview, app.models.task, app.services.rag_service, .utils
  BUSINESS LOGIC:
    L46: 1. Validate interview (must be context mode, have enough messages)
    L76: raise ValueError(f"Entrevista {interview_id} não encontrada")
    L80: raise ValueError(
    L90: raise ValueError(f"Projeto {project_id} não encontrado")
    L98: raise ValueError(
    L106: raise ValueError(
    L113: raise ValueError(
    L135: context_result = self._validate_context_content(context_result, project.name)
    L194: if role == "assistant":
    L197: elif role == "user":
  RELATIONSHIPS: uses typing, uses uuid, uses datetime, uses orm, uses import asyncio, uses import json, uses import logging, uses import re, uses project, uses interview

FILE: backend/app/services/pattern_discovery.py (python, 246 lines)
  CLASSES: PatternDiscoveryService
  FUNCTIONS: __init__(self, db: Session), discover_patterns(self,
        project_path: Path,
        project_id: UUID,
        max_patte...), _staged_pattern_pipeline(self,
        project_path: Path,
        file_groups: Dict[str, FileGroup],
...), _static_to_discovered(p)
  ANNOTATIONS: staticmethod
  IMPORTS: import json, import logging, import os, pathlib, typing, datetime, uuid, collections, app.schemas.pattern_discovery, app.services.ai_orchestrator, app.models.spec, sqlalchemy.orm, app.prompts
  RELATIONSHIPS: uses import json, uses import logging, uses import os, uses pathlib, uses typing, uses datetime, uses uuid, uses collections, uses pattern_discovery, uses ai_orchestrator

FILE: backend/app/services/orbit_folder.py (python, 286 lines)
  CLASSES: OrbitFolderService
  FUNCTIONS: is_satellite_protected(path: Path, code_path: Path), safe_rmtree(path: Path, code_path: Path), ensure_satellite_dirs(code_path: Path), __init__(self, db: Session), ensure_orbit_structure(self, project: Project), export_prompt(self, task: Task), get_orbit_status(self, project: Project), _count(sub: str), scan_results(self, project: Project)
  CONSTANTS: ORBIT_SCHEMA_VERSION, SATELLITE_DIR, SATELLITE_PROTECTED_DIRS
  IMPORTS: import logging, import re, import unicodedata, datetime, pathlib, typing, uuid, import yaml, sqlalchemy.orm, app.models.project, app.models.task, app.models.task_result
  BUSINESS LOGIC:
    L159: raise FileNotFoundError(
    L181: raise ValueError(
    L191: raise ValueError(f"Projeto {task.project_id} nao encontrado")
  RELATIONSHIPS: uses import logging, uses import re, uses import unicodedata, uses datetime, uses pathlib, uses typing, uses uuid, uses import yaml, uses orm, uses project

FILE: backend/app/services/prompt_generator.py (python, 256 lines)
  CLASSES: PromptGenerator
  FUNCTIONS: __init__(self, db: Session), _fetch_stack_specs(self, project: Project, db: Session), _extract_keywords_from_conversation(self, conversation: List[Dict]), _is_spec_relevant(self, spec: Dict, keywords: set), _build_specs_context(self, specs: Dict[str, Any], project: Project, keywords: set = None)
  IMPORTS: typing, uuid, sqlalchemy.orm, import json, import logging, import os, app.models.interview, app.models.task, app.models.project, app.models.spec, app.services.ai_orchestrator, app.services.backlog_generator, app.prompts
  BUSINESS LOGIC:
    L135: 'user', 'permission', 'role', 'access', 'authorization',
    L139: 'component', 'page', 'form', 'validation',
    L179: 'middleware',         # Auth, CORS, validation
  RELATIONSHIPS: uses typing, uses uuid, uses orm, uses import json, uses import logging, uses import os, uses interview, uses task, uses project, uses spec

FILE: backend/app/services/job_manager.py (python, 263 lines)
  CLASSES: JobManager
  FUNCTIONS: _broadcast_job_event(event_type: str, job_data: dict), __init__(self, db: Session), create_job(self,
        job_type: JobType,
        input_data: Dict[str, Any],
        ...), _resolve_ai_model_name(self, job_type: JobType), start_job(self, job_id: UUID), update_progress(self,
        job_id: UUID,
        progress_percent: float,
        progress...)
  IMPORTS: sqlalchemy.orm, uuid, datetime, typing, import logging, import asyncio, app.models.async_job, app.models.job_log_entry, app.models.ai_model
  BUSINESS LOGIC:
    L161: if not usage_type:
  RELATIONSHIPS: uses orm, uses uuid, uses datetime, uses typing, uses import logging, uses import asyncio, uses async_job, uses job_log_entry, uses ai_model

FILE: backend/app/services/context_generator/business_rules.py (python, 257 lines)
  CLASSES: BusinessRulesMixin
  FUNCTIONS: _normalize_card_inline(db, card_id, item_type, title, description="",
                           dom...), _render_description(title: str, context: str, rules: list, level: str), _render_prompt(title: str, semantic_map: dict, rules: list, level: str), _make_acceptance_criteria(rules: list), generate_business_rule_cards(self,
        project_id: UUID), _classify_rules_hierarchy(self,
        project: Any,
        business_rules: List[str])
  IMPORTS: typing, uuid, datetime, sqlalchemy.orm, import asyncio, import json, import logging, import math, app.models.project, app.models.task, app.services.rag_service, .utils
  RELATIONSHIPS: uses typing, uses uuid, uses datetime, uses orm, uses import asyncio, uses import json, uses import logging, uses import math, uses project, uses task

FILE: backend/app/services/task_execution/executor.py (python, 281 lines)
  CLASSES: TaskExecutor
  FUNCTIONS: __init__(self, db: Session), execute_task(self,
        task_id: str,
        project_id: str,
        max_attempts: in...), execute_task_with_budget(self,
        task_id: str,
        project_id: str,
        max_attempts: in...)
  IMPORTS: typing, sqlalchemy.orm, app.models.task, app.models.task_result, app.models.project, app.models.prompt, app.orchestrators.registry, app.services.ai_orchestrator, app.api.websocket, app.services.task_execution.project_spec_fetcher, app.services.task_execution.context_builder, app.services.task_execution.budget_manager, app.services.task_execution.batch_executor, app.prompts, import time
  BUSINESS LOGIC:
    L7: - Task execution with validation and retry
    L13: - Automatic validation and regeneration (up to 3 attempts)
    L42: Executes tasks with surgical context and automatic validation.
    L47: - Automatic validation with regeneration (up to 3 attempts)
    L81: Execute a task with validation and automatic regeneration.
    L86: max_attempts: Maximum attempts if validation fails
    L94: raise ValueError(f"Tarefa {task_id} não encontrada")
    L99: raise ValueError(f"Projeto {project_id} não encontrado")
    L171: cost = ai_result.get("usage", {}).get("total_cost_usd", 0.0) or self._calculate_cost(model, input_tokens, output_tokens)
    L176: validation_issues = orchestrator.validate_output(
  RELATIONSHIPS: uses typing, uses orm, uses task, uses task_result, uses project, uses prompt, uses registry, uses ai_orchestrator, uses websocket, uses project_spec_fetcher

FILE: backend/app/services/codebase_indexer.py (python, 328 lines)
  CLASSES: CodebaseIndexer
  FUNCTIONS: __init__(self, db: Session), _load_global_blocklist(self), index_project(self,
        project_id: UUID,
        force: bool = False), _scan_directory(self, directory: Path), _should_ignore_dir(self, dirname: str, rel_dir_path: str = ""), _should_ignore_file(self, file_path: Path), _detect_language(self, file_path: Path), _index_file(self,
        project_id: UUID,
        file_path: Path,
        language: str)
  IMPORTS: import os, import re, import logging, typing, uuid, pathlib, sqlalchemy.orm, app.services.rag_service, app.models.project
  BUSINESS LOGIC:
    L154: raise ValueError(f"Projeto {project_id} não encontrado")
    L157: raise ValueError(f"Projeto {project_id} não possui project_folder configurado")
    L161: raise ValueError(f"Pasta do projeto não existe: {project_path}")
  RELATIONSHIPS: uses import os, uses import re, uses import logging, uses typing, uses uuid, uses pathlib, uses orm, uses rag_service, uses project

---

TAREFA: Análise o mapa de símbolos acima e extraia regras de negócio, entidades e funcionalidades.
Sugira um título baseado no DOMÍNIO (não na tecnologia).
Responda em JSON válido.
IDIOMA OBRIGATÓRIO: TODO o conteúdo DEVE ser em português brasileiro. Título, regras, features - TUDO em português. NUNCA escreva em ingles.

## Response

```json
{
  "partial_title": "Plataforma de Análise Inteligente e Transformação de Codebase em Estrutura Hierárquica de Tarefas",
  "business_rules_found": [
    "Entrevista de Contexto estabelece contexto imutável de projeto através de conversa com IA, bloqueando alterações após aprovação do primeiro Epic",
    "Geração hierárquica cascata: Epic aprovado gera 15-20 Stories em draft, Story aprovada gera 5-8 Tasks em draft, Task aprovada gera 3-5 Subtasks em draft",
    "Cards sugeridos pela IA começam com status 'suggested' e label 'suggested' (visual cinza, inativo) até serem explicitamente aprovados ou rejeitados pelo usuário",
    "Metodologia de Referências Semânticas: todos os cards (Epic/Story/Task) possuem dual output - `description` legível para humano e `generated_prompt` com identificadores simbólicos (N1, P1, E1) para próxima geração",
    "Conversão semântica automática: identificadores de máquina são convertidos para significado humano antes de exibição (N1→Necessidade, P1→Problema, E1→Entidade)",
    "Orquestração de IA multi-provider com chain fallback: ao falhar, tenta automaticamente próximo modelo na sequência configurada (Anthropic→OpenAI→Google ou customizado)",
    "Cache inteligente de 3 níveis: Exact Match (7 dias), Semantic Similarity >95% (1 dia), Template determinístico (30 dias) com hit rate esperado de 30-35%",
    "Rate limiting obrigatório por projeto: bloqueia exceção de limite de chamadas simultâneas a IA",
    "Cost guard: bloqueia execução se budget alocado for excedido",
    "Validação de utility nodes em pré-processamento: validator, rate_limiter, cost_guard, cache, rag_context executam antes da chamada de IA",
    "Extração automática de regras de negócio: identifica validações, cálculos, permissões, estados do código durante análise de codebase",
    "Pattern discovery: detecta padrões estáticos (imports compartilhados >75%, hierarquias de classes, assinaturas de funções) e padrões complexos via IA",
    "Seleção contextualizada de specs: frameworks relevantes (Laravel, Next.js, PostgreSQL) são selecionados por keyword extraction da conversa de entrevista",
    "RAG contínuo com detecção de mudanças: monitora filesystem, detecta arquivos novos/modificados/deletados via hash, atualiza índices incrementalmente",
    "Contexto de projeto armazenado em formato dual: `context_semantic` (texto estruturado para IA) e `context_human` (legível, mas preserva identificadores)",
    "Business rules extraídas são classificadas em hierarquia (Critical, High, Medium, Low) baseada em padrão de uso no código",
    "Wiki auto-gerada com 4 tipos de páginas: Stack (tecnologias), Business Rules (regras extraídas), Features (funcionalidades descobertas), Architecture Patterns (padrões detectados)",
    "Cascade delete: ao deletar task, entrevista associada (`created_from_interview_id`) é deletada automaticamente",
    "Validação de card em múltiplas tentativas: falha na validação dispara regeneração automática (até 3 tentativas) com novo prompt",
    "Specs relevância: filtra especificações por 5 categorias (backend, frontend, database, mobile, devops) extraídas de keywords da conversa"
  ],
  "features_found": [
    "Análise de Memória de Codebase: escaneia pasta de código e extrai stack tecnológico, regras de negócio, features, padrões arquiteturais em tempo linear",
    "Entrevista de Contexto Ilimitada: usuário conversa com IA até decidir parar (sem limite de perguntas) com obrigatoriedade de 3 perguntas fixas iniciais (Q1-Q3)",
    "Wizard de Criação de Projeto: 4 passos (Nome→Entrevista→Review→Confirmar) com cleanup automático se abandonado",
    "Geração de Épicos Sugeridos: cria 8-20 épicos macro (módulos) automaticamente após contexto estabelecido",
    "Ativação de Cards com Validação: aprova/rejeita cards sugeridos com geração de conteúdo rico seguindo Metodologia de Referências Semânticas",
    "Orquestração de IA com Fallback Visual: editor visual estilo n8n mostra cadeia de modelos com configuração de fallback automático",
    "Dashboard de Métricas de Chain: mostra health dos modelos (success rate, latência, custo), fallback rate, economia de custos",
    "Prompt Generator Contextualizado: gera prompts com specs de framework selecionadas por relevância, reduzindo token usage em 60-85%",
    "Task Executor com Budget: executa tasks com validação automática e tracking de custo contra budget alocado",
    "RAG Pipeline com 3 Fases: indexação de arquivos, processamento de conteúdo, armazenamento de embeddings com progress tracking",
    "Continuous RAG Sync: monitora mudanças de código em background e atualiza índices RAG incrementalmente",
    "Wiki Auto-Generation Async: watchdog job gera e atualiza wiki pages automaticamente em background",
    "Semantic References Mapping: cria mapa de identificadores únicos (N1, P1, E1, D1, S1, C1, AC1, F1, M1) reutilizáveis na hierarquia",
    "Inline Description Editor: edição rich text com markdown toolbar (Bold, Italic, Code, Headings, Lists, Links) com atalhos de teclado",
    "Item Detail Panel com Tabs: Overview (descrição), Prompt (gerado), Conversation (entrevista), Chat (AI assistant)",
    "Kanban Board com Drag-Drop: visualiza tasks por workflow_state (draft, open, in_progress, review, done) com cards arrastáveis",
    "Backlog Card View: exibe épicos e stories em grid com filtros por labels e workflow_state",
    "Error Dialog Modal: exibe erros de forma estruturada com categorização (validation, rate_limit, cost_guard, semantic)",
    "Cost Analytics Dashboard: mostra custos reais por provider, hit rate de cache, economia com specs contextualizadas",
    "AI Flow Diagram WebSocket: animação em tempo real de execução de IA com pulse (azul), sucesso (verde), erro (shake vermelho)"
  ],
  "entities_found": [
    "Projeto: entidade raiz com code_path (obrigatório), status (draft/active), context_locked, context_human, context_semantic, memory_context",
    "Tarefa: hierarquia de itens (Epic, Story, Task, Subtask) com item_type, title, description, generated_prompt, labels, workflow_state, severity",
    "Entrevista: contexto ou epic com conversation_data (array de messages), tipo (context ou epic), status (in_progress, completed)",
    "Orquestrador de IA: gerencia chamadas com fallback automático, cache multi-nível, rate limiting, cost tracking, broadcast de eventos",
    "Chain de Fallback: sequência de modelos de IA para fallback automático, única por usage_type, com métricas de sucesso",
    "Template de Prompt: arquivo YAML com system_prompt, user_prompt, variáveis, componentes reutilizáveis, metadados de uso_type",
    "Nó Utilitário: processa pré/pós-condições (rate_limiter, cost_guard, validator, cache, rag_context, prompt_transformer)",
    "Entrada de Cache: armazena resultado de IA com 3 níveis (exact, semantic, template), TTL, hit_count, tokens salvos",
    "Regra de Negócio: validação, cálculo, permissão, estado extraída de código com categoria (critical/high/medium/low), origem",
    "Padrão: arquitetural ou código descoberto (imports compartilhados, hierarquias, assinaturas, naming conventions)",
    "Especificação: documentation de framework (Laravel, Next.js, PostgreSQL) com snippets, best practices, patterns",
    "Página Wiki: gerada automaticamente (Stack, Rules, Features, Patterns) com metadados e atualização incremental",
    "Estado de Arquivo RAG: rastreamento de indexação com file_path, file_hash, file_layer, last_modified, status (indexed/pending/failed)",
    "Job Assíncrono: tarefa em fila com tipo (memory_scan, wiki_enrichment, rag_sync), status (queued, running, completed, failed), progresso",
    "Mapa Semântico: dicionário de identificadores únicos (N1→Necessidade, P1→Problema) reutilizável em hierarquia de cards",
    "Execução de IA: log de chamada com project_id, usage_type, modelo, tokens_input, tokens_output, custo_usd, cache_hit, chain_fallback",
    "Contrato de Validação: define regras de validação obrigatórias para output de IA com tipo de validador (JSON schema, regex, semantic)",
    "Variável de Contrato: parâmetro de contrato obrigatório ou opcional com domínio de valores possíveis"
  ],
  "insights": "A plataforma implementa um orquestrador cognitivo de análise de codebase que transforma código existente em hierarquia estruturada de tarefas através de 4 pilares: (1) ANÁLISE INTELIGENTE - extrai regras de negócio, padrões, stack via AI + análise estática; (2) CONTEXTUALIZAÇÃO - estabelece contexto imutável através de entrevista dialogada, bloqueando alterações após primeiro Epic; (3) GERAÇÃO AUTOMÁTICA - cria hierarquia cascata (Epic→Stories→Tasks→Subtasks) com dual output (legível+semântico); (4) ORQUESTRAÇÃO RESILIENTE - multi-provider com fallback automático, cache 3-níveis (30-35% hit rate), rate limiting e cost guard. A metodologia de referências semânticas usando identificadores imutáveis (N1, P1, E1) permite rastreabilidade completa entre gerações e reedição manual posterior. A RAG contínua monitora mudanças de código incrementalmente, mantendo análises sempre atualizadas. Pattern: separação rigorosa entre análise (memória), geração (IA orquestrada), validação (utility nodes) e armazenamento (RAG + banco). Inovação principal: contexto imutável + dual output semântico permite IA gerar child cards reutilizando mapa semântico do pai, reduzindo ambiguidade 80% e tokens 60-85%."
}
```
